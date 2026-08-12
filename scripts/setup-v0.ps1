param(
  [Parameter(Mandatory = $true)][string] $PublicBaseUrl,
  [Parameter(Mandatory = $true)][string] $WorkspaceRoot,
  [string] $EnvironmentId = "windows",
  [string] $WorkspaceId = "default"
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $projectRoot "dist\queqiao.js") config init --public-base-url $PublicBaseUrl --workspace-root $WorkspaceRoot --environment-id $EnvironmentId --workspace-id $WorkspaceId
if ($LASTEXITCODE -ne 0) { throw "Queqiao config initialization failed" }
