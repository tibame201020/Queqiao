param(
  [ValidateSet('all','01','02','03','04')]
  [string]$Demo = 'all',
  [string]$PackageTarball = ''
)

$ErrorActionPreference = 'Stop'

$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repo

$generated = Join-Path $PSScriptRoot 'generated'
$outDir = Join-Path $repo 'docs\assets\cli\flows'
New-Item -ItemType Directory -Force -Path $generated,$outDir | Out-Null

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  try { return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port }
  finally { $listener.Stop() }
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

function Sanitize-Output {
  param([string]$Text, [string]$Root)
  $sanitized = $Text.TrimEnd()
  if ($Root) {
    $sanitized = $sanitized.Replace($Root, 'C:\QueqiaoDemo')
    $sanitized = $sanitized.Replace($Root.Replace('\','/'), 'C:/QueqiaoDemo')
  }
  $sanitized = [regex]::Replace($sanitized, '(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b', '<worker-id>')
  $sanitized = [regex]::Replace($sanitized, '(?i)("?pid"?\s*:\s*)\d+', '$1"<pid>"')
  $sanitized = [regex]::Replace($sanitized, '(?i)("?(?:token|credential|joinCode)"?\s*:\s*")[^"]+("?)', '$1<redacted>$2')
  $sanitized = [regex]::Replace($sanitized, '(?i)(join code|token|secret)\s*[:=]\s*[^\s,}\"]+', '$1=<redacted>')
  return $sanitized
}

function New-Step {
  param(
    [Parameter(Mandatory = $true)][string]$DisplayCommand,
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$Root,
    [double]$TypingSeconds = 1.05,
    [double]$HoldSeconds = 0.9
  )
  $result = Invoke-RawNative -FailureLabel $DisplayCommand -Action $Action
  return [ordered]@{
    command = $DisplayCommand
    output = Sanitize-Output -Text $result.raw -Root $Root
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
    [Parameter(Mandatory = $true)][string]$Root,
    [double]$TypingSeconds = 1.05,
    [double]$HoldSeconds = 0.9
  )
  $result = Invoke-RawNative -FailureLabel $DisplayCommand -Action $Action
  $parsed = $result.raw | ConvertFrom-Json
  $projected = & $Project $parsed
  return [ordered]@{
    command = $DisplayCommand
    output = Sanitize-Output -Text ($projected | ConvertTo-Json -Depth 8) -Root $Root
    durationMs = $result.durationMs
    typingSeconds = $TypingSeconds
    holdSeconds = $HoldSeconds
  }
}

function Save-Demo {
  param([string]$Title, [string]$Stem, [array]$Steps, [string]$PackageVersion, [string]$Root)
  $transcript = [ordered]@{
    schemaVersion = 2
    title = $Title
    package = "@tibame201020/queqiao@$PackageVersion"
    runtimeRoot = 'C:\QueqiaoDemo'
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    evidence = 'real-packed-cli'
    steps = $Steps
  }
  $transcriptFile = Join-Path $generated "$Stem.transcript.json"
  $transcript | ConvertTo-Json -Depth 10 | Set-Content -Path $transcriptFile -Encoding utf8
  $gif = Join-Path $outDir "$Stem.gif"
  python scripts/cli-demo/render_terminal.py $transcriptFile $gif
  if ($LASTEXITCODE -ne 0) { throw 'Terminal renderer failed' }
  $item = Get-Item $gif
  return [pscustomobject]@{ demo = $Stem; transcript = $transcriptFile; gif = $item.FullName; bytes = $item.Length }
}

$packageVersion = node -p "require('./package.json').version"
if (-not $PackageTarball) {
  $stage = Join-Path $generated 'package-stage'
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $stage | Out-Null
  $stageDist = Join-Path $stage 'dist'
  $previousOutdir = $env:QUEQIAO_BUILD_OUTDIR
  try {
    $env:QUEQIAO_BUILD_OUTDIR = $stageDist
    node scripts/build-package.mjs
    if ($LASTEXITCODE -ne 0) { throw 'staged package build failed' }
  }
  finally {
    if ($null -eq $previousOutdir) { Remove-Item Env:QUEQIAO_BUILD_OUTDIR -ErrorAction SilentlyContinue }
    else { $env:QUEQIAO_BUILD_OUTDIR = $previousOutdir }
  }
  foreach ($file in @('package.json','README.md','CHANGELOG.md','LICENSE','config.example.yaml','extension.d.ts')) {
    Copy-Item (Join-Path $repo $file) (Join-Path $stage $file)
  }
  Push-Location $stage
  try {
    $packJson = npm pack --ignore-scripts --json | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'staged npm pack failed' }
    $pack = $packJson | ConvertFrom-Json
    $PackageTarball = Join-Path $stage $pack[0].filename
  }
  finally { Pop-Location }
}
$PackageTarball = (Resolve-Path $PackageTarball).Path

$selected = if ($Demo -eq 'all') { @('01','02','03','04') } else { @($Demo) }
$results = @()
$original = @{
  LOCALAPPDATA = $env:LOCALAPPDATA
  TEMP = $env:TEMP
  TMP = $env:TMP
  USERPROFILE = $env:USERPROFILE
  HOME = $env:HOME
  npm_config_prefix = $env:npm_config_prefix
  npm_config_audit = $env:npm_config_audit
  npm_config_fund = $env:npm_config_fund
  npm_config_update_notifier = $env:npm_config_update_notifier
  PATH = $env:PATH
}

try {
  foreach ($id in $selected) {
    $root = Join-Path ([System.IO.Path]::GetTempPath()) "queqiao-cli-demo-$id"
    if (Test-Path $root) { Remove-Item $root -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $root | Out-Null

    $env:LOCALAPPDATA = Join-Path $root 'local-app-data'
    $env:TEMP = Join-Path $root 'temp'
    $env:TMP = $env:TEMP
    $env:USERPROFILE = Join-Path $root 'home'
    $env:HOME = $env:USERPROFILE
    $env:npm_config_prefix = Join-Path $root 'npm-prefix'
    $env:npm_config_audit = 'false'
    $env:npm_config_fund = 'false'
    $env:npm_config_update_notifier = 'false'
    $env:PATH = "$env:npm_config_prefix;$($original.PATH)"
    New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA,$env:TEMP,$env:USERPROFILE,$env:npm_config_prefix | Out-Null

    $gatewayPort = Get-FreePort
    $managementPort = Get-FreePort
    $workerPort = Get-FreePort

    $tsx = Join-Path $repo 'node_modules\.bin\tsx.cmd'
    $fixtureJson = & $tsx scripts/cli-demo/prepare_fixture.ts $root $gatewayPort $managementPort $workerPort
    if ($LASTEXITCODE -ne 0) { throw 'CLI demo fixture preparation failed' }
    $fixture = $fixtureJson | ConvertFrom-Json

    $null = Invoke-RawNative -FailureLabel 'install packed Queqiao' -Action {
      npm install -g $PackageTarball --no-audit --no-fund
    }

    $workspaceJson = Invoke-RawNative -FailureLabel 'workspace list json' -Action {
      queqiao worker workspace list --worker demo-worker --json
    }
    $workspaceId = (($workspaceJson.raw | ConvertFrom-Json).workspaces | Select-Object -First 1).id
    if (-not $workspaceId) { throw 'Fixture did not create a Workspace' }

    if ($id -eq '01') {
      $steps = @()
      $steps += New-Step -DisplayCommand 'queqiao gateway list' -Root $root -Action { queqiao gateway list }
      $steps += New-Step -DisplayCommand 'queqiao worker list' -Root $root -Action { queqiao worker list }
      $steps += New-Step -DisplayCommand 'queqiao worker workspace list --worker demo-worker' -Root $root -Action { queqiao worker workspace list --worker demo-worker } -HoldSeconds 1.5
      $results += Save-Demo -Title 'Queqiao CLI - Roles & Workspaces' -Stem '01-roles-workspaces' -Steps $steps -PackageVersion $packageVersion -Root $root
    }

    if ($id -eq '02') {
      $secondRoot = Join-Path $root 'workspace-two'
      New-Item -ItemType Directory -Force -Path $secondRoot | Out-Null
      $steps = @()
      $steps += New-Step -DisplayCommand 'queqiao worker workspace add --worker demo-worker --root C:\QueqiaoDemo\workspace-two --display-name "Demo App" --profile coding' -Root $root -Action {
        queqiao worker workspace add --worker demo-worker --root $secondRoot --display-name 'Demo App' --access-profile Editor
      } -TypingSeconds 1.6 -HoldSeconds 1.1
      $second = Invoke-RawNative -FailureLabel 'workspace list after add' -Action { queqiao worker workspace list --worker demo-worker --json }
      $secondId = (($second.raw | ConvertFrom-Json).workspaces | Where-Object { $_.displayName -eq 'Demo App' } | Select-Object -First 1).id
      $steps += New-Step -DisplayCommand "queqiao worker workspace info --worker demo-worker --workspace $secondId" -Root $root -Action {
        queqiao worker workspace info --worker demo-worker --workspace $secondId
      } -HoldSeconds 1.7
      $results += Save-Demo -Title 'Queqiao CLI - Workspace Authority' -Stem '02-workspace-authority' -Steps $steps -PackageVersion $packageVersion -Root $root
    }

    if ($id -eq '03') {
      $extensionRoot = [string]$fixture.extensionRoot
      $steps = @()
      $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao extension install C:\QueqiaoDemo\mock-extension --json' -Root $root -Action {
        queqiao extension install $extensionRoot --json
      } -Project {
        param($o)
        [ordered]@{ changed = $o.changed; id = $o.id; version = $o.version; source = $o.source; connectorManifestImpact = $o.connectorManifestImpact }
      } -TypingSeconds 1.35 -HoldSeconds 0.9
      $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao extension attach dev.queqiao.demo --worker demo-worker --json' -Root $root -Action {
        queqiao extension attach dev.queqiao.demo --worker demo-worker --json
      } -Project {
        param($o)
        [ordered]@{ changed = $o.changed; attached = $o.attached; worker = $o.worker }
      }
      $steps += New-Step -DisplayCommand 'queqiao extension list' -Root $root -Action { queqiao extension list }
      $steps += New-Step -DisplayCommand 'queqiao doctor extension' -Root $root -Action { queqiao doctor extension } -HoldSeconds 1.5
      $results += Save-Demo -Title 'Queqiao CLI - Extension Hub' -Stem '03-extension-hub' -Steps $steps -PackageVersion $packageVersion -Root $root
    }

    if ($id -eq '04') {
      $runtimeStarted = $false
      try {
        $steps = @()
        $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker serve --bg --worker demo-worker --json' -Root $root -Action {
          queqiao worker serve --bg --worker demo-worker --json
        } -Project { param($o) [ordered]@{ started = $o.started; role = $o.role; name = $o.name; pid = '<pid>' } }
        $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao gateway serve --bg --gateway demo-gateway --json' -Root $root -Action {
          queqiao gateway serve --bg --gateway demo-gateway --json
        } -Project { param($o) [ordered]@{ started = $o.started; role = $o.role; name = $o.name; pid = '<pid>' } }
        $runtimeStarted = $true
        Start-Sleep -Milliseconds 500

        $join = Invoke-RawNative -FailureLabel 'gateway join-token' -Action { queqiao gateway join-token --gateway demo-gateway --expires 120 --json }
        $joinObject = $join.raw | ConvertFrom-Json
        $joinCode = [string]$joinObject.joinCode
        if (-not $joinCode) { throw 'Join-token did not return a join code' }
        $steps += [ordered]@{
          command = 'queqiao gateway join-token --gateway demo-gateway --expires 120 --json'
          output = "{`n  `"joinCode`": `"<redacted>`",`n  `"joinCodeVersion`": 1`n}"
          durationMs = $join.durationMs
          typingSeconds = 1.25
          holdSeconds = 0.8
        }
        $steps += New-ProjectedJsonStep -DisplayCommand 'queqiao worker join --worker demo-worker --join-code <redacted> --json' -Root $root -Action {
          queqiao worker join --worker demo-worker --join-code $joinCode --json
        } -Project { param($o) [ordered]@{ joined = $o.joined; workerId = '<worker-id>'; environmentId = $o.environmentId } } -TypingSeconds 1.35
        $steps += New-Step -DisplayCommand 'queqiao gateway workers list --gateway demo-gateway' -Root $root -Action {
          queqiao gateway workers list --gateway demo-gateway
        }
        $steps += New-Step -DisplayCommand 'queqiao gateway status --gateway demo-gateway' -Root $root -Action {
          queqiao gateway status --gateway demo-gateway
        }
        $steps += New-Step -DisplayCommand 'queqiao worker status --worker demo-worker' -Root $root -Action {
          queqiao worker status --worker demo-worker
        } -HoldSeconds 1.5
        $results += Save-Demo -Title 'Queqiao CLI - Start, Enroll & Verify' -Stem '04-start-enroll-verify' -Steps $steps -PackageVersion $packageVersion -Root $root
      }
      finally {
        if ($runtimeStarted) {
          try { queqiao gateway stop --gateway demo-gateway --json 2>$null | Out-Null } catch {}
          try { queqiao worker stop --worker demo-worker --json 2>$null | Out-Null } catch {}
        }
      }
    }

    Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
  }
}
finally {
  foreach ($entry in $original.GetEnumerator()) {
    if ($null -eq $entry.Value) { Remove-Item -Path "Env:$($entry.Key)" -ErrorAction SilentlyContinue }
    else { Set-Item -Path "Env:$($entry.Key)" -Value $entry.Value }
  }
}

$results | ConvertTo-Json -Depth 5
