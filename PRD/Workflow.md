# Workflow

**Status:** Rewritten 1 November 2026 to match ADR-040 and `PRD/Intake and Work Engine.md`. For Tarun's review. The earlier transition table is superseded.

How a case moves. `Loan Lifecycle.md` defines the stages; this defines the transitions and the edge cases that break naive designs. The tasks each action raises are in `Intake and Work Engine.md`, Part 4, and are not repeated here.

---

## Case stage transitions

| From | To | Trigger | Actor |
|---|---|---|---|
| (none) | Documents Pending | Case logged | Person |
| Documents Pending | Eligibility Check | Documents marked Partially Collected, or Complete with eligibility unanswered | Person |
| Eligibility Check | Documents Pending | Answered eligible, documents outstanding | Person |
| Eligibility Check | Documents Collected | Answered eligible, documents all in | Person |
| Documents Pending | Documents Collected | Documents Complete and eligibility already Eligible | Person |
| Eligibility Check | Lost | Answered not eligible | Person |
| Documents Pending, Eligibility Check or Collected | Login Completed | An application reaches Login Completed or Under Review (a pre-check on partial documents is allowed) | System |
| Login Completed or later | Query Raised by Bank | An application reaches Query Raised by Bank | System |
| Any earlier stage | Approved | An application reaches Approved or Sanctioned | System |
| Any earlier stage | Sanction Accepted | An application reaches Sanction Accepted | System |
| Any earlier stage | Disbursed | An application is Disbursed, with amount and date | System |
| Disbursed | Closed | Close-out completed, invoice raised | Finance |
| Any open stage | Rejected | Set by a person; one lender's rejection never closes a case | Person |
| Any non-terminal stage | Lost | Marked lost, reason from the MIS closure list | Person |
| Lost | The stage it left | Reopened | Person |

Every transition writes an event naming its actor (BR-050, BR-052). System transitions name the system and cite the application change that caused them.

**Forward only.** A lender update never moves a case backward, so a case at Approved stays there when another lender raises a query. **Sending to a lender does not move the stage**; the login does. **Eligibility is never a gate.** A manager can correct a stage by hand, with a note and an event.

---

## Application status transitions

Independent per application. A case may hold many at once. The statuses are the MIS's eleven:

```
Not Logged In ─▶ Login Completed ─▶ Under Review ─▶ Approved ─▶ Sanctioned ─▶ Sanction Accepted ─▶ Disbursed
     │                 │                 │  ▲            │            │               │
     │                 │                 ▼  │            │            └──▶ Withdrawn / Closed
     │                 └──▶ Query Raised by Bank         └──▶ Rejected / Withdrawn / Closed
     ├──▶ Not Eligible (Pre-check)
     └──▶ Withdrawn / Closed
```

The next statuses offered from each, and the fields each needs, are the table in `Intake and Work Engine.md`, Part 1. A "Show all statuses" tick lets someone correct a mistake.

Rules:

- **Query Raised by Bank ⇄ Under Review is a loop,** and the most common real-world transition. Each query is recorded with what was asked.
- **Rejected** requires a reason. **Sanctioned** requires a sanction amount and date, which PFO saves as the offer (BR-023). One disbursement per case (BR-022).
- **Withdrawn / Closed is our choice to stop; Rejected is theirs.** Never conflate them: the distinction is the value of the rejection data.
- **Not Eligible (Pre-check)** means the lender declined before login. It is not counted as a login and closes only that application.
- **Not Logged In covers "sent".** `not_submitted` and `submitted` show as one status, with "Sent on {date}" once emailed. A sent file always has a next step: "Confirm login with {bank}" two days on.
- **Who may move a lender's status:** the login team, managers and management. A telecaller may send their own case's file (ADR-042) but may not update status (ADR-043).

---

## Edge cases

**Approved at one lender, rejected at another.** Normal. The case stays Approved; each application keeps its own status.

**Rejected everywhere.** The case does **not** move automatically. The next move is often another lender. It stays where it is, shows in the work queue, and a person marks it Rejected or Lost, because only a person knows whether options remain.

**Sanction nearing expiry.** Offers carry an expiry. An expired offer does not reverse the stage; it raises a task for the owner (`Offer from {bank} expires {date}`).

**Customer accepts one lender after sanction.** Unaccepted applications go to Withdrawn / Closed, not Rejected.

**Re-submission after a rejection.** A corrected file sent back to the same lender is a **new application**, never a status reset. The rejection is history.

**Loan type changes mid-case.** The pending list is recomputed. Documents already collected are never discarded; they belong to the person, not the case (ADR-007).

**Eligibility changes later.** A case marked not eligible can be reopened if circumstances change. Reopening restores the stage it was lost from and keeps the loss in history.

**Two cases for one customer.** A home loan and a business loan can run in parallel. The person is shared. Log a Case shows the match inline as the mobile is typed.

**The same mobile appears twice.** Log a Case shows the existing case inline, with a "This is a different customer" tick that is recorded. Nothing is silently merged and nothing is refused (Principle 7). A person sees only the cases they may read; for any others the screen says how many there are and nothing more (ADR-043). A duplicate that was logged by mistake is retired by marking one Lost with "Duplicate record". Cases are never merged: merging is for identities (people, organisations), not process records, because both timelines are true.

---

## What triggers what

The consequences of each event belong to a workflow layer that the interface observes, because business logic never lives in the UI. The full table of events, the tasks each closes and raises, due dates and assignees is `Intake and Work Engine.md`, Part 4: one pure rule table (`src/domain/work/rules.ts`), tested by `Backend/work.test.ts`.

In short: every action closes the tasks it finishes and raises the next, and the case screen states that next step in a fixed line. Tasks are never deleted (BR-041).

---

## Open questions

1. **Hold semantics.** ADR-021 makes hold orthogonal to stage and removes a held case from the work queue. It does not say whether a held case may change stage. A lender sanctions a file while the customer is travelling: the sanction happened, and refusing to record it would put the two axes out of step. The likely answer is that **system** transitions proceed and **user** ones do not, but that is a business call. Until it is answered, stage logic ignores the hold flag. Does marking a held case Lost clear the hold? Clearing it loses the reason the case stalled.
2. **Reminder cadence.** "Confirm login with {bank}" is due two days after sending, and queries two days after being raised. Are those the right intervals for every lender?
3. **Rejected versus Lost.** The MIS keeps both. Is there a rule for when a case with every application rejected becomes one or the other?
