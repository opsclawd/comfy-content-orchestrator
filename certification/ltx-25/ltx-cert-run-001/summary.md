# LTX-2.5 Hardware Certification Summary

**Run ID:** `ltx-cert-run-001`  
**Generated At:** `2026-08-16T13:29:17.646Z`  
**Status:** **FAILED**  
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

**Gate Status:** **FAILED** (Max Duration: 55,000 ms)

| Check | Status | Description |
| :--- | :--- | :--- |
| Render Success | PASS | Render execution completed successfully |
| No OOM Detected | PASS | Workload ran without Out-Of-Memory error |
| Duration Within Limit | PASS | Render duration (48,022 ms) <= limit (55,000 ms) |
| Telemetry Complete | FAIL | All required GPU and host telemetry metrics captured without errors |
| Post-Unload Headroom Observed | FAIL | Post-unload headroom sample measured after model unload |

## Measured Resource Telemetry

| Metric | Measured Value |
| :--- | :--- |
| **Total Render Duration** | 48,022 ms |
| **Peak VRAM** | N/A |
| **Peak Host RAM Used** | N/A |
| **Peak Process RSS** | N/A |
| **Swap Used Delta** | N/A |
| **System Swap-In Pages Delta** | N/A |
| **System Swap-Out Pages Delta** | N/A |
| **System Major Page Faults Delta** | N/A |
| **System Minor Page Faults Delta** | N/A |
| **Process Major Page Faults Delta** | N/A |
| **Process Minor Page Faults Delta** | N/A |
| **Post-Unload Used VRAM** | N/A |
| **Post-Unload Free VRAM** | N/A |
| **Total Samples Collected** | 0 |
| **Sampling Errors** | 13 |

## Failure Details

- **Phase:** `final_sampling`
- **Code:** `final_sampling_failed`
- **Message:** Final telemetry sample failed: Explicit sample (post_unload) failed: Sampling aborted: consecutive error budget of 10 exceeded
- **Details:** `{}`

## Historical Baseline Comparison (Reference Only)

*Note: Historical baseline values are informational reference points from previous benchmarks and are NOT used as measured data or pass conditions.*

| Metric | Measured Run | Historical Baseline (Reference) |
| :--- | :--- | :--- |
| **Total Render Duration** | 48,022 ms | ~46,000 ms (46 s) |
| **Peak VRAM** | N/A | ~24,028 MB |
| **Core DiT Sampling** | N/A (Measured End-to-End) | ~12 s |
