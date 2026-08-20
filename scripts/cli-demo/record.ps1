param(
  [ValidateSet('01','02','03','04')]
  [string]$Demo = '01',
  [string]$PackageVersion = '0.7.0'
)

$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repo

$root = 'C:\Users\Public\QueqiaoDemo'
$workspaceRoot = Join-Path $root 'workspace'
$generated = Join-Path $PSScriptRoot 'generated'
$gatewayPort = 18775
$managementPort = 18774
$workerPort = 18776
New-Item -ItemType Directory -Force -Path $generated | Out-Null

function Sanitize-Output {
  param([string]$Text)
  $sanitized = $Text.TrimEnd()
  $sanitized = [regex]::Replace($sanitized, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b', '<worker-id>')
  $sanitized = [regex]::Replace($sanitized, '(?i)("?pid"?\s*:\s*)\d+', '$1"<pid>"')
  $sanitized = [regex]::Replace($sanitized, '(?i)("?(?:token|credential|joinCode)"?\s*:\s*")[^"]+("?)', '$1<redacted>$2')
  $sanitized = [regex]::Replace($sanitized, '(?i)(token|secret)\s*[:=]\s*[^\s,}\"]+', '$1=<redacted>')
  return $sanitized
}

function Invoke-RawNative {
  param(
    [Parameter(Mandatory = $true)][string]$FailureLabel,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  $started = Get-Date
  $raw = & $Action 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $elapsed = [math]::Round(((Get-Date) - $started).TotalMilliseconds)
  if ($exitCode -ne 0) { throw "Command failed ($exitCode): $FailureLabel`n$raw" }
  return [pscustomobject]@{ raw = $raw.TrimEnd(); durationMs = $elapsed }
}

function New-Step {
  param(
    [Parameter(Mandatory = $true)][string]$DisplayCommand,
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [double]$TypingSeconds = 1.15,
    [double]$HoldSeconds = 1.0
  )
  $result = Invoke-RawNative -FailureLabel $DisplayCommand -Action $Action
  return [ordered]@{
    command = $DisplayCommand
    output = Sanitize-Output $result.raw
    durationMs = $result.durationMs
    typingSeconds = $TypingSeconds
    holdSeconds = $HoldSeconds
  }
}

function New-ProjectedJsonStep {
  param(
    [Parameter(Mandatory = $true)][string]$DisplayCommand,
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][scriptblock]$Project,
    [double]$TypingSeconds = 1.15,
    [double]$HoldSeconds = 1.0
  )
  $result = Invoke-RawNative -FailureLabel $DisplayCommand -Action $Action
  $parsed = $result.raw | ConvertFrom-Json
  $projected = & $Project $parsed
  return [ordered]@{
    command = $DisplayCommand
    output = Sanitize-Output ($projected | ConvertTo-Json -Depth 6 -Compress)
    durationMs = $result.durationMs
    typingSeconds = $TypingSeconds
    holdSeconds = $HoldSeconds
  }
}

function Install-Package {
  $null = Invoke-RawNative -FailureLabel 'npm install' -Action { npm install -g "@tibame201020/queqiao@$PackageVersion" --no-audit --no-fund }
}

function Setup-Worker {
  $null = Invoke-RawNative -FailureLabel 'worker setup' -Action { queqiao worker setup --name demo-worker --port $workerPort }
}

function Setup-Gateway {
  $null = Invoke-RawNative -FailureLabel 'gateway setup' -Action { queqiao gateway setup --name demo-gateway --public-base-url "http://127.0.0.1:$gatewayPort/" --port $gatewayPort --management-port $managementPort }
}

function Add-DemoWorkspace {
  New-Item -ItemType Directory -Force -Path $workspaceRoot | Out-Null
  Set-Content -Path (Join-Path $workspaceRoot 'hello.txt') -Value 'hello from Queqiao demo' -Encoding utf8
  return Invoke-RawNative -FailureLabel 'workspace add' -Action {
    queqiao workspace add --worker demo-worker --root $workspaceRoot --id demo-workspace --name 'Demo Workspace' --profile read-only
  }
}

function Start-DemoRuntime {
  $null = Invoke-RawNative -FailureLabel 'worker serve' -Action { queqiao worker serve --name demo-worker --bg }
  $null = Invoke-RawNative -FailureLabel 'gateway serve' -Action { queqiao gateway serve --name demo-gateway --bg }
  Start-Sleep -Milliseconds 500
}

function Join-DemoWorker {
  $join = Invoke-RawNative -FailureLabel 'join token' -Action { queqiao gateway join-token --name demo-gateway --expires 120 }
  $joinObject = $join.raw | ConvertFrom-Json
  if (-not $joinObject.token) { throw 'Join-token response did not contain a token' }
  $token = [string]$joinObject.token
  $null = Invoke-RawNative -FailureLabel 'worker join' -Action {
    queqiao worker join --name demo-worker --gateway "http://127.0.0.1:$gatewayPort/" --token $token --endpoint "http://127.0.0.1:$workerPort/"
  }
  return [pscustomobject]@{ joinRaw = $join.raw; token = $token }
}

function Save-Demo {
  param(
    [string]$Title,
    [string]$Stem,
    [array]$Steps
  )
  $transcript = [ordered]@{
    schemaVersion = 1
    title = $Title
    package = "@tibame201020/queqiao@$PackageVersion"
    runtimeRoot = 'C:\Users\Public\QueqiaoDemo'
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    steps = $Steps
  }
  $transcriptFile = Join-Path $generated "$Stem.transcript.json"
  $transcript | ConvertTo-Json -Depth 8 | Set-Content -Path $transcriptFile -Encoding utf8
  $gif = "docs/assets/cli/$Stem.gif"
  python scripts/cli-demo/render_terminal.py $transcriptFile $gif
  if ($LASTEXITCODE -ne 0) { throw 'Terminal renderer failed' }
  $item = Get-Item $gif
  [pscustomobject]@{
    demo = $Demo
    package = "@tibame201020/queqiao@$PackageVersion"
    transcript = $transcriptFile
    gif = $item.FullName
    bytes = $item.Length
  } | ConvertTo-Json -Compress
}

if (Test-Path $root) { Remove-Item $root -Recurse -Force }
New-Item -ItemType Directory -Force -Path $root | Out-Null

$oldEnv = @{
  LOCALAPPDATA = $env:LOCALAPPDATA
  TEMP = $env:TEMP
  TMP = $env:TMP
  npm_config_prefix = $env:npm_config_prefix
  npm_config_audit = $env:npm_config_audit
  npm_config_fund = $env:npm_config_fund
  npm_config_update_notifier = $env:npm_config_update_notifier
  PATH = $env:PATH
}

$runtimeStarted = $false
try {
  $env:LOCALAPPDATA = "$root\local"
  $env:TEMP = "$root\temp"
  $env:TMP = $env:TEMP
  $env:npm_config_prefix = "$root\npm-prefix"
  $env:npm_config_audit = 'false'
  $env:npm_config_fund = 'false'
  $env:npm_config_update_notifier = 'false'
  $env:PATH = "$env:npm_config_prefix;$($oldEnv.PATH)"
  New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA,$env:TEMP,$env:npm_config_prefix | Out-Null

  Install-Package

  if ($Demo -eq '01') {
    $steps = @()
    $steps += New-Step -DisplayCommand 'queqiao gateway setup --name demo-gateway --public-base-url https://example.invalid/queqiao/' -Action {
      queqiao gateway setup --name demo-gateway --public-base-url 'https://example.invalid/queqiao/'
    } -TypingSeconds 1.35 -HoldSeconds 1.25
    $steps += New-Step -DisplayCommand 'queqiao worker setup --name demo-worker --port 7576' -Action {
      queqiao worker setup --name demo-worker --port 7576
    } -TypingSeconds 1.15 -HoldSeconds 1.75
    Save-Demo -Title 'Queqiao CLI · Bootstrap Gateway & Worker' -Stem '01-bootstrap-roles' -Steps $steps
  }

  if ($Demo -eq '02') {
    Setup-Worker
    New-Item -ItemType Directory -Force -Path $workspaceRoot | Out-Null
    Set-Content -Path (Join-Path $workspaceRoot 'hello.txt') -Value 'hello from Queqiao demo' -Encoding utf8
    $steps = @()
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao workspace add --worker demo-worker --root C:\Users\Public\QueqiaoDemo\workspace --id demo-workspace --profile read-only' -Action {
      queqiao workspace add --worker demo-worker --root $workspaceRoot --id demo-workspace --name 'Demo Workspace' --profile read-only
    } -Project {
      param($o)
      [ordered]@{ added = $o.added; workspace = [ordered]@{ id = $o.workspace.id; root = $o.workspace.root; profile = $o.workspace.profile } }
    } -TypingSeconds 1.55 -HoldSeconds 1.3
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao workspace list --worker demo-worker' -Action {
      queqiao workspace list --worker demo-worker
    } -Project {
      param($o)
      [ordered]@{ workspaces = @($o.workspaces | ForEach-Object { [ordered]@{ id = $_.id; root = $_.root; profile = $_.profile } }) }
    } -TypingSeconds 0.95 -HoldSeconds 2.0
    Save-Demo -Title 'Queqiao CLI · Grant Workspace Authority' -Stem '02-workspace-authority' -Steps $steps
  }

  if ($Demo -eq '03') {
    Setup-Gateway
    Setup-Worker
    $null = Add-DemoWorkspace
    $steps = @()
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker serve --name demo-worker --bg' -Action {
      queqiao worker serve --name demo-worker --bg
    } -Project {
      param($o)
      [ordered]@{ started = $o.started; role = $o.role; name = $o.name; pid = '<pid>' }
    } -TypingSeconds 0.95 -HoldSeconds 0.75
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao gateway serve --name demo-gateway --bg' -Action {
      queqiao gateway serve --name demo-gateway --bg
    } -Project {
      param($o)
      [ordered]@{ started = $o.started; role = $o.role; name = $o.name; pid = '<pid>' }
    } -TypingSeconds 0.95 -HoldSeconds 0.75
    $runtimeStarted = $true
    Start-Sleep -Milliseconds 500

    $join = Invoke-RawNative -FailureLabel 'join token' -Action { queqiao gateway join-token --name demo-gateway --expires 120 }
    $joinObject = $join.raw | ConvertFrom-Json
    $token = [string]$joinObject.token
    if (-not $token) { throw 'Join-token response did not contain a token' }
    $joinProjection = [ordered]@{ token = '<redacted>'; expiresAt = $joinObject.expiresAt }
    $steps += [ordered]@{
      command = 'queqiao gateway join-token --name demo-gateway --expires 120'
      output = ($joinProjection | ConvertTo-Json -Compress)
      durationMs = $join.durationMs
      typingSeconds = 1.05
      holdSeconds = 0.8
    }
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker join --name demo-worker --gateway http://127.0.0.1:18775/ --token <redacted>' -Action {
      queqiao worker join --name demo-worker --gateway "http://127.0.0.1:$gatewayPort/" --token $token --endpoint "http://127.0.0.1:$workerPort/"
    } -Project {
      param($o)
      [ordered]@{ joined = $o.joined; workerId = '<worker-id>'; environmentId = $o.environmentId }
    } -TypingSeconds 1.3 -HoldSeconds 1.0
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker list --name demo-gateway' -Action {
      queqiao worker list --name demo-gateway
    } -Project {
      param($o)
      $w = $o.workers[0]
      [ordered]@{ workers = @([ordered]@{ workerId = '<worker-id>'; environmentId = $w.environmentId; endpoint = $w.transport.endpoint }) }
    } -TypingSeconds 0.85 -HoldSeconds 1.5
    Save-Demo -Title 'Queqiao CLI · Start & Enroll' -Stem '03-start-enroll' -Steps $steps
  }

  if ($Demo -eq '04') {
    Setup-Gateway
    Setup-Worker
    $null = Add-DemoWorkspace
    Start-DemoRuntime
    $runtimeStarted = $true
    $null = Join-DemoWorker
    Start-Sleep -Milliseconds 500

    $steps = @()
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao gateway status --name demo-gateway' -Action {
      queqiao gateway status --name demo-gateway
    } -Project {
      param($o)
      [ordered]@{ name = $o.name; active = $o.active; reachable = $o.health.reachable; healthy = $o.health.healthy }
    } -TypingSeconds 0.9 -HoldSeconds 0.75
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker status --name demo-worker' -Action {
      queqiao worker status --name demo-worker
    } -Project {
      param($o)
      [ordered]@{ name = $o.name; active = $o.active; reachable = $o.health.reachable; healthy = $o.health.healthy }
    } -TypingSeconds 0.9 -HoldSeconds 0.75
    $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker list --name demo-gateway' -Action {
      queqiao worker list --name demo-gateway
    } -Project {
      param($o)
      $w = $o.workers[0]
      [ordered]@{ workers = @([ordered]@{ workerId = '<worker-id>'; environmentId = $w.environmentId; endpoint = $w.transport.endpoint }) }
    } -TypingSeconds 0.9 -HoldSeconds 1.7
    Save-Demo -Title 'Queqiao CLI · Verify Deployment' -Stem '04-verify-deployment' -Steps $steps
  }
}
finally {
  if ($runtimeStarted) {
    try { queqiao worker stop --name demo-worker 2>$null | Out-Null } catch {}
    try { queqiao gateway stop --name demo-gateway 2>$null | Out-Null } catch {}
    Start-Sleep -Milliseconds 250
  }
  foreach ($entry in $oldEnv.GetEnumerator()) {
    Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value -ErrorAction SilentlyContinue
    if ($null -eq $entry.Value) { Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
  }
  if (Test-Path $root) { Remove-Item $root -Recurse -Force }
}
