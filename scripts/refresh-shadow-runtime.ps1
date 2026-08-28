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

function Get-RoleStatus {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('gateway', 'worker')][string]$Role,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $cli = Join-Path $repoRoot 'dist\queqiao.js'
  $json = & node $cli $Role status --name $Name --json 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $json) {
    throw "Unable to read $Role '$Name' status through the Queqiao CLI."
  }
  return (($json -join "`n") | ConvertFrom-Json)
}

function Stop-NamedRole {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('gateway', 'worker')][string]$Role,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $status = Get-RoleStatus -Role $Role -Name $Name
  if ($status.active -ne $true) {
    Write-Host "Shadow $Role '$Name' is not running; continuing."
    return
  }
  if ($status.managed -ne $true) {
    throw "Shadow $role '$Name' is active but unmanaged. Stop that legacy runtime intentionally once, then rerun the refresh so Queqiao can own its lifecycle."
  }

  Write-Host "Stopping Shadow $Role '$Name' through Queqiao lifecycle..."
  $cli = Join-Path $repoRoot 'dist\queqiao.js'
  Invoke-Checked -File 'node.exe' -Arguments @($cli, $Role, 'stop', '--name', $Name)
}

function Start-NamedRole {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('gateway', 'worker')][string]$Role,
    [Parameter(Mandatory = $true)][string]$Name
  )

  Write-Host "Starting Shadow $Role '$Name' through Queqiao lifecycle..."
  $cli = Join-Path $repoRoot 'dist\queqiao.js'
  Invoke-Checked -File 'node.exe' -Arguments @($cli, $Role, 'serve', '--bg', '--name', $Name)
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

$workerConfig = Join-Path $queqiaoRoot "workers\$WorkerName\config\config.yaml"
$workerPort = Read-WorkerListenPort -ConfigFile $workerConfig

if ($PreflightOnly) {
  Write-Host 'Shadow refresh preflight: PASS'
  Write-Host "  Gateway role: $GatewayName"
  Write-Host "  Worker role:  $WorkerName"
  Write-Host "  Worker health port: $workerPort"
  exit 0
}

Push-Location $repoRoot
$backupRoot = Join-Path $env:TEMP ("queqiao-shadow-refresh-" + [guid]::NewGuid().ToString('N'))
$backupDist = Join-Path $backupRoot 'dist'
$repoDist = Join-Path $repoRoot 'dist'
$runtimeTouched = $false
$buildStarted = $false
$gatewayWasRunning = (Get-RoleStatus -Role 'gateway' -Name $GatewayName).active -eq $true
$workerWasRunning = (Get-RoleStatus -Role 'worker' -Name $WorkerName).active -eq $true
try {
  if (Test-Path -LiteralPath $repoDist -PathType Container) {
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Copy-Item -LiteralPath $repoDist -Destination $backupDist -Recurse -Force
  }

  try {
    $runtimeTouched = $true
    Stop-NamedRole -Role 'worker' -Name $WorkerName
    Stop-NamedRole -Role 'gateway' -Name $GatewayName
    Wait-RepoDistRelease

    Write-Host 'Building the current Queqiao package with Shadow stopped...'
    $buildStarted = $true
    Invoke-Checked -File 'npm.cmd' -Arguments @('run', 'build:package')

    Write-Host 'Relinking the global Queqiao command to this repository...'
    Invoke-Checked -File 'npm.cmd' -Arguments @('link')

    Start-NamedRole -Role 'gateway' -Name $GatewayName
    Start-NamedRole -Role 'worker' -Name $WorkerName
    Wait-GatewayHealth
    Wait-HttpHealth -Url "http://127.0.0.1:$workerPort/health" -Label "Shadow Worker '$WorkerName'"
  } catch {
    $failure = $_
    if ($runtimeTouched) {
      try { Stop-NamedRole -Role 'worker' -Name $WorkerName } catch {}
      try { Stop-NamedRole -Role 'gateway' -Name $GatewayName } catch {}
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
        try { Start-NamedRole -Role 'gateway' -Name $GatewayName } catch {}
      }
      if ($workerWasRunning) {
        try { Start-NamedRole -Role 'worker' -Name $WorkerName } catch {}
      }
    }
    throw $failure
  }

  Write-Host ''
  Write-Host 'Shadow refresh complete.'
  Write-Host "  Gateway: $GatewayName (healthy)"
  Write-Host "  Worker:  $WorkerName (healthy, managed lifecycle)"
  Write-Host '  Global queqiao command: linked to this repository'
} finally {
  if (Test-Path -LiteralPath $backupRoot) {
    Remove-Item -LiteralPath $backupRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
