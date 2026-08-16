# Task Context: Task 6

Title: Aggregate measurements and evaluate the resource gate
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

- Create: `packages/application/src/certification/certification-metrics.ts`
- Create: `packages/application/src/certification/certification-metrics.test.ts`
- Modify: `packages/application/src/certification/index.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `peaks-come-from-raw-samples` — peak VRAM, host RAM used, and process RSS are maxima over observed paired samples only. Test case: `calculates GPU and host peaks from raw samples`.
- `deltas-use-window-edges` — swap usage, swap-in/swap-out activity, and page-fault deltas are `last - first`, never negative, and process deltas require the same PID/start-time identity at both edges. Test case: `calculates non-negative host and process deltas across one stable process`.
- `missing-data-fails-the-gate` — empty samples, absent post-unload data, any sampling error, or missing required process values yield nullable aggregates and a failed check, not zero. Test case: `fails certification when required telemetry evidence is missing`.
- `duration-boundary-is-inclusive` — a successful non-OOM render at exactly 55,000 ms passes; 55,001 ms fails. Test case: `applies the inclusive 55 second LTX duration gate`.
- `summary-has-one-source` — Markdown fields are rendered exclusively from a parsed artifact and visibly label failed/null values. Test case: `renders JSON-equivalent measurements and failures in Markdown`.

**Steps:**

- [ ] Create focused fixtures for normal, missing, counter-reset, PID-change, timeout, OOM, and duration-boundary scenarios.
- [ ] Implement pure `aggregateCertificationTelemetry`, `evaluateLtxResourceGate`, and `renderCertificationSummary` functions. Return named check results for render success, no OOM, duration, telemetry completeness, and post-unload headroom evidence.
- [ ] Treat counter reset or PID identity change as unavailable evidence and a failed completeness check. Do not clamp it into a passing zero delta.
- [ ] Include historical 46 s/24,028 MB values only in an explicitly labeled comparison section; never use them as measured fields or pass conditions.
- [ ] Re-export the functions/types from the certification index, run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/application/src/certification/certification-metrics.test.ts` — expected: peak, delta, missing-data, failure, and threshold tests pass.
- `pnpm exec eslint packages/application/src/certification/certification-metrics.ts packages/application/src/certification/certification-metrics.test.ts packages/application/src/certification/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/certification/certification-metrics.ts packages/application/src/certification/certification-metrics.test.ts packages/application/src/certification/index.ts` — expected: all files conform.

**Commit:** `feat(application): evaluate LTX resource envelope`

## Repository Targets

### Expected Files
- packages/application/src/certification/certification-metrics.ts
- packages/application/src/certification/certification-metrics.test.ts
- packages/application/src/certification/index.ts

### Reference Files
- packages/contracts/src/ltx-certification.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/application/src/certification/certification-metrics.test.ts"]
["pnpm","exec","eslint","packages/application/src/certification/certification-metrics.ts","packages/application/src/certification/certification-metrics.test.ts","packages/application/src/certification/index.ts"]
["pnpm","exec","prettier","--check","packages/application/src/certification/certification-metrics.ts","packages/application/src/certification/certification-metrics.test.ts","packages/application/src/certification/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **peaks-come-from-raw-samples**: All peak values are maxima over observed paired samples only. (Test: `calculates GPU and host peaks from raw samples`)
- **deltas-use-window-edges**: Swap usage, swap activity, and page-fault deltas use stable first/last identities and cannot be negative. (Test: `calculates non-negative host and process deltas across one stable process`)
- **missing-data-fails-the-gate**: Missing samples, sampling errors, or missing cleanup evidence fail completeness instead of becoming zero. (Test: `fails certification when required telemetry evidence is missing`)
- **duration-boundary-is-inclusive**: A successful render at 55000 ms passes and one at 55001 ms fails. (Test: `applies the inclusive 55 second LTX duration gate`)
- **summary-has-one-source**: Markdown values and failure labels are rendered only from the parsed artifact. (Test: `renders JSON-equivalent measurements and failures in Markdown`)

