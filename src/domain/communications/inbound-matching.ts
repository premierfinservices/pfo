/**
 * Which case (and which banker) an inbound email is a reply to.
 *
 * Pure decision logic, no I/O — the same shape as recipients.ts. The caller
 * (Backend/inbound-mail.ts) fetches the candidate rows from Postgres and
 * hands them here; this module only decides among them.
 *
 * TWO SIGNALS, IN ORDER OF TRUST:
 *
 *   1. Same Gmail thread as an email PFO sent. Gmail groups replies into
 *      threads on its own, which is more reliable than parsing
 *      In-Reply-To/References by hand — this is the strongest signal
 *      available and, when present, is trusted over sender address alone
 *      (a banker could reply from a personal address inside the same
 *      thread; the thread still identifies the right case).
 *
 *   2. Sender address matches a catalogued banker's work email
 *      (bank_contact.work_email), falling back to that banker's most
 *      recently submitted-to case. Weaker: a banker who works several live
 *      cases and starts a fresh thread (rather than replying) is only
 *      resolvable this way, and "most recent" is a guess when they email
 *      about an older one.
 *
 * NO MATCH ON EITHER is a valid outcome, not an error — an inbound email
 * from an unrecognised address, or a reply Gmail did not thread, has nowhere
 * automated to attach to and belongs in the review queue (Backend/
 * inbound-mail.ts), never silently discarded.
 */

import { normaliseEmail } from "../submissions/recipients.js";

export interface OutboundThreadMatch {
  readonly gmailThreadId: string;
  readonly loanCaseId: string;
  readonly bankContactId: string | null;
}

export interface BankContactCaseCandidate {
  readonly bankContactId: string;
  readonly workEmail: string;
  readonly loanCaseId: string;
  /** ISO timestamp of the most recent submission to this banker on this
   * case — used only to break ties when the same banker has more than one
   * open case (pick the one most recently sent to). */
  readonly lastSubmittedAt: string;
}

export type InboundMatchResult =
  | { readonly matchedBy: "thread"; readonly loanCaseId: string; readonly bankContactId: string | null }
  | { readonly matchedBy: "sender"; readonly loanCaseId: string; readonly bankContactId: string }
  | { readonly matchedBy: "none" };

export function matchInboundEmail(input: {
  readonly fromAddress: string;
  readonly gmailThreadId: string;
  readonly outboundThreads: readonly OutboundThreadMatch[];
  readonly bankContactCandidates: readonly BankContactCaseCandidate[];
}): InboundMatchResult {
  const thread = input.outboundThreads.find((candidate) => candidate.gmailThreadId === input.gmailThreadId);
  if (thread) {
    return { matchedBy: "thread", loanCaseId: thread.loanCaseId, bankContactId: thread.bankContactId };
  }

  const sender = normaliseEmail(input.fromAddress);
  const senderMatches = input.bankContactCandidates.filter(
    (candidate) => normaliseEmail(candidate.workEmail) === sender,
  );
  if (senderMatches.length === 0) {
    return { matchedBy: "none" };
  }

  const mostRecent = senderMatches.reduce((best, candidate) =>
    candidate.lastSubmittedAt > best.lastSubmittedAt ? candidate : best,
  );
  return { matchedBy: "sender", loanCaseId: mostRecent.loanCaseId, bankContactId: mostRecent.bankContactId };
}
