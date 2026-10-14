# MiniMax-H3 Attention Optimization Evaluation Report Template

> **OPERATOR INSTRUCTIONS:**
> This template is a **blank** evaluation form for live physical execution on dedicated GPU render hosts (Issue #445).
> Per `AGENTS.md`, automated agents must **never** author synthetic hardware measurements or pre-populate GO/NO-GO verdicts.
> Complete each section only after executing both the dense control baseline and candidate variant under identical physical conditions.

---

## 1. Experiment Metadata & Provenance

- **Evaluation Date:** `<YYYY-MM-DD>`
- **Operator Name / ID:** `<operator-identity>`
- **Target Host Name:** `<hostname>`
- **NVIDIA GPU Model & UUID:** `<NVIDIA RTX 4090 / GPU-UUID>`
- **Driver & CUDA Build:** `<Driver Version> / <CUDA Build>`
- **ComfyUI Core Revision:** `<pinned-candidate-sha>`
- **Route:** `[ ] i2v` | `[ ] ref2v`
- **Candidate Attention Variant:** `[ ] sage` | `[ ] native-sol-attn` | `[ ] veda`
- **Baseline Control Run ID:** `<h3-attn-dense-...>`
- **Candidate Variant Run ID:** `<h3-attn-candidate-...>`
- **Admission Verdict:** `[ ] Admitted` | `[ ] Rejected`

---

## 2. Controlled Invariants Verification

All invariants must be strictly verified before comparing timing metrics:

- [ ] **Route Identical:** `i2v` or `ref2v` matches baseline
- [ ] **Frame Count Identical:** Exactly 124 frames (or candidate grid frames)
- [ ] **Geometry & Cadence Identical:** Exactly `1344x768` at 24 fps
- [ ] **Noise Seed Identical:** Same random seed (e.g. 42)
- [ ] **Scheduler Steps Identical:** Exactly 20 steps (res_multistep / simple)
- [ ] **Conditioning Inputs Identical:** SHA-256 match on staged input assets
- [ ] **Single Factor Change:** Attention configuration is the sole variable changed
- [ ] **Runner Variant Identical:** Same memory management policy (e.g. `dynamicvram-offload-v1`)

---

## 3. Attention Topology & Compatibility Audit

- [ ] **Topology Digest Match:** Computed graph digest matches descriptor `attentionRequest.topologyDigest`
- [ ] **Patch Node Count:** Exactly 0 (dense/sage) or exactly 1 (sol-attn/veda)
- [ ] **No Stacking:** Confirmed no simultaneous stacking of `ModelSparseAttention` and `ApplyVedaSparseAttention`
- [ ] **No Sage + Sparse Combination:** `--use-sage-attention` NOT combined with sparse patch nodes
- [ ] **Wiring Integrity:** BasicGuider model input connects correctly; BasicScheduler model input intact
- [ ] **Compatibility State:** `[ ] supported` | `[ ] requires_isolated_upgrade` | `[ ] unverified` | `[ ] unsupported`

---

## 4. Telemetry & Execution Accounting

### Attention Call Invariant Audit
| Metric | Baseline (Dense Control) | Candidate Variant | Requirement | Status |
| :--- | :--- | :--- | :--- | :--- |
| Effective Attention Backend | `torch_sdpa` | `<observed-backend>` | Matches requested | `[PASS / FAIL]` |
| Accelerated Attention Calls | 0 | `<accelerated-calls>` | > 0 (No undetected no-op) | `[PASS / FAIL]` |
| Dense Attention Calls | `<dense-calls>` | `<dense-calls>` | Recorded | `[PASS / FAIL]` |
| Attention Fallback Events | 0 | `<fallback-count>` | Exactly 0 (No fallback) | `[PASS / FAIL]` |
| Missing Kernel Errors | None | `<kernel-error>` | None | `[PASS / FAIL]` |

### Phase Timings (Milliseconds)
| Phase | Baseline Control (ms) | Candidate Variant (ms) | Delta (ms) | Delta (%) | Status |
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

## 6. Output Conformance & Visual Quality Review

- [ ] **Probed Video Geometry:** `1344x768` (ffprobe verified)
- [ ] **Probed Video Duration:** 5.167s / 124 frames (ffprobe verified)
- [ ] **Container Format:** MP4 (H.264 / AAC)
- **Continuity & Temporal Consistency:** `[ ] Pass` | `[ ] Minor Degradation` | `[ ] Critical Defect`
- **Identity & Conditioning Preservation:** `[ ] Pass` | `[ ] Minor Drift` | `[ ] Critical Defect`
- **Visual Artifacts / Quantization Noise:** `[ ] None` | `[ ] Acceptable` | `[ ] Regression`

---

## 7. Operator Verdict & Sign-Off

- [ ] **GO** — Variant demonstrates measurable speedup, zero fallback, within memory envelope, and visually lossless quality compared to dense control.
- [ ] **NO-GO** — Variant demonstrates visual regression, memory violation, undetected no-op, fallback, or negative speedup.
- [ ] **INCONCLUSIVE** — Telemetry gap, hardware contention, or requires further parameter tuning.

**Operator Sign-Off Signature:** __________________________________  
**Date:** ________________________  
**Detailed Findings & Rationales:**  
```
<Operator to record specific qualitative notes, kernel logs, and review rationale here>
```
