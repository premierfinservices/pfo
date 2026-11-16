# Glass dashboard: design note

16 November 2026. Approved by Tarun in conversation the same day. The decision and its reasons are ADR-053 in `DECISIONS.md`; this note says where things are.

## Intent

Tarun showed a reference (a "liquid glass" finance dashboard) and asked for PFO's home screen and overall interface to look like it, less flashy. PFO is used all day for forms and tables, so the look was taken and the parts that hurt daily work were left out: tiny grey text on glass, a hero that fills half of every screen, icon-only navigation, a fake "ask anything" bar.

## Approaches considered

| Approach | Outcome |
|---|---|
| Change colour and radius tokens only | Rejected. Same layout in new paint. |
| Restyle the shared layer, rebuild Home, sweep the other screens | **Chosen.** Almost all styling already flows through three files. |
| Bring in a component and chart library | Rejected. More machinery than three charts need. |

## Where things are

| Piece | File |
|---|---|
| Backdrop, glass, radii, shadows, display font | `Frontend/src/index.css`, `Frontend/index.html` |
| Floating navigation and page shell | `Frontend/src/App.tsx` |
| `PageHeader`, `Segmented`, restyled card, button, badge, modal, toast | `Frontend/src/ui/index.tsx` |
| The three charts | `Frontend/src/ui/charts.tsx` |
| Home | `Frontend/src/screens/WorkspaceHome.tsx`, `WorkQueue.tsx` |
| Leads per week | `src/domain/reports/mis-report.ts` (`leadsByWeek`), tested in `mis-report.test.ts` |
| Every other screen | its heading replaced by `PageHeader` |

## Rules to keep

- Glass is for the navigation and Home's two headline cards. Anything that holds a table, a form or figures is solid white.
- Text on the backdrop is white; put only inputs, selects and solid buttons in a `PageHeader`'s `actions`.
- Charts use one hue and print their labels and counts.
- Nothing on the backdrop moves.

## To tune the look

The backdrop is one variable, `--pfo-backdrop`, in `index.css`. Lower the chroma (the second number in each `oklch`) for a quieter blue; the gold light is the third gradient.
