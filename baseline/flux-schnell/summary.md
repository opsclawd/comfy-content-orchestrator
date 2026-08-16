# FLUX.1 [schnell] Measured Host Baseline

**Profile ID:** `flux-schnell-draft`  
**Measured At:** `2026-08-16T18:46:12.794Z`  
**Type:** Measured Host Baseline (Reference for FLUX ↔ LTX Soak Testing #8)  
**Runner Mode:** `dynamicvram`  

*Note: This document records the empirical physical resource envelope measured on the RTX 4090 host. It is an empirical baseline for drift and soak comparison (#8), not a certified gate evaluation.*

## Workload & Hardware Identity

- **Profile ID:** `flux-schnell-draft`
- **Engine:** `flux_schnell`
- **Resolution & Steps:** 1024x1024, 1 frame, 4 steps
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Workflow SHA-256:** `af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.58.03, CUDA 13.2)
- **Host:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-117-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `69326`

## Measured Resource Telemetry (75 Samples @ 200 ms)

| Metric | Measured Baseline Value |
| :--- | :--- |
| **Total Render Duration** | 11,020 ms (11.02 s) |
| **Peak VRAM** | 23,938 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Pool** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 99.5% |
| **Peak Host RAM Used** | 29,087 MB |
| **Peak Process RSS** | 26,874 MB |
| **Swap Used Delta** | 0 MB |
| **System Swap-In Pages Delta** | 0 |
| **System Swap-Out Pages Delta** | 0 |
| **System Major Page Faults Delta** | 2 |
| **System Minor Page Faults Delta** | 7,729,076 |
| **Process Major Page Faults Delta** | 2 |
| **Process Minor Page Faults Delta** | 7,381,513 |
| **Post-Unload Used VRAM** | 564 MB |
| **Post-Unload Free VRAM** | 23,487 MB |
| **Total Samples Collected** | 75 |
| **Sampling Errors** | 0 |

