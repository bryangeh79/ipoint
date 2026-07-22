param(
  [Parameter(Mandatory=$true)]
  [string]$JobId,
  [Parameter(Mandatory=$true)]
  [string]$TaskPrompt,
  [string]$WorkDir = "C:\AI_WORKSPACE\iPoint App",
  [string]$Model = "gpt-5.6-sol",
  [int]$TimeoutSeconds = 3600
)

$ErrorActionPreference = "Continue"
$jobDir = ".local/codex-jobs/$JobId"
New-Item -ItemType Directory -Force -Path $jobDir | Out-Null

# Remove prohibited env vars
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:CODEX_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:CODEX_AUTH_TOKEN -ErrorAction SilentlyContinue

$stdout = Join-Path $jobDir "stdout.log"
$stderr = Join-Path $jobDir "stderr.log"
$exitFile = Join-Path $jobDir "exit-code.txt"
$resultFile = Join-Path $jobDir "result.json"

$promptFile = Join-Path $jobDir "prompt.txt"
Set-Content -Path $promptFile -Value $TaskPrompt -Encoding UTF8

$startTime = Get-Date
$job = @{
  jobId = $JobId
  startTime = $startTime.ToString("o")
  status = "STARTING"
  workDir = $WorkDir
} | ConvertTo-Json | Set-Content (Join-Path $jobDir "job.json")

Write-Output "[SUPERVISOR] Starting Codex CLI job $JobId"
Write-Output "[SUPERVISOR] WorkDir: $WorkDir"
Write-Output "[SUPERVISOR] PID: $$"

# Start Codex CLI process
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "powershell"
$psi.Arguments = "-NoProfile -Command `"codex exec --dangerously-bypass-approvals-and-sandbox -m '$Model' `$(Get-Content '$promptFile' -Raw)`""
$psi.WorkingDirectory = $WorkDir
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
$process.Start() | Out-Null

$pid = $process.Id
$job.status = "RUNNING"
$job.pid = $pid
$job | ConvertTo-Json | Set-Content (Join-Path $jobDir "job.json")

# Wait loop with heartbeats
$lastHeartbeat = Get-Date
while (-not $process.HasExited) {
  Start-Sleep -Seconds 30
  $elapsed = (Get-Date) - $startTime
  $nowHeartbeat = Get-Date
  
  # Read stdout/stderr periodically to keep buffers clear
  $stdoutLine = $process.StandardOutput.ReadToAsync().Result
  $stderrLine = $process.StandardError.ReadToAsync().Result
  
  if ($stdoutLine) { Add-Content -Path $stdout -Value $stdoutLine }
  if ($stderrLine) { Add-Content -Path $stderr -Value $stderrLine }
  
  Write-Output "[CODEX HEARTBEAT] JOB=$JobId PID=$pid ELAPSED=$([math]::Round($elapsed.TotalMinutes,1))m"

  if ($elapsed.TotalSeconds -gt $TimeoutSeconds) {
    Write-Output "[SUPERVISOR] Timeout reached ($TimeoutSeconds seconds). Killing process."
    $process.Kill()
    break
  }
}

# Drain remaining output
$process.WaitForExit(10000) | Out-Null
$remainingStdout = $process.StandardOutput.ReadToEnd()
$remainingStderr = $process.StandardError.ReadToEnd()
if ($remainingStdout) { Add-Content -Path $stdout -Value $remainingStdout }
if ($remainingStderr) { Add-Content -Path $stderr -Value $remainingStderr }

$exitCode = $process.ExitCode
Set-Content -Path $exitFile -Value $exitCode

$result = @{
  executionEngine = "Codex CLI"
  openClawSubagentUsed = "NO"
  authSource = "CHATGPT_ACCOUNT_SESSION"
  jobId = $JobId
  pid = $pid
  exitCode = $exitCode
  stdout = $stdout
  stderr = $stderr
  completedAt = (Get-Date).ToString("o")
} | ConvertTo-Json

$result | Set-Content $resultFile

Write-Output "[SUPERVISOR] Job $JobId completed with exit code $exitCode"
Write-Output "EXIT_CODE=$exitCode"
Write-Output "[STDOUT_TAIL]"
Get-Content $stdout -Tail 10 -ErrorAction SilentlyContinue

exit $exitCode
