/**
 * MIS reports over real cases (ADR-046). The figures are worked out by
 * `computeMisReport`, whose definitions are the MIS's own; this file reads the
 * rows it needs. Practice cases never count.
 */

import { PERIODS, computeMisReport, periodRange, type ReportApplication, type ReportCase, type ReportTask } from "@domain/reports/mis-report.js";
import { FIRMS, LEAD_SOURCES } from "@domain/work/intake.js";
import { syncWarning, type SyncRun } from "@domain/work/sync-status.js";

import { can, type Actor } from "./authorize.js";
import type { Queryable } from "./db.js";
import { ApiError, refusalMessage } from "./http.js";

const todayInIndia = (): string => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export interface ReportRows {
  readonly cases: readonly (ReportCase & { readonly ownerName: string | null })[];
  readonly applications: readonly ReportApplication[];
  readonly tasks: readonly ReportTask[];
  readonly people: readonly { readonly id: string; readonly name: string }[];
}

/** `firm` null means both firms. `syncedOnly` is the sync's own check against the MIS. */
export async function reportRows(client: Queryable, firm: string | null, syncedOnly = false): Promise<ReportRows> {
  const where = `not c.is_practice and ($1::text is null or c.firm = $1)
                 ${syncedOnly ? "and c.mis_case_id is not null" : ""}`;
  const { rows: cases } = await client.query<{
    id: string;
    case_number: string;
    customer_name: string | null;
    stage: string;
    document_status: string;
    owner_user_id: string;
    original_owner: string;
    owner_name: string | null;
    lead_on: string;
    amount: string | null;
    loan_type: string | null;
    source_code: string | null;
  }>(
    `select c.id, c.case_number, p.full_name as customer_name, c.stage::text, c.document_status, c.owner_user_id,
            coalesce(c.original_owner_user_id, c.owner_user_id) as original_owner, op.full_name as owner_name,
            coalesce(c.lead_received_on, (c.created_at at time zone 'Asia/Kolkata')::date)::text as lead_on,
            c.requested_amount::text as amount, c.loan_type, rs.code as source_code
       from loan_case c
       left join case_party cp on cp.case_id = c.id and cp.is_primary and cp.removed_at is null
       left join person p on p.id = cp.person_id
       left join app_user ou on ou.id = c.owner_user_id
       left join person op on op.id = ou.person_id
       left join referral_source rs on rs.id = c.referral_source_id
      where ${where}`,
    [firm],
  );
  const { rows: applications } = await client.query<{
    id: string;
    case_id: string;
    status: string;
    login_date: string | null;
    login_employee_id: string | null;
    sanction_date: string | null;
    sanction_amount: string | null;
    disbursement_date: string | null;
    disbursement_amount: string | null;
  }>(
    `select s.id, s.case_id, s.status::text, s.login_date::text, s.login_employee_id, s.sanction_date::text,
            (select o.sanctioned_amount::text from offer o where o.submission_id = s.id order by o.created_at desc limit 1) as sanction_amount,
            s.disbursement_date::text, s.disbursement_amount::text
       from submission s
       join loan_case c on c.id = s.case_id
      where ${where}`,
    [firm],
  );
  const { rows: tasks } = await client.query<{ case_id: string; assigned_to: string; due_on: string | null }>(
    `select t.case_id, t.assigned_to, (t.due_at at time zone 'Asia/Kolkata')::date::text as due_on
       from task t
       join loan_case c on c.id = t.case_id
      where t.completed_at is null and ${where}`,
    [firm],
  );
  const { rows: people } = await client.query<{ id: string; name: string }>(
    `select u.id, p.full_name as name from app_user u join person p on p.id = u.person_id
      where u.username <> 'pfo.automation' order by p.full_name`,
  );
  const number = (value: string | null): number | null => (value === null ? null : Number(value));
  return {
    cases: cases.map((row) => ({
      id: row.id,
      caseNumber: row.case_number,
      customerName: row.customer_name,
      stage: row.stage,
      documentStatus: row.document_status,
      ownerId: row.owner_user_id,
      originalOwnerId: row.original_owner,
      ownerName: row.owner_name,
      leadOn: row.lead_on,
      amount: number(row.amount),
      loanType: row.loan_type,
      leadSource: LEAD_SOURCES.find((source) => source.code === row.source_code)?.label ?? null,
    })),
    applications: applications.map((row) => ({
      id: row.id,
      caseId: row.case_id,
      status: row.status,
      loginDate: row.login_date,
      loginEmployeeId: row.login_employee_id,
      sanctionDate: row.sanction_date,
      sanctionAmount: number(row.sanction_amount),
      disbursementDate: row.disbursement_date,
      disbursementAmount: number(row.disbursement_amount),
    })),
    tasks: tasks.map((row) => ({ caseId: row.case_id, assignedTo: row.assigned_to, dueOn: row.due_on })),
    people,
  };
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** `report.view` at `all` only: these are whole-office figures. */
export async function misReport(client: Queryable, actor: Actor, params: URLSearchParams) {
  if (!can(actor, "report.view", "all")) throw new ApiError(403, refusalMessage("report.view"));

  const today = todayInIndia();
  const typedFrom = params.get("from");
  const typedTo = params.get("to");
  let range: { from: string; to: string } | null;
  if (typedFrom || typedTo) {
    if (!typedFrom || !typedTo || !DATE_SHAPE.test(typedFrom) || !DATE_SHAPE.test(typedTo) || typedFrom > typedTo) {
      throw new ApiError(400, "Choose a start date and an end date, in that order.");
    }
    range = { from: typedFrom, to: typedTo };
  } else {
    range = periodRange(params.get("period") ?? "month", today);
    if (!range) throw new ApiError(400, "Unknown period.");
  }

  const wantedFirm = params.get("firm");
  const firm = wantedFirm && wantedFirm !== "all" ? wantedFirm : null;
  if (firm && !FIRMS.some((item) => item.code === firm)) throw new ApiError(400, "Unknown firm.");

  const rows = await reportRows(client, firm);
  const report = computeMisReport({ ...rows, ...range, today, who: params.get("who") || null });
  return {
    ...report,
    periods: PERIODS,
    people: rows.people,
    // What a clicked number opens. Names are here because the screen lists them;
    // `report.view` at `all` already reads every case.
    cases: rows.cases.map((c) => ({
      id: c.id,
      caseNumber: c.caseNumber,
      customerName: c.customerName,
      stage: c.stage,
      ownerName: c.ownerName,
      leadOn: c.leadOn,
      amount: c.amount,
    })),
  };
}

/**
 * The latest MIS sync run and the warning, if any, managers should see (ADR-047).
 * Same audience as the reports: whoever may see whole-office figures.
 */
export async function misSyncStatus(client: Queryable, actor: Actor) {
  if (!can(actor, "report.view", "all")) return { warning: null };
  const { rows } = await client.query<{ finished_at: Date; outcome: SyncRun["outcome"]; issues: string[] }>(
    `select finished_at, outcome, issues from mis_sync_run order by finished_at desc limit 1`,
  );
  const row = rows[0];
  const latest = row ? { finishedAt: row.finished_at.toISOString(), outcome: row.outcome, issues: row.issues } : null;
  return { latest, warning: syncWarning(latest, new Date().toISOString()) };
}
