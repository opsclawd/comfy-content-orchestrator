# FastH3-Omni Upstream Source, Architecture & Licensing Audit

**Audit Date:** October 29, 2026  
**Issue:** #468 — [421.14] Evaluate FastH3-Omni multi-reference draft rendering on RTX 4090 (isolated)  
**Task Classification:** Phase A — Autonomous engineering/research/offline validation (fail-closed).  
**Governance Boundary:** Autonomous agents do not execute on physical GPUs, certify hardware profiles, upload campaign assets, or authorize production deployment.

---

## 1. Executive Summary & Feasibility Decision

FastH3-Omni is an officially announced and published reference-conditioned video generation architecture from the FastVideo research collective, designed to provide multi-reference image conditioning (`<Picture N>` binding) with accelerated 8-step inference.

### Upstream Status
- **Upstream Release Status:** `released` (official weights, model cards, and inference guide published on Hugging Face and GitHub).
- **Offline Specification Readiness:** `blocked_unverified_runtime`. The reference binding mapper and descriptor are deterministic and offline, but the FastVideo export artifacts, runtime dependency closure, launch command and operator limits are unaudited, so no argv or config is emitted. `offline_validated` is reachable only when every identity component is audit-sourced and the upstream recipe is captured verbatim.
- **Physical Execution Readiness:** `blocked_unverified_runtime` and `blocked_license_review` (execution on target hardware requires dedicated operator environment setup, local weight verification, SM89 memory validation, and organizational commercial license review).

### Governance and Non-Goals
1. **No production integration:** FastH3-Omni is an isolated candidate exploration under #421, strictly distinct from #443 `fasth3-i2v-8` (FastH3 V2 I2V) and from #467 TeaCache.
2. **No private data upload:** Reactor hosted API is documented for schema comparison only. No campaign reference assets, prompts, or proprietary data may be uploaded to hosted services.
3. **No baseline mutation:** Approved baseline workflows (`canonical-base-20`, `fl2va-turbo-8`, `ref2va-turbo-4`, `fasth3-i2v-8`), templates, and render profiles remain completely unmodified.

---

## 2. Upstream Release & Source Audit (Observed 2026-10-29)

Evidence status: no copy of any README, recipe or license file was captured and hashed. Only the Hugging Face LFS digest of the ComfyUI INT8 file is on record (upstream-published, not locally verified). All other claims are `unverified` in the fixture (`docs/fixtures/fasth3-omni-audit-fixture.json`) until an evidence file digest is stored.

### 2.1 Official Release Artifacts

| Component | Repository | Revision / Commit | Published Digest / File | Size | Verification Method |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FastH3-Omni BF16 Model Card** | `FastVideo/FastVideo-FastH3-Omni-8-Step-V1` | `53e0d26a1691aa473b6262d8196a8feb2c297df0` | `README.md` | — | unverified (no evidence digest) |
| **FastH3-Omni Comfy Model Card** | `FastVideo/FastH3-Omni-Comfy` | `82eff2a6eee6c962846879f4bab52610a4df24d3` | `README.md` | — | unverified (no evidence digest) |
| **INT8 Pruned Checkpoint** | `FastVideo/FastH3-Omni-Comfy` | `82eff2a6eee6c962846879f4bab52610a4df24d3` | `diffusion_models/fasth3_omniref_8step_pruned_int8_convrot.safetensors` | 22,213,723,064 bytes | `remote_metadata_lfs`<br>`SHA-256: 851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80` |
| **FastVideo Source Guide** | `hao-ai-lab/FastVideo` | `7203b4976eefcd70a52728ca1281797ce96734eb` | `docs/inference/fasth3_omniref.md` | — | unverified (no evidence digest) |
| **RTX 4090 Recipe** | `hao-ai-lab/FastVideo` | `7203b4976eefcd70a52728ca1281797ce96734eb` | `examples/inference/basic/basic_fasth3_omniref_rtx4090.yaml` | — | unverified (no evidence digest) |
| **Base Model License** | `MiniMaxAI/MiniMax-H3` | `42ed227ee7df40d41602854ae760620d6eb651fe` | `LICENSE` | — | `review_required` (no evidence digest) |

### 2.2 Rejection of Unrelated / Legacy Candidates

To eliminate ambiguity and prevent model confusion:
1. **`fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors` (FastH3 V2):** Rejected for multi-reference tasks. This checkpoint is strictly frame-anchored I2V only and lacks general reference conditioning architecture.
2. **`minimax_h3_fl2va_pruned_int8_convrot.safetensors` (FL2VA):** Rejected. Frame-anchored first/last frame only.
3. **`minimax_h3_ref2va_pruned_int8_convrot.safetensors` (Ref2VA Base):** Preserved as the 20-step baseline comparator, not an 8-step Omni model.
4. **Pre-release experimental PDD checkpoints:** Rejected. Internal development checkpoints lack official release lineage and stability guarantees.

---

## 3. Architecture Compatibility Matrix

| Feature / Criterion | Reactor Hosted API | Pinned ComfyUI Core (`55b6a9b1`) | Isolated ComfyUI Checkout | Isolated FastVideo Runner (`7203b497`) |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Route** | Multi-reference Ref2VA | I2V & Ref2V (native H3) | Experimental Comfy nodes | Multi-reference Ref2VA (`workload_type: i2v` with Ref2VA pipeline override) |
| **Runtime Dependencies** | Proprietary cloud service | Unknown (not audited) | Newer Comfy core required | Unknown (not audited); upstream pyproject torch pin and CUDA wheel choice to be resolved |
| **Quantization & Format** | Cloud internal | INT8 pruned convrot | INT8 pruned convrot | Layerwise FP8 streaming (16 blocks) |
| **Hardware Suitability** | N/A (Cloud) | NVIDIA RTX 4090 (24GB) | RTX 4090 (high VRAM pressure) | NVIDIA RTX 4090 (SM89 compatible with layer streaming) |
| **Sparse Kernels** | Cloud internal | Native SDPA / Triton | Block sparse Triton | VSA emulator (BF16); **NVFP4 blocked** (requires Blackwell hardware per the Comfy card) |
| **Memory Policy** | Cloud internal | Standard offload | Dynamic VRAM offload | Layer streaming (16 resident blocks); process restart per clip |
| **Reference Images** | 1–3 (real-time), up to 9 | Unknown (not audited) | Node-dependent | 1–9 reference images via `<Picture N>` tokens |
| **Keyframes (1st/Last)** | Distinct inputs supported | Supported in I2V node | Supported in I2V node | Denied in Phase A compiler (not documented in 4090 basic recipe) |
| **Discrete Durations / Frames** | `5.875, 8.0, 10.125, 12.25, 14.375` s | 124 frames (5.17s @ 24fps) | 124 frames | **124, 243, 362 frames** (24fps); 243f matches 10.125s |
| **Commercial License** | Reactor Terms of Service | MiniMax Community License | MiniMax Community License | MiniMax Community License + Apache-2.0 runtime |
| **Local Qualification** | **N/A (Prohibited)** | **Not compatible with Omni** | **Unverified** | **Blocked: unverified runtime (identity and launch command unaudited)** |

---

## 4. Hardware Constraints & RTX 4090 SM89 Realities

The FastVideo RTX 4090 recipe (`basic_fasth3_omniref_rtx4090.yaml`) specifies key hardware trade-offs for 24GB GPUs:
1. **Layerwise FP8 Streaming:** The full DiT weights exceed 40GB in uncompressed form. The SM89 runner streams weights with a resident block budget of `16` blocks in VRAM.
2. **Blackwell NVFP4 Incompatibility:** FastVideo documentation explicitly notes that NVFP4 text encoding and sparse attention require NVIDIA Blackwell architecture. For RTX 4090 (SM89), text encoding must use the BF16 Qwen2.5-VL tower with the VSA emulator.
3. **AdaLN Precomputation:** The upstream guide references an AdaLN table dependency; its filename, hash and generation command are not audited.
4. **Host Memory & Swap Pressure:** Upstream notes cite up to 57.7 GiB host cgroup allocation during pipeline setup. Host RAM, swap and VRAM stop limits are operator-supplied; missing limits deny execution.
5. **Process Isolation:** The inference runtime must execute as a fresh single-clip process to avoid CUDA memory fragmentation and leaks across consecutive runs.

---

## 5. Licensing & Commercial Use Audit

### Base Model: MiniMax-H3 Community License Agreement
- **Source:** `https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/42ed227ee7df40d41602854ae760620d6eb651fe/LICENSE`
- **Territorial Exclusions:** Clause 1 excludes the European Union, United Kingdom, Republic of Korea, and United States of America from certain community grants without prior written commercial authorization.
- **Revenue Threshold:** Commercial use by entities with greater than $20,000,000 USD annual revenue requires explicit commercial licensing from MiniMax.
- **Output Terms:** Generated outputs are subject to acceptable use policies and attribution requirements.
- **Status:** `review_required`. Production deployment and automated distribution are strictly blocked pending corporate legal review.

### Runtime Engine: FastVideo (Apache-2.0)
- The FastVideo inference harness is licensed under Apache-2.0. However, the runtime license does **not** override or relax the underlying model weight restrictions or output covenants of the MiniMax community agreement.

---

## 6. Discrete Duration & Frame Rate Alignment

Reactor's hosted API documents specific discrete durations:
$$\{5.875, 8.0, 10.125, 12.25, 14.375\} \text{ seconds at } 24\text{ fps}$$

FastVideo local inference operates on discrete frame counts:
$$\{124, 243, 362\} \text{ frames at } 24\text{ fps}$$

Notice the mathematical correspondence:
- $124 \text{ frames} / 24\text{ fps} \approx 5.1667 \text{ seconds}$ (standard baseline H3 length; not in Reactor's list)
- $243 \text{ frames} / 24\text{ fps} = 10.125 \text{ seconds}$ (**exact match** with Reactor's $10.125$s option)
- $362 \text{ frames} / 24\text{ fps} \approx 15.0833 \text{ seconds}$ (long shot option)

**Fencing Rule:** The local compiler accepts only discrete frames `124`, `243`, and `362`. Off-grid frame counts (e.g. `192`) and floating-point duration strings are rejected. Matched comparison against baseline models must use identical integer frame counts.

---

## 7. Audit Conclusion & Phase A Deliverables

1. Upstream revisions are recorded in `docs/fixtures/fasth3-omni-audit-fixture.json` and contracts; only the Comfy INT8 LFS digest is a digest, and unaudited items are explicit `unverified` claims.
2. Offline manifest mapping and compiler enforce immutable `<Picture N>` slot bindings, input order preservation, and SM89 hardware fences. Preparation yields a blocked specification listing missing prerequisites.
3. Execution remains blocked (`blocked_unverified_runtime` / `blocked_license_review`) until an operator executes Phase B on physical hardware with verified weights and legal sign-off.
