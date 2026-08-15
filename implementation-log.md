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

