# Session Checkpoint — 2026-09-12

**Office Server Production Cutover Gate — 4 of 21 steps remain.**

Last commit: `94802ff` (not yet pushed as of this checkpoint — check
`git log origin/main -1` before assuming it's live on the server).

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
