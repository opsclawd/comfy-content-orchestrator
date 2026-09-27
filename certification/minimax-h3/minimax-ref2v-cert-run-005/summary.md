# LTX-2.5 Hardware Certification Summary

**Run ID:** `minimax-ref2v-cert-run-005`  
**Generated At:** `2026-09-27T04:21:36.129Z`  
**Status:** **PASSED**  
**Runner Mode:** `dynamicvram`  

## Workload & Hardware Identity

- **Profile Key:** `MINIMAX_H3_720P_5S_REF2V_V1` (v1)
- **Profile ID:** `minimax-h3-720p-124f-ref2v`
- **Engine:** `minimax_h3_ref2v`
- **Resolution & Frames:** 1344x768, 124 frames, 20 steps
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Workflow SHA-256:** `37146c0f83e2ce74def1fdac46d0f636a0a408ddcc342b06c843b7acb04c7696`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.91.07, CUDA 13.2)
- **Host:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-139-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `1160`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 900,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (613,570 ms) <= limit (900,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 613,570 ms |
| **Peak VRAM** | 21,066 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 87.6% |
| **Peak Host RAM Used** | 29,625 MB |
| **Peak Process RSS** | 29,108 MB |
| **Peak Swap Used** | 3,639 MB |
| **Swap Used Delta** | 435 MB |
| **System Swap-In Pages Delta** | 114,824 |
| **System Swap-Out Pages Delta** | 238,341 |
| **System Major Page Faults Delta** | 29,880 |
| **System Minor Page Faults Delta** | 27,326,038 |
| **Process Major Page Faults Delta** | 28,222 |
| **Process Minor Page Faults Delta** | 13,251,422 |
| **Post-Unload Used VRAM** | 606 MB |
| **Post-Unload Free VRAM** | 23,445 MB |
| **Total Samples Collected** | 2838 |
| **Sampling Errors** | 0 |
