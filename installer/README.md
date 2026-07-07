# Eventify — Installer

Turnkey setup that installs PostgreSQL, creates the database and tables,
installs the app, builds it, and starts it. Native install (no Docker).

The app runs at **http://localhost:3001** once installed.

---

## macOS

1. Open **Terminal**, or just double-click `install.command` in Finder.
   - If macOS blocks it ("unidentified developer"), right-click → **Open**,
     or run it from Terminal:
     ```bash
     bash installer/install.command
     ```
2. The first run may ask for your password (to install Homebrew) and will:
   - install Homebrew, Node.js 20, and PostgreSQL 15,
   - create the `eventify` database + tables,
   - build and start the app.

**Later launches:** double-click `installer/start.command` (or
`bash installer/start.command`).

---

## Windows

1. **Right-click `install.bat` → Run as administrator** (admin is required the
   first time so Node.js and PostgreSQL can install).
2. It installs Node.js LTS + PostgreSQL 15 (via `winget`), creates the
   `eventify` database + tables, builds and starts the app.

**Later launches:** double-click `installer\start.bat`.

### Windows prerequisites
- **App Installer / winget** — preinstalled on Windows 10 (2004+) and Windows 11.
  If `winget` is missing, install **App Installer** from the Microsoft Store.
- If PostgreSQL is **already installed** on the machine, the installer will ask
  for the existing `postgres` superuser password (needed once to create the
  app's role and database).

---

## Seeding the Miss Carigara 2026 configuration

After installing, sign up / log in once in the app (this creates your
organization), then run from the project folder:

```bash
npm run db:seed
```

This creates the **Miss Carigara 2026** event with all rounds, sets, criteria,
and scoring rules — but no contestants or judges (add those in the app).
Re-running with `npm run db:seed -- --force` deletes the event (including any
contestants/judges/scores added under it) and re-creates the configuration.

---

## What it creates

| Item            | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| DB role         | `eventify` (random password, generated once)               |
| Database        | `eventify` on `localhost:5432`                             |
| Connection      | written to `.env.local` as `DATABASE_URL`                  |
| Tables          | created by `npm run db:migrate` (Drizzle migrations)       |
| App URL         | http://localhost:3001                                      |

Re-running the installer is safe — it reuses the existing password and database
and just re-applies any new migrations, rebuilds, and restarts.

---

## Troubleshooting

- **Port 3001 in use:** stop the other process, or change the port in
  `package.json` (`start` script) and the start scripts.
- **`winget` not found (Windows):** install **App Installer** from the
  Microsoft Store, then re-run.
- **Postgres won't start (macOS):** `brew services restart postgresql@15`.
- **Wrong Postgres password (Windows):** re-run and enter the correct
  `postgres` superuser password, or reset it in pgAdmin.
- **Reset everything:** drop the database with
  `dropdb -h localhost eventify` (macOS) and delete `.env.local`, then re-run
  the installer.
