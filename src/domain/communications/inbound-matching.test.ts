import { describe, expect, it } from "vitest";

import { matchInboundEmail } from "./inbound-matching.js";

describe("matchInboundEmail", () => {
  it("matches on Gmail thread when the reply landed in a thread PFO started", () => {
    const result = matchInboundEmail({
      fromAddress: "someone.else@hdfcbank.com",
      gmailThreadId: "thread-1",
      outboundThreads: [{ gmailThreadId: "thread-1", loanCaseId: "case-1", bankContactId: "contact-1" }],
      bankContactCandidates: [],
    });

    expect(result).toEqual({ matchedBy: "thread", loanCaseId: "case-1", bankContactId: "contact-1" });
  });

  it("prefers a thread match over a sender match even when both exist", () => {
    const result = matchInboundEmail({
      fromAddress: "karthik@hdfcbank.com",
      gmailThreadId: "thread-1",
      outboundThreads: [{ gmailThreadId: "thread-1", loanCaseId: "case-1", bankContactId: "contact-1" }],
      bankContactCandidates: [
        { bankContactId: "contact-1", workEmail: "karthik@hdfcbank.com", loanCaseId: "case-2", lastSubmittedAt: "2026-09-01T00:00:00Z" },
      ],
    });

    expect(result.matchedBy).toBe("thread");
    expect(result).toMatchObject({ loanCaseId: "case-1" });
  });

  it("falls back to sender address, case-insensitively, when no thread matches", () => {
    const result = matchInboundEmail({
      fromAddress: "Karthik@HDFCBank.com",
      gmailThreadId: "thread-unknown",
      outboundThreads: [],
      bankContactCandidates: [
        { bankContactId: "contact-1", workEmail: "karthik@hdfcbank.com", loanCaseId: "case-1", lastSubmittedAt: "2026-09-01T00:00:00Z" },
      ],
    });

    expect(result).toEqual({ matchedBy: "sender", loanCaseId: "case-1", bankContactId: "contact-1" });
  });

  it("picks the most recently submitted-to case when the same banker has several", () => {
    const result = matchInboundEmail({
      fromAddress: "karthik@hdfcbank.com",
      gmailThreadId: "thread-unknown",
      outboundThreads: [],
      bankContactCandidates: [
        { bankContactId: "contact-1", workEmail: "karthik@hdfcbank.com", loanCaseId: "case-old", lastSubmittedAt: "2026-01-01T00:00:00Z" },
        { bankContactId: "contact-1", workEmail: "karthik@hdfcbank.com", loanCaseId: "case-new", lastSubmittedAt: "2026-09-01T00:00:00Z" },
      ],
    });

    expect(result).toEqual({ matchedBy: "sender", loanCaseId: "case-new", bankContactId: "contact-1" });
  });

  it("matches nothing for an unrecognised sender with no thread match — a valid outcome, not an error", () => {
    const result = matchInboundEmail({
      fromAddress: "unknown@example.com",
      gmailThreadId: "thread-unknown",
      outboundThreads: [{ gmailThreadId: "thread-1", loanCaseId: "case-1", bankContactId: "contact-1" }],
      bankContactCandidates: [
        { bankContactId: "contact-1", workEmail: "karthik@hdfcbank.com", loanCaseId: "case-1", lastSubmittedAt: "2026-09-01T00:00:00Z" },
      ],
    });

    expect(result).toEqual({ matchedBy: "none" });
  });
});
