# Practice cases — design spec

## Why

Testing or training on real workflows (e.g. the Banks → send-documents flow)
currently has no safe target: every case in the system is a real loan
application, so a test send permanently and correctly moves a real case
through stage history (`case.stage_changed` events, `Submitted` stage) and
into every dashboard/report tile. There is no way to undo that without
either lying about the case's audit trail (rejected — see "Alternatives
considered") or leaving real case data polluted by test activity.

This was discovered directly: a manual test of the Banks/send flow on real
case AL-2026-00005 moved it to `Submitted` and left a withdrawn test bank
row on it, and the case-stage engine (`Backend/case-stage.ts`) has no
backward transition by design — stage only advances from real facts, and
every step is an immutable, audited event. That refusal to rewind is
correct behavior for a lending compliance system and is not being changed.

## Goal

Give employees a way to create and drive a case through the exact same UI
and backend flow as a real case — including sending real test emails via
the Banks tab — without that activity ever appearing in reports, dashboards,
or the real case-number sequence.

## Non-goals

- Not building a rollback/undo for real case stage history. That
  capability is deliberately absent.
- Not adding extra confirmation/warnings to the send-documents flow itself.
  The existing flow (pick bank/branch, enter a real email/name, review,
  send) is unchanged for practice cases.
- Not restricting who can create a practice case beyond the normal
  `case.create` permission any employee already has.
- Not making `is_practice` editable after creation.

## Data model

New migration `Database/migrations/0037_practice_cases.sql`:

- `loan_case.is_practice boolean not null default false`.
- A new sequence and function mirroring the real case-number allocator
  (`app.allocate_case_number()`, ADR-024), producing a visually distinct
  series that can never collide with or consume a real `AL-YYYY-#####`
  number:

  ```sql
  create sequence app.practice_case_number_seq;

  create function app.allocate_practice_case_number() returns text
    language sql as $$
      select 'PRACTICE-' || lpad(nextval('app.practice_case_number_seq')::text, 5, '0')
    $$;
  ```

No other schema change. Case events (`case.stage_changed`, etc.) already
carry `case_id`; any query needing to know if an event belongs to a
practice case joins back to `loan_case.is_practice` — no event-level flag
is added.

## Case creation

`Backend/cases.ts`'s `createCase`:

- Accepts an optional `body.isPractice` boolean (default `false`).
- When `true`, calls `app.allocate_practice_case_number()` instead of
  `app.allocate_case_number()` for the case number.
- Inserts `is_practice` into the `loan_case` row alongside the existing
  columns. Every other column and validation path (applicant, product,
  intake facts, starting stage `'new'`) is unchanged.
- No permission gate beyond the existing `case.create` check — any
  employee who can create a case can mark it practice.
- `is_practice` is set once, at creation, and no endpoint (including
  `case.assign`, stage-mutation endpoints, or any admin route) accepts a
  change to it afterward. This is the property that prevents a real case
  from being retroactively relabeled practice (or vice versa) to hide or
  fabricate history.

Frontend: the "New case" screen (case creation form) gets one added
control — a checkbox labeled "Practice case (for testing/training — never
shows up in real reports)" — wired to `isPractice` in the create-case
request body.

## Stage engine and audit trail

No change to `Backend/case-stage.ts`. Practice cases go through
`advanceCaseStage` and `recordSystemCaseEvent` identically to real cases:
same guards, same one-event-per-step behavior, same immutability. The
"tag" distinguishing practice history from real history is simply
`loan_case.is_practice` on the case the event's `case_id` points to —
consistent with the decision to keep full audit fidelity for practice
cases rather than skip logging.

## Reporting and dashboard exclusion

Every query backing the Overview screen's tiles and lists adds
`and loan_case.is_practice = false` (or the equivalent join filter):

- Active cases, Needs attention, New leads, Pending documents, With a
  bank counts.
- Pipeline (volume by stage) bars.
- Team "busiest owners" active/attention counts.
- Recent activity feed ("Across the organisation").

These are the same queries backing `Frontend`'s Dashboard/Overview screen
observed in this session. Each gets the added predicate; no new endpoint
is introduced for this filtering.

## Frontend visibility

- All Cases list and search results: practice cases appear inline (not
  hidden), each with a small "Practice" badge next to the case-number
  pill, in the same visual slot as existing stage badges
  (`Ready for Submission`, `Submitted`, etc.).
- Case detail header shows the same "Practice" badge beside the case
  number, so the badge is visible throughout every screen of the
  workflow, including mid-task (e.g. the Banks tab), not just on first
  load.

## Testing

- Unit test on `createCase`: `isPractice: true` produces a case numbered
  `PRACTICE-00001` (or next in sequence), with `is_practice = true`
  persisted; a normal creation (`isPractice` omitted or `false`) is
  unaffected and still consumes the real sequence.
- Unit test(s) on the dashboard/report query layer: creating a practice
  case with submissions/events does not change the count/value returned
  by any of the tiles listed above, run against a case that would
  otherwise match (e.g. a practice case in `ready_for_submission` does
  not increment "Active cases" or appear in "Needs attention").
- No change needed to `Backend/mail-server.mjs` or its tests — the send
  path itself is identical for practice and real cases.

## Alternatives considered

- **Stage rollback / undo for real cases.** Rejected: it would add a way
  to erase or rewrite genuine submission history on a compliance-relevant
  system, for every real case, to solve a testing problem. The one-way
  stage engine is an intentional safety property (see `case-stage.ts`'s
  own comments) and this design does not touch it.
- **Separate dev/test database (`aos_dev`/`aos_test`) instead of a
  same-database flag.** Already the documented approach for engineering
  dev work (see `CLAUDE.md`'s two-PC topology section) but doesn't serve
  the case here: the need is for real employees to practice the real
  production UI/workflow (including a real mailbox send) without spinning
  up a parallel environment each time. The `is_practice` flag keeps
  practice activity in the same database and UI employees already use,
  while keeping it out of anything that matters for real reporting.
- **Reusing the real case-number sequence, tagging only via the column.**
  Rejected per stakeholder preference: a practice case number would then
  be visually indistinguishable from a real one anywhere it appears
  (emails sent to banks, search results, case lists), reintroducing the
  exact confusion this feature exists to prevent.

## Immediate cleanup (separate from this feature)

Real case AL-2026-00005 was moved to `Submitted` with one withdrawn
practice bank row (`State Bank of India — Gandhipuram`, addressed to a
test recipient) during manual testing of the send flow before this
feature existed. That case's history is accurate — a submission was made
and withdrawn — and is left as-is; this spec does not touch it.
