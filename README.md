# Calorie Food Telegram Mini App

AI-powered calorie assistant для Telegram Mini App: пользователь логирует еду текстом/фото, backend на FastAPI обрабатывает сканы через OpenRouter, а React WebApp показывает Dashboard и Daily Log.

[![Live Demo](https://img.shields.io/badge/%F0%9F%9A%80%20Live%20Demo-Open%20Mini%20App-brightgreen?style=for-the-badge)](https://ai-calorie.duckdns.org)

---

![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white)
![Telegram](https://img.shields.io/badge/Telegram-Mini%20App-26A5E4?style=flat-square&logo=telegram&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-AI-000000?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)

---

## Product Scope

MVP закрывает основные пользовательские сценарии:

- Telegram auth через `initData`
- Dashboard по калориям и БЖУ
- Daily Log с удалением приемов пищи
- AI scan (фото + текст или текст-only)
- Подтверждение/перерасчет AI результата
- Manual fallback для добавления еды

Подробности продукта: `docs/PRD.md`.

## Architecture

Текущая архитектура:

- `frontend` - React + TypeScript + Vite + Tailwind
- `backend` - FastAPI + Alembic + PostgreSQL
- `bot` - Telegram bot worker (`python -m app.bot`, long polling)
- `nginx` - static frontend + reverse proxy `/api`

Архитектурные решения: `docs/adr/`.

## Backend (FastAPI)

Реализованные endpoints:

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
- `POST /scans/{scan_id}/recalculate`
- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`

API контракт: `backend/openapi.yaml`.

## Frontend (React Mini App)

Основные экраны и UX:

- `Dashboard` (дневной прогресс по калориям/макросам)
- `Daily Log` (список приемов пищи, swipe-delete, Б/Ж/У по позиции)
- центральная CTA-кнопка `+` (quick add)
- `Add with AI` (камера/галерея/текст)
- `AI Draft` в Daily Log с перерасчетом и подтверждением
- `Onboarding` и `Add Meal` (manual entry)

## AI Scan Flow

1. Пользователь отправляет фото или описание.
2. Backend создает `scan_job` и запускает обработку через OpenRouter.
3. Frontend поллит статус: `queued -> processing -> succeeded|failed|cancelled`.
4. При `succeeded` создается AI draft, пользователь может:
   - пересчитать по комментарию (`/recalculate`)
   - подтвердить и добавить meal (`/confirm`)
5. После подтверждения обновляются Daily Log и Dashboard.

## Data Model

Ключевые таблицы:

- `users`, `profiles`, `daily_goals`
- `meals`, `meal_items`, `daily_summaries`
- `scan_jobs`, `scan_results`
- `sessions`, `events`, `streaks`, `achievements`, `user_achievements`

ERD: `docs/erd.md`.  
Миграции: `backend/alembic_migrations/`.

## Repository Structure

```text
backend/              FastAPI app, migrations, tests
frontend/             React mini app
docs/                 PRD, ERD, ADR, deploy notes
scripts/              local/prod scripts
docker-compose.yml
docker-compose.prod.yml
```

## Local Run

### Option 1: Docker

```bash
docker compose up -d postgres
```

```bash
cd backend
python -m pip install -e .[dev]
alembic -c alembic.ini upgrade head
uvicorn app.main:app --reload --port 8080
```

```bash
cd ../frontend
npm ci
npm run dev
```

### Option 2: helper scripts

```bash
./scripts/start-local.sh
```

## Environment Variables

Обязательные для production:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `APP_ENV`
- `OPENROUTER_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBAPP_URL`
- `CORS_ALLOW_ORIGIN_REGEX`

Примеры: `.env.example`, `.env.prod.example`.

## Production Deploy (Ubuntu)

```bash
cp .env.prod.example .env.prod
chmod +x scripts/deploy-ubuntu.sh scripts/rollback-ubuntu.sh
./scripts/deploy-ubuntu.sh
```

Полный runbook: `docs/server_deploy_update_instructions.xml`.

## CI/CD

### CI

Workflow: `.github/workflows/ci.yml`

- `frontend` job: lint, typecheck, build
- `backend` job: pytest (with PostgreSQL service)

### Auto Deploy

Workflow: `.github/workflows/deploy.yml`  
Скрипт: `scripts/deploy-server-update.sh`

На каждый push в `main`:

1. SSH на сервер
2. `git pull --rebase --autostash`
3. `docker-compose down --remove-orphans`
4. `docker-compose up -d --build`
5. health-check `/api/health/ready`

Нужные GitHub Secrets:

- `PROD_HOST`
- `PROD_USER`
- `PROD_SSH_KEY`
