/**
 * Opening the archives customers send documents in.
 *
 * Zip is opened here, in pure JavaScript. RAR and 7z need a native tool the
 * office server does not have, so they are reported, not guessed at: the person
 * is told to extract them and drop the folder instead.
 */

import { unzipSync } from "fflate";

export interface ArchiveLimits {
  /** Total size once unpacked. Checked from the zip's own index before anything is inflated. */
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
}

const DEFAULT_LIMITS: ArchiveLimits = { maxTotalBytes: 200 * 1024 * 1024, maxFiles: 500 };

export interface UnpackedFile {
  readonly fileName: string;
  /** The folder the file sat in, last segment only, as a dropped folder reports it. */
  readonly folder: string;
  readonly bytes: Uint8Array;
}

export type UnpackResult =
  | { readonly ok: true; readonly files: readonly UnpackedFile[] }
  | { readonly ok: false; readonly reason: string };

export function archiveKind(fileName: string): "zip" | "unsupported" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".rar") || lower.endsWith(".7z")) return "unsupported";
  return null;
}

export function unpackZip(bytes: Uint8Array, limits: ArchiveLimits = DEFAULT_LIMITS): UnpackResult {
  let total = 0;
  let count = 0;
  let refusal: string | null = null;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter(entry) {
        if (entry.name.endsWith("/") || entry.name.startsWith("__MACOSX/")) return false;
        count += 1;
        total += entry.originalSize;
        if (count > limits.maxFiles) refusal ??= `The archive holds too many files (more than ${limits.maxFiles}).`;
        if (total > limits.maxTotalBytes) refusal ??= "The archive is too large once unpacked.";
        return refusal === null;
      },
    });
  } catch {
    return { ok: false, reason: "That is not a valid zip file." };
  }
  if (refusal) return { ok: false, reason: refusal };

  const files = Object.entries(entries).map(([path, content]) => {
    const parts = path.split("/");
    return { fileName: parts[parts.length - 1]!, folder: parts.length > 1 ? parts[parts.length - 2]! : "", bytes: content };
  });
  return { ok: true, files };
}
