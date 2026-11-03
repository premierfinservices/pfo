import { describe, expect, it } from "vitest";

import {
  parseFilerSummaries,
  parseFinancialSummary,
  summaryBusinessNames,
  presetsFor,
  rupeeParts,
  rupeesShort,
  selectMonths,
  type ParsedSummary,
} from "./financial-summary.js";

/** The layout `calculate-values` writes. Every figure here is invented. */
const SAMPLE = `GST AND ITR SUMMARY - DEMO TRADERS
Prepared: 30 Oct 2026
==============================================================

GST TAXABLE VALUE  (GSTR-3B Table 3.1(a))
Jan 2026 to Mar 2026
--------------------------------------------------------------
  Jan 2026    Rs.       1,00,000.50
  Feb 2026    Rs.       2,00,000.25
  Mar 2026    Rs.       3,00,000.00
--------------------------------------------------------------
  TOTAL       Rs.       6,00,000.75
  AVG/MONTH   Rs.       2,00,000.25

==============================================================

ITR  (last 3 assessment years, amounts in Rs.)
--------------------------------------------------------------
  Year              Turnover     Net Profit  Depreciation  Finance Cost
  ---------------------------------------------------------------------
  AY 2026-27  3,50,00,000.00  14,00,000.25     20,000.75   9,00,000.00  (FY 2025-26 CA financials, ITR not yet filed)
  AY 2025-26  3,10,00,000.00   9,00,000.00     24,000.00   6,00,000.00
  AY 2024-25*  2,90,00,000.00  LOSS 4,40,000.50     19,000.00   5,80,000.00
`;

function ok(text: string): ParsedSummary {
  const parsed = parseFinancialSummary(text);
  if (!parsed) throw new Error("expected the summary to parse");
  return parsed;
}

describe("parseFinancialSummary", () => {
  it("reads the business, the date, every month and the totals", () => {
    const s = ok(SAMPLE);
    expect(s.business).toBe("DEMO TRADERS");
    expect(s.prepared).toBe("30 Oct 2026");
    expect(s.months.map((m) => m.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026"]);
    expect(s.months.map((m) => m.amount)).toEqual([100000.5, 200000.25, 300000]);
    expect(s.total).toBe(600000.75);
    expect(s.average).toBe(200000.25);
  });

  it("reads each ITR year, a loss as negative, and the notes", () => {
    const s = ok(SAMPLE);
    expect(s.itr).toHaveLength(3);
    expect(s.itr[0]).toMatchObject({
      assessmentYear: "2026-27",
      financialYear: "2025-26",
      turnover: 35000000,
      netProfit: 1400000.25,
      depreciation: 20000.75,
      financeCost: 900000,
      note: "FY 2025-26 CA financials, ITR not yet filed",
      fromComparative: false,
    });
    expect(s.itr[2]).toMatchObject({ assessmentYear: "2024-25", netProfit: -440000.5, fromComparative: true });
  });

  it("reads 'Not available' as a missing figure, not zero", () => {
    const text = SAMPLE.replace("   9,00,000.00     24,000.00", "   Not available     24,000.00");
    const s = ok(text);
    expect(s.itr[1]?.netProfit).toBeNull();
    expect(s.itr[1]?.depreciation).toBe(24000);
  });

  it("accepts whole-rupee figures with no paise", () => {
    const whole = `GST AND ITR SUMMARY - DEMO TRADERS
Prepared: 30 Oct 2026
GST TAXABLE VALUE  (GSTR-3B Table 3.1(a))
  Jan 2026    Rs.   1,00,000
  Feb 2026    Rs.   2,00,000
  TOTAL       Rs.   3,00,000
  AVG/MONTH   Rs.   1,50,000
ITR  (last 3 assessment years, amounts in Rs.)
  Year              Turnover     Net Profit  Depreciation  Finance Cost
  AY 2025-26    27,48,46,213      13,78,220      5,75,051   1,34,24,169`;
    const s = ok(whole);
    expect(s.total).toBe(300000);
    expect(s.itr[0]?.turnover).toBe(274846213);
  });

  it("refuses a file whose months do not add up to its own TOTAL", () => {
    expect(parseFinancialSummary(SAMPLE.replace("6,00,000.75", "6,10,000.75"))).toBeNull();
  });

  it("refuses text that is not this layout", () => {
    expect(parseFinancialSummary("hello")).toBeNull();
    expect(parseFinancialSummary("")).toBeNull();
    expect(parseFinancialSummary(SAMPLE.replace("Finance Cost", "Interest"))).toBeNull();
  });

  it("refuses an ITR row it cannot read in full", () => {
    expect(parseFinancialSummary(SAMPLE.replace("24,000.00   6,00,000.00", "24,000.00"))).toBeNull();
  });

  it("puts the months in date order and names each one's financial year", () => {
    const text = SAMPLE.replace(/Jan 2026    Rs\.       1,00,000.50\n  Feb 2026    Rs\.       2,00,000.25\n  Mar 2026    Rs\.       3,00,000.00/,
      "Mar 2026    Rs.       3,00,000.00\n  Jan 2026    Rs.       1,00,000.50\n  Feb 2026    Rs.       2,00,000.25");
    const s = ok(text);
    expect(s.months.map((m) => m.label)).toEqual(["Jan 2026", "Feb 2026", "Mar 2026"]);
    expect(s.months.every((m) => m.financialYear === "2025-26")).toBe(true);
  });
});

/** Twelve months, Nov 2025 to Oct 2026, for the filter tests. */
function year(): ParsedSummary["months"] {
  const amounts = [38, 41, 30, 33, 52, 37, 35, 12, 40, 45, 40, 38].map((v) => v * 100000);
  const labels = ["Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026", "Oct 2026"];
  return labels.map((label, i) => {
    const [mon, yr] = label.split(" ") as [string, string];
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(mon);
    const y = Number(yr);
    const fy = month >= 3 ? y : y - 1;
    return { label, short: mon, year: y, month, amount: amounts[i]!, financialYear: `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`, span: 1 };
  });
}

describe("selectMonths", () => {
  const months = year();
  const all = { from: 0, to: 11, excluded: new Set<number>(), belowAverage: false };

  it("totals every month with no filter", () => {
    const r = selectMonths(months, all);
    expect(r.indexes).toHaveLength(12);
    expect(r.total).toBe(44_100_000);
    expect(r.average).toBe(r.total / 12);
  });

  it("limits to a range", () => {
    const r = selectMonths(months, { ...all, from: 6, to: 11 });
    expect(r.indexes).toEqual([6, 7, 8, 9, 10, 11]);
  });

  it("leaves a month out and recomputes the average over what remains", () => {
    const r = selectMonths(months, { ...all, excluded: new Set([7]) });
    expect(r.indexes).toHaveLength(11);
    expect(r.total).toBe(42_900_000);
    expect(r.average).toBeCloseTo(r.total / 11);
  });

  it("keeps only months below the average of the range", () => {
    const r = selectMonths(months, { ...all, belowAverage: true });
    expect(r.indexes.every((i) => months[i]!.amount < r.baseAverage)).toBe(true);
    expect(r.indexes).toContain(7);
    expect(r.indexes).not.toContain(4);
  });

  it("handles an empty selection without dividing by zero", () => {
    const r = selectMonths(months, { ...all, excluded: new Set(months.map((_, i) => i)) });
    expect(r.indexes).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.average).toBe(0);
  });
});

describe("presetsFor", () => {
  it("offers all, last 6, last 3 and each financial year that is only part of the window", () => {
    const p = presetsFor(year());
    expect(p.map((x) => x.id)).toEqual(["all", "last6", "last3", "fy-2025-26", "fy-2026-27"]);
    expect(p.find((x) => x.id === "fy-2025-26")).toMatchObject({ from: 0, to: 4 });
    expect(p.find((x) => x.id === "fy-2026-27")).toMatchObject({ from: 5, to: 11 });
  });

  it("does not offer a preset that equals another", () => {
    const three = year().slice(9);
    expect(presetsFor(three).map((x) => x.id)).toEqual(["all"]);
  });
});

describe("rupee formatting", () => {
  it("groups the Indian way and keeps paise exact", () => {
    expect(rupeeParts(46040998.57)).toEqual({ negative: false, whole: "4,60,40,998", paise: ".57" });
    expect(rupeeParts(100000)).toEqual({ negative: false, whole: "1,00,000", paise: "" });
    expect(rupeeParts(-12.5)).toEqual({ negative: true, whole: "12", paise: ".50" });
    expect(rupeeParts(0.05)).toEqual({ negative: false, whole: "0", paise: ".05" });
  });

  it("says crore and lakh in words", () => {
    expect(rupeesShort(46040998.57)).toBe("4.60 crore");
    expect(rupeesShort(3837000)).toBe("38.37 lakh");
    expect(rupeesShort(99999)).toBe("");
  });
});

describe("a file with a summary for each of several filers", () => {
  const OTHER = SAMPLE.replace("DEMO TRADERS", "DEMO ENERGY (PARTNERSHIP FIRM)")
    .replace("1,00,000.50", "10.00")
    .replace("2,00,000.25", "20.00")
    .replace("3,00,000.00", "30.00")
    .replace(/6,00,000\.75/, "60.00")
    .replace("2,00,000.25", "20.00");
  const TWO = `${SAMPLE}

${OTHER}`;

  it("keeps a single summary exactly as before", () => {
    expect(parseFilerSummaries(SAMPLE)?.map((s) => s.business)).toEqual(["DEMO TRADERS"]);
  });

  it("reads each filer's summary on its own, in the order written", () => {
    const filers = parseFilerSummaries(TWO);
    expect(filers?.map((s) => s.business)).toEqual(["DEMO TRADERS", "DEMO ENERGY (PARTNERSHIP FIRM)"]);
    expect(filers?.map((s) => s.total)).toEqual([600000.75, 60]);
  });

  it("refuses the whole file when any filer's part does not read", () => {
    expect(parseFilerSummaries(`${SAMPLE}
GST AND ITR SUMMARY - BROKEN
nothing here`)).toBeNull();
    expect(parseFilerSummaries("not a summary")).toBeNull();
  });

  it("names every filer", () => {
    expect(summaryBusinessNames(TWO)).toEqual(["DEMO TRADERS", "DEMO ENERGY (PARTNERSHIP FIRM)"]);
  });

  it("still refuses one section holding two blocks, which cannot be told apart", () => {
    const unlabelled = SAMPLE.split("\n").slice(1).join("\n");
    expect(parseFinancialSummary(`${SAMPLE}\n${unlabelled}`)).toBeNull();
  });
});
