/**
 * Update Case: the main working screen, from the MIS (ADR-040).
 *
 * Pick the customer, then three tabs: Case, Send to lenders, Applications. The
 * line under the header always says what comes next, in plain text and never as
 * a popup. It comes from the same tasks as the work queue, so the two agree.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { CASE_STAGE_LABELS, LOST_REASONS, LOST_REASON_LABELS, type CaseStage } from "@domain/case/stages.js";
import { shortDate } from "@domain/work/rules.js";

import { api, apiUpload } from "../api/client.js";
import { useApiQuery, useMutation } from "../api/hooks.js";
import { useSession } from "../session.js";
import { Badge, Button, Card, Empty, Field, Input, Select, StageBadge, cx } from "../ui/index.js";
import { dateFromToday, type WorkLists } from "./LogCase.js";

interface PickRow {
  readonly id: string;
  readonly caseNumber: string;
  readonly stage: CaseStage;
  readonly customerName: string | null;
  readonly ownerName: string | null;
  readonly nextTitle: string | null;
  readonly nextDue: string | null;
}

interface Application {
  readonly id: string;
  readonly status: string;
  readonly statusLabel: string;
  readonly nextStatuses: readonly string[];
  readonly bank: string | null;
  readonly bankerName: string | null;
  readonly loginDate: string | null;
  readonly loginEmployeeId: string | null;
  readonly reference: string | null;
  readonly approvedAmount: number | null;
  readonly sanctionAmount: number | null;
  readonly sanctionDate: string | null;
  readonly acceptanceDate: string | null;
  readonly disbursementAmount: number | null;
  readonly disbursementDate: string | null;
  readonly sentAt: string | null;
}

interface Summary {
  readonly id: string;
  readonly caseNumber: string;
  readonly stage: CaseStage;
  readonly customerName: string | null;
  readonly ownerName: string | null;
  readonly amount: number | null;
  readonly amountInWords: string;
  readonly loanType: string | null;
  readonly loanVariant: string | null;
  readonly place: string | null;
  readonly isPractice: boolean;
  readonly isOnHold: boolean;
  readonly documentStatus: string;
  readonly eligibilityStatus: string;
  readonly done: string | null;
  readonly next: string;
  readonly pending: readonly { id: string; label: string; rejected: boolean }[];
  readonly notNeeded: readonly { id: string; label: string }[];
  readonly uploaded: readonly { name: string; fileName: string }[];
  readonly financialSummary: string | null;
  readonly applications: readonly Application[];
}

interface LenderOption {
  readonly id: string;
  readonly name: string;
  readonly supports: boolean;
  readonly already: boolean;
  readonly bankers: readonly string[];
}

const TODAY = (): string => dateFromToday(0);

const DOCUMENT_LABELS: Record<string, string> = {
  not_assessed: "Not assessed",
  pending: "Pending",
  partial: "Partially collected",
  complete: "Complete",
};

export function UpdateCase(): ReactNode {
  const [params, setParams] = useSearchParams();
  const caseId = params.get("case");
  const [search, setSearch] = useState("");
  const list = useApiQuery<readonly PickRow[]>(`/work/cases${search ? `?q=${encodeURIComponent(search)}` : ""}`);

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
      <div className="space-y-3">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">Update Case</h1>
        <Input
          placeholder="Name, mobile or case number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoFocus
        />
        {list.loading ? (
          <Empty>Loading…</Empty>
        ) : list.error ? (
          <Empty>{list.error.message}</Empty>
        ) : (list.data ?? []).length === 0 ? (
          <Empty>No open cases found.</Empty>
        ) : (
          <ul className="max-h-[75vh] divide-y divide-ink-100 overflow-y-auto rounded-lg bg-white ring-1 ring-ink-150">
            {(list.data ?? []).map((row) => {
              const overdue = row.nextDue !== null && row.nextDue < TODAY();
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ case: row.id })}
                    className={cx(
                      "w-full px-3 py-2 text-left hover:bg-ink-50",
                      caseId === row.id && "bg-brand-50",
                    )}
                  >
                    <span className="block text-sm font-medium text-ink-900">{row.customerName ?? row.caseNumber}</span>
                    <span className="tnum block text-xs text-ink-500">
                      {row.caseNumber} · {CASE_STAGE_LABELS[row.stage]}
                    </span>
                    {row.nextTitle && (
                      <span className={cx("block text-xs", overdue ? "text-red-700" : "text-ink-500")}>
                        {row.nextTitle}
                        {row.nextDue ? `, ${shortDate(row.nextDue)}` : ""}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {caseId ? (
        <CasePanel key={caseId} caseId={caseId} onChanged={list.refetch} />
      ) : (
        <Empty>Choose the customer. Your cases are listed with the most urgent first.</Empty>
      )}
    </div>
  );
}

type Tab = "case" | "send" | "applications";

function CasePanel({ caseId, onChanged }: { caseId: string; onChanged: () => void }): ReactNode {
  const loaded = useApiQuery<Summary>(`/work/cases/${caseId}`);
  const lists = useApiQuery<WorkLists>("/work/lists");
  const [latest, setLatest] = useState<Summary | null>(null);
  const [tab, setTab] = useState<Tab>("case");
  const mutation = useMutation();

  if (loaded.loading || lists.loading) return <Empty>Loading case…</Empty>;
  const summary = latest ?? loaded.data;
  if (loaded.error || !summary || !lists.data) {
    return <Empty>{loaded.error?.message ?? "This case is not available."}</Empty>;
  }

  const act = async (path: string, body: Record<string, unknown>): Promise<void> => {
    const result = await mutation.run(() =>
      api<Summary>(`/work/cases/${caseId}/${path}`, { method: "POST", body }),
    );
    if (result) {
      setLatest(result);
      onChanged();
    }
  };

  const closed = summary.stage === "lost" || summary.stage === "closed";

  const refresh = async (): Promise<void> => {
    setLatest(await api<Summary>(`/work/cases/${caseId}`));
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-xl font-semibold text-ink-900">{summary.customerName}</h2>
          <StageBadge stage={summary.stage} label={CASE_STAGE_LABELS[summary.stage]} />
          {summary.isPractice && <Badge>Practice</Badge>}
          {summary.isOnHold && <Badge tone="warn">On hold</Badge>}
          <Link to={`/cases/${summary.id}`} className="ml-auto text-xs text-ink-500 hover:underline">
            Full history and documents
          </Link>
        </div>
        <p className="tnum mt-1 text-sm text-ink-500">
          {summary.caseNumber} · {summary.loanType}
          {summary.loanVariant ? ` (${summary.loanVariant})` : ""} · {summary.place}
          {summary.amountInWords ? ` · ${summary.amountInWords}` : ""} · {summary.ownerName}
        </p>
      </div>

      <div className="rounded-md bg-brand-50 px-3 py-2 text-sm text-ink-900 ring-1 ring-brand-200" role="status">
        {summary.done && <span className="text-ink-600">{summary.done} </span>}
        <span className="font-medium">{summary.next}</span>
      </div>

      {mutation.error && <p className="text-sm text-red-700">{mutation.error}</p>}

      <div className="flex gap-1 border-b border-ink-150">
        {(
          [
            ["case", "Case"],
            ["send", "Send to lenders"],
            ["applications", `Applications (${summary.applications.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cx(
              "-mb-px border-b-2 px-3 py-2 text-sm",
              tab === value ? "border-brand-600 font-medium text-ink-900" : "border-transparent text-ink-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "case" && <CaseTab summary={summary} act={act} pending={mutation.pending} closed={closed} refresh={refresh} />}
      {tab === "send" && <SendTab summary={summary} act={act} pending={mutation.pending} />}
      {tab === "applications" && (
        <ApplicationsTab summary={summary} lists={lists.data} act={act} pending={mutation.pending} />
      )}
    </div>
  );
}

type Act = (path: string, body: Record<string, unknown>) => Promise<void>;

function CaseTab({
  summary,
  act,
  pending,
  closed,
  refresh,
}: {
  summary: Summary;
  act: Act;
  pending: boolean;
  closed: boolean;
  refresh: () => Promise<void>;
}): ReactNode {
  const [nextDate, setNextDate] = useState(dateFromToday(1));
  const [reason, setReason] = useState<string>(LOST_REASONS[0]);
  const [note, setNote] = useState("");

  if (closed) {
    return (
      <Card>
        <Link to={`/cases/${summary.id}`} className="text-sm underline">
          Open the case to reopen it
        </Link>
      </Card>
    );
  }

  const asking =
    summary.eligibilityStatus === "unanswered" &&
    (summary.documentStatus === "partial" || summary.documentStatus === "complete");

  return (
    <div className="space-y-4">
      {asking && (
        <Card title="Is this case eligible?" subtitle="Your decision. Check what has come in, then answer.">
          {summary.financialSummary && (
            <pre className="mb-4 overflow-x-auto rounded-md bg-ink-50 p-3 font-mono text-xs leading-5 text-ink-800 ring-1 ring-ink-150">
              {summary.financialSummary}
            </pre>
          )}
          {summary.documentStatus !== "complete" && (
            <Field label="If eligible, collect the rest on">
              <Input
                type="date"
                className="max-w-48"
                min={TODAY()}
                value={nextDate}
                onChange={(event) => setNextDate(event.target.value)}
              />
            </Field>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" disabled={pending} onClick={() => void act("eligibility", { answer: "eligible", nextDate })}>
              Eligible
            </Button>
            <Button disabled={pending} onClick={() => void act("eligibility", { answer: "not_eligible", note })}>
              Not eligible
            </Button>
          </div>
        </Card>
      )}

      <Card
        title="Documents"
        subtitle={`Now: ${DOCUMENT_LABELS[summary.documentStatus] ?? summary.documentStatus}${
          summary.eligibilityStatus === "eligible" ? " · Eligible" : ""
        }`}
      >
        <div className="flex flex-wrap items-end gap-2">
          <Button disabled={pending} onClick={() => void act("documents", { which: "all" })}>
            Fully received
          </Button>
          <Button disabled={pending} onClick={() => void act("documents", { which: "part", nextDate })}>
            Partly received
          </Button>
          <Button disabled={pending} onClick={() => void act("documents", { which: "pending", nextDate })}>
            Nothing yet
          </Button>
          <Field label="Next collection date">
            <Input type="date" min={TODAY()} value={nextDate} onChange={(event) => setNextDate(event.target.value)} />
          </Field>
        </div>
      </Card>

      <UploadCard summary={summary} refresh={refresh} />

      <Card title="Pending documents" subtitle="For information only. Nothing here stops the file going to a lender.">
        <PendingList summary={summary} act={act} pending={pending} />
      </Card>

      <Card title="Reschedule">
        <div className="flex flex-wrap gap-2">
          <Button disabled={pending} onClick={() => void act("reschedule", { days: 1 })}>
            Tomorrow
          </Button>
          <Button disabled={pending} onClick={() => void act("reschedule", { days: 3 })}>
            +3 days
          </Button>
          <Button disabled={pending} onClick={() => void act("reschedule", { days: 7 })}>
            Next week
          </Button>
        </div>
      </Card>

      <Card title="Customer dropped">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason">
            <Select value={reason} onChange={(event) => setReason(event.target.value)}>
              {LOST_REASONS.map((value) => (
                <option key={value} value={value}>
                  {LOST_REASON_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)">
            <Input value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
        <Button className="mt-3" disabled={pending} onClick={() => void act("drop", { reason, note })}>
          Close the case
        </Button>
      </Card>
    </div>
  );
}

/** What the server says became of one file; an archive carries the answers for the files inside it. */
interface UploadAnswer {
  readonly fileName: string;
  readonly result: string;
  readonly storedAs?: string;
  readonly readByAi?: boolean;
  readonly reason?: string;
  readonly files?: readonly UploadAnswer[];
}

/** One action: pick the case folder or drop the files. PFO files each one. */
function UploadCard({ summary, refresh }: { summary: Summary; refresh: () => Promise<void> }): ReactNode {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<{
    filed: number;
    repeats: number;
    others: string[];
    read: string[];
    failed: string[];
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const send = async (files: readonly File[]): Promise<void> => {
    const result = { filed: 0, repeats: 0, others: [] as string[], read: [] as string[], failed: [] as string[] };
    setOutcome(null);
    setProgress({ done: 0, total: files.length });
    for (const [index, file] of files.entries()) {
      const parts = (file.webkitRelativePath || "").split("/");
      const folder = parts.length > 1 ? (parts[parts.length - 2] ?? "") : "";
      try {
        const answer = await apiUpload<UploadAnswer>(`/work/cases/${summary.id}/upload`, file, folder);
        const tally = (item: UploadAnswer): void => {
          if (item.result === "filed" || item.result === "summary") result.filed += 1;
          if (item.result === "duplicate") result.repeats += 1;
          if (item.result === "other") result.others.push(item.fileName);
          if (item.readByAi) result.read.push(`${item.fileName} → ${item.storedAs ?? "filed"}`);
          if (item.result === "unreadable_archive" || item.result === "failed") {
            result.failed.push(`${item.fileName}: ${item.reason ?? "could not be filed"}`);
          }
          item.files?.forEach(tally);
        };
        tally(answer);
      } catch (error) {
        result.failed.push(`${file.name}: ${(error as Error).message}`);
      }
      setProgress({ done: index + 1, total: files.length });
    }
    setProgress(null);
    setOutcome(result);
    await refresh();
  };

  const pick = (list: FileList | null): void => {
    if (list && list.length > 0) void send([...list]);
  };

  const dropped = async (items: DataTransferItemList): Promise<void> => {
    const entries = [...items].map((item) => item.webkitGetAsEntry()).filter((entry) => entry !== null);
    const files: File[] = [];
    const walk = async (entry: FileSystemEntry): Promise<void> => {
      if (entry.isFile) {
        files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
        return;
      }
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (batch.length === 0) return;
        for (const child of batch) await walk(child);
      }
    };
    for (const entry of entries) await walk(entry);
    if (files.length > 0) await send(files);
  };

  return (
    <Card
      title="Upload received documents"
      subtitle="Pick the whole case folder, even if only some documents have come. PFO files each one by its name, or by reading it when the name says nothing, and opens zip files. Any order."
    >
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void dropped(event.dataTransfer.items);
        }}
        className={cx(
          "rounded-md border-2 border-dashed p-5 text-center text-sm text-ink-600",
          dragging ? "border-brand-500 bg-brand-50" : "border-ink-200",
        )}
      >
        <p>Drop the case folder here, or</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <label className="cursor-pointer rounded-md bg-brand-600 px-3.5 py-1.5 font-medium text-white">
            Choose folder
            <input
              type="file"
              className="hidden"
              multiple
              {...({ webkitdirectory: "" } as object)}
              onChange={(event) => {
                pick(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
          <label className="cursor-pointer rounded-md px-3.5 py-1.5 font-medium text-ink-700 ring-1 ring-ink-300">
            Choose files
            <input
              type="file"
              className="hidden"
              multiple
              onChange={(event) => {
                pick(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {progress && (
        <p className="mt-3 text-sm text-ink-700" role="status">
          Uploading {progress.done} of {progress.total}…
        </p>
      )}
      {outcome && (
        <div className="mt-3 space-y-1 text-sm" role="status">
          <p className="text-ink-800">
            {outcome.filed} filed{outcome.repeats > 0 ? `, ${outcome.repeats} already here` : ""}.
          </p>
          {outcome.others.length > 0 && (
            <p className="text-amber-800">Kept as Other Document, name not recognised: {outcome.others.join(", ")}</p>
          )}
          {outcome.read.length > 0 && (
            <p className="text-ink-700">Identified by reading, please check: {outcome.read.join("; ")}</p>
          )}
          {outcome.failed.map((line) => (
            <p key={line} className="text-red-700">
              {line}
            </p>
          ))}
        </div>
      )}

      {summary.uploaded.length > 0 && (
        <details className="mt-3 text-sm text-ink-600">
          <summary className="cursor-pointer">{summary.uploaded.length} documents on this case</summary>
          <ul className="mt-1 space-y-0.5">
            {summary.uploaded.map((item, index) => (
              <li key={`${item.fileName}-${index}`}>{item.fileName}</li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function PendingList({ summary, act, pending }: { summary: Summary; act: Act; pending: boolean }): ReactNode {
  return (
    <div className="space-y-4">
      {summary.pending.length === 0 ? (
        <p className="text-sm text-ink-500">Nothing pending.</p>
      ) : (
        <ol className="space-y-1 text-sm">
          {summary.pending.map((item, index) => (
            <li key={item.id} className="flex items-center justify-between gap-2">
              <span>
                {index + 1}. {item.label}
                {item.rejected && <span className="text-red-700"> (rejected, needs a replacement)</span>}
              </span>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => void act(`requirements/${item.id}/not-needed`, {})}
              >
                Not needed
              </Button>
            </li>
          ))}
        </ol>
      )}
      {summary.notNeeded.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">Marked not needed</h4>
          <ul className="space-y-1 text-sm text-ink-500">
            {summary.notNeeded.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-2">
                <span>{item.label}</span>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => void act(`requirements/${item.id}/restore`, {})}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SendTab({ summary, act, pending }: { summary: Summary; act: Act; pending: boolean }): ReactNode {
  const [options, setOptions] = useState<readonly LenderOption[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const count = summary.applications.length;

  useEffect(() => {
    api<readonly LenderOption[]>(`/work/cases/${summary.id}/lenders`)
      .then(setOptions)
      .catch((error: Error) => setFailed(error.message));
  }, [summary.id, count]);

  if (failed) return <Empty>{failed}</Empty>;
  if (!options) return <Empty>Loading lenders…</Empty>;

  const shown = options.filter((lender) => lender.name.toLowerCase().includes(search.toLowerCase()));
  const ticked = Object.keys(picked);

  return (
    <div className="space-y-4">
      {summary.pending.length > 0 && (
        <p className="text-sm text-ink-600">
          {summary.pending.length} item{summary.pending.length === 1 ? "" : "s"} still pending:{" "}
          {summary.pending.slice(0, 4).map((item) => item.label).join(", ")}
          {summary.pending.length > 4 ? ", and more" : ""}. You can still send.
        </p>
      )}

      <Input placeholder="Search lenders" value={search} onChange={(event) => setSearch(event.target.value)} />

      <ul className="max-h-96 divide-y divide-ink-100 overflow-y-auto rounded-lg bg-white ring-1 ring-ink-150">
        {shown.map((lender) => {
          const isPicked = lender.id in picked;
          return (
            <li key={lender.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <label className="flex min-w-56 flex-1 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isPicked}
                  disabled={lender.already}
                  onChange={(event) =>
                    setPicked((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[lender.id] = "";
                      else delete next[lender.id];
                      return next;
                    })
                  }
                />
                {lender.supports ? "★ " : ""}
                {lender.name}
                {lender.already && <span className="text-xs text-ink-400">already sent</span>}
              </label>
              {isPicked && (
                <>
                  <Input
                    className="max-w-56 uppercase"
                    placeholder="Banker (pick or type)"
                    list={`bankers-${lender.id}`}
                    value={picked[lender.id] ?? ""}
                    onChange={(event) => setPicked((current) => ({ ...current, [lender.id]: event.target.value }))}
                  />
                  <datalist id={`bankers-${lender.id}`}>
                    {lender.bankers.map((name) => (
                      <option key={name} value={name} />
                    ))}
                  </datalist>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          disabled={pending || ticked.length === 0}
          onClick={() => {
            void act("send", {
              lenders: ticked.map((id) => ({ id, banker: picked[id] })),
            });
            setPicked({});
          }}
        >
          Send to {ticked.length} lender{ticked.length === 1 ? "" : "s"}
        </Button>
        <Link to={`/cases/${summary.id}?tab=banks`} className="text-sm underline">
          Email documents to a banker
        </Link>
      </div>
    </div>
  );
}

function ApplicationsTab({
  summary,
  lists,
  act,
  pending,
}: {
  summary: Summary;
  lists: WorkLists;
  act: Act;
  pending: boolean;
}): ReactNode {
  const session = useSession();
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  if (summary.applications.length === 0) {
    return <Empty>No applications yet. Use the Send to lenders tab.</Empty>;
  }

  const app = summary.applications.find((item) => item.id === selected);
  const allowAll = session.can("case.assign", "all");
  const everyStatus = Object.keys(lists.statusLabels).filter((value) => value !== "submitted" && value !== "not_submitted");
  const offered = app ? (showAll && allowAll ? everyStatus : app.nextStatuses) : [];

  const set = (key: string, value: string): void => setValues((current) => ({ ...current, [key]: value }));
  const text = (key: string, label: string, placeholder?: string): ReactNode => (
    <Field label={label} key={key}>
      <Input value={values[key] ?? ""} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} />
    </Field>
  );
  const date = (key: string, label: string): ReactNode => (
    <Field label={label} key={key}>
      <Input type="date" value={values[key] ?? ""} onChange={(event) => set(key, event.target.value)} />
    </Field>
  );

  const fieldsFor = (target: string, current: Application): ReactNode[] => {
    const login = [
      "login_completed", "under_process", "query_raised", "eligibility_received",
      "sanctioned", "sanction_accepted", "disbursed", "rejected",
    ].includes(target);
    const sanction = ["sanctioned", "sanction_accepted", "disbursed"].includes(target);
    const out: ReactNode[] = [];
    if (login && !current.loginDate) out.push(date("loginDate", "Login date *"));
    if (login && !current.loginEmployeeId) {
      out.push(
        <Field label="Logged in by *" key="loginEmployeeId">
          <Select value={values.loginEmployeeId ?? ""} onChange={(event) => set("loginEmployeeId", event.target.value)}>
            <option value="">Pick…</option>
            {lists.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>,
      );
    }
    if (login && !current.reference) out.push(text("reference", "Reference number"));
    if (target === "query_raised") out.push(text("query", "The bank's query *"));
    if (current.status === "query_raised" && target !== "query_raised") out.push(text("answer", "How it was resolved"));
    if (target === "eligibility_received" && current.approvedAmount === null) {
      out.push(text("approvedAmount", "Approved amount", "25L"));
    }
    if (sanction && current.sanctionAmount === null) {
      out.push(text("sanctionAmount", "Sanction amount * (from the letter)", "25L"));
    }
    if (sanction && !current.sanctionDate) out.push(date("sanctionDate", "Sanction date *"));
    if (target === "sanction_accepted" && !current.acceptanceDate) out.push(date("acceptanceDate", "Acceptance date *"));
    if (target === "disbursed") {
      out.push(text("disbursementAmount", "Disbursement amount *", "25L"));
      out.push(date("disbursementDate", "Disbursement date *"));
    }
    if (target === "not_eligible_precheck") out.push(text("reason", "Why not eligible *"));
    if (target === "rejected") {
      out.push(
        <Field label="Rejection reason *" key="rejectionReasonId">
          <Select value={values.rejectionReasonId ?? ""} onChange={(event) => set("rejectionReasonId", event.target.value)}>
            <option value="">Pick…</option>
            {lists.rejectionReasons.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>,
      );
    }
    if (target === "withdrawn") out.push(text("reason", "Reason"));
    return out;
  };

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-ink-100 rounded-lg bg-white ring-1 ring-ink-150">
        {summary.applications.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => {
                setSelected(item.id);
                setStatus(null);
                setValues({});
                setShowAll(false);
              }}
              className={cx(
                "flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50",
                selected === item.id && "bg-brand-50",
              )}
            >
              <span className="font-medium">{item.bank}</span>
              <Badge>{item.statusLabel}</Badge>
              {item.bankerName && <span className="text-xs text-ink-500">{item.bankerName}</span>}
            </button>
          </li>
        ))}
      </ul>

      {app && (
        <Card title={`${app.bank}: new status`}>
          {offered.length === 0 && !allowAll ? (
            <p className="text-sm text-ink-500">This application is finished.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {offered.map((value) => (
                <Button
                  key={value}
                  variant={status === value ? "primary" : "secondary"}
                  onClick={() => {
                    setStatus(value);
                    setValues({});
                  }}
                >
                  {lists.statusLabels[value]}
                </Button>
              ))}
            </div>
          )}
          {allowAll && (
            <label className="mt-3 flex items-center gap-2 text-xs text-ink-500">
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              Show all statuses (to correct a mistake)
            </label>
          )}

          {status && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">{fieldsFor(status, app)}</div>
              <Button
                variant="primary"
                className="mt-4"
                disabled={pending}
                onClick={() => {
                  void act(`applications/${app.id}`, { ...values, status, showAllStatuses: showAll });
                  setStatus(null);
                  setValues({});
                  setSelected(null);
                }}
              >
                Save application
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
