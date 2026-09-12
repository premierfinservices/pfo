# Session Checkpoint — 2026-09-12

**Office Server Production Cutover Gate — 4 of 21 steps remain.**
**Also pending: GitHub repo ownership transfer — see bottom of this file.**

Last commit: `7859678` (pushed to `origin/main` this session — confirm
with `git log origin/main -1` before assuming it's still current, since
work continues on a different machine next).

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
