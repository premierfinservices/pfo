/**
 * "Forgot password" (ADR-052).
 *
 * Two steps, both reachable without signing in:
 *
 *   1. `requestPasswordReset` — an employee types their username on the login
 *      screen. A one-time link is mailed to the OFFICE mailbox, not to the
 *      employee: PFO stores no email address per employee. Whoever reads that
 *      mailbox forwards the link to the right person.
 *   2. `completePasswordReset` — the link opens a screen where the employee
 *      chooses a new password.
 *
 * The answer to step 1 is the same whether or not the username exists, so the
 * form is not a way to find out who works here. Only the SHA-256 of the token is
 * stored. A link works once and for 30 minutes; asking again retires the older
 * link. A completed reset ends every session the account has, as an
 * administrator's reset does (`resetUserPassword`).
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { hashPassword } from "@domain/auth/password.js";

import type { Queryable } from "./db.js";
import { recordUserEvent } from "./events.js";
import { ApiError } from "./http.js";
import { createHttpEmailProvider } from "./mail-client.js";
import { MIN_PASSWORD_LENGTH } from "./users.js";

const LINK_LIFETIME_MINUTES = 30;

/** Asking twice inside this window for one account sends one email, so the
 * office mailbox cannot be flooded by pressing the button. */
const COOLDOWN_SECONDS = 60;

/** Per PC: five requests in ten minutes. In memory, like the sign-in throttle. */
const MAX_REQUESTS_PER_ADDRESS = 5;
const REQUEST_WINDOW_MS = 10 * 60 * 1000;
const requestsByAddress = new Map<string, { start: number; count: number }>();

export function assertResetRequestAllowed(address: string): void {
  const now = Date.now();
  const entry = requestsByAddress.get(address);
  if (!entry || now - entry.start > REQUEST_WINDOW_MS) {
    requestsByAddress.set(address, { start: now, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_REQUESTS_PER_ADDRESS) {
    throw new ApiError(429, "Too many reset requests from this PC. Try again in a few minutes, or ask a manager.");
  }
}

/** Test seam, as `resetLoginThrottle` is for the sign-in throttle. */
export function resetPasswordResetThrottle(): void {
  requestsByAddress.clear();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Where the link goes and what it points at. All three come from `.env`; none
 * has a default, so nothing about the office is written into this public code,
 * and a link is never built from a header the browser sent. */
function mailSettings(): { to: string; from: string; publicUrl: string } | null {
  const to = process.env.PFO_PASSWORD_RESET_TO?.trim();
  const from = process.env.PFO_MAIL_SENDER_ADDRESS?.trim();
  const publicUrl = process.env.PFO_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return to && from && publicUrl ? { to, from, publicUrl } : null;
}

const SAME_ANSWER = {
  ok: true,
  message:
    "If that account exists, a reset link has been sent to the office mailbox. " +
    "Ask a manager to forward it to you. It works once, for 30 minutes.",
} as const;

export async function requestPasswordReset(client: Queryable, body: Record<string, unknown>) {
  const username = typeof body.username === "string" ? body.username.trim() : "";

  const settings = mailSettings();
  if (!settings) {
    // True whoever asks, so it reveals nothing about any account.
    console.error("[password-reset] PFO_PASSWORD_RESET_TO, PFO_PUBLIC_URL or PFO_MAIL_SENDER_ADDRESS is not set; nothing sent.");
    throw new ApiError(503, "Password reset is not set up on this server. Ask a manager to reset your password.");
  }
  if (!username) return SAME_ANSWER;

  const { rows } = await client.query<{ id: string; username: string }>(
    `select id, username from app_user where lower(username) = lower($1) and is_active`,
    [username],
  );
  const user = rows[0];
  if (!user) return SAME_ANSWER;

  const recent = await client.query(
    `select 1 from password_reset_token
      where user_id = $1 and created_at > now() - make_interval(secs => $2)`,
    [user.id, COOLDOWN_SECONDS],
  );
  if (recent.rowCount) return SAME_ANSWER;

  // Retire any earlier link for this account: only the newest one works.
  await client.query(
    `update password_reset_token set used_at = now() where user_id = $1 and used_at is null`,
    [user.id],
  );
  const token = randomBytes(32).toString("base64url");
  await client.query(
    `insert into password_reset_token (user_id, token_hash, expires_at)
     values ($1, $2, now() + make_interval(mins => $3))`,
    [user.id, sha256(token), LINK_LIFETIME_MINUTES],
  );

  const result = await createHttpEmailProvider().send({
    submissionPackageEmailId: randomUUID(),
    from: { email: settings.from },
    to: [{ email: settings.to }],
    subject: "PFO password reset request",
    body:
      `A password reset was requested for the PFO account "${user.username}".\n\n` +
      `To choose a new password, open this link within ${LINK_LIFETIME_MINUTES} minutes. It works once:\n` +
      `${settings.publicUrl}/#/reset-password?token=${token}\n\n` +
      `Forward it only to the person who owns that account. If nobody asked for this, ignore it: ` +
      `nothing changes unless the link is used.\n`,
    attachments: [],
  });
  if (!result.ok) {
    // The kind only. Never the link, and never the message, which may quote it.
    console.error(`[password-reset] mail failed (${result.failure.kind}); the link was not delivered.`);
  }
  return SAME_ANSWER;
}

export async function completePasswordReset(client: Queryable, body: Record<string, unknown>) {
  const token = typeof body.token === "string" ? body.token : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ApiError(400, `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const invalid = new ApiError(400, "This reset link is not valid or has expired. Ask for a new one.");
  if (!token) throw invalid;

  // Locked, so two clicks of the same link cannot both pass.
  const { rows } = await client.query<{ id: string; user_id: string; auth_identity_id: string }>(
    `select t.id, t.user_id, u.auth_identity_id
       from password_reset_token t
       join app_user u on u.id = t.user_id
      where t.token_hash = $1 and t.used_at is null and t.expires_at > now() and u.is_active
        for update of t`,
    [sha256(token)],
  );
  const link = rows[0];
  if (!link) throw invalid;

  await client.query(`update password_reset_token set used_at = now() where id = $1`, [link.id]);
  await client.query(`update app_user set password_hash = $1 where id = $2`, [
    await hashPassword(password),
    link.user_id,
  ]);
  await client.query(
    `update api_session set revoked_at = now() where user_id = $1 and revoked_at is null`,
    [link.user_id],
  );

  // The audit log refuses a transaction with no identity. The link has just
  // proved this one, so the event is recorded as the account owner's own.
  await client.query("select set_config('app.auth_identity_id', $1, true)", [link.auth_identity_id]);
  await recordUserEvent(client, {
    actorUserId: link.user_id,
    subjectUserId: link.user_id,
    eventType: "user.password_reset_by_link",
  });

  return { ok: true };
}
