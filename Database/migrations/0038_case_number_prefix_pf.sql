-- ===========================================================================
-- 0038 — Case number prefix AL -> PF
--
-- The company rebranded from Amaze Loans to Premier Finserv (see the Phase
-- 1-9 rebrand commits). Case numbers were still stamped AL-YYYY-NNNNN, the
-- one piece of the old brand still visible to customers on the phone and on
-- printed login forms. src/domain/case/case-number.ts's CASE_NUMBER_PREFIX
-- is now "PF"; this migration brings app.allocate_case_number and the
-- format check constraint into step with it (ADR-024: the two must not
-- diverge).
-- ===========================================================================

alter table loan_case
  drop constraint loan_case_number_format;

alter table loan_case
  add constraint loan_case_number_format
  check (case_number ~ '^PF-\d{4}-\d{5,}$' or case_number ~ '^PRACTICE-\d{5,}$');

create or replace function app.allocate_case_number(p_year integer default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_year  integer := coalesce(p_year, extract(year from now())::integer);
  v_value integer;
begin
  insert into case_number_sequence (year, last_value)
  values (v_year, 1)
  on conflict (year) do update
    set last_value = case_number_sequence.last_value + 1
  returning last_value into v_value;

  return format('PF-%s-%s', v_year, lpad(v_value::text, 5, '0'));
end;
$$;

comment on function app.allocate_case_number is
  'Allocates the next case number for a year, creating the year''s counter row '
  'on first use. SECURITY DEFINER because case_number_sequence is not readable '
  'or writable by any client — a client that could increment the counter could '
  'skip numbers. Format matches formatCaseNumber() in '
  'src/domain/case/case-number.ts; the two must stay in step (ADR-024).';

-- All AL-* cases were dummy/test data and have already been deleted (case
-- cleanup, 2026-09-10). No real case number is being renumbered here — this
-- just lets the very first real case start at PF-<year>-00001 instead of
-- continuing the old counter.
delete from case_number_sequence;
