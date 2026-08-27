# Sprint 2.5 — Generation Dispatch Contract Closure

**Date:** 2026-08-26
**Status:** Approved design
**PRD reference:** Sprint 2.5, §2.3, §3.1.2, §6.4, §9.2

## Purpose

Close the job, lease, and dispatch contracts before Sprint 3 implements durable
generation. The PRD specifies the durable queue in a single roadmap bullet
("PostgreSQL durable worker leasing with `SELECT ... FOR UPDATE SKIP LOCKED`")
while §9.2's Durable Lease Recovery Gate demands deterministic reassignment with
no duplicate completed manifests. That is a concurrency-correctness property; it
must not be invented during implementation.

Following the Sprint 1.5 precedent, this sprint ships working code — migration,
domain types, ports, adapter, routes — not a document that Sprint 3 interprets.

## What already exists

Investigation of `001_baseline.sql` and the application ports found substantially
more in place than the PRD implies:

- `render_jobs` exists with `job_id`, `scene_id`, `workflow_template`,
  `injected_payload`, `status`, `worker_id`, `lease_expires_at`, `retry_count`,
  `max_retries`, `error_trace`, and `CHECK (retry_count <= max_retries)`.
- `job_status_enum` exists: `queued`, `leased`, `rendering`, `completed`,
  `failed`, `cancelled`.
- A partial index `ON (status, lease_expires_at) WHERE status IN ('queued','leased')`
  exists — already shaped for a claim query.
- `generation_manifests.job_id` is `NOT NULL UNIQUE REFERENCES render_jobs`, so
  **exactly-once-manifest is already enforced at the database level**.

What is genuinely missing is semantics, not tables: lease duration and renewal,
what reclaims an expired lease, which transitions are legal, the claim query
itself, the dispatch protocol, and where storage admission is evaluated.

The application ports `RenderJobRepository<TRenderJob>` and
`ManifestRepository<TManifest>` exist but are generic placeholders with no
implementations — generic precisely because no `RenderJob` domain type was ever
defined. That missing type is the ambiguity this sprint closes.

## Decisions

### One queue, two job kinds

Candidate generation and production render both become `render_jobs` rows,
discriminated by `job_kind`. Manifests are written only for `production` jobs;
the existing `UNIQUE` constraint already permits jobs without manifests.

Rationale: both paths dispatch ComfyUI workflows to the same single GPU, which
§3.1.2 already governs with an exclusive execution lease. One queue serialises
that contention naturally. Two queues would duplicate the lease, reclaim, and
retry machinery and then require cross-queue GPU arbitration.

### Worker polls the Control API

The render worker polls `POST /api/jobs/claim` over the tailnet. The Control API
runs the `SKIP LOCKED` claim internally.

Rationale: PostgreSQL has **no published ports** — verified during the Hetzner
deployment, the compose service exposes none, so it is reachable only inside the
control-plane Docker network. A worker claiming directly would require publishing
the database to the tailnet and issuing it credentials. Polling also handles
intermittent worker availability as a non-event: an offline worker simply stops
polling and its leases expire. The worker exposes no listener, matching §2.1B
("Render-worker control surface: Tailscale interface only when remotely
required").

### Self-healing claim with a fencing token

The claim query treats an expired lease as claimable — no separate sweeper
process. Each claim mints a new `lease_token`; every subsequent mutation must
present the current token, so a superseded worker's writes are rejected at the
database rather than merely caught downstream by the manifest `UNIQUE`
constraint.

The existing partial index already keys `queued` and `leased` rows by expiry,
which is the access pattern "claimable = queued OR (leased AND expired)"
requires — evidence the original schema author intended self-healing reclaim.
The index is extended below to cover `rendering` as well, since the pattern was
right but its coverage stopped short of the mid-render crash case.

## Schema

Migration `007_job_dispatch_contract.sql`. Additive only; no table is created.

```sql
CREATE TYPE job_kind_enum AS ENUM ('candidate', 'production');

ALTER TABLE render_jobs
  ADD COLUMN job_kind job_kind_enum NOT NULL DEFAULT 'production',
  ADD COLUMN lease_token UUID;              -- NULL when unleased

-- Reclaim must cover 'rendering': a worker can die mid-render, which is exactly
-- what the Durable Lease Recovery Gate kills. Ordering is FIFO by created_at.
DROP INDEX idx_render_jobs_queue;
CREATE INDEX idx_render_jobs_queue
  ON render_jobs (status, lease_expires_at, created_at)
  WHERE status IN ('queued', 'leased', 'rendering');
```

`DEFAULT 'production'` keeps the migration safe against existing rows and matches
what the table was originally built for.

## Layer placement

| Layer | Addition |
|---|---|
| `packages/domain` | `render-job.ts` — `RenderJob`, `JobKind`, `JobStatus`, `LeaseToken`, `evaluateJobTransition()` |
| `packages/application/src/ports` | `JobQueuePort`; `RenderJobRepository` de-genericised onto the real domain type |
| `packages/infrastructure/src/postgres/repositories` | `postgres-render-job-queue.ts` |
| `apps/control-api/src/http/routes` | `job-routes.ts` |

This mirrors the storage-watermark work already merged (domain rule → port →
postgres adapter → route) and introduces no new architectural pattern.

## Job lifecycle

Every existing enum value keeps a distinct meaning.

| From | To | Trigger |
|---|---|---|
| `queued` | `leased` | claim |
| `leased` | `rendering` | worker submits the ComfyUI prompt |
| `leased` / `rendering` | `queued` | lease expired, **or** worker-reported failure — in either case while `retry_count < max_retries`; increments `retry_count` |
| `rendering` | `completed` | success (+ manifest for production jobs) |
| `leased` / `rendering` | `failed` | lease expired or worker-reported failure once `retry_count >= max_retries` |
| `queued` / `leased` / `rendering` | `cancelled` | operator or system cancel |

`completed`, `failed`, and `cancelled` are terminal.

Retry is expressed as a direct return to `queued`, not as `failed` → `queued`.
This keeps `failed` genuinely terminal and avoids needing a background process to
resurrect failed rows — consistent with the no-sweeper decision above. A job
reaches `failed` only when its retry budget is spent.

`leased` and `rendering` remain distinct because §3.1.2's exclusive GPU lease
means a worker can own a job while still waiting for the GPU. Collapsing them
would hide that state.

## Claim protocol

One transaction, two statements. The first prevents infinite reassignment; the
second claims.

```sql
-- 1. expired AND out of retries -> terminal, never handed out again
UPDATE render_jobs
SET status = 'failed',
    error_trace = 'lease expired; retries exhausted',
    updated_at = now()
WHERE status IN ('leased','rendering')
  AND lease_expires_at < now()
  AND retry_count >= max_retries;

-- 2. claim the oldest eligible job
WITH claimable AS (
  SELECT job_id FROM render_jobs
  WHERE status = 'queued'
     OR (status IN ('leased','rendering')
         AND lease_expires_at < now()
         AND retry_count < max_retries)
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
UPDATE render_jobs j
SET status = 'leased',
    worker_id = $1,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + $2::interval,
    retry_count = j.retry_count
                + (CASE WHEN j.status = 'queued' THEN 0 ELSE 1 END),
    updated_at = now()
FROM claimable c
WHERE j.job_id = c.job_id
RETURNING j.*;
```

Reclaim increments `retry_count` so a persistently crashing worker cannot loop
forever; the existing `CHECK (retry_count <= max_retries)` bounds it, and
statement 1 makes exhaustion terminal and visible rather than leaving a job
stuck in `rendering` with a dead lease.

`gen_random_uuid()` is used for `lease_token` rather than the codebase's usual
`uuidv7()`. This is deliberate: a fencing token benefits from being
unpredictable, and v7 UUIDs are time-ordered and therefore partially guessable.
Ordering has no value for a token.

### Fencing

Every mutation after claim carries `WHERE job_id = $1 AND lease_token = $2`.
Zero rows affected means the worker has been superseded and must abort.

## Storage admission

Evaluated at claim time — the moment new storage is committed to — and graded by
`job_kind`, following §2.3 rather than inventing a rule:

| Watermark | Claimable |
|---|---|
| normal / warning | any job |
| degraded (85%) | `production` only — §2.3 stops "new candidate-generation work" but continues "explicitly approved delivery operations" |
| critical (92%) | nothing — §2.3 blocks "new media writes except cleanup/repair" |

A blocked claim reports "no job available" rather than an error: nothing is
consumed, no retry is burned, and work resumes when capacity frees. This closes
the design half of issue #89.

## Timings

Lease 5 minutes, heartbeat 30 seconds, both configurable.

Grounded in §3.1.1's certified LTX workload (≤55 s) and §9.5's candidate batch
target (<45 s for 18 keyframes), so roughly ten missed heartbeats precede
reclaim — a merely slow render will not be reclaimed.

## HTTP surface

`apps/control-api/src/http/routes/job-routes.ts`, matching the existing `/api/`
prefix.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/jobs/claim` | `{ workerId }` | claim → `leased`; returns job + `leaseToken` |
| `POST /api/jobs/:id/start` | `{ leaseToken }` | `leased` → `rendering` |
| `POST /api/jobs/:id/heartbeat` | `{ leaseToken }` | renew `lease_expires_at` |
| `POST /api/jobs/:id/complete` | `{ leaseToken, manifestPayload? }` | → `completed` |
| `POST /api/jobs/:id/fail` | `{ leaseToken, errorTrace }` | → `queued` if retries remain, else `failed` |

`manifestPayload` is required for `production` jobs and rejected with `400` if
absent; it is not accepted for `candidate` jobs, which produce no manifest.

### Status codes

A polling worker must distinguish three different situations:

- **`204`** — nothing claimable, including admission-blocked. The normal quiet
  path; the worker keeps polling at its usual interval.
- **`409`** — lease token mismatch. The worker is superseded and must **abort**,
  not retry. This is the fencing signal.
- **`503`** — storage telemetry unavailable, so admission cannot be evaluated.
  Fails **closed**, consistent with the `/metrics` route, and signals the worker
  to back off rather than poll normally.

### Idempotent completion

If a worker completes a job but loses the response, its retry must not read as
supersession. `complete` and `fail` return `200` when the job is already in the
target state **and** the token still matches; only a genuine token mismatch
returns `409`. `lease_token` is therefore not cleared on completion — it remains
the record of which worker finished the job.

For production jobs, `complete` writes a manifest row. A duplicate attempt raises
the `generation_manifests.job_id` unique violation, which the adapter catches and
reports as already-done → `200`. Exactly-once is enforced by the database, not by
application bookkeeping.

`fail` splits the idempotency case by post-state, because its target state is not
fixed:

- A repeated `fail` against a row that the previous call already moved to
  `failed` (the retry-exhausted branch) returns `already_applied` / `200`. The
  job is genuinely terminal; the worker just lost the response.
- A repeated `fail` against a row that the previous call requeued
  (`status = 'queued'`, retries remain) returns `superseded` / `409`. The row is
  no longer in a state where `fail` applies, and the next attempt will see a
  different `lease_token` once the row is reclaimed, so re-using the original
  token is a stale-lease signal.

This rule was settled after the Sprint 2.5 merge when PR #104's review surfaced
a contract conflict between the #98 acceptance trap ("repeated `fail` returns
`200`") and the #103 `postgres-job-queue` behavior codified by the
`fail never treats a repeat as already_applied` integration test. The terminal
case is unambiguous; the requeue case is defensible either way. Tracking the
contract in this spec rather than only in code closes the cross-issue gap.

## Scope boundaries

In scope: migration, domain types and transition rules, `JobQueuePort`, the
Postgres adapter, the HTTP routes, admission integration, and the concurrency
tests that prove the invariant.

Out of scope, deferred to Sprint 3:

- the worker-side polling loop and ComfyUI invocation;
- StoryboardCandidate persistence;
- manifest **content** assembly per §6.4 — `complete` accepts `manifestPayload`
  as opaque JSONB and stores it, which lets this sprint prove exactly-once
  without depending on §6.4's content rules;
- ReferenceAsset continuity;
- render and queue telemetry metrics.

Worker authentication is deliberately **not** designed here. These endpoints are
a new authenticated surface, but inventing a worker auth scheme now would
prejudge the tailnet-identity-versus-session-login question that §2.5 flags as an
open product decision. For this sprint tailnet reachability is the boundary, as
it is for every other endpoint today; the endpoint shapes are designed so auth
can be added without changing them.

## Testing

Integration tests against real PostgreSQL, using the repository's existing
`test:db` / Testcontainers setup:

1. **Concurrent claim** — N workers race one queued job; exactly one wins, the
   rest receive `204`.
2. **Expired-lease reclaim** — force `lease_expires_at` into the past; a second
   worker claims it and `retry_count` increments.
3. **Fencing** — the original worker calls `complete` after supersession,
   receives `409`, and the job row is unchanged.
4. **Retry exhaustion** — at `max_retries`, an expired lease becomes `failed`
   rather than being reassigned indefinitely.
5. **Exactly-once manifest** — two `complete` calls for one production job yield
   exactly one `generation_manifests` row.
6. **Graded admission** — at degraded, `candidate` claims return `204` while
   `production` claims succeed; at critical, both return `204`.

Tests 2 and 5 together constitute §9.2's Durable Lease Recovery Gate
("kill a PostgreSQL-leased worker and verify deterministic reassignment without
duplicate completed manifests"), provable in CI without a GPU or a live render
worker. That is what de-risks Sprint 3.

## Issue decomposition

Four issues, split by layer, sized to match the tasks that have completed
successfully through the orchestrator:

1. **Migration and domain types** — `job_kind`, `lease_token`, index revision;
   `RenderJob` domain type and `evaluateJobTransition()`.
2. **`JobQueuePort` and Postgres adapter** — the claim query, token fencing, and
   concurrency tests 1–5. The risk concentrates here, so it gets a dedicated
   review.
3. **Control API job endpoints** — the five routes as thin HTTP over the port,
   including the `204`/`409`/`503` semantics and idempotent completion.
4. **Storage-admission integration** — graded admission in the claim path, test 6;
   closes the design half of #89.
