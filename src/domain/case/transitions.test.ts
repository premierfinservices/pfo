import { describe, expect, it } from "vitest";

import {
  evaluateTransition,
  highestJustifiedStage,
  systemStageFor,
  userSelectableStages,
  type CaseSnapshot,
} from "./transitions.js";
import { CASE_STAGES, LOST_REASONS } from "./stages.js";

const at = (stage: CaseSnapshot["stage"], over: Partial<CaseSnapshot> = {}): CaseSnapshot => ({
  stage,
  justifiedStage: null,
  isInvoiceRaised: false,
  stageBeforeLost: null,
  ...over,
});

describe("the MIS stage list", () => {
  it("has login, and none of the stages before documents are promised", () => {
    expect(CASE_STAGES).toContain("login_completed");
    expect(CASE_STAGES[0]).toBe("documents_pending");
    for (const gone of ["new", "contacted", "appointment_fixed", "submitted"]) {
      expect(CASE_STAGES as readonly string[]).not.toContain(gone);
    }
  });

  it("uses the MIS closure reasons", () => {
    expect(LOST_REASONS).toEqual([
      "not_interested",
      "customer_not_eligible",
      "unreachable",
      "documents_unavailable",
      "duplicate_case",
      "other",
    ]);
  });
});

describe("a person's moves", () => {
  it("runs documents, then eligibility, then collected", () => {
    expect(evaluateTransition(at("documents_pending"), { to: "eligibility_check", actor: "user" }).allowed).toBe(true);
    expect(evaluateTransition(at("eligibility_check"), { to: "documents_pending", actor: "user" }).allowed).toBe(true);
    expect(evaluateTransition(at("eligibility_check"), { to: "documents_collected", actor: "user" }).allowed).toBe(true);
  });

  it("never lets a person set a lender-driven stage", () => {
    expect(evaluateTransition(at("documents_collected"), { to: "login_completed", actor: "user" }).allowed).toBe(false);
    expect(userSelectableStages("documents_collected")).not.toContain("approved");
  });

  it("lets a person set Rejected, because one lender's rejection never does", () => {
    expect(evaluateTransition(at("login_completed"), { to: "rejected", actor: "user" }).allowed).toBe(true);
  });

  it("needs the invoice to close", () => {
    expect(evaluateTransition(at("disbursed"), { to: "closed", actor: "user" }).allowed).toBe(false);
    expect(
      evaluateTransition(at("disbursed", { isInvoiceRaised: true }), { to: "closed", actor: "user" }).allowed,
    ).toBe(true);
  });

  it("needs a reason for Lost, and reopens where it was lost from", () => {
    expect(evaluateTransition(at("eligibility_check"), { to: "lost", actor: "user" }).allowed).toBe(false);
    expect(
      evaluateTransition(at("eligibility_check"), { to: "lost", actor: "user", lostReason: "customer_not_eligible" })
        .allowed,
    ).toBe(true);
    const lost = at("lost", { stageBeforeLost: "eligibility_check" });
    expect(evaluateTransition(lost, { to: "eligibility_check", actor: "user" }).allowed).toBe(true);
    expect(evaluateTransition(lost, { to: "documents_collected", actor: "user" }).allowed).toBe(false);
  });
});

describe("lender updates", () => {
  it("maps each application status to the MIS case stage", () => {
    expect(highestJustifiedStage(["login_completed"])).toBe("login_completed");
    expect(highestJustifiedStage(["under_process"])).toBe("login_completed");
    expect(highestJustifiedStage(["query_raised"])).toBe("query_raised");
    expect(highestJustifiedStage(["eligibility_received"])).toBe("approved");
    expect(highestJustifiedStage(["sanctioned"])).toBe("approved");
    expect(highestJustifiedStage(["sanction_accepted"])).toBe("sanction_accepted");
    expect(highestJustifiedStage(["disbursed"])).toBe("disbursed");
  });

  it("does not move the case when a file is only sent, or is declined", () => {
    expect(
      highestJustifiedStage(["not_submitted", "submitted", "not_eligible_precheck", "rejected", "withdrawn"]),
    ).toBeNull();
  });

  it("takes the furthest of several lenders", () => {
    expect(highestJustifiedStage(["rejected", "login_completed", "sanctioned"])).toBe("approved");
  });

  it("can jump a case on partial documents straight to login", () => {
    expect(systemStageFor(at("documents_pending", { justifiedStage: "login_completed" }))).toBe("login_completed");
    expect(systemStageFor(at("eligibility_check", { justifiedStage: "login_completed" }))).toBe("login_completed");
  });

  it("only moves forward: a later query never pulls Approved back", () => {
    expect(systemStageFor(at("approved", { justifiedStage: "query_raised" }))).toBeNull();
  });

  it("never moves a Rejected, Lost or Closed case", () => {
    for (const stage of ["rejected", "lost", "closed"] as const) {
      expect(systemStageFor(at(stage, { justifiedStage: "disbursed" }))).toBeNull();
    }
  });
});
