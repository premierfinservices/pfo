/**
 * Log a Case, Update Case and the work engine, server-side (ADR-040).
 *
 * Source of truth: PRD/Intake and Work Engine.md. What each action leaves to do
 * is decided by `@domain/work/rules.js`; this file is the Postgres wiring.
 *
 * Every write here carries its next step back to the screen as `next`, so the
 * guidance line and the work queue read the same tasks and cannot disagree.
 */

import { createHash } from "node:crypto";

import { LOST_REASONS, type LostReason } from "@domain/case/stages.js";
import { evaluateTransition } from "@domain/case/transitions.js";
import {
  EMPLOYMENT_TYPES,
  FIRMS,
  LEAD_SOURCES,
  LOAN_TYPES,
  LOAN_VARIANTS,
  OTHER_LOAN_TYPE,
  amountInWords,
  capitals,
  normaliseMobile,
  parseAmount,
  productCodeFor,
} from "@domain/work/intake.js";
import { nextStepLine, workFor, type WorkEvent } from "@domain/work/rules.js";
import { belongsToApplicant, classifyCaseFile, monthlyReturnName, partyForFile, type FileMatch } from "@domain/work/file-names.js";
import { standardFileName } from "@domain/work/standard-names.js";
import { uploadRefusal } from "@domain/storage/upload-safety.js";
import { deriveStatusLine } from "@domain/work/status-line.js";
import { summaryBelongsTo, summaryBusinessNames } from "@domain/work/financial-summary.js";
import { documentRowLabel, financialYearOf, type PeriodKind } from "@domain/requirements/index.js";
import {
  NEXT_SUBMISSION_STATUSES,
  SUBMISSION_STATUS_LABELS,
  canTransitionSubmission,
  type SubmissionStatus,
} from "@domain/submissions/status.js";

import { can, canActOnCase, type Actor } from "./authorize.js";
import { archiveKind, unpackZip } from "./archive.js";
import { advanceCaseStage, justifiedStageOf, lockCaseForOutcomeMutation } from "./case-stage.js";
import { createCase, markLost } from "./cases.js";
import { normaliseIdentifier } from "./customers.js";
import { uploadDocument } from "./documents.js";
import type { Queryable } from "./db.js";
import { recordCaseEvent, recordCasePartyEvent, recordSubmissionEvent, type SubmissionEventType } from "./events.js";
import { readByContent } from "./file-reading.js";
import { ApiError, refusalMessage } from "./http.js";
import { regenerateRequirements } from "./requirements.js";

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** The same shape `submission_recipient_email_shaped` enforces (0024). */
const EMAIL_SHAPE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/** Marks a row a person removed, so Restore never revives one a rule retired. */
const NOT_NEEDED_REASON = "Not needed on this case";

interface CaseRow {
  id: string;
  case_number: string;
  stage: string;
  owner_user_id: string;
  is_on_hold: boolean;
  is_invoice_raised: boolean;
  stage_before_lost: string | null;
  financial_summary: string | null;
  document_status: string;
  eligibility_status: string;
  lost_reason: string | null;
  requested_amount: string | null;
  loan_type: string | null;
  loan_variant: string | null;
  place: string | null;
  firm: string;
  mis_managed: boolean;
  mis_case_notes: string | null;
  is_practice: boolean;
  applicant_name: string | null;
  applicant_person_id: string | null;
  has_co_applicant: boolean | null;
  owner_name: string | null;
  opened_on: string;
}

const CASE_SELECT = `
  select c.id, c.case_number, c.stage::text, c.owner_user_id, c.is_on_hold, c.is_invoice_raised,
         c.stage_before_lost::text, c.financial_summary, c.document_status, c.eligibility_status, c.lost_reason::text,
         c.requested_amount::text, c.loan_type, c.loan_variant, c.place, c.firm, c.mis_managed, c.mis_case_notes, c.is_practice,
         c.has_co_applicant,
         p.full_name as applicant_name, p.id as applicant_person_id, op.full_name as owner_name,
         coalesce(c.lead_received_on, (c.created_at at time zone 'Asia/Kolkata')::date)::text as opened_on
    from loan_case c
    left join case_party cp on cp.case_id = c.id and cp.is_primary and cp.removed_at is null
    left join person p on p.id = cp.person_id
    left join app_user ou on ou.id = c.owner_user_id
    left join person op on op.id = ou.person_id`;

async function loadCase(client: Queryable, caseId: string): Promise<CaseRow> {
  const { rows } = await client.query<CaseRow>(`${CASE_SELECT} where c.id = $1`, [caseId]);
  if (!rows[0]) throw new ApiError(404, "No such case, or you do not have access to it.");
  return rows[0];
}

/** 404 when the actor may not see the case, 403 when they may see but not act. */
function requireCase(actor: Actor, row: CaseRow, permission: string): void {
  if (!canActOnCase(actor, row.owner_user_id, "case.read")) {
    throw new ApiError(404, "No such case, or you do not have access to it.");
  }
  if (!canActOnCase(actor, row.owner_user_id, permission)) {
    throw new ApiError(403, refusalMessage(permission));
  }
}

/** Run one event's plan: close what it finishes, raise what it leaves. */
export async function applyWork(
  client: Queryable,
  actor: Actor,
  caseId: string,
  event: WorkEvent,
  loginEmployeeId?: string | null,
): Promise<void> {
  const plan = workFor(event);

  const clauses: string[] = [];
  const params: unknown[] = [caseId, actor.userId];
  if (plan.closeScope === "all") clauses.push("true");
  if (plan.closeScope === "case") clauses.push("submission_id is null");
  if (plan.closeKinds || plan.closeSubmissionId) {
    const narrow: string[] = [];
    if (plan.closeKinds) {
      params.push(plan.closeKinds);
      narrow.push(`kind = any($${params.length})`);
    }
    if (plan.closeSubmissionId) {
      params.push(plan.closeSubmissionId);
      narrow.push(`submission_id = $${params.length}`);
    }
    clauses.push(`(${narrow.join(" and ")})`);
  }
  if (clauses.length > 0) {
    await client.query(
      `update task set completed_at = now(), completed_by = $2
        where case_id = $1 and completed_at is null and (${clauses.join(" or ")})`,
      params,
    );
  }

  const task = plan.create;
  if (!task) return;
  const owner = await client.query<{ owner_user_id: string }>(
    `select owner_user_id from loan_case where id = $1`,
    [caseId],
  );
  const assignee =
    task.assignee === "owner"
      ? owner.rows[0]!.owner_user_id
      : task.assignee === "login_employee"
        ? (loginEmployeeId ?? actor.userId)
        : actor.userId;

  await client.query(
    `insert into task (case_id, assigned_to, title, due_at, kind, submission_id, created_by)
     values ($1, $2, $3,
             case when $4::text ~ '^\\d+$' then current_date + ($4::text)::int else ($4::text)::date end,
             $5, $6, $7)`,
    [caseId, assignee, task.title, String(task.due), task.kind, task.submissionId ?? null, actor.userId],
  );
}

interface TaskRow {
  id: string;
  case_id: string;
  title: string;
  kind: string | null;
  due_on: string | null;
  assigned_to: string;
  assignee_name: string | null;
  submission_id: string | null;
}

async function openTasksOf(client: Queryable, caseId: string): Promise<TaskRow[]> {
  const { rows } = await client.query<TaskRow>(
    `select t.id, t.case_id, t.title, t.kind, (t.due_at at time zone 'Asia/Kolkata')::date::text as due_on,
            t.assigned_to, p.full_name as assignee_name, t.submission_id
       from task t
       left join app_user u on u.id = t.assigned_to
       left join person p on p.id = u.person_id
      where t.case_id = $1 and t.completed_at is null
      order by t.due_at nulls last, t.created_at`,
    [caseId],
  );
  return rows;
}

/** The one guidance line, from the same tasks the work queue reads. */
async function nextLineFor(client: Queryable, row: CaseRow): Promise<string> {
  const tasks = await openTasksOf(client, row.id);
  let waitingOnBank: string | null = null;
  if (tasks.length === 0) {
    const live = await client.query<{ name: string | null }>(
      `select coalesce(s.bank_name_at_submission, o.canonical_name) as name
         from submission s
         left join organisation o on o.id = s.institution_organisation_id
        where s.case_id = $1 and s.status in ('login_completed', 'under_process', 'query_raised')
        order by s.updated_at desc limit 1`,
      [row.id],
    );
    waitingOnBank = live.rows[0]?.name ?? null;
  }
  return nextStepLine({
    stage: row.stage,
    lostReason: row.lost_reason,
    waitingOnBank,
    openTasks: tasks.map((task) => ({
      title: task.title,
      dueOn: task.due_on,
      assigneeName: task.assignee_name ?? "Unassigned",
    })),
  });
}

async function moveStageByUser(
  client: Queryable,
  actor: Actor,
  row: CaseRow,
  to: "documents_pending" | "eligibility_check" | "documents_collected",
): Promise<void> {
  if (row.stage === to) return;
  // Past Documents Collected a lender update owns the stage: a late document
  // does not pull a logged-in file back.
  if (!["documents_pending", "eligibility_check", "documents_collected"].includes(row.stage)) return;
  const verdict = evaluateTransition(
    {
      stage: row.stage as never,
      justifiedStage: await justifiedStageOf(client, row.id),
      isInvoiceRaised: row.is_invoice_raised,
      stageBeforeLost: row.stage_before_lost as never,
    },
    { to, actor: "user" },
  );
  if (!verdict.allowed) throw new ApiError(409, verdict.reason);
  await client.query(`update loan_case set stage = $1 where id = $2`, [to, row.id]);
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId: row.id,
    eventType: "case.stage_changed",
    payloadBefore: { stage: row.stage },
    payloadAfter: { stage: to },
  });
}

function requireOpen(row: CaseRow): void {
  if (row.stage === "lost" || row.stage === "closed") {
    throw new ApiError(409, "This case is closed. Reopen it first.");
  }
  if (row.is_on_hold) throw new ApiError(409, "This case is on hold. Release the hold first.");
}

/** Today, Tomorrow, or a yyyy-mm-dd. Refuses the past, as the MIS does. */
function requireFutureDate(value: unknown, what: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new ApiError(400, `Pick ${what}.`);
  }
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  if (text < today) throw new ApiError(400, `${what[0]!.toUpperCase()}${what.slice(1)} is in the past.`);
  return text;
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export async function workLists(client: Queryable) {
  const { rows: places } = await client.query<{ name: string }>(
    `select name from (
       select upper(name) as name from city where is_active
       union
       select place as name from loan_case where place is not null
     ) p order by name`,
  );
  const { rows: people } = await client.query<{ id: string; name: string; roles: string[] }>(
    `select u.id, p.full_name as name,
            coalesce(array_agg(r.role::text) filter (where r.revoked_at is null), '{}'::text[]) as roles
       from app_user u
       join person p on p.id = u.person_id
       left join user_role r on r.user_id = u.id
      where u.is_active and u.username <> 'pfo.automation'
      group by u.id, p.full_name
      order by p.full_name`,
  );
  const { rows: reasons } = await client.query<{ id: string; label: string }>(
    `select id, name as label from rejection_reason where is_active order by display_order, name`,
  );
  return {
    loanTypes: LOAN_TYPES.map((type) => type.label),
    otherLoanType: OTHER_LOAN_TYPE,
    variants: LOAN_VARIANTS,
    leadSources: LEAD_SOURCES,
    firms: FIRMS,
    employmentTypes: EMPLOYMENT_TYPES,
    places: places.map((row) => row.name),
    people,
    rejectionReasons: reasons,
    statusLabels: SUBMISSION_STATUS_LABELS,
    nextStatuses: NEXT_SUBMISSION_STATUSES,
  };
}

/** Cases already on this mobile. Only cases the caller may read are named
 * (case number, name, stage); the rest are counted in `hidden`, so a
 * telecaller learns the number is taken without seeing another owner's case. */
export async function mobileMatches(client: Queryable, actor: Actor, mobile: string) {
  if (!can(actor, "case.create", "all")) throw new ApiError(403, refusalMessage("case.create"));
  const normal = normaliseMobile(mobile);
  if (!normal) return { valid: false, matches: [], hidden: 0 };
  const { rows } = await client.query<{
    id: string;
    case_number: string;
    full_name: string;
    stage: string;
    owner_user_id: string;
  }>(
    `select c.id, c.case_number, p.full_name, c.stage::text, c.owner_user_id
       from person_identifier i
       join person p on p.id = i.person_id
       join case_party cp on cp.person_id = p.id and cp.removed_at is null
       join loan_case c on c.id = cp.case_id
      where i.identifier_type = 'phone' and i.value_normalised = $1
      order by c.created_at desc`,
    [normaliseIdentifier("phone", normal)],
  );
  const visible = rows.filter((row) => canActOnCase(actor, row.owner_user_id, "case.read"));
  return {
    valid: true,
    matches: visible.map((row) => ({
      id: row.id,
      caseNumber: row.case_number,
      customerName: row.full_name,
      stage: row.stage,
    })),
    hidden: rows.length - visible.length,
  };
}

/** "PF-1, PF-2 and 1 other case" for the cases a caller may name. */
function describeMatches(existing: { matches: { caseNumber: string }[]; hidden: number }): string {
  const named = existing.matches.map((match) => match.caseNumber).join(", ");
  if (existing.hidden === 0) return named;
  const other = `${existing.hidden} other case${existing.hidden === 1 ? "" : "s"}`;
  return named === "" ? other : `${named} and ${other}`;
}

// ---------------------------------------------------------------------------
// Log a Case
// ---------------------------------------------------------------------------

export async function logCase(client: Queryable, actor: Actor, body: Record<string, unknown>) {
  if (!can(actor, "case.create", "all")) throw new ApiError(403, refusalMessage("case.create"));

  const name = capitals(String(body.customerName ?? ""));
  if (name === "") throw new ApiError(400, "Type the customer's name.");

  const mobile = normaliseMobile(String(body.mobile ?? ""));
  if (!mobile) throw new ApiError(400, "Type a 10-digit mobile number (starting 6, 7, 8 or 9).");

  const place = capitals(String(body.place ?? ""));
  if (place === "") throw new ApiError(400, "Type or pick the place.");

  const amount = parseAmount(String(body.amount ?? ""));
  if (amount === null) throw new ApiError(400, "Type the loan amount (for example 2500000, 25L or 1.5cr).");

  const loanType = String(body.loanType ?? "");
  const variant = String(body.variant ?? "").trim();
  if (loanType === OTHER_LOAN_TYPE && variant === "") {
    throw new ApiError(400, "For 'Other Loan Types', type what the loan is in Variant.");
  }

  const employment = EMPLOYMENT_TYPES.find((type) => type.code === body.employmentType);
  if (!employment) throw new ApiError(400, "Pick the employment / business type.");

  const productCode = productCodeFor(loanType, employment.code);
  if (!productCode) throw new ApiError(400, "Pick the loan type.");

  const source = LEAD_SOURCES.find((item) => item.code === body.leadSource);
  if (!source) throw new ApiError(400, "Pick the lead source.");

  const firm = FIRMS.find((item) => item.code === body.firm);
  if (!firm) throw new ApiError(400, "Pick the firm: Mint Capital Management or Premier Finservices.");

  const pickup = requireFutureDate(body.pickupDate, "when the documents will be collected");

  // ADR-049: asked on every new case. Yes needs a name; the mobile is optional.
  if (body.coApplicant !== "yes" && body.coApplicant !== "no") {
    throw new ApiError(400, "Answer: is there a co-applicant?");
  }
  const coApplicant = body.coApplicant === "yes" ? coApplicantFrom(body, mobile) : null;

  const ownerUserId = typeof body.telecallerId === "string" && body.telecallerId ? body.telecallerId : actor.userId;
  const owner = await client.query(`select 1 from app_user where id = $1 and is_active`, [ownerUserId]);
  if (!owner.rows[0]) throw new ApiError(400, "Pick the telecaller.");

  // Same mobile: the screen has already shown the match. Going ahead needs the
  // explicit "different customer" tick, and the override is recorded.
  const existing = await mobileMatches(client, actor, mobile);
  const overridden = body.differentCustomer === true;
  const taken = existing.matches.length + existing.hidden > 0;
  if (taken && !overridden) {
    throw new ApiError(
      409,
      `This mobile is already on ${describeMatches(existing)}. ` +
        `Open that case, or tick "This is a different customer".`,
    );
  }

  const person = await resolvePerson(client, actor, name, mobile, overridden);

  const lookups = await client.query<{ product_id: string; employment_id: string; source_id: string }>(
    `select (select id from loan_product where code = $1) as product_id,
            (select id from employment_type where code = $2) as employment_id,
            (select id from referral_source where code = $3) as source_id`,
    [productCode, employment.code, source.code],
  );
  const ids = lookups.rows[0]!;
  if (!ids.product_id) throw new ApiError(500, `Loan product ${productCode} is missing.`);

  const created = (await createCase(client, actor, {
    applicantId: person,
    loanProductId: ids.product_id,
    requestedAmount: amount,
    referralSourceId: ids.source_id,
    employmentTypeId: ids.employment_id,
    isPractice: body.isPractice === true,
  })) as { id: string };

  const note = taken ? `Shares mobile with ${describeMatches(existing)}, recorded as a different customer.` : null;
  await client.query(
    `update loan_case
        set loan_type = $1, loan_variant = $2, place = $3, owner_user_id = $4, duplicate_override_note = $5,
            firm = $6, original_owner_user_id = $4,
            lead_received_on = (created_at at time zone 'Asia/Kolkata')::date,
            has_co_applicant = $8
      where id = $7`,
    [loanType, variant || null, place, ownerUserId, note, firm.code, created.id, coApplicant !== null],
  );
  if (coApplicant) await insertCoApplicant(client, actor, created.id, coApplicant);
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId: created.id,
    eventType: "case.logged",
    payloadAfter: { loanType, ownerUserId, firm: firm.code, duplicateOverride: note !== null },
  });

  await applyWork(client, actor, created.id, { type: "case_logged", due: pickup });
  return await caseSummary(client, actor, created.id, `${name} logged.`);
}

interface CoApplicantInput {
  readonly name: string;
  readonly mobile: string | null;
}

/** The co-applicant's name and optional mobile from a request body. */
function coApplicantFrom(body: Record<string, unknown>, applicantMobile: string | null): CoApplicantInput {
  const name = capitals(String(body.coApplicantName ?? ""));
  if (name === "") throw new ApiError(400, "Type the co-applicant's name.");
  const typed = String(body.coApplicantMobile ?? "").trim();
  const mobile = typed === "" ? null : normaliseMobile(typed);
  if (typed !== "" && !mobile) {
    throw new ApiError(400, "Type the co-applicant's 10-digit mobile number, or leave it blank.");
  }
  if (mobile && mobile === applicantMobile) {
    throw new ApiError(400, "The co-applicant's mobile is the customer's own. Leave it blank if they share one.");
  }
  return { name, mobile };
}

/** One co-applicant party on the case, reusing the person when the mobile is already on file. */
async function insertCoApplicant(client: Queryable, actor: Actor, caseId: string, input: CoApplicantInput): Promise<void> {
  const personId = input.mobile
    ? await resolvePerson(client, actor, input.name, input.mobile, false)
    : (
        await client.query<{ id: string }>(`insert into person (full_name, created_by) values ($1, $2) returning id`, [
          input.name,
          actor.userId,
        ])
      ).rows[0]!.id;
  const inserted = await client.query<{ id: string }>(
    `insert into case_party (case_id, person_id, role, is_primary, created_by)
     select $1, $2, 'co_applicant', false, $3
      where not exists (select 1 from case_party where case_id = $1 and person_id = $2 and removed_at is null)
     returning id`,
    [caseId, personId, actor.userId],
  );
  if (!inserted.rows[0]) throw new ApiError(409, "That person is already on this case.");
  await recordCasePartyEvent(client, {
    actorUserId: actor.userId,
    caseId,
    casePartyId: inserted.rows[0].id,
    eventType: "case.party_added",
    payloadAfter: { role: "co_applicant", personId },
  });
}

/** Update Case: add a co-applicant after the case was logged (ADR-049). */
export async function addCoApplicant(client: Queryable, actor: Actor, caseId: string, body: Record<string, unknown>) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.update");
  requireOpen(row);
  const applicantMobile = await client.query<{ value_normalised: string }>(
    `select i.value_normalised from case_party cp
       join person_identifier i on i.person_id = cp.person_id and i.identifier_type = 'phone'
      where cp.case_id = $1 and cp.is_primary and cp.removed_at is null limit 1`,
    [caseId],
  );
  const own = applicantMobile.rows[0] ? normaliseMobile(applicantMobile.rows[0].value_normalised) : null;
  await insertCoApplicant(client, actor, caseId, coApplicantFrom(body, own));
  await client.query(`update loan_case set has_co_applicant = true where id = $1`, [caseId]);
  return await caseSummary(client, actor, caseId, "Co-applicant added.");
}

/** Managers take a co-applicant off (`case.assign`). The party is marked removed, never deleted. */
export async function removeCoApplicant(client: Queryable, actor: Actor, caseId: string, partyId: string) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.assign");
  const removed = await client.query(
    `update case_party set removed_at = now(), removed_by = $3
      where id = $1 and case_id = $2 and role = 'co_applicant' and removed_at is null returning id`,
    [partyId, caseId, actor.userId],
  );
  if (!removed.rows[0]) throw new ApiError(404, "No such co-applicant on this case.");
  await recordCasePartyEvent(client, {
    actorUserId: actor.userId,
    caseId,
    casePartyId: partyId,
    eventType: "case.party_removed",
    payloadAfter: { role: "co_applicant" },
  });
  const left = await client.query(
    `select 1 from case_party where case_id = $1 and role = 'co_applicant' and removed_at is null`,
    [caseId],
  );
  if (!left.rows[0]) await client.query(`update loan_case set has_co_applicant = false where id = $1`, [caseId]);
  return await caseSummary(client, actor, caseId, "Co-applicant removed.");
}

async function resolvePerson(
  client: Queryable,
  actor: Actor,
  name: string,
  mobile: string,
  forceNew: boolean,
): Promise<string> {
  const normal = normaliseIdentifier("phone", mobile);
  if (!forceNew) {
    // Nothing already matched a case, but the person may be on file without one.
    const known = await client.query<{ person_id: string }>(
      `select person_id from person_identifier
        where identifier_type = 'phone' and value_normalised = $1 limit 1`,
      [normal],
    );
    if (known.rows[0]) return known.rows[0].person_id;
  }
  const inserted = await client.query<{ id: string }>(
    `insert into person (full_name, created_by) values ($1, $2) returning id`,
    [name, actor.userId],
  );
  const id = inserted.rows[0]!.id;
  // A shared family number stays primary on neither-or-both as the schema allows.
  await client.query(
    `insert into person_identifier
       (person_id, identifier_type, value_raw, value_normalised, is_primary, created_by)
     values ($1, 'phone', $2, $3, true, $4)`,
    [id, mobile, normal, actor.userId],
  );
  return id;
}

// ---------------------------------------------------------------------------
// Update Case: reading
// ---------------------------------------------------------------------------

/** Own cases by default, managers see everyone's; due and overdue first. */
/** `?firm=mcm` or `?firm=premier` narrows a list; absent or `all` means both. */
export function firmFilter(params: URLSearchParams): string | null {
  const wanted = params.get("firm");
  if (wanted === null || wanted === "" || wanted === "all") return null;
  if (!FIRMS.some((item) => item.code === wanted)) throw new ApiError(400, "Unknown firm.");
  return wanted;
}

/** `ended` adds lost and closed cases, as the MIS's Edit a Case does with its tick box. */
export async function pickList(
  client: Queryable,
  actor: Actor,
  q: string | null,
  firm: string | null = null,
  ended = false,
) {
  const everyone = can(actor, "case.read", "all");
  if (!everyone && !can(actor, "case.read", "own")) {
    throw new ApiError(403, refusalMessage("case.read"));
  }
  const term = q?.trim() ? `%${q.trim()}%` : null;
  const digits = q?.replace(/\D/g, "") ?? "";
  const { rows } = await client.query<{
    id: string;
    case_number: string;
    stage: string;
    firm: string;
    applicant_name: string | null;
    owner_name: string | null;
    next_title: string | null;
    next_due: string | null;
  }>(
    `select c.id, c.case_number, c.stage::text, c.firm, p.full_name as applicant_name, op.full_name as owner_name,
            n.title as next_title, (n.due_at at time zone 'Asia/Kolkata')::date::text as next_due
       from loan_case c
       left join case_party cp on cp.case_id = c.id and cp.is_primary and cp.removed_at is null
       left join person p on p.id = cp.person_id
       left join app_user ou on ou.id = c.owner_user_id
       left join person op on op.id = ou.person_id
       left join lateral (
         select title, due_at from task t
          where t.case_id = c.id and t.completed_at is null
          order by t.due_at nulls last limit 1
       ) n on true
      where ($6 or c.stage not in ('lost', 'closed'))
        and ($1 or c.owner_user_id = $2)
        and ($5::text is null or c.firm = $5)
        and ($3::text is null
             or p.full_name ilike $3
             or c.case_number ilike $3
             or ($4 <> '' and exists (
                   select 1 from person_identifier i
                    where i.person_id = p.id and i.identifier_type = 'phone'
                      and i.value_normalised like '%' || $4 || '%')))
      order by n.due_at nulls last, c.created_at desc
      limit 100`,
    [everyone, actor.userId, term, digits, firm, ended],
  );
  return rows.map((row) => ({
    id: row.id,
    caseNumber: row.case_number,
    stage: row.stage,
    firm: row.firm,
    customerName: row.applicant_name,
    ownerName: row.owner_name,
    nextTitle: row.next_title,
    nextDue: row.next_due,
  }));
}

/** Every name the case holds: its people and its firms. What a summary's business is compared with. */
async function caseNames(client: Queryable, caseId: string): Promise<string[]> {
  const { rows } = await client.query<{ name: string | null }>(
    `select coalesce(p.full_name, o.canonical_name) as name
       from case_party cp
       left join person p on p.id = cp.person_id
       left join organisation o on o.id = cp.organisation_id
      where cp.case_id = $1 and cp.removed_at is null`,
    [caseId],
  );
  return rows.map((r) => r.name).filter((n): n is string => !!n);
}

/** "This summary is for X", or null when it is the case's own or cannot be told. */
async function summaryWarning(client: Queryable, caseId: string, text: string | null): Promise<string | null> {
  if (!text) return null;
  // A file can hold one summary per filer. It is the case's own if any of them is.
  const businesses = summaryBusinessNames(text);
  const names = await caseNames(client, caseId);
  const verdicts = businesses.map((business) => summaryBelongsTo(business, names));
  if (businesses.length === 0 || verdicts.some((same) => same !== false)) return null;
  return businesses.length === 1
    ? `This summary is for ${businesses[0]}, which is not a name on this case.`
    : `This summary is for ${businesses.join(" and ")}, none of which is a name on this case.`;
}

/** Everything Update Case shows, plus the guidance line. */
export async function caseSummary(client: Queryable, actor: Actor, caseId: string, done?: string) {
  const row = await loadCase(client, caseId);
  if (!canActOnCase(actor, row.owner_user_id, "case.read")) {
    throw new ApiError(404, "No such case, or you do not have access to it.");
  }
  await regenerateRequirements(client, caseId);

  const { rows: pending } = await client.query<{
    id: string;
    name: string;
    code: string;
    other_party: string | null;
    period_start: string | null;
    period_kind: string | null;
    status: string;
  }>(
    `select r.id, coalesce(r.custom_name, dt.name) as name, dt.code,
            case when cpa.is_primary then null else pp.full_name end as other_party,
            r.period_start::text, dt.period_kind::text, r.status::text
       from document_requirement r
       join document_type dt on dt.id = r.document_type_id
       left join case_party cpa on cpa.id = r.required_of_case_party_id
       left join person pp on pp.id = cpa.person_id
      where r.case_id = $1 and r.status in ('pending', 'rejected')
      order by dt.display_order, dt.code, r.period_start desc`,
    [caseId],
  );

  const { rows: notNeeded } = await client.query<{
    id: string;
    name: string;
    period_start: string | null;
    period_kind: string | null;
  }>(
    `select r.id, coalesce(r.custom_name, dt.name) as name, r.period_start::text, dt.period_kind::text
       from document_requirement r
       join document_type dt on dt.id = r.document_type_id
      where r.case_id = $1 and r.status = 'not_applicable' and r.reason = $2
      order by dt.display_order, dt.code, r.period_start desc`,
    [caseId, NOT_NEEDED_REASON],
  );

  const { rows: applications } = await client.query<{
    id: string;
    status: SubmissionStatus;
    bank: string | null;
    banker_name: string | null;
    login_date: string | null;
    login_employee_id: string | null;
    bank_reference_number: string | null;
    approved_amount: string | null;
    sanction_amount: string | null;
    sanction_date: string | null;
    sanction_acceptance_date: string | null;
    disbursement_amount: string | null;
    disbursement_date: string | null;
    open_query_id: string | null;
    submitted_at: string | null;
  }>(
    `select s.id, s.status::text as status,
            coalesce(s.bank_name_at_submission, o.canonical_name) as bank, s.banker_name,
            s.login_date::text, s.login_employee_id, s.bank_reference_number,
            s.approved_amount::text, of.sanctioned_amount::text as sanction_amount, s.sanction_date::text,
            s.sanction_acceptance_date::text, s.disbursement_amount::text, s.disbursement_date::text,
            (select q.id from submission_query q where q.submission_id = s.id and q.answered_at is null limit 1) as open_query_id,
            s.submitted_at::text
       from submission s
       left join organisation o on o.id = s.institution_organisation_id
       left join lateral (select sanctioned_amount from offer where submission_id = s.id order by created_at desc limit 1) of on true
      where s.case_id = $1
      order by s.created_at`,
    [caseId],
  );

  const { rows: uploadedRows } = await client.query<{
    id: string;
    name: string;
    file_name: string;
    status: string;
    document_id: string;
  }>(
    `select r.id, r.status::text, coalesce(r.custom_name, dt.name) as name, d.file_name, d.id as document_id
       from document_requirement r
       join document_type dt on dt.id = r.document_type_id
       join document d on d.id = r.uploaded_document_id
      where r.case_id = $1 and r.status in ('received', 'verified')
      order by dt.display_order, dt.code, r.period_start desc nulls last`,
    [caseId],
  );
  const gstMonths = await gstMonthsIn(client, caseId);
  const next = await nextLineFor(client, row);
  const open = row.stage !== "lost" && row.stage !== "closed";
  const uploadFirst =
    open && uploadedRows.length === 0 && (row.document_status === "partial" || row.document_status === "complete");

  const tasks = await openTasksOf(client, caseId);
  const { rows: coApplicants } = await client.query<{ id: string; full_name: string | null }>(
    `select cp.id, p.full_name from case_party cp join person p on p.id = cp.person_id
      where cp.case_id = $1 and cp.role = 'co_applicant' and cp.removed_at is null order by cp.created_at`,
    [caseId],
  );
  return {
    id: row.id,
    hasCoApplicant: row.has_co_applicant,
    coApplicants: coApplicants.map((party) => ({ partyId: party.id, name: party.full_name })),
    caseNumber: row.case_number,
    stage: row.stage,
    customerName: row.applicant_name,
    applicantPersonId: row.applicant_person_id,
    openedOn: row.opened_on,
    ownerName: row.owner_name,
    ownerUserId: row.owner_user_id,
    amount: row.requested_amount === null ? null : Number(row.requested_amount),
    amountInWords: row.requested_amount === null ? "" : amountInWords(Number(row.requested_amount)),
    loanType: row.loan_type,
    loanVariant: row.loan_variant,
    place: row.place,
    firm: row.firm,
    misManaged: row.mis_managed,
    misCaseNotes: row.mis_case_notes,
    isPractice: row.is_practice,
    isOnHold: row.is_on_hold,
    documentStatus: row.document_status,
    eligibilityStatus: row.eligibility_status,
    lostReason: row.lost_reason,
    done: done ?? null,
    next: uploadFirst ? `Next: Upload the documents received, below. Then: ${next.replace(/^Next: /, "")}` : next,
    statusLine: deriveStatusLine({
      stage: row.stage,
      isOnHold: row.is_on_hold,
      applications: applications.map((app) => ({
        bank: app.bank,
        status: app.status,
        sentAt: app.submitted_at,
        loginDate: app.login_date,
      })),
    }),
    // A suggestion only: document status stays a person's call (ADR-040).
    suggestDocumentsComplete:
      open && pending.length === 0 && uploadedRows.length > 0 && row.document_status !== "complete",
    financialSummary: row.financial_summary,
    financialSummaryWarning: await summaryWarning(client, caseId, row.financial_summary),
    uploaded: uploadedRows.map((item) => ({
      requirementId: item.id,
      documentId: item.document_id,
      name: item.name,
      fileName: item.file_name,
      status: item.status,
    })),
    pending: pending.map((item) => {
      const year = item.period_start ? financialYearOf(new Date(item.period_start)).label : undefined;
      // The 3B set is the last 12 months, not one financial year.
      const label =
        item.code === "gst_returns"
          ? `${item.name} – last 12 months`
          : documentRowLabel(item.name, year, (item.period_kind ?? undefined) as PeriodKind | undefined);
      const months = item.code === "gst_returns" && gstMonths > 0 ? ` (${gstMonths} of 12 months in)` : "";
      return {
        id: item.id,
        label: `${item.other_party ? `${label} (${item.other_party})` : label}${months}`,
        rejected: item.status === "rejected",
      };
    }),
    notNeeded: notNeeded.map((item) => ({
      id: item.id,
      label: documentRowLabel(
        item.name,
        item.period_start ? financialYearOf(new Date(item.period_start)).label : undefined,
        (item.period_kind ?? undefined) as PeriodKind | undefined,
      ),
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      dueOn: task.due_on,
      assigneeName: task.assignee_name,
    })),
    applications: applications.map((app) => ({
      id: app.id,
      status: app.status,
      statusLabel: SUBMISSION_STATUS_LABELS[app.status],
      nextStatuses: NEXT_SUBMISSION_STATUSES[app.status],
      bank: app.bank,
      bankerName: app.banker_name,
      loginDate: app.login_date,
      loginEmployeeId: app.login_employee_id,
      reference: app.bank_reference_number,
      approvedAmount: app.approved_amount === null ? null : Number(app.approved_amount),
      sanctionAmount: app.sanction_amount === null ? null : Number(app.sanction_amount),
      sanctionDate: app.sanction_date,
      acceptanceDate: app.sanction_acceptance_date,
      disbursementAmount: app.disbursement_amount === null ? null : Number(app.disbursement_amount),
      disbursementDate: app.disbursement_date,
      hasOpenQuery: app.open_query_id !== null,
      sentAt: app.submitted_at,
    })),
  };
}

/** The work queue. Everyone sees their own; `can task.read all` can see others. */
export async function workQueue(client: Queryable, actor: Actor, who: string | null, firm: string | null = null) {
  const everyone = can(actor, "task.read", "all");
  if (!everyone && !can(actor, "task.read", "own")) throw new ApiError(403, refusalMessage("task.read"));
  const target = who === "everyone" ? (everyone ? null : actor.userId) : everyone && who ? who : actor.userId;
  const { rows } = await client.query<{
    id: string;
    case_id: string;
    case_number: string;
    title: string;
    kind: string | null;
    due_on: string | null;
    assignee_name: string | null;
    customer_name: string | null;
    firm: string;
  }>(
    `select t.id, t.case_id, c.case_number, c.firm, t.title, t.kind,
            (t.due_at at time zone 'Asia/Kolkata')::date::text as due_on,
            ap.full_name as assignee_name, p.full_name as customer_name
       from task t
       join loan_case c on c.id = t.case_id
       left join case_party cp on cp.case_id = c.id and cp.is_primary and cp.removed_at is null
       left join person p on p.id = cp.person_id
       left join app_user au on au.id = t.assigned_to
       left join person ap on ap.id = au.person_id
      where t.completed_at is null and not c.is_practice
        and ($1::uuid is null or t.assigned_to = $1)
        and ($2::text is null or c.firm = $2)
      order by t.due_at nulls last`,
    [target, firm],
  );
  return rows.map((row) => ({
    id: row.id,
    caseId: row.case_id,
    caseNumber: row.case_number,
    firm: row.firm,
    title: row.title,
    kind: row.kind,
    dueOn: row.due_on,
    assigneeName: row.assignee_name,
    customerName: row.customer_name,
  }));
}

// ---------------------------------------------------------------------------
// Update Case: the Case tab
// ---------------------------------------------------------------------------

export async function updateDocuments(client: Queryable, actor: Actor, caseId: string, body: Record<string, unknown>) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.update");
  requireOpen(row);

  const which = String(body.which ?? "");
  const eligible = row.eligibility_status === "eligible";
  let status: string;
  let event: WorkEvent;
  let target: "documents_pending" | "eligibility_check" | "documents_collected";
  let said: string;

  if (which === "pending") {
    status = "pending";
    event = { type: "documents_none", due: requireFutureDate(body.nextDate, "when to collect the documents") };
    target = "documents_pending";
    said = "Documents marked as nothing yet.";
  } else if (which === "part") {
    status = "partial";
    said = "Documents marked partly received.";
    if (eligible) {
      event = {
        type: "eligible",
        documentsComplete: false,
        due: requireFutureDate(body.nextDate, "when to collect the rest"),
      };
      target = "documents_pending";
    } else {
      event = { type: "documents_part" };
      target = "eligibility_check";
    }
  } else if (which === "all") {
    status = "complete";
    event = { type: "documents_all", eligible };
    target = eligible ? "documents_collected" : "eligibility_check";
    said = "Documents marked fully received.";
  } else {
    throw new ApiError(400, "Choose what happened with the documents.");
  }

  await client.query(`update loan_case set document_status = $1 where id = $2`, [status, caseId]);
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId,
    eventType: "case.documents_updated",
    payloadBefore: { documentStatus: row.document_status },
    payloadAfter: { documentStatus: status },
  });
  await moveStageByUser(client, actor, row, target);
  await applyWork(client, actor, caseId, event);
  return await caseSummary(client, actor, caseId, said);
}

export async function answerEligibility(client: Queryable, actor: Actor, caseId: string, body: Record<string, unknown>) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.update");
  requireOpen(row);

  const answer = String(body.answer ?? "");
  if (answer !== "eligible" && answer !== "not_eligible") {
    throw new ApiError(400, "Answer Eligible or Not eligible.");
  }

  const record = async (): Promise<void> => {
    await client.query(`update loan_case set eligibility_status = $1 where id = $2`, [answer, caseId]);
    await recordCaseEvent(client, {
      actorUserId: actor.userId,
      caseId,
      eventType: "case.eligibility_answered",
      payloadBefore: { eligibilityStatus: row.eligibility_status },
      payloadAfter: { eligibilityStatus: answer },
    });
  };

  if (answer === "not_eligible") {
    await record();
    await markLost(client, actor, caseId, {
      lostReason: "customer_not_eligible",
      lostNote: typeof body.note === "string" ? body.note : null,
    });
    await applyWork(client, actor, caseId, { type: "not_eligible" });
    return await caseSummary(client, actor, caseId, "Marked not eligible.");
  }

  const complete = row.document_status === "complete";
  const due = complete ? undefined : requireFutureDate(body.nextDate, "when to collect the rest");
  await record();
  await moveStageByUser(client, actor, row, complete ? "documents_collected" : "documents_pending");
  await applyWork(client, actor, caseId, { type: "eligible", documentsComplete: complete, ...(due ? { due } : {}) });
  return await caseSummary(client, actor, caseId, "Marked eligible.");
}

export async function reschedule(client: Queryable, actor: Actor, caseId: string, body: Record<string, unknown>) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.update");
  requireOpen(row);

  const days = Number(body.days);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new ApiError(400, "Pick when to reschedule to.");

  const tasks = await openTasksOf(client, caseId);
  const task = tasks[0];
  if (!task) throw new ApiError(409, "This case has no open action to reschedule.");

  const { rows } = await client.query<{ due_on: string }>(
    `update task set due_at = current_date + $1::int where id = $2
     returning (due_at at time zone 'Asia/Kolkata')::date::text as due_on`,
    [days, task.id],
  );
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId,
    eventType: "case.task_rescheduled",
    payloadBefore: { taskId: task.id, dueOn: task.due_on },
    payloadAfter: { taskId: task.id, dueOn: rows[0]!.due_on },
  });
  return await caseSummary(client, actor, caseId, `${task.title} rescheduled.`);
}

export async function dropCase(client: Queryable, actor: Actor, caseId: string, body: Record<string, unknown>) {
  const reason = String(body.reason ?? "") as LostReason;
  if (!(LOST_REASONS as readonly string[]).includes(reason)) throw new ApiError(400, "Pick why the case is closing.");
  await markLost(client, actor, caseId, {
    lostReason: reason,
    lostNote: typeof body.note === "string" ? body.note : null,
  });
  await applyWork(client, actor, caseId, { type: "dropped" });
  return await caseSummary(client, actor, caseId, "Case closed.");
}

/** Undoes `requirementNotNeeded`: the document is pending again. */
export async function requirementRestore(client: Queryable, actor: Actor, caseId: string, requirementId: string) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.update");
  const updated = await client.query(
    `update document_requirement set status = 'pending', reason = null
      where id = $1 and case_id = $2 and status = 'not_applicable' and reason = $3`,
    [requirementId, caseId, NOT_NEEDED_REASON],
  );
  if (updated.rowCount === 0) throw new ApiError(404, "No such removed document on this case.");
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId,
    eventType: "case.requirement_restored",
    payloadAfter: { requirementId },
  });
  return await caseSummary(client, actor, caseId, "Back on this case's pending list.");
}

/** One tap, no reason: this document is not needed on this case. */
export async function requirementNotNeeded(client: Queryable, actor: Actor, caseId: string, requirementId: string) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "case.update");
  const updated = await client.query(
    `update document_requirement set status = 'not_applicable', reason = $3
      where id = $1 and case_id = $2 and status in ('pending', 'rejected')`,
    [requirementId, caseId, NOT_NEEDED_REASON],
  );
  if (updated.rowCount === 0) throw new ApiError(404, "No such pending document on this case.");
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId,
    eventType: "case.requirement_not_needed",
    payloadAfter: { requirementId },
  });
  return await caseSummary(client, actor, caseId, "Removed from this case's pending list.");
}

/**
 * Take a wrongly uploaded document off the case. The file is never deleted (BR-031):
 * it stays on record, unlinked from this case, and no longer in its document list.
 * The row it answered goes back to pending, or, if the upload made the row, becomes
 * not-needed. The reason is kept on that row, not in the event. Anyone who may
 * verify documents may retire one: it is the same judgement.
 */
export async function retireDocument(
  client: Queryable,
  actor: Actor,
  caseId: string,
  requirementId: string,
  body: Record<string, unknown>,
) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "document.verify");
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) throw new ApiError(400, "Say why this document is being removed.");

  const { rows } = await client.query<{ is_custom: boolean; code: string; document_id: string }>(
    `select r.is_custom, dt.code, r.uploaded_document_id as document_id
       from document_requirement r
       join document_type dt on dt.id = r.document_type_id
      where r.id = $1 and r.case_id = $2 and r.status in ('received', 'verified') and r.uploaded_document_id is not null`,
    [requirementId, caseId],
  );
  const found = rows[0];
  if (!found) throw new ApiError(404, "No such uploaded document on this case.");

  await client.query(
    `update document_requirement
        set status = $2, uploaded_document_id = null, satisfied_by_document_id = null, reason = $3
      where id = $1`,
    [requirementId, found.is_custom ? "not_applicable" : "pending", reason],
  );
  // The 3B set had been marked complete at twelve months; one fewer reopens it.
  if (found.code === "gst_returns" && (await gstMonthsIn(client, caseId)) < 12) {
    await client.query(
      `update document_requirement r set status = 'pending'
         from document_type dt
        where dt.id = r.document_type_id and r.case_id = $1 and dt.code = 'gst_returns'
          and not r.is_custom and r.status = 'received' and r.uploaded_document_id is null`,
      [caseId],
    );
  }
  await recordCaseEvent(client, {
    actorUserId: actor.userId,
    caseId,
    eventType: "case.document_retired",
    payloadAfter: { requirementId, documentId: found.document_id },
  });
  return await caseSummary(client, actor, caseId, "Document removed from this case. The file is kept on record.");
}

/** Remove the GST and ITR summary from the case, e.g. when it was uploaded to the wrong one. */
export async function clearFinancialSummary(client: Queryable, actor: Actor, caseId: string) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "document.verify");
  if (!row.financial_summary) throw new ApiError(404, "This case has no GST and ITR summary.");
  await client.query(`update loan_case set financial_summary = null, financial_summary_at = null where id = $1`, [caseId]);
  await recordCaseEvent(client, { actorUserId: actor.userId, caseId, eventType: "case.financial_summary_cleared" });
  return await caseSummary(client, actor, caseId, "GST and ITR summary removed from this case.");
}

// ---------------------------------------------------------------------------
// Update Case: uploading a case folder
// ---------------------------------------------------------------------------

/** Months of GSTR-3B on this case. */
async function gstMonthsIn(client: Queryable, caseId: string): Promise<number> {
  const { rows } = await client.query<{ n: number }>(
    `select count(distinct r.period_start)::int as n
       from document_requirement r
       join document_type dt on dt.id = r.document_type_id
      where r.case_id = $1 and dt.code = 'gst_returns' and r.is_custom
        and r.period_start is not null and r.uploaded_document_id is not null`,
    [caseId],
  );
  return rows[0]?.n ?? 0;
}

/** The pending row this file answers, or a new row of its own. */
async function requirementForFile(
  client: Queryable,
  actor: Actor,
  caseId: string,
  match: FileMatch,
  rowName: string,
  fileName: string,
): Promise<string> {
  // A personal document is the applicant's unless the file names a co-applicant (ADR-049).
  const personal = belongsToApplicant(match.documentTypeCode);
  const { rows: parties } = await client.query<{ id: string; name: string | null; is_primary: boolean }>(
    `select cp.id, p.full_name as name, cp.is_primary
       from case_party cp left join person p on p.id = cp.person_id
      where cp.case_id = $1 and cp.removed_at is null and (cp.is_primary or cp.role = 'co_applicant')`,
    [caseId],
  );
  const owner = partyForFile(fileName, parties.map((p) => ({ id: p.id, name: p.name, isPrimary: p.is_primary })));
  const ownerIsCoApplicant = personal && parties.some((p) => p.id === owner && !p.is_primary);

  if (!match.isMonthlyReturn) {
    const { rows } = await client.query<{ id: string }>(
      `select r.id
         from document_requirement r
         join document_type dt on dt.id = r.document_type_id
        where r.case_id = $1 and dt.code = $2 and r.status in ('pending', 'rejected')
          and ($3::date is null or r.period_start = $3::date or r.period_start is null)
          and (not $5 or r.required_of_case_party_id = $4)
        order by (r.required_of_case_party_id = $4) desc nulls last,
                 (r.period_start = $3::date) desc nulls last, r.period_start desc nulls last
        limit 1`,
      [caseId, match.documentTypeCode, match.periodStart ?? null, owner, ownerIsCoApplicant],
    );
    if (rows[0]) return rows[0].id;
  }

  const { rows } = await client.query<{ id: string }>(
    `insert into document_requirement
       (case_id, document_type_id, required_of_case_party_id, applicable_from_stage, applicability_id,
        is_custom, custom_name, period_start, period_end, created_by)
     select $1, dt.id, $2, 'documents_pending', a.id, true, $3, $4, $5, $6
       from document_type dt, requirement_applicability a
      where dt.code = $7 and a.code = 'optional'
     returning id`,
    [
      caseId,
      personal ? owner : null,
      rowName,
      match.periodStart ?? null,
      match.periodEnd ?? null,
      actor.userId,
      match.documentTypeCode,
    ],
  );
  if (!rows[0]) throw new ApiError(500, `Document type ${match.documentTypeCode} is missing.`);
  return rows[0].id;
}

export interface UploadAnswer {
  readonly fileName: string;
  readonly result: "skipped" | "summary" | "duplicate" | "filed" | "other" | "archive" | "unreadable_archive" | "failed";
  readonly documentTypeCode?: string;
  /** What it was stored as, when PFO renamed it. */
  readonly storedAs?: string;
  /** The type came from reading the file, not its name. */
  readonly readByAi?: boolean;
  readonly reason?: string;
  /** The name of the document type it was filed as. */
  readonly typeName?: string;
  /** Something to look at twice, such as a summary for another business. */
  readonly warning?: string;
  /** For an archive: what became of each file inside. */
  readonly files?: readonly UploadAnswer[];
}

/**
 * One file from a case folder. The screen sends them one at a time so one bad
 * file cannot lose the rest; the person only ever does one thing, pick the folder.
 *
 * A zip is opened and each file inside goes through here as if dropped. A
 * stored file is named by what it is, with the name it arrived with kept.
 */
export async function uploadCaseFile(
  client: Queryable,
  actor: Actor,
  caseId: string,
  file: { bytes: Uint8Array; fileName: string; folder: string },
  insideArchive = false,
): Promise<UploadAnswer> {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "document.upload");

  const archive = archiveKind(file.fileName);
  if (archive) {
    const unreadable = (reason: string): UploadAnswer => ({ fileName: file.fileName, result: "unreadable_archive", reason });
    if (archive === "unsupported") {
      return unreadable("PFO cannot open RAR or 7z files. Extract it, then drop the folder.");
    }
    if (insideArchive) return unreadable("A zip inside a zip is not opened. Extract it, then drop the folder.");
    const opened = unpackZip(file.bytes);
    if (!opened.ok) return unreadable(opened.reason);
    const files: UploadAnswer[] = [];
    for (const inner of opened.files) {
      try {
        files.push(await uploadCaseFile(client, actor, caseId, { ...inner, folder: inner.folder || file.folder }, true));
      } catch (error) {
        // Only checks that run before any query (empty, too large, storage down): a
        // database error would have aborted the transaction and must not be swallowed.
        if (!(error instanceof ApiError)) throw error;
        files.push({ fileName: inner.fileName, result: "failed", reason: error.message });
      }
    }
    return { fileName: file.fileName, result: "archive", files };
  }

  await regenerateRequirements(client, caseId);

  const kind = classifyCaseFile(file.fileName, file.folder);
  if (kind.kind === "skip") return { fileName: file.fileName, result: "skipped" };

  // Before anything is written for this file: `uploadDocument` refuses it too,
  // but by then a checklist line would already exist for a file never stored.
  const refusal = uploadRefusal(file.fileName, file.bytes);
  if (refusal) throw new ApiError(415, refusal);

  if (kind.kind === "financial_summary") {
    await client.query(
      `update loan_case set financial_summary = $1, financial_summary_at = now() where id = $2`,
      [new TextDecoder().decode(file.bytes).replace(/^﻿/, ""), caseId],
    );
    await recordCaseEvent(client, { actorUserId: actor.userId, caseId, eventType: "case.financial_summary_added" });
    const warning = await summaryWarning(client, caseId, new TextDecoder().decode(file.bytes));
    return { fileName: file.fileName, result: "summary", ...(warning ? { warning } : {}) };
  }

  // A repeat is the same bytes, whatever the file is called. Documents from before
  // the fingerprint existed are still caught by name and size.
  const contentSha256 = createHash("sha256").update(file.bytes).digest("hex");
  const { rows: already } = await client.query(
    `select 1 from document_requirement r join document d on d.id = r.uploaded_document_id
      where r.case_id = $1
        and (d.content_sha256 = $2 or (d.content_sha256 is null and d.file_name = $3 and d.file_size_bytes = $4))
      limit 1`,
    [caseId, contentSha256, file.fileName, file.bytes.byteLength],
  );
  if (already[0]) return { fileName: file.fileName, result: "duplicate" };

  let match = kind.match;
  let readByAi = false;
  if (!match.recognised) {
    const read = await readByContent(client, file);
    if (read) {
      match = read;
      readByAi = true;
    }
  }

  const { rows: typeRows } = await client.query<{ name: string }>(`select name from document_type where code = $1`, [
    match.documentTypeCode,
  ]);
  const typeName = typeRows[0]?.name ?? match.documentTypeCode;
  const rowName = match.isMonthlyReturn
    ? monthlyReturnName(match.periodStart!)
    : readByAi
      ? typeName
      : file.fileName.replace(/\.[^.]+$/, "");
  const requirementId = await requirementForFile(client, actor, caseId, match, rowName, file.fileName);

  // Named by what it is, once known; a file nothing could place keeps its own name.
  let storedName = file.fileName;
  if (match.recognised && !match.keepsOwnName) {
    const { rows: owner } = await client.query<{ full_name: string | null }>(
      `select p.full_name
         from document_requirement r
         left join case_party cp on cp.id = r.required_of_case_party_id
         left join person p on p.id = cp.person_id
        where r.id = $1`,
      [requirementId],
    );
    const standard = standardFileName({
      typeName,
      ...(match.isMonthlyReturn ? { monthlyName: monthlyReturnName(match.periodStart!) } : {}),
      periodStart: match.periodStart ?? null,
      periodEnd: match.periodEnd ?? null,
      personName: owner[0]?.full_name ?? null,
      originalFileName: file.fileName,
    });
    // Two documents of one kind (deed pages, a second bank's statement) must not read the same.
    const { rows: taken } = await client.query<{ file_name: string }>(
      `select d.file_name from document_requirement r join document d on d.id = r.uploaded_document_id
        where r.case_id = $1`,
      [caseId],
    );
    const used = new Set(taken.map((t) => t.file_name));
    const dot = standard.lastIndexOf(".") > 0 ? standard.lastIndexOf(".") : standard.length;
    storedName = standard;
    for (let n = 2; used.has(storedName); n += 1) storedName = `${standard.slice(0, dot)} (${n})${standard.slice(dot)}`;
  }

  await uploadDocument(client, actor, caseId, requirementId, {
    bytes: file.bytes,
    fileName: storedName,
    contentSha256,
    ...(storedName !== file.fileName ? { originalFileName: file.fileName } : {}),
  });

  // Twelve months in means the 3B set is complete, so it leaves the pending list.
  if (match.isMonthlyReturn && (await gstMonthsIn(client, caseId)) >= 12) {
    await client.query(
      `update document_requirement r set status = 'received'
         from document_type dt
        where dt.id = r.document_type_id and r.case_id = $1 and dt.code = 'gst_returns'
          and not r.is_custom and r.status = 'pending'`,
      [caseId],
    );
  }
  return {
    fileName: file.fileName,
    result: match.recognised ? "filed" : "other",
    documentTypeCode: match.documentTypeCode,
    typeName,
    ...(storedName !== file.fileName ? { storedAs: storedName } : {}),
    ...(readByAi ? { readByAi: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Update Case: the Send to lenders tab
// ---------------------------------------------------------------------------

/** Active lenders, those supporting this loan type first. */
export async function lenderOptions(client: Queryable, actor: Actor, caseId: string) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "submission.create");
  const { rows } = await client.query<{
    id: string;
    name: string;
    supports: boolean;
    already: boolean;
    bankers: string[];
    bankerEmails: Record<string, string>;
    lastBanker: { name: string | null; email: string | null } | null;
  }>(
    // lastBanker: whoever this lender's most recent file went to, so ticking the
    // lender fills the banker in instead of making someone type it every time.
    `select o.id, o.canonical_name as name,
            (select jsonb_build_object('name', bc.contact_name, 'email', lower(nullif(btrim(bc.work_email), '')))
               from submission s join bank_contact bc on bc.id = s.bank_contact_id and bc.is_active
              where s.institution_organisation_id = o.id
              order by s.created_at desc limit 1) as "lastBanker",
            ($2::text = any (p.supported_loan_types)) as supports,
            exists (select 1 from submission s where s.case_id = $1 and s.institution_organisation_id = o.id
                     and s.status not in ('rejected', 'withdrawn', 'not_eligible_precheck')) as already,
            coalesce((select array_agg(distinct bc.contact_name) from bank_contact bc
                       where bc.institution_organisation_id = o.id and bc.is_active and bc.contact_name is not null), '{}') as bankers,
            coalesce((select jsonb_object_agg(upper(bc.contact_name), lower(btrim(bc.work_email))) from bank_contact bc
                       where bc.institution_organisation_id = o.id and bc.is_active and bc.contact_name is not null
                         and nullif(btrim(bc.work_email), '') is not null), '{}'::jsonb) as "bankerEmails"
       from organisation o
       join lender_profile p on p.organisation_id = o.id
      where o.is_active and o.parent_organisation_id is null and 'lender' = any (o.roles)
      order by ($2::text = any (p.supported_loan_types)) desc, o.canonical_name`,
    [caseId, row.loan_type],
  );
  return rows;
}

export async function sendToLenders(client: Queryable, actor: Actor, caseId: string, body: Record<string, unknown>) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "submission.create");
  requireOpen(row);

  const picks = Array.isArray(body.lenders)
    ? (body.lenders as { id?: unknown; banker?: unknown; email?: unknown }[])
    : [];
  if (picks.length === 0) throw new ApiError(400, "Tick at least one lender.");

  // "email": make the application and its recipient, and leave the file for the
  // Banks tab's mail flow to send; the follow-up task waits for the mail
  // (`afterPackageSent`). Anything else only records the lender and banker.
  const emailMode = body.mode === "email";

  const skipped: string[] = [];
  const created: string[] = [];
  const createdIds: { lenderId: string; lender: string; submissionId: string }[] = [];
  for (const pick of picks) {
    const lenderId = String(pick.id ?? "");
    const banker = capitals(String(pick.banker ?? ""));
    const typedEmail = emailMode ? String(pick.email ?? "").trim().toLowerCase() : "";
    if (typedEmail !== "" && !EMAIL_SHAPE.test(typedEmail)) {
      throw new ApiError(400, `"${typedEmail}" does not look like an email address.`);
    }
    const { rows: lenderRows } = await client.query<{
      name: string;
      branch_id: string | null;
      branch_name: string | null;
      address_line: string | null;
      city_name: string | null;
    }>(
      `select o.canonical_name as name, b.id as branch_id, b.canonical_name as branch_name,
              bb.address_line, c.name as city_name
         from organisation o
         left join lateral (select * from organisation x where x.parent_organisation_id = o.id
                             and 'branch' = any (x.roles) and x.is_active order by x.created_at limit 1) b on true
         left join bank_branch bb on bb.organisation_id = b.id
         left join city c on c.id = bb.city_id
        where o.id = $1 and o.is_active and 'lender' = any (o.roles)`,
      [lenderId],
    );
    const lender = lenderRows[0];
    if (!lender) throw new ApiError(400, "One of the ticked lenders is no longer active.");
    if (!lender.branch_id) throw new ApiError(409, `${lender.name} has no branch on file. Add one in the lender catalogue.`);

    const already = await client.query(
      `select 1 from submission where case_id = $1 and institution_organisation_id = $2
        and status not in ('rejected', 'withdrawn', 'not_eligible_precheck')`,
      [caseId, lenderId],
    );
    if (already.rows[0]) {
      skipped.push(lender.name);
      continue;
    }

    let contactId: string | null = null;
    let recipientEmail = typedEmail;
    if (banker !== "") {
      const known = await client.query<{ id: string; work_email: string | null }>(
        `select id, work_email from bank_contact
          where institution_organisation_id = $1 and upper(contact_name) = $2 and is_active limit 1`,
        [lenderId, banker],
      );
      contactId = known.rows[0]?.id ?? null;
      const onFile = known.rows[0]?.work_email?.trim().toLowerCase() ?? "";
      if (contactId) {
        if (recipientEmail === "") recipientEmail = onFile;
        // A banker with no address gets the one typed now; one with an address keeps it.
        else if (onFile === "") {
          await client.query(`update bank_contact set work_email = $2, updated_by = $3 where id = $1`, [
            contactId,
            recipientEmail,
            actor.userId,
          ]);
        }
      } else {
        const added = await client.query<{ id: string }>(
          `insert into bank_contact (institution_organisation_id, branch_organisation_id, contact_name, work_email, created_by)
           values ($1, $2, $3, $4, $5) returning id`,
          [lenderId, lender.branch_id, banker, recipientEmail || null, actor.userId],
        );
        contactId = added.rows[0]!.id;
      }
    } else if (recipientEmail !== "") {
      // An address with no name: the same address at the same lender is the same banker.
      const known = await client.query<{ id: string }>(
        `select id from bank_contact
          where institution_organisation_id = $1 and lower(btrim(work_email)) = $2 and is_active limit 1`,
        [lenderId, recipientEmail],
      );
      contactId = known.rows[0]?.id ?? null;
      if (!contactId) {
        const added = await client.query<{ id: string }>(
          `insert into bank_contact (institution_organisation_id, branch_organisation_id, work_email, created_by)
           values ($1, $2, $3, $4) returning id`,
          [lenderId, lender.branch_id, recipientEmail, actor.userId],
        );
        contactId = added.rows[0]!.id;
      }
    }
    if (emailMode && recipientEmail === "") {
      throw new ApiError(400, `Type ${lender.name}'s banker email, so the documents have somewhere to go.`);
    }

    const inserted = await client.query<{ id: string }>(
      `insert into submission
         (case_id, branch_organisation_id, institution_organisation_id, bank_contact_id, banker_name,
          bank_name_at_submission, branch_name_at_submission, branch_address_at_submission,
          branch_city_at_submission, snapshot_taken_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $10)
       returning id`,
      [
        caseId,
        lender.branch_id,
        lenderId,
        contactId,
        banker || null,
        lender.name,
        lender.branch_name,
        lender.address_line,
        lender.city_name,
        actor.userId,
      ],
    );
    const submissionId = inserted.rows[0]!.id;
    await recordSubmissionEvent(client, {
      actorUserId: actor.userId,
      caseId,
      entityType: "submission",
      entityId: submissionId,
      eventType: "submission.created",
    });
    if (emailMode) {
      await client.query(
        `insert into submission_recipient
           (submission_id, bank_contact_id, email, contact_name, is_primary, recipient_kind, display_order, created_by)
         values ($1, $2, $3, $4, true, 'to', 10, $5)`,
        [submissionId, contactId, recipientEmail, banker || null, actor.userId],
      );
    } else {
      await applyWork(client, actor, caseId, { type: "sent_to_lender", bank: lender.name, submissionId });
    }
    created.push(lender.name);
    createdIds.push({ lenderId, lender: lender.name, submissionId });
  }

  const said = [
    created.length ? (emailMode ? `Ready to email ${created.join(", ")}.` : `Sent to ${created.join(", ")}.`) : null,
    skipped.length ? `Already with ${skipped.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return { ...(await caseSummary(client, actor, caseId, said)), created: createdIds };
}

/**
 * After a package's mail has gone: the follow-up task a recorded send raises
 * straight away. Only once the file is really out (`submitted`), and only if
 * the send was not already recorded and given its task.
 */
export async function afterPackageSent(
  client: Queryable,
  actor: Actor,
  caseId: string,
  submissionId: string,
): Promise<void> {
  const { rows } = await client.query<{ status: string; bank: string | null }>(
    `select status::text, bank_name_at_submission as bank from submission where id = $1 and case_id = $2`,
    [submissionId, caseId],
  );
  if (rows[0]?.status !== "submitted") return;
  const raised = await client.query(`select 1 from task where submission_id = $1 and kind = 'confirm_login'`, [submissionId]);
  if (raised.rows[0]) return;
  await applyWork(client, actor, caseId, { type: "sent_to_lender", bank: rows[0].bank ?? "the lender", submissionId });
}

// ---------------------------------------------------------------------------
// Update Case: the Applications tab
// ---------------------------------------------------------------------------

function optionalAmount(value: unknown, what: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseAmount(String(value));
  if (parsed === null) throw new ApiError(400, `${what}: type an amount (for example 25L or 1.5cr).`);
  return parsed;
}

function optionalDate(value: unknown, what: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) {
    throw new ApiError(400, `${what}: pick a date.`);
  }
  return text;
}

const FINISHED: readonly SubmissionStatus[] = ["disbursed", "rejected", "withdrawn", "not_eligible_precheck"];

/** One form, as in the MIS: the new status and the fields it needs, in one go. */
export async function updateApplication(
  client: Queryable,
  actor: Actor,
  caseId: string,
  submissionId: string,
  body: Record<string, unknown>,
) {
  const row = await loadCase(client, caseId);
  requireCase(actor, row, "submission.update_status");
  requireOpen(row);
  await lockCaseForOutcomeMutation(client, caseId);

  const { rows } = await client.query<{
    status: SubmissionStatus;
    bank: string | null;
    submitted_at: string | null;
    login_date: string | null;
    login_employee_id: string | null;
    sanction_date: string | null;
    disbursement_amount: string | null;
    disbursement_date: string | null;
    has_offer: boolean;
    open_query_id: string | null;
  }>(
    `select s.status::text as status, coalesce(s.bank_name_at_submission, o.canonical_name) as bank, s.submitted_at,
            s.login_date::text, s.login_employee_id, s.sanction_date::text,
            s.disbursement_amount::text, s.disbursement_date::text,
            exists (select 1 from offer f where f.submission_id = s.id) as has_offer,
            (select q.id from submission_query q where q.submission_id = s.id and q.answered_at is null limit 1) as open_query_id
       from submission s
       left join organisation o on o.id = s.institution_organisation_id
      where s.id = $1 and s.case_id = $2`,
    [submissionId, caseId],
  );
  const current = rows[0];
  if (!current) throw new ApiError(404, "No such application on this case.");

  const to = String(body.status ?? "") as SubmissionStatus;
  const correcting = body.showAllStatuses === true && can(actor, "case.assign", "all");
  if (!correcting && !canTransitionSubmission(current.status, to)) {
    throw new ApiError(409, `This application cannot move to ${SUBMISSION_STATUS_LABELS[to] ?? to} from here.`);
  }

  const atOrPastLogin = ["login_completed", "under_process", "query_raised", "eligibility_received", "sanctioned", "sanction_accepted", "disbursed", "rejected"].includes(to);
  const atOrPastSanction = ["sanctioned", "sanction_accepted", "disbursed"].includes(to);

  const loginDate = optionalDate(body.loginDate, "Login date") ?? current.login_date;
  const loginEmployee = (typeof body.loginEmployeeId === "string" && body.loginEmployeeId) || current.login_employee_id;
  if (atOrPastLogin && !loginDate) throw new ApiError(400, "Login date is needed.");
  if (atOrPastLogin && !loginEmployee) throw new ApiError(400, "Pick who logged it in.");

  const approved = optionalAmount(body.approvedAmount, "Approved amount");
  const sanctionAmount = optionalAmount(body.sanctionAmount, "Sanction amount");
  const sanctionDate = optionalDate(body.sanctionDate, "Sanction date") ?? current.sanction_date;
  if (atOrPastSanction && !current.has_offer && sanctionAmount === null) {
    throw new ApiError(400, "Sanction amount is needed.");
  }
  if (atOrPastSanction && !sanctionDate) throw new ApiError(400, "Sanction date is needed.");

  const acceptanceDate = optionalDate(body.acceptanceDate, "Acceptance date");
  if (to === "sanction_accepted" && !acceptanceDate) throw new ApiError(400, "Acceptance date is needed.");

  const disbursementAmount = optionalAmount(body.disbursementAmount, "Disbursement amount");
  const disbursementDate = optionalDate(body.disbursementDate, "Disbursement date");
  if (to === "disbursed" && (disbursementAmount === null || !disbursementDate)) {
    throw new ApiError(400, "Disbursement amount and date are needed.");
  }

  const reasonText = typeof body.reason === "string" ? body.reason.trim() : "";
  if (to === "not_eligible_precheck" && reasonText === "") throw new ApiError(400, "Note why the lender found the customer not eligible.");
  const rejectionReasonId = typeof body.rejectionReasonId === "string" ? body.rejectionReasonId : null;
  if (to === "rejected" && !rejectionReasonId) throw new ApiError(400, "Pick the rejection reason.");

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (to === "query_raised" && query === "") throw new ApiError(400, "Type the bank's query.");

  if (sanctionAmount !== null && !current.has_offer) {
    await client.query(
      `insert into offer (submission_id, sanctioned_amount, created_by) values ($1, $2, $3)`,
      [submissionId, sanctionAmount, actor.userId],
    );
  } else if (sanctionAmount !== null) {
    await client.query(`update offer set sanctioned_amount = $1 where submission_id = $2`, [sanctionAmount, submissionId]);
  }

  if (to === "sanction_accepted") {
    await client.query(
      `update offer set is_accepted = true, accepted_at = now(), accepted_by = $1
        where submission_id = $2 and is_accepted = false`,
      [actor.userId, submissionId],
    );
  }

  if (to === "query_raised") {
    await client.query(
      `insert into submission_query (submission_id, question) values ($1, $2)`,
      [submissionId, query],
    );
  }
  const closingQuery = current.status === "query_raised" && to !== "query_raised" && current.open_query_id;
  if (closingQuery) {
    await client.query(
      `update submission_query set answer = $1, answered_at = now(), answered_by = $2 where id = $3`,
      [typeof body.answer === "string" && body.answer.trim() ? body.answer.trim() : "Resolved", actor.userId, current.open_query_id],
    );
  }

  await client.query(
    `update submission set
        status = $1::app.submission_status,
        submitted_at = coalesce(submitted_at, case when $1::text not in ('not_submitted', 'withdrawn') then now() end),
        submitted_by = coalesce(submitted_by, case when $1::text not in ('not_submitted', 'withdrawn') then $2::uuid end),
        login_date = coalesce($3::date, login_date),
        login_employee_id = coalesce($4::uuid, login_employee_id),
        bank_reference_number = coalesce($5::text, bank_reference_number),
        approved_amount = coalesce($6::numeric, approved_amount),
        sanction_date = coalesce($7::date, sanction_date),
        sanction_acceptance_date = coalesce($8::date, sanction_acceptance_date),
        disbursement_amount = coalesce($9::numeric, disbursement_amount),
        disbursement_date = coalesce($10::date, disbursement_date),
        precheck_reason = case when $1::text = 'not_eligible_precheck' then $11::text else precheck_reason end,
        rejection_reason_id = case when $1::text = 'rejected' then $12::uuid else null end,
        bank_reason_text = case when $1::text = 'rejected' then nullif($11::text, '') else bank_reason_text end,
        rejected_at = case when $1::text = 'rejected' then now() else null end
      where id = $13`,
    [
      to,
      actor.userId,
      loginDate,
      loginEmployee,
      typeof body.reference === "string" && body.reference.trim() ? body.reference.trim() : null,
      approved,
      sanctionDate,
      acceptanceDate,
      disbursementAmount,
      disbursementDate,
      reasonText,
      rejectionReasonId,
      submissionId,
    ],
  );
  await recordSubmissionEvent(client, {
    actorUserId: actor.userId,
    caseId,
    entityType: "submission",
    entityId: submissionId,
    eventType: `submission.${to}` as SubmissionEventType,
  });

  const bank = current.bank ?? "the bank";
  if (to === "login_completed") await applyWork(client, actor, caseId, { type: "login_completed", submissionId });
  if (to === "query_raised") {
    await applyWork(client, actor, caseId, { type: "query_raised", bank, submissionId }, loginEmployee);
  }
  if (closingQuery) await applyWork(client, actor, caseId, { type: "query_answered", submissionId });
  if (to === "sanctioned") await applyWork(client, actor, caseId, { type: "sanctioned", bank, submissionId });
  if (FINISHED.includes(to)) await applyWork(client, actor, caseId, { type: "application_finished", submissionId });
  if (to !== "disbursed" && FINISHED.includes(to)) {
    const live = await client.query(
      `select 1 from submission where case_id = $1
          and status not in ('rejected', 'withdrawn', 'not_eligible_precheck') limit 1`,
      [caseId],
    );
    if (!live.rows[0]) await applyWork(client, actor, caseId, { type: "no_lender_left" });
  }

  await advanceCaseStage(client, caseId, { entityType: "submission", entityId: submissionId });
  return await caseSummary(client, actor, caseId, `${bank} is now ${SUBMISSION_STATUS_LABELS[to]}.`);
}
