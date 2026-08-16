# LTX-2.5 Hardware Certification Summary

**Run ID:** `ltx-cert-run-002`  
**Generated At:** `2026-08-16T15:45:48.417Z`  
**Status:** **PASSED**  
**Runner Mode:** `dynamicvram`  

## Workload & Hardware Identity

- **Profile Key:** `LTX_25_720P_5S_V1` (v1)
- **Profile ID:** `ltx-25-720p-97f`
- **Engine:** `ltx_25`
- **Resolution & Frames:** 1280x720, 97 frames, 8 steps
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Workflow SHA-256:** `94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.58.03, CUDA 13.2)
- **Host:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-117-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `64474`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 55,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (46,874 ms) <= limit (55,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 46,874 ms |
| **Peak VRAM** | 23,618 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 98.2% |
| **Peak Host RAM Used** | 29,325 MB |
| **Peak Process RSS** | 26,732 MB |
| **Swap Used Delta** | 0 MB |
| **System Swap-In Pages Delta** | 0 |
| **System Swap-Out Pages Delta** | 0 |
| **System Major Page Faults Delta** | 142 |
| **System Minor Page Faults Delta** | 20,399,486 |
| **Process Major Page Faults Delta** | 126 |
| **Process Minor Page Faults Delta** | 19,283,765 |
| **Post-Unload Used VRAM** | 600 MB |
| **Post-Unload Free VRAM** | 23,451 MB |
| **Total Samples Collected** | 239 |
| **Sampling Errors** | 0 |

## Historical Baseline Comparison (Reference Only)

*Note: Historical baseline values are informational reference points from previous benchmarks and are NOT used as measured data or pass conditions.*

| Metric | Measured Run | Historical Baseline (Reference) |
| :--- | :--- | :--- |
| **Total Render Duration** | 46,874 ms | ~46,000 ms (46 s) |
| **Peak VRAM** | 23,618 MB | ~24,028 MB |
| **Core DiT Sampling** | N/A (Measured End-to-End) | ~12 s |
