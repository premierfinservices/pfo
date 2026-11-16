/**
 * The home screen: one for everybody (ADR-050), laid out as a dashboard (ADR-053).
 *
 * On the backdrop: the greeting, one headline figure, and this week's
 * follow-ups day by day. Under it, for
 * whoever may see office-wide figures, the few numbers worth seeing first and
 * three small charts. Then the work queue, from real tasks, own cases by
 * default and everyone's for a manager, as the MIS's "View as" does. The full
 * MIS reports stay one click below.
 *
 * Every figure here comes from the same report the Reports screen shows, worked
 * out on the server, so the two cannot disagree. Until 6 Nov 2026 there were
 * five per-role homes and a Founders Dashboard that could.
 */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { CASE_STAGES, CASE_STAGE_LABELS, type CaseStage } from "@domain/case/stages.js";
import { periodRange, type MisReport } from "@domain/reports/mis-report.js";

import { useApiQuery } from "../api/hooks.js";
import type { ApiHealthDetail } from "../api/types.js";
import { lakhs } from "../lib.js";
import { useSession } from "../session.js";
import { DotRows, RowBars, WeekBars } from "../ui/charts.js";
import { PageHeader, Segmented, cx } from "../ui/index.js";
import { dateFromToday } from "./LogCase.js";
import { Reports } from "./Reports.js";
import { WorkQueue, actionOf, type QueueRow } from "./WorkQueue.js";

type Period = "today" | "week" | "month";

const PERIODS: readonly { value: Period; label: string; word: string; before: string }[] = [
  { value: "today", label: "Today", word: "today", before: "the day before" },
  { value: "week", label: "This week", word: "this week", before: "the week before" },
  { value: "month", label: "This month", word: "this month", before: "the month before" },
];

function greeting(): string {
  const hour = Number(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(11, 13));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

const todayLine = (): string =>
  new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });

export function WorkspaceHome(): ReactNode {
  const session = useSession();
  const seesOffice = session.can("report.view", "all");
  const [period, setPeriod] = useState<Period>("month");
  const report = useApiQuery<MisReport>(seesOffice ? `/reports/mis?period=${period}&firm=all` : null);
  // The same question the work queue below asks before anyone touches its filters.
  const queue = useApiQuery<readonly QueueRow[]>(`/work/queue${session.can("task.read", "all") ? "?who=everyone" : ""}`);
  const rows = queue.data ?? [];
  const chosen = PERIODS.find((item) => item.value === period)!;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={todayLine()}
        title={`${greeting()}, ${session.displayName}`}
        overlap={seesOffice}
        actions={
          seesOffice && (
            <>
              <SystemHealth />
              <Segmented label="Period" value={period} options={PERIODS} onChange={setPeriod} />
            </>
          )
        }
      >
        <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,23rem)_1fr_minmax(0,25rem)]">
          <Headline report={report.data} rows={rows} period={chosen} />
          <WeekAhead rows={rows} className="lg:col-start-3" />
        </div>
      </PageHeader>

      {seesOffice && report.data && <Overview data={report.data} period={chosen} />}
      <WorkQueue />
      {seesOffice && (
        <details className="group rounded-xl bg-white shadow-soft ring-1 ring-ink-900/5">
          <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink-900 select-none">
            Full reports <span className="font-normal text-ink-500">Every figure, by lender, source and team</span>
          </summary>
          <div className="border-t border-ink-100 p-5">
            <Reports embedded />
          </div>
        </details>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// On the backdrop
// ---------------------------------------------------------------------------

/**
 * The one figure to lead with. Whoever sees the office's figures gets money
 * disbursed in the chosen period, and the way in to the Reports screen, which
 * has no other door. Everyone else gets their own open follow-ups, because that
 * is the number they can act on. No shortcuts to Log a Case, Update Case or the
 * case list: those are in the top bar already (Tarun, 16 Nov 2026).
 */
function Headline({ report, rows, period }: {
  report: MisReport | undefined;
  rows: readonly QueueRow[];
  period: (typeof PERIODS)[number];
}): ReactNode {
  const session = useSession();
  const today = dateFromToday(0);
  const late = rows.filter((row) => row.dueOn !== null && row.dueOn < today).length;
  const customers = report?.cards.customersDisbursed.n ?? 0;

  return (
    <section className="glass self-start rounded-2xl p-5">
      {session.can("report.view", "all") ? (
        <>
          <h2 className="text-sm font-medium text-ink-700">Disbursed {period.word}</h2>
          <p className="font-display mt-1 text-4xl font-light text-ink-900">{report ? lakhs(report.cards.disbursementValue.n) : "…"}</p>
          <p className="mt-1.5 text-xs text-ink-700">
            {report && `${customers} ${customers === 1 ? "customer" : "customers"}. ${lakhs(report.previous.disbursementValue)} ${period.before}.`}
          </p>
        </>
      ) : (
        <>
          <h2 className="text-sm font-medium text-ink-700">Your open follow-ups</h2>
          <p className="font-display mt-1 text-4xl font-light text-ink-900">{rows.length}</p>
          <p className={cx("mt-1.5 text-xs", late > 0 ? "font-medium text-red-700" : "text-ink-700")}>
            {late > 0 ? `${late} overdue.` : "None overdue."}
          </p>
        </>
      )}
      {session.can("report.view", "all") && (
        <Link
          to="/reports"
          className="mt-4 inline-flex h-9 items-center rounded-full bg-white px-4 text-sm font-medium text-brand-700 shadow-soft transition-colors duration-150 hover:bg-brand-50"
        >
          Open reports
        </Link>
      )}
    </section>
  );
}

const DAY_LETTERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Monday to Sunday of this week: how many follow-ups fall due on each day, and what is due today. */
function WeekAhead({ rows, className }: { rows: readonly QueueRow[]; className?: string }): ReactNode {
  const today = dateFromToday(0);
  const monday = Date.parse(`${periodRange("week", today)!.from}T00:00:00Z`);
  const days = DAY_LETTERS.map((letter, index) => {
    const date = new Date(monday + index * 86_400_000).toISOString().slice(0, 10);
    return { letter, date, due: rows.filter((row) => row.dueOn === date).length };
  });
  const late = rows.filter((row) => row.dueOn !== null && row.dueOn < today).length;
  const dueToday = rows.filter((row) => row.dueOn === today);

  return (
    <section className={cx("glass-tint rounded-2xl p-5 text-white", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Follow-ups this week</h2>
        {late > 0 && <p className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-medium">{late} overdue</p>}
      </div>
      <ol className="mt-3 grid grid-cols-7 gap-1 text-center">
        {days.map((day) => (
          <li
            key={day.date}
            aria-current={day.date === today ? "date" : undefined}
            className={cx("rounded-xl py-1.5", day.date === today ? "bg-white text-ink-900 shadow-soft" : day.date < today && "text-white/60")}
          >
            <span className="block text-xs">{day.letter}</span>
            <span className="font-display tnum block text-xl font-light">{day.due === 0 ? "–" : day.due}</span>
            <span className={cx("tnum block text-xs", day.date === today ? "text-ink-600" : "text-white/60")}>{Number(day.date.slice(8))}</span>
          </li>
        ))}
      </ol>
      {dueToday.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 rounded-xl bg-white/95 px-3 text-ink-900">
          {dueToday.slice(0, 3).map((row) => (
            <li key={row.id}>
              <Link to={`/update-case?case=${row.caseId}`} className="flex items-baseline justify-between gap-3 py-1.5 text-sm hover:underline">
                <span className="truncate font-medium">{row.customerName ?? row.caseNumber}</span>
                <span className="shrink-0 text-xs text-ink-600">{actionOf(row)}</span>
              </Link>
            </li>
          ))}
          {dueToday.length > 3 && <li className="py-1.5 text-xs text-ink-600">and {dueToday.length - 3} more due today, in the queue below</li>}
        </ul>
      )}
    </section>
  );
}

const HEALTH_LABELS: Record<string, string> = { database: "Database", storage: "Documents", mail: "Mail" };

/** Database, document storage and mail: one quiet line while all three are up, and the name of whatever is not. */
function SystemHealth(): ReactNode {
  const health = useApiQuery<ApiHealthDetail>("/health/detail");
  if (!health.data) return null;
  const parts = (["database", "storage", "mail"] as const).map((key) => ({ label: HEALTH_LABELS[key]!, state: health.data![key] }));
  const down = parts.filter((part) => part.state !== "up" && part.state !== "unconfigured");
  const notSetUp = parts.filter((part) => part.state === "unconfigured");
  const text =
    down.length > 0
      ? `${down.map((part) => part.label).join(", ")} down`
      : notSetUp.length > 0
        ? `${notSetUp.map((part) => part.label).join(", ")} not set up`
        : "All systems OK";
  return (
    <p className="glass flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium text-ink-800" role="status">
      <span className={cx("h-2 w-2 rounded-full", down.length > 0 ? "bg-red-500" : notSetUp.length > 0 ? "bg-amber-500" : "bg-emerald-500")} />
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Under it: the office at a glance
// ---------------------------------------------------------------------------

const PANEL = "rounded-xl bg-white p-5 shadow-soft ring-1 ring-ink-900/5";

/** A number, what it is out of, and a bar showing that share. */
function StatTile({ label, value, of, total, alarm = false }: {
  label: string;
  value: number;
  /** What the total counts: "open follow-ups". */
  of: string;
  total: number;
  /** Red when the number is above zero: something is late. */
  alarm?: boolean;
}): ReactNode {
  const red = alarm && value > 0;
  return (
    <div className={PANEL}>
      <h3 className="text-sm text-ink-600">{label}</h3>
      <p className={cx("font-display tnum mt-2 text-4xl font-light", red ? "text-red-700" : "text-ink-900")}>{value}</p>
      <p className="mt-1 text-xs text-ink-500">
        of {total} {of}
      </p>
      <div className="mt-3 h-1 rounded-full bg-ink-100">
        <div
          className={cx("h-full rounded-full", red ? "bg-red-500" : "bg-brand-600")}
          style={{ width: `${total === 0 ? 0 : Math.min(100, (value / total) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function Overview({ data, period }: { data: MisReport; period: (typeof PERIODS)[number] }): ReactNode {
  const { cards } = data;
  const weeks = data.leadsByWeek;
  const thisWeek = weeks[weeks.length - 1]?.n ?? 0;
  const lastWeek = weeks[weeks.length - 2]?.n ?? 0;
  const stages = [...data.pipeline]
    .sort((a, b) => CASE_STAGES.indexOf(a.label as (typeof CASE_STAGES)[number]) - CASE_STAGES.indexOf(b.label as (typeof CASE_STAGES)[number]))
    .map((row) => ({ label: CASE_STAGE_LABELS[row.label as CaseStage] ?? row.label, n: row.n }));
  const sources = [...data.leadsBySource].sort((a, b) => b.n - a.n);
  const team = [...data.workload].filter((row) => row.open.n > 0).sort((a, b) => b.overdue.n - a.overdue.n || b.open.n - a.open.n);
  const biggest = Math.max(1, ...team.map((row) => row.open.n));

  return (
    // Pulled up over the backdrop's edge; the header leaves the room (`overlap`).
    <div className="-mt-22 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Overdue follow-ups" value={cards.overdueFollowups.n} of="open follow-ups" total={cards.openFollowups.n} alarm />
      <StatTile label="Due today" value={cards.dueToday.n} of="open follow-ups" total={cards.openFollowups.n} />
      <StatTile label="Lender queries waiting on us" value={cards.lenderQueries.n} of="applications in progress" total={cards.inProgressApplications.n} />
      <StatTile label="Cases with documents pending" value={cards.documentsOutstanding.n} of="active cases" total={cards.activeCases.n} />

      {/* The one warm card: the trend is the thing on this screen nobody could see before. */}
      <section className={cx(PANEL, "flex flex-col justify-between gap-4 bg-linear-to-br from-white from-40% to-gold-100/70 sm:col-span-2")}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm text-ink-600">Leads received this week</h3>
            <p className="font-display tnum mt-2 text-4xl font-light text-ink-900">{thisWeek}</p>
          </div>
          <p className="text-right text-xs text-ink-500">
            {lastWeek} the week before
            <br />
            Twelve weeks, oldest on the left
          </p>
        </div>
        <WeekBars weeks={weeks} />
      </section>

      <section className={PANEL}>
        <h3 className="mb-4 text-sm text-ink-600">Active cases by stage</h3>
        {stages.length === 0 ? <p className="text-sm text-ink-500">No active cases.</p> : <RowBars rows={stages} />}
      </section>

      <section className={PANEL}>
        <h3 className="mb-4 text-sm text-ink-600">Leads by source, {period.word}</h3>
        {sources.length === 0 ? <p className="text-sm text-ink-500">No leads {period.word}.</p> : <DotRows rows={sources} unit="leads" />}
      </section>

      {team.length > 0 && (
        <section className={cx(PANEL, "sm:col-span-2 xl:col-span-4")}>
          <h3 className="text-sm text-ink-600">Team load</h3>
          <ul className="mt-4 grid gap-x-10 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {team.map((row) => (
              <li key={row.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-ink-900">{row.name}</span>
                  <span className="tnum shrink-0 text-xs text-ink-500">
                    {row.open.n} open{row.overdue.n > 0 && <span className="font-medium text-red-700">, {row.overdue.n} overdue</span>}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                  <div className="flex h-full gap-0.5" style={{ width: `${(row.open.n / biggest) * 100}%` }}>
                    {row.overdue.n > 0 && <div className="rounded-full bg-red-500" style={{ width: `${(row.overdue.n / row.open.n) * 100}%` }} />}
                    <div className="flex-1 rounded-full bg-brand-600" />
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
