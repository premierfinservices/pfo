/**
 * inbound-mail.ts / POST /api/internal/inbound-email — acceptance tests
 * against real Postgres and a real storage backend, `documents.test.ts`
 * style. Classification itself is mocked (`vi.mock`) rather than calling the
 * real Claude API: what this file proves is PFO's own behaviour once a
 * classification result comes back, not Claude's accuracy.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { hashPassword } from "@domain/auth/password.js";
import type { Role } from "@domain/permissions/index.js";

vi.mock("./inbound-classification-client.js", () => ({
  classifyAttachment: vi.fn(),
}));

import { classifyAttachment } from "./inbound-classification-client.js";
import { createApiServer } from "./api-server.js";
import { pool, withActor } from "./db.js";
import { createBanker } from "./bankers.js";
import type { Actor } from "./authorize.js";

const INTERNAL_TOKEN = "test-internal-token";
process.env.PFO_INTERNAL_TOKEN = INTERNAL_TOKEN;

let baseUrl: string;
let server: ReturnType<typeof createApiServer>;
let storageServer: ChildProcess;
let storageRoot: string;

// Port 4329, matching vitest.integration.config.ts's PFO_STORAGE_SERVER_URL —
// that value is a module-level constant in storage-client.ts, read once at
// import time, so every test file in this suite must spawn its own
// storage-server on the same port (safe: fileParallelism is false, so only
// one file's instance is ever listening at a time) rather than picking its
// own, exactly as documents.test.ts and submissions.test.ts already do.
const STORAGE_PORT = 4329;

async function startStorageServer(): Promise<void> {
  storageRoot = mkdtempSync(path.join(tmpdir(), "pfo-test-storage-inbound-"));
  storageServer = spawn(process.execPath, [path.join(process.cwd(), "Backend", "storage-server.mjs")], {
    env: { ...process.env, PFO_STORAGE_PORT: String(STORAGE_PORT), PFO_STORAGE_ROOT: storageRoot },
    stdio: "pipe",
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${STORAGE_PORT}/health`);
      if (res.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("storage-server did not become healthy in time.");
}

const PASSWORD = "integration-test-password";

interface Session {
  readonly token: string;
  readonly userId: string;
}

async function createEmployee(role: Role): Promise<string> {
  const username = `${role}.${randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(PASSWORD);
  await withActor(null, async (client) => {
    const person = await client.query<{ id: string }>(
      `insert into person (full_name) values ($1) returning id`,
      [`Test ${role}`],
    );
    const user = await client.query<{ id: string }>(
      `insert into app_user (person_id, auth_identity_id, username, password_hash, is_active)
       values ($1, $2, $3, $4, true) returning id`,
      [person.rows[0]!.id, randomUUID(), username, passwordHash],
    );
    await client.query(`insert into user_role (user_id, role, granted_by) values ($1, $2, $1)`, [
      user.rows[0]!.id,
      role,
    ]);
  });
  return username;
}

async function api(
  path_: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path_}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function signInAs(role: Role): Promise<Session> {
  const username = await createEmployee(role);
  const { status, body } = await api("/api/auth/login", { method: "POST", body: { username, password: PASSWORD } });
  expect(status, JSON.stringify(body)).toBe(200);
  return { token: body.token, userId: body.user.id };
}

async function anyLoanProductId(): Promise<string> {
  const { rows } = await pool.query(`select id from loan_product limit 1`);
  return rows[0]!.id;
}

/** A case with real, outstanding (not yet uploaded against) requirements — the
 * state this feature actually attaches into, unlike aReadyCase() elsewhere
 * which verifies everything first. */
async function caseWithOutstandingRequirements(session: Session): Promise<{ id: string; requirementId: string; documentTypeCode: string }> {
  const customer = await api("/api/customers", {
    method: "POST",
    token: session.token,
    body: { fullName: `Applicant ${randomUUID().slice(0, 8)}`, phone: "9843012345", city: "Coimbatore" },
  });
  const created = await api("/api/cases", {
    method: "POST",
    token: session.token,
    body: { applicantId: customer.body.id, loanProductId: await anyLoanProductId() },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const caseId = created.body.id;

  await api(`/api/cases/${caseId}/stage`, { method: "PUT", token: session.token, body: { stage: "contacted" } });
  const advanced = await api(`/api/cases/${caseId}/stage`, {
    method: "PUT",
    token: session.token,
    body: { stage: "documents_pending" },
  });
  expect(advanced.status, JSON.stringify(advanced.body)).toBe(200);

  const listing = await api(`/api/cases/${caseId}/requirements`, { token: session.token });
  const requirement = listing.body.requirements[0];
  expect(requirement).toBeTruthy();

  return { id: caseId, requirementId: requirement.id, documentTypeCode: requirement.documentTypeCode };
}

async function seededBankContactAndThread(
  caseId: string,
  actor: Actor,
): Promise<{ bankContactId: string; gmailThreadId: string }> {
  const { rows: branchRows } = await pool.query<{ id: string }>(
    `select id from organisation where 'branch' = any(roles) and is_active limit 1`,
  );
  const branchOrganisationId = branchRows[0]!.id;

  const banker = await withActor(null, (client) =>
    createBanker(client, actor, {
      branchOrganisationId,
      name: `Test Banker ${randomUUID().slice(0, 6)}`,
      workEmail: `banker.${randomUUID().slice(0, 8)}@hdfcbank.com`,
    }),
  );

  const gmailThreadId = `thread-${randomUUID()}`;

  await withActor(null, async (client) => {
    const submission = await client.query<{ id: string }>(
      `insert into submission (case_id, branch_organisation_id, bank_contact_id, status, submitted_by, submitted_at)
       values ($1, $2, $3, 'submitted', $4, now()) returning id`,
      [caseId, branchOrganisationId, banker.id, actor.userId],
    );
    const pkg = await client.query<{ id: string }>(
      `insert into submission_package
         (submission_id, initiated_by, sender_address, sender_name, provider, status, document_count, email_count, total_bytes)
       values ($1, $2, 'sender@premierfinservices.com', 'Premier Finserv', 'gmail', 'sent', 1, 1, 100)
       returning id`,
      [submission.rows[0]!.id, actor.userId],
    );
    await client.query(
      `insert into submission_package_email
         (submission_package_id, sequence, subject, status, attachment_count, attachment_bytes, sent_at, gmail_message_id, gmail_thread_id)
       values ($1, 1, 'Documents', 'sent', 1, 100, now(), $2, $3)`,
      [pkg.rows[0]!.id, `msg-${randomUUID()}`, gmailThreadId],
    );
  });

  return { bankContactId: banker.id, gmailThreadId };
}

async function seedInboundEmail(input: {
  fromAddress: string;
  gmailThreadId: string;
  storagePath: string;
}): Promise<{ status: number; body: any; gmailMessageId: string }> {
  const gmailMessageId = `msg-${randomUUID()}`;
  const response = await fetch(`${baseUrl}/api/internal/inbound-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pfo-internal-token": INTERNAL_TOKEN },
    body: JSON.stringify({
      gmailMessageId,
      gmailThreadId: input.gmailThreadId,
      fromAddress: input.fromAddress,
      subject: "Re: Documents",
      receivedAt: new Date().toISOString(),
      rawStoragePath: "inbound-email/raw.json",
      attachments: [{ index: 0, storagePath: input.storagePath, contentType: "application/pdf", fileName: "statement.pdf" }],
    }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, gmailMessageId };
}

async function storeAttachment(bytes: string): Promise<string> {
  const objectPath = `test-fixtures/${randomUUID()}.pdf`;
  const res = await fetch(`http://127.0.0.1:${STORAGE_PORT}/objects?path=${encodeURIComponent(objectPath)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: Buffer.from(bytes),
  });
  expect(res.ok).toBe(true);
  return objectPath;
}

beforeAll(async () => {
  await startStorageServer();
  server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.mocked(classifyAttachment).mockReset();
});

afterAll(async () => {
  server.close();
  storageServer.kill();
  rmSync(storageRoot, { recursive: true, force: true });
  await pool.end();
});

describe("POST /api/internal/inbound-email", () => {
  it("refuses without the shared secret", async () => {
    const response = await fetch(`${baseUrl}/api/internal/inbound-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(401);
  });

  it("auto-attaches a high-confidence match to the correct requirement, landing at received", async () => {
    const owner = await signInAs("telecaller");
    const testCase = await caseWithOutstandingRequirements(owner);
    const systemActor: Actor = { userId: owner.userId, authIdentityId: randomUUID(), roles: ["manager"], overrides: [] };
    const { bankContactId, gmailThreadId } = await seededBankContactAndThread(testCase.id, systemActor);
    const storagePath = await storeAttachment("%PDF-fake-bank-statement%");

    vi.mocked(classifyAttachment).mockResolvedValue({
      documentTypeCode: testCase.documentTypeCode,
      confidence: 0.95,
      periodStart: undefined,
      periodEnd: undefined,
      extractedFields: {},
      reasoning: "Matches the requirement.",
      rawModelResponse: { mocked: true },
    });

    const result = await seedInboundEmail({
      fromAddress: "someone.new@hdfcbank.com", // not the banker's own address — proves thread match, not sender match
      gmailThreadId,
      storagePath,
    });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.inserted).toBe(true);

    const requirementAfter = await api(`/api/cases/${testCase.id}/requirements`, { token: owner.token });
    const requirement = requirementAfter.body.requirements.find((r: any) => r.id === testCase.requirementId);
    expect(requirement.status).toBe("received");
    expect(requirement.document).toBeTruthy();

    const audit = await pool.query(
      `select decision, confidence from inbound_classification_audit
        where inbound_email_id = (select id from inbound_email where gmail_message_id = $1)`,
      [result.gmailMessageId],
    );
    expect(audit.rows).toEqual([expect.objectContaining({ decision: "auto_attached" })]);

    void bankContactId;
  });

  it("routes a low-confidence match to the review queue instead of attaching anything", async () => {
    const owner = await signInAs("telecaller");
    const testCase = await caseWithOutstandingRequirements(owner);
    const systemActor: Actor = { userId: owner.userId, authIdentityId: randomUUID(), roles: ["manager"], overrides: [] };
    const { gmailThreadId } = await seededBankContactAndThread(testCase.id, systemActor);
    const storagePath = await storeAttachment("%PDF-unclear-document%");

    vi.mocked(classifyAttachment).mockResolvedValue({
      documentTypeCode: testCase.documentTypeCode,
      confidence: 0.4,
      periodStart: undefined,
      periodEnd: undefined,
      extractedFields: {},
      reasoning: "Not sure what this is.",
      rawModelResponse: { mocked: true },
    });

    const result = await seedInboundEmail({ fromAddress: "someone.new@hdfcbank.com", gmailThreadId, storagePath });
    expect(result.status, JSON.stringify(result.body)).toBe(200);

    const requirementAfter = await api(`/api/cases/${testCase.id}/requirements`, { token: owner.token });
    const requirement = requirementAfter.body.requirements.find((r: any) => r.id === testCase.requirementId);
    expect(requirement.document).toBeFalsy();

    const queue = await pool.query(
      `select reason, status from inbound_email_review_queue
        where inbound_email_id = (select id from inbound_email where gmail_message_id = $1)`,
      [result.gmailMessageId],
    );
    expect(queue.rows).toEqual([expect.objectContaining({ reason: "low_confidence", status: "pending_review" })]);
  });

  it("is idempotent: re-processing the same Gmail message id is a no-op", async () => {
    const owner = await signInAs("telecaller");
    const testCase = await caseWithOutstandingRequirements(owner);
    const systemActor: Actor = { userId: owner.userId, authIdentityId: randomUUID(), roles: ["manager"], overrides: [] };
    const { gmailThreadId } = await seededBankContactAndThread(testCase.id, systemActor);
    const storagePath = await storeAttachment("%PDF-repeat%");

    vi.mocked(classifyAttachment).mockResolvedValue({
      documentTypeCode: testCase.documentTypeCode,
      confidence: 0.95,
      periodStart: undefined,
      periodEnd: undefined,
      extractedFields: {},
      reasoning: "x",
      rawModelResponse: {},
    });

    const gmailMessageId = `msg-${randomUUID()}`;
    const body = {
      gmailMessageId,
      gmailThreadId,
      fromAddress: "someone.new@hdfcbank.com",
      subject: "Re: Documents",
      receivedAt: new Date().toISOString(),
      rawStoragePath: "inbound-email/raw.json",
      attachments: [{ index: 0, storagePath, contentType: "application/pdf", fileName: "statement.pdf" }],
    };

    const first = (await fetch(`${baseUrl}/api/internal/inbound-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pfo-internal-token": INTERNAL_TOKEN },
      body: JSON.stringify(body),
    }).then((r) => r.json())) as { inserted: boolean };
    const second = (await fetch(`${baseUrl}/api/internal/inbound-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pfo-internal-token": INTERNAL_TOKEN },
      body: JSON.stringify(body),
    }).then((r) => r.json())) as { inserted: boolean };

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);

    const rows = await pool.query(`select count(*)::int as count from inbound_email where gmail_message_id = $1`, [
      gmailMessageId,
    ]);
    expect(rows.rows[0].count).toBe(1);
  });
});
