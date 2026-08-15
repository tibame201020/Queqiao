param(
  [Parameter(Mandatory = $true)][string] $JoinToken,
  [string] $Gateway = "http://127.0.0.1:7574",
  [string] $WorkerEndpoint = "http://127.0.0.1:7577"
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $projectRoot "dist\queqiao.js") worker join --gateway $Gateway --token $JoinToken --endpoint $WorkerEndpoint
if ($LASTEXITCODE -ne 0) { throw "WSL Worker enrollment failed" }
