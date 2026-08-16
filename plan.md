<!-- plan-review-required -->
# LTX-2.5 Hardware Certification Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reproducible `pnpm certify:ltx` hardware harness that verifies an approved LTX-2.5 Gold Master, measures the RTX 4090 and Linux host resource envelope around one ComfyUI render, unloads models, and writes truthful versioned JSON and Markdown evidence.

**Architecture:** Keep operating-system and `nvidia-smi` access in `@cco/infrastructure`, keep sampling/orchestration and gate policy in `@cco/application`, define the durable result format in `@cco/contracts`, and compose everything in `apps/render-worker`. The CLI will reuse the existing provenance collector for workflow hashing, model hashing, Git identity, and the 100 GB disk reservation; it will compare that live report with a separately approved Gold Master provenance record before dispatch. Rendering, recovery cleanup, settling, and artifact publication are explicit phases so failed or timed-out runs retain measured evidence without ever being reported as passing.

**Tech Stack:** Node.js 24, TypeScript 5.7, pnpm workspaces, Zod, Vitest, Linux `/proc`, `nvidia-smi`, the existing `ComfyUiRenderEngineAdapter`, and the existing provenance collector.

---

**Goal details**

- Certify `LTX_25_720P_5S_V1` at 1280x720, 97 frames, and 8 steps against an approved workflow/model identity.
- Sample GPU and host telemetry every 200 ms from before dispatch through the bounded post-`/free` settle window.
- Record the runner, ComfyUI, NVIDIA, Node, kernel, startup-mode, workflow, model, output-path, timing, VRAM, RSS, host-memory, swap, and page-fault evidence required by the issue.
- Evaluate the current resource gate from live data: render succeeds without OOM and total render duration is at most 55,000 ms.
- Keep DynamicVRAM/workflow-managed offloading as the default and treat `--highvram` as a separately named comparator only.

**Non-goals**

- Starting, stopping, restarting, or changing the configuration of the persistent ComfyUI service.
- Editing or optimizing the LTX workflow, model files, or sampler parameters during certification.
- Visually grading the rendered video or committing large video output.
- Adding a generic-CI hardware job, running the FLUX↔LTX soak from issue #8, or supporting non-Linux/non-NVIDIA certification hosts.
- Promoting `--highvram` to the production default from a single run.
- Inventing Gold Master hashes, host measurements, sampling duration, output hashes, or hardware evidence that was not observed.

**Assumptions and dependency reality**

- The target is an otherwise idle Trinidad Linux host with one selected RTX 4090, Node 24+, a persistent ComfyUI service, and permission to read `/proc/<pid>`.
- The operator supplies an approved issue-#6 provenance JSON file through `--gold-master-provenance`. It must identify `ltx-25-720p-97f`, contain the exact workflow and model hashes, use `source.kind: "validated_host_export"`, and use an immutable revision rather than `unpinned`.
- The checked-in `templates/provenance.json` and `templates/README.md` currently describe an `authored_from_spec`/`unpinned` workflow and do not contain expected model hashes. That checked-in state is sufficient for unit development but is not sufficient for a real passing certification. The harness must reject it as Gold Master evidence rather than silently blessing it.
- `--comfyui-pid` is required for a hardware run. This makes process RSS, process faults, and startup arguments precise instead of relying on port-to-PID discovery heuristics.
- The existing `RenderEnginePort.getRenderResult()` waits for the terminal ComfyUI outcome, and `unloadModels()` already calls `/free` with `free_memory` and `unload_models`.
- `--highvram` labels and verifies the already-running ComfyUI process; the harness does not restart ComfyUI with that flag.

**Affected files (repository-root-relative)**

- Create `packages/contracts/src/ltx-certification.ts` — versioned Zod schemas and types for samples, environment identity, gate results, failures, and the final artifact.
- Create `packages/contracts/src/ltx-certification.test.ts` — contract acceptance and rejection tests.
- Modify `packages/contracts/src/index.ts` — export the certification contract.
- Create `packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts` — `GpuTelemetryPort` adapter and CSV parser.
- Create `packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts` — command/parsing/error tests.
- Create `packages/application/src/ports/host-telemetry-port.ts` — host/process telemetry port.
- Modify `packages/application/src/ports/index.ts` — export the host telemetry port.
- Create `packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts` — `/proc/meminfo`, `/proc/vmstat`, `/proc/<pid>/status`, and `/proc/<pid>/stat` adapter.
- Create `packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts` — Linux parser and adapter tests.
- Create `packages/infrastructure/src/telemetry/runner-environment.ts` — one-time Node/kernel/GPU/ComfyUI-process identity collection.
- Create `packages/infrastructure/src/telemetry/runner-environment.test.ts` — environment and startup-argument parser tests.
- Modify `packages/infrastructure/src/index.ts` — export the three telemetry infrastructure units.
- Create `packages/application/src/certification/telemetry-sampler.ts` — non-overlapping 200 ms sampling loop with explicit post-unload sampling.
- Create `packages/application/src/certification/telemetry-sampler.test.ts` — fake-clock loop, failure recovery, and stop tests.
- Create `packages/application/src/certification/certification-metrics.ts` — pure aggregation, identity-safe result building, gate evaluation, and Markdown rendering.
- Create `packages/application/src/certification/certification-metrics.test.ts` — peak/delta/missing-sample/threshold/summary tests.
- Create `packages/application/src/certification/run-certification.ts` — render/unload/settle orchestration and failure capture.
- Create `packages/application/src/certification/run-certification.test.ts` — phase-order and recovery tests.
- Create `packages/application/src/certification/index.ts` — certification-module exports.
- Modify `packages/application/src/index.ts` — export the certification module.
- Create `apps/render-worker/src/certification/preflight.ts` — approved-vs-live provenance, RTX 4090, and memory-mode checks.
- Create `apps/render-worker/src/certification/preflight.test.ts` — drift, unsupported-host, and flag-conflict tests.
- Create `apps/render-worker/src/certification/artifact-writer.ts` — collision-safe atomic JSON/Markdown directory publication.
- Create `apps/render-worker/src/certification/artifact-writer.test.ts` — temp-directory publication and failure tests.
- Create `apps/render-worker/src/cli/certify-ltx.ts` — argument parsing, dependency composition, exit-code mapping, and direct entry point.
- Create `apps/render-worker/src/cli/certify-ltx.test.ts` — CLI unit tests without a GPU or ComfyUI service.
- Modify `apps/render-worker/package.json` — local `certify:ltx` script and `tsx` development dependency.
- Modify `package.json` — root `certify:ltx` forwarding script.
- Modify `pnpm-lock.yaml` — lock the render-worker `tsx` dependency declaration.
- Create `docs/ltx-hardware-certification.md` — operator procedure, metric semantics, exit codes, and comparator rules.
- Modify `README.md` — link the operator guide and distinguish historical values from certification evidence.
- Create `certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json` — real target-host baseline evidence, only after all hardware stop conditions pass.
- Create `certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md` — human-readable view generated from that same result object.

## Task 1: Define the versioned certification artifact contract

**Files:**

- Create: `packages/contracts/src/ltx-certification.ts`
- Create: `packages/contracts/src/ltx-certification.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Behavioral invariants — write these named tests first:**

- `passed-artifact-is-complete` — a `passed` artifact is accepted only when the render and gate passed, raw samples are present, required measured peaks/deltas are non-null, and `failure` is null. Test case: `accepts a complete passed DynamicVRAM certification artifact`.
- `failed-artifact-keeps-evidence` — a `failed` artifact may retain partial samples and nullable aggregates, but must carry a structured phase/code/message and a failed gate. Test case: `accepts a failed render artifact with partial measured evidence`.
- `no-fabricated-success` — a success-shaped artifact with missing telemetry, a failed render, a failed gate, or a non-null failure is rejected. Test case: `rejects a passed artifact when required measured evidence is missing`.
- `workload-identity-is-pinned` — profile key/version, engine, width, height, frames, and steps use the exact certified LTX literals. Test case: `rejects an artifact for a different workload identity`.
- `mode-is-explicit` — runner mode is exactly `dynamicvram` or `highvram`; sample interval is a positive integer; hashes are lowercase SHA-256 strings; counters and memory values are finite and non-negative. Test case: `rejects invalid mode hashes intervals and counters`.

**Steps:**

- [ ] Add the five tests above using fixtures that contain two raw samples plus a post-unload sample. Assert both `safeParse(...).success` and the paths of important validation errors.
- [ ] Define and export Zod schemas and types for `CertificationGpuSampleSchema`, `CertificationGpuSample`, `CertificationHostSampleSchema`, `CertificationHostSample`, `CertificationTelemetrySampleSchema`, `CertificationTelemetrySample`, `CertificationEnvironmentSchema`, `CertificationEnvironment`, `CertificationGateSchema`, `CertificationGate`, `CertificationFailureSchema`, `CertificationFailure`, `LtxCertificationArtifactSchema`, and `LtxCertificationArtifact`.
- [ ] Make `LtxCertificationArtifactSchema` a discriminated union or a base schema with `superRefine` so success cannot be declared without observed data. Use this top-level shape as the implementation target:

```ts
type LtxCertificationArtifact = Readonly<{
  version: 1;
  runId: string;
  generatedAt: string;
  status: "passed" | "failed";
  runnerMode: "dynamicvram" | "highvram";
  identity: {
    profileId: "ltx-25-720p-97f";
    renderProfileKey: "LTX_25_720P_5S_V1";
    renderProfileVersion: 1;
    engine: "ltx_25";
    width: 1280;
    height: 720;
    frames: 97;
    steps: 8;
    workflowSha256: string;
    modelSha256: Readonly<Record<string, string>>;
    comfyUiCommit: string;
    customNodes: readonly {
      name: string;
      commit: string | null;
      status: "tracked" | "not_git" | "unavailable";
    }[];
  };
  environment: CertificationEnvironment;
  render: {
    executionId: string | null;
    status: "succeeded" | "failed" | "not_started";
    outputObjectKeys: readonly string[];
    startedAt: string | null;
    completedAt: string | null;
    totalDurationMs: number | null;
  };
  telemetry: {
    sampleIntervalMs: 200;
    samples: readonly CertificationTelemetrySample[];
    samplingErrors: readonly { measuredAt: string; message: string }[];
    peakVramMb: number | null;
    peakHostRamUsedMb: number | null;
    peakProcessRssMb: number | null;
    swapUsedDeltaMb: number | null;
    systemSwapInPageDelta: number | null;
    systemSwapOutPageDelta: number | null;
    systemMajorPageFaultDelta: number | null;
    systemMinorPageFaultDelta: number | null;
    processMajorPageFaultDelta: number | null;
    processMinorPageFaultDelta: number | null;
    postUnloadUsedVramMb: number | null;
    postUnloadFreeVramMb: number | null;
  };
  gate: CertificationGate;
  failure: CertificationFailure | null;
}>;
```

- [ ] Export all schemas and types from `packages/contracts/src/index.ts` and keep all time values ISO-8601 strings or integer milliseconds; do not add an unobservable sampling-duration field.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/contracts/src/ltx-certification.test.ts` — expected: the five contract tests pass.
- `pnpm exec eslint packages/contracts/src/ltx-certification.ts packages/contracts/src/ltx-certification.test.ts packages/contracts/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/contracts/src/ltx-certification.ts packages/contracts/src/ltx-certification.test.ts packages/contracts/src/index.ts` — expected: all three files conform.

**Commit:** `feat(contracts): define LTX certification artifact`

## Task 2: Implement NVIDIA memory telemetry

**Files:**

- Create: `packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts`
- Create: `packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Reference only: `packages/application/src/ports/gpu-telemetry-port.ts`

**Behavioral invariants — write these named tests first:**

- `selected-gpu-only` — one configured GPU index maps exactly one CSV row to total/used/free MB and an injected timestamp. Test case: `reads the configured GPU index as one GpuMemorySnapshot`.
- `strict-csv` — blank, short, extra-column, non-finite, negative, or internally inconsistent rows are rejected. Test case: `rejects malformed or inconsistent nvidia-smi memory output`.
- `telemetry-never-fabricates` — process launch errors, non-zero exits, and a missing selected GPU produce a descriptive telemetry error instead of zeros. Test case: `surfaces nvidia-smi execution and GPU-selection failures`.
- `documented-poll-command` — every read uses `nvidia-smi --query-gpu=memory.total,memory.used,memory.free --format=csv,noheader,nounits` and selects the configured row in-process. Test case: `invokes the documented nounits memory query`.

**Steps:**

- [ ] Add tests with an injected promise-based `execFile` function and injected `now`; cover Unix newlines and CRLF.
- [ ] Export a pure `parseNvidiaSmiMemoryCsv(stdout, gpuIndex)` and an `NvidiaSmiTelemetryAdapter` implementing the existing `GpuTelemetryPort` without changing that port.
- [ ] Validate `totalVramMb === usedVramMb + freeVramMb` within a one-MB rounding tolerance, preserve MiB-style values as the repository's `Mb` convention, and include the selected index and safe stderr excerpt in errors.
- [ ] Export the parser, adapter, options, and error type from `packages/infrastructure/src/index.ts`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts` — expected: valid output parses and all invalid/unavailable cases fail explicitly.
- `pnpm exec eslint packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.ts packages/infrastructure/src/telemetry/nvidia-smi-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: all files conform.

**Commit:** `feat(infrastructure): sample NVIDIA VRAM`

## Task 3: Add the host telemetry port and Linux adapter together

**Files:**

- Create: `packages/application/src/ports/host-telemetry-port.ts`
- Modify: `packages/application/src/ports/index.ts`
- Create: `packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts`
- Create: `packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts`
- Modify: `packages/infrastructure/src/index.ts`

**Behavioral invariants — write these named tests first:**

- `linux-units-are-normalized` — `/proc` kB values become MB consistently and `hostRamUsedMb` is `MemTotal - MemAvailable`. Test case: `normalizes meminfo RAM swap and RSS values to MB`.
- `counter-fields-are-exact` — `/proc/vmstat` `pswpin`/`pswpout`/`pgmajfault`/`pgfault` and `/proc/<pid>/stat` fields 10/12 are read as cumulative integer counters. Test case: `reads system swap activity and process page fault counters`.
- `process-identity-is-stable` — every snapshot verifies the configured PID still has the expected `/proc/<pid>/stat` start-time field, preventing PID reuse from mixing processes. Test case: `rejects telemetry when the configured process identity changes`.
- `required-source-failure-is-loud` — absent/malformed required keys or inaccessible process files reject the sample and never substitute zero. Test case: `rejects missing malformed or inaccessible proc telemetry`.

**Steps:**

- [ ] Define `HostTelemetrySnapshot` and `HostTelemetryPort.readHostMemory()` in the application port. Include total/available/used RAM, total/used swap, system swap-in/swap-out activity, system faults, process RSS, process faults, PID/start-time identity, and `measuredAt`.
- [ ] In the same task, implement every method of the new port in `LinuxHostTelemetryAdapter`; inject `readFile` and `now` for unit tests. Implement and export pure parsers `parseProcMeminfo`, `parseProcVmstat`, `parseProcPidStatus`, and `parseProcPidStat`.
- [ ] Parse `/proc/meminfo`, `/proc/vmstat`, `/proc/<pid>/status`, and the parenthesized-command-safe `/proc/<pid>/stat` format. Capture the process start time once in the constructor factory and verify it on subsequent samples.
- [ ] Export the new port from `packages/application/src/ports/index.ts` and the adapter/parsers (`LinuxHostTelemetryAdapter`, `parseProcMeminfo`, `parseProcVmstat`, `parseProcPidStatus`, `parseProcPidStat`) from `packages/infrastructure/src/index.ts`. This keeps the port and its only adapter type-correct in one commit.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts` — expected: unit normalization, counter extraction, PID-reuse rejection, and malformed input tests pass.
- `pnpm exec eslint packages/application/src/ports/host-telemetry-port.ts packages/application/src/ports/index.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/ports/host-telemetry-port.ts packages/application/src/ports/index.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.ts packages/infrastructure/src/telemetry/linux-host-telemetry-adapter.test.ts packages/infrastructure/src/index.ts` — expected: all files conform.

**Commit:** `feat(telemetry): read Linux host resource counters`

## Task 4: Record reproducible runner environment identity

**Files:**

- Create: `packages/infrastructure/src/telemetry/runner-environment.ts`
- Create: `packages/infrastructure/src/telemetry/runner-environment.test.ts`
- Modify: `packages/infrastructure/src/index.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `environment-is-observed` — Node, platform, architecture, kernel release/version, CPU model/count, GPU name/UUID/driver/total memory, CUDA version when observable, and ComfyUI PID/cmdline are collected from injected system sources. Test case: `collects the complete reproducibility environment record`.
- `argv-preserves-boundaries` — NUL-separated `/proc/<pid>/cmdline` becomes an ordered string array without shell re-parsing. Test case: `parses ComfyUI startup arguments without losing argument boundaries`.
- `unsupported-gpu-is-data` — the collector records the actual GPU identity; it does not rewrite a non-4090 name or decide pass/skip. Test case: `records the reported GPU identity verbatim`.
- `missing-identity-is-loud` — an unreadable cmdline or malformed GPU identity query rejects environment collection. Test case: `rejects incomplete GPU or ComfyUI process identity`.

**Steps:**

- [ ] Test an injected `os` facade, `readFile`, and `execFile` with deterministic timestamps and NVIDIA output.
- [ ] Implement `collectRunnerEnvironment` using `nvidia-smi --query-gpu=name,uuid,driver_version,memory.total --format=csv,noheader,nounits`, plus a plain `nvidia-smi` call only to extract its advertised CUDA version. Record `null` when the CUDA banner is genuinely absent.
- [ ] Read the ComfyUI command line from the required PID and return data matching `CertificationEnvironmentSchema`; do not infer or normalize its memory flags here.
- [ ] Export the collector and dependency/options types from `packages/infrastructure/src/index.ts`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/infrastructure/src/telemetry/runner-environment.test.ts` — expected: environment, argument-boundary, unsupported-name, and failure tests pass.
- `pnpm exec eslint packages/infrastructure/src/telemetry/runner-environment.ts packages/infrastructure/src/telemetry/runner-environment.test.ts packages/infrastructure/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/infrastructure/src/telemetry/runner-environment.ts packages/infrastructure/src/telemetry/runner-environment.test.ts packages/infrastructure/src/index.ts` — expected: all files conform.

**Commit:** `feat(telemetry): capture certification runner identity`

## Task 5: Build the non-overlapping telemetry sampler

**Files:**

- Create: `packages/application/src/certification/telemetry-sampler.ts`
- Create: `packages/application/src/certification/telemetry-sampler.test.ts`
- Create: `packages/application/src/certification/index.ts`
- Modify: `packages/application/src/index.ts`
- Reference only: `packages/application/src/ports/gpu-telemetry-port.ts`
- Reference only: `packages/application/src/ports/host-telemetry-port.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `start-samples-before-dispatch` — `start()` completes one tagged `pre_dispatch` sample before scheduling the next 200 ms sample. Test case: `captures a pre-dispatch sample before start resolves`.
- `one-sample-at-a-time` — if a read lasts longer than 200 ms, the loop does not overlap reads and schedules the next interval after the current attempt settles. Test case: `never overlaps telemetry reads when a sample is slow`.
- `sample-failure-recovers` — a GPU or host read error is timestamped in `samplingErrors`, the partial pair is discarded, and the next interval still runs. Test case: `records a sampling error and recovers on the next interval`.
- `stop-is-terminal` — `stop()` cancels the next timer, waits for the in-flight attempt, and no later sample can mutate the result. Test case: `drains the active sample and remains stopped`.
- `post-unload-is-explicit` — `sampleNow("post_unload")` creates a separately tagged paired sample after settling and before stop. Test case: `tags the explicit post-unload sample`.
- `invalid-transitions-throw` — calling `start()` while already `running`, `stopping`, or `stopped` throws an explicit invalid transition error; calling `sampleNow()` when not `running` throws an error; `stop()` is idempotent across all states. Test case: `rejects invalid state machine transitions and handles re-entrant calls`.
- `consecutive-error-budget-aborts` — when consecutive sampling errors reach the configured budget (default: 10), the sampler aborts further sampling loops and records a fatal failure in sampling errors. Test case: `aborts sampling when consecutive error budget is exceeded`.

**Steps:**

- [ ] Write the fake-timer tests with deferred promises covering all seven invariants including invalid transitions, idempotence, and consecutive error budget.
- [ ] Implement `TelemetrySampler` with explicit `idle | running | stopping | stopped` state machine. Enforce strict transition rules: `start()` transitions `idle -> running` and rejects if called in `running`, `stopping`, or `stopped`; `sampleNow()` requires `running` state and rejects otherwise; `stop()` transitions to `stopping -> stopped` and is idempotent across repeated calls. Implement a recursive injected `setTimeout` scheduler with 200 ms default, read dependencies for both ports, immutable result snapshots, consecutive sampling error threshold / budget (default: 10) before stopping further polling, and error recovery on transient failures below the threshold.
- [ ] Read GPU and host telemetry concurrently within one attempt, but do not retain an unpaired sample if either source fails. Bound error text and preserve no fabricated numeric values.
- [ ] Export sampler types and classes from `packages/application/src/certification/index.ts` and re-export that module from `packages/application/src/index.ts`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/application/src/certification/telemetry-sampler.test.ts` — expected: all loop, transition, error recovery, and budget tests pass with fake timers.
- `pnpm exec eslint packages/application/src/certification/telemetry-sampler.ts packages/application/src/certification/telemetry-sampler.test.ts packages/application/src/certification/index.ts packages/application/src/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/certification/telemetry-sampler.ts packages/application/src/certification/telemetry-sampler.test.ts packages/application/src/certification/index.ts packages/application/src/index.ts` — expected: all files conform.

**Commit:** `feat(application): sample certification telemetry`

## Task 6: Aggregate measurements and evaluate the resource gate

**Files:**

- Create: `packages/application/src/certification/certification-metrics.ts`
- Create: `packages/application/src/certification/certification-metrics.test.ts`
- Modify: `packages/application/src/certification/index.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `peaks-come-from-raw-samples` — peak VRAM, host RAM used, and process RSS are maxima over observed paired samples only. Test case: `calculates GPU and host peaks from raw samples`.
- `deltas-use-window-edges` — swap usage, swap-in/swap-out activity, and page-fault deltas are `last - first`, never negative, and process deltas require the same PID/start-time identity at both edges. Test case: `calculates non-negative host and process deltas across one stable process`.
- `missing-data-fails-the-gate` — empty samples, absent post-unload data, any sampling error, or missing required process values yield nullable aggregates and a failed check, not zero. Test case: `fails certification when required telemetry evidence is missing`.
- `duration-boundary-is-inclusive` — a successful non-OOM render at exactly 55,000 ms passes; 55,001 ms fails. Test case: `applies the inclusive 55 second LTX duration gate`.
- `summary-has-one-source` — Markdown fields are rendered exclusively from a parsed artifact and visibly label failed/null values. Test case: `renders JSON-equivalent measurements and failures in Markdown`.

**Steps:**

- [ ] Create focused fixtures for normal, missing, counter-reset, PID-change, timeout, OOM, and duration-boundary scenarios.
- [ ] Implement pure `aggregateCertificationTelemetry`, `evaluateLtxResourceGate`, and `renderCertificationSummary` functions. Return named check results for render success, no OOM, duration, telemetry completeness, and post-unload headroom evidence.
- [ ] Treat counter reset or PID identity change as unavailable evidence and a failed completeness check. Do not clamp it into a passing zero delta.
- [ ] Include historical 46 s/24,028 MB values only in an explicitly labeled comparison section; never use them as measured fields or pass conditions.
- [ ] Re-export the functions/types from the certification index, run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/application/src/certification/certification-metrics.test.ts` — expected: peak, delta, missing-data, failure, and threshold tests pass.
- `pnpm exec eslint packages/application/src/certification/certification-metrics.ts packages/application/src/certification/certification-metrics.test.ts packages/application/src/certification/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/certification/certification-metrics.ts packages/application/src/certification/certification-metrics.test.ts packages/application/src/certification/index.ts` — expected: all files conform.

**Commit:** `feat(application): evaluate LTX resource envelope`

## Task 7: Orchestrate render, cleanup, and failure evidence

**Files:**

- Create: `packages/application/src/certification/run-certification.ts`
- Create: `packages/application/src/certification/run-certification.test.ts`
- Modify: `packages/application/src/certification/index.ts`
- Reference only: `packages/application/src/ports/render-engine-port.ts`
- Reference only: `packages/application/src/certification/telemetry-sampler.ts`
- Reference only: `packages/application/src/certification/certification-metrics.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`

**Behavioral invariants — write these named tests first:**

- `ordered-success-path` — state transitions are `ready -> sampling -> rendering -> unloading -> settling -> final_sampling -> stopped -> completed`; telemetry starts before queueing and `/free` occurs only after a succeeded result. Test case: `runs the successful certification phases in order`.
- `failed-render-keeps-cleanup` — a failed result or render exception transitions to recovery, attempts `/free`, performs the bounded settle and final sample when possible, stops telemetry, and returns a failed artifact draft. Test case: `captures a failed render and still attempts cleanup evidence`.
- `timeout-is-not-thrown-away` — a render timeout becomes failure code `render_timeout` with the observed samples retained. Test case: `returns measured failure evidence when RenderEnginePort times out`.
- `cleanup-failure-cannot-pass` — unload, settle, final-sample, or sampler-stop failure is recorded and forces the gate to fail even when rendering succeeded. Test case: `fails the run when post-render cleanup evidence is incomplete`.
- `settle-is-bounded` — the injected sleep is called exactly once with 5,000 ms after an unload attempt and never becomes an unbounded poll. Test case: `uses the fixed five second post-unload settle window`.

**Steps:**

- [ ] Build fakes for `RenderEnginePort`, the sampler control surface, `sleep`, and `now`; assert call order rather than implementation details.
- [ ] Implement `runCertification` around one `queueRender()`/`getRenderResult()` pair. Start duration immediately before dispatch, use terminal completion time for duration, and preserve output object keys as paths/identifiers without claiming hashes.
- [ ] Put cleanup in an explicit recovery path that attempts each remaining safe step once. Combine a primary render failure and cleanup failure in structured details without replacing the primary cause.
- [ ] Return a validated artifact draft to the caller; reserve filesystem publication and process exit codes for the render-worker layer.
- [ ] Re-export the use case and dependency/input types, run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run packages/application/src/certification/run-certification.test.ts` — expected: success, failed render, timeout, cleanup failure, and settle-bound tests pass.
- `pnpm exec eslint packages/application/src/certification/run-certification.ts packages/application/src/certification/run-certification.test.ts packages/application/src/certification/index.ts` — expected: no errors.
- `pnpm exec prettier --check packages/application/src/certification/run-certification.ts packages/application/src/certification/run-certification.test.ts packages/application/src/certification/index.ts` — expected: all files conform.

**Commit:** `feat(application): orchestrate hardware certification`

## Task 8: Enforce Gold Master, hardware, and memory-mode preflight

**Files:**

- Create: `apps/render-worker/src/certification/preflight.ts`
- Create: `apps/render-worker/src/certification/preflight.test.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`
- Reference only: `templates/provenance.json`

**Behavioral invariants — write these named tests first:**

- `approved-and-live-identities-match` — profile ID, render-profile key/version, workflow SHA-256, and the complete keyed model-hash set must match exactly. Test case: `accepts identical approved and live LTX provenance`.
- `certified-workload-is-exact` — the loaded profile and its workflow assertions must resolve to engine `ltx_25`, 1280x720, 97 frames, and 8 steps before live provenance is accepted. Test case: `rejects a profile that is not the pinned 720p 97-frame 8-step workload`.
- `any-drift-refuses-dispatch` — a changed/missing/extra model hash or changed workflow hash is a preflight failure before telemetry/render calls. Test case: `rejects workflow or model hash drift before dispatch`.
- `approved-source-is-host-validated` — `authored_from_spec`, `unpinned`, wrong profile, absent render-profile identity, or malformed approved JSON is rejected. Test case: `rejects provenance that is not an immutable validated host export`.
- `target-gpu-is-exact` — only the selected NVIDIA GeForce RTX 4090 identity is certification-capable; unavailable NVIDIA tooling and other GPUs return an explicit unsupported result. Test case: `classifies missing or non-RTX-4090 hardware as unsupported`.
- `memory-flags-are-exclusive` — default mode rejects `--highvram`, `--lowvram`, `--novram`, `--gpu-only`, and other explicit VRAM-mode flags; comparator mode requires exactly `--highvram` and rejects every mutually exclusive companion. Test case: `enforces DynamicVRAM default and exclusive highvram comparator arguments`.

**Steps:**

- [ ] Add table-driven tests for identity drift and ComfyUI argument combinations. Include an assertion that the render dependency was never touched on any failure.
- [ ] Implement and export pure `verifyGoldMasterProvenance`, `classifyCertificationHardware`, and `verifyComfyUiMemoryMode` functions in `apps/render-worker/src/certification/preflight.ts`. Normalize neither hashes nor startup flags: exact identity is the safety property.
- [ ] Require the approved report to be a prior `CertificationProvenanceReport` with host-validated source metadata. Compare live data produced by the existing collector after it has independently enforced the profile's 100 GB disk reservation and checked-in workflow hash.
- [ ] Return typed `ready`, `unsupported`, or `refused` outcomes so the CLI can distinguish skip code 77 from configuration/integrity failure code 1 using `classifyCertificationHardware`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run apps/render-worker/src/certification/preflight.test.ts` — expected: exact-match, drift, source, GPU, and memory-mode tests pass.
- `pnpm exec eslint apps/render-worker/src/certification/preflight.ts apps/render-worker/src/certification/preflight.test.ts` — expected: no errors.
- `pnpm exec prettier --check apps/render-worker/src/certification/preflight.ts apps/render-worker/src/certification/preflight.test.ts` — expected: both files conform.

**Commit:** `feat(render-worker): enforce LTX certification preflight`

## Task 9: Publish JSON and Markdown artifacts atomically

**Files:**

- Create: `apps/render-worker/src/certification/artifact-writer.ts`
- Create: `apps/render-worker/src/certification/artifact-writer.test.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`
- Reference only: `packages/application/src/certification/certification-metrics.ts`

**Behavioral invariants — write these named tests first:**

- `same-result-two-formats` — `result.json` is the parsed artifact and `summary.md` is rendered from that exact in-memory object. Test case: `writes JSON and Markdown from the same validated artifact`.
- `run-id-cannot-escape-root` — only a conservative `[a-z0-9][a-z0-9._-]*` run ID is accepted; separators, traversal, control characters, and empty IDs are rejected. Test case: `rejects unsafe certification run IDs`.
- `existing-result-is-immutable` — if the final run directory exists, publication aborts without changing it. Test case: `refuses to overwrite an existing certification run`.
- `partial-publication-is-hidden` — files are written and synced in a sibling temporary directory, then the directory is renamed to the final path; on error only that owned temporary directory is removed. Test case: `does not expose a partial final artifact directory on write failure`.

**Steps:**

- [ ] Write tests under a Vitest-owned temporary directory using real filesystem calls and injected failing write/rename functions for the partial-publication case.
- [ ] Implement `writeCertificationArtifacts({ outputRoot, artifact })` with Zod parsing before writes, two-space/stable JSON plus trailing newline, generated Markdown plus trailing newline, `mkdir` collision checks, and an atomic same-filesystem directory rename.
- [ ] Return repository-relative result/summary paths for CLI output. Never delete or overwrite an existing final run directory.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run apps/render-worker/src/certification/artifact-writer.test.ts` — expected: same-source, unsafe-ID, collision, and atomic-failure tests pass.
- `pnpm exec eslint apps/render-worker/src/certification/artifact-writer.ts apps/render-worker/src/certification/artifact-writer.test.ts` — expected: no errors.
- `pnpm exec prettier --check apps/render-worker/src/certification/artifact-writer.ts apps/render-worker/src/certification/artifact-writer.test.ts` — expected: both files conform.

**Commit:** `feat(render-worker): publish certification evidence atomically`

## Task 10: Wire the certify:ltx CLI and package commands

**Files:**

- Create: `apps/render-worker/src/cli/certify-ltx.ts`
- Create: `apps/render-worker/src/cli/certify-ltx.test.ts`
- Modify: `apps/render-worker/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Reference only: `templates/provenance.json`
- Reference only: `templates/ltx_25_720p_97f_api.json`
- Reference only: `packages/infrastructure/src/comfyui/render-engine-adapter.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`

**Behavioral invariants — write these named tests first:**

- `preflight-precedes-side-effects` — arguments, approved report, profile/live provenance, disk, environment, GPU, and memory mode all pass before sampler start or render dispatch. Test case: `completes all preflight checks before starting telemetry or rendering`.
- `dynamicvram-is-default` — absent `--highvram` selects `dynamicvram`, while `--highvram` selects `highvram`; both require a unique explicit run ID and never share a destination. Test case: `defaults to DynamicVRAM and isolates highvram comparator output`.
- `hardware-unavailable-is-explicit-skip` — unavailable NVIDIA/RTX hardware exits 77, writes no passing artifact, and prints a clear reason; integrity/configuration/disk failures exit 1. Test case: `maps unsupported hardware to 77 and refused preflight to 1`.
- `render-outcome-is-published` — once dispatch begins, both passing and failed/timeout outcomes are published; exit is 0 only for a passing gate and 1 for a failed artifact. Test case: `publishes measured success and failure outcomes with truthful exit codes`.
- `direct-entry-is-testable` — importing the module has no process side effect, while direct execution sets `process.exitCode` from `runCertificationCli`. Test case: `does not execute the CLI when imported`.

**Steps:**

- [ ] Add parser tests for required `--comfyui-dir`, `--comfyui-url`, `--comfyui-pid`, `--gold-master-provenance`, and `--run-id`; optional `--manifest`, `--gpu-index`, `--output-root`, and `--highvram`; help; duplicates; unknown flags; invalid PIDs/indexes/run IDs; and positional arguments.
- [ ] Add orchestration tests with dependency injection. Assert that refusal paths never call sampler/render/writer, while post-dispatch failure calls the writer once with `status: "failed"`.
- [ ] Implement the CLI in this order: parse; load the exact `ltx-25-720p-97f` profile; read approved provenance; collect live provenance (including disk/hash/Git checks); collect environment; apply Task 8 preflight; read/parse the checked-in workflow; construct adapters/sampler/render engine; call `runCertification`; atomically write artifacts; print paths and gate summary.
- [ ] Use fixed defaults `templates/provenance.json`, `certification/ltx-25`, GPU index 0, sample interval 200 ms, render timeout 300,000 ms, and settle 5,000 ms. Defaults must resolve from module/repository location, not the caller's current directory.
- [ ] Add `"certify:ltx": "tsx src/cli/certify-ltx.ts"` and `tsx` to `apps/render-worker/package.json`; add root `"certify:ltx": "pnpm --filter render-worker certify:ltx"`; update `pnpm-lock.yaml` with pnpm rather than hand-editing it.
- [ ] Keep the hardware command out of generic test scripts. Unit tests use fixtures only and do not invoke `/free`, ComfyUI, `/proc`, or `nvidia-smi`.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run apps/render-worker/src/cli/certify-ltx.test.ts` — expected: parsing, ordering, mode, skip/failure, and publication tests pass without hardware.
- `pnpm exec eslint apps/render-worker/src/cli/certify-ltx.ts apps/render-worker/src/cli/certify-ltx.test.ts` — expected: no errors.
- `pnpm exec prettier --check apps/render-worker/src/cli/certify-ltx.ts apps/render-worker/src/cli/certify-ltx.test.ts apps/render-worker/package.json package.json pnpm-lock.yaml` — expected: all scoped files conform.
- `pnpm --filter render-worker certify:ltx -- --help` — expected: exit 0 and usage documents every flag without querying hardware.

**Commit:** `feat(render-worker): add LTX hardware certification CLI`

## Task 11: Document hardware operation and metric semantics

**Files:**

- Create: `docs/ltx-hardware-certification.md`
- Modify: `README.md`
- Reference only: `templates/README.md`

**Steps:**

- [ ] Document prerequisites, the required approved Gold Master report, required environment values, the exact default command, exit codes 0/1/77, output layout, and the rule that video outputs remain external while object keys/paths are recorded.
- [ ] Define each metric's semantics: 200 ms paired samples; MB derived from Linux kB and NVIDIA nounits values; system/process counters as window deltas; peak host used RAM as total minus available; process RSS from `VmRSS`; and post-unload VRAM as the explicit sample after a fixed five-second settle.
- [ ] Document that system-wide memory/swap/fault deltas assume an idle host, while process RSS/faults are bound to PID/start time. Explain that a sampling error or counter reset makes the run fail rather than becoming zero.
- [ ] Document DynamicVRAM as the first/default baseline. Give the comparator command with `--highvram` and a different run ID, and state that one comparator result cannot change production policy.
- [ ] Document the hardware acceptance checklist and current blocker: checked-in authored/unpinned provenance is not approved Gold Master evidence. No hardware-dependent issue checkbox is complete until the target-host artifacts exist and parse.
- [ ] Link the guide from `README.md`, run the scoped check, then commit.

**Acceptance/verification:**

- `pnpm exec prettier --check docs/ltx-hardware-certification.md README.md` — expected: both Markdown files conform.

**Commit:** `docs: add LTX certification runbook`

## Task 12: Produce the Trinidad DynamicVRAM certification evidence

**Files:**

- Create: `certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json`
- Create: `certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md`
- Reference only: `docs/ltx-hardware-certification.md`
- Reference only: `packages/contracts/src/ltx-certification.ts`
- Reference only: `packages/application/src/certification/certification-metrics.ts`
- Reference only: `apps/render-worker/package.json`

**Steps:**

- [ ] On the idle Trinidad host, confirm the approved issue-#6 provenance file is a validated host export with immutable workflow/model hashes, ComfyUI is running in default DynamicVRAM/workflow-managed mode, its PID is readable, at least 100 GB is free, and no target output directory exists. Stop immediately if any condition is false.
- [ ] Run exactly one baseline certification through the harness, with operator-provided environment values and the fixed non-overwriting run ID:

```bash
pnpm certify:ltx -- --comfyui-dir "$COMFYUI_DIR" --comfyui-url "$COMFYUI_URL" --comfyui-pid "$COMFYUI_PID" --gold-master-provenance "$LTX_GOLD_MASTER_PROVENANCE" --run-id trinidad-rtx4090-dynamicvram-v1
```

- [ ] Require exit 0. Inspect only the small JSON/Markdown artifacts, not the rendered video, and confirm the JSON reports the real RTX 4090, `dynamicvram`, matching approved hashes, 97 frames/8 steps identity, successful render, no OOM, duration at most 55,000 ms, non-null peak VRAM/host RAM/process RSS/swap usage/swap activity/page-fault measurements, raw samples, and a non-null post-unload sample.
- [ ] Validate the exact generated files against the contract and confirm the Markdown was derived from the JSON:

```bash
pnpm --filter render-worker exec tsx -e 'import { readFile } from "node:fs/promises"; import { LtxCertificationArtifactSchema } from "@cco/contracts"; import { renderCertificationSummary } from "@cco/application"; const path = "certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json"; const artifact = LtxCertificationArtifactSchema.parse(JSON.parse(await readFile(path, "utf8"))); const summary = await readFile("certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md", "utf8"); if (artifact.status !== "passed" || !artifact.gate.passed || summary !== renderCertificationSummary(artifact)) process.exit(1);'
```

- [ ] Commit only `result.json` and `summary.md`; do not add rendered media. Leave `--highvram` unexecuted unless the service is separately restarted/configured by an authorized operator and use a different run ID if it is later measured.

**Acceptance/verification:**

- `pnpm exec prettier --check certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/result.json certification/ltx-25/trinidad-rtx4090-dynamicvram-v1/summary.md` — expected: both evidence files conform.
- The exact contract-check command in the preceding step exits 0 — expected: the artifact is genuinely passing and the summary exactly matches its JSON source.

**Commit:** `certification: record Trinidad LTX DynamicVRAM envelope`

**Tests to add or update**

- New contract tests validate truthful passed/failed result shapes without hardware.
- New infrastructure tests cover NVIDIA CSV, `/proc` parsing, PID reuse, environment identity, and missing-source failures using injected fixtures.
- New application tests cover the 200 ms loop, no-overlap guarantee, recovery after sampling failures, state transitions, peak/delta calculations, missing samples, counter reset, timeout/failure evidence, post-unload cleanup, and the inclusive 55-second gate.
- New render-worker tests cover Gold Master drift rejection, target hardware and memory-mode policy, atomic output, CLI parsing, preflight ordering, exit codes, and distinct comparator results.
- No existing test file over 500 lines is expanded. Every new behavior gets a focused new test file, avoiding oversized updates to `collector.test.ts`, `profile-manifest.test.ts`, or `render-engine-adapter.test.ts`.
- The final hardware artifact is additionally contract-parsed and summary-compared, but this evidence step is not a substitute for the unit tests.

**Validation model**

Each implementation task makes its file-scoped test, lint, and formatting commands an acceptance criterion. The orchestrator's workspace-wide typecheck and dedicated validate phase still run automatically; they are not repeated as a standalone plan task or as unscoped manifest commands. The hardware command is deliberately excluded from generic CI and runs only in Task 12 on Trinidad with approved identity inputs.

**Risk areas**

- Spawning `nvidia-smi` every 200 ms may perturb CPU/host measurements or miss a very narrow VRAM peak. Preserve the interval and raw sampling errors in the artifact; if measured sampler latency consistently approaches 200 ms, stop and redesign around a persistent NVIDIA stream rather than quietly lowering fidelity.
- `/proc` counters are cumulative and system-wide values are noisy on a busy host. The runbook must require an idle machine, while PID/start-time checks protect process metrics from PID reuse.
- ComfyUI is persistent and the CLI performs irreversible external actions by queueing a real render and posting `/free`. Preflight must finish before either action, and recovery must never retry the render.
- A process can be labeled `--highvram` incorrectly if only CLI input is trusted. Always verify `/proc/<pid>/cmdline`, enforce mutual exclusion, and store the observed arguments.
- Two artifact files can diverge if separately assembled. Validate one in-memory artifact and derive both files from it inside one atomic publication operation.
- Existing issue-#6 assets are not yet a validated host export. Accepting them would falsely certify an authored workflow; the real run remains blocked until approved immutable provenance exists.
- The existing render result exposes output object keys, not content hashes. Record those identifiers truthfully and do not claim output hashes unless a later port supplies measured hashes.
- Automatic workspace typechecking runs after each task. In particular, Task 3 deliberately adds `HostTelemetryPort` and its Linux implementation/exports together so no port-only commit leaves adapters behind.

**Stop conditions**

- Abort before implementation if the task requires editing files outside the affected list or changing the workflow/model content; revise the plan instead.
- Abort a real run if approved Gold Master provenance is missing, authored/unpinned, malformed, or differs from the live workflow/model set. Never generate or copy hashes merely to make the run pass.
- Abort a real run if the selected GPU is not the target RTX 4090, `nvidia-smi` is unavailable, Linux `/proc` or the configured ComfyUI PID is unreadable, the PID identity changes, or ComfyUI startup arguments do not match the selected mode.
- Abort before dispatch if the existing provenance collector reports less than 100 GB available, hash drift, missing models, Git identity failure, or invalid workflow JSON.
- Abort publication if the run directory already exists or any artifact fails `LtxCertificationArtifactSchema`; never overwrite prior certification evidence.
- Record a failed artifact and stop after dispatch if render execution times out/fails/OOMs, telemetry has missing/error samples, `/free` fails, counters reset, the process identity changes, or post-unload sampling fails. Do not retry the certified render under the same run ID.
- Do not mark the issue complete if Task 12 cannot run on Trinidad or if its artifact does not pass the contract and <=55-second gate. Report the hardware/provenance blocker explicitly instead.

**Risk classification rationale**

This plan requires review because it contains a timed sampling loop with recovery after read failures, an explicit multi-phase certification state machine, and external side effects that queue a ComfyUI render and invoke `/free`.
