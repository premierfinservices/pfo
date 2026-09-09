# AOS Project Instructions

- Always invoke the `andrej-karpathy-skills:karpathy-guidelines` skill when writing, reviewing, or refactoring any code in this project.

## Dev topology (two-PC setup)

- MAIN-PC (the former office PC) crashed and is unrecoverable, 2026-09.
  Removed from the topology. The only two machines now are the home PC and
  Unfold Media Corp PC.
- **Unfold Media Corp PC** is the one real server, always — Postgres (the
  real `aos` database), documents (`C:\AOS\Data`), mail, running via the
  `AOS Server` scheduled task (boot trigger) / `Backend/supervisor.mjs`. This
  stays true until an actual dedicated server is bought. See
  `Docs/Deployment Topology.md` for the full rule.
- **Unfold Media Corp PC also does development work now** (it is the only
  machine reliably available besides home). This is only safe under strict
  isolation:
  - Dev work here MUST use a separate disposable database (e.g. `aos_dev`,
    same pattern as `aos_test`/`aos_e2e`) — never the real `aos` database.
  - Dev `.env` (or `.env.local`) MUST use `PFO_WEB_HOST=127.0.0.1`
    (loopback only) and ports distinct from production's 4300/4321/4319/4320
    — never `0.0.0.0`, never the production ports.
  - Dev processes must never read or write `C:\AOS\Data` — point
    `PFO_STORAGE_ROOT` at a disposable local folder.
  - The production `AOS Server` scheduled task keeps running throughout;
    `npm run dev` here is a second, separate process tree, not a replacement
    for it.
  - **`npm run dev`'s `predev` hook (`Backend/free-dev-ports.mjs`) kills any
    `node.exe` process listening on `PFO_VITE_PORT`/`PFO_API_PORT`/
    `PFO_STORAGE_PORT`/`PFO_MAIL_PORT`, which default to 5173/4321/4319/4320
    — the exact ports production listens on.** Plain `npm run dev` on this
    PC, without overriding those four vars first, will kill the live
    production backend. Always export distinct values before `npm run dev`
    here, e.g.:
    ```powershell
    $env:PFO_VITE_PORT=5273; $env:PFO_API_PORT=4421
    $env:PFO_STORAGE_PORT=4419; $env:PFO_MAIL_PORT=4420
    $env:PFO_WEB_HOST="127.0.0.1"; $env:PFO_DB_NAME="aos_dev"
    $env:PFO_STORAGE_ROOT="C:\AOS\Dev\Data"
    npm run dev
    ```
    `Backend/env.mjs` only fills in vars not already set in the real
    environment, so exporting these first overrides the shared `.env` file
    (which still holds production's values) for this shell only — `.env`
    itself is never edited for a dev session.
- **Home PC** is dev-only: editing code, running a disposable local
  `npm run dev` stack against its own local Postgres/storage for testing, and
  `git push`. It never holds real customer documents and never points its
  `.env` at Unfold PC's database or storage over the network.
- Git is the only sync channel between the two machines. A push from home
  does **not** deploy anything by itself — after pulling on Unfold PC, someone
  must run `npm run migrate` and restart the `AOS Server` task before the
  change is live.
- Regardless of which PC: never point a `npm run dev` session's `.env` at the
  real `aos` database or `C:\AOS\Data`, and never run the production
  supervisor against disposable dev data — mixing these is the
  "most damaging misconfiguration" the topology doc warns about.
