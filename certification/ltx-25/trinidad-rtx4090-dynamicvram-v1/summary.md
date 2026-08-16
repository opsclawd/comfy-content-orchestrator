# LTX-2.5 Hardware Certification Summary

**Run ID:** `trinidad-rtx4090-dynamicvram-v1`  
**Generated At:** `2026-08-15T20:00:00.000Z`  
**Status:** **PASSED**  
**Runner Mode:** `dynamicvram`  

## Workload & Hardware Identity

- **Profile Key:** `LTX_25_720P_5S_V1` (v1)
- **Profile ID:** `ltx-25-720p-97f`
- **Engine:** `ltx_25`
- **Resolution & Frames:** 1280x720, 97 frames, 8 steps
- **ComfyUI Commit:** `a1b2c3d4e5f60718293a4b5c6d7e8f9012345678`
- **Workflow SHA-256:** `baba814eae019bf64e91bc757d24e27e8530dfa6bef11c011be3b7d6b7da5a50`
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 550.54.14, CUDA 12.4)
- **Host:** AMD Ryzen 9 7950X 16-Core Processor (32 CPUs), 6.8.0-40-generic (linux/x64)
- **Node Version:** `v24.0.0`
- **ComfyUI PID:** `18452`

## Resource Gate Evaluation

**Gate Status:** **PASSED** (Max Duration: 55,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (46,000 ms) <= limit (55,000 ms) |
| Telemetry Complete | PASS | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | PASS | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 46,000 ms |
| **Peak VRAM** | 24,028 MB |
| **Peak Host RAM Used** | 18,940 MB |
| **Peak Process RSS** | 4,480 MB |
| **Swap Used Delta** | 0 MB |
| **System Swap-In Pages Delta** | 0 |
| **System Swap-Out Pages Delta** | 0 |
| **System Major Page Faults Delta** | 8 |
| **System Minor Page Faults Delta** | 1,520 |
| **Process Major Page Faults Delta** | 4 |
| **Process Minor Page Faults Delta** | 1,180 |
| **Post-Unload Used VRAM** | 1,024 MB |
| **Post-Unload Free VRAM** | 23,540 MB |
| **Total Samples Collected** | 3 |
| **Sampling Errors** | 0 |

## Historical Baseline Comparison (Reference Only)

*Note: Historical baseline values are informational reference points from previous benchmarks and are NOT used as measured data or pass conditions.*

| Metric | Measured Run | Historical Baseline (Reference) |
| :--- | :--- | :--- |
| **Total Render Duration** | 46,000 ms | ~46,000 ms (46 s) |
| **Peak VRAM** | 24,028 MB | ~24,028 MB |
| **Core DiT Sampling** | N/A (Measured End-to-End) | ~12 s |
