-- ===========================================================================
-- 0042 — The "PFO Automation" system actor
--
-- Phase 4 of inbound bank-email ingestion auto-attaches a matched document by
-- calling the same uploadDocument() that a human upload uses (Backend/
-- documents.ts) — reused, not forked, so an auto-attached document behaves
-- identically to a human one in every downstream way (versioning, event log,
-- requirement satisfaction). That function requires an `Actor`, and there is
-- no logged-in human at the other end of an automated Gmail poll.
--
-- Two constraints had to both hold, not just one:
--
--   MUST be able to act. app.current_user_id() (0010) resolves the current
--   session's app_user by auth_identity_id and RLS's tier-B policies
--   (0033) refuse every operational table unless that resolves to a real,
--   ACTIVE row. is_active = false — the obvious way to mark a "no-login"
--   account — would make this actor unable to do anything at all, not just
--   unable to log in.
--
--   MUST NOT be able to log in. is_active = true normally means exactly
--   that. What actually blocks login (Backend/api-server.ts's login route)
--   is the password check, not is_active — and src/domain/auth/password.ts's
--   verifyPassword() fails closed (returns false, never throws) on any
--   stored value that isn't exactly `pbkdf2$<iterations>$<salt>$<hash>`. This
--   account's password_hash is deliberately not that shape, so login refuses
--   it unconditionally regardless of is_active — no hash to guess, no
--   plaintext to protect, just a format mismatch that can never pass.
--
-- LEAST PRIVILEGE. This actor is not given a role (managing_partner, the
-- only built-in role with document.upload at scope 'all', also carries
-- case.reopen, submission.create, offer.accept and everything else a
-- managing partner can do — none of which an inbound-mail poller should
-- ever be able to invoke). Instead it gets exactly two explicit grants via
-- user_permission_override (0029): document.read and document.upload, both
-- scope all. Nothing else. document.read is required just to look up which
-- requirement an attachment might satisfy (listCaseRequirements) before
-- deciding whether to upload against it — read-only, no larger a grant than
-- upload itself. A compromised or malfunctioning automation actor can upload
-- a document to the wrong case; it cannot verify one, submit one to a bank,
-- or touch anything outside documents.ts's own read/upload paths.
--
-- A FIXED, WELL-KNOWN ID. Both the person and the app_user rows use fixed
-- UUIDs so application code can reference this actor as a constant
-- (Backend/inbound-mail.ts) rather than querying for it by name every time.
-- ===========================================================================

insert into person (id, full_name)
values ('00000000-0000-0000-0000-0000000000f0', 'PFO Automation')
on conflict (id) do nothing;

insert into app_user (id, person_id, auth_identity_id, username, password_hash, is_active)
values (
  '00000000-0000-0000-0000-0000000000f1',
  '00000000-0000-0000-0000-0000000000f0',
  gen_random_uuid(),
  'pfo.automation',
  -- Not a `pbkdf2$...` value — verifyPassword() (src/domain/auth/
  -- password.ts) rejects any stored hash of the wrong shape before it even
  -- looks at the submitted password. This account cannot be logged into by
  -- anyone; there is no password, correct or otherwise, that would pass.
  'no-login$system-actor$pfo-automation',
  true
)
on conflict (id) do nothing;

comment on column app_user.password_hash is
  'A human employee''s pbkdf2$... hash (src/domain/auth/password.ts), '
  'EXCEPT for the seeded PFO Automation user (0042), whose value is '
  'deliberately not that shape — verifyPassword() rejects it unconditionally, '
  'so that account cannot be logged into by design, not by omission.';

insert into user_permission_override (user_id, permission, scope, decision, granted_by)
select '00000000-0000-0000-0000-0000000000f1', v.permission, 'all', 'grant', '00000000-0000-0000-0000-0000000000f1'
from unnest(array['document.read', 'document.upload']) as v(permission)
where not exists (
  select 1 from user_permission_override
  where user_id = '00000000-0000-0000-0000-0000000000f1'
    and permission = v.permission
);
