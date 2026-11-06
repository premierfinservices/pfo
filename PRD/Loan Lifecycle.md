# Loan Lifecycle

> **Superseded (6 Nov 2026).** This describes PFO's first lifecycle. The working model is the MIS's: `PRD/Intake and Work Engine.md`, ADR-040, and ADR-047 to ADR-050 in `DECISIONS.md`. Where this file disagrees with them, they win.

**Status:** Rewritten 1 November 2026 to match ADR-040 and `PRD/Intake and Work Engine.md`. For Tarun's review. The earlier ten-stage lifecycle (ADR-020) is superseded.

Every stage a case can occupy, what each one means, and what moves it. If this document and `Intake and Work Engine.md` disagree, the Intake and Work Engine spec wins.

---

## Two axes, not one

Kept from ADR-004, because everything here depends on it:

- **Case stage**: where the *customer's file* stands. One value, always.
- **Application status**: where *one file at one lender* stands. Many at once.

A case is at *Approved* while its five applications are variously sanctioned, rejected and waiting. Neither axis can express the other.

---

## Where a case begins

A case enters PFO only when the customer has **promised to send documents**. Leads, calls and appointments that have not reached that point are not cases, and PFO does not track them. This is the MIS's rule, and it is why New, Contacted and Appointment Fixed no longer exist.

---

## The stages

| # | Stage | Means | Reached when |
|---|---|---|---|
| 1 | **Documents Pending** | Customer promised documents; collection under way | Case logged |
| 2 | **Eligibility Check** | Enough is in to ask whether the case is worth taking forward | Documents marked Partially Collected, or Complete with eligibility unanswered |
| 3 | **Documents Collected** | Everything is in; send to lenders | Documents Complete and eligibility Eligible |
| 4 | **Login Completed** | A lender has logged the file in | Any application reaches Login Completed or Under Review |
| 5 | **Query Raised by Bank** | A lender has a query | Any application reaches Query Raised by Bank |
| 6 | **Approved** | A lender has approved or sanctioned | Any application reaches Approved or Sanctioned |
| 7 | **Sanction Accepted** | Customer accepted a sanction | Any application reaches Sanction Accepted |
| 8 | **Disbursed** | Money has moved | An application is Disbursed, with amount and date |
| 9 | **Rejected** | No lender has taken it | Set by a person |
| - | **Closed** | Invoice raised | Finance closes |
| - | **Lost** | Will not proceed; reopenable | Not eligible, or customer dropped, with a reason |

Stages 1 to 8 are ordered, and **Closed**, **Lost** and **Rejected** sit outside that order. Closed is terminal. Lost can be reopened; whether Rejected can is open (below).

**Sending is not a stage.** Emailing a file to a lender records which lender and banker; the case does not move. The *login* moves it. A file sent on partial documents for a pre-check can go from Documents Pending or Eligibility Check straight to Login Completed. This replaces the old rule that a case leaves Ready for Submission when a submission is dispatched.

**Eligibility is asked, never decided.** A person answers "Is this case eligible?" with Eligible or Not eligible. PFO does not compute it from the checklist, and it is never a gate: a file can go to a banker for a pre-check before the question is answered. Not eligible moves the case to Lost.

---

## Stages that were removed, and why (ADR-040)

**New, Contacted, Appointment Fixed.** They described the sales conversation before documents are promised, which is not what PFO tracks. An appointment is, at most, a task with a due date.

**Ready for Submission and Submitted.** Ready for Submission was gated on every applicable requirement being verified, which is not how the office works: it collects enough to check eligibility, and sends with documents still outstanding when that suits the case. Submitted meant "dispatched to a lender"; the login now carries that meaning.

**Sanctioned** is replaced by the MIS's Approved, which covers a lender approving or sanctioning.

Old stage values remain in the TypeScript union and the Postgres enums, unwritable, because the prototype store and retired rules are written in them. Removing them is a cleanup, not a requirement.

The earlier rule still stands: **do not encode as a stage what a field or a task expresses better.** Whether documents are in is the `document_status` field (Not Assessed, Pending, Partially Collected, Complete), set by a person. Who needs to do what next is a task.

---

## Stage is stored, and moves forward only

Stage is a **stored column**. Every change writes an event naming who or what caused it (BR-050).

- A lender update moves the case **forward only**, by the order above, never backward. A case at Approved stays there if another lender raises a query. Rejection at one lender never moves a case anywhere, because another may still be live.
- The system moves stages 4 to 8 itself when an application changes, so the two axes cannot drift. The event names the system as actor and the application as cause.
- **A case is not moved to Rejected automatically** when every application is rejected. The next move is often another lender, and only a person knows whether options remain.
- A manager can correct a stage by hand, with a note and an event.

---

## On Hold is not a stage (ADR-021)

Unchanged. Cases stall for reasons unrelated to progress: the customer is travelling, a co-applicant's documents are stuck. Hold is a flag carrying a reason and a follow-up date, orthogonal to stage, so that when it lifts you know where the case was. A held case drops out of the work queue until its follow-up date.

---

## Lost

Reachable from any non-terminal stage. Lost reasons are the MIS closure reasons:

Customer not interested · Not eligible / rejected by all lenders · Customer unreachable · Documents not provided · Duplicate record · Other (see notes)

A reason is mandatory; free text may accompany it, never replace it. Anyone who can update the case may mark it Lost. **Reopening** is allowed and restores the case to the stage it was lost from, keeps the loss in history, and does not create a new case. A "Duplicate record" loss is how a second case for the same enquiry is retired (cases are never merged).

---

## Closed vs Disbursed

Still deliberately separate. Disbursement is the customer's endpoint; the company's work continues with the invoice and the commission. A case in Disbursed for two months is a real signal that money is owed. "Disbursed: case complete" in the MIS maps to **Closed**, not Lost. Only **Finance** closes a case, because closing asserts the invoice is raised (`case.close`).

---

## Open questions

1. **Partial disbursement.** Home loans disbursed in tranches: does Disbursed mean the *first* tranche or the *final*? It affects when commission is due, and needs a business answer.
2. **Reopening a Rejected case** after the customer finds another route: is it the same case or a new one? Today a person reopens it.
