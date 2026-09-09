# Premier Finserv Rebrand Roadmap

Checkpoint file. Amaze Loans Pvt Ltd has dissolved; Premier Finserv is the
new organisation running the same business. This tracks converting the
codebase, running system, and outbound business identity from AOS / Amaze
Loans to Premier Finserv, in phases, without breaking the live production
system on Unfold Media Corp PC or losing real customer data.

Read this file at the start of any session working on the rebrand. Update
its STATUS lines as work happens — this is the source of truth for what has
and hasn't been done, the same role
`AOS Production Readiness Master Roadmap.txt` plays for the persistence
milestone.

**Do not treat this as a single task.** Several phases touch the live
production database, the real document store, and the mailbox that sends
real email to real banks. Each phase below says whether it's safe to do
any time or needs a planned window, and what the rollback is.

---

## TASK COMPLEXITY / MODEL / EFFORT GUIDE

Which Claude Code model and reasoning effort to run each phase at, judged
on: how much the phase depends on judgment calls vs mechanical find-replace,
and how expensive a mistake is (text-only vs live production data). Effort
here means how carefully to work — how much to verify before/after, not a
literal tool setting. Re-judge this if the phase's actual scope turns out
different from what's written below.

| Phase | Complexity | Model | Effort | Why |
|---|---|---|---|---|
| 0 — Audit | Low | Sonnet 5 | Low | Read-only grep/inspection, no judgment calls that survive past this checkpoint. |
| 1 — User-facing branding | Low | Sonnet 5 | Low | COMPLETE. Was string replacement in known UI files. |
| 2 — Mail sender identity | Low | Sonnet 5 | Low | One env var + restart + a verification send. No code change, low blast radius, easily reversible. |
| 3 — Low-risk internal text | Low | Sonnet 5 | Low-Medium | Mechanical, but needs judgment on what NOT to touch (ADR/BR codes, historical references) — a pure find-replace tool would over-rename. Not Haiku: the judgment calls (what's safe to reword vs a legal/audit citation) matter more than the mechanical edits are numerous. |
| 4 — Env var prefix rename | Medium-High | Sonnet 5 | High | Wide blast radius across two machines' `.env` files and every script that reads `AOS_*`. Mechanical per-file, but the coordination requirement (both PCs updated in the same window) and the port-collision reintroduction risk (`free-dev-ports.mjs`) need careful sequencing, not just search-and-replace. |
| 5 — Database rename | High | Opus 5 | High | Live production database, real customer data behind it. `ALTER DATABASE` itself is simple SQL, but the surrounding sequencing (connection draining, verifying every hardcoded db-name reference, confirming the app actually reconnects correctly) is exactly where Opus's deeper reasoning earns its cost — a missed reference here means production downtime, not a typo. |
| 6 — Storage/backup path rename | High | Opus 5 | High (max care) | Real customer documents (110 files as of this checkpoint) and their backups. Highest-consequence phase in the whole roadmap — a mistake here is potential data loss, not just downtime. Verify file count/size before and after, not just "it ran without error." |
| 7 — Scheduled task rename | Medium | Sonnet 5 | Medium | Mechanical PowerShell re-registration once elevated, but must be verified against the exact trigger/logon config already confirmed working (`BootTrigger`, `RunLevel=Highest`, S4U) — get that wrong and the server silently stops surviving reboots. |
| 8 — Repo & folder rename | Medium | Sonnet 5 | Medium | GitHub side is low-stakes; the local folder move on the server PC carries the same "don't move a path a running task depends on" risk as Phase 6, just smaller (code, not customer data). |
| 9 — Final verification gate | Medium-High | Opus 5 | High | Breadth, not depth — many independent checks (grep inventory, typecheck, test suites, backup verify, real login) that must ALL be genuinely green, not spot-checked. This is the gate that decides "rebrand complete," so treat a partial pass as a fail, not a rounding error. |

General rule underneath the table: any phase that can touch the live `aos`
database, `C:\AOS\Data`, or the production scheduled tasks gets Opus 5 at
high effort, full stop, regardless of how mechanical the change looks on
paper — the cost of being wrong there is data loss or downtime, not a
re-edit. Phases that are pure text/docs/comments stay on Sonnet 5 at low
effort; there's nothing for a bigger model to add.

---

## OPEN DECISIONS — needed before Phase 2 onward

Not yet answered by the business. Phase 1 does not depend on these; nothing
past Phase 1 should start until they are:

1. **Internal slug/short name** — used for the database name, env var
   prefix, storage folder, npm package name, scheduled task names. Currently
   proposed but NOT CONFIRMED: `pfo` (short) vs `premierfinserv` (explicit).
   Whichever is picked becomes `AOS_*` → `<SLUG>_*`, database `aos` →
   `<slug>`, `C:\AOS\Data` → `C:\<Slug>\Data`, etc., consistently.
2. **Timing for the downtime-requiring phases** (5, 6, 7) — do them live in
   a working session with a human watching, or schedule an after-hours
   window. Each of those phases stops the production task briefly.
3. **Scope of Phase 8** (GitHub repo rename, local folder path rename) —
   bundle with the runtime rename or defer to later. Renaming the folder
   means moving the working directory both PCs use.

---

## KEY FINDING FROM THE PHASE 0 AUDIT — read this first

**The live mail backend sends real email to real banks with the display
name "Amaze Loans"** (`Backend/mail-server.mjs:95`,
`SENDER_NAME = process.env.AOS_MAIL_SENDER_NAME ?? "Amaze Loans"`). This is
not cosmetic — it is the sender identity on outbound correspondence to
lenders, for a company that has legally dissolved. This is a business/legal
concern independent of anything below, and the fix is already low-risk:
the value is already overridable via `AOS_MAIL_SENDER_NAME` in `.env`
without touching code. **This should be prioritised ahead of the DB/path
renames below** — recommend doing it as soon as the new sender identity is
confirmed, not waiting for Phase 5+.

`package.json`'s `"description"` and `README.md`'s first line also still
say "Amaze Loans Pvt Ltd" as the entity operating the system — lower
stakes (not sent externally) but should move with Phase 3.

---

## PHASE 0 — Audit (COMPLETE, this checkpoint)

**Complexity: Low — Model: Sonnet 5 — Effort: Low**

What actually still says "AOS" or "Amaze Loans" in the codebase, as of
2026-09-09, `git log` HEAD `6fbb3dd`:

- **User-facing branding (browser title, login screen, app header,
  dashboards, mail sender, idle-session prompt): DONE** — commit `4a4e6f3`,
  2026-09-07. Verified live: `<title>Premier Finserv One — Premier
  Finservices</title>`, login screen shows "Premier Finserv One".
- **Outbound mail sender identity: "Amaze Loans", NOT YET CHANGED** — see
  Key Finding above.
- **Code comments referencing "AOS" as the system's own name**: ~17 files
  under `Frontend/src`, several under `Backend/`. Not customer-visible.
  Lowest priority — cosmetic accuracy for future readers, not a rebrand
  blocker.
- **"Amaze Loans" as the legal entity name**: appears in
  `Backend/bootstrap-production.ts`, `Backend/mail-server.mjs`,
  `Backend/seed-users.ts`, `Backend/submissions.ts`, `DECISIONS.md`,
  `Docs/Deployment Topology.md`, `Docs/Email and WhatsApp Integration.md`,
  `Frontend/src/fake/document-submission.test.ts`,
  `Frontend/src/fake/mail.ts`, `Frontend/src/fake/store.ts`,
  `package.json`, `README.md`,
  `src/domain/communications/email-provider.ts`,
  `src/domain/communications/whatsapp-provider.ts`,
  `src/domain/submissions/compose.test.ts`,
  `src/domain/submissions/compose.ts`,
  `src/domain/submissions/package.test.ts`,
  `tests/e2e/document-submission.spec.ts`. Not yet individually triaged —
  do that at the start of Phase 3/4 (most are comments/docs/tests; the
  mail-sending ones are covered by the Key Finding above).
- **Internal engineering nomenclature, untouched**: `AOS_*` env var
  prefix throughout `Backend/`, `Frontend/`, `.env.example`; database name
  `aos` (plus `aos_test`, `aos_e2e`, `aos_dev`); storage paths
  `C:\AOS\Data`, `C:\AOS\Backups`; `package.json` `"name": "aos"`;
  Windows scheduled tasks `AOS Server` / `AOS Nightly Backup`; GitHub repo
  `tarunrameshphotography/AOS`; local folder path
  `...\Amaze Loans Pvt Ltd\AOS` on both PCs; doc file names
  (`AOS Production Readiness Master Roadmap.txt`,
  `Docs/Deployment Topology.md`'s content, `CLAUDE.md`).

---

## PHASE 1 — Customer/employee-facing branding

**STATUS: COMPLETE** (commit `4a4e6f3`, 2026-09-07)
**Complexity: Low — Model: Sonnet 5 — Effort: Low**

Browser title, login screen, app header/nav, dashboards, document rules,
master data, lender catalogue screens, mail-sender display name in the UI
layer, idle-session monitor text, and the e2e test asserting the login
page text. No further action.

---

## PHASE 2 — Outbound mail sender identity

**STATUS: COMPLETE** (2026-09-09). `AOS_MAIL_SENDER_NAME=Premier Finserv`
live in production `.env` on Unfold PC, `AOS Server` task restarted after
the edit, code fallback in `Backend/mail-server.mjs:95` updated from
`"Amaze Loans"` to `"Premier Finserv"`, and a real verification send to
tarunrameshphotography@gmail.com confirmed via the live `/send` endpoint
(`providerMessageId: 1a0855b3354ca4a7`) with From identity
`Premier Finserv <premierfinservices.cbe@gmail.com>`. Remaining stale
`SENDER_ADDRESS` fallback and log/comment text ("Amaze Loans mailbox")
deferred to Phase 3 — cosmetic only, doesn't affect the live sender identity.
**Complexity: Low — Model: Sonnet 5 — Effort: Low**

- Set `AOS_MAIL_SENDER_NAME` in the production `.env` on Unfold PC to the
  new sender name (no code change required — the fallback in
  `Backend/mail-server.mjs:95` already reads this var).
- Restart the `AOS Server` task so the mail backend picks it up.
- Verify: check the mail backend's `/health` response and, ideally, one
  real send to a controlled test address before it goes out to a bank.
- Risk: LOW. One env var, no schema/data change, instantly reversible by
  unsetting the var.
- Rollback: remove the env var override; falls back to the old default
  (though the old default should also be updated once the new name is
  confirmed, so this is a stopgap, not the final state).

---

## PHASE 3 — Low-risk internal text (docs, comments, package metadata)

**STATUS: COMPLETE** (2026-09-09). Legal entity name confirmed as
"Premier Finservices" (matches the browser title and the
`premierfinservices.cbe@gmail.com` mailbox already live from Phase 2).
**Complexity: Low-Medium — Model: Sonnet 5 — Effort: Low-Medium**

- Updated `package.json` `"description"`, `README.md`'s entity line,
  `Backend/bootstrap-production.ts`, `Backend/seed-users.ts`,
  `Backend/mail-server.mjs` (comments + the `SENDER_ADDRESS` fallback
  deferred from Phase 2), `Backend/submissions.ts` (same fallback pattern,
  missed by Phase 2), `Docs/Email and WhatsApp Integration.md`,
  `src/domain/communications/email-provider.ts` (a user-facing string Phase
  1 missed), `src/domain/communications/whatsapp-provider.ts`,
  `Frontend/src/fake/mail.ts`, `Frontend/src/fake/store.ts`
  (`DEFAULT_EMAIL_SENDER`), `src/domain/submissions/compose.ts`, and every
  test asserting the old sender name/address in sync with the above
  (`compose.test.ts`, `package.test.ts`, `document-submission.test.ts`,
  `tests/e2e/document-submission.spec.ts`), plus `.env.example`'s mail/
  WhatsApp comments and defaults for consistency with the live prod values.
- Deliberately NOT touched (judgment calls):
  - `DECISIONS.md` ADR-002 — a dated historical decision record, not a
    live description of the system.
  - `Docs/Deployment Topology.md` — explicitly deferred to Phase 9 by this
    roadmap (it's rewritten wholesale there alongside the master roadmap).
  - `Database/migrations/*.sql` — already-applied migrations are treated
    as immutable history, not live text.
  - `document-catalogue.ts`'s `"Amaze Loans Application Form"` document
    type name — this may refer to an actual physical form name that
    existing case documents are already matched/tagged against; renaming
    it is a data/behavior question, not a text-only edit, so it's left for
    a deliberate decision rather than swept in here.
  - Comments/log text that still call the system "AOS" as its own name —
    left alone because the npm package name, database, storage paths,
    scheduled tasks, GitHub repo, and local folder are all still literally
    `AOS`/`aos` until Phases 4–8 land; renaming those comments now would
    make them describe infrastructure that doesn't exist yet. Revisit once
    Phase 4+ picks the slug.
- Risk: NONE — text-only, no running-system impact, no downtime. Unit
  tests and `npm run typecheck` verified green after the change.
- Verification: `npx vitest run` on the touched test files (59 tests
  passed) and `npm run typecheck` (clean).

---

## PHASE 4 — Env var prefix rename (`AOS_*` → `<SLUG>_*`)

**STATUS: COMPLETE, BOTH PCS** (2026-09-09). Slug confirmed: `pfo`. Ran on
Unfold Media Corp PC (the production server) and home PC.
**Complexity: Medium-High — Model: Sonnet 5 — Effort: High**

- Renamed every `AOS_*` env var identifier to `PFO_*` across 48 files:
  `Backend/`, `Frontend/`, `src/domain/`, `.env.example`, `Scripts/*.ps1`,
  root test/build configs (`vite.config.ts`, `playwright.config.ts`,
  `vitest.integration.config.ts`), `tests/`, and the docs that document
  these exact var names (`CLAUDE.md`, `Docs/Installation.md`,
  `Docs/Disaster Recovery.md`, `Docs/Email and WhatsApp Integration.md`,
  `Docs/Session Checkpoint.md`, `Database/README.md`,
  `Frontend/README.md`) — 438 replacements. Only the identifier prefix
  changed; values (`aos`, `aos_test`, `aos_dev`, `C:\AOS\Data`, the `AOS
  Server` task name) are untouched — those are Phases 5-8.
- Deliberately NOT touched, same reasoning as Phase 3: `Docs/Deployment
  Topology.md` and `AOS Production Readiness Master Roadmap.txt` (both
  explicitly deferred to Phase 9's wholesale rewrite),
  `Database/migrations/0033_application_role.sql` (immutable history),
  `Docs/superpowers/plans/*` (historical checkpoint records), and this
  roadmap's own earlier narrative text (historical record of what was
  literally set at the time).
- Verified: `npm run typecheck` clean; `npm test` (655 tests, no DB
  involved) green; grep confirms zero remaining `AOS_[A-Z_]+` outside the
  deliberately-excluded files.
- **Unfold PC `.env` cutover: DONE.** All 19 `AOS_*` keys mirrored to
  `PFO_*` (same values), then the old `AOS_*` lines removed — `.env` is
  now `PFO_*`-only.
- **Task restart: DONE** (2026-09-09, from an elevated session on Unfold
  PC). `Stop-ScheduledTask` alone was confirmed to be a no-op as predicted;
  `taskkill /PID <old PID> /T /F` (PID read from `Backend/supervisor.pid`)
  cleared the stale single-instance lock, then `Start-ScheduledTask`
  brought the full tree back. `Backend/supervisor.log` shows a clean
  fresh-start sequence (storage → mail → api → web, all "healthy"),
  reading the real `aos` database and `C:\AOS\Data` under the new `PFO_*`
  var names with no missing-config errors. Verified live:
  `http://127.0.0.1:4321/api/health/detail` →
  `{"ok":true,"database":"up","storage":"up","mail":"up"}`,
  `http://127.0.0.1:4300` → HTTP 200. Grep confirms zero `AOS_[A-Z_]+`
  references left in `Backend/`, `Frontend/`, `src/`, `Scripts/`, or
  `.env.example`.
- **Home PC's `.env`: DONE** (2026-09-09, reported from the home PC
  session, not independently verified from Unfold PC — no session on
  Unfold PC has access to home PC's filesystem to double-check). `git
  pull` brought home PC to `efef9a3`. All keys home PC's `.env` actually
  defines (14 of them — this file never carried the backup/Gmail keys
  that only apply to the production mail/backup path) renamed from
  `AOS_*` to `PFO_*`, same values, no leftover `AOS_*` lines. `npm run
  migrate` reported running clean against home PC's local dev Postgres
  afterward. `npm run dev` itself was not run/confirmed as of this
  checkpoint — optional further verification, not required for this
  phase to be considered done.
- **Coordination requirement**: `.env` is git-ignored and per-machine. Both
  the home PC's `.env` and Unfold PC's production `.env` must be updated
  to the new var names in the same maintenance window the code ships,
  or the app starts with unset config the moment new code reads
  `PFO_DB_NAME` but the `.env` file still has `AOS_DB_NAME`.
- Risk: MEDIUM. Mechanical but wide blast radius; a missed rename in one
  file (e.g. `free-dev-ports.mjs`, which currently mirrors ports between
  production and dev-on-server-PC) reintroduces the dev/prod port-collision
  risk documented in `CLAUDE.md`.
- Rollback: revert the commit; restore old `.env` var names on both PCs.

---

## PHASE 5 — Database rename (`aos` → `<slug>`)

**STATUS: COMPLETE** (2026-09-09, Unfold Media Corp PC). Slug `pfo`.
Executed live in an ELEVATED session with a human watching, per the timing
decision. **Total outage ≈ 1 minute (16:01:20 → 16:02:2x IST).**

What was done:
- Pre-cutover verified backup `C:\AOS\Backups6-09-09_10-14-59` (1150
  objects, 110 documents / 27.5 MB), plus a freshly captured row-count
  baseline of all 63 public tables taken from `aos` immediately before the
  rename (the checkpoint's transcribed baseline omitted
  `lender_submission_rule|0`, listing 62 entries while correctly stating 63).
- An `npm run dev` stack was found running on this PC (PID 10024, started
  14:01) — not accounted for in the checkpoint. It was confirmed properly
  isolated: loopback-only dev ports 4419/4420/4421/5173 and pointed at
  `aos_dev`, **not** production (proved by hitting its API 25 times and
  watching `pg_stat_database` counters move on `aos_dev` while `aos` stayed
  frozen at 3022 commits). It was stopped before Step 3 so its pool could not
  reconnect to `aos_dev` between `pg_terminate_backend` and `ALTER DATABASE`.
- Elevated `Stop-ScheduledTask` + `taskkill /T /F` on supervisor PID 37584
  took production down cleanly. Elevation was precisely what the previous
  session lacked.
- All five databases renamed, zero backends needing termination:
  `aos`→`pfo`, `aos_test`→`pfo_test`, `aos_e2e`→`pfo_e2e`,
  `aos_dev`→`pfo_dev`, `aos_rehearsal_0035`→`pfo_rehearsal_0035`.
  Sizes unchanged.
- `.env`: exactly one line changed (diff-verified), `PFO_DB_NAME=aos` →
  `PFO_DB_NAME=pfo`. `PFO_DB_USER=aos_app` and `PFO_STORAGE_ROOT=C:\AOS\Data`
  deliberately untouched; `PFO_REQUIRE_DB_NAME` still unset.
- Elevated `Start-ScheduledTask`; the supervisor cleared the stale PID-37584
  lock by itself and came up reporting `database "pfo"`.

Verification — all green:
- `{"ok":true,"database":"up","storage":"up","mail":"up"}`, web HTTP 200,
  employee access live at `http://192.168.0.101:4300`.
- Row counts in `pfo` **identical to the pre-rename baseline across all 63
  tables**; 0001–0037 applied, no CHANGED checksums.
- `Scripts/aos-status.ps1`: every check UP, `database 'pfo'`, document store
  110 files / 27.5 MB.
- Fresh verified backup under the new name:
  `C:\AOS\Backups6-09-09_10-33-16` — 1150 objects, dump checksum
  matches, all 110 documents present and unchanged.

**Test databases — RESOLVED after the cutover.** `pfo_test` had a stale
`0037_practice_cases.sql` (applied 13:54:31, checksum `a3c8311…`) while the
file was edited at 14:08:36 and production applied the current version at
14:10:09 (`6913c52…`); `pfo_e2e` had never received 0037 at all (36 of 37).
That drift predated the cutover by ~2 hours and was unrelated to the rename.
Both databases were dropped and left to rebuild themselves — each suite's
globalSetup creates the database if absent and runs the real migrations.
`npm run test:integration` now passes: **15 files, 215 tests**, against a
freshly migrated `pfo_test`.

**Separate pre-existing issue, NOT a rebrand problem — the e2e suite is
stale.** `npm run test:e2e` rebuilds `pfo_e2e` correctly and the app works
(sign-in succeeds, 13 tests pass, the banner renders the rebranded
"PFONE Premier Finserv One"), but 26 tests fail on one assertion:
`Frontend/src/App.tsx:88` returns `isFounder(session) ? "All Cases" : "My Cases"`,
so Telecaller and Manager now see a `My Cases` nav link while the specs still
expect `All Cases` unconditionally (8 occurrences across 5 spec files). The
nav label became role-dependent in `d7d440c` on **2026-08-18**; the failing
specs were last written **2026-08-11/12**. The suite has therefore been stale
since three weeks before the rebrand began. Fixing it is test maintenance
independent of every rebrand phase.

**Complexity: High — Model: Opus 5 — Effort: High**

- Take a fresh verified backup immediately before starting
  (`npm run backup` then `npm run backup:verify`).
- Stop the `AOS Server` task.
- `ALTER DATABASE aos RENAME TO <slug>;` (simplest — same instance, same
  data, no dump/restore, near-instant) as the admin role, once no
  connections are open (Postgres refuses the rename otherwise:
  `terminate other connections to "aos" first`, or use
  `pg_terminate_backend` after stopping the app).
- Update `AOS_DB_NAME` / `<SLUG>_DB_NAME` in production `.env`.
- Also rename `aos_test`, `aos_e2e`, `aos_dev` to match, and update every
  place that hardcodes those names (`AOS_REQUIRE_DB_NAME` guard in the
  API, `vitest.integration.config.ts`, Playwright config, `CLAUDE.md`'s
  dev-on-server instructions, this session's `aos_dev` guidance).
- Restart the task, run `npm run migrate:status` to confirm the app sees
  the renamed database correctly, then `Scripts/aos-status.ps1`.
- Risk: MEDIUM-HIGH if rushed, LOW if sequenced correctly — `ALTER
  DATABASE RENAME` does not touch the data itself, only the catalogue
  entry, so the real risk is a missed reference to the old name somewhere
  in `.env`/scripts, not data loss. The pre-rename backup is the safety
  net regardless.
- Rollback: `ALTER DATABASE <slug> RENAME TO aos;`, revert `.env`, restart.

---

## PHASE 6 — Storage & backup path rename (`C:\AOS\...` → `C:\PFO\...`)

**STATUS: COMPLETE** (2026-09-09, Unfold Media Corp PC). Done live with the
user watching, per the timing decision. **~3 minutes of downtime**
(16:52–16:55 local / 10:52–10:55 UTC).
**Complexity: High — Model: Opus 5 — Effort: High (max care)**

### What was done

- **Pre-flight SHA-256 manifest** of all of `C:\AOS` — 1,562 files — written
  before anything was touched, so the move could be proven byte-for-byte
  rather than just count-and-size. This is stronger than the file-count check
  this phase originally called for; keep the manifest step for Phase 8's
  folder move.
- **Fresh verified backup first**: `C:\AOS\Backups\2026-09-09_10-53-12`,
  self-verified inline (1150 TOC objects, dump checksum matched, all 110
  document files present and unchanged) plus a separate `npm run backup:verify`
  pass, both green, with the server still up.
- **Server stopped for real**: `Stop-ScheduledTask` followed by
  `taskkill /PID (Get-Content Backend\supervisor.pid).Trim() /T /F` from the
  elevated session — the supervisor plus all four children, then all four
  ports (4300/4321/4319/4320) confirmed free before anything moved.
- **Moved the whole `C:\AOS` tree in one same-volume rename**:
  `Move-Item C:\AOS C:\PFO`. This covered `Data` and `Backups` as the phase
  required, and carried `Dev`, `DrillBackups`, `QA-Data`, `QA-Mail` and
  `RehearsalStorage_0035` with them. Renaming the parent rather than doing
  three separate moves is one operation instead of several, leaves nothing
  half-moved, and lets `C:\AOS` disappear entirely — which is what Phase 9's
  "zero remaining AOS" gate wants. Near-instant, as predicted.
- **The 24 orphaned files (cutover-gate Task 21) are accounted for, not
  resolved**: a move carries them along unchanged, so the pre/post manifest
  proves they are exactly as found. This phase deliberately made no cleanup
  decision about them — that decision is still open and still separate.
- **Integrity proof**: re-hashed the whole tree at `C:\PFO`. All 1,562
  pre-move entries present with **identical SHA-256 and identical size; zero
  missing, zero changed**. The 112 extra files are the fresh backup run taken
  after the manifest.
- **Production `.env`**: `PFO_STORAGE_ROOT=C:\PFO\Data`, and
  `PFO_BACKUP_ROOT=C:\PFO\Backups` **added** — it had never been set, so
  backups were silently relying on the hard-coded default in `backup.mjs`.
  It is now explicit.
- **`AOS Nightly Backup` task action repointed**: its arguments hard-coded the
  log path `C:\AOS\Backups\backup-log.txt`. Left unchanged, the 20:30 run
  would have failed outright (cmd cannot open a log in a directory that no
  longer exists) — a silent loss of that night's backup. Now
  `C:\PFO\Backups\backup-log.txt`; S4U / `RunLevel=Highest` / boot-and-daily
  trigger all preserved and re-verified. The **task name is untouched** —
  that is Phase 7.
- **Code/script/doc defaults repointed** (16 files): `.env.example`,
  `playwright.config.ts` (`C:/AOS/QA-Data`, `C:/AOS/QA-Mail`), `CLAUDE.md`
  (including the dev-session `PFO_STORAGE_ROOT="C:\AOS\Dev\Data"` example,
  which the move made wrong), `Backend/backup.mjs`, `Backend/backup-verify.mjs`,
  `Backend/storage-server.mjs` (`DEFAULT_ROOT`), `Backend/restore-drill.ts`
  (all three drill folder constants **and the safety guard at line 88** that
  compares the drill's targets against the real store — that fallback pointing
  at a stale path was the subtlest hazard in this phase),
  `Backend/restore.mjs`, `Backend/security.test.ts`, `Scripts/aos-status.ps1`,
  `Scripts/register-backup-task.ps1`, `Docs/Disaster Recovery.md`,
  `Docs/Installation.md` (including the `D:\AOS-Backups` different-disk
  example → `D:\PFO-Backups`), `Frontend/README.md`,
  `Frontend/src/fake/storage.ts`, `src/domain/storage/storage-state.test.ts`.
- **Phase 4 remnant found and fixed in production `.env`**: the commented-out
  `AOS_MAIL_CAPTURE_DIR`, `AOS_WHATSAPP_*` and the `AOS_GMAIL_*` prose
  reference had kept the old prefix, because `.env` is not in git and Phase 4
  only renamed tracked files. Uncommenting any of them would have set a
  variable nothing reads. Now `PFO_*`.

### Verification (all run after the move, all green)

- `npm run backup:verify -- --all` — **11 of 12 runs fully verified**. The one
  FAIL is `2026-08-10_12-31-34`, the oldest run, written by an older backup
  with `manifest formatVersion 1` that carries **no checksums at all**; its
  archive is still readable. This is a pre-existing format limitation, not
  move damage — the SHA-256 manifest independently proves that run's bytes are
  identical before and after. Do not read this as a Phase 6 regression.
- `npm run restore-drill` — **16/16 checks passed** against the moved backups
  and the rewritten drill constants, including "restored document bytes match
  the original byte for byte". Disposable databases and folders cleaned up.
- `Scripts/aos-status.ps1` — every line UP; document store reported as
  `C:\PFO\Data - 110 file(s), 27.5 MB`.
- Live storage server `/health` and `/config` both report root `C:\PFO\Data`.
- **Real document download**: an existing customer PDF fetched through the
  running storage server, 46,376 bytes, matching its on-disk size exactly.
- **Upload/download round trip**: PUT then GET of a temp object under
  `case/_phase6-verification/`, content identical on return, then deleted —
  store back to exactly **110 files / 28,881,771 bytes**, the pre-move figure.
- `npm run typecheck` clean; `vitest run src/domain/storage` 20/20 passed.

### Deliberately NOT changed

Same reasoning as Phases 3 and 4 — these still say `C:\AOS\...` on purpose:

- `Docs/Deployment Topology.md` and `AOS Production Readiness Master
  Roadmap.txt` — both explicitly deferred to Phase 9's wholesale rewrite.
- `Database/migrations/0033_application_role.sql` — applied migration, treated
  as immutable history.
- `Backend/supervisor.log` — a log. It records where the storage root actually
  was at the time; rewriting it would be falsifying a record.
- `Docs/Session Checkpoint.md` and `Docs/superpowers/plans/*` — historical
  checkpoint records.
- This roadmap's own earlier-phase narrative — historical record of what was
  literally true then.

### Outstanding

- **Home PC `.env` not updated** — same situation as Phase 4, which needed a
  separate pass on that machine. Its `PFO_STORAGE_ROOT` still points at
  whatever local disposable folder it used; if that was `C:\AOS\...` on that
  machine it must be repointed there before its next `npm run dev`. Nothing on
  the home PC holds real documents, so this is a dev-convenience fix, not a
  data risk.
- `C:\PFO\DrillBackups` was kept deliberately, as the artefact proving the
  drill ran (the drill's own behaviour, unchanged).

### Rollback (unused, recorded for completeness)

`Move-Item C:\PFO C:\AOS`, revert `PFO_STORAGE_ROOT` and drop the new
`PFO_BACKUP_ROOT` in `.env`, revert the `AOS Nightly Backup` task argument,
restart the task. The verified backup taken at the top of the window is the
fallback if the move itself had been interrupted.

---

## PHASE 7 — Scheduled task rename

**STATUS: COMPLETE** (2026-09-09, Unfold Media Corp PC). Executed live in
an ELEVATED session with a human watching. **~1 minute of downtime**
(11:07 UTC window, matching the Phase 5/6 pattern) while the supervisor
tree restarted under the new task.
**Complexity: Medium — Model: Sonnet 5 — Effort: Medium**

What was done:
- Updated the default `$TaskName` in `Scripts/register-aos-services.ps1`
  (`AOS Server` → `PFO Server`) and `Scripts/register-backup-task.ps1`
  (`AOS Nightly Backup` → `PFO Nightly Backup`), plus every reference to
  those task names in their own doc comments, `Scripts/aos-status.ps1`,
  `Backend/supervisor.mjs`'s stop-instructions message, `CLAUDE.md`,
  `Docs/Installation.md`, and `Docs/Disaster Recovery.md` — 8 files.
  Deliberately left `Docs/Deployment Topology.md`, `AOS Production
  Readiness Master Roadmap.txt` (both deferred to Phase 9), and
  `Docs/superpowers/plans/*` (historical checkpoints) untouched, same
  reasoning as every prior phase.
- Registered `PFO Server` with `register-aos-services.ps1 -WhatIf` first,
  then for real. Verified its `Principal` (S4U / Highest), trigger
  (`MSFT_TaskBootTrigger`), action (identical `cmd.exe` wrapper, same
  `node`/`supervisor.mjs`/log paths), and settings (`MultipleInstances
  IgnoreNew`, no execution time limit) match the golden `AOS Server`
  config transcribed into this file — byte-for-byte on every field that
  matters. Registering a new task under a boot trigger did not start it
  immediately (confirmed `State: Ready` right after registration), so the
  old task kept serving with no overlap risk.
- Cutover: `taskkill /PID <old PID> /T /F` on the `AOS Server` supervisor
  (`Stop-ScheduledTask` alone confirmed a no-op again, as in Phase 5),
  confirmed ports 4300/4321/4319/4320 free, then `Start-ScheduledTask
  -TaskName "PFO Server"`. New PID came up clean — `supervisor.log` shows
  the same storage → mail → api → web healthy sequence — and
  `/api/health/detail` returned `{"ok":true,"database":"up","storage":"up","mail":"up"}`
  with web HTTP 200 within seconds.
- Registered `PFO Nightly Backup` the same way (`-WhatIf` then for real),
  confirmed it targets `C:\PFO\Backups` at 20:30 daily — matching the
  already-live `PFO_BACKUP_ROOT`. Ran it immediately rather than waiting
  for tonight: `Start-ScheduledTask -TaskName "PFO Nightly Backup"`
  produced a fresh self-verified backup
  (`C:\PFO\Backups\2026-09-09_11-08-17`, 1150 TOC objects, dump checksum
  matched, all 110 documents present/unchanged), and a separate `npm run
  backup:verify` pass confirmed the same run independently.
- `Scripts/aos-status.ps1` (already updated to look for the new names)
  reports everything UP: web/API/storage/mail, `PFO Server` Running,
  `PFO Nightly Backup` Ready with a clean last run, document store 110
  files / 27.5 MB, backup 0h old.
- Old tasks kept, not deleted, per the roadmap's own caution: `AOS Server`
  and `AOS Nightly Backup` are now `Disabled` (not removed) as a
  fallback for one verification cycle. Delete them once the new tasks
  have survived a real reboot and the next scheduled 20:30 backup run.

### Outstanding

- **Reboot verification: DONE (2026-09-09, 16:45).** Unfold PC rebooted;
  `aos-status.ps1` afterward showed `PFO Server` auto-started cleanly via
  its `BootTrigger` with no manual intervention — `Running`, result code
  `267009` (`SCHED_S_TASK_RUNNING`, the expected code for an active
  boot-triggered task, not an error). Web/API/storage/mail/Postgres all
  UP, document store intact (110 files, 27.5 MB).
- **Tonight's 20:30 scheduled run of `PFO Nightly Backup` not yet
  observed** — today's verification was a manual `Start-ScheduledTask`,
  not the trigger firing on its own. Check `C:\PFO\Backups\backup-log.txt`
  tomorrow morning.
- Once the backup trigger is confirmed, remove the disabled `AOS Server`
  / `AOS Nightly Backup` tasks: `Unregister-ScheduledTask -TaskName "AOS
  Server" -Confirm:$false` (and the backup equivalent).

### Rollback (unused, recorded for completeness)

Re-enable and start the disabled `AOS Server` task, stop `PFO Server` the
same way (`taskkill` on its supervisor PID, `Stop-ScheduledTask` alone is
a no-op), confirm health. Same for the backup task pair.


**Exact verified `AOS Server` config** — captured live 2026-09-09 from the
task as it was running healthily after the Phase 5 cutover. Ported here from
`Docs/Premier Finserv Phase 5 CHECKPOINT.md` before that file was deleted;
the new task must reproduce every one of these:

```
UserId             : ADMIN
LogonType          : S4U
RunLevel           : Highest
Trigger            : MSFT_TaskBootTrigger
Execute            : cmd.exe
Arguments          : /c ""C:\Program Files
odejs
ode.exe" "…\AOS\Backend\supervisor.mjs" >> "…\AOS\Backend\supervisor.log" 2>&1"
WorkingDirectory   : C:\WORK FILES\Amaze Loans Pvt Ltd\AOS
MultipleInstances  : IgnoreNew
ExecutionTimeLimit : PT0S
```

Two operational notes learned during the Phase 5 cutover, both of which apply
to any future restart of this task:
- `Stop-ScheduledTask` alone is a **no-op** against the running supervisor
  tree — the task flips to `Ready` while the supervisor and its four children
  keep serving. Stopping it for real needs
  `taskkill /PID (Get-Content Backend\supervisor.pid).Trim() /T /F`.
- Because of `MultipleInstances: IgnoreNew`, that `taskkill` is also what
  clears the stale single-instance lock; on the next `Start-ScheduledTask` the
  supervisor logs `clearing a stale lock from PID <old>` and starts cleanly.
- Both commands require an **elevated** session (S4U / `RunLevel=Highest`);
  a non-elevated session gets `Access is denied` on every child.

---

## PHASE 8 — Repository & local folder rename

**STATUS: COMPLETE** (2026-09-09, Unfold Media Corp PC). Open Decision #3
resolved as "bundle now" — GitHub rename and local folder rename done
together in one pass.
**Complexity: Medium — Model: Sonnet 5 — Effort: Medium**

What was done (Unfold PC):
- GitHub repo renamed `tarunrameshphotography/AOS` → `tarunrameshphotography/pfo`
  via `gh repo rename pfo` (GitHub auto-redirects the old URL).
- Unfold PC's `origin` remote updated to
  `https://github.com/tarunrameshphotography/pfo.git`; `git fetch` confirmed
  it resolves and is up to date with `main`.
- `PFO Server` supervisor tree stopped (`taskkill /PID <supervisor> /T /F`,
  same pattern as Phase 5/7 — `Stop-ScheduledTask` alone doesn't kill the
  process tree), ports 4300/4321/4319/4320 confirmed free.
- Local folder copied `...\Amaze Loans Pvt Ltd\AOS` → `...\Amaze Loans Pvt
  Ltd\PFO` (`robocopy /E`, 721 dirs / 7167 files / 155.85 MB, 0 failed) —
  copied rather than renamed in place, because this Claude Code session's
  own working directory was pinned to the `AOS` folder and held a handle
  on it that blocked an in-place `Rename-Item`/`Remove-Item`. `.git`,
  `.env`, and `node_modules` all copied intact — no reinstall needed.
- `Scripts/register-aos-services.ps1` and `Scripts/register-backup-task.ps1`
  re-run from the new `PFO` location (`$RepoRoot` is derived from
  `$PSScriptRoot` at registration time, so this re-points each task's
  `Action`/working directory to the new path). Both tasks confirmed via
  `-WhatIf` first, then registered for real.
- `PFO Server` started from the new path: `aos-status.ps1` showed
  everything UP (web/API/storage/mail/Postgres, employee LAN access,
  firewall rule). `PFO Nightly Backup` run manually and verified
  (`backup-log.txt` shows a fresh checksummed backup, 110/110 documents
  present and unchanged) rather than waiting for tonight's 20:30 trigger.
- Old disabled `AOS Server` / `AOS Nightly Backup` tasks (kept as Phase 7
  fallback) unregistered now that the renamed tasks are proven working
  from the new path — closes out that Phase 7 outstanding item too.

### Outstanding

- **Old `...\Amaze Loans Pvt Ltd\AOS` folder still on disk, not deleted.**
  `Remove-Item` failed with "in use" — this Claude Code session's own cwd
  was rooted there for the whole conversation and Windows won't let a
  directory be deleted while any process (including this session's shell)
  has it as a working directory. Content is an exact copy of what's now
  live at `PFO`, so it is safe to delete once this session (and any other
  process/terminal/editor with a window open under that path) is closed:
  ```powershell
  Remove-Item -LiteralPath "C:\WORK FILES\Amaze Loans Pvt Ltd\AOS" -Recurse -Force
  ```
- **Home PC not yet updated** (out of reach from this session — dev-only
  machine, not touched here). On home PC:
  1. Close any terminal/editor with the old `AOS` folder open.
  2. `git remote set-url origin https://github.com/tarunrameshphotography/pfo.git`
     (run inside the existing folder first, before moving it, so the
     `.git` config updates while the path is still valid).
  3. Rename (or robocopy + delete) `...\Amaze Loans Pvt Ltd\AOS` →
     `...\Amaze Loans Pvt Ltd\PFO`. Home PC runs no scheduled task
     against this path, so there's no task Action to re-point — this is
     just a folder rename, lower risk than the Unfold PC side.
  4. Re-open the project from the new `PFO` path; `npm run dev` (with the
     usual dev-only env overrides) should work unchanged since nothing
     inside the repo hardcodes the old absolute path.
- Risk realized: MEDIUM as predicted for the server-PC folder move, but
  the actual failure mode was different than anticipated (session cwd
  lock, not the running task) — worked around with a copy instead of an
  in-place rename with no data loss.

---

## PHASE 9 — Final verification / rebrand-complete gate

**STATUS: COMPLETE (2026-09-09, Unfold Media Corp PC). REBRAND COMPLETE.**
**Complexity: Medium-High — Model: Opus 5 — Effort: High**

### Gates — all green

- `npm run typecheck`, `npm test`, `npm run test:integration`,
  `npm run backup:verify` — all PASS, run twice: once before this phase's
  text sweep and again after it, so the sweep is proven not to have broken
  anything.
- `Scripts/pfo-status.ps1` (renamed this phase) — every line UP: Postgres
  service and port on database `pfo`, web 4300, API 4321, storage 4319,
  mail 4320 able to send, employee access `http://192.168.0.101:4300`,
  firewall rule, `PFO Server` Running, `PFO Nightly Backup` Ready (result
  0), document store `C:\PFO\Data` 110 files / 27.5 MB, last backup 0.2h
  old with 14 runs retained.
- `/api/health/detail` → `{"ok":true,"database":"up","storage":"up","mail":"up"}`;
  web root HTTP 200 over the LAN address.
- **Real document upload/download round trip**: PUT then GET of
  `case/_phase9-verification/probe.txt` through the live storage server —
  content byte-identical on return. Probe and its `.meta.json` sidecar
  deleted afterward; store back to exactly **110 files / 28,881,771 bytes**,
  identical to the Phase 6 figure.
- **Real employee login**: confirmed working in the browser by the user
  (not automated — no session here uses a real employee's password).

### Changes made this phase

- **Old `...\Amaze Loans Pvt Ltd\AOS` folder deleted** by the user, closing
  Phase 8's outstanding item. Confirmed gone from disk.
- **npm package name** `"aos"` → `"pfo"` (`package.json`, `package-lock.json`).
- **Prose sweep, whole-word `AOS` → `PFO`, 45 code files + every live doc**
  (`CLAUDE.md`, `README.md`, `Database/README.md`, `Frontend/README.md`,
  `Docs/Installation.md`, `Docs/Disaster Recovery.md`,
  `Docs/Email and WhatsApp Integration.md`,
  `Docs/Document Requirement Engine.md`, `Docs/Deployment Topology.md`,
  `PRD/*.md`, `.env.example`). This is the cleanup Phase 3 deliberately
  deferred: comments calling the system "AOS" were left alone then because
  the package, database, paths, tasks and repo were still literally `AOS`.
  Phases 4–8 have now landed, so the comments are correct again.
- **Script filenames renamed** (`git mv`, references updated repo-wide):
  `aos-status.ps1` → `pfo-status.ps1`,
  `register-aos-services.ps1` → `register-pfo-services.ps1`,
  `aos-lan-address.ps1` → `pfo-lan-address.ps1`. Safe: the scheduled tasks
  invoke `node`/`supervisor.mjs` directly, not these scripts.
- **Windows firewall rule renamed** `AOS web (4300)` → `PFO web (4300)`,
  in step with `pfo-status.ps1` now looking for a `PFO*` rule. Verified
  live by the status script.
- **`Docs/Deployment Topology.md`** rewritten to the new names throughout,
  including the two "Amaze Loans" prose references (the office, and the
  mail-server warning about who email is sent as).
- **`AOS Production Readiness Master Roadmap.txt` renamed to
  `PFO Production Readiness Master Roadmap.txt`** and its contents updated;
  the reference to it in `Milestones.txt` updated to match.
- **`aos_recovery`** (the disposable restore-drill database named in
  `Docs/Disaster Recovery.md`) → `pfo_recovery`; **`aos.office.local`** →
  `pfo.office.local`.

### Deliberately kept — explicit decisions, not oversights

The gate asks for these calls to be made out loud rather than silently:

1. **`aos_app` — the live Postgres role.** 24 references across
   `.env.example`, `.env`, `Backend/db.ts`, `db-config.mjs`,
   `bootstrap-production.ts`, `seed-users.ts`, the security test suites,
   `vitest.integration.config.ts` and `Docs/Installation.md`. Renaming a
   role that owns grants, column masks and RLS policies across migrations
   0002/0033/0034/0036/0037 is a Phase-5-class production database
   operation with real downtime risk, and it buys nothing a user or a bank
   ever sees. **Deferred as its own future task, not folded into a
   verification gate.**
2. **`aos.dump` — the filename inside every backup run.** `backup.mjs`
   writes it, `backup-verify.mjs` and `restore.mjs` read it, and it is
   recorded in the manifest of all 14 retained runs. Renaming it would make
   existing verified backups unverifiable without a compatibility shim.
   Kept so the disaster-recovery path stays simple and proven.
3. **`aos.token` — the browser sessionStorage key.** Changing it silently
   signs out every employee mid-day for no functional gain.
4. **`aos-fade-up` / `aos-animate-in` / `aos-pop-in` — CSS animation
   identifiers** in `Frontend/src/index.css` and `Frontend/src/ui/index.tsx`.
   Invisible to users, and changing them requires a frontend rebuild and a
   production web-server restart — downtime for a cosmetic rename.
5. **`aos`, `aos_production`, `aos_prod` in `tests/support/e2e-environment.ts`'s
   forbidden-database list.** Retained on purpose, as that file's own
   comment explains: a backup restored under the old name is still real
   customer data. Verified that `pfo`, `pfo_production`, `pfo_prod` are
   listed alongside them.
6. **History, left as written**: `Database/migrations/*.sql` (applied,
   immutable), `Backend/supervisor.log` (a record of what was true when it
   ran — also locked by the running supervisor), `DECISIONS.md`,
   `Milestones.txt`, `Docs/Session Checkpoint.md`,
   `Docs/superpowers/plans|specs/*`, `playwright-report/*` (generated),
   `future unseen potential.txt`, and this roadmap's own Phase 0–8
   narrative.

### Outstanding (not blocking the gate)

- **Home PC** still needs its own pass: `.env` `PFO_STORAGE_ROOT` repoint
  (Phase 6), folder rename `AOS` → `PFO` and `git remote set-url` (Phase 8).
  Dev-only machine, no real customer data — see Phase 8's step list.
- **`C:\WORK FILES\Amaze Loans Pvt Ltd\`** — the parent folder still carries
  the dissolved entity's name. Renaming it moves the working directory both
  PCs use and the `PFO Server` / `PFO Nightly Backup` task actions, so it is
  a deliberate separate operation, not part of this gate.
- **The e2e suite remains stale** — 26 failures on the `All Cases` /
  `My Cases` nav assertion, pre-dating the rebrand by three weeks (see
  Phase 5). Test maintenance, unrelated to any rebrand phase.
- `aos_app` role rename (decision 1 above), if it is ever judged worth a
  downtime window.

---

## Sequencing note

Phases 2 and 3 have no dependency on the slug decision and no downtime —
they can start immediately once the sender-name/description text is
confirmed. Phases 4 through 8 depend on the slug decision and should
happen together, in slug order (env vars before DB before storage before
tasks before repo/folder), each verified before the next starts, because
each later phase's `.env` values depend on the earlier phase already being
live and correct.
