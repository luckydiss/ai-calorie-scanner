# Backend

Phase 2+ backend is bootstrapped with FastAPI and PostgreSQL.

## Run locally

```bash
python -m pip install -e .[dev]
alembic -c alembic.ini upgrade head
uvicorn app.main:app --reload --port 8080
```

PowerShell shortcuts:

```powershell
./scripts/start-dev.ps1
./scripts/deploy-check.ps1
```

Database runtime:

- Backend works only with PostgreSQL (`DATABASE_URL` is required).

Required env for auth and scan:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `TELEGRAM_ALLOW_INSECURE_DEV=1` only for local development outside Telegram

Operational env (phase 4):

- `LOG_LEVEL` (default: `INFO`)
- `MAINTENANCE_CLEANUP_INTERVAL_MINUTES` (default: `30`)
- `SESSIONS_RETENTION_DAYS` (default: `30`)
- `SCAN_JOBS_RETENTION_DAYS` (default: `30`)

## Implemented endpoints (phase 2)

- `POST /auth/telegram/verify`
- `POST /auth/logout`
- `POST /auth/logout-all`
- `GET/PUT /profile`
- `GET/PUT /goals`
- `GET/POST /meals`
- `PATCH/DELETE /meals/{meal_id}`
- `GET /dashboard`
- `POST /scans`
- `GET /scans/{scan_id}`
- `POST /scans/{scan_id}/confirm`
- `POST /scans/{scan_id}/cancel`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

## Tests

```bash
python -m pytest
```

Notes:

- Telegram auth now validates `initData` signature and `auth_date` TTL.
- Insecure Telegram auth fallback is allowed only when:
  - `APP_ENV=development`
  - `TELEGRAM_ALLOW_INSECURE_DEV=1`
- Phase 3 scan implementation uses OpenRouter chat completions with image input.
- Required env vars for scan:
  - `OPENROUTER_API_KEY`
  - `OPENROUTER_MODEL` (default: `google/gemini-3.1-flash-lite-preview`)
- Rate limits:
  - `/auth/telegram/verify` controlled by `AUTH_RATE_LIMIT_PER_MINUTE`
  - `/scans` controlled by `SCANS_RATE_LIMIT_PER_MINUTE`
- Normalized scan error codes include:
  - `provider_auth_missing`
  - `provider_invalid_image`
  - `provider_auth_invalid`
  - `provider_quota_exceeded`
  - `provider_forbidden`
  - `provider_rate_limited`
  - `provider_timeout`
  - `provider_connect_error`
- Background maintenance cleanup:
  - Deletes expired sessions older than retention window
  - Deletes old terminal scan jobs (`succeeded|failed|cancelled`) older than retention window
- Monitoring:
  - Structured JSON request logs
  - Prometheus-style metrics on `GET /metrics`
  - Scan outcome counters grouped by `outcome` and `error_code`

## PostgreSQL and migrations

```bash
docker compose up -d postgres
cd backend
alembic -c alembic.ini upgrade head
```

Set in `.env` for PostgreSQL runtime:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/calorie_food
```

Important:

- Runtime schema patching was removed.
- Backend startup now expects `alembic_version` table to exist.
- If startup fails with "Database is not migrated", run:

```bash
alembic -c alembic.ini upgrade head
```

Container runtime:

- `backend/Dockerfile` runs `alembic upgrade head` on startup and then starts uvicorn on `0.0.0.0:8080`.
