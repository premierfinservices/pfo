/**
 * The one place a lender update moves a case's stage.
 *
 * `systemStageFor` (`@domain/case/transitions.js`) decides; this is only the
 * Postgres wiring: read the applications, write one row and one event. Forward
 * only, as in the MIS (ADR-040).
 */

import { highestJustifiedStage, systemStageFor } from "@domain/case/transitions.js";
import type { CaseStage } from "@domain/case/stages.js";

import type { Queryable } from "./db.js";
import { recordSystemCaseEvent } from "./events.js";

export interface CauseRef {
  readonly entityType: string;
  readonly entityId: string;
}

/**
 * Serialise every Phase 5 outcome mutation on one case — status changes,
 * offer recording and acceptance, query raise/answer — the same
 * `pg_advisory_xact_lock` idiom Phase 3 established for sending
 * (`Backend/submissions.ts`'s `lockSubmissionForSending`), keyed on the
 * *case* rather than the submission because BR-025's cascade (accepting one
 * offer withdraws every other live submission on the case) touches sibling
 * rows: two employees accepting competing offers on the same case at once, or
 * one employee double-clicking Accept, must not both read the case's
 * facts before either has committed its outcome. A different salt (`1`) from
 * the submission-send lock's (`0`) — they guard unrelated concerns and must
 * not queue behind each other.
 */
export async function lockCaseForOutcomeMutation(client: Queryable, caseId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 1))`, [caseId]);
}

/** The furthest case stage this case's applications justify. */
export async function justifiedStageOf(client: Queryable, caseId: string): Promise<CaseStage | null> {
  const { rows } = await client.query<{ status: string }>(
    `select status::text from submission where case_id = $1`,
    [caseId],
  );
  return highestJustifiedStage(rows.map((row) => row.status));
}

/**
 * Move a case to where its applications now put it, then return the stage it
 * ended at. A case on hold does not move out from under whoever held it.
 */
export async function advanceCaseStage(
  client: Queryable,
  caseId: string,
  causedBy: CauseRef,
): Promise<CaseStage> {
  const { rows } = await client.query<{
    stage: CaseStage;
    is_on_hold: boolean;
    is_invoice_raised: boolean;
    stage_before_lost: CaseStage | null;
  }>(
    `select stage, is_on_hold, is_invoice_raised, stage_before_lost from loan_case where id = $1`,
    [caseId],
  );
  const row = rows[0];
  if (!row) throw new Error(`No such case: ${caseId}`);
  if (row.is_on_hold) return row.stage;

  const next = systemStageFor({
    stage: row.stage,
    justifiedStage: await justifiedStageOf(client, caseId),
    isInvoiceRaised: row.is_invoice_raised,
    stageBeforeLost: row.stage_before_lost,
  });
  if (next === null) return row.stage;

  await client.query(`update loan_case set stage = $1 where id = $2`, [next, caseId]);
  await recordSystemCaseEvent(client, {
    caseId,
    eventType: "case.stage_changed",
    payloadBefore: { stage: row.stage },
    payloadAfter: { stage: next },
    causedByEntityType: causedBy.entityType,
    causedByEntityId: causedBy.entityId,
  });
  return next;
}
