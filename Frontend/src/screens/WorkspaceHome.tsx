/**
 * The home screen: one for everybody (ADR-050).
 *
 * The work queue first: Overdue, Today, Upcoming, from real tasks, own cases by
 * default and everyone's for a manager, as the MIS's "View as" does. Whoever may
 * see office-wide figures gets the MIS reports underneath, the same figures the
 * sync checks against the MIS, and a line on the system's health.
 *
 * Until 6 Nov 2026 there were five per-role homes and a separate Founders
 * Dashboard whose numbers were worked out in the browser and could disagree
 * with the Reports screen.
 */

import type { ReactNode } from "react";

import { useApiQuery } from "../api/hooks.js";
import type { ApiHealthDetail } from "../api/types.js";
import { useSession } from "../session.js";
import { Badge } from "../ui/index.js";
import { Reports } from "./Reports.js";
import { WorkQueue } from "./WorkQueue.js";

function greeting(): string {
  const hour = Number(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(11, 13));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function WorkspaceHome(): ReactNode {
  const session = useSession();
  const seesOffice = session.can("report.view", "all");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          {greeting()}, {session.displayName}
        </h1>
        {seesOffice && <SystemHealth />}
      </div>
      <WorkQueue />
      {seesOffice && <Reports />}
    </div>
  );
}

const HEALTH_LABELS: Record<string, string> = { database: "Database", storage: "Documents", mail: "Mail" };

/** Database, document storage and mail, one badge each. */
function SystemHealth(): ReactNode {
  const health = useApiQuery<ApiHealthDetail>("/health/detail");
  if (!health.data) return null;
  const parts = [
    ["database", health.data.database],
    ["storage", health.data.storage],
    ["mail", health.data.mail],
  ] as const;
  return (
    <span className="ml-auto flex gap-1.5">
      {parts.map(([key, state]) => (
        <Badge key={key} tone={state === "up" ? "good" : state === "unconfigured" ? "neutral" : "bad"}>
          {HEALTH_LABELS[key]}: {state === "up" ? "OK" : state === "unconfigured" ? "not set up" : "down"}
        </Badge>
      ))}
    </span>
  );
}
