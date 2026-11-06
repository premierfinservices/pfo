# MCM go-live: design for Tarun's approval

Written 3 November 2026. **A proposal, not a decision.** Nothing here has been run. Go-live hands MCM's cases to PFO for good (ADR-046), and only Tarun says when. No customer data in this file.

## What go-live is

`npm run mis:sync -- --go-live` clears the `mis_managed` flag on every synced case. From then on the sync leaves those cases alone and PFO accepts edits to them. The MIS stops being the source for them. The command is one step; the work around it is the design below.

## What is in scope today

**Every MIS case** (Tarun, 6 Nov 2026, ADR-047): live and archived, of any date. The only exception is MCM-0027, which stays in the MIS. Archived cases arrive closed (disbursed) or lost. Older cases arrive with no documents, because the MIS holds none. This settles the earlier A/B/C question for the 8 older cases as **B**.

## Steps, in order

1. Name any MIS case to leave out (add it to `MIS_SYNC_EXCLUDED`). Done for MCM-0027.
2. `npm run mis:sync` as a dry run. Read it. It must say "Figures match the MIS" and list no unmapped status, lender, mobile or employee, or each one must be understood.
3. Take a backup (`npm run backup`, confirm the checksum line). The production server needs an elevated shell for restarts; the sync itself does not.
4. **Freeze MIS entry.** From this moment the team enters nothing new in the MIS. Pick a quiet hour, since the sync runs 08:00 to 21:00.
5. `npm run mis:sync -- --apply` once more, then check the case count and the Reports screen against the MIS Dashboard.
6. Upload documents for the older cases as they come up (the MIS has none).
7. `npm run mis:sync -- --go-live`. Check one case: edits now save, and the "Managed in the MIS" banner is gone.
8. Disable the `PFO MIS Sync` scheduled task so nothing keeps looking at the MIS. Keep `MIS.xlsm` as a read-only archive; do not delete it.
9. Telecallers and the login desk enter cases in PFO from then on. Change the weak temporary passwords first.

## What can go wrong

- **No undo built for go-live.** I have not written a way to give cases back to the MIS. Until it is written, treat step 7 as one-way, and do it only after step 5 checks out.
- **Work done in the MIS after step 4** is lost to PFO. The freeze matters.
- **MCM-0020 and PF-2026-00001** are the same customer and stay separate by decision. Go-live does not change that.

## Tarun to answer

1. A date and hour for the freeze.
2. Whether to write a go-live reversal first, as a safety net, before step 7.
