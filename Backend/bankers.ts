/**
 * Bankers — `bank_contact` rows, administered as reusable master data,
 * independent of any case.
 *
 * Source of truth: ADR-034, ADR-036. Schema: Database/migrations/0003,
 * 0019, 0024.
 *
 * `bank_contact` and its read path (`Backend/lenders.ts`'s `GET /api/lenders`,
 * which nests active contacts under each branch) already existed — what this
 * module adds is the write path, which did not: there was no way to record a
 * banker except by hand-editing the database. Without it, the case-side "Add
 * bank" flow could only ever offer free-typed addresses, so the same banker
 * got retyped on every case that used them. A banker created here shows up
 * immediately in every case's Bank → Branch → Banker picker
 * (`submission_recipient.bank_contact_id`) and is never recreated.
 *
 * PERMISSIONS. Read requires `organisation.read` (every role). Write
 * (`createBanker`, `updateBanker`, `setBankerActive`) requires
 * `organisation.update` — held by telecaller, login_executive, manager and
 * managing_partner (src/domain/permissions/roles.ts), deliberately not by
 * admin (system administration, not business data, per that role's own
 * doc comment) or finance (deliberately narrow). A case's own
 * `submission.create` path only ever selects an existing banker; it never
 * calls into this module, so a login desk with `organisation.update` but
 * mid-case does not need a second permission just to pick a name.
 */

import { isEmailShaped } from "@domain/submissions/recipients.js";

import type { Queryable } from "./db.js";
import { can, type Actor } from "./authorize.js";
import { ApiError, refusalMessage } from "./http.js";
import { recordBankContactEvent } from "./events.js";

export interface Banker {
  readonly id: string;
  readonly institutionOrganisationId: string;
  readonly institutionName: string;
  readonly branchOrganisationId: string | null;
  readonly branchName: string | null;
  readonly name: string | null;
  readonly designation: string | null;
  readonly workEmail: string | null;
  readonly workMobile: string | null;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
}

function requireRead(actor: Actor): void {
  if (!can(actor, "organisation.read", "all")) {
    throw new ApiError(403, refusalMessage("organisation.read"));
  }
}

function requireWrite(actor: Actor): void {
  if (!can(actor, "organisation.update", "all")) {
    throw new ApiError(403, refusalMessage("organisation.update"));
  }
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() : undefined;
}

const BANKER_SELECT = `
  select bc.id, bc.institution_organisation_id, i.canonical_name as institution_name,
         bc.branch_organisation_id, br.canonical_name as branch_name,
         bc.contact_name, bc.designation, bc.work_email, bc.work_mobile,
         bc.is_primary_contact, bc.is_active
    from bank_contact bc
    join organisation i on i.id = bc.institution_organisation_id
    left join organisation br on br.id = bc.branch_organisation_id`;

function bankerFromRow(row: Record<string, unknown>): Banker {
  return {
    id: row.id as string,
    institutionOrganisationId: row.institution_organisation_id as string,
    institutionName: row.institution_name as string,
    branchOrganisationId: (row.branch_organisation_id as string | null) ?? null,
    branchName: (row.branch_name as string | null) ?? null,
    name: (row.contact_name as string | null) ?? null,
    designation: (row.designation as string | null) ?? null,
    workEmail: (row.work_email as string | null) ?? null,
    workMobile: (row.work_mobile as string | null) ?? null,
    isPrimary: row.is_primary_contact as boolean,
    isActive: row.is_active as boolean,
  };
}

/**
 * Every banker, active and inactive alike — the standalone Bankers screen
 * filters and searches client-side, the same pattern `listLenders` and
 * `LenderCatalogue` already use: this catalogue is small enough that a round
 * trip per filter change would be pure overhead, and showing an inactive
 * banker here (unlike on the case-side picker) is the point — it is how an
 * office user finds and reactivates one.
 */
export async function listBankers(client: Queryable, actor: Actor): Promise<Banker[]> {
  requireRead(actor);
  const { rows } = await client.query(
    `${BANKER_SELECT} order by i.canonical_name, br.canonical_name nulls first, bc.contact_name nulls first`,
  );
  return rows.map(bankerFromRow);
}

async function loadBankerOr404(client: Queryable, id: string): Promise<Record<string, unknown>> {
  const { rows } = await client.query(`${BANKER_SELECT} where bc.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, "No such banker.");
  return rows[0];
}

async function loadBranchOr400(
  client: Queryable,
  branchOrganisationId: string,
): Promise<{ id: string; institutionId: string }> {
  const { rows } = await client.query<{ id: string; parent_organisation_id: string | null }>(
    `select id, parent_organisation_id from organisation
      where id = $1 and 'branch' = any(roles) and is_active`,
    [branchOrganisationId],
  );
  const branch = rows[0];
  if (!branch || !branch.parent_organisation_id) {
    throw new ApiError(400, "No such branch, or it is no longer active.");
  }
  return { id: branch.id, institutionId: branch.parent_organisation_id };
}

/**
 * A new primary displaces the branch's existing one. At most one ACTIVE
 * primary per branch is enforced by `bank_contact_one_primary_per_branch`
 * (a partial unique index), and the case-side picker reads this flag to
 * pre-select a recipient — a second "the" primary contact is a data-entry
 * mistake, not a preference, so this runs before the insert/update that would
 * otherwise collide with it. Both share the request's own transaction
 * (`withActor`, db.ts), so a failure after this leaves neither change.
 */
async function clearExistingPrimary(
  client: Queryable,
  branchOrganisationId: string,
  exceptId?: string,
): Promise<void> {
  await client.query(
    `update bank_contact set is_primary_contact = false
      where branch_organisation_id = $1 and is_primary_contact and is_active
        and id is distinct from $2`,
    [branchOrganisationId, exceptId ?? null],
  );
}

function validateContactFields(name: string | null, workEmail: string | null): void {
  if (!name && !workEmail) {
    throw new ApiError(400, "A name or an email is required.");
  }
  if (workEmail && !isEmailShaped(workEmail)) {
    throw new ApiError(400, `"${workEmail}" does not look like an email address.`);
  }
}

/**
 * Always branch-scoped. `bank_contact.branch_organisation_id` is nullable in
 * the schema for a regional or state-level manager who belongs to no single
 * desk (0019) — a real case, but not one this workflow needs: the case-side
 * picker is Bank → Branch → Banker, so a banker with no branch would never
 * surface there. Institution-only contacts stay possible for whoever edits
 * the database directly; this screen does not need to offer them yet.
 */
export async function createBanker(
  client: Queryable,
  actor: Actor,
  body: Record<string, unknown>,
): Promise<Banker> {
  requireWrite(actor);

  const branchOrganisationId = trimmedString(body.branchOrganisationId);
  if (!branchOrganisationId) throw new ApiError(400, "A branch is required.");
  const branch = await loadBranchOr400(client, branchOrganisationId);

  const name = trimmedString(body.name) || null;
  const workEmail = trimmedString(body.workEmail) || null;
  validateContactFields(name, workEmail);
  const designation = trimmedString(body.designation) || null;
  const workMobile = trimmedString(body.workMobile) || null;
  const isPrimary = body.isPrimary === true;

  if (isPrimary) await clearExistingPrimary(client, branch.id);

  const { rows } = await client.query<{ id: string }>(
    `insert into bank_contact
       (institution_organisation_id, branch_organisation_id, contact_name,
        designation, work_email, work_mobile, is_primary_contact, is_active, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, true, $8)
     returning id`,
    [branch.institutionId, branch.id, name, designation, workEmail, workMobile, isPrimary, actor.userId],
  );
  const id = rows[0]!.id;

  await recordBankContactEvent(client, {
    actorUserId: actor.userId,
    entityId: id,
    eventType: "bank_contact.created",
    payloadAfter: {
      institutionOrganisationId: branch.institutionId,
      branchOrganisationId: branch.id,
      isPrimary,
    },
  });

  return bankerFromRow(await loadBankerOr404(client, id));
}

/**
 * Amend a banker's own fields — name, designation, work contact details,
 * primary flag. Which bank and branch a banker belongs to is not editable
 * here: a manager moving banks is a new `bank_contact` row against the same
 * person (ADR-036 §1), not a field overwritten on the old one.
 */
export async function updateBanker(
  client: Queryable,
  actor: Actor,
  id: string,
  body: Record<string, unknown>,
): Promise<Banker> {
  requireWrite(actor);
  const before = await loadBankerOr404(client, id);

  const name = "name" in body ? trimmedString(body.name) || null : (before.contact_name as string | null);
  const workEmail =
    "workEmail" in body ? trimmedString(body.workEmail) || null : (before.work_email as string | null);
  validateContactFields(name, workEmail);
  const designation =
    "designation" in body ? trimmedString(body.designation) || null : (before.designation as string | null);
  const workMobile =
    "workMobile" in body ? trimmedString(body.workMobile) || null : (before.work_mobile as string | null);
  const isPrimary = "isPrimary" in body ? body.isPrimary === true : (before.is_primary_contact as boolean);

  const branchOrganisationId = before.branch_organisation_id as string | null;
  if (isPrimary && !before.is_primary_contact && branchOrganisationId) {
    await clearExistingPrimary(client, branchOrganisationId, id);
  }

  await client.query(
    `update bank_contact
        set contact_name = $1, designation = $2, work_email = $3, work_mobile = $4,
            is_primary_contact = $5, updated_by = $6
      where id = $7`,
    [name, designation, workEmail, workMobile, isPrimary, actor.userId, id],
  );

  await recordBankContactEvent(client, {
    actorUserId: actor.userId,
    entityId: id,
    eventType: "bank_contact.updated",
    payloadBefore: { isPrimary: before.is_primary_contact },
    payloadAfter: { isPrimary },
  });

  return bankerFromRow(await loadBankerOr404(client, id));
}

/**
 * Deactivate/reactivate. Bankers are never deleted — the same reasoning
 * `Backend/users.ts` gives for accounts applies here: a submission already
 * addressed to this contact must keep meaning what it meant
 * (`submission_recipient` snapshots the name and email at send time
 * regardless), and "moved on" is a fact worth keeping, not erasing.
 */
export async function setBankerActive(
  client: Queryable,
  actor: Actor,
  id: string,
  body: Record<string, unknown>,
): Promise<Banker> {
  requireWrite(actor);
  await loadBankerOr404(client, id);
  const isActive = body.isActive === true;

  await client.query(`update bank_contact set is_active = $1, updated_by = $2 where id = $3`, [
    isActive,
    actor.userId,
    id,
  ]);

  await recordBankContactEvent(client, {
    actorUserId: actor.userId,
    entityId: id,
    eventType: isActive ? "bank_contact.activated" : "bank_contact.deactivated",
    payloadAfter: { isActive },
  });

  return bankerFromRow(await loadBankerOr404(client, id));
}
