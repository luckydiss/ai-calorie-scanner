#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.prod" ]]; then
  echo ".env.prod not found."
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod down
echo "Services stopped."
