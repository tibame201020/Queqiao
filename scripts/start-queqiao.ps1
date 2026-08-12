[CmdletBinding()]
param(
  [switch]$Rebuild
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $projectRoot 'dist'
$workerEntry = Join-Path $runtime 'queqiao-worker.js'
$gatewayEntry = Join-Path $runtime 'queqiao-gateway.js'
$layout = & node (Join-Path $runtime 'queqiao.js') config paths | ConvertFrom-Json
$logDirectory = Join-Path $layout.logDir 'startup'

if ($Rebuild) {
  Push-Location $projectRoot
  try { & npm run build:package; if ($LASTEXITCODE -ne 0) { throw 'Queqiao package build failed' } }
  finally { Pop-Location }
}
if (!(Test-Path -LiteralPath $workerEntry) -or !(Test-Path -LiteralPath $gatewayEntry)) {
  throw 'Queqiao bundle is missing. Run npm run build:package or use -Rebuild.'
}
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

function Test-Health([string]$Url) {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2).StatusCode -eq 200 }
  catch { return $false }
}

function Start-NodeService([string]$Name, [string]$Entry, [string]$HealthUrl) {
  if (Test-Health $HealthUrl) { Write-Host "$Name already online"; return }
  $node = (Get-Command node -ErrorAction Stop).Source
  Start-Process -FilePath $node -ArgumentList $Entry -WorkingDirectory $projectRoot -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDirectory "$Name.stdout.log") `
    -RedirectStandardError (Join-Path $logDirectory "$Name.stderr.log")
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-Health $HealthUrl) { Write-Host "$Name started"; return }
  }
  throw "$Name did not become healthy; inspect $logDirectory"
}

Start-NodeService 'windows-worker' $workerEntry 'http://127.0.0.1:7576/health'

& wsl.exe -e sh -lc 'systemctl --user start queqiao-worker && systemctl --user is-active --quiet queqiao-worker'
if ($LASTEXITCODE -ne 0) { throw 'WSL Queqiao Worker failed to start' }
Write-Host 'wsl-worker online'

Start-NodeService 'gateway' $gatewayEntry 'http://127.0.0.1:7575/health'

& tailscale funnel --bg 7575
if ($LASTEXITCODE -ne 0) { throw 'Tailscale Funnel failed to start' }

& node (Join-Path $runtime 'queqiao.js') doctor
if ($LASTEXITCODE -ne 0) { throw 'Queqiao doctor failed' }
& tailscale funnel status

