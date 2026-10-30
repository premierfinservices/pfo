# Resume on the Home PC

Written 30 October 2026 for a Claude session (or a person) that has **no memory of the work below**. Read this first, then the files in "Read in this order". Everything you need is in this repository; nothing depends on the chat that produced it.

> **This repository is public.** Never commit `.env`, passwords, API keys, customer names, mobile numbers, documents, or anything from the real `pfo` database. If a note needs a credential, say where it lives, not what it is.

## What this is, in five lines

- PFO is Premier Finservices' loan operating system. Mint Capital Management (MCM) and Premier Finservices are **one office with one process**.
- MCM already runs on an Excel workbook, the **MIS** (`MIS.xlsm`). It is more automated than PFO was: every action leaves a next action.
- The goal, set by Tarun Ramesh (Manager of both firms): **PFO replaces the MIS and is as automated as it.** We copy the MIS's behaviour into PFO. There is no live sync with Excel.
- The MIS stays the working system until its data is imported (step 4 below). Tarun says "go live" when he is ready.
- Tarun is the decision maker. He prefers a straight assessment to validation, wants decisions recorded with reasons, and treats "unknown" as a valid answer. Do not invent numbers, rules or dates.

## Where things stand (30 Oct 2026)

| Step | What | State |
|---|---|---|
| 1 | Log a Case, Update Case, MIS stages and lender statuses, tasks, short checklists, the "Next:" line, MIS lender and place lists, upload by file name | Built and tested. **Applied to production on 30 Oct 2026** (migrations 0044 to 0047) |
| 2 | Document drop: read unnamed scans by content (Anthropic API), dedupe by content hash, rename to standard names, open zip | Built and tested. Applied (migration 0048). ADR-041. **Off until `PFO_ANTHROPIC_API_KEY` is set**; without it unnamed files land in Other Document. RAR and 7z are reported, not opened, by choice |
| 3 | PFO works out GST and ITR figures itself | **Not started.** PFO only shows the `GST and ITR Summary.txt` that Tarun's desktop `organize` skill wrote |
| 4 | MIS reports and drill-downs, MCM data import, a firm field (MCM or Premier) on each case | **Not started** |

Production: `main` is at or after `8a42b93`, migrated to 0048, running on the Unfold Media Corp PC. After the migration the server was verified healthy and no data was lost, but **nobody has yet signed in and clicked through the new screens in a browser**. That is the first thing to ask Tarun about.

Tests at last run: unit 749/749; integration 296/298. The 2 failures predate this work: `Backend/api.test.ts` still expects `AL-` case numbers after the rebrand to `PF-`. Do not "fix" them by accident while doing something else; it is a small separate job.

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
- **Never edit a migration that has been applied.** Production recorded each file's checksum. Migrations 0011 onward have CRLF line endings on the Unfold PC's disk, and the checksums were recorded with them; a fresh LF clone will make the runner refuse on production. Add a new numbered migration instead (next is 0049).
- **Never run plain `npm run dev` on the Unfold PC.** Its `predev` hook kills any `node.exe` on the production ports.
- **`pfo_test` fills up** across runs, then a customer-list test fails on the 500-row limit. Drop the database and rerun. It also fails with a checksum error if an applied migration is edited.
- **Vitest fails a test whose mock throws**, even when the code under test catches it. Model a failure as a returned value instead.
- Long Bash heredocs can fail on Windows. Put long edits in a script file and run that.
- Git operations that need a fresh interactive login (the Git Credential Manager browser picker) cannot be done from Claude's shell tools. The person runs them in their own terminal.

## Open decisions and loose ends (Tarun's to decide)

1. **May telecallers send files to lenders and update applications?** The MIS lets anyone; PFO's permissions let telecallers only read. Recommended: allow. Unchanged until he decides. (One telecaller is telecaller-only; one person holds both roles.)
2. **Sign-in check of what went live.** Log a Case, Update Case, the upload card, the telecaller and login-executive views (tested through the API only, never in a browser). Use a practice case; do not send a real email.
3. **Privacy of AI reading.** Reading sends a customer's document to Anthropic's API. Tarun approved it. A CA or lawyer should still confirm the privacy position, including whether customer data may be shared across the two proprietorships. Not confirmed as done. Alternative if it matters: local OCR (Tesseract) plus rules.
4. **Duplicate-mobile warning shows another owner's customer name, case number and stage** to any telecaller (`mobileMatches` in `Backend/work.ts`). This mirrors the MIS, where the warning names the existing case, but telecallers' own cases are hidden elsewhere in PFO. An automated review flagged it as an information-disclosure risk. A fix would return only "this number exists" for cases the person cannot read, and show details only for their own. It changes how the warning reads, so it is Tarun's call. Not changed.
5. **A real offsite backup.** `D:\PFO-Backups-Offsite` is on the same PC as everything else. Get a copy that leaves the building before MCM's data moves in.
6. **The password used for the live `tarun` account was shared in chat** and should be changed.
7. **Rewrite** `Requirements and Progress.md`, `Loan Lifecycle.md` and `Workflow.md` to match ADR-040.

## Known limits of what is built

- A split ITR (separate computation, P&L, balance sheet PDFs) with no combined ITR PDF leaves its ITR line pending until someone marks it "Not needed".
- The checklist can ask for an ITR year not yet filed (assessment year 2026-27 appeared). Check against real cases.
- On real case folders, file names were recognised for 2,184 of 2,693 files (81%), and GST folders 100%. The rest are mostly unrenamed WhatsApp images; those go to Other Document unless AI reading is on.
- Emailing documents still happens from the case's Banks tab. The Send to lenders tab only records lender and banker.
- Old stage names remain in the TypeScript union and Postgres enums, unwritable, for the prototype store and retired rules.
- The AI's identifications are not written to an audit table (inbound mail's are).
- The upload zip limits (500 files, 200 MB) come from the zip's own declared sizes.

## Suggested first message to a fresh session

> Read `Docs/Resume on Home PC.md`, then run the "Which PC Is This" check and tell me which machine you are on. Then summarise steps 1 to 4 in your own words and tell me which open decisions block what. Do not start step 3 until I confirm its design.

Step 3 has no written design yet. Start it with a short design (inputs, the exact formulas the `calculate-values` skill uses, where results are shown, and how a person corrects a figure), get Tarun's approval, then build test first.
