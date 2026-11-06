# Resume on the Home PC

Written 30 October 2026 for a Claude session (or a person) that has **no memory of the work below**. Read this first, then the files in "Read in this order". Everything you need is in this repository; nothing depends on the chat that produced it.

> **This repository is public.** Never commit `.env`, passwords, API keys, customer names, mobile numbers, documents, or anything from the real `pfo` database. If a note needs a credential, say where it lives, not what it is.

## What this is, in five lines

- PFO is Premier Finservices' loan operating system. Mint Capital Management (MCM) and Premier Finservices are **one office with one process**.
- MCM already runs on an Excel workbook, the **MIS** (`MIS.xlsm`). It is more automated than PFO was: every action leaves a next action.
- The goal, set by Tarun Ramesh (Manager of both firms): **PFO replaces the MIS and is as automated as it.** We copy the MIS's behaviour into PFO. There is no live sync with Excel.
- The MIS stays the working system until its data is imported (step 4 below). Tarun says "go live" when he is ready.
- Tarun is the decision maker. He prefers a straight assessment to validation, wants decisions recorded with reasons, and treats "unknown" as a valid answer. Do not invent numbers, rules or dates.

## Checkpoint, 6 November 2026 (read this first; it overrides the older status below)

Decisions: ADR-047 to ADR-050. Migrations run through 0054; the next number is 0055.

| What | State |
|---|---|
| **MIS sync fixed** (ADR-047). From 3 Nov 14:30 to 6 Nov every run failed, because MCM-0036 has three real disbursements and BR-022 allowed one | **Live** since 6 Nov 15:05. Migration 0053 applied. Every MIS case is in scope now, Active and Archived, any date (40 cases; MCM-0027 still excluded). Each case is its own savepoint. Every run is recorded in `mis_sync_run`. Exit codes: 0 clean, 2 kept with issues, 1 nothing kept |
| Sync-failure banner, Update Case as the only case screen (ADR-048), documents the MIS way with the co-applicant question (ADR-049), prototype store removed and one home screen (ADR-050) | **On `main`, not yet live.** Needs migration 0054 and an elevated restart with a fresh build (below) |

**To make the rest live** (Unfold PC, elevated PowerShell):
1. Stop the `PFO Server` task.
2. `npm run migrate`. This applies 0054 if it is not already applied.
3. `npm run build`.
4. Start the `PFO Server` task.

Then sign in and open a case. Do not run the build before the restart: the new screens call API routes the running server does not have yet.

**Open, for Tarun**
- MCM-0023 is skipped on every run because telecaller EMP-004 has no PFO login. Either create the login or exclude the case.
- FU-00112 has no responsible employee in the MIS.
- APP-0007 and APP-0029 were deleted from the MIS, so PFO marked them withdrawn.
- The backend routes only the old Case Detail screen used are still in the API (ADR-048). Removing them means rewriting most of the integration tests' fixtures.
- Seven end-to-end tests that drove Case Detail are suspended, and need rewriting for Update Case. **Never run Playwright on this PC** until you have checked that `playwright.config.ts` points the API at unused storage and mail ports. It now does; before 6 Nov it fell back to production's.
- Rewriting the superseded PRDs (they now carry a banner) is still open.

## Checkpoint, 2 November 2026 (read this first; it overrides the older status below)

`main` is at the commit that adds this section, pushed to `origin`. Running on the Unfold Media Corp PC. Migrations are applied through 0052; the next number is 0053. Decisions: ADR-045 (firm field) and ADR-046 (sync and reports).

| Step | What | State |
|---|---|---|
| 1 | Log a Case, Update Case, MIS stages, tasks, checklists | Live |
| 2 | Document drop: dedupe, rename, open zips | Live. Reading unnamed files is off: Tarun will not pay for an API account, and local OCR is parked (`Docs/Local OCR Design.md`). Files arrive already named by `organize` |
| 3 | GST and ITR summary | Live. It reads the `GST and ITR Summary.txt` that `organize` writes; PFO does not work the figures out itself. Files with several filers show the original text |
| 4 | Firm field, MIS sync, MIS reports | Live, built 2 Nov 2026 |

**While the MIS and PFO both run**

- The MIS is the source for MCM. Task `PFO MIS Sync` copies cases Active in the MIS with a lead date from 13 Oct 2026, every 30 minutes from 08:00 to 21:00. Log: `C:\PFO\Logs\mis-sync.log`. Nothing alerts on failure, so check the log if PFO looks out of date.
- Currently 14 cases, 19 applications, 31 tasks. Synced cases refuse edits in PFO except document uploads. A re-run overwrites them from the MIS.
- By hand: `npm run mis:sync` is a dry run that rolls back; add `-- --apply` to keep it. `-- --go-live` hands the cases to PFO for good, and only Tarun says when.
- Every case is MCM (Tarun, 2 Nov 2026). Log a Case still asks for the firm.
- PF-2026-00001 and MCM-0020 are the same customer and stay separate by Tarun's decision. The first holds the uploaded documents. Each sync names the pair and changes neither.

**Checked on 2 Nov 2026.** 239 values compared row by row with the MIS, all matching (one flagged difference was the checker reading a blank amount as 0). 12 Dashboard figures matched over all MIS rows; the disbursement ones were 0 for that period, so only tests cover those definitions. Reports and Update Case were opened in a browser on a restored rehearsal copy, not on production.

**Tests.** Three integration failures, none from this work: two in `Backend/api.test.ts` expect `AL-` case numbers, and `Backend/supervisor.test.ts` cannot find openssl on this PC. To run integration tests in a worktree, junction `node_modules` to the main folder's and pass the database login through the environment. `Backend/migrate.mjs` refuses to run from a worktree because line endings change the checksums, so migrate from the main folder.

**Open, for Tarun**

1. Go-live for MCM, and whether the 8 older Active MIS cases come across. Nothing is built for them yet.
2. Change the weak temporary passwords on the 9 live accounts, managers first.
3. Confirm the certificate warning has gone in Brave, and try the Reports screen on production.
4. The stage badge (a derived status line is recommended), the "mark documents Complete?" prompt, why a case gets two GST rows for one month, and a per-filer switch for several-filer summaries.

**Housekeeping.** Merged worktrees under `.claude/worktrees/` can be removed. Each has a `node_modules` junction, so remove the junction first or the shared folder is at risk. The scratch database `pfo_rehearsal_0049` and `C:\PFO\RehearsalStorage_0049` can go too.

**Pushing from this PC.** Git cannot show a sign-in prompt from Claude's shell. `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main` uses the GitHub CLI login for that one command.

## Added 3 Nov 2026 (read with the checkpoint above)

- **MCM-0027** stays in the MIS and never comes to PFO (`MIS_SYNC_EXCLUDED`), by Tarun's decision.
- **A summary for another business** now shows a warning on the case, and a wrongly filed document or summary can be retired. A name spaced differently counts as the same business. A file with a summary per filer passes if any filer is a name on the case.
- **GSTR-1, 2A and 9 files in the GST folder** are no longer taken for a month of GSTR-3B. This was the cause of two GST rows for one month. Cases uploaded before the fix still hold the old rows; on one live case the GSTR-1 files sit under "GSTR-3B <month>" names. They need retiring and re-uploading by a person, not a script.
- **Status line** beside the stage badge on Update Case (`src/domain/work/status-line.ts`): where the lenders have the file, derived, never moves the stage. **"Mark documents Complete?"** is a suggestion only.
- **Per-filer switch** on the GST & ITR summary when a file holds one summary per filer. An ITR-only file with per-person blocks and no GST still shows the original text.
- **MCM go-live** is designed, not run: `Docs/MCM Go-Live Design.md`. Waiting on Tarun (the 8 older cases, the freeze time).
- **Local OCR** stays parked (`Docs/Local OCR Design.md`).
- Next migration number is still 0053. The two `AL-` tests in `Backend/api.test.ts` now expect `PF-`.

## Where things stood on 30 Oct 2026 (history)

| Step | What | State |
|---|---|---|
| 1 | Log a Case, Update Case, MIS stages and lender statuses, tasks, short checklists, the "Next:" line, MIS lender and place lists, upload by file name | Built and tested. **Applied to production on 30 Oct 2026** (migrations 0044 to 0047) |
| 2 | Document drop: read unnamed scans by content (Anthropic API), dedupe by content hash, rename to standard names, open zip | Built and tested. Applied (migration 0048). ADR-041. **Off until `PFO_ANTHROPIC_API_KEY` is set**; without it unnamed files land in Other Document. RAR and 7z are reported, not opened, by choice |
| 3 | PFO works out GST and ITR figures itself | **Not started.** PFO only shows the `GST and ITR Summary.txt` that Tarun's desktop `organize` skill wrote |
| 4 | MIS reports and drill-downs, MCM data import, a firm field (MCM or Premier) on each case | **Not started** |

Production: `main` is at or after `8a42b93`, migrated to 0048, running on the Unfold Media Corp PC. After the migration the server was verified healthy and no data was lost, but **nobody has yet signed in and clicked through the new screens in a browser**. That is the first thing to ask Tarun about.

Tests at last run (Home PC, 30 Oct evening): unit 751/751; integration 302/306. The 4 failures are not from this work. Two predate it: `Backend/api.test.ts` still expects `AL-` case numbers after the rebrand to `PF-`. Do not "fix" them by accident; it is a small separate job. The other two are environmental on the Home PC: the `customers` test fails once `pfo_test` has filled up (drop and rerun), and `migrate-import-side-effect` fails because `core.autocrlf=true` puts a CR after the `#!` line of `Backend/migrate.mjs` (a `.gitattributes` with `*.mjs text eol=lf` would fix it; not done).

## Added the evening of 30 Oct 2026 (Home PC): apply this on the Unfold PC first

Two new migrations, **not yet applied to production**:

- **0050 fixes a live bug.** 0045 added columns to `submission`, but 0034 had made `aos_app`'s read access column-by-column, so `aos_app` could not read them. If the production server runs as `aos_app` (check `PFO_DB_USER` in the Unfold PC's `.env`), **Log a Case and Update Case return 500 (`permission denied for table submission`) until 0050 is applied.** `Backend/app-role-column-grants.test.ts` now fails if any masked table gains a column `aos_app` cannot read. Every earlier work test ran as the superuser and could not see this.
- **0049 lets a telecaller send their own case's file to lenders** (ADR-042). Sending only: moving a lender's status is still the login desk's. `Backend/role-grants-drift.test.ts` checks the migrated database against `roles.ts`, which the 0008 snapshot test cannot.

Deploy as in "How a change reaches production", including a backup and a rehearsal on a restored copy. After it, sign in as a telecaller on a practice case: log a case, then send it to a lender.

Decisions Tarun made on 30 Oct (details in the open-decisions list below): telecallers may send files (done); AI reading is to be replaced by local OCR, **design not yet written** (recommended: `tesseract.js` plus a PDF renderer from npm, no install on the server; Tamil to be confirmed; this replaces the reading part of ADR-041); he handles the offsite backup and the shared password himself; the three superseded PRDs are to be rewritten keeping what still applies.

## Read in this order

1. `CLAUDE.md` (repo root): project rules, and the rule about which PC you are on.
2. `Docs/Which PC Is This.md`: run the check **before anything else**.
3. `PRD/Intake and Work Engine.md`: the approved spec for steps 1 to 4. Part 9 lists what is deliberately not built yet.
4. `DECISIONS.md`: **ADR-040** (the whole intake and work engine) and **ADR-041** (document drop). They say what they reverse.
5. `PRD/reference/MCM MIS Master Context.md`: the MIS's own project notes, copied from the MIS folder. This is the source for how the MIS behaves and why. Much of it is Excel build history (VBA, COM, backups, SHAs) and is **not** relevant to PFO; the parts that are: the "Quick-entry forms" section (Log a Case, Update Case rules), "Edit a Case", "Business rules learned", the lender and place sections, and "Design in one paragraph".
6. `Backend/work.test.ts`: the MIS's test scenarios rewritten as PFO tests. "As automated as the MIS" means this file passes. Read it to see the intended behaviour in executable form.
7. `src/domain/work/` (pure rules: `rules.ts` decides what each action leaves to do; `file-names.ts` and `standard-names.ts` for the document drop) and `Backend/work.ts` (the Postgres wiring).

Old documents that now describe a **superseded model** and have not been rewritten: `PRD/Requirements and Progress.md`, `PRD/Loan Lifecycle.md`, `PRD/Workflow.md`. ADR-040 says they are superseded. Trust the ADR and the Intake and Work Engine spec over them. Rewriting them is open work.

## What is not in the repository (and where it is)

| Thing | Where | Why not here |
|---|---|---|
| `MIS.xlsm` | Unfold PC, `C:\WORK FILES\Mint Capital Management\MIS\` | Holds **real customer data**. Never copy it into this repo or a test |
| MIS full specification | Unfold PC, `C:\Tarun\prompts\MCM_Excel_MIS_Full_Specification.md` | Personal context folder. Ask Tarun if you need something from it |
| MIS build/test tooling (`test_quick.py` and others) | Unfold PC, `D:\MCM_Hardening_2026-10-15\` | Excel build tooling; its scenarios are already ported to `Backend/work.test.ts` |
| Tarun's master context (`TARUN_MASTER_CONTEXT.md`) | Unfold PC, `C:\Tarun\` | Covers his other ventures and personal working notes |
| The `organize` and `calculate-values` skills | Tarun's Claude Code skills on the Unfold PC | Step 3 will need their rules. `organize` sorts a case folder and writes `Pending Documents.txt` and `GST and ITR Summary.txt`. `calculate-values` works total taxable GST value over the last 12 months (from GSTR-3B returns) and profit for the last three assessment years (from ITR). If this PC does not have them, ask Tarun for their text before building step 3 |
| Real `pfo` database, `C:\PFO\Data`, `.env` | Unfold PC only | See below |

## Setting up the Home PC

The Home PC is **dev only**. It never holds real customer documents and never points at the Unfold PC's database or storage.

1. `git remote -v` must show `https://github.com/premierfinservices/pfo.git`. The repo moved from `tarunrameshphotography/pfo` on 17 Sep 2026. If it still shows the old URL: `git remote set-url origin https://github.com/premierfinservices/pfo.git`.
2. Needs Node, PostgreSQL (local), and git. `npm install`.
3. Copy `.env.example` to `.env` and fill it in for **local development**: `PFO_DB_NAME=pfo_dev`, `PFO_WEB_HOST=127.0.0.1`, a disposable `PFO_STORAGE_ROOT` (for example `C:\PFO\Dev\Data`). Never put a real password in a file you commit.
4. `npm run migrate` against `pfo_dev`. A fresh database has no checksum history, so line endings do not matter here.
5. `npm run seed-users` creates development accounts on a development database only; read the header of `Backend/seed-users.ts` first (it refuses unsuitable databases).
6. Checks: `npm run typecheck`, `npm test` (unit), `npm run test:integration` (needs local Postgres; it makes its own `pfo_test` database and its own storage on a test port).
7. Run the app with `npm run dev` after the CLAUDE.md checks. On the Home PC there is no production to collide with, but still run "Which PC Is This" first.

## How a change reaches production

Git is the only channel. A push from here **deploys nothing**. After you push to `main`, someone on the Unfold PC (which is the production server) must:

1. `git pull --ff-only` in `C:\WORK FILES\Premier FinServ\PFO`.
2. `npm install` if `package.json` changed.
3. `npm run backup` and confirm "OK ... dump checksum matches".
4. **Rehearse** any new migration on a throwaway copy of production (restore the backup into a scratch database with `Backend/restore.mjs`, then run the migrations with the live folder's own migration files). This is how the 0044 to 0048 rollout was done on 30 Oct.
5. Stop the server (needs an **elevated** PowerShell; see `Docs/Session Checkpoint.md`), `npm run migrate`, `npm run build`, start the `PFO Server` scheduled task.
6. Verify health and compare row counts before and after.

Do not ask a Home PC session to do steps 1 to 6. They need the Unfold PC.

## Traps that nearly caused damage

- **Never check out a branch in the production folder** (`...\PFO` on the Unfold PC). The live server runs from it. Use a git worktree for feature work, and push a branch tip straight to `main` if it is a clean fast-forward.
- **Never edit a migration that has been applied.** Production recorded each file's checksum. Migrations 0011 onward have CRLF line endings on the Unfold PC's disk, and the checksums were recorded with them; a fresh LF clone will make the runner refuse on production. Add a new numbered migration instead (next is 0051).
- **Never run plain `npm run dev` on the Unfold PC.** Its `predev` hook kills any `node.exe` on the production ports.
- **`pfo_test` fills up** across runs, then a customer-list test fails on the 500-row limit. Drop the database and rerun. It also fails with a checksum error if an applied migration is edited.
- **Vitest fails a test whose mock throws**, even when the code under test catches it. Model a failure as a returned value instead.
- Long Bash heredocs can fail on Windows. Put long edits in a script file and run that.
- Git operations that need a fresh interactive login (the Git Credential Manager browser picker) cannot be done from Claude's shell tools. The person runs them in their own terminal.

## Open decisions and loose ends (Tarun's to decide)

1. **Telecallers and lenders.** *Decided 30 Oct:* a telecaller may send their own case's file to lenders (ADR-042, migration 0049). *Decided 1 Nov (ADR-043):* they may not update an application's status; the login team, managers and management do.
2. **Sign-in check of what went live.** Log a Case, Update Case, the upload card, the telecaller and login-executive views (tested through the API only, never in a browser). Use a practice case; do not send a real email.
3. **Privacy of AI reading.** *Decided 30 Oct:* reading will be done locally with Tesseract OCR plus rules instead of sending documents to Anthropic's API. Not built; needs a short design first (see above). Until it is built, the current API reading stays off unless `PFO_ANTHROPIC_API_KEY` is set. Whether customer data may be shared across the two proprietorships is still worth a CA's or lawyer's confirmation.
4. **Duplicate-mobile warning shows another owner's customer name, case number and stage** to any telecaller (`mobileMatches` in `Backend/work.ts`). This mirrors the MIS, where the warning names the existing case, but telecallers' own cases are hidden elsewhere in PFO. An automated review flagged it as an information-disclosure risk. *Fixed 1 Nov (ADR-043):* the warning now names only cases the person can read and counts the rest ("2 other cases you cannot open"). Not yet deployed.
5. **A real offsite backup.** `D:\PFO-Backups-Offsite` is on the same PC as everything else. Get a copy that leaves the building before MCM's data moves in. *Tarun will handle this himself.*
6. **The password used for the live `tarun` account was shared in chat** and should be changed. *Tarun will handle this himself.*
7. **Rewrite** `Requirements and Progress.md`, `Loan Lifecycle.md` and `Workflow.md` to match ADR-040, keeping what still applies. *Agreed 30 Oct; rewritten 1 Nov, awaiting Tarun's read. Where they go beyond the spec (the Rejected-reopen and reminder-interval questions) they say so under "Open questions".*

## Known limits of what is built

- A split ITR (separate computation, P&L, balance sheet PDFs) with no combined ITR PDF leaves its ITR line pending until someone marks it "Not needed".
- The checklist can ask for an ITR year not yet filed (assessment year 2026-27 appeared). Check against real cases.
- On real case folders, file names were recognised for 2,184 of 2,693 files (81%), and GST folders 100%. The rest are mostly unrenamed WhatsApp images; those go to Other Document unless AI reading is on.
- *Changed 1 Nov (ADR-044):* Send to lenders now emails. It makes the application and recipient, you choose documents once, review one email per lender, and send; "Record only, no email" keeps the old record-only behaviour. Not yet tried against a real mailbox: dev uses capture-mode mail. If a person closes the panel before sending, the application stays Not Logged In and is sent from the Banks tab.
- Old stage names remain in the TypeScript union and Postgres enums, unwritable, for the prototype store and retired rules.
- The AI's identifications are not written to an audit table (inbound mail's are).
- The upload zip limits (500 files, 200 MB) come from the zip's own declared sizes.

## Suggested first message to a fresh session

> Read `Docs/Resume on Home PC.md`, then run the "Which PC Is This" check and tell me which machine you are on. Then summarise steps 1 to 4 in your own words and tell me which open decisions block what. Do not start step 3 until I confirm its design.

Step 3 has no written design yet. Start it with a short design (inputs, the exact formulas the `calculate-values` skill uses, where results are shown, and how a person corrects a figure), get Tarun's approval, then build test first.
