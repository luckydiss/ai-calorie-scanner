#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

export VITE_API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:8080}"

cd "$FRONTEND_DIR"
exec npm run dev
