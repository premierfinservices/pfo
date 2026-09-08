# AOS Project Instructions

- Always invoke the `andrej-karpathy-skills:karpathy-guidelines` skill when writing, reviewing, or refactoring any code in this project.

## Dev topology (two-PC setup)

- **Unfold Media Corp PC** is the one real server, always — Postgres, documents
  (`C:\AOS\Data`), mail, running via `npm run start:production` /
  `Backend/supervisor.mjs`. This stays true until an actual dedicated server
  is bought. See `Docs/Deployment Topology.md` for the full rule.
- **This home PC** is dev-only: editing code, running a disposable local
  `npm run dev` stack against its own local Postgres/storage for testing, and
  `git push`. It never holds real customer documents and never points its
  `.env` at Unfold PC's database or storage over the network.
- Git is the only sync channel between the two machines. A push from home
  does **not** deploy anything by itself — after pulling on Unfold PC, someone
  must run `npm run migrate` and restart the supervisor before the change is
  live.
- Never run `npm run dev` on Unfold PC, and never run the production
  supervisor against home PC's local data — mixing these is the
  "most damaging misconfiguration" the topology doc warns about.
