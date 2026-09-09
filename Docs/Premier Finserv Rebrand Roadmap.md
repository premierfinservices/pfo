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

**STATUS: CODE SIDE COMPLETE, CUTOVER NOT YET DONE** (2026-09-09). Slug
confirmed: `pfo`. Ran on Unfold Media Corp PC (the production server).
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
- **NOT YET DONE — the actual cutover**: production `.env` on Unfold PC
  still has the old `AOS_*` names (unchanged — editing it is the live,
  hard-to-reverse-if-mishandled step, held for explicit go-ahead), the
  `AOS Server` task has not been restarted, and the home PC's `.env` was
  not reachable from this session at all. Until `.env` on both machines is
  updated to `PFO_*` and the task restarted, production keeps running on
  the pre-Phase-4 checkout — `Backend/env.mjs` only fills in vars not
  already set, so the old `.env` file's `AOS_*` keys are simply not read
  by the new code's `PFO_*` lookups, meaning **the current running
  process must not be restarted onto this commit until `.env` is updated
  in the same window**, or it starts with unset config.
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

**STATUS: NOT STARTED.** Blocked on: slug decision, timing decision.
**Requires a downtime window.**
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

## PHASE 6 — Storage & backup path rename (`C:\AOS\...` → `C:\<Slug>\...`)

**STATUS: NOT STARTED.** Blocked on: slug decision, timing decision.
**Requires a downtime window. Handles real customer documents — highest
care of any phase.**
**Complexity: High — Model: Opus 5 — Effort: High (max care)**

- Fresh verified backup first (same as Phase 5 — can be the same
  maintenance window).
- Stop the `AOS Server` task and confirm no process still has
  `C:\AOS\Data` open (Task 21 in the cutover gate already flagged 24
  orphaned files here — resolve or account for those before moving the
  folder, not after).
- Move (not copy-then-delete) `C:\AOS\Data` → `C:\<Slug>\Data` and
  `C:\AOS\Backups` → `C:\<Slug>\Backups`.
- Update `AOS_STORAGE_ROOT` / `AOS_BACKUP_ROOT` in production `.env`.
- Verify file count and total size match before/after
  (`Scripts/aos-status.ps1` already reports both).
- Run `npm run backup:verify` against the moved backup directory to prove
  nothing broke.
- Restart the task, confirm document upload/download still works.
- Risk: HIGH if the move is interrupted mid-way or done while the storage
  server still has the old path open. LOW if sequenced as above — this is
  a filesystem move on the same drive (near-instant, not a slow copy) with
  a verified backup as the fallback.
- Rollback: move the folders back, revert `.env`, restart.

---

## PHASE 7 — Scheduled task rename

**STATUS: NOT STARTED.** Blocked on: slug decision.
**Requires an ELEVATED PowerShell session** (this session could not
self-elevate — same limitation noted in the production cutover gate).
**Complexity: Medium — Model: Sonnet 5 — Effort: Medium**

- Re-run `Scripts/register-aos-services.ps1` (or its renamed successor)
  under the new task name(s), pointed at the renamed `.env`/paths from
  Phases 4–6.
- Confirm the new task has the same `BootTrigger` / `RunLevel=Highest` /
  S4U configuration verified for the current `AOS Server` task before
  removing the old one.
- Remove the old `AOS Server` / `AOS Nightly Backup` tasks only after the
  new ones are confirmed working — don't delete-then-create.
- Risk: LOW-MEDIUM — if the new task fails to register correctly and the
  old one is already removed, the server won't survive a reboot until
  fixed. Keep the old task disabled-but-present as a fallback for one
  verification cycle rather than deleting it immediately.

---

## PHASE 8 — Repository & local folder rename

**STATUS: NOT STARTED.** Blocked on: Open Decision #3 (bundle or defer).
**Complexity: Medium — Model: Sonnet 5 — Effort: Medium**

- GitHub repo rename (`tarunrameshphotography/AOS` → new name) — GitHub
  auto-redirects the old URL, low risk on its own, but both PCs' local
  `git remote` URLs should be updated to the new URL rather than relying
  on the redirect indefinitely.
- Local folder rename on both PCs (`...\Amaze Loans Pvt Ltd\AOS` → new
  path) — must be done with the `AOS Server` task stopped on Unfold PC
  (the task's registered Action points at an absolute path in the current
  folder; moving the folder out from under a running task breaks it), then
  the task's Action re-pointed at the new path (ties to Phase 7).
- Risk: LOW for the GitHub side, MEDIUM for the local folder move on the
  server PC specifically (same "don't move a path a running task depends
  on" risk as Phase 6, smaller blast radius).

---

## PHASE 9 — Final verification / rebrand-complete gate

**STATUS: NOT STARTED.**
**Complexity: Medium-High — Model: Opus 5 — Effort: High**

- Re-run the grep inventory from Phase 0; confirm zero remaining
  "AOS"/"Amaze Loans" hits outside anything deliberately kept (e.g. if a
  historical ADR number or ADR-018/BR-051 style codes are judged fine to
  keep as-is — that's a call to make explicitly here, not silently).
- Full `Scripts/aos-status.ps1` (or its renamed equivalent) green.
- `npm run typecheck`, unit + integration suites green under the renamed
  database.
- `npm run backup:verify` green under the renamed paths.
- A real employee login and one real document upload/download, post-move.
- Update `AOS Production Readiness Master Roadmap.txt` and
  `Docs/Deployment Topology.md` to reflect the new names throughout (they
  still say `aos`/`AOS`/`C:\AOS\...` even after Phases 4–8 land, until this
  phase touches them).

---

## Sequencing note

Phases 2 and 3 have no dependency on the slug decision and no downtime —
they can start immediately once the sender-name/description text is
confirmed. Phases 4 through 8 depend on the slug decision and should
happen together, in slug order (env vars before DB before storage before
tasks before repo/folder), each verified before the next starts, because
each later phase's `.env` values depend on the earlier phase already being
live and correct.
