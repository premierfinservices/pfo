/**
 * The home screen's small charts (ADR-053).
 *
 * Hand-drawn from divs: three charts do not earn a charting library. Each uses
 * one hue, so nothing depends on telling colours apart, and each prints its
 * labels and counts, so the picture is a second way to read figures that are
 * already on the screen in words.
 */

import type { ReactNode } from "react";

import { shortDate } from "@domain/work/rules.js";

import { cx } from "./index.js";

/** One thin bar per week, oldest first. The last bar is this week and is the only solid one. */
export function WeekBars({ weeks }: { weeks: readonly { weekStart: string; n: number }[] }): ReactNode {
  const top = Math.max(1, ...weeks.map((week) => week.n));
  const peak = weeks.findIndex((week) => week.n === top);
  const last = weeks.length - 1;

  return (
    <div>
      <div className="flex h-32 items-end justify-between pt-5">
        {weeks.map((week, index) => (
          <div
            key={week.weekStart}
            title={`Week of ${shortDate(week.weekStart)}: ${week.n} ${week.n === 1 ? "lead" : "leads"}`}
            className="flex h-full w-6 items-end justify-center"
          >
            <div
              className={cx("relative w-2 rounded-t-full", index === last ? "bg-brand-600" : "bg-brand-600/30")}
              style={{ height: `max(2px, ${(week.n / top) * 100}%)` }}
            >
              {/* Two labels only: the tallest week and this one. */}
              {(index === last || index === peak) && week.n > 0 && (
                <span className="tnum absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-ink-600">{week.n}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-ink-500">
        <span>{weeks[0] ? `Week of ${shortDate(weeks[0].weekStart)}` : ""}</span>
        <span>This week</span>
      </div>
    </div>
  );
}

/** A labelled bar per row, longest row full width. */
export function RowBars({ rows }: { rows: readonly { label: string; n: number }[] }): ReactNode {
  const top = Math.max(1, ...rows.map((row) => row.n));
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink-800">{row.label}</span>
            <span className="tnum shrink-0 text-ink-600">{row.n}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${(row.n / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const MOST_DOTS = 72;

/**
 * A row of dots per label: a count you can see without reading it. One dot is
 * one item until the total passes what fits, and then the chart says how many
 * a dot stands for rather than quietly changing scale.
 */
export function DotRows({ rows, unit }: { rows: readonly { label: string; n: number }[]; unit: string }): ReactNode {
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  const each = Math.max(1, Math.ceil(total / MOST_DOTS));
  return (
    <div>
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate text-ink-800">{row.label}</span>
              <span className="tnum shrink-0 text-ink-600">{row.n}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1" aria-hidden>
              {Array.from({ length: Math.ceil(row.n / each) }, (_, index) => (
                <span key={index} className="h-2 w-2 rounded-full bg-brand-600" />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {each > 1 && (
        <p className="mt-3 text-xs text-ink-500">
          Each dot is {each} {unit}.
        </p>
      )}
    </div>
  );
}
