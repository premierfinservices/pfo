/**
 * mail-inbound.mjs's fixture path, proven against lightweight fake storage
 * and internal-API servers rather than real Gmail — the same reasoning
 * mail-server.mjs's `capture` provider exists for on the send side.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

describe("mail-inbound.mjs fixture provider", () => {
  let fixtureDir: string;
  let storageServer: Server;
  let apiServer: Server;
  const storedObjects: { path: string; contentType: string | null; bytes: Buffer }[] = [];
  const internalRequests: any[] = [];

  beforeEach(async () => {
    fixtureDir = mkdtempSync(path.join(tmpdir(), "pfo-inbound-fixture-"));
    storedObjects.length = 0;
    internalRequests.length = 0;

    storageServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const objectPath = url.searchParams.get("path") ?? "";
        const bytes = Buffer.concat(chunks);
        storedObjects.push({ path: objectPath, contentType: req.headers["content-type"] ?? null, bytes });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ path: objectPath, sizeBytes: bytes.byteLength }));
      });
    });
    const storagePort = await listen(storageServer);

    apiServer = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        internalRequests.push({
          token: req.headers["x-pfo-internal-token"],
          body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const apiPort = await listen(apiServer);

    process.env.PFO_MAIL_INBOUND_PROVIDER = "fixture";
    process.env.PFO_MAIL_INBOUND_FIXTURE_DIR = fixtureDir;
    process.env.PFO_STORAGE_SERVER_URL = `http://127.0.0.1:${storagePort}`;
    process.env.PFO_API_INTERNAL_URL = `http://127.0.0.1:${apiPort}`;
    process.env.PFO_INTERNAL_TOKEN = "test-internal-token";
  });

  afterEach(() => {
    storageServer.close();
    apiServer.close();
    rmSync(fixtureDir, { recursive: true, force: true });
    delete process.env.PFO_MAIL_INBOUND_PROVIDER;
    delete process.env.PFO_MAIL_INBOUND_FIXTURE_DIR;
    delete process.env.PFO_STORAGE_SERVER_URL;
    delete process.env.PFO_API_INTERNAL_URL;
    delete process.env.PFO_INTERNAL_TOKEN;
  });

  function writeFixture(name: string, message: unknown) {
    writeFileSync(path.join(fixtureDir, name), JSON.stringify(message), "utf8");
  }

  const attachmentBase64Url = Buffer.from("fake pdf bytes").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

  function sampleMessage(id: string) {
    return {
      id,
      threadId: `thread-${id}`,
      internalDate: String(Date.now()),
      payload: {
        headers: [
          { name: "From", value: "Karthik <karthik@hdfcbank.com>" },
          { name: "Subject", value: "Re: Loan documents" },
        ],
        parts: [
          { mimeType: "text/plain", body: { data: "aGVsbG8" } },
          {
            filename: "statement.pdf",
            mimeType: "application/pdf",
            body: { data: attachmentBase64Url },
          },
        ],
      },
    };
  }

  it("stores the raw message and every attachment, then hands off to the internal API", async () => {
    writeFixture("msg-1.json", sampleMessage("msg-1"));

    const { runOnePollCycleForTests } = await import("./mail-inbound.mjs");
    await runOnePollCycleForTests(() => {});

    const rawStored = storedObjects.find((o) => o.path.endsWith("/raw.json"));
    expect(rawStored).toBeTruthy();

    const attachmentStored = storedObjects.find((o) => o.path.includes("statement.pdf"));
    expect(attachmentStored?.bytes.toString("utf8")).toBe("fake pdf bytes");

    expect(internalRequests).toHaveLength(1);
    expect(internalRequests[0].token).toBe("test-internal-token");
    expect(internalRequests[0].body).toMatchObject({
      gmailMessageId: "msg-1",
      gmailThreadId: "thread-msg-1",
      fromAddress: "Karthik <karthik@hdfcbank.com>",
      subject: "Re: Loan documents",
    });
    expect(internalRequests[0].body.attachments).toHaveLength(1);
    expect(internalRequests[0].body.attachments[0]).toMatchObject({ fileName: "statement.pdf", contentType: "application/pdf" });
  });

  it("processes every fixture file found in the directory", async () => {
    writeFixture("msg-1.json", sampleMessage("msg-1"));
    writeFixture("msg-2.json", sampleMessage("msg-2"));

    const { runOnePollCycleForTests } = await import("./mail-inbound.mjs");
    await runOnePollCycleForTests(() => {});

    expect(internalRequests).toHaveLength(2);
    const ids = internalRequests.map((r) => r.body.gmailMessageId).sort();
    expect(ids).toEqual(["msg-1", "msg-2"]);
  });
});
