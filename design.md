# Design Document: Scene Aggregate Lifecycle

## The Problem Being Solved and Why It Matters

The Godzspeed Content Orchestration Platform requires a strict Human-on-the-Loop constraint to ensure creative alignment and robust deterministic production execution. A core part of this workflow is the progression of a `Scene` from drafting through to approval, rendering, and QA. 

Without a centralized, pure-domain aggregate enforcing these transitions, state mutation would leak into HTTP handlers or repository layers. This leads to anemic domain models where illegal state transitions (e.g., silently resuming a cancelled scene, or retaining "approved" status after changing a prompt) become possible. By encapsulating the lifecycle inside a `Scene` aggregate root, we guarantee that the creative-review invariants—such as invalidating approval upon mutation—are mechanically enforced at the core of the application, independent of any infrastructure.

## Key Design Decisions and Trade-offs Considered

1. **Branded/Opaque Types for Identity**
   - *Decision*: Use TypeScript branded types (e.g., `type SceneId = string & { readonly _brand: unique symbol }`) for identifiers.
   - *Trade-off*: Adds minor type-casting overhead at the system boundaries (e.g., repositories or API controllers), but prevents critical bugs where a `CampaignId` is accidentally passed instead of a `SceneId`.

2. **Behavior-Driven State Transitions vs. Setters**
   - *Decision*: The `Scene` aggregate will expose explicit methods reflecting ubiquitous language (e.g., `approve()`, `submitForQA()`, `cancel()`) and keep its `status` property strictly read-only from the outside.
   - *Trade-off*: Increases the verbosity of the aggregate class compared to a simple data structure, but completely eliminates the possibility of ad-hoc, invalid `status = 'rendering'` assignments from external services.

3. **Approval Invalidation via Revision Tracking**
   - *Decision*: Maintain a `specRevision` counter on the `Scene` that increments upon any creative mutation (prompt, engine, references, duration, LoRA). The `approve()` method records the current revision as `approvedRevision`. Any subsequent mutation resets `approvedRevision` to `undefined` and forces a transition back to `director_review` if the scene was previously `approved`.
   - *Trade-off*: Simpler and more performant than performing deep equality checks or hashing the entire `SceneSpec` on every update, while safely maintaining the invariant.

4. **Terminal State Enforcement**
   - *Decision*: The `completed` and `cancelled` states will be strictly terminal. Any lifecycle or mutation method invoked on a scene in a terminal state will synchronously throw a typed domain error.

## Proposed Approach with Rationale

The implementation will reside entirely within `packages/domain/src` and rely on no external infrastructure.

### 1. Types & Enums
We will define `SceneStatus` aligning perfectly with PRD §4.2:
`draft_pending`, `generating_candidates`, `director_review`, `approved`, `queued`, `rendering`, `qa`, `completed`, `failed`, `cancelled`.

### 2. Domain Errors
We will introduce typed exceptions inheriting from standard `Error`:
- `InvalidTransitionError`: Thrown when attempting an illegal status transition.
- `TerminalStateError`: Thrown when mutating a completed or cancelled scene.
- `InvariantViolationError`: Thrown when logic invariants fail (e.g., trying to approve a scene that isn't in review).

### 3. The `Scene` Aggregate Class
The `Scene` class will encapsulate internal state (status, assigned engine, duration, references, LoRA config, spec revision).

**Behavioral Transition Methods:**
- `beginCandidateGeneration()` (draft_pending | director_review -> generating_candidates)
- `submitCandidatesForReview()` (generating_candidates -> director_review)
- `approve()` (director_review -> approved)
- `requestReroll()` (director_review -> generating_candidates)
- `queueForProduction()` (approved | failed -> queued)
- `startRendering()` (queued -> rendering)
- `submitForQA()` (rendering -> qa)
- `acceptQA()` (qa -> completed)
- `rejectQA()` (qa -> director_review)
- `fail()` (any non-terminal -> failed)
- `recoverToReview()` (failed -> director_review)
- `cancel()` (any non-terminal -> cancelled)

**Mutation Methods:**
- `updatePrompt(...)`
- `updateReferences(...)`
- `updateEngine(...)`
- `updateDuration(...)`
- `updateLora(...)`
*(If called while `approved`, these will reset the status to `director_review` and clear the approval revision).*

## Assumptions Made

1. **Revision Counter Sufficiency:** A simple monotonic integer `specRevision` counter is sufficient to track the identity/version of the `SceneSpec` for the sake of invalidating approvals, rather than requiring full cryptographic hashing of the payload in the domain.
2. **Failure Recovery Paths:** Because `failed` can transition to either `queued`, `director_review`, or `cancelled` depending on user intent, the domain will expose specific intent-based recovery methods (e.g., `queueForProduction()` can be reused or aliased for retry, and `recoverToReview()` handles returning to the director) rather than a single ambiguous `retry()` method.
3. **Primitive Modeling:** Since detailed definitions of LoRA configurations or references aren't fully fleshed out in the domain yet, they will be modeled as minimal TypeScript primitives/interfaces (e.g., string arrays or basic objects) just enough to satisfy the Sprint 1 requirement of tracking their mutation.
4. **OOP Paradigm:** I am assuming an Object-Oriented Aggregate Root pattern (a class with private state and public behavior) rather than a purely functional state-reducer pattern, as it fits well with the requested "behavior methods" and "no direct status setter".

## In Scope
- Definition of branded identity types (`SceneId`, `CampaignId`).
- The `Scene` aggregate class and its encapsulated state.
- All valid state transition methods and mutation behavior.
- Invalidation of approval upon spec/creative mutation.
- Typed domain errors (`InvalidTransitionError`, `TerminalStateError`).
- Comprehensive unit testing covering all transitions and invalidations.

## Out of Scope
- PostgreSQL integration, repository interfaces, or persistence mapping.
- Next.js / API transport schemas (Zod).
- Any ComfyUI workflow knowledge or provider integration.
- Campaign or RenderJob aggregates (unless absolutely necessary for simple references).
- UI/Review Hub implementation.

## Risks or Concerns Identified from Code Analysis

1. **Empty Domain Package Baseline**: `packages/domain/src` is currently empty. The patterns established here (e.g., branded types, error base classes, aggregate structure) will become the defacto standard for the repository. This is not inherently a risk, but it places a high responsibility on this issue to set clean, scalable conventions.
2. **QA Rejection Semantics**: The PRD states "QA rejection returns the Scene to director review without erasing prior lifecycle history at the domain event/result level." In the pure aggregate, we do not store the full event history itself (as we are not strictly event-sourcing the state machine into an event array inside the class, though we could). If event history is needed, the `Scene` might need to emit or return Domain Events (e.g., `SceneQaRejectedEvent`) from its methods so that the Application layer can persist them to the `ReviewEventStore`. If Domain Events aren't part of the established pattern, the Application layer will be responsible for inserting the append-only `ReviewEvent` after calling `scene.rejectQA()`. We assume the Application layer handles the audit log recording.
