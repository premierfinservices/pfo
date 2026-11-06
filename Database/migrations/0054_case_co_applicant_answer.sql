-- ===========================================================================
-- 0054 — Log a Case asks whether there is a co-applicant (ADR-049)
--
-- Tarun, 6 Nov 2026: the question is asked when a case is logged. Yes records
-- the co-applicant as a case_party (role co_applicant, name and optional mobile);
-- No is recorded here, so "no co-applicant" and "nobody asked" read differently.
-- A co-applicant can still be added later, which sets this to true.
--
-- Null means the question was never asked: cases logged before this, and cases
-- copied from the MIS, which holds no co-applicant. Additive. loan_case is not
-- column-masked (0034), so aos_app needs no extra grant.
-- ===========================================================================

alter table loan_case add column has_co_applicant boolean;

comment on column loan_case.has_co_applicant is
  'The answer to "Co-applicant?" on Log a Case. True when one is on the case, false when the '
  'answer was No, null when it was never asked (older and MIS-synced cases).';
