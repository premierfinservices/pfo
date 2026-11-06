-- ===========================================================================
-- 0053 — A case may be disbursed by several lenders; every MIS sync run is kept
--
-- BR-022 said a case could have at most one disbursed application. The MIS says
-- otherwise: MCM-0036 was disbursed by three lenders between 31 Oct and 3 Nov
-- 2026, and Tarun confirmed all three are real (6 Nov 2026, ADR-047). Because the
-- index refused the second one, every sync run from 3 Nov 14:30 rolled back and
-- PFO stopped hearing from the MIS. The MIS's own reports already count
-- customers disbursed and applications disbursed separately.
--
-- mis_sync_run keeps one row per applied sync, so a failure shows on screen
-- instead of only in a log file nobody reads.
-- ===========================================================================

drop index submission_one_disbursed_per_case;

create table mis_sync_run (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null,
  finished_at timestamptz not null default now(),
  outcome     text not null check (outcome in ('ok', 'issues', 'failed')),
  issues      jsonb not null default '[]'::jsonb
);

comment on table mis_sync_run is
  'One row per applied MIS sync (Backend/mis-sync-cli.ts --apply). Issues carry MIS IDs and '
  'closed-list words only, never a customer''s name or number (ADR-018).';

create index mis_sync_run_finished_idx on mis_sync_run (finished_at desc);

-- Same row-security pattern as 0039: the API reads it only for a signed-in user
-- (who may see office-wide reports, checked in Backend/reports.ts). Only the
-- sync, connecting as the admin role, writes it.
do $$
declare
  t text;
begin
  foreach t in array array['mis_sync_run']
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

grant select on mis_sync_run to aos_app;
