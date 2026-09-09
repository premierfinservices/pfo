# Resume checkpoint — Practice Cases feature

**Date:** 2026-09-09
**Status:** Tasks 1-8 COMPLETE and committed on branch `feature/practice-cases`. Task 9 (manual browser click-through) NOT started — needs a decision, see below.

## What's done

All on branch `feature/practice-cases` (created off `main`, not committed to `main` directly), one commit per task:

1. `Database/migrations/0037_practice_cases.sql` — applied and verified against the disposable `aos_test` database (via `npm run test:integration`'s auto-provisioning, never `aos`/production). `app.allocate_practice_case_number()` confirmed to produce `PRACTICE-00001`, `PRACTICE-00002`, ... contiguously.
2. `Backend/cases.ts` — `createCase` accepts `isPractice`, picks the right allocator, persists the flag. `WRITABLE` confirmed unchanged (no `isPractice` entry — immutability enforced).
3. `Backend/events.ts` — `listOrgEvents` excludes practice-case events.
4. `Backend/submissions.ts` — `listAllSubmissions` now joins `loan_case` (it had no join before this — the hidden leak the spec called out) and excludes practice cases.
5. `Frontend/src/api/types.ts` + `Frontend/src/screens/WorkspaceHome.tsx` — `ApiCase.isPractice`, dashboard tiles filtered at the `all` source.
6. `Frontend/src/screens/NewCase.tsx` — practice-case checkbox, not draft-persisted (defaults unchecked every visit).
7. `Frontend/src/screens/CaseList.tsx` + `CaseDetail.tsx` — "Practice" badge (tone="neutral"), same pattern as the `isOnHold` badge.
8. `Backend/api.test.ts` — 6 new tests (practice numbering, real numbering unaffected, immutability, list visibility, events exclusion, submissions exclusion). All pass.

**Verification run this session:**
- `npm run typecheck` — clean, no errors, at every frontend task.
- `npx vitest run --config vitest.integration.config.ts Backend/api.test.ts` — all new + existing tests pass.
- `npm run test:integration` (full backend suite, 15 files) — all pass except one **pre-existing, unrelated** flake in `customers > creates, reads, lists and updates a customer` (confirmed by re-running against `git stash` of all this session's changes — it fails identically on unmodified code, likely stale accumulated rows in the long-lived `aos_test` database from repeated local runs affecting a list/pagination assumption). Not caused by this feature.
- `npm test` (unit suite, 40 files / 655 tests) — all pass.

No production database, `C:\AOS\Data`, or the `AOS Server` scheduled task was touched. No migration was run against `aos` — only against the disposable, auto-provisioned `aos_test`.

## What's NOT done — Task 9

Task 9 is a manual browser click-through against a **disposable dev database** (`npm run dev` with dev-safe env overrides, `AOS_DB_NAME` pointed away from `aos`), signing in as an employee, creating a practice case, and confirming the badge/exclusion behavior end-to-end visually, including one real test email send via the Banks tab.

**Not started because:**
- It needs a live employee login. The one credential this session's history knows about (`tarun`, Manager role) had its password reset mid-earlier-session and may not still be valid.
- It needs a `npm run dev` process with the CLAUDE.md-mandated port/DB overrides (`AOS_VITE_PORT`, `AOS_API_PORT`, `AOS_STORAGE_PORT`, `AOS_MAIL_PORT`, `AOS_WEB_HOST=127.0.0.1`, `AOS_DB_NAME=aos_dev` or similar, `AOS_STORAGE_ROOT` pointed off `C:\AOS\Data`) — safe to do, but should be confirmed with the user before spinning up a second long-lived process on whatever machine this session is running on.

## To resume

Ask the user:
1. Whether to proceed with Task 9 now, and if so, what credentials to sign in with (reset `tarun`'s password, or create a fresh disposable employee account via the test harness/an admin script).
2. Confirm the dev-safe env overrides to use (a distinct `AOS_DB_NAME` for this click-through, e.g. `aos_dev`).

Everything Task 9 needs (the code) is already committed and covered by automated tests; Task 9 itself is pure UI verification, not implementation.
