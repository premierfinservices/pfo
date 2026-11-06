import { describe, expect, it } from "vitest";

import { classifyCaseFile, monthlyReturnName, partyForFile, type FileKind } from "./file-names.js";

function typeOf(kind: FileKind): string {
  return kind.kind === "document" ? kind.match.documentTypeCode : kind.kind;
}

describe("reading organize's file names", () => {
  it.each([
    ["Aadhaar - Demo.jpeg", "aadhaar_card"],
    ["Aadhaar and PAN - Demo.pdf", "aadhaar_card"],
    ["PAN - Demo.pdf", "pan_card"],
    ["PAN .jpeg", "pan_card"],
    ["Photo - Demo.jpg", "photograph"],
    ["Canara Bank - CC Statement - Demo Traders - Apr 2025 to Mar 2026.pdf", "bank_statement"],
    ["Demo Lender - LAP Statement - Demo Traders - May 2026.pdf", "existing_loan_statement"],
    ["Demo Lender - LAP Welcome Letter - Demo Traders - May 2021.pdf", "existing_loan_statement"],
    ["GST Certificate - Demo Traders.pdf", "gst_certificate"],
    ["GST Certificate - Demo Traders - Annexure A.pdf", "gst_certificate"],
    ["Udyam Certificate - Demo Traders - Page 1.pdf", "udyam_certificate"],
    ["Settlement Deed - Demo - Feb 2024.pdf", "other_document"],
    ["Sale Deed - Demo - Jan 2010 - Page 03.jpg", "sale_deed"],
    ["Patta Chitta - Demo - Jan 2010.pdf", "patta_chitta"],
    ["Property Tax Receipt (Vacant Land) - Demo - Jan 2026.pdf", "property_tax_receipt"],
    ["Demo Bank - LAP Sanction Letter - Demo - May 2021.pdf", "sanction_letter"],
  ])("%s", (name, expected) => expect(typeOf(classifyCaseFile(name))).toBe(expected));

  it("reads a monthly 3B, in both namings, to its own month", () => {
    for (const name of ["GSTR-3B Apr 2025.pdf", "GSTR3B_00AAAAA0000A0Z0_042025.pdf"]) {
      const kind = classifyCaseFile(name);
      expect(kind).toMatchObject({
        kind: "document",
        match: { documentTypeCode: "gst_returns", isMonthlyReturn: true, periodStart: "2025-04-01", periodEnd: "2025-04-30" },
      });
    }
    expect(classifyCaseFile("GSTR-3B Feb 2024.pdf")).toMatchObject({ match: { periodEnd: "2024-02-29" } });
  });

  it("reads a month in the GST folder, however it is written", () => {
    for (const [name, folder] of [["Apr 2025.pdf", "GST"], ["April-25.pdf", "GST"], ["GST3B Apr 2025.pdf", ""]] as const) {
      expect(classifyCaseFile(name, folder)).toMatchObject({ match: { isMonthlyReturn: true, periodStart: "2025-04-01" } });
    }
    expect(typeOf(classifyCaseFile("GST Certificate Apr 2025.pdf", "GST"))).toBe("gst_certificate");
  });

  it("files a GSTR-1 or other non-3B return as Other Document under its own name, in or out of the GST folder", () => {
    for (const name of ["GSTR-1 Jan 2026.pdf", "GSTR1 Jan 2026.pdf", "GSTR-9 Mar 2026.pdf", "GSTR 2A Feb 2026.pdf"]) {
      for (const folder of ["GST", ""]) {
        const kind = classifyCaseFile(name, folder);
        expect(kind).toMatchObject({
          kind: "document",
          match: { documentTypeCode: "other_document", recognised: true, keepsOwnName: true },
        });
        expect((kind as { match: { isMonthlyReturn?: boolean } }).match.isMonthlyReturn).toBeUndefined();
      }
    }
    expect(classifyCaseFile("GSTR-3B Jan 2026.pdf", "GST")).toMatchObject({ match: { isMonthlyReturn: true } });
    expect(typeOf(classifyCaseFile("portal download.pdf", "GST"))).toBe("gst_returns");
  });

  it("reads an ITR to the financial year its assessment year covers", () => {
    for (const name of ["ITR AY 2025-26 - Demo.pdf", "ITR 2025-26.pdf"]) {
      expect(classifyCaseFile(name)).toMatchObject({
        match: { documentTypeCode: "itr", periodStart: "2024-04-01", periodEnd: "2025-03-31" },
      });
    }
  });

  it.each([
    ["ITR Computation AY 2025-26 - Demo.pdf", "computation_income"],
    ["Computation 2025-26.pdf", "computation_income"],
    ["ITR AY 2025-26 - Balance Sheet.pdf", "balance_sheet"],
    ["Balance Sheet AY 2025-26 - Demo.pdf", "balance_sheet"],
    ["P&L AY 2025-26.pdf", "profit_and_loss"],
    ["Profit and Loss FY 2024-25 - Demo.pdf", "profit_and_loss"],
  ])("files a separate ITR part under its own year: %s", (name, code) => {
    expect(classifyCaseFile(name)).toMatchObject({ match: { documentTypeCode: code, periodStart: "2024-04-01" } });
  });

  it("recognises the generated files, and takes the summary", () => {
    expect(classifyCaseFile("Pending Documents.txt").kind).toBe("skip");
    expect(classifyCaseFile("GST and ITR Summary.txt").kind).toBe("financial_summary");
    expect(classifyCaseFile("old stuff.rar").kind).toBe("skip");
  });

  it("uses the folder when the name says nothing, and never drops a file", () => {
    expect(typeOf(classifyCaseFile("DOC-2026-WA0016.pdf", "BANK DOCUMENTS"))).toBe("bank_statement");
    const unknown = classifyCaseFile("DOC-2026-WA0016.pdf", "LOAN DOCUMENTS");
    expect(unknown).toMatchObject({ kind: "document", match: { documentTypeCode: "other_document", recognised: false } });
  });

  it("names a month's return", () => expect(monthlyReturnName("2025-04-01")).toBe("GSTR-3B Apr 2025"));
});

describe("partyForFile (ADR-049)", () => {
  const parties = [
    { id: "applicant", name: "RAVI KUMAR", isPrimary: true },
    { id: "spouse", name: "LAKSHMI DEVI", isPrimary: false },
  ];

  it("files a document under the co-applicant whose whole name is in the file name", () => {
    expect(partyForFile("PAN - LAKSHMI DEVI.pdf", parties)).toBe("spouse");
    expect(partyForFile("aadhaar_lakshmi_devi_front.jpg", parties)).toBe("spouse");
  });

  it("keeps everything else with the applicant, including a partial name", () => {
    expect(partyForFile("PAN - RAVI KUMAR.pdf", parties)).toBe("applicant");
    expect(partyForFile("PAN - LAKSHMI.pdf", parties)).toBe("applicant");
    expect(partyForFile("PAN.pdf", parties)).toBe("applicant");
  });

  it("never gives the applicant's own document to a co-applicant whose name is part of theirs", () => {
    const short = [parties[0]!, { id: "son", name: "KUMAR", isPrimary: false }];
    expect(partyForFile("PAN - RAVI KUMAR.pdf", short)).toBe("applicant");
    expect(partyForFile("PAN - KUMAR.pdf", short)).toBe("son");
  });

  it("answers null when the case has no party", () => {
    expect(partyForFile("PAN.pdf", [])).toBeNull();
  });
});
