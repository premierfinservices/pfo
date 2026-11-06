import { describe, expect, it } from "vitest";

import { amountInWords, capitals, normaliseMobile, parseAmount, productCodeFor } from "./intake.js";
import { nextStepLine, shortDate, workFor } from "./rules.js";

describe("parsing, as Log a Case does", () => {
  it.each([
    ["2500000", 2500000],
    ["25,00,000", 2500000],
    ["25L", 2500000],
    ["25 lakh", 2500000],
    ["1.5cr", 15000000],
    ["1.5 crore", 15000000],
    ["₹ 5,00,000", 500000],
    ["50k", 50000],
  ])("reads %s", (text, rupees) => expect(parseAmount(text)).toBe(rupees));

  it.each(["", "abc", "0", "-5", "12x"])("refuses %s", (text) => expect(parseAmount(text)).toBeNull());

  it("words an amount the Indian way", () => {
    expect(amountInWords(2500000)).toBe("Twenty Five Lakh Rupees");
    expect(amountInWords(15000000)).toBe("One Crore Fifty Lakh Rupees");
    expect(amountInWords(123456)).toBe("One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees");
    expect(amountInWords(0)).toBe("");
  });

  it("takes 10-digit mobiles starting 6 to 9", () => {
    expect(normaliseMobile("98765 43210")).toBe("9876543210");
    expect(normaliseMobile("+91 98765-43210")).toBe("9876543210");
    expect(normaliseMobile("09876543210")).toBe("9876543210");
    expect(normaliseMobile("5876543210")).toBeNull();
    expect(normaliseMobile("98765")).toBeNull();
  });

  it("stores names and places in capitals", () => {
    expect(capitals("  r.s.  puram ")).toBe("R.S. PURAM");
  });

  it("picks the personal loan by employment", () => {
    expect(productCodeFor("Personal Loan", "salaried")).toBe("pl");
    expect(productCodeFor("Personal Loan", "proprietorship")).toBe("pl_self_employed");
    expect(productCodeFor("Home Loan", "salaried")).toBe("hl_purchase");
    expect(productCodeFor("Nonsense", "salaried")).toBeNull();
  });
});

describe("what each action leaves to do", () => {
  it("logging a case raises Collect documents on the pickup date, for the telecaller", () => {
    expect(workFor({ type: "case_logged", due: "2026-11-02" }).create).toMatchObject({
      kind: "collect_documents",
      due: "2026-11-02",
      assignee: "owner",
    });
  });

  it("partly received means check eligibility today", () => {
    const plan = workFor({ type: "documents_part" });
    expect(plan.closeScope).toBe("case");
    expect(plan.create).toMatchObject({ kind: "check_eligibility", due: 0, assignee: "owner" });
  });

  it("fully received still asks eligibility when unanswered, else goes to lenders", () => {
    expect(workFor({ type: "documents_all", eligible: false }).create?.kind).toBe("check_eligibility");
    expect(workFor({ type: "documents_all", eligible: true }).create?.kind).toBe("send_to_lenders");
  });

  it("eligible collects the rest, or sends if all in", () => {
    expect(workFor({ type: "eligible", documentsComplete: false, due: "2026-11-02" }).create).toMatchObject({
      kind: "collect_remaining_documents",
      due: "2026-11-02",
    });
    expect(workFor({ type: "eligible", documentsComplete: true }).create?.kind).toBe("send_to_lenders");
  });

  it("not eligible or dropped closes everything and raises nothing", () => {
    for (const type of ["not_eligible", "dropped"] as const) {
      const plan = workFor({ type });
      expect(plan.closeScope).toBe("all");
      expect(plan.create).toBeUndefined();
    }
  });

  it("sending raises Confirm login in two days", () => {
    const plan = workFor({ type: "sent_to_lender", bank: "Demo Bank", submissionId: "s1" });
    // Sending ends collection, so the Next line moves on to the lender.
    expect(plan.closeKinds).toEqual([
      "collect_documents",
      "collect_remaining_documents",
      "check_eligibility",
      "send_to_lenders",
    ]);
    expect(plan.create).toMatchObject({ title: "Confirm login with Demo Bank", due: 2, submissionId: "s1" });
  });

  it("a query goes to the login employee, due in two days", () => {
    expect(workFor({ type: "query_raised", bank: "Demo Bank", submissionId: "s1" }).create).toMatchObject({
      title: "Resolve query from Demo Bank",
      due: 2,
      assignee: "login_employee",
    });
  });

  it("a finished application closes only its own tasks", () => {
    const plan = workFor({ type: "application_finished", submissionId: "s1" });
    expect(plan.closeSubmissionId).toBe("s1");
    expect(plan.closeScope).toBeUndefined();
  });
});

describe("the Next line", () => {
  it("names the task, the date and the person", () => {
    expect(
      nextStepLine({
        stage: "documents_pending",
        openTasks: [{ title: "Collect remaining documents", dueOn: "2026-11-02", assigneeName: "Chinna" }],
      }),
    ).toBe("Next: Collect remaining documents. Due 2 Nov. Chinna.");
  });

  it("speaks plainly with no open task", () => {
    expect(nextStepLine({ stage: "login_completed", openTasks: [], waitingOnBank: "Demo Bank" })).toBe(
      "Waiting on Demo Bank. Update the application when you hear from them.",
    );
    expect(nextStepLine({ stage: "lost", openTasks: [], lostReason: "customer_not_eligible" })).toBe(
      "Case closed as not eligible. Nothing further. Reopen if this changes.",
    );
    expect(nextStepLine({ stage: "disbursed", openTasks: [] })).toBe(
      "Disbursement recorded. Next: raise the invoice.",
    );
  });

  it("formats dates", () => expect(shortDate("2026-11-02")).toBe("2 Nov"));
});
