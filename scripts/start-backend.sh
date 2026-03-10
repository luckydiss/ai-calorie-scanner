#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/calorie_food}"

cd "$BACKEND_DIR"
python -m alembic -c alembic.ini upgrade head
exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8080
