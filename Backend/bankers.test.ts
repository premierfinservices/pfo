/**
 * Bankers ("bank_contact") — acceptance tests for the write path added
 * alongside the standalone Bankers screen, against real Postgres and real
 * HTTP, mirroring `Backend/master-data.test.ts`'s shape.
 *
 * WHAT THIS PROVES: a banker created here is reusable master data — it shows
 * up in `GET /api/lenders`' branch contacts and can be selected by
 * `bankContactId` on a case's submission, without ever being retyped, and the
 * write path is gated on `organisation.update` (not `master_data.manage`,
 * which is a narrower group that deliberately does not include the roles
 * that actually deal with banks day to day).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { hashPassword } from "@domain/auth/password.js";
import type { Role } from "@domain/permissions/index.js";

import { createApiServer } from "./api-server.js";
import { pool, withActor } from "./db.js";

let baseUrl: string;
let server: ReturnType<typeof createApiServer>;

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

async function login(username: string): Promise<Session> {
  const { status, body } = await api("/api/auth/login", {
    method: "POST",
    body: { username, password: PASSWORD },
  });
  expect(status, JSON.stringify(body)).toBe(200);
  return { token: body.token, userId: body.user.id };
}

async function signInAs(role: Role): Promise<Session> {
  return await login(await createEmployee(role));
}

/** A real seeded branch (0025) to attach test bankers to. */
async function anyBranchId(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `select id from organisation where 'branch' = any(roles) and is_active limit 1`,
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await pool.end();
});

describe("reading bankers", () => {
  it("every role can list bankers", async () => {
    const finance = await signInAs("finance");
    const result = await api("/api/bankers", { token: finance.token });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(Array.isArray(result.body)).toBe(true);
  });

  it("refuses an unauthenticated caller", async () => {
    const result = await api("/api/bankers");
    expect(result.status).toBe(401);
  });
});

describe("creating a banker requires organisation.update — finance is refused, login desk is not", () => {
  it("403 for finance, 200 for login_executive", async () => {
    const finance = await signInAs("finance");
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const refused = await api("/api/bankers", {
      method: "POST",
      token: finance.token,
      body: { branchOrganisationId: branchId, name: "Refused Banker" },
    });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toContain("organisation.update");

    const created = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: {
        branchOrganisationId: branchId,
        name: "Suresh Kumar",
        designation: "Branch Manager",
        workEmail: "suresh.kumar@example-bank.test",
        workMobile: "9876543210",
      },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.name).toBe("Suresh Kumar");
    expect(created.body.designation).toBe("Branch Manager");
    expect(created.body.branchOrganisationId).toBe(branchId);
    expect(created.body.isActive).toBe(true);
    expect(created.body.isPrimary).toBe(false);
  });

  it("admin — system administration, not business data — is also refused", async () => {
    const admin = await signInAs("admin");
    const branchId = await anyBranchId();
    const result = await api("/api/bankers", {
      method: "POST",
      token: admin.token,
      body: { branchOrganisationId: branchId, name: "Should not save" },
    });
    expect(result.status).toBe(403);
  });
});

describe("a banker is reusable master data, not typed in per case", () => {
  it("appears in /api/lenders' branch contacts immediately after creation", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const created = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: `Reusable Banker ${randomUUID().slice(0, 6)}` },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);

    const lenders = await api("/api/lenders", { token: loginDesk.token });
    expect(lenders.status).toBe(200);
    const branch = lenders.body
      .flatMap((lender: any) => lender.branches)
      .find((b: any) => b.id === branchId);
    expect(branch).toBeDefined();
    expect(branch.contacts.some((c: any) => c.id === created.body.id)).toBe(true);
  });

  it("a name-only banker (no email) and an email-only banker (a shared mailbox) both save", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const named = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "Name Only Banker" },
    });
    expect(named.status, JSON.stringify(named.body)).toBe(200);

    const desk = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, workEmail: "homeloans.branch@example-bank.test" },
    });
    expect(desk.status, JSON.stringify(desk.body)).toBe(200);
    expect(desk.body.name).toBeNull();
  });

  it("refuses a banker with neither a name nor an email", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const result = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId },
    });
    expect(result.status).toBe(400);
  });

  it("refuses a malformed email and an unknown branch", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const badEmail = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "Bad Email", workEmail: "not-an-email" },
    });
    expect(badEmail.status).toBe(400);

    const badBranch = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: randomUUID(), name: "No Such Branch" },
    });
    expect(badBranch.status).toBe(400);
  });
});

describe("editing and deactivating a banker", () => {
  it("PATCH updates fields the request names and leaves the rest alone", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const created = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "Edit Me", designation: "RM", workMobile: "9000000000" },
    });

    const updated = await api(`/api/bankers/${created.body.id}`, {
      method: "PATCH",
      token: loginDesk.token,
      body: { designation: "Senior RM" },
    });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.designation).toBe("Senior RM");
    expect(updated.body.name).toBe("Edit Me");
    expect(updated.body.workMobile).toBe("9000000000");
  });

  it("PATCH is also refused for a role without organisation.update", async () => {
    const loginDesk = await signInAs("login_executive");
    const finance = await signInAs("finance");
    const branchId = await anyBranchId();

    const created = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "Protected" },
    });

    const result = await api(`/api/bankers/${created.body.id}`, {
      method: "PATCH",
      token: finance.token,
      body: { designation: "Should not apply" },
    });
    expect(result.status).toBe(403);
  });

  it("deactivating and reactivating toggles isActive and is still listed", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const created = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "Moved On" },
    });

    const deactivated = await api(`/api/bankers/${created.body.id}/active`, {
      method: "PUT",
      token: loginDesk.token,
      body: { isActive: false },
    });
    expect(deactivated.status, JSON.stringify(deactivated.body)).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    const listing = await api("/api/bankers", { token: loginDesk.token });
    expect(listing.body.some((b: any) => b.id === created.body.id && b.isActive === false)).toBe(true);

    const reactivated = await api(`/api/bankers/${created.body.id}/active`, {
      method: "PUT",
      token: loginDesk.token,
      body: { isActive: true },
    });
    expect(reactivated.body.isActive).toBe(true);
  });

  it("a deactivated banker no longer appears among a branch's active contacts on /api/lenders", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const created = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: `Hide Me ${randomUUID().slice(0, 6)}` },
    });
    await api(`/api/bankers/${created.body.id}/active`, {
      method: "PUT",
      token: loginDesk.token,
      body: { isActive: false },
    });

    const lenders = await api("/api/lenders", { token: loginDesk.token });
    const branch = lenders.body
      .flatMap((lender: any) => lender.branches)
      .find((b: any) => b.id === branchId);
    expect(branch.contacts.some((c: any) => c.id === created.body.id)).toBe(false);
  });
});

describe("at most one primary banker per branch", () => {
  it("marking a second banker primary un-primaries the first", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const first = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "First Primary", isPrimary: true },
    });
    expect(first.body.isPrimary).toBe(true);

    const second = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: { branchOrganisationId: branchId, name: "Second Primary", isPrimary: true },
    });
    expect(second.body.isPrimary).toBe(true);

    const listing = await api("/api/bankers", { token: loginDesk.token });
    const refreshedFirst = listing.body.find((b: any) => b.id === first.body.id);
    expect(refreshedFirst.isPrimary).toBe(false);
  });
});

describe("a case can select a catalogued banker as a recipient, and reuse it on another case", () => {
  async function aCase(session: Session): Promise<{ id: string }> {
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Applicant ${randomUUID().slice(0, 8)}`, phone: "9843012345", city: "Coimbatore" },
    });
    const { rows } = await pool.query<{ id: string }>(`select id from loan_product limit 1`);
    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: { applicantId: customer.body.id, loanProductId: rows[0]!.id },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    return created.body;
  }

  it("createSubmission accepts bankContactId, and the same banker works on a second case", async () => {
    const loginDesk = await signInAs("login_executive");
    const branchId = await anyBranchId();

    const banker = await api("/api/bankers", {
      method: "POST",
      token: loginDesk.token,
      body: {
        branchOrganisationId: branchId,
        name: "Reused Across Cases",
        workEmail: `reused.${randomUUID().slice(0, 6)}@example-bank.test`,
      },
    });
    expect(banker.status, JSON.stringify(banker.body)).toBe(200);

    for (let i = 0; i < 2; i++) {
      const loanCase = await aCase(loginDesk);
      const submission = await api(`/api/cases/${loanCase.id}/submissions`, {
        method: "POST",
        token: loginDesk.token,
        body: {
          branchOrganisationId: branchId,
          recipients: [{ email: banker.body.workEmail, bankContactId: banker.body.id, kind: "to", isPrimary: true }],
        },
      });
      expect(submission.status, JSON.stringify(submission.body)).toBe(200);
      expect(submission.body.recipients[0].email).toBe(banker.body.workEmail);
    }
  });
});
