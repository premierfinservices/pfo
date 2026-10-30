import { describe, expect, it } from "vitest";

import { standardFileName } from "./standard-names.js";

describe("standardFileName", () => {
  it("names a plain document by its type and owner, keeping the extension", () => {
    expect(standardFileName({ typeName: "PAN Card", personName: "DEMO CUSTOMER", originalFileName: "IMG_2231.JPEG" })).toBe(
      "PAN Card - DEMO CUSTOMER.jpeg",
    );
  });

  it("leaves the owner off when the document belongs to no one", () => {
    expect(standardFileName({ typeName: "Sale Deed", originalFileName: "scan 4.pdf" })).toBe("Sale Deed.pdf");
  });

  it("puts the assessment year on an annual document", () => {
    expect(
      standardFileName({
        typeName: "ITR",
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        personName: "DEMO",
        originalFileName: "a.pdf",
      }),
    ).toBe("ITR AY 2025-26 - DEMO.pdf");
  });

  it("uses a monthly return's own name instead of the type name", () => {
    expect(
      standardFileName({ typeName: "GST Returns", monthlyName: "GSTR-3B Apr 2025", originalFileName: "x.pdf" }),
    ).toBe("GSTR-3B Apr 2025.pdf");
  });

  it("drops characters Windows refuses, and collapses spaces", () => {
    expect(standardFileName({ typeName: "P&L / Profit:  Loss", originalFileName: "a.pdf" })).toBe("P&L Profit Loss.pdf");
  });

  it("copes with a file that has no extension", () => {
    expect(standardFileName({ typeName: "Photograph", originalFileName: "photo" })).toBe("Photograph");
  });
});
