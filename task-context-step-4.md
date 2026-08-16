# Task Context: Task 4

Title: Record reproducible runner environment identity
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

- Create: `packages/infrastructure/src/telemetry/runner-environment.ts`
- Create: `packages/infrastructure/src/telemetry/runner-environment.test.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `environment-is-observed` — Node, platform, architecture, kernel release/version, CPU model/count, GPU name/UUID/driver/total memory, CUDA version when observable, and ComfyUI PID/cmdline are collected from injected system sources. Test case: `collects the complete reproducibility environment record`.
- `argv-preserves-boundaries` — NUL-separated `/proc/<pid>/cmdline` becomes an ordered string array without shell re-parsing. Test case: `parses ComfyUI startup arguments without losing argument boundaries`.
- `unsupported-gpu-is-data` — the collector records the actual GPU identity; it does not rewrite a non-4090 name or decide pass/skip. Test case: `records the reported GPU identity verbatim`.
- `missing-identity-is-loud` — an unreadable cmdline or malformed GPU identity query rejects environment collection. Test case: `rejects incomplete GPU or ComfyUI process identity`.

**Steps:**

- [ ] Test an injected `os` facade, `readFile`, and `execFile` with deterministic timestamps and NVIDIA output.
- [ ] Implement `collectRunnerEnvironment` using `nvidia-smi --query-gpu=name,uuid,driver_version,memory.total --format=csv,noheader,nounits`, plus a plain `nvidia-smi` call only to extract its advertised CUDA version. Record `null` when the CUDA banner is genuinely absent.
- [ ] Read the ComfyUI command line from the required PID and return data matching `CertificationEnvironmentSchema`; do not infer or normalize its memory flags here.
- [ ] Export the collector and dependency/options types from `packages/infrastructure/src/index.ts`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/infrastructure/src/telemetry/runner-environment.test.ts` — expected: environment, argument-boundary, unsupported-name, and failure tests pass.
- `pnpm exec eslint packages/infrastructure/src/telemetry/runner-environment.ts packages/infrastructure/src/telemetry/runner-environment.test.ts packages/infrastructure/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/infrastructure/src/telemetry/runner-environment.ts packages/infrastructure/src/telemetry/runner-environment.test.ts packages/infrastructure/src/index.ts` — expected: all files conform.

**Commit:** `feat(telemetry): capture certification runner identity`

## Repository Targets

### Expected Files
- packages/infrastructure/src/telemetry/runner-environment.ts
- packages/infrastructure/src/telemetry/runner-environment.test.ts
- packages/infrastructure/src/index.ts

### Reference Files
- packages/contracts/src/ltx-certification.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/telemetry/runner-environment.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/telemetry/runner-environment.ts","packages/infrastructure/src/telemetry/runner-environment.test.ts","packages/infrastructure/src/index.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/telemetry/runner-environment.ts","packages/infrastructure/src/telemetry/runner-environment.test.ts","packages/infrastructure/src/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **environment-is-observed**: The complete Node, host, GPU, and ComfyUI process identity comes from observed sources. (Test: `collects the complete reproducibility environment record`)
- **argv-preserves-boundaries**: NUL-separated process arguments remain an ordered array without shell parsing. (Test: `parses ComfyUI startup arguments without losing argument boundaries`)
- **unsupported-gpu-is-data**: The collector records actual GPU identity and leaves pass/skip classification to policy. (Test: `records the reported GPU identity verbatim`)
- **missing-identity-is-loud**: Incomplete GPU or ComfyUI process identity rejects collection. (Test: `rejects incomplete GPU or ComfyUI process identity`)

