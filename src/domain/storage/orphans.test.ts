import { describe, expect, it } from "vitest";
import { classifyStoredFiles } from "./orphans.js";

const UUID_A = "8f2c1e4a-0b6d-4c3e-9a71-2d5f8e9b0c14";
const UUID_B = "a91d7c33-5e2f-4b80-8c16-7f0e3d2a9b58";

describe("classifyStoredFiles", () => {
  it("treats a referenced document and its sidecar as neither orphan nor missing", () => {
    const doc = `person/${UUID_A}/pan/v1-pan.pdf`;
    const result = classifyStoredFiles([doc, `${doc}.meta.json`], [doc]);
    expect(result.referencedPresent).toEqual([doc]);
    expect(result.referencedMissing).toEqual([]);
    expect(result.orphans).toEqual([]);
  });

  it("classifies a non-UUID owner id as prototype, keeping its sidecar with it", () => {
    const doc = "person/per_001/pan/v1-ravi-pan.pdf";
    const result = classifyStoredFiles([doc, `${doc}.meta.json`], []);
    expect(result.orphans).toEqual([{ path: doc, sidecar: `${doc}.meta.json`, kind: "prototype" }]);
  });

  it("classifies an unreferenced UUID owner as unreferenced-uuid, not prototype", () => {
    const doc = `organisation/${UUID_B}/gst_returns/2024_25/v1-gstr.pdf`;
    const result = classifyStoredFiles([doc], []);
    expect(result.orphans).toEqual([{ path: doc, sidecar: null, kind: "unreferenced-uuid" }]);
  });

  it("reports a sidecar whose document is gone as its own orphan", () => {
    const sidecar = "person/per_002/aadhaar/v1-a.pdf.meta.json";
    const result = classifyStoredFiles([sidecar], []);
    expect(result.orphans).toEqual([{ path: sidecar, sidecar: null, kind: "prototype" }]);
  });

  it("does not orphan the sidecar of a referenced document whose bytes are missing", () => {
    const doc = `person/${UUID_A}/pan/v2-pan.pdf`;
    const result = classifyStoredFiles([`${doc}.meta.json`], [doc]);
    expect(result.referencedMissing).toEqual([doc]);
    expect(result.orphans).toEqual([]);
  });

  it("marks anything not shaped like an owner path as unrecognised", () => {
    const result = classifyStoredFiles(["desktop.ini", "scans/x.pdf"], []);
    expect(result.orphans.map((o) => o.kind)).toEqual(["unrecognised", "unrecognised"]);
  });
});
