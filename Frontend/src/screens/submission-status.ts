/** How an application's lender status reads on screen. Moved from the retired Banks tab (ADR-048). */

import type { SubmissionStatus } from "../api/types.js";

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  not_submitted: "Not Logged In",
  submitted: "Not Logged In",
  not_eligible_precheck: "Not Eligible (Pre-check)",
  login_completed: "Login Completed",
  under_process: "Under Review",
  query_raised: "Query Raised by Bank",
  eligibility_received: "Approved",
  sanctioned: "Sanctioned",
  sanction_accepted: "Sanction Accepted",
  rejected: "Rejected",
  withdrawn: "Withdrawn / Closed",
  disbursed: "Disbursed",
};

export function statusTone(status: SubmissionStatus): "neutral" | "info" | "warn" | "good" | "bad" {
  switch (status) {
    case "not_submitted":
      return "neutral";
    case "rejected":
      return "bad";
    case "withdrawn":
      return "neutral";
    case "sanctioned":
    case "disbursed":
      return "good";
    default:
      return "info";
  }
}
