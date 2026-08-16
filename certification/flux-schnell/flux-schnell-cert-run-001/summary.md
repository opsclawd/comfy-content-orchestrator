# FLUX.1 [schnell] Hardware Certification Summary

**Run ID:** `flux-schnell-cert-run-001`  
**Generated At:** `2026-08-16T23:20:11.643Z`  
**Status:** **PASSED**  
**Runner Mode:** `dynamicvram`  

## Workload & Hardware Identity

- **Profile Key:** `FLUX_SCHNELL_DRAFT_V1` (v1)
- **Profile ID:** `flux-schnell-draft`
- **Engine:** `flux_schnell`
- **Resolution & Steps:** 1024x1024, 1 frame, 4 steps
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Workflow SHA-256:** `af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.58.03, CUDA 13.2)
- **Host:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-117-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `69326`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 30,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (11,123 ms) <= limit (30,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 11,123 ms |
| **Peak VRAM** | 23,874 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 99.3% |
| **Peak Host RAM Used** | 29,141 MB |
| **Peak Process RSS** | 26,898 MB |
| **Swap Used Delta** | 0 MB |
| **System Swap-In Pages Delta** | 0 |
| **System Swap-Out Pages Delta** | 0 |
| **System Major Page Faults Delta** | 0 |
| **System Minor Page Faults Delta** | 7,759,392 |
| **Process Major Page Faults Delta** | 0 |
| **Process Minor Page Faults Delta** | 7,411,958 |
| **Post-Unload Used VRAM** | 564 MB |
| **Post-Unload Free VRAM** | 23,487 MB |
| **Total Samples Collected** | 75 |
| **Sampling Errors** | 0 |
