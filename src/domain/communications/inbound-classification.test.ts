import { describe, expect, it } from "vitest";

import { buildClassificationPrompt, extractResponseText, parseClassificationResponse } from "./inbound-classification.js";

describe("buildClassificationPrompt", () => {
  it("lists every candidate document type by code and name", () => {
    const prompt = buildClassificationPrompt([
      { code: "bank_statement", name: "Bank Statement" },
      { code: "itr", name: "Income Tax Return" },
    ]);

    expect(prompt).toContain("bank_statement: Bank Statement");
    expect(prompt).toContain("itr: Income Tax Return");
  });
});

describe("extractResponseText", () => {
  it("joins every text content block", () => {
    const text = extractResponseText({
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    });
    expect(text).toBe("hello world");
  });

  it("returns an empty string for a response with no content blocks", () => {
    expect(extractResponseText({})).toBe("");
    expect(extractResponseText(null)).toBe("");
  });
});

describe("parseClassificationResponse", () => {
  it("parses a well-formed JSON response", () => {
    const result = parseClassificationResponse(
      JSON.stringify({
        documentTypeCode: "bank_statement",
        confidence: 0.92,
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        extractedFields: { accountNumber: "1234" },
        reasoning: "Header says Bank Statement.",
      }),
      { raw: true },
    );

    expect(result).toEqual({
      documentTypeCode: "bank_statement",
      confidence: 0.92,
      periodStart: "2026-01-01",
      periodEnd: "2026-03-31",
      extractedFields: { accountNumber: "1234" },
      reasoning: "Header says Bank Statement.",
      rawModelResponse: { raw: true },
    });
  });

  it("extracts JSON even when the model wraps it in prose or a code fence", () => {
    const result = parseClassificationResponse(
      'Sure, here you go:\n```json\n{"documentTypeCode":"itr","confidence":0.7,"reasoning":"looks like an ITR"}\n```',
      null,
    );
    expect(result.documentTypeCode).toBe("itr");
    expect(result.confidence).toBe(0.7);
  });

  it("degrades to zero confidence, not a throw, on unparseable text", () => {
    const result = parseClassificationResponse("not json at all", { junk: true });
    expect(result.confidence).toBe(0);
    expect(result.documentTypeCode).toBeNull();
    expect(result.rawModelResponse).toEqual({ junk: true });
  });

  it("clamps an out-of-range confidence into [0, 1]", () => {
    const result = parseClassificationResponse(JSON.stringify({ confidence: 5, reasoning: "x" }), null);
    expect(result.confidence).toBe(1);
  });

  it("defaults documentTypeCode to null when the model omits it", () => {
    const result = parseClassificationResponse(JSON.stringify({ confidence: 0.3, reasoning: "unsure" }), null);
    expect(result.documentTypeCode).toBeNull();
  });
});
