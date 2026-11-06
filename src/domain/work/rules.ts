/**
 * What each action on a case leaves to do next: the rule table in
 * PRD/Intake and Work Engine.md, Part 4 (ADR-040).
 *
 * Pure. An event goes in; which open tasks to close and which task to raise
 * come out. Screens never decide this.
 */

export type TaskKind =
  | "collect_documents"
  | "collect_remaining_documents"
  | "check_eligibility"
  | "send_to_lenders"
  | "confirm_login"
  | "resolve_query"
  | "present_offer";

export type WorkEvent =
  | { readonly type: "case_logged"; readonly due: string }
  | { readonly type: "documents_none"; readonly due: string }
  | { readonly type: "documents_part" }
  | { readonly type: "documents_all"; readonly eligible: boolean }
  | { readonly type: "eligible"; readonly documentsComplete: boolean; readonly due?: string }
  | { readonly type: "not_eligible" }
  | { readonly type: "dropped" }
  | { readonly type: "sent_to_lender"; readonly bank: string; readonly submissionId: string }
  | { readonly type: "login_completed"; readonly submissionId: string }
  | { readonly type: "query_raised"; readonly bank: string; readonly submissionId: string }
  | { readonly type: "query_answered"; readonly submissionId: string }
  | { readonly type: "sanctioned"; readonly bank: string; readonly submissionId: string }
  | { readonly type: "application_finished"; readonly submissionId: string }
  /** Every lender the file went to has turned it down or been withdrawn. */
  | { readonly type: "no_lender_left" };

export type Assignee = "owner" | "actor" | "login_employee";

export interface PlannedTask {
  readonly kind: TaskKind;
  readonly title: string;
  /** An explicit date (yyyy-mm-dd) or a number of days from today. */
  readonly due: string | number;
  readonly assignee: Assignee;
  readonly submissionId?: string;
}

export interface WorkPlan {
  /** `case`: open tasks not tied to one lender. `all`: every open task. */
  readonly closeScope?: "case" | "all";
  readonly closeKinds?: readonly TaskKind[];
  readonly closeSubmissionId?: string;
  readonly create?: PlannedTask;
}

const SEND: PlannedTask = {
  kind: "send_to_lenders",
  title: "Send file to lenders",
  due: 0,
  assignee: "actor",
};

const CHECK: PlannedTask = {
  kind: "check_eligibility",
  title: "Check eligibility",
  due: 0,
  assignee: "owner",
};

export function workFor(event: WorkEvent): WorkPlan {
  switch (event.type) {
    case "case_logged":
      return {
        create: { kind: "collect_documents", title: "Collect documents", due: event.due, assignee: "owner" },
      };
    case "documents_none":
      return {
        closeScope: "case",
        create: { kind: "collect_documents", title: "Collect documents", due: event.due, assignee: "owner" },
      };
    case "documents_part":
      return { closeScope: "case", create: CHECK };
    case "documents_all":
      return { closeScope: "case", create: event.eligible ? SEND : CHECK };
    case "eligible":
      return {
        closeKinds: ["check_eligibility"],
        create: event.documentsComplete
          ? SEND
          : {
              kind: "collect_remaining_documents",
              title: "Collect remaining documents",
              due: event.due ?? 0,
              assignee: "owner",
            },
      };
    case "not_eligible":
    case "dropped":
      return { closeScope: "all" };
    case "sent_to_lender":
      // The file has gone: collecting and checking are over, whatever was left
      // open. Anything still missing comes back as the lender's query.
      return {
        closeKinds: ["collect_documents", "collect_remaining_documents", "check_eligibility", "send_to_lenders"],
        create: {
          kind: "confirm_login",
          title: `Confirm login with ${event.bank}`,
          due: 2,
          assignee: "actor",
          submissionId: event.submissionId,
        },
      };
    case "login_completed":
      return { closeKinds: ["confirm_login"], closeSubmissionId: event.submissionId };
    case "query_raised":
      return {
        create: {
          kind: "resolve_query",
          title: `Resolve query from ${event.bank}`,
          due: 2,
          assignee: "login_employee",
          submissionId: event.submissionId,
        },
      };
    case "query_answered":
      return { closeKinds: ["resolve_query"], closeSubmissionId: event.submissionId };
    case "sanctioned":
      return {
        create: {
          kind: "present_offer",
          title: `Present the offer from ${event.bank} to the customer`,
          due: 0,
          assignee: "owner",
          submissionId: event.submissionId,
        },
      };
    case "application_finished":
      return { closeSubmissionId: event.submissionId };
    case "no_lender_left":
      // Sending closed collection; with no lender left, the case still needs a next step.
      return { create: SEND };
  }
}

// ---------------------------------------------------------------------------
// Guidance: the one fixed "Next:" line on every case screen
// ---------------------------------------------------------------------------

export interface OpenTaskFacts {
  readonly title: string;
  readonly dueOn: string | null;
  readonly assigneeName: string;
}

export interface GuidanceFacts {
  readonly stage: string;
  /** Earliest due first. */
  readonly openTasks: readonly OpenTaskFacts[];
  readonly lostReason?: string | null;
  readonly waitingOnBank?: string | null;
}

/** "2 Nov" */
export function shortDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return year && month && day ? `${day} ${names[month - 1]}` : iso;
}

/** The sentence under the case header. Always one line, always current. */
export function nextStepLine(facts: GuidanceFacts): string {
  if (facts.stage === "lost") {
    return facts.lostReason === "customer_not_eligible"
      ? "Case closed as not eligible. Nothing further. Reopen if this changes."
      : "Case closed. Nothing further. Reopen if this changes.";
  }
  if (facts.stage === "closed") return "Case closed. Nothing further.";

  const task = facts.openTasks[0];
  if (task) {
    const due = task.dueOn ? ` Due ${shortDate(task.dueOn)}.` : "";
    return `Next: ${task.title}.${due} ${task.assigneeName}.`;
  }

  switch (facts.stage) {
    case "eligibility_check":
      return "Next: answer whether this case is eligible.";
    case "documents_collected":
      return "Next: send the file to lenders. Use the Send to lenders tab.";
    case "approved":
      return "Next: record the sanction, or update the application when you hear from the bank.";
    case "sanction_accepted":
      return "Next: record the disbursement when it happens.";
    case "disbursed":
      return "Disbursement recorded. Next: raise the invoice.";
    case "rejected":
      return "Marked rejected. Send to another lender, or close the case.";
    case "login_completed":
    case "query_raised":
      return `Waiting on ${facts.waitingOnBank ?? "the bank"}. Update the application when you hear from them.`;
    default:
      return "No open action on this case. Choose what happens next.";
  }
}
