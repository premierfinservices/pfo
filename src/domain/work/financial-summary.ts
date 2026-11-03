/**
 * Reading `GST and ITR Summary.txt`, and the filter arithmetic the summary
 * screen uses. Pure: no I/O, no clock.
 *
 * The file is written by the desktop `organize` / `calculate-values` skills
 * in a fixed plain-text layout and stored as-is in `loan_case.financial_summary`
 * (ADR-040). This turns it into figures a screen can chart and filter.
 *
 * THE FIGURES ARE NEVER GUESSED. Parsing is strict on purpose: if the layout is
 * not one this knows, or the periods do not add up to the file's own TOTAL
 * line, `parseFinancialSummary` returns null and the screen shows the original
 * text instead. A summary that quietly shows a wrong number to someone sizing
 * a loan is worse than one that looks plain.
 *
 * Layouts it knows (all seen in real case folders): monthly or quarterly GST
 * returns; ITR cells that are a figure, "LOSS <figure>", "Nil", or not
 * applicable ("N/A", "NA (44AD)", "Not in P&L", "Not available"); a
 * "Presumptive" column in place of "Net Profit"; a "PARTIAL:" line. Files with
 * more than one GST block or ITR block (several filers) are refused, because
 * showing one filer's block as the whole summary would mislead.
 */

export interface SummaryMonth {
  /** "Sep 2025", or "Oct-Dec 2025" for a quarterly return, as written. */
  readonly label: string;
  /** What a chart axis shows: "Sep", or "Oct–Dec". */
  readonly short: string;
  readonly year: number;
  /** 0 = January. For a quarter, the month it starts in. */
  readonly month: number;
  readonly amount: number;
  /** April to March, "2025-26". */
  readonly financialYear: string;
  /** Months the return covers: 1, or 3 for a quarterly return. */
  readonly span: number;
}

export interface SummaryItrYear {
  /** "2026-27". */
  readonly assessmentYear: string;
  /** The year the figures are for: assessment year 2026-27 is "2025-26". */
  readonly financialYear: string;
  readonly turnover: number | null;
  /** Negative for a loss. For a presumptive filer, the presumptive income. */
  readonly netProfit: number | null;
  readonly profitKind: "net_profit" | "presumptive";
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
  /** A "PARTIAL:" line, without the word, if the file has one. */
  readonly partial: string | null;
  /** Oldest first. */
  readonly months: readonly SummaryMonth[];
  readonly total: number;
  readonly average: number;
  /** Newest first, as written. */
  readonly itr: readonly SummaryItrYear[];
  /** Lines under the ITR table that start with *, without the asterisk. */
  readonly itrFootnotes: readonly string[];
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const NUMBER = "[\\d,]+(?:\\.\\d+)?";

const MONTH_ROW = new RegExp(`^\\s*([A-Za-z]{3})\\s+(\\d{4})\\s+Rs\\.\\s+(${NUMBER})\\s*$`);
const QUARTER_ROW = new RegExp(`^\\s*([A-Za-z]{3})-([A-Za-z]{3})\\s+(\\d{4})\\s+Rs\\.\\s+(${NUMBER})\\s*$`);
const TOTAL_ROW = new RegExp(`^\\s*TOTAL\\s+Rs\\.\\s+(${NUMBER})\\s*$`, "i");
const AVERAGE_ROW = new RegExp(`^\\s*AVG\\/MONTH\\s+Rs\\.\\s+(${NUMBER})\\s*$`, "i");
const ITR_ROW = /^\s*AY\s+(\d{4})-(\d{2})(\*?)\s+(.*)$/;
/** One ITR cell, from the start of what is left of the row. */
const ITR_CELL = new RegExp(
  `^\\s*((?:LOSS\\s+)?${NUMBER}\\*?|Not available|Not in P&L|N\\/A|NA\\s*\\([^)]*\\)|Nil)(?=\\s|$)`,
  "i",
);

function toNumber(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function financialYearOf(year: number, month: number): string {
  const start = month >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const capitalised = (word: string): string => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`;

function readCell(token: string): number | null {
  if (/^nil$/i.test(token)) return 0;
  if (/^(not available|not in p&l|n\/a|na\b)/i.test(token)) return null;
  const loss = /^LOSS\s+/i.test(token);
  const value = toNumber(token.replace(/^LOSS\s+/i, "").replace(/\*$/, ""));
  return Number.isNaN(value) ? null : loss ? -value : value;
}

function readItrRow(match: RegExpExecArray, profitKind: SummaryItrYear["profitKind"]): SummaryItrYear | null {
  const start = Number(match[1]);
  const end = Number(match[2]);
  if ((start + 1) % 100 !== end) return null;

  let rest = match[4] ?? "";
  const cells: string[] = [];
  for (let i = 0; i < 4; i++) {
    const cell = ITR_CELL.exec(rest);
    if (!cell) return null;
    cells.push(cell[1]!);
    rest = rest.slice(cell[0].length);
  }
  const noteMatch = /^\s*\((.*)\)\s*$/.exec(rest);
  if (rest.trim() !== "" && !noteMatch) return null;

  return {
    assessmentYear: `${start}-${match[2]}`,
    financialYear: `${start - 1}-${String(start % 100).padStart(2, "0")}`,
    turnover: readCell(cells[0]!),
    netProfit: readCell(cells[1]!),
    profitKind,
    depreciation: readCell(cells[2]!),
    financeCost: readCell(cells[3]!),
    note: noteMatch?.[1]?.trim() || null,
    fromComparative: match[3] === "*",
  };
}

export function parseFinancialSummary(text: string): ParsedSummary | null {
  // Windows tools write a byte-order mark and sometimes doubled carriage
  // returns. Neither is part of the layout, and a stray "\r" stops "." matching.
  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n");

  let business: string | null = null;
  let prepared: string | null = null;
  let partial: string | null = null;
  const months: SummaryMonth[] = [];
  const itr: SummaryItrYear[] = [];
  const footnotes: string[] = [];
  let total: number | null = null;
  let average: number | null = null;
  let gstBlocks = 0;
  let itrHeaders = 0;
  let profitKind: SummaryItrYear["profitKind"] = "net_profit";

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
    const partialLine = /^PARTIAL:\s*(.+?)\s*$/i.exec(line);
    if (partialLine) {
      partial = partialLine[1] ?? null;
      continue;
    }
    if (/^GST TAXABLE VALUE/i.test(line)) {
      gstBlocks++;
      continue;
    }

    if (/Turnover/.test(line) && /Depreciation/.test(line) && /Finance Cost/.test(line)) {
      const order = ["Turnover", /Net Profit|Presumptive/, "Depreciation", "Finance Cost"].map((name) =>
        typeof name === "string" ? line.indexOf(name) : line.search(name),
      );
      if (order.some((at) => at < 0) || order.some((at, i) => i > 0 && at <= order[i - 1]!)) return null;
      profitKind = /Presumptive/.test(line) ? "presumptive" : "net_profit";
      itrHeaders++;
      continue;
    }

    const quarterRow = QUARTER_ROW.exec(line);
    if (quarterRow) {
      const from = MONTH_NAMES.indexOf((quarterRow[1] ?? "").toLowerCase());
      const to = MONTH_NAMES.indexOf((quarterRow[2] ?? "").toLowerCase());
      if (from < 0 || to < 0 || (to - from + 12) % 12 !== 2) return null;
      const year = Number(quarterRow[3]);
      months.push({
        label: `${capitalised(quarterRow[1]!)}-${capitalised(quarterRow[2]!)} ${year}`,
        short: `${capitalised(quarterRow[1]!)}–${capitalised(quarterRow[2]!)}`,
        year,
        month: from,
        amount: toNumber(quarterRow[4] ?? ""),
        financialYear: financialYearOf(year, from),
        span: 3,
      });
      continue;
    }

    const monthRow = MONTH_ROW.exec(line);
    if (monthRow) {
      const month = MONTH_NAMES.indexOf((monthRow[1] ?? "").toLowerCase());
      if (month < 0) return null;
      const year = Number(monthRow[2]);
      months.push({
        label: `${capitalised(monthRow[1]!)} ${year}`,
        short: capitalised(monthRow[1]!),
        year,
        month,
        amount: toNumber(monthRow[3] ?? ""),
        financialYear: financialYearOf(year, month),
        span: 1,
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
      if (itrHeaders === 0) return null;
      const row = readItrRow(itrRow, profitKind);
      if (!row) return null;
      itr.push(row);
      continue;
    }

    const footnote = /^\s*\*\s+(.+?)\s*$/.exec(line);
    if (footnote && itr.length > 0) footnotes.push(footnote[1]!);
  }

  // Several GST blocks or several ITR blocks mean several filers. One block
  // shown as if it were the whole summary would mislead.
  if (gstBlocks > 1 || itrHeaders > 1) return null;
  if (months.length === 0 || total === null || itr.length === 0) return null;

  // The periods must add up to the file's own TOTAL, to the rupee. If they do
  // not, something in the file or the layout is not what this reads.
  const sum = months.reduce((a, m) => a + m.amount, 0);
  if (Math.abs(sum - total) > 1) return null;

  months.sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const monthsCovered = months.reduce((a, m) => a + m.span, 0);

  return {
    business,
    prepared,
    partial,
    months,
    total,
    average: average ?? total / monthsCovered,
    itr,
    itrFootnotes: footnotes,
  };
}

// ---------------------------------------------------------------------------
// Several filers in one file
// ---------------------------------------------------------------------------

const TITLE_LINE = /^GST AND ITR SUMMARY\s*-\s*(.+?)\s*$/i;

/**
 * The file as one text per filer. `calculate-values` writes a whole summary,
 * title line and all, for each filer, one after another. A file with one title
 * (or none) comes back as it is.
 */
function filerSections(text: string): string[] {
  const lines = text.replace(/^﻿/, "").replace(/\r/g, "").split("\n");
  const starts = lines.flatMap((line, i) => (TITLE_LINE.test(line) ? [i] : []));
  if (starts.length <= 1) return [text];
  return starts.map((from, n) => lines.slice(from, starts[n + 1] ?? lines.length).join("\n"));
}

/**
 * Each filer's summary, in the order written. All or nothing: if any filer's
 * part does not read, none is shown, because the screen would otherwise present
 * part of a file as the whole of it.
 */
export function parseFilerSummaries(text: string): ParsedSummary[] | null {
  const parsed = filerSections(text).map(parseFinancialSummary);
  return parsed.every((p): p is ParsedSummary => p !== null) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Whose summary is it
// ---------------------------------------------------------------------------

/** Every name on the file's title lines, in order. Works on files the full parser refuses. */
export function summaryBusinessNames(text: string): string[] {
  const cleaned = text.replace(/^﻿/, "").replace(/\r/g, "");
  return cleaned.split("\n").flatMap((line) => {
    const name = TITLE_LINE.exec(line)?.[1];
    return name ? [name] : [];
  });
}

/** The name on the file's first title line, or null. */
export function summaryBusinessName(text: string): string | null {
  return summaryBusinessNames(text)[0] ?? null;
}

/** Words that say what kind of firm it is, not which one. */
const NAME_NOISE = new Set(["M", "S", "MS", "PVT", "PRIVATE", "LTD", "LIMITED", "LLP", "AND", "CO", "COMPANY", "THE", "PROP", "PROPRIETOR"]);

const nameWords = (name: string): Set<string> =>
  new Set(
    name
      .toUpperCase()
      .replace(/&/g, " AND ")
      .split(/[^A-Z0-9]+/)
      .filter((word) => word !== "" && !NAME_NOISE.has(word)),
  );

/**
 * Whether the business named on a summary is one the case holds. A name matches
 * when all the words of one are among the words of the other, so "M/s. RVB Metal
 * Works" and "RVB METAL WORKS COIMBATORE" both match "RVB METAL WORKS" while
 * "ACE ASSOCIATES" does not. null means it cannot be told: a name is missing.
 * Used only to warn; one customer can trade under several names.
 */
export function summaryBelongsTo(business: string | null, caseNames: readonly string[]): boolean | null {
  if (!business) return null;
  const summaryWords = nameWords(business);
  if (summaryWords.size === 0) return null;
  const candidates = caseNames.map(nameWords).filter((words) => words.size > 0);
  if (candidates.length === 0) return null;
  const within = (small: Set<string>, large: Set<string>): boolean => [...small].every((word) => large.has(word));
  if (candidates.some((words) => within(summaryWords, words) || within(words, summaryWords))) return true;
  // Same name spaced differently ("RAVIMURUGAA" / "RAVI MURUGAA"): compare with the spaces taken out.
  const squashed = (words: Set<string>): string => [...words].join("");
  const target = squashed(summaryWords);
  return candidates.some((words) => squashed(words) === target);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

interface Period {
  readonly amount: number;
  readonly span?: number;
}

export interface MonthFilter {
  /** Inclusive indexes into the months array. */
  readonly from: number;
  readonly to: number;
  /** Indexes the person has left out. */
  readonly excluded: ReadonlySet<number>;
  /** Keep only periods under the average of what is left after the rest. */
  readonly belowAverage: boolean;
}

export interface MonthSelection {
  readonly indexes: readonly number[];
  readonly total: number;
  /** Months those periods cover (a quarterly return is 3). */
  readonly monthsCounted: number;
  /** Per month, over the selected periods only. 0 when none are selected. */
  readonly average: number;
  /** The per-month average before "below average" was applied; the line that filter uses. */
  readonly baseAverage: number;
}

const spanOf = (period: Period): number => period.span ?? 1;

export function selectMonths(months: readonly Period[], filter: MonthFilter): MonthSelection {
  const base: number[] = [];
  for (let i = Math.max(0, filter.from); i <= Math.min(months.length - 1, filter.to); i++) {
    if (!filter.excluded.has(i)) base.push(i);
  }
  const baseTotal = base.reduce((a, i) => a + months[i]!.amount, 0);
  const baseMonths = base.reduce((a, i) => a + spanOf(months[i]!), 0);
  const baseAverage = baseMonths ? baseTotal / baseMonths : 0;
  // A period is "below average" by its own per-month rate.
  const indexes = filter.belowAverage ? base.filter((i) => months[i]!.amount / spanOf(months[i]!) < baseAverage) : base;
  const total = indexes.reduce((a, i) => a + months[i]!.amount, 0);
  const monthsCounted = indexes.reduce((a, i) => a + spanOf(months[i]!), 0);
  return { indexes, total, monthsCounted, average: monthsCounted ? total / monthsCounted : 0, baseAverage };
}

export interface MonthPreset {
  readonly id: string;
  readonly label: string;
  readonly from: number;
  readonly to: number;
}

/** The last periods that add up to exactly `months` months, or null if they cannot. */
function lastMonths(periods: readonly SummaryMonth[], months: number): { from: number; to: number } | null {
  let covered = 0;
  for (let i = periods.length - 1; i >= 0; i--) {
    covered += periods[i]!.span;
    if (covered === months) return { from: i, to: periods.length - 1 };
    if (covered > months) return null;
  }
  return null;
}

/**
 * Presets built from the periods actually in the file, so a window that
 * starts in September, or is quarterly, or is 24 months long, gets sensible
 * choices instead of a fixed list. When the file covers more than a year the
 * latest 12 months come first, since that is the window a lender looks at.
 * A preset that covers the same periods as an earlier one is dropped.
 */
export function presetsFor(months: readonly SummaryMonth[]): readonly MonthPreset[] {
  const last = months.length - 1;
  const covered = months.reduce((a, m) => a + m.span, 0);
  const candidates: MonthPreset[] = [];
  const add = (id: string, label: string, range: { from: number; to: number } | null): void => {
    if (range) candidates.push({ id, label, ...range });
  };
  if (covered > 12) add("last12", "Last 12 months", lastMonths(months, 12));
  add("all", `All ${covered} months`, { from: 0, to: last });
  add("last6", "Last 6", lastMonths(months, 6));
  add("last3", "Last 3", lastMonths(months, 3));
  for (const fy of new Set(months.map((m) => m.financialYear))) {
    const inYear = months.map((m, i) => (m.financialYear === fy ? i : -1)).filter((i) => i >= 0);
    add(`fy-${fy}`, `FY ${fy}`, { from: inYear[0]!, to: inYear[inYear.length - 1]! });
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
