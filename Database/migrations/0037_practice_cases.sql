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
