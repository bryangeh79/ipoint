#!/usr/bin/env pwsh
param(
  [Parameter(Mandatory)][string]$Phase,
  [Parameter(Mandatory)][string[]]$MandatoryTestFiles
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Resolve-Path "$PSScriptRoot/.."
$exitCode = 0

$prohibitedPatterns = @(
  @{ Pattern = 'expect\(true\)\.toBe\(true\)';              Label = 'fake-assertion' }
  @{ Pattern = 'TODO:\s*Implement';                         Label = 'todo-implement' }
  @{ Pattern = 'will be implemented';                       Label = 'will-be-implemented' }
  @{ Pattern = 'For CI gating';                             Label = 'ci-gating-comment' }
  @{ Pattern = 'it\.skip\b';                                Label = 'it-skip' }
  @{ Pattern = 'test\.skip\b';                              Label = 'test-skip' }
  @{ Pattern = 'it\.todo\b';                                Label = 'it-todo' }
  @{ Pattern = 'test\.todo\b';                              Label = 'test-todo' }
  @{ Pattern = 'if \(!process\.env\.DATABASE_URL\) return'; Label = 'conditional-db-skip' }
  @{ Pattern = 'information_schema\.tables';                Label = 'info-schema-table-check' }
  @{ Pattern = 'information_schema\.columns';               Label = 'info-schema-column-check' }
  @{ Pattern = 'to_regclass';                               Label = 'to-regclass-check' }
  @{ Pattern = 'toBeDefined\(\)';                           Label = 'tobedefined-assertion' }
    @{ Pattern = 'placeholder';                               Label = 'placeholder-string' }

  # Phase 5 B-strict assertion gate (Command Center 2026-07-26)
  @{ Pattern = 'if \(outcome';                               Label = 'conditional-outcome' }
  @{ Pattern = 'if \(.*Ledger';                              Label = 'conditional-ledger' }
  @{ Pattern = 'if \(.*Result';                              Label = 'conditional-result' }
  @{ Pattern = 'if \(zeroResult';                            Label = 'conditional-zeroresult' }
  @{ Pattern = 'if \(anyLedger';                             Label = 'conditional-anyledger' }
  @{ Pattern = 'toContain\(outcome';                         Label = 'multi-outcome-fallback' }
  @{ Pattern = 'toBeGreaterThanOrEqual\(0\)';                Label = 'gte0-count' }
  @{ Pattern = '["'"']SKIPPED_INELIGIBLE["'"'], ["'"']SKIPPED_NO_BENEFICIARY["'"']'; Label = 'b07-dual-outcome' }
  @{ Pattern = 'writeFileSync';                              Label = 'forensics-write' }
  @{ Pattern = 'B_FORENSICS_FILE';                           Label = 'forensics-env-var' }
  @{ Pattern = 'r\.forensics';                               Label = 'forensics-object' }
  @{ Pattern = '// Note:';                                   Label = 'regex-leftover-comment' }
  @{ Pattern = 'leftover from regex';                        Label = 'regex-leftover-string' }
)

Write-Host "[Phase $Phase Integration Gate] Scanning $($MandatoryTestFiles.Count) file(s)"

$globalViolations = $false
foreach ($file in $MandatoryTestFiles) {
  $fullPath = Join-Path $workspaceRoot $file
  if (-not (Test-Path $fullPath)) {
    Write-Host "  MISSING: $file" -ForegroundColor Red
    $exitCode = 1; continue
  }
  $content = Get-Content $fullPath -Raw
  $lines = Get-Content $fullPath
  $fileViolations = $false

  foreach ($entry in $prohibitedPatterns) {
    if ($content -match $entry.Pattern) {
      $lineNums = @()
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $entry.Pattern) { $lineNums += ($i + 1).ToString() }
      }
      Write-Host "  FAIL $($entry.Label) in $file (lines: $($lineNums -join ','))" -ForegroundColor Red
      $globalViolations = $true; $fileViolations = $true; $exitCode = 1
    }
  }

  if (-not $fileViolations) { Write-Host "  PASS $file - clean" -ForegroundColor Green }
}

Write-Host ""
Write-Host "Structural integrity check:"
foreach ($file in $MandatoryTestFiles) {
  $fullPath = Join-Path $workspaceRoot $file
  if (-not (Test-Path $fullPath)) { continue }
  $lines = Get-Content $fullPath

  $testCount = 0; $todoCount = 0; $skipCount = 0
  foreach ($line in $lines) {
    if ($line -match '\bit\b\(' -or $line -match '\btest\b\(') { $testCount++ }
    if ($line -match 'it\.todo|test\.todo') { $todoCount++ }
    if ($line -match 'it\.skip|test\.skip') { $skipCount++ }
  }

  Write-Host "  $file - tests: $testCount, todo: $todoCount, skip: $skipCount"
  if ($todoCount -gt 0) { Write-Host "    FAIL: has $todoCount todo(s)" -ForegroundColor Red; $exitCode = 1 }
  if ($skipCount -gt 0) { Write-Host "    FAIL: has $skipCount skip(s)" -ForegroundColor Red; $exitCode = 1 }
  if ($testCount -lt 15) { Write-Host "    FAIL: only $testCount tests (need >= 15)" -ForegroundColor Red; $exitCode = 1 }
  else { Write-Host "    PASS: $testCount tests present" -ForegroundColor Green }
}

if ($exitCode -eq 0) { Write-Host "Phase $Phase Integration Gate PASSED" -ForegroundColor Green }
else { Write-Host "Phase $Phase Integration Gate FAILED - remove prohibited patterns" -ForegroundColor Red }
exit $exitCode
