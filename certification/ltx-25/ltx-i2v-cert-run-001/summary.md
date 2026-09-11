# LTX-2.5 Hardware Certification Summary

**Run ID:** `ltx-i2v-cert-run-001`  
**Generated At:** `2026-09-11T00:59:55.483Z`  
**Status:** **PASSED**  
**Runner Mode:** `dynamicvram`  

## Workload & Hardware Identity

- **Profile Key:** `LTX_25_720P_5S_I2V_V1` (v1)
- **Profile ID:** `ltx-25-720p-97f-i2v`
- **Engine:** `ltx_25_i2v`
- **Resolution & Frames:** 1280x720, 97 frames, 8 steps
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Workflow SHA-256:** `95349fce04e8e9598ea2013fb2f218efc86185d1216563d450f90b00fd0fecfb`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.58.03, CUDA 13.2)
- **Host:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-117-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `214757`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 55,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (49,235 ms) <= limit (55,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 49,235 ms |
| **Peak VRAM** | 23,716 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 98.6% |
| **Peak Host RAM Used** | 29,304 MB |
| **Peak Process RSS** | 27,056 MB |
| **Swap Used Delta** | 32 MB |
| **System Swap-In Pages Delta** | 124 |
| **System Swap-Out Pages Delta** | 8,949 |
| **System Major Page Faults Delta** | 1,315 |
| **System Minor Page Faults Delta** | 21,232,964 |
| **Process Major Page Faults Delta** | 1,175 |
| **Process Minor Page Faults Delta** | 20,098,711 |
| **Post-Unload Used VRAM** | 602 MB |
| **Post-Unload Free VRAM** | 23,449 MB |
| **Total Samples Collected** | 249 |
| **Sampling Errors** | 0 |
