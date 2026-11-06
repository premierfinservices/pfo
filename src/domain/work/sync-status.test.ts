import { describe, expect, it } from "vitest";

import { syncWarning } from "./sync-status.js";

// 14:30 IST on 6 Nov 2026 is 09:00 UTC.
const AT_1430_IST = "2026-11-06T09:00:00.000Z";
const minutesLater = (minutes: number): string => new Date(Date.parse(AT_1430_IST) + minutes * 60_000).toISOString();

describe("syncWarning", () => {
  it("says nothing before the first run, or after a clean recent one", () => {
    expect(syncWarning(null, AT_1430_IST)).toBeNull();
    expect(syncWarning({ finishedAt: AT_1430_IST, outcome: "ok", issues: [] }, minutesLater(20))).toBeNull();
  });

  it("does not warn about ordinary skips, which the run report already names", () => {
    const run = { finishedAt: AT_1430_IST, outcome: "issues" as const, issues: ["APP-0001 (MCM-0001): skipped, lender status \"X\" is not known."] };
    expect(syncWarning(run, minutesLater(20))).toBeNull();
  });

  it("names a run that kept nothing", () => {
    const run = { finishedAt: AT_1430_IST, outcome: "failed" as const, issues: ["Could not read the MIS"] };
    expect(syncWarning(run, minutesLater(5))).toBe("The MIS sync failed at 06/11 14:30 and kept nothing. PFO may be out of date. Could not read the MIS");
  });

  it("names the cases a run could not copy", () => {
    const run = {
      finishedAt: AT_1430_IST,
      outcome: "issues" as const,
      issues: ["MCM-0036: FAILED and undone, duplicate key (table submission).", "MCM-0040: FAILED and undone, x."],
    };
    expect(syncWarning(run, minutesLater(5))).toBe(
      "The MIS sync at 06/11 14:30 could not copy 2 cases (MCM-0036, MCM-0040). The rest is up to date.",
    );
  });

  it("warns when the task has stopped during sync hours, not overnight", () => {
    const run = { finishedAt: AT_1430_IST, outcome: "ok" as const, issues: [] };
    expect(syncWarning(run, minutesLater(61))).toBe(
      'The MIS sync has not run since 06/11 14:30. Check the "PFO MIS Sync" task on the server.',
    );
    // 23:30 IST: outside 08:00-21:00, no runs are expected.
    expect(syncWarning(run, minutesLater(9 * 60))).toBeNull();
  });
});
