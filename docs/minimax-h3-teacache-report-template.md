# MiniMax-H3 TeaCache Timestep-Caching Candidate Evaluation Report Template

> **OPERATOR INSTRUCTIONS:**
> This template is a **blank** evaluation form and runbook for live physical execution on dedicated NVIDIA RTX 4090 GPU render hosts (Issue #445).
> Per `AGENTS.md` and repository governance rules, automated agents must **never** author synthetic hardware measurements or pre-populate GO/NO-GO verdicts.
> Complete each section only after executing both the baseline control and candidate TeaCache variant under identical physical conditions.
> See the specification document [MiniMax-H3 TeaCache Timestep-Caching Experiments Specification](minimax-h3-teacache-experiments.md) for full catalog definitions, parameter bounds, and topological rules.
> All CLI commands below are runnable and self-contained. Fill in the observed results, resource metrics, creative rubric assessments, and final disposition upon physical execution.

---

## 1. Experiment Metadata & Provenance

- **Evaluation Date:** `<YYYY-MM-DD>`
- **Operator Name / ID:** `<operator-identity>`
- **Target Host Name:** `<hostname>`
- **NVIDIA GPU Model & UUID:** `<NVIDIA RTX 4090 / GPU-UUID>`
- **Driver & CUDA Build:** `<Driver Version> / <CUDA Build>`
- **ComfyUI Core Revision:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **TeaCache Node Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
- **Route:** `[ ] i2v` | `[ ] ref2v`
- **Frame Count:** `[ ] 124f (5.17s)` | `[ ] 243f (10.13s)` | `[ ] 362f (15.08s)`
- **Random Seed:** `<e.g. 42>`
- **Candidate TeaCache Variant:** `[ ] raw-l1-v1`
- **Candidate Parameters:**
  - `rel_l1_thresh`: `<e.g. 0.05, 0.10, 0.15>`
  - `start_step`: `<e.g. 2>`
  - `end_step`: `<e.g. -2>`
  - `total_steps`: `20`
- **Baseline Control Run ID:** `<h3-tc-baseline-...>`
- **Candidate Variant Run ID:** `<h3-tc-candidate-...>`
- **Topology Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
- **Configuration Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
- **Runtime Lock Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
- **Admission Verdict:** `[ ] Admitted` | `[ ] Rejected`

---

## 2. Controlled Invariants Verification

All invariants must be strictly verified before comparing timing metrics:

- [ ] **Route Identical:** `i2v` or `ref2v` matches baseline
- [ ] **Frame Count Identical:** Exactly 124 frames (or staged 243f/362f)
- [ ] **Geometry & Cadence Identical:** Exactly `1344x768` at 24 fps
- [ ] **Noise Seed Identical:** Same random seed across pair
- [ ] **Scheduler Steps Identical:** Exactly 20 steps (`res_multistep` or `simple`)
- [ ] **Conditioning Inputs Identical:** SHA-256 match on staged input assets
- [ ] **Single Factor Change:** `caching.configuration` is the sole variable changed
- [ ] **Dense Attention Preserved:** PyTorch SDPA dense attention used across both runs (no Sage/Veda/Native Sol-Attn)
- [ ] **Standard Checkpoint Preserved:** Canonical INT8 ConvRot model used (no Turbo/Lightning/FastH3 distillation)
- [ ] **Runtime Substrate Verified:** Baseline and candidate executed on identical virtual environment and package versions
- [ ] **Runner Policy Identical:** Same memory management policy (`dynamicvram-offload-v1`)
- [ ] **Operator Stop Policy Enforced:** Executed with identical operator-authored stop policy (`--stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json`)

---

## 3. TeaCache Topology & Node Configuration Audit

- [ ] **Node 401 Present:** Candidate graph contains node 401 with class `CCOMiniMaxH3TeaCache`
- [ ] **Model Interception:** Node 401 input `model` wired to `["6", 0]`
- [ ] **Guider Rewiring:** Node 16 (`BasicGuider`) input `model` wired to `["401", 0]`
- [ ] **Scheduler Rewiring:** Node 9 (`BasicScheduler`) input `model` wired to `["401", 0]`
- [ ] **Control Node 401 Absent:** Baseline control graph contains no node 401; nodes 16 and 9 wire to `["6", 0]`
- [ ] **Conditioning Intact:** Nodes 104/105 conditioning connections completely unmodified
- [ ] **No Competing Wrappers:** Confirmed no competing model wrappers or LoRA loaders stacked onto model path

---

## 4. Telemetry & Execution Accounting

### Timestep Caching Accounting
| Metric | Baseline Control (`off`) | Candidate Variant (`raw-l1-v1`) | Requirement | Status |
| :--- | :--- | :--- | :--- | :--- |
| Model Forward Passes | 20 | `<forward-calls>` | Recorded | `[PASS / FAIL]` |
| Timestep Cache Hits | 0 | `<cache-hits>` | $\ge 1$ (No `no_op`) | `[PASS / FAIL]` |
| Cache Hit Rate (%) | 0.0% | `<hit-rate>%` | Recorded | `[PASS / FAIL]` |
| Nested Forwards on Cache Hit | 0 | 0 | Exactly 0 (No leak) | `[PASS / FAIL]` |
| Effective Sampling Steps | 20 | 20 | Matches scheduler | `[PASS / FAIL]` |
| No-Op Classification | N/A | `[ ] Verified` | `status != "no_op"` | `[PASS / FAIL]` |

### Phase Timings (Milliseconds)
| Phase | Baseline Control (ms) | Candidate Variant (ms) | Delta (ms) | Ratio (Variant/Base) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Environment Startup | | | | | `[measured/unknown]` |
| Model Loading | | | | | `[measured/unknown]` |
| Conditioning | | | | | `[measured/unknown]` |
| Sampling Wall Time | | | | | `[measured/unknown]` |
| - Per-Step Mean | | | | | `[measured/unknown]` |
| VAE Video Decode | | | | | `[measured/unknown]` |
| Mux & Save | | | | | `[measured/unknown]` |
| Whole Attempt Wall Time | | | | | `[measured/unknown]` |

---

## 5. Resource Envelope (RTX 4090 24GB VRAM)

| Resource | Baseline Control | Candidate Variant | Delta | Safety Threshold | Within Limits |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Peak VRAM (MiB) | | | | $\le 23,500\text{ MiB}$ | `[YES / NO]` |
| Peak Host RAM (MiB) | | | | $\le 60,000\text{ MiB}$ | `[YES / NO]` |
| Swap Activity Delta (MiB) | | | | $0\text{ MiB}$ | `[YES / NO]` |

---

## 6. Output Conformance & Probed Media Facts

- [ ] **Probed Video Geometry:** `1344x768` (ffprobe verified)
- [ ] **Probed Video Duration:** 5.167s / 124 frames (ffprobe verified)
- [ ] **Container Format:** MP4 (H.264 / AAC)
- [ ] **Video Stream Codec:** `h264` (yuv420p)
- [ ] **Audio Stream Codec:** `aac` (stereo, 44100 Hz or 48000 Hz)
- [ ] **Audio / Video Synchronization:** Audio stream remains synchronized with video motion without lip-sync drift or temporal offset
- [ ] **Audio Playback Continuity:** Audio plays smoothly with zero pops, clicks, or dropouts across cache-skipped step intervals
- [ ] **No Corrupted / Black Frames:** Output video verified complete from frame 0 to end

---

## 7. Qualitative Visual Quality Review

*Score each category: `1 (Severe Regression)` to `5 (Indistinguishable from Baseline Control)`.*

| Evaluation Dimension | Score (1-5) | Specific Visual Observations | Status |
| :--- | :---: | :--- | :--- |
| **Subject Identity & Face** | | | `[Pass / Fail]` |
| **Wardrobe & Fine Textures** | | | `[Pass / Fail]` |
| **Scene Background Stability** | | | `[Pass / Fail]` |
| **Motion Smoothness & Trajectory** | | | `[Pass / Fail]` |
| **Temporal Flicker & Shimmer** | | | `[Pass / Fail]` |
| **Reference Adherence (Ref2V)** | | | `[Pass / Fail / N/A]` |
| **Audio & Sync Fidelity** | | | `[Pass / Fail]` |

---

## 8. Anomaly & Incident Log

| Step / Timestamp | Event / Observation | Impact on Run | Action Taken |
| :--- | :--- | :--- | :--- |
| | | | |

---

## 9. Operator Sign-Off & Disposition

### Recommendation Summary
- **Overall Execution Result:** `[ ] SUCCESS` | `[ ] REJECTED` | `[ ] ABORTED`
- **Observed Sampling Wall-Time Speedup:** `<ratio or N/A>`
- **Observed Cache Hit Rate:** `<hit-rate or N/A>`
- **Visual Acceptability:** `[ ] ACCEPTABLE` | `[ ] UNACCEPTABLE DEFECTS`
- **Audio & Playback Integrity:** `[ ] ACCEPTABLE` | `[ ] UNACCEPTABLE DEFECTS`

### Disposition Decision
- [ ] **RECOMMEND PROMOTION REVIEW (#445):** Candidate threshold demonstrates reproducible sampling acceleration ($\ge 15\%$), zero stability failures, and commercially acceptable visual quality across all test seeds.
- [ ] **REQUIRE RE-TUNING:** Threshold too aggressive (artifacts) or too conservative (insufficient speedup). Further parameter sweep needed.
- [ ] **REJECT CANDIDATE:** Fundamental visual regressions, motion shudder, or unresolvable offload overhead negate benefits. Candidate remains disabled in catalog.

### Mandatory Sign-Off Gates
- [ ] **Licensing & Release Sign-off:** Verified upstream MIT License compliance (`experiments/minimax-h3-teacache/LICENSE`, copyright attribution to Icyoung, and non-encumbered open-source distribution). Approved for release gate review.
- [ ] **Evidence Retention Sign-off:** All raw run directories (`.ai-runs/`), telemetry streams (`events.jsonl`), runtime manifests, reconstructed configs, and probed artifacts are securely retained and committed to durable evidence storage.

**Operator Signature:** `___________________________`  
**Date:** `YYYY-MM-DD`
