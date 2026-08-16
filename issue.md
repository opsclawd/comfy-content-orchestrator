# S1-07: Build the LTX-2.5 hardware certification harness and measure the full resource envelope

**Sprint:** 1 — Core Runtime, Domain Boundaries & Hardware Certification
**Story ID:** S1-07
**Depends on:** #5, #6
**Spec source:** `docs/prd.md` §3.1.1-§3.1.3, §3.6.5, §8 Sprint 1, §9.1

---

## Goal

Turn the one-off LTX-2.5 benchmark into a reproducible hardware-certification harness that executes the pinned Gold Master workflow on the Trinidad RTX 4090 and records the complete GPU/host-memory/resource envelope needed to certify a production `RenderProfile`.

This issue measures **one certified LTX workload repeatedly and reproducibly**. The cross-model FLUX↔LTX soak is #8.

## Certified workload

Use the exact workflow/model hashes produced by #6 and the existing baseline input:

```text
engine: LTX-2.5
resolution: 720p
frames: 97
approx duration: 5 seconds
DiT steps: 8
expected historical baseline:
  peak VRAM: 24,028 MB
  total execution: 46 s
  core DiT sampling: ~12 s
```

The historical values are comparison points, not hard-coded pass results. The harness must measure the live run.

## Scope

### Certification command

Add an explicit render-worker/tooling command such as `pnpm certify:ltx` (final naming may follow repo conventions) that:

1. validates the Gold Master workflow/model hashes from #6;
2. verifies the >=100GB LTX free-space reservation/preflight;
3. records the current runner environment (ComfyUI commit, startup args/memory mode, NVIDIA driver, CUDA/runtime where observable, Node version, host/kernel metadata useful for reproduction);
4. starts sampling telemetry before render dispatch;
5. executes one certified LTX workflow through `RenderEnginePort`/ComfyUI adapter from #5;
6. records end-to-end execution time;
7. records peak GPU VRAM;
8. records peak process RSS / relevant host RAM measurements;
9. records swap consumption/activity;
10. records major page faults (and minor faults if inexpensive);
11. requests `/free` after completion and records post-unload VRAM/headroom after a bounded settle period;
12. writes machine-readable JSON plus a human-readable summary artifact.

### GPU telemetry

Implement an infrastructure adapter for `GpuTelemetryPort` using NVML / `nvidia-smi` or an equivalent reliable NVIDIA source. Sampling frequency must be sufficient to capture a short-lived peak; document the interval.

### Host telemetry

Capture host memory/process metrics using Linux-native mechanisms (`/usr/bin/time -v`, `/proc`, cgroup metrics, or equivalent). The selected method must be automatable and its semantics documented.

### Memory-profile comparison

The first certification path is **default ComfyUI DynamicVRAM/workflow-managed offloading**.

Implement an optional comparator path for `--highvram`, but:

- do not combine mutually exclusive VRAM flags;
- do not make `--highvram` the default merely because it is available;
- record it as a separate runner profile/result;
- only recommend changing the production baseline if measured stability/headroom is equal or better.

## Hardware/CI separation

Generic CI must run unit tests for parsing/aggregation/threshold logic using fixtures. The actual RTX 4090 certification command is a hardware integration task and must fail clearly or skip intentionally when the required GPU/ComfyUI environment is absent; it must never fabricate passing metrics.

## Acceptance criteria

- [ ] Certification refuses to run when workflow/model hashes do not match the pinned Gold Master inputs.
- [ ] Certification refuses to run when the configured disk free-space reservation is below 100GB.
- [ ] Live certification records total render duration.
- [ ] Live certification records peak VRAM.
- [ ] Live certification records peak host process RSS / host-memory measurement.
- [ ] Live certification records swap usage/activity.
- [ ] Live certification records major page faults.
- [ ] Live certification records post-`/free` VRAM/headroom.
- [ ] Machine-readable certification output contains runner/workflow/model identity plus all observed measurements.
- [ ] Human-readable summary is generated from the same measured data, not hand-entered numbers.
- [ ] Default DynamicVRAM/offloading is tested first.
- [ ] `--highvram` comparison, if executed, is stored as a distinct result and does not silently overwrite the baseline.
- [ ] The certified 720p/97-frame workflow completes without OOM and in <=55 seconds to pass the current LTX Resource Envelope Gate.
- [ ] Unit tests cover telemetry parsing, peak calculation, missing samples, timeout/failure output, and certification threshold evaluation without a real GPU.

## Required output artifact

Persist a versioned certification artifact under a path such as:

```text
certification/ltx-25/<timestamp-or-run-id>/result.json
certification/ltx-25/<timestamp-or-run-id>/summary.md
```

Do not commit large rendered video artifacts unless repository policy explicitly requires it; record output hashes/paths instead.

## Automation execution notes

- This issue is expected to run on the Trinidad render host for final acceptance. Do not mark hardware-dependent boxes complete from mocked tests.
- If the automation Run environment cannot access the GPU/ComfyUI service, the implementation portion may land with unit tests, but the PR must state the certification blocker and the issue remains incomplete until a real hardware run produces the artifact.
- Do not optimize the workflow during certification; the purpose is to characterize the pinned baseline.

## Definition of done

Merged implementation plus a real hardware certification artifact from the target RTX 4090 proving the pinned LTX workload's total latency, peak VRAM, host RAM/RSS, swap, page faults, and post-unload headroom. No values are inferred or invented.
