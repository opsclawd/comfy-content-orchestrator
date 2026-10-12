# Variable-Frame MiniMax-H3 Feasibility Harness & Operator Runbook

## 1. Purpose and Non-Production Boundary

Issue #422 supplies GPU-independent engineering and an isolated, deterministic feasibility harness for testing continuous MiniMax-H3 video clips longer than the certified 124-frame baseline. This runbook guides human or operator agents during live execution on dedicated physical hardware (Issue #423).

### Strict Boundary Rules
- **Non-Production Isolation:** This harness evaluates candidate continuous frame counts (`124`, `192`, `243`, `362` at 24 fps). It does **not** modify `MINIMAX_H3_SUPPORTED_FRAME_RANGE`, default render profiles (`MINIMAX_H3_720P_5S_I2V_V1`, `MINIMAX_H3_720P_5S_REF2V_V1`), worker queue dispatch, or Review Hub approval gating.
- **No In-Place Template Mutation:** Canonical workflow templates (`templates/minimax_h3_720p_i2v_124f_api.json` and `templates/minimax_h3_720p_ref2v_124f_api.json`) are strictly immutable. The harness deep-clones templates into isolated run directories (`.ai-runs/minimax-h3-experiments/<run-id>/`) with derived workflow digests.
- **Evidence Paths Never Agent-Authored:** Per `AGENTS.md`, paths under `certification/`, `baseline/`, and `config/render-profiles/` hold physical hardware measurements. Automated agents must never author synthetic measurements or fabricate hardware certifications. Physical execution and GO/NO-GO determination belong strictly to the operator on live hardware.

### Grounding in System Architecture
- **ADR-0007 Alignment:**
  - Route `ref2v` (`reference_directed`): Uses `MiniMaxH3ReferenceToVideo` (node 105), wiring up to 9 Autogrow reference slots (`ref_images.ref_image_0` through `ref_images.ref_image_8`) directly from `LoadImage` nodes, pruning unreferenced slots and nodes. Conditioning prompt references use 1-based tags `<Picture 1>` through `<Picture N>`.
  - Route `i2v` (`frame_anchored`): Uses `MiniMaxH3ImageToVideo` (node 104), taking a single start-frame image from `LoadImage` (node 20).
- **Target Geometry & Cadence:** Standard production resolution `1344x768`, 24 fps (`MINIMAX_H3_FPS`).
- **Diffusion Model Weights:** Pinned `minimax_h3_ref2va_pruned_int8_convrot.safetensors` for both routes, matching `.minimax-h3-version`.

---

## 2. Pinned Environment & Runner Regimes

All experiments require the exact pinned revisions verified across repositories:

| Component | Pinned Version / Commit | Verification Script |
| --- | --- | --- |
| ComfyUI Core | `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc` | `./scripts/check-comfyui-version.sh` |
| MiniMax-H3 Models | Revision `7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1` | `./scripts/check-minimax-h3-version.sh` |
| FFmpeg | `7.0.2-static` | `./scripts/check-ffmpeg-version.sh` |

### CLI Memory Regimes & Pinned Semantics
In ComfyUI commit `55b6a9b1`, `cli_args.py` keeps Dynamic VRAM offloading active by default unless explicitly disabled. Passing `--lowvram` alone does **not** disable dynamic VRAM.
- **Baseline Regime (`dynamicvram-offload-v1`):** Default execution mode. No memory flags passed to ComfyUI. Leverages ComfyUI's dynamic VRAM memory allocator.
- **Comparator Variant (`static-lowvram-v1`):** Distinct fallback memory regime. Requires passing both `--disable-dynamic-vram` and `--lowvram`, accompanied by an explicit `--variant-reason` explaining the comparison hypothesis.

---

## 3. Frame Grid & Candidate Set

Candidate frame counts are constrained by the MiniMax-H3 latent temporal compression ratio:
$$\text{frames} = 17k + 5 \quad \text{where } k \in \mathbb{N}$$

The harness strictly admits only four candidate counts. All off-grid or out-of-scope counts fail closed at validation time:

| Frame Count | Grid Step $k$ | Nominal Duration (s) | Configured Duration (ms) | Experiment Role |
| --- | --- | --- | --- | --- |
| **124** | 7 | $31/6 \approx 5.167$s | 5,167 ms | Certified Control Baseline |
| **192** | 11 | $8.000$s | 8,000 ms | Candidate Tier 1 |
| **243** | 14 | $81/8 = 10.125$s | 10,125 ms | Candidate Tier 2 |
| **362** | 21 | $181/12 \approx 15.083$s | 15,083 ms | Candidate Tier 3 |

---

## 4. Render Host Preflight Verification

Before initiating any live runs on the physical host (e.g. RTX 4090), verify environment readiness:

### 1. Verify Pinned Artifacts
```bash
./scripts/check-comfyui-version.sh --comfy-dir /path/to/ComfyUI
./scripts/check-minimax-h3-version.sh --models-dir /path/to/ComfyUI/models
./scripts/check-ffmpeg-version.sh
```

### 2. Verify Target Isolation
- **Host Identity:** Confirm execution on the target host matching `--target-host`.
- **GPU Exclusivity:** Ensure no other process holds `/tmp/cco-gpu-locks/gpu-<uuid>.lock`. The harness enforces exclusive atomic acquisition by GPU UUID, recording PID and start-time ticks.
- **Port Inode Ownership:** Default port is `8199` on loopback `127.0.0.1`. The runner validates `/proc/net/tcp` inode matches against `/proc/${pid}/fd` to ensure no socket hijacking. Wildcard addresses (`0.0.0.0`) are strictly rejected.

---

## 5. Experiment Lifecycle & CLI Commands

The harness CLI is accessed via `pnpm experiment:minimax-h3 <subcommand>`.

### Subcommand 1: `prepare`
Generates isolated run descriptors, wires the workflow, validates prompt picture tokens, verifies input asset dimensions, and stages input assets.

#### I2V Preparation Example:
```bash
pnpm experiment:minimax-h3 prepare \
  --route i2v \
  --frames 124 \
  --seed 42 \
  --inputs ./test-assets/i2v-manifest.json \
  --prompt "Cinematic camera pan across misty mountains at dawn" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir /path/to/ComfyUI \
  --python /path/to/ComfyUI/venv/bin/python3 \
  --run-id "run-i2v-124f-baseline" \
  --operator-label "operator-alex" \
  --output-root .ai-runs/minimax-h3-experiments
```

#### Ref2V Preparation Example (with Autogrow Reference Slots):
```bash
pnpm experiment:minimax-h3 prepare \
  --route ref2v \
  --frames 192 \
  --seed 42 \
  --inputs ./test-assets/ref2v-manifest.json \
  --prompt "A wide shot of <Picture 1> wearing <Picture 2> walking through <Picture 3>" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir /path/to/ComfyUI \
  --python /path/to/ComfyUI/venv/bin/python3 \
  --run-id "run-ref2v-192f-candidate" \
  --operator-label "operator-alex" \
  --output-root .ai-runs/minimax-h3-experiments
```

#### Comparator Variant Example:
```bash
pnpm experiment:minimax-h3 prepare \
  --route i2v \
  --frames 192 \
  --seed 42 \
  --inputs ./test-assets/i2v-manifest.json \
  --prompt "Cinematic camera pan across misty mountains at dawn" \
  --runner-variant static-lowvram-v1 \
  --variant-reason "Evaluate memory fragmentation under static lowvram regime" \
  --target-host "$(hostname)" \
  --gpu-uuid "GPU-00000000-0000-0000-0000-000000000000" \
  --comfyui-dir /path/to/ComfyUI \
  --python /path/to/ComfyUI/venv/bin/python3 \
  --run-id "run-i2v-192f-static" \
  --operator-label "operator-alex" \
  --output-root .ai-runs/minimax-h3-experiments
```

### Subcommand 2: `validate`
Performs an offline, zero-GPU dry run check. Reconstructs the expected graph from authoritative base templates and verifies it against `config.json`, validates staged asset hashes, and verifies schema contracts.
```bash
pnpm experiment:minimax-h3 validate \
  --run-dir .ai-runs/minimax-h3-experiments/run-i2v-124f-baseline
```

### Subcommand 3: `run`
Launches the live experiment on the host. Spawns ComfyUI with exact array arguments, polls readiness, streams telemetry (`telemetry.jsonl`), submits the verified in-memory graph, polls history, probes output video with ffprobe, evaluates conformance, and writes durable `terminal-evidence.json`, `process.json`, and `result.json`.
For candidate runs (`frames > 124`), `--baseline-run-dir` pointing to a completed 124-frame baseline run for the matching route is strictly required:
```bash
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/run-ref2v-192f-candidate \
  --baseline-run-dir .ai-runs/minimax-h3-experiments/run-ref2v-124f-baseline \
  --stop-policy ./operator-stop-policy.json
```

### Subcommand 4: `reconcile`
Idempotent crash-recovery utility. If a run terminated prematurely (e.g. process crash, OOM, power loss), `reconcile` reads persisted `intent.json`, `receipt.json`, `terminal-evidence.json`, `process.json`, and outputs to reconstruct and durably persist `result.json`—even if `result.json` never existed.
```bash
pnpm experiment:minimax-h3 reconcile \
  --run-dir .ai-runs/minimax-h3-experiments/run-ref2v-192f-candidate
```

### Subcommand 5: `cleanup`
Safely stops any surviving child process, releases the GPU lock, and removes staging/temporary files (`temp`, `inputs`, `user`) while preserving control records (`descriptor.json`, `result.json`, `*.jsonl`). Generated output video files in `outputs/` are **preserved by default** (`--keep-outputs` is default behavior). To delete output videos along with temporary files, pass `--remove-outputs`.
```bash
# Default: cleans up temporary files and retains output videos
pnpm experiment:minimax-h3 cleanup \
  --run-dir .ai-runs/minimax-h3-experiments/run-ref2v-192f-candidate

# Remove outputs as well:
pnpm experiment:minimax-h3 cleanup \
  --run-dir .ai-runs/minimax-h3-experiments/run-ref2v-192f-candidate \
  --remove-outputs
```

### Subcommand 6: `import-sidecar`
Imports a reviewed visual review sidecar (`visual-review.json`) into an existing `result.json`. Verifies that the sidecar's `runId` and `outputSha256` match the probed facts of the run before updating `result.json`. This enables completed baseline runs to satisfy the visual review prerequisite required for candidate escalation.
```bash
pnpm experiment:minimax-h3 import-sidecar \
  --run-dir .ai-runs/minimax-h3-experiments/run-i2v-124f-baseline \
  --sidecar ./visual-review.json
```

### Input Manifest Schema & Examples

The `--inputs` flag expects a JSON manifest specifying input assets and reference slot metadata.

#### Sample `i2v-manifest.json` (Route `i2v`):
```json
{
  "referenceSetId": "ref-set-i2v-sunset",
  "references": [
    {
      "assetPath": "/path/to/sunset_start_frame.png",
      "stagedFilename": "start_frame.png",
      "role": "first_frame",
      "tag": "<Picture 1>",
      "order": 0
    }
  ]
}
```

#### Sample `ref2v-manifest.json` (Route `ref2v`):
```json
{
  "referenceSetId": "ref-set-character-action",
  "references": [
    {
      "assetPath": "/path/to/character.png",
      "stagedFilename": "character.png",
      "role": "character_identity",
      "tag": "<Picture 1>",
      "order": 0
    },
    {
      "assetPath": "/path/to/costume.png",
      "stagedFilename": "costume.png",
      "role": "costume",
      "tag": "<Picture 2>",
      "order": 1
    },
    {
      "assetPath": "/path/to/environment.png",
      "stagedFilename": "environment.png",
      "role": "background",
      "tag": "<Picture 3>",
      "order": 2
    }
  ]
}
```

---

## 6. Staged Escalation Methodology

Testing must proceed strictly in escalating frame counts:
$$\text{Baseline 124f (Control)} \longrightarrow \text{192f} \longrightarrow \text{243f} \longrightarrow \text{362f}$$

1. **Baseline Control Run (124 frames):**
   Execute 124 frames first to confirm absolute parity with certified production baseline. Peak VRAM, host swap, and execution latency establish the control reference.
2. **Escalate to 192 frames:**
   If baseline passes with zero stop triggers, proceed to 192 frames, providing `--baseline-run-dir`.
3. **Escalate to 243 frames:**
   If 192 frames passes conformance and visual inspection, proceed to 243 frames.
4. **Escalate to 362 frames:**
   Final candidate tier. Highest memory pressure and thermal envelope.

### Stopping Criteria (Fail-Closed Gates)
Do **NOT** advance to subsequent frame counts if any of the following occur:
- **CUDA Out-of-Memory (OOM):** ComfyUI process exits with CUDA out of memory or allocator failure.
- **Host Swap Delta Spike:** Host swap usage increases by $> 1024$ MiB during the run.
- **Process Crash / Non-Zero Exit:** ComfyUI crashes, terminates via signal, or drops socket connection.
- **Output Conformance Failure:**
  - `measuredFrames !== configuredFrames`
  - Container / stream duration discrepancy $> 0.2$s
  - Geometry or fps mismatch
- **Visual Collapse:**
  - Complete static black/gray output
  - Severe spatial tiling / checkerboard artifacts
  - Temporal blur disintegration / identity melting beyond acceptable continuity

---

## 7. Crash Recovery & Troubleshooting Runbook

### Scenario A: ComfyUI Crashes with CUDA OOM
1. Execute `reconcile`:
   ```bash
   pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/<run-id>
   ```
2. Inspect `result.json`: Verify `execution.status: "failed"` and terminal evidence details.
3. Halt escalation for this route/regime.

### Scenario B: Process Terminated by SIGINT / Operator Abort
1. Run `reconcile`:
   ```bash
   pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/<run-id>
   ```
2. Inspect result and run cleanup if needed:
   ```bash
   pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/<run-id> --keep-outputs
   ```

### Scenario C: Port / Socket Collision
If preflight reports port `8199` is occupied:
1. Verify child process state via `cleanup`:
   ```bash
   pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/<run-id>
   ```
2. If another process is using the socket, specify an alternate port during `prepare`: `--port 8200`.

---

## 8. Blank Observation Templates & Evidence Schemas

Per `AGENTS.md`, benchmark and certification records must NEVER be populated with fake data by automated tools. The schemas below describe operator-owned records. Populate policy thresholds from the operator's operating limits before `run`; there is no executable default policy. The policy example is instructional and becomes valid only after numeric limits replace its placeholders.

### 8.1 Stop Policy Template (`stop-policy.json`)
```json
{
  "policyId": "<operator-defined-policy-id>",
  "maxPeakVramMb": "<operator-defined positive integer>",
  "maxHostRamMb": "<operator-defined positive integer>",
  "maxSwapUsedMb": "<operator-defined positive integer>",
  "maxSwapDeltaMb": "<operator-defined positive integer>",
  "maxExecutionDurationMs": "<operator-defined positive integer>",
  "requireCompleteTelemetry": true,
  "requireConformantProbe": true,
  "visualStopConditions": [
    "severe_flicker_or_tearing",
    "subject_identity_collapse",
    "extreme_motion_blur_or_distortion"
  ]
}
```

### 8.2 Visual Review Template (`visual-review.json`)
```json
{
  "schemaVersion": 1,
  "runId": "exp-i2v-124-001",
  "route": "i2v",
  "configuredFrames": 124,
  "outputSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "status": "pending",
  "reviewer": null,
  "reviewedAt": null,
  "findings": null,
  "notes": null,
  "unavailableReason": null
}
```

### 8.3 Operator Decision Sidecar (`decision.json`)
```json
{
  "schemaVersion": 1,
  "runId": "exp-i2v-124-001",
  "route": "i2v",
  "configuredFrames": 124,
  "comparisonKey": "0000000000000000000000000000000000000000000000000000000000000000",
  "status": "pending",
  "operator": null,
  "decidedAt": null,
  "reason": null,
  "evidenceBundle": {
    "resultDigest": "<sha256-hex-digest-of-reconciled-result.json>",
    "observedMode": "dynamic_vram"
  }
}
```

### 8.4 Downstream Matrix Candidate Evaluation Row (`matrix-row.json`)
```json
{
  "schemaVersion": 1,
  "route": "i2v",
  "configuredFrames": 192,
  "requestedDurationMs": 8000,
  "configuredDurationMs": 8000,
  "width": 1344,
  "height": 768,
  "seed": 42,
  "promptDigest": "0000000000000000000000000000000000000000000000000000000000000000",
  "referenceSetId": "ref-set-1",
  "references": [
    {
      "slotIndex": 0,
      "role": "first_frame",
      "tag": "<Picture 1>",
      "order": 0,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    }
  ],
  "requestedRunnerVariant": "dynamicvram-offload-v1",
  "configuredRunnerVariant": "dynamicvram-offload-v1",
  "effectiveRunnerMode": "unknown",
  "descriptorDigest": null,
  "configDigest": null,
  "policyDigest": null,
  "comparisonKey": "0000000000000000000000000000000000000000000000000000000000000000",
  "runId": null,
  "baselineRunId": null,
  "attemptStatus": "unattempted",
  "blockReason": "Not yet scheduled in feasibility escalation order",
  "executionStatus": "not_started",
  "collectionStatus": "not_started",
  "probeStatus": "not_started",
  "outputConformanceStatus": "unknown",
  "visualReviewStatus": "pending",
  "stopRecommendation": null,
  "operatorDecision": "pending",
  "measuredPeakVramMb": null,
  "measuredHostRamMb": null,
  "measuredSwapDeltaMb": null,
  "measuredDurationMs": null,
  "measuredFrames": null
}
```
