# Practice Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any employee create a "practice case" that goes through the real PFOne UI and backend (including a real test email send) without ever counting toward real case numbers, dashboard tiles, the org activity feed, or the submissions board.

**Architecture:** Add one column (`loan_case.is_practice`) and one parallel case-number allocator (`PRACTICE-00001`, ...). Case creation is the only write path — no endpoint ever changes the flag afterward. The stage/event engine is untouched; every place that aggregates cases into a count or list either already excludes them at the correct layer (frontend tile math, for endpoints that return full case objects) or gets a new `is_practice = false` filter (backend aggregate queries: org activity, submissions board).

**Tech Stack:** PostgreSQL migrations (`Database/migrations`), Node/TypeScript backend (`Backend/*.ts`, hand-written SQL via `pg`), React/TypeScript frontend (`Frontend/src`), Vitest for tests (`Backend/*.test.ts`, real Postgres, real HTTP, no mocks).

**Spec:** `Docs/superpowers/specs/2026-09-09-practice-cases-design.md`

## Global Constraints

- `is_practice` is set only at case creation (`Backend/cases.ts`'s `createCase`) and MUST NOT appear in `WRITABLE` (`Backend/cases.ts:453-463`) or any other update path, ever.
- Practice case numbers are `PRACTICE-00001`, `PRACTICE-00002`, ... — never `AL-YYYY-#####`, and must never consume a value from the real `case_number_sequence` table.
- No changes to `Backend/case-stage.ts`, the event schema, or `Backend/mail-server.mjs` — the stage engine, audit trail, and mail send path are identical for practice and real cases.
- Practice cases stay visible in `All Cases` and search (no hiding), tagged with a "Practice" badge.
- Practice cases must be excluded from every one of: Active cases, Needs attention, New leads, Pending documents, With a bank, Pipeline by stage, Team busiest-owners, Recent/organisation activity.

---

## Files to modify

- `Database/migrations/0037_practice_cases.sql` (new)
- `Backend/cases.ts`
- `Backend/events.ts`
- `Backend/submissions.ts`
- `Backend/api.test.ts`
- `Frontend/src/api/types.ts`
- `Frontend/src/screens/WorkspaceHome.tsx`
- `Frontend/src/screens/NewCase.tsx`
- `Frontend/src/screens/CaseList.tsx`
- `Frontend/src/screens/CaseDetail.tsx`

## Files inspected (read, not modified)

- `Database/migrations/0004_cases.sql` — `loan_case` table, `case_number_sequence`, `allocate_case_number`, the `loan_case_number_format` CHECK, the immutability trigger
- `Database/migrations/0033_application_role.sql` — `aos_app` table/function grants (loan_case is a whole-table grant already; new function needs its own `grant execute`)
- `Database/migrations/0035_case_intake_facts.sql`, `0036_master_data_write_grants.sql` — migration numbering/style precedent
- `Database/migrations/0021_document_requirement_engine.sql:270-273` — `alter table loan_case add column ...` + `comment on column` style precedent
- `Backend/case-stage.ts` — confirmed no changes needed; one-way, fully audited stage engine
- `Backend/cases.ts` (full `createCase`, `listCases`, `readCase`, `caseFromRow`, `COLUMNS`, `WRITABLE`, `updateCase`)
- `Backend/events.ts:897-931` (`listOrgEvents` — backs the Recent Activity tile)
- `Backend/submissions.ts:263-303` (`listAllSubmissions` — backs the "With a bank" / Banks board tile; **no existing join to `loan_case` at all**, a genuinely hidden leak path)
- `Backend/submissions.ts:518-...` (`createSubmission` — used by the new test to create a submission row without touching the mail server)
- `Backend/reference.ts:242-280` (global search's case query — confirmed unfiltered by design, practice cases stay searchable via substring match, no change needed)
- `Backend/api-server.ts:893-896` (`/api/cases` POST/GET routing), `:1057-1061` (`/api/submissions` routing), `:987-991` (`/api/events` routing)
- `Backend/api.test.ts:1-60, 228-327` — test harness (`api()`, `createEmployee`, `signIn`) and existing `describe("cases", ...)` conventions
- `Backend/submissions.test.ts:142-217` — `anyLoanProductId`, `aCase`, `twoBranchIds` helper patterns (not modified — used as a style reference only, since this plan adds its tests to `api.test.ts` to avoid the mail/storage server startup cost this file pays)
- `src/domain/case/case-number.ts` — confirmed `CASE_NUMBER_PATTERN` is `AL`-only; not modified, since practice numbers never flow through `formatCaseNumber`/`parseCaseNumber` and the global search's `ilike` fallback already finds them by substring
- `src/domain/permissions/roles.ts:63-114` — confirmed `manager`/`managing_partner` hold `case.create`, `submission.create`, `submission.read` (all), and `event.view` (all) via `MANAGING_PARTNER_GRANTS`, so tests can use one role throughout
- `Frontend/src/screens/WorkspaceHome.tsx` (full) — confirmed `all`/`active` computed once here from `GET /cases` and fed to both the plain workspace tiles and `FoundersDashboard`
- `Frontend/src/screens/FoundersDashboard.tsx` (`OverviewSection`, `TasksSection`, `DocumentsSection`, `TeamSection`, `BanksSection`, `ActivitySection`, and the `attention`/`casesById`/`submissions`/`events` derivations) — confirmed every tile derives from `all`/`active` (fixed at the `WorkspaceHome` source) or from the `submissions`/`events` API responses (fixed in `Backend/submissions.ts` and `Backend/events.ts`)
- `Frontend/src/screens/CaseList.tsx:56, 175-204` — confirmed same `GET /cases` endpoint, independent of `WorkspaceHome`; this is why filtering cannot happen in `listCases` itself
- `Frontend/src/screens/CaseDetail.tsx:190-209` — case header, `isOnHold` badge precedent
- `Frontend/src/screens/BanksTab.tsx:959-967` — checkbox styling precedent
- `Frontend/src/ui/index.tsx:219-244` — `Badge`/`Tone`/`TONE_STYLES`, `StageBadge`
- `package.json` — `npm run migrate`, `npm run migrate:status`, `npm test` (`vitest run`)

---

## Step-by-step implementation order

1. Task 1 — migration (schema + allocator + constraint + grant)
2. Task 2 — backend case creation (numbering, persistence, read path)
3. Task 3 — backend org-activity exclusion (`listOrgEvents`)
4. Task 4 — backend submissions-board exclusion (`listAllSubmissions`)
5. Task 5 — frontend type + dashboard-tile exclusion (`ApiCase.isPractice`, `WorkspaceHome`)
6. Task 6 — frontend New Case checkbox
7. Task 7 — frontend Practice badges (`CaseList`, `CaseDetail`)
8. Task 8 — backend tests (numbering, immutability, org-activity exclusion, submissions-board exclusion)
9. Task 9 — manual verification pass (migration + full click-through)

Each task is independently committable and testable in this order; 2 depends on 1, 3/4 are independent of each other and of 2 (but come after 1), 5 depends on 2, 6 depends on 5, 7 depends on 5, 8 depends on 2/3/4.

---

### Task 1: Database migration

**Files:**
- Create: `Database/migrations/0037_practice_cases.sql`

**Interfaces:**
- Produces: column `loan_case.is_practice boolean not null default false`; function `app.allocate_practice_case_number() returns text`; sequence `app.practice_case_number_seq`. Task 2 consumes both the column and the function by exact name.

- [ ] **Step 1: Write the migration**

```sql
-- ===========================================================================
-- 0037 — Practice cases
--
-- Testing or training on the real Banks/send-documents flow had no safe
-- target: every case was a real loan application, and Backend/case-stage.ts
-- refuses by design to rewind stage history once a submission genuinely goes
-- out (see that file's own comments). This migration adds a first-class
-- is_practice flag so an employee can drive a case through the exact same
-- UI/backend path — including a real test email send — without it becoming
-- real case history. Full spec: Docs/superpowers/specs/2026-09-09-practice-
-- cases-design.md.
--
-- NOT a rollback mechanism for real cases. is_practice is set once, at
-- creation (Backend/cases.ts's createCase), and no endpoint ever changes it
-- afterward — Backend/cases.ts's WRITABLE map for updateCase deliberately
-- never gains an entry for it.
-- ===========================================================================

alter table loan_case
  add column is_practice boolean not null default false;

comment on column loan_case.is_practice is
  'Set once, at creation, never editable afterward (Backend/cases.ts''s '
  'WRITABLE map has no entry for it — that absence is the enforcement). '
  'A practice case runs through the identical stage engine and audit trail '
  '(case.stage_changed etc.) as a real case; the only difference is this '
  'flag, which every dashboard/report aggregate (Backend/events.ts''s '
  'listOrgEvents, Backend/submissions.ts''s listAllSubmissions, and the '
  'frontend tile math in WorkspaceHome.tsx) excludes it by. All Cases and '
  'search show it inline with a badge — it is not hidden.';

-- A practice case number must never be mistaken for a real one anywhere it
-- appears (an email to a "bank", a case list row, a search result), and must
-- never consume or collide with a real AL-YYYY-##### number. A plain
-- Postgres sequence is enough here — unlike case_number_sequence's per-year
-- counter table (0004's own comment: contiguity matters for a real case
-- number quoted to a customer), a practice number carries no such promise,
-- so the simpler primitive is the right one, not the one already in use.
create sequence app.practice_case_number_seq;

create function app.allocate_practice_case_number()
returns text
language sql
security definer
set search_path = public, pg_temp
as $$
  select 'PRACTICE-' || lpad(nextval('app.practice_case_number_seq')::text, 5, '0')
$$;

comment on function app.allocate_practice_case_number is
  'Allocates the next practice-case number, e.g. PRACTICE-00001. SECURITY '
  'DEFINER so aos_app can call it without direct sequence privileges, '
  'matching app.allocate_case_number''s own reasoning (0004). Never shares '
  'case_number_sequence — a practice case must not be able to skip a real '
  'case number, and a real case must not be able to skip a practice one.';

grant execute on function app.allocate_practice_case_number() to aos_app;

-- The real-case-number format check must widen to admit PRACTICE-NNNNN,
-- since both formats now share loan_case.case_number.
alter table loan_case
  drop constraint loan_case_number_format;

alter table loan_case
  add constraint loan_case_number_format
  check (case_number ~ '^AL-\d{4}-\d{5,}$' or case_number ~ '^PRACTICE-\d{5,}$');
```

- [ ] **Step 2: Apply it to the local dev database**

Run: `npm run migrate`
Expected: output lists `0037_practice_cases.sql` as applied, no errors. (Do not run this against production — see the plan's final Migration/verification section for the production rollout note.)

- [ ] **Step 3: Verify manually with psql or an ad-hoc query**

Run (via `psql` or any Postgres client pointed at your dev DB):
```sql
select app.allocate_practice_case_number();
select app.allocate_practice_case_number();
```
Expected: `PRACTICE-00001`, then `PRACTICE-00002` — contiguous, independent of any `AL-` numbers already allocated.

- [ ] **Step 4: Commit**

```bash
git add Database/migrations/0037_practice_cases.sql
git commit -m "feat(db): add loan_case.is_practice and practice case numbering"
```

---

### Task 2: Backend case creation

**Files:**
- Modify: `Backend/cases.ts:39-43` (`COLUMNS`), `:69-99` (`caseFromRow`), `:316-396` (`createCase`)
- Test: `Backend/api.test.ts` (Task 8 adds the tests; this task only implements)

**Interfaces:**
- Consumes: `app.allocate_practice_case_number()` and `loan_case.is_practice` from Task 1.
- Produces: `caseFromRow(...).isPractice: boolean`, read by Task 5's `ApiCase.isPractice` and by Task 3/4's exclusion logic indirectly (they query `loan_case.is_practice` directly, not through this function).

- [ ] **Step 1: Add `is_practice` to the selected columns**

In `Backend/cases.ts`, change:
```ts
const COLUMNS = `c.id, c.case_number, c.loan_product_id, c.requested_amount, c.stage,
                 c.owner_user_id, c.created_by, c.source, c.referral_source_id,
                 c.is_on_hold, c.hold_reason, c.hold_until,
                 c.lost_reason, c.lost_note, c.lost_at, c.stage_before_lost,
                 c.is_invoice_raised, c.closed_at, c.created_at, c.updated_at`;
```
to:
```ts
const COLUMNS = `c.id, c.case_number, c.loan_product_id, c.requested_amount, c.stage,
                 c.owner_user_id, c.created_by, c.source, c.referral_source_id,
                 c.is_on_hold, c.hold_reason, c.hold_until,
                 c.lost_reason, c.lost_note, c.lost_at, c.stage_before_lost,
                 c.is_invoice_raised, c.closed_at, c.created_at, c.updated_at,
                 c.is_practice`;
```

- [ ] **Step 2: Map it in `caseFromRow`**

Change:
```ts
    isInvoiceRaised: row.is_invoice_raised,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
```
to:
```ts
    isInvoiceRaised: row.is_invoice_raised,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isPractice: row.is_practice,
```

- [ ] **Step 3: Read the flag and pick the allocator in `createCase`**

Find this block (currently around line 370-396):
```ts
  // ADR-024: the number comes from the sequence function, never from the
  // application. Two PCs creating a case at the same moment is exactly the
  // case the row lock in there exists for.
  const numbered = await client.query<{ case_number: string }>(
    `select app.allocate_case_number() as case_number`,
  );

  // A case is owned by whoever created it. Reassignment is `case.assign`.
  const inserted = await client.query(
    `insert into loan_case (case_number, loan_product_id, requested_amount, stage,
                            owner_user_id, source, referral_source_id, created_by,
                            is_gst_registered, has_existing_obligations, construction_stage)
     values ($1, $2, $3, 'new', $4, $5, $6, $4, $7, $8, $9)
     returning id`,
    [
      numbered.rows[0]!.case_number,
      loanProductId,
      body.requestedAmount ?? null,
      actor.userId,
      typeof body.source === "string" ? body.source : null,
      referralSourceId,
      isGstRegistered,
      hasExistingObligations,
      constructionStage,
    ],
  );
  const caseId = inserted.rows[0]!.id;
```

Replace with:
```ts
  // Set once, here, and nowhere else — see WRITABLE below, which has no
  // entry for it. A practice case never becomes real, and a real case never
  // becomes practice.
  const isPractice = body.isPractice === true;

  // ADR-024: the number comes from the sequence function, never from the
  // application. Two PCs creating a case at the same moment is exactly the
  // case the row lock in there exists for. A practice case draws from its
  // own allocator (0037) so it can never consume or collide with a real
  // AL-YYYY-##### number.
  const numbered = await client.query<{ case_number: string }>(
    isPractice
      ? `select app.allocate_practice_case_number() as case_number`
      : `select app.allocate_case_number() as case_number`,
  );

  // A case is owned by whoever created it. Reassignment is `case.assign`.
  const inserted = await client.query(
    `insert into loan_case (case_number, loan_product_id, requested_amount, stage,
                            owner_user_id, source, referral_source_id, created_by,
                            is_gst_registered, has_existing_obligations, construction_stage,
                            is_practice)
     values ($1, $2, $3, 'new', $4, $5, $6, $4, $7, $8, $9, $10)
     returning id`,
    [
      numbered.rows[0]!.case_number,
      loanProductId,
      body.requestedAmount ?? null,
      actor.userId,
      typeof body.source === "string" ? body.source : null,
      referralSourceId,
      isGstRegistered,
      hasExistingObligations,
      constructionStage,
      isPractice,
    ],
  );
  const caseId = inserted.rows[0]!.id;
```

- [ ] **Step 4: Confirm `WRITABLE` is untouched (no code change — verification only)**

Open `Backend/cases.ts:453-463` and confirm the `WRITABLE` map still reads exactly:
```ts
const WRITABLE: Record<string, string> = {
  requestedAmount: "requested_amount",
  source: "source",
  referralSourceId: "referral_source_id",
  ...CASE_LEVEL_FACTS,
};
```
Do not add `isPractice` here. This absence is what Task 8's immutability test verifies.

- [ ] **Step 5: Type-check and run the existing case tests to confirm nothing broke**

Run: `npm test -- Backend/api.test.ts`
Expected: PASS (existing "cases" describe block, unmodified so far).

- [ ] **Step 6: Commit**

```bash
git add Backend/cases.ts
git commit -m "feat(cases): accept isPractice at creation, numbered separately"
```

---

### Task 3: Exclude practice cases from the organisation activity feed

**Files:**
- Modify: `Backend/events.ts:897-931` (`listOrgEvents`)

**Interfaces:**
- Consumes: `loan_case.is_practice` (Task 1).
- Produces: no signature change — `listOrgEvents` still returns `readonly OrgTimelineEntry[]`; only which rows it returns changes.

- [ ] **Step 1: Add the join filter**

Change:
```ts
  const { rows } = await client.query(
    `select e.id, e.occurred_at, e.actor_kind, e.event_type, e.payload_after,
            e.case_id, c.case_number,
            p.full_name as actor_name
       from event e
       join loan_case c on c.id = e.case_id
       left join app_user u on u.id = e.actor_user_id
       left join person p on p.id = u.person_id
      where e.case_id is not null
      order by e.occurred_at desc, e.id desc
      limit $1`,
    [limit],
  );
```
to:
```ts
  const { rows } = await client.query(
    `select e.id, e.occurred_at, e.actor_kind, e.event_type, e.payload_after,
            e.case_id, c.case_number,
            p.full_name as actor_name
       from event e
       join loan_case c on c.id = e.case_id
       left join app_user u on u.id = e.actor_user_id
       left join person p on p.id = u.person_id
      where e.case_id is not null
        and not c.is_practice
      order by e.occurred_at desc, e.id desc
      limit $1`,
    [limit],
  );
```

- [ ] **Step 2: Commit**

```bash
git add Backend/events.ts
git commit -m "fix(events): exclude practice cases from the org activity feed"
```

(No standalone test in this task — Task 8 covers `listOrgEvents` exclusion via `GET /api/events`.)

---

### Task 4: Exclude practice cases from the submissions board

**Files:**
- Modify: `Backend/submissions.ts:263-303` (`listAllSubmissions`)

**Interfaces:**
- Consumes: `loan_case.is_practice` (Task 1).
- Produces: no signature change — `listAllSubmissions` still returns `SubmissionBoardEntry[]`; only which rows it returns changes.

This is the hidden leak the spec asked to find: `listAllSubmissions` currently has **no join to `loan_case` at all**, so a practice case's submissions would otherwise appear on the "With a bank" tile and the Banks/Applications board unfiltered.

- [ ] **Step 1: Add the join and filter**

Change:
```ts
  const { rows } = await client.query<
    Pick<
      SubmissionRow,
      | "id"
      | "case_id"
      | "bank_name_at_submission"
      | "branch_name_at_submission"
      | "status"
      | "submitted_at"
      | "created_at"
      | "rejection_reason_id"
      | "bank_reason_text"
    >
  >(
    `select id, case_id, bank_name_at_submission, branch_name_at_submission, status,
            submitted_at::text, created_at::text, rejection_reason_id, bank_reason_text
       from submission
      order by created_at desc
      limit $1`,
    [limit],
  );
```
to:
```ts
  const { rows } = await client.query<
    Pick<
      SubmissionRow,
      | "id"
      | "case_id"
      | "bank_name_at_submission"
      | "branch_name_at_submission"
      | "status"
      | "submitted_at"
      | "created_at"
      | "rejection_reason_id"
      | "bank_reason_text"
    >
  >(
    `select s.id, s.case_id, s.bank_name_at_submission, s.branch_name_at_submission, s.status,
            s.submitted_at::text, s.created_at::text, s.rejection_reason_id, s.bank_reason_text
       from submission s
       join loan_case c on c.id = s.case_id
      where not c.is_practice
      order by s.created_at desc
      limit $1`,
    [limit],
  );
```

- [ ] **Step 2: Commit**

```bash
git add Backend/submissions.ts
git commit -m "fix(submissions): exclude practice cases from the org submissions board"
```

(No standalone test in this task — Task 8 covers `listAllSubmissions` exclusion via `GET /api/submissions`.)

---

### Task 5: Frontend type + dashboard-tile exclusion

**Files:**
- Modify: `Frontend/src/api/types.ts:47-80` (`ApiCase`), `Frontend/src/screens/WorkspaceHome.tsx:34`

**Interfaces:**
- Consumes: `isPractice` field now present on every `ApiCase` from `GET /cases` (Task 2).
- Produces: `WorkspaceHome`'s `all`/`active` no longer contain practice cases, which `FoundersDashboard`'s `OverviewSection`, `TasksSection`, `DocumentsSection`, and `TeamSection` all consume unchanged (they already derive everything from `all`/`active`, confirmed during investigation).

- [ ] **Step 1: Add the field to `ApiCase`**

In `Frontend/src/api/types.ts`, change:
```ts
  readonly applicantId: string | null;
  readonly applicantName: string | null;
  readonly applicantPhone: string | null;
  /**
   * Present on `/api/cases` (the All Cases list) only, from Stage 3C —
```
to:
```ts
  readonly applicantId: string | null;
  readonly applicantName: string | null;
  readonly applicantPhone: string | null;
  /**
   * Set once at creation and never editable afterward (Backend/cases.ts's
   * WRITABLE map has no entry for it). All Cases and search still show a
   * practice case inline with a badge; every dashboard/report aggregate
   * excludes it (WorkspaceHome.tsx's `all`, Backend/events.ts's
   * listOrgEvents, Backend/submissions.ts's listAllSubmissions).
   */
  readonly isPractice: boolean;
  /**
   * Present on `/api/cases` (the All Cases list) only, from Stage 3C —
```

- [ ] **Step 2: Exclude practice cases at the one place tiles are computed from**

In `Frontend/src/screens/WorkspaceHome.tsx`, change:
```ts
  const all = cases.data ?? [];
```
to:
```ts
  // Practice cases stay visible in All Cases/search (CaseList.tsx renders
  // `cases.data` directly, unfiltered, with a badge) but must never reach a
  // dashboard tile, so the filter lives here, at the one place this
  // screen's tiles and FoundersDashboard's tiles both derive `all`/`active`
  // from.
  const all = (cases.data ?? []).filter((c) => !c.isPractice);
```

- [ ] **Step 3: Type-check the frontend**

Run: `npm run build` (or the project's frontend typecheck script — confirm exact script name in `package.json` before running; `tsc --noEmit` via the Vite build is the expected path for this repo)
Expected: no new type errors. `ApiCase.isPractice` being non-optional means anywhere else in the codebase that constructs an `ApiCase`-shaped literal (test fixtures, if any) will now fail to compile until `isPractice` is added — check for any at this step and add `isPractice: false` to them if the build surfaces one.

- [ ] **Step 4: Commit**

```bash
git add "Frontend/src/api/types.ts" "Frontend/src/screens/WorkspaceHome.tsx"
git commit -m "feat(dashboard): exclude practice cases from every tile"
```

---

### Task 6: New Case practice checkbox

**Files:**
- Modify: `Frontend/src/screens/NewCase.tsx`

**Interfaces:**
- Consumes: none new (posts `isPractice` in the existing `POST /cases` body, consumed by Task 2's `createCase`).
- Produces: nothing consumed by a later task — this is a leaf UI change.

- [ ] **Step 1: Add local state**

Find the block of `useState` declarations near the top of the component (alongside `amount`, `referralSourceId`, etc. — the existing draft-backed fields) and add one more:
```ts
const [isPractice, setIsPractice] = useState(false);
```
(Match whatever `useState` import/pattern the surrounding fields already use in this file — this field is intentionally NOT wired into the `clearDrafts`/draft-persistence mechanism the other fields use, since a practice case should default to unchecked on every fresh visit to the form rather than being remembered across sessions.)

- [ ] **Step 2: Send it in the create request**

Change:
```ts
      return await api<ApiCase>("/cases", {
        method: "POST",
        body: {
          applicantId: applicant.id,
          loanProductId: productId,
          ...(amount ? { requestedAmount: Number(amount) } : {}),
          ...(referralSourceId ? { referralSourceId } : {}),
          // Each fact is OMITTED when unanswered rather than sent as null —
          // "nobody asked" and "asked, no answer" are different, and only the
          // first is true of a question the form never showed.
          ...(employmentTypeId ? { employmentTypeId } : {}),
          ...(businessConstitutionId ? { businessConstitutionId } : {}),
          ...(borrowerTypeId ? { borrowerTypeId } : {}),
          ...(gst === undefined ? {} : { isGstRegistered: gst }),
          ...(itr === undefined ? {} : { itrFiled: itr }),
          ...(obligations === undefined ? {} : { hasExistingObligations: obligations }),
        },
      });
```
to:
```ts
      return await api<ApiCase>("/cases", {
        method: "POST",
        body: {
          applicantId: applicant.id,
          loanProductId: productId,
          ...(amount ? { requestedAmount: Number(amount) } : {}),
          ...(referralSourceId ? { referralSourceId } : {}),
          // Each fact is OMITTED when unanswered rather than sent as null —
          // "nobody asked" and "asked, no answer" are different, and only the
          // first is true of a question the form never showed.
          ...(employmentTypeId ? { employmentTypeId } : {}),
          ...(businessConstitutionId ? { businessConstitutionId } : {}),
          ...(borrowerTypeId ? { borrowerTypeId } : {}),
          ...(gst === undefined ? {} : { isGstRegistered: gst }),
          ...(itr === undefined ? {} : { itrFiled: itr }),
          ...(obligations === undefined ? {} : { hasExistingObligations: obligations }),
          ...(isPractice ? { isPractice: true } : {}),
        },
      });
```

- [ ] **Step 3: Add the checkbox to the form**

Find this block (the footer area, just before the error message and the Back/Clear/Open case buttons):
```tsx
      {mutation.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {mutation.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
```
Insert a checkbox row immediately above the `mutation.error` block:
```tsx
      <label className="flex items-center gap-2 text-sm text-ink-700">
        <input
          type="checkbox"
          checked={isPractice}
          onChange={(event) => setIsPractice(event.target.checked)}
        />
        Practice case (for testing/training — never shows up in real reports)
      </label>

      {mutation.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {mutation.error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
```

- [ ] **Step 4: Manual check in the browser**

Run: `npm run dev` (with the dev-safe env overrides from `CLAUDE.md`'s two-PC topology section if running on the Unfold PC — distinct ports, `AOS_DB_NAME` pointed at a disposable database, never the real `aos` database or `C:\AOS\Data`)
Steps: open New Case, tick "Practice case", fill in an applicant/loan type, click "Open case". Expected: the created case's number (visible on the case detail header, Task 7) reads `PRACTICE-00001` (or the next number in sequence) rather than `AL-YYYY-#####`.

- [ ] **Step 5: Commit**

```bash
git add Frontend/src/screens/NewCase.tsx
git commit -m "feat(new-case): add a practice-case checkbox"
```

---

### Task 7: Practice badge on All Cases and Case Detail

**Files:**
- Modify: `Frontend/src/screens/CaseList.tsx:177-186`, `Frontend/src/screens/CaseDetail.tsx:196-205`

**Interfaces:**
- Consumes: `loanCase.isPractice` (Task 5's `ApiCase` field, already present on both screens' existing `loanCase`/`ApiCase` objects — no new fetch needed).
- Produces: nothing consumed by a later task — this is a leaf UI change.

- [ ] **Step 1: Badge on the All Cases list row**

In `Frontend/src/screens/CaseList.tsx`, change:
```tsx
                  <Td>
                    <Link to={`/cases/${loanCase.id}`} className="tnum font-medium text-ink-900 hover:underline">
                      {loanCase.caseNumber}
                    </Link>
                    {loanCase.isOnHold && (
                      <span className="ml-2">
                        <Badge tone="warn">Hold</Badge>
                      </span>
                    )}
                  </Td>
```
to:
```tsx
                  <Td>
                    <Link to={`/cases/${loanCase.id}`} className="tnum font-medium text-ink-900 hover:underline">
                      {loanCase.caseNumber}
                    </Link>
                    {loanCase.isPractice && (
                      <span className="ml-2">
                        <Badge tone="neutral" title="For testing/training only — excluded from every report and dashboard tile">
                          Practice
                        </Badge>
                      </span>
                    )}
                    {loanCase.isOnHold && (
                      <span className="ml-2">
                        <Badge tone="warn">Hold</Badge>
                      </span>
                    )}
                  </Td>
```

- [ ] **Step 2: Badge on the Case Detail header**

In `Frontend/src/screens/CaseDetail.tsx`, change:
```tsx
          <StageBadge stage={loanCase.stage} label={CASE_STAGE_LABELS[loanCase.stage]} />
          {loanCase.isOnHold && <Badge tone="warn">On hold</Badge>}
        </div>
```
to:
```tsx
          <StageBadge stage={loanCase.stage} label={CASE_STAGE_LABELS[loanCase.stage]} />
          {loanCase.isPractice && (
            <Badge tone="neutral" title="For testing/training only — excluded from every report and dashboard tile">
              Practice
            </Badge>
          )}
          {loanCase.isOnHold && <Badge tone="warn">On hold</Badge>}
        </div>
```

- [ ] **Step 3: Manual check in the browser**

Steps: open the practice case created in Task 6's manual check. Expected: a "Practice" badge appears next to the stage badge on the case detail header, and the same case's row in All Cases shows the badge next to its `PRACTICE-00001` number.

- [ ] **Step 4: Commit**

```bash
git add Frontend/src/screens/CaseList.tsx Frontend/src/screens/CaseDetail.tsx
git commit -m "feat(ui): show a Practice badge on practice cases"
```

---

### Task 8: Backend tests

**Files:**
- Modify: `Backend/api.test.ts` (add to the existing `describe("cases", ...)` block, plus one new `describe` block)

**Interfaces:**
- Consumes: everything from Tasks 1-4 (the migration, `createCase`, `listOrgEvents`, `listAllSubmissions`).
- Produces: nothing consumed by a later task — this is the verification layer.

This file already has the harness (`api()`, `createEmployee`, `signIn`, `anyLoanProductId` — check whether `anyLoanProductId` already exists in `api.test.ts` itself or needs copying in from `Backend/submissions.test.ts:146-149`; if absent, add it verbatim). No mail or storage server is started in this file today and none should be added — submission creation for these tests goes through `POST /api/cases/:id/submissions` (`createSubmission`), which writes a database row and returns before any package/send/mail step, so it never touches `Backend/mail-server.mjs`.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe("cases", ...)` block in `Backend/api.test.ts`, after the last existing `it(...)`:

```ts
  it("creates a practice case with its own numbering, excluded from real numbering", async () => {
    const session = await signIn(await createEmployee("manager"));
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Practice Applicant ${randomUUID().slice(0, 8)}` },
    });

    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: {
        applicantId: customer.body.id,
        loanProductId: await anyLoanProductId(),
        isPractice: true,
      },
    });

    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.caseNumber).toMatch(/^PRACTICE-\d{5,}$/);
    expect(created.body.isPractice).toBe(true);
  });

  it("still numbers a normal case AL-YYYY-##### when isPractice is omitted", async () => {
    const session = await signIn(await createEmployee("manager"));
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Real Applicant ${randomUUID().slice(0, 8)}` },
    });

    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: { applicantId: customer.body.id, loanProductId: await anyLoanProductId() },
    });

    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body.caseNumber).toMatch(/^AL-\d{4}-\d{5}$/);
    expect(created.body.isPractice).toBe(false);
  });

  it("never lets isPractice change after creation", async () => {
    const session = await signIn(await createEmployee("manager"));
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Immutable Practice ${randomUUID().slice(0, 8)}` },
    });
    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: { applicantId: customer.body.id, loanProductId: await anyLoanProductId(), isPractice: true },
    });
    expect(created.body.isPractice).toBe(true);

    // isPractice is not in WRITABLE, so PATCH silently ignores it — sending
    // it alongside a real field change proves the real field lands and
    // isPractice does not move.
    const patched = await api(`/api/cases/${created.body.id}`, {
      method: "PATCH",
      token: session.token,
      body: { isPractice: false, requestedAmount: 500000 },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.requestedAmount).toBe(500000);
    expect(patched.body.isPractice).toBe(true);
  });

  it("keeps a practice case visible in the case list alongside real ones", async () => {
    const session = await signIn(await createEmployee("manager"));
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Listed Practice ${randomUUID().slice(0, 8)}` },
    });
    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: { applicantId: customer.body.id, loanProductId: await anyLoanProductId(), isPractice: true },
    });

    const listed = await api("/api/cases", { token: session.token });
    expect(listed.status).toBe(200);
    const row = listed.body.find((c: { id: string }) => c.id === created.body.id);
    expect(row).toBeDefined();
    expect(row.isPractice).toBe(true);
  });
```

Add a new top-level `describe` block, after the closing `});` of the existing `describe("cases", ...)` block:

```ts
describe("practice cases are excluded from organisation-wide aggregates", () => {
  it("does not appear in the org activity feed", async () => {
    const session = await signIn(await createEmployee("manager"));
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Activity Practice ${randomUUID().slice(0, 8)}` },
    });
    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: { applicantId: customer.body.id, loanProductId: await anyLoanProductId(), isPractice: true },
    });

    const events = await api("/api/events?limit=500", { token: session.token });
    expect(events.status, JSON.stringify(events.body)).toBe(200);
    const leaked = events.body.filter((e: { caseId: string }) => e.caseId === created.body.id);
    expect(leaked).toHaveLength(0);
  });

  it("does not appear on the organisation submissions board", async () => {
    const session = await signIn(await createEmployee("manager"));
    const customer = await api("/api/customers", {
      method: "POST",
      token: session.token,
      body: { fullName: `Board Practice ${randomUUID().slice(0, 8)}` },
    });
    const created = await api("/api/cases", {
      method: "POST",
      token: session.token,
      body: { applicantId: customer.body.id, loanProductId: await anyLoanProductId(), isPractice: true },
    });

    const lenders = await api("/api/lenders", { token: session.token });
    expect(lenders.status, JSON.stringify(lenders.body)).toBe(200);
    const branchId = lenders.body[0]?.branches?.[0]?.id;
    expect(branchId, "at least one bank branch must exist in the reference data for this test to run").toBeDefined();

    const submission = await api(`/api/cases/${created.body.id}/submissions`, {
      method: "POST",
      token: session.token,
      body: {
        branchOrganisationId: branchId,
        recipients: [{ email: "practice-board-test@example.com", name: "Test", isPrimary: true }],
      },
    });
    expect(submission.status, JSON.stringify(submission.body)).toBe(200);

    const board = await api("/api/submissions?limit=500", { token: session.token });
    expect(board.status, JSON.stringify(board.body)).toBe(200);
    const leaked = board.body.filter((s: { caseId: string }) => s.caseId === created.body.id);
    expect(leaked).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Confirm `anyLoanProductId` is available in `api.test.ts`**

Check the top of `Backend/api.test.ts` for an existing `anyLoanProductId` helper (it may already be there — the file's existing `describe("cases", ...)` tests reference it). If it is not defined in this file, add it near the other test helpers (`createEmployee`, `signIn`), copied from `Backend/submissions.test.ts:146-149`:
```ts
async function anyLoanProductId(): Promise<string> {
  const { rows } = await pool.query(`select id from loan_product limit 1`);
  return rows[0]!.id;
}
```
(`pool` is already imported in `api.test.ts` from `./db.js`.)

- [ ] **Step 3: Run the tests to verify they fail without Tasks 1-4**

If run against a database that does not yet have migration 0037 applied, or before `Backend/cases.ts`/`events.ts`/`submissions.ts` are updated, these tests fail — the `isPractice`/`PRACTICE-` assertions fail against a normal `AL-` case number, or the exclusion tests fail because the practice case's activity/submission is not actually excluded yet.

Run: `npm test -- Backend/api.test.ts`
Expected (before Tasks 1-4 land): FAIL on the new tests, with errors matching a missing `is_practice` column or a `caseNumber` not matching `/^PRACTICE-/`.

(In practice, since this plan implements Tasks 1-4 before Task 8, this step is a sanity check to run only if executing tasks out of order — otherwise skip straight to Step 4.)

- [ ] **Step 4: Run the tests to verify they pass with Tasks 1-4 done**

Run: `npm test -- Backend/api.test.ts`
Expected: PASS, all tests including the new ones.

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test`
Expected: PASS. This confirms the `loan_case_number_format` CHECK widening and the `COLUMNS`/`caseFromRow` changes did not break any other suite that creates or reads cases (`documents.test.ts`, `submissions.test.ts`, `events.test.ts`, `slice.test.ts`, etc.).

- [ ] **Step 6: Commit**

```bash
git add Backend/api.test.ts
git commit -m "test(cases): cover practice-case numbering, immutability, and exclusion"
```

---

### Task 9: Manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Fresh migration status check**

Run: `npm run migrate:status`
Expected: `0037_practice_cases.sql` shown as applied, nothing pending.

- [ ] **Step 2: Full click-through on a disposable dev database**

Using a `npm run dev` session with the dev-safe env overrides from `CLAUDE.md` (distinct ports, `AOS_DB_NAME` set to a disposable database — never the real `aos` database, never `C:\AOS\Data`):

1. Open New Case, tick "Practice case", create it. Confirm the toast/redirect lands on a case whose number is `PRACTICE-00001` (or next in sequence).
2. Confirm the "Practice" badge shows on the case detail header.
3. Go to All Cases — confirm the practice case appears in the list with its badge, sitting alongside real cases.
4. Search for the case by typing its `PRACTICE-#####` number in the global search bar — confirm it is found (via the existing `ilike` substring match in `Backend/reference.ts`, unmodified by this plan).
5. Drive the case through Documents/Banks exactly as a real case (this plan does not restrict that flow) up to a real test email send via the Banks tab, exactly as demonstrated live in this session for case AL-2026-00005 — except this time the underlying case is `PRACTICE-#####`, so its `Submitted` stage and event history are practice data, not a real case's.
6. Open the workspace Overview/Founders Dashboard. Confirm the practice case's activity does NOT move "Active cases," "Needs attention," "New leads," "Pending documents," "With a bank," the Pipeline bars, or the Team busiest-owners counts.
7. Confirm the practice case's stage-change and submission events do NOT appear in "Recent activity."
8. Create one more real (non-practice) case in parallel and confirm its numbering is unaffected (still contiguous `AL-YYYY-#####`) and it DOES show up in the dashboard tiles.

- [ ] **Step 3: Report back**

Summarize the click-through results. If anything in Step 2 fails, do not proceed to any production rollout — return to the relevant task above and fix it first.

---

## Migration/verification commands

- `npm run migrate` — apply pending migrations to whatever database the current shell's env points at. **Never run this against the real `aos` database from this plan's work** — use a disposable dev/test database per `CLAUDE.md`'s two-PC topology rules.
- `npm run migrate:status` — check what is applied without applying anything.
- `npm test` — full Vitest suite (`vitest run`), real Postgres, real HTTP, no mocks.
- `npm test -- Backend/api.test.ts` — just this plan's test file.
- `npm run dev` (with the dev-safe env overrides) — manual click-through.

**Production rollout is explicitly out of scope for this plan's execution** — it ends at Task 9's dev-database verification. Applying `0037_practice_cases.sql` to the real `aos` database on Unfold PC, and restarting the `AOS Server` task, is a separate, later action requiring its own explicit go-ahead (per this session's established practice of confirming before any production-affecting step).

---

## Risks and edge cases

- **`loan_case_number_format` CHECK constraint drop/recreate (Task 1) is the migration's only genuinely destructive statement.** Dropping and re-adding a CHECK constraint on `loan_case` briefly leaves the table without the format check; on a table this size (tens of rows per the earlier session's dashboard, not millions) this is instantaneous and safe, but it is worth knowing this is not a purely additive migration in the way 0033/0036 were.
- **`ApiCase.isPractice` is non-optional.** Any existing frontend code, test fixture, or mock that constructs an `ApiCase`-shaped object literal (rather than receiving one from the real API) will fail to typecheck until it adds `isPractice: false`. Task 5 Step 3 calls this out explicitly — search the frontend for hand-built `ApiCase` literals before considering the type change complete.
- **The frontend exclusion (Task 5) lives in `WorkspaceHome.tsx`, not in `Backend/cases.ts`'s `listCases`.** This is deliberate — `CaseList.tsx` calls the same `GET /cases` endpoint and must keep seeing practice cases. If a future screen adds a *third* consumer of `GET /cases` that computes aggregate tiles (rather than rendering a list), it must repeat this same `.filter((c) => !c.isPractice)` — there is no single server-side choke point for this specific data shape, because the same endpoint legitimately serves both a filtered (dashboard) and unfiltered (list) consumer.
- **`listAllSubmissions` (Task 4) was unfiltered by anything before this plan** — not just practice cases. Confirm during Task 4's implementation that no other caller of `listAllSubmissions` relies on seeing every submission regardless of case (a grep for `listAllSubmissions` callers should turn up only the one `/api/submissions` route from this investigation, but re-check at implementation time in case something changed).
- **Practice-case emails still really send.** This plan deliberately does not add any extra confirmation step to the Banks/send flow for practice cases (per the approved spec's explicit non-goal) — a practice case can still address a real bank contact by mistake, exactly as almost happened in this session with HDFC/Anand Kumar. The badge and the "for testing/training" checkbox copy are the only safeguards; this is a conscious tradeoff already approved in the spec, not an oversight to fix here.
- **Case AL-2026-00005's existing `Submitted`/`Withdrawn` state is explicitly out of scope** (per the spec's own "Immediate cleanup" section) — this plan does not touch it, and no task here should be expanded to "fix" that case's history.
- **Grant statement scope.** `grant execute on function app.allocate_practice_case_number() to aos_app;` is the only new grant needed — `loan_case` already has a whole-table `select, insert, update` grant to `aos_app` from migration 0033, so the new `is_practice` column needs no separate column-level grant.

## Final acceptance checklist

- [ ] Migration `0037_practice_cases.sql` applies cleanly and is idempotent-safe on rerun-of-status (i.e., `migrate:status` shows it applied, `migrate` again is a no-op)
- [ ] `app.allocate_practice_case_number()` produces `PRACTICE-00001`, `PRACTICE-00002`, ... independent of the real `case_number_sequence`
- [ ] `loan_case_number_format` CHECK accepts both `AL-YYYY-#####` and `PRACTICE-#####`, rejects anything else
- [ ] `POST /api/cases` with `isPractice: true` creates a case numbered `PRACTICE-#####` with `is_practice = true`
- [ ] `POST /api/cases` without `isPractice` (or with it `false`/absent) is completely unaffected — still `AL-YYYY-#####`, contiguous, `is_practice = false`
- [ ] `PATCH /api/cases/:id` with `isPractice` in the body never changes the stored flag, on either a real or practice case
- [ ] `GET /api/cases` includes practice cases, each with `isPractice: true`, alongside real ones
- [ ] `GET /api/events` never includes an event whose `case_id` belongs to a practice case
- [ ] `GET /api/submissions` never includes a submission whose case is a practice case
- [ ] `WorkspaceHome.tsx`'s `all`/`active` (and everything `FoundersDashboard` derives from them: Active cases, Needs attention, New leads, Pending documents, Pipeline by stage, Team busiest-owners) exclude practice cases
- [ ] The New Case screen has a working "Practice case" checkbox that round-trips into `isPractice` on the create request
- [ ] All Cases list and Case Detail header both show a "Practice" badge on a practice case, styled with the existing `Badge`/`Tone` system, without disturbing the existing stage/hold badges
- [ ] `npm test` passes in full, not just the new tests
- [ ] `Backend/mail-server.mjs` and its tests are untouched
- [ ] `Backend/case-stage.ts` is untouched
- [ ] Manual click-through (Task 9) confirms the whole loop end-to-end on a disposable dev database, including a real test email send via the Banks tab that leaves zero trace on any dashboard tile or activity feed
