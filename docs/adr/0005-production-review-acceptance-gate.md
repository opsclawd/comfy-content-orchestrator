# 5. Production Review Acceptance Gate & Attempt Lineage Invariant

Date: 2026-09-13

## Status

Accepted

## Context

In the Godzspeed Sovereign Content Orchestration Platform, commercial video production is organized into two compute tiers:
1. Fast draft generation produces immutable storyboard candidates (FLUX.1 [schnell]).
2. The Creative Director reviews candidates and approves a specific candidate belonging to a specific SceneSpec revision.
3. Production rendering generates the high-fidelity video clips using headless ComfyUI on dedicated agency hardware (Trinidad RTX 4090), traceably conditioned by the approved storyboard candidate (ADR-0004).
4. Audio mixing and delivery assembly produces the final vertical reel (FFmpeg).

Prior to this architecture, technical completion of a production render job was at risk of triggering immediate, automatic audiovisual delivery assembly. In commercial content creation, however, **technical render completion does not equal creative production acceptance**:
- A diffusion render may complete with a valid MP4 container, exact frame count (97 frames), and certified resolution (1280x720), yet still exhibit unacceptable visual artifacts, unnatural character dynamics, uncanny valley motion, or poor temporal coherence.
- If assembly proceeds automatically upon technical completion, unapproved footage is stitched into delivery reels, wasting downstream assembly compute, cluttering delivery storage, and risking client exposure to unreviewed content.
- Furthermore, when creative direction requires a re-render, naively updating or deleting past render records destroys auditability and provenance.
- Finally, if human review commands (accept, re-render) do not cryptographically or relationally fence the exact render attempt viewed by the director, race conditions and stale browser actions can accept superseded attempts, causing severe creative desynchronization.

## Decision

We establish the foundational platform invariant:
> **"storyboard approved -> production rendered -> production reviewed/accepted (#215) -> final reel assembled -> director watches/downloads the result (#213)"**

To enforce this invariant across the domain, application, infrastructure, API, and UI layers, we implement the following architectural rules:

### 1. Strict Separation of Technical Completion and Creative Acceptance
Technical render execution and human creative acceptance are strictly separated across distinct lifecycle stages and state machines:
- When a worker finishes rendering a production job, it commits the `GenerationManifest` and transitions the scene to `qa` and the `CampaignProductionRun` to `production_review`.
- Technical completion **never** automatically enqueues delivery assembly.
- Delivery assembly admission is gated behind explicit human director acceptance across every required scene in the campaign production run.

### 2. Formal Distinction of Review and Retry Concepts
To eliminate ambiguity across UI, API, and domain logic, four distinct lifecycle concepts are formally established:
1. **Storyboard candidate reroll (`reroll`):** Creative rejection during draft review (`director_review -> generating_candidates`). Invalidates the current candidate selection and clears approval. Has no relationship to production attempts.
2. **Infrastructure retry of one render job:** Transient worker lease timeouts, worker node disconnections, or infrastructure crashes before manifest creation. Managed by `RenderJob`/`JobQueue` retry policies without incrementing attempt ordinal or creating a new attempt ledger entry.
3. **Creative production re-render as a new attempt (`production_rerender`):** Creative rejection during production review (`qa -> queued`). The render was technically successful, but the director requests another creative iteration. Increments `productionAttemptOrdinal`, creates an immutable ledger row in `campaign_production_attempts`, and preserves SceneSpec revision, selected candidate, and storyboard approval.
4. **Explicit accepted production attempt (`production_accept`):** Human sign-off on a specific attempt (`qa -> completed`). Sets `acceptedProductionAttemptId` on the Scene and `accepted_attempt_id`, `accepted_production_job_id`, and `accepted_attempt_ordinal` on the `CampaignProductionRunScene`. This is the **only** attempt authorized to feed downstream delivery assembly.

### 3. Attempt-Fenced Review Commands (`expectedProductionJobId`)
Both `production_accept` and `production_rerender` commands require an explicit `expectedProductionJobId` in their command payload:
- If a director's browser issues an acceptance or re-render referencing an active job that has been superseded by a newer attempt, the command fails closed with `409 STALE_PRODUCTION_ATTEMPT_CONFLICT`, even if `expectedSpecRevision` is unchanged.
- Idempotent command replay (same `actionId` and identical payload) returns `200 OK` with `isIdempotentReplay: true` and creates zero duplicate attempts, jobs, or review events.
- Conflicting command replay (same `actionId` with altered payload) fails with `409 IDEMPOTENCY_CONFLICT`.

### 4. Fail-Closed Assembly Admission (`attemptEnqueueAssemblyForAcceptedRun`)
Delivery assembly is admitted only when all required scenes in the campaign production run have been explicitly accepted. At admission time, the system re-validates full structural and provenance invariants:
- Every scene must possess non-null `acceptedAttemptId`, `acceptedProductionJobId`, and `acceptedAttemptOrdinal`.
- The accepted attempt record must exist in `campaign_production_attempts` and match the accepted attempt ID.
- The attempt must belong to the exact `sceneId` and exact `runId` (prohibiting cross-scene or cross-run leakage).
- The attempt's `specRevision` must match the scene's `specRevision`.
- The attempt's `ordinal` must match `acceptedAttemptOrdinal`.
- The attempt's production job must have an immutable `GenerationManifest` recorded in `generation_manifests`.
- The sum of expected stem durations must exactly equal `run.expectedTotalDurationMs`.
- If any check fails, a typed `AcceptedProductionAttemptInvariantError` is thrown, the transaction is rolled back, the run remains in `production_review`, and zero assembly jobs are created.
- When all checks pass, video stems are mapped to `AssemblySpec.videoStems` in canonical `sequenceIndex` order and enqueued to `delivery_assembly_jobs`.

### 5. Canonical Downstream Delivery Handoff (#213) — COMPLETE
Downstream commercial delivery packaging and client handoff (Parent #213, Issues #276–#278) consumes the canonical completed assembly and immutable `AssemblyManifest` produced after this gate. Delivery cannot be triggered from unreviewed renders, incomplete runs, or partially accepted campaigns. With #213 closed, the director can watch and download the canonical assembled delivery reel directly inside the Review Hub (`CampaignDeliveryReelPanel`), completing the full pipeline invariant:
> **`storyboard approved -> production rendered -> production reviewed/accepted (#215) -> final reel assembled -> director watches/downloads the result (#213)`**

## Consequences

- Directors have absolute certainty that commercial deliveries contain only explicitly accepted footage matching their creative intent.
- Historical attempts and rejected iterations remain fully auditable in `campaign_production_attempts` and `review_events`.
- Technical render failures and creative re-renders are cleanly decoupled and cannot contaminate each other.
- The platform eliminates accidental double-assembly and guarantees deterministic stem ordering in final commercial deliverables.
