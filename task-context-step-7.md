# Task Context: Task 7

Title: Orchestrate render, cleanup, and failure evidence
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

- Create: `packages/application/src/certification/run-certification.ts`
- Create: `packages/application/src/certification/run-certification.test.ts`
- Modify: `packages/application/src/certification/index.ts`
- Reference only: `packages/application/src/ports/render-engine-port.ts`
- Reference only: `packages/application/src/certification/telemetry-sampler.ts`
- Reference only: `packages/application/src/certification/certification-metrics.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `ordered-success-path` — state transitions are `ready -> sampling -> rendering -> unloading -> settling -> final_sampling -> stopped -> completed`; telemetry starts before queueing and `/free` occurs only after a succeeded result. Test case: `runs the successful certification phases in order`.
- `failed-render-keeps-cleanup` — a failed result or render exception transitions to recovery, attempts `/free`, performs the bounded settle and final sample when possible, stops telemetry, and returns a failed artifact draft. Test case: `captures a failed render and still attempts cleanup evidence`.
- `timeout-is-not-thrown-away` — a render timeout becomes failure code `render_timeout` with the observed samples retained. Test case: `returns measured failure evidence when RenderEnginePort times out`.
- `cleanup-failure-cannot-pass` — unload, settle, final-sample, or sampler-stop failure is recorded and forces the gate to fail even when rendering succeeded. Test case: `fails the run when post-render cleanup evidence is incomplete`.
- `settle-is-bounded` — the injected sleep is called exactly once with 5,000 ms after an unload attempt and never becomes an unbounded poll. Test case: `uses the fixed five second post-unload settle window`.

**Steps:**

- [ ] Build fakes for `RenderEnginePort`, the sampler control surface, `sleep`, and `now`; assert call order rather than implementation details.
- [ ] Implement `runCertification` around one `queueRender()`/`getRenderResult()` pair. Start duration immediately before dispatch, use terminal completion time for duration, and preserve output object keys as paths/identifiers without claiming hashes.
- [ ] Put cleanup in an explicit recovery path that attempts each remaining safe step once. Combine a primary render failure and cleanup failure in structured details without replacing the primary cause.
- [ ] Return a validated artifact draft to the caller; reserve filesystem publication and process exit codes for the render-worker layer.
- [ ] Re-export the use case and dependency/input types, run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/application/src/certification/run-certification.test.ts` — expected: success, failed render, timeout, cleanup failure, and settle-bound tests pass.
- `pnpm exec eslint packages/application/src/certification/run-certification.ts packages/application/src/certification/run-certification.test.ts packages/application/src/certification/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/certification/run-certification.ts packages/application/src/certification/run-certification.test.ts packages/application/src/certification/index.ts` — expected: all files conform.

**Commit:** `feat(application): orchestrate hardware certification`

## Repository Targets

### Expected Files
- packages/application/src/certification/run-certification.ts
- packages/application/src/certification/run-certification.test.ts
- packages/application/src/certification/index.ts

### Reference Files
- packages/application/src/ports/render-engine-port.ts
- packages/application/src/certification/telemetry-sampler.ts
- packages/application/src/certification/certification-metrics.ts
- packages/contracts/src/ltx-certification.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/application/src/certification/run-certification.test.ts"]
["pnpm","exec","eslint","packages/application/src/certification/run-certification.ts","packages/application/src/certification/run-certification.test.ts","packages/application/src/certification/index.ts"]
["pnpm","exec","prettier","--check","packages/application/src/certification/run-certification.ts","packages/application/src/certification/run-certification.test.ts","packages/application/src/certification/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **ordered-success-path**: Success follows the explicit sampling, rendering, unloading, settling, final sampling, stop, and completion order. (Test: `runs the successful certification phases in order`)
- **failed-render-keeps-cleanup**: Render failure still attempts cleanup and preserves observed evidence. (Test: `captures a failed render and still attempts cleanup evidence`)
- **timeout-is-not-thrown-away**: Render timeout becomes structured failure evidence with samples retained. (Test: `returns measured failure evidence when RenderEnginePort times out`)
- **cleanup-failure-cannot-pass**: Any missing unload, settle, final-sample, or stop evidence forces a failed run. (Test: `fails the run when post-render cleanup evidence is incomplete`)
- **settle-is-bounded**: Exactly one fixed 5000 ms settle follows an unload attempt. (Test: `uses the fixed five second post-unload settle window`)

