/**
 * The GST and ITR summary, drawn as totals, graphs and filters.
 *
 * Input is the text of `GST and ITR Summary.txt` (written by the desktop
 * `organize` skill, stored verbatim). It is read by `parseFinancialSummary`,
 * which is strict: if the text is not that layout, or its months do not add up
 * to its own TOTAL line, this shows the original text unchanged. Nothing here
 * estimates a figure; the "worked out" numbers are sums and averages of what
 * the file says, over the months the person has chosen to count.
 *
 * Motion: bars rise from the baseline; when a filter changes the old bars sink
 * and only the selected months rise. Figures count to their new value. All of it
 * stops for people who have asked for reduced motion (summary-motion.ts, and
 * the global rule in index.css).
 */

import { useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import {
  parseFilerSummaries,
  presetsFor,
  rupeeParts,
  rupeesShort,
  selectMonths,
  type ParsedSummary,
  type SummaryItrYear,
} from "@domain/work/financial-summary.js";

import { useApiQuery } from "../api/hooks.js";
import { Empty, cx } from "../ui/index.js";
import { useCountUp, useFlashOnChange, useStaged } from "./summary-motion.js";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function FinancialSummary({ text }: { text: string }): ReactNode {
  const filers = useMemo(() => parseFilerSummaries(text), [text]);
  const refreshed = useFlashOnChange(text);
  const [chosen, setChosen] = useState(0);

  if (!filers) {
    // Not the layout this reads. Show the file as it is rather than guess.
    return (
      <pre className="mb-4 overflow-x-auto rounded-md bg-ink-50 p-3 font-mono text-xs leading-5 text-ink-800 ring-1 ring-ink-150">
        {text}
      </pre>
    );
  }
  const at = Math.min(chosen, filers.length - 1);
  const parsed = filers[at]!;
  // Keyed by the filer and the window of months: a different set of months
  // starts the filters afresh, the same months with new figures keeps them.
  return (
    <>
      {filers.length > 1 && (
        <div role="tablist" aria-label="Whose summary" className="mb-3 flex flex-wrap gap-2">
          {filers.map((filer, i) => (
            <button
              key={`${filer.business ?? "filer"}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === at}
              onClick={() => setChosen(i)}
              className={cx(
                "rounded-full px-3 py-1 text-sm ring-1",
                i === at ? "bg-ink-900 text-white ring-ink-900" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50",
              )}
            >
              {filer.business ?? `Filer ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      <Summary key={`${at}|${parsed.months.map((m) => m.label).join("|")}`} parsed={parsed} refreshed={refreshed} />
    </>
  );
}

/** The summary, or a plain sentence saying there is not one yet. */
export function FinancialsOrEmpty({ text }: { text: string | null }): ReactNode {
  if (!text) {
    return (
      <Empty>
        No GST and ITR summary on this case yet. It appears when the case folder is dropped with its "GST and ITR Summary.txt".
      </Empty>
    );
  }
  return <FinancialSummary text={text} />;
}

/** The same, for a screen that does not already hold the case (the full case view). */
export function CaseFinancials({ caseId }: { caseId: string }): ReactNode {
  const query = useApiQuery<{ financialSummary: string | null }>(`/work/cases/${caseId}`);
  if (query.loading) return <SummarySkeleton />;
  if (query.error) return <Empty>{query.error.message}</Empty>;
  return <FinancialsOrEmpty text={query.data?.financialSummary ?? null} />;
}

/** Grey shimmering placeholders for the case panel while it loads. */
export function SummarySkeleton(): ReactNode {
  return (
    <div aria-busy="true" aria-label="Loading the case" className="space-y-4 rounded-lg bg-white p-5 ring-1 ring-ink-150">
      <div className="fs-shimmer h-4 w-40 rounded" />
      <div className="fs-shimmer h-10 w-72 rounded" />
      <div className="fs-shimmer h-4 w-48 rounded" />
      <div className="fs-shimmer h-32 w-full rounded" />
      <div className="fs-shimmer h-4 w-56 rounded" />
      <div className="fs-shimmer h-16 w-full rounded" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** Rupees, whole part large, paise kept exact and small. */
function Money({ value, className, flash }: { value: number; className?: string | undefined; flash?: boolean | undefined }): ReactNode {
  const parts = rupeeParts(value);
  return (
    <span className={cx("tnum", className, flash && "fs-flash")}>
      {parts.negative && "-"}Rs. {parts.whole}
      {parts.paise && <span className="text-[0.5em] font-semibold text-ink-400">{parts.paise}</span>}
    </span>
  );
}

function CountedMoney({ value, className, flash }: { value: number; className?: string | undefined; flash?: boolean | undefined }): ReactNode {
  return <Money value={useCountUp(value)} className={className} flash={flash} />;
}

/** "3.91 crore" large when it is that big, counting as it changes. */
function CountedShort({ value, flash }: { value: number; flash?: boolean | undefined }): ReactNode {
  const shown = useCountUp(value);
  const short = rupeesShort(shown);
  return (
    <span className={cx("tnum", flash && "fs-flash")}>
      {short ? short : `Rs. ${rupeeParts(shown).whole}`}
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500",
        on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

type Mode = "bars" | "line";
type Metric = "turnover" | "netProfit" | "depreciation" | "financeCost";

const METRICS: readonly { id: Metric; label: string }[] = [
  { id: "turnover", label: "Sales" },
  { id: "netProfit", label: "Net profit" },
  { id: "depreciation", label: "Depreciation" },
  { id: "financeCost", label: "Finance cost" },
];

function Summary({ parsed, refreshed }: { parsed: ParsedSummary; refreshed: boolean }): ReactNode {
  const { months } = parsed;
  const presets = useMemo(() => presetsFor(months), [months]);

  const home = presets[0]!;
  const [presetId, setPresetId] = useState(home.id);
  const [range, setRange] = useState({ from: home.from, to: home.to });
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(new Set());
  const [belowAverage, setBelowAverage] = useState(false);
  const [mode, setMode] = useState<Mode>("bars");
  const [moreOpen, setMoreOpen] = useState(false);

  const [hiddenYears, setHiddenYears] = useState<ReadonlySet<number>>(new Set());
  const [metric, setMetric] = useState<Metric>("turnover");

  const selection = useMemo(
    () => selectMonths(months, { ...range, excluded, belowAverage }),
    [months, range, excluded, belowAverage],
  );
  const filtered = presetId !== home.id || excluded.size > 0 || belowAverage;
  const count = selection.indexes.length;
  const totalMonths = months.reduce((a, m) => a + m.span, 0);

  const chooseRange = (id: string, from: number, to: number): void => {
    setPresetId(id);
    setRange({ from, to });
    setExcluded(new Set());
  };
  const reset = (): void => {
    chooseRange(home.id, home.from, home.to);
    setBelowAverage(false);
  };
  const exclude = (index: number): void => setExcluded((s) => new Set(s).add(index));
  const restore = (index: number): void =>
    setExcluded((s) => {
      const next = new Set(s);
      next.delete(index);
      return next;
    });

  const periodLabel =
    count === 0
      ? "No months selected"
      : !filtered
        ? `${selection.monthsCounted} months, ${months[selection.indexes[0]!]!.label} to ${months[selection.indexes[count - 1]!]!.label}`
        : `${selection.monthsCounted} of ${totalMonths} months${belowAverage ? ", only those below the average" : ""}`;

  const visibleYears = parsed.itr.map((_, i) => i).filter((i) => !hiddenYears.has(i));
  const kinds = new Set(parsed.itr.map((y) => y.profitKind));
  const profitLabel = kinds.size === 1 && kinds.has("presumptive") ? "Presumptive income" : kinds.has("presumptive") ? "Net profit / presumptive" : "Net profit";
  const toggleYear = (i: number): void =>
    setHiddenYears((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const copyText = (): string =>
    [
      `GST AND ITR SUMMARY${parsed.business ? ` - ${parsed.business}` : ""}`,
      `GST sales (${periodLabel}): Rs. ${rupeeParts(selection.total).whole}${rupeeParts(selection.total).paise}, average Rs. ${rupeeParts(selection.average).whole}${rupeeParts(selection.average).paise} a month`,
      ...visibleYears.map((i) => {
        const y = parsed.itr[i]!;
        const f = (n: number | null): string => (n === null ? "not available" : `Rs. ${rupeeParts(n).negative ? "-" : ""}${rupeeParts(n).whole}${rupeeParts(n).paise}`);
        return `${y.financialYear}: sales ${f(y.turnover)}, net profit ${f(y.netProfit)}`;
      }),
    ].join("\n");

  return (
    <section className="mb-4 rounded-lg bg-white ring-1 ring-ink-150">
      <div className="@container px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink-900">
            GST and ITR summary
            {parsed.business && <span className="font-normal text-ink-500"> · {parsed.business}</span>}
          </p>
          {parsed.prepared && <p className="text-xs text-ink-500">Prepared {parsed.prepared}</p>}
        </div>

        {/* ------------------------------------------------------------ GST */}
        <hr className="my-4 border-ink-100" />
        <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">GST sales</p>
        {parsed.partial && (
          <p className="mt-1 text-xs text-ink-600">
            <span className="font-semibold">Partial:</span> {parsed.partial}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <Chip key={p.id} on={presetId === p.id} onClick={() => chooseRange(p.id, p.from, p.to)}>
              {p.label}
            </Chip>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="mt-2 text-xs font-medium text-brand-600 hover:underline"
        >
          {moreOpen ? "Fewer filters ▴" : "More filters ▾"}
        </button>

        {moreOpen && (
          <div className="aos-animate-in mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md bg-ink-50 px-3 py-2.5 text-xs text-ink-700 ring-1 ring-ink-150">
            <span className="flex items-center gap-1.5">
              From
              <MonthSelect
                months={months}
                value={range.from}
                onChange={(v) => {
                  setPresetId("custom");
                  setRange({ from: Math.min(v, range.to), to: Math.max(v, range.to) });
                  setExcluded(new Set());
                }}
              />
              to
              <MonthSelect
                months={months}
                value={range.to}
                onChange={(v) => {
                  setPresetId("custom");
                  setRange({ from: Math.min(v, range.from), to: Math.max(v, range.from) });
                  setExcluded(new Set());
                }}
              />
            </span>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={belowAverage} onChange={(e) => setBelowAverage(e.target.checked)} />
              Only months below the average
            </label>
            <span className="flex items-center gap-1.5">
              Graph
              <Chip on={mode === "bars"} onClick={() => setMode("bars")}>
                Bars
              </Chip>
              <Chip on={mode === "line"} onClick={() => setMode("line")}>
                Line
              </Chip>
            </span>
          </div>
        )}

        <div className="mt-4 grid gap-5 @2xl:grid-cols-[18rem_1fr]">
          <div>
            <p className="text-sm text-ink-500">{periodLabel}</p>
            <p className="font-display mt-1 text-3xl font-extrabold tracking-tight whitespace-nowrap text-ink-900">
              {count === 0 ? "-" : <CountedMoney value={selection.total} flash={refreshed} />}
            </p>
            <p className="text-sm text-ink-500">{count > 0 && rupeesShort(selection.total)}</p>
            <p className="mt-3 text-sm text-ink-500">Average per month</p>
            <p className="font-display text-2xl font-extrabold tracking-tight whitespace-nowrap text-ink-900">
              {count === 0 ? "-" : <CountedMoney value={selection.average} flash={refreshed} />}
            </p>
            {filtered && (
              <button type="button" onClick={reset} className="aos-animate-in mt-3 text-xs font-medium text-brand-600 hover:underline">
                Reset filters
              </button>
            )}
          </div>

          <div>
            <GstChart months={months} indexes={selection.indexes} mode={mode} onExclude={exclude} />
            {(excluded.size > 0 || belowAverage) && (
              <div className="aos-animate-in mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-600">
                {excluded.size > 0 && <span>Left out:</span>}
                {[...excluded]
                  .sort((a, b) => a - b)
                  .map((i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => restore(i)}
                      title="Put this month back"
                      className="rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-700 hover:bg-ink-150"
                    >
                      {months[i]!.label} ✕
                    </button>
                  ))}
                {belowAverage && (
                  <button
                    type="button"
                    onClick={() => setBelowAverage(false)}
                    className="rounded-full bg-ink-100 px-2.5 py-1 font-medium text-ink-700 hover:bg-ink-150"
                  >
                    Only below average ✕
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------ ITR */}
        <hr className="my-5 border-ink-100" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold tracking-wide text-ink-500 uppercase">Income Tax · last {parsed.itr.length} years</p>
          <div className="flex flex-wrap gap-1.5">
            {parsed.itr.map((y, i) => (
              <Chip key={y.assessmentYear} on={!hiddenYears.has(i)} onClick={() => toggleYear(i)}>
                {y.financialYear}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-5 @2xl:grid-cols-2">
          <div>
            <div className="grid grid-cols-[0.9fr_1fr_1fr] gap-2 pb-1 text-xs font-semibold text-ink-500">
              <span>Year</span>
              <span>Sales</span>
              <span>{profitLabel}</span>
            </div>
            {visibleYears.length === 0 ? (
              <p className="border-t border-ink-100 py-3 text-sm text-ink-500">No year selected.</p>
            ) : (
              visibleYears.map((i) => <ItrRow key={parsed.itr[i]!.assessmentYear} year={parsed.itr[i]!} flash={refreshed} />)
            )}
            <ItrNotes years={parsed.itr} footnotes={parsed.itrFootnotes} />
          </div>
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {METRICS.map((m) => (
                <Chip key={m.id} on={metric === m.id} onClick={() => setMetric(m.id)}>
                  {m.id === "netProfit" ? profitLabel : m.label}
                </Chip>
              ))}
            </div>
            <ItrChart years={visibleYears.map((i) => parsed.itr[i]!).reverse()} metric={metric} />
          </div>
        </div>

        {/* -------------------------------------------------------- details */}
        <Details
          parsed={parsed}
          selection={selection}
          range={range}
          excluded={excluded}
          belowAverage={belowAverage}
          visibleYears={visibleYears}
          onToggleMonth={(i, on) => (on ? restore(i) : exclude(i))}
          copyText={copyText}
        />
      </div>
    </section>
  );
}

function MonthSelect({
  months,
  value,
  onChange,
}: {
  months: ParsedSummary["months"];
  value: number;
  onChange: (value: number) => void;
}): ReactNode {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="rounded-md bg-white px-1.5 py-1 text-xs ring-1 ring-ink-300"
    >
      {months.map((m, i) => (
        <option key={m.label} value={i}>
          {m.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// ITR rows and notes
// ---------------------------------------------------------------------------

function ItrRow({ year, flash }: { year: SummaryItrYear; flash: boolean }): ReactNode {
  const loss = year.netProfit !== null && year.netProfit < 0;
  return (
    <div className="aos-animate-in grid grid-cols-[0.9fr_1fr_1fr] items-baseline gap-2 border-t border-ink-100 py-2.5">
      <span className="text-sm font-semibold text-ink-900">
        {year.financialYear}
        {year.fromComparative || year.note ? " *" : ""}
        <span className="block text-xs font-normal text-ink-500">AY {year.assessmentYear}</span>
      </span>
      <Figure value={year.turnover} flash={flash} />
      <Figure value={year.netProfit} flash={flash} loss={loss} caption={year.profitKind === "presumptive" ? "presumptive" : undefined} />
    </div>
  );
}

function Figure({ value, flash, loss, caption }: { value: number | null; flash: boolean; loss?: boolean; caption?: string | undefined }): ReactNode {
  if (value === null) return <span className="text-sm text-ink-500">Not available</span>;
  const abs = Math.abs(value);
  return (
    <span className="block">
      {loss && <span className="block text-xs font-bold tracking-wide text-red-700 uppercase">Loss</span>}
      <span className={cx("font-display text-xl font-extrabold tracking-tight whitespace-nowrap", loss ? "text-red-700" : "text-ink-900")}>
        <CountedShort value={abs} flash={flash} />
      </span>
      {rupeesShort(abs) && (
        <span className="tnum block text-xs text-ink-500">
          Rs. {rupeeParts(abs).whole}
          {rupeeParts(abs).paise}
        </span>
      )}
      {caption && <span className="block text-xs text-ink-500">{caption}</span>}
    </span>
  );
}

function ItrNotes({ years, footnotes }: { years: readonly SummaryItrYear[]; footnotes: readonly string[] }): ReactNode {
  const notes = [...years.flatMap((y) => (y.note ? [`${y.financialYear}: ${y.note}.`] : [])), ...footnotes];
  if (notes.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-ink-500">
      {notes.map((n) => (
        <li key={n}>* {n}</li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Graphs
// ---------------------------------------------------------------------------

const W = 520;
const H = 220;

function GstChart({
  months,
  indexes,
  mode,
  onExclude,
}: {
  months: ParsedSummary["months"];
  indexes: readonly number[];
  mode: Mode;
  onExclude: (index: number) => void;
}): ReactNode {
  const series = indexes.map((i) => ({ i, label: months[i]!.label, amount: months[i]!.amount }));
  const signature = `${mode}|${series.map((s) => `${s.i}:${s.amount}`).join(",")}`;
  const { shown, leaving, version } = useStaged(series, signature);
  const [hover, setHover] = useState<number | null>(null);

  if (shown.length === 0) {
    return <p className="flex h-40 items-center justify-center text-sm text-ink-500">No months selected.</p>;
  }

  const top = 20;
  const bottom = 34;
  const max = Math.max(...shown.map((s) => s.amount), 1);
  const min = Math.min(...shown.map((s) => s.amount));
  // Only the first of any tied lowest months is marked.
  const weakAt = shown.length > 1 ? shown.findIndex((s) => s.amount === min) : -1;
  const slot = (W - 12) / shown.length;
  const cx0 = (n: number): number => 6 + slot * n + slot / 2;
  const y = (v: number): number => top + (1 - v / max) * (H - top - bottom);
  const barWidth = Math.min(slot * 0.7, 46);
  const avgShown = shown.reduce((a, s) => a + s.amount, 0) / shown.length;
  const description = `${mode === "bars" ? "Bar" : "Line"} chart of monthly GST sales, ${shown.length} months, from ${shown[0]!.label} to ${shown[shown.length - 1]!.label}.`;
  const hovered = hover !== null ? shown[hover] : undefined;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description} className="block h-auto w-full overflow-visible">
        <line x1={6} x2={W - 6} y1={H - bottom} y2={H - bottom} className="stroke-ink-200" />
        {!leaving && (
          <g key={`avg-${version}`} className="fs-late">
            <line x1={6} x2={W - 6} y1={y(avgShown)} y2={y(avgShown)} strokeDasharray="5 4" className="stroke-ink-400" />
            <text x={W - 6} y={y(avgShown) - 6} textAnchor="end" paintOrder="stroke" stroke="white" strokeWidth={3} className="fill-ink-500 text-[11px]">
              average
            </text>
          </g>
        )}

        {mode === "line" && shown.length > 1 && (
          <polyline
            key={`line-${version}`}
            pathLength={1}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            className={cx("stroke-brand-500", leaving ? "fs-late" : "fs-line")}
            style={leaving ? { opacity: 0, transition: "opacity 200ms" } : undefined}
            points={shown.map((s, n) => `${cx0(n)},${y(s.amount)}`).join(" ")}
          />
        )}

        {shown.map((s, n) => {
          const weak = n === weakAt;
          const fillClass = weak ? "fill-red-400" : "fill-brand-500";
          const common = {
            style: { ["--i" as string]: n } as CSSProperties,
            onMouseEnter: () => setHover(n),
            onMouseLeave: () => setHover(null),
            onClick: () => onExclude(s.i),
            onKeyDown: (e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onExclude(s.i);
              }
            },
            tabIndex: 0,
            role: "button",
            "aria-label": `${s.label}: Rs. ${rupeeParts(s.amount).whole}. Press to leave this month out.`,
            className: "cursor-pointer outline-none focus-visible:stroke-ink-900",
          };
          return mode === "bars" ? (
            <rect
              key={`${version}-${s.i}`}
              {...common}
              className={cx(common.className, leaving ? "fs-bar-out" : "fs-bar", fillClass, "hover:opacity-80")}
              x={cx0(n) - barWidth / 2}
              y={y(s.amount)}
              width={barWidth}
              height={Math.max(H - bottom - y(s.amount), 1)}
              rx={3}
            />
          ) : (
            <circle key={`${version}-${s.i}`} {...common} className={cx(common.className, leaving ? "fs-bar-out" : "fs-dot", fillClass)} cx={cx0(n)} cy={y(s.amount)} r={5} />
          );
        })}

        {shown.map((s, n) => {
          const m = months[s.i]!;
          return (
            <text key={`l-${version}-${s.i}`} x={cx0(n)} y={H - 18} textAnchor="middle" className="fill-ink-500 text-[11px]">
              {m.short}
              {(n === 0 || m.month === 0) && (
                <tspan x={cx0(n)} dy={12} className="fill-ink-400 text-[10px]">
                  {m.year}
                </tspan>
              )}
            </text>
          );
        })}
      </svg>

      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-elevated"
          style={{ left: `${(cx0(hover) / W) * 100}%`, top: `${(y(hovered.amount) / H) * 100}%` }}
        >
          {hovered.label}: Rs. {rupeeParts(hovered.amount).whole}
          {rupeeParts(hovered.amount).paise}
        </div>
      )}
      <p className="mt-1 text-xs text-ink-400">Click a month to leave it out.</p>
    </div>
  );
}

function ItrChart({ years, metric }: { years: readonly SummaryItrYear[]; metric: Metric }): ReactNode {
  const series = years.map((y) => ({ key: y.assessmentYear, label: y.financialYear, value: y[metric] }));
  const signature = `${metric}|${series.map((s) => `${s.key}:${s.value}`).join(",")}`;
  const { shown, leaving, version } = useStaged(series, signature);
  const [hover, setHover] = useState<number | null>(null);

  if (shown.length === 0) return <p className="flex h-40 items-center justify-center text-sm text-ink-500">No year selected.</p>;

  const values = shown.map((s) => s.value ?? 0);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const top = 26;
  const bottom = 34;
  const span = hi - lo || 1;
  const y = (v: number): number => top + ((hi - v) / span) * (H - top - bottom);
  const zero = y(0);
  const slot = (W - 20) / shown.length;
  const barWidth = Math.min(slot * 0.5, 70);
  const cx0 = (n: number): number => 10 + slot * n + slot / 2;
  const label = METRICS.find((m) => m.id === metric)?.label ?? "";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Bar chart of ${label.toLowerCase()} for ${shown.map((s) => s.label).join(", ")}.`}
        className="block h-auto w-full overflow-visible"
      >
        <line x1={10} x2={W - 10} y1={zero} y2={zero} className="stroke-ink-200" />
        {shown.map((s, n) => {
          const v = s.value;
          if (v === null) {
            return (
              <text key={`${version}-${s.key}`} x={cx0(n)} y={zero - 8} textAnchor="middle" className="fill-ink-400 text-[12px]">
                Not available
              </text>
            );
          }
          const negative = v < 0;
          const barTop = Math.min(y(v), zero);
          const height = Math.max(Math.abs(y(v) - zero), 1);
          const previous = n > 0 ? shown[n - 1]!.value : null;
          const change = previous !== null && previous > 0 ? (v / previous - 1) * 100 : null;
          return (
            <g key={`${version}-${s.key}`} onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(null)}>
              <rect
                style={{ ["--i" as string]: n, transformOrigin: negative ? "50% 0%" : "50% 100%" } as CSSProperties}
                className={cx(leaving ? "fs-bar-out" : "fs-bar", negative ? "fill-red-400" : "fill-brand-500")}
                x={cx0(n) - barWidth / 2}
                y={barTop}
                width={barWidth}
                height={height}
                rx={4}
              />
              <text
                x={cx0(n)}
                y={negative ? barTop + height + 14 : barTop - 8}
                textAnchor="middle"
                className={cx("text-[12px] font-bold", negative ? "fill-red-700" : "fill-ink-900", leaving ? "opacity-0" : "fs-late")}
              >
                {negative ? "Loss " : ""}
                {rupeesShort(v) || rupeeParts(v).whole}
              </text>
              <text x={cx0(n)} y={H - 6} textAnchor="middle" className="fill-ink-500 text-[12px]">
                {s.label}
                {change !== null && (
                  <tspan dx={6} className={cx("text-[11px] font-semibold", change >= 0 ? "fill-green-700" : "fill-red-700")}>
                    {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}%
                  </tspan>
                )}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && shown[hover]?.value != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-ink-900 px-2 py-1 text-xs whitespace-nowrap text-white shadow-elevated"
          style={{ left: `${(cx0(hover) / W) * 100}%`, top: `${(y(shown[hover]!.value!) / H) * 100}%` }}
        >
          {shown[hover]!.label}: {shown[hover]!.value! < 0 ? "Loss " : ""}Rs. {rupeeParts(Math.abs(shown[hover]!.value!)).whole}
          {rupeeParts(Math.abs(shown[hover]!.value!)).paise}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details: the month table, the full ITR figures, copy
// ---------------------------------------------------------------------------

type SortKey = "month" | "amount" | "average";

function Details({
  parsed,
  selection,
  range,
  excluded,
  belowAverage,
  visibleYears,
  onToggleMonth,
  copyText,
}: {
  parsed: ParsedSummary;
  selection: ReturnType<typeof selectMonths>;
  range: { from: number; to: number };
  excluded: ReadonlySet<number>;
  belowAverage: boolean;
  visibleYears: readonly number[];
  onToggleMonth: (index: number, on: boolean) => void;
  copyText: () => string;
}): ReactNode {
  const { months } = parsed;
  const [sortKey, setSortKey] = useState<SortKey>("month");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [copied, setCopied] = useState(false);

  const rows = [];
  for (let i = range.from; i <= range.to; i++) {
    const rate = months[i]!.amount / months[i]!.span;
    if (belowAverage && !excluded.has(i) && !(rate < selection.baseAverage)) continue;
    rows.push({ i, amount: months[i]!.amount, against: selection.baseAverage ? rate / selection.baseAverage - 1 : 0 });
  }
  const key = { month: "i", amount: "amount", average: "against" } as const;
  rows.sort((a, b) => (a[key[sortKey]] - b[key[sortKey]]) * direction);

  const sortBy = (next: SortKey): void => {
    if (next === sortKey) setDirection((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(next);
      setDirection(1);
    }
  };
  const arrow = (k: SortKey): string => (sortKey === k ? (direction === 1 ? " ▲" : " ▼") : "");

  const full = (n: number | null): string =>
    n === null ? "Not available" : `${n < 0 ? "Loss " : ""}${rupeeParts(Math.abs(n)).whole}${rupeeParts(Math.abs(n)).paise}`;

  return (
    <details className="mt-5 rounded-lg ring-1 ring-ink-150 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-semibold text-ink-900">
        Month by month and every figure
        <span aria-hidden className="text-ink-400">▾</span>
      </summary>
      <div className="space-y-5 border-t border-ink-100 px-4 py-4">
        <div>
          <p className="mb-1 text-xs text-ink-500">Untick a month to leave it out of the totals. Click a heading to sort.</p>
          <div className="overflow-x-auto">
            <table className="tnum w-full text-left text-sm">
              <thead className="text-xs text-ink-500">
                <tr>
                  <th className="w-8 py-1.5" />
                  <th className="cursor-pointer py-1.5 font-semibold select-none" onClick={() => sortBy("month")}>Month{arrow("month")}</th>
                  <th className="cursor-pointer py-1.5 text-right font-semibold select-none" onClick={() => sortBy("amount")}>Taxable sales{arrow("amount")}</th>
                  <th className="cursor-pointer py-1.5 text-right font-semibold select-none" onClick={() => sortBy("average")}>Against average{arrow("average")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const off = excluded.has(r.i);
                  return (
                    <tr key={r.i} className={cx("border-t border-ink-100", off && "text-ink-300 line-through")}>
                      <td className="py-1.5">
                        <input
                          type="checkbox"
                          aria-label={`Count ${months[r.i]!.label}`}
                          checked={!off}
                          onChange={(e) => onToggleMonth(r.i, e.target.checked)}
                        />
                      </td>
                      <td className="py-1.5">{months[r.i]!.label}</td>
                      <td className="py-1.5 text-right">Rs. {rupeeParts(r.amount).whole}{rupeeParts(r.amount).paise}</td>
                      <td className="py-1.5 text-right">{r.against >= 0 ? "+" : ""}{(r.against * 100).toFixed(0)}%</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="font-semibold">
                <tr className="border-t-2 border-ink-200 bg-ink-50">
                  <td />
                  <td className="py-1.5">Total, {selection.monthsCounted} months</td>
                  <td className="py-1.5 text-right">Rs. {rupeeParts(selection.total).whole}{rupeeParts(selection.total).paise}</td>
                  <td />
                </tr>
                <tr className="bg-ink-50">
                  <td />
                  <td className="py-1.5">Average per month</td>
                  <td className="py-1.5 text-right">{selection.indexes.length ? `Rs. ${rupeeParts(selection.average).whole}${rupeeParts(selection.average).paise}` : "-"}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="overflow-x-auto">
          <p className="mb-1 text-xs text-ink-500">Income Tax, every figure (Rs.)</p>
          <table className="tnum w-full text-left text-sm">
            <thead className="text-xs text-ink-500">
              <tr>
                <th className="py-1.5 font-semibold">Year</th>
                <th className="py-1.5 text-right font-semibold">Sales</th>
                <th className="py-1.5 text-right font-semibold">Net profit</th>
                <th className="py-1.5 text-right font-semibold">Depreciation</th>
                <th className="py-1.5 text-right font-semibold">Finance cost</th>
              </tr>
            </thead>
            <tbody>
              {visibleYears.map((i) => {
                const y = parsed.itr[i]!;
                return (
                  <tr key={y.assessmentYear} className="border-t border-ink-100">
                    <td className="py-1.5">{y.financialYear} <span className="text-xs text-ink-500">AY {y.assessmentYear}</span></td>
                    <td className="py-1.5 text-right">{full(y.turnover)}</td>
                    <td className={cx("py-1.5 text-right", y.netProfit !== null && y.netProfit < 0 && "text-red-700")}>{full(y.netProfit)}</td>
                    <td className="py-1.5 text-right">{full(y.depreciation)}</td>
                    <td className="py-1.5 text-right">{full(y.financeCost)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(copyText()).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-ink-900 ring-1 ring-ink-200 hover:bg-ink-50"
        >
          {copied ? "Copied" : "Copy as text"}
        </button>
      </div>
    </details>
  );
}
