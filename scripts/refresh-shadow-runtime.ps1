[CmdletBinding()]
param(
  [string]$GatewayName = 'shadow',
  [string]$WorkerName = 'windows',
  [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $env:LOCALAPPDATA) {
  throw 'LOCALAPPDATA is unavailable; cannot resolve Queqiao runtime state.'
}
$queqiaoRoot = Join-Path $env:LOCALAPPDATA 'Queqiao'

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$File $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Resolve-Launcher {
  param(
    [Parameter(Mandatory = $true)][string]$Directory,
    [Parameter(Mandatory = $true)][ValidateSet('gateway', 'worker')][string]$Role,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw "Queqiao $Role launcher directory does not exist: $Directory"
  }

  $candidates = @(
    Get-ChildItem -LiteralPath $Directory -Filter '*.ps1' -File | Where-Object {
      $content = Get-Content -LiteralPath $_.FullName -Raw
      if ($Role -eq 'gateway') {
        return $content -match ('gateway\s+serve\s+--name\s+' + [regex]::Escape($Name))
      }
      return $content -match 'queqiao-worker\.js'
    }
  )

  if ($candidates.Count -ne 1) {
    throw "Expected exactly one $Role launcher for '$Name' under $Directory, found $($candidates.Count)."
  }

  return $candidates[0].FullName
}

function Get-LauncherProcesses {
  param([Parameter(Mandatory = $true)][string]$Launcher)

  $needle = $Launcher.ToLowerInvariant()
  return @(
    Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'powershell.exe' -and
      $_.CommandLine -and
      $_.CommandLine.ToLowerInvariant().Contains($needle)
    }
  )
}

function Stop-LauncherTree {
  param(
    [Parameter(Mandatory = $true)][string]$Launcher,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $processes = @(Get-LauncherProcesses -Launcher $Launcher)
  if ($processes.Count -gt 1) {
    throw "Refusing to stop ${Label}: multiple launcher processes were found."
  }
  if ($processes.Count -eq 0) {
    Write-Host "$Label launcher is not running; continuing."
    return
  }

  $pidValue = [int]$processes[0].ProcessId
  Write-Host "Stopping $Label (PID $pidValue)..."
  & "$env:SystemRoot\System32\taskkill.exe" /PID $pidValue /T /F | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to stop $Label process tree (PID $pidValue)."
  }
}

function Start-Launcher {
  param(
    [Parameter(Mandatory = $true)][string]$Launcher,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if (@(Get-LauncherProcesses -Launcher $Launcher).Count -gt 0) {
    Write-Host "$Label launcher is already running."
    return
  }

  Write-Host "Starting $Label..."
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', $Launcher
  ) -WindowStyle Hidden | Out-Null
}

function Get-RepoDistProcesses {
  $distPrefix = ((Join-Path $repoRoot 'dist') -replace '/', '\').TrimEnd('\').ToLowerInvariant() + '\'

  return @(
    Get-CimInstance Win32_Process | Where-Object {
      if ($_.Name -ne 'node.exe' -or -not $_.CommandLine) {
        return $false
      }
      $commandLine = ($_.CommandLine -replace '/', '\').ToLowerInvariant()
      return $commandLine.Contains($distPrefix)
    }
  )
}

function Wait-RepoDistRelease {
  param([int]$TimeoutSeconds = 3)

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    $busy = @(Get-RepoDistProcesses)
    if ($busy.Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  $details = $busy | ForEach-Object {
    "  PID $($_.ProcessId): $($_.CommandLine)"
  }
  $message = @(
    "Cannot refresh Shadow because another Queqiao runtime is using this repository's dist bundle:"
    $details
    "Stop the listed Gateway/Worker intentionally, then rerun npm run dev:shadow:refresh."
    "No unrelated runtime was stopped automatically."
  ) -join [Environment]::NewLine
  throw $message
}

function Resolve-WorkerConfigFromLauncher {
  param([Parameter(Mandatory = $true)][string]$Launcher)

  $content = Get-Content -LiteralPath $Launcher -Raw
  $match = [regex]::Match(
    $content,
    '(?m)^\s*\$env:QUEQIAO_CONFIG_FILE\s*=\s*[''"](?<path>[^''"]+)[''"]'
  )
  if ($match.Success) {
    return $match.Groups['path'].Value
  }

  return Join-Path $queqiaoRoot "workers\$WorkerName\config\config.yaml"
}

function Read-WorkerListenPort {
  param([Parameter(Mandatory = $true)][string]$ConfigFile)

  if (-not (Test-Path -LiteralPath $ConfigFile -PathType Leaf)) {
    throw "Worker config does not exist: $ConfigFile"
  }

  $inWorker = $false
  $inListen = $false
  foreach ($line in Get-Content -LiteralPath $ConfigFile) {
    if ($line -match '^worker:\s*$') {
      $inWorker = $true
      $inListen = $false
      continue
    }
    if ($inWorker -and $line -match '^\S') {
      break
    }
    if ($inWorker -and $line -match '^\s{2}listen:\s*$') {
      $inListen = $true
      continue
    }
    if ($inListen -and $line -match '^\s{4}port:\s*(\d+)\s*$') {
      return [int]$Matches[1]
    }
  }

  throw "Unable to resolve Worker listen port from $ConfigFile"
}

function Wait-HttpHealth {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Label,
    [int]$TimeoutSeconds = 20
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        return
      }
    } catch {
      # Runtime may still be starting.
    }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "$Label did not become healthy at $Url within $TimeoutSeconds seconds."
}

function Wait-GatewayHealth {
  param([int]$TimeoutSeconds = 20)

  $cli = Join-Path $repoRoot 'dist\queqiao.js'
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $json = & node $cli gateway status --name $GatewayName --json 2>$null
      if ($LASTEXITCODE -eq 0 -and $json) {
        $status = ($json -join "`n") | ConvertFrom-Json
        if ($status.active -eq $true) {
          return
        }
      }
    } catch {
      # Runtime may still be starting.
    }
    Start-Sleep -Milliseconds 300
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Gateway '$GatewayName' did not become healthy within $TimeoutSeconds seconds."
}

$gatewayScripts = Join-Path $queqiaoRoot "gateways\$GatewayName\scripts"
$workerScripts = Join-Path $queqiaoRoot "workers\$WorkerName\scripts"
$gatewayLauncher = Resolve-Launcher -Directory $gatewayScripts -Role gateway -Name $GatewayName
$workerLauncher = Resolve-Launcher -Directory $workerScripts -Role worker -Name $WorkerName
$workerConfig = Resolve-WorkerConfigFromLauncher -Launcher $workerLauncher
$workerPort = Read-WorkerListenPort -ConfigFile $workerConfig

if ($PreflightOnly) {
  Write-Host 'Shadow refresh preflight: PASS'
  Write-Host "  Gateway launcher: $GatewayName"
  Write-Host "  Worker launcher:  $WorkerName"
  Write-Host "  Worker health port: $workerPort"
  exit 0
}

Push-Location $repoRoot
$backupRoot = Join-Path $env:TEMP ("queqiao-shadow-refresh-" + [guid]::NewGuid().ToString('N'))
$backupDist = Join-Path $backupRoot 'dist'
$repoDist = Join-Path $repoRoot 'dist'
$runtimeTouched = $false
$buildStarted = $false
$gatewayWasRunning = @(Get-LauncherProcesses -Launcher $gatewayLauncher).Count -eq 1
$workerWasRunning = @(Get-LauncherProcesses -Launcher $workerLauncher).Count -eq 1
try {
  if (Test-Path -LiteralPath $repoDist -PathType Container) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Copy-Item -LiteralPath $repoDist -Destination $backupDist -Recurse -Force
  }

  try {
    $runtimeTouched = $true
    Stop-LauncherTree -Launcher $workerLauncher -Label "Shadow Worker '$WorkerName'"
    Stop-LauncherTree -Launcher $gatewayLauncher -Label "Shadow Gateway '$GatewayName'"
    Wait-RepoDistRelease

    Write-Host 'Building the current Queqiao package with Shadow stopped...'
    $buildStarted = $true
    Invoke-Checked -File 'npm.cmd' -Arguments @('run', 'build:package')

    Write-Host 'Relinking the global Queqiao command to this repository...'
    Invoke-Checked -File 'npm.cmd' -Arguments @('link')

    Start-Launcher -Launcher $gatewayLauncher -Label "Shadow Gateway '$GatewayName'"
    Start-Launcher -Launcher $workerLauncher -Label "Shadow Worker '$WorkerName'"
    Wait-GatewayHealth
    Wait-HttpHealth -Url "http://127.0.0.1:$workerPort/health" -Label "Shadow Worker '$WorkerName'"
  } catch {
    $failure = $_
    if ($runtimeTouched) {
      try { Stop-LauncherTree -Launcher $workerLauncher -Label "Shadow Worker '$WorkerName'" } catch {}
      try { Stop-LauncherTree -Launcher $gatewayLauncher -Label "Shadow Gateway '$GatewayName'" } catch {}
    }

    if ($buildStarted -and (Test-Path -LiteralPath $backupDist -PathType Container)) {
      Write-Warning 'Shadow refresh failed; restoring the previous dist bundle.'
      if (Test-Path -LiteralPath $repoDist) {
        Remove-Item -LiteralPath $repoDist -Recurse -Force
      }
      Copy-Item -LiteralPath $backupDist -Destination $repoDist -Recurse -Force
    }

    if ($runtimeTouched) {
      if ($gatewayWasRunning) {
        try { Start-Launcher -Launcher $gatewayLauncher -Label "Shadow Gateway '$GatewayName'" } catch {}
      }
      if ($workerWasRunning) {
        try { Start-Launcher -Launcher $workerLauncher -Label "Shadow Worker '$WorkerName'" } catch {}
      }
    }
    throw $failure
  }

  Write-Host ''
  Write-Host 'Shadow refresh complete.'
  Write-Host "  Gateway: $GatewayName (healthy)"
  Write-Host "  Worker:  $WorkerName (healthy on current launcher config)"
  Write-Host '  Global queqiao command: linked to this repository'
} finally {
  if (Test-Path -LiteralPath $backupRoot) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
