/**
 * Reading `GST and ITR Summary.txt`, and the filter arithmetic the summary
 * screen uses. Pure: no I/O, no clock.
 *
 * The file is written by the desktop `organize` / `calculate-values` skills
 * in a fixed plain-text layout and stored as-is in `loan_case.financial_summary`
 * (ADR-040). This turns it into figures a screen can chart and filter.
 *
 * THE FIGURES ARE NEVER GUESSED. Parsing is strict on purpose: if the layout is
 * not exactly the one the skill writes, or the months do not add up to the
 * file's own TOTAL line, `parseFinancialSummary` returns null and the screen
 * shows the original text instead. A summary that quietly shows a wrong number
 * to someone sizing a loan is worse than one that looks plain.
 */

export interface SummaryMonth {
  /** "Sep 2025", as written. */
  readonly label: string;
  readonly year: number;
  /** 0 = January. */
  readonly month: number;
  readonly amount: number;
  /** April to March, "2025-26". */
  readonly financialYear: string;
}

export interface SummaryItrYear {
  /** "2026-27". */
  readonly assessmentYear: string;
  /** The year the figures are for: assessment year 2026-27 is "2025-26". */
  readonly financialYear: string;
  readonly turnover: number | null;
  /** Negative for a loss. */
  readonly netProfit: number | null;
  readonly depreciation: number | null;
  readonly financeCost: number | null;
  /** The bracketed note at the end of the row, if any. */
  readonly note: string | null;
  /** A year marked with * : taken from the comparative column of a later year. */
  readonly fromComparative: boolean;
}

export interface ParsedSummary {
  readonly business: string | null;
  readonly prepared: string | null;
  /** Oldest first. */
  readonly months: readonly SummaryMonth[];
  readonly total: number;
  readonly average: number;
  /** Newest first, as written. */
  readonly itr: readonly SummaryItrYear[];
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER = "[\\d,]+(?:\\.\\d+)?";

const MONTH_ROW = new RegExp(`^\\s*([A-Za-z]{3})\\s+(\\d{4})\\s+Rs\\.\\s+(${NUMBER})\\s*$`);
const TOTAL_ROW = new RegExp(`^\\s*TOTAL\\s+Rs\\.\\s+(${NUMBER})\\s*$`, "i");
const AVERAGE_ROW = new RegExp(`^\\s*AVG\\/MONTH\\s+Rs\\.\\s+(${NUMBER})\\s*$`, "i");
const ITR_ROW = /^\s*AY\s+(\d{4})-(\d{2})(\*?)\s+(.*)$/;
const ITR_FIGURE = new RegExp(`(LOSS\\s+)?${NUMBER}|Not available`, "gi");

function toNumber(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function financialYearOf(year: number, month: number): string {
  const start = month >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function readItrRow(match: RegExpExecArray): SummaryItrYear | null {
  const start = Number(match[1]);
  const end = Number(match[2]);
  if ((start + 1) % 100 !== end) return null;

  const rest = match[4] ?? "";
  const noteMatch = /\(([^)]*)\)\s*$/.exec(rest);
  const figuresText = noteMatch ? rest.slice(0, noteMatch.index) : rest;
  const figures = figuresText.match(ITR_FIGURE);
  if (!figures || figures.length !== 4) return null;

  const read = (token: string): number | null => {
    if (/^not available$/i.test(token)) return null;
    const loss = /^LOSS\s+/i.test(token);
    const value = toNumber(token.replace(/^LOSS\s+/i, ""));
    return Number.isNaN(value) ? null : loss ? -value : value;
  };

  return {
    assessmentYear: `${start}-${match[2]}`,
    financialYear: `${start - 1}-${String(start % 100).padStart(2, "0")}`,
    turnover: read(figures[0]!),
    netProfit: read(figures[1]!),
    depreciation: read(figures[2]!),
    financeCost: read(figures[3]!),
    note: noteMatch?.[1]?.trim() || null,
    fromComparative: match[3] === "*",
  };
}

export function parseFinancialSummary(text: string): ParsedSummary | null {
  const lines = text.split(/\r?\n/);

  let business: string | null = null;
  let prepared: string | null = null;
  const months: SummaryMonth[] = [];
  const itr: SummaryItrYear[] = [];
  let total: number | null = null;
  let average: number | null = null;
  let headerSeen = false;

  for (const line of lines) {
    const titled = /^GST AND ITR SUMMARY\s*-\s*(.+?)\s*$/i.exec(line);
    if (titled) {
      business = titled[1] ?? null;
      continue;
    }
    const date = /^Prepared:\s*(.+?)\s*$/i.exec(line);
    if (date) {
      prepared = date[1] ?? null;
      continue;
    }

    if (/Turnover/.test(line) && /Net Profit/.test(line)) {
      const order = ["Turnover", "Net Profit", "Depreciation", "Finance Cost"].map((name) => line.indexOf(name));
      if (order.some((at) => at < 0) || order.some((at, i) => i > 0 && at <= order[i - 1]!)) return null;
      headerSeen = true;
      continue;
    }

    const monthRow = MONTH_ROW.exec(line);
    if (monthRow) {
      const month = MONTH_NAMES.indexOf((monthRow[1] ?? "").toLowerCase());
      if (month < 0) return null;
      const year = Number(monthRow[2]);
      months.push({
        label: `${(monthRow[1] ?? "").slice(0, 1).toUpperCase()}${(monthRow[1] ?? "").slice(1).toLowerCase()} ${year}`,
        year,
        month,
        amount: toNumber(monthRow[3] ?? ""),
        financialYear: financialYearOf(year, month),
      });
      continue;
    }

    const totalRow = TOTAL_ROW.exec(line);
    if (totalRow) {
      total = toNumber(totalRow[1] ?? "");
      continue;
    }
    const averageRow = AVERAGE_ROW.exec(line);
    if (averageRow) {
      average = toNumber(averageRow[1] ?? "");
      continue;
    }

    const itrRow = ITR_ROW.exec(line);
    if (itrRow) {
      const row = readItrRow(itrRow);
      if (!row) return null;
      itr.push(row);
    }
  }

  if (months.length === 0 || total === null || itr.length === 0 || !headerSeen) return null;

  // The months must add up to the file's own TOTAL, to the rupee. If they do
  // not, something in the file or the layout is not what this reads.
  const sum = months.reduce((a, m) => a + m.amount, 0);
  if (Math.abs(sum - total) > 1) return null;

  months.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));

  return {
    business,
    prepared,
    months,
    total,
    average: average ?? total / months.length,
    itr,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export interface MonthFilter {
  /** Inclusive indexes into the months array. */
  readonly from: number;
  readonly to: number;
  /** Indexes the person has left out. */
  readonly excluded: ReadonlySet<number>;
  /** Keep only months under the average of what is left after the rest. */
  readonly belowAverage: boolean;
}

export interface MonthSelection {
  readonly indexes: readonly number[];
  readonly total: number;
  /** Over the selected months only. 0 when none are selected. */
  readonly average: number;
  /** The average before "below average" was applied; the line that filter uses. */
  readonly baseAverage: number;
}

export function selectMonths(months: readonly { readonly amount: number }[], filter: MonthFilter): MonthSelection {
  const base: number[] = [];
  for (let i = Math.max(0, filter.from); i <= Math.min(months.length - 1, filter.to); i++) {
    if (!filter.excluded.has(i)) base.push(i);
  }
  const baseTotal = base.reduce((a, i) => a + months[i]!.amount, 0);
  const baseAverage = base.length ? baseTotal / base.length : 0;
  const indexes = filter.belowAverage ? base.filter((i) => months[i]!.amount < baseAverage) : base;
  const total = indexes.reduce((a, i) => a + months[i]!.amount, 0);
  return { indexes, total, average: indexes.length ? total / indexes.length : 0, baseAverage };
}

export interface MonthPreset {
  readonly id: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Presets built from the months actually in the file, so a 12-month window
 * that starts in September gets sensible choices, not a fixed list. A preset
 * that covers exactly the same months as an earlier one is dropped.
 */
export function presetsFor(months: readonly SummaryMonth[]): readonly MonthPreset[] {
  const last = months.length - 1;
  const candidates: MonthPreset[] = [
    { id: "all", label: `All ${months.length} months`, from: 0, to: last },
    { id: "last6", label: "Last 6", from: Math.max(0, last - 5), to: last },
    { id: "last3", label: "Last 3", from: Math.max(0, last - 2), to: last },
  ];
  const years = [...new Set(months.map((m) => m.financialYear))];
  for (const fy of years) {
    const inYear = months.map((m, i) => (m.financialYear === fy ? i : -1)).filter((i) => i >= 0);
    candidates.push({ id: `fy-${fy}`, label: `FY ${fy}`, from: inYear[0]!, to: inYear[inYear.length - 1]! });
  }
  const seen = new Set<string>();
  return candidates.filter((p) => {
    const key = `${p.from}-${p.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Rupee formatting
// ---------------------------------------------------------------------------

const GROUPED = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** The whole rupees grouped the Indian way, and the paise kept exactly (".57", or "" when there are none). */
export function rupeeParts(amount: number): { negative: boolean; whole: string; paise: string } {
  const paiseTotal = Math.round(Math.abs(amount) * 100);
  const whole = Math.floor(paiseTotal / 100);
  const paise = paiseTotal % 100;
  return {
    negative: amount < 0 && paiseTotal > 0,
    whole: GROUPED.format(whole),
    paise: paise === 0 ? "" : `.${String(paise).padStart(2, "0")}`,
  };
}

/** "4.60 crore" or "38.37 lakh"; empty below a lakh, where the exact figure is short enough. */
export function rupeesShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1e7) return `${(abs / 1e7).toFixed(2)} crore`;
  if (abs >= 1e5) return `${(abs / 1e5).toFixed(2)} lakh`;
  return "";
}
