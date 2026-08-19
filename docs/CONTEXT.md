# Context & Ubiquitous Language

## Ubiquitous Language (Domain Concepts)

- **Campaign:** Campaign identity and high-level completion/progress rules.
- **Scene:** SceneSpec, references, LoRA configuration, assigned engine, approval validity, current candidate selection, and canonical lifecycle transitions.
- **SceneSpec:** Structured creative specification containing the script, generation prompts, reference bindings, timing, and engine parameters for a scene revision.
- **StoryboardCandidate:** First-class immutable candidate generated for a specific `sceneId` and `sceneSpecRevision`. Candidate records and files are immutable at the database layer (protected via triggers and application-role privilege restrictions) and preserved independently from transient cache or delivery retention.
- **Current Candidate Selection vs. Immutable History:** Candidate selection is an auditable, mutable pointer on the Scene (`selected_candidate_id`, `selected_candidate_revision`). Candidate records themselves are append-only and immutable.
- **Current SceneSpec Revision:** Incrementing integer representing the specification version of the scene. Spec changes (prompt, duration, engine, references, LoRA) increment revision and invalidate existing candidate selection and approval.
- **RenderJob:** Durable production work, retry limits, worker ownership, and completion semantics.
- **RenderWorker:** Dedicated execution node / host process that holds GPU capacity, claims render leases, and runs diffusion/media generation workloads.
- **RenderLease:** Exclusive GPU-worker execution right for one diffusion job.
- **ReferenceAsset:** Continuity/provenance identity.
- **GenerationManifest:** Immutable evidence from a successful render; not a mutable aggregate.
- **ReviewEvent:** Append-only audit event capturing all human review actions, reviewer identity, timestamp, and before/after state transitions.
- **RenderProfile:** Versioned certified execution configuration for an engine/workflow/hardware envelope.

## Review Plane Actions & Behavioral Invariants

- **`candidate_select`:** Action choosing an immutable candidate belonging to the current `sceneSpecRevision`. Attempting to select a historical candidate from a prior revision is rejected.
- **`reject` vs. `reroll`:**
  - `reject`: Strictly QA rejection of rendered production video (`qa -> director_review`), clearing prior approval while retaining the approved candidate selection.
  - `reroll`: Storyboard candidate regeneration in review (`director_review -> generating_candidates`), invalidating current candidate selection and clearing approval.
- **`expectedSpecRevision` Conflict Semantics:** Optimistic concurrency control. If the client's `expectedSpecRevision` does not match the scene's current revision, a `STALE_REVISION_CONFLICT` (409) is returned with zero database writes.
- **Action ID & Idempotency:** Client assigns a unique UUIDv7 `actionId` to each command. An identical command replayed with the same `actionId` returns 200 with `isIdempotentReplay: true` and writes zero duplicate events. Reusing an `actionId` with altered payload returns `IDEMPOTENCY_CONFLICT` (409) with zero writes.
- **Server-Authoritative Reviewer Identity & Timestamp:** Reviewer name and action timestamp are determined server-side from authenticated session context and the server clock. Client-provided reviewer identity or timestamps cannot override server audit metadata.
- **Review API Never Synchronously Renders:** Review HTTP routes only commit state transitions, candidate selections, and audit records. Rendering compute is deferred to asynchronous worker queue processing (Sprint 3).

## Canonical Scene Lifecycle States

- **DRAFT_PENDING**
- **GENERATING_CANDIDATES**
- **DIRECTOR_REVIEW**
- **APPROVED**
- **QUEUED**
- **RENDERING**
- **QA**
- **COMPLETED**
- **FAILED**
- **CANCELLED**
