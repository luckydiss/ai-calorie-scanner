#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f ".env.prod" ]]; then
  echo ".env.prod not found on server. Create it before deploying."
  exit 1
fi

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  COMPOSE_CMD="docker compose"
fi

echo "[deploy] Pull latest main"
git pull --rebase --autostash origin main

# Keep host nginx proxying to localhost:3000.
sed -i 's/80:80/127.0.0.1:3000:80/g' docker-compose.prod.yml

# Needed for docker-compose v1 variable substitution on some servers.
cp .env.prod .env

echo "[deploy] Restart containers"
sudo ${COMPOSE_CMD} -f docker-compose.prod.yml down --remove-orphans
sudo ${COMPOSE_CMD} -f docker-compose.prod.yml up -d --build

echo "[deploy] Verify stack"
sudo ${COMPOSE_CMD} -f docker-compose.prod.yml ps
curl -fsS https://ai-calorie.duckdns.org/api/health/ready

echo "[deploy] Done"
