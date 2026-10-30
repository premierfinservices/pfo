-- ===========================================================================
-- 0044 — The MIS lifecycle's enum values (ADR-040)
--
-- A separate migration because a value added with ALTER TYPE cannot be used
-- until the transaction that added it commits, and 0045 uses them.
--
-- Old values stay: removing an enum value means rebuilding the type, and 0045's
-- check constraints already stop anything writing them.
-- ===========================================================================

alter type app.case_stage add value if not exists 'eligibility_check';
alter type app.case_stage add value if not exists 'documents_collected';
alter type app.case_stage add value if not exists 'login_completed';
alter type app.case_stage add value if not exists 'query_raised';
alter type app.case_stage add value if not exists 'approved';
alter type app.case_stage add value if not exists 'sanction_accepted';
alter type app.case_stage add value if not exists 'rejected';

alter type app.submission_status add value if not exists 'login_completed';
alter type app.submission_status add value if not exists 'not_eligible_precheck';
alter type app.submission_status add value if not exists 'sanction_accepted';

alter type app.lost_reason add value if not exists 'other';
