/**
 * The work queue: real tasks (ADR-040), grouped by the action to take so the
 * home screen answers "what needs doing" at a glance instead of listing every
 * task. Each card shows the oldest few, with the rest one click away.
 * Managers can switch to everyone, or one person.
 */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { FIRMS } from "@domain/work/intake.js";
import { shortDate } from "@domain/work/rules.js";

import { useApiQuery } from "../api/hooks.js";
import { useSession } from "../session.js";
import { Empty, Select } from "../ui/index.js";
import { dateFromToday, type WorkLists } from "./LogCase.js";

interface QueueRow {
  readonly id: string;
  readonly caseId: string;
  readonly caseNumber: string;
  readonly title: string;
  readonly kind: string | null;
  readonly dueOn: string | null;
  readonly assigneeName: string | null;
  readonly customerName: string | null;
}

const PREVIEW = 5;

/**
 * One card per action. Grouped by the task's kind, not its wording, so
 * retitling a task never splits a card. Both document kinds are one action.
 * A task with no kind (older or imported) falls back to its title, with any
 * " from <lender>" suffix dropped.
 */
const ACTION_BY_KIND: Readonly<Record<string, string>> = {
  collect_documents: "Collect documents",
  collect_remaining_documents: "Collect documents",
  check_eligibility: "Check eligibility",
  send_to_lenders: "Send file to lenders",
  confirm_login: "Confirm login",
  resolve_query: "Resolve lender query",
  present_offer: "Present offer",
};
const actionOf = (row: QueueRow): string =>
  (row.kind ? ACTION_BY_KIND[row.kind] : undefined) ?? row.title.replace(/ from .+$/, "");
const detailOf = (title: string): string => /^.+? from (.+)$/.exec(title)?.[1] ?? "";

function ActionCard({ action, rows, today }: { action: string; rows: readonly QueueRow[]; today: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const overdue = rows.filter((row) => row.dueOn !== null && row.dueOn < today).length;
  const shown = open ? rows : rows.slice(0, PREVIEW);

  return (
    <section className="flex flex-col rounded-xl bg-white p-4 ring-1 ring-ink-150">
      <header className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-ink-900">{action}</h3>
        <div className="text-right">
          <p className="tnum text-2xl font-semibold leading-none text-ink-900">{rows.length}</p>
          {overdue > 0 && <p className="mt-1 text-xs font-medium text-red-700">{overdue} overdue</p>}
        </div>
      </header>
      <ul className="mt-3 flex-1 divide-y divide-ink-100">
        {shown.map((row) => {
          const detail = detailOf(row.title);
          return (
            <li key={row.id}>
              <Link to={`/update-case?case=${row.caseId}`} className="flex items-baseline gap-2 py-1.5 text-sm hover:underline">
                <span className="truncate font-medium text-ink-900">{row.customerName ?? row.caseNumber}</span>
                {detail && <span className="truncate text-xs text-ink-500">{detail}</span>}
                <span className="tnum ml-auto shrink-0 text-xs text-ink-500">
                  {row.dueOn ? shortDate(row.dueOn) : ""}
                  {row.assigneeName ? ` · ${row.assigneeName}` : ""}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {rows.length > PREVIEW && (
        <button type="button" className="mt-2 self-start text-xs font-medium text-brand-600 hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

export function WorkQueue(): ReactNode {
  const session = useSession();
  const seesAll = session.can("task.read", "all");
  const [who, setWho] = useState(seesAll ? "everyone" : "");
  const [firm, setFirm] = useState("all");
  const queue = useApiQuery<readonly QueueRow[]>(
    `/work/queue?${[who ? `who=${who}` : "", firm !== "all" ? `firm=${firm}` : ""].filter(Boolean).join("&")}`,
  );
  const lists = useApiQuery<WorkLists>(seesAll ? "/work/lists" : null);

  const today = dateFromToday(0);
  const rows = queue.data ?? [];
  const groups = new Map<string, QueueRow[]>();
  for (const row of rows) {
    const action = actionOf(row);
    groups.set(action, [...(groups.get(action) ?? []), row]);
  }
  const lateCount = (list: readonly QueueRow[]): number => list.filter((row) => row.dueOn !== null && row.dueOn < today).length;
  const ordered = [...groups].sort((a, b) => lateCount(b[1]) - lateCount(a[1]) || b[1].length - a[1].length);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">What needs doing</h2>
        <div className="flex gap-2">
          <Select className="max-w-48" value={firm} onChange={(event) => setFirm(event.target.value)} aria-label="Firm">
            <option value="all">Both firms</option>
            {FIRMS.map((item) => (
              <option key={item.code} value={item.code}>
                {item.label}
              </option>
            ))}
          </Select>
          {seesAll && (
            <Select className="max-w-48" value={who} onChange={(event) => setWho(event.target.value)} aria-label="Person">
              <option value="everyone">Everyone</option>
              {(lists.data?.people ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {queue.loading ? (
        <Empty>Loading…</Empty>
      ) : queue.error ? (
        <Empty>{queue.error.message}</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nothing to do right now.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map(([action, list]) => (
            <ActionCard key={action} action={action} rows={list} today={today} />
          ))}
        </div>
      )}
    </div>
  );
}
