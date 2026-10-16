# Local PostgreSQL for development without Docker, using an installed PostgreSQL's binaries.
# Data lives in data/pg (git-ignored) on port 5433, trust auth, localhost only.
#   ./scripts/dev-db.ps1 start | stop | status
param([ValidateSet("start", "stop", "status")][string]$Action = "start")

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$data = Join-Path $root "data\pg"
$bin = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\initdb.exe" -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1 | ForEach-Object { $_.DirectoryName }
if (-not $bin) { throw "No PostgreSQL installation found under C:\Program Files\PostgreSQL" }

switch ($Action) {
    "start" {
        if (-not (Test-Path $data)) {
            & "$bin\initdb.exe" -D $data -U postgres -A trust -E UTF8 --locale=C | Out-Null
            Add-Content (Join-Path $data "postgresql.conf") "listen_addresses = 'localhost'"
            $created = $true
        }
        & "$bin\pg_ctl.exe" -D $data -o "-p 5433" -l (Join-Path $root "data\pg.log") -w start
        if ($created) {
            & "$bin\createdb.exe" -h localhost -p 5433 -U postgres jobcopilot
            & "$bin\createdb.exe" -h localhost -p 5433 -U postgres jobcopilot_test
        }
    }
    "stop" { & "$bin\pg_ctl.exe" -D $data -w stop }
    "status" { & "$bin\pg_ctl.exe" -D $data status }
}
