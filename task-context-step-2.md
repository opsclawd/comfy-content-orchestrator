# Task Context: Task 2

Title: Implement NVIDIA memory telemetry
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

- Create: `packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts`
- Create: `packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Reference only: `packages/application/src/ports/gpu-telemetry-port.ts`

**Behavioral invariants — write these named tests first:**

- `selected-gpu-only` — one configured GPU index maps exactly one CSV row to total/used/free MB and an injected timestamp. Test case: `reads the configured GPU index as one GpuMemorySnapshot`.
- `strict-csv` — blank, short, extra-column, non-finite, negative, or internally inconsistent rows are rejected. Test case: `rejects malformed or inconsistent nvidia-smi memory output`.
- `telemetry-never-fabricates` — process launch errors, non-zero exits, and a missing selected GPU produce a descriptive telemetry error instead of zeros. Test case: `surfaces nvidia-smi execution and GPU-selection failures`.
- `documented-poll-command` — every read uses `nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits` and selects the configured row in-process. Test case: `invokes the documented nounits memory query`.

**Steps:**

- [ ] Add tests with an injected promise-based `execFile` function and injected `now`; cover Unix newlines and CRLF.
- [ ] Export a pure `parseNvidiaSmiMemoryCsv(stdout, gpuIndex)` and an `NvidiaSmiTelemetryAdapter` implementing the existing `GpuTelemetryPort` without changing that port.
- [ ] Validate `totalVramMb === usedVramMb + freeVramMb` within a one-MB rounding tolerance, preserve MiB-style values as the repository's `Mb` convention, and include the selected index and safe stderr excerpt in errors.
- [ ] Export the parser, adapter, options, and error type from `packages/infrastructure/src/index.ts`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts` — expected: valid output parses and all invalid/unavailable cases fail explicitly.
- `pnpm exec eslint packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: all files conform.

**Commit:** `feat(infrastructure): sample NVIDIA VRAM`

## Repository Targets

### Expected Files
- packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts
- packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts
- packages/infrastructure/src/index.ts

### Reference Files
- packages/application/src/ports/gpu-telemetry-port.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts","packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts","packages/infrastructure/src/index.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts","packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts","packages/infrastructure/src/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **selected-gpu-only**: The configured GPU index maps exactly one CSV row to the memory snapshot and injected timestamp. (Test: `reads the configured GPU index as one GpuMemorySnapshot`)
- **strict-csv**: Malformed, non-finite, negative, or inconsistent NVIDIA CSV is rejected. (Test: `rejects malformed or inconsistent nvidia-smi memory output`)
- **telemetry-never-fabricates**: Execution and GPU-selection failures surface errors instead of zero-valued telemetry. (Test: `surfaces nvidia-smi execution and GPU-selection failures`)
- **documented-poll-command**: Each read invokes the documented memory query in no-header nounits CSV mode. (Test: `invokes the documented nounits memory query`)

