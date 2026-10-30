import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { archiveKind, unpackZip } from "./archive.js";

const text = (value: string) => new TextEncoder().encode(value);

describe("archiveKind", () => {
  it("tells zip from the archives PFO cannot open", () => {
    expect(archiveKind("Documents.ZIP")).toBe("zip");
    expect(archiveKind("a.rar")).toBe("unsupported");
    expect(archiveKind("a.7z")).toBe("unsupported");
    expect(archiveKind("a.pdf")).toBeNull();
  });
});

describe("unpackZip", () => {
  it("returns each file with the folder it sat in", () => {
    const bytes = zipSync({ "KYC/PAN.pdf": text("pan"), "GST/GSTR-3B Apr 2025.pdf": text("gst"), "top.jpg": text("top") });
    const result = unpackZip(bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => [f.fileName, f.folder]).sort()).toEqual([
      ["GSTR-3B Apr 2025.pdf", "GST"],
      ["PAN.pdf", "KYC"],
      ["top.jpg", ""],
    ]);
  });

  it("ignores folder entries and the Mac resource folder", () => {
    const bytes = zipSync({ "__MACOSX/._a.pdf": text("junk"), "a.pdf": text("a") });
    const result = unpackZip(bytes);
    expect(result.ok && result.files.map((f) => f.fileName)).toEqual(["a.pdf"]);
  });

  it("refuses an archive that unpacks past the size limit, without unpacking it", () => {
    const bytes = zipSync({ "big.bin": new Uint8Array(2_000_000) });
    const result = unpackZip(bytes, { maxTotalBytes: 1_000_000, maxFiles: 10 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("too large") });
  });

  it("refuses an archive with too many files", () => {
    const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.pdf`, text("x")]));
    const result = unpackZip(zipSync(many), { maxTotalBytes: 1_000_000, maxFiles: 5 });
    expect(result).toEqual({ ok: false, reason: expect.stringContaining("too many") });
  });

  it("says so when the bytes are not a zip", () => {
    expect(unpackZip(text("not a zip"))).toEqual({ ok: false, reason: expect.stringContaining("not a valid zip") });
  });
});
