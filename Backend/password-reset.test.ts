/**
 * "Forgot password" (ADR-052): real PostgreSQL, real HTTP, a stub mail backend.
 *
 * The stub listens where the suite's PFO_MAIL_SERVER_URL points and records what
 * the API asked it to send, so these read the actual email the office mailbox
 * would receive and use the link in it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

import { hashPassword } from "@domain/auth/password.js";

import { createApiServer, resetLoginThrottle } from "./api-server.js";
import { pool, withActor } from "./db.js";

const OLD_PASSWORD = "the-old-password";
const NEW_PASSWORD = "a-brand-new-password";
const OFFICE_MAILBOX = "office-mailbox@example.test";

interface SentMail {
  readonly to: string[];
  readonly subject: string;
  readonly body: string;
}

let baseUrl: string;
let server: ReturnType<typeof createApiServer>;
let mailBackend: Server;
let sent: SentMail[] = [];
let mailShouldFail = false;

async function createEmployee(isActive = true): Promise<{ username: string; userId: string }> {
  const username = `reset.${randomUUID().slice(0, 8)}`;
  const passwordHash = await hashPassword(OLD_PASSWORD);
  return await withActor(null, async (client) => {
    const person = await client.query<{ id: string }>(
      `insert into person (full_name) values ('Reset Test') returning id`,
    );
    const user = await client.query<{ id: string }>(
      `insert into app_user (person_id, auth_identity_id, username, password_hash, is_active)
       values ($1, $2, $3, $4, $5) returning id`,
      [person.rows[0]!.id, randomUUID(), username, passwordHash, isActive],
    );
    await client.query(`insert into user_role (user_id, role, granted_by) values ($1, 'telecaller', $1)`, [
      user.rows[0]!.id,
    ]);
    return { username, userId: user.rows[0]!.id };
  });
}

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

const forgot = (username: string) => post("/api/auth/forgot-password", { username });
const reset = (token: string, password = NEW_PASSWORD) => post("/api/auth/reset-password", { token, password });
const signIn = (username: string, password: string) => post("/api/auth/login", { username, password });

/** The token inside the link in the most recent email. */
function lastToken(): string {
  const body = sent.at(-1)?.body ?? "";
  const match = /#\/reset-password\?token=([A-Za-z0-9_-]+)/.exec(body);
  expect(match, `no reset link in: ${body}`).not.toBeNull();
  return match![1]!;
}

beforeAll(async () => {
  mailBackend = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const message = JSON.parse(raw);
      res.setHeader("Content-Type", "application/json");
      if (mailShouldFail) {
        res.end(JSON.stringify({ ok: false, submissionPackageEmailId: message.submissionPackageEmailId, failure: { kind: "network", message: "down" } }));
        return;
      }
      sent.push({ to: message.to.map((a: { email: string }) => a.email), subject: message.subject, body: message.body });
      res.end(JSON.stringify({ ok: true, submissionPackageEmailId: message.submissionPackageEmailId }));
    });
  });
  await new Promise<void>((resolve) => mailBackend.listen(4330, "127.0.0.1", resolve));

  server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => mailBackend.close(() => resolve()));
  await pool.end();
});

beforeEach(() => {
  sent = [];
  mailShouldFail = false;
  process.env.PFO_PASSWORD_RESET_TO = OFFICE_MAILBOX;
  process.env.PFO_PUBLIC_URL = "https://pfo.example.test:4300/";
  process.env.PFO_MAIL_SENDER_ADDRESS = "sender@example.test";
  resetLoginThrottle();
});

describe("asking for a reset", () => {
  it("mails a link to the office mailbox, naming the account, and stores only a hash", async () => {
    const { username } = await createEmployee();
    const { status, body } = await forgot(username);

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual([OFFICE_MAILBOX]);
    expect(sent[0]!.body).toContain(`"${username}"`);
    expect(sent[0]!.body).toContain("https://pfo.example.test:4300/#/reset-password?token=");

    const { rows } = await pool.query(`select token_hash from password_reset_token`);
    expect(rows.some((r: { token_hash: string }) => r.token_hash === lastToken())).toBe(false);
  });

  it("answers identically for an unknown or deactivated account, and sends nothing", async () => {
    const real = await createEmployee();
    const sentForReal = await forgot(real.username);
    sent = [];
    resetLoginThrottle();

    const unknown = await forgot(`nobody.${randomUUID().slice(0, 8)}`);
    const inactive = await createEmployee(false);
    const deactivated = await forgot(inactive.username);

    expect(unknown).toEqual({ status: 200, body: sentForReal.body });
    expect(deactivated).toEqual({ status: 200, body: sentForReal.body });
    expect(sent).toHaveLength(0);
  });

  it("sends one email for two requests in quick succession", async () => {
    const { username } = await createEmployee();
    await forgot(username);
    await forgot(username);
    expect(sent).toHaveLength(1);
  });

  it("limits one PC to five requests in ten minutes", async () => {
    const { username } = await createEmployee();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await forgot(username)).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it("is refused with 503 when the mailbox or public address is not configured", async () => {
    const { username } = await createEmployee();
    delete process.env.PFO_PASSWORD_RESET_TO;
    const { status } = await forgot(username);
    expect(status).toBe(503);
    expect(sent).toHaveLength(0);
  });

  it("still answers normally when the mail backend cannot deliver", async () => {
    const { username } = await createEmployee();
    mailShouldFail = true;
    const { status } = await forgot(username);
    expect(status).toBe(200);
  });
});

describe("using the link", () => {
  it("sets the new password, ends existing sessions, and records who did it", async () => {
    const { username, userId } = await createEmployee();
    const before = await signIn(username, OLD_PASSWORD);
    expect(before.status).toBe(200);

    await forgot(username);
    const { status } = await reset(lastToken());
    expect(status).toBe(200);

    expect((await signIn(username, OLD_PASSWORD)).status).toBe(401);
    expect((await signIn(username, NEW_PASSWORD)).status).toBe(200);

    const stale = await fetch(`${baseUrl}/api/auth/me`, { headers: { Authorization: `Bearer ${before.body.token}` } });
    expect(stale.status).toBe(401);

    const { rows } = await pool.query(
      `select actor_user_id from event where entity_id = $1 and event_type = 'user.password_reset_by_link'`,
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(userId);
  });

  it("works once", async () => {
    const { username } = await createEmployee();
    await forgot(username);
    const token = lastToken();
    expect((await reset(token)).status).toBe(200);
    expect((await reset(token, "yet-another-password")).status).toBe(400);
    expect((await signIn(username, NEW_PASSWORD)).status).toBe(200);
  });

  it("is refused after 30 minutes", async () => {
    const { username, userId } = await createEmployee();
    await forgot(username);
    await pool.query(
      `update password_reset_token set expires_at = now() - interval '1 second' where user_id = $1`,
      [userId],
    );
    expect((await reset(lastToken())).status).toBe(400);
    expect((await signIn(username, OLD_PASSWORD)).status).toBe(200);
  });

  it("is retired by a newer request for the same account", async () => {
    const { username, userId } = await createEmployee();
    await forgot(username);
    const first = lastToken();
    await pool.query(`update password_reset_token set created_at = now() - interval '5 minutes' where user_id = $1`, [userId]);
    await forgot(username);
    const second = lastToken();

    expect(first).not.toBe(second);
    expect((await reset(first)).status).toBe(400);
    expect((await reset(second)).status).toBe(200);
  });

  it("is refused for an account deactivated after the link was sent", async () => {
    const { username, userId } = await createEmployee();
    await forgot(username);
    await pool.query(`update app_user set is_active = false where id = $1`, [userId]);
    expect((await reset(lastToken())).status).toBe(400);
  });

  it("refuses a short password without using up the link", async () => {
    const { username } = await createEmployee();
    await forgot(username);
    const token = lastToken();
    expect((await reset(token, "short")).status).toBe(400);
    expect((await reset(token)).status).toBe(200);
  });

  it("refuses a made-up token", async () => {
    expect((await reset("not-a-real-token")).status).toBe(400);
    expect((await reset("")).status).toBe(400);
  });
});
