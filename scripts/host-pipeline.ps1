<#
.SYNOPSIS
    iPoint Phase 3 — Host Pipeline (PowerShell)
    Runs the full pnpm pipeline: install, format:check, lint, typecheck, build, test.
    Logs all output to a timestamped file.

.DESCRIPTION
    Intended for execution on the Windows host (where pnpm and Git work natively).
    Do NOT run inside the sandbox container.

    Usage:
        .\scripts\host-pipeline.ps1 [-NoInstall] [-SkipTests]
#>

param(
    [switch]$NoInstall,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$PipelineRoot = Resolve-Path "$PSScriptRoot\.."
$Timestamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$LogDir = Join-Path $PipelineRoot "pipeline-logs"
$null = New-Item -ItemType Directory -Force -Path $LogDir
$LogFile = Join-Path $LogDir "pipeline-$Timestamp.log"

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $Line = "[$((Get-Date -Format 'HH:mm:ss'))] [$Level] $Message"
    Add-Content -Path $LogFile -Value $Line
    Write-Host $Line
}

function Invoke-Step {
    param([string]$Name, [scriptblock]$ScriptBlock)
    Write-Log "▶ $Name - START"
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $output = & $ScriptBlock 2>&1
        $sw.Stop()
        $output | ForEach-Object { Write-Log "  $_" }
        Write-Log "✅ $Name - PASSED ($($sw.Elapsed.TotalSeconds.ToString('F2'))s)"
        return $true
    }
    catch {
        $sw.Stop()
        Write-Log "❌ $Name - FAILED ($($sw.Elapsed.TotalSeconds.ToString('F2'))s)"
        Write-Log "  Error: $_"
        return $false
    }
}

# ── Header ──
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║     iPoint Phase 3 — Host Pipeline           ║" -ForegroundColor Cyan
Write-Host "║     $Timestamp                              ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Log "Pipeline started"
Write-Log "Root: $PipelineRoot"
Write-Log "Log:  $LogFile"

# ── Environment checks ──
Write-Log "--- Environment ---"

# Node version
try {
    $nodeVer = node --version
    Write-Log "Node: $nodeVer"
}
catch {
    Write-Log "Node: NOT FOUND - please install Node.js >=22.0.0" -Level "ERROR"
    exit 1
}

# pnpm version
try {
    $pnpmVer = pnpm --version
    Write-Log "pnpm: $pnpmVer"
    if ($pnpmVer -lt "9.15.0") {
        Write-Log "pnpm version $pnpmVer below required 9.15.0" -Level "WARN"
    }
}
catch {
    Write-Log "pnpm: NOT FOUND - please install pnpm@9.15.9" -Level "ERROR"
    exit 1
}

# Git repo
try {
    $branch = git -C $PipelineRoot branch --show-current
    Write-Log "Git branch: $branch"
}
catch {
    Write-Log "Git: NOT FOUND or not a repository" -Level "WARN"
}

# ── Pipeline steps ──
$stepsPassed = 0
$stepsFailed = 0

# 1. Install
if (-not $NoInstall) {
    if (Invoke-Step "pnpm install" { pnpm install --frozen-lockfile }) {
        $stepsPassed++
    } else {
        $stepsFailed++
    }
} else {
    Write-Log "⏭ Skipping pnpm install (--NoInstall)"
}

# 2. Format check
if (Invoke-Step "pnpm format:check" { pnpm format:check }) {
    $stepsPassed++
} else {
    $stepsFailed++
}

# 3. Lint
if (Invoke-Step "pnpm lint" { pnpm lint }) {
    $stepsPassed++
} else {
    $stepsFailed++
}

# 4. Typecheck
if (Invoke-Step "pnpm typecheck" { pnpm typecheck }) {
    $stepsPassed++
} else {
    $stepsFailed++
}

# 5. Build
if (Invoke-Step "pnpm build" { pnpm build }) {
    $stepsPassed++
} else {
    $stepsFailed++
}

# 6. Test
if (-not $SkipTests) {
    if (Invoke-Step "pnpm test --reporter verbose" { pnpm test -- --reporter verbose }) {
        $stepsPassed++
    } else {
        $stepsFailed++
    }
} else {
    Write-Log "⏭ Skipping tests (--SkipTests)"
}

# ── Summary ──
Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║              PIPELINE SUMMARY                ║" -ForegroundColor Cyan
Write-Host "╠══════════════════════════════════════════════╣" -ForegroundColor Cyan
Write-Host "║  Passed: $($stepsPassed.ToString().PadLeft(3))                               ║" -ForegroundColor $(if ($stepsFailed -eq 0) { "Green" } else { "Yellow" })
Write-Host "║  Failed: $($stepsFailed.ToString().PadLeft(3)}                               ║" -ForegroundColor $(if ($stepsFailed -gt 0) { "Red" } else { "Green" })
Write-Host "║  Log:    $LogFile" -ForegroundColor Gray
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Log "Pipeline finished — Passed: $stepsPassed, Failed: $stepsFailed"
exit $stepsFailed
