# Task Context: Task 8

Title: Enforce Gold Master, hardware, and memory-mode preflight
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

- Create: `apps/render-worker/src/certification/preflight.ts`
- Create: `apps/render-worker/src/certification/preflight.test.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`
- Reference only: `templates/provenance.json`

**Behavioral invariants — write these named tests first:**

- `approved-and-live-identities-match` — profile ID, render-profile key/version, workflow SHA-256, and the complete keyed model-hash set must match exactly. Test case: `accepts identical approved and live LTX provenance`.
- `certified-workload-is-exact` — the loaded profile and its workflow assertions must resolve to engine `ltx_25`, 1280x720, 97 frames, and 8 steps before live provenance is accepted. Test case: `rejects a profile that is not the pinned 720p 97-frame 8-step workload`.
- `any-drift-refuses-dispatch` — a changed/missing/extra model hash or changed workflow hash is a preflight failure before telemetry/render calls. Test case: `rejects workflow or model hash drift before dispatch`.
- `approved-source-is-host-validated` — `authored_from_spec`, `unpinned`, wrong profile, absent render-profile identity, or malformed approved JSON is rejected. Test case: `rejects provenance that is not an immutable validated host export`.
- `target-gpu-is-exact` — only the selected NVIDIA GeForce RTX 4090 identity is certification-capable; unavailable NVIDIA tooling and other GPUs return an explicit unsupported result. Test case: `classifies missing or non-RTX-4090 hardware as unsupported`.
- `memory-flags-are-exclusive` — default mode rejects `--highvram`, `--lowvram`, `--novram`, `--gpu-only`, and other explicit VRAM-mode flags; comparator mode requires exactly `--highvram` and rejects every mutually exclusive companion. Test case: `enforces DynamicVRAM default and exclusive highvram comparator arguments`.

**Steps:**

- [ ] Add table-driven tests for identity drift and ComfyUI argument combinations. Include an assertion that the render dependency was never touched on any failure.
- [ ] Implement and export pure `verifyGoldMasterProvenance`, `classifyCertificationHardware`, and `verifyComfyUiMemoryMode` functions in `apps/render-worker/src/certification/preflight.ts`. Normalize neither hashes nor startup flags: exact identity is the safety property.
- [ ] Require the approved report to be a prior `CertificationProvenanceReport` with host-validated source metadata. Compare live data produced by the existing collector after it has independently enforced the profile's 100 GB disk reservation and checked-in workflow hash.
- [ ] Return typed `ready`, `unsupported`, or `refused` outcomes so the CLI can distinguish skip code 77 from configuration/integrity failure code 1 using `classifyCertificationHardware`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run apps/render-worker/src/certification/preflight.test.ts` — expected: exact-match, drift, source, GPU, and memory-mode tests pass.
- `pnpm exec eslint apps/render-worker/src/certification/preflight.ts apps/render-worker/src/certification/preflight.test.ts` — expected: no errors.
- `pnpm exec prettier --check apps/render-worker/src/certification/preflight.ts apps/render-worker/src/certification/preflight.test.ts` — expected: both files conform.

**Commit:** `feat(render-worker): enforce LTX certification preflight`

## Repository Targets

### Expected Files
- apps/render-worker/src/certification/preflight.ts
- apps/render-worker/src/certification/preflight.test.ts

### Reference Files
- packages/infrastructure/src/comfyui/provenance/collector.ts
- packages/infrastructure/src/comfyui/provenance/profile-manifest.ts
- packages/contracts/src/ltx-certification.ts
- templates/provenance.json

## Validation Commands

```bash
["pnpm","exec","vitest","run","apps/render-worker/src/certification/preflight.test.ts"]
["pnpm","exec","eslint","apps/render-worker/src/certification/preflight.ts","apps/render-worker/src/certification/preflight.test.ts"]
["pnpm","exec","prettier","--check","apps/render-worker/src/certification/preflight.ts","apps/render-worker/src/certification/preflight.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **approved-and-live-identities-match**: All LTX profile, workflow, and complete keyed model identities match exactly. (Test: `accepts identical approved and live LTX provenance`)
- **certified-workload-is-exact**: The profile and workflow assertions resolve to LTX 2.5 at 1280x720, 97 frames, and 8 steps. (Test: `rejects a profile that is not the pinned 720p 97-frame 8-step workload`)
- **any-drift-refuses-dispatch**: Changed, missing, or extra workflow/model identity refuses before telemetry or render dispatch. (Test: `rejects workflow or model hash drift before dispatch`)
- **approved-source-is-host-validated**: Only immutable validated-host Gold Master provenance is eligible. (Test: `rejects provenance that is not an immutable validated host export`)
- **target-gpu-is-exact**: Only the selected RTX 4090 is certification-capable and other hardware is explicitly unsupported. (Test: `classifies missing or non-RTX-4090 hardware as unsupported`)
- **memory-flags-are-exclusive**: Default mode rejects explicit VRAM modes and comparator mode requires highvram without conflicts. (Test: `enforces DynamicVRAM default and exclusive highvram comparator arguments`)

