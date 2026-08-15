# Implementation Log - Task 7: Add source-gated Gold Master workflows and provenance records

## Status: DONE

### Summary of Changes
1. **FLUX [schnell] Gold Master API Workflow (`templates/flux_schnell_draft_api.json`)**:
   - Created the API-format ComfyUI workflow map targeting the 4-step FLUX.1 [schnell] draft path.
   - Pinned canonical SHA-256 hash: `00abd5b566eaa1e2cdf5e9be4e57b707d24ed10c6d668e438e075891f478f6dc`.

2. **LTX-2.5 Gold Master API Workflow (`templates/ltx_25_720p_97f_api.json`)**:
   - Created the API-format ComfyUI workflow map targeting 1280x720 resolution, 97 frames (~5s at 24 fps), and 8 DiT sampling steps.
   - Pinned canonical SHA-256 hash: `e6ee75a1df0ac80e4c420eadd820028a9a389f5e680c3de6d89c37159d9f582a`.

3. **Certification Manifest (`templates/provenance.json`)**:
   - Defined version 1 manifest with profiles `flux-schnell-draft` and `ltx-25-720p-97f`.
   - Recorded source URIs, revisions, licenses, exact model file specs, runner profiles, disk requirements, and node assertions.
   - Pinned `minFreeDiskGb: 100`, `runnerProfile: "dynamicvram-offload-v1"`, and `renderProfileIdentity: { "key": "LTX_25_720P_5S_V1", "version": 1 }` for LTX-2.5.
   - Recorded `renderProfileIdentity: null` and sampler 4-step assertion for FLUX.

4. **Provenance Documentation (`templates/README.md`)**:
   - Documented export procedures, source repositories, and licensing (Apache-2.0 and LTX-2 Community License).
   - Documented canonical JSON serialization and why raw formatting/whitespace differences do not alter the hash.
   - Documented relative ComfyUI model paths and empirical performance baseline context.
   - Documented how to run certification commands with CLI stdout/stderr redirection.

5. **Workflow Assets Test Suite (`packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`)**:
   - Implemented TDD test suite covering all 6 behavioral invariants:
     - `Gold Master workflows are API-format object maps with pinned canonical hashes`
     - `FLUX Gold Master pins the validated four-step sampler node`
     - `LTX Gold Master pins 720p 97-frame eight-step baseline nodes`
     - `Gold Master profiles identify every referenced certification model file`
     - `Gold Master provenance contains immutable source and license evidence`
     - `LTX Gold Master enforces the 100 GB DynamicVRAM profile`

### Verification Results
- `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`: PASS (6/6 tests passed)
- `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`: PASS (0 lint errors)
- `pnpm exec prettier --check templates/flux_schnell_draft_api.json templates/ltx_25_720p_97f_api.json templates/provenance.json packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`: PASS
- `pnpm typecheck`: PASS (0 type errors)
- `pnpm test`: PASS (145/145 tests passed across 25 test files)
