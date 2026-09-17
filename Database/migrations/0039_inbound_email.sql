-- ===========================================================================
-- 0039 — Inbound bank email, raw
--
-- First piece of the inbound bank-email ingestion feature (AFTER INITIAL
-- PRODUCTION backlog). Every existing email table in this schema
-- (0030_document_submission_by_email.sql) is about mail PFO SENDS.
-- `Docs/Email and WhatsApp Integration.md` has said, until now, "PFO never
-- reads the mailbox" — this is the first table that exists because that is
-- about to stop being true for one narrow purpose: matching a bank's reply to
-- the submission it answers.
--
-- One row per Gmail message PFO has fetched. Nothing here decides what the
-- message MEANS — that is `inbound_classification_audit` (0040) and
-- `src/domain/communications/inbound-matching.ts`. This table only answers
-- "did we already see this message" and "what did we do with it", which is
-- also what makes re-polling the same inbox safe: the unique index on
-- `gmail_message_id` is the actual idempotency guarantee, not the Gmail
-- UNREAD label (a process restarted between fetching and un-marking a
-- message must not process it twice).
-- ===========================================================================

create table inbound_email (
  id                     uuid primary key default gen_random_uuid(),

  -- Gmail's own identifiers. `gmail_message_id` is the dedupe key: an
  -- `insert ... on conflict (gmail_message_id) do nothing` is what lets two
  -- overlapping poll cycles (a restart mid-batch) both attempt the same
  -- message without either double-processing it.
  gmail_message_id       text not null,
  gmail_thread_id        text not null,

  from_address           text not null,
  subject                text,
  received_at            timestamptz not null,

  -- Where the raw MIME payload and attachments were put via the existing
  -- storage adapter (the same one Backend/documents.ts uses) — a path, not
  -- the bytes themselves. Never re-derive a second storage mechanism for
  -- this; an inbound email's attachments are stored exactly like an
  -- employee's upload is.
  raw_storage_path       text not null,

  status                 text not null default 'fetched',

  -- Filled in by src/domain/communications/inbound-matching.ts. Both
  -- nullable: an email that cannot be matched to any case or bank contact
  -- still gets a row here (so the review queue has something to show), it
  -- just has nowhere automated to attach to.
  matched_bank_contact_id uuid references bank_contact (id),
  matched_loan_case_id    uuid references loan_case (id),

  created_at             timestamptz not null default now(),

  constraint inbound_email_status_known
    check (status in ('fetched', 'matched', 'unmatched', 'processed'))
);

comment on table inbound_email is
  'One Gmail message PFO has fetched from the inbox it also sends from '
  '(gmail.modify scope, added specifically for this). Existence of a row is '
  'the idempotency guarantee against re-polling the same message, not the '
  'Gmail UNREAD label, which is only a secondary signal.';

comment on column inbound_email.gmail_message_id is
  'Gmail''s message id. Unique below — the actual dedupe key. A process '
  'restarted mid-poll relies on the unique-violation-on-insert to know it '
  'already saw a message, independently of whether it also removed the '
  'UNREAD label before crashing.';

comment on column inbound_email.matched_bank_contact_id is
  'Which banker this looks like a reply from, per inbound-matching.ts. Null '
  'means unmatched — the email still gets a row, but nothing automated '
  'attaches to a case for it (Phase 4: routed to inbound_email_review_queue '
  'instead).';

create unique index inbound_email_gmail_message_id_unique
  on inbound_email (gmail_message_id);

create index inbound_email_thread_idx
  on inbound_email (gmail_thread_id);

create index inbound_email_matched_case_idx
  on inbound_email (matched_loan_case_id);

-- Case-derived data (ADR-027): governed by the case/bank-contact it matches,
-- same tier-B treatment as submission_package_email (0030) and every other
-- operational table. Same do-block-over-an-array shape 0030 and 0033 use —
-- 0033's own block only covers the tables that existed when it ran, so a
-- table created afterward repeats the pattern rather than being folded into
-- that one, but keeps the same quoted-array form the schema-coverage test
-- (src/domain/permissions/schema-coverage.test.ts) scans for.
do $$
declare
  t text;
begin
  foreach t in array array['inbound_email']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy aos_app_authenticated on %I for all to aos_app '
      'using (app.current_user_id() is not null) '
      'with check (app.current_user_id() is not null)', t);
  end loop;
end;
$$;

grant select, insert, update on inbound_email to aos_app;
