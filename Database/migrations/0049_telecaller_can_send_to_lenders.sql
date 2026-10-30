-- ===========================================================================
-- 0049 — A telecaller may send their own case's file to lenders
--
-- Tarun Ramesh, 30 October 2026: telecallers can send files to lenders. The MIS
-- lets anyone do it, and ADR-040 left this open until he decided.
--
-- Scope is `own`, like the telecaller's other case permissions, so a telecaller
-- sends only a case they own. Only `submission.create` is granted: updating a
-- lender's status (`submission.update_status`) stays with the login desk, since
-- sending was the question asked.
--
-- 0008 is applied and frozen, so the grant arrives here. roles.ts already holds
-- it, and seed.ts leaves it out of 0008 for the same reason
-- (GRANTED_AFTER_SEED). Additive: one row, nothing else touched.
-- ===========================================================================

insert into role_permission (role, permission, scope)
values ('telecaller', 'submission.create', 'own')
on conflict (role, permission) do update set scope = excluded.scope;
