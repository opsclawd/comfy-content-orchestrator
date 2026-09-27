# LTX-2.5 Hardware Certification Summary

**Run ID:** `minimax-ref2v-visual-qa-001`  
**Generated At:** `2026-09-27T10:40:24.126Z`  
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
| Duration Within Limit | PASS | Render duration (467,839 ms) <= limit (900,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 467,839 ms |
| **Peak VRAM** | 21,258 MB |
| **Driver-Reserved VRAM** | 513 MB |
| **Allocatable VRAM Denominator** | 24,051 MB (Nameplate: 24,564 MB) |
| **Peak VRAM Utilisation (Allocatable)** | 88.4% |
| **Peak Host RAM Used** | 29,781 MB |
| **Peak Process RSS** | 29,005 MB |
| **Peak Swap Used** | 3,678 MB |
| **Swap Used Delta** | N/A |
| **System Swap-In Pages Delta** | 282,194 |
| **System Swap-Out Pages Delta** | 97,559 |
| **System Major Page Faults Delta** | 60,534 |
| **System Minor Page Faults Delta** | 23,935,920 |
| **Process Major Page Faults Delta** | 58,576 |
| **Process Minor Page Faults Delta** | 13,193,990 |
| **Post-Unload Used VRAM** | 606 MB |
| **Post-Unload Free VRAM** | 23,445 MB |
| **Total Samples Collected** | 2169 |
| **Sampling Errors** | 0 |
