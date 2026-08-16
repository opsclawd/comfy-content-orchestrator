# Task Context: Task 1

Title: Define the versioned certification artifact contract
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-7
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-7
Start Commit: 27bbf2d699970a5f188cd3e8acf284c622494c3a

## Task Requirements

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

## Repository Targets

### Expected Files
- packages/contracts/src/ltx-certification.ts
- packages/contracts/src/ltx-certification.test.ts
- packages/contracts/src/index.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/contracts/src/ltx-certification.test.ts"]
["pnpm","exec","eslint","packages/contracts/src/ltx-certification.ts","packages/contracts/src/ltx-certification.test.ts","packages/contracts/src/index.ts"]
["pnpm","exec","prettier","--check","packages/contracts/src/ltx-certification.ts","packages/contracts/src/ltx-certification.test.ts","packages/contracts/src/index.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **passed-artifact-is-complete**: A passed artifact is valid only with a successful render and gate, raw samples, required non-null measurements, and no failure. (Test: `accepts a complete passed DynamicVRAM certification artifact`)
- **failed-artifact-keeps-evidence**: A failed artifact may retain partial evidence but must have a structured failure and failed gate. (Test: `accepts a failed render artifact with partial measured evidence`)
- **no-fabricated-success**: Missing telemetry, render failure, gate failure, or a non-null failure cannot be represented as passed. (Test: `rejects a passed artifact when required measured evidence is missing`)
- **workload-identity-is-pinned**: Profile key, version, engine, dimensions, frame count, and step count are exact LTX certification literals. (Test: `rejects an artifact for a different workload identity`)
- **mode-is-explicit**: Mode, hash, interval, memory, and counter fields accept only the explicit finite domain described by the contract. (Test: `rejects invalid mode hashes intervals and counters`)

