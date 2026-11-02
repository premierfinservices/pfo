/**
 * Two small rules the "send documents to a banker" path needs.
 *
 * A single file can satisfy more than one requirement row on a case (a rule's
 * row and a row an upload added, for the same month, for instance). The person
 * chooses FILES, so the list offered, and the check that what they chose is
 * still on the case, must count files, not rows. Counting rows made the check
 * "44 matching rows against 43 chosen files" fail every time, and the message
 * could not say which document, because nothing was missing.
 */

/** One row per document, the first one wins, order kept. */
export function onePerDocument<T extends { readonly documentId: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    if (seen.has(row.documentId)) continue;
    seen.add(row.documentId);
    kept.push(row);
  }
  return kept;
}

/** Says which chosen documents are no longer sendable, by file name. */
export function unavailableDocumentsMessage(fileNames: readonly string[]): string {
  const tail = "Reopen the dialog and choose again.";
  if (fileNames.length === 0) return `A chosen document can no longer be sent from this case. ${tail}`;
  if (fileNames.length === 1) return `This document can no longer be sent from this case: ${fileNames[0]}. ${tail}`;
  return `These documents can no longer be sent from this case: ${fileNames.join(", ")}. ${tail}`;
}
