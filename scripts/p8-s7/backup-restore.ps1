# P8-S7 backup -> restore -> verify rehearsal (host-run, PostgreSQL 17).
#
# Uses dedicated `ipoint_p8s7_source_*` / `ipoint_p8s7_restore_*` databases on
# the host PostgreSQL (docker container `ipoint-postgres-1`, port 55432).
# NEVER touches ipoint_ci, shared dev DBs, or any production database.
#
# Requirements: docker (postgres:17-alpine container with pg_dump/pg_restore),
# pnpm 9, Node 22+.
#
# Usage:
#   .\scripts\p8-s7\backup-restore.ps1
# Evidence: .local/p8-s7-backup/<timestamp>/
# No $ErrorActionPreference='Stop' here on purpose: on Windows PowerShell
# 5.1 any native-command stderr line (psql NOTICEs, pg_restore progress)
# would abort the script. Every step instead checks $LASTEXITCODE explicitly
# (Exec-Capture / Exec-DockerPsql) so failures are caught deterministically.
$ErrorActionPreference = 'Continue'
# PowerShell 7.5+ converts native stderr to error records; keep them as
# captured output, never as thrown errors.
$PSNativeCommandUseErrorActionPreference = $false

$ts = (Get-Date -Format 'yyyyMMddTHHmmss').ToLowerInvariant()
$outDir = ".local\p8-s7-backup\$ts"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$adminUrl = $env:P8S7_ADMIN_DATABASE_URL
if (-not $adminUrl) { $adminUrl = 'postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/postgres' }
$pgContainer = $env:P8S7_PG_CONTAINER
if (-not $pgContainer) { $pgContainer = 'ipoint-postgres-1' }

$sourceDb = "ipoint_p8s7_source_$ts"
$restoreDb = "ipoint_p8s7_restore_$ts"
$sourceUrl = "postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/$sourceDb"
$restoreUrl = "postgresql://ipoint:ipoint-local-only@127.0.0.1:55432/$restoreDb"
$dumpName = "$sourceDb.dump"

# Runs a scriptblock, captures ALL output (stdout + stderr) into an evidence
# log and throws when the native exit code is non-zero. `2>&1` capture is
# required on Windows PowerShell 5.1: native stderr must never surface as a
# PowerShell error record (it would abort the script on benign stderr lines).
function Exec-Capture([string]$label, [scriptblock]$block) {
  Write-Host "== $label"
  $log = Join-Path $outDir (($label -replace '[^a-z0-9]+', '-') + '.log')
  $output = & $block 2>&1
  $output | Out-File -Encoding utf8 $log
  if ($LASTEXITCODE) {
    throw "Step failed with exit code $LASTEXITCODE : $label (see $log)"
  }
  Write-Host "   -> $log"
}

function Exec-DockerPsql([string]$db, [string]$sql) {
  $output = docker exec $pgContainer psql -h 127.0.0.1 -U ipoint -d $db -v ON_ERROR_STOP=1 -c $sql 2>&1
  $output | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE) { throw "psql failed on $db" }
}

try {
  # 1. Create the source database (drop stale same-name leftovers first).
  Exec-DockerPsql 'postgres' "DROP DATABASE IF EXISTS $sourceDb WITH (FORCE)"
  Exec-DockerPsql 'postgres' "CREATE DATABASE $sourceDb"
  Exec-DockerPsql 'postgres' "DROP DATABASE IF EXISTS $restoreDb WITH (FORCE)"

  # 2. Migrate + seed the source at Phase 8 state; capture integrity baseline.
  $env:DATABASE_URL = $sourceUrl
  Exec-Capture 'db-checksum-source' { pnpm db:checksum }
  Exec-Capture 'db-migrate-source' { pnpm db:migrate }
  Exec-Capture 'db-seed-source' { pnpm db:seed }
  Exec-Capture 'db-drift-source' { pnpm db:drift }

  # 3. pg_dump (custom format) inside the PG container, copy out to evidence.
  Exec-Capture 'pg-dump' { docker exec $pgContainer pg_dump -h 127.0.0.1 -U ipoint -Fc -d $sourceDb -f "/tmp/$dumpName" }
  Exec-Capture 'docker-cp-dump' { docker cp "${pgContainer}:/tmp/$dumpName" (Join-Path $outDir $dumpName) }

  # 4. Restore into a fresh dedicated restore database.
  Exec-DockerPsql 'postgres' "CREATE DATABASE $restoreDb"
  Exec-Capture 'docker-cp-restore' { docker cp (Join-Path $outDir $dumpName) "${pgContainer}:/tmp/$dumpName" }
  Exec-Capture 'pg-restore' { docker exec $pgContainer pg_restore -h 127.0.0.1 -U ipoint -d $restoreDb "/tmp/$dumpName" }

  # 5. Verify: row-count parity, migrations parity, write-path round trip,
  #    read query, drift clean, migration checksum integrity on the restored DB.
  $env:P8S7_SOURCE_DATABASE_URL = $sourceUrl
  $env:P8S7_RESTORE_DATABASE_URL = $restoreUrl
  Exec-Capture 'verify-restored-db' { node scripts\p8-s7\verify-restored-db.mjs }

  $env:DATABASE_URL = $restoreUrl
  Exec-Capture 'db-drift-restored' { pnpm db:drift }
  Exec-Capture 'db-checksum-restored' { pnpm db:checksum }

  # 6. Functional smoke: boot the API against the RESTORED database and hit
  #    /health/ready (expect database: ok). Host Redis must be running.
  $env:P8S7_SMOKE_DATABASE_URL = $restoreUrl
  Exec-Capture 'health-smoke' { node .local\p8-s7-check\health-smoke.mjs }

  # 7. Evidence summary.
  $dumpMeta = Get-Item (Join-Path $outDir $dumpName)
  $verifySummary = Get-Content (Join-Path $outDir 'verify-restored-db.log') -Raw
  $summary = [ordered]@{
    timestamp = (Get-Date).ToUniversalTime().ToString('o')
    sourceDb = $sourceDb
    restoreDb = $restoreDb
    pgContainer = $pgContainer
    dumpFile = $dumpName
    dumpBytes = $dumpMeta.Length
    dbChecksumsFrozen = '40/40 (db:checksum exit 0 on source and restored)'
    driftClean = 'db:drift exit 0 on source and restored'
    verifyResult = if ($verifySummary -match 'VERIFY_RESULT: PASS') { 'PASS' } else { 'CHECK verify-restored-db.log' }
  }
  $summary | ConvertTo-Json | Set-Content (Join-Path $outDir 'summary.json')
  Write-Host "BACKUP_RESTORE_REHEARSAL_COMPLETE: $outDir"
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:P8S7_SOURCE_DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:P8S7_RESTORE_DATABASE_URL -ErrorAction SilentlyContinue
}
