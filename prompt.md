You are fixing code review findings identified during the authoritative whole-change review.

## CONTEXT

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Transient working files and scratch scripts MUST be written inside `.ai-tmp/`. `.ai-tmp/` is already gitignored. Nothing may be written to the worktree root unless it is a declared deliverable.

Working directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-328
Issue number: 328

Issue description:
# [325.3] Integrate reference-directed MiniMax-H3 workflow and production profile

## Parent

#325

## Depends on

#326

## Objective

Add a first-class, deterministic MiniMax-H3 reference-directed production workflow/profile that can consume the approved structured shot intent and exact immutable ReferenceAssets defined by #306-#309, while preserving a separately explicit frame-anchored production mode.

## Scope

### H3 capability integration

Integrate the supported MiniMax-H3 reference-directed workflow exposed by the pinned runtime/ComfyUI environment.

Represent production modes explicitly in contracts/profile identity rather than treating one workflow as a generic H3 adapter:

- reference-directed mode;
- frame-anchored first/last-frame mode where already supported or explicitly integrated.

### Declarative injection topology

Add explicit topology targets for every supported production input required by the selected workflow, including as applicable:

- structured prompt/shot instruction;
- image references;
- reference ordering/role mapping;
- video references if supported and intentionally adopted;
- audio references if supported and intentionally adopted;
- seed/generation parameters;
- geometry/duration controls;
- first/last frame only for frame-anchored profiles.

Use exact node IDs, expected class types, and explicit input names. Fail closed on topology mismatch. No runtime node heuristics.

### Reference-role mapping

Map the canonical roles from #306/#326 to actual H3 capabilities.

A role that cannot be represented by the certified workflow must fail explicitly before execution or be rejected at an earlier contract boundary. Never claim a reference was honored if it was silently omitted.

### Prompt/ShotPlan compilation

Define deterministic compilation from approved ShotPlan + SceneSpec to the H3 textual/structured instruction surface.

Record the exact executed instruction, not only the source ShotPlan.

### Environment/governance

Pin/verify exact model/runtime/custom-node artifacts required by the workflow.

Update component/license governance using evidence-backed status. Unknown rights remain `review_required`.

### Provenance contract

Define executed production provenance sufficient to reconstruct:

- H3 profile/workflow/model identity and hashes;
- route/mode;
- exact executed instruction;
- every staged reference identity/hash and mapped role;
- geometry/duration/generation parameters;
- first/last frame identity only when the frame-anchored route actually uses one.

## Certification boundary

This issue makes the reference-directed workflow/profile certification-ready but MUST NOT fabricate real RTX 4090 measurements or frozen empirical certification artifacts. Physical certification belongs to the operator child.

## Non-goals

- ShotPlan UI.
- Storyboard rendering changes.
- Production dispatch orchestration.
- Physical benchmark claims.
- Production-video acceptance workflow changes.
- H3 2K/quantization optimization.

## Acceptance criteria

- [ ] A first-class reference-directed H3 workflow/profile identity exists.
- [ ] Frame-anchored production remains a distinct explicit profile/mode rather than the default.
- [ ] Declarative injection topology covers all supported inputs and fails closed on mismatch.
- [ ] Canonical reference roles map honestly to supported H3 inputs.
- [ ] Unsupported reference semantics cannot be silently discarded.
- [ ] Approved ShotPlan can be deterministically compiled into executed H3 instructions.
- [ ] Exact reference IDs/hashes/roles and workflow/model identity are representable in production provenance.
- [ ] Required runtime/model components are pinned and governance-checked.
- [ ] Unit/static/preflight tests cover representative reference combinations and both routing modes where supported.
- [ ] No fabricated physical certification artifacts are committed.

## Completion condition

The repository contains a deterministic, reference-directed MiniMax-H3 production component ready for real-host certification and later dispatch wiring.



Design document:
# Design: Reference directed MiniMax-H3 production

## Purpose and architectural boundary

Issue #328 adds a deterministic, certification-ready production component. It does not add dispatch orchestration, ShotPlan UI, storyboard rendering changes, production acceptance changes, or physical certification. The component consumes an approved current-revision ShotPlan, SceneSpec, and immutable reference bindings and produces a profile-specific workflow execution plus reconstructable provenance.

ADR 0007 is authoritative: `reference_directed` uses ShotPlan and bound ReferenceAssets as visual authority; previs is review evidence only. `frame_anchored` is an explicit route using verified anchor frames. There is no inferred route and no fallback between routes. The existing `MINIMAX_H3_720P_5S_I2V_V1` remains the frame-anchored identity. Add `MINIMAX_H3_720P_5S_REF2V_V1` with engine `minimax_h3_ref2v`.

## Profile and certification representation

The new profile must represent static execution configuration without claiming hardware measurements. Extend the profile contract so profile identity, workflow/model/runtime pins, geometry, frame count, FPS, and configured generation parameters are declared fields, while measured VRAM, host RAM, process RSS, render duration, and physical certification evidence remain a separate optional/absent certification record. Existing certified profile schemas and meanings remain compatible. The new profile has no synthetic measurement values and cannot be treated as physically certified until operator evidence exists.

Keep three provenance classes distinct: `declared` is requested creative intent (SceneSpec/ShotPlan and requested duration); `configured` is the profile and exact values injected into the ComfyUI graph; `executed` is the immutable graph snapshot and instruction actually submitted; `measured` is runtime-observed output metadata such as measured duration, stream dimensions/FPS/frame count, resource measurements, and output digests. `verified` records checks and their subject (for example, expected workflow hash matched, staged bytes matched asset SHA-256, or pinned runtime identity matched). Configured frame count/FPS must never be reported as measured stream metadata. A configured duration does not prove output duration.

## Closed topology and variable reference cardinality

Topology is declarative and profile-specific. Every target is `{nodeId, classType, inputField}`; validation rejects absent nodes, duplicate node IDs in the target set, wrong classes, missing inputs, or incompatible input shapes before graph mutation. There is no node-class search or heuristic discovery. Reference topology is `referenceImages: readonly NodeInjectionTarget[]`, exactly nine ordered targets, with array index 0 representing 1-based slot 1 and subsequent entries slots 2 through 9. The reference node target is separately declared for the H3 `ref_images` collection and `ref_image_size`; prompt/Picture-tag surface, seed, width, height, frame count, and any other mutable generation controls each have explicit targets. Targets and class/input names are fixed only after checking the pinned node specification.

The checked-in Ref2V API workflow is authored with a connected nine-entry reference collection in a form accepted by the native node. For N references, where 0 <= N <= 9, the worker constructs the `ref_images` collection from exactly slots 1..N in canonical order. It does not leave missing `LoadImage` nodes, file paths, or dangling links: unused image loader nodes are removed from the per-execution graph and the collection is rebuilt to N entries before preflight/submission. For N=0 the worker sets the node's optional collection to its documented empty/omitted representation and verifies that the native node accepts prompt-only execution; if the pinned node cannot execute that form, preflight rejects zero-reference jobs rather than submitting a broken graph. Topology validation validates the nine declared slot descriptions against the canonical template, while execution validates and submits only the N active, connected references. Thus fewer than nine references neither fail because unused slots are absent nor reach ComfyUI as unpopulated loaders. Counts above nine fail before staging. The per-execution graph and exact active target map are included in executed workflow identity/hash and provenance.

Frame-anchored topology is separate and explicitly declares first-frame and optional last-frame targets. It validates only targets required by the selected anchor state; unused anchor inputs are absent or disconnected by a deterministic template operation. `none` is not a valid frame-anchored execution state.

## Canonical reference ordering and honest roles

Bindings have no persisted ordinal, so both prompt compilation and staging use one canonical function over the same resolved binding snapshot. Sort ascending by role priority `subject_identity`, `product`, `location`, `style`, `composition`, then by `referenceAssetId` in ascending Unicode code-point order. IDs are canonical UUID strings and compared in lowercase canonical form; duplicate `(role, referenceAssetId)` bindings are invalid. Do not use query order, insertion order, localized collation, weight, or storage key as tie-breakers. The resulting order assigns 1-based `slotIndex` and exact `<Picture n>` `promptTag`. Compiler and staging consume the canonicalized list, not independently sorted inputs.

H3 accepts images as an ordered collection, not typed semantic-role sockets. Each binding records its canonical role as metadata and the executed instruction explicitly associates its stable Picture tag with that role/subject when relevant. This is guidance, not a claim of role-specific model enforcement. Preserve all role, asset ID, digest, slot, and tag information. Reject non-image media, non-representable regional hints, and any binding weight semantics that cannot be honored. If weight is retained only as requested metadata, provenance marks it `declared_unapplied` and admission rejects non-default weight rather than silently dropping it. Do not infer video/audio-reference support from generated audio components.

## Deterministic ShotPlan compilation and admission

A pure compiler accepts the approved ShotPlan identity/revision, current SceneSpec, route, canonical resolved binding list, and frame-anchor resolution when applicable. It verifies approval/current revision, route agreement across selected profile, SceneSpec/ShotPlan declarations, and required current-revision scene approval. Reference-directed mode permits zero to nine images; it never stages previs. Frame-anchored mode requires anchor target and verified anchor media for each requested endpoint, and rejects reference collection inputs.

Compile supported fields in a fixed documented sequence: SceneSpec action/script context; framing, angle, lens, camera position/movement/speed; subjects and positions; action summary; beats sorted by unique `beatIndex` with explicit start/end milliseconds; lighting, environment, palette, atmosphere; continuity; supported dialogue/performance; then ordered role-to-Picture declarations. Normalize line endings to LF, trim field-edge whitespace, escape embedded control characters deterministically, and use fixed separators. Reject duplicate beat indices, invalid/out-of-duration ranges, missing required values, or material fields with no declared textual encoding. Every tag in the instruction must correspond to exactly one active staged image and vice versa; zero images means zero Picture tags. The compiler returns exact UTF-8 instruction bytes and SHA-256. That executed text is persisted; source ShotPlan ID alone is not a reconstruction substitute.

ShotPlan beat ranges are represented losslessly as integer `startMs`/`endMs`, with half-open interval semantics `[startMs,endMs)` and validation `0 <= startMs < endMs <= configuredDurationMs`; the compiler preserves both endpoints. Do not claim that H3 enforces exact timing. Scene trim, loop, and audio/video synchronization are not H3 profile controls in this issue: no trim/loop behavior is inferred or encoded. If an upstream SceneSpec requests trim or loop semantics, admission must either preserve a typed declared request and reject execution as unsupported, or a later explicitly scoped profile must define the exact control and provenance. The #328 schema must not silently erase such intent.

## Provenance contract and persistence

Extend `AssembleManifestInput`, `AssembleGenerationManifest`, and the generation manifest contract rather than relying on prompt text or candidate-only fields. A production manifest has route/mode, profile key/version/engine, workflow template identity and expected hash, actual submitted workflow hash, pinned ComfyUI revision and required model artifact identities/hashes, exact instruction and hash, ShotPlan ID/variant/revision and SceneSpec revision, configured parameters, staged image entries, and route-specific evidence. Each `referenceImages` entry contains `slotIndex`, `assetId`, SHA-256, canonical role, `promptTag`, staging subfolder/name, and injection target. Include the resolved binding snapshot and verify IDs/digests against the staged bytes. Record first/last frame asset/candidate identity, digest, transform, and injection target only for frame-anchored execution.

`previsReviewEvidence` is optional review metadata containing the previs candidate identity/hash and review association; it is outside `executionConditioning` and never contributes to conditioning claims. Reference-directed `executionConditioning` contains only actual instruction/reference/profile inputs. For frame-anchored jobs it contains only actual anchor inputs. Preserve legacy `approvedCandidate` and candidate-conditioned manifests for existing consumers; production reference-directed records do not require `approvedCandidateId`.

Conditional invariants are enforced at schema and assembler boundaries: (1) `routingMode=reference_directed` requires profile `MINIMAX_H3_720P_5S_REF2V_V1`, approved ShotPlan identity/revision, executed instruction/hash, and `referenceImages` array (possibly empty), forbids anchor injection, and forbids candidate conditioning; (2) each Picture tag has one unique slot/asset and each active image has one tag and verified SHA; (3) `routingMode=frame_anchored` requires the I2V profile and non-empty first-frame identity/hash/target, permits last-frame fields only as an all-or-none tuple, and forbids reference-directed image claims; (4) a workflow hash/runtime pin and model hashes are mandatory for either route; (5) measured fields are included only when actually observed and carry measurement provenance, never populated from profile configuration. Profile/mode contradictions or partial conditional tuples fail closed.

Update worker payload validation to allow `shotPlanId` and positive `specRevision` on production jobs when using the reference-directed profile, require both together, cross-check them against the approved current-revision plan, and reject them for unrelated candidate jobs. Decouple Ref2V resolution/staging from `approvedCandidateId`; only frame-anchored execution resolves the approved candidate when that candidate is the declared anchor. A reference-directed job may carry optional previs review identity, but that identity can never be an execution input.

## Workflow, runtime, and governance

Author `templates/minimax_h3_720p_ref2v_124f_api.json` from verified native `MiniMaxH3ReferenceToVideo` node specifications and the pinned `.minimax-h3-version` runtime/model requirements; no such checked-in template or ComfyUI source checkout is assumed. Record its exact SHA-256 in `templates/provenance.json`. Pin and verify ComfyUI core revision that registers native H3 nodes, plus every required external artifact. Prefer native nodes. The existing MiniMax Community License approval applies to the same verified model weights used by the I2V profile and may be reused for those exact weights under the new profile identity. Do not transfer that approval to unverified artifacts. Any newly introduced external custom node with unknown rights is `review_required`; it is not usable until governance permits it.

## Compatibility and completion boundary

Direct consumers must be able to parse old manifests and profile identities while recognizing the new route and its lossless schema. `AssembleGenerationManifest` writes the new shape; downstream #330 may consume it without requiring #328 to implement #330 execution. Do not remove historical candidate provenance. Unit, static, and preflight coverage includes prompt-only and 1..9 reference cardinalities, representative roles, mismatch/drift rejection, both routes, provenance conditional invariants, and compatibility parsing. No certification/baseline/render-profile evidence artifacts or physical claims are authored.

## Acceptance trace

AC-1/2: distinct REF2V and existing explicit I2V identities; AC-3: exact declarative targets plus deterministic variable-cardinality graph construction; AC-4/5: canonical role order and explicit rejection of unsupported semantics; AC-6: approved plan compiler with exact text/hash; AC-7: route-complete manifest and worker payload conservation; AC-8: pinned runtime/model and evidence-based license state; AC-9: representative tests for both modes; AC-10: no fabricated measurements. REQ-TRAP-1 through REQ-TRAP-6 remain excluded.

Implementation plan:
# Implementation plan

## 1. Verify repository seams and native graph contract

Read ADR 0007, `docs/CONTEXT.md`, profile/topology contracts and tests, worker validation/execution and tests, reference binding/staging adapters, manifest schema/repository/serialization tests, `AssembleGenerationManifest`, `.minimax-h3-version`, `templates/provenance.json`, and component governance. Trace what `SceneSpec`, ShotPlan approval, bindings, and render payload already carry. Do not assume a reference-directed API template or ComfyUI source checkout exists. Use the pinned runtime/node specification evidence and available documented workflow export to verify `MiniMaxH3ReferenceToVideo` input names, types, empty-reference behavior, output links, and dynamic `ref_images` representation. If zero-reference execution is unsupported, encode the explicit preflight rejection rather than inventing graph behavior.

## 2. Define profile, topology, and template artifacts

Add `MINIMAX_H3_720P_5S_REF2V_V1` (`minimax_h3_ref2v`) as a separate reference-directed identity; keep `MINIMAX_H3_720P_5S_I2V_V1` as explicit frame-anchored mode. Update `RenderProfileSchema` and related profile/registry code to represent static, certification-ready configuration without fabricated `measuredPeakVramMb`, `measuredTotalDurationMs`, or other physical metrics. Preserve existing profile parse/validation compatibility and require a separate actual certification record before calling the new profile certified.

Extend `ProfileInjectionTopology` with explicit prompt, seed, geometry, frame/duration, reference collection, reference scaling, and route-specific frame-anchor targets as supported by the verified node contract. Declare the exact nine `referenceImages` slot targets as ordered `NodeInjectionTarget[]` (indices map to 1-based slots); separately declare collection and Picture-tag semantics. Validate duplicate/absent/wrong-class/missing-input targets before any mutation. Add `templates/minimax_h3_720p_ref2v_124f_api.json` as an explicit task deliverable, built from the pinned native specifications, with nine valid connected reference slots and valid execution output wiring. Add the template identity/hash entry to `templates/provenance.json`. Do not author files in `certification/`, `baseline/`, or `config/render-profiles/`.

## 3. Canonicalize bindings and compile the approved ShotPlan

Implement one shared pure canonical ordering operation consumed by compiler and staging: role priority `subject_identity`, `product`, `location`, `style`, `composition`; then canonical lowercase UUID `referenceAssetId` ascending by Unicode code-point comparison. Reject duplicate role/asset pairs. Assign stable 1-based indices and `<Picture n>` tags once, pass that ordered representation through all downstream layers, and never independently re-sort. Validate image media, immutable identity and SHA-256, current SceneSpec revision, supported role/weight/hints, and maximum nine. Support zero references only if the verified node behavior permits it.

Implement deterministic ShotPlan + SceneSpec compilation using fixed field order, LF normalization, deterministic whitespace/control escaping, beats ordered by unique `beatIndex`, and explicit `[startMs,endMs)` integer range encoding. Enforce ranges within configured duration. Persist exact emitted UTF-8 instruction and SHA-256. Every tag maps one-to-one to one staged reference. Reject unencoded material intent, unsupported modalities, unsupported weights/region hints, and requested trim/loop semantics unless exact supported controls and provenance are defined. Test stable output, tags, and rejection behavior.

## 4. Execute route-specific closed graph construction and worker admission

Update worker payload types and `validateInjectedPayload` in `apps/render-worker/src/render-job-executor.ts`: production Ref2V accepts `shotPlanId` plus `specRevision` as an all-or-none pair, validates positive revision, approved/current plan and matching scene revision, and does not require `approvedCandidateId`. Reject these fields for unrelated job/profile combinations. Reference-directed staging resolves current immutable ReferenceAssets directly. Keep `approvedCandidateId` resolution for frame-anchored jobs whose declared anchor uses that candidate. No route fallback is allowed.

Before mutation, validate all declared topology targets against the checked-in template and enforce profile/mode consistency. Build the per-job reference graph deterministically: construct exactly N entries for 0..9 in canonical order, remove unused LoadImage nodes/links/files for slots N+1..9, and validate N active paths/targets and their hashes. For N=0, use the documented native empty/omitted collection only when pinned-node preflight proves it valid; otherwise reject before submission. Never submit disconnected loaders or dangling links. For frame-anchored execution, construct only the explicitly required first/last anchor inputs and verify each target and digest. Capture the exact final graph snapshot/hash and the active injection map.

## 5. Extend manifest assembly, contracts, and governance

Update `AssembleManifestInput`, `AssembleGenerationManifest`, generation manifest schemas, and serialization/repository round trips to accept route-specific execution data. Add `routingMode`, ShotPlan/SceneSpec identities and revisions, profile/workflow/model/runtime pins, exact executed instruction/hash, `referenceImages` entries (`slotIndex`, asset ID, SHA-256, role, Picture tag, stagedAs, injectionTarget), configured generation values, optional `previsReviewEvidence`, frame anchors only for frame-anchored mode, and measured/verified fields only when sourced from execution. Make empty `referenceImages: []` explicit for valid prompt-only mode. Preserve legacy `approvedCandidate` and old manifest reads.

Enforce conditional invariants in schemas and assembler: reference-directed profile/route pair; mandatory ShotPlan/revision/instruction/workflow/model provenance; no candidate conditioning or anchor fields; one-to-one slots/tags/asset digests; frame-anchored route/profile pair with required first anchor and all-or-none optional last-anchor identity/hash/transform/target; no reference-directed claims for anchor route; no partial tuples; and no configured-to-measured promotion. `previsReviewEvidence` remains a sibling review field and is never nested in `executionConditioning`. Cross-check submitted graph values, staged bytes, resolved binding snapshot, payload identity, and manifest values.

Pin/verify ComfyUI core revision and exact required artifacts in the established environment mechanism, and update `templates/provenance.json`, `.minimax-h3-version` governance checks as needed. Reuse the existing MiniMax Community License approval only for identical verified model hashes. New unknown external custom nodes remain `review_required`; native ComfyUI nodes need no invented custom-node dependency. Record evidence-based component governance.

## 6. Tests and validation

Add focused tests for profile union compatibility with absent measurements; topology exact targets and drift; 0, 1, 9, and 10 references; active graph construction with no dangling/unused loaders; deterministic ordering across permuted database/query order and tied roles; duplicate bindings; tag-to-stage bijection; unsupported roles/media/weights/hints; route mismatch; approved/stale ShotPlan payload validation; absence of candidate requirement for Ref2V; frame anchor first/last conditional tuples; instruction determinism and beat ranges; expected template/runtime/model hash verification; manifest schema, assembly, persistence round-trip, legacy compatibility, and provenance-layer distinction.

Run focused unit tests and relevant fast gates (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm boundaries`, `pnpm check:control-plane`). If an integration test is changed, invoke it with `pnpm vitest run --config vitest.integration.config.ts <file>` or run `pnpm test:db`. Do not use rendering as validation and do not create physical certification artifacts.

## 7. Downstream compatibility and scope check

Verify directly referenced downstream manifest consumers can represent and parse the new route, ordered reference entries, previs review evidence, and measured-versus-configured distinction while continuing to accept legacy candidate manifests. #328 delivers the contract and assembly representation; downstream dispatch/consumer execution belongs to its owning issue. Do not implement ShotPlan UI, storyboard rendering, production dispatch orchestration, production acceptance changes, physical benchmark claims, or 2K/quantization optimization.

Review findings to fix:
```
### FINDINGS TO RESOLVE:
- **[AC-1] [HIGH]** Failed requirement: Declarative injection topology covers all supported inputs and fails closed on mismatch.
  Evidence: Topology declares node 105 input ref_images, absent from the authoritative template, which instead has ref_image_1 through ref_image_9. Worker does not validate referenceNode/refImageSize or the complete topology before mutation.
  Required Fix: Implement requirement to satisfy: Declarative injection topology covers all supported inputs and fails closed on mismatch.
  Source: spec-review

- **[AC-2] [HIGH]** Failed requirement: Unsupported reference semantics cannot be silently discarded.
  Evidence: When bindings are empty, executor synthesizes them from libraryRole, weight 1 and null hints. If plan repository/result is absent it falls back to payload prompt but still emits reference_directed provenance.
  Required Fix: Implement requirement to satisfy: Unsupported reference semantics cannot be silently discarded.
  Source: spec-review

- **[AC-3] [HIGH]** Failed requirement: Approved ShotPlan can be deterministically compiled into executed H3 instructions.
  Evidence: Compiler is deterministic, but worker treats repository/plan as optional and may submit fallback prompt while recording requested ShotPlan identity. It does not verify fetched plan revision against payload/current SceneSpec approval; compiler is invoked without SceneSpec.
  Required Fix: Implement requirement to satisfy: Approved ShotPlan can be deterministically compiled into executed H3 instructions.
  Source: spec-review

- **[AC-4] [HIGH]** Failed requirement: Exact reference IDs/hashes/roles and workflow/model identity are representable in production provenance.
  Evidence: Schema represents required fields and worker hashes staged references, but profile/engine conditional uses AND between mismatch checks, and assembler does not verify manifest reference entries against graph injections or instruction hash/length against submitted text.
  Required Fix: Implement requirement to satisfy: Exact reference IDs/hashes/roles and workflow/model identity are representable in production provenance.
  Source: spec-review

- **[AC-5] [HIGH]** Failed requirement: Required runtime/model components are pinned and governance-checked.
  Evidence: .minimax-h3-version and its checker pin model repository revision and hashes, but no ComfyUI core revision is pinned although core registers the node. Template source revision is model repo revision. New registry rows approve multiple profile aliases rather than documenting distinct exact artifact/runtime evidence.
  Required Fix: Implement requirement to satisfy: Required runtime/model components are pinned and governance-checked.
  Source: spec-review

- **[AC-6] [HIGH]** Failed requirement: Unit/static/preflight tests cover representative reference combinations and both routing modes where supported.
  Evidence: Tests cover 0, 2, 9 and >9 references, representative role, and existing I2V behavior, but omit adversarial plan/binding absence, revision drift, topology drift and one-sided profile mismatch.
  Required Fix: Implement requirement to satisfy: Unit/static/preflight tests cover representative reference combinations and both routing modes where supported.
  Source: spec-review

- **[F-ff6e1a57] [HIGH]** Production can omit approved plan/binding authority but emit authoritative provenance; route contradictions are not fail-closed.
  Files: apps/render-worker/src/render-job-executor.ts, packages/contracts/src/generation-manifest.ts
  Evidence: Ref2V synthesizes bindings from asset libraryRole when none exist; it can fall back to payload prompt when plan repository/plan is missing while recording the requested ShotPlan identity. Schema profile/engine mismatch check uses AND.
  Required Fix: Require current approved plan and bindings, reject unsupported semantics, reject if either profile or engine mismatches, and check instruction plus actual graph-reference correspondence.
  Source: spec-review

- **[F-cfc18e7e] [HIGH]** Exact topology and fail-closed drift are normative; target declaration does not describe the submitted graph.
  Files: packages/contracts/src/render-profile.ts, templates/minimax_h3_720p_ref2v_124f_api.json, apps/render-worker/src/render-job-executor.ts
  Evidence: Declared ref_images target is absent from template; numbered ref_image_N inputs are present. Worker prunes numbered nodes/inputs but never validates complete declared topology.
  Required Fix: Model the actual native interface and validate every node/class/input/connection before mutation; test drift.
  Source: spec-review

- **[F-7b193233] [HIGH]** Required runtime pinning and evidence-backed governance are incomplete.
  Files: templates/provenance.json, .minimax-h3-version, scripts/check-minimax-h3-version.sh, config/component-license-registry.json
  Evidence: Checker verifies model artifacts only; no ComfyUI core commit is pinned although it provides the native node. Added governance rows approve profile aliases without distinct artifact/runtime evidence.
  Required Fix: Pin and verify ComfyUI core independently and retain review_required absent exact approval evidence.
  Source: spec-review

- **[F-dc50ab6a] [CRITICAL]** This can silently execute against unrelated library references and user-supplied prompt text while producing a reference_directed manifest that names a ShotPlan ID. These are production authority and provenance integrity failures, not merely missing dependency configuration.
  Files: apps/render-worker/src/render-job-executor.ts
  Evidence: In the Ref2V branch, referenceAssetRepository is optional; when bindings are empty, lines 1061-1070 synthesize scene bindings from every non-archived library asset's libraryRole. shotPlanRepository is also optional, and when it is absent or findById returns no plan, lines 1183-1188 hash and submit the injected fallback prompt (or an empty string). The worker therefore has successful execution paths without an approved ShotPlan or authoritative current-revision SceneReferenceBindings.
  Required Fix: Make the repositories mandatory for Ref2V, fail closed if the plan or current-revision binding snapshot is absent, and verify plan scene ID, requested revision, approval/current-scene approval and binding revisions before staging. Remove the libraryRole fallback and compile only the verified approved plan with its authoritative bindings.
  Source: quality-review

- **[F-72fbb175] [HIGH]** The checked-in graph and mutation path do not implement the documented native collection contract. A workflow with unrecognized per-slot inputs can fail ComfyUI validation or run without the intended images; the current tests assert the authored shape rather than prove compatibility with the pinned node API.
  Files: templates/minimax_h3_720p_ref2v_124f_api.json, apps/render-worker/src/render-job-executor.ts, packages/contracts/src/render-profile.ts
  Evidence: ADR 0007 describes the native MiniMaxH3ReferenceToVideo input as ref_images. The authored workflow instead declares ref_image_1 through ref_image_9 on node 105, and mutateWorkflow deletes those keys for inactive slots without constructing or updating a ref_images collection. The topology declares referenceNode.inputField as ref_images, but that target is not used to build the graph.
  Required Fix: Build the per-execution ref_images input in the exact representation accepted by the pinned native node, validate that shape against its registered input schema, and test a preflight/graph submission for zero, one, and multiple references before treating the profile as executable.
  Source: quality-review

- **[F-92d82f45] [HIGH]** The manifest is the durable routing contract. Allowing either half of a contradictory identity to pass lets consumers classify provenance incorrectly and defeats the intended fail-closed route/profile pairing.
  Files: packages/contracts/src/generation-manifest.ts
  Evidence: The reference_directed profile/engine invariant at lines 169-172 rejects only when both renderProfile is wrong and engine is wrong (logical AND). A manifest with the correct profile and an unrelated engine, or the correct engine and an unrelated profile, passes this conditional check.
  Required Fix: Reject when either identity field mismatches (logical OR), and add schema tests for each one-sided mismatch. Apply equivalent route/profile/engine conditional validation to frame_anchored manifests as well.
  Source: quality-review

- **[F-9785b7fc] [CRITICAL]** This turns implementation-authored assertions into an active governance authorization. The issue permits reusing approval only for the exact already-reviewed model weights and requires evidence-backed governance; these entries can cause the license routing guard to authorize execution based on newly fabricated review metadata.
  Files: config/component-license-registry.json
  Evidence: The change adds three separate Ref2V model component IDs as status approved, each with a new reviewedAt timestamp and copied notes asserting commercial-use approval and operating-entity compliance (lines 50-80). No review evidence is supplied, and the entries duplicate one profile identity under alternate identifiers.
  Required Fix: Do not introduce new approval records or review timestamps in implementation. Reuse only the existing registry authorization keyed to the verified identical artifacts through the established governance mechanism; keep any artifact/profile without documented review as review_required until an authorized reviewer records the evidence.
  Source: quality-review

```



## TASK

Read the review findings and failed acceptance criteria carefully.
Implement the necessary fixes in the repository worktree to resolve all blocking defects.

1. **Targeted Scope**:
   - Fix ONLY what the review findings report. Do not expand scope or refactor unrelated code.
   - Respect repository architectural boundaries (inward dependencies only; do not import `@ai-sdlc/infrastructure` in `packages/application`).
   - Do NOT revert or undo changes in validation-critical files (listed under Validation-Critical Files above) unless you are providing an alternative fix that still passes validation.
   - **Governance and Compliance Gate Integrity**:
     - Do NOT fabricate compliance records, licensing audit notes, or approval metadata to resolve a finding.
     - Do NOT edit production license registries, compliance registries, security exception lists, or legal audit configurations (e.g. `*license-registry*.json`, `*compliance-registry*.json`, or equivalent repository governance files) to flip gate statuses (such as `review_required`, `blocked`, or `pending`) to `approved`.
     - Never weaken fail-closed policy checks or alter authoritative production governance data merely to make a test pass or satisfy an acceptance criterion.
   - **External Authority / Human-Owned Gates**:
     - Distinguish code defects from conditions requiring external authority (legal sign-off, commercial licensing review, physical hardware/certification, human operator credentials or decisions).
     - Automated fixers CANNOT satisfy external authority gates by self-authoring approval or mocking out real-world conditions in production data.
     - If a finding cannot be resolved through code/test fixes within repository boundaries and instead genuinely requires external human or operator action (or would require fabricating compliance data), you MUST NOT falsify data or weaken the gate. Instead, report `"result": "cannot_fix"` with an explanation in `reason`.

2. **Worktree State**:
   - Make the required file modifications and leave the worktree in a finished state for deterministic validation.

## VALIDATION SCOPE

Do not re-run the full repository validation suite yourself. A dedicated
validate/fix-validate phase runs the complete suite immediately after you
finish, with its own properly-sized per-command timeout - separate from
your invocation budget. Re-running it yourself risks exceeding your time
budget before you can write any result at all, which is worse than a
validation failure: it loses the entire turn, including your fix.

Limit your own verification to:
- `pnpm typecheck`
- `pnpm lint`
plus only the specific unit test(s) that directly cover your changes.

Do not run integration suites, Testcontainers-based tests, or
hardware/model-dependent suites (database integration tests, media
encoding/ML inference suites, GPU-dependent render tests, or any
repo-specific equivalent) yourself.

## FINAL ACTION

Write `./fix-review-result.json` with:
```json
{
  "result": "done_with_fixes"
}
```

Or, if any blocking finding cannot be fixed automatically because it requires external authority, legal/licensing audit sign-off, human operator action, or cannot be resolved without fabricating compliance data:
```json
{
  "result": "cannot_fix",
  "reason": "Explain why the finding requires external authority or human intervention and cannot be fixed automatically."
}
```

## CRITICAL RULES

- Do not ask questions.
- Do not switch git branches.
- Do not create commits.
- Never fabricate compliance data or weaken fail-closed governance/licensing gates.
- If a finding requires external authority, legal sign-off, or human operator action, write `result: cannot_fix`.
- Write `./fix-review-result.json` before stopping.
- If `./fix-review-result.json` already exists and needs revision (e.g. a second pass over your own review found something new), rewrite the entire file from scratch. Do not patch/diff-edit it — context-based patch tools are unreliable against large JSON arrays, since they require reproducing exact surrounding text; a failed or partial patch application can silently corrupt the file.
