# ADR-001: Service Architecture for Telegram AI Calorie Tracker

## Status

Accepted

## Context

MVP needs fast release, clean separation of concerns, and independent scaling for AI inference.

## Decision

Use a modular service architecture:

- `miniapp-web` (React + TypeScript + Tailwind)
- `api` (REST API, auth, meals, dashboard, trophies)
- `ai-worker` (async image processing)
- `postgres` (primary data store)
- `redis` (queue and cache)
- `s3-compatible storage` (meal images)

## Rationale

- AI operations are slower and bursty, should not block API.
- Queue-based async flow improves reliability and retries.
- REST contract simplifies frontend and backend parallel development.

## Consequences

Positive:

- Independent scaling for API and AI.
- Better observability for scan jobs.
- Easier incident isolation.

Negative:

- More infra components to operate.
- Need idempotency and retry handling for job processing.
