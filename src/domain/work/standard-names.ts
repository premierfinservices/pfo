/**
 * The name a document is stored under once PFO knows what it is.
 *
 * Customers' files arrive as IMG_2231.JPEG and DOC-WA0016.pdf. Stored under
 * "PAN Card - DEMO CUSTOMER.jpeg", the case folder reads like organize's. The
 * original name is kept on the document record, so nothing is lost. Pure.
 */

export interface StandardNameInput {
  /** `document_type.name`, e.g. "PAN Card". */
  readonly typeName: string;
  /** A monthly return's own name, e.g. "GSTR-3B Apr 2025"; used instead of the type name. */
  readonly monthlyName?: string;
  readonly periodStart?: string | null;
  readonly periodEnd?: string | null;
  /** Whose document it is, when it belongs to a person on the case. */
  readonly personName?: string | null;
  readonly originalFileName: string;
}

/** A financial year April to March is named by its assessment year: AY 2025-26 is April 2024 to March 2025. */
function assessmentYearLabel(periodStart: string, periodEnd?: string | null): string | null {
  const start = /^(\d{4})-04-01$/.exec(periodStart);
  if (!start) return null;
  if (periodEnd && periodEnd !== `${Number(start[1]) + 1}-03-31`) return null;
  const year = Number(start[1]) + 1;
  return `AY ${year}-${String(year + 1).slice(-2)}`;
}

export function standardFileName(input: StandardNameInput): string {
  const extension = /(\.[A-Za-z0-9]{1,5})$/.exec(input.originalFileName)?.[1]?.toLowerCase() ?? "";
  const year = input.monthlyName || !input.periodStart ? null : assessmentYearLabel(input.periodStart, input.periodEnd);
  const base = [input.monthlyName ?? input.typeName, year].filter(Boolean).join(" ");
  const named = input.personName ? `${base} - ${input.personName}` : base;
  // Characters Windows refuses in a file name, and runs of spaces left behind.
  const clean = named.replace(/[<>:"/\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return `${clean}${extension}`;
}
