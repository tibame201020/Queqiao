$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectRoot ".env"
$workersFile = Join-Path $projectRoot ".queqiao\workers.json"

$values = @{}
foreach ($line in [IO.File]::ReadAllLines($environmentFile)) {
  if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
}
$workerToken = $values["QUEQIAO_WORKER_TOKEN"]
if (-not $workerToken) { throw "QUEQIAO_WORKER_TOKEN is missing from .env" }

$workers = @(
  @{ environmentId = "windows"; url = "http://127.0.0.1:7576"; token = $workerToken }
  @{ environmentId = "wsl"; url = "http://127.0.0.1:7577"; token = $workerToken }
)
[IO.File]::WriteAllText($workersFile, ($workers | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Output "Created worker registry with environments: windows, wsl"

