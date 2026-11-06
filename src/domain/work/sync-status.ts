/**
 * The warning managers see when the MIS sync is not keeping PFO up to date
 * (ADR-047). The sync runs every 30 minutes from 08:00 to 21:00 India time; until
 * 6 Nov 2026 it failed for three days and nothing on screen said so. Pure.
 */

export interface SyncRun {
  readonly finishedAt: string;
  readonly outcome: "ok" | "issues" | "failed";
  readonly issues: readonly string[];
}

/** A run older than this, during sync hours, means the task has stopped. */
const LATE_AFTER_MINUTES = 60;

function indiaTime(iso: string): { hour: number; label: string } {
  const shifted = new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString();
  return { hour: Number(shifted.slice(11, 13)), label: `${shifted.slice(8, 10)}/${shifted.slice(5, 7)} ${shifted.slice(11, 16)}` };
}

/** Null when there is nothing to say. `issues` runs are normal and shown on the run report, not here. */
export function syncWarning(latest: SyncRun | null, now: string): string | null {
  if (!latest) return null;
  const at = indiaTime(latest.finishedAt).label;
  if (latest.outcome === "failed") {
    return `The MIS sync failed at ${at} and kept nothing. PFO may be out of date. ${latest.issues[0] ?? ""}`.trim();
  }
  const failedCases = latest.issues.filter((issue) => issue.includes("FAILED"));
  if (failedCases.length > 0) {
    const ids = failedCases.map((issue) => issue.split(":")[0]).join(", ");
    return `The MIS sync at ${at} could not copy ${failedCases.length} case${failedCases.length === 1 ? "" : "s"} (${ids}). The rest is up to date.`;
  }
  const hour = indiaTime(now).hour;
  const minutes = (new Date(now).getTime() - new Date(latest.finishedAt).getTime()) / 60_000;
  if (hour >= 8 && hour < 21 && minutes > LATE_AFTER_MINUTES) {
    return `The MIS sync has not run since ${at}. Check the "PFO MIS Sync" task on the server.`;
  }
  return null;
}
