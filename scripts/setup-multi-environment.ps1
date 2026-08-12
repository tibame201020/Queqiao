$ErrorActionPreference = "Stop"
$runtimeRoot = Join-Path $env:LOCALAPPDATA "Queqiao"
$environmentFile = Join-Path $runtimeRoot "config\runtime.env"
$workersFile = Join-Path $runtimeRoot "config\workers.json"
if (-not (Test-Path -LiteralPath $environmentFile)) { throw "Run setup-v0.ps1 first: $environmentFile is missing" }
$values = @{}
foreach ($line in [IO.File]::ReadAllLines($environmentFile)) {
  if ($line -match '^([^#=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
}
$workerTokenFile = $values["QUEQIAO_WORKER_TOKEN_FILE"]
if (-not $workerTokenFile) { throw "QUEQIAO_WORKER_TOKEN_FILE is missing from runtime.env" }
$workers = @(
  @{ environmentId = "windows"; url = "http://127.0.0.1:7576"; tokenFile = $workerTokenFile }
  @{ environmentId = "wsl"; url = "http://127.0.0.1:7577"; tokenFile = $workerTokenFile }
)
[IO.File]::WriteAllText($workersFile, (ConvertTo-Json -InputObject $workers -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Output "Updated external Worker registry: $workersFile"
