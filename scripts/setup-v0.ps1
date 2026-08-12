param(
  [Parameter(Mandatory = $true)][string] $PublicBaseUrl,
  [Parameter(Mandatory = $true)][string] $WorkspaceRoot,
  [string] $EnvironmentId = "windows",
  [string] $WorkspaceId = "default"
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Join-Path $env:LOCALAPPDATA "Queqiao"
$configDir = Join-Path $runtimeRoot "config"
$dataDir = Join-Path $runtimeRoot "data"
$secretsDir = Join-Path $dataDir "secrets"
$environmentFile = Join-Path $configDir "runtime.env"
$workspacesFile = Join-Path $configDir "workspaces.json"
$workersFile = Join-Path $configDir "workers.json"
$workerTokenFile = Join-Path $secretsDir "worker-token.secret"
$approvalSecretFile = Join-Path $secretsDir "oauth-approval.secret"
$jwtSecretFile = Join-Path $secretsDir "jwt-signing.secret"

foreach ($target in @($environmentFile, $workspacesFile, $workersFile)) {
  if (Test-Path -LiteralPath $target) { throw "Runtime configuration already exists: $target" }
}
New-Item -ItemType Directory -Force -Path $configDir, $secretsDir, (Join-Path $dataDir "gateway") | Out-Null
$resolvedWorkspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
function New-RandomBase64([int] $byteCount) {
  $bytes = New-Object byte[] $byteCount
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  return [Convert]::ToBase64String($bytes)
}

[IO.File]::WriteAllText($approvalSecretFile, (New-RandomBase64 24), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($jwtSecretFile, (New-RandomBase64 48), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($workerTokenFile, (New-RandomBase64 32), [Text.UTF8Encoding]::new($false))
$lines = @(
  "PUBLIC_BASE_URL=$($PublicBaseUrl.TrimEnd('/'))", "PORT=7575", "TRUST_PROXY_HOPS=1",
  "OAUTH_APPROVAL_SECRET_FILE=$approvalSecretFile", "JWT_SIGNING_SECRET_FILE=$jwtSecretFile",
  "QUEQIAO_STATE_DIR=$(Join-Path $dataDir 'gateway')", "QUEQIAO_WORKERS_FILE=$workersFile",
  "QUEQIAO_WORKER_PORT=7576", "QUEQIAO_WORKER_TOKEN_FILE=$workerTokenFile",
  "QUEQIAO_ENVIRONMENT_ID=$EnvironmentId", "QUEQIAO_WORKSPACE_ID=$WorkspaceId",
  "QUEQIAO_WORKSPACES_FILE=$workspacesFile"
)
[IO.File]::WriteAllLines($environmentFile, $lines, [Text.UTF8Encoding]::new($false))
$workspaces = @(@{ id = $WorkspaceId; displayName = $WorkspaceId; root = $resolvedWorkspace; profile = "read-only" })
$workers = @(@{ environmentId = $EnvironmentId; url = "http://127.0.0.1:7576"; tokenFile = $workerTokenFile })
[IO.File]::WriteAllText($workspacesFile, (ConvertTo-Json -InputObject $workspaces -Depth 5), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($workersFile, (ConvertTo-Json -InputObject $workers -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output "Created Queqiao runtime configuration at $runtimeRoot"
Write-Output "Approval secret is stored at $approvalSecretFile"
