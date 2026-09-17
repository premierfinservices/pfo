# Deployment Topology

Who runs what, on which machine, in the Premier Finserv office.

## The rule

**Exactly one PC in the office is the PFO server.** It runs PostgreSQL and the
four PFO processes. Every other PC opens a browser to that machine's address
and runs nothing at all — no Node, no `npm`, no checkout of this repository.

```
┌──────────────────────────────────────┐         ┌────────────────────┐
│  THE SERVER PC                       │         │  Every other PC    │
│                                      │         │                    │
│  PostgreSQL        127.0.0.1:5432    │         │  A browser,        │
│  storage-server    127.0.0.1:4319    │   LAN   │  pointed at        │
│  mail-server       127.0.0.1:4320    │◄────────┤  http://<server    │
│  api-server        127.0.0.1:4321    │         │   IP>:4300         │
│  web-server        0.0.0.0:4300  ◄───┼─────────┘                    │
│                                      │         │  Nothing installed │
│  C:\PFO\Data      documents          │         │                    │
│  C:\PFO\Backups   backups            │         └────────────────────┘
└──────────────────────────────────────┘
```

**One port is open to the office: 4300.** Everything else is loopback.

## Why only the web server faces the network

Each process below it is reachable only from the machine it runs on, and that
is the access control:

| Process | Binds | Why |
|---|---|---|
| `web-server.mjs` | `PFO_WEB_HOST`, default loopback, **0.0.0.0 on the server** | Serves the built frontend and proxies `/api`. The only front door. |
| `api-server.ts` | loopback (configurable, but leave it) | Enforces every permission. Reached through the web server's proxy. |
| `storage-server.mjs` | **loopback, always — refuses otherwise** | No authentication. Anything that reaches it can read or overwrite every customer's documents and relocate the whole store via `PUT /config`. |
| `mail-server.mjs` | **loopback, always — refuses otherwise** | No authentication, and holds the Gmail refresh token. Anything that reaches it can send email as Premier Finserv, to anyone, including banks. |
| PostgreSQL | loopback | Only the API talks to it. |

The two "refuses otherwise" entries are enforced in code: setting
`PFO_STORAGE_HOST` or `PFO_MAIL_HOST` to anything but loopback makes that
process exit with an explanation. If document bytes ever need to leave the
machine directly, the answer is authentication on that server, not a wider
bind — and that refusal exists to force the conversation rather than let it
happen by analogy with the web server's setting.

## Why employee PCs must not run the backend

If a second PC runs `npm run dev` — even once, even by accident — that machine
gets:

- its own empty PostgreSQL, so it sees no cases and creates cases nobody else sees;
- **its own `C:\PFO\Data`**, so documents uploaded through it land on that
  employee's local disk, are invisible to the rest of the office, are not in
  any backup, and are lost when that PC is reimaged.

Nothing in the system detects this. The employee's screen looks completely
normal. This is the single most damaging misconfiguration available, which is
why the topology is stated as a rule rather than a recommendation.

## What each setting means

| Setting | Server PC | Anywhere else |
|---|---|---|
| `PFO_WEB_HOST` | `0.0.0.0` | `127.0.0.1` |
| `PFO_WEB_PORT` | `4300` | `4300` |
| `PFO_API_HOST` | `127.0.0.1` | `127.0.0.1` |
| `PFO_DB_HOST` | `127.0.0.1` | — |
| `PFO_DB_NAME` | `pfo` | never `pfo` |
| `PFO_STORAGE_ROOT` | `C:\PFO\Data` | — |
| `PFO_BACKUP_ROOT` | a **different disk** from the documents | — |
| `PFO_MAIL_PROVIDER` | `gmail` | `unconfigured` |

`PFO_MAIL_PROVIDER=capture` is for automated tests only. It reports success
and sends nothing, so an office install running it would record submissions
that never left the building. `Scripts/pfo-status.ps1` flags it in red.

## Starting, stopping, and surviving a reboot

One process supervises the other four:

```
npm run start:production          # Backend/supervisor.mjs, foreground
Scripts/register-pfo-services.ps1 # register it to start at boot
Scripts/pfo-status.ps1            # is everything up?
```

The supervisor:

- **waits up to two minutes for PostgreSQL** before starting the API. On a
  Windows reboot both start at once and Postgres routinely wins the race by
  thirty seconds; without the wait, an employee logging in during that window
  is told PFO is broken.
- **restarts any process that exits**, backing off 1s → 2s → 4s … → 60s, so a
  crash-loop leaves a readable log instead of filling the disk.
- **sweeps its own four ports for orphaned Node processes at startup.** Windows
  does not tear down a process tree when an ancestor dies, so a force-killed
  supervisor or a power cut leaves children holding the ports and the next
  start would otherwise fail with `EADDRINUSE` forever.
- **refuses to start if another supervisor is already running** (PID file at
  `Backend/supervisor.pid`). Two supervisors kill each other's children and
  present as an application that flickers in and out.

PostgreSQL is *not* started by the supervisor — it is its own Windows service
and already starts automatically.

## What happens when something is unavailable

| Failure | What an employee sees | Where the detail goes |
|---|---|---|
| PostgreSQL stopped | `503` "PFO cannot reach its database right now, so nothing was saved… the PFO server PC needs attention." | Driver error in the API log |
| API process stopped | `503` "PFO is running but its API is not responding. Nothing was saved." | Supervisor log, with restarts |
| Storage server stopped | Upload fails: "The document could not be stored. Check that the storage backend is running and try again." | API log |
| Gmail unreachable / not configured | The submission records the email as `failed` with a reason, and **Retry** resends only the failed ones. Nothing is silently marked sent. | `submission_package_email.status` |
| Whole server PC off | "Cannot reach the PFO server. Check that it is running." | — |

No PostgreSQL error text, table name, column name or connection string ever
reaches a browser.

## Firewall

On the server PC, allow **inbound TCP 4300** only:

```powershell
New-NetFirewallRule -DisplayName "PFO web (4300)" -Direction Inbound `
    -Action Allow -Protocol TCP -LocalPort 4300 -Profile Private
```

`-Profile Private` matters: the office network must be classified Private, or
the rule will not apply. Do **not** open 4319, 4320, 4321 or 5432 — nothing
outside the server PC has any reason to reach them, and three of the four have
no authentication.

## Still to be recorded by whoever installs the office server

These cannot be guessed from a development checkout, and a wrong confident
answer in this table is worse than a blank one.

| | |
|---|---|
| Server PC (make / asset tag / location) | **UNFOLDMEDIACORP** — no formal asset tag; located at the Premier Finservices office |
| Server LAN IP, static or DHCP-reserved | `192.168.0.101` on the `192.168.0.0/24` office LAN — DHCP-reserved in the router against this PC's MAC address |
| URL employees use | `http://192.168.0.101:4300` |
| Backup destination (physical location) | `C:\PFO\Backups` on UNFOLDMEDIACORP only — no offsite or separate physical copy exists yet; this is a known gap |
| Who holds the database password and the login slips | Tarun Ramesh, Manager — Premier Finservices |

**2026-09-07 — server moved to UNFOLDMEDIACORP.** This PC now runs PostgreSQL
and all four PFO processes, registered to start at boot (`PFO Server` /
`PFO Nightly Backup` scheduled tasks), with inbound TCP 4300 open on the
Private profile and a verified backup taken same day. It holds the real
production database and document store (confirmed, not inferred from this
checkout).

MAIN-PC was previously documented here as the server at this same IP,
`192.168.0.101` — that record was stale; production has in fact been running
on UNFOLDMEDIACORP since 2026-09-07. **2026-09-09 — MAIN-PC crashed and is
unrecoverable.** It cannot rejoin the LAN, so the IP-collision / silently
diverging second copy risk described above is closed. The office now runs
on exactly two machines: the home PC (development only) and UNFOLDMEDIACORP
(production server, and also development — see below).

## UNFOLDMEDIACORP also does development work

With MAIN-PC gone, UNFOLDMEDIACORP is used for both running production and
day-to-day development. That is only safe under strict isolation, since this
one physical machine now hosts both the real `pfo` database/`C:\PFO\Data`
**and** whatever a dev session touches:

- Development processes here use a separate, disposable database (e.g.
  `pfo_dev`) — never `pfo`.
- Development processes bind `PFO_WEB_HOST=127.0.0.1` and use ports distinct
  from production's 4300/4321/4319/4320 — never `0.0.0.0`, never the
  production ports.
- Development processes point `PFO_STORAGE_ROOT` at a disposable local
  folder — never `C:\PFO\Data`.
- The production `PFO Server` scheduled task (boot trigger, runs regardless
  of who is logged in) is left running throughout; a `npm run dev` session
  here is a second, separate process tree alongside it, not a replacement.

This does not relax "the rule" above — it is still true that only one set of
processes may bind the real database/storage/port 4300. It just means the
same PC now hosts two fully separated stacks side by side.

A server whose IP changes on reboot breaks every bookmark in the office
silently — reserve it in the router against that PC's MAC address before
go-live. `Docs/Installation.md` is the step-by-step procedure.
