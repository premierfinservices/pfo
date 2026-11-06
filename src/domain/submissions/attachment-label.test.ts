import { describe, expect, it } from "vitest";

import { attachmentLabel } from "./attachment-label.js";

describe("attachmentLabel", () => {
  it("names a month of GSTR-3B by its month, with no financial year to count", () => {
    expect(
      attachmentLabel({
        documentTypeCode: "gst_returns",
        typeName: "GST 3B",
        periodKind: "financial_year",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
      }),
    ).toEqual({ label: "GSTR-3B Jul 2026" });
  });

  it("labels a whole-year document by its year, as before", () => {
    expect(
      attachmentLabel({
        documentTypeCode: "itr",
        typeName: "ITR",
        periodKind: "assessment_year",
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
      }),
    ).toEqual({ label: "ITR – AY 2025-26", financialYearLabel: "2024-25" });
    expect(
      attachmentLabel({
        documentTypeCode: "gst_returns",
        typeName: "GST 3B",
        periodKind: "financial_year",
        periodStart: "2025-04-01",
        periodEnd: "2026-03-31",
      }),
    ).toEqual({ label: "GST 3B – FY 2025-26", financialYearLabel: "2025-26" });
  });

  it("uses the type name alone for a document with no period", () => {
    expect(
      attachmentLabel({ documentTypeCode: "pan_card", typeName: "PAN Card", periodKind: undefined, periodStart: null, periodEnd: null }),
    ).toEqual({ label: "PAN Card" });
  });
});
