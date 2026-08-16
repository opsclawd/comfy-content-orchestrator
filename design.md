# LTX-2.5 Hardware Certification Harness Design

## The problem being solved and why it matters
We need a reproducible hardware certification harness to run a pinned "Gold Master" LTX-2.5 workload on the target RTX 4090 and record its resource consumption. This creates a baseline resource envelope that validates our `RenderProfile` metrics. Establishing this envelope is critical for production stability, ensuring that our capacity planning, render job dispatching limits, and Out-Of-Memory (OOM) protections are grounded in verifiable, live measurements rather than estimates.

## Key design decisions and trade-offs considered
- **GPU Telemetry Method**:
  - *Trade-off*: We can either use a native Node library for NVML, or poll the `nvidia-smi` executable. While native NVML is more precise, polling `nvidia-smi` avoids native compilation dependencies and is generally sufficient for our sampling needs if executed smartly.
  - *Decision*: We will implement an `NvidiaSmiTelemetryAdapter` (implementing `GpuTelemetryPort`) that continuously polls `nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits` using `child_process.execFile`. To avoid missing short-lived peaks while minimizing overhead, we will poll at a 200ms interval.
- **Host Telemetry Collection**:
  - *Trade-off*: The harness could wrap the ComfyUI process with `/usr/bin/time -v` if it launched it, or read `/proc` files. Because ComfyUI is generally managed as a separate long-running service, wrapping its startup isn't feasible for a live test.
  - *Decision*: The harness will collect system-wide memory metrics by reading `/proc/meminfo` and system-wide page faults via `/proc/vmstat` (`pgmajfault`). By measuring the delta during the isolated execution window, we capture the workload's impact. If ComfyUI's PID is discoverable (e.g., via a known port), the harness can read `/proc/<pid>/status` for precise RSS.
- **CLI Location**:
  - *Decision*: The script will be created as `apps/render-worker/src/cli/certify-ltx.ts` and exposed as `pnpm certify:ltx`. This places it near the `RenderEnginePort` and orchestrates both application and infrastructure packages.
- **Comparator Path (`--highvram`)**:
  - *Decision*: We will introduce an explicit CLI flag `--highvram` to run a comparator profile. This run will be output to a separate result JSON to avoid overwriting the default DynamicVRAM certification baseline.

## Proposed approach with rationale
1. **Telemetry Infrastructure**:
   - `NvidiaSmiTelemetryAdapter`: Implements `GpuTelemetryPort` via `nvidia-smi` polling.
   - `HostTelemetryAdapter`: Reads `/proc/meminfo` for RAM and Swap, and `/proc/vmstat` for major page faults.
   - `TelemetrySampler`: An orchestrator that takes both ports and runs a periodic `setInterval` loop to collect a time-series of snapshots.
2. **Certification Harness CLI (`certify-ltx.ts`)**:
   - **Preflight**: Validates the workflow/model hashes against the `LTX_25_720P_5S_V1` profile in `packages/contracts/src/render-profile.ts` or via `ProfileManifest`. Checks for `>=100GB` free disk space.
   - **Environment Record**: Grabs driver versions, Node versions, and kernel metadata.
   - **Execution**: Starts `TelemetrySampler`, calls `RenderEnginePort.queueRender`, and awaits `getRenderResult`.
   - **Cleanup**: Calls `RenderEnginePort.unloadModels()`, waits for a 5-second settle period, and measures the post-unload headroom.
   - **Artifact Generation**: Calculates peak VRAM, total duration, peak RSS, swap delta, and major page fault delta. Serializes all raw samples and peaks to a machine-readable JSON file, and formats a human-readable Markdown summary.
3. **Hardware/CI Separation**:
   - Core aggregation logic, threshold verification, and parser logic will be isolated into pure functions, covered entirely by unit tests using fixture data.
   - The CLI will execute real hardware queries but intentionally exit gracefully (or with a specific skip code) in CI environments lacking an RTX 4090.

## Assumptions made
- **Process Architecture**: ComfyUI runs as a separate, persistent background service accessible to the runner. The harness does not launch ComfyUI; thus, system-wide deltas from `/proc` are a valid proxy in an isolated environment, or we must provide the harness with ComfyUI's PID.
- **Target Profile Location**: The "Gold Master workflow/model hashes from #6" exist and are accessible within the `LTX_25_720P_5S_V1` profile definitions in the codebase.
- **Isolated Runner Environment**: The certification is run on an otherwise idle machine. If other heavy processes are running, system-wide `/proc` delta measurements would be noisy.
- **Free Endpoint**: `RenderEnginePort.unloadModels()` triggers ComfyUI's `/free` endpoint or equivalent memory release mechanism, allowing us to accurately measure post-unload headroom.

## What is in scope and what is explicitly out of scope
**In Scope**:
- CLI tool `pnpm certify:ltx` orchestrating the measurement.
- `GpuTelemetryPort` adapter using `nvidia-smi`.
- Host memory and swap/page fault collection via `/proc`.
- Outputting timestamped JSON and Markdown artifacts under `certification/ltx-25/`.
- Unit tests for parsing, missing samples, and threshold evaluation.

**Out of Scope**:
- Managing the lifecycle (start/stop) of the ComfyUI service itself.
- Validating the generated video output visually (the render success status is trusted).
- Mutating or optimizing the existing Gold Master workflow.
- CI pipeline configuration to run the hardware task.
- Multi-model context switching tests.

## Risks or concerns identified from code analysis
- **Overhead of `nvidia-smi` Polling**: Rapidly spanning `nvidia-smi` every 100-200ms might incur CPU spikes that artificially inflate the host metric measurements or interfere with render dispatch. If this occurs, we may need to pivot to parsing a persistent `nvidia-smi dmon` stream.
- **Cross-Platform Compatibility**: Code that relies heavily on `/proc` is strictly bound to Linux. While acceptable for the RTX 4090 certification target, the codebase must ensure these adapters are only instantiated dynamically or skipped entirely on MacOS/Windows developer machines to avoid crashes during unrelated tests.
