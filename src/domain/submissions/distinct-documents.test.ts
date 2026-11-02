import { describe, expect, it } from "vitest";

import { onePerDocument, unavailableDocumentsMessage } from "./distinct-documents.js";

describe("onePerDocument", () => {
  it("keeps the first row for a file that backs two requirements, and the order", () => {
    const rows = [
      { documentId: "a", requirementId: "r1" },
      { documentId: "b", requirementId: "r2" },
      { documentId: "a", requirementId: "r3" },
      { documentId: "c", requirementId: "r4" },
    ];
    expect(onePerDocument(rows)).toEqual([
      { documentId: "a", requirementId: "r1" },
      { documentId: "b", requirementId: "r2" },
      { documentId: "c", requirementId: "r4" },
    ]);
  });

  it("leaves a list with no repeats unchanged", () => {
    const rows = [{ documentId: "a" }, { documentId: "b" }];
    expect(onePerDocument(rows)).toEqual(rows);
  });

  it("handles an empty list", () => {
    expect(onePerDocument([])).toEqual([]);
  });
});

describe("unavailableDocumentsMessage", () => {
  it("names a single document", () => {
    expect(unavailableDocumentsMessage(["PAN - Demo.pdf"])).toBe(
      "This document can no longer be sent from this case: PAN - Demo.pdf. Reopen the dialog and choose again.",
    );
  });

  it("names several, in order", () => {
    expect(unavailableDocumentsMessage(["A.pdf", "B.pdf"])).toBe(
      "These documents can no longer be sent from this case: A.pdf, B.pdf. Reopen the dialog and choose again.",
    );
  });

  it("still says something useful when no name could be found", () => {
    expect(unavailableDocumentsMessage([])).toBe(
      "A chosen document can no longer be sent from this case. Reopen the dialog and choose again.",
    );
  });
});
