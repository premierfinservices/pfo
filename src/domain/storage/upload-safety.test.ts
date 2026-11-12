import { describe, expect, it } from "vitest";

import { contentTypeFor, isShownInline, uploadRefusal } from "./upload-safety.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const PDF = bytes("%PDF-1.7\n...");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);

describe("uploadRefusal", () => {
  it("accepts a real PDF and real images", () => {
    expect(uploadRefusal("PAN.pdf", PDF)).toBeNull();
    expect(uploadRefusal("photo.png", PNG)).toBeNull();
    expect(uploadRefusal("IMG_2231.JPEG", JPEG)).toBeNull();
  });

  it("accepts a PDF with a little junk before its header", () => {
    expect(uploadRefusal("scan.pdf", bytes("\n\n junk %PDF-1.4"))).toBeNull();
  });

  it("accepts a phone's PNG that was named .jpg", () => {
    expect(uploadRefusal("WhatsApp Image.jpg", PNG)).toBeNull();
  });

  it("accepts types nobody listed, and a bank's HTML table named .xls", () => {
    expect(uploadRefusal("statement.xls", bytes("<html><table>"))).toBeNull();
    expect(uploadRefusal("GST and ITR Summary.txt", bytes("Total"))).toBeNull();
    expect(uploadRefusal("ledger.tally", bytes("anything"))).toBeNull();
    expect(uploadRefusal("no extension", bytes("anything"))).toBeNull();
  });

  it.each(["setup.exe", "run.bat", "macro.xlsm", "page.html", "logo.svg", "a.pdf.js", "link.lnk"])(
    "refuses %s by its extension",
    (name) => {
      expect(uploadRefusal(name, bytes("anything"))).toMatch(/does not store/);
    },
  );

  it("is not fooled by case, or by the trailing dots and spaces Windows drops", () => {
    expect(uploadRefusal("SETUP.EXE", bytes("x"))).not.toBeNull();
    expect(uploadRefusal("setup.exe. ", bytes("x"))).not.toBeNull();
  });

  it("refuses a Windows program under any name", () => {
    expect(uploadRefusal("Bank Statement.pdf", bytes("MZ\x90\x00"))).toMatch(/program/);
    expect(uploadRefusal("notes.txt", bytes("MZ\x90\x00"))).toMatch(/program/);
  });

  it("refuses a file named as a PDF or an image that is not one", () => {
    expect(uploadRefusal("PAN.pdf", bytes("<html><script>alert(1)</script>"))).toMatch(/not one/);
    expect(uploadRefusal("photo.jpg", bytes("<svg onload=alert(1)>"))).toMatch(/not one/);
  });
});

describe("contentTypeFor", () => {
  it("answers from the name alone, and says nothing it does not know", () => {
    expect(contentTypeFor("PAN.PDF")).toBe("application/pdf");
    expect(contentTypeFor("photo.jpeg")).toBe("image/jpeg");
    expect(contentTypeFor("page.html")).toBe("application/octet-stream");
    expect(contentTypeFor("no extension")).toBe("application/octet-stream");
  });
});

describe("isShownInline", () => {
  it("is true only for PDFs and images a browser renders", () => {
    expect(isShownInline("a.pdf")).toBe(true);
    expect(isShownInline("a.png")).toBe(true);
    expect(isShownInline("a.heic")).toBe(false);
    expect(isShownInline("a.docx")).toBe(false);
    expect(isShownInline("a.html")).toBe(false);
  });
});
