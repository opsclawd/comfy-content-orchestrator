# Task Context: Task 5

Title: Build the non-overlapping telemetry sampler
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-7
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-7
Start Commit: 27bbf2d699970a5f188cd3e8acf284c622494c3a

## Task Requirements

**Files:**

- Create: `packages/application/src/certification/telemetry-sampler.ts`
- Create: `packages/application/src/certification/telemetry-sampler.test.ts`
- Create: `packages/application/src/certification/index.ts`
- Modify: `packages/application/src/index.ts`
- Reference only: `packages/application/src/ports/gpu-telemetry-port.ts`
- Reference only: `packages/application/src/ports/host-telemetry-port.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `start-samples-before-dispatch` — `start()` completes one tagged `pre_dispatch` sample before scheduling the next 200 ms sample. Test case: `captures a pre-dispatch sample before start resolves`.
- `one-sample-at-a-time` — if a read lasts longer than 200 ms, the loop does not overlap reads and schedules the next interval after the current attempt settles. Test case: `never overlaps telemetry reads when a sample is slow`.
- `sample-failure-recovers` — a GPU or host read error is timestamped in `samplingErrors`, the partial pair is discarded, and the next interval still runs. Test case: `records a sampling error and recovers on the next interval`.
- `stop-is-terminal` — `stop()` cancels the next timer, waits for the in-flight attempt, and no later sample can mutate the result. Test case: `drains the active sample and remains stopped`.
- `post-unload-is-explicit` — `sampleNow("post_unload")` creates a separately tagged paired sample after settling and before stop. Test case: `tags the explicit post-unload sample`.
- `invalid-transitions-throw` — calling `start()` while already `running`, `stopping`, or `stopped` throws an explicit invalid transition error; calling `sampleNow()` when not `running` throws an error; `stop()` is idempotent across all states. Test case: `rejects invalid state machine transitions and handles re-entrant calls`.
- `consecutive-error-budget-aborts` — when consecutive sampling errors reach the configured budget (default: 10), the sampler aborts further sampling loops and records a fatal failure in sampling errors. Test case: `aborts sampling when consecutive error budget is exceeded`.

**Steps:**

- [ ] Write the fake-timer tests with deferred promises covering all seven invariants including invalid transitions, idempotence, and consecutive error budget.
- [ ] Implement `TelemetrySampler` with explicit `idle | running | stopping | stopped` state machine. Enforce strict transition rules: `start()` transitions `idle -> running` and rejects if called in `running`, `stopping`, or `stopped`; `sampleNow()` requires `running` state and rejects otherwise; `stop()` transitions to `stopping -> stopped` and is idempotent across repeated calls. Implement a recursive injected `setTimeout` scheduler with 200 ms default, read dependencies for both ports, immutable result snapshots, consecutive sampling error threshold / budget (default: 10) before stopping further polling, and error recovery on transient failures below the threshold.
- [ ] Read GPU and host telemetry concurrently within one attempt, but do not retain an unpaired sample if either source fails. Bound error text and preserve no fabricated numeric values.
- [ ] Export sampler types and classes from `packages/application/src/certification/index.ts` and re-export that module from `packages/application/src/index.ts`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/application/src/certification/telemetry-sampler.test.ts` — expected: all loop, transition, error recovery, and budget tests pass with fake timers.
- `pnpm exec eslint packages/application/src/certification/telemetry-sampler.ts packages/application/src/certification/telemetry-sampler.test.ts packages/application/src/certification/index.ts packages/application/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/certification/telemetry-sampler.ts packages/application/src/certification/telemetry-sampler.test.ts packages/application/src/certification/index.ts packages/application/src/index.ts` — expected: all files conform.

**Commit:** `feat(application): sample certification telemetry`

## Repository Targets

### Expected Files
- packages/application/src/certification/telemetry-sampler.ts
- packages/application/src/certification/telemetry-sampler.test.ts
- packages/application/src/certification/index.ts
- packages/application/src/index.ts

### Reference Files
- packages/application/src/ports/gpu-telemetry-port.ts
- packages/application/src/ports/host-telemetry-port.ts
- packages/contracts/src/ltx-certification.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/application/src/certification/telemetry-sampler.test.ts"]
["pnpm","exec","eslint","packages/application/src/certification/telemetry-sampler.ts","packages/application/src/certification/telemetry-sampler.test.ts","packages/application/src/certification/index.ts","packages/application/src/index.ts"]
["pnpm","exec","prettier","--check","packages/application/src/certification/telemetry-sampler.ts","packages/application/src/certification/telemetry-sampler.test.ts","packages/application/src/certification/index.ts","packages/application/src/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **start-samples-before-dispatch**: Start resolves only after one pre-dispatch paired sample is captured. (Test: `captures a pre-dispatch sample before start resolves`)
- **one-sample-at-a-time**: Slow sampling never overlaps another sampling attempt. (Test: `never overlaps telemetry reads when a sample is slow`)
- **sample-failure-recovers**: A failed paired sample is recorded as an error and the next interval still runs. (Test: `records a sampling error and recovers on the next interval`)
- **stop-is-terminal**: Stop cancels future work, drains in-flight work, and prevents later mutation. (Test: `drains the active sample and remains stopped`)
- **post-unload-is-explicit**: The explicit post-unload sample is tagged distinctly before shutdown. (Test: `tags the explicit post-unload sample`)
- **invalid-transitions-throw**: Invalid state machine transitions throw explicit errors while stop() is idempotent across all states. (Test: `rejects invalid state machine transitions and handles re-entrant calls`)
- **consecutive-error-budget-aborts**: Exceeding the consecutive sampling error budget stops further polling and marks the sampler as failed. (Test: `aborts sampling when consecutive error budget is exceeded`)

