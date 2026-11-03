import { describe, expect, it } from "vitest";
import { deriveStatusLine, type StatusLineApplication } from "./status-line.js";

const app = (status: string, over: Partial<StatusLineApplication> = {}): StatusLineApplication => ({
  bank: "Kotak",
  status,
  sentAt: "2026-11-02T10:00:00+05:30",
  loginDate: null,
  ...over,
});
const line = (apps: StatusLineApplication[], stage = "documents_pending", isOnHold = false) =>
  deriveStatusLine({ stage, isOnHold, applications: apps });

describe("the status line beside the stage badge", () => {
  it("says nothing when no lender holds the file", () => {
    expect(line([])).toBeNull();
    expect(line([app("not_submitted"), app("rejected"), app("withdrawn"), app("not_eligible_precheck")])).toBeNull();
  });

  it("says where a sent file is waiting", () => {
    expect(line([app("submitted")])).toBe("Sent to Kotak 2 Nov, waiting for login");
  });

  it("reports the furthest-along lender and counts the rest", () => {
    expect(line([app("submitted"), app("sanctioned", { bank: "HDFC" }), app("under_process", { bank: "Axis" })])).toBe(
      "Sanctioned by HDFC (and 2 other lenders)",
    );
    expect(line([app("login_completed", { loginDate: "2026-11-03" }), app("rejected", { bank: "Axis" })])).toBe("Logged in at Kotak 3 Nov");
    expect(line([app("submitted"), app("query_raised", { bank: "Axis" })])).toBe("Axis has raised a query (and 1 other lender)");
  });

  it("never invents a date or a lender", () => {
    expect(line([app("submitted", { bank: null, sentAt: null })])).toBe("Sent to a lender, waiting for login");
  });

  it("shows a hold, and stays silent on closed or lost cases", () => {
    expect(line([], "documents_pending", true)).toBe("On hold");
    expect(line([app("submitted")], "documents_pending", true)).toBe("On hold. Sent to Kotak 2 Nov, waiting for login");
    expect(line([app("disbursed")], "closed")).toBeNull();
    expect(line([app("submitted")], "lost")).toBeNull();
  });
});
