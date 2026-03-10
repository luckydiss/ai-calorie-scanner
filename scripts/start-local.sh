#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]]; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

"$ROOT_DIR/scripts/start-backend.sh" &
BACKEND_PID=$!

sleep 2
"$ROOT_DIR/scripts/start-frontend.sh"
