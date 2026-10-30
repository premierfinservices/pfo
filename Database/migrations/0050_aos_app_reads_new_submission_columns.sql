-- ===========================================================================
-- 0050 — aos_app can read the submission columns 0045 added
--
-- THE GAP. Migration 0034 (column masking, ADR-026) revoked table-wide SELECT on
-- `submission` from aos_app and re-granted it column by column, for the columns
-- the table had then, so that `login_fee_amount` stays unreadable. Migration 0045
-- (the intake and work engine, ADR-040) added nine columns to `submission`
-- (banker_name, login_date, login_employee_id, approved_amount, sanction_date,
-- sanction_acceptance_date, disbursement_amount, disbursement_date, and one more)
-- and granted nothing, so aos_app could not read them. The first query to name
-- one, the case summary behind Log a Case and Update Case, fails with
-- "permission denied for table submission" for aos_app and works for the
-- superuser every earlier test ran as. Found by Backend/security-workflows.test.ts
-- when a telecaller sending a file was tested under aos_app.
--
-- THE FIX. Repeat 0034's loop: grant SELECT on every column except the masked
-- one. Granting a column already granted does nothing, so this is safe to rerun.
-- Writes were never affected: INSERT and UPDATE on `submission` are table-level
-- (0033). `login_fee_amount` stays masked, and Backend/app-role-column-grants.test.ts
-- checks that every masked table is readable except its masked column, so the
-- next column added fails there instead of in production.
-- ===========================================================================

do $$
declare
  col text;
begin
  for col in
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'submission'
       and column_name <> 'login_fee_amount'
  loop
    execute format('grant select (%I) on submission to aos_app', col);
  end loop;
end;
$$;
