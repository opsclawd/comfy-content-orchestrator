# Implementation Log - Issue #328: [325.3] Integrate reference-directed MiniMax-H3 workflow and production profile

**Status**: `DONE`  
**Date**: 2026-09-25  
**Parent**: #325  
**Depends on**: #326  

---

## 1. Overview and Objective

Issue #328 integrates a first-class, deterministic reference-directed production profile (`MINIMAX_H3_720P_5S_REF2V_V1`, engine: `minimax_h3_ref2v`) consuming approved `ShotPlan`, `SceneSpec`, and up to 9 immutable reference assets, while preserving the frame-anchored production profile (`MINIMAX_H3_720P_5S_I2V_V1`, engine: `minimax_h3_i2v`) as a distinct, explicit mode with verified anchor frames.

In accordance with ADR 0007:
- `reference_directed` mode uses `ShotPlan` and bound `ReferenceAsset`s as visual authority; previs stills are strictly non-authoritative review evidence (`previsReviewEvidence`) and are excluded from `executionConditioning` (False Conditioning Invariant).
- `frame_anchored` mode remains distinct and explicitly anchored by first/last frames.
- Declarative injection topology covers all inputs with zero heuristic node discovery and fails closed on topology mismatch.
- Variable reference cardinality (0..9) is handled cleanly: unused `LoadImage` loader nodes and collection inputs (`ref_image_1`..`ref_image_9` on node 105) are pruned before submission, eliminating dangling links or empty loader errors.
- Reference roles map honestly according to canonical priority (`subject_identity` < `product` < `location` < `style` < `composition`) and tie-broken by lowercase UUID code-point order. Continuous weights != 1, hints, non-image media, and duplicate pairs fail closed before staging.
- Zero fabricated physical hardware measurements were committed (`certification/`, `baseline/`, and `config/render-profiles/` remained strictly untouched). The Ref2V profile declares operational parameters while hardware measurement fields remain omitted/uncertified until physical operator benchmark runs on RTX 4090.

---

## 2. Changes Summary by Component

### A. Templates & Component Governance
1. `templates/minimax_h3_720p_ref2v_124f_api.json`:
   - Authored from ComfyUI specification for `MiniMaxH3ReferenceToVideo` (node 105).
   - Declares 9 ordered `LoadImage` loader nodes (nodes 201..209) feeding dynamic reference collection inputs `ref_image_1`..`ref_image_9` on node 105.
   - Pinned canonical SHA-256 workflow hash: `cc5876b4ca9fd45e8ae50fade56db711107818a17a5eb48d7edf3e875dc2b7c7`.
2. `templates/provenance.json`:
   - Added `minimax-h3-720p-124f-ref2v` certification profile definition with 4 model pins (`diffusion_models`, `clip`, `video_vae`, `audio_vae`), `minFreeDiskGb: 50`, `dynamicvram-offload-v1`, and workflow assertions for node 9 (steps = 20) and node 105 (width = 1344, height = 768, length = 124).
3. `templates/README.md`:
   - Documented `minimax-h3-720p-124f-ref2v` workflow, models, canonical hash, and runner profile.
4. `config/component-license-registry.json`:
   - Registered `MINIMAX_H3_720P_5S_REF2V_V1` with license identifier `MiniMax-Community-License`, evidence basis `contract_attested`, and allowed routing.

### B. Contracts (`@cco/contracts`)
1. `packages/contracts/src/render-profile.ts`:
   - Added `"MINIMAX_H3_720P_5S_REF2V_V1"` to `RenderProfileKeySchema` and `RenderProfileSchema`.
   - Defined `MINIMAX_H3_720P_5S_REF2V_V1_PROFILE` with declared fields (`frames: 124`, `steps: 20`, `runnerProfile: "dynamicvram-offload-v1"`), leaving measured hardware fields (`measuredPeakVramMb`, `measuredTotalDurationMs`, etc.) uncertified/undefined.
   - Defined `MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY` declaring explicit targets for `prompt` (node 105), `seed` (node 15), `referenceNode` (node 105 `ref_images`), and `referenceImages` (ordered array of nodes 201..209).
   - Added alias resolution for `minimax-h3-720p-124f-ref2v`, `minimax_h3_ref2v`, and `minimax-h3-720p-5s-ref2v-v1`.
   - Exported `isProfileCertified` function returning `false` for unmeasured/uncertified profiles.
2. `packages/contracts/src/ltx-certification.ts`:
   - Added `MinimaxH3Ref2vWorkloadIdentitySchema` (`minimax_h3_ref2v`, 1344x768, 124 frames, 20 steps, 24 FPS) and included it in `CertificationWorkloadIdentitySchema`.
3. `packages/contracts/src/generation-manifest.ts`:
   - Created comprehensive generation manifest contract enforcing conditional invariants:
     - `reference_directed`: requires `shotPlan`, `referenceImages` (0..9 entries with `slotIndex`, `promptTag`, `assetId`, `contentHashSha256`, `role`), `executedInstruction`, and `submittedWorkflowHash`; strictly excludes `executionConditioning` (False Conditioning Invariant). Previs is recorded only in optional `previsReviewEvidence`.
     - `frame_anchored`: requires `firstFrame` and allows optional `lastFrame`.
4. `packages/contracts/src/index.ts`:
   - Re-exported new schemas and types from `generation-manifest.ts` and `render-profile.ts`.

### C. Application Layer (`@cco/application`)
1. `packages/application/src/shot-plan-compiler/canonicalize-reference-bindings.ts`:
   - Pure, deterministic canonicalization over resolved scene reference bindings.
   - Enforces role priority order: `subject_identity` (0) < `product` (1) < `location` (2) < `style` (3) < `composition` (4).
   - Enforces secondary sort by `referenceAssetId` in ascending Unicode code-point order.
   - Filters out archived bindings.
   - Fails closed on: >9 active references (`REFERENCE_LIMIT_EXCEEDED`), duplicate `(role, referenceAssetId)` bindings (`DUPLICATE_REFERENCE_BINDING`), non-default continuous weights != 1 (`UNSUPPORTED_REFERENCE_WEIGHT`), non-null hints (`UNSUPPORTED_REFERENCE_HINTS`), non-image media types (`UNSUPPORTED_REFERENCE_MEDIA`), and missing asset references (`REFERENCE_ASSET_NOT_FOUND`).
   - Assigns deterministic 1-based `slotIndex` (1..9) and prompt tags (`<Picture 1>`..`<Picture 9>`).
2. `packages/application/src/shot-plan-compiler/shot-plan-compiler.ts`:
   - Pure, deterministic compiler transforming approved `ShotPlan` + `SceneSpec` + canonical references into authoritative instruction text.
   - Validates that `shotPlan.status === "approved"` (`SHOT_PLAN_NOT_APPROVED`).
   - Validates routing mode alignment (`ROUTING_MODE_MISMATCH`).
   - Validates `sceneSpec.revision === shotPlan.specRevision` (`SPEC_REVISION_MISMATCH`).
   - Validates temporal beats: unique indices (`DUPLICATE_BEAT_INDEX`) and half-open intervals `[startMs, endMs)` within duration window (`BEAT_RANGE_OUT_OF_BOUNDS`).
   - Emits structured sections in invariant sequence: Scene Context -> Camera & Framing -> Subjects & Blocking -> Action Summary -> Temporal Beats -> Environment & Lighting -> Continuity -> Dialogue & Performance -> Reference Visuals.
   - Normalizes line endings to LF and sanitizes control characters.
   - Enforces bidirectional tag-to-reference bijection: no orphan `<Picture n>` tags in text (`ORPHAN_PICTURE_TAG`) and no unreferenced staged references (`UNREFERENCED_STAGED_REFERENCE`).
   - Returns `{ instructionText, instructionHashSha256, instructionBytes }`.
3. `packages/application/src/use-cases/execute-profile-render.ts`:
   - Supported `minimax_h3_ref2v` engine in `ProfileRenderIdentity`.
4. `packages/application/src/use-cases/assemble-generation-manifest.ts`:
   - Accepted route-specific inputs (`routingMode`, `shotPlan`, `executedInstruction`, `referenceImages`, `firstFrame`, `lastFrame`, `previsReviewEvidence`, `submittedWorkflowHash`).
   - Strictly isolated conditioning image from reference-directed executions.

### D. Infrastructure & Worker (`@cco/infrastructure`, `apps/render-worker`)
1. `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`:
   - Registered `minimax-h3-720p-124f-ref2v` in `KNOWN_PROFILE_MANIFEST`.
2. `apps/render-worker/src/certification/preflight.ts`:
   - Handled `minimax_h3_ref2v` profile baseline and assertion checks (node 9 steps = 20, node 105 width = 1344, height = 768, length = 124).
   - Validated approved provenance report entries for `minimax_h3_ref2v`.
3. `apps/render-worker/src/cli/certify.ts`:
   - Supported `minimax_h3_ref2v` workload identity and timeout configuration (900s).
4. `apps/render-worker/src/render-job-executor.ts`:
   - `validateInjectedPayload`: For `minimax_h3_ref2v` production jobs, accepts and requires `shotPlanId` + `specRevision`, and does not require `approvedCandidateId`.
   - `mutateWorkflow`: Implemented variable cardinality logic for Ref2V. Populates slots 1..N with staged filenames; prunes unused loader nodes N+1..9 and removes inputs `ref_image_${slot}` from node 105. For N=0, prunes all reference nodes and inputs.
   - `createCertifiedRenderJobExecutor`: Staged canonical references into ComfyUI input folder, compiled ShotPlan, cleaned up staged references in `finally`, and passed structured route fields to manifest assembly.

---

## 3. Verification

The following verification gates were run and passed cleanly:

| Command | Status | Notes |
|---|---|---|
| `pnpm typecheck` | Passed | `tsc --build --force` across all packages and apps with zero errors. |
| `pnpm lint` | Passed | ESLint across entire repository with zero warnings/errors. |
| `pnpm boundaries` | Passed | Zero dependency-cruiser architecture violations (652 modules, 1769 dependencies). |
| `pnpm vitest run packages/contracts/src/generation-manifest.test.ts packages/contracts/src/render-profile.test.ts packages/application/src/shot-plan-compiler/canonicalize-reference-bindings.test.ts packages/application/src/shot-plan-compiler/shot-plan-compiler.test.ts apps/render-worker/src/certification/preflight.test.ts apps/render-worker/src/render-job-executor.test.ts` | Passed | 114 passing tests across all 6 targeted test suites. |

---

## 4. Modified & Created Files

- `templates/minimax_h3_720p_ref2v_124f_api.json` (new)
- `templates/provenance.json`
- `templates/README.md`
- `config/component-license-registry.json`
- `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`
- `packages/contracts/src/render-profile.ts`
- `packages/contracts/src/ltx-certification.ts`
- `packages/contracts/src/generation-manifest.ts` (new)
- `packages/contracts/src/index.ts`
- `packages/contracts/src/render-profile.test.ts`
- `packages/contracts/src/generation-manifest.test.ts` (new)
- `packages/application/src/shot-plan-compiler/canonicalize-reference-bindings.ts` (new)
- `packages/application/src/shot-plan-compiler/shot-plan-compiler.ts` (new)
- `packages/application/src/shot-plan-compiler/index.ts` (new)
- `packages/application/src/shot-plan-compiler/canonicalize-reference-bindings.test.ts` (new)
- `packages/application/src/shot-plan-compiler/shot-plan-compiler.test.ts` (new)
- `packages/application/src/use-cases/execute-profile-render.ts`
- `packages/application/src/use-cases/assemble-generation-manifest.ts`
- `packages/application/src/index.ts`
- `apps/render-worker/src/certification/preflight.ts`
- `apps/render-worker/src/certification/preflight.test.ts`
- `apps/render-worker/src/cli/certify.ts`
- `apps/render-worker/src/render-job-executor.ts`
- `apps/render-worker/src/render-job-executor.test.ts`
- `implementation-log.md` (new)
