/**
 * Orchestrates one inbound bank email once mail-inbound.mjs has fetched and
 * stored it: dedupe, match it to a case, classify its attachments, and
 * either auto-attach a document or route it to the review queue.
 *
 * Lives in the api process (not the mail process) because everything here
 * needs the domain layer and an authenticated Postgres transaction — RLS's
 * tier-B policies (0033) refuse every operational table without a real
 * app.current_user_id(), which mail-inbound.mjs deliberately does not have.
 * The one entry point, `handleInboundEmail`, is reached only via the
 * loopback-only, shared-secret-guarded `/api/internal/inbound-email` route
 * in api-server.ts.
 */

import { matchInboundEmail, type BankContactCaseCandidate, type OutboundThreadMatch } from "@domain/communications/inbound-matching.js";
import type { CandidateDocumentType } from "@domain/communications/inbound-classification.js";

import type { Queryable } from "./db.js";
import type { Actor } from "./authorize.js";
import { loadOverrides } from "./users.js";
import { listCaseRequirements, uploadDocument } from "./documents.js";
import { getObjectWithContentType } from "./storage-client.js";
import { classifyAttachment } from "./inbound-classification-client.js";

/**
 * The fixed, well-known id seeded by Database/migrations/0042 — see that
 * migration for why this actor exists, cannot log in, and holds exactly one
 * permission (document.upload, scope all) rather than a role.
 */
export const SYSTEM_ACTOR_USER_ID = "00000000-0000-0000-0000-0000000000f1";

export async function loadSystemActor(client: Queryable): Promise<Actor> {
  const { rows } = await client.query<{ auth_identity_id: string }>(
    `select auth_identity_id from app_user where id = $1`,
    [SYSTEM_ACTOR_USER_ID],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("The PFO Automation system actor is missing — has migration 0042 been run?");
  }
  return {
    userId: SYSTEM_ACTOR_USER_ID,
    authIdentityId: row.auth_identity_id,
    roles: [],
    overrides: await loadOverrides(client, SYSTEM_ACTOR_USER_ID),
  };
}

const AUTO_ATTACH_THRESHOLD = Number(process.env.PFO_INBOUND_AUTO_ATTACH_THRESHOLD ?? 0.85);

// No PFO_INBOUND_AUTO_VERIFY flag: auto-verifying a document would need the
// system actor to hold document.verify, which Database/migrations/0042
// deliberately did not grant it (least privilege — this actor can attach a
// document to the wrong requirement at worst, never mark one satisfied
// sight-unseen). Every auto-attached document lands at `received`, exactly
// like a human upload, pending human verification (BR-032). Turning on
// auto-verify later is a real, separate decision — a new migration granting
// the permission plus new code — not a flag flip on inert code.

export interface InboundAttachmentInput {
  readonly index: number;
  readonly storagePath: string;
  readonly contentType: string;
  readonly fileName: string;
}

export interface InboundEmailInput {
  readonly gmailMessageId: string;
  readonly gmailThreadId: string;
  readonly fromAddress: string;
  readonly subject: string | null;
  readonly receivedAt: string;
  readonly rawStoragePath: string;
  readonly attachments: readonly InboundAttachmentInput[];
}

async function loadMatchCandidates(
  client: Queryable,
  gmailThreadId: string,
): Promise<{ outboundThreads: OutboundThreadMatch[]; bankContactCandidates: BankContactCaseCandidate[] }> {
  const threadRows = await client.query<{
    gmail_thread_id: string;
    case_id: string;
    bank_contact_id: string | null;
  }>(
    `select spe.gmail_thread_id, s.case_id, s.bank_contact_id
       from submission_package_email spe
       join submission_package sp on sp.id = spe.submission_package_id
       join submission s on s.id = sp.submission_id
      where spe.gmail_thread_id = $1`,
    [gmailThreadId],
  );

  const senderRows = await client.query<{
    bank_contact_id: string;
    work_email: string;
    case_id: string;
    last_submitted_at: string;
  }>(
    `select s.bank_contact_id, bc.work_email, s.case_id, max(sp.initiated_at) as last_submitted_at
       from submission s
       join bank_contact bc on bc.id = s.bank_contact_id
       join submission_package sp on sp.submission_id = s.id
      where bc.work_email is not null
      group by s.bank_contact_id, bc.work_email, s.case_id`,
  );

  return {
    outboundThreads: threadRows.rows.map((row) => ({
      gmailThreadId: row.gmail_thread_id,
      loanCaseId: row.case_id,
      bankContactId: row.bank_contact_id,
    })),
    bankContactCandidates: senderRows.rows.map((row) => ({
      bankContactId: row.bank_contact_id,
      workEmail: row.work_email,
      loanCaseId: row.case_id,
      lastSubmittedAt: row.last_submitted_at,
    })),
  };
}

async function candidateDocumentTypes(client: Queryable, actor: Actor, caseId: string): Promise<CandidateDocumentType[]> {
  const { requirements } = await listCaseRequirements(client, actor, caseId);
  return requirements
    .filter((requirement) => requirement.status !== "not_applicable" && requirement.status !== "verified")
    .map((requirement) => ({ code: requirement.documentTypeCode, name: requirement.documentTypeCode }));
}

async function queueForReview(
  client: Queryable,
  inboundEmailId: string,
  attachmentIndex: number,
  reason: string,
  classificationSnapshot: unknown,
): Promise<void> {
  await client.query(
    `insert into inbound_email_review_queue
       (inbound_email_id, attachment_index, reason, classification_snapshot)
     values ($1, $2, $3, $4)`,
    [inboundEmailId, attachmentIndex, reason, classificationSnapshot ? JSON.stringify(classificationSnapshot) : null],
  );
}

async function recordAudit(
  client: Queryable,
  input: {
    inboundEmailId: string;
    attachmentIndex: number;
    documentTypeCode: string | null;
    confidence: number;
    rawModelResponse: unknown;
    decision: "auto_attached" | "queued_for_review" | "attach_failed";
    resultingDocumentId: string | null;
  },
): Promise<void> {
  await client.query(
    `insert into inbound_classification_audit
       (inbound_email_id, attachment_index, document_type_code, confidence, raw_model_response, decision, resulting_document_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.inboundEmailId,
      input.attachmentIndex,
      input.documentTypeCode,
      input.confidence,
      JSON.stringify(input.rawModelResponse ?? null),
      input.decision,
      input.resultingDocumentId,
    ],
  );
}

/**
 * The one entry point. Returns `{ inserted: false }` when this message was
 * already seen (dedupe by gmail_message_id — the real idempotency guarantee,
 * per Database/migrations/0039), in which case nothing else runs.
 */
export async function handleInboundEmail(
  client: Queryable,
  input: InboundEmailInput,
): Promise<{ inserted: boolean }> {
  const { rows: insertedRows } = await client.query<{ id: string }>(
    `insert into inbound_email
       (gmail_message_id, gmail_thread_id, from_address, subject, received_at, raw_storage_path)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (gmail_message_id) do nothing
     returning id`,
    [input.gmailMessageId, input.gmailThreadId, input.fromAddress, input.subject, input.receivedAt, input.rawStoragePath],
  );
  const inboundEmailId = insertedRows[0]?.id;
  if (!inboundEmailId) {
    return { inserted: false };
  }

  const { outboundThreads, bankContactCandidates } = await loadMatchCandidates(client, input.gmailThreadId);
  const match = matchInboundEmail({
    fromAddress: input.fromAddress,
    gmailThreadId: input.gmailThreadId,
    outboundThreads,
    bankContactCandidates,
  });

  if (match.matchedBy === "none") {
    await client.query(`update inbound_email set status = 'unmatched' where id = $1`, [inboundEmailId]);
    for (const attachment of input.attachments) {
      await queueForReview(client, inboundEmailId, attachment.index, "no_case_match", null);
    }
    return { inserted: true };
  }

  await client.query(
    `update inbound_email set status = 'matched', matched_bank_contact_id = $2, matched_loan_case_id = $3 where id = $1`,
    [inboundEmailId, match.bankContactId, match.loanCaseId],
  );

  const actor = await loadSystemActor(client);
  const candidates = await candidateDocumentTypes(client, actor, match.loanCaseId);

  for (const attachment of input.attachments) {
    let bytes: Uint8Array;
    try {
      const object = await getObjectWithContentType(attachment.storagePath);
      bytes = object.bytes;
    } catch (error) {
      await recordAudit(client, {
        inboundEmailId,
        attachmentIndex: attachment.index,
        documentTypeCode: null,
        confidence: 0,
        rawModelResponse: null,
        decision: "attach_failed",
        resultingDocumentId: null,
      });
      await queueForReview(client, inboundEmailId, attachment.index, "attach_failed", {
        error: error instanceof Error ? error.message : "could not read stored attachment",
      });
      continue;
    }

    const classification = await classifyAttachment({
      bytes,
      contentType: attachment.contentType,
      fileName: attachment.fileName,
      candidateDocumentTypes: candidates,
    });

    const matchedRequirement =
      classification.documentTypeCode &&
      (await listCaseRequirements(client, actor, match.loanCaseId)).requirements.find(
        (requirement) => requirement.documentTypeCode === classification.documentTypeCode,
      );

    if (classification.confidence >= AUTO_ATTACH_THRESHOLD && matchedRequirement) {
      try {
        const updated = await uploadDocument(client, actor, match.loanCaseId, matchedRequirement.id, {
          bytes,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
        });
        const resultingDocumentId = updated.document?.id ?? null;

        await recordAudit(client, {
          inboundEmailId,
          attachmentIndex: attachment.index,
          documentTypeCode: classification.documentTypeCode,
          confidence: classification.confidence,
          rawModelResponse: classification.rawModelResponse,
          decision: "auto_attached",
          resultingDocumentId,
        });
      } catch (error) {
        await recordAudit(client, {
          inboundEmailId,
          attachmentIndex: attachment.index,
          documentTypeCode: classification.documentTypeCode,
          confidence: classification.confidence,
          rawModelResponse: classification.rawModelResponse,
          decision: "attach_failed",
          resultingDocumentId: null,
        });
        await queueForReview(client, inboundEmailId, attachment.index, "attach_failed", classification);
      }
    } else {
      await recordAudit(client, {
        inboundEmailId,
        attachmentIndex: attachment.index,
        documentTypeCode: classification.documentTypeCode,
        confidence: classification.confidence,
        rawModelResponse: classification.rawModelResponse,
        decision: "queued_for_review",
        resultingDocumentId: null,
      });
      await queueForReview(
        client,
        inboundEmailId,
        attachment.index,
        matchedRequirement ? "low_confidence" : "no_requirement_match",
        classification,
      );
    }
  }

  await client.query(`update inbound_email set status = 'processed' where id = $1`, [inboundEmailId]);
  return { inserted: true };
}
