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
- **ComponentLicenseRegistry:** Machine-readable, versioned catalog of all third-party models, nodes, and assembly tools (`approved`, `restricted`, `review_required`, `blocked`).
- **LicenseRoutingGuard:** Fail-closed application-level enforcement guard that evaluates required components before dispatching render jobs or media assemblies, ensuring restricted, blocked, review-required, or unregistered components are non-dispatchable with zero GPU / FFmpeg execution.
- **LicenseRoutingDecision:** Auditable provenance record (`decisionId`, `registryRevision`, `evaluations`, `violations`, `timestamp`) embedded into generated artifacts (e.g. `AssemblyManifest.governanceDecisionId`).
- **AssemblySpec:** Structured technical and creative specification for audiovisual assembly, declaring campaign identity, assembly profile (`VERTICAL_REEL_1080X1920_V1`), ordered video stems (`VideoStemRef[]`), optional voiceover (`VoiceoverAssetRef`), optional soundbed (`SoundbedAssetRef`), and subtitle cues (`SubtitleCue[]`).
- **AssemblyManifest:** Immutable provenance record and audit evidence produced for an assembled commercial delivery reel (`assemblyId`, `createdAt`, `campaignId`, `assemblyProfile`, `generationManifestIds`, `inputs`, `timeline`, `subtitleCuesSha256`, `layout`, `ffmpeg`, `commandFingerprint`, `encoding`, `streams`, `output`, `governanceDecisionId`). Persisted beside the delivered media object, it constitutes the final-delivery provenance boundary.

## Review Plane Actions & Behavioral Invariants

- **`candidate_select`:** Action choosing an immutable candidate belonging to the current `sceneSpecRevision`. Attempting to select a historical candidate from a prior revision is rejected.
- **`reject` vs. `reroll`:**
  - `reject`: Strictly QA rejection of rendered production video (`qa -> director_review`), clearing prior approval while retaining the approved candidate selection.
  - `reroll`: Storyboard candidate regeneration in review (`director_review -> generating_candidates`), invalidating current candidate selection and clearing approval.
- **`expectedSpecRevision` Conflict Semantics:** Optimistic concurrency control. If the client's `expectedSpecRevision` does not match the scene's current revision, a `STALE_REVISION_CONFLICT` (409) is returned with zero database writes.
- **Action ID & Idempotency:** Client assigns a unique UUIDv7 `actionId` to each command. An identical command replayed with the same `actionId` returns 200 with `isIdempotentReplay: true` and writes zero duplicate events. Reusing an `actionId` with altered payload returns `IDEMPOTENCY_CONFLICT` (409) with zero writes.
- **Server-Authoritative Reviewer Identity & Timestamp:** Reviewer name and action timestamp are determined server-side from authenticated session context and the server clock. Client-provided reviewer identity or timestamps cannot override server audit metadata.
- **Review API Never Synchronously Renders:** Review HTTP routes only commit state transitions, candidate selections, and audit records. Rendering compute is deferred to asynchronous worker queue processing (Sprint 3).
- **Fail-Closed Governance Routing Guard:** All generation dispatch and assembly pipelines must evaluate required component licenses against the versioned registry before any compute or external service invocation. Non-approved or missing entries halt execution immediately without acquiring GPU leases or spawning media processes.

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

## Sprint 3.5 Status & Sprint 4 Handoff

- **Sprint 3.5 Exit Condition Status: COMPLETE (LTX & FFmpeg Governance Cleared)**
  The local media assembly implementation (`FfmpegMediaAssemblerAdapter`, `AssembleDeliveryReel`, audio mixing/ducking, ASS subtitle burning, and immutable `AssemblyManifest` generation) is complete and verified via real-FFmpeg integration tests:
  1. **Production Governance Gate Status:** In the authoritative repository `config/component-license-registry.json` (registry revision `2026-08-29.4`, reviewed `2026-09-02`), `LTX_25_720P_5S_V1` and host `ffmpeg` (`7.0.2-static`) have achieved formal operator approval for Phase 1 commercial use (`reviewedAt: 2026-09-02T00:00:00.000Z`). Voiceover provider `azure-tts` is approved for Phase 1 commercial voiceover generation (`reviewedAt: 2026-09-03T00:00:00.000Z`).
  2. **PRD §9.5 Performance Benchmark:** Deterministic standalone benchmark command `pnpm bench:assembly` is verified and runnable (<30s threshold, measuring ~20s in the development environment). Per AGENTS.md rules ("Evidence paths are never agent-authored"), certification paths (`certification/`, `baseline/`, `config/render-profiles/`) hold measurements of physical hardware and must NEVER be agent-authored. Physical workstation certification remains an operator action via `pnpm bench:assembly`.
- **LTX Remains Strictly Video-Only:** `LTX_25_720P_5S_V1` produces silent 1280x720 landscape video only. Voice synthesis, provider TTS, soundbed generation/curation, and delivery packaging are completely separate pipeline stages with distinct provenance.
- **Audio Staging & Provenance Boundary:** Sprint 3.5 consumes pre-resolved audio assets (`voiceover`, `soundbed`) from persistent object storage. Voice synthesis / provider invocation (e.g. Azure, ElevenLabs) occurs upstream of assembly and is never orchestrated by the FFmpeg assembler.
- **AssemblyManifest as Final-Delivery Provenance Boundary:** The delivered commercial media object (`output.mp4`) is paired with an immutable `AssemblyManifest` persisted beside it in delivery storage. From only the persisted manifest locator and referenced immutable generation manifests and media assets in object storage, all executed inputs, layout parameters, audio timing, burned subtitles, runtime command fingerprints, and governance decisions are semantically reconstructable.
- **Phase 1 Vertical Delivery Profile:**
  - Key: `VERTICAL_REEL_1080X1920_V1`, version: 1
  - Layout: `fit_blurred_fill` (1280x720 landscape stems scaled to 1080x608 foreground, centered over a 1080x1920 background with `gblur=sigma=20` [matching `FIT_BLURRED_FILL_BLUR_SIGMA = 20`])
  - Video stream: H.264 (`yuv420p`), CFR normalized to 30.0 fps, 1080x1920
  - Audio stream: AAC, stereo (2 channels), 48,000 Hz, 192 kbps
  - Voiceover normalization: EBU R128 loudness targeting via `loudnorm` (-16.0 LUFS integrated, -1.5 dBTP true-peak target) with the final audio mix path constrained to a -1.0 dBTP ceiling via `alimiter` (4x oversampled at 192 kHz)
  - Soundbed ducking: -18.0 dB baseline gain, ducked by -12.0 dB (to -30.0 dB) during voiceover windows, looped via `aloop` and trimmed to total duration via `atrim` (no crossfade)
  - Subtitles: ASS format with `VERTICAL_REEL_CENTER_V1` profile (font size 52, marginV 320, white text with black outline, bottom-centered social safe region)
- **Fail-Closed Governance Invariant:**
  - All assembly operations evaluate `EnforceLicenseRouting` in Step 1 before validation or FFmpeg execution.
  - Component statuses of `restricted`, `review_required`, `blocked`, or unregistered halt immediately with a typed `LicenseRoutingError`, producing zero FFmpeg process spawns, zero delivery media writes, and zero AssemblyManifest writes.
  - Generation-time provenance is validated: each stem's `generationManifestId` is resolved through `GenerationManifestRepository`; missing, unresolvable, or output-checksum-inconsistent manifests fail closed to an `unknown_component` denial (in Step 1) and `AssemblySpecValidationError` (in Step 2).
- **Verification & Benchmark Commands:**
  - Full integration correctness suite: `pnpm test:assembly` (runs `vitest.assembly.config.ts`)
  - Standalone PRD §9.5 performance benchmark: `pnpm bench:assembly` (runs `scripts/bench-assembly.mjs`, which automatically executes `pnpm build` first to compile required packages from clean checkouts)
- **Idempotent Rerun, Atomic Storage & Conflicting Provenance Boundary:**
  - Assembly identity is derived canonically from the immutable request (`computeAssemblyId(spec)`).
  - Storage adapters support atomic conditional create / put-if-absent via `ifNoneMatch: "*"` in `ObjectStoragePort` (mapped to S3's `IfNoneMatch: "*"` and throwing `ObjectAlreadyExistsError` on 412/conflict).
  - Create-or-verify semantics: Replaying an identical assembly request converges on the existing identity and returns the existing persisted `AssemblyManifest` without duplicate storage writes or conflicting provenance. Replaying the same assembly identity with altered spec or environment parameters (different stems, order, audio timing/looping, cues, FFmpeg runtime build, or governance decision) raises a typed `AssemblyProvenanceConflictError` without deleting or overwriting the existing delivery media or manifest.
- **Sprint 4 Boundary & Production Render Dispatch (Issue #196):**
  - Production render dispatch mechanism (`EnqueueSceneProductionRenderUseCase`) triggers durable LTX-2.5 render execution for approved scenes (`status: approved` or recoverable `failed`).
  - Automatic campaign-wide dispatch gating is intentionally deferred to Issue #197.
  - Duration Quantization: `mapDurationMsToLtxFrameCount` enforces nearest `8n+1` frame count within the validated frame range `[97, 97]` (~4042ms at 24fps) with a 167ms tolerance window, failing closed outside the certified envelope. Deterministic tie-breaking rounds down.
  - Seed Derivation: SHA-256 of `${sceneId}:${specRevision}` produces a 48-bit unsigned big-endian deterministic seed.
  - Unit of Work Context Separation: `EnqueueSceneProductionRenderUseCase` exposes `executeWithContext(context, input)` so multi-scene callers (e.g. #197 campaign-level dispatch) execute within a single parent transaction without nesting `uow.execute()`.
  - Topology & Worker Mutation: Production jobs inject `frameCount` into the certified topology's target (`LTX_25_720P_5S_V1_INJECTION_TOPOLOGY.frameCount` -> node `"5"`, `length`). Candidate jobs reject `frameCount`.
  - Manifest Provenance: Step 8 of `assembleGenerationManifest` inspects executed workflow nodes for `frameCount` and sets `fps: LTX_FPS` (24) for runtime accuracy.
  - Scene State Transitions: `approved` -> `queued` (enqueue) -> `rendering` (worker start) -> `qa` (worker complete) / `failed` (worker fail). Route handlers trigger idempotent progress handlers (`markProductionRenderingStartedIfQueued`, `submitProductionForQAIfRendering`, `failProductionIfActive`).
- **Candidate-Conditioned Production Invariant & Architecture (Issues #214 / #227):**
  - **Creative-Control Invariant:** "A production render for a reviewed visual scene must be traceably conditioned by the exact candidate approved for that same SceneSpec revision." (See [ADR 0004](adr/0004-candidate-conditioned-production-invariant.md)).
  - **Deterministic Preprocessing & Conditioning Pipeline:**
    - Node 20 (`LoadImage`): Staged candidate image under the ComfyUI input subfolder `conditioning/` with deterministic filename `cco-<scene>-<job>-<hash>` loaded by worker.
    - Node 21 (`ImageScale`): Resizes with Lanczos interpolation to exactly 1280x720 (`crop: "center"`), ensuring deterministic pixel alignment and eliminating spatial distortion across varying candidate aspect ratios.
    - Node 22 (`LTXVImgToVideo`): Injects conditioned image latents into the LTX-2.5 sampling pipeline.
  - **Distinct Profile Identity:** `LTX_25_720P_5S_I2V_V1` represents the certified Image-to-Video production profile, distinct from text-to-video (`LTX_25_720P_5S_V1`). Reviewed visual production unconditionally dispatches `LTX_25_720P_5S_I2V_V1`, retaining `LTX_25_720P_5S_V1` strictly for separate legacy or unreviewed execution paths.
  - **Multi-Layer Fail-Closed Verification:**
    - Unselected, mismatched, or cross-scene candidate references reject dispatch with `CandidateIdentityMismatchError` or `CandidateSceneMismatchError`.
    - Stale candidates or spec revision mismatches reject dispatch with `StaleCandidateRevisionError` or `MissingCandidateSelectionError`.
    - Missing or hash-corrupted candidate media files reject execution with `ApprovedCandidateMediaUnavailableError` or `ApprovedCandidateMediaHashMismatchError`.
    - Missing or unrepresentable conditioned profile configurations reject execution with `MissingCertifiedProfileError`.
    - Reference image staging/injection failures fail closed with `ReferenceImageStagingError`.
    - **Zero Silent Fallback:** A failed I2V conditioning pipeline never falls back silently to unconditioned text-to-video generation.
  - **Single-Source Manifest Provenance:** `GenerationManifest` records `approvedCandidate` (`candidateId`, `sceneId`, `specRevision`, `sha256`) and `executionConditioning` (`profileKey: "LTX_25_720P_5S_I2V_V1"`, `media: { storageBucket, storageObjectKey, sha256 }`, `stagedAs: { subfolder: "conditioning", filename: "cco-<scene>-<job>-<hash>" }`, `injectionTarget: { nodeId: "20", inputName: "image" }`), alongside persisted workflow identity and sha256.
