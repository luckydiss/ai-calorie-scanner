# Calorie Food Telegram Mini App

This repository contains phase 1 and phase 2 artifacts for an AI-powered calorie tracker in Telegram Web Mini Apps.

## Phase 1 scope

- Product and MVP definition
- Architecture decisions
- Database schema v1
- API contract v1 (OpenAPI)
- Backend core MVP implementation (without AI)
- Basic repository structure and CI skeleton

## Repository layout

- `docs/PRD.md` - product requirements (MVP)
- `docs/adr/` - architecture decision records
- `docs/erd.md` - data model overview
- `backend/openapi.yaml` - API contract v1
- `backend/schema.sql` - PostgreSQL schema v1
- `backend/app/` - FastAPI phase 2 implementation
- `backend/tests/` - API tests for phase 2
- `frontend/src/` - React phase 2 UI (`Dashboard`, `Daily Log`)
- `.github/workflows/ci.yml` - lint/typecheck/test pipeline skeleton

## Next phase entry criteria

Before phase 3 implementation:

1. Align phase 2 implementation against `openapi.yaml` and add remaining endpoints if needed.
2. Integrate AI scan queue and worker (`/scans` flow).
3. Start frontend screen integration with live backend.

## Ubuntu production deploy

1. Copy env template and fill secrets:

```bash
cp .env.prod.example .env.prod
```

2. Deploy containers:

```bash
chmod +x scripts/deploy-ubuntu.sh scripts/rollback-ubuntu.sh
./scripts/deploy-ubuntu.sh
```

3. Optional: run Telegram bot service (sends WebApp button on `/start`):

```bash
docker-compose -f docker-compose.prod.yml up -d --build bot
docker-compose -f docker-compose.prod.yml logs -f bot
```

3. Useful commands:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend
docker-compose -f docker-compose.prod.yml logs -f bot
./scripts/rollback-ubuntu.sh
```

Troubleshooting uploads:

- If scan image upload fails with `413 Payload Too Large`, increase `client_max_body_size` in every Nginx layer (host proxy and frontend container). The frontend container config already sets `client_max_body_size 25M`.

## GitHub auto-deploy (push to main)

Workflow file: `.github/workflows/deploy.yml`.

Set these repository secrets in GitHub:

- `PROD_HOST` (example: `13.63.45.211`)
- `PROD_USER` (example: `ubuntu`)
- `PROD_SSH_KEY` (private key contents used for SSH auth)

On every push to `main`, GitHub Actions connects to the server and runs:

- `scripts/deploy-server-update.sh`
