/**
 * What a file in a case folder is, from its name and folder alone.
 *
 * The `organize` skill has already named and filed everything by its content,
 * so this only reads those conventions. Anything it cannot place is still
 * uploaded, as Other Document, and shown as such: nothing is dropped or guessed.
 * Pure.
 */

export interface FileMatch {
  readonly documentTypeCode: string;
  /** First day of the month or financial year this file covers, if any. */
  readonly periodStart?: string;
  readonly periodEnd?: string;
  /** Whether this file is one month of a monthly return. */
  readonly isMonthlyReturn?: boolean;
  readonly recognised: boolean;
  /** Recognised, but no standard name fits, so it is stored under the name it came with. */
  readonly keepsOwnName?: boolean;
}

export type FileKind =
  | { readonly kind: "document"; readonly match: FileMatch }
  /** organize's figures for this case. */
  | { readonly kind: "financial_summary" }
  /** Generated, or not a document at all. */
  | { readonly kind: "skip" };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function monthPeriod(year: number, monthIndex: number) {
  const pad = (n: number): string => String(n).padStart(2, "0");
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    periodStart: `${year}-${pad(monthIndex + 1)}-01`,
    periodEnd: `${year}-${pad(monthIndex + 1)}-${pad(last)}`,
  };
}

/** AY 2025-26 is financial year 2024-25: April 2024 to March 2025. */
function assessmentYearPeriod(assessmentStart: number) {
  return { periodStart: `${assessmentStart - 1}-04-01`, periodEnd: `${assessmentStart}-03-31` };
}

const ITR_PARTS: readonly (readonly [RegExp, string])[] = [
  [/balance\s*sheet|\bbs\b/i, "balance_sheet"],
  [/profit|\bp\s*&\s*l\b|\bpnl\b|\bp\s+and\s+l\b/i, "profit_and_loss"],
  [/computation|\bcoi\b/i, "computation_income"],
];

/** The period a name states. "FY 2024-25" is that year; "AY 2025-26", or a bare
 * "2025-26" as organize writes on returns, is the assessment year. */
function yearIn(name: string): { periodStart?: string; periodEnd?: string } {
  const found = /(fy|f\.y\.)?\s*(\d{4})\s*-\s*\d{2}/i.exec(name);
  if (!found) return {};
  const start = Number(found[2]);
  return found[1] ? assessmentYearPeriod(start + 1) : assessmentYearPeriod(start);
}

/** Tested in order, first match wins, so the specific come before the general. */
const NAME_RULES: readonly (readonly [RegExp, string])[] = [
  [/^aadhaar|^aadhar/i, "aadhaar_card"],
  [/^pan\b/i, "pan_card"],
  [/^photo/i, "photograph"],
  [/^passport/i, "passport"],
  [/^form\s*16/i, "form_16"],
  [/26as|\bais\b/i, "form_26as"],
  [/salary\s*slip|payslip/i, "salary_slip"],
  [/gst\s*(certificate|registration)/i, "gst_certificate"],
  [/udyam/i, "udyam_certificate"],
  [/partnership\s*deed/i, "partnership_deed"],
  [/\bmoa\b|\baoa\b/i, "moa_aoa"],
  [/sanction\s*letter/i, "sanction_letter"],
  [/foreclosure/i, "foreclosure_letter"],
  [/\b(lap|loan|repayment|emi)\b.*(statement|schedule)|welcome\s*letter/i, "existing_loan_statement"],
  [/statement/i, "bank_statement"],
  [/parent\s*(deed|doc)/i, "parent_document"],
  [/sale\s*(deed|agreement)/i, "sale_deed"],
  [/patta|chitta/i, "patta_chitta"],
  [/\bec\b|encumbrance/i, "encumbrance_cert"],
  [/property\s*tax|tax\s*receipt/i, "property_tax_receipt"],
  [/\beb\b.*bill|electricity/i, "org_address_proof"],
  [/\bplan\b|layout/i, "approved_plan"],
  [/lease/i, "lease_deed"],
  [/quotation|proforma/i, "vehicle_quotation"],
  [/valuation/i, "valuation_report"],
];

/** organize's folders, for a name the rules above do not place. */
const FOLDER_RULES: readonly (readonly [RegExp, string])[] = [
  [/bank\s*(documents|statements)/i, "bank_statement"],
  [/^itr$/i, "itr"],
  [/^gst$/i, "gst_returns"],
];

export function classifyCaseFile(fileName: string, folder = ""): FileKind {
  const name = fileName.replace(/\.[^.]+$/, "").trim();
  const lower = fileName.toLowerCase();

  if (lower === "pending documents.txt" || lower === "desktop.ini" || lower === "thumbs.db") return { kind: "skip" };
  if (lower === "gst and itr summary.txt") return { kind: "financial_summary" };
  if (/\.(zip|rar|7z|tmp|lnk)$/.test(lower)) return { kind: "skip" };

  // GSTR-3B Apr 2025
  const named = /^gstr-?\s*3b\s+([a-z]{3})[a-z]*\s+(\d{4})/i.exec(name);
  if (named) {
    const month = MONTHS.indexOf(named[1]!.toLowerCase());
    if (month >= 0) {
      return {
        kind: "document",
        match: { documentTypeCode: "gst_returns", isMonthlyReturn: true, recognised: true, ...monthPeriod(Number(named[2]), month) },
      };
    }
  }
  // GSTR3B_<GSTIN>_042025, as the portal downloads it
  const portal = /^gstr-?3b[_\s-].*?(\d{2})(\d{4})$/i.exec(name);
  if (portal && Number(portal[1]) >= 1 && Number(portal[1]) <= 12) {
    return {
      kind: "document",
      match: {
        documentTypeCode: "gst_returns",
        isMonthlyReturn: true,
        recognised: true,
        ...monthPeriod(Number(portal[2]), Number(portal[1]) - 1),
      },
    };
  }
  // "Apr 2025.pdf", "GST3B June 25.pdf": a month in the GST folder, or on a 3B.
  // A GSTR-1, 2A or 9 in the GST folder is not a month of 3B, whatever month it names.
  const otherGstr = /^gstr(?!-?\s*3b)/i.test(name);
  if (!otherGstr && (/^gst$/i.test(folder.trim()) || /^gst-?\s*3b/i.test(name))) {
    const month = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*(\d{4}|\d{2})\b/i.exec(name);
    if (month && !/certificate|registration/i.test(name)) {
      const year = month[2]!.length === 2 ? 2000 + Number(month[2]) : Number(month[2]);
      return {
        kind: "document",
        match: {
          documentTypeCode: "gst_returns",
          isMonthlyReturn: true,
          recognised: true,
          ...monthPeriod(year, MONTHS.indexOf(month[1]!.toLowerCase())),
        },
      };
    }
  }
  // A GSTR-1, 2A or 9 is not a 3B and has no type of its own: it must not be named
  // "GST 3B" or fill the 3B row, so it keeps its own name as an Other Document.
  if (otherGstr) {
    return { kind: "document", match: { documentTypeCode: "other_document", recognised: true, keepsOwnName: true } };
  }
  if (/^gstr/i.test(name)) {
    return { kind: "document", match: { documentTypeCode: "gst_returns", recognised: true } };
  }

  // Some customers file the ITR as one PDF, others as separate computation, P&L
  // and balance sheet PDFs. Each part goes on its own row, under its own year,
  // whatever order they arrive in.
  for (const [pattern, documentTypeCode] of ITR_PARTS) {
    if (pattern.test(name)) {
      return { kind: "document", match: { documentTypeCode, recognised: true, ...yearIn(name) } };
    }
  }
  if (/^itr\b/i.test(name)) {
    return { kind: "document", match: { documentTypeCode: "itr", recognised: true, ...yearIn(name) } };
  }

  for (const [pattern, documentTypeCode] of NAME_RULES) {
    if (pattern.test(name)) return { kind: "document", match: { documentTypeCode, recognised: true } };
  }
  for (const [pattern, documentTypeCode] of FOLDER_RULES) {
    if (pattern.test(folder.trim())) return { kind: "document", match: { documentTypeCode, recognised: true } };
  }
  return { kind: "document", match: { documentTypeCode: "other_document", recognised: false } };
}

/** Who a document type belongs to, when no pending row says already. */
const PERSONAL_TYPES = new Set([
  "aadhaar_card",
  "pan_card",
  "photograph",
  "passport",
  "form_16",
  "form_26as",
  "salary_slip",
  "bank_statement",
  "itr",
  "computation_income",
  "gst_returns",
  "gst_certificate",
  "udyam_certificate",
  "org_address_proof",
]);

export function belongsToApplicant(documentTypeCode: string): boolean {
  return PERSONAL_TYPES.has(documentTypeCode);
}

/** How a monthly return shows on its own row: "GSTR-3B Apr 2025". */
export function monthlyReturnName(periodStart: string): string {
  const [year, month] = periodStart.split("-").map(Number);
  const label = MONTHS[(month ?? 1) - 1]!;
  return `GSTR-3B ${label[0]!.toUpperCase()}${label.slice(1)} ${year}`;
}
