# Disaster Recovery

What to do when the office server PC, its disk, or the database is gone.

Read this **before** you need it. The procedure has been rehearsed — see
"Proof this works" at the bottom — but rehearsing it yourself once, on a quiet
afternoon, is worth more than reading it twice.

---

## First: do not make it worse

1. **Do not delete anything.** Not the database, not `C:\PFO\Data`, not a
   backup folder that "looks corrupt". A damaged database is often still
   partially readable and is evidence about what happened.
2. **Do not run migrations** against a database you are unsure about.
3. **Take a copy of the backup folder you intend to restore from** before
   restoring, if there is room. A restore reads it, but a failed restore
   attempt followed by a panicked second attempt is where backups get lost.
4. Note the time and what happened. Ten minutes of memory is worth more than an
   hour of reconstruction later.

---

## What PFO data actually is

Two halves that must be restored **from the same backup run**:

| | Where | What it is |
|---|---|---|
| Operational database | PostgreSQL `pfo` | Customers, cases, requirements, document *metadata*, verification, submissions, users, permissions, the event log |
| Document bytes | `PFO_STORAGE_ROOT` (`C:\PFO\Data`) | The actual PDFs and photos |

`document.file_path` in the database is a *pointer*. A database restored
without its matching documents is a system that believes in files it cannot
open; documents restored without their database are bytes nobody can find.
`Backend/backup.mjs` writes both into one timestamped folder for exactly this
reason — **never mix a database dump from one run with documents from another.**

Not in the backup, because it is not derived data: `.env`. It holds the
database password and the Gmail refresh token. Keep a copy somewhere secure and
offline. Everything else can be rebuilt from this repository.

---

## Scenario A — the database is corrupt or was dropped, the PC is fine

1. Confirm what you are restoring from:

   ```powershell
   cd C:\PFO\App
   npm run backup:verify -- --all
   ```

   Pick the newest run that verifies. If none do, use the newest that verifies
   with only document problems — a good dump with some missing files is far
   better than nothing.

2. Restore. Note `PFO_RESTORE_CONFIRM`: without it the script refuses to write
   to the office database at all.

   ```powershell
   $env:PFO_RESTORE_CONFIRM="pfo"
   node Backend/restore.mjs `
       --backup "D:\PFO-Backups\2026-08-10_20-30-00" `
       --db pfo `
       --storage-root C:\PFO\Data `
       --create-db --drop-existing --overwrite-storage
   ```

   `--drop-existing` destroys the current `pfo` database. That is the intent
   here, and it is why the confirmation variable exists. **Only run this when
   you have decided the current database is not worth keeping.**

3. Check the tail of the output: "all N restored document(s) match the backup
   byte for byte". If it reports missing or corrupted files, the database is
   restored but some documents are not — see "Partial document loss" below.

4. Start PFO and check it:

   ```powershell
   Start-ScheduledTask -TaskName "PFO Server"
   .\Scripts\pfo-status.ps1
   ```

5. Open a case that had documents and download one. That is the only check that
   proves both halves came back together.

---

## Scenario B — the server PC is dead

You need the backup folder (from wherever `PFO_BACKUP_ROOT` pointed) and the
`.env` copy.

1. Follow `Docs/Installation.md` steps 1–4 on the replacement PC — Node,
   PostgreSQL, the checkout, `npm ci`, and `.env`.
2. **Do not run `npm run migrate`.** The restore brings the schema with it, and
   migrating first produces a database the dump cannot be applied cleanly onto.
3. Create the database and restore:

   ```powershell
   $env:PFO_RESTORE_CONFIRM="pfo"
   node Backend/restore.mjs `
       --backup "<backup folder>" --db pfo `
       --storage-root C:\PFO\Data --create-db
   ```
4. `npm run build`, then continue from Installation step 7.
5. `npm run migrate:status` — if the checkout is newer than the backup, some
   migrations will show as pending. Apply them with `npm run migrate`.
6. Re-do Installation steps 8, 11 and 12: firewall, backup task, server task.
   None of those live in the backup.
7. **The LAN IP of the new PC is probably different.** Reserve the old address
   for it if you can; otherwise tell everyone the new URL and update
   `Docs/Deployment Topology.md`.

---

## Scenario C — someone deleted a case, or a document, by mistake

There is no undelete, and there is deliberately no "restore one row" path: a
row lifted out of a backup and pushed into a live database arrives without the
events, requirements and submissions that referenced it.

What to do instead:

1. Restore the relevant backup into a **scratch** database and folder — never
   over the live one:

   ```powershell
   node Backend/restore.mjs --backup "<run>" --db pfo_recovery `
       --storage-root C:\PFO\Recovery --create-db --drop-existing
   ```
2. Read what you need out of `pfo_recovery` with `psql`, and copy the document
   files you need out of `C:\PFO\Recovery\Documents`.
3. Re-enter the work in the live system through the normal screens, so it
   carries correct events and ownership.
4. Drop `pfo_recovery` and delete `C:\PFO\Recovery` when done.

Note that most "deletions" in PFO are not deletions: cases are marked lost and
can be reopened, requirements become `not_applicable` rather than disappearing,
users are deactivated rather than removed, and the event log cannot be modified
at all (a database trigger refuses `UPDATE` and `DELETE` on it). Check whether
the thing is actually gone before restoring anything.

---

## Partial document loss

If a restore reports missing or mismatched document files, the database is
consistent but some bytes are gone. Those requirements will show as verified
with a document that cannot be downloaded.

1. Note which paths failed — the restore prints the first five and counts the
   rest.
2. Check an older backup: `npm run backup:verify -- --all` and look for a run
   where those files verify.
3. If no backup has them, the documents must be collected from the customer
   again. Find the affected cases by matching `document.file_path` against the
   failed paths.

---

## Orphaned document files

The opposite of partial loss: files under `<PFO_STORAGE_ROOT>\Documents` that no
`document` row points at. They are inert — nothing can reach them through the
app — but they are backed up forever and confuse every storage audit.
`npm run storage:orphans` finds and classifies them
(`src/domain/storage/orphans.ts`):

- **prototype** — owner id is not a UUID (e.g. `person/per_001/...`). Sample
  files from the retired in-browser prototype; the API only ever builds paths
  from UUIDs, so no row can reference them. The only kind the script will move.
- **unreferenced-uuid** — most likely bytes from an upload whose transaction
  rolled back (bytes are stored before the row is inserted). Could be a real
  customer's file. Listed for human review; never moved by the script.
- **unrecognised** — not shaped like a document path. Review by hand.

Nothing in this procedure deletes anything. On the server, with production's
own `.env`:

1. `npm run backup` — must end with a verified backup.
2. `npm run storage:orphans` — read-only. Check the first two lines name `pfo`
   and `C:\PFO\Data`, and that the counts are what you expect. Stop and ask if
   they are not.
3. `npm run storage:orphans -- --quarantine` — moves the prototype orphans (and
   their `.meta.json` sidecars) to `<PFO_STORAGE_ROOT>\Quarantine\<timestamp>\`,
   hash-checked before and after, with a `manifest.json` listing every file.
4. Run step 2 again: 0 prototype orphans.
5. `npm run backup` again — verified.
6. Record the quarantine folder and counts in the master roadmap. Deleting that
   folder later is its own, separate decision.

To undo, in PowerShell (set `$q` to the quarantine folder):

```powershell
$m = Get-Content "$q\manifest.json" -Raw | ConvertFrom-Json
foreach ($f in $m.files) {
  $rel = $f.path -replace '/', '\'
  $to = Join-Path "$($m.storageRoot)\Documents" $rel
  New-Item -ItemType Directory -Force (Split-Path $to) | Out-Null
  Move-Item (Join-Path "$q\Documents" $rel) $to
}
```

The script refuses to run as a role that row-level security filters (e.g.
`aos_app` alone): a filtered `document` table would make real files look
orphaned. It uses `PFO_DB_ADMIN_USER` when set, the same as backup and restore.

---

## Proof this works

`npm run restore-drill` runs the entire procedure end to end against throwaway
targets — it builds a synthetic case with a real uploaded document through the
ordinary code paths, backs it up, **deliberately corrupts a copy to confirm the
verifier rejects it**, restores into a scratch database and folder, and checks
that the case, the document metadata, the requirement linkage, the audit trail
and the document bytes all came back. It never touches `pfo` or `C:\PFO\Data`.

Last run: 16/16 checks passed, including both damage-detection cases. The
report is written to `<PFO_BACKUP_ROOT>\..\DrillBackups\last-drill-report.md`.

Run it after any change to the backup or restore scripts, and once a quarter
regardless.
