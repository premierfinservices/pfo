-- ===========================================================================
-- 0051 — which firm a case belongs to (MCM or Premier)
--
-- Mint Capital Management and Premier Finservices run one office and one
-- process (Docs/Resume on Home PC.md), but they are two proprietorships with
-- different owners, so a case has to say which one it is for. This is step 4 of
-- the MIS parity work; the MCM import and the MIS reports both depend on it.
--
-- Additive. Every case that exists today was logged in PFO, which is Premier
-- Finservices' system, so the default is 'premier'. The MCM import sets 'mcm'.
-- A check constraint rather than an enum, as 0045 did for document_status:
-- adding a third firm later is then a constraint swap, not a type rebuild.
--
-- loan_case is not one of the column-masked tables (0034), so aos_app needs no
-- extra grant; Backend/app-role-column-grants.test.ts guards that.
-- ===========================================================================

alter table loan_case
  add column firm text not null default 'premier',
  add constraint loan_case_firm_known check (firm in ('mcm', 'premier'));

comment on column loan_case.firm is
  'Which proprietorship the case is for: mcm (Mint Capital Management) or premier '
  '(Premier Finservices). Chosen when the case is logged; a manager can correct it.';

create index loan_case_firm_idx on loan_case (firm);
