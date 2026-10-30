-- ===========================================================================
-- 0045 — Log a Case, Update Case and the work engine (ADR-040)
--
-- Source of truth: PRD/Intake and Work Engine.md.
-- Additive, except the constraints that retire the old stages. Production had
-- zero loan cases when this was written.
-- ===========================================================================

-- Cases -----------------------------------------------------------------------

alter table loan_case
  alter column stage set default 'documents_pending',
  add column document_status text not null default 'pending',
  add column eligibility_status text not null default 'unanswered',
  add column loan_type text,
  add column loan_variant text,
  add column place text,
  add column duplicate_override_note text,
  add constraint loan_case_document_status_known
    check (document_status in ('not_assessed', 'pending', 'partial', 'complete')),
  add constraint loan_case_eligibility_status_known
    check (eligibility_status in ('unanswered', 'eligible', 'not_eligible'));

comment on column loan_case.document_status is
  'What a person says has arrived, as in the MIS. Never computed from the checklist, '
  'because the checklist only informs (ADR-040).';
comment on column loan_case.eligibility_status is
  'A person''s answer. The system asks; it does not decide (ADR-040).';

-- Production has no cases, but a development database may. Old stages map to
-- the nearest new one, so this migration runs anywhere.
update loan_case set stage = case stage
    when 'new' then 'documents_pending'
    when 'contacted' then 'documents_pending'
    when 'appointment_fixed' then 'documents_pending'
    when 'ready_for_submission' then 'documents_collected'
    when 'submitted' then 'documents_collected'
    when 'sanctioned' then 'approved'
  end::app.case_stage
 where stage in ('new', 'contacted', 'appointment_fixed', 'ready_for_submission', 'submitted', 'sanctioned');

alter table loan_case add constraint loan_case_stage_not_retired
  check (stage not in ('new', 'contacted', 'appointment_fixed', 'ready_for_submission', 'submitted', 'sanctioned'));

-- Lender applications ---------------------------------------------------------

alter table submission
  add column login_date date,
  add column login_employee_id uuid references app_user (id),
  add column banker_name text,
  add column approved_amount numeric(14, 2),
  add column sanction_date date,
  add column sanction_acceptance_date date,
  add column disbursement_amount numeric(14, 2),
  add column disbursement_date date,
  add column precheck_reason text;

alter table submission add constraint submission_precheck_has_reason
  check (status <> 'not_eligible_precheck' or precheck_reason is not null);

-- Tasks -----------------------------------------------------------------------

alter table task
  add column kind text,
  add column submission_id uuid references submission (id);

create index task_open_by_assignee_idx on task (assigned_to, due_at) where completed_at is null;
create index task_open_by_case_idx on task (case_id) where completed_at is null;

-- Lists -----------------------------------------------------------------------

alter table lender_profile add column supported_loan_types text[] not null default '{}';

comment on column lender_profile.supported_loan_types is
  'MIS loan-type names, used only to list likely lenders first on Send to lenders.';

insert into referral_source (code, name, display_order)
values ('provided_lead_database', 'Provided Lead Database', 1),
       ('direct_referral', 'Direct Referral', 2)
on conflict (code) do nothing;

insert into employment_type (code, name, display_order)
values ('self_employed_professional', 'Self-Employed Professional', 20),
       ('proprietorship', 'Proprietorship', 21),
       ('partnership_llp', 'Partnership / LLP', 22),
       ('private_limited', 'Private Limited Company', 23),
       ('retired', 'Retired / Pensioner', 24),
       ('other_employment', 'Other', 25)
on conflict (code) do nothing;

update employment_type set name = 'Self-Employed Business' where code = 'self_employed';

-- "Other Loan Types" needs a product to open. It copies the shape of the
-- personal loan, the least demanding, and the checklist asks only for KYC.
insert into loan_product (code, name, description, category, variant, customer_product_id, security_type_id,
                          property_requirement_id, gst_requirement_id, is_active, display_order)
select 'other_loan', 'Other Loan', 'Anything the other loan types do not cover. Details go in Variant.',
       category, 'other', customer_product_id, security_type_id, property_requirement_id, gst_requirement_id, true, 999
  from loan_product
 where code = 'pl'
on conflict (code) do nothing;

-- Idle thresholds, one per new stage ------------------------------------------

insert into operational_threshold (key, value_days, description)
values ('idle_days.eligibility_check', 2, 'Days in Eligibility Check before a case needs attention.'),
       ('idle_days.documents_collected', 2, 'Days in Documents Collected before a case needs attention.'),
       ('idle_days.login_completed', 10, 'Days in Login Completed before a case needs attention.'),
       ('idle_days.query_raised', 3, 'Days in Query Raised by Bank before a case needs attention.'),
       ('idle_days.approved', 7, 'Days in Approved before a case needs attention.'),
       ('idle_days.sanction_accepted', 7, 'Days in Sanction Accepted before a case needs attention.')
on conflict (key) do nothing;

delete from operational_threshold
 where key in ('idle_days.new', 'idle_days.contacted', 'idle_days.appointment_fixed',
               'idle_days.ready_for_submission', 'idle_days.submitted', 'idle_days.sanctioned');

-- Grants: new tables none; new columns inherit the table's grants.
