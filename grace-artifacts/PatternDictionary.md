# Pattern Dictionary: calorie_food

## PAT-001: Backend API Monolith

- Type: Structural
- Description: FastAPI routes, request/response DTOs, auth/session handling, and SQL-backed orchestration are concentrated in a single module.
- Canonical file: `backend/app/main.py`
- Mandatory elements:
  - `create_app(settings: Settings | None = None) -> FastAPI`
  - Pydantic request/response models declared in the same module as routes
  - helper conversion functions such as `row_to_*`, `str_to_dt`, `dt_to_str`
  - direct `DBConnection` usage inside route handlers
- Forbidden assumptions:
  - assuming a repository layer exists
  - assuming domain services own all business logic
- Deviations found:
  - none; this is the dominant API pattern

## PAT-002: Thin Infrastructure Adapter

- Type: Structural
- Description: infrastructure helpers are intentionally small, single-purpose modules with one class plus a few top-level helpers.
- Canonical files:
  - `backend/app/db.py`
  - `backend/app/ai.py`
  - `backend/app/metrics.py`
  - `backend/app/rate_limit.py`
  - `backend/app/telegram_auth.py`
- Mandatory elements:
  - one clear responsibility per module
  - small public API
  - no internal dependency fan-out explosion
- Preferred style:
  - top-level helper functions
  - lightweight classes with straightforward state

## PAT-003: Domain Package = `schemas.py` + `service.py` (+ constants)

- Type: Structural
- Description: extracted backend domains are organized as mini-packages with Pydantic schemas and pure-function service modules.
- Canonical packages:
  - `backend/app/achievements/`
  - `backend/app/progression/`
- Mandatory elements:
  - `schemas.py` with `BaseModel` outputs
  - `service.py` with top-level functions and optional dataclass result containers
  - package `__init__.py` that re-exports public API
- Preferred style:
  - services receive `DBConnection` explicitly
  - timezone/date helpers are local to the service module
  - writes are wrapped with `transaction(conn)`

## PAT-004: Backend Error Handling Style

- Type: ErrorHandling
- Description: HTTP-facing failures are surfaced through `HTTPException` in the API layer; lower-level helpers raise domain-specific Python exceptions where needed.
- Canonical examples:
  - `backend/app/main.py`
  - `backend/app/telegram_auth.py`
- Mandatory elements:
  - explicit `HTTPException` with concrete status codes in route code
  - mapping of provider/network exceptions through `map_scan_error_code`
  - best-effort logging around request lifecycle and maintenance failures
- Deviations found:
  - `backend/app/main.py` still uses `print(...)` when logging OpenRouter HTTP error payloads in one exception path
  - Priority: Medium

## PAT-005: SQL Access Pattern

- Type: DataAccess
- Description: SQL is written inline as multiline strings and executed directly through a custom `DBConnection` wrapper that normalizes placeholder syntax.
- Canonical files:
  - `backend/app/main.py`
  - `backend/app/achievements/service.py`
  - `backend/app/progression/service.py`
- Mandatory elements:
  - `conn.execute(...)` with `?` placeholders
  - explicit `.fetchone()` / `.fetchall()`
  - `with transaction(conn):` around write groups
- Forbidden elements:
  - hidden implicit session state
  - ORM model usage in request handlers

## PAT-006: Frontend Single-File App Shell

- Type: Structural
- Description: the React UI is composed in one large `App.tsx` file containing page sections, view components, local state, scan polling, and action handlers.
- Canonical file: `frontend/src/App.tsx`
- Mandatory elements:
  - local `type` declarations near usage
  - many internal helper functions before the exported `App`
  - `useState`-driven orchestration rather than external state manager
- Risks:
  - high change surface
  - difficult targeted testing

## PAT-007: Typed Frontend HTTP Client

- Type: Interface
- Description: frontend API access is centralized in `api.ts` with exported TypeScript types matching backend payloads.
- Canonical file: `frontend/src/api.ts`
- Mandatory elements:
  - exported DTO types
  - local `request<T>` wrapper
  - bearer token stored in module scope after `bootstrapSession()`
  - form-data handling for scan uploads

## PAT-008: Provider-Based I18n

- Type: Structural
- Description: localization is managed through a small React context provider with eagerly imported JSON dictionaries.
- Canonical file: `frontend/src/i18n/index.tsx`
- Mandatory elements:
  - `import.meta.glob(..., { eager: true })`
  - `I18nProvider`
  - `useI18n`
  - fallback locale behavior

## Naming Conventions

- Backend package names are lowercase and feature-oriented: `achievements`, `progression`
- Backend support modules are short nouns: `db.py`, `ai.py`, `metrics.py`, `config.py`
- Backend schema classes use `*Out`, `*Request`, `*Response`
- Backend service outputs use explicit semantic names: `ProgressionAwardResult`, `AchievementsResponse`
- Frontend main files are broad role names: `App.tsx`, `api.ts`, `main.tsx`

## Async/Sync Conventions

- FastAPI middleware and scan creation route are async-aware
- Many route handlers remain synchronous because DB access is synchronous via psycopg
- `OpenRouterClient` is synchronous and called from API routes
- Telegram bot worker is async and separate

## Testing Patterns

- Backend tests are end-to-end oriented through `fastapi.testclient.TestClient`
- Tests use a real PostgreSQL database plus Alembic migrations
- Helper functions inside `backend/tests/test_api.py` bootstrap auth and reset DB state
- No mirroring frontend test structure is present

## Deviation Audit

### Must Fix

- No correctness-critical pattern break was identified during onboarding.

### Should Fix

- `backend/app/main.py` mixes route layer and persistence/domain logic; this is the main maintainability deviation from a clean layered design.
- `frontend/src/App.tsx` is a UI god object by responsibility volume, even though the import graph stays simple.
- `backend/app/main.py` uses `print(...)` in one provider error branch instead of the established logger-based pattern.

### Nice To Fix

- Introduce frontend tests around scan flow, bootstrap auth, and achievement rendering.
- Extract backend route groups into files such as `auth`, `meals`, `scans`, `dashboard`.
