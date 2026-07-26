#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Phase 5 Integration Gate — rejects placeholder/fake tests.

.DESCRIPTION
  Scans mandatory Phase 5 integration test files for patterns that
  indicate placeholder or fake tests:

    - expect(true).toBe(true)          # fake assertion
    - TODO: Implement                  # placeholder
    - it.skip / test.skip              # silent skip
    - it.todo / test.todo              # unimplemented
    - hasDatabase ? it : it.skip       # conditional skip
    - test.todo / it.todo              # todo marker

  Exits with non-zero if any prohibited pattern is found.

.PARAMETER Phase
  Phase identifier (used for error messages).

.PARAMETER MandatoryTestFiles
  Array of test file paths (relative to workspace root) to scan.

.EXAMPLE
  pwsh -File scripts/p5-integration-gate.ps1 -Phase "5" -MandatoryTestFiles @("apps/api/src/__tests__/b-transaction-commission.integration.spec.ts")
#>

param(
  [Parameter(Mandatory)]
  [string]$Phase,

  [Parameter(Mandatory)]
  [string[]]$MandatoryTestFiles
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = Resolve-Path "$PSScriptRoot/.."
$exitCode = 0

$prohibitedPatterns = @(
  @{ Pattern = 'expect\(true\)\.toBe\(true\)';   Label = 'fake-assertion' }
  @{ Pattern = 'TODO:\s*Implement';              Label = 'placeholder-todo' }
  @{ Pattern = 'it\.skip\b';                     Label = 'it-skip' }
  @{ Pattern = 'test\.skip\b';                   Label = 'test-skip' }
  @{ Pattern = 'it\.todo\b';                     Label = 'it-todo' }
  @{ Pattern = 'test\.todo\b';                   Label = 'test-todo' }
  @{ Pattern = 'hasDatabase \? it : it\.skip';   Label = 'conditional-skip' }
)

Write-Host "🔍 Phase $Phase Integration Gate — scanning $($MandatoryTestFiles.Count) file(s)" -ForegroundColor Cyan
Write-Host ""

foreach ($file in $MandatoryTestFiles) {
  $fullPath = Join-Path $workspaceRoot $file
  if (-not (Test-Path $fullPath)) {
    Write-Host "  ❌ MISSING: $file" -ForegroundColor Red
    $exitCode = 1
    continue
  }

  $content = Get-Content $fullPath -Raw
  $foundProhibited = $false

  foreach ($entry in $prohibitedPatterns) {
    if ($content -match $entry.Pattern) {
      # Find line numbers for reporting
      $lines = Get-Content $fullPath
      $lineNums = @()
      for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $entry.Pattern) {
          $lineNums += ($i + 1).ToString()
        }
      }
      Write-Host "  ❌ $($entry.Label) in $file (lines: $($lineNums -join ', '))" -ForegroundColor Red
      $foundProhibited = $true
      $exitCode = 1
    }
  }

  if (-not $foundProhibited) {
    Write-Host "  ✅ $file — clean" -ForegroundColor Green
  }
}

Write-Host ""
if ($exitCode -eq 0) {
  Write-Host "✅ Phase $Phase Integration Gate PASSED" -ForegroundColor Green
} else {
  Write-Host "❌ Phase $Phase Integration Gate FAILED — remove placeholder patterns before merging" -ForegroundColor Red
}

exit $exitCode
