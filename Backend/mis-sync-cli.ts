/**
 * npm run mis:sync                 Dry run: does everything, shows the result, undoes it.
 * npm run mis:sync -- --apply      The same, and keeps it.
 * npm run mis:sync -- --go-live    Hands every synced case over to PFO. See ADR-046.
 *
 * After the sync, in the same transaction, the figures PFO now reports are compared
 * with the same figures worked out from the MIS's own rows. Any difference undoes
 * the run. The output holds IDs and counts only, never customer details.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { computeMisReport } from "@domain/reports/mis-report.js";
import { dateOnly, misDocumentStatus, misLenderStatus, misStage, type MisData } from "@domain/work/mis-sync.js";

import { closeAdminPool, withAdmin } from "./db.js";
import { loadDotEnv } from "./env.mjs";
import { releaseFromMis, syncFromMis } from "./mis-sync.js";
import { reportRows } from "./reports.js";

loadDotEnv();

const MIS_PATH = process.env.PFO_MIS_PATH ?? "C:\\WORK FILES\\Mint Capital Management\\MIS\\MIS.xlsm";

function readMis(): MisData {
  const script = fileURLToPath(new URL("../Scripts/mis_extract.py", import.meta.url));
  const run = spawnSync("python", [script, MIS_PATH], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`Could not read the MIS: ${run.stderr || run.error?.message}`);
  return JSON.parse(run.stdout) as MisData;
}

class DryRun extends Error {}

/** Headline figures from the MIS's rows for the synced cases, by the same definitions. */
function figuresFromMis(data: MisData, caseNumbers: ReadonlySet<string>, today: string, people: Map<string, string>) {
  const cases = data.customers
    .filter((c) => caseNumbers.has(c.caseId))
    .map((c) => ({
      id: c.caseId,
      caseNumber: c.caseId,
      customerName: null,
      stage: c.location === "Active" ? (misStage(c.caseStatus) ?? "?") : "lost",
      documentStatus: misDocumentStatus(c.documentStatus) ?? "?",
      ownerId: people.get(c.assignedId ?? "") ?? "?",
      originalOwnerId: people.get(c.originalId ?? c.assignedId ?? "") ?? "?",
      leadOn: dateOnly(c.leadDate) ?? "",
      amount: c.amount,
      loanType: c.loanType,
      leadSource: c.leadSource,
    }));
  const applications = data.applications
    .filter((a) => caseNumbers.has(a.caseId))
    .map((a) => ({
      id: a.applicationId,
      caseId: a.caseId,
      status: misLenderStatus(a.status) ?? "?",
      loginDate: dateOnly(a.loginDate),
      loginEmployeeId: people.get(a.loginEmployeeId ?? "") ?? null,
      sanctionDate: dateOnly(a.sanctionDate),
      sanctionAmount: a.sanctionAmount,
      disbursementDate: dateOnly(a.disbursementDate),
      disbursementAmount: a.disbursementAmount,
    }));
  const tasks = data.followups
    .filter((f) => caseNumbers.has(f.caseId) && f.status === "Open")
    .map((f) => ({ caseId: f.caseId, assignedTo: people.get(f.responsibleId ?? "") ?? "?", dueOn: dateOnly(f.dueDate) }));
  return { cases, applications, tasks };
}

type Figures = ReturnType<typeof computeMisReport>;

function headline(report: Figures): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, cell] of Object.entries(report.cards)) out[key] = cell.n;
  for (const row of report.pipeline) out[`pipeline:${row.label}`] = row.n;
  for (const row of report.leadsByLoanType) out[`leads:${row.label}`] = row.n;
  for (const row of report.leadsBySource) out[`source:${row.label}`] = row.n;
  return out;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));

  if (args.has("--go-live")) {
    const released = await withAdmin((client) => releaseFromMis(client));
    console.log(`${released} case(s) handed over to PFO. The sync will no longer touch them.`);
    return;
  }

  const apply = args.has("--apply");
  const data = readMis();
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const range = { from: "2000-01-01", to: "2099-12-31", today };
  let mismatches: string[] = [];

  await withAdmin(async (client) => {
    const report = await syncFromMis(client, data);

    const rows = await reportRows(client, "mcm", true);
    const inPfo = headline(computeMisReport({ ...rows, ...range }));

    const { rows: users } = await client.query<{ id: string; username: string }>(`select id, username from app_user`);
    const byUsername = new Map(users.map((u) => [u.username, u.id]));
    const people = new Map(Object.entries(report.employees).map(([emp, username]) => [emp, byUsername.get(username)!]));
    const fromMis = headline(
      computeMisReport({
        ...figuresFromMis(data, new Set(report.caseIds), today, people),
        people: rows.people,
        ...range,
      }),
    );
    mismatches = [...new Set([...Object.keys(inPfo), ...Object.keys(fromMis)])]
      .filter((key) => inPfo[key] !== fromMis[key])
      .map((key) => `${key}: MIS ${fromMis[key] ?? 0}, PFO ${inPfo[key] ?? 0}`);

    console.log(apply ? "APPLY" : "DRY RUN (nothing kept)");
    console.log("Cases:", report.caseIds.join(", ") || "none");
    console.log("Case rows:", JSON.stringify(report.cases), "released:", report.released, "existing people reused:", report.reusedPeople);
    console.log("Applications:", JSON.stringify(report.applications));
    console.log("Tasks:", JSON.stringify(report.tasks));
    console.log("Employees:", JSON.stringify(report.employees));
    console.log("Figures now in PFO:", JSON.stringify(inPfo));
    console.log(mismatches.length ? `MISMATCHES:\n  ${mismatches.join("\n  ")}` : "Figures match the MIS.");
    console.log(report.issues.length ? `Needs a look:\n  ${report.issues.join("\n  ")}` : "No issues.");

    if (mismatches.length > 0) throw new Error("Figures differ from the MIS; nothing was kept.");
    if (!apply) throw new DryRun();
  }).catch((error: unknown) => {
    if (!(error instanceof DryRun)) throw error;
  });
  console.log(apply ? "Done. Kept." : "Dry run finished. Run with --apply to keep it.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeAdminPool());
