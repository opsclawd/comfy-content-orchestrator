# 4. Candidate-Conditioned Production Invariant

Date: 2026-09-10

## Status

Accepted

## Context

In the Godzspeed Sovereign Content Orchestration Platform, creative direction occurs through a two-tier compute pipeline:
1. Fast draft generation produces immutable storyboard candidates (e.g. via FLUX.1 [schnell]).
2. The Creative Director reviews candidates within the Next.js Review Hub and approves a specific candidate belonging to a specific SceneSpec revision.
3. Production rendering generates the final high-fidelity video using headless ComfyUI running on dedicated agency hardware (Trinidad RTX 4090).

Prior to this architecture, text-to-video (T2V) production was initiated from noise prompts (`LTX_25_720P_5S_V1`), introducing prompt drift and visual discontinuity between the approved storyboard still and the final rendered video. Furthermore, naive conditioning implementations risk silent degradation: if an approved image is missing, corrupt, misaligned, or if the conditioned profile is unavailable, automated systems frequently fall back to unconditioned text-to-video generation or reuse stale candidates from prior revisions, rendering footage completely disconnected from the director's creative approval.

## Decision

We establish the foundational platform invariant:
> **"A production render for a reviewed visual scene must be traceably conditioned by the exact candidate approved for that same SceneSpec revision."**

To enforce this invariant without ambiguity, compromise, or silent degradation, we implement the following architectural rules:

### 1. Distinct Profile Identity
Image-to-video (I2V) conditioning is not a dynamic toggle or parameter patch on the legacy text-to-video profile. It constitutes a distinct, independently certified `RenderProfile`:
- Profile Key: `LTX_25_720P_5S_I2V_V1`, version: 1
- Workflow Template: `ltx-25-720p-97f-i2v` (`templates/ltx_25_720p_i2v_97f_api.json`)
- Certified Engine Identity: `ltx_25_i2v`
- Declared Injection Topology: `referenceImage` targeting Node 20 (`LoadImage`, input field `image`), alongside text prompts (Node 3 `prompt`, Node 4 `negativePrompt`) and deterministic seed (Node 1 `KSampler`, field `seed`).
- The legacy `LTX_25_720P_5S_V1` profile remains strictly unconditioned text-to-video, retained in the platform only for separate legacy or unreviewed execution paths. Reviewed visual production unconditionally dispatches `LTX_25_720P_5S_I2V_V1` once approval and candidate selection preconditions pass, with zero silent fallback or override toggles to text-only generation.

### 2. Deterministic In-Workflow Candidate Preprocessing
Storyboard candidates generated in Tier 1 may originate from various source dimensions (e.g., 1024x1024 square images from FLUX [schnell] draft generation). Resizing images on host worker machines introduces non-deterministic image filtering across environments.
- Candidate preprocessing is declared directly inside the certified ComfyUI workflow topology via Node 21 `ImageScale`:
  - `upscale_method`: `"lanczos"`
  - `width`: 1280
  - `height`: 720
  - `crop`: `"center"`
- Node 21 feeds Node 22 (`LTXVImgToVideo`, conditioning input `image`).
- This guarantees bit-identical candidate scaling and aspect-ratio alignment directly within the ComfyUI execution graph.

### 3. Multi-Layer Fail-Closed Enforcement
Zero silent fallback is permitted under any circumstances. If conditioning cannot be achieved exactly as approved, rendering is prohibited:
- **Control Plane & Domain Gate (`verifyApprovedVisualProductionInput`):**
  - Scene must have an explicit `selectedCandidateId` and `selectedCandidateRevision` matching `specRevision`.
  - Candidate must belong to the exact `sceneId` and exact `sceneSpecRevision`.
  - Scene `approval` must be present with `approval.revision` matching `specRevision`.
  - If any check fails, domain errors (`MissingCandidateSelectionError`, `CandidateIdentityMismatchError`, `CandidateSceneMismatchError`, `StaleCandidateRevisionError`, `SelectedCandidateRevisionMismatchError`, `ApprovalRevisionMismatchError`) halt execution before dispatch.
- **Worker Storage & Hash Gate (`ResolveApprovedCandidateMediaUseCase`):**
  - The worker retrieves candidate bytes from immutable review object storage and computes SHA-256 integrity checks.
  - Missing media throws `ApprovedCandidateMediaUnavailableError`. Corrupt or hash-mismatched media throws `ApprovedCandidateMediaHashMismatchError`.
- **Worker Staging Gate (`HttpComfyUiInputStagingAdapter`):**
  - Candidate image bytes are uploaded to ComfyUI's input directory under a deterministic subfolder (`conditioning/`).
  - Network timeouts or upload failures raise `ReferenceImageStagingError`. Zero prompts are submitted to ComfyUI if staging fails.
- **Profile Availability Gate:**
  - If the conditioned profile or its workflow template cannot be resolved, `MissingCertifiedProfileError` is thrown. The worker never falls back to unconditioned profiles or legacy templates.
- **Governance Routing Gate (`LicenseRoutingGuard`):**
  - Production render dispatch and worker execution require approved component status in `component-license-registry.json`. Restricted, review-required, or blocked profiles fail closed without acquiring GPU leases.

### 4. Single-Source Manifest Provenance
Auditability is maintained by deriving provenance authoritatively from the executed workflow rather than ephemeral dispatch arguments:
- `GenerationManifest` records `approvedCandidate` (`candidateId`, `sceneId`, `specRevision`, `sha256`) and `executionConditioning` (`profileKey: "LTX_25_720P_5S_I2V_V1"`, `media: { storageBucket, storageObjectKey, sha256 }`, `stagedAs: { subfolder: "conditioning", filename: "cco-<scene>-<job>-<hash>" }`, `injectionTarget: { nodeId: "20", inputName: "image" }`).
- The manifest captures the persisted workflow identity and SHA-256 hash, engine identity (`ltx_25_i2v`), frame count (97), and FPS (24).
- The final delivered media reel links each video stem back to its immutable `GenerationManifest`, ensuring full end-to-end creative provenance.

### 5. Physical Hardware Certification Policy
Per `AGENTS.md`, benchmark and certification evidence (`certification/`, `baseline/`, `config/render-profiles/`) measures physical hardware and must never be fabricated by agents.
- The I2V profile `LTX_25_720P_5S_I2V_V1` and its execution envelope on the Trinidad RTX 4090 workstation require an operator-executed certification run (`pnpm certify:ltx-i2v`).
- All software and automated E2E integration gates (AC-1 through AC-9) are verified via the Testcontainers-backed test harness (`tests/integration/production-render.ltx.integration.test.ts`), while live physical certification (AC-10, AC-11) is structured as a formal blocking operator handoff.

## Consequences

- Directors have mathematical certainty that approved visual frames condition downstream production video.
- Any discrepancy in revisions, hashes, or candidate identity halts the pipeline with an actionable error.
- Eliminates visual hallucinations or unconditioned drift in commercial deliverables.
