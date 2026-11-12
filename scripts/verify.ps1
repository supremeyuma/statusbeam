$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  Write-Host ""
  Write-Host "== $Name ==" -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Step '$Name' failed with exit code $LASTEXITCODE"
  }
}

Invoke-Step -Name "format" -Command { pnpm format:check }
Invoke-Step -Name "lint" -Command { pnpm lint }
Invoke-Step -Name "typecheck" -Command { pnpm typecheck }
Invoke-Step -Name "tests" -Command { pnpm test }
Invoke-Step -Name "build" -Command { pnpm build }

Write-Host ""
Write-Host "ALL CHECKS PASSED" -ForegroundColor Green
