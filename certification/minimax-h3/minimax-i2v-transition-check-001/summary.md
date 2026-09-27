# LTX-2.5 Hardware Certification Summary

**Run ID:** `minimax-i2v-transition-check-001`  
**Generated At:** `2026-09-27T04:30:43.949Z`  
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
- **ComfyUI PID:** `1160`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 900,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (403,684 ms) <= limit (900,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 403,684 ms |
| **Peak VRAM** | 21,450 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 89.2% |
| **Peak Host RAM Used** | 29,570 MB |
| **Peak Process RSS** | 29,002 MB |
| **Peak Swap Used** | 3,955 MB |
| **Swap Used Delta** | N/A |
| **System Swap-In Pages Delta** | 339,071 |
| **System Swap-Out Pages Delta** | 315,617 |
| **System Major Page Faults Delta** | 79,930 |
| **System Minor Page Faults Delta** | 21,956,139 |
| **Process Major Page Faults Delta** | 76,264 |
| **Process Minor Page Faults Delta** | 12,650,461 |
| **Post-Unload Used VRAM** | 606 MB |
| **Post-Unload Free VRAM** | 23,445 MB |
| **Total Samples Collected** | 1875 |
| **Sampling Errors** | 0 |
