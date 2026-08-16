# Gold Master Workflow Templates & Provenance

This directory contains the version-controlled, source-gated Gold Master ComfyUI API workflow templates and certification provenance manifest used by the Content Orchestrator.

## Certification status

> [!IMPORTANT]
> Both workflows (`flux-schnell-draft` and `ltx-25-720p-97f`) are **host-validated** against the running Trinidad render host at ComfyUI revision `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`.
>
> Pinned canonical SHA-256 workflow hashes, model categories, relative paths, and baseline assertion constraints are defined in [`templates/provenance.json`](provenance.json) and enforced during provenance collection and certification harness preflight checks.

## Workflows and Sources

### 1. `flux-schnell-draft` (`templates/flux_schnell_draft_api.json`)
- **Source Kind:** Host-validated export (`validated_host_export`).
- **Source URI:** `https://github.com/comfyanonymous/ComfyUI`
- **Revision:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Redistribution Basis & License:** GPL-3.0.
- **Workflow Format:** Exact ComfyUI API object map targeting the 4-step Schnell sampler path (1024x1024).
- **Canonical SHA-256:** `af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5`
- **Runner Profile:** `dynamicvram-offload-v1`.
- **Referenced Models:**
  - `models/diffusion_models/flux1-schnell.safetensors`
  - `models/clip/t5xxl_fp8_e4m3fn.safetensors`
  - `models/clip/clip_l.safetensors`
  - `models/vae/ae.safetensors`

### 2. `ltx-25-720p-97f` (`templates/ltx_25_720p_97f_api.json`)
- **Source Kind:** Host-validated export (`validated_host_export`).
- **Source URI:** `https://github.com/comfyanonymous/ComfyUI`
- **Revision:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Redistribution Basis & License:** GPL-3.0.
- **Workflow Format:** Exact ComfyUI API object map targeting 1280x720 resolution, 97 frames (~5 seconds at 24 fps), and 8 DiT sampling steps.
- **Canonical SHA-256:** `94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539`
- **Runner Profile:** `dynamicvram-offload-v1` (requiring DynamicVRAM / workflow-managed model offloading).
- **Disk Space Requirement:** Minimum 100 GB free disk space reservation (`minFreeDiskGb: 100`).
- **Render Profile Identity:** `LTX_25_720P_5S_V1` (v1).
- **Referenced Models:**
  - `models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`
  - `models/clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`
  - `models/vae/ltx-2.5-video-vae-conv-bf16.safetensors`

---

## Canonical JSON Hashing and Immutability

Workflow integrity is verified using canonical JSON serialization before computing SHA-256 hashes (`hashWorkflow` in `hasher.ts`).
Canonicalization performs deterministic, recursive sorting of all object keys while preserving JSON array ordering and value semantics.
Consequently:
- Whitespace, indentation, line endings, and JSON object key ordering differences do not alter the canonical SHA-256 hash.
- Changes to node connections, array parameters, node IDs, class types, or input values produce different SHA-256 digests and are rejected.

---

## Model Paths in ComfyUI

The models listed in `templates/provenance.json` correspond to the following relative paths within the ComfyUI installation directory (`$COMFYUI_DIR`):

| Profile | Category | Relative Path | Full ComfyUI Path |
|---|---|---|---|
| `flux-schnell-draft` | `diffusion_models` | `flux1-schnell.safetensors` | `models/diffusion_models/flux1-schnell.safetensors` |
| `flux-schnell-draft` | `clip` | `t5xxl_fp8_e4m3fn.safetensors` | `models/clip/t5xxl_fp8_e4m3fn.safetensors` |
| `flux-schnell-draft` | `clip` | `clip_l.safetensors` | `models/clip/clip_l.safetensors` |
| `flux-schnell-draft` | `vae` | `ae.safetensors` | `models/vae/ae.safetensors` |
| `ltx-25-720p-97f` | `diffusion_models` | `ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` | `models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors` |
| `ltx-25-720p-97f` | `clip` | `gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` | `models/clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors` |
| `ltx-25-720p-97f` | `vae` | `ltx-2.5-video-vae-conv-bf16.safetensors` | `models/vae/ltx-2.5-video-vae-conv-bf16.safetensors` |

---

## Empirical Performance Certification Scope

The empirical performance values for LTX-2.5 (measured on the RTX 4090 workstation: 46,874 ms end-to-end execution, 23,618 MB peak VRAM, ~12s DiT sampling) are verified in `certification/ltx-25/ltx-cert-run-002/`.
This tooling and manifest pin and certify the **inputs and execution environment** (workflow structure, model hashes, ComfyUI/custom-node Git commits, and disk reservation) rather than modifying empirical benchmark metrics.

---

## Running Certification Profiles

To collect provenance and generate machine-readable certification reports, execute the `@cco/infrastructure` provenance CLI.
Progress logs and non-fatal diagnostic information are written to `stderr`, while the single-line canonical JSON report is emitted to `stdout`.

Redirect `stdout` to save the certification artifact while preserving `stderr` logs on the console:

```bash
# FLUX Schnell Draft Profile
pnpm --filter @cco/infrastructure provenance -- --comfyui-dir "$COMFYUI_DIR" --profile flux-schnell-draft --manifest ../../templates/provenance.json > flux-provenance.json

# LTX-2.5 720p 97-Frame Profile
pnpm --filter @cco/infrastructure provenance -- --comfyui-dir "$COMFYUI_DIR" --profile ltx-25-720p-97f --manifest ../../templates/provenance.json > ltx-provenance.json
```
