/**
 * Case stage transitions and their guards.
 *
 * Source of truth: PRD/Intake and Work Engine.md, Part 1 (ADR-040).
 *
 * This module is pure. It decides whether a move is legal and why not; it does
 * not persist anything, does not know about the database, and does not import
 * from the UI.
 */

import {
  CASE_STAGE_PROGRESSION,
  type CaseStage,
  type LostReason,
  isTerminalStage,
  stageOrdinal,
} from "./stages.js";

/**
 * `system` transitions are consequences of a lender update, so the two axes
 * cannot drift apart (ADR-019). `user` transitions are a person's choice.
 */
export type TransitionActor = "user" | "system";

/** The facts a guard needs, as a flat snapshot so guards stay testable. */
export interface CaseSnapshot {
  readonly stage: CaseStage;
  /** The furthest case stage this case's lender applications justify. */
  readonly justifiedStage: CaseStage | null;
  /** Set once close-out is complete. */
  readonly isInvoiceRaised: boolean;
  /** The stage a lost case was in when it was lost, used to restore on reopen. */
  readonly stageBeforeLost: CaseStage | null;
}

export interface TransitionRequest {
  readonly to: CaseStage;
  readonly actor: TransitionActor;
  readonly lostReason?: LostReason;
}

export type TransitionOutcome =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const ALLOWED: TransitionOutcome = { allowed: true };

function deny(reason: string): TransitionOutcome {
  return { allowed: false, reason };
}

/** The moves a person makes. Lender updates are not here: see `systemStageFor`. */
const USER_MOVES: readonly { readonly from: CaseStage; readonly to: CaseStage }[] = [
  { from: "documents_pending", to: "eligibility_check" },
  { from: "documents_pending", to: "documents_collected" },
  { from: "eligibility_check", to: "documents_pending" },
  { from: "eligibility_check", to: "documents_collected" },
  { from: "documents_collected", to: "eligibility_check" },
  { from: "documents_collected", to: "documents_pending" },
  { from: "disbursed", to: "closed" },
  ...CASE_STAGE_PROGRESSION.filter((stage) => stage !== "disbursed").map((from) => ({
    from: from as CaseStage,
    to: "rejected" as CaseStage,
  })),
];

/** The stages a person can choose from here. */
export function userSelectableStages(from: CaseStage): readonly CaseStage[] {
  return USER_MOVES.filter((move) => move.from === from).map((move) => move.to);
}

/** Decide whether a case may move as requested, with a reason when it may not. */
export function evaluateTransition(
  snapshot: CaseSnapshot,
  request: TransitionRequest,
): TransitionOutcome {
  if (snapshot.stage === request.to) {
    return deny(`The case is already at ${request.to}.`);
  }
  if (request.to === "lost") return evaluateLoss(snapshot, request);
  if (snapshot.stage === "lost") return evaluateReopen(snapshot, request);
  if (snapshot.stage === "closed") {
    return deny("A closed case cannot be moved. Closed is terminal.");
  }

  if (request.actor === "system") {
    return systemStageFor(snapshot) === request.to
      ? ALLOWED
      : deny(`Nothing on this case's applications moves it to ${request.to}.`);
  }

  const isMove = USER_MOVES.some((move) => move.from === snapshot.stage && move.to === request.to);
  if (!isMove) return deny(`A case cannot move from ${snapshot.stage} to ${request.to}.`);

  if (request.to === "closed" && !snapshot.isInvoiceRaised) {
    return deny("Close-out is incomplete: the invoice has not been raised.");
  }
  return ALLOWED;
}

function evaluateLoss(snapshot: CaseSnapshot, request: TransitionRequest): TransitionOutcome {
  if (isTerminalStage(snapshot.stage)) {
    return deny(`A ${snapshot.stage} case cannot be marked lost.`);
  }
  if (request.actor !== "user") {
    return deny("Only a person can mark a case lost. The system never gives up on a case.");
  }
  if (!request.lostReason) {
    return deny("A reason is required when marking a case lost.");
  }
  return ALLOWED;
}

/** Reopening restores the stage the case was lost from. */
function evaluateReopen(snapshot: CaseSnapshot, request: TransitionRequest): TransitionOutcome {
  if (request.actor !== "user") return deny("Only a person can reopen a case.");
  if (snapshot.stageBeforeLost === null) {
    return deny("The stage this case was lost from is unknown, so it cannot be restored.");
  }
  if (request.to !== snapshot.stageBeforeLost) {
    return deny(
      `A reopened case returns to ${snapshot.stageBeforeLost}, the stage it was lost from.`,
    );
  }
  return ALLOWED;
}

/**
 * Where lender updates move this case, or `null` if they do not.
 *
 * Forward only, as in the MIS: a case at Approved stays there when another
 * lender raises a query. `closed`, `lost` and `rejected` have no position, so
 * they are never moved by a lender update.
 */
export function systemStageFor(snapshot: CaseSnapshot): CaseStage | null {
  if (snapshot.justifiedStage === null) return null;
  const current = stageOrdinal(snapshot.stage);
  const target = stageOrdinal(snapshot.justifiedStage);
  if (current === null || target === null || target <= current) return null;
  return snapshot.justifiedStage;
}

/** The case stage one application status justifies. */
export function stageJustifiedBy(status: string): CaseStage | null {
  switch (status) {
    case "login_completed":
    case "under_process":
      return "login_completed";
    case "query_raised":
      return "query_raised";
    case "eligibility_received":
    case "sanctioned":
      return "approved";
    case "sanction_accepted":
      return "sanction_accepted";
    case "disbursed":
      return "disbursed";
    default:
      return null;
  }
}

/** The furthest stage any of a case's applications justifies. */
export function highestJustifiedStage(statuses: readonly string[]): CaseStage | null {
  let best: CaseStage | null = null;
  for (const status of statuses) {
    const stage = stageJustifiedBy(status);
    if (stage === null) continue;
    if (best === null || (stageOrdinal(stage) ?? -1) > (stageOrdinal(best) ?? -1)) best = stage;
  }
  return best;
}
