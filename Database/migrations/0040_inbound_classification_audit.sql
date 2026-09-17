-- ===========================================================================
-- 0040 — Inbound email classification: the audit log and the review queue
--
-- Two tables, deliberately not one, because they answer different questions
-- and have different lifecycles:
--
--   inbound_classification_audit   WHAT THE MODEL SAID, every time it was
--                                   asked. Append-only, like `event` — a
--                                   decision that misfiled a financial
--                                   document must be traceable to the exact
--                                   model response that caused it, forever.
--   inbound_email_review_queue     WHAT A HUMAN STILL NEEDS TO LOOK AT. A
--                                   worklist: rows get resolved and stop
--                                   mattering. Mixing this with the audit
--                                   trail would mean either the audit trail
--                                   can be "resolved" away (losing history)
--                                   or the worklist accumulates rows nobody
--                                   ever needs to see again.
-- ===========================================================================

create table inbound_classification_audit (
  id                     uuid primary key default gen_random_uuid(),
  inbound_email_id       uuid not null references inbound_email (id),
  attachment_index       integer not null,

  document_type_code     text,
  confidence             numeric(4, 3) not null,

  -- The full Claude API response, verbatim. This is the record that lets a
  -- misclassification be understood after the fact rather than merely
  -- flagged — "why did it think this was a bank statement" has to be
  -- answerable from this column alone.
  raw_model_response     jsonb not null,

  decision               text not null,
  resulting_document_id  uuid references document (id),

  created_at             timestamptz not null default now(),

  constraint inbound_classification_audit_confidence_range
    check (confidence >= 0 and confidence <= 1),
  constraint inbound_classification_audit_decision_known
    check (decision in ('auto_attached', 'queued_for_review', 'attach_failed')),
  constraint inbound_classification_audit_attached_has_document
    check (decision <> 'auto_attached' or resulting_document_id is not null)
);

comment on table inbound_classification_audit is
  'Append-only log of every classification decision made about an inbound '
  'attachment, auto-attached or not. Never edited or deleted — the reason a '
  'document ended up (or did not end up) attached to a case must survive '
  'independently of whatever the review queue does with it afterward.';

comment on column inbound_classification_audit.raw_model_response is
  'The Claude API response, verbatim, not just the fields PFO acted on. '
  'Every field here is a claim to verify, not a fact (see '
  'inbound-classification.ts) — this is what lets a human check the claim '
  'later.';

create index inbound_classification_audit_email_idx
  on inbound_classification_audit (inbound_email_id);

-- Case-derived, same reasoning and do-block shape as 0039.
do $$
declare
  t text;
begin
  foreach t in array array['inbound_classification_audit']
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

-- Append-only, like `event` (0033 tier 2): select and insert, deliberately no
-- update — a log a compromised process could rewrite is not a log.
grant select, insert on inbound_classification_audit to aos_app;

-- ---------------------------------------------------------------------------
-- The review queue
-- ---------------------------------------------------------------------------

create table inbound_email_review_queue (
  id                     uuid primary key default gen_random_uuid(),
  inbound_email_id       uuid not null references inbound_email (id),
  attachment_index       integer not null,

  reason                 text not null,
  classification_snapshot jsonb,

  status                 text not null default 'pending_review',
  resolved_at            timestamptz,
  resolved_by            uuid references app_user (id),

  created_at             timestamptz not null default now(),

  constraint inbound_email_review_queue_status_known
    check (status in ('pending_review', 'resolved', 'dismissed')),
  constraint inbound_email_review_queue_resolution_is_complete
    check ((status = 'pending_review') = (resolved_at is null))
);

comment on table inbound_email_review_queue is
  'What still needs a human. Populated when an inbound attachment could not '
  'be confidently auto-attached (low confidence, no requirement match, or no '
  'case match at all). A resolved row stops being a worklist item but the '
  'classification decision that put it here stays in '
  'inbound_classification_audit regardless.';

comment on column inbound_email_review_queue.reason is
  'Why this needed a human: low_confidence / no_requirement_match / '
  'no_case_match / attach_failed. Free text rather than a check constraint '
  'because the review UI (a later milestone) is expected to grow more '
  'specific reasons without a migration each time.';

create index inbound_email_review_queue_status_idx
  on inbound_email_review_queue (status);

create index inbound_email_review_queue_email_idx
  on inbound_email_review_queue (inbound_email_id);

do $$
declare
  t text;
begin
  foreach t in array array['inbound_email_review_queue']
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

grant select, insert, update on inbound_email_review_queue to aos_app;
