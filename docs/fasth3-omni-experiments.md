# FastH3-Omni Multi-Reference Draft Rendering Specification & Operator Runbook

**Issue:** #468 — [421.14] Evaluate FastH3-Omni multi-reference draft rendering on RTX 4090 (isolated)  
**Parent:** #421 — Production-viable longer MiniMax-H3 shots  
**Target Hardware:** Dedicated Single NVIDIA GeForce RTX 4090 (24GB VRAM, SM89)  
**Classification:** Phase A (Offline preparation) completed; Phase B (Operator execution & visual acceptance) runbook.

---

## 1. Executive Summary & Boundaries

FastH3-Omni is an 8-step reference-conditioned video generation candidate designed to render drafts conditioned on multiple immutable campaign references (cast, wardrobe, products, and locations) via `<Picture N>` prompt tokens.

### Governance Boundary
- **Autonomous Scope (Phase A):** Upstream audit, fail-closed contracts, reference manifest mapper, FastVideo SM89 prepared-or-blocked specification compiler, isolated CLI (`pnpm experiment:fasth3-omni`), and operator runbook.
- **Operator Scope (Phase B):** Physical execution on dedicated RTX 4090 hardware, model weights downloading, environment setup, full-video visual inspection, and signed GO/NO-GO determination.
- **Production Isolation:** FastH3-Omni is strictly isolated from production render worker dispatch, production profiles, and baseline ComfyUI workflows. It does not replace `fasth3-i2v-8` (I2V only) or `ref2va-turbo-4` (Ref2V comparator).

---

## 2. Upstream Checkpoints & Cryptographic Provenance

All model weights and runtime dependencies must be downloaded to isolated storage locations and verified against cryptographic hashes before execution.

| Component | Target Path | Pinned Source / Revision | Published LFS SHA-256 | Size |
| :--- | :--- | :--- | :--- | :--- |
| **ComfyUI-lane INT8 DiT (NOT the FastVideo export)** | `diffusion_models/fasth3_omniref_8step_pruned_int8_convrot.safetensors` | `FastVideo/FastH3-Omni-Comfy` @ `82eff2a6` | `851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80` (upstream-published, not locally verified) | 22,213,723,064 bytes |
| **FastVideo export shards, index, encoder, tokenizer, VAEs, AdaLN table** | — | *Not audited* | *Unknown* | *Unknown* |

> [!CAUTION]
> **NVFP4 Precision Incompatibility:** NVFP4 text encoding requires NVIDIA Blackwell hardware per the Comfy card. On RTX 4090 (SM89), attempting to load NVFP4 text encoders will trigger CUDA illegal instruction traps. Always use the BF16 text encoder path with the VSA emulator.

---

## 3. Hardware Preflight & Environment Setup

Run this preflight sequence on the dedicated RTX 4090 render host prior to benchmarking:

### 3.1 Host Memory & VRAM Verification
```bash
# 1. Verify NVIDIA driver & RTX 4090 SM89 compute capability
nvidia-smi --query-gpu=name,compute_cap,memory.total,memory.free --format=csv

# 2. Record host RAM, cgroup limit and swap
free -h
swapon --show
```

Numeric stop limits are **operator-supplied inputs**, not defaults of this runbook. Before any run the operator records approved values for startup, render, probe and shutdown timeouts (ms), peak VRAM (MB), peak host RAM (MB) and peak swap (MB). The upstream guide's cited host cgroup peak (57.7 GiB) is an upstream observation only, not a validated threshold for this runtime. A prepared specification with any limit unset stays blocked (`blocked_unverified_runtime`) and execution is denied.

### 3.2 Isolated Runtime Setup (NON-EXECUTABLE until audited)
Do **not** install FastVideo or newer PyTorch wheels into the repository's pinned ComfyUI environment (`55b6a9b1`). Use a dedicated checkout and virtualenv at FastVideo commit `7203b4976eefcd70a52728ca1281797ce96734eb`.

The Python version, PyTorch/CUDA build, driver minimum, attention-kernel configuration and dependency lock for the SM89 lane are **unknown** (audit claim `runtime-dependency-closure`, `unverified`). The operator must resolve them from the FastVideo source at that commit and record a dependency lock fingerprint before the specification can leave `blocked_unverified_runtime`. No install command is provided here because inventing one would be unaudited.

### 3.3 Model Weights Provisioning (NON-EXECUTABLE until audited)
The FastVideo FP8/dense export (transformer shards, shard index, runtime config, BF16 text/vision encoder, tokenizer/processor, VAEs, AdaLN table and its generation command) is **not yet enumerated** in the audit (claim `fastvideo-export-artifacts`, `unverified`). The operator must list every file with size and SHA-256 and fill the model identity before preparation can succeed.

The only upstream hash currently on record is the Hugging Face LFS SHA-256 of the **ComfyUI** INT8 checkpoint (`851b2dc9...`, 22,213,723,064 bytes, `FastVideo/FastH3-Omni-Comfy` @ `82eff2a6`). That file belongs to the ComfyUI lane; it is **not** the FastVideo export and must not be used for a FastVideo run.

---

## 4. Phase A Preparation & Validation (CLI Commands)

Before launching physical inference, use the Phase A CLI to generate the isolated run directory, stage campaign references and produce a prepared-or-blocked specification. With the current audit this yields a **blocked** specification (no `config.yaml`, no `command.json`) listing the missing prerequisites:

```bash
# 1. Prepare isolated run
pnpm experiment:fasth3-omni prepare \
  --run-id "omni-4090-test-01" \
  --manifest "tests/fixtures/campaign-reference-manifest.json" \
  --prompt "A wide shot of <Picture 1> wearing <Picture 2> presenting <Picture 3> in an illuminated studio" \
  --frames 124 \
  --seed 42 \
  --width 832 \
  --height 480 \
  --output-root ".ai-runs/fasth3-omni-experiments"

# 2. Perform offline structural and cryptographic validation
pnpm experiment:fasth3-omni validate \
  --run-dir ".ai-runs/fasth3-omni-experiments/omni-4090-test-01" \
  --output-root ".ai-runs/fasth3-omni-experiments"
```

---

## 5. Phase B Live Execution Protocol (Operator Only)

### 5.1 Single-Process Execution Rule
FastVideo layer streaming on 24GB GPUs accumulates residual memory across iterations. Execute **one fresh OS process per clip**:

```bash
The launch command is **not provided**: the upstream launch command and recipe schema have not been captured (claim `fastvideo-launch-command`, `unverified`). Once captured, the prepared specification carries the verbatim upstream recipe, its source SHA-256 and the recorded derivation; the operator runs exactly the `argv`/`environment` in `command.json`, with the operator-approved limits enforced and telemetry recorded.

### 5.2 Stream & Metric Extraction
```bash
# Probe output streams and duration
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,nb_frames,r_frame_rate,codec_name -of json "${RUN_DIR}/output.mp4"
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels,sample_rate -of json "${RUN_DIR}/output.mp4"

# Hash full output video
sha256sum "${RUN_DIR}/output.mp4" | awk '{print $1}' > "${RUN_DIR}/output.mp4.sha256"
```

---

## 6. Head-to-Head Comparison Methodology

Benchmark FastH3-Omni drafts against matched reference conditioning runs using existing comparators:
1. **Comparator 1: `ref2va-turbo-4` (Ref2V 4-step LoRA):**
   - Our fastest observed Ref2V route on RTX 4090 (#445).
   - Compare at matched 243 frames (10.125s), same reference images, prompt, and seed.
2. **Comparator 2: `canonical-base-20` (Ref2VA Base 20-step):**
   - The production-quality ground truth baseline.
   - Provides the visual quality ceiling and baseline latency measure.

### Evaluation Metrics
- **Sampling Wall Time (s):** Time spent exclusively in DiT forward passes (excluding text encode and VAE decode).
- **Total Clip Latency (s):** End-to-end execution wall time.
- **Peak VRAM (MB):** Maximum allocated device memory.
- **Peak Host RAM & Swap:** Memory expansion during pipeline initialization.
- **Cost per Accepted Clip:** Accounting for draft generation speed multiplied by visual acceptance rate.
- **Visual Rubric (1-5 Scale):**
  - Reference identity fidelity (face, hands, wardrobe, product, location)
  - Temporal coherence and freedom from flickering/morphing
  - Camera motion smoothness
  - Audio synchronization adherence
