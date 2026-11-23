<#
.SYNOPSIS
    1-command deploy of OSRS Flip Terminal v2 to a Linux VPS running systemd --user.
    Builds frontend locally, uploads code only (NEVER touches VPS .env or SQLite DB),
    updates Python deps via uv, restarts osrs-terminal.service, and verifies /health.
.EXAMPLE
    .\deploy\deploy-vps.ps1 -VpsHost "user@your-vps-ip"
    # Or save "user@your-vps-ip" in gitignored deploy\.deploy.local and run:
    .\deploy\deploy-vps.ps1
#>
param(
    [string]$VpsHost = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LocalHostFile = Join-Path $PSScriptRoot ".deploy.local"

if (-not $VpsHost) {
    if ($env:OSRS_VPS_HOST) {
        $VpsHost = $env:OSRS_VPS_HOST.Trim()
    } elseif (Test-Path $LocalHostFile) {
        $VpsHost = (Get-Content $LocalHostFile -Raw).Trim()
    }
}

if (-not $VpsHost) {
    throw "No VPS host configured. Pass -VpsHost 'user@your-vps-ip', set OSRS_VPS_HOST, or create gitignored deploy\.deploy.local."
}

$TempTar = Join-Path $env:TEMP "osrs_v2_deploy.tar.gz"

Write-Host "=== 1/4 Building React frontend locally ===" -ForegroundColor Cyan
Push-Location (Join-Path $RepoRoot "frontend")
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
} finally {
    Pop-Location
}

Write-Host "=== 2/4 Packaging backend + compiled static SPA ===" -ForegroundColor Cyan
Push-Location $RepoRoot
try {
    if (Test-Path $TempTar) { Remove-Item -Force $TempTar }
    tar -czf $TempTar backend/pyproject.toml backend/app frontend/dist
    if ($LASTEXITCODE -ne 0) { throw "tar packaging failed" }
} finally {
    Pop-Location
}

Write-Host "=== 3/4 Uploading to $VpsHost (preserving .env & SQLite DB) ===" -ForegroundColor Cyan
scp -o BatchMode=yes $TempTar "${VpsHost}:/tmp/osrs_v2_deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "scp upload failed" }
Remove-Item -Force $TempTar

$RemoteCmd = @'
set -euo pipefail
mkdir -p ~/osrs_trading_dashboard/backend ~/osrs_trading_dashboard/data ~/osrs_trading_dashboard/backups
rm -rf ~/osrs_trading_dashboard/backend/app ~/osrs_trading_dashboard/backend/static ~/osrs_trading_dashboard/frontend
tar -xzf /tmp/osrs_v2_deploy.tar.gz -C ~/osrs_trading_dashboard
mv ~/osrs_trading_dashboard/frontend/dist ~/osrs_trading_dashboard/backend/static
rmdir ~/osrs_trading_dashboard/frontend
rm -f /tmp/osrs_v2_deploy.tar.gz
cd ~/osrs_trading_dashboard
~/.local/bin/uv pip install --python .venv/bin/python ./backend -q
systemctl --user restart osrs-terminal.service
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:9119/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
systemctl --user is-active osrs-terminal.service
curl -fsS http://127.0.0.1:9119/health
echo ""
'@ -replace "`r`n", "`n"

Write-Host "=== 4/4 Updating deps, restarting service & verifying health ===" -ForegroundColor Cyan
$RemoteCmd | ssh -o BatchMode=yes $VpsHost "bash -s"
if ($LASTEXITCODE -ne 0) { throw "Remote deploy failed" }

Write-Host "`nDeploy complete! Your VPS database, active slots, journal, and .env were preserved." -ForegroundColor Green
