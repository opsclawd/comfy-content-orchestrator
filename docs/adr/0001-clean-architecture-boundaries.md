# 1. Clean Architecture Boundaries

Date: 2026-08-14

## Status

Accepted

## Context

The content orchestrator requires strict architectural encapsulation to prevent a "big ball of mud" and maintain the isolated `domain` and strictly-controlled `application` layers.

## Decision

We will use a pnpm monorepo with `dependency-cruiser` statically analyzing imports and failing the build on architectural violations.

The dependency direction must be strictly inward:
- `domain` may depend only on `shared`.
- `application` may depend on `domain`, `contracts`, and `shared`.
- `infrastructure` may import domain types and application port contracts only.
- `web` may consume `contracts` plus presentation-safe types.

We will use exactly two composition roots to wire the application and infrastructure: `apps/control-api` and `apps/render-worker`. These apps are allowed to import across layers to perform dependency injection and bootstrap the processes.

## Consequences

- All future product and infrastructure code will be deterministically verified against this architecture during CI.
- Human reviewers are relieved from manual boundary checking.
- Introducing external dependencies (e.g., PostgreSQL, FFmpeg) must happen exclusively in `infrastructure`, preventing domain pollution.
