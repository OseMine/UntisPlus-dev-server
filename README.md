# Untis+ Dev Server

## Overview
> **What is Untis+ Dev Server?**
> A Server to simulate Webuntis API for testing and Developing [Untis+](https://github.com/ninocss/UntisPlus)

## Tech Stack

| Dependency | Purpose|
| :--- | :--- |
| Express | Web framework |
| CORS | Cross-origin resource sharing |
| cookie-parser | Cookie parsing for sessions |
| uuid | Session ID generation |
| dotenv | Environment configuration |
| selfsigned | Self-signed certificate generation (dev) |

## Project Structure

```
src/
  index.js      # Main server entry point (WebUntis simulation + admin API)
  store.js      # Persistent data store (data/db.json) shared by API and admin
  admin.js      # Admin REST API (CRUD on all school data)
public/
  admin.html    # Admin panel (no build step – plain HTML/JS, served at /admin)
data/
  db.json       # School data (auto-created from seed on first start)
.env            # Environment variables (credentials, port)
package.json    # Dependencies and scripts
key.pem         # SSL private key (auto-generated)
cert.pem        # SSL certificate (auto-generated)
```

## Usage

### Server

**Install Dependencies**

```bash
npm install
```

**Generate SSL certificates (first run only)**

```bash
node gen-cert.cjs
```

**Start Server**

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

Server runs on `https://0.0.0.0:3000` (configurable via `PORT` in `.env`)

**Allow through Windows Firewall** (required for phone access):
```powershell
# Run as Administrator
New-NetFirewallRule -DisplayName "UntisPlus Dev Server" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

### Trust Self-Signed Certificate (Required)

The app will reject the self-signed cert with `CERTIFICATE_VERIFY_FAILED`. You must trust `cert.pem` on your device:

**Android:**
1. Transfer `cert.pem` to phone (email, USB, cloud)
2. Settings → Security → Install certificates → CA certificate
3. Select `cert.pem` → Name it "UntisPlus Dev" → OK

**iOS:**
1. AirDrop/email `cert.pem` to iPhone
2. Open → Install Profile → Settings → General → VPN & Device Management → Trust it
3. Settings → About → Certificate Trust Settings → Enable full trust for "UntisPlus Dev"

**Alternative: Use mkcert (recommended for development)**
```bash
# Install once
# Windows: choco install mkcert  OR  scoop install mkcert
# macOS: brew install mkcert
# Linux: sudo apt install libnss3-tools && mkcert -install

mkcert -install
mkcert 192.168.178.38 localhost 127.0.0.1
# Creates key.pem and cert.pem that are automatically trusted
```

### Untis+ App (Android & iOS)

1. In Untis+ Account Settings, add account from custom URL (*Manual Entry*)
2. Enter your local IP and port (e.g., `192.168.178.38:3000`)
   - The app will use HTTPS automatically
   - Find your IP with `ipconfig` (Windows) or `ifconfig` (Mac/Linux)
3. Set credentials in `.env`:
   ```
   UNTIS_USER=your_username
   UNTIS_PASSWORD=your_password
   ```

Default test credentials: `testuser` / `testpass`

### Admin panel

Open `https://<host>:3000/admin` in any browser (no build step). The panel lets the school admin
edit **everything** the simulated API serves:

- Klassen, Lehrer, Fächer, Räume, Schüler (CRUD)
- Stundenplan: Wochen-Grid pro Klasse, Stunden anlegen/bearbeiten/löschen
- Hausaufgaben pro Klasse, Absenzen pro Schüler
- Nachrichten: News (für alle) + Inbox (an ausgewählte Klassen)
- Daten: Export/Import als `db.json`, Reset auf Startdaten

All changes are written immediately to `data/db.json` and served by the WebUntis simulation – the
Untis+ app sees them after a refresh (e.g. another `getTimetable` call).

If `ADMIN_PASSWORD` is set in `.env`, the panel requires that password. Without it the panel is open
(dev tool).

> The test account `testuser` is the student **Test User (id 123)** of class **5A (id 45)**.

### Endpoints

**JSON-RPC** (`POST https://<ip>:3000/WebUntis/jsonrpc.do?school=demo`)
- `authenticate` - Login with username/password
- `getUserData2017` - Get user profile data
- `getCurrentSchoolyear` - Get current school year
- `getHolidays` - Get holidays
- `getKlassen` / `getSubjects` / `getTeachers` / `getRooms` - Master data
- `getTimetable` - Get timetable lessons
- `getTimetableWithAbsences` - Get timetable with absences
- `getHomeWork2017` - Get homework assignments
- `getMessagesOfDay2017` / `getMessagesOfDay` / `getMessages` - Newsfeed fallback

**REST**
- `GET https://<ip>:3000/WebUntis/api/token/new` - MessageCenter token (pseudo-JWT)
- `GET https://<ip>:3000/WebUntis/api/rest/view/v1/messages` - Inbox
- `POST https://<ip>:3000/WebUntis/api/rest/view/v1/messages` (also v2) - Send message (multipart)
- `GET https://<ip>:3000/WebUntis/api/rest/view/v1/messages/permissions` - Messaging permissions
- `GET https://<ip>:3000/WebUntis/api/rest/view/v1/messages/recipients/static/persons` - Message recipients
- `GET https://<ip>:3000/WebUntis/messageFileRequest.do?file=<id>` - Download attachment
- `GET https://<ip>:3000/WebUntis/api/public/news/newsWidgetData` - Public news widget
- `GET https://<ip>:3000/WebUntis/api/public/timetable/weekly/data` - Public weekly data
- `GET https://<ip>:3000/WebUntis/api/exams?startDate=YYYYMMDD&endDate=YYYYMMDD` - Exams (also `/api/classreg/exams` and `/api/exams/student/<id>`)

**Admin API** (`/api/admin/*`, see panel at `/admin`)
- `GET /api/admin/bootstrap` - Full store
- `POST|PUT|DELETE /api/admin/{classes|teachers|subjects|rooms|students|lessons|homework|absences|messages|exams}` - CRUD
- `POST /api/admin/reset`, `POST /api/admin/import`, `GET /api/admin/export`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a PR