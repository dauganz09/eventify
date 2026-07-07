#!/usr/bin/env bash
#
# Eventify — macOS launcher. Use this for everyday startup AFTER install.command
# has run once. It ensures PostgreSQL is running, then starts the built app.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

APP_PORT="3001"
PG_FORMULA="postgresql@15"

[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
[ -x /usr/local/bin/brew ]    && eval "$(/usr/local/bin/brew shellenv)"

if command -v brew >/dev/null 2>&1; then
  export PATH="$(brew --prefix "$PG_FORMULA" 2>/dev/null)/bin:$PATH"
  export PATH="$(brew --prefix node@20 2>/dev/null)/bin:$PATH"
  brew services start "$PG_FORMULA" >/dev/null 2>&1 || true
fi

if [ ! -f .env.local ] || ! grep -q '^DATABASE_URL=' .env.local; then
  echo "No DATABASE_URL found. Run installer/install.command first." >&2
  exit 1
fi
if [ ! -d .next ]; then
  echo "No production build found. Run installer/install.command first." >&2
  exit 1
fi

# Apply any migrations added since the last launch, so pulling a new version
# and relaunching (without re-running the full installer) keeps the schema in
# sync. drizzle-kit reads DATABASE_URL from .env.local and is a safe no-op when
# everything is already applied.
echo "Applying any pending database migrations…"
npm run db:migrate

echo "Starting Eventify on http://localhost:${APP_PORT} … (press Ctrl+C to stop)"
exec npm run start
