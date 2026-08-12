param(
  [Parameter(Mandatory = $true)]
  [string] $PublicBaseUrl,

  [Parameter(Mandatory = $true)]
  [string] $WorkspaceRoot,

  [string] $EnvironmentId = "windows",
  [string] $WorkspaceId = "interview"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot ".env"

if (Test-Path -LiteralPath $environmentFile) {
  throw ".env already exists; refusing to overwrite secrets"
}

$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
function New-RandomBase64([int] $byteCount) {
  $bytes = New-Object byte[] $byteCount
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes)
}

$approvalSecret = New-RandomBase64 24
$jwtSecret = New-RandomBase64 48
$workerToken = New-RandomBase64 32

$lines = @(
  "PUBLIC_BASE_URL=$($PublicBaseUrl.TrimEnd('/'))"
  "PORT=7575"
  "TRUST_PROXY_HOPS=1"
  "OAUTH_APPROVAL_SECRET=$approvalSecret"
  "JWT_SIGNING_SECRET=$jwtSecret"
  "QUEQIAO_STATE_DIR=$projectRoot\.queqiao\gateway"
  "QUEQIAO_WORKER_URL=http://127.0.0.1:7576"
  "QUEQIAO_WORKER_PORT=7576"
  "QUEQIAO_WORKER_TOKEN=$workerToken"
  "QUEQIAO_ENVIRONMENT_ID=$EnvironmentId"
  "QUEQIAO_WORKSPACE_ID=$WorkspaceId"
  "QUEQIAO_WORKSPACE_ROOT=$resolvedWorkspace"
)

[IO.File]::WriteAllLines($environmentFile, $lines, [Text.UTF8Encoding]::new($false))
Write-Output "Created $environmentFile"
Write-Output "OAUTH_APPROVAL_SECRET=$approvalSecret"
