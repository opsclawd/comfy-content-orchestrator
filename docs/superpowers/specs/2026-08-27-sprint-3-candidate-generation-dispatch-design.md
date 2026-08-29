# Sprint 3 — Durable Candidate-Generation Dispatch

**Date:** 2026-08-27
**Status:** Approved design
**PRD reference:** Sprint 3, §3.1, §3.1.2, §3.6.5, §5.5, §6.4, §9.2
**Supersedes:** None — this is the first design document for Sprint 3.
**Companion:** ADR-0002 (`docs/adr/0002-tailscale-identity-is-review-hub-auth.md`); Sprint 2.5 spec (`docs/superpowers/specs/2026-08-26-sprint-2-5-dispatch-contract-design.md`).

## Purpose

Close the durable candidate-generation dispatch contract: the render worker that consumes Sprint 2.5's five HTTP endpoints (`/api/jobs/{claim,:id/start,:id/heartbeat,:id/complete,:id/fail}`) and produces exactly-one `GenerationManifest` per successful `production` job, with storage-watermark enforcement at write time and the §9.2 Durable Lease Recovery Gate provable end-to-end against real hardware.

Following the Sprint 1.5 and 2.5 precedents, this sprint ships working code — worker daemon, manifest assembler, write-side admission, profile loader — not a document the Sprint 3 implementation has to interpret. Where Sprint 2.5 defined the *protocol*, Sprint 3 defines the *consumer*.

## What already exists

The dispatch protocol Sprint 2.5 shipped is the contract this sprint consumes. Concretely, the following are already merged on `main` and Sprint 3 does not re-litigate them:

- **Database schema** (`packages/infrastructure/migrations/007_job_dispatch_contract.sql` and earlier): `render_jobs` with `job_kind`, `lease_token`, `retry_count`, `max_retries`, `error_trace`; `job_status_enum` (`queued`, `leased`, `rendering`, `completed`, `failed`, `cancelled`); `generation_manifests.job_id UNIQUE` enforcing exactly-once manifest at the database level; `storyboard_candidates` immutability triggers.
- **`JobQueuePort` and Postgres adapter** (`packages/application/src/ports/job-queue-port.ts`, `packages/infrastructure/src/postgres/repositories/postgres-job-queue.ts`): `claim` with `FOR UPDATE SKIP LOCKED` and `lease_token = gen_random_uuid()` rotation; `start` / `heartbeat` / `complete` / `fail` with token fencing and idempotent post-state branches (per the `fail` contract reconciliation in PR #107).
- **Five HTTP routes** (`apps/control-api/src/http/routes/job-routes.ts`): `200` for `applied`/`already_applied`, `409` for `superseded`, `404` for `not_found`, `204` for "nothing claimable, including admission-blocked", `503` for telemetry unavailable, `400` for `manifestPayload` validation failures. Worker authentication is deliberately out of scope per ADR-0002's "Worker authentication" non-change.
- **Claim-side storage admission** (`packages/infrastructure/src/storage/storage-aware-job-admission-gate.ts`, PR #106): `candidate` jobs refused at degraded and critical; `production` jobs admitted at degraded, refused at critical. Wired into `PostgresJobQueue` at `apps/control-api/src/bootstrap.ts:208-212`. The table-driven tests cover all six watermark × job-kind cells.
- **RenderProfile certification** (`apps/render-worker/src/cli/certify.ts`, `certify-ltx.ts`, `certify-transition-soak.ts`; `apps/render-worker/src/certification/{preflight,artifact-writer,transition-*,atomic-artifact-publisher}.ts`): `LTX_25_720P_5S_V1` profile certified, gold-master provenance verified before each render, transition artifacts atomically published.
- **ComfyUI integration** (`packages/infrastructure/src/comfyui/{comfyui-client,render-engine-adapter}.ts`): `ComfyUiRenderEngineAdapter implements RenderEnginePort`; HTTP-based invocation against ComfyUI's loopback or authorized Tailscale interface.
- **GPU lease and telemetry** (`packages/application/src/ports/{gpu-execution-lease-port,gpu-telemetry-port}.ts`; `packages/infrastructure/src/.../LocalFsGpuLeaseAdapter`, `NvidiaSmiTelemetryAdapter`): exclusive per-host GPU execution enforced by local filesystem lease; telemetry via `nvidia-smi`.
- **`ExecuteProfileRenderUseCase`** (`packages/application/src/use-cases/execute-profile-render.ts`): the single-shot render pipeline that ties `RenderEnginePort`, `GpuExecutionLeasePort`, `GpuTelemetryPort`, and certification provenance together.
- **Storage admission policy and enforcement** (`packages/domain/src/storage-admission.ts`, `packages/application/src/use-cases/enforce-storage-admission.ts`): `createStorageAdmissionPolicy(usedBytes, totalBytes)` and `EnforceStorageAdmission.execute(operation)` already implement the §2.3 grading exactly. Used today by the claim-side gate; Sprint 3 re-uses for write-side gating.
- **All application ports** the worker will need: `RenderJobRepository`, `ManifestRepository`, `StoryboardCandidateRepository`, `MediaAssemblerPort`, `StorageTelemetryPort`, `StorageMetricsRegistryPort`.

What is **genuinely missing** for Sprint 3:

1. The **worker polling daemon** that turns the one-shot `ExecuteProfileRenderUseCase` into a polling consumer of the Control API's `/api/jobs/{claim,…}` surface. `apps/render-worker/src/index.ts` exports only `renderWorkerName` — there is no entry point today.
2. **GenerationManifest content assembly** per §5.5 / §6.4: the worker must produce the 16 minimum fields (manifest/job/campaign/scene identity, render attempt/timestamp, engine and RenderProfile identity, model/checkpoint/VAE/text-encoder SHA-256 hashes, workflow template identity/hash, LoRA identities/strengths, sampling seed/steps/CFG/sampler/scheduler/denoise, dimensions/frame count/FPS, prompts/audio prompt [capability-dependent: explicitly `null` when unsupported by profile], persistent ReferenceAsset identities, approved StoryboardCandidate identity/hash, ComfyUI commit/custom-node environment, runner profile/runtime metadata, governance/license/policy identity, output filenames/hashes/review object keys/execution duration). Today the route accepts `manifestPayload` as opaque JSONB and stores it.
3. **Write-side storage admission** (#89): the *actual* generation/media-write path the worker executes between `start` and `complete` must call `EnforceStorageAdmission` and surface failures as 507/429 at the relevant write endpoint. The claim-side gate is correct as-is; this is the worker's responsibility and the missing second half of #89.
4. **RenderProfile runtime loader** in the worker: `loadCertificationProfile` is exercised by the certify CLI but the polling daemon needs the same loading path at runtime, keyed by the job's `workflow_template`.
5. **End-to-end §9.2 Durable Lease Recovery proof from the worker's side**: the queue-side test exists (`postgres-job-queue.integration.test.ts`), but there is no integration test that exercises claim → start → render (against a stubbed ComfyUI) → kill mid-render → reclaim → complete → assert no duplicate manifest.

## Decisions

### One job per candidate, not one job per batch

A `candidate` job produces **exactly one** `storyboard_candidates` row and one ComfyUI invocation. The PRD §9.5 "candidate-batch target (<45 s for 18 keyframes)" is realised as 18 independent jobs in the queue, each with its own lease and retry, sharing a `SceneSpec`.

Rationale:

- Aligns with the existing data model: `storyboard_candidates` is immutable-per-candidate, not immutable-per-batch.
- Atomic retry: a worker dying mid-batch loses 1 candidate; the other 17 are unaffected. A one-job-per-batch worker that dies at candidate 9 of 18 retries all 18.
- Concurrency control is simpler: one lease = one render = one storyboard row, with no partial-batch state to model.
- The queue depth scales linearly with batch size but `FOR UPDATE SKIP LOCKED` and the existing partial index already handle that.
- The "batch" remains a SceneSpec concept (`SceneSpec.injectedPayload` carries the per-candidate seed/parameters), not a queue concept.

If a future requirement needs a synchronous N-candidates-per-invocation render for hardware-reuse reasons, that can be added inside one job's `execute()` without changing the queue protocol. The protocol stays decoupled from the render batch.

### Storage admission surface, split per #89's clarified scope

The user's 2026-08-27 decision:

- **`/api/jobs/claim` polling endpoint**: unchanged. Returns 204 for "nothing claimable, including admission-blocked" — the Sprint 2.5 contract is preserved (`docs/superpowers/specs/2026-08-26-sprint-2-5-dispatch-contract-design.md:239-241`). Changing to 507/429 would break the worker's polling contract and force a worker-side distinction between "no work" and "back off" that the Sprint 2.5 design deliberately collapsed.
- **Write-side surfaces** (media upload, manifest submission, or wherever the worker hands work to the Control API in Sprint 3): when the worker attempts a storage-consuming operation at degraded/critical, the Control API returns **507 Insufficient Storage** or **429 Too Many Requests** — never 5xx that masks the admission reason, and never a silent success.
- **No retry budget consumed on admission refusal** at write time: the work is still valid; storage is the bottleneck. `retry_count` is not incremented, the job remains in its current active status. A future design can revisit if admission-blocked becomes sustained rather than transient.
- **Worker-side backoff on sustained 204** is out of scope for this sprint; the Storage Watermark Gate (#68) can be verified without it.

The exact HTTP endpoint(s) where write-time admission surfaces as 507/429 are an implementation detail of Sprint 3 issue 1 (worker daemon). The contract is: **no storage-consuming operation lands at a forbidden watermark**, regardless of which surface catches it.

### Worker authentication: tailnet reachability only

Per ADR-0002's "What this decision explicitly does *not* change" section, worker authentication is deliberately not designed here. The five job-dispatch endpoints were designed shape-stably for auth-later addition; Sprint 3 inherits that boundary. Tailnet reachability remains the access boundary.

This will be revisited per ADR-0002's "future change to add session/login must amend or supersede this ADR" consequence — but not in Sprint 3.

### RenderProfile selection

The worker selects the RenderProfile by reading `job.workflowTemplate` (which already exists on `RenderJob` as `workflowTemplate: string`) and loading the matching certified profile via `loadCertificationProfile`. The certify CLI already exercises this path. The worker reuses it unchanged.

A job's `workflowTemplate` is set at queue time (by whatever Sprint 3 mechanism enqueues a `candidate` or `production` job — out of scope for Sprint 3 issue 1's worker-side work, see "Scope boundaries"). The worker treats it as authoritative and refuses jobs whose `workflowTemplate` does not match a certified profile.

### Generation manifest content assembly

`assemble-generation-manifest.ts` (a new use case in `packages/application/src/use-cases/`) is the single source of truth for §5.5 content. It is invoked by the worker immediately before `/api/jobs/:id/complete` for `production` jobs and produces the `manifestPayload` argument.

- **Authoritative Post-Dispatch Workflow Provenance**: The assembler extracts prompts, negative prompts, sampling parameters (seed, steps, CFG, sampler, scheduler, denoise), and audio prompt directly from the post-injection workflow dispatched to ComfyUI, with zero fallback to `job.injectedPayload`.
- **Capability-Dependent Audio Prompt**: If the RenderProfile lacks audio generation capability (e.g. `LTX_25_720P_5S_V1`), the manifest explicitly records `prompts.audioPrompt: null`. Supplying `audioPrompt` in `injectedPayload` for a profile lacking audio capability is rejected prior to render dispatch.
- **Declarative Injection Topology**: RenderProfiles explicitly declare injection target nodes (`prompt`, `negativePrompt`, `seed`, `audioPrompt`). Workflow mutation and manifest extraction validate target nodes against this declarative topology rather than using loose string heuristics.

Inputs to the assembler:

- The `RenderJob` row (for `jobId`, `sceneId`, `retryCount` → render attempt).
- The certified `RenderProfile` loaded by the worker.
- The finalized dispatched `RenderWorkflow` post-injection.
- The `RenderEnginePort.execute()` result, which already returns `outputPaths`, `durations`, and the run-time provenance collected by the engine adapter.
- The ComfyUI invocation's provenance (commit hash, custom-node environment) — already collected by `RenderEnginePort` and `ExecuteProfileRenderUseCase`.
- The `storyboard_candidates` row written for the same scene/revision if `job_kind = "production"` and a candidate was selected (per §5.5's "approved StoryboardCandidate identity/hash where applicable").

Outputs: a `Readonly<Record<string, unknown>>` whose JSON shape matches §5.5's 16 fields, with type guards enforced by the assembler's contract test.

The Sprint 2.5 route layer treats `manifestPayload` as opaque JSONB — Sprint 3 doesn't change that. The contract lives in the assembler.

### Failure modes and retry semantics

- **Supersession (409)**: the worker must abort and never retry. The lease token has rotated; the new holder owns the job.
- **Not found (404)**: same — abort. The job no longer exists.
- **Already applied (200)**: this is the idempotent-retry success path; treat as success.
- **503 (telemetry unavailable) on `/claim`**: back off and retry, telemetry may be transiently broken.
- **507/429 on a write endpoint**: storage admission refused. The worker does **not** call `/api/jobs/:id/fail` (which would consume `retry_count`). Instead it calls the new `POST /api/jobs/:id/defer` endpoint, see "Admission deferral" below.
- **Network errors / unexpected 5xx**: treat as transient, retry with backoff.
- **`complete` returning `applied` (200)** for `production` jobs writes the manifest; the unique constraint on `generation_manifests.job_id` is the database-level guard against duplicates. A retry that races with a successful write surfaces as `already_applied` (200) — exactly once, by construction.
- **`complete` returning `applied` (200)** for `candidate` jobs writes the `storyboard_candidates` row in the same transaction; the unique constraint on `(scene_id, scene_spec_revision, variant_ordinal)` is the database-level guard against duplicates. Same `already_applied` semantics.

### Admission deferral

The "no `retry_count` consumed on admission refusal" rule (per the §"Storage admission surface" decision) cannot be honored through `/api/jobs/:id/fail`, because `fail()` always increments `retry_count` when requeuing (`packages/infrastructure/src/postgres/repositories/postgres-job-queue.ts:500-503`). A new endpoint is the cleanest separation.

`POST /api/jobs/:id/defer` takes `{ leaseToken, reason }` and atomically:

- sets `status = 'queued'`
- clears `worker_id` and `lease_expires_at`
- **keeps `lease_token` attached** to the row — this is the idempotency anchor for replay detection
- **does NOT increment `retry_count`**
- returns `200` with the same `deferred` outcome

Idempotent retry walkthrough (the bug GPT caught in earlier wording):

1. Worker A calls `/defer` → row: `status='queued', lease_token=old, worker_id=null, lease_expires_at=null`.
2. Worker A retries `/defer` (lost response): WHERE `status='queued' AND lease_token=old` matches → returns `200 already_applied`. ✓
3. Worker B claims: WHERE `status='queued'` matches (claim's predicate filters on status, not on `lease_token`). UPDATE rotates `lease_token` to a new uuid.
4. Worker A's stale retry after worker B's claim: WHERE `status='queued' AND lease_token=old` — no match (status is now `leased`, token is now new). Falls through, returns `superseded` / `409`. ✓ Worker A correctly aborts.

This works because nothing else (start/heartbeat/complete/fail) matches `status='queued'`. The kept `lease_token` is inert to other mutations and only the deferral machinery reads it.

The endpoint and the `deferred` outcome mirror the existing pattern: same idempotency contract as `complete`/`fail`, same `translateMutationResult` mapping (the route layer needs no new mapping — `already_applied` and `superseded` are already mapped).

## Schema

No new migration in Sprint 3. The `render_jobs`, `generation_manifests`, `storyboard_candidates`, and supporting tables already exist with the fields the worker needs.

Two fields Sprint 3 *uses* but does not change:

- `render_jobs.workflow_template` — already on the row (`VARCHAR NOT NULL`). The worker reads it for RenderProfile selection.
- `render_jobs.injected_payload` — already on the row (`JSONB NOT NULL`). The worker reads it for per-candidate seed/parameters.

If Sprint 3 issue 1's worker implementation reveals a need for a new field (e.g. ComfyUI invocation nonce), that is filed as a separate migration under a separate issue. No schema change is part of this sprint's contract.

## Layer placement

| Layer | Addition |
|---|---|
| `packages/domain` | (none — the storage admission policy is already in `storage-admission.ts`) |
| `packages/application/src/use-cases` | `assemble-generation-manifest.ts` (new) |
| `packages/application/src/ports` | (none — all needed ports exist) |
| `packages/infrastructure/src/postgres` | `PostgresJobQueue.complete()` extended to accept a `candidatePayload` for `candidate` jobs and write the `storyboard_candidates` row in the same transaction. New `/defer` mutation in `PostgresJobQueue` with a `deferred` `JobMutationResult` outcome. |
| `apps/render-worker/src` | `worker.ts` (new — HTTP polling/heartbeat/settlement state machine), `render-job-executor.ts` (new — render orchestrator: profile loading, payload assembly, SHA-256 hashing), `control-api-client.ts` (new — HTTP client for the six routes), `cli/run-worker.ts` (new — composition root), tests under `worker.test.ts` and `render-job-executor.test.ts` |
| `apps/control-api/src/http/routes` | Existing `job-routes.ts` modified; no new route file or plugin is added. The file registers the new `/api/jobs/:id/defer` endpoint, extends `complete` to accept `candidatePayload` for `candidate` jobs, and invokes `enforceStorageAdmission` before writes (issue #113). |

This mirrors Sprint 2.5's pattern: the worker daemon is composition-root work that wires existing application-layer seams. The new use case is a single-file addition. The queue-adapter extensions (`/defer`, candidate-row write) are the smallest surface change that closes the gaps surfaced during spec review.

## Worker protocol

The worker is a polling consumer of the Control API. Its lifecycle for one job spans two files: `worker.ts` (the HTTP polling/heartbeat/settlement state machine) and `render-job-executor.ts` (the render orchestrator: profile loading, payload assembly, SHA-256 hashing). The protocol steps below are annotated with which file owns each responsibility.

1. **Poll `/api/jobs/claim`** with `{ workerId, allowedJobKinds? }`. On `204` (no work), sleep for the configured `heartbeatIntervalMs` and re-poll. On `503` (telemetry down), back off more aggressively. On `200` with a job, proceed. — `worker.ts`
2. **Read the job's `workflowTemplate`**, load the matching certified `RenderProfile` via `loadCertificationProfile`. If no certified profile matches, call `/api/jobs/:id/fail` with `error_trace = "no certified profile for workflow_template"` and re-poll. — profile loading in `render-job-executor.ts`; `/fail` invocation and re-poll in `worker.ts`
3. **Call `/api/jobs/:id/start`** with the `leaseToken` to transition `leased` → `rendering`. On `409` (superseded) or `404` (gone), abort and re-poll. On `200` (`applied` or `already_applied`), proceed. — `worker.ts`
4. **Invoke `ExecuteProfileRenderUseCase`** with the loaded profile, the job's `injectedPayload`, and the ComfyUI invocation inputs. While running, **send `/api/jobs/:id/heartbeat`** every `heartbeatIntervalMs`. On heartbeat `409` (superseded), **the worker does NOT release the GPU lease** — `ExecuteProfileRenderUseCase` owns the lease and will release it in `finally` when the render returns (`packages/application/src/use-cases/execute-profile-render.ts:197-203`). The worker daemon does not have access to the lease object. Instead, the worker logs the supersession, lets the render finish naturally (or fail locally), and abandons the result: it does not call `/api/jobs/:id/complete` or `/api/jobs/:id/fail` (both would 409 with the dead token). The orphan render output is the cost of a rare supersession edge case; the manifest is the only durable record, and the original worker can't write one. — render dispatch via `render-job-executor.ts`; heartbeat loop in `worker.ts`
5. **On render success for `production` jobs**: invoke `assemble-generation-manifest.ts` to build the §5.5 `manifestPayload`. Call `/api/jobs/:id/complete` with `{ leaseToken, manifestPayload }`. On `400`, the manifest is malformed — fail the job with the validation error. — manifest assembly in `render-job-executor.ts` (which calls `assemble-generation-manifest.ts` per issue #112); `/complete` invocation in `worker.ts`
6. **On render success for `candidate` jobs**: assemble the candidate row from the render result (see "Candidate persistence" below). Call `/api/jobs/:id/complete` with `{ leaseToken, candidatePayload: { storageBucket, storageObjectKey, contentHashSha256, variantOrdinal, generationPayload? } }`. The queue adapter writes the `storyboard_candidates` row in the same transaction as the status update. — candidate payload assembly (variantOrdinal validation, SHA-256 hashing, outputObjectKeys → storageBucket/storageObjectKey) in `render-job-executor.ts`; `/complete` invocation in `worker.ts`
7. **On render failure**: call `/api/jobs/:id/fail` with `leaseToken` and `errorTrace`. The adapter's idempotency rules apply (requeued → `superseded`, terminal → `already_applied`). — `worker.ts`
8. **On storage admission refusal at write time** (per the §"Storage admission surface" decision): call the new `/api/jobs/:id/defer` (see "Admission deferral" above) with `{ leaseToken, reason: <typed StorageAdmissionError.message> }`. The job returns to `queued` without consuming `retry_count`; the worker re-polls. — `worker.ts`

Worker-side storage admission: before each of the worker's storage-consuming operations (writing candidate media bytes, writing generation manifest bytes, writing any review proxy the worker produces), call `EnforceStorageAdmission.execute(operation)`. On `StorageAdmissionError`, the worker calls `/api/jobs/:id/defer` (step 8 above).

The worker does not need to know about token rotation beyond recognising `409` as the abort signal. The Postgres adapter rotates tokens on `claim`; the worker treats any `409` as fencing.

## Candidate persistence

A successful `candidate` job's `storyboard_candidates` row is written inside `PostgresJobQueue.complete()`'s transaction, in the same statement batch as the status update. This mirrors the production-manifest path and gives exactly-once via the unique constraint.

- **Payload shape** (validated by the route layer's `completeJobSchema` extension for `candidate` jobs): `{ storageBucket, storageObjectKey, contentHashSha256, variantOrdinal, generationPayload? }`. Not `manifestPayload`. The queue adapter dispatches on `job_kind`.
- **Uniqueness key**: `(scene_id, scene_spec_revision, variant_ordinal)` per migration `003_candidate_selection.sql:46`. Plus `(storage_bucket, storage_object_key)` uniqueness on line 47. The worker computes `variantOrdinal` deterministically from `SceneSpec.injectedPayload` — e.g. the per-candidate ordinal inside an N-candidate batch — or the queue adapter assigns one if `injectedPayload` doesn't carry it. The exact rule is part of issue #111's implementation; the contract is that exactly-one candidate row exists per `(scene_id, scene_spec_revision, variant_ordinal)`.
- **Write location**: inside `PostgresJobQueue.complete()` for `candidate` jobs. Same transaction as the status update; the route layer's catch-and-translate-to-`already_applied` pattern is reused.
- **Duplicate-completion behavior**: a replay with the same `(scene_id, scene_spec_revision, variant_ordinal)` raises the unique violation; adapter catches it and returns `already_applied` / `200`. Mirrors the production-manifest pattern exactly.
- **Where the assembly lives**: in the worker daemon's `/complete` invocation flow for `candidate` jobs. Folds into #111; #112 stays focused on the §5.5 production-manifest contract.

## Scope boundaries

In scope:

- Worker polling daemon (`apps/render-worker/src/worker.ts`).
- GenerationManifest content assembly (`assemble-generation-manifest.ts`).
- Candidate row persistence inside `/api/jobs/:id/complete` for `candidate` jobs (issue #111).
- `/api/jobs/:id/defer` endpoint with idempotent semantics (issue #113).
- Write-side storage admission enforcement (#89).
- RenderProfile runtime loading by the worker.
- End-to-end integration test proving §9.2 Durable Lease Recovery Gate from the worker's side.

Out of scope, deferred:

- **Worker → Control API authentication**: per ADR-0002, tailnet reachability is the boundary. Worker auth is a separate ADR.
- **Mechanism that enqueues `candidate` / `production` jobs into `render_jobs`**: Sprint 3 issue 1's worker consumes jobs from `claim` but does not add the upstream producer. The `reroll` review action transitioning a scene to `generating_candidates` and the mechanism that turns that into `render_jobs` rows is a separate issue.
- **Render-engine cancellation seam**: `RenderEnginePort` exposes only `queueRender` / `getRenderResult` / `unloadModels` (`packages/application/src/ports/render-engine-port.ts:23-27`). On heartbeat 409 the worker abandons the render and lets it finish naturally; adding `cancelRender()` is a separate concern (ComfyUI does not natively support cancellation).
- **ReferenceAsset continuity tracking**: §5.5 lists it as a manifest field; Sprint 3 stores the field, but the asset-graph traversal that produces the manifest's "persistent ReferenceAsset identities" array is a separate concern.
- **Worker-side backoff on sustained 204**: not in scope per the §"Storage admission surface" decision.
- **Render and queue telemetry metrics**: out of scope; the metrics route already exists for storage.

## Acceptance criteria additions

Two spec requirements from the original design (and from issue #111) were not explicitly enumerated in the acceptance criteria for PR #117. They are tracked here so PR #117's outcome is reconciled with the spec text. **Both gaps were closed on `ai/issue-111` in commit `b9e8a36`** (per Open Question 2 resolution below): the test code lands on the implementation branch alongside the spec amendment, not as a follow-up. The boxes are checked because the corresponding code landed before this PR is merged.

- [x] **"No certified profile" worker-level test case.** Worker protocol step 2 and issue #111 step 2 prescribe that a missing certified profile must surface as `/api/jobs/:id/fail` with the typed error and a re-poll. Resolution (`b9e8a36`): `render-job-executor.ts` throws `MissingCertifiedProfileError` (carries `workflowTemplate`, preserves upstream cause) when `loadCertificationProfileFn` rejects. `worker.test.ts` adds "fails the job with a typed missing-profile error when no certified profile exists" asserting `/fail` is called exactly once with `error_trace` containing `no certified profile for workflow_template "<id>"`, `/defer` is NOT used, no bytes are written, no `/complete` is attempted, and the start() loop re-polls. `render-job-executor.test.ts` adds "throws MissingCertifiedProfileError when loadCertificationProfile signals no match" asserting the executor boundary.

- [x] **§9.2 integration test must explicitly assert worker A's `/complete` returns 409.** Testing step 3 and issue #111 acceptance §9.2 require *"assert exactly one `generation_manifests` row, no duplicate, and worker A's `complete` returned `409` (fenced)."* Resolution (`b9e8a36`): `tests/integration/render-worker.integration.test.ts` introduces `SpyControlApiClient` (wraps `HttpControlApiClient`, captures each call's outcome) used by worker A only. The test asserts `workerAClient.completeCallsFor(jobId)` has length 1 with `outcome === "superseded"`. Worker B uses an unwrapped real client. The "exactly one `generation_manifests` row" assertion remains — both halves of the §9.2 acceptance criterion are now proven.

## Deviation log

Each deviation below names the original spec text, the actual implementation in PR #117 (which closes issue #111), and the rationale for keeping the implementation. Future deviations from this design doc must be appended to this log in the same format.

### Deviation 1: class name `RenderWorkerDaemon` → `RenderWorker`

- **Spec anchor:** issue #111 anchored design §"New file — `apps/render-worker/src/worker.ts`" declares `export class RenderWorkerDaemon` with `run(signal: AbortSignal): Promise<void>`.
- **Actual:** `export class RenderWorker` (`apps/render-worker/src/worker.ts:81`) with `start(signal?: AbortSignal): Promise<void>` and `runOnce(): Promise<void>`.
- **Rationale:** the term "Daemon" implied superprocess semantics the implementation does not have (no child-process spawn, no signal forwarding beyond SIGINT/SIGTERM). `RenderWorker` is more accurate. The `start()` vs `run()` split is honest about the loop's active-attempt draining requirement on shutdown — issue #111's `run(signal: AbortSignal)` would have forced an early-return that abandoned active leases, contradicting the graceful-shutdown requirement.
- **Spec amendment:** the class is `RenderWorker`; the long-running method is `start(signal?)`.

### Deviation 2: dependency list 9 ports → 5 ports with `renderJobExecutor` bundling

- **Spec anchor:** issue #111 anchored design declares `RenderWorkerDeps` with 9 ports: `loadCertificationProfile`, `renderEngine`, `gpuLease`, `gpuTelemetry`, `executeProfileRender`, `enforceStorageAdmission`, `assembleManifest`, `controlApiClient`, `logger`.
- **Actual:** 5 ports + injected `sleep`: `controlApiClient`, `objectStorage`, `enforceStorageAdmission`, `renderJobExecutor`, `logger`, `sleep` (`apps/render-worker/src/worker.ts:43`). `renderJobExecutor` (a new file `apps/render-worker/src/render-job-executor.ts`) bundles `loadCertificationProfile`, `executeProfileRender`, payload assembly, SHA-256 hashing, `variantOrdinal` validation, and `productionManifestAssembler` invocation.
- **Rationale:** composition-root practice groups by what changes together. The 6 ports compressed into `renderJobExecutor` all change with certification content. Splitting them as 6 individual ports would create churn for no isolation benefit — anyone swapping one has to swap the others. The protocol steps 2 (load profile), 5 (assemble production manifest), and 6 (assemble candidate row) still happen, just behind one seam.
- **Spec amendment:** the worker composes 5 ports + `sleep`; `renderJobExecutor` is the bundling seam; `assembleManifest` (issue #112's responsibility) flows through `renderJobExecutor` rather than being a direct worker port.

### Deviation 3: file split — `worker.ts` + `render-job-executor.ts`

- **Spec anchor:** issue #111 anchored design treats `worker.ts` as the single new file holding both the polling loop and the render orchestration.
- **Actual:** `worker.ts` (650 lines) is the HTTP polling/heartbeat/settlement state machine with `AttemptPhase = "starting" | "active" | "fenced" | "settling" | "settled"`. `render-job-executor.ts` (485 lines) is the render orchestrator (profile loading, payload assembly, SHA-256 hashing, `variantOrdinal` validation). The two files have distinct change drivers and distinct test surfaces (`worker.test.ts` 2646 lines vs `render-job-executor.test.ts` 995 lines).
- **Rationale:** separation of concerns between HTTP protocol consumer and render orchestration. A monolithic `worker.ts` would have been ~1000 lines mixing both concerns, harder to test, and conflating two different failure modes. The state machine handles edge cases the spec under-specified: heartbeat racing with shutdown, settlement barrier awaiting in-flight heartbeat, retry classification by HTTP status code, graceful active-attempt drain.
- **Spec amendment:** see the per-step file attribution in the Worker protocol section above.

### Deviation 4: daemon-level retry classification by HTTP status — **resolved (generous reading)**

- **Spec anchor:** issue #111 Explicit Traps §"DO NOT re-implement claim, lease, retry, or admission logic in the worker" — verbatim.
- **Actual:** `worker.ts` implements `isNonTransientStatusCode`, `startWithRetry`, `completeWithRetry`, `failWithRetry`, `deferWithRetry`. Each retries HTTP mutations by HTTP status code classification (transient 5xx and JSON-parse failures retry; 4xx 400/401/403/409/404 do not retry).
- **Rationale (architectural decision):** the trap is read as forbidding duplication of *durable-state retry*, not daemon-level retry classification. The queue owns durable retry budget — it decides whether a job can be re-claimed (durable state in `render_jobs.retry_count`). The daemon owns daemon-level retry classification — it decides whether to retry a single HTTP call (transient transport vs non-transient application). These are distinct concerns: conflating them would either force the queue to model transient HTTP semantics or leave the daemon unable to recover from a single Control API hiccup. PR #117 implements the generous reading.
- **Spec amendment (locked):** the trap is now clarified as:
  > **DO NOT re-implement queue retry-count semantics, lease ownership, or admission policy in the worker. Daemon-level retry classification by HTTP status code on a single in-flight mutation IS permitted and IS required.**
  >
  > In particular, the worker may classify HTTP responses by status code (e.g. retry on 5xx and JSON-parse failures, do not retry on 4xx, propagate 409/404 as `superseded`/`not_found` outcomes) for each *individual* `/start`, `/complete`, `/fail`, `/defer` call. The worker MUST NOT increment or decrement `retry_count`, MUST NOT own or release the GPU lease, and MUST NOT encode admission policy beyond invoking `EnforceStorageAdmission.execute` before each write.
- **Adversarial test for the boundary:** the generous reading is *only* safe if the daemon-level classifier never promotes a non-transient response to success. The boundary test is: a `/fail` followed by a 5xx must NOT be classified as success — the second `/fail` must observe the post-state idempotency rules and return `already_applied`. PR #107 (#105 split) already proves the post-state split. PR #117's `worker.test.ts` "settlement fail retries persist" group (lines 2504-2612) proves the daemon-level classifier composes with the queue's post-state rules rather than overriding them.

## Open questions — resolved

All three open questions raised in this spec amendment are resolved. The resolutions are recorded here so that subsequent deviations cite this baseline rather than re-litigating it.

1. **Deviation 4 strictness — resolved (generous reading).** The trap forbids duplication of *durable-state retry* (`retry_count`, lease ownership, admission policy), not daemon-level classification of *transient HTTP outcomes on a single mutation call*. PR #117's implementation is conformant. The Spec amendment block in Deviation 4 above is now locked text, not a proposal.

2. **Acceptance gap sequencing — resolved (land both on the implementation branch alongside the spec amendment).** The two missing acceptance items (no-cert test, §9.2 409 assertion) landed as a single additional commit `b9e8a36` on `ai/issue-111` (PR #117's branch) before this spec amendment is merged. They are spec requirements, not nice-to-haves, and shipping the spec amendment without them would re-create the same drift pattern the amendment exists to fix. Each [ ] item in the Acceptance criteria additions section above is checked off here and the corresponding code change is in PR #117's commit history.

3. **`assembleManifest` timing — resolved (composition-root wiring).** When issue #112 lands, `assemble-generation-manifest.ts` becomes a real adapter implementation wired in by the worker's composition root (`apps/render-worker/src/cli/render.ts` or `cli/run-worker.ts`), not a new dep added to `renderJobExecutor`. `renderJobExecutor` continues to accept `ProductionManifestAssembler` as an opaque injected seam (function or `{ assemble / assembleManifest }` object) — the production-vs-candidate branch in `render-job-executor.ts:execute` then dispatches to whichever assembler is wired in. The composition root is the single place that knows the assembler identity. This keeps `renderJobExecutor` testable in isolation (production tests use a stub assembler) and keeps the dep set stable when the assembler is swapped.

## Testing

Integration tests against real PostgreSQL using the existing `test:db` / Testcontainers setup, plus a smoke test against a stubbed ComfyUI HTTP server:

1. **Worker poll loop, idle queue** — worker polls continuously, receives 204s, no spurious writes. Verify with `apps/render-worker/src/worker.test.ts` against a fake `ControlApiClient`.
2. **Worker poll loop, single job** — enqueue one `candidate` job, worker claims it, runs (stubbed ComfyUI returns one image), persists nothing to `render_jobs` other than what `/complete` causes, ends in `completed`. Verify exactly one `storyboard_candidates` row written, with the right `(scene_id, scene_spec_revision, variant_ordinal)` and the right `storage_bucket` / `storage_object_key`. Verify `generation_manifests` row written iff `job_kind = "production"`.
3. **§9.2 Durable Lease Recovery** — enqueue one `production` job; worker A claims it and starts; mid-render, force-kill worker A's lease by setting `lease_expires_at` into the past and clearing the process; worker B claims, runs, completes; assert exactly one `generation_manifests` row, no duplicate, and worker A's `complete` returned `409` (fenced).
4. **§9.4 Storage Watermark Gate write-half** — pre-fill MinIO so watermark is at 85%; worker attempts to write candidate media; assert `StorageAdmissionError` thrown at the `EnforceStorageAdmission.execute(candidate_upload)` call; assert no media bytes landed in MinIO; assert worker called `/defer` (not `/fail`); assert `retry_count` unchanged.
5. **Generation manifest content (§5.5)** — for a known RenderProfile + known ComfyUI invocation, run the assembler; assert every §5.5 field is present, types match, SHA-256 hashes are deterministic for the same inputs.
6. **Idempotent `complete`** — repeat the same `/api/jobs/:id/complete` call twice for both `production` (manifest) and `candidate` (row); assert the second is `200 already_applied`, no duplicate.
7. **Supersession** — worker A claims and starts; worker B reclaims after expiry; worker A's `/complete` returns `409`; the job is owned by worker B's completion.
8. **`/defer` idempotency** — worker A calls `/defer`; worker A retries with the same token; assert second is `200 already_applied`. Then worker B claims (token rotates); worker A retries the original token; assert `superseded` / `409`. Assert `retry_count` is unchanged across all three calls.
9. **Abandonment on heartbeat 409** — worker A holds a render mid-execution; worker B reclaims after lease expiry; worker A's `/complete` returns `409`; assert the GPU lease is still held by worker A's process until the use case's `finally` releases it; no concurrent GPU render by worker B until lease expiry.

Tests 3, 4, 8 and 9 together prove the §9.2 Durable Lease Recovery Gate, the §9.4 Storage Watermark Gate's missing write-half, the new `/defer` idempotency contract, and the abandonment semantics, completing the acceptance criteria that Sprint 2.5 deferred to Sprint 3.

## Issue decomposition

Four issues, sized to match the tasks that have completed successfully through the orchestrator. The risk concentrates in issue 1 (the worker daemon), so it gets a dedicated review.

1. **#111 — Worker polling daemon + candidate row write** — `apps/render-worker/src/worker.ts`, integration with the six HTTP endpoints (claim/start/heartbeat/complete/fail/defer), `control-api-client.ts`, candidate-row assembly for the `/complete` invocation of `candidate` jobs (per the §"Candidate persistence" section), end-to-end §9.2 test from the worker's side. The risk-concentrated issue.
2. **#112 — GenerationManifest content assembly (§5.5)** — `packages/application/src/use-cases/assemble-generation-manifest.ts`, contract tests for all 16 fields, wired into the worker's `complete` invocation for `production` jobs.
3. **#113 — Write-side storage admission + `/defer` endpoint (#89)** — worker calls `EnforceStorageAdmission` before each storage-consuming operation; write endpoints surface 507/429; the new `/api/jobs/:id/defer` endpoint with idempotent semantics (per the §"Admission deferral" section); no retry budget consumed on admission refusal. This completes the write-half of #89.
4. **#114 — RenderProfile runtime loader** — wire `loadCertificationProfile` into the worker's claim path; refuse jobs whose `workflowTemplate` doesn't match a certified profile; verify with a contract test using the existing certify fixtures.

Operator-only:

- **Real-environment deployment acceptance** — once issues 1-4 land, an operator runs the §9.2 and §9.4 gates against real Trinidad ComfyUI and real MinIO. Tracked separately under `#68`.
