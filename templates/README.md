# Gold Master Workflow Templates & Provenance

This directory contains the version-controlled, source-gated Gold Master ComfyUI API workflow templates and certification provenance manifest used by the Content Orchestrator.

## Workflows and Sources

### 1. `flux-schnell-draft` (`templates/flux_schnell_draft_api.json`)
- **Source Kind:** Validated host API export (`validated_host_export`).
- **Source URI:** `https://github.com/black-forest-labs/flux`
- **Revision:** `main` (host-validated 4-step draft baseline).
- **Redistribution Basis & License:** Apache-2.0. The FLUX.1 [schnell] workflow definition is distributed under the Apache-2.0 license.
- **Workflow Format:** Exact ComfyUI API object map targeting the 4-step Schnell sampler path.
- **Canonical SHA-256:** `00abd5b566eaa1e2cdf5e9be4e57b707d24ed10c6d668e438e075891f478f6dc`
- **Referenced Models:**
  - `models/checkpoints/flux1-schnell.safetensors`

### 2. `ltx-25-720p-97f` (`templates/ltx_25_720p_97f_api.json`)
- **Source Kind:** Official upstream template export (`official_upstream`).
- **Source URI:** `https://github.com/Lightricks/LTX-2`
- **Revision:** `main`
- **Redistribution Basis & License:** LTX-2 Community License Agreement (dated Jan. 5, 2026).
- **Workflow Format:** Exact ComfyUI API object map targeting 1280x720 resolution, 97 frames (~5 seconds at 24 fps), and 8 DiT sampling steps.
- **Canonical SHA-256:** `e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a`
- **Runner Profile:** `dynamicvram-offload-v1` (requiring DynamicVRAM / workflow-managed model offloading).
- **Disk Space Requirement:** Minimum 100 GB free disk space reservation (`minFreeDiskGb: 100`).
- **Referenced Models:**
  - `models/diffusion_models/ltx-video-2b-v0.9.1.safetensors`
  - `models/text_encoders/t5xxl_fp16.safetensors`
  - `models/vae/ltx-video-vae.safetensors`

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
| `flux-schnell-draft` | `checkpoints` | `flux1-schnell.safetensors` | `models/checkpoints/flux1-schnell.safetensors` |
| `ltx-25-720p-97f` | `diffusion_models` | `ltx-video-2b-v0.9.1.safetensors` | `models/diffusion_models/ltx-video-2b-v0.9.1.safetensors` |
| `ltx-25-720p-97f` | `text_encoders` | `t5xxl_fp16.safetensors` | `models/text_encoders/t5xxl_fp16.safetensors` |
| `ltx-25-720p-97f` | `vae` | `ltx-video-vae.safetensors` | `models/vae/ltx-video-vae.safetensors` |

---

## Empirical Performance Certification Scope

The empirical performance values for LTX-2.5 (measured on the RTX 4090 workstation: 46s end-to-end execution, 24,028 MB peak VRAM, ~12s DiT sampling) remain unchanged.
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
