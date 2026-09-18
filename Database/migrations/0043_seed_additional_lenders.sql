-- ===========================================================================
-- 0043 — Additional lenders: RBI-list gaps identified against 0020/0025
--
-- Hand-written seed data, same convention and reasoning as 0020 (ADR-025).
-- This is a gap-fill, not a re-architecture: no new tables, no schema change.
--
-- SOURCING. Each institution below was verified this pass against RBI's
-- published bank/NBFC categorisation and, where reachable, the institution's
-- own official site (see chat record 2026-09-17). Two institutions were
-- flagged during research but are NOT in this migration because verification
-- could not be completed against a working, non-parked, non-blocked source:
-- Mahindra & Mahindra Financial Services (site returned HTTP 403), IIFL
-- Finance / IIFL Home Finance (no legal entity name found, marketing copy
-- only), Godrej Capital / Godrej Housing Finance (brand name only, no legal
-- entity name), Vastu Housing Finance (the URL on file is a parked domain).
-- Fedbank Financial Services, Bandhan Bank and DCB Bank were also held back:
-- legal name confirmed but head-office city and Tamil Nadu/Coimbatore
-- presence were not — adding them with a guessed city would be exactly the
-- fabrication 0020 refuses to do. All seven remain a follow-up pass once
-- verified.
--
-- As with 0020: institution name, type and head-office city only. No
-- branches beyond the same geography-only Coimbatore stub every other active
-- lender gets, no relationship managers, no product limits or rates.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Part 1 — the institutions.
-- ---------------------------------------------------------------------------

insert into organisation (canonical_name, roles, industry, city, is_active)
select v.name, array['lender']::app.organisation_role[], 'Banking and Finance', v.head_office, true
from (values
  -- Public sector banks (RBI list — not in 0020)
  ('Bank of Maharashtra',      'Pune'),
  ('Punjab & Sind Bank',       'New Delhi'),
  -- Private sector banks (RBI list — not in 0020)
  ('Yes Bank',                 'Mumbai'),
  ('RBL Bank',                 'Mumbai'),
  -- Small finance banks (RBI list — not in 0020/0025)
  ('Capital Small Finance Bank', 'Jalandhar'),
  ('Suryoday Small Finance Bank', 'Mumbai'),
  -- NBFCs
  ('Piramal Finance',          'Mumbai'),
  ('SMFG India Credit',        'Mumbai')
) as v(name, head_office)
where not exists (
  select 1 from organisation o
  where o.canonical_name = v.name and 'lender' = any (o.roles)
);

insert into lender_profile (
  organisation_id, lender_type, lender_type_id, code, head_office_city,
  primary_service_region, website_url, is_on_panel, display_order, notes
)
select
  o.id,
  v.legacy_enum::app.lender_type,
  lt.id,
  v.code,
  v.head_office,
  v.region,
  v.website,
  v.on_panel,
  v.display_order,
  v.notes
from (values
  -- code                code name                                          type code                    legacy  head office   service region                          website                                 panel  order  notes
  ('bank_of_maharashtra', 'Bank of Maharashtra',                             'public_sector_bank',       'bank', 'Pune',       'Pan-India, strongest in Maharashtra',  'https://bankofmaharashtra.in',        true,   80,  null),
  ('psb',                 'Punjab & Sind Bank',                              'public_sector_bank',       'bank', 'New Delhi',  'Pan-India, strongest in North India',  'https://punjabandsindbank.co.in',     true,   90,  null),

  ('yes_bank',            'Yes Bank',                                        'private_sector_bank',      'bank', 'Mumbai',     'Pan-India',                            'https://yesbank.in',                  true,  220,  null),
  ('rbl_bank',            'RBL Bank',                                        'private_sector_bank',      'bank', 'Mumbai',     'Pan-India',                            'https://rblbank.com',                 true,  230,  null),

  ('capital_sfb',         'Capital Small Finance Bank',                      'small_finance_bank',       'bank', 'Jalandhar',  'North India',                          'https://capitalbank.co.in',           true,  240,
    'RBI-licensed small finance bank; verified via RBI''s published SFB list this pass. Tamil Nadu/Coimbatore branch presence not confirmed — treat as pan-India until an office confirms a local branch.'),
  ('suryoday_sfb',        'Suryoday Small Finance Bank',                     'small_finance_bank',       'bank', 'Mumbai',     'Pan-India, strongest in West and South India', 'https://suryodaybank.com',       true,  250,
    'RBI-licensed small finance bank; verified via RBI''s published SFB list this pass. Tamil Nadu/Coimbatore branch presence not confirmed.'),

  ('piramal_finance',     'Piramal Finance',                                 'nbfc',                     'nbfc', 'Mumbai',     'Pan-India',                            'https://piramalfinance.com',          true,  380,
    'Legal name is Piramal Finance Limited, rebranded from Piramal Capital & Housing Finance Limited. Recorded here under its market name per this catalogue''s convention (see HDFC Bank''s row in 0020); NBFC vs HFC split with the RBI register not independently confirmed this pass. Tamil Nadu/Coimbatore branch presence not confirmed.'),
  ('smfg_india_credit',   'SMFG India Credit',                               'nbfc',                     'nbfc', 'Mumbai',     'Tamil Nadu and pan-India',             'https://smfgindiacredit.com',         true,  390,
    'Formerly Fullerton India. CIN confirms Tamil Nadu company registration; official site explicitly lists Coimbatore personal/business loan service pages, so Coimbatore presence is confirmed rather than assumed — unusual for this catalogue and noted for that reason.')
) as v(code, name, type_code, legacy_enum, head_office, region, website, on_panel, display_order, notes)
join organisation o on o.canonical_name = v.name and 'lender' = any (o.roles)
join lender_type lt on lt.code = v.type_code
where not exists (select 1 from lender_profile lp where lp.organisation_id = o.id);

-- The market name Fullerton India is still in circulation; alias it so a
-- typed search still finds SMFG India Credit rather than coming up empty.
insert into organisation_alias (organisation_id, alias, alias_normalised, source)
select o.id, v.alias, lower(v.alias), 'typed_by_user'::app.alias_source
from (values
  ('SMFG India Credit', 'Fullerton India'),
  ('Punjab & Sind Bank', 'PSB')
) as v(name, alias)
join organisation o on o.canonical_name = v.name and 'lender' = any (o.roles)
where not exists (
  select 1 from organisation_alias a
  where a.organisation_id = o.id and a.alias_normalised = lower(v.alias)
);

-- ---------------------------------------------------------------------------
-- Part 2 — the same geography-only Coimbatore branch stub 0020 gives every
-- other active institution. No address, no phone, no email — an office user
-- renames it to the real branch, exactly as 0020's own comment describes.
-- ---------------------------------------------------------------------------

insert into organisation (canonical_name, roles, industry, city, parent_organisation_id)
select o.canonical_name || ' — Coimbatore', array['branch']::app.organisation_role[],
       'Banking and Finance', 'Coimbatore', o.id
from organisation o
join lender_profile lp on lp.organisation_id = o.id
where o.is_active
  and o.canonical_name in (
    'Bank of Maharashtra', 'Punjab & Sind Bank', 'Yes Bank', 'RBL Bank',
    'Capital Small Finance Bank', 'Suryoday Small Finance Bank',
    'Piramal Finance', 'SMFG India Credit'
  )
  and not exists (
    select 1 from organisation b
    where b.parent_organisation_id = o.id and 'branch' = any (b.roles)
  );

insert into bank_branch (organisation_id, city_id, district_id, operational_status, notes)
select b.id, c.id, d.id, 'operational',
       'Seeded as this lender''s Coimbatore presence, with geography only. '
       'Rename it to the actual branch and fill in the address, phone and '
       'email — the migration that created it deliberately did not guess them.'
from organisation b
join organisation o on o.id = b.parent_organisation_id
join lender_profile lp on lp.organisation_id = o.id
cross join (select id from city where code = 'coimbatore') c
cross join (select id from district where code = 'coimbatore') d
where 'branch' = any (b.roles)
  and b.canonical_name = o.canonical_name || ' — Coimbatore'
  and not exists (select 1 from bank_branch bb where bb.organisation_id = b.id);

-- ===========================================================================
-- What is NOT in this migration, and why — same rule as 0020
--
-- No relationship managers, no branch addresses/phones/emails beyond the
-- Coimbatore geography stub, no turnaround days, no product limits or rates,
-- no lender insights. Bankers are operational master data entered by
-- authorized PF1 users through the Bankers screen, never invented here.
--
-- Held back this pass (verification incomplete, see header): Mahindra &
-- Mahindra Financial Services, IIFL Finance / IIFL Home Finance, Godrej
-- Capital / Godrej Housing Finance, Vastu Housing Finance, Fedbank Financial
-- Services, Bandhan Bank, DCB Bank.
-- ===========================================================================
