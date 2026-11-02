/**
 * The sync against real Postgres, with fictional data only. The MIS's real rows
 * never appear in a test (repo rule). Each test rolls back, so runs stay clean.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MisApplication, MisCustomer, MisData, MisFollowup } from "@domain/work/mis-sync.js";
import { dateOnly, inSyncScope, istInstant, matchEmployee, misClosure, pfoLenderName, rejectedAt } from "@domain/work/mis-sync.js";

import { closeAdminPool, withAdmin } from "./db.js";
import { releaseFromMis, syncFromMis } from "./mis-sync.js";
import { reportRows } from "./reports.js";
import { computeMisReport } from "@domain/reports/mis-report.js";
import type { Queryable } from "./db.js";

class Undo extends Error {}

/** Runs against the test database and always rolls back. */
async function inRollback(fn: (client: Queryable) => Promise<void>): Promise<void> {
  await withAdmin(async (client) => {
    await fn(client);
    throw new Undo();
  }).catch((error: unknown) => {
    if (!(error instanceof Undo)) throw error;
  });
}

let telecallerName = "";
let lender = "";

beforeAll(async () => {
  await withAdmin(async (client) => {
    await client.query(`update app_user set is_active = true where username = 'pfo.automation'`);
    const user = await client.query<{ full_name: string }>(
      `select p.full_name from app_user u join person p on p.id = u.person_id
        where u.is_active and u.username <> 'pfo.automation' order by u.created_at limit 1`,
    );
    telecallerName = user.rows[0]!.full_name;
    const bank = await client.query<{ name: string }>(
      `select o.canonical_name as name from organisation o
        where 'lender' = any (o.roles) and o.parent_organisation_id is null
          and exists (select 1 from organisation b where b.parent_organisation_id = o.id and 'branch' = any (b.roles) and b.is_active)
        order by o.canonical_name limit 1`,
    );
    lender = bank.rows[0]!.name;
  });
});

afterAll(async () => {
  await closeAdminPool();
});

let serial = 0;
const fresh = (): string => {
  serial += 1;
  return String(serial).padStart(4, "0");
};
const mobile = (): string => `9${String(Date.now()).slice(-6)}${String(serial).padStart(3, "0")}`;

function customer(over: Partial<MisCustomer> = {}): MisCustomer {
  return {
    caseId: `MCM-${fresh()}`,
    leadDate: "2026-10-17T00:00:00",
    name: "fictional traders",
    mobile: mobile(),
    place: "COIMBATORE",
    leadSource: "Direct Referral",
    loanType: "Business Loan",
    otherLoanDescription: "OVER DRAFT",
    employmentType: "Proprietorship",
    amount: 2500000,
    assignedId: "EMP-1",
    originalId: "EMP-1",
    documentStatus: "Partially Collected",
    caseStatus: "Login Completed",
    notes: "a note",
    closureDate: null,
    closureReason: null,
    location: "Active",
    createdAt: "2026-10-17T10:48:52",
    ...over,
  };
}

function application(caseId: string, over: Partial<MisApplication> = {}): MisApplication {
  return {
    applicationId: `APP-${fresh()}`,
    caseId,
    lender,
    loginDate: "2026-10-24T00:00:00",
    reference: null,
    loginEmployeeId: "EMP-1",
    status: "Under Review",
    amountApproved: null,
    sanctionAmount: null,
    sanctionDate: null,
    acceptanceStatus: null,
    acceptanceDate: null,
    disbursementAmount: null,
    disbursementDate: null,
    rejectionReason: null,
    notes: null,
    banker: null,
    createdAt: "2026-10-24T14:13:23",
    ...over,
  };
}

function followup(caseId: string, over: Partial<MisFollowup> = {}): MisFollowup {
  return {
    followupId: `FU-${fresh()}`,
    caseId,
    applicationId: null,
    activityAt: "2026-10-20T09:15:00",
    activityType: "Document Request",
    notes: null,
    nextAction: "Collect remaining documents",
    dueDate: "2026-11-03T00:00:00",
    responsibleId: "EMP-1",
    status: "Open",
    completionDate: null,
    ...over,
  };
}

const misData = (over: Partial<MisData>): MisData => ({
  customers: [],
  applications: [],
  followups: [],
  changes: [],
  employees: [{ id: "EMP-1", name: telecallerName }],
  ...over,
});

/** Other test files leave synced cases in this database; those are not this test's. */
const ownIssues = (issues: readonly string[]): string[] => issues.filter((issue) => !issue.includes("no longer in the MIS. Left"));

const ist = (column: string): string => `to_char(${column} at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS')`;

describe("what the MIS's words mean", () => {
  it("takes only active cases from 13 Oct 2026", () => {
    expect(inSyncScope(customer())).toBe(true);
    expect(inSyncScope(customer({ leadDate: "2026-10-13T00:00:00" }))).toBe(true);
    expect(inSyncScope(customer({ leadDate: "2026-10-12T00:00:00" }))).toBe(false);
    expect(inSyncScope(customer({ location: "Archived" }))).toBe(false);
    expect(inSyncScope(customer({ caseId: "MCM-0027" }))).toBe(false);
  });

  it("reads a naive MIS time as Indian time, with no day shift", () => {
    expect(istInstant("2026-10-17T00:00:00")).toBe("2026-10-16T18:30:00.000Z");
    expect(istInstant("2026-10-17")).toBe("2026-10-16T18:30:00.000Z");
    expect(dateOnly("2026-10-17T00:00:00")).toBe("2026-10-17");
    expect(istInstant(null)).toBeNull();
  });

  it("uses PFO's lender names and the MIS's closure reasons", () => {
    expect(pfoLenderName("Aditya Birla Capital")).toBe("Aditya Birla Finance");
    expect(pfoLenderName("Axis Bank")).toBe("Axis Bank");
    expect(misClosure("Disbursed: case complete")).toEqual({ stage: "closed" });
    expect(misClosure("Customer unreachable")).toEqual({ stage: "lost", lostReason: "unreachable" });
  });

  it("matches an employee by full name, then by username, and never guesses", () => {
    const users = [
      { id: "1", username: "chinna", fullName: "Chinna T" },
      { id: "2", username: "tarun", fullName: "Tarun Ramesh" },
    ];
    expect(matchEmployee("CHINNA THAMBI", users)).toBe("1");
    expect(matchEmployee("TARUN RAMESH", users)).toBe("2");
    expect(matchEmployee("NOBODY HERE", users)).toBeNull();
  });

  it("dates a rejection from the Change Log, the last time it became Rejected", () => {
    const app = application("MCM-1", { applicationId: "APP-X" });
    const changes = [
      { recordId: "APP-X", field: "Lender Status", newValue: "Under Review", at: "2026-10-26T10:02:06" },
      { recordId: "APP-X", field: "Lender Status", newValue: "Rejected", at: "2026-10-26T14:15:42" },
    ];
    expect(rejectedAt(app, changes)).toBe("2026-10-26T14:15:42");
    expect(rejectedAt(app, [])).toBe(app.createdAt);
  });
});

describe("syncing", () => {
  it("creates the case as MCM with the MIS's own number and dates", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const report = await syncFromMis(client, misData({ customers: [c] }));
      expect(ownIssues(report.issues)).toEqual([]);
      expect(report.cases.created).toBe(1);

      const { rows } = await client.query(
        `select case_number, firm, stage::text, document_status, mis_managed, requested_amount::text, loan_variant, place,
                lead_received_on::text as lead, ${ist("created_at")} as created
           from loan_case where mis_case_id = $1`,
        [c.caseId],
      );
      expect(rows[0]).toMatchObject({
        case_number: c.caseId,
        firm: "mcm",
        stage: "login_completed",
        document_status: "partial",
        mis_managed: true,
        requested_amount: "2500000.00",
        loan_variant: "OVER DRAFT",
        lead: "2026-10-17",
        created: "2026-10-17 10:48:52",
      });
    });
  });

  it("changes nothing the second time, and writes no second event", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const data = misData({ customers: [c], applications: [application(c.caseId)], followups: [followup(c.caseId)] });
      await syncFromMis(client, data);
      const count = async (): Promise<number> =>
        (await client.query(`select count(*)::int as n from event where source = 'import'`)).rows[0].n as number;
      const before = await count();

      const again = await syncFromMis(client, data);
      expect(again.cases).toEqual({ created: 0, updated: 0, unchanged: 1 });
      expect(again.applications).toEqual({ created: 0, updated: 0, unchanged: 1 });
      expect(again.tasks).toMatchObject({ created: 0, updated: 0, unchanged: 1, closed: 0 });
      expect(await count()).toBe(before);
    });
  });

  it("lets the MIS win on a re-run, and records what changed without personal data", async () => {
    await inRollback(async (client) => {
      const c = customer();
      await syncFromMis(client, misData({ customers: [c] }));
      await client.query(`update loan_case set stage = 'approved' where mis_case_id = $1`, [c.caseId]);

      const moved = { ...c, caseStatus: "Query Raised by Bank", name: "renamed traders" };
      const report = await syncFromMis(client, misData({ customers: [moved] }));
      expect(report.cases.updated).toBe(1);

      const { rows } = await client.query(
        `select c.stage::text, p.full_name, e.payload_after
           from loan_case c
           join case_party cp on cp.case_id = c.id and cp.is_primary
           join person p on p.id = cp.person_id
           join event e on e.case_id = c.id and e.event_type = 'case.synced_from_mis'
          where c.mis_case_id = $1`,
        [c.caseId],
      );
      expect(rows[0].stage).toBe("query_raised");
      expect(rows[0].full_name).toBe("RENAMED TRADERS");
      expect(JSON.stringify(rows[0].payload_after)).not.toContain("RENAMED");
    });
  });

  it("imports an application with its dates, and no login date when the MIS has none", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const withLogin = application(c.caseId);
      const without = application(c.caseId, { loginDate: null, loginEmployeeId: null });
      await syncFromMis(client, misData({ customers: [c], applications: [withLogin, without] }));

      const { rows } = await client.query(
        `select mis_application_id as id, status::text, login_date::text as login, ${ist("submitted_at")} as sent, ${ist("created_at")} as created
           from submission where mis_application_id = any ($1)`,
        [[withLogin.applicationId, without.applicationId]],
      );
      const a = rows.find((r) => r.id === withLogin.applicationId)!;
      const b = rows.find((r) => r.id === without.applicationId)!;
      expect(a).toMatchObject({ status: "under_process", login: "2026-10-24", sent: "2026-10-24 00:00:00" });
      expect(b).toMatchObject({ status: "under_process", login: null, sent: "2026-10-24 14:13:23" });
    });
  });

  it("keeps the bank's words on a rejection and dates it from the Change Log", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const app = application(c.caseId, { status: "Rejected", rejectionReason: "low cibil" });
      await syncFromMis(client, misData({
        customers: [c],
        applications: [app],
        changes: [{ recordId: app.applicationId, field: "Lender Status", newValue: "Rejected", at: "2026-10-26T14:15:42" }],
      }));
      const { rows } = await client.query(
        `select s.bank_reason_text, r.code, ${ist("s.rejected_at")} as at
           from submission s join rejection_reason r on r.id = s.rejection_reason_id
          where s.mis_application_id = $1`,
        [app.applicationId],
      );
      expect(rows[0]).toEqual({ bank_reason_text: "low cibil", code: "not_categorised_mis", at: "2026-10-26 14:15:42" });
    });
  });

  it("records a sanction and disbursement with an offer, and reports one with no amount", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const good = application(c.caseId, {
        status: "Disbursed",
        sanctionAmount: 2000000,
        sanctionDate: "2026-10-25T00:00:00",
        acceptanceStatus: "Accepted",
        acceptanceDate: "2026-10-26T00:00:00",
        disbursementAmount: 1900000,
        disbursementDate: "2026-10-28T00:00:00",
      });
      const bad = application(c.caseId, { status: "Sanctioned" });
      const report = await syncFromMis(client, misData({ customers: [c], applications: [good, bad] }));

      expect(report.applications.created).toBe(1);
      expect(report.issues.join()).toContain(bad.applicationId);
      const { rows } = await client.query(
        `select o.sanctioned_amount::text as amount, o.is_accepted, s.disbursement_date::text as disbursed
           from submission s join offer o on o.submission_id = s.id where s.mis_application_id = $1`,
        [good.applicationId],
      );
      expect(rows[0]).toEqual({ amount: "2000000.00", is_accepted: true, disbursed: "2026-10-28" });

      const again = await syncFromMis(client, misData({ customers: [c], applications: [good] }));
      expect(again.applications.unchanged).toBe(1);
    });
  });

  it("opens and answers a lender query as the status moves", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const app = application(c.caseId, { status: "Query Raised by Bank" });
      await syncFromMis(client, misData({ customers: [c], applications: [app] }));
      const open = async (): Promise<number> =>
        (await client.query(
          `select count(*)::int as n from submission_query q join submission s on s.id = q.submission_id
            where s.mis_application_id = $1 and q.answered_at is null`,
          [app.applicationId],
        )).rows[0].n as number;
      expect(await open()).toBe(1);
      await syncFromMis(client, misData({ customers: [c], applications: [{ ...app, status: "Under Review" }] }));
      expect(await open()).toBe(0);
    });
  });

  it("brings follow-ups across: open as due, completed with its date, cancelled left out", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const open = followup(c.caseId);
      const done = followup(c.caseId, { status: "Completed", completionDate: "2026-10-21T16:05:00", nextAction: "Send file to lenders" });
      const cancelled = followup(c.caseId, { status: "Cancelled" });
      const report = await syncFromMis(client, misData({ customers: [c], followups: [open, done, cancelled] }));
      expect(report.tasks).toMatchObject({ created: 2, skippedCancelled: 1 });

      const { rows } = await client.query(
        `select mis_followup_id as id, kind, (due_at at time zone 'Asia/Kolkata')::date::text as due, ${ist("completed_at")} as completed
           from task where mis_followup_id = any ($1)`,
        [[open.followupId, done.followupId, cancelled.followupId]],
      );
      expect(rows.find((r) => r.id === open.followupId)).toMatchObject({ kind: "collect_remaining_documents", due: "2026-11-03", completed: null });
      expect(rows.find((r) => r.id === done.followupId)).toMatchObject({ kind: "send_to_lenders", completed: "2026-10-21 16:05:00" });
      expect(rows).toHaveLength(2);
    });
  });

  it("closes a task when the MIS cancels or removes its follow-up", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const one = followup(c.caseId);
      const two = followup(c.caseId);
      await syncFromMis(client, misData({ customers: [c], followups: [one, two] }));
      const report = await syncFromMis(client, misData({ customers: [c], followups: [{ ...one, status: "Cancelled" }] }));
      expect(report.tasks.closed).toBe(2);
    });
  });

  it("withdraws an application the MIS no longer has, without deleting it", async () => {
    await inRollback(async (client) => {
      const c = customer();
      const app = application(c.caseId);
      await syncFromMis(client, misData({ customers: [c], applications: [app] }));
      const report = await syncFromMis(client, misData({ customers: [c] }));
      expect(report.issues.join()).toContain(app.applicationId);
      const { rows } = await client.query(`select status::text from submission where mis_application_id = $1`, [app.applicationId]);
      expect(rows[0].status).toBe("withdrawn");
    });
  });

  it("closes a synced case when the MIS archives it, and reopens it on restore", async () => {
    await inRollback(async (client) => {
      const c = customer();
      await syncFromMis(client, misData({ customers: [c] }));
      await syncFromMis(client, misData({ customers: [{ ...c, location: "Archived", closureReason: "Customer unreachable", closureDate: "2026-11-01T00:00:00" }] }));
      const read = async () =>
        (await client.query(`select stage::text, lost_reason::text, stage_before_lost::text as was from loan_case where mis_case_id = $1`, [c.caseId])).rows[0];
      expect(await read()).toEqual({ stage: "lost", lost_reason: "unreachable", was: "login_completed" });
      await syncFromMis(client, misData({ customers: [c] }));
      expect(await read()).toEqual({ stage: "login_completed", lost_reason: null, was: null });
    });
  });

  it("never brings in an archived case or one from before 13 Oct", async () => {
    await inRollback(async (client) => {
      const archived = customer({ location: "Archived" });
      const old = customer({ leadDate: "2026-10-12T00:00:00" });
      const report = await syncFromMis(client, misData({ customers: [archived, old] }));
      expect(report.caseIds).toEqual([]);
    });
  });

  it("reports what it cannot map and leaves it out, without guessing", async () => {
    await inRollback(async (client) => {
      const badStatus = customer({ caseStatus: "Interested" });
      const badMobile = customer({ mobile: "12345" });
      const badOwner = customer({ assignedId: "EMP-99" });
      const c = customer();
      const badLender = application(c.caseId, { lender: "No Such Bank" });
      const report = await syncFromMis(client, misData({
        customers: [badStatus, badMobile, badOwner, c],
        applications: [badLender],
      }));
      expect(report.caseIds).toEqual([c.caseId]);
      expect(ownIssues(report.issues)).toHaveLength(4);
    });
  });

  it("reuses a person with the same mobile and name, and keeps another name apart", async () => {
    await inRollback(async (client) => {
      const first = customer({ name: "shared one" });
      await syncFromMis(client, misData({ customers: [first] }));
      const same = customer({ name: "shared one", mobile: first.mobile });
      const other = customer({ name: "shared two", mobile: first.mobile });
      const report = await syncFromMis(client, misData({ customers: [first, same, other] }));
      expect(report.reusedPeople).toBe(1);
      expect(report.issues.join()).toContain(other.caseId);

      const people = async (id: string): Promise<string> =>
        (await client.query(
          `select p.full_name from case_party cp join loan_case c on c.id = cp.case_id join person p on p.id = cp.person_id where c.mis_case_id = $1`,
          [id],
        )).rows[0].full_name as string;
      expect(await people(first.caseId)).toBe("SHARED ONE");
      expect(await people(same.caseId)).toBe("SHARED ONE");
      expect(await people(other.caseId)).toBe("SHARED TWO");
    });
  });

  it("does not rename a person PFO held before the sync, and says so", async () => {
    await inRollback(async (client) => {
      const c = customer({ name: "held already" });
      await syncFromMis(client, misData({ customers: [c] }));
      await client.query(
        `update person set created_by = null where id = (
           select cp.person_id from case_party cp join loan_case k on k.id = cp.case_id where k.mis_case_id = $1)`,
        [c.caseId],
      );
      const report = await syncFromMis(client, misData({ customers: [{ ...c, name: "new spelling" }] }));
      expect(report.issues.join()).toContain(c.caseId);
    });
  });

  it("names a PFO-only case with the same customer, and changes neither", async () => {
    await inRollback(async (client) => {
      const c = customer();
      await syncFromMis(client, misData({ customers: [c] }));
      const { rows } = await client.query(
        `select c.id, cp.person_id, c.loan_product_id, c.owner_user_id from loan_case c
           join case_party cp on cp.case_id = c.id where c.mis_case_id = $1`,
        [c.caseId],
      );
      const other = await client.query<{ id: string }>(
        `insert into loan_case (case_number, loan_product_id, owner_user_id) values ('PF-2026-99999', $1, $2) returning id`,
        [rows[0].loan_product_id, rows[0].owner_user_id],
      );
      await client.query(
        `insert into case_party (case_id, person_id, role, is_primary, created_by) values ($1, $2, 'applicant', true, $3)`,
        [other.rows[0]!.id, rows[0].person_id, rows[0].owner_user_id],
      );
      const report = await syncFromMis(client, misData({ customers: [c] }));
      expect(report.sameCustomer).toContain(`${c.caseId} and PF-2026-99999`);
      expect(report.cases.unchanged).toBe(1);
      expect(ownIssues(report.issues)).toEqual([]);
      const still = await client.query(`select firm, mis_managed from loan_case where id = $1`, [other.rows[0]!.id]);
      expect(still.rows[0]).toEqual({ firm: "premier", mis_managed: false });
    });
  });

  it("stops touching a case after go-live", async () => {
    await inRollback(async (client) => {
      const c = customer();
      await syncFromMis(client, misData({ customers: [c] }));
      expect(await releaseFromMis(client)).toBeGreaterThanOrEqual(1);
      const report = await syncFromMis(client, misData({ customers: [{ ...c, caseStatus: "Rejected" }] }));
      expect(report.released).toBe(1);
      const { rows } = await client.query(`select stage::text, mis_managed from loan_case where mis_case_id = $1`, [c.caseId]);
      expect(rows[0]).toEqual({ stage: "login_completed", mis_managed: false });
    });
  });

  it("gives the reports the same figures as the MIS's rows", async () => {
    await inRollback(async (client) => {
      const c = customer();
      await syncFromMis(client, misData({
        customers: [c],
        applications: [application(c.caseId)],
        followups: [followup(c.caseId, { dueDate: "2026-10-30T00:00:00" })],
      }));
      const rows = await reportRows(client, "mcm", true);
      const mine = { ...rows, cases: rows.cases.filter((row) => row.caseNumber === c.caseId) };
      const report = computeMisReport({ ...mine, from: "2026-10-01", to: "2026-10-31", today: "2026-11-02" });
      expect(report.cards.activeCases.n).toBe(1);
      expect(report.leadsByLoanType[0]).toMatchObject({ label: "Business Loan", n: 1, amount: 2500000 });
      expect(report.leadsBySource[0]).toMatchObject({ label: "Direct Referral", n: 1 });
    });
  });
});
