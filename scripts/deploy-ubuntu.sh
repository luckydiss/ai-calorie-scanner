#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.prod" ]]; then
  echo ".env.prod not found. Create it from .env.prod.example"
  exit 1
fi

docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

echo "Deployment completed."
echo "Frontend: http://<server-ip>/"
echo "Health:   http://<server-ip>/health/live"
