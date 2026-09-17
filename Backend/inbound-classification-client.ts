/**
 * The actual Claude API call for inbound attachment classification.
 *
 * Prompt-building and response-parsing are pure functions in
 * src/domain/communications/inbound-classification.ts (unit-tested without a
 * network call); this file is the thin I/O shell around them — the fetch
 * call and the base64 encoding, which is why it lives in Backend rather than
 * in the environment-agnostic domain layer.
 */

import {
  buildClassificationPrompt,
  extractResponseText,
  parseClassificationResponse,
  zeroConfidenceResult,
  type CandidateDocumentType,
  type InboundClassificationResult,
} from "@domain/communications/inbound-classification.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const CLASSIFICATION_MODEL = process.env.PFO_INBOUND_CLASSIFICATION_MODEL ?? "claude-sonnet-5";

export interface ClassifyAttachmentInput {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly fileName: string;
  /** The case's actual outstanding requirement types — classification is
   * asked to choose among these, or say none fit, not to guess from an
   * open-ended taxonomy. */
  readonly candidateDocumentTypes: readonly CandidateDocumentType[];
}

function contentBlockFor(input: ClassifyAttachmentInput): Record<string, unknown> {
  const base64 = Buffer.from(input.bytes).toString("base64");
  if (input.contentType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  }
  return { type: "image", source: { type: "base64", media_type: input.contentType, data: base64 } };
}

export async function classifyAttachment(input: ClassifyAttachmentInput): Promise<InboundClassificationResult> {
  const apiKey = process.env.PFO_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    return zeroConfidenceResult("PFO_ANTHROPIC_API_KEY is not configured — classification was not attempted.", null);
  }

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: CLASSIFICATION_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [contentBlockFor(input), { type: "text", text: buildClassificationPrompt(input.candidateDocumentTypes) }],
          },
        ],
      }),
    });
  } catch (error) {
    return zeroConfidenceResult(
      `Could not reach the Claude API: ${error instanceof Error ? error.message : "network error"}`,
      null,
    );
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return zeroConfidenceResult(`Claude API returned HTTP ${response.status}.`, payload);
  }

  return parseClassificationResponse(extractResponseText(payload), payload);
}
