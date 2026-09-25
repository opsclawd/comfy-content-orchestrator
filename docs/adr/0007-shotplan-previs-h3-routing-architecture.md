# 7. ShotPlan, Non-Authoritative Previs, and MiniMax-H3 Production Routing Architecture

Date: 2026-09-25

## Status

Accepted

## Context

In commercial generative video production, initial implementations of the Godzspeed platform conditioned video diffusion directly on single 2D still images (ADR 0004, ADR 0006). Under that paradigm:
1. Fast still diffusion (FLUX.1 [schnell] or a reference-conditioned still profile) produced a 2D candidate still image (`StoryboardCandidate`).
2. The director approved the still image in the Review Hub.
3. The approved still image was staged directly as `first_frame` (Node 104 `MiniMaxH3ImageToVideo` in `templates/minimax_h3_720p_i2v_124f_api.json`) to initiate video diffusion.

While this established candidate-conditioned traceability, commercial generative video production revealed critical architectural limitations:
- **Diffusion Latent Warping:** Forcing an independently generated 2D still image to serve as the exact `first_frame` of an H3 video frequently causes unnatural motion pops, prompt fighting, skin warping, and uncanny-valley freeze frames during the initial seconds of video generation.
- **Reference Underutilization:** MiniMax-H3 possesses a native, multi-modal reference conditioning node—`MiniMaxH3ReferenceToVideo`—which natively accepts up to 9 reference images (`ref_images`), alongside prompt reference tags (`<Picture 1>` through `<Picture 9>`), directly synthesizing dynamic video from high-fidelity character, product, location, and style references without requiring a single pre-baked starting pixel frame.
- **Conflation of Visualization and Execution Authority:** The single-stage candidate pipeline in ADR 0006 overloaded `StoryboardCandidate` to simultaneously represent:
  - Human creative evaluation of shot composition, lighting, and framing ("Is this what the director wants?"), and
  - Rigid pixel-level diffusion conditioning ("Every pixel in this still must anchor the video engine").

Parent: #325 (Production-grade reference-directed MiniMax-H3 pipeline)
Issue: #326 (Define ShotPlan, previs authority, and H3 routing architecture)

## Decision

We establish the foundational post-pivot platform invariant:
> **"A storyboard or previsualization image MUST NOT serve as production pixel authority by default. In `reference_directed` production, approved SceneReferenceBindings and the approved ShotPlan are the exclusive visual conditioning authority. Previsualization media serves strictly as non-authoritative director review evidence."**

Only in the explicit, opt-in `frame_anchored` mode does an approved image candidate serve as a pixel-level anchor (`first_frame` or `last_frame`) to satisfy hard cut-to-cut visual continuity requirements.

---

### 1. Production Authority Hierarchy

We define the authoritative production-input hierarchy for visual generation:

```text
Authoritative Production Inputs:
  1. Approved current-revision SceneSpec (creative scope, script, geometry, timing)
  2. Approved ShotPlan (structured camera, blocking, beats, lighting, continuity)
  3. Immutable current-revision SceneReferenceBindings (role, binding order)
     + Verified ReferenceAsset SHA-256 binary digests
  4. Explicit H3 RenderProfile & RoutingMode (reference_directed vs frame_anchored)

Non-Authoritative Review Evidence:
  - Storyboard / Previs Candidate Media (review visualization only; NOT pixel conditioning by default)
```

In `reference_directed` production:
- Production video diffusion dispatches with real reference assets and structured prompt guidance.
- Previs stills provide non-authoritative visualization for human director sign-off in the Review Hub.
- Previs pixels are never staged or injected into diffusion conditioning nodes.

---

### 2. Canonical ShotPlan Specification

#### 2.1 Domain Concept & Identity
A `ShotPlan` is an explicit, structured specification of camera, staging, lighting, temporal dynamics, and continuity constraints that bridges high-level script copy with low-level diffusion model execution.
- **Identity:** `ShotPlanId` (UUIDv7 string).
- **Ownership:** Bound to exactly one `SceneId` and one `specRevision`.
- **Variant Ordinal:** `variantOrdinal` (positive integer: 1, 2, 3...) enabling multiple alternative shot plans for the same scene revision during planning.
- **Status:** `'draft' | 'approved' | 'superseded' | 'rejected'`.

#### 2.2 Canonical Field Schema
The canonical `ShotPlan` contract comprises the following structured dimensions:

```typescript
export type ShotPlanRoutingMode = "reference_directed" | "frame_anchored";

export type ShotFraming =
  | "extreme_wide"
  | "wide"
  | "full_shot"
  | "medium_wide"
  | "medium"
  | "medium_close_up"
  | "close_up"
  | "extreme_close_up";

export type CameraAngle =
  | "eye_level"
  | "low_angle"
  | "high_angle"
  | "bird_eye"
  | "worm_eye"
  | "dutch_angle"
  | "over_the_shoulder";

export type CameraMovement =
  | "static"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "dolly_in"
  | "dolly_out"
  | "tracking"
  | "pedestal_up"
  | "pedestal_down"
  | "crane"
  | "arc"
  | "orbit"
  | "whip_pan";

export type MovementSpeed = "slow" | "medium" | "fast" | "variable";

export type LightingStyle =
  | "natural_golden_hour"
  | "high_key_commercial"
  | "low_key_dramatic"
  | "chiaroscuro"
  | "softbox_studio"
  | "neon_night"
  | "overcast_diffused"
  | "practical_interior";

export interface ShotPlanSubjectBlocking {
  readonly subjectId: string;
  readonly referenceAssetId?: string | null;
  readonly role: "subject_identity" | "product";
  readonly initialPosition:
    | "screen_left"
    | "screen_center"
    | "screen_right"
    | "foreground_left"
    | "foreground_center"
    | "foreground_right"
    | "background_center";
  readonly movementTrajectory: string;
  readonly interactionSummary?: string | null;
}

export interface ShotPlanTemporalBeat {
  readonly beatIndex: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly description: string;
  readonly cameraAction: string;
  readonly subjectAction: string;
}

export interface ShotPlanDialogueIntent {
  readonly speaker?: string | null;
  readonly line?: string | null;
  readonly audioFxPrompt?: string | null;
  readonly voiceoverCue?: string | null;
  readonly deliveryEmotion?: string | null;
}

export interface ShotPlanContinuityConstraints {
  readonly incomingContinuityFromSceneId?: string | null;
  readonly persistentSubjectIds: readonly string[];
  readonly lightingContinuityNote?: string | null;
  readonly frameAnchorTarget: "none" | "first_frame" | "last_frame" | "both";
  readonly anchorCandidateId?: string | null;
  readonly anchorMediaHashSha256?: string | null;
}

export interface ShotPlanPrevisAssociation {
  readonly candidateId: string;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly contentHashSha256: string;
  readonly modelProfile: string;
  readonly generatedAt: string;
  readonly reviewNotes?: string | null;
}

export interface ShotPlanDocument {
  readonly id: string;
  readonly sceneId: string;
  readonly specRevision: number;
  readonly variantOrdinal: number;
  readonly status: "draft" | "approved" | "superseded" | "rejected";
  readonly routingMode: ShotPlanRoutingMode;
  
  // Timing & Frame Quantification
  readonly targetDurationMs: number;
  readonly targetFrameCount: number;
  readonly durationToleranceMs: number;
  readonly fps: 24;

  // Visual Framing & Camera Intent
  readonly framing: ShotFraming;
  readonly angle: CameraAngle;
  readonly lensIntent: string; // e.g. "35mm anamorphic prime, shallow depth of field"
  readonly cameraPosition: string; // e.g. "eye level, tripod-mounted with fluid head"
  readonly cameraMovement: CameraMovement;
  readonly movementSpeed: MovementSpeed;
  readonly cameraPromptDescription: string;

  // Staging & Blocking
  readonly subjects: readonly ShotPlanSubjectBlocking[];
  readonly actionSummary: string;
  readonly beats: readonly ShotPlanTemporalBeat[];

  // Environment & Lighting
  readonly lightingStyle: LightingStyle;
  readonly environmentDescription: string;
  readonly colorPalette: readonly string[];
  readonly atmosphere?: string | null;

  // Optional Dialogue & Performance
  readonly dialogue?: ShotPlanDialogueIntent | null;

  // Explicit Continuity Fencing
  readonly continuity: ShotPlanContinuityConstraints;

  // Optional Previs Association
  readonly previs?: ShotPlanPrevisAssociation | null;

  // Metadata & Timestamps
  readonly machineModel?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}
```

#### 2.3 Duration Representation & Quantization Rules
- MiniMax-H3 runs at a fixed 24 FPS with a temporal frame grid governed by formula:
  $$\text{frames} = 5 + 17k \quad (k \in \mathbb{N})$$
- For a standard 5.0-second commercial shot:
  $$k = 7 \implies \text{frames} = 5 + 17(7) = 124 \text{ frames}$$
  $$\text{Duration} = \frac{124 \text{ frames}}{24 \text{ fps}} \approx 5.1667 \text{ seconds} = 5167 \text{ ms}$$
- The quantization tolerance window is half a grid step:
  $$\text{Tolerance} = \lceil \frac{17 / 2}{24} \times 1000 \rceil = 355 \text{ ms}$$
- If a requested `targetDurationMs` outside the tolerance of 124 frames (e.g. <4812ms or >5522ms for a 5s profile) is requested, validation fails closed with `DurationQuantizationError`.

#### 2.4 Field Mutability & Invalidation Matrix
To support autonomous planning by LLMs and human directorial refinement in the Review Hub without accidental creative corruption, fields adhere to strict mutability rules:

| Field Group | Machine Planned | Director Editable (Pre-Approval) | Approval-Invalidating Mutation |
|---|---|---|---|
| `id`, `sceneId`, `specRevision`, `variantOrdinal` | Yes (Server) | No (Immutable identity) | N/A (Cannot mutate) |
| `targetDurationMs`, `targetFrameCount`, `fps` | Yes (Derived) | No (Governed by SceneSpec duration) | SceneSpec revision increment |
| `routingMode` | Yes (Default `reference_directed`) | Yes | Invalidates approval |
| `framing`, `angle`, `lensIntent`, `cameraMovement` | Yes | Yes | Invalidates approval |
| `subjects`, `actionSummary`, `beats` | Yes | Yes | Invalidates approval |
| `lightingStyle`, `environmentDescription`, `colorPalette` | Yes | Yes | Invalidates approval |
| `dialogue`, `deliveryEmotion` | Yes | Yes | Invalidates approval |
| `continuity` (`frameAnchorTarget`, `anchorCandidateId`) | Yes | Yes | Invalidates approval |
| `previs` (`candidateId`, `reviewNotes`) | Attached by previs worker | Notes editable | Adding/replacing previs does NOT invalidate approved ShotPlan structure |

---

### 3. Decoupled Previs Semantics & Historical Auditability

#### 3.1 Coexistence with Historical `StoryboardCandidate` Records
- **No Data Deletion or Rewriting:** Existing rows in `storyboard_candidates` are protected by PostgreSQL audit triggers (`reject_audit_mutation()`) and remain completely untouched.
- **Historical Invariant Preservation:** Prior scene runs (e.g. LTX or early H3 candidates rendered under ADR 0004/0006) preserve their recorded `selected_candidate_id` and legacy provenance.
- **Semantic Separation:**
  - `storyboard_candidates`: Retained as the immutable media storage record for generated candidate stills (now designated as non-authoritative previs media).
  - `shot_plans`: Serves as the authoritative creative and production-intent contract.
  - In `reference_directed` mode, `selected_candidate_id` on `storyboard_scenes` is purely a visual review anchor; it is never staged to the ComfyUI video worker.
  - In `frame_anchored` mode, `selected_candidate_id` (or `continuity.anchorCandidateId`) is verified as the authoritative first/last frame pixel asset.

---

### 4. Persistence Boundary & Scene Aggregate Pointer

#### 4.1 Persistence Model
`ShotPlan` is a first-class persisted entity managed within PostgreSQL:
- **Table:** `shot_plans`
- **Primary Key:** `shot_plan_id UUID`
- **Revision Ownership:** Owned by `storyboard_scenes(scene_id)` at a specific `spec_revision`.
- **Relational Integrity:**
  - `FOREIGN KEY (scene_id) REFERENCES storyboard_scenes(scene_id) ON DELETE RESTRICT`
  - `UNIQUE (scene_id, spec_revision, variant_ordinal)`
  - `UNIQUE (shot_plan_id, scene_id, spec_revision)`
  - Optional previs candidate link: `FOREIGN KEY (previs_candidate_id) REFERENCES storyboard_candidates(candidate_id) ON DELETE SET NULL`
- **Append-Only Invariant:** Once a `ShotPlan` is marked `approved`, it becomes immutable. If the director requests changes to an approved plan, a new `specRevision` or new `variantOrdinal` must be materialized.

#### 4.2 Scene Aggregate Pointer
On `storyboard_scenes`, candidate selection pointers are supplemented with explicit shot plan selection pointers:
- `selected_shot_plan_id UUID`
- `selected_shot_plan_revision INT`
- `production_routing_mode VARCHAR(32) NOT NULL DEFAULT 'reference_directed'`
- **Integrity Constraints:**
  - `CHECK ((selected_shot_plan_id IS NULL AND selected_shot_plan_revision IS NULL) OR (selected_shot_plan_id IS NOT NULL AND selected_shot_plan_revision IS NOT NULL))`
  - `CHECK (selected_shot_plan_revision IS NULL OR selected_shot_plan_revision = spec_revision)`
  - `FOREIGN KEY (selected_shot_plan_id, scene_id, selected_shot_plan_revision) REFERENCES shot_plans(shot_plan_id, scene_id, spec_revision)`

---

### 5. MiniMax-H3 Production Routing Architecture

#### 5.1 The Two H3 Routing Modes
MiniMax-H3 production rendering dispatches through two strictly decoupled certified pipelines:

1. **`reference_directed` (Platform Default for New Commercial Scenes):**
   - **Engine Identity:** `minimax_h3_ref2v`
   - **ComfyUI Certified Node:** `MiniMaxH3ReferenceToVideo`
   - **Execution Topology:**
     - Up to 9 reference images staged into `ref_images`
     - Text prompt structured with indexed `<Picture i>` tags corresponding to bound references
     - Global reference scaling mode: `ref_image_size: "max"` (2048px short edge, identity-preserving)
     - High-resolution video VAE (`minimax_h3_video_vae_int8_convrot.safetensors`)
     - Optional audio VAE (`minimax_h3_audio_vae_fp32.safetensors`)
   - **Pixel Authority:** Reference assets + structured prompt. Previs candidate pixels are NOT injected into diffusion.

2. **`frame_anchored` (Explicit Continuity Route):**
   - **Engine Identity:** `minimax_h3_i2v`
   - **ComfyUI Certified Node:** `MiniMaxH3ImageToVideo` (Node 104 in current template)
   - **Execution Topology:**
     - Prompt text
     - `first_frame` (IMAGE): Exactly one image, stretched to canvas (1344x768)
     - Optional `last_frame` (IMAGE): Exactly one image, cropped to cover canvas
   - **Pixel Authority:** The staged anchor image(s) condition the exact starting/ending boundary pixels.

#### 5.2 Deterministic Production Routing Decision Table
Routing is determined exclusively by explicit contract declarations. No heuristic inference based on file existence is permitted.

| Condition / Input State | Declared Routing Mode | Required Verified Inputs | Forbidden / Invalid Inputs | Outcome | Fail-Closed Error Code |
|---|---|---|---|---|---|
| Approved ShotPlan with `routingMode: "reference_directed"` | `reference_directed` | - Approved ShotPlan matching `specRevision`<br>- Scene approval matching `specRevision`<br>- 1 to 9 bound ReferenceAssets with valid SHA-256 digests | - `first_frame` staging<br>- >9 bound references<br>- Unsupported reference media (e.g. video/audio) | **DISPATCH `reference_directed`** (Node `MiniMaxH3ReferenceToVideo`) | `REFERENCE_LIMIT_EXCEEDED` if >9; `UNSUPPORTED_MEDIA_TYPE` if video/audio |
| Approved ShotPlan with `routingMode: "frame_anchored"`, `frameAnchorTarget: "first_frame"` | `frame_anchored` | - Approved ShotPlan matching `specRevision`<br>- Scene approval matching `specRevision`<br>- Verified anchor candidate image (`selectedCandidateId` or `anchorCandidateId`) with valid SHA-256 | - Missing anchor image<br>- Anchor image aspect ratio mismatch >5%<br>- Multi-image reference batch staging | **DISPATCH `frame_anchored`** (Node `MiniMaxH3ImageToVideo`, Node 20 `first_frame`) | `MISSING_ANCHOR_FRAME` if null; `STALE_CANDIDATE_REVISION` if rev mismatch; `ANCHOR_GEOMETRY_MISMATCH` if aspect bad |
| Approved ShotPlan with `routingMode: "frame_anchored"` but anchor candidate is missing/null | `frame_anchored` | None | Missing anchor image | **FAIL CLOSED** (Job dispatch blocked) | `MISSING_ANCHOR_FRAME` |
| Scene has unapproved ShotPlan or `selected_shot_plan_id IS NULL` | Any | None | Unapproved plan | **FAIL CLOSED** (Dispatch blocked) | `UNAPPROVED_SHOT_PLAN` |
| Stale revision (`shotPlan.specRevision != scene.specRevision`) | Any | None | Stale revision | **FAIL CLOSED** (Dispatch blocked) | `STALE_SHOT_PLAN_REVISION` |
| Ambiguous routing mode (`routingMode` is null, unknown, or unrecognized string) | Unknown | None | Ambiguous routing | **FAIL CLOSED** (Dispatch blocked) | `UNKNOWN_ROUTING_MODE` |
| Bound reference count = 0 in `reference_directed` mode | `reference_directed` | Approved ShotPlan | Zero reference assets | **DISPATCH text-only reference_directed** (Prompt-only guidance via `MiniMaxH3ReferenceToVideo` without `ref_images`) | N/A (Permitted if explicit prompt-only scene intended) |

#### 5.3 Strict No-Silent-Fallback Invariant
- A failed `reference_directed` job NEVER falls back silently to `frame_anchored` or text-to-video.
- A failed `frame_anchored` job NEVER falls back silently to `reference_directed`.
- Zero heuristic "best-effort" toggles: If required conditioning assets cannot be retrieved or verified against their SHA-256 hashes, execution halts immediately with a typed error.

---

### 6. Reference-Role Capability & Multiplicity Matrix

Canonical reference roles established in ADR 0006 and Issue #306 are mapped directly onto the `reference_directed` MiniMax-H3 execution envelope:

| Canonical Role (#306) | Representable in H3 `reference_directed`? | Multiplicity Bounds | Staging & Prompt Tag Mapping | Fidelity Mode (`ref_image_size`) | Unsupported / Out-of-Bounds Behavior |
|---|---|---|---|---|---|
| `subject_identity` | **Yes (Full)** | 1 to 3 images | Staged into `ref_images`; Prompt references `<Picture i>` with character name & visual traits (e.g. "Elena depicted in <Picture 1>") | `"max"` (2048px short edge, high identity fidelity) | >3 subjects or >9 total references fails closed with `REFERENCE_LIMIT_EXCEEDED` |
| `product` | **Yes (Full)** | 1 to 2 images | Staged into `ref_images`; Prompt references `<Picture i>` with product description & packaging details | `"max"` (High dimensional & logo fidelity) | Product missing SHA-256 or unreadable fails closed with `CORRUPT_REFERENCE_ASSET` |
| `location` | **Yes (Full)** | 1 image | Staged into `ref_images`; Prompt references `<Picture i>` for architectural & set continuity | `"match"` or `"max"` | >1 location fails closed (conflicting environmental grounding) |
| `style` | **Yes (Full)** | 1 to 2 images | Staged into `ref_images`; Prompt references `<Picture i>` for film stock, color grading, and lighting tone | `"match"` | Exceeding 9 total references fails closed |
| `composition` | **Partial / Qualified** | 0 to 1 image | Staged into `ref_images`; Prompt references `<Picture i>` for shot framing. *Note: MiniMax-H3 does not possess spatial ControlNet; composition is guidance, not pixel lock.* | `"match"` | Cannot guarantee exact bounding coordinates |

#### Global Multiplicity Rule
$$\sum \text{references} \le 9$$
If a scene binds more than 9 reference assets across all roles, dispatch fails closed with `REFERENCE_LIMIT_EXCEEDED`.

#### Conditioning Weight Handling
`SceneReferenceBinding.weight` (0.0 to 1.0) was established in ADR 0006 for potential ControlNet or LoRA weighting.
- **Empirical Constraint:** Built-in node `MiniMaxH3ReferenceToVideo` does NOT accept per-image continuous floating-point weights.
- **Architectural Policy:** In `reference_directed` mode, `weight` is treated as a **prompt-emphasis priority**, dictating tag positioning and descriptive emphasis in the generated prompt string. It does NOT configure an internal diffusion engine scalar. `weight` remains valid for auditability and future custom node support.

---

### 7. Decoupled Geometry Contract

We decouple geometry authority across four distinct pipeline stages:

```text
+-----------------------+     +-----------------------+
|  1. Loose Previs      |     |  2. Reference Assets  |
|  - Non-authoritative  |     |  - Client library res |
|  - 1024x1024 / 16:9   |     |  - No manual crop     |
|  - Fast review draft  |     |  - ref_image_size max |
+-----------------------+     +-----------------------+
            |                             |
            +--------------+--------------+
                           |
                           v
              +--------------------------+
              | 3. H3 Production Profile |
              | - SceneSpec authority    |
              | - 1344x768 native 16:9   |
              | - 24 FPS, 124 frames     |
              +--------------------------+
                           |
                           v
              +--------------------------+
              | 4. Final Delivery Reel   |
              | - 1080x1920 vertical     |
              | - FFmpeg fit_blurred_fill|
              | - ADR 0005 assembly      |
              +--------------------------+
```

#### Detailed Geometry Invariants
1. **Authoritative Creative Geometry Lives in `SceneSpec.geometry`:**
   - Standard commercial landscape: 1344x768 (16:9).
   - Any modification to `SceneSpec.geometry` increments `specRevision` and invalidates all existing ShotPlans, previs selections, and approvals.
2. **Previsualization Media Geometry:**
   - Previs stills are non-authoritative review artifacts.
   - Previs may be generated at draft resolutions (e.g. 1024x1024 or 1344x768). Aspect-ratio differences in previs do not break production video generation because previs pixels are not injected into the production diffusion graph in `reference_directed` mode.
3. **Reference Asset Geometry:**
   - Reference assets can be arbitrary client library dimensions (e.g. 2400x3600 portrait photo, 4000x4000 packshot).
   - In `reference_directed` mode, resizing is handled natively inside ComfyUI's reference pipeline (`ref_image_size: "max"` or `"match"`). Workers do not perform lossy destructive cropping prior to staging.
4. **H3 Production Profile Geometry:**
   - Video output resolution is strictly certified at 1344x768 at 24 FPS (124 frames for 5.17s).
   - In `frame_anchored` mode, `first_frame` is stretched to 1344x768 by node 104, while `last_frame` is cropped to cover. Anchor frames with aspect ratios deviating >5% from 16:9 must be rejected at staging to prevent severe stretching distortion.
5. **Final Vertical Delivery Reel Geometry:**
   - Delivery assembly (`VERTICAL_REEL_1080X1920_V1`) is a downstream FFmpeg operation (ADR 0005).
   - Stems remain native 1344x768 landscape. FFmpeg scales stems to 1080x608 foreground over a 1080x1920 blurred fill background (`gblur=sigma=20`).

---

### 8. State Machine, Approval, and Invalidation Matrix

#### 8.1 Mutation Invalidation Matrix
The following matrix defines the exact effect of every user and system event on platform entities:

| Event / Mutation | ShotPlan Selection | ShotPlan Approval | Previs Candidate Selection | Production Admission | Production Rerender Lineage |
|---|---|---|---|---|---|
| **Edit Scene Prompt** | Invalidated (`null`) | Invalidated (`null`) | Stale (`null`) | Blocked | Ineligible (spec revision incremented) |
| **Edit Scene References** (add/remove/rebind) | Invalidated (`null`) | Invalidated (`null`) | Stale (`null`) | Blocked | Ineligible (spec revision incremented) |
| **Edit Scene Duration / Geometry** | Invalidated (`null`) | Invalidated (`null`) | Stale (`null`) | Blocked | Ineligible (spec revision incremented) |
| **Director Updates Draft ShotPlan** (pre-approval) | Preserved (updates draft) | Unapproved (`null`) | Preserved | Blocked | N/A |
| **Director Rerolls ShotPlan** (`reroll_shotplan`) | Reset (`null`), spec revision++ | Reset (`null`) | Reset (`null`) | Blocked | N/A |
| **Director Selects ShotPlan** (`select_shotplan`) | Set (`selectedShotPlanId`) | Unapproved (`null`) | Preserved | Blocked until approval | N/A |
| **Director Approves ShotPlan** (`approve_shotplan`) | Locked (`selectedShotPlanId`) | Approved (`revision = specRevision`) | Retained as review evidence | **Admitted to Queue** | Initial Attempt (Ordinal 1) |
| **Previs Generation Batch Completes** | Unchanged | Unchanged | Available for selection | Blocked | N/A |
| **Director Selects Previs Candidate** | Unchanged | Unchanged | Set (`previsCandidateId`) | Blocked until approval | N/A |
| **Production Render Fails (Transient Worker Lease)** | Unchanged | Preserved | Preserved | Worker retry | Same attempt, retryCount++ |
| **Creative Production Re-render** (`production_rerender`) | Preserved | Preserved | Preserved | **Re-admitted to Queue** | New Attempt (Ordinal++) |
| **Production QA Reject** (`rejectQA`) | Preserved | Revoked (`null`) | Preserved | Blocked (returns to review) | Active attempt marked rejected |
| **Production Accept** (`production_accept`) | Preserved | Preserved | Preserved | **Admitted to Assembly** | Accepted attempt recorded |

#### 8.2 Stale Revision & Attempt Fencing
- **Optimistic Concurrency:** Commands mutating scene or shot plan state require `expectedSpecRevision`. If `expectedSpecRevision !== scene.specRevision`, the request fails with `409 STALE_REVISION_CONFLICT` and zero database writes.
- **Attempt Fencing:** Commands on production attempts require `expectedProductionJobId`. If `expectedProductionJobId !== scene.activeProductionJobId`, the request fails with `409 STALE_PRODUCTION_ATTEMPT_CONFLICT`.

---

### 9. Reconstructable Provenance Chain & Manifest Requirements

#### 9.1 The Post-Pivot Reconstruction Chain
Auditability requires mathematical reproducibility from persistent artifacts:
```text
SceneSpec revision
  -> ShotPlan revision / identity (framing, camera, blocking, beats, lighting)
  -> ReferenceAsset IDs / SHA-256 hashes + SceneReferenceBindings (role, binding order)
  -> Selected H3 Route & Profile (reference_directed vs frame_anchored)
  -> Executed Multimodal Inputs (indexed <Picture i>, ref_image_size, seed)
  -> ProductionAttempt (attemptId, ordinal, jobId, seed)
  -> Video Output & GenerationManifest
```

#### 9.2 Strict Manifest Separation Invariant
The `GenerationManifest` must never conflate non-authoritative review evidence with executed diffusion conditioning:
1. **Review Previs Evidence (`previsReviewEvidence`):**
   If a previs candidate still was reviewed or selected during the ShotPlan approval, its identity is captured in an isolated metadata block:
   ```json
   "previsReviewEvidence": {
     "candidateId": "01923456-789a-7b3c-9d4e-5f60718293a4",
     "contentHashSha256": "3a4f89b...",
     "storageBucket": "cco-previs",
     "storageObjectKey": "previs/scene-1/cand-1.png",
     "modelProfile": "FLUX_SCHNELL_DRAFT_V1"
   }
   ```
2. **Executed Conditioning (`executionConditioning`):**
   Captures ONLY the inputs physically wired into the ComfyUI execution graph:
   - In `reference_directed` mode:
     ```json
     "executionConditioning": {
       "routingMode": "reference_directed",
       "renderProfile": "MINIMAX_H3_720P_5S_REF2V_V1",
       "refImageSize": "max",
       "referenceImages": [
         {
           "index": 1,
           "referenceAssetId": "01928374-...",
           "contentHashSha256": "4b5c6d...",
           "role": "subject_identity",
           "promptTag": "<Picture 1>",
           "stagedAs": "conditioning/cco-scene-1-job-1-pic1.png"
         },
         {
           "index": 2,
           "referenceAssetId": "01928375-...",
           "contentHashSha256": "7e8f9a...",
           "role": "product",
           "promptTag": "<Picture 2>",
           "stagedAs": "conditioning/cco-scene-1-job-1-pic2.png"
         }
       ]
     }
     ```
   - In `frame_anchored` mode:
     ```json
     "executionConditioning": {
       "routingMode": "frame_anchored",
       "renderProfile": "MINIMAX_H3_720P_5S_I2V_V1",
       "firstFrame": {
         "candidateId": "01923456-...",
         "contentHashSha256": "3a4f89b...",
         "stagedAs": "conditioning/cco-scene-1-job-1-firstframe.png",
         "injectionTarget": { "nodeId": "104", "inputName": "first_frame" }
       }
     }
     ```
3. **The False Conditioning Invariant:**
   Under NO circumstances may `previsReviewEvidence` appear inside `executionConditioning` for a `reference_directed` render.

---

### 10. Partial Supersession of ADR 0006

ADR 0006 (`docs/adr/0006-candidate-reference-geometry-architecture.md`) is updated to status: **`Partially Superseded by ADR 0007`**.

#### Replaced Sections
- **Section 1 ("Single-Stage Authoritative Candidate Pipeline"):**
  *Replaced by:* ADR 0007 §1, §2, and §4. Previs stills no longer serve as mandatory `first_frame` conditioning. The authoritative pipeline proceeds from `SceneSpec + References -> ShotPlan -> Approval -> H3 Production Video`.
- **Section 4.2 ("Production-Native Candidate Geometry"):**
  *Replaced by:* ADR 0007 §7. Previs candidates do not require production-native 1344x768 resolution because they are non-authoritative. H3 production video profiles and anchor frames in `frame_anchored` mode retain native 1344x768 geometry.
- **Section 6 ("End-to-End Reconstructable Provenance Chain"):**
  *Replaced by:* ADR 0007 §9. The reconstruction chain transitions through `ShotPlan` and `ReferenceAsset` hashes rather than assuming every video attempt descends from an approved storyboard still.

#### Preserved Sections (Strictly In Force)
- **Section 3 ("Reference Semantics & Boundary Separation"):** Fully preserved. Canonical roles (`subject_identity`, `product`, `location`, `style`, `composition`), ownership entities (`ReferenceAsset`, `ReferenceGroup`, `SceneReferenceBinding`), and the `libraryRole` amendment remain authoritative.
- **Section 4.1 ("Geometry Authority Lives in SceneSpec"):** Fully preserved. Creative resolution authority resides in `SceneSpec.geometry`.
- **Section 4.3 ("Vertical Reel Assembly Separation"):** Fully preserved. Downstream FFmpeg assembly (`VERTICAL_REEL_1080X1920_V1`) operates on landscape stems via `fit_blurred_fill`.
- **Section 5 ("Objective Candidate Eligibility vs. Subjective Ranking"):** Fully preserved for previs candidate generation.

---

### 11. Empirical Uncertainties & Downstream Implementation Fencing

In accordance with platform governance, empirical uncertainties identified in preliminary ComfyUI node inspection are explicitly fenced so downstream tasks (#327 and #328) implement with deterministic contracts:

1. **Multi-Image Batch Wiring for `ref_images` in `MiniMaxH3ReferenceToVideo`:**
   - *Empirical Uncertainty:* The exact ComfyUI node graph topology for chaining up to 9 images into the single `ref_images` input (e.g. `ImageBatch` chain vs custom multi-slot adapter) requires verification against the live RTX 4090 ComfyUI host.
   - *Downstream Fence:* Issue #327 (contracts/persistence) requires only the ordered list of bound references with 1-based indices (`<Picture 1>` ... `<Picture 9>`). Issue #328 (worker execution) is responsible for the physical node batch wiring in the workflow template.
2. **Global vs. Per-Image Fidelity Mode (`ref_image_size`):**
   - *Empirical Uncertainty:* `ref_image_size` (`"match"` vs `"max"`) is a node-level parameter on `MiniMaxH3ReferenceToVideo`, indicating it applies globally to the entire reference batch.
   - *Downstream Fence:* Until ComfyUI supports per-image sizing, the production profile sets `ref_image_size: "max"` globally whenever any `subject_identity` or `product` reference is present, ensuring maximum likeness fidelity.
3. **Absence of Native Reference Conditioning Strength Slider:**
   - *Empirical Uncertainty:* MiniMax-H3 does not provide a native floating-point weight input per reference image.
   - *Downstream Fence:* Downstream implementations must NOT attempt to pass `SceneReferenceBinding.weight` as a native diffusion scalar. #328 must map `weight` to prompt-emphasis priority (order of tags and modifier adjectives).

---

### 12. Downstream Consumer Traceability & Forward-Looking Commitments

To ensure clean handoffs without conflating future capability enablement with present-tense PR acceptance:
- **Traceability to #327 (Domain & Persistence):**
  - Enables `ShotPlan` entity, `shot_plans` PostgreSQL migration, repository interfaces, and scene aggregate methods (`selectShotPlan`, `approveShotPlan`, `rerollShotPlan`).
  - *Present PR Boundary:* Defines canonical schemas, invalidation rules, and persistence specifications in documentation and contract types. Present PR does not run database migrations or implement domain services.
- **Traceability to #328 (Production Routing & Worker Execution):**
  - Enables `reference_directed` ComfyUI workflow template, worker reference staging adapter, and generation manifest assembly.
  - *Present PR Boundary:* Defines routing decision tables, multiplicity limits, and manifest provenance schemas. Present PR does not dispatch live GPU renders.

---

### 13. Concrete Reference Examples

#### 13.1 Complete Canonical ShotPlan Document (JSON)
```json
{
  "id": "01923456-789a-7b3c-9d4e-5f60718293a1",
  "sceneId": "01923456-789a-7b3c-9d4e-5f6071829300",
  "specRevision": 3,
  "variantOrdinal": 1,
  "status": "approved",
  "routingMode": "reference_directed",
  "targetDurationMs": 5167,
  "targetFrameCount": 124,
  "durationToleranceMs": 355,
  "fps": 24,
  "framing": "medium_close_up",
  "angle": "eye_level",
  "lensIntent": "50mm anamorphic prime lens, creamy bokeh, shallow depth of field",
  "cameraPosition": "eye level, tripod-mounted fluid head",
  "cameraMovement": "dolly_in",
  "movementSpeed": "slow",
  "cameraPromptDescription": "Cinematic 50mm anamorphic shot, slow smooth dolly in towards subject, natural morning sunlight streaming from window",
  "subjects": [
    {
      "subjectId": "elena_hero",
      "referenceAssetId": "01923456-789a-7b3c-9d4e-5f6071829311",
      "role": "subject_identity",
      "initialPosition": "screen_center",
      "movementTrajectory": "Static seated posture, slowly turning head towards camera",
      "interactionSummary": "Holding coffee mug with both hands, taking a gentle sip"
    },
    {
      "subjectId": "coffee_mug_product",
      "referenceAssetId": "01923456-789a-7b3c-9d4e-5f6071829322",
      "role": "product",
      "initialPosition": "foreground_center",
      "movementTrajectory": "Lifted smoothly from rustic oak table to lips",
      "interactionSummary": "Matte ceramic coffee mug featuring embossed brand logo"
    }
  ],
  "actionSummary": "Elena sits in a sunlit kitchen, lifts the ceramic coffee mug to her lips, and looks out the window with a serene smile.",
  "beats": [
    {
      "beatIndex": 1,
      "startMs": 0,
      "endMs": 1800,
      "description": "Elena rests hands around warm ceramic mug on wooden breakfast table.",
      "cameraAction": "Camera starts at medium distance, initiates slow forward dolly push.",
      "subjectAction": "Elena looks down thoughtfully at mug, steam rising."
    },
    {
      "beatIndex": 2,
      "startMs": 1800,
      "endMs": 3800,
      "description": "Elena lifts mug to lips and takes a sip as camera closes in.",
      "cameraAction": "Camera dollies in to medium close-up, rack focusing onto brand logo on mug.",
      "subjectAction": "Lifts mug smoothly with both hands, eyes closing softly in appreciation."
    },
    {
      "beatIndex": 3,
      "startMs": 3800,
      "endMs": 5167,
      "description": "Elena lowers mug slightly and smiles towards the sunlit window.",
      "cameraAction": "Camera settles on Elena's serene profile as morning light illuminates her face.",
      "subjectAction": "Gentle confident smile, gaze fixed towards horizon outside."
    }
  ],
  "lightingStyle": "natural_golden_hour",
  "environmentDescription": "Warm minimalist Scandinavian kitchen, pale oak table, floor-to-ceiling window overlooking morning garden mist.",
  "colorPalette": ["warm amber", "matte cream", "pale oak", "soft mist blue"],
  "atmosphere": "Steam gently rising from coffee, subtle dust motes floating in sunbeam",
  "dialogue": {
    "speaker": "Elena",
    "line": "Morning begins when you choose to pause.",
    "audioFxPrompt": "Gentle ceramic cup clink on wood, soft ambient birdsong outside",
    "voiceoverCue": "Cue at T+0.5s",
    "deliveryEmotion": "Intimate, warm, grounded, whisper-soft"
  },
  "continuity": {
    "incomingContinuityFromSceneId": null,
    "persistentSubjectIds": ["elena_hero"],
    "lightingContinuityNote": "Establish master golden hour key light for campaign opening",
    "frameAnchorTarget": "none",
    "anchorCandidateId": null,
    "anchorMediaHashSha256": null
  },
  "previs": {
    "candidateId": "01923456-789a-7b3c-9d4e-5f6071829399",
    "storageBucket": "cco-previs",
    "storageObjectKey": "previs/campaign-1/scene-1-cand-1.png",
    "contentHashSha256": "8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b",
    "modelProfile": "FLUX_SCHNELL_DRAFT_V1",
    "generatedAt": "2026-09-25T10:15:30.000Z",
    "reviewNotes": "Composition approved by Director. Previs confirmed for camera push-in and mug placement."
  },
  "machineModel": "anthropic/claude-3-5-sonnet",
  "createdAt": "2026-09-25T10:20:00.000Z",
  "updatedAt": "2026-09-25T10:45:00.000Z"
}
```

#### 13.2 `reference_directed` Production Scenario
- **Input State:** Approved ShotPlan (above), 2 bound ReferenceAssets:
  - `<Picture 1>` (`subject_identity`, SHA-256 `4b5c...`): Actor headshot of Elena.
  - `<Picture 2>` (`product`, SHA-256 `7e8f...`): Ceramic mug packshot.
- **Synthesized Prompt Sent to Node (`MiniMaxH3ReferenceToVideo`):**
  `"Cinematic 50mm anamorphic medium close-up, slow dolly in. Elena in <Picture 1> sits in a sunlit kitchen, lifts the ceramic coffee mug in <Picture 2> to her lips, and looks towards the sunlit window. Natural golden hour lighting, 24fps, photorealistic 8k, warm morning atmosphere."`
- **Executed Conditioning in `GenerationManifest`:**
  ```json
  "executionConditioning": {
    "routingMode": "reference_directed",
    "renderProfile": "MINIMAX_H3_720P_5S_REF2V_V1",
    "refImageSize": "max",
    "referenceImages": [
      {
        "index": 1,
        "referenceAssetId": "01923456-789a-7b3c-9d4e-5f6071829311",
        "role": "subject_identity",
        "contentHashSha256": "4b5c6d...",
        "promptTag": "<Picture 1>",
        "stagedAs": "conditioning/cco-scene1-job1-pic1.png"
      },
      {
        "index": 2,
        "referenceAssetId": "01923456-789a-7b3c-9d4e-5f6071829322",
        "role": "product",
        "contentHashSha256": "7e8f9a...",
        "promptTag": "<Picture 2>",
        "stagedAs": "conditioning/cco-scene1-job1-pic2.png"
      }
    ]
  },
  "previsReviewEvidence": {
    "candidateId": "01923456-789a-7b3c-9d4e-5f6071829399",
    "contentHashSha256": "8a7b6c...",
    "storageBucket": "cco-previs",
    "storageObjectKey": "previs/campaign-1/scene-1-cand-1.png",
    "modelProfile": "FLUX_SCHNELL_DRAFT_V1"
  }
  ```

#### 13.3 `frame_anchored` Production Scenario
- **Input State:** Scene 2 requires an exact match cut from Scene 1's final frame.
- **ShotPlan Declaration:**
  - `routingMode`: `"frame_anchored"`
  - `continuity.frameAnchorTarget`: `"first_frame"`
  - `continuity.anchorCandidateId`: `"01923456-789a-7b3c-9d4e-5f6071829399"`
  - `continuity.anchorMediaHashSha256`: `"8a7b6c5d4e..."`
- **Execution:**
  Worker stages anchor image to ComfyUI input directory as `conditioning/cco-scene2-job1-firstframe.png` and wires it to Node 104 (`MiniMaxH3ImageToVideo`, input `first_frame`).
- **Executed Conditioning in `GenerationManifest`:**
  ```json
  "executionConditioning": {
    "routingMode": "frame_anchored",
    "renderProfile": "MINIMAX_H3_720P_5S_I2V_V1",
    "firstFrame": {
      "candidateId": "01923456-789a-7b3c-9d4e-5f6071829399",
      "contentHashSha256": "8a7b6c5d4e...",
      "stagedAs": "conditioning/cco-scene2-job1-firstframe.png",
      "injectionTarget": { "nodeId": "104", "inputName": "first_frame" }
    }
  }
  ```

#### 13.4 Invalid / Ambiguous Scenario Showing Fail-Closed Handling
- **Scenario:** Scene declares `routingMode: "reference_directed"`, but client binds 11 reference assets (4 characters, 3 products, 2 locations, 2 styles).
- **Validation Failure:**
  The production admission guard evaluates `validateProductionRoutingAdmission`:
  $$\sum \text{references} = 11 > 9$$
- **System Action:**
  - Job dispatch is rejected before acquiring GPU lease or touching ComfyUI.
  - Throws typed domain exception: `ExceededMaxReferenceLimitError("Scene '0192...' binds 11 reference assets, exceeding the maximum hardware limit of 9 for MiniMax-H3 reference_directed routing.")`.
  - Scene remains in `approved` state, audit event recorded, zero failed GPU jobs or corrupted manifests written.

---

## Consequences

- Directors review non-authoritative previs media for framing and blocking approval without baking rigid 2D still pixels into downstream video diffusion.
- MiniMax-H3 production rendering natively leverages `MiniMaxH3ReferenceToVideo` with up to 9 reference images and `<Picture i>` tags, dramatically improving character, product, and style fidelity.
- Hard cut-to-cut continuity is preserved via the explicit, opt-in `frame_anchored` routing mode using `MiniMaxH3ImageToVideo`.
- Clear mathematical bounds and fail-closed validation prevent out-of-bounds references (>9) or unrepresentable duration/frame combinations from reaching the GPU worker.
- Complete auditability and provenance are maintained with strict separation between review evidence (`previsReviewEvidence`) and executed diffusion conditioning (`executionConditioning`).
- Downstream implementation tasks (#327 for domain/persistence, #328 for production routing/worker execution) have an authoritative specification without needing to invent domain policies.

## Downstream Gate

Issues #327 and #328 are **not ready to start merely because #326 exists**. They become ready only after this ADR PR is reviewed and merged with the required implementation contract above.
