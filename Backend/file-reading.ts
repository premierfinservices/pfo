/**
 * Reading a file by what is in it, for the files whose name says nothing.
 *
 * WhatsApp images and phone scans arrive as IMG_2231.JPEG. Code cannot read
 * those, so they go to the model, and only those: a file the name already
 * explains is never sent, and neither is a repeat. The answer is a claim, not a
 * fact (see inbound-classification.ts), so it is used only when it is confident
 * AND names a type PFO actually has; otherwise the file stays Other Document and
 * a person looks at it. If the model cannot be reached, the same (the client reports that as confidence 0).
 */

import { monthPeriod, type FileMatch } from "@domain/work/file-names.js";

import { classifyAttachment } from "./inbound-classification-client.js";
import type { Queryable } from "./db.js";

/** Below this the model's answer is ignored. */
export const MIN_READ_CONFIDENCE = 0.75;

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function mediaTypeFor(fileName: string): string | null {
  const extension = /(\.[A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";
  return MEDIA_TYPES[extension] ?? null;
}

const isDate = (value: string | undefined): value is string => value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** A month's return, or an April-to-March year; any other range the model reports is not trusted as a period. */
function periodFrom(code: string, start: string | undefined, end: string | undefined): Partial<FileMatch> {
  if (!isDate(start) || !isDate(end)) return {};
  if (code === "gst_returns" && start.slice(0, 7) === end.slice(0, 7)) {
    return { isMonthlyReturn: true, ...monthPeriod(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1) };
  }
  if (start.endsWith("-04-01") && end === `${Number(start.slice(0, 4)) + 1}-03-31`) {
    return { periodStart: start, periodEnd: end };
  }
  return {};
}

export async function readByContent(
  client: Queryable,
  file: { bytes: Uint8Array; fileName: string },
): Promise<FileMatch | null> {
  const contentType = mediaTypeFor(file.fileName);
  if (!contentType) return null;

  const { rows: offered } = await client.query<{ code: string; name: string }>(
    `select code, name from document_type
      where is_active and artifact_kind = 'customer' and code <> 'other_document'
      order by display_order, name`,
  );

  // Never throws: a missing key or an unreachable API comes back as confidence 0.
  const answer = await classifyAttachment({
    bytes: file.bytes,
    contentType,
    fileName: file.fileName,
    candidateDocumentTypes: offered,
    source: "one document a customer gave a loan office, as a scan or a photo",
  });

  const code = answer.documentTypeCode;
  if (!code || answer.confidence < MIN_READ_CONFIDENCE || !offered.some((type) => type.code === code)) return null;
  return { documentTypeCode: code, recognised: true, ...periodFrom(code, answer.periodStart, answer.periodEnd) };
}
