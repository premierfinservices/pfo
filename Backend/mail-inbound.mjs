/**
 * Polls the same Gmail inbox mail-server.mjs sends from, for bank replies.
 *
 * Lives alongside mail-server.mjs (same "mail" process, same port, no new
 * process or port) but in its own file — mail-server.mjs is deliberately
 * "the one place in PFO that knows what Gmail is" for SENDING, and this adds
 * READING, which is different enough (a new OAuth scope, a genuinely new
 * risk) to keep visibly separate rather than folded in.
 *
 * THREE PROVIDERS, same shape as mail-server.mjs's send providers:
 *
 *   unconfigured  The default. Polling does nothing.
 *   gmail         Real polling, via the shared token in gmail-auth.mjs.
 *   fixture       FOR TESTS ONLY. Reads canned Gmail API message JSON from a
 *                 directory instead of calling Google, enabled only by
 *                 PFO_MAIL_INBOUND_PROVIDER=fixture.
 *
 * WHAT THIS FILE DOES NOT DO. It does not decide which case an email belongs
 * to (src/domain/communications/inbound-matching.ts), does not classify
 * attachments (Backend/inbound-classification-client.ts), and does not touch
 * Postgres — exactly like mail-server.mjs has never touched Postgres. Every
 * fetched message is POSTed, raw, to the api process's internal endpoint,
 * which is the only process in PFO allowed to write case-derived data (RLS's
 * tier-B policies require an authenticated app.current_user_id(), which this
 * loopback poller does not have and should not be given).
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { gmailAccessToken, gmailMisconfiguration } from "./gmail-auth.mjs";

// Read fresh on every call rather than captured once at import time: ESM
// caches a module by URL, so a test importing this file twice under two
// different env configurations must still see the second one.
function currentProvider() {
  return (process.env.PFO_MAIL_INBOUND_PROVIDER ?? "unconfigured").trim().toLowerCase();
}
function pollIntervalMs() {
  return Number(process.env.PFO_MAIL_INBOUND_POLL_MS ?? 60_000);
}
function fixtureDir() {
  return process.env.PFO_MAIL_INBOUND_FIXTURE_DIR ?? "";
}
function storageUrl() {
  return (process.env.PFO_STORAGE_SERVER_URL ?? "http://127.0.0.1:4319").replace(/\/$/, "");
}
function internalApiUrl() {
  return (process.env.PFO_API_INTERNAL_URL ?? "http://127.0.0.1:4321").replace(/\/$/, "");
}
function internalToken() {
  return process.env.PFO_INTERNAL_TOKEN ?? "";
}

// ---------------------------------------------------------------------------
// Gmail API — listing, fetching, and marking messages read.
// ---------------------------------------------------------------------------

async function gmailFetchJson(url) {
  const token = await gmailAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    throw new Error(`Gmail returned HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function gmailListUnread() {
  const query = encodeURIComponent("is:unread -in:sent -in:drafts");
  const payload = await gmailFetchJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=25`,
  );
  return payload.messages ?? [];
}

async function gmailGetMessage(id) {
  return gmailFetchJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
}

async function gmailGetAttachment(messageId, attachmentId) {
  return gmailFetchJson(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
}

async function gmailMarkRead(id) {
  const token = await gmailAccessToken();
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/modify`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

// ---------------------------------------------------------------------------
// Fixture provider — for tests. A directory of full `messages.get` JSON
// bodies, one file per message, attachment bytes inlined as base64url in
// each part's body.data (small test attachments; no separate attachment
// fetch is simulated).
// ---------------------------------------------------------------------------

async function fixtureListAndGetAll() {
  const dir = fixtureDir();
  if (!dir) return [];
  const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json"));
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"))));
}

// ---------------------------------------------------------------------------
// MIME payload walking — headers and attachment parts.
// ---------------------------------------------------------------------------

function headerValue(headers, name) {
  const found = (headers ?? []).find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return found?.value ?? null;
}

function decodeBase64Url(data) {
  return Buffer.from(String(data ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Every leaf part with a filename (an attachment) — text/plain and
 * text/html body parts are skipped, they are never what a bank is sending. */
function collectAttachmentParts(payload, collected = []) {
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) collectAttachmentParts(part, collected);
  } else if (payload.filename) {
    collected.push(payload);
  }
  return collected;
}

async function attachmentBytes(messageId, part) {
  if (part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.body?.attachmentId) {
    const fetched = await gmailGetAttachment(messageId, part.body.attachmentId);
    return decodeBase64Url(fetched.data);
  }
  return Buffer.alloc(0);
}

// ---------------------------------------------------------------------------
// Storage — the same HTTP object store documents.ts writes to, via a plain
// fetch rather than importing storage-client.ts: that file is TypeScript and
// resolves `@domain` through vite, which this plain .mjs process has no
// access to, exactly as mail-server.mjs has never imported it either.
// ---------------------------------------------------------------------------

async function putObject(objectPath, bytes, contentType) {
  const response = await fetch(`${storageUrl()}/objects?path=${encodeURIComponent(objectPath)}`, {
    method: "PUT",
    headers: contentType ? { "Content-Type": contentType } : {},
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`Could not store "${objectPath}" (HTTP ${response.status})`);
  }
  return response.json();
}

// ---------------------------------------------------------------------------
// One message: store raw + attachments, then hand off to the api process.
// ---------------------------------------------------------------------------

async function processMessage(message, log) {
  const headers = message.payload?.headers ?? [];
  const gmailMessageId = message.id;
  const gmailThreadId = message.threadId;
  const fromAddress = (headerValue(headers, "From") ?? "").trim();
  const subject = headerValue(headers, "Subject");
  const receivedAt = message.internalDate
    ? new Date(Number(message.internalDate)).toISOString()
    : new Date().toISOString();

  const rawStored = await putObject(
    `inbound-email/${gmailMessageId}/raw.json`,
    Buffer.from(JSON.stringify(message)),
    "application/json",
  );

  const attachmentParts = collectAttachmentParts(message.payload ?? {});
  const attachments = [];
  for (let index = 0; index < attachmentParts.length; index += 1) {
    const part = attachmentParts[index];
    const bytes = await attachmentBytes(gmailMessageId, part);
    const stored = await putObject(
      `inbound-email/${gmailMessageId}/attachment-${index}-${part.filename}`,
      bytes,
      part.mimeType,
    );
    attachments.push({
      index,
      storagePath: stored.path,
      contentType: part.mimeType,
      fileName: part.filename,
    });
  }

  const response = await fetch(`${internalApiUrl()}/api/internal/inbound-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-pfo-internal-token": internalToken() },
    body: JSON.stringify({
      gmailMessageId,
      gmailThreadId,
      fromAddress,
      subject,
      receivedAt,
      rawStoragePath: rawStored.path,
      attachments,
    }),
  });

  if (!response.ok) {
    log(`could not hand off ${gmailMessageId} to the API (HTTP ${response.status})`);
    return;
  }

  // Belt-and-suspenders, not the primary dedupe mechanism — see
  // Database/migrations/0039_inbound_email.sql. The API's own unique
  // constraint on gmail_message_id is what actually prevents double
  // processing if this step is skipped or fails.
  if (currentProvider() === "gmail") {
    await gmailMarkRead(gmailMessageId).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// The poll loop.
// ---------------------------------------------------------------------------

let pollTimer = null;

async function pollOnce(log) {
  const provider = currentProvider();
  if (provider === "unconfigured") return;

  if (provider === "gmail") {
    const missing = gmailMisconfiguration();
    if (missing.length > 0) return;
    const summaries = await gmailListUnread().catch((error) => {
      log(`could not list inbox: ${error.message}`);
      return [];
    });
    for (const summary of summaries) {
      const message = await gmailGetMessage(summary.id).catch((error) => {
        log(`could not fetch ${summary.id}: ${error.message}`);
        return null;
      });
      if (message) await processMessage(message, log).catch((error) => log(`failed on ${summary.id}: ${error.message}`));
    }
    return;
  }

  if (provider === "fixture") {
    const messages = await fixtureListAndGetAll();
    for (const message of messages) {
      await processMessage(message, log).catch((error) => log(`failed on ${message.id}: ${error.message}`));
    }
  }
}

export function startInboundPolling(log = () => {}) {
  const provider = currentProvider();
  if (provider === "unconfigured") {
    log("inbound polling not configured (PFO_MAIL_INBOUND_PROVIDER unset)");
    return;
  }
  const intervalMs = pollIntervalMs();
  log(`inbound polling started, provider=${provider}, every ${intervalMs}ms`);
  pollOnce(log).catch((error) => log(`poll failed: ${error.message}`));
  pollTimer = setInterval(() => {
    pollOnce(log).catch((error) => log(`poll failed: ${error.message}`));
  }, intervalMs);
}

export function stopInboundPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function inboundStatus() {
  const provider = currentProvider();
  return { inboundConfigured: provider !== "unconfigured", inboundProvider: provider };
}

// Exported for tests — runs one poll cycle synchronously rather than waiting
// for the interval.
export { pollOnce as runOnePollCycleForTests };
