# MiniMax-H3 TeaCache Source Audit & Adaptation Specification

## 1. Upstream Audit & Cryptographic Pin

This document records the architectural and security audit of the upstream MiniMax-H3 TeaCache candidate implementation, evaluated for isolated timestep-caching experiments under Issue #467.

### Pinned Upstream Identity
- **Repository:** `https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache`
- **Candidate Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
- **License:** MIT License (`Copyright (c) 2026 Icyoung`)
- **Pyproject Version:** `0.1.0` (Python requirement `>=3.10`, dependencies: none beyond host PyTorch)

### Audited Source File Hashes

| File | SHA-256 Digest | Audit Status |
| :--- | :--- | :--- |
| `nodes.py` | `dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287` | Audited |
| `teacache.py` | `97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f` | Audited |
| `LICENSE` | `ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67` | Verified MIT |
| `pyproject.toml` | `e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be` | Audited |
| `__init__.py` | `8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416` | Audited |

Security inspection confirms that the audited candidate files contain ordinary Python dataclass, tensor manipulation, and ComfyUI node registration code. No arbitrary network downloads, child process spawning, shell execution, or binary extensions are present.

---

## 2. Pinned ComfyUI Core Compatibility & Output Semantics

The target environment runs ComfyUI core pinned at commit `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc` (ComfyUI v0.33.0).

### Core Dispatch Compatibility
- `ModelPatcher.set_model_unet_function_wrapper`: Supported on pinned core. It registers `model_options["model_function_wrapper"]`.
- When sampling executes (e.g. within `comfy.samplers` or `comfy_extras.nodes_custom_sampler.SamplerCustomAdvanced`), the wrapper intercepts model evaluation as:
  ```python
  model_function_wrapper(apply_model, {"input": x, "timestep": timestep, "c": c, "cond_or_uncond": cond_or_uncond})
  ```
- **H3 Model Semantics:** In MiniMax-H3, `BaseModel._apply_model` calls `diffusion_model` on packed AV tensors, concatenates stream outputs, and computes denoised predictions via `model_sampling.calculate_denoised`.
- **Denoised Output Reuse Approximation:** The upstream node caches and returns the previous output of `apply_model`. On the pinned core, this returns the denoised prediction, not an intermediate transformer residual or velocity. Reusing this tensor is an intentional approximation that risks cumulative motion, identity, and audio degradation.

### Generation Route Compatibility
- **I2V (`MiniMaxH3ImageToVideo`):** Supported. Node returns conditioning in slot 0 and packed latent in slot 1.
- **Ref2V (`MiniMaxH3ReferenceToVideo`):** Supported. Ordered reference images are embedded into conditioning and injected inside diffusion evaluations.
- **Fail-Closed Policy:** Any route using unknown conditioning schemas, variable sigma shifts, or altered precision must fail closed.

---

## 3. Upstream Analysis & Required Architectural Adaptations

Static audit identified six critical issues in upstream `4cbb50d6` that prevent unadapted production deployment:

1. **Unmanaged Long-Lived State:** Upstream instantiates a cache state dataclass during node `apply()` and closes over it in the wrapper. Because ComfyUI's execution cache can reuse outputs across multiple prompt submissions, this state is not reset on subsequent runs, prompt retries, or seed changes.
2. **Unbounded Step Counter:** Upstream increments `step_idx` on every wrapper invocation without verifying the actual sigma sequence, scheduler step count, or multi-branch evaluation. If guider evaluates multiple branches or if steps are interrupted, step indexing desynchronizes.
3. **Tensor Aliasing via Detach without Clone:** Upstream caches `input.detach()` and `output.detach()`. If downstream nodes or samplers mutate tensors in place, cached state is corrupted.
4. **Denoised Prediction Reuse:** Upstream returns the previous full denoised model output. While this avoids transformer compute, packed video and audio latents can experience drift. This must be recorded as an experimental approximation (`raw-l1-v1`), not exact mathematical equivalence.
5. **Raw Relative-L1 Accumulation:** Upstream calculates `rel_l1 = (curr - prev).abs().mean() / prev.abs().mean()`. Without polynomial calibration, large video latent deltas can obscure audio latent differences.
6. **Self-Reported Counters:** Upstream counts wrapper calls internally. The test harness requires independent interception of `diffusion_model` forwards to verify that compute was truly skipped.

---

## 4. Repository-Owned Adapted Node: `CCOMiniMaxH3TeaCache`

To resolve these findings while preserving the candidate's core algorithm, the repository provides an isolated adapted node (`CCOMiniMaxH3TeaCacheNode`):

- **Node Key:** `CCOMiniMaxH3TeaCache`
- **Adapter Version:** `0.1.0-cco-experimental`

### Local In-Tree Adapter File Hashes
| File | SHA-256 Digest | Role |
| :--- | :--- | :--- |
| `__init__.py` | `3b14b0a4da6f0fa366d8da492ea85ce74f2a63f18336ac63970d9d2bfe128c94` | Node mapping registration & export |
| `nodes.py` | `ea16ae7ced6ab1ddfe7ba729a0a0c7047827f1e5601c6fd5c8363b837dd17d2c` | ComfyUI custom node definition & input validation |
| `teacache.py` | `8cd8128f98eab25980364788dc3276112de3e241479fba0adf8b0e1717a72fbf` | Session management, sigma validation, UUID-stable fingerprinting, tensor caching |

These three digests are the single source of truth
(`packages/contracts/src/minimax-h3-teacache.ts`'s `TEACACHE_LOCAL_ADAPTER_FILE_HASHES`);
this table is a copy for operator reference and must be kept in sync with it
whenever `experiments/minimax-h3-teacache/{__init__,nodes,teacache}.py` changes.

- **Execution-Local Session Lifecycle:** Each `SamplerCustomAdvanced` invocation creates an isolated `TeaCacheSession` bound via context variables (`contextvars`). The session is strictly cleaned up in a `finally` block on completion or error.
- **Tensor Isolation:** Cached inputs and outputs are explicitly cloned (`.detach().clone()`).
- **Sigma Schedule Validation:** The session validates a canonical 20-step schedule (21 strictly descending finite sigmas) at initialization and maps logical steps directly.
- **Independent Instrumentation:** The collector hooks `BaseModel._apply_model` / `diffusion_model` to verify that cache hits perform zero transformer evaluations.
- **Parameter Bounds:**
  - `rel_l1_thresh`: Conservative candidate grid `{0.05, 0.10, 0.15}`.
  - Step window: Half-open interval `[start_step, end_step)`. Enforces at least the first 2 and last 2 steps remain unskipped: `2 <= start_step < effective_end <= 18`.

---

## 5. Security, Licensing, & Governance Boundary

- The adapted code retains upstream MIT copyright notices.
- Caching is disabled by default in all production ShotPlan routes and worker execution.
- No hardware speedup claims or aesthetic approvals are asserted by offline CI. Live measurements and visual reviews are governed strictly by Issue #445.
