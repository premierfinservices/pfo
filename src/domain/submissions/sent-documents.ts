/**
 * Which documents have gone to a lender, which have not, and why not.
 *
 * Pure. Input is what the package list already says (each email, its status
 * and the documents it carried) and what the case could send. Output is the
 * two lists a person needs to act on: "sent" and "not sent, because ...".
 *
 * A document counts as sent if ANY email that actually went carried it, even
 * if an older attempt failed. "Not sent" is only ever a statement about what
 * the records show, never a guess about what the lender holds.
 */

export interface OfferedDocument {
  readonly documentId: string;
  readonly fileName: string;
  /** The document's type, e.g. "Existing Loan Statement". */
  readonly label: string;
  /** Why it cannot be sent at all (for example, too large for one email). */
  readonly blockedBecause?: string | undefined;
}

export interface SentPackage {
  readonly emails: readonly {
    readonly status: "pending" | "sent" | "failed";
    readonly failureMessage: string | null;
    readonly documents: readonly { readonly documentId: string; readonly fileName: string }[];
  }[];
}

export interface SentDocument {
  readonly documentId: string;
  readonly fileName: string;
}

export interface UnsentDocument extends SentDocument {
  readonly label: string;
  readonly reason: string;
}

export interface SentDocumentReport {
  readonly sent: readonly SentDocument[];
  readonly notSent: readonly UnsentDocument[];
  readonly anySent: boolean;
}

export function sentDocumentReport(
  packages: readonly SentPackage[],
  offered: readonly OfferedDocument[],
): SentDocumentReport {
  const sent = new Map<string, SentDocument>();
  const unsentReason = new Map<string, string>();

  for (const pkg of packages) {
    for (const email of pkg.emails) {
      for (const d of email.documents) {
        if (email.status === "sent") {
          sent.set(d.documentId, { documentId: d.documentId, fileName: d.fileName });
        } else if (!unsentReason.has(d.documentId)) {
          unsentReason.set(
            d.documentId,
            email.status === "failed"
              ? `Its email failed: ${email.failureMessage ?? "no reason given"}`
              : "Its email has not gone yet",
          );
        }
      }
    }
  }

  const notSent: UnsentDocument[] = [];
  for (const d of offered) {
    if (sent.has(d.documentId)) continue;
    notSent.push({
      documentId: d.documentId,
      fileName: d.fileName,
      label: d.label,
      reason: d.blockedBecause ?? unsentReason.get(d.documentId) ?? "Not included in any email to this lender",
    });
  }

  // Sent documents come back in the order the offered list gives, then any the
  // case no longer offers (replaced or removed since) at the end.
  const offeredOrder = offered.filter((d) => sent.has(d.documentId)).map((d) => sent.get(d.documentId)!);
  const rest = [...sent.values()].filter((d) => !offered.some((o) => o.documentId === d.documentId));

  return { sent: [...offeredOrder, ...rest], notSent, anySent: sent.size > 0 };
}
