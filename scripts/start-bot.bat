@echo off
setlocal
cd /d %~dp0..

if not exist ".env.prod" (
  echo .env.prod not found. Copy .env.prod.example first.
  exit /b 1
)

docker-compose -f docker-compose.prod.yml up -d --build bot
docker-compose -f docker-compose.prod.yml logs -f bot
