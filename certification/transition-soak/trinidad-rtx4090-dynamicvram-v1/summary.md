# FLUX ↔ LTX Transition Soak Certification Summary

**Run ID:** `trinidad-rtx4090-dynamicvram-v1`  
**Generated At:** `2026-08-17T00:47:19.025Z`  
**Status:** **FAILED**  
**Host RAM Decision:** **64GB Required (Phase 1 Prerequisite)** (`require_64gb`)  
**Runner Profile:** `dynamicvram-offload-v1`  
**Selected Profile:** `None (Failed Gate)`  
**Completed Transitions:** 10 / 10 (Total Renders: 11)  

## Workload & Hardware Identity

### Host Hardware & Environment
- **GPU:** NVIDIA GeForce RTX 4090 (24,564 MB, Driver 595.58.03, CUDA 13.2)
- **Host CPU & RAM:** AMD Ryzen 7 7700X 8-Core Processor (16 CPUs), 6.8.0-117-generic (linux/x64)
- **Node Version:** `v24.19.0`
- **ComfyUI PID:** `69326`
- **ComfyUI Startup Args:** `/home/gpoontip/ComfyUI/venv/bin/python main.py --listen 0.0.0.0 --port 8188`

### FLUX Workload Identity (`flux-schnell-draft`)
- **Engine & Dimensions:** `flux_schnell` (1024x1024, 1 frame, 4 steps)
- **Workflow SHA-256:** `af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5`
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Measured Footprint:** 29.257890132 GB (Min Free Disk: 0 GB)

### LTX Workload Identity (`ltx-25-720p-97f`)
- **Profile Key:** `LTX_25_720P_5S_V1` (v1)
- **Engine & Dimensions:** `ltx_25` (1280x720, 97 frames, 8 steps)
- **Workflow SHA-256:** `94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539`
- **ComfyUI Commit:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- **Measured Footprint:** 38.329275932 GB (Min Free Disk: 100 GB)

## Configured Thresholds

| Threshold Parameter | Configured Limit | Description |
| :--- | :--- | :--- |
| **Min Post-Unload Free VRAM** | 23,000 MB | Minimum free GPU memory required after model unload |
| **Min Host Available RAM** | 1,024 MB | Minimum available host system RAM at all times |
| **Max VRAM Growth** | 256 MB | Maximum allowable same-family / post-unload VRAM growth |
| **Max Host / RSS Growth** | 256 MB | Maximum allowable same-family / post-unload Host RAM or RSS growth |
| **Max Latency Degradation** | 20% | Maximum median latency increase vs single-family baselines |
| **Cleanup Timeout** | 30,000 ms | Maximum duration to await post-unload VRAM headroom |
| **Cleanup Poll Interval** | 500 ms | Telemetry polling interval during post-unload settle |

## Resource Gate Evaluation

**Gate Status:** **FAILED**  

| Gate Check | Status | Description |
| :--- | :--- | :--- |
| **Completed Required Transitions** | PASS | Executed initial FLUX render plus 10 strict switches (10 completed) |
| **All Renders Successful** | PASS | Every render completed with status 'succeeded' and non-null execution ID |
| **All Cleanups Successful** | PASS | Every post-render model unload passed within timeout |
| **No OOM Detected** | PASS | Zero CUDA or host Out-Of-Memory errors detected (OOM count: 0) |
| **No Unexpected Restarts** | PASS | Zero process restarts or PID identity changes (Restart count: 0) |
| **No Sampling Errors** | PASS | All telemetry intervals collected without sampling errors (Error count: 0) |
| **No Swap Activity** | FAIL | Zero swap-used, swap-in, or swap-out page activity during the soak run |
| **Post-Unload VRAM Headroom Met** | PASS | Free VRAM after unload >= 23,000 MB across every iteration |
| **Host Memory Headroom Met** | PASS | Host available RAM >= 1,024 MB across every sample |
| **VRAM Growth Within Tolerance** | PASS | Same-family and post-unload VRAM growth <= 256 MB |
| **Host Growth Within Tolerance** | PASS | Same-family and post-unload Host RAM and RSS growth <= 256 MB |
| **Latency Within Tolerance** | PASS | Median duration degradation <= 20% vs single-family baselines |

## Transition Sequence & Raw Iteration Evidence

*All measured values per render are preserved below to maintain visibility into outliers and spikes.*

| # | Transition | Family | Status | Render Dur | Peak VRAM | Post Free VRAM | Peak Host RAM | Peak RSS | Swap Delta | Major/Minor Faults | Cleanup | OOM/Restart |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| 0 | Initial (FLUX) | FLUX | OK | 12,111 ms | 23,682 MB | 23,455 MB | 29,228 MB | 26,884 MB | 2 MB (in:0/out:466) | 8 / 7,418,346 | PASS (1,590 ms, 4 att) | No OOM / Stable |
| 1 | #1 (flux→ltx) | LTX | OK | 47,909 ms | 23,810 MB | 23,421 MB | 29,235 MB | 26,970 MB | 88 MB (in:3/out:22485) | 1009 / 18,846,249 | PASS (1,593 ms, 4 att) | No OOM / Stable |
| 2 | #2 (ltx→flux) | FLUX | OK | 12,299 ms | 23,686 MB | 23,421 MB | 29,148 MB | 26,782 MB | 982 MB (in:818/out:251657) | 847 / 7,280,089 | PASS (1,590 ms, 4 att) | No OOM / Stable |
| 3 | #3 (flux→ltx) | LTX | OK | 46,120 ms | 23,556 MB | 23,421 MB | 29,288 MB | 26,947 MB | 89 MB (in:2310/out:23559) | 236 / 18,333,817 | PASS (1,580 ms, 4 att) | No OOM / Stable |
| 4 | #4 (ltx→flux) | FLUX | OK | 11,807 ms | 23,846 MB | 23,421 MB | 29,204 MB | 26,839 MB | 0 MB (in:173/out:0) | 9 / 7,239,677 | PASS (1,591 ms, 4 att) | No OOM / Stable |
| 5 | #5 (flux→ltx) | LTX | OK | 45,550 ms | 24,038 MB | 23,421 MB | 29,384 MB | 27,031 MB | N/A (in:912/out:231) | 20 / 18,107,212 | PASS (1,579 ms, 4 att) | No OOM / Stable |
| 6 | #6 (ltx→flux) | FLUX | OK | 11,853 ms | 23,974 MB | 23,421 MB | 29,144 MB | 26,647 MB | 0 MB (in:82/out:0) | 35 / 7,248,895 | PASS (1,575 ms, 4 att) | No OOM / Stable |
| 7 | #7 (flux→ltx) | LTX | OK | 45,287 ms | 24,036 MB | 23,421 MB | 29,341 MB | 26,965 MB | 7 MB (in:169/out:2637) | 9 / 18,143,957 | PASS (1,581 ms, 4 att) | No OOM / Stable |
| 8 | #8 (ltx→flux) | FLUX | OK | 11,818 ms | 23,878 MB | 23,421 MB | 29,216 MB | 26,850 MB | 0 MB (in:91/out:0) | 37 / 7,237,216 | PASS (1,577 ms, 4 att) | No OOM / Stable |
| 9 | #9 (flux→ltx) | LTX | OK | 45,632 ms | 24,038 MB | 23,421 MB | 29,271 MB | 27,043 MB | 0 MB (in:47/out:41) | 9 / 18,110,510 | PASS (1,578 ms, 4 att) | No OOM / Stable |
| 10 | #10 (ltx→flux) | FLUX | OK | 11,735 ms | 23,718 MB | 23,421 MB | 29,199 MB | 26,872 MB | 0 MB (in:55/out:0) | 6 / 7,237,115 | PASS (1,578 ms, 4 att) | No OOM / Stable |

## Aggregate Stability, Growth & Latency Comparisons

### Progressive Memory Growth (Family-Normalized)

| Metric Dimension | Measured Growth | Tolerance Limit | Result |
| :--- | :--- | :--- | :--- |
| **FLUX Peak VRAM Growth** | 36 MB | <= 256 MB | PASS |
| **LTX Peak VRAM Growth** | 228 MB | <= 256 MB | PASS |
| **FLUX Peak Host RAM Growth** | -29 MB | <= 256 MB | PASS |
| **LTX Peak Host RAM Growth** | 36 MB | <= 256 MB | PASS |
| **FLUX Peak Process RSS Growth** | -12 MB | <= 256 MB | PASS |
| **LTX Peak Process RSS Growth** | 73 MB | <= 256 MB | PASS |
| **Post-Unload Used VRAM Growth** | 34 MB | <= 256 MB | PASS |
| **Post-Unload Host RAM Growth** | -1,313 MB | <= 256 MB | PASS |
| **Post-Unload Process RSS Growth** | -803 MB | <= 256 MB | PASS |

### Latency Degradation vs Single-Family Baselines

| Family | Baseline Duration | Soak Median Duration | Degradation % | Max Allowed | Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **FLUX** | 11,123 ms | 11,836 ms | +6.4% | <= +20% | PASS |
| **LTX** | 46,874 ms | 45,632 ms | -2.6% | <= +20% | PASS |

## Failure Details

- **Phase:** `transition_soak_gate`
- **Code:** `TRANSITION_SOAK_FAILED`
- **Message:** Transition soak failed gate checks: noSwapActivity
- **Details:** `{"failedChecks":["noSwapActivity"],"renderFailureCount":0,"cleanupFailureCount":0,"oomCount":0,"unexpectedRestartCount":0,"samplingErrorCount":0}`

## Phase 1 Host RAM & Runner Profile Decision

- **Host RAM Requirement Decision:** **REQUIRE_64GB** (64GB Required (Phase 1 Prerequisite))
- **Selected Runner Profile:** `None`
- **Decision Rationale:** Soak gate checks failed (noSwapActivity). Phase 1 production configuration requires 64GB host RAM before freezing production profile.
