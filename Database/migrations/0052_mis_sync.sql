-- ===========================================================================
-- 0052 — Live MCM cases synced from the MIS, and what the MIS reports count by
--
-- Until go-live the MIS is the working system for MCM. Backend/mis-sync.ts copies
-- its live cases into PFO one way and can be re-run any number of times, so each
-- copied record keeps the MIS ID it came from (ADR-046). Additive, except that
-- the case-number format now also admits the MIS's own numbers, so a case reads
-- the same in both systems while they run side by side.
-- ===========================================================================

alter table loan_case drop constraint loan_case_number_format;
alter table loan_case add constraint loan_case_number_format
  check (case_number ~ '^PF-\d{4}-\d{5,}$'
      or case_number ~ '^PRACTICE-\d{5,}$'
      or case_number ~ '^MCM-\d{4,}$');

alter table loan_case
  add column mis_case_id text,
  add column mis_managed boolean not null default false,
  add column mis_case_notes text,
  add column lead_received_on date,
  add column original_owner_user_id uuid references app_user (id),
  add constraint loan_case_mis_id_unique unique (mis_case_id),
  add constraint loan_case_mis_managed_has_id check (not mis_managed or mis_case_id is not null);

comment on column loan_case.mis_case_id is
  'The MIS Case ID this case was copied from. Stays after go-live as the link to the old record.';
comment on column loan_case.mis_managed is
  'True until go-live: the MIS owns this case, a re-run overwrites it from there, and the API '
  'refuses edits to it except document uploads, which the MIS does not hold (ADR-046).';
comment on column loan_case.lead_received_on is
  'The date the lead came in, which every lead report counts by. Differs from created_at on a '
  'back-entered MIS record, whose Created Timestamp is only the moment of entry.';
comment on column loan_case.original_owner_user_id is
  'Who gets cohort credit in the reports. As in the MIS, reassigning a case does not move it.';

-- Cases logged so far count from the day they were logged, by whoever owned them.
update loan_case
   set lead_received_on = (created_at at time zone 'Asia/Kolkata')::date,
       original_owner_user_id = owner_user_id;

alter table submission
  add column mis_application_id text,
  add constraint submission_mis_id_unique unique (mis_application_id);

-- submission is column-masked for aos_app (0034, 0050): a new column needs its own grant.
grant select (mis_application_id) on submission to aos_app;

alter table task
  add column mis_followup_id text,
  add constraint task_mis_id_unique unique (mis_followup_id);

-- A rejection must carry a category (BR-024). The MIS records only free text, and
-- choosing a real category on its behalf would be inventing a fact. Inactive, so it
-- is never offered on a screen; the MIS's words go in bank_reason_text beside it.
insert into rejection_reason (code, name, description, display_order, is_active)
values ('not_categorised_mis', 'Not categorised (from the MIS)',
        'The MIS records a rejection as free text. See what the bank said on the application.',
        999, false);
