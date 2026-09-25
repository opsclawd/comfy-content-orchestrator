# 6. Candidate Reference Semantics, Canonical Geometry, and Quality Architecture

Date: 2026-09-24

## Status

Partially Superseded by ADR 0007 (2026-09-25)

> **Partial Supersession Notice (2026-09-25):**
> This ADR is partially superseded by [ADR 0007: ShotPlan, Non-Authoritative Previs, and MiniMax-H3 Production Routing Architecture](0007-shotplan-previs-h3-routing-architecture.md).
>
> **Superseded Sections:**
> - **Section 1 ("Single-Stage Authoritative Candidate Pipeline"):** Superseded by ADR 0007 §1, §2, §4. Storyboard/previs candidate stills are no longer mandatory production `first_frame` conditioning. Real ReferenceAssets + approved `ShotPlan` form production visual authority in the default `reference_directed` mode. Previs candidate media serves strictly as non-authoritative director review evidence.
> - **Section 4.2 ("Production-Native Candidate Geometry"):** Superseded by ADR 0007 §7. Previs candidates do not require native 1344x768 resolution because they are non-authoritative visualizations by default. Native 1344x768 remains required for H3 production video profiles and anchor frames in `frame_anchored` mode.
> - **Section 6 ("End-to-End Reconstructable Provenance Chain"):** Superseded by ADR 0007 §9. Provenance reconstructs through `ShotPlan` and `ReferenceAsset` hashes rather than assuming every production attempt descends from an approved storyboard candidate still.
>
> **Preserved Sections (Strictly In Force):**
> - **Section 3 ("Reference Semantics & Boundary Separation"):** Preserved in full. Canonical roles (`subject_identity`, `product`, `location`, `style`, `composition`), ownership entities (`ReferenceAsset`, `ReferenceGroup`, `SceneReferenceBinding`), and the `libraryRole` amendment remain authoritative.
> - **Section 4.1 ("Geometry Authority Lives in SceneSpec"):** Preserved in full. Creative resolution authority resides in `SceneSpec.geometry`.
> - **Section 4.3 ("Vertical Reel Assembly Separation"):** Preserved in full. Downstream FFmpeg assembly (`VERTICAL_REEL_1080X1920_V1`) operates on landscape stems via `fit_blurred_fill`.
> - **Section 5 ("Objective Candidate Eligibility vs. Subjective Ranking"):** Preserved in full for candidate/previs generation.

## Context

In commercial generative video production, the creative director's intent must be preserved from concept through delivery without silent drift, hallucination, or geometric distortion.

Under the initial implementation of the Godzspeed platform:
1. Candidate storyboard images were generated using unconditioned FLUX.1 [schnell] at 1024x1024 square resolution (`templates/flux_schnell_draft_api.json`).
2. Production video rendering transitioned from LTX-Video to MiniMax-H3 (`templates/minimax_h3_720p_i2v_124f_api.json`), which operates natively at 1344x768 (16:9 landscape) and requires a high-fidelity reference frame (`first_frame`) fed directly into Node 104 (`MiniMaxH3ImageToVideo`).
3. Because FLUX Schnell lacked reference conditioning (identity, product, location, style), candidates were purely text-prompted. Characters, products, and environments varied randomly across scenes, breaking campaign continuity.
4. Furthermore, feeding square 1024x1024 candidates into a 1344x768 video generator forced arbitrary cropping or anamorphic stretching, causing severe framing errors and visual degradation between what the creative director approved and what MiniMax-H3 rendered.
5. In addition, there was no objective gate distinguishing between non-viable diffusion failures (e.g. anatomical deformities, fused faces, extra limbs, corrupt provenance) and subjective aesthetic taste, burdening creative directors with reviewing structurally broken candidates.

Parent: #304 (Production-grade reference-conditioned candidate pipeline)

## Decision

We establish the foundational platform invariant:
> **"Storyboard candidates must be generated with verifiable reference conditioning at production-native geometry, objectively certified for structural integrity before director review, and directly condition downstream production video without intermediate re-rendering or geometric distortion."**

To enforce this invariant across the platform, we establish the following architectural rules:

### 1. Single-Stage Authoritative Candidate Pipeline *(Partially Superseded by ADR 0007 §1, §2, §4)*

> *Supersession Note (2026-09-25):* Under ADR 0007, storyboard/previs candidate stills are no longer mandatory production `first_frame` conditioning. Real ReferenceAssets + approved `ShotPlan` form production visual authority in the default `reference_directed` mode. Previs candidate media serves strictly as non-authoritative director review evidence. The single-frame I2V flow remains available exclusively under the opt-in `frame_anchored` routing mode.

We define a single, authoritative storyboard candidate lifecycle stage:
`SceneSpec -> production-capable candidate batch -> automated eligibility gate -> director approval -> MiniMax-H3 first_frame`

- No intermediate "draft refinement", "high-res fix", or secondary "keyframe approval" aggregates are introduced.
- The approved `StoryboardCandidate` is the exact media asset staged to ComfyUI as `first_frame` for MiniMax-H3 production rendering.
- This eliminates multi-stage approval confusion and guarantees that what the director approves is bit-identically what conditions the video diffusion engine.

### 2. Retirement Policy for FLUX Schnell
- Upon operational certification of the replacement reference-conditioned candidate RenderProfile on the RTX 4090 host (#312, #317), FLUX Schnell is removed from default production routing.
- The legacy `flux_schnell_draft` profile and workflow template remain in the codebase strictly as a diagnostic benchmark baseline.
- Default campaign candidate dispatch fails closed if attempted against unconditioned or retired profiles.

### 3. Reference Semantics & Boundary Separation
Reference conditioning must support character identity, commercial products, environments, and style while preserving clean domain separation between storage, logical grouping, and scene usage.

#### Supported Reference Roles
We define five canonical reference roles:
- `subject_identity`: Facial features, anatomical proportions, and likeness of an actor or character across scenes.
- `product`: Commercial hero objects, packaged goods, logos, materials, and dimensional fidelity.
- `location`: Specific architectural, interior, or outdoor environment continuity.
- `style`: Aesthetic medium, color palette, lighting mood, photographic rendering, or film stock texture.
- `composition`: Spatial blocking, camera angle, subject positioning, and framing structure.

#### Ownership & Entity Boundaries
To prevent semantic entanglement and allow asset reuse:
1. **`ReferenceAsset` (Immutable Storage Entity with Declared Library Classification):** Represents the stored binary asset. Contains SHA-256 hash, byte size, MIME type, dimensions (width, height), and immutable storage key. Under Amendment (Issue #308), `ReferenceAsset` additionally carries a declared `libraryRole: ReferenceRole | null` representing an editor-declared default/intended classification of a reusable library asset. This declared classification is explicitly distinguished from `SceneReferenceBinding.role`; it does not constitute a scene assignment, binding, or executed conditioning fact.
2. **`ReferenceGroup` (Logical Scope Entity):** An optional organizational collection of `ReferenceAsset`s belonging to a client or campaign (e.g. "Brand Assets - Fall 2026", "Hero Actor - Elena").
3. **`SceneReferenceBinding` (Scene Revision Entity):** The binding connecting a `ReferenceAsset` to a specific `SceneSpec` revision. The binding declares the specific `ReferenceRole` (`subject_identity`, `product`, etc.), an optional conditioning strength/weight (0.0 to 1.0), and optional regional/bounding hints. A single `ReferenceAsset` can be bound as `subject_identity` in Scene 1 and as `style` in Scene 2, regardless of its `libraryRole`.

#### Amendment: Declared Library Role Classification (`libraryRole`)
To satisfy Review Hub gallery visibility and role badge requirements (AC-1, REQ-DESIGN-2, REQ-DESIGN-8) without violating the clean boundary between declared intent, configured bindings, and executed conditioning:
- Stored `ReferenceAsset` records support `libraryRole: ReferenceRole | null`.
- Upload requires an explicit `ReferenceRole` selection.
- Existing / legacy records default to `null` and render a clearly labeled `Unassigned` role badge in the UI until an authorized user explicitly assigns one via a dedicated role assignment action.
- Automatic role inference from image content or pixels is strictly prohibited.
- `libraryRole` must never be conflated with or automatically copied to `SceneReferenceBinding.role`. Scene reference bindings remain explicit, revisioned entities managed during campaign planning and scene generation (#309).

### 4. Canonical Geometry Authority & Lifecycle Invariants
Conflicting geometric assumptions between draft generation, video synthesis, and vertical delivery are resolved as follows:

1. **Geometry Authority Lives in `SceneSpec`:**
   - Creative aspect ratio and resolution authority resides authoritatively in `SceneSpec.geometry` (defaulting to campaign standards, e.g. 16:9 landscape, 1344x768).
   - Candidate RenderProfiles obtain their target width and height directly from the scene geometry contract, not from hard-coded workflow defaults.
2. **Production-Native Candidate Geometry:** *(Partially Superseded for Previs by ADR 0007 §7)*
   - *Supersession Note (2026-09-25):* Previs candidate stills are non-authoritative visualizations and do not require strict production-native 1344x768 geometry. Target native 1344x768 resolution remains strictly authoritative for H3 production video profiles and anchor frames in `frame_anchored` mode.
   - Candidates must be generated at the native resolution and aspect ratio required by the downstream production video profile (1344x768 for `MINIMAX_H3_720P_5S_I2V_V1`).
   - In-workflow or post-hoc stretching is prohibited. Any aspect-ratio mismatch between approved candidate and production render profile is rejected at dispatch time.
3. **Vertical Reel Assembly Separation:**
   - Final vertical delivery (`VERTICAL_REEL_1080X1920_V1`) is an audiovisual assembly operation executed downstream via FFmpeg (ADR-0005).
   - The production video stems remain native landscape (1344x768). Delivery assembly performs certified framing, smart-cropping, or letterboxing according to `AssemblySpec.layout`.
4. **Approval Invalidation Rules:**
   - Any modification to `SceneSpec` prompts, assigned references, reference bindings, duration, or geometry (aspect ratio, target dimensions) increments `specRevision`.
   - Incrementing `specRevision` immediately invalidates any existing candidate selection (`selectedCandidateId = null`) and resets director approval (`approval = null`).

### 5. Objective Candidate Eligibility vs. Subjective Ranking
We strictly decouple objective machine-verifiable eligibility from human creative preference:

1. **Eligibility (Automated Hard Fail-Closed Gate):**
   A candidate is marked `ineligible` and blocked from director selection if any of the following occur:
   - **Provenance Failure:** Missing, corrupted, or hash-mismatched `ReferenceAsset` inputs.
   - **Geometry Violation:** Candidate dimensions do not match the required `SceneSpec` geometry.
   - **Structural/Topological Defect:** Automated visual QA (#314) detects severe anatomical corruptions (e.g., duplicated/missing limbs, melted hands, multiple heads, fused facial topology).
   - Ineligible candidates remain recorded in the immutable audit trail for diagnostic evaluation but cannot be selected or approved in the Review Hub.
2. **Subjective Ranking (Advisory Creative Guidance):**
   - Aesthetic appeal, lighting nuance, acting performance, and compositional balance remain human creative determinations.
   - Machine models may provide non-blocking advisory ranking or guidance tags, but cannot unilaterally disqualify an otherwise structurally sound candidate.

### 6. End-to-End Reconstructable Provenance Chain *(Superseded by ADR 0007 §9)*

> *Supersession Note (2026-09-25):* Replaced by the post-pivot reconstruction chain in ADR 0007 §9:
> `SceneSpec revision -> ShotPlan revision/identity -> ReferenceAsset IDs/hashes + SceneReferenceBindings -> selected H3 route/profile + executed multimodal inputs -> ProductionAttempt -> output`.
> Review-only previs evidence (`previsReviewEvidence`) is strictly isolated from executed diffusion conditioning (`executionConditioning`).

Auditability requires that every generated asset be deterministically reconstructable:
$$\text{SceneSpec revision} \longrightarrow \text{ReferenceAsset SHA-256 hashes} + \text{prompt} + \text{seed} + \text{RenderProfile} \longrightarrow \text{StoryboardCandidate} \longrightarrow \text{Director Selection} \longrightarrow \text{MiniMax-H3 Attempt}$$

The `GenerationManifest` for both candidate still generation and video production records:
- `specRevision` and `sceneId`
- All bound `ReferenceAsset` identifiers and their SHA-256 digests
- Exact workflow template identity and workflow hash
- Model weights hashes from the certified `RenderProfile`
- Generation parameters (seed, sampling steps, CFG, scheduler, denoise, dimensions)
- Upstream candidate identity and hash (for video production jobs)

## Consequences

- Directors review production-viable candidates that faithfully reflect reference characters, products, and sets.
- Eliminates geometric distortion, anamorphic stretching, and unexpected framing changes between storyboard approval and video delivery.
- Establishes a clear separation between immutable asset storage, campaign asset organization, and scene-level semantic bindings.
- Prevents wasted director time by filtering out structurally deformed or invalid candidates before human review.
- Downstream implementation issues (#306 through #316) have a fixed, authoritative architectural specification.
