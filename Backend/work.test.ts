/**
 * Log a Case, Update Case and the work engine, end to end (ADR-040).
 *
 * The scenarios are the MIS's own (`test_quick.py`), rewritten against PFO over
 * real HTTP and real Postgres, with fictional data. "As automated as the MIS"
 * is what passing this file means.
 */

import { zipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { hashPassword } from "@domain/auth/password.js";
import type { Role } from "@domain/permissions/index.js";

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiServer } from "./api-server.js";
import { pool, withActor } from "./db.js";

// The model is only ever asked about files whose names say nothing; tests decide its answer.
const classify = vi.hoisted(() => vi.fn());
vi.mock("./inbound-classification-client.js", () => ({ classifyAttachment: classify }));

const unsure = { documentTypeCode: null, confidence: 0, periodStart: undefined, periodEnd: undefined, extractedFields: {}, reasoning: "", rawModelResponse: null };
const readAs = (documentTypeCode: string, confidence = 0.95, over: Record<string, unknown> = {}) =>
  classify.mockResolvedValue({ ...unsure, documentTypeCode, confidence, ...over });

let baseUrl: string;
let server: ReturnType<typeof createApiServer>;
let storage: ChildProcess;
const storageRoot = mkdtempSync(join(tmpdir(), "pfo-work-test-"));

const PASSWORD = "integration-test-password";

interface Session {
  readonly token: string;
  readonly userId: string;
}

async function signInAs(...roles: Role[]): Promise<Session> {
  const username = `work.${randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(PASSWORD);
  await withActor(null, async (client) => {
    const person = await client.query<{ id: string }>(`insert into person (full_name) values ($1) returning id`, [
      `Test ${username}`,
    ]);
    const user = await client.query<{ id: string }>(
      `insert into app_user (person_id, auth_identity_id, username, password_hash, is_active)
       values ($1, $2, $3, $4, true) returning id`,
      [person.rows[0]!.id, randomUUID(), username, passwordHash],
    );
    for (const role of roles) {
      await client.query(`insert into user_role (user_id, role, granted_by) values ($1, $2, $1)`, [
        user.rows[0]!.id,
        role,
      ]);
    }
  });
  const { status, body } = await api("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  expect(status, JSON.stringify(body)).toBe(200);
  return { token: body.token, userId: body.user.id };
}

async function api(
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

function today(days = 0): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

let mobileCounter = 0;
function freshMobile(): string {
  mobileCounter += 1;
  return `9${String(Date.now()).slice(-6)}${String(mobileCounter).padStart(3, "0")}`;
}

function caseBody(over: Record<string, unknown> = {}) {
  return {
    customerName: "demo customer",
    mobile: freshMobile(),
    place: "coimbatore",
    amount: "25L",
    loanType: "Business Loan",
    variant: "Fresh",
    leadSource: "direct_referral",
    employmentType: "proprietorship",
    pickupDate: today(1),
    ...over,
  };
}

async function logCase(session: Session, over: Record<string, unknown> = {}) {
  const logged = await api("/api/work/log-case", { method: "POST", token: session.token, body: caseBody(over) });
  expect(logged.status, JSON.stringify(logged.body)).toBe(200);
  return logged.body;
}

const act = (session: Session, caseId: string, path: string, body: unknown = {}) =>
  api(`/api/work/cases/${caseId}/${path}`, { method: "POST", token: session.token, body });

async function ok(session: Session, caseId: string, path: string, body: unknown = {}) {
  const result = await act(session, caseId, path, body);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body;
}

async function aLender(name = "HDFC Bank"): Promise<string> {
  const { rows } = await pool.query(`select id from organisation where canonical_name = $1`, [name]);
  expect(rows[0], `${name} missing`).toBeDefined();
  return rows[0].id;
}

/** A case already sent to one lender, returning the case and application id. */
async function sentCase(session: Session) {
  const logged = await logCase(session);
  const sent = await ok(session, logged.id, "send", { lenders: [{ id: await aLender(), banker: "ravi" }] });
  return { caseId: logged.id as string, appId: sent.applications[0].id as string };
}

const loginFields = (session: Session) => ({
  loginDate: today(),
  loginEmployeeId: session.userId,
  reference: "REF-1",
});

beforeAll(async () => {
  classify.mockResolvedValue(unsure);
  server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await pool.query(`update document_requirement_rule set is_active = code like 'mis\\_%'`);

  // Its own storage backend on the test port, rooted in a temp folder, as
  // documents.test.ts does: never the office disk.
  storage = spawn(process.execPath, ["Backend/storage-server.mjs"], {
    env: { ...process.env, PFO_STORAGE_PORT: "4329", PFO_STORAGE_ROOT: storageRoot },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const up = await fetch("http://127.0.0.1:4329/health").then((r) => r.ok, () => false);
    if (up) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
});

afterAll(async () => {
  storage.kill();
  rmSync(storageRoot, { recursive: true, force: true });
  await pool.query(`
    update document_requirement_rule r
       set is_active = r.code not like 'mis\\_%'
                   and not exists (select 1 from document_type dt
                                    where dt.id = r.document_type_id and dt.artifact_kind <> 'customer')`);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
});

describe("Log a Case", () => {
  it("creates the case at Documents Pending, in capitals, with the first task and the next step", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);

    expect(logged.stage).toBe("documents_pending");
    expect(logged.customerName).toBe("DEMO CUSTOMER");
    expect(logged.place).toBe("COIMBATORE");
    expect(logged.amount).toBe(2500000);
    expect(logged.amountInWords).toBe("Twenty Five Lakh Rupees");
    expect(logged.loanType).toBe("Business Loan");
    expect(logged.loanVariant).toBe("Fresh");
    expect(logged.documentStatus).toBe("pending");
    expect(logged.eligibilityStatus).toBe("unanswered");
    expect(logged.tasks).toHaveLength(1);
    expect(logged.tasks[0].title).toBe("Collect documents");
    expect(logged.tasks[0].dueOn).toBe(today(1));
    expect(logged.next).toContain("Next: Collect documents.");
  });

  it.each([
    [{ customerName: "  " }, "name"],
    [{ mobile: "12345" }, "mobile"],
    [{ place: "" }, "place"],
    [{ amount: "lots" }, "amount"],
    [{ loanType: "Nonsense" }, "loan type"],
    [{ loanType: "Other Loan Types", variant: "" }, "Variant"],
    [{ leadSource: "" }, "lead source"],
    [{ employmentType: "" }, "employment"],
    [{ pickupDate: today(-1) }, "past"],
  ])("refuses a bad field %j", async (over, word) => {
    const session = await signInAs("telecaller");
    const result = await api("/api/work/log-case", { method: "POST", token: session.token, body: caseBody(over) });
    expect(result.status).toBe(400);
    expect(result.body.message).toContain(word);
  });

  it("shows a duplicate mobile, refuses without the tick, and records the override", async () => {
    const session = await signInAs("telecaller");
    const mobile = freshMobile();
    const first = await logCase(session, { mobile });

    const match = await api(`/api/work/mobile?mobile=${mobile}`, { token: session.token });
    expect(match.body.matches.map((m: any) => m.caseNumber)).toEqual([first.caseNumber]);

    const refused = await api("/api/work/log-case", { method: "POST", token: session.token, body: caseBody({ mobile }) });
    expect(refused.status).toBe(409);

    const second = await logCase(session, { mobile, differentCustomer: true, customerName: "another" });
    const { rows } = await pool.query(`select duplicate_override_note from loan_case where id = $1`, [second.id]);
    expect(rows[0].duplicate_override_note).toContain(first.caseNumber);
  });

  it("tells a telecaller a mobile is taken without naming another owner's case", async () => {
    const manager = await signInAs("manager");
    const mobile = freshMobile();
    const theirs = await logCase(manager, { mobile });
    const telecaller = await signInAs("telecaller");

    const match = await api(`/api/work/mobile?mobile=${mobile}`, { token: telecaller.token });
    expect(match.body.matches).toEqual([]);
    expect(match.body.hidden).toBe(1);

    const refused = await api("/api/work/log-case", { method: "POST", token: telecaller.token, body: caseBody({ mobile }) });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain("1 other case");
    expect(refused.body.message).not.toContain(theirs.caseNumber);

    const second = await logCase(telecaller, { mobile, differentCustomer: true });
    const { rows } = await pool.query(`select duplicate_override_note from loan_case where id = $1`, [second.id]);
    expect(rows[0].duplicate_override_note).not.toContain(theirs.caseNumber);
  });

  it("assigns the telecaller chosen, not the person typing", async () => {
    const manager = await signInAs("manager");
    const telecaller = await signInAs("telecaller");
    const logged = await logCase(manager, { telecallerId: telecaller.userId });
    const { rows } = await pool.query(`select owner_user_id from loan_case where id = $1`, [logged.id]);
    expect(rows[0].owner_user_id).toBe(telecaller.userId);
    const queue = await api("/api/work/queue", { token: telecaller.token });
    expect(queue.body.map((t: any) => t.caseId)).toContain(logged.id);
  });

  it("offers every MIS list", async () => {
    const session = await signInAs("telecaller");
    const lists = (await api("/api/work/lists", { token: session.token })).body;
    expect(lists.loanTypes).toHaveLength(17);
    expect(lists.employmentTypes).toHaveLength(8);
    expect(lists.leadSources).toHaveLength(2);
    expect(lists.places.length).toBeGreaterThanOrEqual(262);
    expect(lists.places).toContain("COIMBATORE");
  });
});

describe("the MIS lender list", () => {
  it("holds every MIS lender once, keeps PFO's names, and switches public sector banks off", async () => {
    const { rows } = await pool.query(
      `select o.canonical_name, o.is_active from organisation o
         join lender_profile p on p.organisation_id = o.id
        where o.parent_organisation_id is null`,
    );
    const names = rows.map((row) => row.canonical_name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("SMFG India Credit");
    expect(names).not.toContain("SMFG India Credit - Fullerton India");
    expect(names).toContain("Aditya Birla Finance");
    expect(names).not.toContain("Aditya Birla Capital");
    expect(names).toContain("Sundaram Finance");
    for (const row of rows) {
      if (["State Bank of India", "Canara Bank", "Indian Bank", "UCO Bank"].includes(row.canonical_name)) {
        expect(row.is_active, row.canonical_name).toBe(false);
      }
    }
    expect(rows.find((row) => row.canonical_name === "HDFC Bank").is_active).toBe(true);
  });

  it("lists lenders supporting the loan type first, and never public sector banks", async () => {
    const session = await signInAs("login_executive");
    const logged = await logCase(session, { loanType: "Home Loan" });
    const options = (await api(`/api/work/cases/${logged.id}/lenders`, { token: session.token })).body;
    const firstUnsupported = options.findIndex((o: any) => !o.supports);
    expect(options.slice(firstUnsupported).every((o: any) => !o.supports)).toBe(true);
    expect(options.some((o: any) => o.supports)).toBe(true);
    expect(options.map((o: any) => o.name)).not.toContain("State Bank of India");
  });
});

describe("documents, then eligibility", () => {
  it("partly received moves to Eligibility Check and asks the question", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const updated = await ok(session, logged.id, "documents", { which: "part" });

    expect(updated.stage).toBe("eligibility_check");
    expect(updated.documentStatus).toBe("partial");
    expect(updated.done).toContain("partly received");
    expect(updated.next).toContain("Check eligibility");
    expect(updated.tasks.map((t: any) => t.title)).toEqual(["Check eligibility"]);
  });

  it("not eligible closes the case, closes its tasks, and can be reopened", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    await ok(session, logged.id, "documents", { which: "part" });
    const closed = await ok(session, logged.id, "eligibility", { answer: "not_eligible", note: "CIBIL" });

    expect(closed.stage).toBe("lost");
    expect(closed.lostReason).toBe("customer_not_eligible");
    expect(closed.tasks).toEqual([]);
    expect(closed.next).toContain("not eligible");

    const reopened = await api(`/api/cases/${logged.id}/reopen`, { method: "POST", token: session.token });
    expect(reopened.body.stage).toBe("eligibility_check");
  });

  it("eligible with documents outstanding goes back to collecting, on the chosen date", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    await ok(session, logged.id, "documents", { which: "part" });
    const eligible = await ok(session, logged.id, "eligibility", { answer: "eligible", nextDate: today(3) });

    expect(eligible.stage).toBe("documents_pending");
    expect(eligible.eligibilityStatus).toBe("eligible");
    expect(eligible.tasks[0].title).toBe("Collect remaining documents");
    expect(eligible.tasks[0].dueOn).toBe(today(3));
  });

  it("fully received with eligibility unanswered still asks; then goes to Documents Collected", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const all = await ok(session, logged.id, "documents", { which: "all" });
    expect(all.stage).toBe("eligibility_check");

    const eligible = await ok(session, logged.id, "eligibility", { answer: "eligible" });
    expect(eligible.stage).toBe("documents_collected");
    expect(eligible.next).toContain("Send file to lenders");
  });

  it("an already-eligible case that gets everything goes straight to Documents Collected", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    await ok(session, logged.id, "documents", { which: "part" });
    await ok(session, logged.id, "eligibility", { answer: "eligible", nextDate: today(1) });
    const all = await ok(session, logged.id, "documents", { which: "all" });
    expect(all.stage).toBe("documents_collected");
    expect(all.tasks.map((t: any) => t.title)).toEqual(["Send file to lenders"]);
  });

  it("a date in the past is refused and changes nothing", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const refused = await act(session, logged.id, "documents", { which: "pending", nextDate: today(-1) });
    expect(refused.status).toBe(400);
    const { rows } = await pool.query(`select count(*)::int as n from task where case_id = $1`, [logged.id]);
    expect(rows[0].n).toBe(1);
  });
});

describe("the checklist only informs", () => {
  it("asks a salaried personal loan for short, relevant documents", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session, { loanType: "Personal Loan", employmentType: "salaried" });
    const labels = logged.pending.map((p: any) => p.label).join(" | ");
    expect(labels).toContain("PAN");
    expect(labels).toContain("Salary Slip");
    expect(labels).not.toContain("ITR");
    expect(labels).not.toContain("GST");
    expect(labels).not.toContain("Application Form");
    expect(labels).not.toContain("Sale Deed");
    expect(logged.pending.length).toBeLessThanOrEqual(8);
  });

  it("asks a proprietor's LAP for income and property, and no application form", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session, { loanType: "Loan Against Property (LAP)", employmentType: "proprietorship" });
    const labels = logged.pending.map((p: any) => p.label).join(" | ");
    for (const expected of ["ITR", "GST 3B", "Bank Statement", "Sale Deed", "Encumbrance"]) {
      expect(labels).toContain(expected);
    }
    expect(labels).not.toContain("Application Form");
  });

  it("removes an item from one case in one tap, with no reason", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const before = logged.pending.length;
    const after = await ok(session, logged.id, `requirements/${logged.pending[0].id}/not-needed`);
    expect(after.pending).toHaveLength(before - 1);
    expect(after.notNeeded.map((n: any) => n.id)).toEqual([logged.pending[0].id]);

    const restored = await ok(session, logged.id, `requirements/${logged.pending[0].id}/restore`);
    expect(restored.pending).toHaveLength(before);
    expect(restored.notNeeded).toEqual([]);

    // It stays restored when the checklist is worked out again.
    const reread = (await api(`/api/work/cases/${logged.id}`, { token: session.token })).body;
    expect(reread.pending).toHaveLength(before);
  });

  it("does not stop a file going to a lender with everything pending", async () => {
    const session = await signInAs("login_executive");
    const logged = await logCase(session);
    expect(logged.pending.length).toBeGreaterThan(0);
    const sent = await ok(session, logged.id, "send", { lenders: [{ id: await aLender(), banker: "" }] });
    expect(sent.applications).toHaveLength(1);
    expect(sent.applications[0].statusLabel).toBe("Not Logged In");
  });
});

describe("uploading a case folder", () => {
  const upload = async (session: Session, caseId: string, name: string, content = `bytes of ${name}`, folder = "") => {
    const response = await fetch(`${baseUrl}/api/work/cases/${caseId}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "X-File-Name": encodeURIComponent(name),
        "X-File-Folder": encodeURIComponent(folder),
      },
      body: content,
    });
    const body: any = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body;
  };
  const summaryOf = async (session: Session, caseId: string) =>
    (await api(`/api/work/cases/${caseId}`, { token: session.token })).body;

  it("guides to the upload once documents are marked received", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const part = await ok(session, logged.id, "documents", { which: "part" });
    expect(part.next).toContain("Upload the documents received");
    await upload(session, logged.id, "PAN - Demo.pdf");
    expect((await summaryOf(session, logged.id)).next).not.toContain("Upload the documents received");
  });

  it("files a whole folder in any order, each answering its own pending line", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    for (const name of ["Photo - Demo.jpg", "PAN - Demo.pdf", "Aadhaar - Demo.jpeg"]) {
      expect((await upload(session, logged.id, name)).result).toBe("filed");
    }
    const after = await summaryOf(session, logged.id);
    const labels = after.pending.map((p: any) => p.label);
    expect(labels).not.toContain("PAN Card");
    expect(labels).not.toContain("Aadhaar Card");
    expect(after.uploaded).toHaveLength(3);
  });

  it("keeps twelve monthly 3B files apart, counts them, and clears the line at twelve", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const months = ["Apr 2025", "May 2025", "Jun 2025", "Jul 2025", "Aug 2025", "Sep 2025", "Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026"];
    for (const [index, month] of months.entries()) {
      await upload(session, logged.id, `GSTR-3B ${month}.pdf`);
      const now = await summaryOf(session, logged.id);
      const line = now.pending.find((p: any) => p.label.startsWith("GST 3B"));
      if (index < 11) expect(line.label).toContain(`${index + 1} of 12 months in`);
      else expect(line).toBeUndefined();
    }
    const rows = await api(`/api/cases/${logged.id}/requirements`, { token: session.token });
    const files = rows.body.requirements.filter((r: any) => r.isCustom).map((r: any) => r.document.fileName);
    expect(new Set(files).size).toBe(12);
  });

  it("takes a split ITR as separate documents under the right year, in any order", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    for (const name of ["P&L AY 2025-26.pdf", "Balance Sheet AY 2025-26.pdf", "ITR Computation AY 2025-26.pdf", "ITR AY 2025-26 - Demo.pdf"]) {
      expect((await upload(session, logged.id, name)).result).toBe("filed");
    }
    const { rows } = await pool.query(
      `select dt.code, r.period_start::text from document_requirement r
         join document_type dt on dt.id = r.document_type_id
        where r.case_id = $1 and r.uploaded_document_id is not null`,
      [logged.id],
    );
    expect(rows.map((r) => r.code).sort()).toEqual(["balance_sheet", "computation_income", "itr", "profit_and_loss"]);
    for (const row of rows) expect(row.period_start).toBe("2024-04-01");
  });

  it("never drops an unknown file, and skips a repeat and the generated list", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    expect((await upload(session, logged.id, "DOC-WA0016.pdf")).result).toBe("other");
    expect((await upload(session, logged.id, "DOC-WA0016.pdf")).result).toBe("duplicate");
    expect((await upload(session, logged.id, "Pending Documents.txt")).result).toBe("skipped");
    expect((await summaryOf(session, logged.id)).uploaded).toHaveLength(1);
  });

  it("shows organize's figures beside the eligibility question", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const result = await upload(session, logged.id, "GST and ITR Summary.txt", "TOTAL  Rs. 1,00,000");
    expect(result.result).toBe("summary");
    expect((await summaryOf(session, logged.id)).financialSummary).toContain("1,00,000");
  });

  it("refuses another telecaller's case", async () => {
    const owner = await signInAs("telecaller");
    const stranger = await signInAs("telecaller");
    const logged = await logCase(owner);
    const response = await fetch(`${baseUrl}/api/work/cases/${logged.id}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${stranger.token}`, "X-File-Name": "PAN.pdf" },
      body: "x",
    });
    expect(response.status).toBe(404);
  });
});

describe("the document drop reads, renames and unpacks", () => {
  beforeEach(() => classify.mockReset().mockResolvedValue(unsure));

  const post = async (session: Session, caseId: string, name: string, content: string | Uint8Array, contentType = "application/pdf") => {
    const response = await fetch(`${baseUrl}/api/work/cases/${caseId}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}`, "X-File-Name": encodeURIComponent(name), "Content-Type": contentType },
      body: content,
    });
    const body: any = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body;
  };
  const stored = async (caseId: string) =>
    (
      await pool.query(
        `select d.file_name, d.original_file_name, d.content_sha256, dt.code
           from document_requirement r
           join document d on d.id = r.uploaded_document_id
           join document_type dt on dt.id = d.document_type_id
          where r.case_id = $1 order by d.uploaded_at`,
        [caseId],
      )
    ).rows;

  it("treats the same bytes under another name as a repeat", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    expect((await post(session, logged.id, "PAN - Demo.pdf", "same bytes")).result).toBe("filed");
    expect((await post(session, logged.id, "Copy of PAN.pdf", "same bytes")).result).toBe("duplicate");
    expect(await stored(logged.id)).toHaveLength(1);
  });

  it("identifies a file whose name says nothing by what is in it, and files it under that type", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    readAs("pan_card");
    const answer = await post(session, logged.id, "DOC-WA0016.pdf", "a scanned pan");
    expect(answer).toMatchObject({ result: "filed", readByAi: true, documentTypeCode: "pan_card" });
    const [row] = await stored(logged.id);
    expect(row.code).toBe("pan_card");
    expect(row.file_name).toMatch(/^PAN Card - .+\.pdf$/);
    expect(row.original_file_name).toBe("DOC-WA0016.pdf");
    expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("files it as Other Document when the model is unsure, names a type that is not on offer, or cannot be reached", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    readAs("pan_card", 0.4);
    expect((await post(session, logged.id, "a.pdf", "low confidence")).result).toBe("other");
    readAs("not_a_real_type");
    expect((await post(session, logged.id, "b.pdf", "invented type")).result).toBe("other");
    classify.mockResolvedValue({ ...unsure, reasoning: "Could not reach the Claude API: network error" });
    expect((await post(session, logged.id, "c.pdf", "model down")).result).toBe("other");
    expect((await stored(logged.id)).map((r) => r.code)).toEqual(["other_document", "other_document", "other_document"]);
  });

  it("never sends a file to the model when its name already says what it is, or it is a repeat, or it is not a PDF or image", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    await post(session, logged.id, "PAN - Demo.pdf", "named");
    await post(session, logged.id, "WA1.pdf", "first");
    await post(session, logged.id, "WA1 again.pdf", "first");
    await post(session, logged.id, "notes.docx", "word", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(classify).toHaveBeenCalledTimes(1);
  });

  it("stores two documents of one type under different names", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    readAs("sale_deed");
    await post(session, logged.id, "scan1.pdf", "page one");
    await post(session, logged.id, "scan2.pdf", "page two");
    const names = (await stored(logged.id)).map((r) => r.file_name);
    expect(new Set(names).size).toBe(2);
    expect(names[1]).toMatch(/\(2\)\.pdf$/);
  });

  it("opens a zip and files each file inside it as if it had been dropped", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const enc = (v: string) => new TextEncoder().encode(v);
    const zip = zipSync({ "KYC/PAN - Demo.pdf": enc("pan"), "KYC/Aadhaar - Demo.jpeg": enc("aadhaar"), "Pending Documents.txt": enc("x") });
    const answer = await post(session, logged.id, "Documents.zip", zip, "application/zip");
    expect(answer.result).toBe("archive");
    expect(answer.files.map((f: any) => f.result).sort()).toEqual(["filed", "filed", "skipped"]);
    expect((await stored(logged.id)).map((r) => r.code).sort()).toEqual(["aadhaar_card", "pan_card"]);
  });

  it("says what it could not open: a RAR, a broken zip, a zip inside a zip", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    expect((await post(session, logged.id, "Docs.rar", "rar bytes", "application/octet-stream")).result).toBe("unreadable_archive");
    expect((await post(session, logged.id, "Broken.zip", "not a zip", "application/zip")).result).toBe("unreadable_archive");
    const inner = zipSync({ "a.pdf": new TextEncoder().encode("a") });
    const outer = zipSync({ "inner.zip": inner });
    const answer = await post(session, logged.id, "Outer.zip", outer, "application/zip");
    expect(answer.files[0]).toMatchObject({ fileName: "inner.zip", result: "unreadable_archive" });
    expect(await stored(logged.id)).toHaveLength(0);
  });
});

describe("sending and the applications", () => {
  it("sending does not move the stage, remembers the banker, and raises Confirm login", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);
    const summary = (await api(`/api/work/cases/${caseId}`, { token: session.token })).body;
    expect(summary.stage).toBe("documents_pending");
    expect(summary.applications[0].id).toBe(appId);
    expect(summary.applications[0].bankerName).toBe("RAVI");
    expect(summary.tasks.map((t: any) => t.title)).toContain("Confirm login with HDFC Bank");
    expect(summary.tasks.find((t: any) => t.title.startsWith("Confirm")).dueOn).toBe(today(2));

    const options = (await api(`/api/work/cases/${caseId}/lenders`, { token: session.token })).body;
    const hdfc = options.find((o: any) => o.name === "HDFC Bank");
    expect(hdfc.bankers).toContain("RAVI");
    expect(hdfc.already).toBe(true);
  });

  it("does not make a second application to the same lender", async () => {
    const session = await signInAs("login_executive");
    const { caseId } = await sentCase(session);
    const again = await ok(session, caseId, "send", { lenders: [{ id: await aLender(), banker: "" }] });
    expect(again.applications).toHaveLength(1);
    expect(again.done).toContain("Already with HDFC Bank");
  });

  it("login moves the case to Login Completed, from partial documents too, and needs its fields", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);

    const refused = await act(session, caseId, `applications/${appId}`, { status: "login_completed" });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("Login date");

    const done = await ok(session, caseId, `applications/${appId}`, { status: "login_completed", ...loginFields(session) });
    expect(done.stage).toBe("login_completed");
    expect(done.applications[0].statusLabel).toBe("Login Completed");
    expect(done.tasks).toHaveLength(1);
    expect(done.tasks[0].title).toBe("Collect documents");
  });

  it("a query raises a task for the login employee, due in two days, and closes when answered", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);
    await ok(session, caseId, `applications/${appId}`, { status: "login_completed", ...loginFields(session) });

    const raised = await ok(session, caseId, `applications/${appId}`, { status: "query_raised", query: "Need ITR" });
    expect(raised.stage).toBe("query_raised");
    const task = raised.tasks.find((t: any) => t.title === "Resolve query from HDFC Bank");
    expect(task.dueOn).toBe(today(2));

    const answered = await ok(session, caseId, `applications/${appId}`, { status: "under_process", answer: "Sent" });
    expect(answered.tasks.map((t: any) => t.title)).not.toContain("Resolve query from HDFC Bank");
    expect(answered.stage).toBe("query_raised");
  });

  it("runs the whole path to disbursed, and each stage matches the MIS", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);
    const go = (body: Record<string, unknown>) => ok(session, caseId, `applications/${appId}`, body);

    await go({ status: "login_completed", ...loginFields(session) });
    expect((await go({ status: "eligibility_received", approvedAmount: "20L" })).stage).toBe("approved");

    const noAmount = await act(session, caseId, `applications/${appId}`, { status: "sanctioned", sanctionDate: today() });
    expect(noAmount.status).toBe(400);

    const sanctioned = await go({ status: "sanctioned", sanctionAmount: "18L", sanctionDate: today() });
    expect(sanctioned.stage).toBe("approved");
    expect(sanctioned.applications[0].sanctionAmount).toBe(1800000);
    expect(sanctioned.tasks.map((t: any) => t.title)).toContain("Present the offer from HDFC Bank to the customer");

    const accepted = await go({ status: "sanction_accepted", acceptanceDate: today() });
    expect(accepted.stage).toBe("sanction_accepted");

    const noDate = await act(session, caseId, `applications/${appId}`, { status: "disbursed", disbursementAmount: "18L" });
    expect(noDate.status).toBe(400);

    const disbursed = await go({ status: "disbursed", disbursementAmount: "18L", disbursementDate: today() });
    expect(disbursed.stage).toBe("disbursed");
    expect(disbursed.applications[0].disbursementAmount).toBe(1800000);
    expect(disbursed.applications[0].nextStatuses).toEqual([]);
  });

  it("only moves forward: one lender's query does not pull back another's approval", async () => {
    const session = await signInAs("login_executive");
    const logged = await logCase(session);
    const sent = await ok(session, logged.id, "send", {
      lenders: [{ id: await aLender("HDFC Bank") }, { id: await aLender("ICICI Bank") }],
    });
    const [a, b] = sent.applications;
    await ok(session, logged.id, `applications/${a.id}`, { status: "login_completed", ...loginFields(session) });
    await ok(session, logged.id, `applications/${a.id}`, { status: "eligibility_received" });
    await ok(session, logged.id, `applications/${b.id}`, { status: "login_completed", ...loginFields(session) });
    const queried = await ok(session, logged.id, `applications/${b.id}`, { status: "query_raised", query: "ITR?" });
    expect(queried.stage).toBe("approved");
  });

  it("a pre-check no needs a reason, closes only that application, and is not a login", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);
    const refused = await act(session, caseId, `applications/${appId}`, { status: "not_eligible_precheck" });
    expect(refused.status).toBe(400);

    const declined = await ok(session, caseId, `applications/${appId}`, { status: "not_eligible_precheck", reason: "CIBIL" });
    expect(declined.applications[0].statusLabel).toBe("Not Eligible (Pre-check)");
    expect(declined.stage).toBe("documents_pending");
    expect(declined.tasks.map((t: any) => t.title)).not.toContain("Confirm login with HDFC Bank");
    expect(declined.tasks.map((t: any) => t.title)).toContain("Collect documents");
  });

  it("a rejection closes one application and never the case", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);
    await ok(session, caseId, `applications/${appId}`, { status: "login_completed", ...loginFields(session) });
    const { rows } = await pool.query(`select id from rejection_reason where is_active limit 1`);
    const rejected = await ok(session, caseId, `applications/${appId}`, { status: "rejected", rejectionReasonId: rows[0].id });
    expect(rejected.stage).toBe("login_completed");
    expect(rejected.applications[0].statusLabel).toBe("Rejected");
  });

  it("refuses a skip the MIS does not offer", async () => {
    const session = await signInAs("login_executive");
    const { caseId, appId } = await sentCase(session);
    const skip = await act(session, caseId, `applications/${appId}`, { status: "sanctioned", ...loginFields(session) });
    expect(skip.status).toBe(409);
  });
});

describe("a telecaller sending files to lenders (Tarun, 30 Oct 2026)", () => {
  it("can send their own case, and sees the application it creates", async () => {
    const telecaller = await signInAs("telecaller");
    const logged = await logCase(telecaller);
    const sent = await ok(telecaller, logged.id, "send", { lenders: [{ id: await aLender(), banker: "ravi" }] });

    expect(sent.applications).toHaveLength(1);
    expect(sent.applications[0].statusLabel).toBe("Not Logged In");
    expect(sent.tasks.map((t: any) => t.title)).toContain("Confirm login with HDFC Bank");
  });

  it("cannot send a colleague's case", async () => {
    const owner = await signInAs("telecaller");
    const stranger = await signInAs("telecaller");
    const logged = await logCase(owner);
    const refused = await act(stranger, logged.id, "send", { lenders: [{ id: await aLender(), banker: "" }] });
    expect(refused.status).toBe(404);
  });

  it("still cannot move a lender's status: sending is all this grants", async () => {
    const telecaller = await signInAs("telecaller");
    const logged = await logCase(telecaller);
    const sent = await ok(telecaller, logged.id, "send", { lenders: [{ id: await aLender(), banker: "" }] });
    const refused = await act(telecaller, logged.id, `applications/${sent.applications[0].id}`, {
      status: "login_completed",
      ...loginFields(telecaller),
    });
    expect(refused.status).toBe(403);
  });
});

describe("rescheduling and dropping", () => {
  it("moves the earliest task's date, keeping the task and recording old and new", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const moved = await ok(session, logged.id, "reschedule", { days: 3 });
    expect(moved.tasks).toHaveLength(1);
    expect(moved.tasks[0].dueOn).toBe(today(3));
    const { rows } = await pool.query(
      `select payload_before, payload_after from event where case_id = $1 and event_type = 'case.task_rescheduled'`,
      [logged.id],
    );
    expect(rows[0].payload_before.dueOn).toBe(today(1));
    expect(rows[0].payload_after.dueOn).toBe(today(3));
  });

  it("customer dropped closes the case with a closure reason and clears the queue", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    const refused = await act(session, logged.id, "drop", { reason: "rate_too_high" });
    expect(refused.status).toBe(400);

    const dropped = await ok(session, logged.id, "drop", { reason: "not_interested", note: "bought elsewhere" });
    expect(dropped.stage).toBe("lost");
    expect(dropped.tasks).toEqual([]);
    const queue = await api("/api/work/queue", { token: session.token });
    expect(queue.body.map((t: any) => t.caseId)).not.toContain(logged.id);
  });
});

describe("who sees what", () => {
  it("lists a telecaller's own cases, soonest first; a manager sees everyone's", async () => {
    const one = await signInAs("telecaller");
    const other = await signInAs("telecaller");
    const manager = await signInAs("manager");
    const later = await logCase(one, { pickupDate: today(5) });
    const sooner = await logCase(one, { pickupDate: today(1) });
    const theirs = await logCase(other);

    const mine = (await api("/api/work/cases", { token: one.token })).body.map((c: any) => c.id);
    expect(mine).not.toContain(theirs.id);
    expect(mine.indexOf(sooner.id)).toBeLessThan(mine.indexOf(later.id));

    const all = (await api("/api/work/cases", { token: manager.token })).body.map((c: any) => c.id);
    expect(all).toContain(theirs.id);
  });

  it("finds a case by part of a name, mobile or case number", async () => {
    const session = await signInAs("telecaller");
    const mobile = freshMobile();
    const logged = await logCase(session, { mobile, customerName: "findable person" });
    const ids = async (q: string) =>
      (await api(`/api/work/cases?q=${encodeURIComponent(q)}`, { token: session.token })).body.map((c: any) => c.id);
    expect(await ids("findable")).toContain(logged.id);
    expect(await ids(mobile.slice(-6))).toContain(logged.id);
    expect(await ids(logged.caseNumber)).toContain(logged.id);
  });

  it("hides another telecaller's case, and refuses their writes", async () => {
    const owner = await signInAs("telecaller");
    const stranger = await signInAs("telecaller");
    const logged = await logCase(owner);
    expect((await api(`/api/work/cases/${logged.id}`, { token: stranger.token })).status).toBe(404);
    expect((await act(stranger, logged.id, "documents", { which: "part" })).status).toBe(404);
  });

  it("keeps practice cases out of the work queue", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session, { isPractice: true });
    const queue = await api("/api/work/queue", { token: session.token });
    expect(queue.body.map((t: any) => t.caseId)).not.toContain(logged.id);
  });

  it("lets only a manager correct a stage by hand, with a note", async () => {
    const telecaller = await signInAs("telecaller");
    const manager = await signInAs("manager");
    const logged = await logCase(telecaller);

    const refused = await api(`/api/cases/${logged.id}/stage`, {
      method: "PUT",
      token: telecaller.token,
      body: { stage: "approved", correctionNote: "wrong" },
    });
    expect(refused.status).toBe(403);

    const corrected = await api(`/api/cases/${logged.id}/stage`, {
      method: "PUT",
      token: manager.token,
      body: { stage: "approved", correctionNote: "Entered late" },
    });
    expect(corrected.status).toBe(200);
    expect(corrected.body.stage).toBe("approved");
  });

  it("refuses the retired stages at the database", async () => {
    const session = await signInAs("telecaller");
    const logged = await logCase(session);
    await expect(pool.query(`update loan_case set stage = 'contacted' where id = $1`, [logged.id])).rejects.toThrow(
      /loan_case_stage_not_retired/,
    );
  });
});
