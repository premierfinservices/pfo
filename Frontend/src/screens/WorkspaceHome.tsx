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

import type { MisReport } from "@domain/reports/mis-report.js";

import { useApiQuery } from "../api/hooks.js";
import type { ApiHealthDetail } from "../api/types.js";
import { lakhs } from "../lib.js";
import { useSession } from "../session.js";
import { Badge, cx } from "../ui/index.js";
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
      {seesOffice && <Overview />}
      <WorkQueue />
      {seesOffice && (
        <details className="group rounded-xl bg-white ring-1 ring-ink-150">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink-900">
            Full reports <span className="font-normal text-ink-500">· every figure, by lender, source and team</span>
          </summary>
          <div className="border-t border-ink-100 p-4">
            <Reports />
          </div>
        </details>
      )}
    </div>
  );
}

/** The few numbers worth seeing first, whole office, this month. */
function Overview(): ReactNode {
  const report = useApiQuery<MisReport>("/reports/mis?period=month&firm=all");
  const data = report.data;
  if (!data) return null;

  const stats: readonly { label: string; value: string; note: string; tone?: string }[] = [
    { label: "Overdue", value: String(data.cards.overdueFollowups.n), note: "follow-ups", tone: data.cards.overdueFollowups.n > 0 ? "text-red-700" : "" },
    { label: "Due today", value: String(data.cards.dueToday.n), note: "follow-ups" },
    { label: "Lender queries", value: String(data.cards.lenderQueries.n), note: "waiting on us" },
    { label: "Documents pending", value: String(data.cards.documentsOutstanding.n), note: "cases" },
    { label: "Disbursed this month", value: lakhs(data.cards.disbursementValue.n), note: `${data.cards.customersDisbursed.n} customers` },
  ];
  const team = [...data.workload].filter((row) => row.open.n > 0).sort((a, b) => b.overdue.n - a.overdue.n || b.open.n - a.open.n);
  const biggest = Math.max(1, ...team.map((row) => row.open.n));

  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 lg:col-span-2">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl bg-white p-4 ring-1 ring-ink-150">
            <p className="text-xs font-medium text-ink-500">{stat.label}</p>
            <p className={cx("tnum mt-1 text-3xl font-semibold tracking-tight text-ink-900", stat.tone)}>{stat.value}</p>
            <p className="mt-0.5 text-xs text-ink-500">{stat.note}</p>
          </div>
        ))}
      </div>
      {team.length > 0 && (
        <section className="rounded-xl bg-white p-4 ring-1 ring-ink-150 lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Team load</h2>
          <ul className="mt-3 grid gap-x-8 gap-y-2 md:grid-cols-2 xl:grid-cols-3">
            {team.map((row) => (
              <li key={row.id} className="text-sm">
                <div className="flex justify-between">
                  <span className="text-ink-900">{row.name}</span>
                  <span className="tnum text-xs text-ink-500">
                    {row.open.n} open{row.overdue.n > 0 && <span className="text-red-700"> · {row.overdue.n} overdue</span>}
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div className="flex h-full" style={{ width: `${(row.open.n / biggest) * 100}%` }}>
                    <div className="bg-red-500" style={{ width: `${(row.overdue.n / row.open.n) * 100}%` }} />
                    <div className="flex-1 bg-brand-600" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
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
