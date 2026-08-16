# Task Context: Task 10

Title: Wire the certify:ltx CLI and package commands
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

- Create: `apps/render-worker/src/cli/certify-ltx.ts`
- Create: `apps/render-worker/src/cli/certify-ltx.test.ts`
- Modify: `apps/render-worker/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Reference only: `templates/provenance.json`
- Reference only: `templates/ltx_25_720p_97f_api.json`
- Reference only: `packages/infrastructure/src/comfyui/render-engine-adapter.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`

**Behavioral invariants — write these named tests first:**

- `preflight-precedes-side-effects` — arguments, approved report, profile/live provenance, disk, environment, GPU, and memory mode all pass before sampler start or render dispatch. Test case: `completes all preflight checks before starting telemetry or rendering`.
- `dynamicvram-is-default` — absent `--highvram` selects `dynamicvram`, while `--highvram` selects `highvram`; both require a unique explicit run ID and never share a destination. Test case: `defaults to DynamicVRAM and isolates highvram comparator output`.
- `hardware-unavailable-is-explicit-skip` — unavailable NVIDIA/RTX hardware exits 77, writes no passing artifact, and prints a clear reason; integrity/configuration/disk failures exit 1. Test case: `maps unsupported hardware to 77 and refused preflight to 1`.
- `render-outcome-is-published` — once dispatch begins, both passing and failed/timeout outcomes are published; exit is 0 only for a passing gate and 1 for a failed artifact. Test case: `publishes measured success and failure outcomes with truthful exit codes`.
- `direct-entry-is-testable` — importing the module has no process side effect, while direct execution sets `process.exitCode` from `runCertificationCli`. Test case: `does not execute the CLI when imported`.

**Steps:**

- [ ] Add parser tests for required `--comfyui-dir`, `--comfyui-url`, `--comfyui-pid`, `--gold-master-provenance`, and `--run-id`; optional `--manifest`, `--gpu-index`, `--output-root`, and `--highvram`; help; duplicates; unknown flags; invalid PIDs/indexes/run IDs; and positional arguments.
- [ ] Add orchestration tests with dependency injection. Assert that refusal paths never call sampler/render/writer, while post-dispatch failure calls the writer once with `status: "failed"`.
- [ ] Implement the CLI in this order: parse; load the exact `ltx-25-720p-97f` profile; read approved provenance; collect live provenance (including disk/hash/Git checks); collect environment; apply Task 8 preflight; read/parse the checked-in workflow; construct adapters/sampler/render engine; call `runCertification`; atomically write artifacts; print paths and gate summary.
- [ ] Use fixed defaults `templates/provenance.json`, `certification/ltx-25`, GPU index 0, sample interval 200 ms, render timeout 300,000 ms, and settle 5,000 ms. Defaults must resolve from module/repository location, not the caller's current directory.
- [ ] Add `"certify:ltx": "tsx src/cli/certify-ltx.ts"` and `tsx` to `apps/render-worker/package.json`; add root `"certify:ltx": "pnpm --filter render-worker certify:ltx"`; update `pnpm-lock.yaml` with pnpm rather than hand-editing it.
- [ ] Keep the hardware command out of generic test scripts. Unit tests use fixtures only and do not invoke `/free`, ComfyUI, `/proc`, or `nvidia-smi`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run apps/render-worker/src/cli/certify-ltx.test.ts` — expected: parsing, ordering, mode, skip/failure, and publication tests pass without hardware.
- `pnpm exec eslint apps/render-worker/src/cli/certify-ltx.ts apps/render-worker/src/cli/certify-ltx.test.ts` — expected: no errors.
- `pnpm exec prettier --check apps/render-worker/src/cli/certify-ltx.ts apps/render-worker/src/cli/certify-ltx.test.ts apps/render-worker/package.json package.json pnpm-lock.yaml` — expected: all scoped files conform.
- `pnpm --filter render-worker certify:ltx -- --help` — expected: exit 0 and usage documents every flag without querying hardware.

**Commit:** `feat(render-worker): add LTX hardware certification CLI`

## Repository Targets

### Expected Files
- apps/render-worker/src/cli/certify-ltx.ts
- apps/render-worker/src/cli/certify-ltx.test.ts
- apps/render-worker/package.json
- package.json
- pnpm-lock.yaml

### Reference Files
- templates/provenance.json
- templates/ltx_25_720p_97f_api.json
- packages/infrastructure/src/comfyui/render-engine-adapter.ts
- packages/infrastructure/src/comfyui/provenance/collector.ts
- packages/infrastructure/src/comfyui/provenance/profile-manifest.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","apps/render-worker/src/cli/certify-ltx.test.ts"]
["pnpm","exec","eslint","apps/render-worker/src/cli/certify-ltx.ts","apps/render-worker/src/cli/certify-ltx.test.ts"]
["pnpm","exec","prettier","--check","apps/render-worker/src/cli/certify-ltx.ts","apps/render-worker/src/cli/certify-ltx.test.ts","apps/render-worker/package.json","package.json","pnpm-lock.yaml"]
["pnpm","--filter","render-worker","certify:ltx","--","--help"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **preflight-precedes-side-effects**: All configuration, identity, disk, environment, GPU, and mode checks complete before sampling or dispatch. (Test: `completes all preflight checks before starting telemetry or rendering`)
- **dynamicvram-is-default**: Default and highvram modes are explicit and cannot share a destination. (Test: `defaults to DynamicVRAM and isolates highvram comparator output`)
- **hardware-unavailable-is-explicit-skip**: Unsupported hardware maps to 77 without a passing artifact while refused preflight maps to 1. (Test: `maps unsupported hardware to 77 and refused preflight to 1`)
- **render-outcome-is-published**: Once dispatch begins, success and failure evidence are published with truthful exit status. (Test: `publishes measured success and failure outcomes with truthful exit codes`)
- **direct-entry-is-testable**: Import has no process side effect and only direct execution sets process.exitCode. (Test: `does not execute the CLI when imported`)

