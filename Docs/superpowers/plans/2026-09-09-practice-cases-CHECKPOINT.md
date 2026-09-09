# Resume checkpoint — Practice Cases feature

**Date:** 2026-09-09
**Status:** Plan approved, NOT started. No code, migration, or test changes made yet.

## To resume in a new session

Say something like: "Continue the Practice Cases implementation — read
`Docs/superpowers/plans/2026-09-09-practice-cases.md` and execute it inline
via the superpowers:executing-plans skill, task by task, with checkpoints."

The new session should:
1. Load skill `superpowers:executing-plans`.
2. Read the spec: `Docs/superpowers/specs/2026-09-09-practice-cases-design.md`
3. Read the plan: `Docs/superpowers/plans/2026-09-09-practice-cases.md`
4. Execute Tasks 1-9 in order, exactly as written (each task has concrete
   code, not placeholders).

## What's already true in the repo (do not redo)

- Spec committed: `Docs/superpowers/specs/2026-09-09-practice-cases-design.md` (commit `f81b8fd`)
- Plan written and saved (this session, uncommitted as of this checkpoint —
  check `git status` on `Docs/superpowers/plans/2026-09-09-practice-cases.md`
  first; commit it if not already committed before starting Task 1)
- Nothing else. No migration file exists yet (`Database/migrations/` still
  ends at `0036_master_data_write_grants.sql`). No `is_practice` column, no
  `Backend/cases.ts`/`events.ts`/`submissions.ts` edits, no frontend edits,
  no new tests.

## Session state / environment notes the new session should know

- Working machine for this conversation was reached via the AOS project at
  `C:\WORK FILES\Amaze Loans Pvt Ltd\AOS`, git branch `main`.
- **Do not run migrations or tests against the real `aos` production
  database.** Use a disposable dev database per `CLAUDE.md`'s two-PC
  topology rules (`aos_dev`/`aos_test`/`aos_e2e` naming, distinct ports,
  loopback host). If this session is running on the same machine as the
  live `AOS Server` scheduled task (Unfold PC), export the dev-safe env
  vars documented in `CLAUDE.md` before any `npm run dev` / `npm run
  migrate` / `npm test` — plain `npm run dev` there kills the live
  production backend via `Backend/free-dev-ports.mjs`'s port-killing
  predev hook.
- Earlier in this session, real case **AL-2026-00005** (BALU K) was used to
  manually test the Banks/send-documents flow against a dummy "State Bank
  of India — Gandhipuram" bank contact addressed to the user's own email
  (tarunrameshphotography@gmail.com), then marked Withdrawn. This is
  accepted, real, accurate history and is explicitly **out of scope** — the
  spec's own "Immediate cleanup" section says not to touch it. Do not
  "fix" or revert that case as part of this feature.
- The mail server (`Backend/mail-server.mjs`) was reconfigured earlier this
  session to send as `premierfinservices.cbe@gmail.com` (Premier Finserv's
  new mailbox, replacing the dissolved Amaze Loans' `amazeloans@gmail.com`)
  via a new Gmail OAuth refresh token, and confirmed working. This is
  unrelated to the Practice Cases feature and needs no further action here.
- The employee test account used earlier was `tarun` (real employee,
  Manager role) with a temporary password that was reset mid-session — if
  a new session needs to sign in to the live app to manually verify
  (plan's Task 9), it may need fresh credentials; don't assume the earlier
  temporary password still works or is known.

## Plan summary (for quick orientation — the full plan file is authoritative)

9 tasks, in order:
1. DB migration `0037_practice_cases.sql` — `loan_case.is_practice`, a
   separate `PRACTICE-#####` numbering sequence/function, widened
   case-number CHECK constraint, `aos_app` grant.
2. `Backend/cases.ts` — `createCase` accepts `isPractice`, picks the right
   allocator, persists the flag; `WRITABLE` map deliberately never gains an
   entry for it (enforces immutability).
3. `Backend/events.ts`'s `listOrgEvents` — exclude practice-case events
   from the org activity feed.
4. `Backend/submissions.ts`'s `listAllSubmissions` — exclude practice-case
   submissions from the org submissions board (this query currently has
   **no join to `loan_case` at all** — a real, previously-hidden leak this
   plan fixes).
5. `Frontend/src/api/types.ts` (`ApiCase.isPractice`) +
   `Frontend/src/screens/WorkspaceHome.tsx` (filter `all` at the one place
   dashboard tiles are computed from — NOT in the backend `listCases`,
   because `CaseList.tsx` shares that same endpoint and must keep showing
   practice cases).
6. `Frontend/src/screens/NewCase.tsx` — practice-case checkbox.
7. `Frontend/src/screens/CaseList.tsx` + `CaseDetail.tsx` — "Practice"
   badge, mirroring the existing `isOnHold` badge pattern.
8. `Backend/api.test.ts` — new tests: practice numbering, real-case
   numbering unaffected, immutability after creation, visible in case
   list, excluded from `/api/events` and `/api/submissions`.
9. Manual click-through on a disposable dev database (not production).

Each task in the plan file has literal before/after code — no
"TBD"/"similar to Task N" placeholders — so a fresh session can execute
directly without re-deriving the design.
