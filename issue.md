# S1-03: Define application ports, Scene transition use cases, and RenderProfile contracts

**Sprint:** 1 — Core Runtime, Domain Boundaries & Hardware Certification
**Story ID:** S1-03
**Depends on:** #1, #2
**Spec source:** `docs/prd.md` §3.6.4-§3.6.5, §4.2-§4.4, §5.2-§5.5

---

## Goal

Define the application-layer contracts that isolate orchestration from infrastructure and expose the Scene lifecycle through explicit use cases. Establish the versioned `RenderProfile` contract that will carry empirical hardware/workflow certification data without leaking ComfyUI details into the domain.

## Scope

### Application ports

Define focused ports under `packages/application/src/ports/` (split by responsibility; no giant god-interface):

- `RenderEnginePort`
- `GpuTelemetryPort`
- `SceneRepository`
- `CampaignRepository`
- `RenderJobRepository`
- `ManifestRepository`
- `ReviewEventStore`
- `LicenseRegistryRepository`
- `UnitOfWork`

Create placeholders/interfaces for later provider/media ports only where the PRD already requires them and doing so does not add speculative methods: `PlannerPort`, `CandidateRankerPort`, `VoiceSynthesisPort`, `MediaAssemblerPort`, `ObjectStoragePort`.

### Scene application use cases

Implement thin application use cases/services that load a Scene, invoke domain behavior from #2, and persist through ports. At minimum support the Sprint 1 state-transition paths required to prove architecture:

- approve Scene;
- request reroll / return to candidate generation;
- mutate SceneSpec/configuration with approval invalidation;
- queue approved Scene for production;
- mark rendering started;
- submit render for QA;
- QA approve/reject;
- fail/cancel.

Where a review action is part of the use case, append the corresponding review event through `ReviewEventStore` in the same `UnitOfWork` boundary as mutable Scene persistence. Do not implement PostgreSQL here.

### RenderProfile

Define a versioned configuration/schema contract for empirically certified render envelopes. The initial LTX concept must support at least:

```text
profile key: LTX_25_720P_5S_V1
engine: ltx_25
workflowHash
modelHashes
frames: 97
steps: 8
runnerProfile: dynamicvram-offload-v1
measuredPeakVramMb: 24028
measuredTotalDurationMs: 46000
measuredSamplingDurationMs: ~12000
measuredDiskFootprintGb: ~68.8
minFreeDiskGb: 100
maxConcurrentGpuJobs: 1
requiresModelOffloading: true
```

Host-RAM fields must allow `unknown/not-yet-certified` until the hardware-certification issues populate them. Do not fabricate values.

### Stable contracts

Place API/event transport schemas shared between processes in `packages/contracts`, not in domain entities. Keep transport contracts decoupled from persistence record shapes.

## Architecture constraints

- `application` must not import `infrastructure`.
- Ports define capabilities, not provider names (`GeminiPort`, `ComfyPort`, etc. are wrong abstractions at this layer).
- Provider fallback/retry policy belongs in application orchestration, but actual cloud-provider routing is later Sprint work; do not implement it here.
- `RenderProfile` is versioned execution configuration, not a mutable business aggregate.
- The application layer may orchestrate ports but must not use `fetch`, `ws`, SQL, filesystem, child processes, or provider SDKs.

## Automation execution notes

- Read the actual domain API produced by #2 rather than duplicating state-machine logic in application services.
- Keep use cases individually testable with in-memory fakes/test doubles.
- Add test doubles under application test support only if they improve deterministic tests; do not create infrastructure implementations here.

## Acceptance criteria

- [ ] Application port interfaces exist and are small/cohesive.
- [ ] `RenderEnginePort` has enough contract surface for queue/render result plus model-unload support without exposing raw ComfyUI event shapes to application callers.
- [ ] `GpuTelemetryPort` can supply the VRAM/headroom measurements needed by Sprint 1 certification.
- [ ] Scene transition use cases delegate transition legality to the domain aggregate from #2.
- [ ] Review-event persistence is coordinated with Scene persistence through `UnitOfWork` for review actions.
- [ ] Application tests use fakes and contain no infrastructure imports.
- [ ] `RenderProfile` supports the known empirical LTX baseline and explicit unknown host-RAM certification fields.
- [ ] No benchmark value beyond the PRD's measured values is invented.
- [ ] `packages/contracts` contains stable schemas needed by the current use cases without exposing SQL rows or ComfyUI raw payloads.
- [ ] Dependency Cruiser rules from #1 remain green.

## Test plan

Use in-memory repositories/event stores/unit-of-work fakes to prove:

- valid Scene action persists the mutated aggregate;
- invalid transition surfaces the domain error and performs no write;
- post-approval configuration mutation invalidates approval and persists the new state;
- review actions append the expected event transactionally;
- RenderProfile validation accepts the PRD baseline and rejects impossible values such as `maxConcurrentGpuJobs <= 0`.

## Definition of done

Merged with green CI; application orchestration depends only on ports/domain/contracts; Scene lifecycle operations are usable without infrastructure; the initial versioned RenderProfile contract is ready for workflow and hardware certification.
