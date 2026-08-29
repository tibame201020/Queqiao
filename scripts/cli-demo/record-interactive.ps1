param(
  [ValidateSet('all','gateway','worker','selector','extension','start','enroll')]
  [string]$Demo = 'all',
  [string]$PackageTarball = ''
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $repo

$generated = Join-Path $PSScriptRoot 'generated'
$stage = Join-Path $generated 'interactive-package-stage'
$outDir = Join-Path $repo 'docs\assets\cli\interactive'
New-Item -ItemType Directory -Force -Path $generated,$outDir | Out-Null

if (-not $PackageTarball) {
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
$python = (Resolve-Path (Join-Path $PSScriptRoot 'record_interactive.py')).Path
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Convert-ToWslPath([string]$Path) {
  return (wsl.exe wslpath -a ($Path -replace '\\','/')).Trim()
}

$wslPackage = Convert-ToWslPath $PackageTarball
$wslPython = Convert-ToWslPath $python
$wslOut = Convert-ToWslPath $outDir
$wslHome = (wsl.exe bash -lc 'printf %s ~').Trim()
$wslArch = (wsl.exe uname -m).Trim()
if ($wslArch -ne 'x86_64') { throw "Interactive CLI recording currently requires x86_64 WSL; found $wslArch" }
$toolDir = "$wslHome/.cache/queqiao-cli-demo-tools"
$agg = "$toolDir/agg-1.9.0"
$aggUrl = 'https://github.com/asciinema/agg/releases/download/v1.9.0/agg-x86_64-unknown-linux-gnu'
$aggSha256 = 'f111e315cd71056b116302342553dd765b7297579ed511f111d0cedb442aeda6'

wsl.exe bash -lc "set -e; mkdir -p '$toolDir'; if [ ! -x '$agg' ]; then curl -fsSL '$aggUrl' -o '$agg'; chmod +x '$agg'; fi; echo '$aggSha256  $agg' | sha256sum -c -"
if ($LASTEXITCODE -ne 0) { throw 'agg bootstrap or checksum verification failed' }

$work = "$wslHome/.cache/queqiao-cli-demo-work"
wsl.exe python3 $wslPython --package $wslPackage --out $wslOut --work $work --agg $agg --demo $Demo
if ($LASTEXITCODE -ne 0) { throw 'interactive CLI recording failed' }
