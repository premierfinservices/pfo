/**
 * What the MIS's words mean in PFO (ADR-046). Pure: no database, no file.
 * Backend/mis-sync.ts does the writing. An unknown value maps to null, and the
 * sync reports it and leaves that record alone rather than guessing.
 */

import type { CaseStage, LostReason } from "../case/stages.js";
import type { SubmissionStatus } from "../submissions/status.js";

export interface MisCustomer {
  readonly caseId: string;
  readonly leadDate: string | null;
  readonly name: string;
  readonly mobile: string;
  readonly place: string | null;
  readonly leadSource: string | null;
  readonly loanType: string | null;
  readonly otherLoanDescription: string | null;
  readonly employmentType: string | null;
  readonly amount: number | null;
  readonly assignedId: string | null;
  readonly originalId: string | null;
  readonly documentStatus: string | null;
  readonly caseStatus: string | null;
  readonly notes: string | null;
  readonly closureDate: string | null;
  readonly closureReason: string | null;
  readonly location: string | null;
  readonly createdAt: string | null;
}

export interface MisApplication {
  readonly applicationId: string;
  readonly caseId: string;
  readonly lender: string | null;
  readonly loginDate: string | null;
  readonly reference: string | null;
  readonly loginEmployeeId: string | null;
  readonly status: string | null;
  readonly amountApproved: number | null;
  readonly sanctionAmount: number | null;
  readonly sanctionDate: string | null;
  readonly acceptanceStatus: string | null;
  readonly acceptanceDate: string | null;
  readonly disbursementAmount: number | null;
  readonly disbursementDate: string | null;
  readonly rejectionReason: string | null;
  readonly notes: string | null;
  readonly banker: string | null;
  readonly createdAt: string | null;
}

export interface MisFollowup {
  readonly followupId: string;
  readonly caseId: string;
  readonly applicationId: string | null;
  readonly activityAt: string | null;
  readonly activityType: string | null;
  readonly notes: string | null;
  readonly nextAction: string | null;
  readonly dueDate: string | null;
  readonly responsibleId: string | null;
  readonly status: string | null;
  readonly completionDate: string | null;
}

export interface MisChange {
  readonly recordId: string;
  readonly field: string;
  readonly newValue: string | null;
  readonly at: string;
}

export interface MisEmployee {
  readonly id: string;
  readonly name: string;
}

export interface MisData {
  readonly customers: readonly MisCustomer[];
  readonly applications: readonly MisApplication[];
  readonly followups: readonly MisFollowup[];
  readonly changes: readonly MisChange[];
  readonly employees: readonly MisEmployee[];
}

/** Tarun, 2 Nov 2026: cases with a lead date from here on, and only live ones. */
export const MIS_SYNC_FROM = "2026-10-13";

/** Tarun, 2 Nov 2026: stays in the MIS, never comes to PFO. */
export const MIS_SYNC_EXCLUDED: ReadonlySet<string> = new Set(["MCM-0027"]);

export function inSyncScope(customer: MisCustomer): boolean {
  if (MIS_SYNC_EXCLUDED.has(customer.caseId)) return false;
  return customer.location === "Active" && customer.leadDate !== null && customer.leadDate.slice(0, 10) >= MIS_SYNC_FROM;
}

const STAGES: Readonly<Record<string, CaseStage>> = {
  "Documents Pending": "documents_pending",
  "Documents Collected": "documents_collected",
  "Login Completed": "login_completed",
  "Query Raised by Bank": "query_raised",
  Approved: "approved",
  "Sanction Accepted": "sanction_accepted",
  Disbursed: "disbursed",
  Rejected: "rejected",
};

export const misStage = (status: string | null): CaseStage | null => (status && STAGES[status]) || null;

const DOCUMENT_STATUSES: Readonly<Record<string, string>> = {
  "Not Assessed": "not_assessed",
  Pending: "pending",
  "Partially Collected": "partial",
  Complete: "complete",
};

export const misDocumentStatus = (status: string | null): string | null => (status && DOCUMENT_STATUSES[status]) || null;

const LENDER_STATUSES: Readonly<Record<string, SubmissionStatus>> = {
  "Not Logged In": "not_submitted",
  "Not Eligible (Pre-check)": "not_eligible_precheck",
  "Login Completed": "login_completed",
  "Under Review": "under_process",
  "Query Raised by Bank": "query_raised",
  Approved: "eligibility_received",
  Sanctioned: "sanctioned",
  "Sanction Accepted": "sanction_accepted",
  Disbursed: "disbursed",
  Rejected: "rejected",
  "Withdrawn / Closed": "withdrawn",
};

export const misLenderStatus = (status: string | null): SubmissionStatus | null =>
  (status && LENDER_STATUSES[status]) || null;

/** How an archived case ends here. A disbursed case closes; anything else is lost. */
export function misClosure(reason: string | null): { readonly stage: "closed" } | { readonly stage: "lost"; readonly lostReason: LostReason } {
  switch (reason) {
    case "Disbursed: case complete":
      return { stage: "closed" };
    case "Customer not interested":
      return { stage: "lost", lostReason: "not_interested" };
    case "Not eligible / rejected by all lenders":
      return { stage: "lost", lostReason: "customer_not_eligible" };
    case "Customer unreachable":
      return { stage: "lost", lostReason: "unreachable" };
    case "Documents not provided":
      return { stage: "lost", lostReason: "documents_unavailable" };
    case "Duplicate record":
      return { stage: "lost", lostReason: "duplicate_case" };
    default:
      return { stage: "lost", lostReason: "other" };
  }
}

/** PRD/Intake and Work Engine.md, Part 2A: the MIS name, and the name PFO keeps. */
const LENDER_ALIASES: Readonly<Record<string, string>> = {
  "SMFG India Credit - Fullerton India": "SMFG India Credit",
  "Aditya Birla Capital": "Aditya Birla Finance",
  "The Coimbatore District Central Co-operative Bank": "Coimbatore District Central Co-operative Bank",
  "Home First Finance": "Home First Finance Company India",
  "Aptus Value Housing Finance": "Aptus Value Housing Finance India",
  "India Shelter Finance": "India Shelter Finance Corporation",
};

export const pfoLenderName = (misName: string): string => LENDER_ALIASES[misName] ?? misName;

/** The work engine's task kind for a follow-up's Next Action; null if it has none. */
export function misTaskKind(nextAction: string | null): string | null {
  if (nextAction === "Collect documents") return "collect_documents";
  if (nextAction === "Collect remaining documents") return "collect_remaining_documents";
  if (nextAction === "Send file to lenders") return "send_to_lenders";
  if (nextAction?.startsWith("Resolve query")) return "resolve_query";
  if (nextAction?.startsWith("Confirm login")) return "confirm_login";
  return null;
}

/**
 * Which PFO login an MIS employee is: the full name, else the first word as the
 * username (CHINNA THAMBI is `chinna`). Anything else is unmapped, never a guess.
 */
export function matchEmployee(
  misName: string,
  users: readonly { readonly id: string; readonly username: string; readonly fullName: string | null }[],
): string | null {
  const wanted = misName.trim().toUpperCase();
  const byName = users.filter((user) => user.fullName?.trim().toUpperCase() === wanted);
  if (byName.length === 1) return byName[0]!.id;
  const compact = wanted.replace(/\s+/g, "").toLowerCase();
  const first = wanted.split(/\s+/)[0]!.toLowerCase();
  const byUsername = users.filter((user) => user.username === compact || user.username === first);
  return byUsername.length === 1 ? byUsername[0]!.id : null;
}

/** A naive MIS date and time is Indian time. Null stays null. */
export function istInstant(value: string | null): string | null {
  if (!value) return null;
  const withTime = value.length === 10 ? `${value}T00:00:00` : value;
  return new Date(`${withTime}+05:30`).toISOString();
}

export const dateOnly = (value: string | null): string | null => (value ? value.slice(0, 10) : null);

/** When the application was rejected: the MIS Change Log knows; the row does not. */
export function rejectedAt(application: MisApplication, changes: readonly MisChange[]): string | null {
  const found = changes
    .filter((c) => c.recordId === application.applicationId && c.field === "Lender Status" && c.newValue === "Rejected")
    .map((c) => c.at)
    .sort();
  return found[found.length - 1] ?? application.createdAt;
}
