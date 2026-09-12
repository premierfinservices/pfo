#!/usr/bin/env node
/**
 * Find document-store files no `document` row points at, and optionally move
 * the provably-dead ones out of the way. Procedure: Docs/Disaster Recovery.md,
 * "Orphaned document files".
 *
 * NOTHING IS EVER DELETED. `--quarantine` moves only "prototype" orphans (see
 * src/domain/storage/orphans.ts) into `<storage root>/Quarantine/<timestamp>/`,
 * outside `Documents/`, so the storage server never serves them and a later
 * human decision — not this script — is what removes them. Every moved file is
 * hash-checked before and after the move and recorded in that folder's
 * manifest.json, which is also the undo list.
 *
 * Runs against whatever `.env` / environment points at: on the office server
 * that is the real `pfo` and `C:\PFO\Data`. The first two lines it prints are
 * the database and storage root, so read them before trusting the rest.
 *
 * Usage:
 *   npm run storage:orphans                    report only, writes nothing
 *   npm run storage:orphans -- --quarantine    report, then quarantine
 */

import { mkdir, readdir, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifyStoredFiles, type OrphanedFile } from "@domain/storage/orphans.js";

import { hashFile, indexDocuments } from "./backup-verify.mjs";
import { closeAdminPool, withAdmin } from "./db.js";

const quarantine = process.argv.includes("--quarantine");
const storageRoot = process.env.PFO_STORAGE_ROOT?.trim() || "C:\\PFO\\Data";
const database = process.env.PFO_DB_NAME ?? "pfo";
const documentsRoot = path.join(storageRoot, "Documents");

function onDisk(root: string, relative: string): string {
  return path.join(root, ...relative.split("/"));
}

function describe(orphan: OrphanedFile): string {
  return orphan.sidecar ? `${orphan.path}  (+ sidecar)` : orphan.path;
}

async function removeEmptyParents(dir: string): Promise<void> {
  while (dir.startsWith(documentsRoot + path.sep)) {
    if ((await readdir(dir)).length > 0) return;
    await rmdir(dir);
    dir = path.dirname(dir);
  }
}

async function loadReferencedPaths(): Promise<string[]> {
  return await withAdmin(async (client) => {
    // `document` is FORCE ROW LEVEL SECURITY: a role that cannot bypass it sees
    // a filtered table, and every hidden row's file would look orphaned.
    const { rows: role } = await client.query<{ sees_all: boolean }>(
      "select rolsuper or rolbypassrls as sees_all from pg_roles where rolname = current_user",
    );
    if (!role[0]?.sees_all) {
      throw new Error(
        "This database role is subject to row-level security, so it cannot see every document row. " +
          "Set PFO_DB_ADMIN_USER / PFO_DB_ADMIN_PASSWORD (Docs/Installation.md §5a) and run again.",
      );
    }
    const { rows } = await client.query<{ file_path: string }>("select file_path from document");
    return rows.map((row) => row.file_path);
  });
}

async function main(): Promise<void> {
  console.log(`PFO document-store orphan audit${quarantine ? " — QUARANTINE" : " (read-only)"}`);
  console.log(`  database:     ${database}`);
  console.log(`  storage root: ${storageRoot}\n`);

  const index = await indexDocuments(documentsRoot);
  const referenced = await loadReferencedPaths();
  const result = classifyStoredFiles(
    index.files.map((file) => file.path),
    referenced,
  );

  const byKind = (kind: OrphanedFile["kind"]) => result.orphans.filter((o) => o.kind === kind);
  const orphanFileCount = result.orphans.reduce((n, o) => n + (o.sidecar ? 2 : 1), 0);

  console.log(`  files on disk (incl. .meta.json sidecars): ${index.fileCount}`);
  console.log(
    `  document rows: ${referenced.length} — ${result.referencedPresent.length} present, ` +
      `${result.referencedMissing.length} missing`,
  );
  console.log(
    `  orphaned files: ${orphanFileCount} — ${byKind("prototype").length} prototype, ` +
      `${byKind("unreferenced-uuid").length} unreferenced-uuid, ${byKind("unrecognised").length} unrecognised`,
  );

  for (const [kind, heading] of [
    ["prototype", "Prototype sample files (no row can ever reference these)"],
    ["unreferenced-uuid", "UUID-owned but unreferenced — HUMAN REVIEW, never moved by this script"],
    ["unrecognised", "Not shaped like a document path — HUMAN REVIEW, never moved by this script"],
  ] as const) {
    const list = byKind(kind);
    if (list.length === 0) continue;
    console.log(`\n  ${heading}:`);
    for (const orphan of list) console.log(`    ${describe(orphan)}`);
  }
  if (result.referencedMissing.length > 0) {
    console.log(`\n  Rows whose file is missing (see Docs/Disaster Recovery.md):`);
    for (const missing of result.referencedMissing) console.log(`    ${missing}`);
  }

  if (!quarantine) {
    console.log(`\nRead-only: nothing was moved.\n`);
    return;
  }

  const toMove = byKind("prototype");
  if (toMove.length === 0) {
    console.log(`\nNothing to quarantine.\n`);
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const quarantineRoot = path.join(storageRoot, "Quarantine", stamp);
  const quarantinedDocuments = path.join(quarantineRoot, "Documents");
  const indexed = new Map(index.files.map((file) => [file.path, file]));
  const moved: { path: string; sizeBytes: number; sha256: string; kind: string }[] = [];

  console.log(`\n  Quarantining ${toMove.length} prototype orphan(s) into ${quarantineRoot}`);
  try {
    for (const orphan of toMove) {
      for (const relative of [orphan.path, orphan.sidecar].filter((p): p is string => p !== null)) {
        const file = indexed.get(relative)!;
        const from = onDisk(documentsRoot, relative);
        const to = onDisk(quarantinedDocuments, relative);
        if ((await hashFile(from)) !== file.sha256) {
          throw new Error(`${relative} changed since it was indexed. Stopping; nothing further was moved.`);
        }
        await mkdir(path.dirname(to), { recursive: true });
        await rename(from, to);
        if ((await hashFile(to)) !== file.sha256) {
          throw new Error(`${relative} does not match its hash after the move. Stopping; inspect ${to}.`);
        }
        moved.push({ path: relative, sizeBytes: file.sizeBytes, sha256: file.sha256, kind: orphan.kind });
        await removeEmptyParents(path.dirname(from));
      }
    }
  } finally {
    if (moved.length > 0) {
      const manifest = {
        quarantinedAt: new Date().toISOString(),
        database,
        storageRoot,
        note: "Moved, not deleted. To undo, move each Documents/<path> here back to <storageRoot>/Documents/<path>.",
        files: moved,
      };
      await writeFile(path.join(quarantineRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
      console.log(`  ${moved.length} file(s) moved; manifest at ${path.join(quarantineRoot, "manifest.json")}`);
    }
  }
  console.log(`\nDone. Re-run without --quarantine to confirm, then take a fresh verified backup.\n`);
}

try {
  await main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await closeAdminPool();
}
