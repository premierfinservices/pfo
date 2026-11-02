/**
 * One-way sync of live MCM cases from the MIS into PFO (ADR-046).
 *
 * Re-runnable: every record is found by its MIS ID and only what differs is
 * written, so running it twice changes nothing the second time. The MIS wins on
 * every case it still manages. Dates are written as the MIS holds them, in Indian
 * time; the event log records when the sync itself happened and is not back-dated.
 *
 * Events and the report carry IDs and closed-list values only, never a customer's
 * name or number (ADR-018), so the report is safe to read and paste.
 */

import { EMPLOYMENT_TYPES, FIRMS, LEAD_SOURCES, normaliseMobile, productCodeFor } from "@domain/work/intake.js";
import {
  dateOnly,
  inSyncScope,
  istInstant,
  matchEmployee,
  misClosure,
  misDocumentStatus,
  misLenderStatus,
  misStage,
  misTaskKind,
  pfoLenderName,
  rejectedAt,
  type MisApplication,
  type MisCustomer,
  type MisData,
  type MisFollowup,
} from "@domain/work/mis-sync.js";

import { normaliseIdentifier } from "./customers.js";
import type { Queryable } from "./db.js";

const MCM = FIRMS.find((firm) => firm.code === "mcm")!.code;

export interface Tally {
  created: number;
  updated: number;
  unchanged: number;
}
const tally = (): Tally => ({ created: 0, updated: 0, unchanged: 0 });

export interface SyncReport {
  readonly cases: Tally;
  readonly applications: Tally;
  readonly tasks: Tally & { closed: number; skippedCancelled: number };
  /** Cases the MIS had handed over (go-live), which the sync no longer touches. */
  released: number;
  reusedPeople: number;
  readonly caseIds: string[];
  readonly employees: Record<string, string>;
  readonly issues: string[];
  /** The same customer on a case the MIS does not know. Told each run, never changed. */
  readonly sameCustomer: string[];
}

function same(current: unknown, wanted: unknown): boolean {
  if (current == null && wanted == null) return true;
  if (current == null || wanted == null) return false;
  if (current instanceof Date) return current.getTime() === new Date(String(wanted)).getTime();
  if (typeof wanted === "number") return Number(current) === wanted;
  return String(current) === String(wanted);
}

/** Write the columns that differ; return their names. */
async function applyDifferences(
  client: Queryable,
  table: "loan_case" | "submission" | "task",
  current: Record<string, unknown>,
  wanted: Record<string, unknown>,
): Promise<string[]> {
  const changed = Object.keys(wanted).filter((column) => !same(current[column], wanted[column]));
  if (changed.length === 0) return [];
  const sets = changed.map((column, i) => `${column} = $${i + 2}`);
  await client.query(`update ${table} set ${sets.join(", ")} where id = $1`, [
    current.id,
    ...changed.map((column) => wanted[column]),
  ]);
  return changed;
}

async function insertRow(client: Queryable, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row);
  const { rows } = await client.query<{ id: string }>(
    `insert into ${table} (${columns.join(", ")}) values (${columns.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    columns.map((column) => row[column]),
  );
  return rows[0]!.id;
}

async function recordSync(
  client: Queryable,
  entity: { type: "case" | "submission"; id: string; caseId: string },
  eventType: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `insert into event (actor_kind, entity_type, entity_id, case_id, event_type, payload_before, payload_after, source)
     values ('system', $1, $2, $3, $4, $5, $6, 'import')`,
    [entity.type, entity.id, entity.caseId, eventType, before && JSON.stringify(before), JSON.stringify(after)],
  );
}

interface Context {
  readonly client: Queryable;
  readonly data: MisData;
  readonly automation: string;
  readonly people: Map<string, string>;
  readonly report: SyncReport;
}

function wantedCase(customer: MisCustomer, ctx: Context): Record<string, unknown> | null {
  const { issues } = ctx.report;
  const skip = (why: string): null => {
    issues.push(`${customer.caseId}: skipped, ${why}.`);
    return null;
  };

  const liveStage = misStage(customer.caseStatus);
  if (!liveStage) return skip(`case status "${customer.caseStatus}" has no PFO stage`);
  const documentStatus = misDocumentStatus(customer.documentStatus);
  if (!documentStatus) return skip(`document status "${customer.documentStatus}" is not known`);
  const employment = EMPLOYMENT_TYPES.find((type) => type.label === customer.employmentType);
  if (!employment) return skip(`employment type "${customer.employmentType}" is not known`);
  const productCode = customer.loanType ? productCodeFor(customer.loanType, employment.code) : null;
  if (!productCode) return skip(`loan type "${customer.loanType}" is not known`);
  const owner = customer.assignedId ? ctx.people.get(customer.assignedId) : undefined;
  if (!owner) return skip(`telecaller ${customer.assignedId} has no PFO login`);
  if (!customer.createdAt || !customer.leadDate) return skip("it has no lead date or created timestamp");

  const active = customer.location === "Active";
  const closure = active ? null : misClosure(customer.closureReason);
  const endedAt = active ? null : (istInstant(customer.closureDate) ?? new Date().toISOString());
  const lost = closure?.stage === "lost" ? closure : null;

  return {
    firm: MCM,
    mis_case_id: customer.caseId,
    mis_managed: true,
    mis_case_notes: customer.notes,
    lead_received_on: dateOnly(customer.leadDate),
    original_owner_user_id: (customer.originalId && ctx.people.get(customer.originalId)) || owner,
    requested_amount: customer.amount && customer.amount > 0 ? customer.amount : null,
    stage: closure ? closure.stage : liveStage,
    document_status: documentStatus,
    owner_user_id: owner,
    loan_type: customer.loanType,
    loan_variant: customer.otherLoanDescription,
    place: customer.place,
    created_at: istInstant(customer.createdAt),
    lost_reason: lost ? lost.lostReason : null,
    lost_at: lost ? endedAt : null,
    stage_before_lost: lost ? liveStage : null,
    closed_at: closure?.stage === "closed" ? endedAt : null,
    // The MIS has no invoice flag; a case it closes as complete is finished, and
    // the schema only lets a closed case exist with this set.
    is_invoice_raised: closure?.stage === "closed",
  };
}

async function lookupCaseIds(ctx: Context, customer: MisCustomer): Promise<{ product: string; employment: string; source: string | null } | null> {
  const employment = EMPLOYMENT_TYPES.find((type) => type.label === customer.employmentType)!;
  const source = LEAD_SOURCES.find((item) => item.label === customer.leadSource);
  const { rows } = await ctx.client.query<{ product: string | null; employment: string | null; source: string | null }>(
    `select (select id from loan_product where code = $1) as product,
            (select id from employment_type where code = $2) as employment,
            (select id from referral_source where code = $3) as source`,
    [productCodeFor(customer.loanType!, employment.code), employment.code, source?.code ?? null],
  );
  const found = rows[0]!;
  if (!found.product || !found.employment) {
    ctx.report.issues.push(`${customer.caseId}: skipped, its loan product or employment type is missing from PFO.`);
    return null;
  }
  return { product: found.product, employment: found.employment, source: found.source };
}

/**
 * The customer's person. The same mobile and name reuses the record (Principle 5).
 * The same mobile under another name is a different customer, as Log a Case's
 * "different customer" tick has it, so the two are never merged (Principle 7).
 */
async function personFor(ctx: Context, customer: MisCustomer, mobile: string): Promise<string> {
  const normal = normaliseIdentifier("phone", mobile);
  const name = customer.name.toUpperCase();
  const known = await ctx.client.query<{ person_id: string; full_name: string }>(
    `select i.person_id, p.full_name from person_identifier i join person p on p.id = i.person_id
      where i.identifier_type = 'phone' and i.value_normalised = $1`,
    [normal],
  );
  const samePerson = known.rows.find((row) => row.full_name.toUpperCase() === name);
  if (samePerson) {
    ctx.report.reusedPeople += 1;
    return samePerson.person_id;
  }
  if (known.rows.length > 0) {
    ctx.report.issues.push(`${customer.caseId}: its mobile is already on a person with another name. Kept apart; check whether they are the same customer.`);
  }
  const id = await insertRow(ctx.client, "person", { full_name: name, created_by: ctx.automation });
  await insertRow(ctx.client, "person_identifier", {
    person_id: id,
    identifier_type: "phone",
    value_raw: mobile,
    value_normalised: normal,
    is_primary: true,
    created_by: ctx.automation,
  });
  return id;
}

/** Keeps the customer's details in step, as far as is safe to do automatically. */
async function checkPerson(ctx: Context, customer: MisCustomer, caseId: string, mobile: string): Promise<void> {
  const { rows } = await ctx.client.query<{ person_id: string; full_name: string; created_by: string | null }>(
    `select p.id as person_id, p.full_name, p.created_by
       from case_party cp join person p on p.id = cp.person_id
      where cp.case_id = $1 and cp.is_primary and cp.removed_at is null`,
    [caseId],
  );
  const person = rows[0];
  if (!person) return;
  const name = customer.name.toUpperCase();
  if (person.full_name !== name) {
    // A record this sync made follows the MIS. One PFO already held may be on other cases.
    if (person.created_by === ctx.automation) {
      await ctx.client.query(`update person set full_name = $1 where id = $2`, [name, person.person_id]);
    } else {
      ctx.report.issues.push(`${customer.caseId}: the MIS customer name differs from the PFO person's. Left as it is.`);
    }
  }
  const phone = await ctx.client.query(
    `select 1 from person_identifier where person_id = $1 and identifier_type = 'phone' and value_normalised = $2`,
    [person.person_id, normaliseIdentifier("phone", mobile)],
  );
  if (!phone.rows[0]) {
    ctx.report.issues.push(`${customer.caseId}: the MIS mobile differs from the PFO person's. Left as it is; correct it by hand.`);
  }
}

/** Returns the PFO case id, or null if the case was skipped or has been released. */
async function syncCase(ctx: Context, customer: MisCustomer): Promise<string | null> {
  const { client, report, automation } = ctx;
  const existing = await client.query<Record<string, unknown>>(
    `select *, lead_received_on::text as lead_received_on from loan_case where mis_case_id = $1`,
    [customer.caseId],
  );
  const current = existing.rows[0];
  if (current && current.mis_managed === false) {
    report.released += 1;
    return null;
  }

  const mobile = normaliseMobile(customer.mobile ?? "");
  if (!mobile) {
    report.issues.push(`${customer.caseId}: skipped, its mobile is not a valid 10-digit number.`);
    return null;
  }
  const wanted = wantedCase(customer, ctx);
  if (!wanted) return null;
  const ids = await lookupCaseIds(ctx, customer);
  if (!ids) return null;
  const row: Record<string, unknown> = { ...wanted, loan_product_id: ids.product, referral_source_id: ids.source };

  if (!current) {
    const person = await personFor(ctx, customer, mobile);
    const caseId = await insertRow(client, "loan_case", { ...row, case_number: customer.caseId, created_by: automation });
    await insertRow(client, "case_party", {
      case_id: caseId,
      person_id: person,
      role: "applicant",
      is_primary: true,
      created_by: automation,
      employment_type_id: ids.employment,
    });
    await recordSync(ctx.client, { type: "case", id: caseId, caseId }, "case.created_from_mis", null, {
      misCaseId: customer.caseId,
      firm: MCM,
      stage: row.stage,
      documentStatus: row.document_status,
      ownerUserId: row.owner_user_id,
    });
    report.cases.created += 1;
    return caseId;
  }

  const caseId = String(current.id);
  await checkPerson(ctx, customer, caseId, mobile);
  const changed = await applyDifferences(client, "loan_case", current, row);
  const party = await client.query(
    `update case_party set employment_type_id = $2
      where case_id = $1 and is_primary and removed_at is null and employment_type_id is distinct from $2 returning id`,
    [caseId, ids.employment],
  );
  if (party.rows[0]) changed.push("employment_type");
  if (changed.length === 0) {
    report.cases.unchanged += 1;
    return caseId;
  }
  await recordSync(
    client,
    { type: "case", id: caseId, caseId },
    "case.synced_from_mis",
    { stage: current.stage, documentStatus: current.document_status, ownerUserId: current.owner_user_id },
    { fields: changed, stage: row.stage, documentStatus: row.document_status, ownerUserId: row.owner_user_id },
  );
  report.cases.updated += 1;
  return caseId;
}

interface Lender {
  readonly id: string;
  readonly name: string;
  readonly branchId: string | null;
  readonly branchName: string | null;
  readonly address: string | null;
  readonly city: string | null;
}

async function loadLenders(client: Queryable): Promise<Map<string, Lender>> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    branch_id: string | null;
    branch_name: string | null;
    address_line: string | null;
    city_name: string | null;
  }>(
    `select o.id, o.canonical_name as name, b.id as branch_id, b.canonical_name as branch_name,
            bb.address_line, c.name as city_name
       from organisation o
       left join lateral (select * from organisation x where x.parent_organisation_id = o.id
                           and 'branch' = any (x.roles) and x.is_active order by x.created_at limit 1) b on true
       left join bank_branch bb on bb.organisation_id = b.id
       left join city c on c.id = bb.city_id
      where 'lender' = any (o.roles) and o.parent_organisation_id is null`,
  );
  return new Map(
    rows.map((row) => [
      row.name,
      {
        id: row.id,
        name: row.name,
        branchId: row.branch_id,
        branchName: row.branch_name,
        address: row.address_line,
        city: row.city_name,
      },
    ]),
  );
}

async function syncApplication(
  ctx: Context,
  application: MisApplication,
  caseId: string,
  lenders: Map<string, Lender>,
  notCategorised: string,
): Promise<string | null> {
  const { client, report, automation, data, people } = ctx;
  const id = application.applicationId;
  const skip = (why: string): null => {
    report.issues.push(`${id} (${application.caseId}): skipped, ${why}.`);
    return null;
  };

  const status = misLenderStatus(application.status);
  if (!status) return skip(`lender status "${application.status}" is not known`);
  const lender = application.lender ? lenders.get(pfoLenderName(application.lender)) : undefined;
  if (!lender) return skip(`lender "${application.lender}" is not in PFO's catalogue`);
  if (!lender.branchId) return skip(`${lender.name} has no branch on file`);
  if (!application.createdAt) return skip("it has no created timestamp");

  // The schema refuses these statuses without an offer (BR-023).
  const offerAmount = application.sanctionAmount ?? application.disbursementAmount;
  const needsOffer = status === "sanctioned" || status === "sanction_accepted" || status === "disbursed";
  if (needsOffer && !(offerAmount && offerAmount > 0)) {
    return skip(`it is ${application.status} with no sanction or disbursement amount`);
  }

  const loginEmployee = application.loginEmployeeId ? (people.get(application.loginEmployeeId) ?? null) : null;
  if (application.loginEmployeeId && !loginEmployee) {
    report.issues.push(`${id}: login employee ${application.loginEmployeeId} has no PFO login; left blank.`);
  }

  // The schema needs a dispatch time on anything past Not Logged In. The MIS holds
  // no send date, so it is the login date, else when the application was entered.
  const dispatched = status !== "not_submitted" && status !== "withdrawn";
  const rejected = status === "rejected";

  const wanted: Record<string, unknown> = {
    mis_application_id: id,
    case_id: caseId,
    status,
    status_note: application.notes,
    submitted_at: dispatched ? istInstant(application.loginDate ?? application.createdAt) : null,
    submitted_by: dispatched ? automation : null,
    rejection_reason_id: rejected ? notCategorised : null,
    bank_reason_text: rejected ? application.rejectionReason : null,
    rejected_at: rejected ? istInstant(rejectedAt(application, data.changes)) : null,
    precheck_reason:
      status === "not_eligible_precheck"
        ? (application.rejectionReason ?? application.notes ?? "Not recorded in the MIS")
        : null,
    bank_reference_number: application.reference,
    login_date: dateOnly(application.loginDate),
    login_employee_id: loginEmployee,
    banker_name: application.banker,
    approved_amount: application.amountApproved,
    sanction_date: dateOnly(application.sanctionDate),
    sanction_acceptance_date: dateOnly(application.acceptanceDate),
    disbursement_amount: application.disbursementAmount,
    disbursement_date: dateOnly(application.disbursementDate),
    created_at: istInstant(application.createdAt),
    branch_organisation_id: lender.branchId,
    institution_organisation_id: lender.id,
    bank_name_at_submission: lender.name,
  };

  const existing = await client.query<Record<string, unknown>>(
    `select *, login_date::text as login_date, sanction_date::text as sanction_date,
            sanction_acceptance_date::text as sanction_acceptance_date, disbursement_date::text as disbursement_date
       from submission where mis_application_id = $1`,
    [id],
  );
  const current = existing.rows[0];
  let submissionId: string;
  if (!current) {
    submissionId = await insertRow(client, "submission", {
      ...wanted,
      branch_name_at_submission: lender.branchName,
      branch_address_at_submission: lender.address,
      branch_city_at_submission: lender.city,
      snapshot_taken_at: new Date().toISOString(),
      created_by: automation,
    });
    await recordSync(ctx.client, { type: "submission", id: submissionId, caseId }, "submission.created_from_mis", null, {
      misApplicationId: id,
      status,
      lenderId: lender.id,
    });
    report.applications.created += 1;
  } else {
    submissionId = String(current.id);
    const changed = await applyDifferences(client, "submission", current, wanted);
    if (changed.length > 0) {
      await recordSync(
        client,
        { type: "submission", id: submissionId, caseId },
        "submission.synced_from_mis",
        { status: current.status },
        { fields: changed, status },
      );
      report.applications.updated += 1;
    } else {
      report.applications.unchanged += 1;
    }
  }

  if (offerAmount && offerAmount > 0) {
    const accepted = application.acceptanceStatus === "Accepted" || status === "sanction_accepted";
    const acceptedAt = accepted ? (istInstant(application.acceptanceDate) ?? istInstant(application.sanctionDate) ?? wanted.created_at) : null;
    const offer = await client.query<Record<string, unknown>>(
      `select * from offer where submission_id = $1 order by created_at desc limit 1`,
      [submissionId],
    );
    const fields = {
      sanctioned_amount: offerAmount,
      is_accepted: accepted,
      accepted_at: acceptedAt,
      accepted_by: accepted ? automation : null,
    };
    if (!offer.rows[0]) {
      await insertRow(client, "offer", { submission_id: submissionId, ...fields, created_by: automation });
    } else {
      const changed = Object.keys(fields).filter((key) => !same(offer.rows[0]![key], fields[key as keyof typeof fields]));
      if (changed.length > 0) {
        await client.query(
          `update offer set sanctioned_amount = $2, is_accepted = $3, accepted_at = $4, accepted_by = $5 where id = $1`,
          [offer.rows[0].id, fields.sanctioned_amount, fields.is_accepted, fields.accepted_at, fields.accepted_by],
        );
      }
    }
  }

  // Update Case reads an open query from its own table. The MIS keeps none, only the status.
  const openQuery = await client.query<{ id: string }>(
    `select id from submission_query where submission_id = $1 and answered_at is null limit 1`,
    [submissionId],
  );
  if (status === "query_raised" && !openQuery.rows[0]) {
    await client.query(`insert into submission_query (submission_id, question) values ($1, $2)`, [
      submissionId,
      application.notes ?? "Query recorded in the MIS. See the MIS for details.",
    ]);
  } else if (status !== "query_raised" && openQuery.rows[0]) {
    await client.query(
      `update submission_query set answered_at = now(), answer = $2, answered_by = $3 where id = $1`,
      [openQuery.rows[0].id, "Resolved in the MIS.", automation],
    );
  }
  return submissionId;
}

/** An application the MIS no longer has: withdrawn here, so nothing is destroyed. */
async function withdrawMissing(ctx: Context, caseId: string, seen: ReadonlySet<string>): Promise<void> {
  const { rows } = await ctx.client.query<{ id: string; status: string; mis_application_id: string }>(
    `select id, status::text, mis_application_id from submission
      where case_id = $1 and mis_application_id is not null and status <> 'withdrawn'`,
    [caseId],
  );
  for (const row of rows) {
    if (seen.has(row.mis_application_id)) continue;
    await ctx.client.query(
      `update submission set status = 'withdrawn', status_note = $2, rejection_reason_id = null,
              bank_reason_text = null, rejected_at = null, precheck_reason = null where id = $1`,
      [row.id, "No longer in the MIS."],
    );
    await recordSync(ctx.client, { type: "submission", id: row.id, caseId }, "submission.synced_from_mis",
      { status: row.status }, { fields: ["status"], status: "withdrawn" });
    ctx.report.applications.updated += 1;
    ctx.report.issues.push(`${row.mis_application_id}: no longer in the MIS, marked withdrawn in PFO.`);
  }
}

async function syncFollowup(
  ctx: Context,
  followup: MisFollowup,
  caseId: string,
  submissions: ReadonlyMap<string, string>,
): Promise<void> {
  const { client, report, automation, people } = ctx;
  const existing = await client.query<Record<string, unknown>>(`select * from task where mis_followup_id = $1`, [followup.followupId]);
  const current = existing.rows[0];

  // A cancelled follow-up has no completion date in the MIS, and inventing one would
  // falsify the history. It is left out, unless PFO already holds it open.
  if (followup.status !== "Open" && followup.status !== "Completed") {
    if (current && current.completed_at === null) {
      await client.query(`update task set completed_at = now(), completed_by = $2 where id = $1`, [current.id, automation]);
      report.tasks.closed += 1;
    } else if (!current) {
      report.tasks.skippedCancelled += 1;
    }
    return;
  }

  const assignee = followup.responsibleId ? people.get(followup.responsibleId) : undefined;
  if (!assignee) {
    report.issues.push(`${followup.followupId}: skipped, ${followup.responsibleId} has no PFO login.`);
    return;
  }
  const completed = followup.status === "Completed";
  const wanted = {
    mis_followup_id: followup.followupId,
    case_id: caseId,
    assigned_to: assignee,
    title: followup.nextAction ?? followup.activityType ?? "Follow-up",
    detail: followup.notes,
    kind: misTaskKind(followup.nextAction),
    submission_id: followup.applicationId ? (submissions.get(followup.applicationId) ?? null) : null,
    due_at: istInstant(dateOnly(followup.dueDate)),
    completed_at: completed ? istInstant(followup.completionDate ?? followup.activityAt) : null,
    completed_by: completed ? assignee : null,
    created_at: istInstant(followup.activityAt) ?? new Date().toISOString(),
  };
  if (!current) {
    await insertRow(client, "task", { ...wanted, created_by: automation });
    report.tasks.created += 1;
    return;
  }
  const changed = await applyDifferences(client, "task", current, wanted);
  if (changed.length > 0) report.tasks.updated += 1;
  else report.tasks.unchanged += 1;
}

async function closeMissingTasks(ctx: Context, caseId: string, seen: ReadonlySet<string>): Promise<void> {
  const { rows } = await ctx.client.query<{ id: string; mis_followup_id: string }>(
    `select id, mis_followup_id from task where case_id = $1 and mis_followup_id is not null and completed_at is null`,
    [caseId],
  );
  for (const row of rows) {
    if (seen.has(row.mis_followup_id)) continue;
    await ctx.client.query(`update task set completed_at = now(), completed_by = $2 where id = $1`, [row.id, ctx.automation]);
    ctx.report.tasks.closed += 1;
  }
}

/** Runs inside the caller's transaction; a dry run rolls it back. */
export async function syncFromMis(client: Queryable, data: MisData): Promise<SyncReport> {
  const report: SyncReport = {
    cases: tally(),
    applications: tally(),
    tasks: { ...tally(), closed: 0, skippedCancelled: 0 },
    released: 0,
    reusedPeople: 0,
    caseIds: [],
    employees: {},
    issues: [],
    sameCustomer: [],
  };

  const automationRow = await client.query<{ id: string }>(`select id from app_user where username = 'pfo.automation'`);
  const automation = automationRow.rows[0]?.id;
  if (!automation) throw new Error("The pfo.automation user is missing.");

  const { rows: users } = await client.query<{ id: string; username: string; full_name: string | null }>(
    `select u.id, u.username, p.full_name from app_user u left join person p on p.id = u.person_id
      where u.is_active and u.username <> 'pfo.automation'`,
  );
  const people = new Map<string, string>();
  for (const employee of data.employees) {
    const id = matchEmployee(employee.name, users.map((u) => ({ id: u.id, username: u.username, fullName: u.full_name })));
    if (id) {
      people.set(employee.id, id);
      report.employees[employee.id] = users.find((u) => u.id === id)!.username;
    }
  }

  const ctx: Context = { client, data, automation, people, report };
  const lenders = await loadLenders(client);
  const reason = await client.query<{ id: string }>(`select id from rejection_reason where code = 'not_categorised_mis'`);
  const notCategorised = reason.rows[0]?.id;
  if (!notCategorised) throw new Error("Migration 0052 has not been applied.");

  const { rows: known } = await client.query<{ mis_case_id: string }>(
    `select mis_case_id from loan_case where mis_case_id is not null`,
  );
  const alreadyHere = new Set(known.map((row) => row.mis_case_id));

  const inMis = new Set(data.customers.map((customer) => customer.caseId));
  for (const id of alreadyHere) {
    if (!inMis.has(id)) report.issues.push(`${id}: no longer in the MIS. Left as it is in PFO; check it by hand.`);
  }

  for (const customer of data.customers) {
    // Once copied, a case stays in step even after it leaves the live list, so an
    // archive in the MIS closes it here too.
    if (!inSyncScope(customer) && !alreadyHere.has(customer.caseId)) continue;
    const caseId = await syncCase(ctx, customer);
    if (!caseId) continue;
    report.caseIds.push(customer.caseId);

    const submissions = new Map<string, string>();
    const seenApplications = new Set<string>();
    for (const application of data.applications.filter((a) => a.caseId === customer.caseId)) {
      seenApplications.add(application.applicationId);
      const id = await syncApplication(ctx, application, caseId, lenders, notCategorised);
      if (id) submissions.set(application.applicationId, id);
    }
    await withdrawMissing(ctx, caseId, seenApplications);

    const seenFollowups = new Set<string>();
    for (const followup of data.followups.filter((f) => f.caseId === customer.caseId)) {
      seenFollowups.add(followup.followupId);
      await syncFollowup(ctx, followup, caseId, submissions);
    }
    await closeMissingTasks(ctx, caseId, seenFollowups);
  }

  const { rows: alsoHere } = await client.query<{ mis_case_id: string; other: string }>(
    `select a.mis_case_id, b.case_number as other
       from loan_case a
       join case_party pa on pa.case_id = a.id and pa.is_primary and pa.removed_at is null
       join case_party pb on pb.person_id = pa.person_id and pb.is_primary and pb.removed_at is null
       join loan_case b on b.id = pb.case_id and b.mis_case_id is null and not b.is_practice
      where a.mis_case_id is not null
      order by a.mis_case_id, b.case_number`,
  );
  for (const row of alsoHere) report.sameCustomer.push(`${row.mis_case_id} and ${row.other}`);
  return report;
}

/** Go-live: PFO becomes the place these cases are worked. The sync then leaves them alone. */
export async function releaseFromMis(client: Queryable): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `update loan_case set mis_managed = false where mis_managed returning id`,
  );
  for (const row of rows) {
    await recordSync(client, { type: "case", id: row.id, caseId: row.id }, "case.released_from_mis", { misManaged: true }, { misManaged: false });
  }
  return rows.length;
}
