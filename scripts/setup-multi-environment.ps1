param(
  [Parameter(Mandatory = $true)][string] $WslTokenFile,
  [string] $WslUrl = "http://127.0.0.1:7577"
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $projectRoot "dist\queqiao.js") environment add --id wsl --url $WslUrl --token-file $WslTokenFile
if ($LASTEXITCODE -ne 0) { throw "WSL environment registration failed" }
