# Untis+ Dev Server — Cloudflare Tunnel Setup

Expose the local HTTPS dev server to the internet via a quick TryCloudflare tunnel.

> **TL;DR:** the dev server is **HTTPS-only** (self-signed cert). The tunnel command must use
> `https://localhost:3000` + `--no-tls-verify`. Using `http://` produces `EOF` / "Empty reply from server".

---

## 0. Free up port 3000

Only needed if previous instances are still running. Port 3000 must be free before starting your
own server, otherwise you get `EADDRINUSE`.

```powershell
# Stop any leftover node server(s) holding port 3000
$pids = (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue).OwningProcess
if ($pids) { Stop-Process -Id $pids -Force }

# Stop stale cloudflared instances (optional; each is a separate tunnel)
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
```

## 1. Start the dev server — Terminal 1

```powershell
cd X:\coding\UntisPlus-dev-server
npm start
```

Expected output:

```
Untis+ Dev Server running on https://0.0.0.0:3000
School: demo
Test credentials: testuser / testpass
Data store: ...
Admin panel: https://localhost:3000/admin ...
WebUntis simulation: ...
```

## 2. Verify locally

HTTP 401 with JSON = success (it means the server answers; the 401 is expected without a session):

```powershell
curl.exe -k https://localhost:3000/WebUntis/api/rest/view/v1/messages/permissions
```

- `-k` is required — the cert is self-signed.
- Plain `http://` or a missing `-k` → `curl: (52) Empty reply from server` (that is the TLS server
  rejecting plain HTTP, not a hang).

## 3. Start the tunnel — Terminal 2

```powershell
cloudflared tunnel --no-tls-verify --url https://localhost:3000
```

Two things are non-negotiable:

| Flag | Why |
|---|---|
| `https://localhost:3000` | The origin is an **HTTPS** server. `http://` → `EOF` errors |
| `--no-tls-verify` | Origin cert is self-signed; cloudflared on Windows cannot load the system CA store |

## 4. Grab the URL & verify through the tunnel

The banner prints a random subdomain, e.g. `https://his-wet-holdings-grain.trycloudflare.com`.

```powershell
curl.exe https://xxx.trycloudflare.com/WebUntis/api/rest/view/v1/messages/permissions
```

Expected: `{"error":"Unauthorized","code":-32600}` (HTTP 401).
No `-k` needed here — the tunnel side uses Cloudflare's valid TLS.

## 5. Point the Untis+ app at it

In der App **Manuelle Eingabe** auswählen. Achtung: das **Server**-Feld wird wörtlich genommen und die App baut daraus
`https://<Server-Feld>/WebUntis/...`. Es darf also **kein** `https://` und **kein** `/WebUntis` enthalten sein:

| App-Feld ("Manuelle Eingabe") | Wert |
|---|---|
| Server | `xxx.trycloudflare.com` — nur der Hostname, ohne `https://`, ohne `/WebUntis` |
| Schule | `demo` — exakt, sonst kommt `Invalid school` → "Login fehlgeschlagen" |
| Benutzer / Passwort | `testuser` / `testpass` (oder die Werte aus `.env`) |
| Anmeldeart | Passwort (nicht Login-Key), außer du testest den OTP-Flow |

Falsche Beispiele die **nicht** funktionieren:
- `https://xxx.trycloudflare.com/WebUntis` im Server-Feld → URL wird doppelt → Verbindungsfehler
- Schule `demo.school` oder leer → `Invalid school` → "Login fehlgeschlagen"

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| `Unable to reach the origin service ... EOF` | Origin not running, or tunnel URL uses `http://` instead of `https://` |
| `Empty reply from server` | Requested `http://` against the HTTPS server (or forgot `-k`) |
| `EADDRINUSE ... port 3000` | Another node process holds port 3000 — see step 0 |
| Tunnel works, app still fails | Check school name (`demo`) and that sessions/cookies are sent; the app must keep the `JSESSIONID` cookie |

## Notes

- **Quick tunnels get a new random URL on every restart.** Your app config breaks each time you
  restart the tunnel.
- For a **stable URL**, create a *named tunnel* on your Cloudflare account (cloudflared tunnel login
  → create → route DNS) and use `cloudflared tunnel run <name>` — no `--url` flag needed.
- **Admin panel:** `https://<host>:3000/admin` (browser) — edit classes, teachers, timetable,
  homework, absences, messages. Changes are written to `data/db.json` and served by the simulation.
  Optionally protect it with `ADMIN_PASSWORD` in `.env`.
- The dev server simulates the WebUntis endpoints the app uses (`jsonrpc.do`, `jsonrpc_intern.do`,
  MessageCenter REST incl. token/inbox/send, news widget, weekly data) — see `API_calls.md`.