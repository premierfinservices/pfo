/**
 * What is this attachment, and does it satisfy something this case is
 * waiting for? — the pure, environment-agnostic half.
 *
 * THIS FILE DOES INVOLVE A MODEL, even though nothing here calls one
 * directly — the opposite of compose.ts's "No model involved" and for the
 * opposite reason: composing an outgoing email is a closed-form problem PFO
 * already has every fact for, while reading an arbitrary bank document and
 * deciding what it is is not something this codebase can compute from data
 * it already holds. The actual Claude API call lives in
 * Backend/inbound-classification-client.ts (fetch and base64 encoding are
 * not available the same way in every environment this domain layer runs
 * in); this file only builds the prompt and parses the response, so both are
 * unit-testable without a network call.
 *
 * WHAT THIS BUYS AND COSTS, stated plainly because ADR-016's reasoning for
 * refusing a model on eligibility does not disappear just because this is a
 * different decision: classification is not auditable the way compose.ts is
 * (the same attachment could classify differently on a retry), and the
 * attachment's image bytes leave this server and reach Anthropic's API,
 * which compose.ts's approach specifically avoids for outgoing mail. That
 * cost was accepted deliberately for this feature (there is no in-house OCR
 * in this codebase to avoid it with) — which is exactly why nothing here is
 * trusted blindly: every result carries a confidence score, and the caller
 * (Backend/inbound-mail.ts) cross-checks documentTypeCode against the case's
 * actual outstanding requirements before acting on it, never the model's
 * word alone.
 *
 * OUTPUT IS A CLAIM, NOT A FACT. Every field below is what the model said,
 * not what is true. A parse failure or an implausible response degrades to
 * confidence 0 — routed to human review — rather than throwing, so one bad
 * response degrades gracefully instead of taking down the inbound poll loop.
 */

export interface CandidateDocumentType {
  readonly code: string;
  readonly name: string;
}

export interface InboundClassificationResult {
  /** Best-guess match against the candidate document types, or null if the
   * model did not think any candidate fit. The caller re-validates this
   * against the case's live requirements — never trusted as-is. */
  readonly documentTypeCode: string | null;
  readonly confidence: number;
  readonly periodStart: string | undefined;
  readonly periodEnd: string | undefined;
  readonly extractedFields: Record<string, unknown>;
  readonly reasoning: string;
  /** The full API response, verbatim, for inbound_classification_audit. */
  readonly rawModelResponse: unknown;
}

export function zeroConfidenceResult(reasoning: string, rawModelResponse: unknown): InboundClassificationResult {
  return {
    documentTypeCode: null,
    confidence: 0,
    periodStart: undefined,
    periodEnd: undefined,
    extractedFields: {},
    reasoning,
    rawModelResponse,
  };
}

export function buildClassificationPrompt(candidateDocumentTypes: readonly CandidateDocumentType[]): string {
  const options = candidateDocumentTypes.map((type) => `- ${type.code}: ${type.name}`).join("\n");
  return (
    "You are looking at one attachment from an email a bank sent to a loan office. " +
    "Identify which of the following document types it is, if any, and extract the key dates and figures visible on it.\n\n" +
    `Candidate document types for this case (choose one of these codes, or null if none fit):\n${options}\n\n` +
    "Respond with ONLY a JSON object, no other text, in exactly this shape:\n" +
    "{\n" +
    '  "documentTypeCode": "<one of the codes above, or null>",\n' +
    '  "confidence": <number between 0 and 1>,\n' +
    '  "periodStart": "<YYYY-MM-DD or null, if this document covers a date range>",\n' +
    '  "periodEnd": "<YYYY-MM-DD or null>",\n' +
    '  "extractedFields": { <any other figures, names or dates visible on the document> },\n' +
    '  "reasoning": "<one sentence, why you chose this>"\n' +
    "}"
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Extract the plain-text parts of a Claude `messages` API response. */
export function extractResponseText(payload: unknown): string {
  const content = asRecord(payload).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block: unknown) => asRecord(block).type === "text")
    .map((block: unknown) => String(asRecord(block).text ?? ""))
    .join("");
}

/**
 * Parse the model's response text into a classification result. The prompt
 * asks for JSON only, but a model can still wrap it in prose or a code
 * fence — the first `{...}` span is taken rather than assuming the whole
 * string is clean JSON, and any failure to parse degrades to zero
 * confidence rather than throwing.
 */
export function parseClassificationResponse(text: string, rawModelResponse: unknown): InboundClassificationResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return zeroConfidenceResult("The model's response contained no JSON object.", rawModelResponse);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return zeroConfidenceResult("The model's response could not be parsed as JSON.", rawModelResponse);
  }
  if (typeof parsed !== "object" || parsed === null) {
    return zeroConfidenceResult("The model's response was not a JSON object.", rawModelResponse);
  }

  const record = parsed as Record<string, unknown>;
  const confidence = typeof record.confidence === "number" ? Math.max(0, Math.min(1, record.confidence)) : 0;

  return {
    documentTypeCode: typeof record.documentTypeCode === "string" ? record.documentTypeCode : null,
    confidence,
    periodStart: typeof record.periodStart === "string" ? record.periodStart : undefined,
    periodEnd: typeof record.periodEnd === "string" ? record.periodEnd : undefined,
    extractedFields: asRecord(record.extractedFields),
    reasoning: typeof record.reasoning === "string" ? record.reasoning : "",
    rawModelResponse,
  };
}
