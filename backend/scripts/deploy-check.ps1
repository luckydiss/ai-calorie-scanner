Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $env:DATABASE_URL) {
  throw "DATABASE_URL is not set"
}

python -m alembic -c alembic.ini upgrade head
python -m pytest
