/**
 * The MIS Dashboard's reports (ADR-046). Every number opens the cases behind it,
 * listed below, and stays open until another is clicked or Clear is pressed. The
 * figures are worked out on the server by the MIS's own definitions.
 */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { CASE_STAGE_LABELS, type CaseStage } from "@domain/case/stages.js";
import type { Cell, MisReport } from "@domain/reports/mis-report.js";
import { FIRMS } from "@domain/work/intake.js";

import { useApiQuery } from "../api/hooks.js";
import { lakhs } from "../lib.js";
import { Card, Empty, Input, Select, TABLE_ROW, Td, Th, cx } from "../ui/index.js";

interface ReportAnswer extends MisReport {
  readonly periods: readonly { code: string; label: string }[];
  readonly people: readonly { id: string; name: string }[];
  readonly cases: readonly {
    id: string;
    caseNumber: string;
    customerName: string | null;
    stage: CaseStage;
    ownerName: string | null;
    leadOn: string;
    amount: number | null;
  }[];
}

interface Picked {
  readonly title: string;
  readonly caseIds: readonly string[];
}

const percent = (value: number | null): string => (value === null ? "n/a" : `${Math.round(value * 100)}%`);
const stageLabel = (stage: string): string => CASE_STAGE_LABELS[stage as CaseStage] ?? stage;

function Num({ cell, title, onPick, money }: {
  cell: Cell;
  title: string;
  onPick: (picked: Picked) => void;
  money?: boolean;
}): ReactNode {
  const text = money ? lakhs(cell.n) : String(cell.n);
  if (cell.caseIds.length === 0) return <span className="tnum text-ink-500">{money && cell.n === 0 ? "₹0" : text}</span>;
  return (
    <button
      type="button"
      className="tnum font-medium text-brand-600 hover:underline"
      onClick={() => onPick({ title, caseIds: cell.caseIds })}
    >
      {text}
    </button>
  );
}

function Tile({ label, note, cell, onPick, money, previous }: {
  label: string;
  note: string;
  cell: Cell;
  onPick: (picked: Picked) => void;
  money?: boolean;
  previous?: number;
}): ReactNode {
  const arrow = previous === undefined ? null : cell.n > previous ? "▲" : cell.n < previous ? "▼" : "▬";
  return (
    <div className="rounded-lg bg-white p-3 ring-1 ring-ink-150">
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="mt-1 text-2xl">
        <Num cell={cell} title={label} onPick={onPick} {...(money ? { money } : {})} />
      </p>
      <p className="mt-1 text-xs text-ink-500">
        {note}
        {arrow && ` ${arrow} ${money ? lakhs(previous) : previous} before`}
      </p>
    </div>
  );
}

function Grouped({ title, heading, rows, onPick, withAmount }: {
  title: string;
  heading: string;
  rows: readonly (Cell & { label: string; amount: number })[];
  onPick: (picked: Picked) => void;
  withAmount?: boolean;
}): ReactNode {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <Empty>Nothing in this period.</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <Th>{heading}</Th>
              <Th>Count</Th>
              {withAmount && <Th>Amount requested</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={TABLE_ROW}>
                <Td>{stageLabel(row.label)}</Td>
                <Td>
                  <Num cell={row} title={`${title}: ${stageLabel(row.label)}`} onPick={onPick} />
                </Td>
                {withAmount && <Td>{lakhs(row.amount)}</Td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function Reports(): ReactNode {
  const [period, setPeriod] = useState("month");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [firm, setFirm] = useState("all");
  const [who, setWho] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);

  const range = period === "custom" ? (from && to ? `from=${from}&to=${to}` : "period=today") : `period=${period}`;
  const report = useApiQuery<ReportAnswer>(`/reports/mis?${range}&firm=${firm}${who ? `&who=${who}` : ""}`);
  const data = report.data;
  const pick = (next: Picked): void => setPicked(next);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Reports</h1>
          <p className="mt-1 text-sm text-ink-500">
            Counted the way the MIS counts them. Practice cases are left out. Click a number to see its cases.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Select value={period} onChange={(event) => setPeriod(event.target.value)} className="w-48" aria-label="Period">
            {(data?.periods ?? [{ code: "month", label: "This Month" }]).map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
            <option value="custom">Choose dates</option>
          </Select>
          {period === "custom" && (
            <>
              <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
              <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
            </>
          )}
          <Select value={firm} onChange={(event) => setFirm(event.target.value)} className="w-52" aria-label="Firm">
            <option value="all">Both firms</option>
            {FIRMS.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </Select>
          <Select value={who} onChange={(event) => setWho(event.target.value)} className="w-48" aria-label="View as">
            <option value="">Everyone</option>
            {(data?.people ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {report.loading && !data ? (
        <Empty>Loading…</Empty>
      ) : report.error ? (
        <Empty>{report.error.message}</Empty>
      ) : data ? (
        <>
          <p className="tnum text-xs text-ink-500">
            {data.from} to {data.to}
          </p>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Active customer cases" note="Now." cell={data.cards.activeCases} onPick={pick} />
            <Tile label="In-progress lender applications" note="Now." cell={data.cards.inProgressApplications} onPick={pick} />
            <Tile label="Customers disbursed" note="In period." cell={data.cards.customersDisbursed} onPick={pick} previous={data.previous.customersDisbursed} />
            <Tile label="Applications disbursed" note="In period." cell={data.cards.applicationsDisbursed} onPick={pick} previous={data.previous.applicationsDisbursed} />
            <Tile label="Actual disbursement value" note="In period." cell={data.cards.disbursementValue} onPick={pick} money previous={data.previous.disbursementValue} />
            <Tile label="Sanctions" note="In period, with an amount." cell={data.cards.sanctions} onPick={pick} />
            <Tile label="Sanction value" note="In period." cell={data.cards.sanctionValue} onPick={pick} money />
            <Tile label="Open follow-ups" note="Now." cell={data.cards.openFollowups} onPick={pick} />
            <Tile label="Overdue follow-ups" note="Now." cell={data.cards.overdueFollowups} onPick={pick} />
            <Tile label="Due today" note="Now." cell={data.cards.dueToday} onPick={pick} />
            <Tile label="Documents outstanding" note="Now." cell={data.cards.documentsOutstanding} onPick={pick} />
            <Tile label="Lender queries" note="Now." cell={data.cards.lenderQueries} onPick={pick} />
            <Tile label="No next action" note="Now. Nobody is chasing these." cell={data.cards.noNextAction} onPick={pick} />
            <Tile label="Awaiting closure review" note="Now. Disbursed or rejected." cell={data.cards.awaitingClosureReview} onPick={pick} />
            <Tile label="Closed or lost" note="All time." cell={data.activeVsClosed.closed} onPick={pick} />
          </div>

          {picked && (
            <Card
              title={`${picked.title} (${picked.caseIds.length} ${picked.caseIds.length === 1 ? "case" : "cases"})`}
              actions={
                <button type="button" className="text-xs text-ink-500 hover:underline" onClick={() => setPicked(null)}>
                  Clear
                </button>
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Case</Th>
                    <Th>Customer</Th>
                    <Th>Stage</Th>
                    <Th>Owner</Th>
                    <Th>Lead date</Th>
                    <Th>Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.cases
                    .filter((c) => picked.caseIds.includes(c.id))
                    .map((c) => (
                      <tr key={c.id} className={TABLE_ROW}>
                        <Td>
                          <Link to={`/update-case?case=${c.id}`} className="tnum font-medium text-ink-900 hover:underline">
                            {c.caseNumber}
                          </Link>
                        </Td>
                        <Td>{c.customerName}</Td>
                        <Td>{stageLabel(c.stage)}</Td>
                        <Td>{c.ownerName}</Td>
                        <Td>{c.leadOn}</Td>
                        <Td>{c.amount === null ? "" : lakhs(c.amount)}</Td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <Grouped title="Customers by status" heading="Status" rows={data.pipeline} onPick={pick} />
            <Grouped title="Leads by loan type" heading="Loan type" rows={data.leadsByLoanType} onPick={pick} withAmount />
            <Grouped title="Leads by source" heading="Source" rows={data.leadsBySource} onPick={pick} />
          </div>

          <Card title="Telecallers (cohort: leads received in the period, credited to the original telecaller)">
            <div className="overflow-x-auto">
              <table className={cx("w-full text-sm")}>
                <thead>
                  <tr>
                    <Th>Telecaller</Th>
                    <Th>Leads</Th>
                    <Th>Disbursed</Th>
                    <Th>Conversion</Th>
                    <Th>Active now</Th>
                    <Th>Rejected</Th>
                    <Th>Closed, not disbursed</Th>
                    <Th>Open follow-ups</Th>
                    <Th>Overdue</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.telecallers.map((row) => (
                    <tr key={row.id} className={TABLE_ROW}>
                      <Td>{row.name}</Td>
                      <Td><Num cell={row.leads} title={`${row.name}: leads`} onPick={pick} /></Td>
                      <Td><Num cell={row.disbursed} title={`${row.name}: disbursed`} onPick={pick} /></Td>
                      <Td>{percent(row.conversion)}</Td>
                      <Td><Num cell={row.activeNow} title={`${row.name}: active`} onPick={pick} /></Td>
                      <Td><Num cell={row.rejected} title={`${row.name}: rejected`} onPick={pick} /></Td>
                      <Td><Num cell={row.closedWithoutDisbursement} title={`${row.name}: closed, not disbursed`} onPick={pick} /></Td>
                      <Td><Num cell={row.openFollowups} title={`${row.name}: open follow-ups`} onPick={pick} /></Td>
                      <Td><Num cell={row.overdueFollowups} title={`${row.name}: overdue`} onPick={pick} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Login team (cohort: applications with a login date in the period)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Logged in</Th>
                    <Th>Disbursed</Th>
                    <Th>Success rate</Th>
                    <Th>Under review</Th>
                    <Th>Queries</Th>
                    <Th>Open follow-ups</Th>
                    <Th>Overdue</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.loginTeam.map((row) => (
                    <tr key={row.id} className={TABLE_ROW}>
                      <Td>{row.name}</Td>
                      <Td><Num cell={row.submitted} title={`${row.name}: logged in`} onPick={pick} /></Td>
                      <Td><Num cell={row.disbursed} title={`${row.name}: disbursed`} onPick={pick} /></Td>
                      <Td>{percent(row.successRate)}</Td>
                      <Td><Num cell={row.underReview} title={`${row.name}: under review`} onPick={pick} /></Td>
                      <Td><Num cell={row.queries} title={`${row.name}: queries`} onPick={pick} /></Td>
                      <Td><Num cell={row.openFollowups} title={`${row.name}: open follow-ups`} onPick={pick} /></Td>
                      <Td><Num cell={row.overdueFollowups} title={`${row.name}: overdue`} onPick={pick} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Workload now">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Open</Th>
                    <Th>Overdue</Th>
                    <Th>Due today</Th>
                    <Th>Next 7 days</Th>
                    <Th>Active cases</Th>
                    <Th>No next action</Th>
                    <Th>Active applications</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.map((row) => (
                    <tr key={row.id} className={TABLE_ROW}>
                      <Td>{row.name}</Td>
                      <Td><Num cell={row.open} title={`${row.name}: open`} onPick={pick} /></Td>
                      <Td><Num cell={row.overdue} title={`${row.name}: overdue`} onPick={pick} /></Td>
                      <Td><Num cell={row.dueToday} title={`${row.name}: due today`} onPick={pick} /></Td>
                      <Td><Num cell={row.nextSevenDays} title={`${row.name}: next 7 days`} onPick={pick} /></Td>
                      <Td><Num cell={row.activeCases} title={`${row.name}: active cases`} onPick={pick} /></Td>
                      <Td><Num cell={row.noNextAction} title={`${row.name}: no next action`} onPick={pick} /></Td>
                      <Td><Num cell={row.activeApplications} title={`${row.name}: active applications`} onPick={pick} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
