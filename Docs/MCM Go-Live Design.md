# MCM go-live: design for Tarun's approval

Written 3 November 2026. **A proposal, not a decision.** Nothing here has been run. Go-live hands MCM's cases to PFO for good (ADR-046), and only Tarun says when. No customer data in this file.

## What go-live is

`npm run mis:sync -- --go-live` clears the `mis_managed` flag on every synced case. From then on the sync leaves those cases alone and PFO accepts edits to them. The MIS stops being the source for them. The command is one step; the work around it is the design below.

## What is in scope today, and what is not

| Group | State |
|---|---|
| Cases Active in the MIS with a lead date from 13 Oct 2026 (14 on 2 Nov) | Copied to PFO every 30 minutes, read-only there except document uploads |
| The 8 older Active MIS cases (lead date before 13 Oct 2026) | **Not in PFO.** Held off by `MIS_SYNC_FROM` in `src/domain/work/mis-sync.ts` |
| MCM-0027 | Excluded by Tarun's decision, stays in the MIS |
| Archived or closed MIS cases | Not copied; history stays in the MIS file |

## The decision for the 8 older cases

| Option | What it means | Cost and risk |
|---|---|---|
| **A. Leave them in the MIS** | They finish there. The MIS stays open, read-only for new work, until the last one closes | Two systems for as long as the slowest case takes. Reports in PFO leave them out, so MIS and PFO totals differ |
| **B. Bring them across before go-live** (recommended) | Move `MIS_SYNC_FROM` back to include them, run the dry run, read the "Needs a look" list, apply, then go live with all of them | One small code change plus a dry run. Their old stages and lenders must map cleanly; anything that does not is reported and left out, not guessed. They arrive with **no documents**, because the MIS holds none |
| **C. Bring them across as history only** | Import as closed | Loses the live work on them. Only sensible if they are effectively dead, which Tarun knows and I do not |

I recommend **B**, because A leaves the MIS running indefinitely and defeats the goal that PFO replaces it. B is reversible until `--go-live`: a dry run rolls back, and a synced case is overwritten from the MIS on each run. I do not know whether all 8 are worth carrying; that is Tarun's call, and any he wants out can be added to `MIS_SYNC_EXCLUDED`.

## Steps, in order

1. **Decide A, B or C**, and name any of the 8 to leave out.
2. For B: change the cut-off (or list the extra cases), then `npm run mis:sync` as a dry run. Read it. It must say "Figures match the MIS" and list no unmapped status, lender, mobile or employee, or each one must be understood.
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
- **Reports differ from the MIS** if an older case is left behind (option A or C).

## Tarun to answer

1. A, B or C for the 8 older cases, and any to leave out.
2. A date and hour for the freeze.
3. Whether to write a go-live reversal first, as a safety net, before step 7.
