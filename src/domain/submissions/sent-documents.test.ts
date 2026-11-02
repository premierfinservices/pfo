import { describe, expect, it } from "vitest";

import { sentDocumentReport, type OfferedDocument, type SentPackage } from "./sent-documents.js";

const doc = (id: string, extra: Partial<OfferedDocument> = {}): OfferedDocument => ({
  documentId: id,
  fileName: `${id}.pdf`,
  label: `Type ${id}`,
  ...extra,
});

const email = (
  status: "pending" | "sent" | "failed",
  ids: string[],
  failureMessage: string | null = null,
): SentPackage["emails"][number] => ({
  status,
  failureMessage,
  documents: ids.map((id) => ({ documentId: id, fileName: `${id}.pdf` })),
});

describe("sentDocumentReport", () => {
  it("counts every document in a sent email as sent, and none as not sent", () => {
    const r = sentDocumentReport([{ emails: [email("sent", ["a", "b"]), email("sent", ["c"])] }], [doc("a"), doc("b"), doc("c")]);
    expect(r.sent.map((d) => d.documentId)).toEqual(["a", "b", "c"]);
    expect(r.notSent).toEqual([]);
  });

  it("names a document whose email failed, with the failure", () => {
    const r = sentDocumentReport(
      [{ emails: [email("sent", ["a"]), email("failed", ["b", "c"], "mailbox full")] }],
      [doc("a"), doc("b"), doc("c")],
    );
    expect(r.sent.map((d) => d.documentId)).toEqual(["a"]);
    expect(r.notSent.map((d) => [d.documentId, d.reason])).toEqual([
      ["b", "Its email failed: mailbox full"],
      ["c", "Its email failed: mailbox full"],
    ]);
  });

  it("says a document that was never put in an email was left out", () => {
    const r = sentDocumentReport([{ emails: [email("sent", ["a"])] }], [doc("a"), doc("b")]);
    expect(r.notSent).toEqual([expect.objectContaining({ documentId: "b", reason: "Not included in any email to this lender" })]);
  });

  it("gives the reason a document was too large to send", () => {
    const r = sentDocumentReport([], [doc("a", { blockedBecause: "Larger than one email can carry" })]);
    expect(r.notSent[0]).toMatchObject({ documentId: "a", reason: "Larger than one email can carry" });
  });

  it("treats a document as sent if any package sent it, even if an older one failed", () => {
    const r = sentDocumentReport(
      [{ emails: [email("sent", ["a"])] }, { emails: [email("failed", ["a"], "timeout")] }],
      [doc("a")],
    );
    expect(r.sent.map((d) => d.documentId)).toEqual(["a"]);
    expect(r.notSent).toEqual([]);
  });

  it("says nothing was sent when no package exists", () => {
    const r = sentDocumentReport([], [doc("a"), doc("b")]);
    expect(r.sent).toEqual([]);
    expect(r.notSent).toHaveLength(2);
    expect(r.anySent).toBe(false);
  });

  it("keeps a sent document that is no longer offered (replaced or removed since)", () => {
    const r = sentDocumentReport([{ emails: [email("sent", ["gone"])] }], [doc("a")]);
    expect(r.sent.map((d) => d.fileName)).toEqual(["gone.pdf"]);
    expect(r.notSent.map((d) => d.documentId)).toEqual(["a"]);
  });
});
