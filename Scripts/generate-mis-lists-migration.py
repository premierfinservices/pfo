"""Writes Database/migrations/0046_mis_lenders_places_checklists.sql.

Run once from the repo root. The output is committed; this script is kept so
the migration can be explained, not re-run: an applied migration never changes.

Inputs: PRD/data/mis_lenders.csv and PRD/data/mis_places.txt, taken from the
live MIS on 30 Oct 2026. Neither holds customer data.
"""
import csv
import re

OUT = "Database/migrations/0046_mis_lenders_places_checklists.sql"

# MIS name -> the name PFO already has. Tarun, 30 Oct 2026: keep PFO's names.
SAME_LENDER = {
    "The Coimbatore District Central Co-operative Bank": "Coimbatore District Central Co-operative Bank",
    "Home First Finance": "Home First Finance Company India",
    "Aptus Value Housing Finance": "Aptus Value Housing Finance India",
    "India Shelter Finance": "India Shelter Finance Corporation",
    "SMFG India Credit - Fullerton India": "SMFG India Credit",
    "Aditya Birla Capital": "Aditya Birla Finance",
}


def q(value):
    return "'" + value.replace("'", "''") + "'"


def slug(value):
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def lender_type(row):
    kind = row["lender_type"]
    if kind == "NBFC":
        return "nbfc", "nbfc"
    if kind == "Housing Finance Company":
        return "housing_finance_company", "hfc"
    name = row["name"]
    if "Small Finance" in name:
        return "small_finance_bank", "bank"
    if "Co-operative" in name:
        return "cooperative_bank", "bank"
    if row["active"] == "Inactive":
        return "public_sector_bank", "bank"
    return "private_sector_bank", "bank"


lenders = list(csv.DictReader(open("PRD/data/mis_lenders.csv", encoding="utf-8")))
places = [p.strip() for p in open("PRD/data/mis_places.txt", encoding="utf-8") if p.strip()]

values = []
for i, row in enumerate(lenders):
    pfo_name = SAME_LENDER.get(row["name"], row["name"])
    code, legacy = lender_type(row)
    types = [t.strip() for t in row["supported_loan_types"].split(";") if t.strip()]
    array = "array[" + ", ".join(q(t) for t in types) + "]::text[]"
    values.append(
        f"  ({q(pfo_name)}, {q(slug(pfo_name))}, {q(code)}, {q(legacy)}, "
        f"{'true' if row['active'] == 'Active' else 'false'}, {array}, {500 + i})"
    )

lender_values = ",\n".join(values)
place_values = ",\n".join(f"  ({q(slug(p))}, {q(p)})" for p in places)

# (code, name, document type, party roles or None for the case, financial years,
#  conditions as (fact, operator, values))
BUSINESS = ["self_employed", "self_employed_professional", "proprietorship", "partnership_llp", "private_limited", "business_owner", "other_employment"]
SALARIED = ["salaried", "retired"]
PROPERTY = ["lap", "lap_commercial", "lap_lrd", "lap_balance_transfer", "hl_purchase", "hl_plot_purchase", "hl_self_construct"]
NO_INCOME = ["gl_gold", "other_loan"]
KYC_ROLES = ["applicant", "co_applicant"]

RULES = [
    ("mis_pan", "PAN Card", "pan_card", KYC_ROLES, None, []),
    ("mis_aadhaar", "Aadhaar Card", "aadhaar_card", KYC_ROLES, None, []),
    ("mis_photo", "Photograph", "photograph", KYC_ROLES, None, []),
    ("mis_bank_statement", "Bank Statement", "bank_statement", ["applicant"], None,
     [("case.product_code", "not_in", NO_INCOME)]),
    ("mis_salary_slip", "Salary Slip", "salary_slip", ["applicant"], None,
     [("party.employment_type", "in", SALARIED), ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_form_16", "Form 16", "form_16", ["applicant"], None,
     [("party.employment_type", "in", ["salaried"]), ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_itr", "ITR", "itr", ["applicant"], 2,
     [("party.employment_type", "in", BUSINESS), ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_gst_3b", "GST 3B", "gst_returns", ["applicant"], 1,
     [("party.employment_type", "in", BUSINESS), ("case.is_gst_registered", "not_equals", ["false"]),
      ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_gst_certificate", "GST Certificate", "gst_certificate", ["applicant"], None,
     [("party.employment_type", "in", BUSINESS), ("case.is_gst_registered", "not_equals", ["false"]),
      ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_business_proof", "Udyam or Shop Licence", "udyam_certificate", ["applicant"], None,
     [("party.employment_type", "in", BUSINESS), ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_business_address", "Business Address Proof", "org_address_proof", ["applicant"], None,
     [("party.employment_type", "in", BUSINESS), ("case.product_code", "not_in", NO_INCOME)]),
    ("mis_sale_deed", "Sale Deed", "sale_deed", None, None, [("case.product_code", "in", PROPERTY)]),
    ("mis_parent_deed", "Parent Documents", "parent_document", None, None, [("case.product_code", "in", PROPERTY)]),
    ("mis_patta", "Patta & Chitta", "patta_chitta", None, None, [("case.product_code", "in", PROPERTY)]),
    ("mis_ec", "Encumbrance Certificate", "encumbrance_cert", None, None, [("case.product_code", "in", PROPERTY)]),
    ("mis_tax", "Property Tax Receipt", "property_tax_receipt", None, None, [("case.product_code", "in", PROPERTY)]),
    ("mis_plan", "Building Approval Plan", "approved_plan", None, None, [("case.product_code", "in", PROPERTY)]),
    ("mis_vehicle_quotation", "Vehicle Quotation", "vehicle_quotation", None, None,
     [("case.product_code", "in", ["vl_new_car", "vl_used_car", "vl_two_wheeler", "vl_commercial_vehicle"])]),
    ("mis_machinery_quotation", "Machinery Quotation", "machinery_quotation", None, None,
     [("case.product_code", "in", ["bl_machinery"])]),
    ("mis_lease_deed", "Registered Lease Deed", "lease_deed", None, None, [("case.product_code", "in", ["lap_lrd"])]),
    ("mis_admission", "Admission Letter", "admission_letter", None, None, [("case.product_code", "in", ["el_domestic"])]),
    ("mis_fee", "Fee Structure", "fee_structure", None, None, [("case.product_code", "in", ["el_domestic"])]),
]

rule_sql = []
for order, (code, name, doc, roles, years, conditions) in enumerate(RULES):
    scope = "party" if roles else "case"
    role_sql = ("array[" + ", ".join(q(r) for r in roles) + "]::app.case_party_role[]") if roles else "null"
    kind = q("person") if roles else "null"
    rule_sql.append(f"""insert into document_requirement_rule
  (code, name, document_type_id, scope, party_roles, party_kind, applicability_id, applicable_from_stage,
   financial_years, condition_match, is_active, display_order, notes)
select {q(code)}, {q(name)}, dt.id, {q(scope)}, {role_sql}, {kind}, a.id, 'documents_pending',
       {years if years else 'null'}, 'all', true, {order}, 'Short MIS checklist (ADR-040).'
  from document_type dt, requirement_applicability a
 where dt.code = {q(doc)} and a.code = 'mandatory';""")
    for position, (fact, operator, vals) in enumerate(conditions):
        arr = "array[" + ", ".join(q(v) for v in vals) + "]::text[]"
        rule_sql.append(f"""insert into document_requirement_rule_condition (rule_id, fact, operator, values, display_order)
select id, {q(fact)}, {q(operator)}, {arr}, {position} from document_requirement_rule where code = {q(code)};""")

sql = f"""-- ===========================================================================
-- 0046 — The MIS lender list, place list and short checklists (ADR-040)
--
-- GENERATED by Scripts/generate-mis-lists-migration.py from PRD/data/.
--
-- Lenders: PFO's names are kept (Tarun, 30 Oct 2026). Lenders already here get
-- the MIS's supported loan types; the rest are added, each with a Coimbatore
-- branch so a banker has somewhere to sit. All stay not on panel: none is a
-- confirmed tie-up. Public sector banks go inactive, as in the MIS.
-- ===========================================================================

create temporary table mis_lender (
  name text, code text, type_code text, legacy text, active boolean, types text[], display_order int
) on commit drop;

insert into mis_lender values
{lender_values};

insert into organisation (canonical_name, roles, industry, is_active)
select m.name, array['lender']::app.organisation_role[], 'Banking and Finance', m.active
  from mis_lender m
 where not exists (
   select 1 from organisation o where o.canonical_name = m.name and 'lender' = any (o.roles)
 );

insert into lender_profile (organisation_id, lender_type, lender_type_id, code, is_on_panel, display_order, supported_loan_types)
select o.id, m.legacy::app.lender_type, lt.id, 'mis_' || m.code, false, m.display_order, m.types
  from mis_lender m
  join organisation o on o.canonical_name = m.name and 'lender' = any (o.roles)
  join lender_type lt on lt.code = m.type_code
 where not exists (select 1 from lender_profile p where p.organisation_id = o.id);

update lender_profile p set supported_loan_types = m.types
  from mis_lender m
  join organisation o on o.canonical_name = m.name and 'lender' = any (o.roles)
 where p.organisation_id = o.id;

update organisation o set is_active = false
  from lender_profile p, lender_type lt
 where p.organisation_id = o.id and lt.id = p.lender_type_id and lt.code = 'public_sector_bank';

insert into organisation (canonical_name, roles, industry, city, parent_organisation_id)
select o.canonical_name || ' — Coimbatore', array['branch']::app.organisation_role[],
       'Banking and Finance', 'Coimbatore', o.id
  from organisation o
  join lender_profile p on p.organisation_id = o.id
 where o.is_active
   and not exists (select 1 from organisation b where b.parent_organisation_id = o.id and 'branch' = any (b.roles));

insert into bank_branch (organisation_id, city_id, district_id, operational_status, notes)
select b.id, c.id, c.district_id, 'operational',
       'Added with the MIS lender list, geography only. Rename it to the real branch when known.'
  from organisation b
  join organisation o on o.id = b.parent_organisation_id
  join lender_profile p on p.organisation_id = o.id
  cross join (select id, district_id from city where code = 'coimbatore') c
 where 'branch' = any (b.roles)
   and not exists (select 1 from bank_branch bb where bb.organisation_id = b.id);

-- Places: the MIS list, in capitals. No district, by Tarun's choice. ------------

insert into city (code, name, display_order)
select v.code, v.name, 100
  from (values
{place_values}
  ) as v(code, name)
 where not exists (select 1 from city c where upper(c.name) = v.name)
on conflict (code) do nothing;

-- A few were on file but switched off, such as Chennai and Madurai.
update city c set is_active = true
  from (values
{place_values}
  ) as v(code, name)
 where upper(c.name) = v.name and not c.is_active;

-- Checklists: the old rules stay on file, inactive. -----------------------------

update document_requirement_rule set is_active = false where is_active;

{chr(10).join(rule_sql)}
"""
open(OUT, "w", encoding="utf-8", newline="\n").write(sql)
print("wrote", OUT, "lenders", len(values), "places", len(places), "rules", len(RULES))
