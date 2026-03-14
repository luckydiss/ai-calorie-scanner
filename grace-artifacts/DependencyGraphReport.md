# DEPENDENCY GRAPH REPORT: calorie_food

## Scope

- Backend graph: `backend/app/**/*.py`, excluding `__pycache__`
- Frontend graph: `frontend/src/**/*.{ts,tsx}`
- Excluded: tests, migrations, generated caches, static build output, `node_modules`

## Stats

- Backend files analyzed: 16
- Backend internal dependency edges: 16
- Backend circular dependencies: 0
- Frontend files analyzed: 4
- Frontend internal dependency edges: 4
- Frontend circular dependencies: 0

## Backend Graph

### Core modules by fan-in

| Module | Fan-in | Fan-out | Role |
|---|---:|---:|---|
| `backend/app/db.py` | 3 | 1 | Core infrastructure adapter |
| `backend/app/achievements/schemas.py` | 2 | 0 | Shared DTO leaf |
| `backend/app/config.py` | 2 | 0 | Settings leaf/core |
| `backend/app/progression/schemas.py` | 2 | 0 | Shared DTO leaf |
| `backend/app/achievements/service.py` | 1 | 3 | Domain orchestrator |
| `backend/app/progression/service.py` | 1 | 2 | Domain orchestrator |

### Orchestrators

- `backend/app/main.py`
  - fan-in: 0
  - fan-out: 6
  - depends on:
    - `backend/app/ai.py`
    - `backend/app/config.py`
    - `backend/app/db.py`
    - `backend/app/metrics.py`
    - `backend/app/rate_limit.py`
    - `backend/app/telegram_auth.py`
  - note: static analysis does not count imported names re-exported through `achievements/__init__.py` and `progression/__init__.py`, but operationally `main.py` also coordinates those domains.

### Leaves

- `backend/app/ai.py`
- `backend/app/metrics.py`
- `backend/app/rate_limit.py`
- `backend/app/telegram_auth.py`
- `backend/app/achievements/definitions.py`
- `backend/app/config.py`
- `backend/app/achievements/schemas.py`
- `backend/app/progression/schemas.py`

### Package glue

- `backend/app/achievements/__init__.py` -> re-exports schemas and service
- `backend/app/progression/__init__.py` -> re-exports schemas and service

### Layer analysis

Proposed layers as implemented:

1. Entry/interface:
   - `backend/app/main.py`
   - `backend/app/bot.py`
2. Domain services:
   - `backend/app/achievements/service.py`
   - `backend/app/progression/service.py`
3. Infrastructure/support:
   - `backend/app/db.py`
   - `backend/app/config.py`
   - `backend/app/ai.py`
   - `backend/app/metrics.py`
   - `backend/app/rate_limit.py`
   - `backend/app/telegram_auth.py`
4. DTO/schema/constants:
   - `backend/app/achievements/schemas.py`
   - `backend/app/progression/schemas.py`
   - `backend/app/achievements/definitions.py`

Layer observations:

- No reverse dependency violations were found in the static import graph.
- The main architectural issue is not cyclicity but concentration: the interface layer owns too much domain and persistence logic.

## Frontend Graph

### Dependency structure

- `frontend/src/main.tsx` -> `frontend/src/App.tsx`, `frontend/src/i18n/index.tsx`
- `frontend/src/App.tsx` -> `frontend/src/api.ts`, `frontend/src/i18n/index.tsx`
- `frontend/src/api.ts` -> no internal imports
- `frontend/src/i18n/index.tsx` -> no internal imports

### Core modules by fan-in

| Module | Fan-in | Fan-out | Role |
|---|---:|---:|---|
| `frontend/src/i18n/index.tsx` | 2 | 0 | Shared utility/provider |
| `frontend/src/App.tsx` | 1 | 2 | UI orchestrator |
| `frontend/src/api.ts` | 1 | 0 | HTTP client leaf |
| `frontend/src/main.tsx` | 0 | 2 | Entry point |

## Circular Dependencies

- Backend: none detected
- Frontend: none detected

## Architectural Conclusions

- The project is structurally stable: import cycles are absent and the graph is small.
- The primary risk is file-level concentration:
  - backend: `backend/app/main.py`
  - frontend: `frontend/src/App.tsx`
- `backend/app/db.py` is a core shared dependency; changes there have outsized blast radius.
- Domain modules `achievements` and `progression` are better isolated and are suitable starting points for future extraction patterns.

## CrossLinks Seed For KnowledgeGraph

- `backend/app/main.py` uses `backend/app/db.py`, `backend/app/ai.py`, `backend/app/config.py`, `backend/app/metrics.py`, `backend/app/rate_limit.py`, `backend/app/telegram_auth.py`, and operationally the achievements/progression packages.
- `backend/app/achievements/service.py` uses `backend/app/db.py`, `backend/app/achievements/definitions.py`, `backend/app/achievements/schemas.py`
- `backend/app/progression/service.py` uses `backend/app/db.py`, `backend/app/progression/schemas.py`
- `frontend/src/main.tsx` uses `frontend/src/App.tsx`, `frontend/src/i18n/index.tsx`
- `frontend/src/App.tsx` uses `frontend/src/api.ts`, `frontend/src/i18n/index.tsx`

## Recommended Refactoring Priorities

1. Split `backend/app/main.py` into route modules plus service/repository seams.
2. Split `frontend/src/App.tsx` by screen and stateful hooks.
3. Keep `db.py` stable and introduce repository abstractions around the highest-churn query groups first.
