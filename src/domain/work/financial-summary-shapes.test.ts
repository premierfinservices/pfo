import { describe, expect, it } from "vitest";

import { parseFinancialSummary, presetsFor, selectMonths, type ParsedSummary } from "./financial-summary.js";

// Shapes seen in real case folders. Every figure here is invented.

function ok(text: string): ParsedSummary {
  const parsed = parseFinancialSummary(text);
  if (!parsed) throw new Error("expected the summary to parse");
  return parsed;
}

const TOP = `GST AND ITR SUMMARY - DEMO TRADERS
Prepared: 30 Oct 2026
`;
const ITR_HEAD = `
ITR  (last 3 assessment years, amounts in Rs.)
  Year              Turnover     Net Profit  Depreciation  Finance Cost
`;
const GST_THREE = `
GST TAXABLE VALUE  (GSTR-3B Table 3.1(a))
  Jan 2026    Rs.       1,00,000.00
  Feb 2026    Rs.       2,00,000.00
  Mar 2026    Rs.       3,00,000.00
  TOTAL       Rs.       6,00,000.00
  AVG/MONTH   Rs.       2,00,000.00
`;
const ONE_ROW = "  AY 2025-26    50,00,000     4,00,000     10,000     20,000";

describe("parseFinancialSummary, shapes from real files", () => {
  it("reads quarterly returns as three months each", () => {
    const text = `${TOP}
GST TAXABLE VALUE  (GSTR-3B Table 3.1(a), quarterly returns)
Oct 2025 to Sep 2026
  Oct-Dec 2025  Rs.      1,00,000.00
  Jan-Mar 2026  Rs.      2,00,000.00
  Apr-Jun 2026  Rs.      3,00,000.00
  Jul-Sep 2026  Rs.      4,00,000.00
  TOTAL         Rs.     10,00,000.00
  AVG/MONTH     Rs.        83,333.33
${ITR_HEAD}${ONE_ROW}`;
    const s = ok(text);
    expect(s.months).toHaveLength(4);
    expect(s.months.map((m) => m.span)).toEqual([3, 3, 3, 3]);
    expect(s.months[0]).toMatchObject({ label: "Oct-Dec 2025", short: "Oct–Dec", month: 9, year: 2025, financialYear: "2025-26" });
    expect(s.total).toBe(1000000);
  });

  it("reads Nil, N/A, NA (44AD) and Not in P&L cells without failing", () => {
    const text = `${TOP}${GST_THREE}${ITR_HEAD}  AY 2025-26    50,00,000     4,00,000          Nil     NA (44AD)
  AY 2024-25    40,00,000     3,00,000          N/A    Not in P&L
  AY 2023-24 Not available Not available Not available Not available`;
    const s = ok(text);
    expect(s.itr[0]).toMatchObject({ depreciation: 0, financeCost: null });
    expect(s.itr[1]).toMatchObject({ depreciation: null, financeCost: null, netProfit: 300000 });
    expect(s.itr[2]).toMatchObject({ turnover: null, netProfit: null });
  });

  it("reads a Presumptive column as presumptive income, and keeps the file's footnote", () => {
    const text = `${TOP}${GST_THREE}
ITR  (last 2 assessment years, amounts in Rs.)
  Year              Turnover    Presumptive*  Depreciation  Finance Cost
  AY 2025-26       30,00,000       2,40,000           N/A           N/A
  AY 2024-25       28,00,000       2,24,000           N/A           N/A
  * Presumptive income u/s 44AD (ITR-4); no P&L filed.`;
    const s = ok(text);
    expect(s.itr.every((y) => y.profitKind === "presumptive")).toBe(true);
    expect(s.itr[0]?.netProfit).toBe(240000);
    expect(s.itrFootnotes).toEqual(["Presumptive income u/s 44AD (ITR-4); no P&L filed."]);
  });

  it("keeps a PARTIAL line from the file", () => {
    const text = `${TOP}PARTIAL: GST covers 3 months only (Jan 2026 to Mar 2026)${GST_THREE}${ITR_HEAD}${ONE_ROW}`;
    expect(ok(text).partial).toBe("GST covers 3 months only (Jan 2026 to Mar 2026)");
  });

  it("shows the original text for a file with two GST blocks or two filers", () => {
    expect(parseFinancialSummary(`${TOP}${GST_THREE}${GST_THREE}${ITR_HEAD}${ONE_ROW}`)).toBeNull();
    expect(parseFinancialSummary(`${TOP}${GST_THREE}${ITR_HEAD}${ONE_ROW}${ITR_HEAD}${ONE_ROW}`)).toBeNull();
  });

  it("copes with a byte-order mark and doubled carriage returns (as Windows tools write them)", () => {
    const plain = `${TOP}${GST_THREE}${ITR_HEAD}${ONE_ROW}`;
    const crcrlf = plain.replace(/\n/g, "\r\r\n");
    expect(ok(`﻿${crcrlf}`).business).toBe("DEMO TRADERS");
    expect(ok(crcrlf).itr).toHaveLength(1);
    expect(ok(plain.replace(/\n/g, "\r\n")).total).toBe(600000);
  });

  it("reads a figure marked with a footnote asterisk", () => {
    const text = `${TOP}${GST_THREE}${ITR_HEAD}  AY 2025-26    50,00,000     4,00,000*     10,000     20,000
  * Taken from the comparative column.`;
    const s = ok(text);
    expect(s.itr[0]?.netProfit).toBe(400000);
    expect(s.itrFootnotes).toEqual(["Taken from the comparative column."]);
  });

  it("refuses an ITR cell it does not recognise", () => {
    expect(parseFinancialSummary(`${TOP}${GST_THREE}${ITR_HEAD}  AY 2025-26    50,00,000     4,00,000     maybe     20,000`)).toBeNull();
  });
});

describe("periods that are quarters, and windows longer than a year", () => {
  const quarters = [
    { label: "Oct-Dec 2025", year: 2025, month: 9, amount: 100, financialYear: "2025-26", span: 3 },
    { label: "Jan-Mar 2026", year: 2026, month: 0, amount: 200, financialYear: "2025-26", span: 3 },
    { label: "Apr-Jun 2026", year: 2026, month: 3, amount: 300, financialYear: "2026-27", span: 3 },
    { label: "Jul-Sep 2026", year: 2026, month: 6, amount: 400, financialYear: "2026-27", span: 3 },
  ].map((q) => ({ ...q, short: q.label.slice(0, 7) }));

  it("averages per month, not per return", () => {
    const r = selectMonths(quarters, { from: 0, to: 3, excluded: new Set(), belowAverage: false });
    expect(r.total).toBe(1000);
    expect(r.monthsCounted).toBe(12);
    expect(r.average).toBeCloseTo(1000 / 12);
  });

  it("offers last 6 and last 3 months as 2 and 1 quarters", () => {
    const p = presetsFor(quarters);
    expect(p.find((x) => x.id === "last6")).toMatchObject({ from: 2, to: 3 });
    expect(p.find((x) => x.id === "last3")).toMatchObject({ from: 3, to: 3 });
    expect(p[0]?.label).toBe("All 12 months");
  });

  it("offers last 12 months first when the file has more", () => {
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const months = Array.from({ length: 24 }, (_, i) => {
      const count = 10 + i; // Nov 2024 is the first month
      const mon = MONTHS[count % 12]!;
      const y = 2024 + Math.floor(count / 12);
      const month = count % 12;
      const fy = month >= 3 ? y : y - 1;
      return {
        label: `${mon} ${y}`,
        short: mon,
        year: y,
        month,
        amount: 100,
        financialYear: `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`,
        span: 1,
      };
    });
    const p = presetsFor(months);
    expect(p.map((x) => x.id).slice(0, 4)).toEqual(["last12", "all", "last6", "last3"]);
    expect(p[0]).toMatchObject({ from: 12, to: 23, label: "Last 12 months" });
    expect(p[1]?.label).toBe("All 24 months");
  });
});
