/**
 * Regression test for the TLS-unaware health check (commit f7331bd added
 * optional HTTPS to web-server.mjs; supervisor.mjs's health check hardcoded
 * http:// and would report a perfectly healthy TLS-only server as down).
 *
 * WHAT THIS PROVES: waitForHealth() reaches a self-signed-cert https://
 * server on loopback and returns true, instead of failing certificate
 * validation.
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForHealth } from "./supervisor.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function selfSignedCert(): { certPem: string; keyPem: string } {
  // node:crypto has no public "sign a cert" API, so shell out to openssl —
  // the same assumption Docs/... HTTPS setup already makes for generating
  // the office's own cert, rather than adding a cert-generation dependency
  // for one test.
  const dir = mkdtempSync(path.join(tmpdir(), "pfo-test-cert-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  const result = spawnSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`openssl failed: ${result.stderr}`);
  }
  return { certPem: path.resolve(certPath), keyPem: path.resolve(keyPath) };
}

describe("waitForHealth against a TLS-only web server", () => {
  let child: ChildProcess | undefined;

  afterAll(() => {
    child?.kill();
  });

  it("returns true for a self-signed https:// health endpoint on loopback", async () => {
    const { certPem, keyPem } = selfSignedCert();
    const port = 4300 + Math.floor(Math.random() * 1000);

    child = spawn(process.execPath, [path.join(__dirname, "web-server.mjs")], {
      env: {
        ...process.env,
        PFO_WEB_PORT: String(port),
        PFO_WEB_TLS_CERT: certPem,
        PFO_WEB_TLS_KEY: keyPem,
        PFO_API_PORT: "0",
      },
      stdio: "ignore",
    });

    const healthy = await waitForHealth(`https://127.0.0.1:${port}/health`, 15_000);
    expect(healthy).toBe(true);
  }, 20_000);
});
