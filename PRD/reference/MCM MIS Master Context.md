<!-- Verbatim copy of the MCM MIS project notes (CLAUDE.md in C:\WORK FILES\Mint Capital Management\MIS\), copied 30 Oct 2026. Source of how the MIS behaves; Tarun asked for it to be kept here as development context. It is Excel build history as much as business rules; Docs/Resume on Home PC.md says which parts matter to PFO. Not edited. -->

# MCM MIS — project context for Claude

Mint Capital Management (MCM): loan DSA / facilitation business, sole proprietorship owned by V. Keerthivhasan
(spec spelled it "Keerthivasan" — unresolved [X]). Tarun Ramesh is manager. MCM facilitates loans via banks/NBFCs; it is never the lender.
Read `C:\Tarun\TARUN_MASTER_CONTEXT.md` first (global rule). Spec: `C:\Tarun\prompts\MCM_Excel_MIS_Full_Specification.md`.

## CUTOVER DONE (15-Oct-2026 evening): `MIS.xlsm` is now **v1.1** (sha 0b4f8b78…), migrated with APP-0001 excluded. v1.0 is `Retired\MIS_v1.0_retired_2026-10-15.xlsm` (read-only, sha 67862218…). Trusted Location = this folder only, subfolders NOT trusted. Pre-migration backup: `D:\MCM_Backups\pre-migration_2026-10-15`. First-open checks passed and released to staff 18:25 (§14.9; sha now changes with every save). Trusted Documents records for MIS files were removed: never click Enable Content on `Retired\`. Log: decisions report §14.7–14.9. Notes below that call MIS.xlsm "unchanged" or v1.0 are history.

## DASHBOARD APPEARANCE ROUND 1 (30-Oct-2026): CANDIDATE, NOT LIVE. Awaiting Tarun's "migrate to live".
Staging `D:\MCM_Hardening_2026-10-15\staging\dashboard_visual_2026-10-30\`: `MIS_visual_candidate.xlsm` (built from live sha 64f419de...; if live is saved since, rebuild with `src\build\add_dashboard_visual.ps1 -Src <fresh copy> -Out <new> -VbaDir src\vba`, AccessVBOM on then off), practice `TRY_Dashboard_Visual_DEMO.xlsm` (fictional).
What it adds: header band + greeting (S2), bigger KPI cards, "Needs attention" panel S:V (4 tiles + 3 lists, honours View as, double-click drills), funnel/2 donuts/monthly trend charts (old Chart 6 removed; helpers Lists & Settings BW:CG, names hlp_SrcLabel/hlp_SrcValue), auto-fit zoom on open, headings + formula bar off on Dashboard, reserved empty rows auto-hidden, legend moved to Start Here row 45. No row/column inserted; every existing cell address kept.
Tests: test_visual 91/91 demo, 101/101 candidate; test_dash 44/44, 59/59; test_quick 114/114; test_edit 79/79. wb_diff: no table data, no existing formula changed. wb_diff prints nothing when redirected (os._exit): read its JSON. Not yet tested: a real open with events on (name box, FitDashboard in Workbook_Open) and real mouse double-click on the panel. Round 2 ideas not built: 6-card row, employee chart, in-cell visuals, other sheets' styling.

## MANAGEMENT VIEW REDESIGN (30-Oct-2026): swapped in on Tarun's "migrate to live"; check `D:\MCM_Backups\pre-mgmt-view_2026-10-30\` for the pre-swap copy.
Script `src\build\style_mgmt_view.ps1` (after tidy_sheets.ps1), source `src\vba\modDash.bas`, test `test_mgmt.py` 71/71 demo, 102/102 real data. Metric strip in frozen band (C1:K2), period box L2 (name sel_MgmtPeriod, two-way with Dashboard L2), jump buttons row 3, 6 charts, helpers Lists & Settings CP:CY (CV #N/A deliberate, as CG), spare rows and zero-count checks auto-hidden (TidyMgmtRows), toggle button. Table addresses unchanged. VBA rule learned: module-level variables must sit above the first procedure or the project will not compile; run new macros in hidden Excel with a watchdog first (compile_check.py in staging) so no dialog reaches Tarun's screen. Sanctions rule everywhere = Sanction Date in period AND amount > 0. Real data: one application has a sanction date with no amount.

## SHEET TIDY (30-Oct-2026): LIVE since 30-Oct-2026 (Tarun: "migrate to live")
Pre-swap copy `D:\MCM_Backups\pre-tidy_2026-10-30\MIS_before_tidy.xlsm` (sha C6BC23BA...). Script `src\build\tidy_sheets.ps1` (formats + 2 Start Here lines; no VBA, so no AccessVBOM needed), test `test_tidy.py` 67/67.
Removed buttons: New Lender Application, Send to Several Lenders, New Follow-up (Customers), New Follow-up for application (Lender Applications); macros stay. ui_acceptance.py B06-style clicks, ui_multilender.py and test_multilender M05 expect those buttons and now need updating. User Guide PDF may still mention them. Data sheets: rows 24 pt including new rows, body no wrap, columns at least 30, zoom 80. Follow-up Log: Overdue / Due Today colour only Due Date and Due State. Archive sheet not resized (form layout).

## DASHBOARD APPEARANCE ROUNDS 1 + 2 (30-Oct-2026): LIVE since 30-Oct-2026 (Tarun: "migrate to live"). The "candidate" wording in this section and the round 1 section below is history.
Live sha after swap E13E8B48... (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-visual_2026-10-30\MIS_before_visual.xlsm` (sha 64F419DE...). Read-only open check: 37 customers, 25 apps, 85 follow-ups, 6 charts, 5 sparkline groups, Dashboard protected; the only 10 error cells are the deliberate #N/A in Lists & Settings CG (hide zero-month dots). Open check: first user open after the swap.
Staging `D:\MCM_Hardening_2026-10-15\staging\dashboard_visual2_2026-10-30\`: `MIS_round2_candidate.xlsm` (live sha 64f419de... + add_dashboard_visual.ps1 + add_dashboard_visual2.ps1, same args; AccessVBOM on then off), practice `TRY_Dashboard_Round2_DEMO.xlsm`.
Adds: chtEmployees (S36), data bars, traffic-light icons, 6-month sparklines (helpers Lists & Settings CI:CN), Full screen button, teal band rows 1-2 + no gridlines on other sheets, status chips on Customers/Lender Applications, data rows capped at 48 pt, Bankers styled. Not done: form fonts, 6-card row, Management View gap. Tests: test_visual2 23 demo / 29 candidate, test_visual 91 / 101, test_dash 44 / 59, test_quick 114, test_edit no failures.

## INTERACTIVE DASHBOARD (28-Oct-2026): LIVE since 28-Oct-2026 (Tarun: "migrate to live")
Live sha after swap 4843BE58... (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-dashboard_2026-10-28\MIS_before_dashboard.xlsm` (sha 433ED05E...). Candidate was rebuilt from that copy (Tarun had saved live at 20:14). Open check: first user open after the swap.
Tarun asked for: click-to-drill, View-as filter, trend vs previous period, card styling (all four; filters stay until "Clear filters").
Staging `D:\MCM_Hardening_2026-10-15\staging\dashboard_interactive_2026-10-28\MIS_dashboard_candidate.xlsm` (built from live sha dccdefda...; if live is saved since, rebuild
with `src\build\add_dashboard_interactive.ps1 -Src <fresh copy> -Out <new> -VbaDir src\vba`, AccessVBOM on then off). Practice file (fictional): same folder, `TRY_Dashboard_DEMO.xlsm`.
What it does: double-click a KPI card, pipeline status, Active/Archived, employee-table count, or a Case ID in the pending lists -> matching rows filtered on Customers / Lender
Applications / Follow-up Log (list rows = the number clicked, tested). "View as" box Dashboard L5 (name sel_ViewAs; cases assigned, applications logged in, follow-ups owned) drives the 8 KPI
cards, pipeline and Active/Archived only; lead tables, employee tables and charts still show everyone. Reset to Everyone on open (ResetViewAs in Workbook_Open). Delta arrows + sparklines only on the 3
period cards (customers disbursed, apps disbursed, disbursement value); "Now" cards have no history to trend. Helper block Lists & Settings BN:BU. Clear filters button on 4 sheets.
Tests: `src\build\test_dash.py` 44/44 on demo, 59/59 on the real-data candidate (copies); test_quick 114/114, test_edit 79/79; real mouse double-click verified on the practice file. wb_diff: Dashboard cells/formulas,
Lists & Settings helper block, 9 names, VBA modDash + Dashboard sheet + ThisWorkbook only. Cannot do in cells: shadows/hover/animation. Source: `src\vba\modDash.bas`.

## OPENING NAME -> CURRENT USER (27-Oct-2026): LIVE since 27-Oct-2026 (Tarun: "migrate to live")
The name picked in the open-time box now also fills the Dashboard "Current user" cell (modAccessLog.SetCurrentUserTo; only modAccessLog changed).
Live sha after swap 5DBD442A… (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-access-user_2026-10-27\MIS_before_access_user.xlsm` (sha 16601D4D…).
Staging: `D:\MCM_Hardening_2026-10-15\staging\access_current_user_2026-10-27\`. Open check: first user open after the swap.

## EDIT A CASE (26-Oct-2026): LIVE since 26-Oct-2026 (Tarun: "migrate to live")
Live sha after swap 3BF98FA8… (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-edit-case_2026-10-26\MIS_before_edit_case.xlsm` (sha 2F07A879…).
Amber button "Edit a Case (Ctrl+Shift+E)" after Update Case on Dashboard / Customers / Lender Applications / Follow-up Log. MANAGERS ONLY (Role = Manager:
Tarun EMP-007, Keerthivhasan EMP-008, Sasi Rekha EMP-009; Current user is self-declared, not a login). Edits every typed field of a case, its applications
and follow-ups (closed cases too via tick box); locked: IDs, formula columns, created-by stamps, record location. All values checked first, all-or-nothing;
each changed field goes to the Change Log (old/new, note "via Edit a Case form"). Real delete (follow-up / application / whole case): backup copy first
(no backup, no delete), Yes + typed DELETE, full record text kept in the Change Log; a case takes its apps and follow-ups, an application leaves its
follow-ups with the link cleared; IDs never reused.
Source: `src\vba\modEdit.bas`, `frmEditCase.formcode`, `src\build\add_edit_case.ps1` (after add_bankers / add_lenders_places), tests `src\build\test_edit.py` 79/79
(test_quick 114/114). Staging `D:\MCM_Hardening_2026-10-15\staging\edit_case_2026-10-26\` (candidate, fictional practice file TRY_Edit_Case_DEMO.xlsm).
wb_diff: no cell/formula/name/dropdown change; other modules differ by letter case only. NOT built yet: "Back-entry (old disbursed case)" button
(awaiting Tarun's answers: fill unknown dates with disbursement date + mark BACK-ENTRY, and login employee = the manager entering).

## MORE LENDERS + PLACE LIST (26-Oct-2026): LIVE since 26-Oct-2026 (Tarun: "build and migrate")
Live sha after swap 6B44C721… (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-lenders-places_2026-10-26\MIS_before_lenders_places.xlsm` (sha EA9D0CCC…).
Lender Master 69 -> 115 rows (46 new, all Active / Not verified: DCB, 8 more SFBs, Standard Chartered, HSBC, NBFCs, HFCs; no IDBI / Nainital / J&K).
LND-043 renamed "SMFG India Credit - Fullerton India" (no application used the old name). Lenders went in through the workbook's own handler (IDs LND-070..115, Change Log).
New table tblPlaces (Lists & Settings col BL, name nm_Place): 38 districts + towns (corporation / municipality / taluk HQ), 262 entries, CAPITALS.
Customers[City / Location] is a dropdown of it with no error alert (any other place may still be typed). Log a Case place list = tblPlaces + places already used;
the place is now stored in CAPITALS (modQuick). No district is stored with the town (Tarun's choice). Existing stray spelling TIRUPUR (1 customer) left as typed.
Source/tooling: `src\build\add_lenders_places.ps1`, `src\vba\modQuick.bas`; data + review file in `D:\MCM_Hardening_2026-10-15\staging\lenders_places_2026-10-26\`. test_quick 113/114 -> test expectation updated (place in capitals).
Open check: first user open after the swap; the HFC/NBFC names and town list are from public category lists and own knowledge, not verified against RBI registers.

## BANKERS / ANYONE LOGS IN / AMOUNT WORDS (26-Oct-2026): LIVE since 26-Oct-2026 (Tarun: "migrate to live")
Live sha after swap 1BA3AFC8… (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-bankers_2026-10-26\MIS_before_bankers.xlsm` (sha D39FAA8E…).
Read-only open check after swap: Bankers sheet present, tblApps ends with Banker Name (20 apps), 37 customers, 0 error cells.
The "candidate / pending" wording below is history.
Tarun asked: (1) banker name per lender when sending, typed once then a dropdown per bank; (2) "Logged in by" lists every
active employee, not just the Login Team role; (3) amounts in words under every money box in Update Case.
Built by `src\build\add_bankers.ps1` (after add_quick_entry): new sheet "Bankers" / tblBankers (Bank / NBFC, Banker Name, Added On, Added By),
tblApps + "Banker Name" (appended at the end), Login Team Employee ID DV = hlp_AllActive, modEvents/TakeLoginEmp accept any active employee,
Dashboard C53 + Management View C64 also list anyone who has logged a file in; Update Case is 60 pt taller.
Staging: `D:\MCM_Hardening_2026-10-15\staging\bankers_2026-10-26\` — candidate `MIS_bankers_candidate.xlsm` (from live sha D39FAA8E…),
practice `TRY_Bankers_DEMO.xlsm` (fictional). wb_diff: only Bankers sheet, tblApps col AG, C53/C64, one DV, 3 VBA modules. test_quick 114/114.
If live has been saved since D39FAA8E…, rebuild the candidate from a fresh copy (AccessVBOM on, then off).

## QUICK-ENTRY FORMS (24-Oct-2026): LIVE since 24-Oct-2026 16:55 (Tarun: "migrate to live")
Live sha after swap D9A07848… (changes with every save). Pre-swap copy: `D:\MCM_Backups\pre-quick-entry_2026-10-24\MIS_before_quick_entry.xlsm`
(sha 2B4D7FE1…). Read-only open check after swap: 4 sheets have both buttons, 17 loan types, Dashboard top-10 box OK, 0 error cells, 36 customers.
The "Candidate built…/Promotion pending" lines below are history.
Rule (Tarun 24-Oct): only customers who have PROMISED DOCUMENTS enter the MIS; ordinary calls are not logged.
"Log a Case" (Ctrl+Shift+K): type name, mobile, place, amount (25L / 1.5cr); pick loan type, variant, lead source, employment type,
telecaller (defaults to current user), document pickup date. Creates the case (Documents Pending / docs Pending) + a "Collect documents"
follow-up; asks before creating a duplicate mobile. Variant (Fresh/Takeover/Top-up/OD/CC/Term/…) goes into "Other Loan Type Description".
Log a Case also warns about a duplicate mobile while it is typed, shows the amount in words, and stores names in CAPITALS.
"Update Case" (Ctrl+Shift+B): pick the customer (own cases by default; managers see everyone's; due/overdue first), then three tabs:
Case = documents received all / partly / pending (+ next collection date), reschedule (Tomorrow / +3 / next week), customer dropped = close;
Send to lenders = tick lenders (those whose Supported Loan Types match come first, starred); Applications = tap an app and one of its next
statuses, fill only the blank fields that status needs. Tarun: ANYONE may close a case from this form (modArchive.ArchiveCase got Optional
anyEmployee); the Archive sheet and Restore stay manager-only. Buttons on Dashboard, Customers, Lender Applications, Follow-up Log.
The script also replaces the unused "Loan Against Securities" (Tarun: not an MCM product) with new loan types (17 total), and changes
Dashboard J19:L19 to top-10 loan types with leads (the box fits 11 rows). The earlier "Log a Call" and "Update Application" forms were dropped.
Source: `D:\MCM_Hardening_2026-10-15\src\vba\modQuick.bas`, `frmLogCase.formcode`, `frmUpdateCase.formcode`, `modArchive.bas`, applied by
`src\build\add_quick_entry.ps1` (after add_access_log; build_mis.py does NOT add the forms/loan types/J19 change). Tests: `test_quick.py`
104/104 on demo; test_mis 42 + 2 NOT RUN; test_v11 19/19. VBA IIf evaluates both branches: never put Mid$/Left$ with a possibly-0 argument in one.
Something (probably the user's own Excel) keeps resetting HKCU AccessVBOM to 0: re-check it before each build.
Candidate built from live sha 2b4d7fe1… : `D:\MCM_Hardening_2026-10-15\staging\quick_entry_2026-10-24\`. wb_diff: only tblLoanType, Dashboard J17:L29 + F-column loan box, no record data.
Practice file (fictional data, own backup folder): same folder, `TRY_Quick_Entry_DEMO.xlsm`.
**Promotion pending Tarun's OK.** If live has been saved since, rebuild from a fresh copy (needs AccessVBOM on, then off).
Avoid identifiers that re-case existing code (`show`, `rows`, `target`): VBA re-cases names project-wide.

## ACCESS LOG ADDED (17-Oct-2026): `MIS.xlsm` now shows a "who is opening?" name box on open
Picking a name adds a row to `tblAccessLog` (hidden, protected sheet "Access Log"; Unhide via right-click on a tab), then the workbook saves (so each pick also makes an after-save backup). Cancel or X records nothing. Self-declared name, not a login; macros off = no box. No close time on purpose. Live sha after change 0bdb3c91… ; pre-change copy `D:\MCM_Backups\pre-access-log_2026-10-17\MIS_before_access_log.xlsm` (sha d0d077bb…). Source: `D:\MCM_Hardening_2026-10-15\src\vba\modAccessLog.bas`, `frmLogin.formcode`, applied by `src\build\add_access_log.ps1`. `build_mis.py` does NOT yet build it: a rebuild from source must re-run that script. `ui_acceptance.py` W01 opens with events on and would hang on the box until it is dismissed.

## STATUS (15-Oct-2026) — supersedes the Files/Run/Open-audit notes below
Tarun declared `MIS.xlsm` the FINAL live workbook. This folder holds only that file, the User Guide and this CLAUDE.md.
Everything else (old `MCM_MIS.xlsm`, Demo, `src/`, handover, test/audit/staging/migration reports, `_staging`, `_rebuild`, `_work`) was moved to `D:\MCM_Archive_2026-10-15`.
The rules below still apply to the live workbook (copy first, COM only, no openpyxl). Build/test tooling is in the archive's `src/`; run it from there, never into this folder.

## HARDENING (15-Oct-2026): read `D:\MCM_Hardening_2026-10-15\reports\MCM_MIS_Production_Hardening_Report.md` first
- **v1.1 source is now `D:\MCM_Hardening_2026-10-15\src`** (archive `src/` = v1.0). Restricted folder. Nothing promoted; `MIS.xlsm` unchanged (sha 67862218…).
- Dates: 22 lead dates + EMP-010 corrected only in `staging\MCM_MIS_dates_corrected_2026-10-15.xlsm` (evidence-gated). TRIAL migration into a fresh v1.1 build passed (`f_trial\`), stamped NOT FOR USE.
- **Dashboard crash root cause:** Excel crashes when COM writes a spilling formula into a NON-ACTIVE sheet while the active window has frozen panes. Always `ws.Activate()` before writing formulas by COM. Not lineage corruption.
- Tests: xldates 23, test_mis 44, test_v11 19, rebuild_checks 18, test_migration (with MCM_V10_DEMO), ui_acceptance 26 (+UH1-5). Test harness leaks hidden Excel processes — end `/automation` EXCEL.EXE after long runs (a ~59-instance pile-up froze the PC on 15-Oct).
- Every save now makes a backup snapshot: test copies must redirect BACKUP_FOLDER (xlsession does); migrate keeps events off at SaveAs.
- Open business decisions D1–D16: `reports\MCM_MIS_Outstanding_Decisions_and_Office_Checks.md`.

## Files (as of 14-Oct; now in the archive unless noted)
- `MCM_MIS.xlsm` — **LIVE workbook with real customer data (since 13-Oct-2026). Never rebuild over it, never edit in place.**
- `MCM_MIS_Demo.xlsm` — fictional training copy; safe to rebuild.
- `MCM_MIS_Technical_Handover.md` — architecture, ID logic, formula definitions, VBA modules, limits. Source of truth for design.
- `MCM_MIS_Test_Report.md`, `MCM_MIS_User_Guide.pdf` (source `src/docs/`).
- `src/vba/*.bas` VBA source · `src/build/` build (`build_mis.py`, `schema.py`, `demo_data.py`) and tests (`test_mis.py`, `xlsession.py`).

## Hard rules
- Live workbook edits: follow the `excel-safe-edit` skill — copy first, close Excel (check `~$MCM_MIS.xlsm`), write only empty cells,
  diff, get Tarun's OK before replacing the original. The workbook is .xlsm with charts/shapes: edit via Excel COM, **never openpyxl round-trip**.
- Open via COM with `EnableEvents=False` (skips Workbook_Open daily backup and avoids modal dialogs that hang hidden Excel).
  Enable events only when you want VBA handlers to run. Kill only Excel PIDs you started (`/automation` processes).
- Never put real customer data in tests, docs or context files. Tests run on copies of the demo workbook only.
- Rebuild needs Excel "Trust access to the VBA project object model" (HKCU AccessVBOM); enable for the build, then remove it again.
- Change VBA in `src/vba/` AND the live workbook together; keep `schema.py` column kinds in sync with `modConfig` generated block.
- Requires Excel 2021/2024/365 (dynamic arrays, LAMBDA/MAP). Built on Office ProPlus 2024.

## Design in one paragraph
Tables `tblCustomers / tblApps / tblFollowups / tblEmployees / tblLenders / tblAssignLog / tblArchiveLog / tblSettings`.
IDs (MCM-0001, APP-0001, FU-00001, EMP-001, LND-001) = max(counter in tblSettings, highest existing + 1) — self-healing, never reused.
Archive = `Record Location` flag on the customer; apps/follow-ups inherit it by formula (no physical move). Disbursed = status Disbursed
+ amount + date. Telecaller cohort credit → Original Telecaller ID. Applications store the lender **name** (renaming a lender orphans old rows —
add new + set old Inactive). Backups → `D:\MCM_Backups` (separate physical disk on this PC).

## Run
`python src/build/test_mis.py <scratch_dir>` — 44 checks, must stay 44/44 after any change (verified 44/44 on 14-Oct-2026). Needs HKCU AccessVBOM on (B01); remove it after.
C01 needs `MCM_CLEAN_WB=<clean file>` built with `build_mis.py clean <empty scratch dir>` (since 14-Oct the script refuses to build into the project folder); without it C01/INV-clean report NOT RUN.
`python src/build/ui_acceptance.py MCM_MIS_Demo.xlsm <scratch_dir>` — 21 Excel UI checks (visible Excel, takes over mouse/keyboard ~4 min; warn Tarun first).
Open audit items (14-Oct): which file is live (`MCM_MIS.xlsm` vs `MIS.xlsm`) is undecided; live VBA lacks the Managers-own-cases change; see `MCM_MIS_Audit_Report.md` and `MCM_MIS_Workbook_Reconciliation.md` (recommends promoting the Auto Populated copy after approval + fixing its 22 lead dates stored one day early).

Staging (14-Oct): `_staging\MCM_MIS_staging_candidate.xlsm` = Auto Populated + 23 date fixes + DT width 19, awaiting Tarun's review (`MCM_MIS_Staging_Change_Report.md`). Write dates via COM only through `src/build/xldates.py` (Value2 serials) — passing a datetime to Range.Value shifts it by the UTC offset. Entering any spilling formula on the Dashboard of MCM_MIS.xlsm-lineage files crashes Excel; don't try — fix is rebuild-from-source + data migration (pending approval).

## Business rules learned
- MCM does **not** work with public sector (national public) banks. The 12 PSBs in Lender Master are Inactive (13-Oct-2026); never suggest them as lenders.

