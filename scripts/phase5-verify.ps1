$ErrorActionPreference = "Stop"
$ProjectRoot = "C:\AI_WORKSPACE\iPoint App"
Set-Location $ProjectRoot

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Phase 5 Local Verification" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host ">> Step 1/5: pnpm format:check" -ForegroundColor Yellow
pnpm format:check
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL format:check" -ForegroundColor Red; exit 1 }
Write-Host "OK format:check" -ForegroundColor Green
Write-Host ""

Write-Host ">> Step 2/5: pnpm lint" -ForegroundColor Yellow
pnpm lint
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL lint" -ForegroundColor Red; exit 1 }
Write-Host "OK lint" -ForegroundColor Green
Write-Host ""

Write-Host ">> Step 3/5: pnpm typecheck" -ForegroundColor Yellow
pnpm typecheck
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL typecheck" -ForegroundColor Red; exit 1 }
Write-Host "OK typecheck" -ForegroundColor Green
Write-Host ""

Write-Host ">> Step 4/5: pnpm build" -ForegroundColor Yellow
pnpm build
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL build" -ForegroundColor Red; exit 1 }
Write-Host "OK build" -ForegroundColor Green
Write-Host ""

Write-Host ">> Step 5/5: pnpm test" -ForegroundColor Yellow
pnpm test
if ($LASTEXITCODE -ne 0) { Write-Host "FAIL test" -ForegroundColor Red; exit 1 }
Write-Host "OK test" -ForegroundColor Green
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " ALL GATES PASSED" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
