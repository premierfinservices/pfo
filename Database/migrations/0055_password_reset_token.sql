-- ===========================================================================
-- 0055 — "Forgot password" reset links (ADR-052)
--
-- An employee who cannot sign in asks for a reset on the login screen. The
-- server mails a one-time link to the office mailbox (not to the employee: no
-- email address is stored per employee), and whoever reads that mailbox
-- forwards it. This table holds the links.
--
-- Only the SHA-256 of the token is stored, as api_session does, so a database
-- backup yields no usable link. A link works once (used_at) and for 30 minutes
-- (expires_at). Rows are marked used, never deleted (BR-003).
--
-- Additive. Same access shape as api_session (0031, 0033): reachable before any
-- identity exists, because a reset is requested by someone who cannot sign in.
-- aos_app gets no DELETE, as everywhere else.
-- ===========================================================================

create table password_reset_token (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references app_user (id),

  -- SHA-256 hex of the token that went into the emailed link.
  token_hash  text        not null unique,

  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,

  -- Set when the link is used, or when a newer request for the same account
  -- replaces it. Null means the link is still live (until expires_at).
  used_at     timestamptz
);

comment on table password_reset_token is
  'A one-time "forgot password" link, mailed to the office mailbox. RULE: only the '
  'SHA-256 of the token is stored. A link works once and for 30 minutes. ADR-052.';

create index password_reset_token_user_idx
  on password_reset_token (user_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array[
    'password_reset_token'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end;
$$;

revoke all on password_reset_token from public;

grant select, insert, update on password_reset_token to aos_app;

create policy aos_app_login_path on password_reset_token
  for all to aos_app using (true) with check (true);
