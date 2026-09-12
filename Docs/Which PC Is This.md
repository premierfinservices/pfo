# Which PC Is This

Run this check **before** touching anything that could read/write the real
database, the real document store, or a scheduled task — not after. A wrong
guess here is how the "most damaging misconfiguration" in
`Docs/Deployment Topology.md` happens.

There are exactly two machines (`Docs/Deployment Topology.md`):

| | Home PC | UNFOLDMEDIACORP |
|---|---|---|
| Hostname | `DESKTOP-2KVRC8D` | `UNFOLDMEDIACORP` |
| Role | Development only | Production server, and also development |
| Real `pfo` database / `C:\PFO\Data` | Never | Yes — this is the one machine that holds them |
| Safe to run cutover-gate steps here | No | Yes, but only using production's own `.env` (see below) |

## The check

PowerShell:
```powershell
hostname
Get-Content .env | Select-String "PFO_DB_NAME|PFO_WEB_HOST|PFO_STORAGE_ROOT"
```

Bash:
```bash
hostname
grep -E "PFO_DB_NAME|PFO_WEB_HOST|PFO_STORAGE_ROOT" .env
```

Read the result before doing anything else:

- **Hostname is `DESKTOP-2KVRC8D`** → this is the home PC. It is dev-only.
  Do not attempt any task that needs the real `pfo` database, real
  `C:\PFO\Data`, a scheduled task, the firewall, or a second office PC —
  none of those exist here. Anything asked of "the office server" belongs
  on UNFOLDMEDIACORP instead; say so rather than approximating it with
  dev data.
- **Hostname is `UNFOLDMEDIACORP`** → this is the production server. Two
  different things can be true here at once (it also does dev work), so
  don't stop at the hostname — check the `.env` values too:
  - `PFO_DB_NAME=pfo`, `PFO_WEB_HOST=0.0.0.0`, `PFO_STORAGE_ROOT=C:\PFO\Data`
    → this shell/process is production. Safe to run cutover-gate steps,
    backups, `storage:orphans` for real, etc.
  - `PFO_DB_NAME=pfo_dev` (or similar), `PFO_WEB_HOST=127.0.0.1`, a
    disposable `PFO_STORAGE_ROOT` → this is a dev shell on the server PC,
    with overridden env vars per `Docs/Deployment Topology.md`'s "also
    does development" section. Safe for ordinary dev work, but do **not**
    run cutover-gate/production-verification steps from it — those need
    the real production `.env`, not an overridden dev shell. Also never
    run plain `npm run dev` here without first exporting distinct
    `PFO_VITE_PORT`/`PFO_API_PORT`/`PFO_STORAGE_PORT`/`PFO_MAIL_PORT`/
    `PFO_WEB_HOST`/`PFO_DB_NAME`/`PFO_STORAGE_ROOT` — the un-overridden
    defaults collide with the live production ports and the `predev` hook
    will kill the production backend.
- **Hostname is anything else** → stop and ask. It isn't one of the two
  machines this project runs on; do not guess which role it should play.

## Why this exists

2026-09-12: a session on the home PC was asked to run four
production-only cutover-gate steps (backup verification, second-PC check,
topology recording, orphan quarantine) and nearly started before checking
where it actually was. It caught the mismatch from the local `.env`
(`pfo_dev` / `127.0.0.1` / `C:\PFO\Dev\Data`) before running anything, but
the check should happen first, as a habit, not as a save. See
`PFO Production Readiness Master Roadmap.txt`, "WHICH PC CAN DO WHAT", for
the full per-task breakdown of what each machine can and cannot do.
