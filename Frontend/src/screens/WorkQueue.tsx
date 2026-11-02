/**
 * The work queue: Overdue, Today, Upcoming, from real tasks (ADR-040). Every
 * home screen leads with it. Managers can switch to everyone, or one person.
 */

import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { FIRMS } from "@domain/work/intake.js";
import { shortDate } from "@domain/work/rules.js";

import { useApiQuery } from "../api/hooks.js";
import { useSession } from "../session.js";
import { Card, Empty, Select, cx } from "../ui/index.js";
import { dateFromToday, type WorkLists } from "./LogCase.js";

interface QueueRow {
  readonly id: string;
  readonly caseId: string;
  readonly caseNumber: string;
  readonly title: string;
  readonly dueOn: string | null;
  readonly assigneeName: string | null;
  readonly customerName: string | null;
}

function Group({ title, rows, tone }: { title: string; rows: readonly QueueRow[]; tone?: string }): ReactNode {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className={cx("mb-1 text-xs font-semibold uppercase tracking-wide", tone ?? "text-ink-500")}>
        {title} ({rows.length})
      </h3>
      <ul className="divide-y divide-ink-100">
        {rows.map((row) => (
          <li key={row.id}>
            <Link to={`/update-case?case=${row.caseId}`} className="flex flex-wrap gap-x-3 py-1.5 text-sm hover:underline">
              <span className="font-medium text-ink-900">{row.customerName ?? row.caseNumber}</span>
              <span className="text-ink-600">{row.title}</span>
              <span className="ml-auto text-xs text-ink-500">
                {row.dueOn ? shortDate(row.dueOn) : ""}
                {row.assigneeName ? ` · ${row.assigneeName}` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
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
  const overdue = rows.filter((row) => row.dueOn !== null && row.dueOn < today);
  const due = rows.filter((row) => row.dueOn === today);
  const upcoming = rows.filter((row) => row.dueOn === null || row.dueOn > today);

  return (
    <Card
      title="Work queue"
      actions={
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
            <Select className="max-w-48" value={who} onChange={(event) => setWho(event.target.value)}>
              <option value="everyone">Everyone</option>
              {(lists.data?.people ?? []).map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      }
    >
      {queue.loading ? (
        <Empty>Loading…</Empty>
      ) : queue.error ? (
        <Empty>{queue.error.message}</Empty>
      ) : rows.length === 0 ? (
        <Empty>Nothing to do right now.</Empty>
      ) : (
        <div className="space-y-4">
          <Group title="Overdue" rows={overdue} tone="text-red-700" />
          <Group title="Today" rows={due} tone="text-amber-800" />
          <Group title="Upcoming" rows={upcoming} />
        </div>
      )}
    </Card>
  );
}
