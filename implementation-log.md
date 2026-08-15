# Implementation Log - Issue 2

## Task 1: Define Scene domain contracts and typed errors

- Defined `SCENE_STATUSES` tuple matching PRD §4.2 canonical order and derived `SceneStatus` union.
- Defined branded identity types `SceneId` and `CampaignId` using unique symbols to enforce compile-time separation.
- Defined immutable interfaces: `SceneConfiguration`, `SceneCreateInput`, `SceneApproval`, `SceneApprovalInput`, `SceneSnapshot`, `SceneTransition`, and `SceneTransitionReason`.
- Defined typed domain errors: `InvalidTransitionError`, `InvalidMutationError`, and `TerminalStateError` extending standard `Error` with stable names and contextual fields.
- Implemented minimal `Scene` shell with private constructor, `Scene.create(input)` factory, readonly getters (`id`, `campaignId`, `status`), defensive copying and freezing of configurations, and `snapshot()`.
- Re-exported domain types and aggregate from `packages/domain/src/index.ts`.
- Added unit tests in `packages/domain/src/scene.test.ts` verifying PRD status tuple order, draft creation at revision 1, immutable configuration snapshotting, and compile-time branded type and readonly property guards.
- Quality gates passed: vitest (PASS), eslint (PASS), tsc build (PASS), dependency-cruiser (PASS).

## Task 2: Implement the canonical lifecycle and failure recovery

- Implemented canonical scene lifecycle methods on the `Scene` aggregate root: `beginCandidateGeneration()`, `submitCandidatesForReview()`, `approve(input)`, `requestReroll()`, `queueForProduction()`, `startRendering()`, `submitForQA()`, `acceptQA()`, `rejectQA()`, `fail()`, `recoverToReview()`, and `cancel()`.
- Added private guarded transition helper `#transition` that enforces terminal validation (`TerminalStateError`), validates allowed source states against the canonical PRD §4.2 matrix (`InvalidTransitionError`), updates status atomically, resets failure provenance upon exiting failure, and returns frozen `SceneTransition` facts.
- Implemented failure provenance tracking: `fail()` captures the source status (`generating_candidates`, `queued`, `rendering`, or `qa`) in `#failedFrom`.
- Enforced production failure retry authorization: `queueForProduction()` allows retry from `failed` only if failure originated from a production state (`queued`, `rendering`, `qa`) and current approval revision matches `specRevision`. Retries from candidate generation failure are rejected.
- Enforced approval clearing on review recovery and QA rejection: `rejectQA()` and `recoverToReview()` clear approval metadata (`#approval = undefined`), requiring explicit re-approval.
- Disallowed QA cancellation per PRD §4.2 canonical transition rules.
- Added 5 exhaustive behavioral invariant unit tests in `packages/domain/src/scene.test.ts` covering the canonical matrix table (23 transitions), forbidden transitions, terminal enforcement, failure provenance / retry authorization, and immutable QA rejection facts.
- Verified quality gates: vitest (PASS), eslint (PASS), tsc build (PASS), dependency-cruiser (PASS).

## Task 3: Enforce revision-bound approval and creative mutation rules

- Implemented private guarded mutation helper `#updateConfiguration`:
  - Enforces terminal state validation (`TerminalStateError`) for terminal scenes (`completed`, `cancelled`).
  - Enforces editable status validation (`InvalidMutationError`) for non-editable busy scenes (`generating_candidates`, `queued`, `rendering`, `qa`, `failed`).
  - Increments `specRevision` exactly once per mutation.
  - Automatically resets `approved` scenes to `director_review` and clears `#approval` metadata.
  - Leaves `draft_pending` and `director_review` scenes in their current status.
  - Freezes updated configuration and returns a frozen `SceneTransition` fact with reason `"configuration_changed"`.
- Implemented 5 creative mutation methods on `Scene`:
  - `updatePrompt(prompt: string): SceneTransition`
  - `updateReferences(referenceIds: readonly string[]): SceneTransition`
  - `updateEngine(engineProfileId: string): SceneTransition`
  - `updateDuration(durationMs: number): SceneTransition`
  - `updateLora(loraConfigurationId?: string): SceneTransition` (clears optional LoRA identity when omitted).
- Bound approval metadata to exact revision in `approve(input)` and froze approval object.
- Added 5 exhaustive unit test suites in `packages/domain/src/scene.test.ts` verifying:
  - `binds approval metadata to the current scene revision`
  - `invalidates approval for every creative mutation`
  - `keeps editable non-approved scenes in place while advancing revision`
  - `rejects creative mutation during generation and production`
  - `rejects every creative mutation in terminal states`
- Verified quality gates: vitest (PASS), eslint (PASS), tsc build (PASS), prettier (PASS), dependency-cruiser (PASS).
