# Session Checkpoint — 2026-09-17 (read this section first, then the rest as history)

**Office Server Production Cutover Gate — 1 of 21 steps remains: #12.**
**#21 (orphan quarantine), #10 (nightly backup fix), and #20 (topology facts) are now DONE — see below.**
**Also pending: GitHub repo ownership transfer (needs a browser action by the destination account owner, not doable by Claude) — see bottom of this file.**

Last commit: `5985c0e` (pushed to `origin/main` this session, from
UNFOLDMEDIACORP, confirmed via `Docs/Which PC Is This.md` — hostname
`UnfoldMediaCorp`, `.env` reading `PFO_DB_NAME=pfo` / `PFO_WEB_HOST=0.0.0.0`
/ `PFO_STORAGE_ROOT=C:\PFO\Data`, i.e. this was the real production shell,
not a dev override). Confirm with `git log origin/main -1` before assuming
still current.

## What happened this session (2026-09-17, on UNFOLDMEDIACORP)

1. **Case number rebrand follow-up**: found and fixed several `AL-2026-...`
   fixtures/assertions in test files that earlier rebrand passes had missed
   (`Frontend/src/lib.test.ts`, `Frontend/src/fake/requirements.test.ts`,
   `Frontend/src/fake/case-workflow.test.ts`,
   `src/domain/submissions/{package,compose}.test.ts`,
   `src/domain/case/case-number.test.ts`). All 655 tests pass. Committed as
   `5985c0e` (rebased onto 4 remote doc commits made from home PC in the
   meantime, then pushed).
2. **Migration `0038_case_number_prefix_pf.sql`** (untracked file found at
   session start) was confirmed **already applied** to the real `pfo`
   database (checksum match, `--status` shows `applied`) — it had been run
   by an earlier, uncommitted session. `npm run migrate` this session
   correctly did nothing. The file is now committed so the repo matches
   reality.
3. Restarted the `PFO Server` scheduled task (with user confirmation) so
   the running process picks up the `PF-` prefix code fix and matches the
   already-migrated database. Confirmed back up: ports 4300/4321/4319/4320
   all listening again afterward.
4. **Confirmed the database is intentionally empty** — `loan_case` has 0
   rows, `storage:orphans` reports 0 document rows. User confirmed
   (2026-09-17): *"Yes no cases, all fresh, hard delete everything and keep
   it fresh."* This is deliberate, not data loss — do not be alarmed by low
   counts in future sessions; re-confirm with the user if it looks
   different from this stated fresh-start baseline.
5. **Step #1 (HTTPS check, from the "what's left" list below)**: confirmed
   TLS is live and correct. `https://127.0.0.1:4300/health` → 200
   (`{"ok":true,"service":"aos-web"}`); plain `http://127.0.0.1:4300/`
   connection-resets (server only listens on HTTPS now). The known gap
   (supervisor's internal health check and `Scripts/pfo-status.ps1` probe
   `http://` and will misreport DOWN) is unchanged and still deliberately
   out of scope — do not "fix" by disabling TLS.
6. **Step #21 (orphan quarantine) — DONE.** `npm run backup` (verified) →
   `npm run storage:orphans` (24 files, 12 prototype incl. one new
   `person/per_005/aadhaar_card` location not in the original checklist,
   0 unreferenced-uuid) → `npm run storage:orphans -- --quarantine` (24
   files moved, manifest at
   `C:\PFO\Data\Quarantine\2026-09-17_07-45-54\manifest.json`) → re-ran
   read-only, confirmed 0 orphans remain → `npm run backup` again
   (verified, correctly shows 0 documents since the store is genuinely
   empty now). **This step is closed out — do not repeat it.**
7. **Step #10 (nightly backup verification) — FOUND A REAL BUG, NOT YET
   FIXED.** `Get-ScheduledTaskInfo "PFO Nightly Backup"` showed
   `LastTaskResult = 0x8007010B` ("the directory name is invalid") and no
   `backup-log.txt` entries since **2026-09-09 20:30** (8 days of missing
   unattended backups). Root cause found: the task's action still points at
   the **pre-rebrand path** `C:\WORK FILES\Amaze Loans Pvt Ltd\PFO\Backend\backup.mjs`,
   which no longer exists (project is now at
   `C:\WORK FILES\Premier FinServ\PFO`). This was never updated across the
   AOS→PFO rebrand's folder renames. **This is the one open item — see
   "NEXT ACTION" immediately below.**

## Step #10 — RESOLVED (2026-09-17, later in the same session)

Prior attempt to fix the scheduled task action from a non-elevated shell
had failed with **Access is denied** (`0x80070005`). This session, an
elevated PowerShell was launched via `Start-Process powershell -Verb
RunAs` (UAC prompt approved by the user), and the fix commands were run
inside it successfully:

```powershell
$newAction = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c ""C:\Program Files\nodejs\node.exe" "C:\WORK FILES\Premier FinServ\PFO\Backend\backup.mjs" >> "C:\PFO\Backups\backup-log.txt" 2>&1"' -WorkingDirectory "C:\WORK FILES\Premier FinServ\PFO"
Set-ScheduledTask -TaskName "PFO Nightly Backup" -Action $newAction
```

Verified from the normal (non-elevated) shell afterward:
- `(Get-ScheduledTask -TaskName "PFO Nightly Backup").Actions` shows the
  corrected `C:\WORK FILES\Premier FinServ\PFO\Backend\backup.mjs` path.
- `Start-ScheduledTask -TaskName "PFO Nightly Backup"` triggered a manual
  run; `Get-ScheduledTaskInfo` afterward showed `LastTaskResult = 0`.
- `backup-log.txt` got a fresh, successful entry: verified backup at
  `C:\PFO\Backups\2026-09-17_07-56-46` (0 documents, matching the
  intentionally-empty store baseline from item 4 above), and retention
  correctly pruned the old `2026-08-12_05-56-00` backup.

**This step is closed out — do not repeat it.**

## Step #20 — RESOLVED (2026-09-17, same session)

User (Tarun Ramesh, Manager — Premier Finservices) provided the remaining
human-only facts directly in chat. `Docs/Deployment Topology.md`'s "Still
to be recorded" table updated:
- Server location: Premier Finservices office, UNFOLDMEDIACORP PC, no
  formal asset tag.
- LAN IP `192.168.0.101`: confirmed DHCP-reserved in the router against
  the server's MAC address.
- Backup destination: `C:\PFO\Backups` on UNFOLDMEDIACORP only — **no
  offsite/separate physical copy exists**. Recorded as a known gap, not
  fixed this session (would need a separate task to add an offsite/cloud
  backup destination).
- DB password / login slips holder: Tarun Ramesh, Manager — Premier
  Finservices.

**This step is closed out — do not repeat it.**

## NEXT ACTION — pick up here

Only **#12** remains on the cutover gate: verify reachability from a
second/third physical office PC (neither home nor UNFOLDMEDIACORP) at
`http://192.168.0.101:4300`. Not doable from either machine alone — needs
an actual second device on the office LAN. Nothing to do here until that
device exists; revisit when one is available.

Separately, still open and **not doable by Claude**: the **offsite backup
gap** just recorded under #20 (no copy of `C:\PFO\Backups` exists outside
UNFOLDMEDIACORP — a single-machine failure would lose all backups too),
and the **GitHub ownership transfer** (see its own section further down
this file) — both need a human decision/action (a backup destination
choice, and a GitHub account holder's acceptance) rather than a code or
server change.

---

# Session Checkpoint — 2026-09-12 (history — superseded by the section above for current status)

Last commit as of this section: `7859678`.

Everything else — all 6 development phases (column masking, admin-screen
honesty, concurrency/audit hardening, case completeness, loan outcome
tracking, case intake & document workflow) and 17 of the 21 cutover steps —
is done. See `PFO Production Readiness Master Roadmap.txt`, "STATUS as of
2026-09-12" section, for full detail and evidence per step.

---

## Why this checkpoint exists

The previous session (home PC, DESKTOP-2KVRC8D) built and tested the
tooling for step #21 (orphaned document files) on disposable `pfo_dev`
data, and reconciled the roadmap/Milestones docs against work that had
already landed during the 2026-09-09 rebrand but was never marked done.
It could not run any of the remaining 4 steps itself — they all require
the real UNFOLDMEDIACORP server, powered on, reachable, running production's
own `.env` (never a dev shell with overridden `PFO_*` vars, never
`npm run dev`).

## What's left (in the order to do them)

### 1. Check HTTPS state first
Commit `f7331bd` (2026-09-10, made from the server's own account) added
optional TLS. Check whether `PFO_WEB_TLS_CERT`/`PFO_WEB_TLS_KEY` are already
set in the server's `.env`. If yes: the site works, but
`Backend/supervisor.mjs`'s startup health check and `Scripts/pfo-status.ps1`
still call `http://127.0.0.1/health` and will wrongly report the web
service DOWN — known gap, not a real outage, don't "fix" it by disabling
TLS. If no: initial production runs plain HTTP on the office LAN, which is
fine (firewall already restricts to the Private profile).

### 2. Step #21 — quarantine the orphaned files
```
npm run backup
npm run storage:orphans
```
Expect: 24 files = 12 "prototype" orphans (with sidecars) under
`person/per_001` and `person/per_002`, 0 `unreferenced-uuid`, 43/43
referenced documents present. **If the counts differ, stop and investigate
before quarantining anything.**
```
npm run storage:orphans -- --quarantine
npm run storage:orphans          # confirm 0 prototype orphans
npm run backup                   # fresh verified backup, post-quarantine
```
Procedure and undo instructions: `Docs/Disaster Recovery.md`, "Orphaned
document files".

### 3. Step #10 — confirm the unattended nightly backup
```
Get-ScheduledTaskInfo "PFO Nightly Backup"
```
Expect a `LastRunTime` around 20:30 (not from a manual `Start-ScheduledTask`)
and `LastTaskResult` = 0. Also check `C:\PFO\Backups\backup-log.txt`.

### 4. Step #12 — verify from a second office PC
Browse to `http://192.168.0.101:4300` (or `https://` if TLS is on — install
`Scripts/install-pfo-root-ca.ps1` on that PC first), sign in as a real
employee, open a case, view one document.

### 5. Step #20 — record topology facts
Fill in the blanks in `Docs/Deployment Topology.md`, "Still to be recorded"
table:
- server asset tag / physical location
- DHCP reservation of `192.168.0.101` in the router, against the server's MAC
- offsite/physical backup copy arrangement
- who holds the database password and login slips

These are human facts — don't guess or infer them.

### 6. Close out
Update `PFO Production Readiness Master Roadmap.txt` and `Milestones.txt`
with the results of steps 2-5, commit, and push. That closes the cutover
gate and reaches **INITIAL PRODUCTION**.

## Deliberately not in scope here
- HTTPS completion (health-check/doc gaps) — recorded under "AFTER INITIAL
  PRODUCTION" in the roadmap, not a cutover blocker.
- Two stale untracked files from a previous session's confusion
  (`PFO_Production_Readiness_Master_Roadmap.txt`,
  `PFO_Roadmap_Model_Effort_Plan.txt`) — superseded by the tracked roadmap,
  never committed. Safe to delete once noticed.

## 2026-09-12 update — machine check added, nothing else changed

A later session on this same date was asked to run steps #10/#12/#20/#21
and, per this checkpoint's own instruction, checked machine identity
first: hostname `DESKTOP-2KVRC8D`, `.env` reading `PFO_DB_NAME=pfo_dev` —
this is the home PC, not UNFOLDMEDIACORP. No cutover step was attempted.
That session instead:
- Added `Docs/Which PC Is This.md` — the identity check to run before any
  task that could touch production, plus why it exists.
- Pointed to it from `CLAUDE.md` so it loads every session.
- Added a "WHICH PC CAN DO WHAT" section to the master roadmap (right
  after the cutover-gate status) classifying every remaining step, and
  the post-cutover backlog, by which of the two machines (or neither) can
  do it.
- Updated `Milestones.txt` with a short pointer to both.

**Nothing in "What's left" below changed.** All 4 steps still need to run
on UNFOLDMEDIACORP with production's own `.env`, exactly as this
checkpoint already said. The next session should read `Docs/Which PC Is
This.md` first, confirm it is actually on UNFOLDMEDIACORP with
production's `.env`, then resume at "What's left" below.

## Pending, separate from the cutover gate: move the repo to premierfinserv.cbe@gmail.com's GitHub account

Raised 2026-09-12, home PC. User wants the repo transferred out of
`tarunrameshphotography`'s GitHub account into one owned by
`premierfinserv.cbe@gmail.com`, and wants to do this work from
UNFOLDMEDIACORP next, not home. Nothing has been transferred yet — no
GitHub-side action was taken this session, informational only.

Current remote (both machines should have the same, modulo the redirect
noted below): `https://github.com/tarunrameshphotography/AOS` — this
redirects to the repo's current actual location,
`https://github.com/tarunrameshphotography/pfo` (renamed earlier in the
rebrand). Confirmed clean of committed secrets in the current tree: `.env`
is gitignored, only `.env.example` is tracked; a full-history secret scan
was recommended but not run.

Procedure agreed on (GitHub's built-in ownership transfer, not a
mirror/re-clone — preserves issues/PRs/stars/wiki and leaves a redirect):

1. **Prerequisite** — `premierfinserv.cbe@gmail.com` needs an existing
   GitHub account or org with a known username; GitHub transfers target a
   username, not an email address. Not yet confirmed to exist.
2. On `github.com/tarunrameshphotography/pfo` → Settings → Danger Zone →
   Transfer ownership → enter the new owner's username + repo name to
   confirm. GitHub emails the new owner, who must accept.
3. After acceptance, update the `origin` remote on **both** machines:
   `git remote set-url origin https://github.com/<new-owner>/pfo.git`
   (a transfer does not update either machine's local remote by itself).
4. Decide whether `tarunrameshphotography` should be re-added as a
   collaborator on the new repo — a transfer removes the old owner's
   owner-level access by default, and pushes from this identity would
   otherwise stop working.
5. Verify (don't assume) that GitHub Actions secrets/variables, branch
   protection rules, and webhooks carried over correctly after transfer.

Nothing here is UNFOLDMEDIACORP-specific in the sense of production
data/database — this is a GitHub account operation, doable from a browser
on either machine. The user chose to do it from UNFOLDMEDIACORP anyway;
next session there should pick up at step 1 (confirm the target account
exists) once ready.
