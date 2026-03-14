# RECONNAISSANCE REPORT: calorie_food

## Project Overview

- Type: Telegram Mini App with FastAPI backend, React frontend, and a separate Telegram bot worker.
- Purpose: users log meals manually or through AI-assisted photo/text scans; the system tracks calories, macros, progression, and achievements.
- Product stage: MVP with production/deploy wiring already present.

## Stack

- Backend language: Python 3.12+
- Backend framework: FastAPI 0.116+, Pydantic 2.11+, psycopg 3.2+, SQLAlchemy/Alembic present for migrations
- Frontend language: TypeScript 5.8+
- Frontend framework: React 19 + Vite 7 + Tailwind 3
- Database: PostgreSQL 16
- AI integration: OpenRouter over HTTPX
- Infra: Docker Compose, Nginx in production, GitHub Actions CI/CD
- Testing: pytest on backend; no frontend test framework found

## Architecture

- Pattern: mixed layered/monolithic.
- Backend entry points:
  - `backend/app/main.py` -> FastAPI application factory and all HTTP endpoints
  - `backend/app/bot.py` -> Telegram long-polling worker
- Frontend entry point:
  - `frontend/src/main.tsx` -> React bootstrap

Observed backend shape:

- `main.py` contains the HTTP interface, request/response DTOs, auth/session logic, direct SQL, scan orchestration, and some domain coordination.
- `achievements/` and `progression/` are the only extracted domain submodules.
- There is no repository layer; route handlers execute SQL directly through `DBConnection`.

Observed frontend shape:

- `App.tsx` is a large single-file application shell with view components, local state orchestration, scan polling, and celebratory UI logic.
- `api.ts` acts as a typed HTTP client and token bootstrap layer.
- `i18n/` is a small provider-based localization subsystem.

## Source Inventory

- Backend source files analyzed: 16 Python modules under `backend/app`
- Frontend source files analyzed: 4 TypeScript/TSX modules under `frontend/src`
- Tests found: 1 backend test module
- GRACE artifacts before onboarding: missing

## Key Modules

- `backend/app/main.py` -> central API module; owns FastAPI app creation, DTOs, request lifecycle, auth/session flow, meals, dashboard, scans, and health/metrics endpoints.
- `backend/app/db.py` -> thin PostgreSQL adapter with `?` to `%s` query normalization and transaction helper.
- `backend/app/ai.py` -> OpenRouter client for image/text nutrition estimation and recalculation.
- `backend/app/achievements/service.py` -> derives achievement state from meals/events and syncs unlocks.
- `backend/app/progression/service.py` -> XP, streak, and level progression rules.
- `frontend/src/App.tsx` -> all main UI screens and client-side orchestration.
- `frontend/src/api.ts` -> typed fetch wrapper and Telegram Mini App auth bootstrap.
- `frontend/src/i18n/index.tsx` -> runtime locale loading and translation provider.

## Dependency Flow

- Telegram Mini App -> `frontend/src/main.tsx` -> `frontend/src/App.tsx` -> `frontend/src/api.ts` -> FastAPI endpoints in `backend/app/main.py`
- FastAPI route handlers -> `backend/app/db.py` for persistence
- Scan endpoints -> `backend/app/ai.py` -> OpenRouter
- Meal creation/scan confirmation -> `backend/app/progression/service.py` and `backend/app/achievements/service.py`
- Telegram bot worker -> Telegram Bot API -> launches WebApp URL only; it is operationally separate from the main HTTP app

## Dependency Hotspots

Backend fan-in/fan-out from static imports:

1. `backend/app/db.py` -> fan-in 3, fan-out 1
2. `backend/app/achievements/schemas.py` -> fan-in 2, fan-out 0
3. `backend/app/config.py` -> fan-in 2, fan-out 0
4. `backend/app/progression/schemas.py` -> fan-in 2, fan-out 0
5. `backend/app/main.py` -> fan-in 0, fan-out 6

Frontend fan-in/fan-out:

1. `frontend/src/i18n/index.tsx` -> fan-in 2, fan-out 0
2. `frontend/src/App.tsx` -> fan-in 1, fan-out 2
3. `frontend/src/api.ts` -> fan-in 1, fan-out 0
4. `frontend/src/main.tsx` -> fan-in 0, fan-out 2

## Tests

- Framework: pytest
- Coverage level: medium for backend core flows, absent for frontend
- Key covered backend flows:
  - Telegram auth bootstrap
  - profile/goals CRUD
  - meals and dashboard
  - progression leveling
  - scan failure fallback without provider key
  - achievements
  - logout
  - metrics endpoint

## Risks And Observations

- `backend/app/main.py` is a monolith and the main maintenance hotspot. It mixes transport, validation, SQL, and domain orchestration in one file.
- Direct SQL in route handlers means API-layer changes can easily couple to persistence changes.
- `frontend/src/App.tsx` is also a monolith; UI state, view logic, polling, and local business rules are concentrated in one file.
- No frontend automated tests were found.
- Backend import graph is acyclic and relatively small, which is good for incremental refactoring.
- The Telegram bot is operationally separate and has no static dependency on backend modules; this reduces code coupling but increases deployment coordination requirements.
- README mentions `docs/` and ADR/PRD artifacts, but GRACE artifacts were not yet present in the repo.

## GRACE Status

- KnowledgeGraph: missing before this onboarding
- PatternDictionary: missing before this onboarding
- Annotated modules: 0 before onboarding
- Coverage after onboarding artifacts: source modules are registered at file level, not yet semantically annotated in-code

## Recommended Next Steps

1. Treat `backend/app/main.py` and `frontend/src/App.tsx` as primary impact-analysis hotspots before any feature work.
2. If future work touches API meal/scan logic, extract repository/service seams from `main.py` first or annotate the touched region incrementally.
3. Add frontend tests around `api.ts` integration assumptions and the scan flow state machine.
4. Keep `KnowledgeGraph.xml` updated after every semantic patch so navigation does not regress.
