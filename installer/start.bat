@echo off
REM Eventify - Windows launcher. Use after install.bat has run once.
setlocal
cd /d "%~dp0.."

REM Ensure the PostgreSQL service is running.
powershell -NoProfile -Command "$s=Get-Service -Name 'postgresql-x64-15' -ErrorAction SilentlyContinue; if ($s -and $s.Status -ne 'Running'){ Start-Service $s.Name }"

if not exist ".env.local" (
  echo No .env.local found. Run installer\install.bat first.
  pause
  exit /b 1
)
if not exist ".next" (
  echo No production build found. Run installer\install.bat first.
  pause
  exit /b 1
)

REM Apply any migrations added since the last launch, so pulling a new version
REM and relaunching (without re-running the full installer) keeps the schema in
REM sync. drizzle-kit reads DATABASE_URL from .env.local and is a safe no-op when
REM everything is already applied.
echo Applying any pending database migrations...
call npm run db:migrate
if errorlevel 1 (
  echo.
  echo Database migration failed. Not starting. Try running installer\install.bat.
  pause
  exit /b 1
)

echo Starting Eventify on http://localhost:3001 ... (press Ctrl+C to stop)
call npm run start
pause
