# LTX-2.5 Hardware Certification Summary

**Run ID:** `minimax-h3-cert-run-001`  
**Generated At:** `2026-09-19T02:32:34.156Z`  
**Status:** **PASSED**  
**Runner Mode:** `dynamicvram`  

## Workload & Hardware Identity

- **Profile Key:** `MINIMAX_H3_720P_5S_I2V_V1` (v1)
- **Profile ID:** `minimax-h3-720p-124f-i2v`
- **Engine:** `minimax_h3_i2v`
- **Resolution & Frames:** 1344x768, 124 frames, 20 steps
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Workflow SHA-256:** `4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.91.07, CUDA 13.2)
- **Host:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-139-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `20948`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 600,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (395,641 ms) <= limit (600,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 395,641 ms |
| **Peak VRAM** | 23,950 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 99.6% |
| **Peak Host RAM Used** | 30,351 MB |
| **Peak Process RSS** | 27,930 MB |
| **Swap Used Delta** | 8 MB |
| **System Swap-In Pages Delta** | 344 |
| **System Swap-Out Pages Delta** | 2,566 |
| **System Major Page Faults Delta** | 576 |
| **System Minor Page Faults Delta** | 14,059,293 |
| **Process Major Page Faults Delta** | 351 |
| **Process Minor Page Faults Delta** | 5,015,636 |
| **Post-Unload Used VRAM** | 616 MB |
| **Post-Unload Free VRAM** | 23,435 MB |
| **Total Samples Collected** | 1838 |
| **Sampling Errors** | 0 |
