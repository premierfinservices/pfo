/**
 * The Log a Case vocabulary and its parsing, carried over from the MIS
 * (`modQuick.bas`). Pure.
 */

/** MIS loan type -> the PFO product it opens. */
export const LOAN_TYPES = [
  { label: "Personal Loan", productCode: "pl" },
  { label: "Business Loan", productCode: "bl_term_loan" },
  { label: "Loan Against Property (LAP)", productCode: "lap" },
  { label: "Home Loan", productCode: "hl_purchase" },
  { label: "Loan Against Business/Property", productCode: "lap_commercial" },
  { label: "Plot / Land Purchase Loan", productCode: "hl_plot_purchase" },
  { label: "Car Loan", productCode: "vl_new_car" },
  { label: "Other Loan Types", productCode: "other_loan" },
  { label: "Construction / Home Improvement Loan", productCode: "hl_self_construct" },
  { label: "Gold Loan", productCode: "gl_gold" },
  { label: "Used Car Loan", productCode: "vl_used_car" },
  { label: "Two-Wheeler Loan", productCode: "vl_two_wheeler" },
  { label: "Commercial Vehicle Loan", productCode: "vl_commercial_vehicle" },
  { label: "Machinery / Equipment Loan", productCode: "bl_machinery" },
  { label: "Lease Rental Discounting", productCode: "lap_lrd" },
  { label: "Professional Loan (Doctors / CA)", productCode: "pl_professional" },
  { label: "Education Loan", productCode: "el_domestic" },
] as const;

export const OTHER_LOAN_TYPE = "Other Loan Types";

/** MIS employment type -> the code its checklists read. */
export const EMPLOYMENT_TYPES = [
  { label: "Salaried", code: "salaried" },
  { label: "Self-Employed Professional", code: "self_employed_professional" },
  { label: "Self-Employed Business", code: "self_employed" },
  { label: "Proprietorship", code: "proprietorship" },
  { label: "Partnership / LLP", code: "partnership_llp" },
  { label: "Private Limited Company", code: "private_limited" },
  { label: "Retired / Pensioner", code: "retired" },
  { label: "Other", code: "other_employment" },
] as const;

export const LEAD_SOURCES = [
  { label: "Provided Lead Database", code: "provided_lead_database" },
  { label: "Direct Referral", code: "direct_referral" },
] as const;

/** The two proprietorships that share the office. Which one a case is for is
 * chosen when it is logged (migration 0051). */
export const FIRMS = [
  { label: "Mint Capital Management", code: "mcm" },
  { label: "Premier Finservices", code: "premier" },
] as const;

/** What a badge says. */
export const FIRM_SHORT: Record<string, string> = { mcm: "MCM", premier: "Premier" };

export const LOAN_VARIANTS = ["Fresh", "Takeover", "Top-up", "OD", "CC", "Term"] as const;

export function productCodeFor(loanType: string, employmentCode: string): string | null {
  const found = LOAN_TYPES.find((type) => type.label === loanType);
  if (!found) return null;
  if (found.productCode === "pl" && employmentCode !== "salaried" && employmentCode !== "retired") {
    return "pl_self_employed";
  }
  return found.productCode;
}

/** A 10-digit Indian mobile starting 6 to 9, or null. Accepts +91, spaces, dashes. */
export function normaliseMobile(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

/** 2500000, 25,00,000, 25L, 25 lakh, 1.5cr, 1.5 crore -> rupees, or null. */
export function parseAmount(input: string): number | null {
  const text = input.trim().toLowerCase().replace(/,/g, "").replace(/^(₹|rs\.?)\s*/, "");
  const match = /^(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs|cr|crs|crore|crores|k)?$/.exec(text);
  if (!match) return null;
  const unit = match[2] ?? "";
  const scale = unit.startsWith("c") ? 10_000_000 : unit.startsWith("l") ? 100_000 : unit === "k" ? 1_000 : 1;
  const rupees = Math.round(Number(match[1]) * scale);
  return rupees > 0 ? rupees : null;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function underHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

/** Indian wording: 2500000 -> "Twenty Five Lakh Rupees". */
export function amountInWords(rupees: number): string {
  if (!Number.isFinite(rupees) || rupees <= 0) return "";
  const n = Math.round(rupees);
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const hundred = Math.floor((n % 1_000) / 100);
  const rest = n % 100;
  if (crore) parts.push(`${crore >= 100 ? amountInWords(crore).replace(" Rupees", "") : underHundred(crore)} Crore`);
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(underHundred(rest));
  return `${parts.join(" ")} Rupees`;
}

export function capitals(input: string): string {
  return input.trim().replace(/\s+/g, " ").toUpperCase();
}
