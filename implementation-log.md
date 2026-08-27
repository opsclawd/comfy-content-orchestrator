# Implementation Log - Task 4: Add retry-aware fenced failure

## Overview
Implemented retry-aware fenced job failure via `fail(jobId, leaseToken, errorTrace)` on `JobQueuePort` and `PostgresJobQueue`.

## Key Changes
1. **Application Port (`packages/application/src/ports/job-queue-port.ts`)**:
   - Added `fail(jobId: JobId, leaseToken: LeaseToken, errorTrace: string): Promise<JobMutationResult>` to `JobQueuePort`.

2. **PostgreSQL Adapter (`packages/infrastructure/src/postgres/repositories/postgres-job-queue.ts`)**:
   - Added `fail` method executing a single conditional SQL update matching `job_id`, `lease_token`, and active statuses (`leased`, `rendering`).
   - If `retry_count < max_retries`:
     - Sets status to `'queued'::job_status_enum`.
     - Clears active ownership: `worker_id = NULL`, `lease_expires_at = NULL`.
     - Retains `lease_token` for historical tracking.
     - Increments `retry_count` by 1.
     - Records `error_trace = $3`.
   - If `retry_count >= max_retries`:
     - Sets status to `'failed'::job_status_enum`.
     - Retains `worker_id`, `lease_expires_at`, `lease_token` as forensic history.
     - Preserves `retry_count` without additional increment.
     - Records `error_trace = $3`.
   - Returns `{ outcome: "applied", job: mappedJob }` on update.
   - On non-update, queries current job state:
     - Returns `{ outcome: "not_found" }` if absent.
     - Returns `{ outcome: "superseded" }` if present (never returns `already_applied` for failure).

3. **Integration Tests (`packages/infrastructure/src/postgres/repositories/postgres-job-queue.integration.test.ts`)**:
   - `fail requeues current active work while retries remain`: covers `leased` and `rendering` states, assertions on field clearing, incrementing, and fencing against retained old tokens.
   - `fail terminalizes current active work at retry exhaustion`: covers terminalization at retry limit and forensic ownership preservation.
   - `fail never treats a repeat as already_applied`: verifies repeated failure against requeued/failed jobs returns `superseded`.
   - `fail fences stale and illegal states`: verifies stale tokens and non-active states (`queued`, `completed`, `failed`, `cancelled`) are rejected with `superseded` without mutating database rows.
   - `fail reports missing jobs`: verifies non-existent job ID returns `not_found`.
   - `retry boundary preserves the final attempt`: verifies lifecycle of multi-attempt job where failure below max requeues, queued claim does not increment, and failure at max terminalizes.

## Verification
- Vitest Integration: 30/30 tests passed.
- Typecheck: `@cco/application` and `@cco/infrastructure` clean (0 errors).
- ESLint: clean (0 errors).
- Prettier: verified clean formatting.
