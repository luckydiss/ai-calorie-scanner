# ADR-002: Telegram Auth and API Security Baseline

## Status

Accepted

## Context

Mini App user identity is provided via Telegram WebApp `initData`. API needs secure validation and abuse protection from day one.

## Decision

- Verify `initData` signature server-side for every login.
- Issue app session token (JWT access + refresh strategy is implementation-defined).
- Enforce rate limits on auth and scan endpoints.
- Limit image upload by MIME type and size.
- Validate all inputs using schema validation.

## Rationale

- Prevent forged Telegram identities.
- Reduce brute-force and spam behavior.
- Keep API behavior deterministic and observable.

## Consequences

Positive:

- Secure user linking to Telegram account.
- Lower abuse risk on expensive AI endpoints.

Negative:

- Slight extra complexity in auth bootstrap.
- Need token lifecycle and revocation rules.
