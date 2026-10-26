# Variable-Duration MiniMax-H3 CI Simulation & Regression Coverage (#427)

## Overview

Issue #427 provides comprehensive regression and simulated end-to-end coverage for variable-duration MiniMax-H3 production workflows, verifying that the newly supported duration pathway is coherent from campaign brief through duration planning, ShotPlan approval, acceptance run dispatch, worker-driven assembly execution, and accepted reel readback.

- **Parent**: #421
- **Prerequisites**: #424, #425, #426 merged (base commit `a4622d9`).
- **Release Gate**: Final production release remains #428.

> [!IMPORTANT]
> **CI Simulation vs. Physical Quality Certification Boundary**
> Autonomous CI runs simulate and mechanically verify the full software control plane, schema migrations, and worker lifecycle. CI simulation is **not** equivalent to GPU quality certification on physical hardware. Physical quality evaluations, RTX 4090 host telemetry, and visual sign-offs are strictly operator responsibilities and belong exclusively to physical hardware campaigns (see `docs/h3-acceptance-operator-runbook.md`). Per repository rules (`AGENTS.md`), no genuine certification evidence, baseline records, or profiles may be authored under `certification/`, `baseline/`, or `config/render-profiles/`.

---

## 1. Prerequisites and Local Environment Setup

To execute the test suites and verify deterministic behavior across local environments and CI:

### Tooling & Runtimes
1. **Node.js & pnpm**: Node.js >= 20.x, pnpm >= 9.x.
2. **Docker Engine**: Required for Testcontainers-managed integration tests (`pnpm test:db`).
3. **PostgreSQL 18**: Managed automatically via Testcontainers in integration tests or local container.
4. **MinIO / S3**: Managed via Testcontainers or local S3-compatible service for object storage.

### Static Build & Model Setup Scripts (per `AGENTS.md`)
- **FFmpeg 7.0.2-static**:
  - Run `./scripts/install-ffmpeg.sh` to install the pinned static build.
  - Run `./scripts/check-ffmpeg-version.sh` to verify static build matches `.ffmpeg-version`.
- **Kokoro-82M ONNX**:
  - Run `./scripts/install-kokoro-model.sh` and `./scripts/check-kokoro-version.sh` to verify weights in `.kokoro-version`.
- **WhisperX venv & model**:
  - Run `./scripts/install-whisperx.sh` and `./scripts/check-whisperx-version.sh` to verify Python interpreter in `.whisperx-version`.
- **Piper TTS voice models**:
  - Run `./scripts/install-piper-voice.sh` and `./scripts/check-piper-version.sh` to verify ONNX weights in `.piper-version`.
- **ComfyUI Core & MiniMax-H3 nodes**:
  - Run `./scripts/check-comfyui-version.sh` to verify pinned commit `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`.

### Two Test Suites & Vitest Configurations
| Suite | Command | Config | Covers |
|---|---|---|---|
| **Unit & Simulation** | `pnpm test` | `vitest.config.ts` | `packages/*/src/**/*.test.ts`, `apps/*/src/**/*.test.ts` |
| **Integration** | `pnpm test:db` | `vitest.integration.config.ts` | `packages/infrastructure/src/postgres/**/*.integration.test.ts`, `tests/**/*.integration.test.ts` |

---

## 2. Authoritative Source Matrix & Test Fixtures

The simulation fixtures derive strictly from the operator-accepted candidate matrix established in #445 / #425 (`h3-capability-matrix-ref2va-turbo-4-2026-10-24`):

| Candidate | Frames / FPS | Exact Nominal Duration | Specification Digest | Speed / Quality Verdict | Notes |
|---|---|---|---|---|---|
| **243f Ref2V** | 243 / 24 | 10,125ms | `da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7` | `pass` / `pass` | `CONDITIONAL GO` (rough-draft / preview-only). Content-dependent dimming, limb corruption, blackout defects. |
| **362f Ref2V** | 362 / 24 | 15,083.33ms (15,083ms) | `3d9a04081e1aee13dc08df76720ff5576b1c5bc04c047b2752e8af56d1637ddd` | `pass` / `pass` | `CONDITIONAL GO` (rough-draft / preview-only). Exceeds 15,000ms `MAX_SCENE_DURATION_MS` ceiling. |
| **Historical 362f** | 362 / 24 | 15,083.33ms | `bdd927c3788fcd8fe24a8ec6bc1e3b4d08a6bb199e88fac879e9c3508791f7ee` | `pass` / `fail` (`NO_GO`) | `REJECTED`: #423 unoptimized I2V 362f variant. Severe limb distortion and backdrop blackout between ~3.3s and 6.7s. `overallVerdict: fail`, `releaseEligible: false`. |

### Fixture Helpers (`tests/fixtures/h3-variable-duration/source-matrix.ts`)
- `SOURCE_SPEC_243F`, `SOURCE_SPEC_362F`: Exact canonical execution specifications with pinned model hashes (checkpoint, clip, audio Vae, video Vae, turbo LoRA) and ComfyUI native attention settings.
- `HISTORICAL_NO_GO_SPEC_362F`: Historical rejected 20-step I2V configuration with its own distinct recipe and specification digest (`bdd927c3...`).
- `createDerivedSimulation243fFixture()`: Builds test-scoped candidate profile, raw workflow JSON, workflow hash, specification digest, and provenance report.
- `generateTestOperatorKeyPair()`: Generates test-local Ed25519 key pair for cryptographic signing in test suites.
- `createSignedTestCandidateGrant()`: Generates cryptographically signed authorization grants for candidate profiles.
- `createSignedTestCapabilityEnvelope()`: Generates cryptographically signed capability matrix envelopes.

---

## 3. Executable Requirement-to-Test Matrix ([AC-1] through [AC-16])

Every acceptance criterion is mechanically validated across unit and integration test suites:

| Criterion | Requirement Description | Test File | Test Suite / Assertion |
|---|---|---|---|
| **[AC-1]** | Campaign brief to accepted delivery reel positive lifecycle | `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` & `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `executes full variable-duration (243f) acceptance lifecycle...` |
| **[AC-2]** | Candidate 243f Ref2V positive path matching operator #445 | `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` & `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `runs campaign create -> 243f beat allocation -> ShotPlan approval...` |
| **[AC-3]** | Off-grid frames fail closed before GPU side effects | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `rejects off-grid frames (e.g. 244 frames) before GPU side effects` |
| **[AC-4]** | 362f scene ceiling rejection (>15,000ms `MAX_SCENE_DURATION_MS`) | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `rejects 362f configuration due to scene ceiling` |
| **[AC-5]** | Recorded NO_GO visual decision rejection (never release-eligible) | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `rejects candidate row with recorded NO_GO visual decision` |
| **[AC-6]** | Unapproved profile key or forged specificationDigest rejection | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `rejects unapproved profile or forged candidate specificationDigest` |
| **[AC-7]** | Route distinction: certified I2V never licenses Ref2V | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `rejects route cross-licensing (certified I2V never licenses Ref2V automatically)` |
| **[AC-8]** | Action replay parameter conflict rejection (HTTP 409) | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `rejects action replay when parameters conflict (HTTP 409 idempotency conflict)` |
| **[AC-9]** | Stem checksum mismatch vs. generation manifest fails closed | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` & `packages/application/src/use-cases/assemble-delivery-reel.test.ts` | `rejects assembly when video stem checksum mismatches generation manifest output checksums` |
| **[AC-10]** | Certified 5-second production workflows retain behavior | `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` & `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `preserves five-second production workflows for certified MINIMAX_H3_720P_5S_I2V_V1 and REF2V_V1` |
| **[AC-11]** | Mixed-route 5-second production workflows support | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `preserves mixed-route 5-second production workflows for certified MINIMAX_H3_720P_5S_I2V_V1 and REF2V_V1` |
| **[AC-12]** | Historical ShotPlan and GenerationManifest document validation | `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` & `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `preserves historical 5-second ShotPlan and GenerationManifest repository round trips` |
| **[AC-13]** | Invariant 5: Requested vs exact nominal duration never conflated | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` & `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` | Lines checking `requestedTotalDurationMs: 20000` vs `totalNominalDurationMs: 20250` |
| **[AC-14]** | Public UI does not advertise staging-only candidate lengths | `apps/render-worker/src/h3-variable-duration-lifecycle.test.ts` | `public UI / production release reader does not advertise staging-only candidate lengths before #428 release gate` |
| **[AC-15]** | Worker-driven assembly execution & manifest persistence | `apps/render-worker/src/acceptance-delivery-assembly-worker.test.ts` & `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` | `claims queued job, executes assembly, and writes manifest record` |
| **[AC-16]** | Accepted reel readback with presigned URL and stem lineage | `packages/application/src/use-cases/resolve-operator-acceptance-reel.test.ts` & `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` | `returns completed reel read model with presigned URL and full stem lineage` |

---

## 4. Issue Lineage, Ledger Reconciliation & Exclusions

### Complete Issue Ledger Mapping
- **#421**: Parent issue establishing variable-duration MiniMax-H3 production capability.
- **#422**: Frame grid analysis and feasibility spike establishing valid duration steps ($5 + 17k$ frames: 48f, 65f, ..., 243f, 362f).
- **#423**: Initial unoptimized 20-step I2V 362f run which produced severe limb distortion and backdrop blackout, resulting in recorded `NO_GO` visual decision (`HISTORICAL_NO_GO_ROW_362F` with digest `bdd927c3...`).
- **#441–#444**: Optimizer investigations evaluating 4-step turbo LoRA vs 20-step schedules, and comparing attention backends (`comfy_native` vs custom-node attention variants).
- **#445**: Operator exploration closure gate accepting the authoritative candidate matrix (`h3-capability-matrix-ref2va-turbo-4-2026-10-24`).
- **#424**: Capability matrix schemas and validation rules.
- **#425**: Capability matrix registry admission and candidate profile derivation.
- **#426**: Duration planning allocation, replan contracts, and candidate staging orchestration.
- **#427**: Autonomous CI simulation, regression suites, and connected lifecycle coverage (current issue).
- **#467, #468**: TeaCache (#467) and FastH3-Omni (#468) remain separate experimental optimization tracks; neither is implied eligible by this Ref2V candidate recipe nor confers production eligibility.
- **#428**: Reserved final release gate requiring operator physical hardware certification on the RTX 4090 host.

### Scoped Exclusions & Invariants
1. **Attention Backend Exclusions**:
   - Only `comfy_native` attention with sparsity disabled is admitted. Custom-node attention implementations (`sageattention`, etc.) and non-zero sparsity thresholds are strictly excluded due to VRAM leak and step non-determinism.
2. **Route Distinction**:
   - Certified I2V route never cross-licenses Ref2V route. Each route requires explicit license registry admission and matching specification.
3. **Storage Namespace Isolation**:
   - Candidate video stems and assembled reels belong strictly to `BUCKETS.CANDIDATES` (`godzspeed-candidates`) under `acceptance-runs/<runId>/`. Candidate stems are strictly rejected if targeting `BUCKETS.DELIVERY`.
4. **Scope & Realm Compatibility**:
   - Production scope cannot execute within `isolated_test` realm. Staging candidates cannot execute in production scope.

---

## 5. Production Release Ownership Gate (#428)

Before variable-duration MiniMax-H3 profiles can be released to general production:

1. **Hardware Validation on Render Host**:
   - The human operator must run the physical acceptance campaign on the RTX 4090 host (`docs/h3-acceptance-operator-runbook.md`).
   - Collect physical host telemetry, VRAM peak utilization, step schedules, and visual artifact evaluations.
2. **Quality Sign-off**:
   - Visual inspection must confirm absence of blackout defects, limb corruption, and severe temporal flickering on candidate frame lengths.
3. **Signed Release Promotion (#428)**:
   - Only after operator sign-off may production release records and signed capability manifests be promoted to production configuration (`config/production-releases.json`).
   - Staging candidate keys (`H3_CANDIDATE_*`) must remain staging-only until release promotion.
