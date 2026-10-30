# Intake and Work Engine

**Status:** Approved by Tarun, 30 October 2026. Step 1 built on branch `feature/intake-work-engine`; not yet live.
**Date:** 30 October 2026
**Scope:** Step 1 of bringing PFO up to the automation of the MCM Excel MIS.

Tarun's direction, 30 Oct 2026:

- Log a Case and Update Case from the MIS are what PFO's case entry and case update must be.
- A case enters the system only when the customer has promised to send documents. Qualified leads and earlier stages do not exist here.
- Partly received documents usually means enough to check eligibility. If eligibility fails, the case stops there.
- Eligibility is decided manually. The system asks the question; it does not decide.
- The document checklist must not block sending to a banker, and must not ask for unnecessary documents.
- The next step is stated after every action as guidance text, never as a popup.

This document reverses earlier decisions, listed in Part 8. Those reversals go into `DECISIONS.md` as a new ADR before any code changes.

---

## Part 1: Stages

Stages follow the MIS `Overall Case Status` list, in its order, minus Interested and Follow-up Required (a case enters only once documents are promised), plus Eligibility Check.

| # | Case stage | Source | Means | Reached when |
|---|---|---|---|---|
| 1 | Documents Pending | MIS | Customer promised documents; collection under way | Case logged |
| 2 | Eligibility Check | New | Enough is in to ask whether the case is worth taking forward | Documents marked Partially Collected, or Complete with eligibility unanswered |
| 3 | Documents Collected | MIS | Everything is in; send to lenders | Documents Complete and eligibility Eligible |
| 4 | Login Completed | MIS | A lender has logged the file in | Any application reaches Login Completed or Under Review |
| 5 | Query Raised by Bank | MIS | A lender has a query | Any application reaches Query Raised by Bank |
| 6 | Approved | MIS | A lender has approved or sanctioned | Any application reaches Approved or Sanctioned |
| 7 | Sanction Accepted | MIS | Customer accepted a sanction | Any application reaches Sanction Accepted |
| 8 | Disbursed | MIS | Money has moved | An application is Disbursed, with amount and date |
| 9 | Rejected | MIS | No lender has taken it. Set by a person, because one lender's rejection never closes a case | Set manually |
| - | Closed | PFO | Invoice raised | Finance closes |
| - | Lost | PFO | Will not proceed, reopenable | Not eligible, or customer dropped, with a reason |

**Removed:** New, Contacted, Appointment Fixed, Ready for Submission, Submitted, Sanctioned (the last three replaced by the MIS names above). Production has zero loan cases, so no row needs moving. Old Postgres enum values stay unused, because removing an enum value means rebuilding the type; a check constraint stops them being written and the domain vocabulary drops them.

**Movement rules, as in the MIS:**

- Lender updates only move a case forward, by the order above, and never backward. So a case at Approved stays there if another lender raises a query
- Sending to a lender does not move the stage; the login does. A file sent on partial documents for a pre-check can go straight from Documents Pending or Eligibility Check to Login Completed
- Eligibility moves a case out of Eligibility Check: back to Documents Pending if documents are outstanding, on to Documents Collected if they are all in, or to Lost if not eligible
- Managers can correct a case's stage by hand, with a note and an event, as Edit a Case allows today

**Lost reasons** become the MIS closure reasons: Customer not interested; Not eligible / rejected by all lenders; Customer unreachable; Documents not provided; Duplicate record; Other (see notes). "Disbursed: case complete" is not a loss, so it maps to Closed.

**Lender application statuses** follow the MIS list exactly:

| MIS status | PFO today | Next statuses offered | Fields needed (* required) |
|---|---|---|---|
| Not Logged In | `not_submitted`, `submitted` (shown as one status, with "Sent on {date}" once emailed) | Login Completed, Not Eligible (Pre-check), Withdrawn / Closed | - |
| Not Eligible (Pre-check) | New | Finished | Reason* |
| Login Completed | New | Under Review, Query Raised by Bank, Approved, Sanctioned, Rejected, Withdrawn / Closed | Login date*, login employee*, reference number |
| Under Review | `under_process` | Query Raised by Bank, Approved, Sanctioned, Rejected, Withdrawn / Closed | Login fields |
| Query Raised by Bank | `query_raised` | Under Review, Approved, Sanctioned, Rejected, Withdrawn / Closed | Login fields, query* |
| Approved | `eligibility_received`, renamed | Sanctioned, Rejected, Withdrawn / Closed | Login fields, approved amount |
| Sanctioned | `sanctioned` | Sanction Accepted, Disbursed, Withdrawn / Closed | Login fields, sanction amount*, sanction date* |
| Sanction Accepted | New (PFO records this as an accepted offer) | Disbursed, Withdrawn / Closed | Above, plus acceptance date* |
| Disbursed | `disbursed` | Finished | Above, plus disbursement amount*, disbursement date* |
| Rejected | `rejected` | Finished | Login fields, reason* |
| Withdrawn / Closed | `withdrawn` | Finished | Reason |

Anyone active can be the login employee. A "Show all statuses" tick lets someone correct a mistake. "Sanctioned requires an offer" is satisfied by the sanction amount and date on this form, which PFO saves as the offer.

**New fields on `loan_case`:** `document_status` uses the MIS list (Not Assessed, Pending, Partially Collected, Complete; Not Assessed is kept for imported MCM records) and `eligibility_status` is unanswered, eligible or not_eligible. Both are set by a person, never computed from the checklist. Each change writes an event.

Eligibility is never a gate. A case can go to a banker for a pre-check before the question is answered.

---

## Part 2: Log a Case (replaces New Case)

One screen, MIS fields, in MIS order:

| Field | Behaviour |
|---|---|
| Customer name | Stored in capitals |
| Mobile | 10 digits starting 6 to 9. Existing number shows the matching case inline as it is typed |
| Place | Type or pick from the MIS place list (Part 2A); any other place may be typed. Stored in capitals |
| Loan amount | Accepts 2500000, 25L, 1.5cr. Amount in words shown underneath |
| Loan type | The MIS list of 17 |
| Variant | Fresh, Takeover, Top-up, OD, CC, Term and so on. Required for Other Loan Types |
| Lead source | List |
| Employment type | List |
| Telecaller | Defaults to the signed-in person. Telecallers and managers |
| Document pickup date | Today, Tomorrow, or a date. Not in the past |

**On save:** case created at Documents Pending, document status Pending, task "Collect documents" due on the pickup date, assigned to the telecaller.

**Duplicates:** a matching mobile is shown inline with a link to the existing case and a "This is a different customer" tick. The override is recorded. Nothing is silently merged and nothing is refused (Principle 7).

**Existing person:** a mobile match against a known person reuses that person's record (Principle 5).

Practice-case tick stays. GST, ITR and existing-loan questions leave this screen and are asked only when they change the pending list (Part 5).

---

## Part 2A: Lender and place lists from the MIS

Exact lists, taken from the live MIS on 30 Oct 2026, are saved beside this document. Neither contains customer data.

**Lenders: `PRD/data/mis_lenders.csv`** (115: 103 active, 12 public sector inactive)

- 56 are already in PFO's catalogue (50 by exact name, 6 under a slightly different name) and 59 are added, with type, active flag and supported loan types
- Supported loan types set the "those supporting this loan type first" order on the Send to lenders tab
- All stay marked Not verified: none is a confirmed tie-up
- "Loan Against Securities" is removed from supported types, because it is not offered and the MIS loan-type list no longer has it. MIS research notes are not copied
- PFO's branches, bankers and insights are kept. Bankers are per lender and per branch, picked or typed

PFO's names are kept, by Tarun's decision: nothing is renamed or merged, and the MIS name is not added beside the PFO one.

| MIS name | Treated as PFO's |
|---|---|
| SMFG India Credit - Fullerton India | SMFG India Credit |
| Aditya Birla Capital | Aditya Birla Finance |
| The Coimbatore District Central Co-operative Bank | Coimbatore District Central Co-operative Bank |
| Home First Finance | Home First Finance Company India |
| Aptus Value Housing Finance | Aptus Value Housing Finance India |
| India Shelter Finance | India Shelter Finance Corporation |

Lakshmi Vilas Bank and Coimbatore City Co-operative Bank are not in the MIS and stay as they are.

**Public sector banks:** set inactive in PFO, as in the MIS (Tarun, 30 Oct 2026).

**Places: `PRD/data/mis_places.txt`** (262 districts and towns, in capitals)

Loaded into PFO's `city` table, which has 13 today. The MIS stores no district with a town, by Tarun's choice, so `district_id` stays empty for these. Any other place may be typed, and places already used appear in the list.

---

## Part 3: Update Case (the main screen)

Pick the customer: type part of a name, mobile or case number. Own cases by default, managers see everyone's, due and overdue first. Then three tabs.

**Case tab**

- Documents: Fully received / Partly received / Nothing yet, with next collection date where it applies
- Eligibility: the question "Is this case eligible?" with Eligible / Not eligible. Shown whenever eligibility is unanswered and documents have started arriving. Step 3 adds the GST and ITR summary directly above it; until then it shows the pending list
- Reschedule: Tomorrow / +3 days / Next week
- Customer dropped: reason, then Lost

**Send to lenders tab**

- Tick lenders, those supporting the loan type first
- Banker: pick or type per lender, remembered for that lender
- Documents go by email from the case's Banks tab, using the existing flow. Every uploaded document not marked rejected can be chosen
- If items are pending, a plain line says so: "3 items still pending: ... You can still send." Sending is never refused for this

**Applications tab**

- Tap an application, tap one of its next statuses (Part 1), fill only the blank fields that status needs
- Existing PFO rules stay: a rejection needs a reason, one disbursement per case
- "Not Eligible (Pre-check)" means the lender declined before login. It is not counted as a login, and it closes that application only

The existing case detail screen stays for full history and rarely used facts.

**Uploading received documents**

Marking documents partly or fully received makes the Next line say to upload them. Uploading is one action on the Case tab: choose the case folder, choose files, or drop the folder. The screen sends the files one at a time, so one bad file cannot lose the rest.

- Each file is placed by its name, as the `organize` skill names them, then by its folder. Any order works
- Monthly 3B returns each get their own row, and the pending line counts them until twelve are in
- An ITR's computation, P&L and balance sheet may be separate PDFs; each goes under its own type and year
- A name PFO cannot place is kept as Other Document and listed. Nothing is dropped. A repeat of the same name and size is skipped
- `Pending Documents.txt` is skipped. `GST and ITR Summary.txt` is shown above the eligibility question, until PFO works those figures out itself in step 3

---

## Part 4: Work engine

Backend routes and a workflow layer over the existing `task` table, which has no API today. The rules are one pure, tested function: event in, tasks to close and create out. Screens never decide this.

| Event | Tasks closed | Task created | Due | Assigned to |
|---|---|---|---|---|
| Case logged | - | Collect documents | Pickup date | Telecaller |
| Nothing yet | Open case tasks | Collect documents | Chosen date | Owner |
| Partly received | Open case tasks | Check eligibility | Today | Owner |
| Fully received, eligibility unanswered | Open case tasks | Check eligibility | Today | Owner |
| Fully received, already eligible | Open case tasks | Send file to lenders | Today | Person acting |
| Eligible, documents not all in | Check eligibility | Collect remaining documents | Chosen date | Owner |
| Eligible, documents all in | Check eligibility | Send file to lenders | Today | Person acting |
| Not eligible / customer dropped | All open tasks on the case | None | - | - |
| Sent to lender | Send file to lenders | Confirm login with {bank} | +2 days | Person acting |
| Login Completed | Confirm login with {bank} | None; guidance only | - | - |
| Bank query raised | - | Resolve query from {bank} | +2 days | Login employee on that application |
| Query answered | Resolve query from {bank} | None | - | - |
| Application finished (disbursed, rejected, withdrawn, pre-check no) | Open tasks for that application | None | - | - |
| Sanctioned | - | Present the offer to the customer | Today | Owner |
| Offer nearing expiry | - | Offer from {bank} expires {date} | Today | Owner |
| Reschedule | - | Same task, new due date, with an event recording old and new dates | Chosen date | Unchanged |

"Confirm login with {bank}" is not in the MIS, which only shows a message at that point. It is added so a sent file always has a next step.

Tasks are never deleted (BR-041). Closing records who and when.

**Work queue:** each person's home screen leads with Overdue, Today, Upcoming, using real tasks. Managers can switch to everyone or to one person. The Founders Dashboard's Tasks panel moves to real tasks.

---

## Part 5: Document checklist

The rule engine stays, because it already does this job, but its 105 rules are switched off and 22 short ones take their place:

- One list per loan type, seeded from the checklists Tarun already uses in the `organize` skill
- Conditions kept to: salaried or self-employed, GST yes or no, co-applicant present, property involved
- Standing corrections seeded as rules: no loan application form or signature, e-Aadhaar accepted with no back side, EB bill in the owner's name counts as business address proof, ITR PDF assumed to include computation and P&L, other-loan statements only if a loan is evident, no GST or current account removes those items

A person can remove any item from one case in one tap, or add one. No reason is required.

The 105 old rules stay in the database, inactive, and the Document Rules screen is hidden. They are not deleted (Principle 6).

The pending list is information only. It never moves a stage, never blocks sending, and the progress percentage is removed from case screens. Per-document verification becomes optional.

---

## Part 6: Guidance text

Every case screen has one fixed line below the case header, always visible, always current:

> **Next:** Collect remaining documents. Due 2 Nov. Chinna.

After every action, the same place shows what just happened and what comes next:

> Documents marked partly received. **Next:** answer whether this case is eligible.

Rules:

- Not a popup, modal or toast. It does not disappear and needs no dismissing
- It comes from the same data as the work queue, so the two cannot disagree
- With no open task it says so plainly, for example "Waiting on the bank. Update the application when you hear from them"
- Validation problems also appear inline beside the field
- Confirmation dialogs stay only for actions that are hard to undo, such as sending email to a banker

| Situation | Guidance |
|---|---|
| Just logged | Next: Collect documents. Due {date}. {person} |
| Partly received | Next: answer whether this case is eligible |
| Eligible, documents outstanding | Next: Collect remaining documents. Due {date}. {person} |
| Not eligible | Case closed as not eligible. Nothing further. Reopen if this changes |
| All in, eligible | Next: Send the file to lenders. Use the Send to lenders tab |
| Sent | Next: Confirm login with {bank} by {date} |
| Login Completed | Waiting on {bank}. Update the application when you hear from them |
| Query raised | Next: Resolve the query from {bank} by {date}. {person} |
| Sanctioned | Next: Present the offer to the customer |
| Sanction Accepted | Next: Record the disbursement when it happens |
| Disbursed | Disbursement recorded. Next: raise the invoice |

---

## Part 7: How it gets built and proven

1. ADR recorded in `DECISIONS.md`; this PRD and `Loan Lifecycle.md`, `Workflow.md`, `Requirements and Progress.md` updated
2. Built on a branch, on the isolated `pfo_dev` database and disposable storage, using distinct ports as `CLAUDE.md` requires. Production keeps running untouched
3. Additive migrations, numbered from 0044
4. The MIS scenarios in `test_quick.py` rewritten as PFO tests, using fictional data. Existing suites referencing the removed stages are updated, each change explained; none is deleted to get a pass
5. Tarun tries it on the dev copy and gives the go-ahead
6. Only then: backup, migrate production, restart the PFO Server task, and test with a practice case

**Rollback:** restore the pre-migration backup and return to commit `689e718`. Production has no live cases yet, so this is low risk today. The risk rises once staff start entering real ones.

---

## Part 8: Earlier decisions this reverses

| Decision | Was | Becomes |
|---|---|---|
| Lifecycle (`Loan Lifecycle.md`, ADR-020) | Ten stages from New Lead; a case is a lead from the start; eligibility is only per bank | MIS stages from Documents Pending; a case-level eligibility step exists |
| Submission statuses (`Workflow.md`) | Submitted, Under Process, Eligibility Received and so on | The MIS list of 11 lender statuses |
| Requirements (`Requirements and Progress.md`, ADR-010, ADR-035) | Generated from rules; drive progress and stage | Short checklists; information only |
| Ready for Submission guard | Every applicable requirement settled | Person says all received; stage becomes Documents Collected |
| Sending (ADR-039 flow) | Verified documents only | Any uploaded document not rejected |
| Principle 2 (one question per screen) | Separate workspaces | Unchanged for home screens; Update Case is deliberately one multi-tab screen, as in the MIS |

Principles kept: 4, 5, 6, 7, 8. Security, permissions, event log and backups are untouched.

---

## Part 9: Not in this step

- Document drop, automatic sorting and renaming (step 2)
- GST and ITR summary (step 3)
- MIS reports, MCM data import and the firm field (step 4)

---

## Part 10: Assumptions to correct

1. **Loan types:** the MIS list of 17 becomes the list on Log a Case, mapped to PFO's loan products, adding any that are missing
2. **Who answers eligibility:** anyone who can update the case
3. **Fully received with eligibility unanswered:** the question is still asked, and sending is not blocked meanwhile
4. **Salaried customers:** the same eligibility question, with the pending list in place of the GST and ITR summary
5. **Closing:** anyone may mark a case Lost; only Finance closes after the invoice, as PFO has it today
6. **Edit a Case:** only its stage correction is in this step. Its other manager edits are not rebuilt yet, and its real delete does not come across, because PFO never destroys records (Principle 6)
