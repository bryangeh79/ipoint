# P8-S7 migration integrity rehearsal (host-run, PostgreSQL 17).
#
#   Fresh rehearsal   : apply 0000-0039 to an empty dedicated database,
#                       verify 40/40 checksums + drift clean + seed.
#   Upgrade rehearsal : stage the Phase 7 head set (0000-0036) first, then
#                       apply the Phase 8 additions (0037-0039), verify
#                       forward-only application, 40/40 checksums + drift.
#
# Zero new migrations: the frozen 40/40 set is rehearsed only, never edited.
# Uses dedicated `ipoint_p8s7_fresh_*` / `ipoint_p8s7_upgrade_*` databases on
# the host PostgreSQL (docker container `ipoint-postgres-1`, port 55432).
#
# Usage:
#   .\scripts\p8-s7\migration-rehearsal.ps1
# Evidence: .local/p8-s7-migration/<timestamp>/
# No $ErrorActionPreference='Stop' here on purpose: on Windows PowerShell
# 5.1 any native-command stderr line (psql NOTICEs) would abort the script.
# Every step checks $LASTEXITCODE explicitly.
$ErrorActionPreference = 'Continue'
$PSNativeCommandUseErrorActionPreference = $false

$ts = (Get-Date -Format 'yyyyMMddTHHmmss').ToLowerInvariant()
$outDir = ".local\p8-s7-migration\$ts"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$adminUrl = $env:P8S7_ADMIN_DATABASE_URL
if (-not $adminUrl) { $adminUrl = 'postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/postgres' }
$pgContainer = $env:P8S7_PG_CONTAINER
if (-not $pgContainer) { $pgContainer = 'ipoint-postgres-1' }

$freshDb = "ipoint_p8s7_fresh_$ts"
$upgradeDb = "ipoint_p8s7_upgrade_$ts"
$freshUrl = "postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/$freshDb"
$upgradeUrl = "postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/$upgradeDb"

function Exec-Capture([string]$label, [scriptblock]$block) {
  Write-Host "== $label"
  $log = Join-Path $outDir (($label -replace '[^a-z0-9]+', '-') + '.log')
  & $block *> $log
  if ($LASTEXITCODE) {
    throw "Step failed with exit code $LASTEXITCODE : $label"
  }
  Write-Host "   -> $log"
}

function Exec-DockerPsql([string]$db, [string]$sql) {
  docker exec $pgContainer psql -h 127.0.0.1 -U ipoint -d $db -v ON_ERROR_STOP=1 -c $sql
  if ($LASTEXITCODE -ne 0) { throw "psql failed on $db" }
}

function Sha256([string]$path) {
  return (Get-FileHash -Algorithm SHA256 -Path $path).Hash.ToLowerInvariant()
}

try {
  $migrationsDir = 'packages\database\migrations'
  $phase7Head = Get-ChildItem $migrationsDir -Filter '*.sql' |
    Where-Object { $_.BaseName -match '^\d+_' } |
    Sort-Object Name |
    Where-Object { [int](($_.BaseName -split '_')[0]) -le 36 }

  # ---------- Fresh rehearsal ----------
  Exec-DockerPsql 'postgres' "DROP DATABASE IF EXISTS $freshDb WITH (FORCE)"
  Exec-DockerPsql 'postgres' "CREATE DATABASE $freshDb"
  $env:DATABASE_URL = $freshUrl
  Exec-Capture 'fresh-db-checksum' { pnpm db:checksum }
  Exec-Capture 'fresh-db-migrate' { pnpm db:migrate }
  Exec-Capture 'fresh-db-checksum-after' { pnpm db:checksum }
  Exec-Capture 'fresh-db-drift' { pnpm db:drift }
  Exec-Capture 'fresh-db-seed' { pnpm db:seed }
  $appliedFresh = docker exec $pgContainer psql -h 127.0.0.1 -U ipoint -d $freshDb -t -A -c "SELECT count(*) FROM database_migrations"
  Write-Host "fresh applied migrations: $appliedFresh"

  # ---------- Upgrade rehearsal (Phase 7 head 0036 -> Phase 8 0037-0039) ----------
  Exec-DockerPsql 'postgres' "DROP DATABASE IF EXISTS $upgradeDb WITH (FORCE)"
  Exec-DockerPsql 'postgres' "CREATE DATABASE $upgradeDb"

  # The runner owns the migration table DDL; stage it so manual psql applies
  # can record the same rows the runner would.
  Exec-DockerPsql $upgradeDb "CREATE TABLE database_migrations (filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz(6) NOT NULL DEFAULT now())"

  # Apply the frozen Phase 7 head set (0000-0036) manually via psql, recording
  # the exact same checksums the runner computes (sha256 of file bytes).
  $staged = @()
  foreach ($file in $phase7Head) {
    docker cp $file.FullName "${pgContainer}:/tmp/p8s7-mig.sql" | Out-Null
    docker exec $pgContainer psql -h 127.0.0.1 -U ipoint -d $upgradeDb -v ON_ERROR_STOP=1 -f /tmp/p8s7-mig.sql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "psql failed applying $($file.Name)" }
    $checksum = Sha256 $file.FullName
    Exec-DockerPsql $upgradeDb "INSERT INTO database_migrations (filename, checksum) VALUES ('$($file.Name)', '$checksum')"
    $staged += $file.Name
  }
  Write-Host "staged Phase 7 head set: $($staged.Count) migrations (0000-0036)"

  # Now the frozen runner applies ONLY the Phase 8 additions 0037-0039 and
  # validates every recorded checksum against the manifest (40/40).
  $env:DATABASE_URL = $upgradeUrl
  Exec-Capture 'upgrade-db-checksum' { pnpm db:checksum }
  Exec-Capture 'upgrade-db-migrate' { pnpm db:migrate }
  Exec-Capture 'upgrade-db-checksum-after' { pnpm db:checksum }
  Exec-Capture 'upgrade-db-drift' { pnpm db:drift }
  Exec-Capture 'upgrade-db-seed' { pnpm db:seed }
  $appliedUpgrade = docker exec $pgContainer psql -h 127.0.0.1 -U ipoint -d $upgradeDb -t -A -c "SELECT count(*) FROM database_migrations"
  $maxApplied = docker exec $pgContainer psql -h 127.0.0.1 -U ipoint -d $upgradeDb -t -A -c "SELECT filename FROM database_migrations ORDER BY filename DESC LIMIT 1"
  Write-Host "upgrade applied migrations: $appliedUpgrade (last: $maxApplied)"

  # ---------- Evidence summary ----------
  $summary = [ordered]@{
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    freshDb = $freshDb
    upgradeDb = $upgradeDb
    freshAppliedMigrations = $appliedFresh.Trim()
    upgradeAppliedMigrations = $appliedUpgrade.Trim()
    upgradeLastApplied = $maxApplied.Trim()
    frozenChecksums = '40/40 unchanged (db:checksum exit 0 on fresh and upgrade)'
    driftClean = 'db:drift exit 0 on fresh and upgrade'
    stagedPhase7HeadCount = $staged.Count
    phase8Additions = '0037-0039'
  }
  $summary | ConvertTo-Json | Set-Content (Join-Path $outDir 'summary.json')
  Write-Host "MIGRATION_REHEARSAL_COMPLETE: $outDir"
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
