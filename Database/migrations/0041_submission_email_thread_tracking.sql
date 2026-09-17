-- ===========================================================================
-- 0041 — Thread tracking on outgoing submission emails
--
-- Inbound matching's strongest signal (src/domain/communications/
-- inbound-matching.ts) is "this reply is in the same Gmail thread as an
-- email we sent" — Gmail groups replies into threads automatically, which is
-- more reliable than parsing In-Reply-To/References headers by hand. That
-- requires knowing, for each outgoing email, what Gmail called it.
--
-- submission_package_email (0030) predates any inbound concern and says so:
-- 0030's own header lists what it does NOT do, and this is additive to that,
-- not a reopening of it. Both columns are nullable because every row sent
-- before this migration has neither, and backfilling a past send's Gmail ids
-- is not possible after the fact.
-- ===========================================================================

alter table submission_package_email
  add column gmail_message_id text,
  add column gmail_thread_id  text;

comment on column submission_package_email.gmail_message_id is
  'The id Gmail assigned this outgoing email, captured from the send '
  'response. Null for anything sent before this column existed, and for '
  'anything sent through a non-Gmail provider. Used only to correlate an '
  'inbound reply to the submission it answers (inbound-matching.ts) — not '
  'shown to the user.';

comment on column submission_package_email.gmail_thread_id is
  'The Gmail thread this email belongs to. A reply landing in the same '
  'thread (inbound_email.gmail_thread_id) is the strongest available signal '
  'that it answers this particular submission, stronger than matching on '
  'sender address alone.';

create index submission_package_email_gmail_thread_idx
  on submission_package_email (gmail_thread_id)
  where gmail_thread_id is not null;
