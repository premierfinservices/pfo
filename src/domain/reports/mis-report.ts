/**
 * The MIS Dashboard's figures, as one pure function (ADR-046).
 *
 * Each definition is copied from the MIS's own formula, cell named beside it, so
 * "as the MIS counts it" can be checked rather than believed. An active case is
 * Record Location = Active there, and anything not lost or closed here.
 */

export interface ReportCase {
  readonly id: string;
  readonly caseNumber: string;
  readonly customerName: string | null;
  readonly stage: string;
  readonly documentStatus: string;
  readonly ownerId: string;
  readonly originalOwnerId: string;
  readonly leadOn: string;
  readonly amount: number | null;
  readonly loanType: string | null;
  readonly leadSource: string | null;
}

export interface ReportApplication {
  readonly id: string;
  readonly caseId: string;
  readonly status: string;
  readonly loginDate: string | null;
  readonly loginEmployeeId: string | null;
  readonly sanctionDate: string | null;
  readonly sanctionAmount: number | null;
  readonly disbursementDate: string | null;
  readonly disbursementAmount: number | null;
}

export interface ReportTask {
  readonly caseId: string;
  readonly assignedTo: string;
  readonly dueOn: string | null;
}

export interface ReportPerson {
  readonly id: string;
  readonly name: string;
}

export interface ReportInput {
  readonly cases: readonly ReportCase[];
  readonly applications: readonly ReportApplication[];
  readonly tasks: readonly ReportTask[];
  readonly people: readonly ReportPerson[];
  readonly from: string;
  readonly to: string;
  readonly today: string;
  /** "View as": one person's cases, applications and follow-ups. */
  readonly who?: string | null;
}

/** A number, and the cases behind it, so clicking it can open them. */
export interface Cell {
  readonly n: number;
  readonly caseIds: readonly string[];
}

export const PERIODS = [
  { code: "today", label: "Today" },
  { code: "week", label: "This Week" },
  { code: "month", label: "This Month" },
  { code: "quarter", label: "This Quarter" },
  { code: "year", label: "This Year" },
  { code: "fy", label: "This Financial Year" },
  { code: "all", label: "All Time" },
] as const;

const iso = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** The MIS's tblPeriods. `today` is yyyy-mm-dd in India. The week starts Monday. */
export function periodRange(code: string, today: string): { from: string; to: string } | null {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const month = m - 1;
  switch (code) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const back = (new Date(Date.UTC(y, month, d)).getUTCDay() + 6) % 7;
      return { from: iso(y, month, d - back), to: iso(y, month, d - back + 6) };
    }
    case "month":
      return { from: iso(y, month, 1), to: iso(y, month + 1, 0) };
    case "quarter": {
      const first = Math.floor(month / 3) * 3;
      return { from: iso(y, first, 1), to: iso(y, first + 3, 0) };
    }
    case "year":
      return { from: iso(y, 0, 1), to: iso(y, 11, 31) };
    case "fy": {
      const start = month < 3 ? y - 1 : y;
      return { from: iso(start, 3, 1), to: iso(start + 1, 2, 31) };
    }
    case "all":
      return { from: "2000-01-01", to: "2099-12-31" };
    default:
      return null;
  }
}

/** The period of the same length just before this one, which the arrows compare with. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - start) / 86_400_000) + 1;
  const at = (offset: number): string => new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
  return { from: at(-days), to: at(-1) };
}

const FINISHED_APPLICATION = new Set(["disbursed", "rejected", "withdrawn", "not_eligible_precheck"]);
const REVIEWING = new Set(["under_process", "login_completed"]);

const isActive = (c: ReportCase): boolean => c.stage !== "lost" && c.stage !== "closed";
const between = (date: string | null, from: string, to: string): boolean => date !== null && date >= from && date <= to;
/** tblApps[Is Disbursed]: the status, an amount above zero, and a date. */
const isDisbursed = (a: ReportApplication): boolean =>
  a.status === "disbursed" && (a.disbursementAmount ?? 0) > 0 && a.disbursementDate !== null;

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];
/** Counts cases. */
const ofCases = (rows: readonly ReportCase[]): Cell => ({ n: rows.length, caseIds: rows.map((c) => c.id) });
/** Counts rows that are not cases (applications, follow-ups), keeping the cases to open. */
const ofRows = (rows: readonly { caseId: string }[]): Cell => ({ n: rows.length, caseIds: unique(rows.map((r) => r.caseId)) });

export function computeMisReport(input: ReportInput) {
  const { from, to, today, who = null } = input;
  const byId = new Map(input.cases.map((c) => [c.id, c]));
  const caseOf = (row: { caseId: string }): ReportCase | undefined => byId.get(row.caseId);
  const onActive = (row: { caseId: string }): boolean => {
    const c = caseOf(row);
    return c !== undefined && isActive(c);
  };

  const cases = who ? input.cases.filter((c) => c.ownerId === who) : input.cases;
  const applications = who ? input.applications.filter((a) => a.loginEmployeeId === who) : input.applications;
  const tasks = (who ? input.tasks.filter((t) => t.assignedTo === who) : input.tasks).filter(onActive);
  const active = cases.filter(isActive);

  const disbursedIn = (start: string, end: string): ReportApplication[] =>
    input.applications.filter((a) => isDisbursed(a) && between(a.disbursementDate, start, end));
  const appsDisbursedIn = (start: string, end: string): ReportApplication[] =>
    applications.filter((a) => isDisbursed(a) && between(a.disbursementDate, start, end));
  // J7: each case once, by the case's owner rather than who logged it in.
  const customersDisbursedIn = (start: string, end: string): string[] =>
    unique(
      disbursedIn(start, end)
        .filter((a) => !who || caseOf(a)?.ownerId === who)
        .map((a) => a.caseId),
    );
  const value = (rows: readonly ReportApplication[]): number =>
    rows.reduce((sum, a) => sum + (a.disbursementAmount ?? 0), 0);

  const prior = previousPeriod(from, to);
  const openWithDue = tasks.filter((t) => t.dueOn !== null);
  const overdue = openWithDue.filter((t) => t.dueOn! < today);
  const dueToday = openWithDue.filter((t) => t.dueOn === today);
  const sanctions = applications.filter((a) => between(a.sanctionDate, from, to) && (a.sanctionAmount ?? 0) > 0);
  const openCaseIds = new Set(input.tasks.map((t) => t.caseId));
  const notEnded = (c: ReportCase): boolean => c.stage !== "disbursed" && c.stage !== "rejected";

  const customersDisbursed = customersDisbursedIn(from, to);
  const appsDisbursed = appsDisbursedIn(from, to);

  const cards = {
    activeCases: ofCases(active), // B7
    inProgressApplications: ofRows(applications.filter((a) => onActive(a) && !FINISHED_APPLICATION.has(a.status))), // F7
    customersDisbursed: { n: customersDisbursed.length, caseIds: customersDisbursed }, // J7
    applicationsDisbursed: ofRows(appsDisbursed), // N7
    disbursementValue: { n: value(appsDisbursed), caseIds: unique(appsDisbursed.map((a) => a.caseId)) }, // B11
    sanctions: ofRows(sanctions), // Management View C42
    sanctionValue: {
      n: sanctions.reduce((sum, a) => sum + (a.sanctionAmount ?? 0), 0),
      caseIds: unique(sanctions.map((a) => a.caseId)),
    }, // Management View D42
    openFollowups: ofRows(tasks), // F11
    overdueFollowups: ofRows(overdue), // J11
    dueToday: ofRows(dueToday), // S7
    awaitingClosureReview: ofCases(active.filter((c) => !notEnded(c))), // N11
    lenderQueries: ofRows(applications.filter((a) => onActive(a) && a.status === "query_raised")), // S11
    documentsOutstanding: ofCases(active.filter((c) => c.documentStatus !== "complete" && notEnded(c))), // U7
    noNextAction: ofCases(active.filter((c) => notEnded(c) && !openCaseIds.has(c.id))), // U11
  };

  const previous = {
    customersDisbursed: customersDisbursedIn(prior.from, prior.to).length,
    applicationsDisbursed: appsDisbursedIn(prior.from, prior.to).length,
    disbursementValue: value(appsDisbursedIn(prior.from, prior.to)),
  };

  const groupBy = (rows: readonly ReportCase[], key: (c: ReportCase) => string) => {
    const groups = new Map<string, ReportCase[]>();
    for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
    return [...groups.entries()].map(([label, members]) => ({
      label,
      ...ofCases(members),
      amount: members.reduce((sum, c) => sum + (c.amount ?? 0), 0),
    }));
  };

  // Leads count from the whole list, archived included (J30), and do not narrow
  // by "view as": the MIS's own lead tables show everyone.
  const leads = input.cases.filter((c) => between(c.leadOn, from, to));

  const telecallers = input.people
    .map((person) => {
      const cohort = leads.filter((c) => c.originalOwnerId === person.id);
      const disbursedCases = new Set(input.applications.filter(isDisbursed).map((a) => a.caseId));
      const won = cohort.filter((c) => disbursedCases.has(c.id));
      const theirTasks = input.tasks.filter((t) => t.assignedTo === person.id && onActive(t));
      return {
        id: person.id,
        name: person.name,
        leads: ofCases(cohort), // E37
        disbursed: ofCases(won), // F37
        conversion: cohort.length === 0 ? null : won.length / cohort.length, // G37
        activeNow: ofCases(input.cases.filter((c) => c.ownerId === person.id && isActive(c))), // H37
        rejected: ofCases(cohort.filter((c) => c.stage === "rejected")), // I37
        closedWithoutDisbursement: ofCases(cohort.filter((c) => !isActive(c) && !disbursedCases.has(c.id))), // J37
        openFollowups: ofRows(theirTasks), // K37
        overdueFollowups: ofRows(theirTasks.filter((t) => t.dueOn !== null && t.dueOn < today)), // L37
      };
    })
    .filter((row) => row.leads.n + row.activeNow.n + row.openFollowups.n > 0);

  const loginTeam = input.people
    .map((person) => {
      const theirs = input.applications.filter((a) => a.loginEmployeeId === person.id);
      const cohort = theirs.filter((a) => between(a.loginDate, from, to));
      const won = cohort.filter(isDisbursed);
      const theirTasks = input.tasks.filter((t) => t.assignedTo === person.id && onActive(t));
      return {
        id: person.id,
        name: person.name,
        submitted: ofRows(cohort), // E53
        disbursed: ofRows(won), // F53
        successRate: cohort.length === 0 ? null : won.length / cohort.length, // G53
        underReview: ofRows(theirs.filter((a) => onActive(a) && REVIEWING.has(a.status))), // H53
        queries: ofRows(theirs.filter((a) => onActive(a) && a.status === "query_raised")), // I53
        openFollowups: ofRows(theirTasks),
        overdueFollowups: ofRows(theirTasks.filter((t) => t.dueOn !== null && t.dueOn < today)),
      };
    })
    .filter((row) => row.submitted.n + row.underReview.n + row.queries.n > 0);

  const week = Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000;
  const weekEnd = new Date(week).toISOString().slice(0, 10);
  const workload = input.people
    .map((person) => {
      const open = input.tasks.filter((t) => t.assignedTo === person.id && onActive(t));
      const owned = input.cases.filter((c) => c.ownerId === person.id && isActive(c));
      return {
        id: person.id,
        name: person.name,
        open: ofRows(open), // E67
        overdue: ofRows(open.filter((t) => t.dueOn !== null && t.dueOn < today)),
        dueToday: ofRows(open.filter((t) => t.dueOn === today)),
        nextSevenDays: ofRows(open.filter((t) => t.dueOn !== null && t.dueOn > today && t.dueOn <= weekEnd)),
        activeCases: ofCases(owned),
        noNextAction: ofCases(owned.filter((c) => notEnded(c) && !openCaseIds.has(c.id))),
        activeApplications: ofRows(
          input.applications.filter(
            (a) => a.loginEmployeeId === person.id && onActive(a) && !FINISHED_APPLICATION.has(a.status),
          ),
        ),
      };
    })
    .filter((row) => row.open.n + row.activeCases.n + row.activeApplications.n > 0);

  return {
    from,
    to,
    today,
    cards,
    previous,
    pipeline: groupBy(active, (c) => c.stage),
    activeVsClosed: { active: ofCases(active), closed: ofCases(cases.filter((c) => !isActive(c))) },
    leadsByLoanType: groupBy(leads, (c) => c.loanType ?? "Not recorded").sort((a, b) => b.n - a.n).slice(0, 10),
    leadsBySource: groupBy(leads, (c) => c.leadSource ?? "Not recorded"),
    telecallers,
    loginTeam,
    workload,
  };
}

export type MisReport = ReturnType<typeof computeMisReport>;
