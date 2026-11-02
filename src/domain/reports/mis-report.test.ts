import { describe, expect, it } from "vitest";

import { computeMisReport, periodRange, previousPeriod, type ReportApplication, type ReportCase } from "./mis-report.js";

const person = (id: string) => ({ id, name: id.toUpperCase() });

function aCase(id: string, over: Partial<ReportCase> = {}): ReportCase {
  return {
    id,
    caseNumber: id,
    customerName: null,
    stage: "documents_pending",
    documentStatus: "pending",
    ownerId: "a",
    originalOwnerId: "a",
    leadOn: "2026-10-20",
    amount: 100,
    loanType: "Business Loan",
    leadSource: "Direct Referral",
    ...over,
  };
}

function anApp(id: string, caseId: string, over: Partial<ReportApplication> = {}): ReportApplication {
  return {
    id,
    caseId,
    status: "under_process",
    loginDate: null,
    loginEmployeeId: null,
    sanctionDate: null,
    sanctionAmount: null,
    disbursementDate: null,
    disbursementAmount: null,
    ...over,
  };
}

const base = { people: [person("a"), person("b")], tasks: [], applications: [], from: "2026-10-01", to: "2026-10-31", today: "2026-10-15" };

describe("periods", () => {
  it("matches the MIS's tblPeriods", () => {
    expect(periodRange("today", "2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-02" });
    expect(periodRange("week", "2026-11-02")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // a Monday
    expect(periodRange("week", "2026-11-08")).toEqual({ from: "2026-11-02", to: "2026-11-08" }); // a Sunday
    expect(periodRange("month", "2026-02-10")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodRange("quarter", "2026-11-02")).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(periodRange("fy", "2026-03-31")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(periodRange("fy", "2026-04-01")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(periodRange("nonsense", "2026-11-02")).toBeNull();
  });

  it("compares with the period of the same length just before", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
  });
});

describe("the MIS's definitions", () => {
  it("counts a disbursement only with the status, an amount and a date", () => {
    const report = computeMisReport({
      ...base,
      cases: [aCase("c1"), aCase("c2"), aCase("c3")],
      applications: [
        anApp("x1", "c1", { status: "disbursed", disbursementAmount: 500, disbursementDate: "2026-10-10" }),
        anApp("x2", "c1", { status: "disbursed", disbursementAmount: 300, disbursementDate: "2026-10-11" }),
        anApp("x3", "c2", { status: "disbursed", disbursementAmount: 0, disbursementDate: "2026-10-11" }),
        anApp("x4", "c3", { status: "disbursed", disbursementAmount: 900 }),
      ],
    });
    expect(report.cards.applicationsDisbursed.n).toBe(2);
    expect(report.cards.customersDisbursed.n).toBe(1);
    expect(report.cards.disbursementValue.n).toBe(800);
  });

  it("counts a sanction only with an amount above zero", () => {
    const report = computeMisReport({
      ...base,
      cases: [aCase("c1")],
      applications: [
        anApp("x1", "c1", { sanctionDate: "2026-10-10", sanctionAmount: 500 }),
        anApp("x2", "c1", { sanctionDate: "2026-10-10" }),
        anApp("x3", "c1", { sanctionDate: "2026-09-10", sanctionAmount: 500 }),
      ],
    });
    expect(report.cards.sanctions.n).toBe(1);
    expect(report.cards.sanctionValue.n).toBe(500);
  });

  it("leaves finished applications and closed cases out of what is in progress", () => {
    const report = computeMisReport({
      ...base,
      cases: [aCase("c1"), aCase("c2", { stage: "lost" })],
      applications: [
        anApp("x1", "c1"),
        anApp("x2", "c1", { status: "rejected" }),
        anApp("x3", "c1", { status: "not_eligible_precheck" }),
        anApp("x4", "c2"),
      ],
    });
    expect(report.cards.inProgressApplications.n).toBe(1);
    expect(report.cards.activeCases.n).toBe(1);
  });

  it("does not ask for a next action on a disbursed or rejected case", () => {
    const report = computeMisReport({
      ...base,
      cases: [aCase("c1"), aCase("c2", { stage: "rejected" }), aCase("c3", { stage: "disbursed" }), aCase("c4")],
      tasks: [{ caseId: "c4", assignedTo: "a", dueOn: "2026-10-15" }],
    });
    expect(report.cards.noNextAction.caseIds).toEqual(["c1"]);
    expect(report.cards.awaitingClosureReview.n).toBe(2);
    expect(report.cards.dueToday.n).toBe(1);
  });

  it("separates overdue from due today, and ignores follow-ups on closed cases", () => {
    const report = computeMisReport({
      ...base,
      cases: [aCase("c1"), aCase("c2", { stage: "closed" })],
      tasks: [
        { caseId: "c1", assignedTo: "a", dueOn: "2026-10-14" },
        { caseId: "c1", assignedTo: "a", dueOn: "2026-10-15" },
        { caseId: "c2", assignedTo: "a", dueOn: "2026-10-01" },
      ],
    });
    expect(report.cards.openFollowups.n).toBe(2);
    expect(report.cards.overdueFollowups.n).toBe(1);
    expect(report.cards.dueToday.n).toBe(1);
  });

  it("credits a lead to the original telecaller after the case is reassigned", () => {
    const report = computeMisReport({ ...base, cases: [aCase("c1", { ownerId: "b", originalOwnerId: "a" })] });
    const a = report.telecallers.find((row) => row.id === "a")!;
    const b = report.telecallers.find((row) => row.id === "b")!;
    expect(a.leads.n).toBe(1);
    expect(a.activeNow.n).toBe(0);
    expect(b.leads.n).toBe(0);
    expect(b.activeNow.n).toBe(1);
  });

  it("counts leads by lead date, closed cases included, whatever the view", () => {
    const report = computeMisReport({
      ...base,
      who: "b",
      cases: [aCase("c1", { stage: "lost" }), aCase("c2", { leadOn: "2026-09-30" })],
    });
    expect(report.leadsByLoanType).toEqual([expect.objectContaining({ label: "Business Loan", n: 1, amount: 100 })]);
  });

  it("narrows to one person: their cases, the applications they logged in, their follow-ups", () => {
    const report = computeMisReport({
      ...base,
      who: "a",
      cases: [aCase("c1"), aCase("c2", { ownerId: "b" })],
      applications: [anApp("x1", "c2", { loginEmployeeId: "a" }), anApp("x2", "c1", { loginEmployeeId: "b" })],
      tasks: [{ caseId: "c2", assignedTo: "a", dueOn: null }, { caseId: "c1", assignedTo: "b", dueOn: null }],
    });
    expect(report.cards.activeCases.caseIds).toEqual(["c1"]);
    expect(report.cards.inProgressApplications.n).toBe(1);
    expect(report.cards.openFollowups.n).toBe(1);
  });
});
