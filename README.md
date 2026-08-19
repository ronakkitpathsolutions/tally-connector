# Tally Connector

Bridges the TMS portal to TallyPrime. It runs on the same Windows PC as Tally, receives a
fully-resolved JSON invoice over a Cloudflare Tunnel, renders Tally's import XML, posts it to
`localhost:9001`, and normalises Tally's reply back to JSON.

```
TMS Backend (AWS)
      |  HTTPS + Cloudflare Access service token
      v
tally.tally-connector.store
      |  Cloudflare Named Tunnel
      v
  Client Windows PC
      |
   Connector :4000        <- binds 127.0.0.1 only
      |
   TallyPrime :9001
```

Tally's port is never exposed to the internet.

By default the connector binds `127.0.0.1`, so nobody on the office LAN can reach `:4000` either —
only `cloudflared`, running locally on the same machine. Setting `HOST` to a LAN address (useful
in development, when the backend runs on another machine) drops that: `:4000` becomes reachable
from the whole network, and the shared secret is then the only thing guarding it.

## Prerequisites

- **Node.js 20 LTS or newer** — <https://nodejs.org>
- **Git** — needed for `POST /admin/update`; the connector still runs without it
- **TallyPrime**, with the HTTP server enabled (see below) — it is **off by default**
- **NSSM** (optional but recommended) — <https://nssm.cc>, extracted somewhere on `PATH`.
  Without it the installer falls back to Task Scheduler, which starts the connector at boot but
  will not restart it if the process crashes.

### Enabling Tally's HTTP server

In TallyPrime: `F1 (Help)` → `Settings` → `Connectivity` → `Client/Server configuration`. Set
`TallyPrime acts as` to **Both** and the port to **9001**, then accept the dialog with `Ctrl+A`.
Tally only answers while it is **running with a company loaded** — a closed Tally, or an open
Tally with no company, will not respond.

**Why 9001 and not Tally's default 9000.** The client's server is a terminal server running one
TallyPrime per Windows session, and the instance in an RDP session already holds 9000 with their
live books. Giving the connector's Tally its own port means neither disturbs the other, and it
removes a whole class of confusion: for a full day the Tally on screen and the Tally answering on
9000 were two different processes showing two different companies.

Use the keyboard for Tally's dialogs (`Ctrl+A` to accept, `Y`/`N`, `Esc`). Mouse clicks on them
are unreliable over a remote session, and a dialog left open makes Tally accept TCP connections
while answering nothing.

## Install

From an **Administrator** command prompt, in the repo folder:

```cmd
install.bat
```

It checks prerequisites, runs `npm ci`, builds, prompts for the `.env` values, registers the
connector to start automatically, and finishes by calling `/health` so you know whether Tally
answered before you walk away.

To remove the startup registration (leaves `.env`, `logs\` and `dist\` alone):

```cmd
uninstall.bat
```

## Configuration

`.env`, created by the installer. See `.env.example`.

| Variable | Purpose |
|---|---|
| `PORT` | Connector port. `4000`, and the Cloudflare Tunnel origin must match. |
| `HOST` | Address this PC is reachable at, used both to bind and to reach Tally. Default `127.0.0.1`. See the warning below. |
| `SHARED_SECRET` | Must equal `TALLY_CONNECTOR_SECRET` on the TMS backend, or every request gets a 401. |
| `TALLY_PORT` | Port vouchers are written to. `9001` — see below. |
| `TALLY_MASTERS_PORT` | Port master names are **read** from, when the live company runs as a separate TallyPrime. Defaults to `TALLY_PORT`; the import paths never use it. |
| `TALLY_TIMEOUT_MS` | How long to wait for Tally before giving up. Default 30000. |
| `DEFAULT_COMPANY` | Exact Tally company name, used when the backend sends a blank company. |
| `TALLY_EDU_MODE` | **Testing only.** See below. Keep `false` in production. |
| `ALLOW_MASTER_CREATE` | **Testing only.** Creates missing ledgers alongside the voucher. Keep `false` in production. |

### `TALLY_EDU_MODE`

TallyPrime's free Educational version rejects any voucher date other than the 1st, 2nd, or last day
of a month. Setting this to `true` rewrites dates to fit, so a rejection you see while testing is a
real XML problem rather than a date-policy one.

**Never enable this against a licensed Tally** — it silently changes the date on a financial
document. When it is on, the connector prints a banner at startup and a warning line for every
voucher whose date it moves.

## Routes

All except `/health` require the `x-connector-secret` header.

| Route | Purpose |
|---|---|
| `GET /health` | Liveness, plus whether Tally answers. Unauthenticated so monitoring can use it. |
| `POST /tally/invoice` | Full GST Sales Invoice. This is what the TMS backend calls. |
| `POST /tally/invoice/preview` | Renders the same XML and returns it **without sending it to Tally**. |
| `POST /tally/voucher` | Leaner plain accounting voucher — kept alongside the invoice route while we confirm which shape this Tally release accepts. |
| `POST /tally/preview` | Preview for `/tally/voucher`. |
| `POST /admin/update` | `git pull && npm ci && npm run build`, then exits so the service restarts into the new build. |

### Start with `/tally/invoice/preview`

Before trusting the end-to-end path, pull the XML from the preview route and import it into Tally
**by hand**. That separates "the XML is wrong" from "the network is wrong", which are otherwise
very hard to tell apart from a single failure.

## Logs

One file per day in `logs\`, named `tally-connector-YYYY-MM-DD.log`, alongside the console:

```
2026-08-19T15:55:36.629Z INFO  push received {"billNo":"T/2982/2026-27","company":"...","queued":0}
2026-08-19T15:55:36.812Z INFO  creating missing ledgers {"billNo":"...","ledgers":["PRASHANT CASTECH PVT LTD"]}
2026-08-19T15:55:37.104Z INFO  imported {"billNo":"T/2982/2026-27","action":"created","voucherId":"7","took":"475ms"}
2026-08-19T15:56:02.310Z ERROR Tally rejected the voucher {"billNo":"...","errorCode":"TALLY_LINEERROR","reason":"Ledger 'X' does not exist!"}
```

Tally's own wording is kept verbatim — a paraphrase in the log is a paraphrase in every bug report.

`queued` is how many Tally calls were waiting; consistently above 1 means pushes are arriving
faster than Tally answers.

The shared secret is redacted before anything is written, because logs get pasted into chats and
screenshots. Files older than 30 days are deleted at startup, and only files this logger wrote are
ever touched.

## Operating

```cmd
nssm restart TallyConnector     :: or: schtasks /end + /run, on the fallback path
nssm status TallyConnector
type logs\tally-connector-2026-08-19.log
```

Shipping a fix without visiting the PC: `POST /admin/update` with the shared secret. The process
exits after a successful build and the service restarts it.

## Reading failures

**Tally returns HTTP 200 even when it rejects a voucher.** The outcome lives inside the response
XML — `<CREATED>`, `<ALTERED>`, `<LINEERROR>`. The connector treats `created = 0 and altered = 0`,
or any `LINEERROR`, as a failure and passes Tally's own message back. Trusting the status code
would mark every failed invoice as synced.

| Connector `errorCode` | Meaning |
|---|---|
| `AUTH` | Wrong or missing `x-connector-secret`. |
| `BAD_PAYLOAD` | The invoice does not add up, or has no lines. Never reached Tally. |
| `TALLY_UNREACHABLE` | Nothing answering on the Tally port. Tally closed, or no company loaded. |
| `TALLY_TIMEOUT` | Tally accepted the connection then went quiet — usually sitting on a dialog box. |
| `TALLY_LINEERROR` | Tally rejected it. The message is Tally's own text, usually a ledger name mismatch. |
| `TALLY_NO_CHANGE` | Tally accepted the request but created and altered nothing. |

## Repeat pushes are safe — but not because of REMOTEID

**`REMOTEID` does not deduplicate.** Verified against the client's Tally: importing the same
voucher twice produced two vouchers, not an alter. The retry design originally assumed otherwise,
which would have written double sales into their books.

So `/tally/invoice` asks Tally first. It fetches the vouchers dated on the bill's own day — a
small, bounded query — and skips the import when that bill number is already there, in either
`VOUCHERNUMBER` or `REFERENCE`. Both are checked because Tally only keeps our number in
`VOUCHERNUMBER` when the voucher type numbers manually; under an auto-numbering type it survives
only in `REFERENCE`.

The response then carries `action: "exists"` with `ok: true` — the bill is in Tally, which is what
the caller needs to know.

If the lookup itself fails, the import is **not** attempted: importing on a guess is exactly how
duplicates happen. That returns `TALLY_UNREACHABLE` and is safe to retry.

**Consequence worth knowing:** editing an invoice and pushing it again no longer updates the Tally
voucher — it reports `exists` and leaves the original alone. Correcting a bill already in Tally is
a manual job until an explicit alter path exists.

## Why not PM2

`pm2 startup` has no Windows support — its generator targets systemd, upstart, launchd, rcd and
systemv, and on Windows it exits with `[PM2][ERROR] Init system not found`. The connector is
registered as a Windows service via NSSM instead, matching how `cloudflared` already runs.

## Development

```cmd
npm install
npm test          :: 71 tests, no Tally or network needed
npm run dev
```

The XML builders and the response parser are pure functions with golden-file tests built from two
real invoices, so the wire format can be changed and verified without TallyPrime.
