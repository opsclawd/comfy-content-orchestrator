<!-- plan-review-required -->
# Application Ports, Scene Use Cases, and RenderProfile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable render/review contracts, focused application ports, and transactionally tested Scene lifecycle use cases that delegate all transition legality to the existing domain aggregate.

**Architecture:** `packages/contracts` owns Zod-backed process-boundary schemas and inferred DTO types. `packages/application` owns capability ports and thin use-case classes; review actions run through one `UnitOfWork` callback containing both the `ReviewEventStore.append` and `SceneRepository.save` operations, while production transitions use the same transaction boundary without emitting review events. In-memory implementations live under application test support and stage writes until the callback succeeds so tests can prove atomic behavior without infrastructure imports.

**Tech Stack:** TypeScript 5.7, pnpm workspaces, Zod, Vitest, ESLint, Prettier, Dependency Cruiser.

---

## Goal

- Define small application-layer ports without importing infrastructure or exposing provider-specific/ComfyUI payloads.
- Expose the currently required Scene review and production transitions as primitive-input use cases.
- Persist review events and Scene changes atomically for review actions.
- Define and validate a versioned `RenderProfile`, including the measured LTX baseline and explicit uncertified host-memory fields.

## Non-goals

- Do not add PostgreSQL, ComfyUI, MinIO, NVML, cloud-provider, filesystem, HTTP, WebSocket, or child-process implementations.
- Do not change `packages/domain/src/scene.ts` or duplicate its transition matrix in application code.
- Do not add retry, fallback, provider selection, worker leasing, render-job creation, campaign progress, or manifest construction behavior.
- Do not invent workflow hashes, model hashes, host-RAM measurements, swap measurements, or page-fault measurements.
- Do not expose persistence rows or raw ComfyUI graphs/events through contracts or ports.

## Assumptions and design choices

- `SceneRepository.findById` returns the aggregate instance and `save` persists it; a missing aggregate is reported as an application `SceneNotFoundError`.
- The `UnitOfWork` supplies transaction-scoped `scenes` and `reviewEvents` ports. This keeps transaction context out of repository method signatures and makes it impossible for a review use case to accidentally use an unscoped repository.
- Review event IDs and timestamps are supplied as primitive inputs by the composition root. The application layer does not generate UUIDs or read the system clock.
- Director `approve`, `reroll`, creative edits, QA accept/reject, and `cancel` are audited. Candidate generation, queue/render/submit, failure, and recovery transitions are operational actions and do not append director review events.
- The transport `ReviewAction` values remain those in PRD section 5.3. Prior and resulting states disambiguate director approval from QA acceptance when both use `approve`.
- Unknown host certification values are represented as `null`, not omitted and not fabricated. `measuredSamplingDurationMs` and `measuredDiskFootprintGb` store the PRD approximations as numeric measurements (`12000`, `68.8`).
- Zod is added only to `@cco/contracts`, matching the PRD's schema examples and keeping runtime boundary validation out of the domain.

## Affected files

### Contracts

- `packages/contracts/package.json`
- `pnpm-lock.yaml`
- `packages/contracts/src/render-profile.ts`
- `packages/contracts/src/render-profile.test.ts`
- `packages/contracts/src/scene-review.ts`
- `packages/contracts/src/scene-review.test.ts`
- `packages/contracts/src/index.ts`

### Application ports and test support

- `packages/application/src/ports/scene-repository.ts`
- `packages/application/src/ports/review-event-store.ts`
- `packages/application/src/ports/unit-of-work.ts`
- `packages/application/src/ports/render-engine-port.ts`
- `packages/application/src/ports/gpu-telemetry-port.ts`
- `packages/application/src/ports/campaign-repository.ts`
- `packages/application/src/ports/render-job-repository.ts`
- `packages/application/src/ports/manifest-repository.ts`
- `packages/application/src/ports/license-registry-repository.ts`
- `packages/application/src/ports/planner-port.ts`
- `packages/application/src/ports/candidate-ranker-port.ts`
- `packages/application/src/ports/voice-synthesis-port.ts`
- `packages/application/src/ports/media-assembler-port.ts`
- `packages/application/src/ports/object-storage-port.ts`
- `packages/application/src/ports/ports.test.ts`
- `packages/application/src/ports/index.ts`
- `packages/application/src/test-support/in-memory-scene-unit-of-work.ts`
- `packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts`
- `packages/application/src/index.ts`

### Application use cases

- `packages/application/src/use-cases/scene-not-found-error.ts`
- `packages/application/src/use-cases/review-scene.ts`
- `packages/application/src/use-cases/review-scene.test.ts`
- `packages/application/src/use-cases/progress-scene-production.ts`
- `packages/application/src/use-cases/progress-scene-production.test.ts`
- `packages/application/src/use-cases/index.ts`

## Behavioral invariants

The exact invariant names below are also the Vitest case names and the manifest's `test_case_name` values.

- RenderProfile parsing accepts the measured LTX values only when hashes, positive limits, and explicit nullable host fields are structurally valid; invalid input is rejected rather than coerced.
- A failed unit-of-work callback publishes none of its staged Scene saves or review events.
- Every valid review action performs exactly one domain transition, appends exactly one event with matching before/after states, and saves exactly once in the same successful unit of work.
- Invalid or missing-scene review actions commit neither event nor Scene save.
- Approved-scene creative mutations advance the revision, remove approval, return to `director_review`, and audit only the changed field/value.
- Production actions persist valid domain transitions without emitting director review events; invalid or missing-scene actions do not save.

## Task 1: Add stable RenderProfile and scene-review contracts

**Files:**

- Modify: `packages/contracts/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/contracts/src/render-profile.ts`
- Create: `packages/contracts/src/render-profile.test.ts`
- Create: `packages/contracts/src/scene-review.ts`
- Create: `packages/contracts/src/scene-review.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Reference only: `docs/prd.md` sections 3.6.5, 4.3, and 5.3

**Behavioral invariants / tests first:**

- `accepts the measured LTX 2.5 baseline with uncertified host memory fields set to null`
- `rejects a render profile when maxConcurrentGpuJobs is not positive`
- `rejects malformed workflow and model SHA-256 hashes`
- `requires explicit nulls for host measurements that are not yet certified`
- `accepts every canonical scene status and review action`
- `rejects review events whose prior or resulting status is not canonical`

- [ ] **Step 1: Add the contract dependency and lockfile entry.**

Run:

```bash
pnpm --filter @cco/contracts add zod@^3.24.1
```

Expected: `packages/contracts/package.json` gains a runtime `zod` dependency and `pnpm-lock.yaml` records the resolved package without changing unrelated workspace dependencies.

- [ ] **Step 2: Write the failing contract tests.**

Create fixtures with synthetic hashes such as `"a".repeat(64)` and `"b".repeat(64)`; these are schema fixtures, not certified production hashes. The accepted profile fixture must contain exactly the known values below and explicit `null` host fields:

```ts
const measuredLtxFixture = {
  key: "LTX_25_720P_5S_V1",
  version: 1,
  engine: "ltx_25",
  workflowHash: "a".repeat(64),
  modelHashes: { checkpoint: "b".repeat(64), textEncoder: "c".repeat(64), vae: "d".repeat(64) },
  frames: 97,
  steps: 8,
  runnerProfile: "dynamicvram-offload-v1",
  measuredPeakVramMb: 24028,
  measuredTotalDurationMs: 46000,
  measuredSamplingDurationMs: 12000,
  measuredDiskFootprintGb: 68.8,
  measuredPeakHostRamMb: null,
  measuredPeakProcessRssMb: null,
  measuredSwapUsedMb: null,
  measuredMajorPageFaults: null,
  minFreeDiskGb: 100,
  maxConcurrentGpuJobs: 1,
  requiresModelOffloading: true
};
```

Run:

```bash
pnpm exec vitest run packages/contracts/src/render-profile.test.ts packages/contracts/src/scene-review.test.ts
```

Expected: FAIL because the schemas and exports do not exist.

- [ ] **Step 3: Implement the schemas and inferred types.**

`render-profile.ts` must export `RenderProfileSchema` and `RenderProfile`. Use a lowercase 64-character hexadecimal schema for every hash, `z.number().int().positive()` for integer counts/durations, positive finite numeric validation for disk footprint, `z.literal(1)` for the initial schema version, `z.literal("LTX_25_720P_5S_V1")` for the initial key, and `z.number().int().nonnegative().nullable()` for each uncertified host metric. Use `z.record(hashSchema)` for named model-component hashes so later LoRA hashes are supported without changing the contract.

`scene-review.ts` must define and export the complete stable transport surface:

```ts
export const SCENE_STATUSES = [
  "draft_pending", "generating_candidates", "director_review", "approved", "queued",
  "rendering", "qa", "completed", "failed", "cancelled"
] as const;

export const REVIEW_ACTIONS = [
  "approve", "reject", "reroll", "prompt_edit", "reference_change", "engine_change",
  "duration_change", "lora_tune", "reorder", "duplicate", "cancel"
] as const;
```

Build `SceneStatusSchema` and `ReviewActionSchema` from those tuples. `ReviewEventSchema` contains `eventId`, `sceneId`, `reviewerName`, `action`, optional `directorNotes`, `mutationPayload: z.record(z.string(), z.unknown())`, `priorSceneStatus`, `resultingSceneStatus`, and ISO-datetime `occurredAt`; export the inferred `SceneStatus`, `ReviewAction`, and `ReviewEvent` types. Keep transport IDs as validated non-empty strings so the contract does not import domain brands or prematurely require database UUID persistence.

Update `packages/contracts/src/index.ts` to retain `contractsName` and export both modules via NodeNext `.js` specifiers.

- [ ] **Step 4: Run focused checks and commit.**

Run:

```bash
pnpm exec vitest run packages/contracts/src/render-profile.test.ts packages/contracts/src/scene-review.test.ts
pnpm --filter @cco/contracts typecheck
pnpm exec eslint packages/contracts/src/render-profile.ts packages/contracts/src/render-profile.test.ts packages/contracts/src/scene-review.ts packages/contracts/src/scene-review.test.ts packages/contracts/src/index.ts
pnpm exec prettier --check packages/contracts/package.json pnpm-lock.yaml packages/contracts/src/render-profile.ts packages/contracts/src/render-profile.test.ts packages/contracts/src/scene-review.ts packages/contracts/src/scene-review.test.ts packages/contracts/src/index.ts
pnpm exec depcruise packages/contracts/src/render-profile.ts packages/contracts/src/scene-review.ts packages/contracts/src/index.ts --config .dependency-cruiser.cjs
```

Expected: tests pass; the contracts package typechecks; lint/format pass; Dependency Cruiser reports no forbidden dependency from contracts.

Commit:

```bash
git add packages/contracts/package.json pnpm-lock.yaml packages/contracts/src/render-profile.ts packages/contracts/src/render-profile.test.ts packages/contracts/src/scene-review.ts packages/contracts/src/scene-review.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): define render and review schemas"
```

## Task 2: Define transactional Scene ports and in-memory implementations

**Files:**

- Create: `packages/application/src/ports/scene-repository.ts`
- Create: `packages/application/src/ports/review-event-store.ts`
- Create: `packages/application/src/ports/unit-of-work.ts`
- Create: `packages/application/src/ports/index.ts`
- Create: `packages/application/src/test-support/in-memory-scene-unit-of-work.ts`
- Create: `packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts`
- Modify: `packages/application/src/index.ts`
- Reference only: `packages/domain/src/scene.ts`
- Reference only: `packages/contracts/src/scene-review.ts`

This task intentionally keeps each new port method and every current implementation of it in one commit. No concrete infrastructure adapter exists yet.

**Behavioral invariants / tests first:**

- `commits one staged scene save and review event when the unit of work succeeds`
- `publishes no staged scene saves or review events when the unit of work callback throws`
- `returns undefined without recording a save when a scene is absent`

- [ ] **Step 1: Write the failing in-memory transaction tests.**

Seed a `Scene`, execute a callback through the fake UoW, call `context.scenes.save(scene)` and `context.reviewEvents.append(event)`, and assert committed save/event collections remain empty until the callback resolves. In the rollback case, throw after staging both writes and assert both committed collections remain empty.

Run:

```bash
pnpm exec vitest run packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts
```

Expected: FAIL because the ports and fake UoW do not exist.

- [ ] **Step 2: Define the three transaction-facing ports.**

Use these complete capability shapes:

```ts
export interface SceneRepository {
  findById(sceneId: SceneId): Promise<Scene | undefined>;
  save(scene: Scene): Promise<void>;
}

export interface ReviewEventStore {
  append(event: ReviewEvent): Promise<void>;
}

export interface UnitOfWorkContext {
  readonly scenes: SceneRepository;
  readonly reviewEvents: ReviewEventStore;
}

export interface UnitOfWork {
  execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult>;
}
```

Use type-only imports. `ports/index.ts` exports these modules, and the application root exports `./ports/index.js` while preserving `applicationName`.

- [ ] **Step 3: Implement the deterministic in-memory ports.**

`InMemorySceneUnitOfWork` must accept seeded `Scene` instances keyed by `SceneId`, expose read-only committed `savedScenes` and `reviewEvents` arrays for assertions, and create fresh staging arrays on each `execute`. Its scoped repository reads seeded scenes, stages `save` calls, and its event store stages `append` calls. Only concatenate both staging arrays into committed collections after `work` resolves; rethrow unchanged and discard both arrays when it rejects. Do not attempt to emulate aggregate rollback by cloning private Scene fields—the observable atomic guarantee is that neither persistence call becomes committed.

- [ ] **Step 4: Run focused checks and commit.**

Run:

```bash
pnpm exec vitest run packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts
pnpm --filter @cco/application typecheck
pnpm exec eslint packages/application/src/ports/scene-repository.ts packages/application/src/ports/review-event-store.ts packages/application/src/ports/unit-of-work.ts packages/application/src/ports/index.ts packages/application/src/test-support/in-memory-scene-unit-of-work.ts packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts packages/application/src/index.ts
pnpm exec prettier --check packages/application/src/ports/scene-repository.ts packages/application/src/ports/review-event-store.ts packages/application/src/ports/unit-of-work.ts packages/application/src/ports/index.ts packages/application/src/test-support/in-memory-scene-unit-of-work.ts packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts packages/application/src/index.ts
pnpm exec depcruise packages/application/src/ports packages/application/src/test-support packages/application/src/index.ts --config .dependency-cruiser.cjs
```

Expected: fake transaction tests and skeleton test pass; application typecheck/lint/format pass; no application-to-infrastructure dependency is reported.

Commit:

```bash
git add packages/application/src/ports/scene-repository.ts packages/application/src/ports/review-event-store.ts packages/application/src/ports/unit-of-work.ts packages/application/src/ports/index.ts packages/application/src/test-support/in-memory-scene-unit-of-work.ts packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts packages/application/src/index.ts
git commit -m "feat(application): define transactional scene ports"
```

## Task 3: Define remaining focused application capability ports

**Files:**

- Create: `packages/application/src/ports/render-engine-port.ts`
- Create: `packages/application/src/ports/gpu-telemetry-port.ts`
- Create: `packages/application/src/ports/campaign-repository.ts`
- Create: `packages/application/src/ports/render-job-repository.ts`
- Create: `packages/application/src/ports/manifest-repository.ts`
- Create: `packages/application/src/ports/license-registry-repository.ts`
- Create: `packages/application/src/ports/planner-port.ts`
- Create: `packages/application/src/ports/candidate-ranker-port.ts`
- Create: `packages/application/src/ports/voice-synthesis-port.ts`
- Create: `packages/application/src/ports/media-assembler-port.ts`
- Create: `packages/application/src/ports/object-storage-port.ts`
- Create: `packages/application/src/ports/ports.test.ts`
- Modify: `packages/application/src/ports/index.ts`
- Reference only: `docs/prd.md` section 3.6.4
- Reference only: `packages/contracts/src/render-profile.ts`

No adapter implements these new ports in the current repository, so no adapter edit is required in this task. The implementer must re-run `rg -n "implements (RenderEnginePort|GpuTelemetryPort|CampaignRepository|RenderJobRepository|ManifestRepository|LicenseRegistryRepository|PlannerPort|CandidateRankerPort|VoiceSynthesisPort|MediaAssemblerPort|ObjectStoragePort)" packages apps` before editing; if a match exists by implementation time, bring that adapter into this same task or stop and re-plan.

- [ ] **Step 1: Add compile-time port contract tests before implementation.**

Create `packages/application/src/ports/ports.test.ts` with typed object literals using `satisfies` for every port and one runtime assertion per capability family. The test must demonstrate that render queue input uses `renderProfileKey` and semantic IDs only, render results contain semantic status/output locators rather than ComfyUI events, telemetry returns memory measurements, storage uses an object locator, and placeholder provider/media ports are generic over request/result rather than naming providers.

Run:

```bash
pnpm exec vitest run packages/application/src/ports/ports.test.ts
```

Expected: FAIL because the port exports do not exist.

- [ ] **Step 2: Define render and telemetry capabilities.**

Use provider-neutral types and methods:

```ts
export interface QueueRenderInput {
  readonly renderJobId: string;
  readonly sceneId: string;
  readonly renderProfileKey: string;
}
export interface RenderQueueReceipt { readonly executionId: string; readonly acceptedAt: string; }
export interface RenderResult {
  readonly executionId: string;
  readonly status: "succeeded" | "failed";
  readonly outputObjectKeys: readonly string[];
  readonly completedAt: string;
  readonly errorCode?: string;
}
export interface RenderEnginePort {
  queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt>;
  getRenderResult(executionId: string): Promise<RenderResult | undefined>;
  unloadModels(): Promise<void>;
}

export interface GpuMemorySnapshot {
  readonly totalVramMb: number;
  readonly usedVramMb: number;
  readonly freeVramMb: number;
  readonly measuredAt: string;
}
export interface GpuTelemetryPort { readMemory(): Promise<GpuMemorySnapshot>; }
```

Do not add retry, polling, headroom decisions, raw ComfyUI prompt IDs, node graphs, or NVML structures.

- [ ] **Step 3: Define repository and deferred capability ports.**

Keep not-yet-modeled aggregates generic and avoid persistence record types:

```ts
export interface CampaignRepository<TCampaign> {
  findById(campaignId: string): Promise<TCampaign | undefined>;
  save(campaign: TCampaign): Promise<void>;
}
export interface RenderJobRepository<TRenderJob> {
  findById(renderJobId: string): Promise<TRenderJob | undefined>;
  save(renderJob: TRenderJob): Promise<void>;
}
export interface ManifestRepository<TManifest> {
  findByJobId(renderJobId: string): Promise<TManifest | undefined>;
  append(manifest: TManifest): Promise<void>;
}
export interface LicenseRegistryRepository<TLicenseRecord> {
  findByComponentKey(componentKey: string): Promise<TLicenseRecord | undefined>;
}
```

Define `PlannerPort<TInput, TOutput>.plan`, `CandidateRankerPort<TCandidate, TContext>.rank`, `VoiceSynthesisPort<TInput, TOutput>.synthesize`, and `MediaAssemblerPort<TInput, TOutput>.assemble` as one-method generic capability interfaces. Define `ObjectLocator`, `PutObjectInput`, `StoredObject`, and `ObjectStoragePort.putObject/getObject`; use `Uint8Array` for bytes and bucket/key/checksum values rather than URLs. Export every module from `ports/index.ts`.

- [ ] **Step 4: Run focused checks and commit.**

Run:

```bash
pnpm exec vitest run packages/application/src/ports/ports.test.ts
pnpm --filter @cco/application typecheck
pnpm exec eslint packages/application/src/ports/render-engine-port.ts packages/application/src/ports/gpu-telemetry-port.ts packages/application/src/ports/campaign-repository.ts packages/application/src/ports/render-job-repository.ts packages/application/src/ports/manifest-repository.ts packages/application/src/ports/license-registry-repository.ts packages/application/src/ports/planner-port.ts packages/application/src/ports/candidate-ranker-port.ts packages/application/src/ports/voice-synthesis-port.ts packages/application/src/ports/media-assembler-port.ts packages/application/src/ports/object-storage-port.ts packages/application/src/ports/ports.test.ts packages/application/src/ports/index.ts
pnpm exec prettier --check packages/application/src/ports/render-engine-port.ts packages/application/src/ports/gpu-telemetry-port.ts packages/application/src/ports/campaign-repository.ts packages/application/src/ports/render-job-repository.ts packages/application/src/ports/manifest-repository.ts packages/application/src/ports/license-registry-repository.ts packages/application/src/ports/planner-port.ts packages/application/src/ports/candidate-ranker-port.ts packages/application/src/ports/voice-synthesis-port.ts packages/application/src/ports/media-assembler-port.ts packages/application/src/ports/object-storage-port.ts packages/application/src/ports/ports.test.ts packages/application/src/ports/index.ts
pnpm exec depcruise packages/application/src/ports/render-engine-port.ts packages/application/src/ports/gpu-telemetry-port.ts packages/application/src/ports/campaign-repository.ts packages/application/src/ports/render-job-repository.ts packages/application/src/ports/manifest-repository.ts packages/application/src/ports/license-registry-repository.ts packages/application/src/ports/planner-port.ts packages/application/src/ports/candidate-ranker-port.ts packages/application/src/ports/voice-synthesis-port.ts packages/application/src/ports/media-assembler-port.ts packages/application/src/ports/object-storage-port.ts packages/application/src/ports/index.ts --config .dependency-cruiser.cjs
```

Expected: port contract tests pass; application typecheck/lint/format pass; Dependency Cruiser finds no provider/infrastructure dependency.

Commit:

```bash
git add packages/application/src/ports
git commit -m "feat(application): define orchestration capability ports"
```

## Task 4: Implement transactional Scene review use cases

**Files:**

- Create: `packages/application/src/use-cases/scene-not-found-error.ts`
- Create: `packages/application/src/use-cases/review-scene.ts`
- Create: `packages/application/src/use-cases/review-scene.test.ts`
- Create: `packages/application/src/use-cases/index.ts`
- Modify: `packages/application/src/index.ts`
- Reference only: `packages/domain/src/scene.ts`
- Reference only: `packages/contracts/src/scene-review.ts`
- Reference only: `packages/application/src/ports/unit-of-work.ts`
- Reference only: `packages/application/src/test-support/in-memory-scene-unit-of-work.ts`

**Behavioral invariants / tests first:**

- `approve: director_review transitions to approved, appends approve event, and saves atomically`
- `reroll: director_review transitions to generating_candidates and records reroll`
- `configuration edit: approved invalidates approval, advances revision, and records only the changed field`
- `qa decisions: qa accept completes and qa reject returns to director_review with audit events`
- `cancel: a cancellable scene becomes cancelled and records a cancel event`
- `invalid review transition commits neither a scene save nor a review event`
- `missing review scene throws SceneNotFoundError and commits no writes`
- `review event append failure commits neither the event nor the scene save`

- [ ] **Step 1: Write all named failing tests.**

Use the in-memory UoW and domain methods only for fixture setup. Cover all five creative mutation methods in a table (`prompt_edit`, `reference_change`, `engine_change`, `duration_change`, `lora_tune`) and assert each event's `mutationPayload` contains only its changed property. For valid paths, assert one UoW execution, one committed event, one committed save, and event states equal the domain transition's `from`/`to`. For invalid transitions and missing scenes, assert the original domain/application error and empty committed collections. For append failure, define a task-local `UnitOfWork` stub inside `review-scene.test.ts` whose scoped event store rejects and whose save spy proves it was never called; do not modify the earlier test-support fake in this task.

Run:

```bash
pnpm exec vitest run packages/application/src/use-cases/review-scene.test.ts
```

Expected: FAIL because the use-case class and error do not exist.

- [ ] **Step 2: Add the application error and primitive input DTOs.**

`SceneNotFoundError` extends `Error`, has `name = "SceneNotFoundError"`, exposes the requested string `sceneId`, and uses `Scene '<id>' was not found.` as its stable message.

In `review-scene.ts`, define a shared audit input containing `sceneId`, `eventId`, `reviewerName`, `occurredAt`, and optional `directorNotes`; extend it with the value needed by each mutation. Expose methods on `ReviewSceneUseCases`: `approve`, `requestReroll`, `updatePrompt`, `updateReferences`, `updateEngine`, `updateDuration`, `updateLora`, `acceptQA`, `rejectQA`, and `cancel`. Inputs contain primitives/read-only primitive arrays only; use `sceneId as SceneId` at the repository boundary.

- [ ] **Step 3: Implement the minimal transactional orchestration.**

Each public method calls one private helper with a domain transition callback, canonical `ReviewAction`, and mutation payload. Inside `uow.execute`: load the Scene, throw `SceneNotFoundError` before any write if absent, capture the pre-transition status, invoke exactly one existing `Scene` method, construct and validate a `ReviewEvent` with `ReviewEventSchema.parse`, append it, then save the Scene. Return `void`; do not catch or translate domain errors, and do not pre-encode the transition matrix.

The success order inside the callback is:

```ts
const scene = await context.scenes.findById(sceneId as SceneId);
if (scene === undefined) throw new SceneNotFoundError(sceneId);
const priorSceneStatus = scene.status;
const transition = apply(scene);
const event = ReviewEventSchema.parse({ /* supplied audit fields, action, payload, prior/result */ });
await context.reviewEvents.append(event);
await context.scenes.save(scene);
```

QA acceptance maps to `approve`; QA rejection maps to `reject`. Creative mutation payload keys are exactly `prompt`, `referenceIds`, `engineProfileId`, `durationMs`, and `loraConfigurationId`; an explicit `null` removes the optional LoRA by calling `scene.updateLora(undefined)`.

Export the error and class from `use-cases/index.ts`, and export that barrel from the application root.

- [ ] **Step 4: Run focused checks and commit.**

Run:

```bash
pnpm exec vitest run packages/application/src/use-cases/review-scene.test.ts
pnpm --filter @cco/application typecheck
pnpm exec eslint packages/application/src/use-cases/scene-not-found-error.ts packages/application/src/use-cases/review-scene.ts packages/application/src/use-cases/review-scene.test.ts packages/application/src/use-cases/index.ts packages/application/src/index.ts
pnpm exec prettier --check packages/application/src/use-cases/scene-not-found-error.ts packages/application/src/use-cases/review-scene.ts packages/application/src/use-cases/review-scene.test.ts packages/application/src/use-cases/index.ts packages/application/src/index.ts
pnpm exec depcruise packages/application/src/use-cases packages/application/src/index.ts --config .dependency-cruiser.cjs
```

Expected: all review invariants pass; application typecheck/lint/format pass; no infrastructure import appears in the use-case dependency graph.

Commit:

```bash
git add packages/application/src/use-cases/scene-not-found-error.ts packages/application/src/use-cases/review-scene.ts packages/application/src/use-cases/review-scene.test.ts packages/application/src/use-cases/index.ts packages/application/src/index.ts
git commit -m "feat(application): orchestrate scene review actions"
```

## Task 5: Implement transactional Scene production progression use cases

**Files:**

- Create: `packages/application/src/use-cases/progress-scene-production.ts`
- Create: `packages/application/src/use-cases/progress-scene-production.test.ts`
- Modify: `packages/application/src/use-cases/index.ts`
- Reference only: `packages/domain/src/scene.ts`
- Reference only: `packages/application/src/ports/unit-of-work.ts`
- Reference only: `packages/application/src/use-cases/scene-not-found-error.ts`
- Reference only: `packages/application/src/test-support/in-memory-scene-unit-of-work.ts`

**Behavioral invariants / tests first:**

- `candidate generation start: draft_pending and director_review transition to generating_candidates and save without a review event`
- `candidate submission: generating_candidates transitions to director_review and saves without a review event`
- `queue: approved transitions to queued and saves without a review event`
- `render start: queued transitions to rendering and saves without a review event`
- `QA submission: rendering transitions to qa and saves without a review event`
- `failure: each domain-allowed production state transitions to failed and saves once`
- `failure recovery: failed transitions to director_review and saves without a review event`
- `invalid production transition preserves the domain error and commits no save`
- `missing production scene throws SceneNotFoundError and commits no writes`

- [ ] **Step 1: Write all named failing tests.**

Build fixtures in `draft_pending`, `generating_candidates`, `approved`, `queued`, `rendering`, `qa`, and `failed` using the real aggregate. Parameterize the candidate generation start test over `draft_pending` and `director_review`, and the failure test over `generating_candidates`, `queued`, `rendering`, and `qa`, matching the existing domain API. Assert each valid call executes one UoW, commits one save, and commits zero review events. Assert invalid/missing paths commit neither collection.

Run:

```bash
pnpm exec vitest run packages/application/src/use-cases/progress-scene-production.test.ts
```

Expected: FAIL because the production use-case class does not exist.

- [ ] **Step 2: Implement the production use-case class.**

Export `ProgressSceneProductionUseCases` with primitive `{ readonly sceneId: string }` inputs and methods `beginCandidateGeneration`, `submitCandidatesForReview`, `queue`, `markRenderingStarted`, `submitForQA`, `fail`, and `recoverToReview`. A private helper runs one `uow.execute`, loads the Scene, throws the shared `SceneNotFoundError` if absent, calls exactly one corresponding domain method (`beginCandidateGeneration`, `submitCandidatesForReview`, `queueForProduction`, `startRendering`, `submitForQA`, `fail`, or `recoverToReview`), and saves. It does not append review events, call `RenderEnginePort`, catch domain errors, or duplicate state checks.

Export the class from `use-cases/index.ts`.

- [ ] **Step 3: Run focused acceptance checks and commit.**

Run:

```bash
pnpm exec vitest run packages/application/src/use-cases/progress-scene-production.test.ts
pnpm --filter @cco/application typecheck
pnpm exec eslint packages/application/src/use-cases/progress-scene-production.ts packages/application/src/use-cases/progress-scene-production.test.ts packages/application/src/use-cases/index.ts
pnpm exec prettier --check packages/application/src/use-cases/progress-scene-production.ts packages/application/src/use-cases/progress-scene-production.test.ts packages/application/src/use-cases/index.ts
pnpm exec depcruise packages/application/src/use-cases/progress-scene-production.ts packages/application/src/use-cases/index.ts --config .dependency-cruiser.cjs
```

Expected: production and review use-case tests pass together; application typecheck/lint/format pass; use cases depend only inward.

Commit:

```bash
git add packages/application/src/use-cases/progress-scene-production.ts packages/application/src/use-cases/progress-scene-production.test.ts packages/application/src/use-cases/index.ts
git commit -m "feat(application): orchestrate scene production progression"
```

## Tests to add or update

- Add RenderProfile schema acceptance/rejection tests in `packages/contracts/src/render-profile.test.ts`.
- Add canonical Scene status, review action, and review-event validation tests in `packages/contracts/src/scene-review.test.ts`.
- Add staged commit/rollback tests for the in-memory UoW in `packages/application/src/test-support/in-memory-scene-unit-of-work.test.ts`.
- Add compile-time capability-shape tests in `packages/application/src/ports/ports.test.ts` (this file is part of Task 3's expected scope even though it does not exist yet).
- Add transaction, audit mapping, approval invalidation, missing Scene, and invalid transition tests in `packages/application/src/use-cases/review-scene.test.ts`.
- Add candidate generation, queue/render/QA, failure, and recovery persistence and failure-path tests in `packages/application/src/use-cases/progress-scene-production.test.ts`.
- Retain the existing skeleton tests; do not expand the 1,235-line domain test file because this issue must not alter domain behavior.

## Validation commands

Task-local commands are listed inside each task and are the acceptance criteria for that commit. After all implementation tasks, the orchestrator's dedicated validation phase may run the configured repository command:

```bash
pnpm format
```

The automatic post-task gate also runs `pnpm -r typecheck`; task boundaries above keep each new port and all present implementations together so every intermediate commit remains type-correct.

## Risk areas

- **Transactional semantics:** A real infrastructure UoW must later make event append and Scene save atomic. These application tests prove orchestration and staged fake behavior, not PostgreSQL isolation levels.
- **Aggregate identity in fakes:** The Scene has private mutable fields and no rehydration API. Tests must assess committed calls and must not claim an in-memory clone restores aggregate state after a thrown callback.
- **Review action ambiguity:** Both director approval and QA acceptance use the stable `approve` action. Prior/resulting status fields must always be populated to preserve meaning.
- **Contract/domain status drift:** Contracts cannot import domain, so the canonical status tuple is intentionally duplicated across a process boundary. Tests should assert the PRD sequence explicitly.
- **Certified data integrity:** Synthetic hashes belong only in tests. No exported constant may pretend to be certified until real workflow/model hashes and host measurements exist.
- **Generic future ports:** Campaign, job, manifest, provider, and media types are deliberately generic because their domain contracts do not exist yet. Do not introduce SQL rows or provider DTOs to make them concrete prematurely.
- **Dependency enforcement:** The existing Dependency Cruiser rule for infrastructure imports application ports by source path; new ports must remain under `packages/application/src/ports/` and use only allowed package imports.

## Stop conditions

- Stop and re-plan if implementing a required use case would require changing `packages/domain/src/scene.ts`; domain changes are explicitly out of scope.
- Stop and re-plan if any concrete adapter implementing a changed/new port is present when implementation starts and cannot be included in the same task without materially expanding scope.
- Stop rather than fabricate if the implementation requires certified workflow/model hashes or non-null host RAM, RSS, swap, or page-fault values.
- Stop if the only way to coordinate review events and Scene persistence is to import an infrastructure transaction/client type into application.
- Stop if a proposed RenderEngine port must expose raw ComfyUI graph/event payloads to meet a later issue; keep this issue's semantic queue/unload surface only.
- Stop if adding Zod requires a workspace-wide dependency migration unrelated to `@cco/contracts`; replace that proposal with a separately reviewed contract-validation decision instead of silently widening the task.
