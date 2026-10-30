/**
 * Case lifecycle stages.
 *
 * Source of truth: PRD/Loan Lifecycle.md
 *
 * A case occupies exactly one stage at all times (BR-014). Stages describe the
 * *customer's journey* and are a different axis from submission status, which
 * describes one file at one bank (ADR-004).
 *
 * These constants are the single definition of the stage vocabulary. Database
 * migrations and UI both import from here rather than restating the list, so a
 * stage cannot be added in one place and forgotten in another.
 */

export const CASE_STAGES = [
  "documents_pending",
  "eligibility_check",
  "documents_collected",
  "login_completed",
  "query_raised",
  "approved",
  "sanction_accepted",
  "disbursed",
  "rejected",
  "closed",
  "lost",
] as const;

/**
 * Stages the first lifecycle had (ADR-040 retired them). Nothing writes these:
 * a database constraint refuses them. They stay in the type because the
 * prototype store and the retired document rules are still written in them.
 */
export const LEGACY_CASE_STAGES = [
  "new",
  "contacted",
  "appointment_fixed",
  "ready_for_submission",
  "submitted",
  "sanctioned",
] as const;

export type CaseStage = (typeof CASE_STAGES)[number] | (typeof LEGACY_CASE_STAGES)[number];

/** Stages from which a case never moves again, except by reopening from `lost`. */
export const TERMINAL_STAGES = ["closed", "lost"] as const satisfies readonly CaseStage[];

export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export function isTerminalStage(stage: CaseStage): stage is TerminalStage {
  return (TERMINAL_STAGES as readonly CaseStage[]).includes(stage);
}

/**
 * The ordered progression a case moves through, as the MIS orders it. Lender
 * updates only ever move a case forward along this.
 *
 * `closed` and `lost` are outcomes, not positions (ADR-023). So is `rejected`:
 * a person sets it, and no lender update moves a case out of it.
 */
export const CASE_STAGE_PROGRESSION = [
  "documents_pending",
  "eligibility_check",
  "documents_collected",
  "login_completed",
  "query_raised",
  "approved",
  "sanction_accepted",
  "disbursed",
] as const satisfies readonly CaseStage[];

/** The first lifecycle's order, for the prototype store and the retired rules. */
export const LEGACY_CASE_STAGE_PROGRESSION = [
  "new",
  "contacted",
  "appointment_fixed",
  "documents_pending",
  "ready_for_submission",
  "submitted",
  "sanctioned",
  "disbursed",
] as const satisfies readonly CaseStage[];

export type ProgressionStage =
  | (typeof CASE_STAGE_PROGRESSION)[number]
  | (typeof LEGACY_CASE_STAGE_PROGRESSION)[number];

/** Both lifecycles merged, so a requirement due "from documents_pending" reads
 * correctly against either. */
const ALL_STAGES_IN_ORDER: readonly CaseStage[] = [
  "new",
  "contacted",
  "appointment_fixed",
  "documents_pending",
  "eligibility_check",
  "documents_collected",
  "ready_for_submission",
  "login_completed",
  "submitted",
  "query_raised",
  "approved",
  "sanctioned",
  "sanction_accepted",
  "disbursed",
];

/**
 * How far along a stage sits, for comparisons such as "is this requirement due
 * yet?" and "would this move the case backward?".
 *
 * Returns `null` for `closed`, `lost` and `rejected`: they have no position,
 * and callers must handle that rather than receive a plausible-looking number.
 */
export function stageOrdinal(stage: CaseStage): number | null {
  const index = ALL_STAGES_IN_ORDER.indexOf(stage);
  return index === -1 ? null : index;
}

/**
 * Human-readable labels. Kept beside the values deliberately: a stage added
 * without a label is a compile error rather than a screen showing
 * "ready_for_submission" to a telecaller.
 */
export const CASE_STAGE_LABELS: Record<CaseStage, string> = {
  documents_pending: "Documents Pending",
  eligibility_check: "Eligibility Check",
  documents_collected: "Documents Collected",
  login_completed: "Login Completed",
  query_raised: "Query Raised by Bank",
  approved: "Approved",
  sanction_accepted: "Sanction Accepted",
  disbursed: "Disbursed",
  rejected: "Rejected",
  new: "New",
  contacted: "Contacted",
  appointment_fixed: "Appointment Fixed",
  ready_for_submission: "Ready for Submission",
  submitted: "Submitted",
  sanctioned: "Sanctioned",
  closed: "Closed",
  lost: "Lost",
};

/**
 * Reasons a case can be lost. Controlled list, not free text — a rejection
 * reason buried in a note is a fact the company cannot learn from
 * (Product Principles #11).
 */
export const LOST_REASONS = [
  "not_interested",
  "customer_not_eligible",
  "unreachable",
  "documents_unavailable",
  "duplicate_case",
  "other",
] as const;

/** Reasons the first lifecycle offered. Readable on old records, no longer offered. */
export type RetiredLostReason =
  | "rate_too_high"
  | "sanctioned_elsewhere"
  | "property_issue"
  | "customer_postponed";

export type LostReason = (typeof LOST_REASONS)[number] | RetiredLostReason;

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  not_interested: "Customer not interested",
  customer_not_eligible: "Not eligible / rejected by all lenders",
  unreachable: "Customer unreachable",
  documents_unavailable: "Documents not provided",
  duplicate_case: "Duplicate record",
  other: "Other (see notes)",
  rate_too_high: "Rate too high",
  sanctioned_elsewhere: "Sanctioned elsewhere",
  property_issue: "Property issue",
  customer_postponed: "Customer postponed",
};
