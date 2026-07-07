# Eventify - Windows installer (PowerShell).
#
# One-shot setup for a fresh Windows PC:
#   1. Installs Node.js LTS and PostgreSQL 15 via winget (if missing).
#   2. Ensures the PostgreSQL service is running and creates the `eventify`
#      role + database.
#   3. Writes .env.local with the generated DATABASE_URL.
#   4. Installs dependencies, runs migrations (creates the tables), builds,
#      and starts the app on http://localhost:3001.
#
# Run via installer\install.bat (recommended) or:
#   powershell -ExecutionPolicy Bypass -File installer\install.ps1
#
# Safe to re-run: if the app's database is already reachable it skips the
# superuser steps, so you are not asked for the Postgres password again.

$ErrorActionPreference = "Stop"

$Root      = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$AppName   = "Eventify"
$AppPort   = "3001"
$DbName    = "eventify"
$DbUser    = "eventify"
$DbHost    = "localhost"
$DbPort    = "5432"
$PgVersion = "15"
$PgBin     = "C:\Program Files\PostgreSQL\$PgVersion\bin"

function Log($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok($m)  { Write-Host "  [OK] $m" -ForegroundColor Green }
function Die($m) { Write-Host "`nERROR: $m" -ForegroundColor Red; exit 1 }

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user    = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user;C:\Program Files\nodejs;$PgBin"
}

function New-Password([int]$len = 24) {
  $chars = (48..57) + (65..90) + (97..122)   # 0-9 A-Z a-z (URL-safe)
  -join ($chars | Get-Random -Count $len | ForEach-Object { [char]$_ })
}

# ── winget ───────────────────────────────────────────────────────────────
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Die "winget (App Installer) is required. Install 'App Installer' from the Microsoft Store, then re-run."
}

# ── 1. Node.js 20+ ─────────────────────────────────────────────────────────
$needNode = $true
if (Get-Command node -ErrorAction SilentlyContinue) {
  $maj = (node -p "process.versions.node.split('.')[0]")
  if ([int]$maj -ge 20) { $needNode = $false }
}
if ($needNode) {
  Log "Installing Node.js LTS..."
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  Refresh-Path
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Die "Node.js could not be installed. Install it from https://nodejs.org and re-run."
}
Ok "Node.js $(node -v)"

# ── 2. PostgreSQL 15 ───────────────────────────────────────────────────────
$SuperPass = $null
if (-not (Test-Path "$PgBin\psql.exe")) {
  Log "Installing PostgreSQL $PgVersion..."
  $SuperPass = New-Password 24
  $custom = "--mode unattended --unattendedmodeui none --superpassword `"$SuperPass`" --servicename postgresql-x64-$PgVersion --serverport $DbPort"
  winget install -e --id "PostgreSQL.PostgreSQL.$PgVersion" --silent `
    --accept-package-agreements --accept-source-agreements --custom $custom
  Refresh-Path
}
if (-not (Test-Path "$PgBin\psql.exe")) {
  Die "PostgreSQL could not be found at $PgBin. Install PostgreSQL $PgVersion and re-run."
}
$psql     = "$PgBin\psql.exe"
$createdb = "$PgBin\createdb.exe"

# Make sure the service is running.
$svc = Get-Service -Name "postgresql-x64-$PgVersion" -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -ne "Running") { Start-Service $svc.Name }
Ok "PostgreSQL present"

# ── 3. Decide whether we still need superuser access ───────────────────────
# Reuse an existing working DATABASE_URL so re-runs don't re-prompt.
$DbPass = $null
$appDbWorks = $false
if ((Test-Path ".env.local") -and (Select-String -Path ".env.local" -Pattern '^DATABASE_URL=' -Quiet)) {
  $line = (Select-String -Path ".env.local" -Pattern '^DATABASE_URL=' | Select-Object -First 1).Line
  if ($line -match '://[^:]+:([^@]+)@') { $DbPass = $Matches[1] }
  if ($DbPass) {
    $env:PGPASSWORD = $DbPass
    & $psql -U $DbUser -h $DbHost -p $DbPort -d $DbName -tAc "SELECT 1" *> $null
    if ($LASTEXITCODE -eq 0) { $appDbWorks = $true }
  }
}

if (-not $appDbWorks) {
  if (-not $SuperPass) {
    # Postgres pre-existed; we need its superuser password to create the role/db.
    $sec = Read-Host "Enter the PostgreSQL 'postgres' superuser password" -AsSecureString
    $SuperPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  if (-not $DbPass) { $DbPass = New-Password 24 }

  Log "Creating database role and database..."
  $env:PGPASSWORD = $SuperPass
  $sql = @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$DbUser') THEN
    CREATE ROLE $DbUser LOGIN PASSWORD '$DbPass';
  ELSE
    ALTER ROLE $DbUser WITH LOGIN PASSWORD '$DbPass';
  END IF;
END `$`$;
"@
  $sql | & $psql -U postgres -h $DbHost -p $DbPort -d postgres -v ON_ERROR_STOP=1
  if ($LASTEXITCODE -ne 0) { Die "Could not create the role (wrong superuser password?)." }

  $exists = (& $psql -U postgres -h $DbHost -p $DbPort -d postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname='$DbName'")
  if (-not ($exists -match "1")) {
    & $createdb -U postgres -h $DbHost -p $DbPort -O $DbUser $DbName
    if ($LASTEXITCODE -ne 0) { Die "Could not create the database." }
  }
}
Ok "Database '$DbName' ready"

$DatabaseUrl = "postgres://${DbUser}:${DbPass}@${DbHost}:${DbPort}/${DbName}"

# ── 4. .env.local ──────────────────────────────────────────────────────────
Log "Writing .env.local..."
$keep = @()
if (Test-Path ".env.local") {
  $keep = Get-Content ".env.local" | Where-Object { $_ -notmatch '^DATABASE_URL=' }
}
# Write UTF-8 WITHOUT a BOM — Windows PowerShell 5.1's Set-Content -Encoding UTF8
# prepends a BOM that would corrupt the first env var (e.g. ﻿DATABASE_URL).
$envContent = (($keep + "DATABASE_URL=$DatabaseUrl") -join "`n") + "`n"
[System.IO.File]::WriteAllText((Join-Path (Get-Location) ".env.local"), $envContent, (New-Object System.Text.UTF8Encoding($false)))
Ok ".env.local updated"

# ── 5. Dependencies, migrations, build ─────────────────────────────────────
$env:DATABASE_URL = $DatabaseUrl
Log "Installing dependencies (npm ci)..."
& npm ci
if ($LASTEXITCODE -ne 0) { Die "npm ci failed." }
Log "Creating tables (running migrations)..."
& npm run db:migrate
if ($LASTEXITCODE -ne 0) { Die "Migrations failed." }
Log "Building the app..."
& npm run build
if ($LASTEXITCODE -ne 0) { Die "Build failed." }

Write-Host "`n[DONE] $AppName is installed." -ForegroundColor Green
Write-Host "  Database: postgres://${DbUser}:****@${DbHost}:${DbPort}/${DbName}"
Write-Host "  Re-launch later with: installer\start.bat`n"

# ── 6. Start ───────────────────────────────────────────────────────────────
Log "Starting $AppName on http://localhost:$AppPort ... (press Ctrl+C to stop)"
& npm run start
