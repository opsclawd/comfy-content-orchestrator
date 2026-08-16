# Task Context: Task 12

Title: Produce the Trinidad DynamicVRAM certification evidence
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

- Create: `certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json`
- Create: `certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md`
- Reference only: `docs/ltx-hardware-certification.md`
- Reference only: `packages/contracts/src/ltx-certification.ts`
- Reference only: `packages/application/src/certification/certification-metrics.ts`
- Reference only: `apps/render-worker/package.json`

**Steps:**

- [ ] On the idle Trinidad host, confirm the approved issue-#6 provenance file is a validated host export with immutable workflow/model hashes, ComfyUI is running in default DynamicVRAM/workflow-managed mode, its PID is readable, at least 100 GB is free, and no target output directory exists. Stop immediately if any condition is false.
- [ ] Run exactly one baseline certification through the harness, with operator-provided environment values and the fixed non-overwriting run ID:

```bash
pnpm certify:ltx -- --comfyui-dir "$COMFYUI_DIR" --comfyui-url "$COMFYUI_URL" --comfyui-pid "$COMFYUI_PID" --gold-master-provenance "$LTX_GOLD_MASTER_PROVENANCE" --run-id trinidad-rtx4090-dynamicvram-v1
```

- [ ] Require exit 0. Inspect only the small JSON/Markdown artifacts, not the rendered video, and confirm the JSON reports the real RTX 4090, `dynamicvram`, matching approved hashes, 97 frames/8 steps identity, successful render, no OOM, duration at most 55,000 ms, non-null peak VRAM/host RAM/process RSS/swap usage/swap activity/page-fault measurements, raw samples, and a non-null post-unload sample.
- [ ] Validate the exact generated files against the contract and confirm the Markdown was derived from the JSON:

```bash
pnpm --filter render-worker exec tsx -e 'import { readFile } from "node:fs/promises"; import { LtxCertificationArtifactSchema } from "@cco/contracts"; import { renderCertificationSummary } from "@cco/application"; const path = "certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json"; const artifact = LtxCertificationArtifactSchema.parse(JSON.parse(await readFile(path, "utf8"))); const summary = await readFile("certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md", "utf8"); if (artifact.status !== "passed" || !artifact.gate.passed || summary !== renderCertificationSummary(artifact)) process.exit(1);'
```

- [ ] Commit only `result.json` and `summary.md`; do not add rendered media. Leave `--highvram` unexecuted unless the service is separately restarted/configured by an authorized operator and use a different run ID if it is later measured.

**Acceptance/verification:**

- `pnpm exec prettier --check certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md` — expected: both evidence files conform.
- The exact contract-check command in the preceding step exits 0 — expected: the artifact is genuinely passing and the summary exactly matches its JSON source.

**Commit:** `certification: record Trinidad LTX DynamicVRAM envelope`

**Tests to add or update**

- New contract tests validate truthful passed/failed result shapes without hardware.
- New infrastructure tests cover NVIDIA CSV, `/proc` parsing, PID reuse, environment identity, and missing-source failures using injected fixtures.
- New application tests cover the 200 ms loop, no-overlap guarantee, recovery after sampling failures, state transitions, peak/delta calculations, missing samples, counter reset, timeout/failure evidence, post-unload cleanup, and the inclusive 55-second gate.
- New render-worker tests cover Gold Master drift rejection, target hardware and memory-mode policy, atomic output, CLI parsing, preflight ordering, exit codes, and distinct comparator results.
- No existing test file over 500 lines is expanded. Every new behavior gets a focused new test file, avoiding oversized updates to `collector.test.ts`, `profile-manifest.test.ts`, or `render-engine-adapter.test.ts`.
- The final hardware artifact is additionally contract-parsed and summary-compared, but this evidence step is not a substitute for the unit tests.

**Validation model**

Each implementation task makes its file-scoped test, lint, and formatting commands an acceptance criterion. The orchestrator's workspace-wide typecheck and dedicated validate phase still run automatically; they are not repeated as a standalone plan task or as unscoped manifest commands. The hardware command is deliberately excluded from generic CI and runs only in Task 12 on Trinidad with approved identity inputs.

**Risk areas**

- Spawning `nvidia-smi` every 200 ms may perturb CPU/host measurements or miss a very narrow VRAM peak. Preserve the interval and raw sampling errors in the artifact; if measured sampler latency consistently approaches 200 ms, stop and redesign around a persistent NVIDIA stream rather than quietly lowering fidelity.
- `/proc` counters are cumulative and system-wide values are noisy on a busy host. The runbook must require an idle machine, while PID/start-time checks protect process metrics from PID reuse.
- ComfyUI is persistent and the CLI performs irreversible external actions by queueing a real render and posting `/free`. Preflight must finish before either action, and recovery must never retry the render.
- A process can be labeled `--highvram` incorrectly if only CLI input is trusted. Always verify `/proc/<pid>/cmdline`, enforce mutual exclusion, and store the observed arguments.
- Two artifact files can diverge if separately assembled. Validate one in-memory artifact and derive both files from it inside one atomic publication operation.
- Existing issue-#6 assets are not yet a validated host export. Accepting them would falsely certify an authored workflow; the real run remains blocked until approved immutable provenance exists.
- The existing render result exposes output object keys, not content hashes. Record those identifiers truthfully and do not claim output hashes unless a later port supplies measured hashes.
- Automatic workspace typechecking runs after each task. In particular, Task 3 deliberately adds `HostTelemetryPort` and its Linux implementation/exports together so no port-only commit leaves adapters behind.

**Stop conditions**

- Abort before implementation if the task requires editing files outside the affected list or changing the workflow/model content; revise the plan instead.
- Abort a real run if approved Gold Master provenance is missing, authored/unpinned, malformed, or differs from the live workflow/model set. Never generate or copy hashes merely to make the run pass.
- Abort a real run if the selected GPU is not the target RTX 4090, `nvidia-smi` is unavailable, Linux `/proc` or the configured ComfyUI PID is unreadable, the PID identity changes, or ComfyUI startup arguments do not match the selected mode.
- Abort before dispatch if the existing provenance collector reports less than 100 GB available, hash drift, missing models, Git identity failure, or invalid workflow JSON.
- Abort publication if the run directory already exists or any artifact fails `LtxCertificationArtifactSchema`; never overwrite prior certification evidence.
- Record a failed artifact and stop after dispatch if render execution times out/fails/OOMs, telemetry has missing/error samples, `/free` fails, counters reset, the process identity changes, or post-unload sampling fails. Do not retry the certified render under the same run ID.
- Do not mark the issue complete if Task 12 cannot run on Trinidad or if its artifact does not pass the contract and <=55-second gate. Report the hardware/provenance blocker explicitly instead.

**Risk classification rationale**

This plan requires review because it contains a timed sampling loop with recovery after read failures, an explicit multi-phase certification state machine, and external side effects that queue a ComfyUI render and invoke `/free`.

## Repository Targets

### Expected Files
- certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json
- certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md

### Reference Files
- docs/ltx-hardware-certification.md
- packages/contracts/src/ltx-certification.ts
- packages/application/src/certification/certification-metrics.ts
- apps/render-worker/package.json

## Validation Commands

```bash
["pnpm","exec","prettier","--check","certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json","certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md"]
pnpm --filter render-worker exec tsx -e 'import { readFile } from "node:fs/promises"; import { LtxCertificationArtifactSchema } from "@cco/contracts"; import { renderCertificationSummary } from "@cco/application"; const path = "certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json"; const artifact = LtxCertificationArtifactSchema.parse(JSON.parse(await readFile(path, "utf8"))); const summary = await readFile("certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md", "utf8"); if (artifact.status !== "passed" || !artifact.gate.passed || summary !== renderCertificationSummary(artifact)) process.exit(1);'
```

