# Session Checkpoint — 2026-09-17 (read this section first, then the rest as history)

**Office Server Production Cutover Gate — 1 of 21 steps remains: #12.**
**#21 (orphan quarantine), #10 (nightly backup fix), and #20 (topology facts) are now DONE — see below.**
**GitHub repo ownership transfer — DONE, see bottom of this file. Remote origin on UNFOLDMEDIACORP updated; home PC still needs updating (see note there).**
**Offsite backup gap (surfaced during #20) — DONE. `npm run backup` now also copies each verified run to `D:\PFO-Backups-Offsite` (Toshiba external, always attached). See below.**

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

## GitHub ownership transfer — DONE (2026-09-17, UNFOLDMEDIACORP)

Repo moved from `tarunrameshphotography` to the new `premierfinservices`
GitHub account (created this session by the user; email
`premierfinservices.cbe@gmail.com`), via GitHub's built-in ownership
transfer (not a mirror/re-clone — preserves issues/PRs/stars/wiki and
leaves a redirect from the old URL).

What happened, in order:
1. Claude-in-Chrome extension wasn't connected at first; user installed/
   enabled it, then logged into `tarunrameshphotography` in that Chrome
   profile. Confirmed via `github.com/settings/profile` before touching
   anything (repo settings under the wrong account 404 rather than
   showing someone else's private settings, which is what first revealed
   the browser was on the wrong account).
2. Claude drove the transfer form at
   `github.com/tarunrameshphotography/pfo/settings` → Danger Zone →
   Transfer → "Specify an organization or username" → `premierfinservices`
   → typed the `tarunrameshphotography/pfo` confirmation string → user
   explicitly confirmed before the final submit click. Result banner:
   "Repository transfer to premierfinservices requested."
3. User logged into `premierfinservices` in the same Chrome profile,
   received GitHub's transfer email, clicked accept. Confirmed complete by
   loading `github.com/premierfinservices/pfo` (200, real content) while
   still logged in as `premierfinservices`.
4. **`origin` remote on UNFOLDMEDIACORP updated**: `git remote set-url
   origin https://github.com/premierfinservices/pfo.git`. `git fetch`
   succeeded immediately (exit 0). `git push` needed a fresh sign-in —
   Git Credential Manager's browser account picker cannot launch through
   Claude's own shell tools (`fatal: Cannot prompt because user
   interactivity has been disabled` / `terminal prompts disabled` — both
   Bash and PowerShell tool invocations run non-interactively). User ran
   `git push origin main --dry-run` themselves in a terminal opened
   directly (not through Claude), signed in as `premierfinservices` via
   the GCM browser picker, and confirmed "Everything up-to-date", exit 0.
   **Lesson for future sessions: any git operation needing a fresh
   interactive credential prompt must be run by the user in their own
   terminal, not delegated to Claude's shell tools.**
5. Verified on GitHub (logged in as `premierfinservices`):
   - Collaborators: `tarunrameshphotography` was auto-retained as a
     collaborator by the transfer — pushes from that identity should
     still work without re-adding.
   - Actions secrets/variables: none existed before or after — nothing to
     carry over.
   - Branch protection: none configured before or after.
   - Webhooks: none configured before or after.

**Still open — home PC's `origin` remote has NOT been updated yet.** User
said (2026-09-17) they'll do this themselves later this evening. Next
session on the home PC (`DESKTOP-2KVRC8D`) — verify it was actually done
before assuming so; if not, must run:
```
git remote set-url origin https://github.com/premierfinservices/pfo.git
```
before its next push, or the push will silently keep going to the old
(now-redirected, but no longer owned) `tarunrameshphotography/pfo` URL.

**This step is closed out except for the home-PC remote update — do not
repeat the transfer itself.**

## Offsite backup gap — RESOLVED (2026-09-17, UNFOLDMEDIACORP, same session)

Raised while recording #20 above (no copy of `C:\PFO\Backups` existed
outside UNFOLDMEDIACORP). Went through brainstorming (bounded path):
recommended cloud/rclone first, user redirected to an already-attached
external drive instead (first `H:`, then settled on `D:` — "Toshiba EXT",
always plugged into this PC).

**What shipped** (commit `2541cc1`): `Backend/backup.mjs` now copies each
*verified* run to `PFO_BACKUP_OFFSITE_ROOT` if that env var is set,
mirroring local retention there too (`pruneOldRuns` helper, shared with
the local-retention code path — same ordering guarantee: copy/prune only
after verification passes, never before). If the drive isn't attached at
run time, it's a warning, not a failure — the local backup is still a
successful, verified run either way.

Wired into `.env` on UNFOLDMEDIACORP: `PFO_BACKUP_OFFSITE_ROOT=D:\PFO-
Backups-Offsite`. The nightly scheduled task calls `node Backend/
backup.mjs` directly, which loads `.env` itself, so no scheduled-task
changes were needed — the offsite copy is already live for tonight's run.
Tested manually before relying on it: real backup run with the drive
present (copy succeeded, contents verified byte-for-byte present on `D:`)
and with a nonexistent drive letter (`Z:`) substituted (correctly skipped
with a warning, local backup still succeeded). Test artifacts cleaned up
from `D:` afterward. All 661 tests still pass.

Docs updated to match: `.env.example`, `Docs/Installation.md` (env var
documented alongside the existing `PFO_BACKUP_ROOT` disk-separation
warning), `Docs/Disaster Recovery.md` (Scenario B now points at the
offsite copy as a fallback source if the whole machine is gone), and
`Docs/Deployment Topology.md`'s "Still to be recorded" table (updated to
reflect the new destination and its limits).

**Known limitation, stated honestly, not hidden:** `D:` stays physically
at the office, always attached to the same PC. This protects against a
single-drive failure (e.g. `C:` dying) but NOT against anything that
takes the whole office — fire, theft, power surge. A true offsite copy
would need a drive that periodically leaves the premises, or a cloud
destination. Not fixed this session; flagged for the user to decide on
later if they want stronger protection than this.

**This step is closed out — do not repeat it. If the user later wants
true offsite (cloud or a drive that leaves the premises), that's a new,
separate task, not a defect in what shipped here.**
