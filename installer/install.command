#!/usr/bin/env bash
#
# Eventify — macOS installer.
#
# One-shot setup for a fresh Mac:
#   1. Installs Homebrew (if missing), Node.js 20+, and PostgreSQL 15.
#   2. Starts PostgreSQL and creates the `eventify` role + database.
#   3. Writes .env.local with the generated DATABASE_URL.
#   4. Installs app dependencies, runs migrations (creates the tables),
#      and builds the production app.
#   5. Starts the app on http://localhost:3001.
#
# Safe to re-run: every step is idempotent and the DB password is reused.
# Double-click in Finder, or run:  bash installer/install.command
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="Eventify"
APP_PORT="3001"
DB_NAME="eventify"
DB_USER="eventify"
DB_HOST="localhost"
DB_PORT="5432"
PG_FORMULA="postgresql@15"

log()  { printf "\n\033[1;36m==>\033[0m \033[1m%s\033[0m\n" "$1"; }
ok()   { printf "\033[1;32m  ✓\033[0m %s\n" "$1"; }
die()  { printf "\n\033[1;31mERROR:\033[0m %s\n" "$1" >&2; exit 1; }

# ── 1. Homebrew ────────────────────────────────────────────────────────────
if ! command -v brew >/dev/null 2>&1; then
  log "Homebrew not found — installing (you may be prompted for your password)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Make brew available on PATH for this session (Apple Silicon + Intel paths).
[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"
command -v brew >/dev/null 2>&1 || die "Homebrew is required but could not be installed."
ok "Homebrew ready"

# ── 2. Node.js 20+ ─────────────────────────────────────────────────────────
need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [ "${major:-0}" -ge 20 ] && need_node=0
fi
if [ "$need_node" -eq 1 ]; then
  log "Installing Node.js 20…"
  brew install node@20
  brew link --overwrite --force node@20 >/dev/null 2>&1 || true
  export PATH="$(brew --prefix node@20)/bin:$PATH"
fi
command -v node >/dev/null 2>&1 || die "Node.js is required but could not be installed."
ok "Node.js $(node -v)"

# ── 3. PostgreSQL 15 ───────────────────────────────────────────────────────
if ! brew list "$PG_FORMULA" >/dev/null 2>&1; then
  log "Installing PostgreSQL 15…"
  brew install "$PG_FORMULA"
fi
# postgresql@15 is keg-only — add its binaries to PATH for this session.
export PATH="$(brew --prefix "$PG_FORMULA")/bin:$PATH"

log "Starting PostgreSQL…"
brew services start "$PG_FORMULA" >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  pg_isready -q -h "$DB_HOST" -p "$DB_PORT" && break
  sleep 1
done
pg_isready -q -h "$DB_HOST" -p "$DB_PORT" || die "PostgreSQL did not become ready on $DB_HOST:$DB_PORT."
ok "PostgreSQL is running"

# ── 4. Role + database (idempotent) ────────────────────────────────────────
# Under Homebrew the current macOS user is a Postgres superuser.
ADMIN_DB="postgres"
psql -h "$DB_HOST" -p "$DB_PORT" -d "$ADMIN_DB" -tAc "SELECT 1" >/dev/null 2>&1 || ADMIN_DB="$USER"

# Reuse the password already stored in .env.local, if present.
DB_PASS=""
if [ -f .env.local ] && grep -q '^DATABASE_URL=' .env.local; then
  DB_PASS="$(grep -E '^DATABASE_URL=' .env.local | head -1 | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
fi
[ -z "$DB_PASS" ] && DB_PASS="$(openssl rand -hex 16)"

log "Creating database role and database…"
psql -h "$DB_HOST" -p "$DB_PORT" -d "$ADMIN_DB" -v ON_ERROR_STOP=1 >/dev/null <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END \$\$;
SQL
if ! psql -h "$DB_HOST" -p "$DB_PORT" -d "$ADMIN_DB" -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  createdb -h "$DB_HOST" -p "$DB_PORT" -O "$DB_USER" "$DB_NAME"
fi
ok "Database '${DB_NAME}' ready"

DATABASE_URL="postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

# ── 5. .env.local ──────────────────────────────────────────────────────────
log "Writing .env.local…"
touch .env.local
grep -v '^DATABASE_URL=' .env.local > .env.local.tmp 2>/dev/null || true
mv .env.local.tmp .env.local 2>/dev/null || true
echo "DATABASE_URL=${DATABASE_URL}" >> .env.local
ok ".env.local updated"

# ── 6. Dependencies, migrations, build ─────────────────────────────────────
export DATABASE_URL
log "Installing dependencies (npm ci)…"
npm ci
log "Creating tables (running migrations)…"
npm run db:migrate
log "Building the app…"
npm run build

printf "\n\033[1;32m✔ %s is installed.\033[0m\n" "$APP_NAME"
printf "  Database: postgres://%s:****@%s:%s/%s\n" "$DB_USER" "$DB_HOST" "$DB_PORT" "$DB_NAME"
printf "  Re-launch later with: \033[1minstaller/start.command\033[0m\n\n"

# ── 7. Start ───────────────────────────────────────────────────────────────
log "Starting $APP_NAME on http://localhost:${APP_PORT} … (press Ctrl+C to stop)"
exec npm run start
