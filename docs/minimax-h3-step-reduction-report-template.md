# MiniMax-H3 Step-Reduction & Distillation Candidate Evaluation Report Template

> **OPERATOR INSTRUCTIONS:**
> This template is a **blank** evaluation form and runbook for live physical execution on dedicated GPU render hosts (Issue #445).
> Per `AGENTS.md` and repository governance rules, automated agents must **never** author synthetic hardware measurements or pre-populate GO/NO-GO verdicts.
> Complete each section only after executing both the baseline control and candidate step-reduction variant under identical physical conditions.
> See the specification document [MiniMax-H3 Step-Reduction & Distillation Candidate Specifications](minimax-h3-step-reduction-experiments.md) for full catalog definitions, licensing audits, and route restrictions.
> All CLI commands below are runnable and self-contained. Fill in the observed results, resource metrics, creative rubric assessments, and final disposition upon physical execution.

---

## 0. Operator Provisioning, Lifecycle & Test Execution Reference

### 0.1 Model Weights Provisioning & Atomic Checksum Verification
Run these commands on the target host before execution. Uses atomic `.tmp` download followed by immediate SHA-256 verification and atomic rename to guarantee weight integrity without overwriting existing verified files:

```bash
MODELS_DIR="/opt/comfyui/models"
mkdir -p "${MODELS_DIR}/diffusion_models" "${MODELS_DIR}/loras" "${MODELS_DIR}/text_encoders" "${MODELS_DIR}/vae"

download_and_verify() {
  local url="$1"
  local expected_hash="$2"
  local target_path="$3"

  if [[ -f "${target_path}" ]]; then
    local current_hash
    current_hash=$(sha256sum "${target_path}" | awk '{print $1}')
    if [[ "${current_hash}" == "${expected_hash}" ]]; then
      echo "File ${target_path} already exists with verified checksum."
      return 0
    else
      echo "Error: ${target_path} exists with unexpected checksum ${current_hash}. Refusing to overwrite." >&2
      return 1
    fi
  fi

  local tmp_path="${target_path}.tmp"
  mkdir -p "$(dirname "${target_path}")"
  echo "Downloading $(basename "${target_path}")..."
  if curl -fL -o "${tmp_path}" "${url}" && echo "${expected_hash}  ${tmp_path}" | sha256sum -c -; then
    mv "${tmp_path}" "${target_path}"
    echo "Verified and staged ${target_path}"
  else
    rm -f "${tmp_path}"
    echo "Error: Download or verification failed for $(basename "${target_path}")" >&2
    return 1
  fi
}

# 1. Ref2VA Base Checkpoint (7e75982b)
download_and_verify \
  "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors" \
  "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779" \
  "${MODELS_DIR}/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors"

# 2. FL2VA Base Checkpoint (7e75982b)
download_and_verify \
  "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors" \
  "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a" \
  "${MODELS_DIR}/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors"

# 3. FL2VA Turbo 8-step LoRA (3ec17a32)
download_and_verify \
  "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors" \
  "2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e" \
  "${MODELS_DIR}/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"

# 4. Ref2VA Turbo 4-step LoRA (3ec17a32)
download_and_verify \
  "https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/3ec17a324ced54151364f24f8b5fb6bf7e26414f/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors" \
  "5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c" \
  "${MODELS_DIR}/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"

# 5. Shared Text Encoder & VAEs
download_and_verify \
  "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors" \
  "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6" \
  "${MODELS_DIR}/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"

download_and_verify \
  "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/vae/minimax_h3_video_vae_int8_convrot.safetensors" \
  "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e" \
  "${MODELS_DIR}/vae/minimax_h3_video_vae_int8_convrot.safetensors"

download_and_verify \
  "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/vae/minimax_h3_audio_vae_fp32.safetensors" \
  "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48" \
  "${MODELS_DIR}/vae/minimax_h3_audio_vae_fp32.safetensors"

# 6. FastH3 8-step Distilled Checkpoint (ec1e3aa3) — Isolated FastH3 Checkout
FASTH3_DIFF_DIR="/opt/comfyui-fasth3/models/diffusion_models"
mkdir -p "${FASTH3_DIFF_DIR}"
download_and_verify \
  "https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy/resolve/ec1e3aa374a91c57b0b94a1623b7e657c0498cf2/diffusion_models/fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors" \
  "0922785978dc9bfe1adf27d8b291b0ca763f9f165f882e6cb297c72fbb6deda8" \
  "${FASTH3_DIFF_DIR}/fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"

mkdir -p /opt/comfyui-fasth3/models/text_encoders /opt/comfyui-fasth3/models/vae
ln -sf "${MODELS_DIR}/text_encoders/"* /opt/comfyui-fasth3/models/text_encoders/
ln -sf "${MODELS_DIR}/vae/"* /opt/comfyui-fasth3/models/vae/
```

### 0.2 Operator Stop Policy & Bounded Lifecycles
Create the operator stop policy `/opt/comfyui/operator-stop-policy.json` to enforce resource bounds:
```json
{
  "policyId": "rtx-4090-minimax-h3-default-stop-v1",
  "maxPeakVramMb": 24000,
  "maxHostRamMb": 32000,
  "maxSwapUsedMb": 4096,
  "maxSwapDeltaMb": 2048,
  "maxExecutionDurationMs": 1200000,
  "requireCompleteTelemetry": true,
  "requireConformantProbe": true,
  "visualStopConditions": [
    "severe_flicker_or_tearing",
    "subject_identity_collapse",
    "extreme_motion_blur_or_distortion"
  ]
}
```

Runner configuration requirements:
- `--runner-variant dynamicvram-offload-v1`
- Input manifest: Ensure `fixtures/inputs/i2v_sample_input.json` and `fixtures/inputs/ref2v_sample_input.json` are created per Section 7.3 of `docs/minimax-h3-step-reduction-experiments.md`.
- Lifecycle timeouts: Startup (120s), Submission (60s), Polling (1s), Total Render (900s / 15m), Probe (30s), Shutdown (30s).
- Execution cleanup: `pnpm experiment:minimax-h3 cleanup --run-dir <run-dir>`
- Stale lock resolution: Inspect `/tmp/cco-gpu-locks/gpu-<gpu-uuid>.lock` for recorded JSON ownership (`jq -r '.pid // empty' "$LOCK_FILE"`), verify process ownership (`ps -u "$(whoami)" -p "${LOCK_PID}"`), send graceful SIGTERM before SIGKILL, and delete lock file only after process exit.

### 0.3 Matched Pair A: FL2VA Base-20 vs FL2VA Turbo 8-Step (I2V)

```bash
# 1. Prepare
pnpm experiment:minimax-h3 prepare \
  --route i2v \
  --sampling-recipe fl2va-base-20 \
  --frames 124 --seed 42 \
  --inputs fixtures/inputs/i2v_sample_input.json \
  --prompt "A cinematic wide shot of ocean waves crashing onto dark basalt rocks at twilight" \
  --target-host localhost --gpu-uuid GPU-71bf9e8a-0d33-4f7b-bf38-038202da0100 \
  --comfyui-dir /opt/comfyui --python /opt/comfyui/venv/bin/python3 \
  --runner-variant dynamicvram-offload-v1 \
  --run-id h3-pair-a-baseline-fl2va-base-20

pnpm experiment:minimax-h3 prepare \
  --route i2v \
  --sampling-recipe fl2va-turbo-8 \
  --frames 124 --seed 42 \
  --inputs fixtures/inputs/i2v_sample_input.json \
  --prompt "A cinematic wide shot of ocean waves crashing onto dark basalt rocks at twilight" \
  --target-host localhost --gpu-uuid GPU-71bf9e8a-0d33-4f7b-bf38-038202da0100 \
  --comfyui-dir /opt/comfyui --python /opt/comfyui/venv/bin/python3 \
  --runner-variant dynamicvram-offload-v1 \
  --run-id h3-pair-a-variant-fl2va-turbo-8

# 2. Validate
pnpm experiment:minimax-h3 validate --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-baseline-fl2va-base-20
pnpm experiment:minimax-h3 validate --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-variant-fl2va-turbo-8

# 3. Run (Live GPU - #445 only)
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-baseline-fl2va-base-20 \
  --stop-policy /opt/comfyui/operator-stop-policy.json
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-variant-fl2va-turbo-8 \
  --stop-policy /opt/comfyui/operator-stop-policy.json

# 4. Reconcile
pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-baseline-fl2va-base-20
pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-variant-fl2va-turbo-8

# 5. Compare
pnpm experiment:minimax-h3 compare \
  --baseline .ai-runs/minimax-h3-experiments/h3-pair-a-baseline-fl2va-base-20 \
  --candidate .ai-runs/minimax-h3-experiments/h3-pair-a-variant-fl2va-turbo-8

# 6. Cleanup
pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-baseline-fl2va-base-20
pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-pair-a-variant-fl2va-turbo-8
```

### 0.4 Matched Pair B: Canonical Base-20 vs Ref2VA Turbo 4-Step (Ref2V)

```bash
# 1. Prepare
pnpm experiment:minimax-h3 prepare \
  --route ref2v \
  --sampling-recipe canonical-base-20 \
  --frames 124 --seed 42 \
  --inputs fixtures/inputs/ref2v_sample_input.json \
  --prompt "A character turning toward the camera in an autumn forest, leaves falling gently" \
  --target-host localhost --gpu-uuid GPU-71bf9e8a-0d33-4f7b-bf38-038202da0100 \
  --comfyui-dir /opt/comfyui --python /opt/comfyui/venv/bin/python3 \
  --runner-variant dynamicvram-offload-v1 \
  --run-id h3-pair-b-baseline-ref2va-base-20

pnpm experiment:minimax-h3 prepare \
  --route ref2v \
  --sampling-recipe ref2va-turbo-4 \
  --frames 124 --seed 42 \
  --inputs fixtures/inputs/ref2v_sample_input.json \
  --prompt "A character turning toward the camera in an autumn forest, leaves falling gently" \
  --target-host localhost --gpu-uuid GPU-71bf9e8a-0d33-4f7b-bf38-038202da0100 \
  --comfyui-dir /opt/comfyui --python /opt/comfyui/venv/bin/python3 \
  --runner-variant dynamicvram-offload-v1 \
  --run-id h3-pair-b-variant-ref2va-turbo-4

# 2. Validate
pnpm experiment:minimax-h3 validate --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-baseline-ref2va-base-20
pnpm experiment:minimax-h3 validate --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-variant-ref2va-turbo-4

# 3. Run (Live GPU - #445 only)
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-baseline-ref2va-base-20 \
  --stop-policy /opt/comfyui/operator-stop-policy.json
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-variant-ref2va-turbo-4 \
  --stop-policy /opt/comfyui/operator-stop-policy.json

# 4. Reconcile
pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-baseline-ref2va-base-20
pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-variant-ref2va-turbo-4

# 5. Compare
pnpm experiment:minimax-h3 compare \
  --baseline .ai-runs/minimax-h3-experiments/h3-pair-b-baseline-ref2va-base-20 \
  --candidate .ai-runs/minimax-h3-experiments/h3-pair-b-variant-ref2va-turbo-4

# 6. Cleanup
pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-baseline-ref2va-base-20
pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-pair-b-variant-ref2va-turbo-4
```

### 0.5 Matched Pair C: FL2VA Base-20 vs FastH3 8-Step (I2V Only)

```bash
# 1. Prepare
pnpm experiment:minimax-h3 prepare \
  --route i2v \
  --sampling-recipe fl2va-base-20 \
  --frames 124 --seed 42 \
  --inputs fixtures/inputs/i2v_sample_input.json \
  --prompt "A rapid aerial tracking shot over a sunlit mountain highway" \
  --target-host localhost --gpu-uuid GPU-71bf9e8a-0d33-4f7b-bf38-038202da0100 \
  --comfyui-dir /opt/comfyui --python /opt/comfyui/venv/bin/python3 \
  --runner-variant dynamicvram-offload-v1 \
  --run-id h3-pair-c-baseline-fl2va-base-20

pnpm experiment:minimax-h3 prepare \
  --route i2v \
  --sampling-recipe fasth3-i2v-8 \
  --frames 124 --seed 42 \
  --inputs fixtures/inputs/i2v_sample_input.json \
  --prompt "A rapid aerial tracking shot over a sunlit mountain highway" \
  --target-host localhost --gpu-uuid GPU-71bf9e8a-0d33-4f7b-bf38-038202da0100 \
  --comfyui-dir /opt/comfyui-fasth3 --python /opt/comfyui-fasth3/venv/bin/python3 \
  --runner-variant dynamicvram-offload-v1 \
  --run-id h3-pair-c-variant-fasth3-8

# 2. Validate
pnpm experiment:minimax-h3 validate --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-baseline-fl2va-base-20
pnpm experiment:minimax-h3 validate --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-variant-fasth3-8

# 3. Run (Live GPU - #445 only)
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-baseline-fl2va-base-20 \
  --stop-policy /opt/comfyui/operator-stop-policy.json
pnpm experiment:minimax-h3 run \
  --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-variant-fasth3-8 \
  --stop-policy /opt/comfyui/operator-stop-policy.json

# 4. Reconcile
pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-baseline-fl2va-base-20
pnpm experiment:minimax-h3 reconcile --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-variant-fasth3-8

# 5. Compare
pnpm experiment:minimax-h3 compare \
  --baseline .ai-runs/minimax-h3-experiments/h3-pair-c-baseline-fl2va-base-20 \
  --candidate .ai-runs/minimax-h3-experiments/h3-pair-c-variant-fasth3-8

# 6. Cleanup
pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-baseline-fl2va-base-20
pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/h3-pair-c-variant-fasth3-8
```

---

## 1. Experiment Metadata & Provenance

- **Evaluation Date:** `<YYYY-MM-DD>`
- **Operator Name / ID:** `<operator-identity>`
- **Target Host Name:** `<hostname>`
- **NVIDIA GPU Model & UUID:** `<NVIDIA RTX 4090 / GPU-UUID>`
- **Driver & CUDA Build:** `<Driver Version> / <CUDA Build>`
- **ComfyUI Core Revision:** `<pinned-candidate-sha>`
- **Route:** `[ ] i2v` | `[ ] ref2v`
- **Candidate Sampling Recipe:** `[ ] fl2va-turbo-8` | `[ ] ref2va-turbo-4` | `[ ] fasth3-i2v-8` | `[ ] fl2va-base-20`
- **Baseline Control Run ID:** `<h3-baseline-...>`
- **Candidate Variant Run ID:** `<h3-candidate-...>`
- **Admission Verdict:** `[ ] Admitted` | `[ ] Rejected`

---

## 2. Controlled Invariants Verification

All invariants must be strictly verified before comparing timing metrics:

- [ ] **Route Identical:** `i2v` or `ref2v` matches baseline
- [ ] **Frame Count Identical:** Exactly 124 frames (or candidate grid frames)
- [ ] **Geometry & Cadence Identical:** Exactly `1344x768` at 24 fps
- [ ] **Noise Seed Identical:** Same random seed (e.g. 42)
- [ ] **Conditioning Inputs Identical:** SHA-256 match on staged input assets
- [ ] **Instruction Text Identical:** ShotPlan compiled instructions byte-identical across same-route comparison
- [ ] **Declared Factor Changes:** All differences (checkpoint, LoRA, steps, sigma shift, runtime core) declared in `changedFactors`
- [ ] **Runner Policy Identical:** Same memory management policy (`dynamicvram-offload-v1`)
- [ ] **Operator Stop Policy Enforced:** Completed using operator-authored stop policy (`--stop-policy /opt/comfyui/operator-stop-policy.json`)
- [ ] **Required Runtime Environment:** Pinned core (`55b6a9b1`) for base/turbo; isolated core (`ee71d5c4`) with `comfy-kitchen==0.2.34` for FastH3

---

## 3. Route Fencing & Graph Topology Audit

- [ ] **FastH3 Route Boundary:** Confirmed FastH3 executed only on `i2v` (T2VA/FL2VA); never on `ref2v`
- [ ] **LoRA Compatibility:** Turbo LoRA paired exclusively with its audited base checkpoint build
- [ ] **No Legacy Turbo Pairing:** Ref2VA I2V baseline was NOT combined with FL2VA Turbo LoRA
- [ ] **Scheduler Steps Verified:** BasicScheduler steps match recipe specification (8 for Turbo/FastH3, 4 for Ref2V Turbo)
- [ ] **Single Reachable Sampler:** Exactly one `SamplerCustomAdvanced` node reachable in graph
- [ ] **Guider & Model Chain Integrity:** Both BasicGuider and BasicScheduler connect to the correct LoRA / VSA output

---

## 4. Telemetry & Execution Accounting

### Observed Sampling & Conditioning Audit
| Metric | Baseline Control | Candidate Variant | Requirement | Status |
| :--- | :--- | :--- | :--- | :--- |
| Completed Sampling Steps | 20 | `<observed-steps>` | Matches recipe expectation | `[PASS / FAIL]` |
| Conditioning Node Class | `<observed-class>` | `<observed-class>` | Matches route specification | `[PASS / FAIL]` |
| Observed Attention Backend | `torch_sdpa` | `<observed-backend>` | Matches runtime expectation | `[PASS / FAIL]` |
| Attention Fallback Events | 0 | `<fallback-count>` | Exactly 0 (No fallback) | `[PASS / FAIL]` |

### Phase Timings (Milliseconds)
| Phase | Baseline Control (ms) | Candidate Variant (ms) | Delta (ms) | Speedup Ratio | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Environment Startup | | | | | `[measured/unknown]` |
| Model Loading | | | | | `[measured/unknown]` |
| Conditioning | | | | | `[measured/unknown]` |
| Sampling Wall Time | | | | | `[measured/unknown]` |
| - Per-Step Mean | | | | | `[measured/unknown]` |
| VAE Video Decode | | | | | `[measured/unknown]` |
| Mux & Save | | | | | `[measured/unknown]` |
| Whole Attempt Wall Time | | | | | `[measured/unknown]` |
| GPU Kernel Duration (if profiler active) | | | | | `[measured/unknown]` |

---

## 5. Resource Envelope

| Resource | Baseline Control | Candidate Variant | Delta | Limit Threshold | Within Limits |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Peak VRAM (MiB) | | | | 24,000 MiB | `[YES / NO]` |
| Peak Host RAM (MiB) | | | | 64,000 MiB | `[YES / NO]` |
| Swap Delta (MiB) | | | | 0 MiB | `[YES / NO]` |

---

## 6. Output Conformance & Creative Quality Review

### Format & Container Conformance
- [ ] **Probed Video Geometry:** `1344x768` (ffprobe verified)
- [ ] **Probed Video Duration:** 5.167s / 124 frames (ffprobe verified)
- [ ] **Container Format:** MP4 (H.264 / AAC)

### Creative Failure Modes Rubric
| Failure Mode | Evaluation Criteria | Time / Frame Range | Severity | Operator Notes |
| :--- | :--- | :--- | :--- | :--- |
| Appearance & Wardrobe Drift | Stability of fabric texture, clothing color, garment details | | `[None / Minor / Critical]` | |
| Scene & Background Replacement | Background stability, lighting consistency, object permanence | | `[None / Minor / Critical]` | |
| Camera-Motion Deviation | Smoothness of pans, trajectory adherence, velocity stability | | `[None / Minor / Critical]` | |
| Facial & Anatomical Anomalies | Preservation of eyes, teeth, fingers, natural expressions | | `[None / Minor / Critical]` | |
| Audio Quality & Sync | Audio-visual dialogue synchronization, soundscape clarity | | `[None / Minor / Critical]` | |
| Reference Fidelity | Adherence to ordered reference images and Picture tags | | `[None / Minor / Critical]` | |

---

## 7. Operator Verdict & Sign-Off

### Disposition
- [ ] **GO (Promote Candidate to Staging)**
- [ ] **NO-GO (Reject Candidate)**
- [ ] **REQUIRES_FURTHER_INVESTIGATION**

### Operator Rationale
`<Operator detailed explanation of decision based on creative and performance criteria>`

**Operator Signature:** `___________________________`
**Date:** `<YYYY-MM-DD>`
