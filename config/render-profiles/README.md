# Certified Production Render Profiles

This directory contains frozen, machine-readable JSON render profile configurations certified for Phase 1 production execution on the Trinidad RTX 4090 render host.

## Profile Registry

### `LTX_25_720P_5S_V1` (`config/render-profiles/LTX_25_720P_5S_V1.json`)
- **Key & Version:** `LTX_25_720P_5S_V1` (v1)
- **Engine:** `ltx_25`
- **Output:** 1280x720 (720p), 97 frames (5s @ 24 fps), 8 steps
- **Workflow SHA-256:** `94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539` (from `templates/provenance.json` & `ltx-cert-run-002`, ComfyUI commit `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`)
- **Model Set & Exact SHA-256 Hashes:** (from `certification/ltx-25/ltx-cert-run-002/result.json` & soak `identities.ltx.modelSha256`):
  - `models/clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors`: `09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de` (15,372,971,786 bytes)
  - `models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors`: `c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334` (21,504,034,224 bytes)
  - `models/vae/ltx-2.5-video-vae-conv-bf16.safetensors`: `685b06ee3d9b2039647698fc4ea33175112462fc374e2777312c907897dfce8d` (1,452,269,922 bytes)
  - **Measured Total Disk Footprint:** `38.329275932 GB` (38,329,275,932 bytes total)
- **Runner Profile:** `dynamicvram-offload-v1`

### Measured Empirical Envelope & Source Run Traceability

Every field in the profile is directly attributable to physical measurements on the Trinidad host:

| Field | Frozen Value | Source Run & Methodology |
|---|---|---|
| `workflowHash` | `94f397ee…` | `certification/ltx-25/ltx-cert-run-002/result.json` & `templates/provenance.json` |
| `modelHashes` | `09a89e…`, `c4279e…`, `685b06…` | `certification/ltx-25/ltx-cert-run-002/result.json` (`identity.modelSha256`) & soak artifact |
| `measuredPeakVramMb` | `24038` | `certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json` (max across LTX transition iterations 5 and 9 under multi-model transition load; captures full envelope vs single-family 23,618 MB) |
| `measuredTotalDurationMs` | `45632` | `certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json` (median LTX duration across 5 soak iterations: `[45287, 45550, 45632, 46120, 47909]`) |
| `measuredSamplingDurationMs` | `null` | Explicit `null` as ComfyUI WebSocket harness records end-to-end prompt duration without separate sampling isolation |
| `measuredDiskFootprintGb` | `38.329275932` | Exact byte sum of the 3 installed LTX-2.5 int8/bf16 models ($38,329,275,932\text{ bytes} \div 10^9$) |
| `measuredPeakHostRamMb` | `29384` | `certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json` (LTX iteration 5 peak host RAM) |
| `measuredPeakProcessRssMb` | `27043` | `certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json` (LTX iteration 9 peak process RSS) |
| `measuredSwapUsedMb` | `89` | `certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json` (max swap delta on LTX iterations; LTX iterations recorded `[88, 89, null, 7, 0]`) |
| `measuredMajorPageFaults` | `1009` | `certification/transition-soak/trinidad-rtx4090-dynamicvram-v1/result.json` (LTX iteration 1 process major page faults during warmup) |
| `minFreeDiskGb` | `100` | Mandatory free disk safety margin |
| `maxConcurrentGpuJobs` | `1` | Core constraint: single active diffusion workload per RTX 4090 |
| `requiresModelOffloading` | `true` | ComfyUI DynamicVRAM / workflow-managed model offloading |

### Operational Assessment & Gate Context
The transition soak run (`trinidad-rtx4090-dynamicvram-v1`) recorded `gate.passed: false` due to a fail-closed binary `noSwapActivity` check when the Linux kernel performed initial cold-page evictions during iterations 0–3 (89 MB max on LTX, 982 MB on FLUX). However, swap activity ceased completely by iteration 4, headroom stayed flat at 1.85–2.09 GB with zero progressive memory leaks, and all 11 other stability gates passed. On a dedicated 32 GB render host running one concurrent generation, this resource envelope is certified for Phase 1 production.
