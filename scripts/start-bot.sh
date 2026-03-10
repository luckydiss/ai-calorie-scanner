#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f ".env.prod" ]]; then
  echo ".env.prod not found. Copy .env.prod.example first."
  exit 1
fi

docker-compose -f docker-compose.prod.yml up -d --build bot
docker-compose -f docker-compose.prod.yml logs -f bot
