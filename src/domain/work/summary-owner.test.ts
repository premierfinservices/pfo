import { describe, expect, it } from "vitest";

import { summaryBelongsTo, summaryBusinessName } from "./financial-summary.js";

describe("summaryBusinessName", () => {
  it("reads the name on the title line", () => {
    expect(summaryBusinessName("GST AND ITR SUMMARY - ACE ASSOCIATES\nPrepared: 24 Oct 2026")).toBe("ACE ASSOCIATES");
  });
  it("copes with a byte-order mark and carriage returns", () => {
    expect(summaryBusinessName("﻿GST AND ITR SUMMARY - ACE ASSOCIATES\r\nPrepared: x")).toBe("ACE ASSOCIATES");
  });
  it("is null when there is no title line", () => {
    expect(summaryBusinessName("TOTAL  Rs. 1,00,000")).toBeNull();
  });
});

describe("summaryBelongsTo", () => {
  it("is false for a different business", () => {
    expect(summaryBelongsTo("ACE ASSOCIATES", ["RVB METAL WORKS"])).toBe(false);
  });
  it("is true for the same name however it is written", () => {
    expect(summaryBelongsTo("M/s. RVB Metal Works", ["RVB METAL WORKS"])).toBe(true);
    expect(summaryBelongsTo("STAR FANCY AND JEWELLERS", ["Star Fancy & Jewellers"])).toBe(true);
  });
  it("ignores company suffixes", () => {
    expect(summaryBelongsTo("ASIA TECH PVT LTD", ["ASIA TECH"])).toBe(true);
  });
  it("is true when one name is the other with something added", () => {
    expect(summaryBelongsTo("RVB METAL WORKS", ["RVB METAL WORKS COIMBATORE"])).toBe(true);
  });
  it("matches any one of the names the case holds", () => {
    expect(summaryBelongsTo("ACE ASSOCIATES", ["JAYALAKSHMI", "ACE ASSOCIATES"])).toBe(true);
  });
  it("does not match on a shared generic word alone", () => {
    expect(summaryBelongsTo("SRI METAL WORKS", ["RVB METAL WORKS"])).toBe(false);
  });
  it("cannot tell when either side has no name", () => {
    expect(summaryBelongsTo(null, ["RVB METAL WORKS"])).toBeNull();
    expect(summaryBelongsTo("ACE ASSOCIATES", [])).toBeNull();
    expect(summaryBelongsTo("PVT LTD", ["RVB METAL WORKS"])).toBeNull();
  });
});
