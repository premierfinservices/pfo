# Requirements and Progress

> **Superseded (6 Nov 2026).** This describes PFO's first lifecycle. The working model is the MIS's: `PRD/Intake and Work Engine.md`, ADR-040, and ADR-047 to ADR-050 in `DECISIONS.md`. Where this file disagrees with them, they win.

**Status:** Rewritten 1 November 2026 to match ADR-040 and `PRD/Intake and Work Engine.md`. For Tarun's review. The earlier model, where generated requirements drove a progress percentage and the case stage (ADR-010, ADR-035), is superseded.

What PFO asks a case to collect, and how it avoids asking for things that do not apply.

---

## What changed, in one paragraph

The office collects enough to check eligibility, drops the case if that fails, and only then collects the rest. The old design instead assumed a full file per loan type, verified document by document, before anything could go to a bank. So the checklist is now **information**: it tells a person what is still pending. It does not move a stage, does not stop a file being sent, and there is no progress percentage. Whether documents are in is a field a person sets (`document_status`), and whether the case is eligible is a question a person answers.

---

## The rule that survives

> **A case is measured only against what that specific case genuinely needs.**

A salaried applicant with no co-applicant, no guarantor and no property can have nothing pending, and that is correct. A list that asks for a guarantor's papers because some other loan type needs them teaches people to ignore the list. This is why the checklist is short and conditional.

"Not applicable" and "still missing" remain different things: a document that does not apply to this customer is *not on the list*, rather than on the list and ticked off.

---

## Part 1: The simplest case stays simple

A case is a customer and a loan. Everything else is optional:

| Participant | When it exists |
|---|---|
| Co-applicant | Joint applications only |
| Guarantor | When a lender asks for one |
| Referrer | When the case came through someone |
| Organisation (employer) | Salaried applicants |
| Organisation (borrower firm) | Business loans, LAP |
| Property | Secured loans |

Hard rules, unchanged:

1. **Log a Case asks only for what the MIS asks:** name, mobile, place, amount, loan type, variant, lead source, employment type, telecaller and pickup date. GST, ITR and existing-loan questions are asked later, only when they change the pending list.
2. **Optional participants are added by an explicit action**, never by an empty field waiting to be filled.
3. **Empty optional sections are hidden, not greyed out.**
4. **Adding a participant later is normal.** It adds that participant's items to the pending list and is an event.

---

## Part 2: The pending list

Short checklists replace the earlier rule set. The rule engine stays, because it already does this job, but its 105 rules are switched off (not deleted: Principle 6) and 22 short ones take their place:

- One list per loan type, seeded from the checklists Tarun already uses in the `organize` skill
- Conditions kept to four: salaried or self-employed, GST yes or no, co-applicant present, property involved
- Standing corrections are seeded as rules: no loan application form or signature, e-Aadhaar accepted with no back side, an EB bill in the owner's name counts as business address proof, an ITR PDF is assumed to include computation and P&L, other-loan statements only if a loan is evident, and no GST or current account removes those items

**Removing or adding an item.** A person can remove any item from one case in one tap, or add one. No reason is required. This replaces the waiver workflow, with its named approver and recorded reason, which the office never wanted.

**Verification** of each document is optional. It is no longer needed for anything to proceed.

### What the list never does

- It never moves a stage.
- It never blocks sending to a lender. When items are pending, Send to lenders says so in a plain line ("3 items still pending: ... You can still send.") and carries on.
- It never produces a score. The progress percentage is removed from case screens.

---

## Part 3: Applicability by stage

The earlier idea that a requirement becomes due *from* a stage is dropped. Items either apply to this case or they do not; nothing is held back as "upcoming". What the office collects first is decided by the person, through document status and the eligibility question, not by a stage table.

---

## Part 4: Is the case in trouble?

Completeness is no longer measured, so the only health question left is whether something is **overdue**. That is answered by real tasks (the work engine in `Intake and Work Engine.md`, Part 4): each action closes the tasks it finishes and raises the next, and the work queue leads with Overdue, Today and Upcoming. Each case screen also states the next step in a fixed line, not a popup.

Still excluded: any predictive "likelihood to convert" score. It needs a year of outcomes in the event log first.

---

## Part 5: What this forbids

- No "complete your profile" nagging for fields that do not apply.
- No required fields that exist because some other loan type needs them.
- No score or percentage that a simple case can never reach.
- No empty section for an absent participant.
- No blocking a stage change or a send on the pending list.
- No universal document checklist applied to every case regardless of type.

---

## Open questions

1. **A split ITR** (separate computation, P&L and balance sheet PDFs, no combined ITR) leaves its ITR line pending until someone removes it. Is that the right default?
2. **Assessment years not yet filed** can appear on the list (2026-27 did). This needs checking against real cases.
3. **Per-lender checklists.** One list per loan type, plus manual additions, is what is built. Real per-lender templates are not, and need a decision on whether they are worth the setup.
