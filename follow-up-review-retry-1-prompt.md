You are performing a follow-up review of code changes made in response to earlier review findings.

## CONTEXT

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-427
Issue number: 427

Issue description & acceptance criteria:
# [421.6] Add regression and simulated end-to-end coverage for variable-duration H3 production

## Parent
#421

## Depends on
#424, #425, #426 merged, using #445 operator-accepted candidate configurations as test fixtures only. Final release remains #428.

## Execution
**Autonomous code/CI only.** CI simulation is not equivalent to GPU/quality certification.

## Objective
Prove that the newly supported duration pathway is coherent from campaign brief to accepted output, while old five-second jobs and snapshots keep working.

## Required automated paths
1. Campaign create → feasible scene-count/beat allocation → ShotPlan variants/previs → selected/approved ShotPlan → production-input inspection → certified profile dispatch → production review → accepted assembly/delivery.
2. At least one longer-duration *simulated* positive path using an explicitly candidate-only capability matrix matching a speed-and-quality combination accepted by operator #445.
3. Negative paths: off-grid frames, unapproved profile, wrong engine/route, wrong resolution, no eligible capability for requested duration, corrupt/missing certification evidence, stale ShotPlan revision, bad output frame count, assembly timing mismatch, retry/replay/idempotency conflict.
4. Legacy five-second job and historical ShotPlan/GenerationManifest read-path regressions; mixed profile support where eligible.
5. Invariants: declared profile identity and hashes match executed frame count and output provenance; requested/nominal/probed duration never silently conflated; operator-only approval cannot be satisfied by a fixture.
6. Run appropriate `pnpm test` and `pnpm test:db` suites, build/lint/typecheck and architecture boundary checks. Keep integration tests on the correct config per `AGENTS.md`.

## Acceptance
- [ ] Every covered failure fails closed before GPU or assembly side effects as appropriate.
- [ ] One realistic positive application lifecycle is automated without pretending to validate actual GPU execution.
- [ ] Existing certified five-second flows retain behavior.
- [ ] Docs include prerequisites and clear operator release gate.

## Non-goals
- Creating actual experimental render assets, host telemetry or human video-quality sign-off.
## Additional regression cases (revised 2026-10-13)
- A technically conformant 362f sample with recorded `NO_GO` visual decision **must not** be misrepresented as release-eligible.
- Route distinction: certified/eligible I2V never licenses Ref2V automatically.
- Exact optimizer checkpoints/custom-node versions/step schedules are immutable in production payload fingerprints and manifests; fallbacks, unknown backends, wrong hashes, and uncertified combinations fail closed.
- Public UI must not advertise staging-only candidate lengths before #428 real certification.



Issue comments:
## Comment by opsclawd

Flagging explicitly: #426's follow-up-review repeatedly demanded a complete, reachable
acceptance-run → worker → completion → accepted-reel lifecycle (AC-9/AC-15/AC-23 in that
issue's ledger) as a blocking condition. That's squarely this issue's stated deliverable
("one realistic positive application lifecycle... without pretending to validate actual
GPU execution"), not #426's (UI/planning layer). Carrying it over here so it isn't lost:
the acceptance-run dispatcher/worker wiring landed in #426's PR (real
`StageH3CandidateRenderUseCase` composition), but the assembly still stops at enqueue —
no worker-side completion or accepted-reel read path is exercised end to end yet.



Design document:
# Design: variable-duration H3 regression and simulated application lifecycle (#427)

## Scope, authority, and verified base

Deliver the full campaign brief → duration/beat allocation → ShotPlan variants/previs → selection/approval → input inspection → profile dispatch → render worker completion → explicit review acceptance → assembly worker completion → readable accepted reel lifecycle. COMMENT-1 requires worker-driven completion and persisted artifact readback; enqueue alone, seeded completed manifests, and a test calling an internal completion callback do not satisfy it. Include a separate certified five-second production control.

This planning correction writes only result.json. It does not change source or move the branch. HEAD is 3aca16b. Git history confirms PR #489 (#425, c7ab353) and PR #490 (#426, accde6a plus be354b3) are merged at a4622d9 on origin/release/2026-10-23-release-2026-10-23-batch-425-426-427. The first implementation action is `git merge --ff-only a4622d9` on the current worktree branch, before source edits. Do not reimplement prerequisites or switch branches.

Repository evidence was read from AGENTS.md, docs/CONTEXT.md (there is no root CONTEXT.md), .ai-orchestrator.json, ADRs 0001/0005/0007/0008, the H3 acceptance runbook, current assembly/media contracts and integration tests, and the a4622d9 git objects for campaign creation/replanning, acceptance contracts/use cases/queue, candidate executor, and tests. The effective configuration is this worktree's .ai-orchestrator.json; no machine-local config is assumed. Existing tests provide reusable infrastructure, but shot-plan-to-h3-lifecycle directly invokes completion and operator-acceptance-run.test substitutes staging and stops at enqueue.

The prerequisites are known, not absent: [#445 closure](https://github.com/opsclawd/comfy-content-orchestrator/issues/445#issuecomment-6374293905) and [#421 operator decision](https://github.com/opsclawd/comfy-content-orchestrator/issues/421#issuecomment-6374280987) record the completed optimization gate. [#425 operator matrix](https://github.com/opsclawd/comfy-content-orchestrator/issues/425#issuecomment-6380534495), node IC_kwDOT44Drc8AAAABfE863w, supplies the authoritative matrix and explicitly authorizes test-local signing. Absence of a committed matrix file is not an unmet prerequisite and cannot excuse omitting AC-2. No genuine matrix or evidence is to be authored under certification/, baseline/, or config/render-profiles/.

## 1. Exact positive tuple and authority separation

The source matrix is `h3-capability-matrix-ref2va-turbo-4-2026-10-24`. Use its 243f Ref2V row for the mandatory longer simulation and its 362f row for scene-ceiling rejection. Both rows encode speedVerdict/qualityVerdict/overallVerdict as pass by explicit operator instruction. Preserve their rough-draft/preview-only CONDITIONAL GO notes, including content-dependent dimming, backdrop/limb corruption, and continuity/blackout defects. Passing registry admission is not production certification or approval of every rendered sample.

| Source identity | 243f positive | 362f boundary |
| --- | --- | --- |
| frames / fps | 243 / 24 | 362 / 24 |
| exact nominal duration | 10,125ms | 362,000/24ms = 15,083.333…ms |
| workflowHash | e6084e4f9004a591291f94c24998d10f2b6c7e687bab375ef8e3af8b29bb6e4a | 6cedefbd4bc0bc26c60826d29cdb4c63b5e11b5ee2fdf9e5d89e02aaca6a0c85 |
| specificationDigest | da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7 | 3d9a04081e1aee13dc08df76720ff5576b1c5bc04c047b2752e8af56d1637ddd |

The complete shared tuple is: version 1; route ref2v; routingMode reference_directed; width 1344; height 768; sampler res_multistep; scheduler simple; steps 4; cfg 1; denoise 1; attention backend comfy_native with customNodeRevision/customNodeSourceHash/packageVersion all none and sparsitySettings {enabled: false, method: none, threshold: 0}; customNodes []; packageVersions {torch: 2.13.0+cu130, comfyui: 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc}; runnerSettings {runnerProfile: dynamicvram-offload-v1, offloadPolicy: dynamicvram, requiresModelOffloading: true, maxConcurrentGpuJobs: 1, minFreeDiskGb: 20}. Preserve every field when computing canonical digests.

| Model role | SHA-256 |
| --- | --- |
| checkpoint | 9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779 |
| clip | 35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6 |
| audioVae | 8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48 |
| videoVae | 52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e |
| turboLora | 5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c |

additionalModels is empty. Source target facts: hostname llama; GPU UUID GPU-89a53488-359c-4942-75ae-47ee8aa89f53; expectedCoreRevision 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc; expectedPythonExecutable /home/gpoontip/ComfyUI/venv/bin/python. These are copied source facts, never a claim that CI observed that host. Source evidenceDigests are a4f0df4b421e9e02a9cb1435083acf2e2e370d59e8aa2342909a3f9c96da791e and 1c55132c518bddde0f4ded7de69ad2b993159fd732039b3fdcea09c47eeb252c. Retain the source operator identity, timestamps, notes, comment URL, row digest, and source envelope/content digest separately from test artifacts.

The positive campaign requests 20,000ms allocated to two scenes requesting 10,000ms each, each nominally 243/24 seconds; assert the actual deterministic allocation rather than conflating requested 20,000ms with nominal 20,250ms. Test 362f as registry-admissible research configuration but scene-inadmissible: its exact nominal duration exceeds MAX_SCENE_DURATION_MS = 15,000, so `scene_ceiling` is required even for a 15,000ms requested scene. Do not round 362f down into eligibility. Keep the earlier technically valid 362f NO_GO sample as a separate decision fixture with its own recipe/sample identity; neither the later pass row nor a valid byte probe overwrites that rejection.

Two separate lifecycles preserve authority. The longer path uses staging candidate selections, an isolated simulation realm, simulated_test evidence, test-owned grants and trust store, and operator-acceptance run storage/readback. The legacy path uses certified five-second production dispatch and ordinary production delivery. An accepted simulation reel is never a certified client delivery. I2V and Ref2V eligibility are independent in both directions; this matrix grants no longer I2V capability.

## 2. Fixture hashing and honest provenance

Keep a lossless copy of the operator-published specifications and source metadata in tests/fixtures/h3-variable-duration, outside production exports. Verify their original workflow hashes and specification digests using repository helpers. The published envelope has a placeholder signedBy and no production signature; do not describe it as cryptographically production-authentic. Generate an ephemeral Ed25519 keypair inside the harness and sign the canonical payload using the real matrix/signature functions, injecting the public key only into H3TrustedCandidateRegistryReader for this test. Sign staging grants with test authority, not deployment keys.

A harness workflow must be a connected executable Ref2V turbo-4 graph, with the model/LoRA, reference conditioning, sampler, decode and video-output nodes inspected by executeRenderJob, not a disconnected graph that merely contains expected values. Write it to the temporary workflow location that the worker actually reads. Use the real `hashWorkflow(rawWorkflow)` implementation. Require equality of that value, candidate.specification.workflowHash, and candidateProvenanceReport.workflow.sha256; compute the specificationDigest with computeH3CandidateSpecificationDigest(specification), derive the candidate key from that digest, then sign the test envelope. Never force an old digest onto new graph bytes or stub the hash check.

Keep original and harness identities explicit. If the exact source graph is used, require the published workflowHash and specificationDigest unchanged. If a minimal connected simulation graph differs from the source graph, store the unmodified source row separately and construct an explicitly simulated derivative with its newly computed workflowHash, specificationDigest and candidate key. Its metadata records sourceMatrixId, sourceSpecificationDigest, sourceWorkflowHash and the exact graph transformation; all accepted execution parameters above remain unchanged. The derived graph tests the operator-accepted duration/route/optimizer tuple with test authority and does not inherit operator approval of different graph bytes. Assert both source-row canonical identity and harness execution identity, with a lossless mapping between them. This is a mandatory simulation implementation detail, not permission to substitute an arbitrary 192f/configuration or drop the positive test.

Use actual Postgres/MinIO repositories/migrations and deterministic model responses. Replace only external planning-model, ComfyUI/provider, runtime observation, and output-fetch boundaries. Real campaign/review/planning policies, StageH3CandidateRenderUseCase, executeRenderJob, fingerprint and manifest builders, queues, completion use cases, and read projection remain composed. Generate neutral CPU clips in isolated temporary storage at exact source frames/fps/geometry, return them through the fake renderer, and independently probe them using pinned FFmpeg/ffprobe. Probe results describe those bytes; simulated process/GPU observations describe fixture claims. Neither proves GPU execution or visual quality. No NVIDIA invocation or live render host is required.

## 3. Authenticate planning selections and conserve duration plans

Repair CreateCampaignShellUseCase so caller-supplied executionProfileSelection and every allowedProfileSelections member are resolved again through resolveSelection(sel.profileKey). Compare kind and all relevant specification/release/certification/deployment/grant digests against the authority result; mismatches, expired/wrong-principal grants and inconsistent key aliases fail closed before campaign/plan/scene persistence or render enqueue. Persist only authority-resolved selections. Supplying an object must not bypass the path used for a profile key. Enforce scope/realm compatibility and that the selected capability is allowed.

Wire registryReader, stagingAuthSource and productionReleaseReader into PreviewCampaignReplanUseCase, CommitCampaignReplanUseCase and control-api bootstrap. Propagate the server-authenticated principal. Use the same authority resolution and capability-map construction as creation, including newly added keys and already persisted selections; stale stored grants do not authorize a new revision. Pass authenticated capabilities into planFeasibleCampaignDuration in both preview and commit. Released-production profiles must come from the release reader, not the candidate catalog. Preserve legacy-only operation during an unrelated authority outage, but fail requests that need the unavailable authority.

Persist revisioned CampaignDurationPlan, predecessor/plan binding digests, stable allocation identity, scene bindings, requested duration, exact integral frames/fps and nominal rounded-ms projection. Preview is read-only. Commit rechecks revisions and authority in its write path and atomically updates bindings/SceneSpecs while invalidating stale ShotPlan approval/input fingerprints according to existing rules. Test a successful 243f staging replan and a test-authorized released-production replan; the latter exercises software contracts without promoting an actual candidate. Test forged supplied objects and revoked authority, plus stale preview/commit conflicts and rollback.

## 4. Close acceptance stem provenance and command identity

Extend VideoStemSourceRecord and PostgresGenerationManifestRepository projections to losslessly expose jobId, sceneId, renderProfile/candidateProfileKey, candidateSpecificationDigest, specRevision, frames/fps and geometry, executionScope, ownerKind, acceptanceRunId, realm/evidenceOrigin, immutable output references/checksums and measuredMedia. Resolve these from persisted payload/manifest records and reject disagreements; do not infer missing candidate authority from a profile-key prefix. AcceptanceRunScene currently stores profileKey/frames, not every required immutable identity: add the candidate specification digest and any missing allocation/plan linkage to the contract and persistence snapshot. Compare those stored names against candidateProfileKey/allocatedFrames semantics explicitly.

Use one application-level stem validation policy at AcceptOperatorAcceptanceSceneUseCase, AssembleOperatorAcceptanceRunUseCase, and assembly worker pre-encode admission. Require current completed job/attempt, correct campaign/scene/run, current specRevision, accepted attempt ID/ordinal, current allocation/plan digest, and all of:

- measuredMedia.frameCount equals scene.frames (allocatedFrames), and measuredMedia.fps equals scene.fps; geometry and configured values match the admitted exact specification;
- renderProfile equals scene.profileKey (candidateProfileKey) and candidateSpecificationDigest equals the persisted scene/selection digest;
- ownerKind is staging_acceptance, executionScope is staging, acceptanceRunId is the run ID, and realm and evidenceOrigin equal the run's values;
- source object checksum is among immutable manifest outputs, and independently probed timing satisfies the existing profile tolerance rather than only checking for measuredMedia presence.

Any missing candidate-only field is denial, including legacy-looking incomplete data. Historical production documents remain readable but cannot be repurposed as staging candidate proof. Reject cross-scene/run/realm, superseded attempt, wrong digest and mismatched output before acceptance/enqueue; recheck at execution to close drift after enqueue. Deployed composition cannot consume simulated_test inputs; simulation authority is constructible only in isolated test composition.

BeginOperatorAcceptanceRunUseCase must honor actionId. Persist a uniquely scoped receipt binding authenticated principal, campaign, canonical input, plan/bindings/revisions, realm and selections to request hash and stable result/run/job identities. Identical replay returns the original run/jobs; changed canonical request under the same identity conflicts with HTTP 409. Apply the same replay/conflict semantics to accept, rerender, assembly request and completion. Infrastructure retry retains one attempt/ordinal; creative rerender creates a new immutable attempt. Use transactional uniqueness and deterministic staging request identities or existing durable dispatch receipts so concurrent begin/retry cannot dispatch duplicate logical work. Do not rely on an in-memory lookup or a database transaction spanning untracked external effects.

## 5. Acceptance assembly, licensing and atomic terminal states

Implement the missing AcceptanceAssemblyManifest adapter, application orchestration, control-API queue transport and AcceptanceDeliveryAssemblyWorker composition. Reuse delivery polling/heartbeat/retry/FFmpeg primitives with typed acceptance routing. Keep acceptance jobs/manifests and output namespace separate from production delivery. Canonically order accepted stems by sequenceIndex and recheck run/stem/allocation totals at admission.

Explicitly repair assembly component resolution: AssembleDeliveryReel currently passes H3_CANDIDATE_* directly to EnforceLicenseRouting, causing unknown_component. For a validated operator-acceptance assembly targeting BUCKETS.CANDIDATES, resolve the candidate through trusted immutable manifest/specification identity and map i2v/frame_anchored to MINIMAX_H3_720P_5S_I2V_V1 or ref2v/reference_directed to MINIMAX_H3_720P_5S_REF2V_V1, version 1, consistent with execute-profile-render and render-job-executor. Check every applicable model/LoRA/node/runtime component under existing license policy; route mapping is not a waiver for candidate-specific components. Unknown identity, missing specification, wrong route or blocked component fails before FFmpeg encoding. Do not infer a route from the candidate key alone or globally license arbitrary candidate keys. BUCKETS.DELIVERY always rejects candidate/staging/simulated stems, even if their underlying model is licensed. A caller choosing BUCKETS.CANDIDATES alone cannot confer acceptance authority: verify run ownership, scope and realm first.

Required transitions: queued → leased → rendering → completed/failed. Persist/require workerId, leaseToken and leaseExpiresAt together for active leases; start/heartbeat/terminal updates require active state, matching owner/token and unexpired lease using authoritative DB time. Reclaim expired active work and fence the old token. A terminal job cannot be changed by an old lease. Completion receipt replay with identical immutable output returns the recorded result even after terminal settlement; it cannot write again. Changed output or completion identity conflicts.

Upload verified media and typed manifest objects to deterministic run-scoped keys first; then atomically save the acceptance manifest, mark the job completed and transition its matching run from assembling to completed in a UnitOfWork. Compare output identity to the claimed spec/run. Terminal worker failure atomically marks both acceptance_assembly_jobs and operator_acceptance_runs failed with a reason. A retryable transport fault retains/requeues the same logical work under the existing retry policy rather than creating a false completed/failed pair; exhausted/terminal failure settles both. Publication failures cannot mark completion. Reconcile uncertain uploads with checksum-bound deterministic identities; uncommitted/orphan objects never become readable accepted output. Add only incremental migrations after the merged base, never edit migration 031.

## 6. Typed readback and lossless handoff

Replace AcceptanceAssemblyManifestSchema.manifest's untyped record with AssemblyManifestSchema. Persist explicit realm/evidenceOrigin and immutable links to acceptanceRunId, campaignId, assembly job, plan/bindings and ordered accepted attempt/manifest identities. If a contract field is not already present, add it to the acceptance envelope/typed lineage record and its Postgres adapter together. Do not weaken AssemblyManifestSchema invariants or invent provenance for historical records.

Define AcceptanceRunReelReadModelSchema in @cco/contracts as a discriminated union with common acceptanceRunId/campaignId, realm, evidenceOrigin and updatedAt. States are pending (pre-assembly run), assembling (requires assemblyJobId), completed (requires manifestId, assemblyJobId, validated AcceptanceAssemblyManifest, verified media and manifest references/checksums, playback/download URL), failed (requires error/reason and any known job ID), and unavailable (requires a reason, no playable URL). Define an exhaustive mapping for every run/job status, including cancelled as unavailable with a cancellation reason. Contradictory terminal run/job states are unavailable, not completed. Non-completed states cannot carry playable media. Missing/corrupt completed artifacts change the read result to unavailable without rewriting historical completion facts.

ResolveOperatorAcceptanceReelUseCase authenticates operator/client/run access, joins the canonical persisted run/job/manifest, parses the typed nested manifest, and verifies both output and manifest objects. Require BUCKETS.CANDIDATES, keys strictly under acceptance-runs/<acceptanceRunId>/, matching campaign/run/job/assembly identity, existence and SHA-256 of actual bytes (do not use an S3 ETag as SHA-256). The stored manifest reference/digest must match parsed object bytes and the persisted typed payload. Presign only after these checks. Tampered bucket/prefix, cross-run media, missing object, invalid JSON/schema, checksum mismatch or manifest substitution yields unavailable. Expose an authenticated GET under the existing acceptance-run namespace. Public campaign delivery queries continue to exclude all acceptance artifacts.

### Representational completeness and provenance layers

| Boundary | Required representation and reconstruction rule |
| --- | --- |
| Brief → plan → SceneSpec/ShotPlan | requested creative ms separate from frames/fps, rounded nominal ms, plan/revision/allocation IDs and ordered scene bindings; beats bounded by their allocation; no reinterpretation of requested ms as stream duration |
| Inspection → job → execution | selected approved plan/revision and references/anchor digests, authority-resolved selection, candidate spec/digest, workflow hash, all optimizer/model/runtime tuple fields, fingerprint and owner/realm; retain declared and observed execution separately |
| Render → review → accepted stem | configuredMedia is expected graph configuration; measuredMedia is independently probed fixture bytes; executed graph/runtime observations have their own source/authority; immutable job/attempt/manifest/output IDs and checksums preserve lineage |
| Accepted stems → assembly | versioned acceptance lineage maps every ordered stem to allocation, attempt, exact frames/fps/profile/specification digest and source checksum; AssemblySpec preserves intended expected duration; typed AssemblyManifest retains executed inputs, actualDurationMs, timeline, encoding, measured streams and output identity |
| Assembly → reel/read consumer | typed immutable acceptance envelope plus manifest storage reference/digest and verified media reference, run identity/realm/origin and union state; no profile/duration inferred from filenames or status alone |

Keep exact frames/fps alongside any integer-millisecond projection. Legacy 5000ms intent yields 124/24 seconds (approximately 5167ms nominal), not exactly 5000ms. Reuse the existing H3 quantization tolerance (355ms on the inspected base), source timing policy and ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS (250ms); do not substitute one blanket tolerance. Compare integral frames and cadence exactly before tolerant duration comparisons. The scene ceiling uses exact frames/fps, not rounded ms.

The existing assembly contract represents full ordered video stems, not arbitrary video ranges. This issue introduces no hidden trimming, looping or retiming of H3 stems to force a creative requested total. Reject unsupported video range/loop commands rather than dropping them. Preserve existing AssemblyManifest execution records for optional voiceover/soundbed: source media/checksum and actualDurationMs; trimStartMs, trimEndMs or the documented source-end default; loopCount, partialLoopDurationMs, padLeadingMs/padTrailingMs and effectiveDurationMs. Require 0 ≤ trimStart < trimEnd ≤ measured source duration, valid partial-loop bounds, nonzero consumed audio, and effectiveDuration = leading pad + sliceDuration × loopCount + partial loop + trailing pad. Preserve timeline decision policy, ordered stemDurationsMs/totalDurationMs, subtitle cues/hash/style when present, layout, command fingerprint, FFmpeg identity, configured encoding and independently measured streams. Typed nesting must retain these fields through JSON/database/object/API round trips. Include absent-audio and trimmed/partially looped audio round-trip witnesses; do not add a new range-editing subsystem.

Conditional invariants are enforced in schemas for local relationships and in application/repository transactions for cross-record relationships: staging candidates require specification/grant/realm/owner identity; accepted scenes require complete attempt/job/ordinal linkage; assembling/completed runs require a matching assembly job; completed jobs require a typed immutable manifest and verified outputs; active jobs require full live lease data; failed terminal states require a reason; subtitle cues require a style and matching cue hash; optional audio requires its complete executed timing provenance. New acceptance records cannot exploit historical optional defaults. Unknown execution metadata remains unknown, never copied from declarations into measured/verified fields.

## 7. Failure coverage and consumer witnesses

Each failure asserts an established typed error/HTTP status plus database row/state and downstream call counts. An admission failure means zero render work admitted; a worker preflight failure means zero conditioning uploads/provider submissions; output failures occur after simulated rendering but before successful completion/acceptance. Assembly admission failures mean zero enqueue; source/preflight failures mean zero encoding; output/publication failures mean no completed playable reel. Startup FFmpeg version probes are distinct from job encodes.

| Witness / counterexample | Required executable proof |
| --- | --- |
| #445/#424 exact source | canonical source 243f/362f digests and notes round trip; test-only signed envelope trusted only in isolated reader; missing/corrupt evidence/signature and unknown/fail rows deny; historical 362f NO_GO never becomes release-eligible |
| Planning (#426) | real create and preview/commit 243f staging allocation succeed; test-released capability also replans; forged supplied selections/grants, revoked authority, infeasible counts, stale revisions and 362f scene_ceiling deny without writes/jobs |
| Render (#425) | real staging use case and executor preserve inspection → payload → connected workflow → manifest identity; off-grid/unsupported frames, wrong engine/route/geometry/fps/profile, wrong hashes/packages/schedules/runner/custom nodes/workflow, unknown backend or silent fallback deny at the appropriate boundary |
| Positive acceptance (AC-2/COMMENT-1) | mandatory two-scene 243f Ref2V campaign reaches real render and assembly workers, persists typed completion and returns hash-verified reel; license routing resolves underlying Ref2V model without licensing dynamic candidate keys |
| Provenance (AC-1) | individually mutate every stem lineage/frame/fps/profile/digest/revision/owner/run/realm/origin field and reject at accept, enqueue and pre-encode recheck; no wrong stem accepted/assembled |
| Replay/failure | concurrent identical begin action yields one run/job per scene; changed payload conflicts; old/replaced/expired lease cannot complete/fail current work; failure settles run and job atomically; upload/DB crash and identical completion replay reconcile one manifest |
| Reel contract | all five union states parse; missing conditional fields fail; namespace/cross-tenant/manifest/media corruption returns unavailable without URL; nested assembly/audio execution provenance round trips losslessly |
| Legacy/public isolation (AC-3) | both historical certified 124f routes and mixed legacy assembly reach normal delivery; old ShotPlan/GenerationManifest documents still read; candidate UI lengths/keys and acceptance media cannot enter public production before #428 |
| Operator handoff (AC-4/#428) | docs accurately state #445 closed and rough-draft scope, 243f admissibility/362f ceiling, #427 simulation evidence limits and remaining #428 real-host/soak/promotion/deployment requirements |

Extend existing unit and integration tests rather than duplicating their internals. Include wrong actual frames/fps/geometry, missing/corrupt output, configured/probed discrepancy, no eligible duration capability, stale inspector/reference fingerprints, allocation/run/source/output timing mismatch and retry/new-attempt distinction. Mixed candidate routes or durations are positive only when separately authorized; use mixed legacy I2V/Ref2V as the guaranteed mixed-profile control. Longer total campaign briefs remain available via multiple supported five-second scenes. Test actual public controls and server rejection, not only catalog constants.

## 8. Architecture, requirements ledger and release boundary

Ports/policies/orchestration belong in application; Postgres/S3/FFmpeg adapters in infrastructure; control-api/render-worker compose them; web consumes contracts/presentation-safe types. Preserve ADR 0007: approved ShotPlan plus verified references condition Ref2V; previs is review evidence; explicit approved anchors condition I2V. No test-only HTTP flag, mutable production registry, production test key, or deployment import of simulation helpers.

AC-1 is covered by the denial matrix and transactional fences; AC-2 by the required 243f worker-to-reel lifecycle; AC-3 by five-second/historical regressions; AC-4 by docs/CONTEXT.md, CI coverage documentation and runbook links. REQ-TRAP-1 prohibits generating experimental GPU media, host telemetry or human quality approvals. COMMENT-1 is closed only by worker-driven terminal persistence and authenticated readback.

For ledger completeness: CONSUMER-421-AC-1 (#422) is harness context with independent tracker reconciliation, not a task to close it. AC-2 (#423) retains unresolved creative/route qualification; CI does not resolve it. AC-3–6 (#441–#444) supply profiling/variant interfaces and operator-scoped exclusions; this issue tests immutable tuple handling without executing those studies. AC-7 (#445) is the completed rough-draft optimization gate, with attention/combination exclusions preserved. AC-8–10 (#424–#426) are consumed through trusted registry, execution and authenticated planning contracts, with narrow repairs described here. AC-11 is this issue's mandatory software coverage. AC-12 (#428) consumes these lossless contracts but owns real 4090 application runs, repeated-run quality/soak/delivery validation, authentic promotion signing and deployment/public enablement. AC-13 (#467 TeaCache) and AC-14 (#468 FastH3-Omni) remain separate experimental work; neither is implied eligible by this Ref2V recipe or added as a prerequisite. Do not claim those downstream execution deliverables or phase sign-offs from this PR.

Document #445 closure and exact source matrix, not a missing-matrix blocker. #427 completion requires both lifecycles, every executable denial/lease/replay/read contract witness, legacy reads/public isolation, and required validation. It does not require new operator artifacts or #428 sign-off; it cannot claim or grant #428 production release.

Implementation plan:
# Implementation plan: #427 corrected architecture

## Planning boundary and execution order

This package changes result.json only. All source, migration, fixture, documentation and test work below is future implementation. Do not switch branches. Follow the dependency order below; complete focused checks before broad validation. Tests must be collected by existing suites. No implementation task may output certification/, baseline/ or config/render-profiles/ artifacts.

## 1. Fast-forward the prerequisite base and construct authoritative fixture support

Before source edits, run `git status --short`, verify a clean implementation worktree, and run `git merge --ff-only a4622d9` on the current branch. Verify HEAD contains c7ab353, accde6a and be354b3. This is the merged PR #489/#490 base on origin/release/2026-10-23-release-2026-10-23-batch-425-426-427, not an unverified future prerequisite. If unrelated edits prevent fast-forwarding, preserve them and report the concrete conflict rather than reset or duplicate upstream code.

Inventory the merged contracts/ports/bootstrap and existing candidate executor/lifecycle, trusted-reader, duration, acceptance-run, review, assembly and delivery tests. Read AGENTS.md, docs/CONTEXT.md, ADRs 0001/0005/0007/0008 and .ai-orchestrator.json. Use local configuration only.

Create isolated support under tests/fixtures/h3-variable-duration and the focused integration harness. Import the operator-published matrix from #425 comment IC_kwDOT44Drc8AAAABfE863w, https://github.com/opsclawd/comfy-content-orchestrator/issues/425#issuecomment-6380534495. #445 is closed; no missing-file/missing-acceptance escape hatch or skipped positive test is permitted. Preserve the raw source rows/notes, source comment and content digest independently of test envelopes.

Use matrixId h3-capability-matrix-ref2va-turbo-4-2026-10-24. Required positive: 243f/24fps = 10,125ms, ref2v/reference_directed, 1344x768, res_multistep/simple, 4 steps, cfg/denoise 1, comfy_native, no sparse/custom attention, dynamicvram-offload-v1. Boundary: 362f/24fps = 15,083.333…ms, same route/recipe, rejected by the exact 15,000ms scene ceiling. Source workflow hashes are e6084e4f9004a591291f94c24998d10f2b6c7e687bab375ef8e3af8b29bb6e4a and 6cedefbd4bc0bc26c60826d29cdb4c63b5e11b5ee2fdf9e5d89e02aaca6a0c85; source specification digests are da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7 and 3d9a04081e1aee13dc08df76720ff5576b1c5bc04c047b2752e8af56d1637ddd respectively.

Embed the complete source specification, including these SHA-256 values: checkpoint 9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779; clip 35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6; audioVae 8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48; videoVae 52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e; turboLora 5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c; additionalModels {}. Preserve torch 2.13.0+cu130, core 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc, expectedPythonExecutable /home/gpoontip/ComfyUI/venv/bin/python, host llama and GPU UUID GPU-89a53488-359c-4942-75ae-47ee8aa89f53 as source facts. Preserve all runner/attention settings listed in the design and full source notes/evidence digests, not only this summary.

Write connected ref2va-turbo-4 workflow JSON to a temporary worker-readable path. Compute hashWorkflow(rawWorkflow), assign the identical hash to candidate.specification.workflowHash and candidateProvenanceReport.workflow.sha256, then computeH3CandidateSpecificationDigest(specification) and derive its key before signing. If reconstructing the exact source graph, assert published hashes/digests. If using a minimal simulation graph, retain the original rows unchanged and explicitly record source-to-derived workflow/specification/key mapping; never reuse an original digest for changed graph bytes or attribute the derivative to operator signing. Keep the accepted execution tuple intact. Both source identity and derived execution hash assertions are mandatory.

Generate ephemeral Ed25519 keys and sign canonical envelopes/grants inside the test with the real signing/verification path. The source explicitly has a placeholder signature identity; test signatures provide isolated staging authority only. Add deterministic planning responses, neutral CPU exact-frame clip generators, simulated runtime observations and fake transport counters. Add distinct unknown/fail rows and historical 362f NO_GO fixture; do not mutate the later pass row into a historical decision. Prove deep freezing, no global catalog mutation/export, and no deployment trust/import leakage.

Validation: `pnpm vitest run packages/contracts/src/h3-candidate-profile.test.ts packages/contracts/src/h3-capability-decision.test.ts packages/infrastructure/src/comfyui/provenance/h3-trusted-candidate-registry-reader.test.ts`. Add fixture-specific tests to these or automatically collected focused test files. Verify source canonical digests and changed-graph hash failures rather than stubbing hashing.

## 2. Repair planning authorization and replan capability wiring

In packages/application/src/use-cases/create-campaign-shell.ts, authenticate supplied executionProfileSelection and all allowedProfileSelections through resolveSelection(profileKey); compare every supplied kind/specification/grant/release/certification/deployment identity to the resolved authority. Use resolved selections for persistence and fingerprints. Validate conflicting key/object forms, principal, realm/scope and selected/allowed membership. A forged object, stale grant or release outage affecting this request must fail before writes/enqueue.

In replan-campaign.ts, add registryReader/stagingAuthSource/productionReleaseReader and authenticated principal dependencies to both preview and commit, wire them in apps/control-api/src/bootstrap.ts, and build/pass the authenticated capability map to planFeasibleCampaignDuration. Resolve newly added keys and revalidate existing selections instead of trusting stored grants. Share the smallest appropriate authority-resolution helper with creation. Preserve independent legacy-only planning during unrelated authority outages.

Add tests for successful 243f staging create/preview/commit with revisioned duration plan/bindings; test-released production profile replan; read-only preview; stale revision/fingerprint rollback; new unauthorized key and forged direct-object forms; revoked/expired/wrong-principal grants and altered digests; 362f scene_ceiling and infeasible scene counts. Assert requested 20,000ms versus nominal 20,250ms explicitly for the two-scene case. No candidate can enter production scope without the separate release authority.

Validation: `pnpm vitest run packages/application/src/use-cases/create-campaign-shell.test.ts packages/application/src/use-cases/replan-campaign.test.ts` plus the merged duration-feasibility tests using their actual filenames; API composition integration checks with `--config vitest.integration.config.ts`. Run `pnpm boundaries` after dependency wiring.

## 3. Close typed acceptance provenance, receipts and terminal state persistence

In contracts/operator-acceptance.ts and application ports, add missing immutable scene/selection/plan digest linkage and a typed acceptance lineage representation. Extend VideoStemSourceRecord, component identity projection where needed, and PostgresGenerationManifestRepository to expose exact renderProfile/candidateProfileKey, candidateSpecificationDigest, specRevision, job/scene identity, measuredMedia/configured identity, scope/owner/run/realm/evidence origin and checksum-bearing output references. Keep database payloads, mappers, in-memory test repositories and exported types aligned. New candidate acceptance requires these fields; legacy parse defaults cannot authorize it.

Implement shared validation used by AcceptOperatorAcceptanceSceneUseCase, AssembleOperatorAcceptanceRunUseCase and worker preflight. Compare scene.frames/allocatedFrames and fps exactly to measured frameCount/fps; profile key, candidate digest, revision and geometry to immutable run-scene/specification; ownerKind staging_acceptance, executionScope staging, acceptanceRunId and realm/evidenceOrigin to the run; attempt/run/scene/ordinal and completed job to the accepted lineage; output checksum and duration to the immutable manifest and allocation. Validate current persisted scene revision and ShotPlan/fingerprint fences again. Enqueue only all accepted current stems, in canonical order, with run/allocation/stem totals consistent.

Make BeginOperatorAcceptanceRunUseCase actionId idempotent with canonical request hash, unique transactional receipt and stable result identities; cover concurrent replay and crash/retry around dispatch using existing durable receipt patterns and deterministic stage request identity. Same key/different payload yields 409. Apply receipt/conflict rules to scene acceptance/rerender/assembly request and completion. Preserve one infrastructure-retry attempt and distinguish a new creative attempt.

Add AcceptanceAssemblyManifest Postgres persistence and UnitOfWork participation. Add incremental migration(s) after the merged latest migration for missing digest/lineage/receipt fields, uniqueness and referential guarantees; never edit migration 031. Required job/run terminal settlement is one transaction, including terminal failure of both records. Define lease predicates using DB time, state, worker and token; add start/heartbeat/reclaim as needed, including expired rendering jobs. Store canonical completion identity for safe terminal replay and conflict rejection.

Tighten AcceptanceAssemblyManifestSchema.manifest to AssemblyManifestSchema. Add AcceptanceRunReelReadModelSchema discriminated states pending/assembling/completed/failed/unavailable with required fields and prohibited playable fields as defined in the design. Add schema refinements for related identities, active leases, completed manifest links, accepted attempt triples and failure reasons; apply cross-record checks in transactions. Persist realm/origin and immutable manifest storage reference/digest. Preserve all assembly execution metadata through adapters.

Validation: extend operator-acceptance-run.test.ts and contract tests with one mutation per provenance field and schema conditional. Add `packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-lifecycle.integration.test.ts` for projections, atomic receipts/settlement, rollback, concurrent begin/claims, expired/replaced leases and replay. Run `pnpm vitest run --config vitest.integration.config.ts packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-lifecycle.integration.test.ts`. Never invoke an integration file with the default config.

## 4. Compose acceptance assembly worker, route-aware licensing and verified readback

Add AcceptanceDeliveryAssemblyWorker in render-worker using existing delivery worker polling/heartbeat/settlement primitives and a typed acceptance client. Add authenticated control-api claim/start/heartbeat/complete/fail operations under the acceptance worker namespace, with real application use cases and active lease checks. An HTTP caller cannot choose an isolated realm or gain authority via a bucket parameter. Deployments reject simulated inputs; only the harness constructs the isolated simulation composition.

Repair AssembleDeliveryReel component resolution or an equivalent shared validated resolver: after verifying acceptance run/manifest identity, map candidate i2v/frame_anchored to MINIMAX_H3_720P_5S_I2V_V1 and ref2v/reference_directed to MINIMAX_H3_720P_5S_REF2V_V1 (version 1) for acceptance assembly targeting BUCKETS.CANDIDATES. Resolve route from verified specification/manifest provenance, never the key prefix alone. Preserve all other applicable model/LoRA/node/runtime license checks. BUCKETS.DELIVERY rejects any candidate/staging/simulated source before encoding. Test actual EnforceLicenseRouting, not a permissive mock: positive candidate Ref2V assembly no longer throws unknown_component; unknown routes/components and blocked candidate-specific dependencies still deny. Do not globally register H3_CANDIDATE_* as licensed components.

Use real pinned FFmpeg assembly and probe, preserving source stem checksums/order and configured versus measured encoding metadata. Publish media and typed manifest under acceptance-runs/<acceptanceRunId>/ in BUCKETS.CANDIDATES, then transactionally persist manifest and mark job/run completed. Terminal worker failure atomically marks job and run failed; retryable errors follow retry policy without duplicate logical jobs. Inject failed upload, lost completion response and transaction failure to verify no false completion and checksum-safe deterministic reconciliation.

Implement ResolveOperatorAcceptanceReelUseCase and authenticated run-scoped GET. Validate client/run access, matching canonical run/job/typed manifest, strict candidates bucket/prefix, both stored objects' existence and actual SHA-256, and equality between persisted and stored manifest identity before presigning. Return the exhaustive union states; corrupt/missing/cross-run artifacts are unavailable, never playable completed. Ordinary campaign delivery queries must not return this reel.

Validation: focused assembly/license/worker/read-use-case tests; persistence tests from Step 3; API integration cases with `--config vitest.integration.config.ts`. Add lossless manifest schema/storage/read-model round trips with no audio and with audio trim/full+partial loop/padding, subtitle style/hash, timeline and encoding/measured streams. Assert unsupported video range/loop input rejects instead of being silently dropped. Run relevant `pnpm test:assembly` tests and `pnpm boundaries`.

## 5. Automate the connected 243f acceptance lifecycle and all negative boundaries

Create tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts and a narrow harness using real Testcontainers Postgres/MinIO, migrations, HTTP servers, queues and composed workers. Deterministically clean up workers, timers, pools, storage, temporary media and containers. Require pinned FFmpeg and Docker; fail clearly on missing prerequisites instead of silently skipping or using a live GPU.

One mandatory connected scenario must:

1. Create a staging-scoped campaign through real authenticated HTTP/application admission using the source-backed 243f Ref2V fixture, requesting 20,000ms/two scenes. Assert requested and nominal allocations, bindings, authority and immutable plan identities. Preview and commit an authorized replan before approval and assert revisions/bindings; do not seed preapproved scenes.
2. Materialize story/beats, generate at least two ShotPlan variants and pipeline-associated previs using deterministic model/provider boundaries, select and approve the intended current plan through review commands, and inspect production inputs. Assert beat bounds, reference hashes, profile/spec/duration/fingerprint identity, and that unselected/previs pixels are not Ref2V authority.
3. Begin the acceptance run with the real StageH3CandidateRenderUseCase/trusted matrix/grant verification. Claim/start through the composed staging worker policy. Execute real executeRenderJob with fake ComfyUI/runtime observations and exact-frame CPU clips from Step 1. Verify workflow file hashing and graph/runtime consistency remain active.
4. Complete through worker/control API. Inspect persisted generation manifests and attempts and compare requested/declared, configured/executed and independently probed layers without copying one into another. Assert completion alone creates zero assembly jobs.
5. Explicitly accept every current attempt and request assembly; verify immutable lineage, source checksums, canonical scene order and nominal totals. Let AcceptanceDeliveryAssemblyWorker claim/start, encode/probe, upload and complete through the API. The test must never call an internal completion callback to manufacture success.
6. Read the authenticated reel endpoint, fetch media and manifest, verify bytes/checksums/typed manifest/probed timing and completed job/run persistence. Assert isolated realm/simulated_test labeling and absence from ordinary delivery. Remove/corrupt the stored artifacts in separate cases and require unavailable without playback URL.

Add table-driven mutations and targeted integration cases for all design witnesses: off-grid and on-grid-unlisted frames; 362f exact ceiling; wrong profile/engine/route/geometry/fps; no eligible allocation; corrupt/missing evidence/signature; wrong host/grant/realm; forged planning object and broken replan authority; altered model/LoRA/node/package/optimizer/workflow/sampler/step/runner settings; graph/runtime disagreement and silent attention fallback; stale revision/approval/fingerprint/reference; wrong actual frames/duration/output bytes; each stem lineage mismatch; run/stem/allocation/source/output timing conflicts; action replay/conflict, retries/new attempt, lease replacement, worker failure and uncertain publication/completion. Keep historical 362f NO_GO distinct from the later pass recipe and deny release regardless of technical byte conformance.

For each mutation assert typed blocker/HTTP status, persisted rows/states and precise no-side-effect boundary: admission→no jobs; worker preflight→zero uploads/provider submit; post-render invalidity→no successful manifest/acceptance; assembly admission→no enqueue; source timing/license/provenance preflight→zero encode; invalid output/publication→no completed reel. Use deterministic clock/lease controls and bounded worker progress, not fixed sleeps. Do not claim bad output was rejected before rendering.

Validation: `pnpm vitest run --config vitest.integration.config.ts tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` plus the new repository integration file. Target modified candidate unit tests via `pnpm vitest run apps/render-worker/src/h3-candidate-executor.test.ts apps/render-worker/src/h3-candidate-lifecycle.test.ts packages/application/src/use-cases/stage-h3-candidate-render.test.ts packages/application/src/use-cases/operator-acceptance-run.test.ts` and actual added unit paths. Confirm the new E2E file is collected by pnpm test:db.

## 6. Preserve five-second production, historical documents and public visibility

Extend existing lifecycle harnesses with a real certified five-second campaign control through ordinary campaign creation/dispatch, render worker completion, explicit production review acceptance, actual delivery worker assembly completion and normal campaign reel readback. Exercise both I2V and Ref2V and a mixed legacy route reel. Keep 5000ms requested distinct from 124 frames/24fps nominal and probed duration; preserve profile/model/workflow identity and existing quantization/timing tolerances. Reuse final-delivery-reel and production-review-gate tests; retain their existing negative assertions.

Add representative historical ShotPlan/GenerationManifest fixture parse, repository JSON round-trip, inspector/read projection and delivery-read regressions without newly optional duration/realm/candidate fields. Preserve original content and immutable hashes; do not manufacture new verified provenance or bulk-update snapshots. Add mixed candidate combinations only if independently authorized; missing support is a denial, not a reason to enable it. A mixed legacy assembly is always required.

Test actual public campaign/review controls and API submissions: staging-only lengths/keys do not appear as production capability choices before #428; forged candidate production input is rejected; acceptance reels never become public delivery; long campaign totals still allocate into eligible five-second scenes. Extend the existing Playwright campaign scenario only for browser visibility/interaction that component/API tests cannot establish.

Validation: focused contract/domain/web tests and `pnpm vitest run --config vitest.integration.config.ts tests/integration/shot-plan-to-h3-lifecycle.e2e.integration.test.ts tests/integration/production-review-gate.e2e.integration.test.ts tests/integration/final-delivery-reel.e2e.integration.test.ts` plus actual modified repository integration paths. For browser changes run `pnpm --filter e2e test tests/minimax-h3-campaign-execution.spec.ts` with its documented prerequisites.

## 7. Document coverage, ledger reconciliation and remaining operator release

Add docs/h3-variable-duration-ci-coverage.md, link it from docs/h3-acceptance-operator-runbook.md, and update docs/CONTEXT.md. Accurately state PR #489/#490 prerequisite base, #445 closure and its scoped-out attention/combination variants, matrix/source hashes and rough-draft caveats, 243f positive/362f ceiling, and earlier NO_GO sample retention. Distinguish test-signature authority and simulated runtime observations from source operator facts and measured fixture bytes.

Document Docker/Postgres/MinIO and pinned FFmpeg install/check prerequisites, focused commands, temporary media cleanup, typed accepted-reel retrieval/state/integrity behavior, requested/configured/measured semantics and exact frame/fps preservation. Include one requirement-to-executable-test table mapping AC-1–4, COMMENT-1, every negative family and all consumer witnesses to actual test names and side-effect counters. Record the remaining ledger dependencies/context as classified in design Section 8; do not claim unrelated experiments or tracker reconciliation complete.

State #428 alone owns real 4090 application execution, repeated-run quality/operational soak/delivery validation, authentic certification/promotion signatures and deployment/public enablement. #445 rough-draft acceptance is not final certification. #427 tests cannot resolve #423 quality holes, license Ref2V from I2V or vice versa, promote historical NO_GO samples, or authorize TeaCache/FastH3-Omni. Do not fill evidence templates or generate host telemetry, experimental GPU assets or operator sign-offs.

Validation: check documented commands against package scripts and suite include/exclude patterns, source links and exact matrix identities; verify every required witness has an executable test rather than a planned skip. Review docs and contracts for lossless representation and conditional invariants at each boundary.

## 8. Full validation and completion gate

Before media tests verify `./scripts/check-ffmpeg-version.sh`; install with `./scripts/install-ffmpeg.sh` if necessary. Use AGENTS.md install/check scripts for model-backed suite prerequisites. These prepare dependencies, not new model/operator evidence. Record environment failures honestly.

Use the six ordered tiers in .ai-orchestrator.json, running only independent commands within a tier concurrently:

1. `pnpm check:hooks`, `pnpm install --frozen-lockfile`.
2. `pnpm format:fix` alone; review its changes.
3. `pnpm format` alone.
4. `pnpm preValidation`, `pnpm build`.
5. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:bash`, `pnpm boundaries`, `pnpm check:control-plane`.
6. `pnpm test:db`, `pnpm test:assembly`, `pnpm test:kokoro`, `pnpm test:piper`, `pnpm test:ltx-production`, `pnpm test:whisperx`.

Keep new ordinary integration files in the current integration-config include paths; FFmpeg-specialized integration files use test:assembly. Never run *.integration.test.ts through the default unit config. Do not duplicate inherited validation commands or add a suite unless needed; any new command requires complete validation.tiers coverage. Record actual results, collection and blockers rather than treating an environmental failure as passing evidence.

Completion requires all seven architecture findings resolved in code and tests: source-backed mandatory 243f lifecycle; correct a4622d9 base; acceptance-only license mapping plus production rejection; authenticated creation and capability-aware preview/commit; full stem lineage/action receipts; atomic job/run success and failure under valid leases; typed integrity-checked reel contract/readback. Also require legacy mixed-route production delivery, historical reads, public isolation, all listed fail-closed witnesses, accurate operator documentation and passing required gates. AC-2 cannot be left unmet because a matrix was not committed. #428 execution/sign-off and other downstream experiments remain outside this PR.

Accumulated review findings ledger:

```
### UNRESOLVED BLOCKING FINDINGS:
- **[AC-1] [HIGH]** Failed requirement: Every covered failure fails closed before GPU or assembly side effects as appropriate.
  Evidence: operator-acceptance-run.ts:29-106 accepts absent candidate identity and ignores measured fps, geometry, revision, owner/run/realm and timing. acceptance-delivery-assembly-worker.ts does not revalidate stems before encoding. assemble-delivery-reel.ts:198 infers missing candidate route and permits arbitrary non-delivery target buckets. Lease predicates omit expiry.
  Required Fix: Implement requirement to satisfy: Every covered failure fails closed before GPU or assembly side effects as appropriate.
  Source: spec-review (iteration 0)

- **[AC-2] [HIGH]** Failed requirement: One realistic positive application lifecycle is automated without pretending to validate actual GPU execution.
  Evidence: h3-variable-duration-lifecycle.test.ts:191 manually creates scenes, replaces StageH3CandidateRenderUseCase, seeds generation manifests and uses a mock assembler over text buffers. It does not generate/approve ShotPlans, inspect inputs, executeRenderJob, run FFmpeg or traverse worker HTTP completion. No new connected integration lifecycle exists.
  Required Fix: Implement requirement to satisfy: One realistic positive application lifecycle is automated without pretending to validate actual GPU execution.
  Source: spec-review (iteration 0)

- **[AC-3] [HIGH]** Failed requirement: Existing certified five-second flows retain behavior.
  Evidence: The new legacy witness at h3-variable-duration-lifecycle.test.ts:872 only creates an I2V campaign shell and checks 124f planning. It never dispatches either route or assembles a mixed-route production reel. No added historical ShotPlan/GenerationManifest read round-trip witnesses establish the anchored requirement.
  Required Fix: Implement requirement to satisfy: Existing certified five-second flows retain behavior.
  Source: spec-review (iteration 0)

- **[AC-4] [HIGH]** Failed requirement: Docs include prerequisites and clear operator release gate.
  Evidence: docs/h3-variable-duration-ci-coverage.md and the runbook reserve physical certification for #428, but the new coverage document lacks Docker/Postgres/MinIO and pinned FFmpeg setup/check commands and an executable requirement-to-test matrix. It describes saving scenes as ShotPlan approval and seeded stems as full render completion.
  Required Fix: Implement requirement to satisfy: Docs include prerequisites and clear operator release gate.
  Source: spec-review (iteration 0)

- **[AC-5] [HIGH]** Failed requirement: Ports/policies/orchestration belong in application; Postgres/S3/FFmpeg adapters in infrastructure; control-api/render-worker compose them; web consumes contracts/presentation-safe types. Preserve ADR 0007. No test-only HTTP flag, mutable production registry, production test key, or deployment import of simulation helpers.
  Evidence: Basic dependency direction is retained, but packages/infrastructure/src/index.ts:233 exports source-matrix.ts, including simulation constructors, fake runtime observations and test signing helpers, from the deployment barrel. tests/fixtures/h3-variable-duration/source-matrix.ts merely re-exports that production module. Required real ADR-0007 approval/conditioning is bypassed in the lifecycle test.
  Required Fix: Implement requirement to satisfy: Ports/policies/orchestration belong in application; Postgres/S3/FFmpeg adapters in infrastructure; control-api/render-worker compose them; web consumes contracts/presentation-safe types. Preserve ADR 0007. No test-only HTTP flag, mutable production registry, production test key, or deployment import of simulation helpers.
  Source: spec-review (iteration 0)

- **[AC-6] [HIGH]** Failed requirement: AC-1 denial matrix/transactional fences; AC-2 required 243f worker-to-reel lifecycle; AC-3 five-second/historical regressions; AC-4 documentation. COMMENT-1 closes only with worker-driven terminal persistence and authenticated readback.
  Evidence: The new worker and repository provide partial terminal persistence, but there is no deployed acceptance worker composition/transport, authenticated verified reel resolver or real 243f render-to-reel integration. Schemas and transactional receipts leave integrity gaps.
  Required Fix: Implement requirement to satisfy: AC-1 denial matrix/transactional fences; AC-2 required 243f worker-to-reel lifecycle; AC-3 five-second/historical regressions; AC-4 documentation. COMMENT-1 closes only with worker-driven terminal persistence and authenticated readback.
  Source: spec-review (iteration 0)

- **[AC-7] [HIGH]** Failed requirement: Preserve the ledger classification of #422, unresolved #423, #441–#444 interfaces/exclusions, closed rough-draft #445, #424–#426 prerequisites, #427 coverage and #428 release ownership; #467/#468 remain separate and confer no eligibility.
  Evidence: The new docs mention #445/#425 and #428 but omit the required downstream/context reconciliation and operator-scoped attention/combination exclusions. The historical NO_GO fixture incorrectly reuses the later passing Ref2V specification and evidence identity, obscuring the distinct earlier sample/recipe.
  Required Fix: Implement requirement to satisfy: Preserve the ledger classification of #422, unresolved #423, #441–#444 interfaces/exclusions, closed rough-draft #445, #424–#426 prerequisites, #427 coverage and #428 release ownership; #467/#468 remain separate and confer no eligibility.
  Source: spec-review (iteration 0)

- **[AC-8] [HIGH]** Failed requirement: Document #445 closure and exact matrix; require both lifecycles, every denial/lease/replay/read witness, legacy reads/public isolation and validation; do not require or grant #428 release.
  Evidence: HEAD is correctly a4622d9, and source specification digests match. However both complete lifecycles and the required denial/replay/lease/integrity witnesses are absent. The public UI test merely queries a fake release reader hard-coded to return an empty array.
  Required Fix: Implement requirement to satisfy: Document #445 closure and exact matrix; require both lifecycles, every denial/lease/replay/read witness, legacy reads/public isolation and validation; do not require or grant #428 release.
  Source: spec-review (iteration 0)

- **[AC-9] [HIGH]** Failed requirement: Complete reachable acceptance-run → worker → completion → accepted-reel lifecycle, including worker-side completion and persisted artifact readback exercised end to end.
  Evidence: AcceptanceDeliveryAssemblyWorker is instantiated only in tests and exported from index.ts; run-delivery-assembler.ts still composes only DeliveryAssemblyWorker. No acceptance claim/start/heartbeat/complete/fail HTTP transport is added. The sole lifecycle test seeds render outputs and mocks encoding.
  Required Fix: Implement requirement to satisfy: Complete reachable acceptance-run → worker → completion → accepted-reel lifecycle, including worker-side completion and persisted artifact readback exercised end to end.
  Source: spec-review (iteration 0)

- **[AC-10] [HIGH]** Failed requirement: #423 — operator-only, incomplete creative/route qualification; operator evidence is not a replacement for optimization gate #445.
  Evidence: The required historical NO_GO distinction is not preserved: source-matrix.ts:174 assigns SOURCE_SPEC_362F, SPEC_DIGEST_362F and the later pass row's evidence digest to the earlier NO_GO fixture. The runbook identifies the earlier rejected sample as an unoptimized I2V variant, whereas this fixture uses the later Ref2V turbo recipe.
  Required Fix: Implement requirement to satisfy: #423 — operator-only, incomplete creative/route qualification; operator evidence is not a replacement for optimization gate #445.
  Source: spec-review (iteration 0)

- **[AC-11] [HIGH]** Failed requirement: #445 — operator optimization gate for exact route-specific speed/quality combinations, preserving explicit exclusions.
  Evidence: Canonical 243f/362f specification digests pass fixture tests, but source-matrix.ts substitutes abbreviated notes and constructed metadata without retaining a lossless source envelope/content digest. Its derived graph has no turbo LoRA, sampler or VAE decode nodes, and it is never consumed by executeRenderJob. It therefore does not exercise the exact accepted execution combination.
  Required Fix: Implement requirement to satisfy: #445 — operator optimization gate for exact route-specific speed/quality combinations, preserving explicit exclusions.
  Source: spec-review (iteration 0)

- **[AC-12] [HIGH]** Failed requirement: #424 — immutable versioned evidence-backed eligible profiles conditional on exact #445 GO.
  Evidence: H3TrustedCandidateRegistryReader and canonical specification hashing are reused, but simulation helpers are production exports and SOURCE_SPEC/SOURCE_ROW freezing is shallow. Source envelope authenticity and lossless source metadata are not retained; source-to-derived mapping lacks the exact graph transformation.
  Required Fix: Implement requirement to satisfy: #424 — immutable versioned evidence-backed eligible profiles conditional on exact #445 GO.
  Source: spec-review (iteration 0)

- **[AC-13] [HIGH]** Failed requirement: #425 — profile-scoped duration mapping, admission, execution, measured media and provenance.
  Evidence: The lifecycle bypasses real staging/executor/measurement. PostgresGenerationManifestRepository reads candidate digest only from a top-level payload field, guesses route from profile names and does not expose the candidate specification to assembly. AssembleDeliveryReel defaults missing route to I2V, and stem validation ignores measured fps/geometry and immutable run identity.
  Required Fix: Implement requirement to satisfy: #425 — profile-scoped duration mapping, admission, execution, measured media and provenance.
  Source: spec-review (iteration 0)

- **[AC-14] [HIGH]** Failed requirement: #426 — planning/ShotPlan/Review Hub use only eligible duration capabilities.
  Evidence: ProfileSelectionResolver improves supplied-object authority comparison and replan capability maps, but verifyScopeAndRealm ignores realm and only checks selected staging-vs-production. CreateCampaignShell does not reject conflicting supplied selection/key aliases. Public controls and released-production replan are not exercised.
  Required Fix: Implement requirement to satisfy: #426 — planning/ShotPlan/Review Hub use only eligible duration capabilities.
  Source: spec-review (iteration 0)

- **[AC-15] [HIGH]** Failed requirement: #427 — simulated E2E, fail-closed and historical five-second regressions after #424–#426.
  Evidence: Missing real 243f connected lifecycle, legacy mixed-route production control, historical read witnesses, full denial matrix and durable lease/replay/readback safeguards are blocking current-issue deliverables.
  Required Fix: Implement requirement to satisfy: #427 — simulated E2E, fail-closed and historical five-second regressions after #424–#426.
  Source: spec-review (iteration 0)

- **[AC-16] [HIGH]** Failed requirement: #428 — real application runs, repeated-run quality, operational soak and delivery release gate consuming #427 contracts.
  Evidence: No downstream GPU/sign-off is required now, but downstream handoff contracts are incomplete: AcceptanceAssemblyManifestSchema permits arbitrary records; reel states omit realm/evidenceOrigin/updatedAt; completed manifests/URLs are optional; manifest object reference/digest and immutable allocation/attempt lineage are missing. Readback does not verify canonical job/output identities or artifact bytes.
  Required Fix: Implement requirement to satisfy: #428 — real application runs, repeated-run quality, operational soak and delivery release gate consuming #427 contracts.
  Source: spec-review (iteration 0)

- **[F-b4ff8304] [HIGH]** AC-2 and COMMENT-1 explicitly prohibit seeded completion and require reachable real render and assembly worker completion plus authenticated persisted readback. Exporting a class does not create a supported runtime success path. The test never exercises ShotPlan variants/previs approval, inspection, executeRenderJob, Postgres/MinIO, pinned FFmpeg, byte probes or worker HTTP completion.
  Files: apps/render-worker/src/h3-variable-duration-lifecycle.test.ts, apps/render-worker/src/acceptance-delivery-assembly-worker.ts, apps/render-worker/src/cli/run-delivery-assembler.ts, apps/control-api/src/http/routes/duration-planning-routes.ts
  Evidence: The positive test at line 191 manually saves scenes, replaces StageH3CandidateRenderUseCase with a vi.fn, seeds VideoStemSourceRecord with claimed measurements, and supplies a mock MediaAssemblerPort returning text buffers. Repository search finds no non-test instantiation of AcceptanceDeliveryAssemblyWorker. The deployed assembler CLI constructs DeliveryAssemblyWorker only; no acceptance worker claim/start/heartbeat/completion/failure routes/client are added.
  Required Fix: Compose the acceptance worker and typed control-API transport in the supported runtime; add the required two-scene 243f Postgres/MinIO integration lifecycle using real planning/review/staging/executor/assembly code and independently probed CPU fixture clips. Replace only authorized external boundaries.
  Source: spec-review (iteration 0)

- **[F-1eb05544] [CRITICAL]** A stem with missing candidate digest/ownership and correct frameCount can be accepted even with wrong measured cadence, another run's media or a stale SceneSpec revision. An omitted checksum list disables output provenance checking. Drift after enqueue is never fenced before encoding. This violates the mandatory fail-closed acceptance/assembly policy and exact-frame/authority invariants.
  Files: packages/application/src/use-cases/operator-acceptance-run.ts, packages/application/src/ports/generation-manifest-repository.ts, packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts, apps/render-worker/src/acceptance-delivery-assembly-worker.ts
  Evidence: validateAcceptanceStemSource at lines 29-106 compares profile, scene and digest only if supplied. It requires frameCount but never compares measuredMedia.fps, geometry, source timing, specRevision, job/attempt ordinal, acceptanceRunId, realm, evidenceOrigin or ownerKind. Output membership is checked only for a nonempty checksum array. The worker directly encodes job.assemblySpec without invoking this policy or rereading accepted current stems.
  Required Fix: Require all candidate-only lineage fields, resolve canonical current job/attempt/scene/plan and compare exact configured/measured frames/fps/geometry plus timing/checksums. Use the same full policy at acceptance, enqueue and worker preflight, rejecting missing or contradictory projections.
  Source: spec-review (iteration 0)

- **[F-784a4f7a] [CRITICAL]** Knowing another run ID permits reaching its read model and presigning its stored location without operator/client/run authorization. A cross-run or foreign-bucket reference can become playable. Network placement and an optional session-population hook do not implement the explicitly required access and namespace checks.
  Files: apps/control-api/src/http/routes/duration-planning-routes.ts, packages/application/src/use-cases/resolve-operator-acceptance-reel.ts
  Evidence: The new GET handler calls the resolver with acceptanceRunId alone and never resolves reviewer/client identity or authorizes campaign access. ResolveOperatorAcceptanceReelParams has no principal. Client-session middleware only populates context and does not reject unauthenticated requests. The resolver then presigns the record's bucket/key without a candidates-bucket or acceptance-runs/<runId>/ prefix restriction.
  Required Fix: Require server-authenticated operator/client context, authorize access against the run's campaign, and reject all locations outside BUCKETS.CANDIDATES and the exact run namespace before storage access or presigning. Add unauthenticated and cross-client/run endpoint tests.
  Source: spec-review (iteration 0)

- **[F-998c0323] [HIGH]** Corrupt media with unchanged metadata, manifest substitution/deletion, cross-job manifests and contradictory terminal job/run states can still yield completed/playable output. Synthetic frame counts and fallback dimensions are represented as observed output. acceptance_review is incorrectly mapped to unavailable, and cancellation lacks the required explicit mapping/reason.
  Files: packages/application/src/use-cases/resolve-operator-acceptance-reel.ts, packages/contracts/src/operator-acceptance.ts, packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-manifest-repository.ts
  Evidence: Readback at lines 111-143 prefers headObject and rejects only when an optional checksumSha256 is present and mismatched; absent objectStorage bypasses verification entirely. It never downloads/hashes bytes or reads the stored manifest object. It casts manifestRecord.manifest rather than parsing it, does not join a completed job/outputManifestId, and synthesizes frameCount, default fps/dimensions and even missing attemptId from sceneId.
  Required Fix: Persist distinct media and manifest references/digests, fetch and SHA-256 both actual objects, parse/equate the stored manifest with the canonical typed envelope, verify run/job/output and lineage agreement, and presign only then. Map every run/job state exhaustively and retain measured facts without invented defaults.
  Source: spec-review (iteration 0)

- **[F-1227bb22] [HIGH]** The design requires typed, lossless new acceptance records and conditional invariants; retaining an unrestricted record alternative defeats the schema change. Downstream #428 cannot reconstruct or trust the acceptance execution from these contracts. Typed audio/subtitle/timing round trips are not established by a cast.
  Files: packages/contracts/src/operator-acceptance.ts, packages/infrastructure/migrations/032_acceptance_assembly_lifecycle.sql, apps/render-worker/src/acceptance-delivery-assembly-worker.ts
  Evidence: AcceptanceAssemblyManifestSchema.manifest is z.union([AssemblyManifestSchema, z.record(...)]) so an empty or corrupt record remains valid. Realm, evidenceOrigin, plan and accepted attempts are optional. Reel union members lack common realm/evidenceOrigin/updatedAt and completed manifest/URL are optional. Accepted-attempt triples, active lease tuples, completed manifest linkage and failed reasons have no conditional refinements. The worker never fills planId/acceptedAttemptIds or immutable allocation lineage.
  Required Fix: Require AssemblyManifestSchema for new acceptance envelopes, version any historical read compatibility separately, require full immutable lineage and storage references, and enforce local state invariants plus cross-record transaction checks. Add no-audio and trimmed/partially-looped-audio database/object/API round-trip tests.
  Source: spec-review (iteration 0)

- **[F-e4a1a7c0] [CRITICAL]** A caller-controlled non-delivery target bypasses candidate licensing authority and can license an unknown-route candidate as I2V. With the normal assembler, admission can use a non-delivery target while actual publication still goes to DELIVERY. This violates acceptance-only licensing, all-component checks and strict separation of staging/simulated artifacts from commercial output.
  Files: packages/application/src/use-cases/assemble-delivery-reel.ts, packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts, packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts, apps/render-worker/src/acceptance-delivery-assembly-worker.ts
  Evidence: assemble-delivery-reel.ts:190-218 maps any candidate to a legacy component for every targetBucket other than BUCKETS.DELIVERY. Missing route falls back to a profile substring or I2V, without a trusted specification or run authorization. The repository does not return candidateSpecificationDigest from getComponentIdentityById. Only the underlying model is added, not candidate-specific model/LoRA/node/runtime components. The worker requests BUCKETS.REVIEW; targetBucket is not passed to mediaAssembler.assemble, whose output bucket remains constructor-configured (default DELIVERY).
  Required Fix: Require a validated acceptance-run context and immutable candidate specification; resolve route only from that specification and evaluate every applicable component. Use an acceptance-specific assembler/publication namespace bound to BUCKETS.CANDIDATES and acceptance-runs/<runId>/, and verify actual output destination. Reject candidate/staging/simulated stems in production regardless of profile-name heuristics.
  Source: spec-review (iteration 0)

- **[F-f1b5de2c] [HIGH]** An expired rendering worker can settle a job, crashed rendering work cannot be reclaimed, and transient transport failures falsely fail the run. Lost completion responses cannot reconcile deterministically. Although job/run writes share a UnitOfWork, updates do not verify the run is assembling with the matching job, and this is not the required fenced, replay-safe terminal protocol.
  Files: packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts, apps/render-worker/src/acceptance-delivery-assembly-worker.ts
  Evidence: claim reclaims only expired leased jobs, not expired rendering jobs, and computes expiry using application time. start/heartbeat/complete never require lease_expires_at > NOW() or worker identity; fail also omits active status. The worker has no heartbeat/retry loop, creates random completion manifest IDs and treats every caught transport/publication/DB error as terminal failure. Complete clears the token, so identical terminal replay is rejected rather than returning a receipt.
  Required Fix: Use authoritative DB time, active-state/owner/token/expiry predicates, reclaim expired active work, heartbeat while encoding, and durable checksum-bound completion receipts. Retry transient failures under the same logical identity and atomically settle only the matching run/job, with integration tests for expiry, replacement, lost responses and upload/transaction faults.
  Source: spec-review (iteration 0)

- **[F-82236872] [HIGH]** Sequential replay tests do not guarantee concurrent idempotency. Reusing actionId after replanning also returns the old result without detecting changed canonical intent. The design requires one durable logical dispatch, canonical authority binding, concurrent conflict handling and completion/rerender semantics.
  Files: packages/application/src/use-cases/operator-acceptance-run.ts, packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts, packages/infrastructure/migrations/032_acceptance_assembly_lifecycle.sql
  Evidence: Begin reads the campaign without a lock, checks for a receipt, creates random run/job request identities, stages all scenes, then inserts the receipt. saveActionReceipt uses ON CONFLICT DO NOTHING without comparing the existing hash/result. Two concurrent transactions can both miss the receipt and commit different runs/jobs; the loser silently discards its receipt. Begin hash binds only campaign/action/requestedBy, not plan/bindings/revisions/realm/selections. No rerender/completion receipt implementation is added.
  Required Fix: Reserve a uniquely scoped canonical receipt under transactional serialization before staging, bind authenticated principal and immutable plan/selection/revision identities, and use deterministic dispatch identities or a durable outbox. On conflict load/compare the winning receipt and return its result or typed 409. Add concurrent Postgres, replan-under-same-action and crash/retry witnesses.
  Source: spec-review (iteration 0)

- **[F-0492aaff] [HIGH]** Matching canonical hashes of synthetic objects does not prove the worker consumes the accepted optimizer/model tuple. Historical sample rejection must remain distinct from a later passing recipe, and test-authority constructors must not be production exports. This undermines source fidelity and authority separation without changing an actual governance registry.
  Files: packages/infrastructure/src/comfyui/provenance/source-matrix.ts, packages/infrastructure/src/index.ts, tests/fixtures/h3-variable-duration/source-matrix.ts, packages/infrastructure/src/comfyui/provenance/h3-variable-duration-fixtures.test.ts
  Evidence: The deployment barrel exports all simulation signing/runtime helpers; the test fixture is only a re-export. Object.freeze is shallow. The derived six-node graph lacks turbo LoRA, independent sampler/scheduler execution, VAE decode and the production reference topology, while claiming the full accepted tuple in its specification/report. It is not executed by the lifecycle test. The historical NO_GO row reuses the later pass row's SOURCE_SPEC_362F, digest and evidence. Lossless raw source envelope/content digest and exact transformation metadata are absent.
  Required Fix: Move all helpers into test-only fixtures; retain lossless source rows/envelope metadata and a separate original NO_GO sample identity; deep-freeze fixtures. Build a valid connected derivative preserving the complete accepted tuple/topology, record its exact transformation and feed its bytes through the real worker hash/preflight path.
  Source: spec-review (iteration 0)

- **[F-0b0051af] [HIGH]** Issue #427 is a coverage deliverable. These tests and documentation claim behavior that they do not execute. Existing tests and the supplied passing fingerprint do not satisfy specifically required connected positive/negative, historical compatibility and public-control proofs. The production release reservation is correctly stated but the handoff is incomplete.
  Files: apps/render-worker/src/h3-variable-duration-lifecycle.test.ts, docs/h3-variable-duration-ci-coverage.md, docs/CONTEXT.md, docs/h3-acceptance-operator-runbook.md
  Evidence: The five-second regression only checks one I2V shell; the public UI witness queries a fake reader returning []. The off-grid witness only checks Number.isInteger and the NO_GO witness only checks fixture strings. There are no new real mixed-route legacy delivery/historical read integration witnesses. Documentation calls scene insertion ShotPlan approval and seeded stems full render completion; it omits CI dependency install/check instructions, executable coverage mapping and required consumer/exclusion handoff.
  Required Fix: Add the real legacy I2V/Ref2V mixed production lifecycle, historical read round trips, actual public controls/server rejection and complete denial matrix with typed errors/state/side-effect counters. Document only proven coverage, prerequisites/focused commands, #445 closure/rough-draft exclusions and the complete #428 boundary.
  Source: spec-review (iteration 0)

- **[F-ef26656e] [HIGH]** Any unauthenticated caller can query the acceptance reel endpoint and obtain presigned URLs. Tampered or cross-namespace `storageBucket`/`storageKey` values are presigned without isolation checks, objects lacking header checksum metadata bypass SHA-256 verification, and corrupt/untyped manifests or failed URL presigning still produce a `completed` response.
  Files: apps/control-api/src/http/routes/duration-planning-routes.ts, packages/application/src/use-cases/resolve-operator-acceptance-reel.ts, packages/contracts/src/operator-acceptance.ts
  Evidence: 1. `GET /api/operator-acceptance/runs/:acceptanceRunId/reel` (`apps/control-api/src/http/routes/duration-planning-routes.ts` lines 293-308) omits `getReviewerIdentity(request)` and `checkReviewerAuthorization(reviewerName)`, whereas routes 5-8 in the same file enforce reviewer authentication/authorization.
2. `ResolveOperatorAcceptanceReelUseCase` (`packages/application/src/use-cases/resolve-operator-acceptance-reel.ts` lines 84-206) treats `objectStorage` and `mediaDelivery` as optional, returning `status: "completed"` even when `objectStorage` is undefined or `generatePresignedReadUrl` fails (`url: undefined`).
3. Lines 114-142 call `headObject` first and only check `if (obj.checksumSha256 && obj.checksumSha256 !== expectedSha256)`, skipping SHA-256 verification whenever `headObject` returns `checksumSha256: undefined`.
4. Bucket and key namespace prefixes are never validated before presigning, `manifestRecord.manifest` is not validated as a typed `AssemblyManifest` (`AcceptanceAssemblyManifestSchema.manifest` allows `z.record(z.string(), z.unknown())`), and contradictory `acceptanceAssemblyJobs` states are not checked when `run.status === "completed"`.
  Required Fix: Enforce `getReviewerIdentity` and `checkReviewerAuthorization` on `GET /api/operator-acceptance/runs/:acceptanceRunId/reel`; tighten `AcceptanceAssemblyManifestSchema.manifest` to `AssemblyManifestSchema`; and in `ResolveOperatorAcceptanceReelUseCase`, require configured `objectStorage` and `mediaDelivery`, verify run/job/manifest identity and `acceptance-runs/<acceptanceRunId>/` bucket/key isolation, verify actual object SHA-256 bytes when `checksumSha256` is absent on `headObject`, and return `unavailable` whenever verification or presigning fails.
  Source: quality-review (iteration 0)

- **[F-d621c1a7] [HIGH]** Missing provenance fields fail open during scene acceptance and assembly admission. Because `AssembleGenerationManifestUseCase` writes `frameCount` (not `frames`), `findVideoStemSourceByJobId` copies `measuredMedia.frameCount` into `stemSource.frames`, preventing detection of declared-vs-measured frame discrepancies. Stems from production scope, different acceptance runs, different realms, or stale `specRevision`s are accepted without error.
  Files: packages/application/src/use-cases/operator-acceptance-run.ts, packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
  Evidence: In `packages/application/src/use-cases/operator-acceptance-run.ts` (lines 29-103), `validateAcceptanceStemSource` guards checks with truthiness conditions (`if (stemSource.renderProfile && ...)`, `if (stemSource.frames !== undefined && ...)`, `if (stemSource.fps !== undefined && ...)`, `if (stemSource.sceneId && ...)`, `if (scene.candidateSpecificationDigest && stemSource.candidateSpecificationDigest && ...)`, `if (stemSource.outputChecksumsSha256 && stemSource.outputChecksumsSha256.length > 0 && ...)`). It never checks `stemSource.measuredMedia.fps`, `stemSource.specRevision === scene.specRevision`, `stemSource.executionScope === "staging"`, `stemSource.ownerKind === "staging_acceptance"`, `stemSource.acceptanceRunId === scene.acceptanceRunId`, or `realm`/`evidenceOrigin`. In `packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts` (lines 170-191), `findVideoStemSourceByJobId` reads `payload?.frames` instead of `payload?.frameCount` (falling back to `measuredMedia?.frameCount`) and swallows `decodeGenerationManifestOutputs` errors (`catch { // ignore }`).
  Required Fix: Make all candidate provenance fields mandatory in `validateAcceptanceStemSource` (including `renderProfile`, `candidateSpecificationDigest`, `specRevision`, `sceneId`, `frames`, `fps`, `measuredMedia.fps`, `executionScope === "staging"`, `ownerKind === "staging_acceptance"`, `acceptanceRunId`, `realm`, `evidenceOrigin`, and non-empty `outputChecksumsSha256`), read `payload.frameCount` in `PostgresGenerationManifestRepository.findVideoStemSourceByJobId`, and invoke stem validation in worker preflight before encoding.
  Source: quality-review (iteration 0)

- **[F-652c099c] [HIGH]** Concurrent identical `begin` requests both see no existing receipt, generate distinct `acceptanceRunId`s, dispatch duplicate staging render jobs, create duplicate `operator_acceptance_runs` rows, and silently ignore the receipt conflict via `ON CONFLICT DO NOTHING` (even if `request_hash` differs). When `OperatorAcceptanceIdempotencyConflictError` is thrown over HTTP, `formatReviewError` omits `code: "IDEMPOTENCY_CONFLICT"`.
  Files: packages/application/src/use-cases/operator-acceptance-run.ts, packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts, apps/control-api/src/http/errors.ts
  Evidence: In `BeginOperatorAcceptanceRunUseCase.execute` (`packages/application/src/use-cases/operator-acceptance-run.ts` lines 136-297), `findActionReceipt` runs without locking, a fresh `acceptanceRunId = randomUUID()` is generated on line 174, `stageRenderUseCase.executeWithContext` is called per scene with `requestId: stage-${acceptanceRunId}-${scene.id}` (line 242), and `saveActionReceipt` runs last (line 285). `PostgresOperatorAcceptanceRunRepository.saveActionReceipt` (`packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts` lines 288-310) uses `INSERT ... ON CONFLICT (scope, run_or_campaign_id, action_id) DO NOTHING`. In `AcceptOperatorAcceptanceSceneUseCase` (lines 330, 402), receipts are scoped only by `input.sceneId` rather than `(acceptanceRunId, sceneId)`. In `apps/control-api/src/http/errors.ts`, `OperatorAcceptanceIdempotencyConflictError` is not handled in `formatReviewError`, falling through to the generic handler without a `code` field.
  Required Fix: Serialize action receipt creation transactionally (e.g., lock the parent campaign/run row or insert-and-check the receipt before dispatching work), derive deterministic staging request IDs from `(campaignId, planId, sceneId, actionId)`, scope `accept_scene` receipts to the acceptance run and scene, include plan/revision/realm in canonical request hashes, and map `OperatorAcceptanceIdempotencyConflictError` in `formatReviewError` to HTTP 409 with `code: "IDEMPOTENCY_CONFLICT"`.
  Source: quality-review (iteration 0)

- **[F-427e7892] [HIGH]** Several required regression tests are tautological assertions over local constants or inline mocks that execute zero application/infrastructure logic, and over-mocking in the positive lifecycle test masked the broken `PostgresGenerationManifestRepository` / `AssembleDeliveryReel` route and frameCount integration.
  Files: apps/render-worker/src/h3-variable-duration-lifecycle.test.ts
  Evidence: 1. Line 524 (`"rejects off-grid frames (e.g. 244 frames) before GPU side effects"`) only computes `const k = (244 - MINIMAX_H3_GRID_OFFSET) / MINIMAX_H3_GRID_STEP; expect(Number.isInteger(k)).toBe(false);` without calling any production code.
2. Line 612 (`"rejects candidate row with recorded NO_GO visual decision"`) only asserts static properties of the constant `HISTORICAL_NO_GO_ROW_362F`.
3. Line 901 (`"public UI / production release reader does not advertise staging-only candidate lengths before #428 release gate"`) asserts that the test's own inline mock `listReleasedProfiles: async () => []` returns `[]`.
4. Lines 191-520 mock `StageH3CandidateRenderUseCase`, bypass `executeRenderJob` and `AssembleGenerationManifestUseCase` via `uow.seedVideoStemSource`, mock `GenerationManifestRepository.getComponentIdentityById`, mock `MediaAssemblerPort.assemble`, and pre-seed the output reel in `storedObjects` before `worker.processNextJob()` runs.
  Required Fix: Replace the tautological constant/arithmetic/mock assertions with tests that invoke the real admission/registry/planning/execution/assembly components (`H3TrustedCandidateRegistryReader`, `StageH3CandidateRenderUseCase`, `executeRenderJob`, `AssembleGenerationManifestUseCase`, `PostgresGenerationManifestRepository`, and `FfmpegMediaAssemblerAdapter`).
  Source: quality-review (iteration 0)

- **[F-7ddc30d3] [HIGH]** A successful real acceptance encode/completion produces an unavailable reel under the supported runtime composition. There is no valid runtime worker-to-playable-reel success path, despite the passing mocked integration test.
  Files: apps/render-worker/src/cli/run-delivery-assembler.ts, packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts, packages/application/src/use-cases/resolve-operator-acceptance-reel.ts
  Evidence: The new acceptance factory at apps/render-worker/src/cli/run-delivery-assembler.ts:392-400 changes outputBucket only. The real FFmpeg adapter at packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts:1021 always uses campaigns/<campaignId>/assemblies/<assemblyId>/output.mp4. AcceptanceDeliveryAssemblyWorker persists that exact key at apps/render-worker/src/acceptance-delivery-assembly-worker.ts:254-256. The resolver at packages/application/src/use-cases/resolve-operator-acceptance-reel.ts:272-283 rejects every media key outside acceptance-runs/<runId>/. The integration mock at tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts:638 invents a compatible key, hiding the contradiction.
  Required Fix: Bind an acceptance-specific output namespace to the authenticated run before encoding/publication and propagate it through the real assembler. Test that supported factory and real FFmpeg adapter produce media that authenticated readback accepts.
  Source: spec-review (iteration 2)

### PREVIOUSLY RESOLVED FINDINGS (REGRESSION CHECKLIST):
- **[F-5533f782] [RESOLVED in iter 3]** Authority-resolving a supplied object is an improvement, but conflicting key/object forms and realm compatibility are explicit anchored denial requirements. A request can state contradictory selections and silently have one form discarded; checking only the selected member does not authenticate the entire allowed set's scope/realm.
  Resolution Evidence: packages/application/src/use-cases/create-campaign-shell.ts:152-197, 210-253; packages/application/src/use-cases/profile-selection-resolver.ts:123-190; packages/application/src/use-cases/replan-campaign.ts:174-193, 370-385
  Source: spec-review

- **[F-ce576487] [RESOLVED in iter 3]** Real persisted Ref2V candidate generation manifests have `route: undefined` in `getComponentIdentityById` and are silently misclassified as `i2v` (`MINIMAX_H3_720P_5S_I2V_V1`) by `AssembleDeliveryReel`, violating the route-distinction governance rule that I2V approval never licenses Ref2V and failing open on missing route provenance. Furthermore, passing `targetBucket: BUCKETS.REVIEW` bypasses the `ineligible-candidate-in-delivery` check even when the underlying `FfmpegMediaAssemblerAdapter` writes output media to `BUCKETS.DELIVERY`.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts:61-99; packages/application/src/use-cases/assemble-delivery-reel.ts:183-225, 370-399, 435-458; packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts:1026-1044; apps/render-worker/src/acceptance-delivery-assembly-worker.ts:213-230
  Source: quality-review

- **[F-ba62dd3d] [RESOLVED in iter 3]** Once a worker calls `start()`, the job enters `'rendering'` status and can never be reclaimed if the worker crashes or its lease expires. Because `AcceptanceDeliveryAssemblyWorker` never heartbeats, any encode exceeding `lockTimeoutMs` expires its lease. Worse, if a lease expires or is superseded, `start`/`complete`/`fail` lack `lease_expires_at > NOW()` guards and the worker's `catch` block can overwrite the run status to `"failed"`.
  Resolution Evidence: packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts:103-218; apps/render-worker/src/acceptance-delivery-assembly-worker.ts:184-206, 304-340
  Source: quality-review

- **[F-3a792755] [RESOLVED in iter 3]** Exporting ephemeral Ed25519 test keypair generators, test capability matrix signers, test candidate grant signers, and simulation fixture builders from the public `@cco/infrastructure` package leaks test-only simulation signing utilities into the production package surface.
  Resolution Evidence: tests/fixtures/h3-variable-duration/source-matrix.ts:1-31; packages/infrastructure/src/index.ts:1-60
  Source: quality-review

- **[F-7fc3588f] [RESOLVED in iter 3]** Callers can include staging candidate profiles inside `allowedProfileSelections` on a production-scope campaign, replans can select a profile outside `allowedDurationProfileKeys`, and PostgreSQL deployments running under the non-owner `orchestrator_app` role lack table privileges on the newly created acceptance tables.
  Resolution Evidence: packages/application/src/use-cases/create-campaign-shell.ts:237-253; packages/application/src/use-cases/replan-campaign.ts:174-193, 370-385; packages/application/src/use-cases/profile-selection-resolver.ts:165-190; packages/infrastructure/migrations/032_acceptance_assembly_lifecycle.sql:42-59
  Source: quality-review

```

Deterministic validation evidence:

```
Validation result: passed (fingerprint: f860ba001783)
```



Complete branch diff against base:

```diff
diff --git a/apps/control-api/src/http/errors.ts b/apps/control-api/src/http/errors.ts
index 323396c..57b151b 100644
--- a/apps/control-api/src/http/errors.ts
+++ b/apps/control-api/src/http/errors.ts
@@ -50,7 +50,8 @@ import {
   OperatorAcceptanceSceneNotFoundError,
   OperatorAcceptanceOrdinalMismatchError,
   OperatorAcceptanceInvalidStatusError,
-  OperatorAcceptanceSceneNotAcceptedError
+  OperatorAcceptanceSceneNotAcceptedError,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import {
   AlreadyAcceptedProductionAttemptError,
@@ -479,6 +480,20 @@ export function formatReviewError(error: unknown): {
     };
   }
 
+  if (
+    error instanceof OperatorAcceptanceIdempotencyConflictError ||
+    (error instanceof Error && error.name === "OperatorAcceptanceIdempotencyConflictError") ||
+    (error as { code?: string })?.code === "IDEMPOTENCY_CONFLICT"
+  ) {
+    return {
+      statusCode: 409,
+      body: {
+        code: "IDEMPOTENCY_CONFLICT",
+        message: (error as Error).message
+      }
+    };
+  }
+
   if (
     error instanceof OperatorAcceptanceInvalidStatusError ||
     error instanceof OperatorAcceptanceSceneNotAcceptedError
diff --git a/apps/control-api/src/http/routes/duration-planning-routes.test.ts b/apps/control-api/src/http/routes/duration-planning-routes.test.ts
index 6014994..a488dbe 100644
--- a/apps/control-api/src/http/routes/duration-planning-routes.test.ts
+++ b/apps/control-api/src/http/routes/duration-planning-routes.test.ts
@@ -35,9 +35,8 @@ const samplePlan = planFeasibleCampaignDuration({
     }
   ],
   realm: {
-    kind: "isolated_test",
-    testRealmId: "test-realm-1",
-    isolationDescriptorDigest: "0".repeat(64)
+    kind: "deployed",
+    deploymentId: "test-deploy-1"
   },
   scope: "production"
 });
@@ -161,7 +160,9 @@ class FakeUnitOfWork implements UnitOfWork {
       findRunSceneBySceneId: async () => undefined,
       updateRunStatus: async () => {},
       updateSceneAcceptedAttempt: async () => {},
-      updateSceneCurrentAttempt: async () => {}
+      updateSceneCurrentAttempt: async () => {},
+      saveActionReceipt: async () => {},
+      findActionReceipt: async () => undefined
     };
 
     return work({
@@ -434,4 +435,36 @@ describe("DurationPlanningRoutes", () => {
     expect(body.code).toBe("FORBIDDEN");
     expect(body.message).toContain("does not match authenticated identity");
   });
+
+  it("returns 404 for non-existent operator acceptance run reel", async () => {
+    const app = createControlApiApp(
+      { uow: new FakeUnitOfWork() },
+      { reviewerIdentityResolver: { resolve: async () => "Test Reviewer" } }
+    );
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/operator-acceptance/runs/01950c46-9e90-7d3d-82d2-8f1d3c000099/reel"
+    });
+
+    expect(res.statusCode).toBe(404);
+    const body = JSON.parse(res.body);
+    expect(body.code).toBe("NOT_FOUND");
+  });
+
+  it("returns 403 on GET acceptance run reel when reviewer is anonymous or unauthorized", async () => {
+    const app = createControlApiApp(
+      { uow: new FakeUnitOfWork() },
+      { reviewerIdentityResolver: { resolve: async () => "anonymous" } }
+    );
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/operator-acceptance/runs/01950c46-9e90-7d3d-82d2-8f1d3c000099/reel"
+    });
+
+    expect(res.statusCode).toBe(403);
+    const body = JSON.parse(res.body);
+    expect(body.code).toBe("FORBIDDEN");
+  });
 });
diff --git a/apps/control-api/src/http/routes/duration-planning-routes.ts b/apps/control-api/src/http/routes/duration-planning-routes.ts
index 09e6950..8c23c90 100644
--- a/apps/control-api/src/http/routes/duration-planning-routes.ts
+++ b/apps/control-api/src/http/routes/duration-planning-routes.ts
@@ -1,5 +1,6 @@
 import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
 import type { ControlApiContainer, ReviewerIdentityResolver } from "../types.js";
+import type { ClientContextResolver } from "@cco/application";
 import {
   ReplanCampaignPreviewRequestSchema,
   ReplanCampaignPreviewResponseSchema,
@@ -9,12 +10,14 @@ import {
   BeginOperatorAcceptanceRunResponseSchema,
   AcceptAcceptanceSceneRequestSchema,
   AssembleOperatorAcceptanceRunRequestSchema,
-  AssembleOperatorAcceptanceRunResponseSchema
+  AssembleOperatorAcceptanceRunResponseSchema,
+  AcceptanceRunReelReadModelSchema
 } from "@cco/contracts";
 
 export interface DurationPlanningRoutesOptions {
   readonly container: ControlApiContainer;
   readonly reviewerIdentityResolver?: ReviewerIdentityResolver | undefined;
+  readonly clientContextResolver?: ClientContextResolver<FastifyRequest> | undefined;
 }
 
 export const campaignIdParamsSchema = {
@@ -109,7 +112,8 @@ export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOp
 
       const body = ReplanCampaignPreviewRequestSchema.parse({
         ...(request.body as Record<string, unknown>),
-        campaignId: request.params.campaignId
+        campaignId: request.params.campaignId,
+        principal: reviewerName
       });
 
       const result = await container.useCases.previewCampaignReplan.execute(body);
@@ -141,7 +145,8 @@ export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOp
 
       const body = ReplanCampaignCommitRequestSchema.parse({
         ...(request.body as Record<string, unknown>),
-        campaignId: request.params.campaignId
+        campaignId: request.params.campaignId,
+        principal: reviewerName
       });
 
       const result = await container.useCases.commitCampaignReplan.execute(body);
@@ -286,4 +291,45 @@ export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOp
       return reply.status(200).send(response);
     }
   );
+
+  // 9. Resolve operator acceptance run reel
+  fastify.get<{ Params: { acceptanceRunId: string } }>(
+    "/api/operator-acceptance/runs/:acceptanceRunId/reel",
+    async (request, reply) => {
+      if (!container.useCases.resolveOperatorAcceptanceReel) {
+        throw new Error("ResolveOperatorAcceptanceReelUseCase is not configured on container.");
+      }
+
+      const reviewerName = await getReviewerIdentity(request);
+      const authorized = await checkReviewerAuthorization(reviewerName);
+      if (!authorized) {
+        return reply.status(403).send({
+          code: "FORBIDDEN",
+          message: `Reviewer '${reviewerName}' is not authorized to resolve operator acceptance run reel`
+        });
+      }
+
+      let clientId: string | undefined;
+      const clientResolver = opts.clientContextResolver;
+      if (clientResolver) {
+        try {
+          const resolved = await clientResolver.resolve(request);
+          if (resolved) {
+            clientId = resolved;
+          }
+        } catch {
+          // No client context
+        }
+      }
+
+      const result = await container.useCases.resolveOperatorAcceptanceReel.execute({
+        acceptanceRunId: request.params.acceptanceRunId,
+        reviewerName,
+        clientId
+      });
+
+      const response = AcceptanceRunReelReadModelSchema.parse(result);
+      return reply.status(200).send(response);
+    }
+  );
 };
diff --git a/apps/control-api/src/http/types.ts b/apps/control-api/src/http/types.ts
index 6ac235f..b418c9e 100644
--- a/apps/control-api/src/http/types.ts
+++ b/apps/control-api/src/http/types.ts
@@ -41,6 +41,7 @@ import {
   BeginOperatorAcceptanceRunUseCase,
   AcceptOperatorAcceptanceSceneUseCase,
   AssembleOperatorAcceptanceRunUseCase,
+  ResolveOperatorAcceptanceReelUseCase,
   type StageH3CandidateRenderUseCase,
   type H3CandidateRegistryReader,
   type RealmAdmissionContext,
@@ -152,6 +153,7 @@ export interface ControlApiUseCases {
   readonly beginOperatorAcceptanceRun?: BeginOperatorAcceptanceRunUseCase | undefined;
   readonly acceptOperatorAcceptanceScene?: AcceptOperatorAcceptanceSceneUseCase | undefined;
   readonly assembleOperatorAcceptanceRun?: AssembleOperatorAcceptanceRunUseCase | undefined;
+  readonly resolveOperatorAcceptanceReel?: ResolveOperatorAcceptanceReelUseCase | undefined;
   readonly createCampaign?: CreateCampaignUseCase | undefined;
   readonly createCampaignShell?: CreateCampaignShellUseCase | undefined;
   readonly createClient?: CreateClientUseCase | undefined;
@@ -603,10 +605,20 @@ export function createControlApiContainer(
     : undefined;
 
   const previewCampaignReplan = dependencies.uow
-    ? new PreviewCampaignReplanUseCase({ uow: dependencies.uow })
+    ? new PreviewCampaignReplanUseCase({
+        uow: dependencies.uow,
+        productionReleaseReader: dependencies.productionReleaseReader,
+        stagingAuthSource: dependencies.stagingAuthSource,
+        registryReader: dependencies.h3CandidateRegistryReader
+      })
     : undefined;
   const commitCampaignReplan = dependencies.uow
-    ? new CommitCampaignReplanUseCase({ uow: dependencies.uow })
+    ? new CommitCampaignReplanUseCase({
+        uow: dependencies.uow,
+        productionReleaseReader: dependencies.productionReleaseReader,
+        stagingAuthSource: dependencies.stagingAuthSource,
+        registryReader: dependencies.h3CandidateRegistryReader
+      })
     : undefined;
   const beginOperatorAcceptanceRun = dependencies.uow
     ? new BeginOperatorAcceptanceRunUseCase({
@@ -621,6 +633,15 @@ export function createControlApiContainer(
   const assembleOperatorAcceptanceRun = dependencies.uow
     ? new AssembleOperatorAcceptanceRunUseCase({ uow: dependencies.uow })
     : undefined;
+  const resolveOperatorAcceptanceReel = dependencies.uow
+    ? new ResolveOperatorAcceptanceReelUseCase({
+        uow: dependencies.uow,
+        ...(dependencies.objectStorage ? { objectStorage: dependencies.objectStorage } : {}),
+        ...(dependencies.reviewMediaDelivery
+          ? { mediaDelivery: dependencies.reviewMediaDelivery }
+          : {})
+      })
+    : undefined;
 
   return {
     dependencies,
@@ -675,7 +696,8 @@ export function createControlApiContainer(
       ...(commitCampaignReplan !== undefined ? { commitCampaignReplan } : {}),
       ...(beginOperatorAcceptanceRun !== undefined ? { beginOperatorAcceptanceRun } : {}),
       ...(acceptOperatorAcceptanceScene !== undefined ? { acceptOperatorAcceptanceScene } : {}),
-      ...(assembleOperatorAcceptanceRun !== undefined ? { assembleOperatorAcceptanceRun } : {})
+      ...(assembleOperatorAcceptanceRun !== undefined ? { assembleOperatorAcceptanceRun } : {}),
+      ...(resolveOperatorAcceptanceReel !== undefined ? { resolveOperatorAcceptanceReel } : {})
     },
     queries: {
       ...(dependencies.sceneReviewQueries !== undefined
diff --git a/apps/render-worker/src/cli/run-delivery-assembler.ts b/apps/render-worker/src/cli/run-delivery-assembler.ts
index ae85e18..4e74048 100644
--- a/apps/render-worker/src/cli/run-delivery-assembler.ts
+++ b/apps/render-worker/src/cli/run-delivery-assembler.ts
@@ -9,13 +9,16 @@ import {
   EnforceLicenseRouting,
   type GenerationManifestRepository,
   type MediaAssemblerPort,
-  type ObjectStoragePort
+  type ObjectStoragePort,
+  type UnitOfWork
 } from "@cco/application";
+import { BUCKETS } from "@cco/shared";
 import { type ComponentRef } from "@cco/contracts";
 import {
   FfmpegMediaAssemblerAdapter,
   JsonFileLicenseRegistryPort,
   PostgresGenerationManifestRepository,
+  PostgresUnitOfWork,
   S3ObjectStorage,
   type S3ObjectStorageOptions
 } from "@cco/infrastructure";
@@ -24,6 +27,7 @@ import {
   type DeliveryAssemblyControlApiClient
 } from "../control-api-client.js";
 import { DeliveryAssemblyWorker } from "../delivery-assembly-worker.js";
+import { AcceptanceDeliveryAssemblyWorker } from "../acceptance-delivery-assembly-worker.js";
 import type { WorkerLogger } from "../worker.js";
 
 const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
@@ -343,12 +347,130 @@ export async function createDeliveryReelAssembler(
   };
 }
 
+export interface AcceptanceDeliveryReelAssemblerOverrides {
+  readonly pool?: pg.Pool | undefined;
+  readonly uow?: UnitOfWork | undefined;
+  readonly generationManifestRepository?: GenerationManifestRepository | undefined;
+  readonly objectStorage?: ObjectStoragePort | undefined;
+  readonly mediaAssembler?: MediaAssemblerPort | undefined;
+  readonly envelopeReader?: AssemblyPlanningEnvelopeReader | undefined;
+  readonly runtimeComponents?: readonly ComponentRef[] | undefined;
+  readonly enforceLicenseRouting?: EnforceLicenseRouting | undefined;
+  readonly assembleDeliveryReelUseCase?: AssembleDeliveryReel | undefined;
+  readonly logger?: WorkerLogger | undefined;
+}
+
+export interface CreatedAcceptanceDeliveryReelAssembler {
+  readonly worker: AcceptanceDeliveryAssemblyWorker;
+  readonly pool: pg.Pool;
+  readonly assembleDeliveryReelUseCase: AssembleDeliveryReel;
+  readonly runtimeComponents: readonly ComponentRef[];
+  readonly cleanup: () => Promise<void>;
+}
+
+export async function createAcceptanceDeliveryReelAssembler(
+  config: DeliveryAssemblerRuntimeConfig,
+  overrides?: AcceptanceDeliveryReelAssemblerOverrides
+): Promise<CreatedAcceptanceDeliveryReelAssembler> {
+  const pool = overrides?.pool ?? new Pool({ connectionString: config.databaseUrl });
+  const ownsPool = !overrides?.pool;
+
+  const generationManifestRepository =
+    overrides?.generationManifestRepository ?? new PostgresGenerationManifestRepository(pool);
+
+  const objectStorage = overrides?.objectStorage ?? new S3ObjectStorage(config.s3Config);
+
+  const licenseRegistry = JsonFileLicenseRegistryPort.fromFile(config.licenseRegistryPath);
+  const enforceLicenseRouting =
+    overrides?.enforceLicenseRouting ?? new EnforceLicenseRouting({ registry: licenseRegistry });
+
+  const envelopeReader = overrides?.envelopeReader ?? new DefaultAssemblyPlanningEnvelopeReader();
+  const envelope = await envelopeReader.getEnvelope();
+
+  const mediaAssembler =
+    overrides?.mediaAssembler ??
+    new FfmpegMediaAssemblerAdapter({
+      ffmpegPath: config.ffmpegPath,
+      ffprobePath: config.ffprobePath,
+      workspaceRoot: config.assemblyWorkspaceRoot,
+      outputBucket: BUCKETS.CANDIDATES,
+      pythonPath: config.pythonPath,
+      maxStemCount: envelope.maxStemCount,
+      maxTotalDurationMs: envelope.maxExpectedTotalDurationMs,
+      objectStorage
+    });
+
+  const runtimeComponents =
+    overrides?.runtimeComponents ??
+    (mediaAssembler.getRuntimeComponents ? await mediaAssembler.getRuntimeComponents() : []);
+
+  const assembleDeliveryReelUseCase =
+    overrides?.assembleDeliveryReelUseCase ??
+    new AssembleDeliveryReel({
+      mediaAssembler,
+      objectStorage,
+      enforceLicenseRouting,
+      generationManifestRepository,
+      runtimeComponents
+    });
+
+  const uow = overrides?.uow ?? new PostgresUnitOfWork(pool);
+  const logger: WorkerLogger = overrides?.logger ?? console;
+
+  const worker = new AcceptanceDeliveryAssemblyWorker(
+    {
+      uow,
+      assembleDeliveryReel: async (params) => {
+        return assembleDeliveryReelUseCase.assemble(params);
+      },
+      objectStorage,
+      logger
+    },
+    {
+      workerId: config.workerId,
+      pollIntervalMs: config.pollIntervalMs,
+      lockTimeoutMs: config.leaseDurationMs
+    }
+  );
+
+  const cleanup = async () => {
+    if (ownsPool) {
+      await pool.end().catch(() => {});
+    }
+  };
+
+  return {
+    worker,
+    pool,
+    assembleDeliveryReelUseCase,
+    runtimeComponents,
+    cleanup
+  };
+}
+
 export async function runDeliveryAssemblerCli(
   argv: string[] = process.argv.slice(2),
   env: NodeJS.ProcessEnv = process.env
 ): Promise<void> {
   const config = parseDeliveryAssemblerRuntimeConfig(env, argv);
-  const assembler = await createDeliveryReelAssembler(config);
+  const getArg = (name: string): string | undefined => {
+    const prefix = `--${name}=`;
+    for (let i = 0; i < argv.length; i++) {
+      const arg = argv[i];
+      if (arg?.startsWith(prefix)) {
+        return arg.slice(prefix.length);
+      }
+      if (arg === `--${name}` && i + 1 < argv.length) {
+        return argv[i + 1];
+      }
+    }
+    return undefined;
+  };
+  const role = (getArg("role") ?? env.ASSEMBLER_ROLE ?? "delivery").trim();
+  const isAcceptance = role === "acceptance" || argv.includes("--acceptance");
+  const assembler = isAcceptance
+    ? await createAcceptanceDeliveryReelAssembler(config)
+    : await createDeliveryReelAssembler(config);
 
   const shutdown = async () => {
     console.info("Shutting down delivery assembly worker...");
diff --git a/apps/render-worker/src/index.ts b/apps/render-worker/src/index.ts
index 062275e..be46a17 100644
--- a/apps/render-worker/src/index.ts
+++ b/apps/render-worker/src/index.ts
@@ -1,2 +1,4 @@
 export const renderWorkerName = "render-worker";
 export * from "./voice-synthesis-factory.js";
+export * from "./acceptance-delivery-assembly-worker.js";
+export * from "./cli/run-delivery-assembler.js";
diff --git a/docs/CONTEXT.md b/docs/CONTEXT.md
index b194912..4c92944 100644
--- a/docs/CONTEXT.md
+++ b/docs/CONTEXT.md
@@ -295,5 +295,15 @@ Issue #426 delivers capability-aware campaign duration allocation, durable durat
 - **Campaign Replan Contract & Idempotency:** Campaign replans require complete vectors of scene durations and expected spec revisions summing strictly to the campaign target duration, acquire row locks, invalidate scene approvals while preserving allocation IDs, and record idempotent action receipts for safe action replay.
 - **Assembly Planning Envelope Safety:** Combinatorial candidate partitioning prunes states against maximum stem and duration envelope ceilings with fail-closed catalog limits, and campaign creation UI warns users when requested durations exceed assembly boundaries.
 
+### 9. Variable-Duration H3 CI Simulation & End-to-End Acceptance Lifecycle (#421.6 / Issue #427)
+
+Issue #427 delivers full simulation and regression coverage for variable-duration MiniMax-H3 production:
+- **Autonomous CI vs. Physical GPU Boundary:** CI simulation exercises the software control plane, duration allocation, staged rendering, review gating, worker assembly, and accepted reel readback. Physical GPU execution and hardware certification belong to the operator runbook (`docs/h3-acceptance-operator-runbook.md`).
+- **Simulated Connected Lifecycle & E2E Coverage:** Validates the end-to-end software path across Postgres, MinIO, and worker execution in `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` and focused unit suites, verifying duration allocation, candidate staging, review gating, worker assembly, manifest storage, and reel readback with full stem lineage.
+- **Negative & Security Boundaries:** Rejects off-grid frame counts ($5 + 17k$), scene ceiling violations (>15,000ms `MAX_SCENE_DURATION_MS`), candidate rows with recorded `NO_GO` visual decisions, unapproved profile digests, cross-route licensing, parameter-conflicting replays (HTTP 409), and stem checksum mismatches.
+- **Legacy 5-Second Controls & Operator Release Gate:** Preserves legacy 5-second production profiles (`MINIMAX_H3_720P_5S_I2V_V1` and `MINIMAX_H3_720P_5S_REF2V_V1`). The production release reader strictly prevents advertising staging-only candidate lengths until the #428 release gate is satisfied on physical hardware.
+- **Reference Documentation:** [docs/h3-variable-duration-ci-coverage.md](h3-variable-duration-ci-coverage.md).
+
+
 
 
diff --git a/docs/h3-acceptance-operator-runbook.md b/docs/h3-acceptance-operator-runbook.md
index c19c09c..52261c5 100644
--- a/docs/h3-acceptance-operator-runbook.md
+++ b/docs/h3-acceptance-operator-runbook.md
@@ -159,6 +159,14 @@ If an operator aborts a candidate staging run or encounters fatal execution erro
    rm -f "$CCO_COMFYUI_DIR/input/stage_"*
    ```
 
+### Variable-Duration Release Gate (#428)
+
+Issue #427 establishes automated CI simulation and software regression coverage across duration allocation, staging acceptance dispatch, worker assembly, and accepted reel readback (`docs/h3-variable-duration-ci-coverage.md`).
+
+However, **CI simulation is not GPU certification**:
+- The public UI and production release reader (`ProductionReleaseCapabilityReader`) strictly withhold advertising variable-duration candidate lengths (e.g. 243f, 362f) from general production until the operator physical campaign is executed on the RTX 4090 host.
+- Only upon successful execution of this runbook with zero unmitigated visual defects (blackouts, limb corruption) may the operator promote candidate profiles into the production release catalog under issue #428.
+
 ## Open baseline questions
 
 (Populate this section only if the physical campaign surfaces a defect in H3 dispatch,
diff --git a/packages/application/src/ports/generation-manifest-repository.ts b/packages/application/src/ports/generation-manifest-repository.ts
index 004239f..e97da0d 100644
--- a/packages/application/src/ports/generation-manifest-repository.ts
+++ b/packages/application/src/ports/generation-manifest-repository.ts
@@ -33,10 +33,22 @@ export interface GenerationManifestComponentIdentity {
    * manifest references from being accepted into assembly provenance.
    */
   readonly outputChecksumsSha256?: readonly string[] | undefined;
+  readonly route?: "i2v" | "ref2v" | undefined;
+  readonly candidateSpecificationDigest?: string | undefined;
 }
 
 export interface VideoStemSourceRecord {
   readonly generationManifestId: string;
+  readonly jobId?: string | undefined;
+  readonly sceneId?: string | undefined;
+  readonly renderProfile?: string | undefined;
+  readonly route?: "i2v" | "ref2v" | undefined;
+  readonly routingMode?: string | undefined;
+  readonly candidateSpecificationDigest?: string | undefined;
+  readonly specRevision?: number | undefined;
+  readonly frames?: number | undefined;
+  readonly fps?: number | undefined;
+  readonly outputChecksumsSha256?: readonly string[] | undefined;
   readonly media: PersistentMediaRef;
   readonly renderAttempt: number;
   readonly executionScope?: "production" | "staging" | undefined;
diff --git a/packages/application/src/ports/operator-acceptance-ports.ts b/packages/application/src/ports/operator-acceptance-ports.ts
index 648ba2f..4ef967b 100644
--- a/packages/application/src/ports/operator-acceptance-ports.ts
+++ b/packages/application/src/ports/operator-acceptance-ports.ts
@@ -2,6 +2,8 @@ import type {
   AcceptanceAssemblyJob,
   AcceptanceAssemblyManifest,
   AcceptanceRunScene,
+  OperatorAcceptanceActionReceipt,
+  OperatorAcceptanceActionScope,
   OperatorAcceptanceRun,
   OperatorAcceptanceRunStatus
 } from "@cco/contracts";
@@ -31,6 +33,12 @@ export interface OperatorAcceptanceRunRepository {
     attemptId: string,
     ordinal: number
   ): Promise<void>;
+  saveActionReceipt(receipt: OperatorAcceptanceActionReceipt): Promise<void>;
+  findActionReceipt(
+    scope: OperatorAcceptanceActionScope | string,
+    runOrCampaignId: string,
+    actionId: string
+  ): Promise<OperatorAcceptanceActionReceipt | undefined>;
 }
 
 export interface AcceptanceAssemblyJobQueuePort {
@@ -38,6 +46,8 @@ export interface AcceptanceAssemblyJobQueuePort {
     job: Omit<AcceptanceAssemblyJob, "status" | "createdAt" | "updatedAt">
   ): Promise<AcceptanceAssemblyJob>;
   claim(workerId: string, leaseDurationMs: number): Promise<AcceptanceAssemblyJob | undefined>;
+  start(jobId: string, leaseToken: string): Promise<void>;
+  heartbeat(jobId: string, leaseToken: string, leaseDurationMs: number): Promise<void>;
   complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void>;
   fail(jobId: string, error: string, leaseToken?: string): Promise<void>;
   findById(jobId: string): Promise<AcceptanceAssemblyJob | undefined>;
diff --git a/packages/application/src/test-support/in-memory-scene-unit-of-work.ts b/packages/application/src/test-support/in-memory-scene-unit-of-work.ts
index adac552..bdb6e24 100644
--- a/packages/application/src/test-support/in-memory-scene-unit-of-work.ts
+++ b/packages/application/src/test-support/in-memory-scene-unit-of-work.ts
@@ -4,6 +4,7 @@ import type {
   AcceptanceAssemblyManifest,
   AcceptanceRunScene,
   CampaignDurationPlan,
+  OperatorAcceptanceActionReceipt,
   OperatorAcceptanceRun,
   ReviewEvent,
   SceneDurationBinding
@@ -125,6 +126,7 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
   private readonly _acceptanceRunScenes = new Map<string, AcceptanceRunScene[]>();
   private readonly _acceptanceJobs = new Map<string, AcceptanceAssemblyJob>();
   private readonly _acceptanceManifests = new Map<string, AcceptanceAssemblyManifest>();
+  private readonly _acceptanceActionReceipts = new Map<string, OperatorAcceptanceActionReceipt>();
   private readonly _campaignReferenceBibles = new Map<string, CampaignReferenceBibleEntry>();
   private readonly _campaignReferenceBibleChanges: CampaignReferenceBibleChange[] = [];
   private readonly _enqueuedAssemblyJobs: EnqueueDeliveryAssemblyJobInput[] = [];
@@ -368,6 +370,32 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
     return this;
   }
 
+  get generationManifests(): GenerationManifestRepository {
+    return {
+      getComponentIdentityById: async (manifestId: string) => {
+        for (const stem of this._seededVideoStemSources.values()) {
+          if (stem.generationManifestId === manifestId && stem.renderProfile) {
+            return {
+              renderProfile: stem.renderProfile,
+              renderProfileVersion: 1,
+              route:
+                stem.route ??
+                (stem.routingMode === "frame_anchored"
+                  ? ("i2v" as const)
+                  : stem.routingMode === "reference_directed"
+                    ? ("ref2v" as const)
+                    : undefined),
+              candidateSpecificationDigest: stem.candidateSpecificationDigest,
+              outputChecksumsSha256: stem.outputChecksumsSha256
+            };
+          }
+        }
+        return undefined;
+      },
+      findVideoStemSourceByJobId: async (jobId: string) => this._seededVideoStemSources.get(jobId)
+    };
+  }
+
   seedReferenceAsset(asset: ReferenceAsset): this {
     this._seededReferenceAssets.set(asset.id, asset);
     return this;
@@ -824,7 +852,26 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
     };
 
     const defaultGenerationManifests: GenerationManifestRepository = {
-      getComponentIdentityById: async () => undefined,
+      getComponentIdentityById: async (manifestId: string) => {
+        for (const stem of this._seededVideoStemSources.values()) {
+          if (stem.generationManifestId === manifestId && stem.renderProfile) {
+            return {
+              renderProfile: stem.renderProfile,
+              renderProfileVersion: 1,
+              route:
+                stem.route ??
+                (stem.routingMode === "frame_anchored"
+                  ? ("i2v" as const)
+                  : stem.routingMode === "reference_directed"
+                    ? ("ref2v" as const)
+                    : undefined),
+              candidateSpecificationDigest: stem.candidateSpecificationDigest,
+              outputChecksumsSha256: stem.outputChecksumsSha256
+            };
+          }
+        }
+        return undefined;
+      },
       findVideoStemSourceByJobId: async (jobId: string) => this._seededVideoStemSources.get(jobId)
     };
 
@@ -1237,7 +1284,10 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
       },
       operatorAcceptanceRuns: {
         createRun: async (run, scenes) => {
-          this._acceptanceRuns.set(run.acceptanceRunId, run);
+          this._acceptanceRuns.set(run.acceptanceRunId, {
+            ...run,
+            status: run.status ?? "dispatched"
+          });
           this._acceptanceRunScenes.set(run.acceptanceRunId, [...scenes]);
         },
         findRunById: async (acceptanceRunId) => {
@@ -1303,6 +1353,14 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
               };
             }
           }
+        },
+        saveActionReceipt: async (receipt) => {
+          const key = `${receipt.scope}:${receipt.runOrCampaignId}:${receipt.actionId}`;
+          this._acceptanceActionReceipts.set(key, receipt);
+        },
+        findActionReceipt: async (scope, runOrCampaignId, actionId) => {
+          const key = `${scope}:${runOrCampaignId}:${actionId}`;
+          return this._acceptanceActionReceipts.get(key);
         }
       },
       acceptanceAssemblyJobs: {
@@ -1333,6 +1391,30 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
           }
           return undefined;
         },
+        start: async (jobId, leaseToken) => {
+          const job = this._acceptanceJobs.get(jobId);
+          if (!job) throw new Error(`Job ${jobId} not found`);
+          if (leaseToken && job.leaseToken && job.leaseToken !== leaseToken) {
+            throw new Error(`Lease token mismatch on job ${jobId}`);
+          }
+          this._acceptanceJobs.set(jobId, {
+            ...job,
+            status: "rendering",
+            updatedAt: new Date().toISOString()
+          });
+        },
+        heartbeat: async (jobId, leaseToken, leaseDurationMs) => {
+          const job = this._acceptanceJobs.get(jobId);
+          if (!job) throw new Error(`Job ${jobId} not found`);
+          if (leaseToken && job.leaseToken && job.leaseToken !== leaseToken) {
+            throw new Error(`Lease token mismatch on job ${jobId}`);
+          }
+          this._acceptanceJobs.set(jobId, {
+            ...job,
+            leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
+            updatedAt: new Date().toISOString()
+          });
+        },
         complete: async (jobId, outputManifestId, leaseToken) => {
           const job = this._acceptanceJobs.get(jobId);
           if (job) {
diff --git a/packages/application/src/use-cases/assemble-delivery-reel.test.ts b/packages/application/src/use-cases/assemble-delivery-reel.test.ts
index 9dac068..091b17e 100644
--- a/packages/application/src/use-cases/assemble-delivery-reel.test.ts
+++ b/packages/application/src/use-cases/assemble-delivery-reel.test.ts
@@ -19,6 +19,7 @@ import {
   AssemblyProvenanceConflictError,
   AssemblyVideoCommitError
 } from "./assemble-delivery-reel.js";
+import { BUCKETS } from "@cco/shared";
 import { EnforceLicenseRouting } from "./enforce-license-routing.js";
 import { LicenseRoutingError } from "./license-routing-error.js";
 
@@ -1548,4 +1549,192 @@ describe("AssembleDeliveryReel use case", () => {
     expect(mockAssembler.assemble).not.toHaveBeenCalled();
     expect(mockStorage.putObject).not.toHaveBeenCalled();
   });
+
+  it("denies assembly with zero ffmpeg spawn when a candidate stem is assembled for production delivery", async () => {
+    const mockStorage: ObjectStoragePort = {
+      putObject: vi.fn(),
+      copyObject: vi.fn(),
+      getObject: vi.fn(async () => undefined)
+    };
+    const mockAssembler: MediaAssemblerPort = {
+      assemble: vi.fn(async () => dummyExecutionResult)
+    };
+
+    const candidateGenManifestRepo: GenerationManifestRepository = {
+      getComponentIdentityById: vi.fn(async () => ({
+        renderProfile: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
+        renderProfileVersion: 1,
+        route: "ref2v" as const,
+        candidateSpecificationDigest:
+          "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7"
+      }))
+    };
+
+    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
+    const useCase = new AssembleDeliveryReel({
+      runtimeComponents: defaultRequiredComponents,
+      mediaAssembler: mockAssembler,
+      objectStorage: mockStorage,
+      enforceLicenseRouting,
+      generationManifestRepository: candidateGenManifestRepo
+    });
+
+    await expect(
+      useCase.assemble({
+        spec: validSpec,
+        targetBucket: BUCKETS.DELIVERY
+      })
+    ).rejects.toThrow(LicenseRoutingError);
+
+    expect(mockAssembler.assemble).not.toHaveBeenCalled();
+    expect(mockStorage.putObject).not.toHaveBeenCalled();
+  });
+
+  it("permits assembly when candidate stem is assembled for acceptance (BUCKETS.CANDIDATES)", async () => {
+    const mockStorage: ObjectStoragePort = {
+      putObject: vi.fn(async (input) => ({ bucket: input.bucket, key: input.key })),
+      copyObject: vi.fn(async (_from, to) => to),
+      getObject: vi.fn(async () => undefined)
+    };
+    const candidateExecutionResult: AssemblyExecutionResult = {
+      ...dummyExecutionResult,
+      output: {
+        ...dummyExecutionResult.output,
+        media: {
+          ...dummyExecutionResult.output.media,
+          bucket: BUCKETS.CANDIDATES
+        }
+      },
+      stagingMedia: {
+        bucket: BUCKETS.CANDIDATES,
+        key: "staging-video.mp4"
+      }
+    };
+    const mockAssembler: MediaAssemblerPort = {
+      assemble: vi.fn(async () => candidateExecutionResult)
+    };
+
+    const candidateGenManifestRepo: GenerationManifestRepository = {
+      getComponentIdentityById: vi.fn(async () => ({
+        renderProfile: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
+        renderProfileVersion: 1,
+        route: "ref2v" as const,
+        candidateSpecificationDigest:
+          "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7"
+      }))
+    };
+
+    const registry = {
+      getSnapshot: () => ({
+        schemaVersion: 1 as const,
+        registryRevision: "2026-10-24.1",
+        generatedAt: "2026-10-24T12:00:00.000Z",
+        entries: [
+          {
+            componentId: "ffmpeg",
+            componentType: "runtime" as const,
+            versionOrRevision: "n8.0.1",
+            status: "approved" as const,
+            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
+            reviewedAt: "2026-08-29T12:00:00.000Z",
+            policyRevision: "2026-08-29.1"
+          },
+          {
+            componentId: "MINIMAX_H3_720P_5S_REF2V_V1",
+            componentType: "model" as const,
+            versionOrRevision: "1",
+            status: "approved" as const,
+            licenseSource: "operator-signed",
+            reviewedAt: "2026-10-24T12:00:00.000Z",
+            policyRevision: "2026-10-24.1"
+          }
+        ]
+      })
+    };
+    const enforceLicenseRouting = new EnforceLicenseRouting({ registry });
+
+    const useCase = new AssembleDeliveryReel({
+      runtimeComponents: defaultRequiredComponents,
+      mediaAssembler: mockAssembler,
+      objectStorage: mockStorage,
+      enforceLicenseRouting,
+      generationManifestRepository: candidateGenManifestRepo
+    });
+
+    const result = await useCase.assemble({
+      spec: validSpec,
+      targetBucket: BUCKETS.CANDIDATES
+    });
+
+    expect(mockAssembler.assemble).toHaveBeenCalledTimes(1);
+    expect(result.manifest.output.media.bucket).toBe(BUCKETS.CANDIDATES);
+  });
+
+  it("denies assembly when Ref2V candidate stem cannot be satisfied by I2V approval (route distinction)", async () => {
+    const mockStorage: ObjectStoragePort = {
+      putObject: vi.fn(),
+      copyObject: vi.fn(),
+      getObject: vi.fn(async () => undefined)
+    };
+    const mockAssembler: MediaAssemblerPort = {
+      assemble: vi.fn(async () => dummyExecutionResult)
+    };
+
+    const candidateGenManifestRepo: GenerationManifestRepository = {
+      getComponentIdentityById: vi.fn(async () => ({
+        renderProfile: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
+        renderProfileVersion: 1,
+        route: "ref2v" as const,
+        candidateSpecificationDigest:
+          "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7"
+      }))
+    };
+
+    // Registry only approves I2V, not Ref2V
+    const registry = {
+      getSnapshot: () => ({
+        schemaVersion: 1 as const,
+        registryRevision: "2026-10-24.1",
+        generatedAt: "2026-10-24T12:00:00.000Z",
+        entries: [
+          {
+            componentId: "ffmpeg",
+            componentType: "runtime" as const,
+            versionOrRevision: "n8.0.1",
+            status: "approved" as const,
+            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
+            reviewedAt: "2026-08-29T12:00:00.000Z",
+            policyRevision: "2026-08-29.1"
+          },
+          {
+            componentId: "MINIMAX_H3_720P_5S_I2V_V1",
+            componentType: "model" as const,
+            versionOrRevision: "1",
+            status: "approved" as const,
+            licenseSource: "operator-signed",
+            reviewedAt: "2026-10-24T12:00:00.000Z",
+            policyRevision: "2026-10-24.1"
+          }
+        ]
+      })
+    };
+    const enforceLicenseRouting = new EnforceLicenseRouting({ registry });
+
+    const useCase = new AssembleDeliveryReel({
+      runtimeComponents: defaultRequiredComponents,
+      mediaAssembler: mockAssembler,
+      objectStorage: mockStorage,
+      enforceLicenseRouting,
+      generationManifestRepository: candidateGenManifestRepo
+    });
+
+    await expect(
+      useCase.assemble({
+        spec: validSpec,
+        targetBucket: BUCKETS.REVIEW
+      })
+    ).rejects.toThrow(LicenseRoutingError);
+
+    expect(mockAssembler.assemble).not.toHaveBeenCalled();
+  });
 });
diff --git a/packages/application/src/use-cases/assemble-delivery-reel.ts b/packages/application/src/use-cases/assemble-delivery-reel.ts
index 1c00d26..2dce324 100644
--- a/packages/application/src/use-cases/assemble-delivery-reel.ts
+++ b/packages/application/src/use-cases/assemble-delivery-reel.ts
@@ -3,6 +3,7 @@ import {
   AssemblyManifestSchema,
   computeAssemblyId,
   createAssemblyManifest,
+  isStagingCandidateProfileKey,
   type AssemblyExecutionResult,
   type AssemblyManifest,
   type AssemblySpec,
@@ -111,6 +112,9 @@ export interface AssembleDeliveryReelDependencies {
 export interface AssembleDeliveryReelParams {
   readonly spec: AssemblySpec;
   readonly requiredComponents?: readonly ComponentRef[] | undefined;
+  readonly targetBucket?: string | undefined;
+  readonly outputKey?: string | undefined;
+  readonly acceptanceRunId?: string | undefined;
 }
 
 export class AssembleDeliveryReel {
@@ -147,6 +151,7 @@ export class AssembleDeliveryReel {
     // reference that cannot match any real registry entry, so the existing
     // evaluator denies it as "unknown_component" via its normal path
     // rather than needing a separate error type here.
+    const targetBucket = params.targetBucket ?? BUCKETS.DELIVERY;
     const resolvedIdentities = new Map<string, GenerationManifestComponentIdentity | undefined>();
     const generationComponents: ComponentRef[] = await Promise.all(
       spec.videoStems.map(async (stem): Promise<ComponentRef> => {
@@ -177,6 +182,48 @@ export class AssembleDeliveryReel {
             versionOrRevision: "unresolved"
           };
         }
+
+        const isCandidate =
+          isStagingCandidateProfileKey(identity.renderProfile) ||
+          Boolean(identity.candidateSpecificationDigest) ||
+          identity.renderProfile.startsWith("H3_CANDIDATE_");
+
+        if (isCandidate) {
+          if (targetBucket !== BUCKETS.CANDIDATES) {
+            return {
+              componentId: `ineligible-candidate-in-delivery:${identity.renderProfile}`,
+              componentType: "model",
+              versionOrRevision: "unresolved"
+            };
+          }
+          if (!identity.route || !identity.candidateSpecificationDigest) {
+            return {
+              componentId: `unresolved-candidate-route:${identity.renderProfile}`,
+              componentType: "model",
+              versionOrRevision: "unresolved"
+            };
+          }
+          if (identity.route === "ref2v") {
+            return {
+              componentId: "MINIMAX_H3_720P_5S_REF2V_V1",
+              componentType: "model",
+              versionOrRevision: "1"
+            };
+          } else if (identity.route === "i2v") {
+            return {
+              componentId: "MINIMAX_H3_720P_5S_I2V_V1",
+              componentType: "model",
+              versionOrRevision: "1"
+            };
+          } else {
+            return {
+              componentId: `unknown-candidate-route:${identity.renderProfile}`,
+              componentType: "model",
+              versionOrRevision: "unresolved"
+            };
+          }
+        }
+
         return {
           componentId: identity.renderProfile,
           componentType: "model",
@@ -237,10 +284,13 @@ export class AssembleDeliveryReel {
     // before any FFmpeg spawn or storage write, so the redundant-encode
     // avoidance this exists for is fully preserved.
     const assemblyId = computeAssemblyId(spec);
-    const earlyManifestKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
+    const earlyManifestKey =
+      targetBucket === BUCKETS.CANDIDATES && params.acceptanceRunId
+        ? `acceptance-runs/${params.acceptanceRunId}/manifest.json`
+        : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
     try {
       const existingManifestObj = await this.deps.objectStorage.getObject({
-        bucket: BUCKETS.DELIVERY,
+        bucket: targetBucket,
         key: earlyManifestKey
       });
       if (existingManifestObj) {
@@ -316,12 +366,37 @@ export class AssembleDeliveryReel {
           `Video stem with order ${stem.order} references generation manifest "${stem.generationManifestId}" with inconsistent output checksum (expected one of [${identity.outputChecksumsSha256.join(", ")}], got "${stem.media.sha256}")`
         );
       }
+
+      const isCandidate =
+        isStagingCandidateProfileKey(identity.renderProfile) ||
+        Boolean(identity.candidateSpecificationDigest) ||
+        identity.renderProfile.startsWith("H3_CANDIDATE_");
+      if (isCandidate) {
+        if (targetBucket !== BUCKETS.CANDIDATES) {
+          throw new AssemblySpecValidationError(
+            `Candidate stem "${identity.renderProfile}" is not permitted for target bucket "${targetBucket}"; must target "${BUCKETS.CANDIDATES}"`
+          );
+        }
+        if (!identity.route || !identity.candidateSpecificationDigest) {
+          throw new AssemblySpecValidationError(
+            `Candidate stem "${identity.renderProfile}" must specify both route and candidateSpecificationDigest`
+          );
+        }
+      }
     }
 
     // Step 3: Invoke MediaAssemblerPort for execution & media persistence
     let executionResult: AssemblyExecutionResult;
+    const assemblerInput = {
+      ...spec,
+      ...(params.targetBucket !== undefined ? { outputBucket: params.targetBucket } : {}),
+      ...(params.outputKey !== undefined ? { outputKey: params.outputKey } : {}),
+      ...(params.acceptanceRunId !== undefined ? { acceptanceRunId: params.acceptanceRunId } : {})
+    };
     try {
-      executionResult = await this.deps.mediaAssembler.assemble(spec);
+      executionResult = await this.deps.mediaAssembler.assemble(
+        assemblerInput as unknown as AssemblySpec
+      );
     } catch (err) {
       if (
         err instanceof Error &&
@@ -330,11 +405,14 @@ export class AssembleDeliveryReel {
       ) {
         const assemblyId =
           (err as { context?: { assemblyId?: string } }).context?.assemblyId ?? "unknown";
-        const manifestKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
+        const manifestKey =
+          targetBucket === BUCKETS.CANDIDATES && params.acceptanceRunId
+            ? `acceptance-runs/${params.acceptanceRunId}/manifest.json`
+            : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
         let existingManifest: AssemblyManifest | undefined;
         try {
           const existingManifestObj = await this.deps.objectStorage.getObject({
-            bucket: BUCKETS.DELIVERY,
+            bucket: targetBucket,
             key: manifestKey
           });
           if (existingManifestObj) {
@@ -354,6 +432,31 @@ export class AssembleDeliveryReel {
       throw err;
     }
 
+    if (
+      params.targetBucket !== undefined &&
+      executionResult.output.media.bucket !== params.targetBucket
+    ) {
+      throw new AssemblySpecValidationError(
+        `Media assembler output bucket "${executionResult.output.media.bucket}" does not match requested targetBucket "${params.targetBucket}"`
+      );
+    }
+    if (
+      params.targetBucket === BUCKETS.CANDIDATES &&
+      executionResult.output.media.bucket !== BUCKETS.CANDIDATES
+    ) {
+      throw new AssemblySpecValidationError(
+        `Candidate acceptance reel output bucket "${executionResult.output.media.bucket}" must be "${BUCKETS.CANDIDATES}"`
+      );
+    }
+    if (
+      params.acceptanceRunId !== undefined &&
+      !executionResult.output.media.key.startsWith(`acceptance-runs/${params.acceptanceRunId}/`)
+    ) {
+      throw new AssemblySpecValidationError(
+        `Acceptance reel output key "${executionResult.output.media.key}" violates acceptance namespace isolation (must start with "acceptance-runs/${params.acceptanceRunId}/")`
+      );
+    }
+
     // Step 4: Construct immutable AssemblyManifest from exact executed state
     const manifest = createAssemblyManifest({
       executionResult,
@@ -364,7 +467,10 @@ export class AssembleDeliveryReel {
     const manifestJson = JSON.stringify(manifest, null, 2);
     const manifestBytes = Buffer.from(manifestJson, "utf-8");
     const checksumSha256 = createHash("sha256").update(manifestBytes).digest("hex");
-    const manifestKey = `campaigns/${executionResult.campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`;
+    const manifestKey =
+      params.targetBucket === BUCKETS.CANDIDATES && params.acceptanceRunId
+        ? `acceptance-runs/${params.acceptanceRunId}/manifest.json`
+        : `campaigns/${executionResult.campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`;
 
     // Step 4a: Check if an AssemblyManifest already exists for this identity (idempotency & conflict prevention)
     const existingManifestObj = await this.deps.objectStorage.getObject({
diff --git a/packages/application/src/use-cases/create-campaign-shell.test.ts b/packages/application/src/use-cases/create-campaign-shell.test.ts
index 4de082c..c3b1704 100644
--- a/packages/application/src/use-cases/create-campaign-shell.test.ts
+++ b/packages/application/src/use-cases/create-campaign-shell.test.ts
@@ -2,8 +2,10 @@ import { describe, expect, it } from "vitest";
 import {
   CampaignDurationPlanningError,
   type CreateCampaignShellRequest,
-  type H3CandidateProfile
+  type H3CandidateProfile,
+  type StagingCandidateProfileSelection
 } from "@cco/contracts";
+import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import type { CampaignId, CampaignShellRecord } from "@cco/domain";
 import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
 import { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
@@ -566,4 +568,108 @@ describe("CreateCampaignShellUseCase", () => {
       ).rejects.toThrow();
     });
   });
+
+  describe("Planning authorization enforcement on supplied selection objects and scope/realm compatibility", () => {
+    const candidateKey = "H3_CANDIDATE_11111111111111111111111111111111_V1";
+    const authorityCandidateSelection: StagingCandidateProfileSelection = {
+      kind: "staging_candidate",
+      profileKey: candidateKey,
+      specificationDigest: "1".repeat(64),
+      targetId: "target-host-1",
+      authorizationId: "auth-1"
+    };
+
+    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
+      listAuthorizedCandidates: async () => [authorityCandidateSelection],
+      resolveCandidateGrant: async () => undefined
+    };
+
+    const mockRegistryReader = {
+      getCandidateProfile: () => undefined,
+      listCandidateProfiles: () => [],
+      isCandidateProfileKey: () => true,
+      resolveH3ProfileFrameCapabilities: (key: string | undefined) =>
+        key === candidateKey
+          ? {
+              profileKey: key,
+              route: "ref2v" as const,
+              routingMode: "reference_directed" as const,
+              width: 1344,
+              height: 768,
+              fps: 24,
+              allowedFrameCounts: [243],
+              isAllowedFrameCount: (f: number) => f === 243
+            }
+          : undefined,
+      isFrameCountAllowedForH3Profile: () => true
+    };
+
+    it("rejects forged caller-supplied executionProfileSelection when specificationDigest mismatches authority", async () => {
+      const uow = new InMemorySceneUnitOfWork();
+      const useCase = new CreateCampaignShellUseCase(uow, {
+        stagingAuthSource: mockStagingAuthSource,
+        registryReader: mockRegistryReader
+      });
+
+      const forgedSelection: StagingCandidateProfileSelection = {
+        kind: "staging_candidate",
+        profileKey: candidateKey,
+        specificationDigest: "2".repeat(64), // Mismatch!
+        targetId: "target-host-1",
+        authorizationId: "auth-1"
+      };
+
+      await expect(
+        useCase.execute({
+          ...validRequest,
+          targetTotalDurationMs: 10000,
+          scope: "staging",
+          executionProfileSelection: forgedSelection
+        })
+      ).rejects.toThrow(CampaignDurationPlanningError);
+    });
+
+    it("rejects forged member in allowedProfileSelections", async () => {
+      const uow = new InMemorySceneUnitOfWork();
+      const useCase = new CreateCampaignShellUseCase(uow, {
+        stagingAuthSource: mockStagingAuthSource,
+        registryReader: mockRegistryReader
+      });
+
+      const forgedAllowed: StagingCandidateProfileSelection = {
+        kind: "staging_candidate",
+        profileKey: candidateKey,
+        specificationDigest: "9".repeat(64), // Mismatch!
+        targetId: "target-host-1",
+        authorizationId: "auth-1"
+      };
+
+      await expect(
+        useCase.execute({
+          ...validRequest,
+          targetTotalDurationMs: 10000,
+          scope: "staging",
+          selectedProfileKey: candidateKey,
+          allowedProfileSelections: [forgedAllowed]
+        })
+      ).rejects.toThrow(CampaignDurationPlanningError);
+    });
+
+    it("rejects staging candidate in production scope", async () => {
+      const uow = new InMemorySceneUnitOfWork();
+      const useCase = new CreateCampaignShellUseCase(uow, {
+        stagingAuthSource: mockStagingAuthSource,
+        registryReader: mockRegistryReader
+      });
+
+      await expect(
+        useCase.execute({
+          ...validRequest,
+          targetTotalDurationMs: 10000,
+          scope: "production",
+          selectedProfileKey: candidateKey
+        })
+      ).rejects.toThrow(CampaignDurationPlanningError);
+    });
+  });
 });
diff --git a/packages/application/src/use-cases/create-campaign-shell.ts b/packages/application/src/use-cases/create-campaign-shell.ts
index 77f62f3..635f9f2 100644
--- a/packages/application/src/use-cases/create-campaign-shell.ts
+++ b/packages/application/src/use-cases/create-campaign-shell.ts
@@ -5,13 +5,7 @@ import {
   type CreativeBrief,
   type ExecutionProfileSelection,
   type ExecutionRealm,
-  type RenderProfileKey,
-  type H3ProfileFrameCapability,
   type H3CapabilityResolverReader,
-  type ReleasedProductionProfileKey,
-  resolveH3ProfileFrameCapabilities,
-  isReleasedProductionProfileKey,
-  isStagingCandidateProfileKey,
   CampaignDurationPlanningError
 } from "@cco/contracts";
 import type {
@@ -33,6 +27,7 @@ import { CampaignIdempotencyConflictError } from "./campaign-idempotency-conflic
 import { computeCampaignRequestHash } from "./campaign-request-hash.js";
 import { resolveSceneCount } from "./scene-count-policy.js";
 import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
+import { ProfileSelectionResolver } from "./profile-selection-resolver.js";
 
 export interface CreateCampaignShellInput extends CreateCampaignShellRequest {
   readonly brief?: CreativeBrief | undefined;
@@ -185,115 +180,53 @@ export class CreateCampaignShellUseCase {
         `Conflicting profile selectors: executionProfileSelection profileKey "${input.executionProfileSelection.profileKey}" does not match targetEngineProfileId "${input.targetEngineProfileId}"`
       );
     }
-
-    const capabilities = new Map<string, H3ProfileFrameCapability>();
-
-    if (this.options?.productionReleaseReader) {
-      // A release-authority outage must not block an independently verified legacy-only
-      // request (issue #426): capture failures here as "no released capabilities available"
-      // rather than propagating. A request that actually needs a released profile still
-      // fails explicitly below, via resolveSelection's own getReleasedProfile call.
-      const releases = await this.options.productionReleaseReader
-        .listReleasedProfiles()
-        .catch(() => []);
-      for (const rel of releases) {
-        const frames = rel.specification.frames;
-        capabilities.set(
-          rel.key,
-          Object.freeze({
-            profileKey: rel.key,
-            route: rel.specification.route,
-            routingMode: rel.specification.routingMode,
-            width: rel.specification.width,
-            height: rel.specification.height,
-            fps: rel.specification.fps,
-            allowedFrameCounts: Object.freeze([frames]),
-            isAllowedFrameCount: (f: number) => f === frames
-          })
+    if (
+      input.allowedProfileSelections !== undefined &&
+      input.allowedDurationProfileKeys !== undefined
+    ) {
+      const allowedObjectKeys = new Set(input.allowedProfileSelections.map((s) => s.profileKey));
+      const allowedStringKeys = new Set(input.allowedDurationProfileKeys);
+      if (
+        allowedObjectKeys.size !== allowedStringKeys.size ||
+        ![...allowedObjectKeys].every((k) => allowedStringKeys.has(k))
+      ) {
+        throw new CampaignDurationPlanningError(
+          "no_feasible_allocation",
+          `Conflicting allowed profile selectors: allowedProfileSelections keys do not match allowedDurationProfileKeys`
         );
       }
     }
 
-    if (this.options?.stagingAuthSource) {
-      // Same independence guarantee as above, for a staging-authority outage.
-      const candidates = await this.options.stagingAuthSource
-        .listAuthorizedCandidates(input.principal)
-        .catch(() => []);
-      for (const cand of candidates) {
-        const cap = resolveH3ProfileFrameCapabilities(cand.profileKey, this.options.registryReader);
-        if (cap) {
-          capabilities.set(cand.profileKey, cap);
-        }
-      }
-    }
-
-    const resolveSelection = async (key: string): Promise<ExecutionProfileSelection> => {
-      if (isReleasedProductionProfileKey(key)) {
-        if (!this.options?.productionReleaseReader) {
-          throw new CampaignDurationPlanningError(
-            "release_unavailable",
-            `No production release reader configured for released profile: ${key}`
-          );
-        }
-        const rel = await this.options.productionReleaseReader.getReleasedProfile(key);
-        if (!rel) {
-          throw new CampaignDurationPlanningError(
-            "release_unavailable",
-            `Released profile ${key} is not available or not enabled`
-          );
-        }
-        return {
-          kind: "released_production",
-          profileKey: key as ReleasedProductionProfileKey,
-          specificationDigest: rel.specificationDigest,
-          releaseId: rel.releaseId,
-          signedReleaseDigest: rel.signedReleaseDigest,
-          certificationRecordDigest: rel.certificationRecordDigest,
-          deploymentEnablementDigest: rel.deploymentEnablementDigest
-        };
-      }
-
-      if (isStagingCandidateProfileKey(key)) {
-        if (!this.options?.stagingAuthSource) {
-          throw new CampaignDurationPlanningError(
-            "capability_unavailable",
-            `No staging authorization source configured for candidate profile: ${key}`
-          );
-        }
-        const candidates = await this.options.stagingAuthSource.listAuthorizedCandidates(
-          input.principal
-        );
-        const cand = candidates.find((c) => c.profileKey === key);
-        if (!cand) {
-          throw new CampaignDurationPlanningError(
-            "capability_unavailable",
-            `Staging candidate ${key} is not authorized`
-          );
-        }
-        return cand;
-      }
+    const resolver = new ProfileSelectionResolver({
+      productionReleaseReader: this.options?.productionReleaseReader,
+      stagingAuthSource: this.options?.stagingAuthSource,
+      registryReader: this.options?.registryReader
+    });
 
-      return {
-        kind: "legacy_production",
-        profileKey: key as RenderProfileKey,
-        version: 1
-      };
-    };
+    const capabilities = await resolver.buildCapabilitiesMap(input.principal);
 
     let selectedProfileSelection: ExecutionProfileSelection;
     if (input.executionProfileSelection) {
-      selectedProfileSelection = input.executionProfileSelection;
+      selectedProfileSelection = await resolver.verifyAndResolveSelection(
+        input.executionProfileSelection,
+        input.principal
+      );
     } else {
       const keyToResolve =
         input.selectedProfileKey ?? input.targetEngineProfileId ?? "MINIMAX_H3_720P_5S_I2V_V1";
-      selectedProfileSelection = await resolveSelection(keyToResolve);
+      selectedProfileSelection = await resolver.resolveSelection(keyToResolve, input.principal);
     }
 
-    let allowedProfileSelections: readonly ExecutionProfileSelection[] | undefined =
-      input.allowedProfileSelections;
-    if (!allowedProfileSelections && input.allowedDurationProfileKeys) {
+    let allowedProfileSelections: readonly ExecutionProfileSelection[] | undefined;
+    if (input.allowedProfileSelections) {
+      allowedProfileSelections = await Promise.all(
+        input.allowedProfileSelections.map((sel) =>
+          resolver.verifyAndResolveSelection(sel, input.principal)
+        )
+      );
+    } else if (input.allowedDurationProfileKeys) {
       allowedProfileSelections = await Promise.all(
-        input.allowedDurationProfileKeys.map((k) => resolveSelection(k))
+        input.allowedDurationProfileKeys.map((k) => resolver.resolveSelection(k, input.principal))
       );
     }
 
@@ -301,6 +234,24 @@ export class CreateCampaignShellUseCase {
       input.scope ??
       (selectedProfileSelection.kind === "staging_candidate" ? "staging" : "production");
 
+    resolver.verifyScopeAndRealm(selectedProfileSelection, scope, realm);
+    if (allowedProfileSelections) {
+      for (const allowed of allowedProfileSelections) {
+        resolver.verifyScopeAndRealm(allowed, scope, realm);
+      }
+    }
+
+    if (
+      allowedProfileSelections &&
+      allowedProfileSelections.length > 0 &&
+      !allowedProfileSelections.some((s) => s.profileKey === selectedProfileSelection.profileKey)
+    ) {
+      throw new CampaignDurationPlanningError(
+        "no_feasible_allocation",
+        `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
+      );
+    }
+
     const plan = planFeasibleCampaignDuration({
       campaignId,
       targetTotalDurationMs: input.targetTotalDurationMs,
diff --git a/packages/application/src/use-cases/index.ts b/packages/application/src/use-cases/index.ts
index 5d51124..2b7f10d 100644
--- a/packages/application/src/use-cases/index.ts
+++ b/packages/application/src/use-cases/index.ts
@@ -105,3 +105,5 @@ export * from "./stage-h3-candidate-render.js";
 export * from "./deterministic-duration-feasibility.js";
 export * from "./replan-campaign.js";
 export * from "./operator-acceptance-run.js";
+export * from "./resolve-operator-acceptance-reel.js";
+export * from "./profile-selection-resolver.js";
diff --git a/packages/application/src/use-cases/operator-acceptance-run.test.ts b/packages/application/src/use-cases/operator-acceptance-run.test.ts
index ada9598..df1b08a 100644
--- a/packages/application/src/use-cases/operator-acceptance-run.test.ts
+++ b/packages/application/src/use-cases/operator-acceptance-run.test.ts
@@ -15,7 +15,8 @@ import {
   type H3CandidateAuthorizationGrant,
   type H3CandidateProfileKey,
   type StagingCandidateProfileSelection,
-  CampaignDurationPlanningError
+  CampaignDurationPlanningError,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
@@ -206,18 +207,34 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     const mockStageRenderUseCase = {
       executeWithContext: async (_context: unknown, _input: unknown) => {
         const jobId = randomUUID();
+        const stageInput = _input as {
+          sceneId: SceneId;
+          candidateProfileKey: string;
+          acceptanceRunId: string;
+        };
         uow.seedVideoStemSource(jobId, {
           generationManifestId: randomUUID(),
+          jobId,
+          sceneId: stageInput.sceneId,
+          renderProfile: stageInput.candidateProfileKey,
+          route: "ref2v",
+          routingMode: "reference_directed",
+          candidateSpecificationDigest: "b".repeat(64),
+          specRevision: 1,
+          frames: 124,
+          fps: 24,
+          outputChecksumsSha256: ["0".repeat(64)],
           renderAttempt: 1,
           executionScope: "staging",
           ownerKind: "staging_acceptance",
+          acceptanceRunId: stageInput.acceptanceRunId,
           realm: isolatedTestRealm,
           evidenceOrigin: "simulated_test",
           measuredMedia: {
-            outputKey: "videos/stem-1.mp4",
+            outputKey: `videos/stem-${stageInput.sceneId}.mp4`,
             checksumSha256: "0".repeat(64),
             container: "ffprobe",
-            dimensions: { width: 720, height: 1280 },
+            dimensions: { width: 1344, height: 768 },
             frameCount: 124,
             fps: 24,
             durationMs: 5167,
@@ -226,7 +243,7 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
           },
           media: {
             bucket: "staging-bucket",
-            key: "videos/stem-1.mp4",
+            key: `videos/stem-${stageInput.sceneId}.mp4`,
             sha256: "0".repeat(64),
             contentType: "video/mp4"
           }
@@ -257,6 +274,23 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     expect(beginRes.sceneCount).toBe(2);
     expect(beginRes.dispatchedJobIds).toHaveLength(2);
 
+    // 1a. Idempotent replay of begin
+    const beginReplay = await beginUseCase.execute({
+      campaignId,
+      actionId: "act-begin-staging",
+      requestedBy: "operator"
+    });
+    expect(beginReplay).toEqual(beginRes);
+
+    // 1b. Idempotent conflict on begin with altered payload
+    await expect(
+      beginUseCase.execute({
+        campaignId,
+        actionId: "act-begin-staging",
+        requestedBy: "different-operator"
+      })
+    ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
+
     // 2. Attempt assemble before accepting scenes -> must fail
     await expect(
       assembleUseCase.execute({
@@ -276,6 +310,27 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     });
     expect(accept1.accepted).toBe(true);
 
+    // 3a. Idempotent replay of accept scene 1
+    const accept1Replay = await acceptUseCase.execute({
+      acceptanceRunId: beginRes.acceptanceRunId,
+      sceneId: scenes[0]!.id,
+      actionId: "act-accept-scene-1",
+      expectedAttemptOrdinal: 1,
+      acceptedBy: "operator"
+    });
+    expect(accept1Replay).toEqual(accept1);
+
+    // 3b. Idempotent conflict on accept scene 1
+    await expect(
+      acceptUseCase.execute({
+        acceptanceRunId: beginRes.acceptanceRunId,
+        sceneId: scenes[0]!.id,
+        actionId: "act-accept-scene-1",
+        expectedAttemptOrdinal: 2,
+        acceptedBy: "operator"
+      })
+    ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
+
     // Still cannot assemble (scene 2 not accepted)
     await expect(
       assembleUseCase.execute({
@@ -305,6 +360,23 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     expect(assembleRes.status).toBe("assembling");
     expect(assembleRes.assemblyJobId).toBeDefined();
 
+    // 5a. Idempotent replay of assemble
+    const assembleReplay = await assembleUseCase.execute({
+      acceptanceRunId: beginRes.acceptanceRunId,
+      actionId: "act-assemble-final",
+      requestedBy: "operator"
+    });
+    expect(assembleReplay).toEqual(assembleRes);
+
+    // 5b. Idempotent conflict on assemble with altered requestedBy
+    await expect(
+      assembleUseCase.execute({
+        acceptanceRunId: beginRes.acceptanceRunId,
+        actionId: "act-assemble-final",
+        requestedBy: "different-operator"
+      })
+    ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
+
     // Verify stored acceptance run state
     await uow.execute(async (context) => {
       const run = await context.operatorAcceptanceRuns!.findRunById(beginRes.acceptanceRunId);
@@ -490,4 +562,98 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
       expect(res.assemblyJobId).toBeDefined();
     });
   });
+
+  it("AcceptOperatorAcceptanceSceneUseCase rejects stem with frame count mismatch or invalid checksum", async () => {
+    const { campaignId, scenes, stagingPlan, uow } = setupStagingCampaign(1);
+    await uow.execute(async (context) => {
+      await context.durationPlans!.savePlan(stagingPlan);
+    });
+
+    const mockGrant: H3CandidateAuthorizationGrant = {
+      payload: {
+        version: 1,
+        candidateKey: stagingCandidateRef2v.profileKey as H3CandidateProfileKey,
+        specificationDigest: "b".repeat(64),
+        goldMasterWorkflowHash: "c".repeat(64),
+        goldMasterModelHashesDigest: "d".repeat(64),
+        targetHostname: "test-host",
+        targetGpuUuid: "GPU-1234",
+        purpose: "staging",
+        scope: "staging",
+        issuedAt: new Date(Date.now() - 60_000).toISOString(),
+        expiresAt: new Date(Date.now() + 60_000).toISOString(),
+        operatorId: "operator-1"
+      },
+      signature: "0123456789abcdef".repeat(4),
+      signerKeyId: "auth-1"
+    };
+
+    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
+      listAuthorizedCandidates: async () => [
+        stagingCandidateRef2v as StagingCandidateProfileSelection
+      ],
+      resolveCandidateGrant: async () => mockGrant
+    };
+
+    const seededFrames = 999; // intentionally mismatched frames
+    const mockStageRenderUseCase = {
+      executeWithContext: async (_context: unknown, _input: unknown) => {
+        const jobId = randomUUID();
+        uow.seedVideoStemSource(jobId, {
+          generationManifestId: randomUUID(),
+          renderAttempt: 1,
+          executionScope: "staging",
+          ownerKind: "staging_acceptance",
+          realm: isolatedTestRealm,
+          evidenceOrigin: "simulated_test",
+          renderProfile: stagingCandidateRef2v.profileKey,
+          frames: seededFrames,
+          measuredMedia: {
+            outputKey: "videos/stem-bad.mp4",
+            checksumSha256: "0".repeat(64),
+            container: "ffprobe",
+            dimensions: { width: 720, height: 1280 },
+            frameCount: seededFrames,
+            fps: 24,
+            durationMs: 5167,
+            formatDurationMs: 5167,
+            measurement: "source_bytes"
+          },
+          media: {
+            bucket: "staging-bucket",
+            key: "videos/stem-bad.mp4",
+            sha256: "0".repeat(64),
+            contentType: "video/mp4"
+          }
+        });
+        return {
+          job: { jobId },
+          attemptId: randomUUID()
+        };
+      }
+    } as unknown as StageH3CandidateRenderUseCase;
+
+    const beginUseCase = new BeginOperatorAcceptanceRunUseCase({
+      uow,
+      stagingAuthSource: mockStagingAuthSource,
+      stageRenderUseCase: mockStageRenderUseCase
+    });
+    const acceptUseCase = new AcceptOperatorAcceptanceSceneUseCase({ uow });
+
+    const beginRes = await beginUseCase.execute({
+      campaignId,
+      actionId: "act-begin-mismatch-test",
+      requestedBy: "operator"
+    });
+
+    await expect(
+      acceptUseCase.execute({
+        acceptanceRunId: beginRes.acceptanceRunId,
+        sceneId: scenes[0]!.id,
+        actionId: "act-accept-bad-stem",
+        expectedAttemptOrdinal: 1,
+        acceptedBy: "operator"
+      })
+    ).rejects.toThrow(/does not match scene frames/i);
+  });
 });
diff --git a/packages/application/src/use-cases/operator-acceptance-run.ts b/packages/application/src/use-cases/operator-acceptance-run.ts
index d9e0bf2..e22a250 100644
--- a/packages/application/src/use-cases/operator-acceptance-run.ts
+++ b/packages/application/src/use-cases/operator-acceptance-run.ts
@@ -1,4 +1,4 @@
-import { randomUUID } from "node:crypto";
+import { createHash, randomUUID } from "node:crypto";
 import {
   type AcceptanceAssemblyJob,
   type AcceptanceRunScene,
@@ -7,12 +7,14 @@ import {
   type BeginOperatorAcceptanceRunRequest,
   type BeginOperatorAcceptanceRunResponse,
   type OperatorAcceptanceRun,
+  canonicalizeJson,
   CampaignDurationPlanningError,
   OperatorAcceptanceRunNotFoundError,
   OperatorAcceptanceSceneNotFoundError,
   OperatorAcceptanceOrdinalMismatchError,
   OperatorAcceptanceInvalidStatusError,
-  OperatorAcceptanceSceneNotAcceptedError
+  OperatorAcceptanceSceneNotAcceptedError,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import type { UnitOfWork } from "../ports/unit-of-work.js";
 import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
@@ -20,6 +22,192 @@ import type { StagingPlanningAuthorizationSource } from "../ports/staging-planni
 import type { VideoStemSourceRecord } from "../ports/generation-manifest-repository.js";
 import { validateAssemblySpec } from "../ports/assembly-spec.js";
 
+export function computeAcceptanceActionRequestHash(action: string, payload: unknown): string {
+  return createHash("sha256").update(canonicalizeJson({ action, payload })).digest("hex");
+}
+
+export function deterministicUuid(seed: string): string {
+  const hash = createHash("sha256").update(seed).digest("hex");
+  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
+}
+
+export function validateAcceptanceStemSource(
+  scene: AcceptanceRunScene,
+  stemSource: VideoStemSourceRecord,
+  expectedRunContext?: {
+    realm?: unknown;
+    evidenceOrigin?: unknown;
+  }
+): void {
+  if (!stemSource.renderProfile || stemSource.renderProfile !== scene.profileKey) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem renderProfile '${stemSource.renderProfile}' does not match scene profileKey '${scene.profileKey}'`
+    );
+  }
+
+  if (stemSource.frames === undefined || stemSource.frames !== scene.frames) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem frame count ${stemSource.frames} does not match scene frames ${scene.frames}`
+    );
+  }
+
+  if (stemSource.fps === undefined || Math.abs(stemSource.fps - scene.fps) > 0.01) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem fps ${stemSource.fps} does not match scene fps ${scene.fps}`
+    );
+  }
+
+  if (!stemSource.sceneId || stemSource.sceneId !== scene.sceneId) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem sceneId '${stemSource.sceneId}' does not match expected sceneId '${scene.sceneId}'`
+    );
+  }
+
+  if (
+    !scene.candidateSpecificationDigest ||
+    !stemSource.candidateSpecificationDigest ||
+    stemSource.candidateSpecificationDigest !== scene.candidateSpecificationDigest
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem candidateSpecificationDigest '${stemSource.candidateSpecificationDigest}' does not match expected '${scene.candidateSpecificationDigest}'`
+    );
+  }
+
+  if (stemSource.specRevision === undefined || stemSource.specRevision !== scene.specRevision) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem specRevision ${stemSource.specRevision} does not match scene specRevision ${scene.specRevision}`
+    );
+  }
+
+  if (stemSource.executionScope !== "staging") {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem executionScope '${stemSource.executionScope}' must be 'staging'`
+    );
+  }
+
+  if (stemSource.ownerKind !== "staging_acceptance") {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem ownerKind '${stemSource.ownerKind}' must be 'staging_acceptance'`
+    );
+  }
+
+  if (!stemSource.acceptanceRunId || stemSource.acceptanceRunId !== scene.acceptanceRunId) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem acceptanceRunId '${stemSource.acceptanceRunId}' does not match scene acceptanceRunId '${scene.acceptanceRunId}'`
+    );
+  }
+
+  if (!stemSource.realm) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem source is missing required realm`
+    );
+  }
+
+  if (!stemSource.evidenceOrigin) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem source is missing required evidenceOrigin`
+    );
+  }
+
+  if (
+    expectedRunContext?.realm &&
+    canonicalizeJson(stemSource.realm) !== canonicalizeJson(expectedRunContext.realm)
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem realm does not match acceptance run realm`
+    );
+  }
+
+  if (
+    expectedRunContext?.evidenceOrigin &&
+    stemSource.evidenceOrigin !== expectedRunContext.evidenceOrigin
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem evidenceOrigin '${stemSource.evidenceOrigin}' does not match acceptance run evidenceOrigin '${expectedRunContext.evidenceOrigin}'`
+    );
+  }
+
+  if (!stemSource.measuredMedia) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem source is missing required measuredMedia`
+    );
+  }
+
+  if (stemSource.measuredMedia.frameCount !== scene.frames) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia frameCount ${stemSource.measuredMedia.frameCount} does not match scene frames ${scene.frames}`
+    );
+  }
+
+  if (
+    stemSource.measuredMedia.fps === undefined ||
+    stemSource.measuredMedia.fps === null ||
+    Math.abs(stemSource.measuredMedia.fps - scene.fps) > 0.01
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia fps ${stemSource.measuredMedia.fps} does not match scene fps ${scene.fps}`
+    );
+  }
+
+  if (!stemSource.measuredMedia.dimensions) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      "Video stem measuredMedia is missing required dimensions"
+    );
+  }
+
+  if (
+    stemSource.measuredMedia.dimensions.width !== 1344 ||
+    stemSource.measuredMedia.dimensions.height !== 768
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia dimensions ${stemSource.measuredMedia.dimensions.width}x${stemSource.measuredMedia.dimensions.height} do not match configured 1344x768`
+    );
+  }
+
+  if (Math.abs(stemSource.measuredMedia.durationMs - scene.expectedDurationMs) > 355) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia duration ${stemSource.measuredMedia.durationMs}ms exceeds tolerance of expected duration ${scene.expectedDurationMs}ms`
+    );
+  }
+
+  if (!stemSource.media.sha256 || stemSource.media.sha256.length !== 64) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem media sha256 is invalid or empty`
+    );
+  }
+
+  if (
+    !stemSource.outputChecksumsSha256 ||
+    stemSource.outputChecksumsSha256.length === 0 ||
+    !stemSource.outputChecksumsSha256.includes(stemSource.media.sha256)
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem media sha256 '${stemSource.media.sha256}' is not present in outputChecksumsSha256`
+    );
+  }
+}
+
 export interface OperatorAcceptanceRunDependencies {
   readonly uow: UnitOfWork;
   readonly stageRenderUseCase?: StageH3CandidateRenderUseCase | undefined;
@@ -66,10 +254,45 @@ export class BeginOperatorAcceptanceRunUseCase {
         );
       }
 
+      const requestHash = computeAcceptanceActionRequestHash("begin", {
+        campaignId: input.campaignId,
+        actionId: input.actionId,
+        requestedBy: input.requestedBy,
+        planId: currentPlan.planId,
+        planRevision: currentPlan.revision,
+        realm: currentPlan.realm,
+        allocations: currentPlan.allocations.map((a) => ({
+          allocationId: a.allocationId,
+          profileKey: a.profileSelection.profileKey,
+          specificationDigest:
+            a.profileSelection.kind === "staging_candidate"
+              ? a.profileSelection.specificationDigest
+              : undefined,
+          frames: a.frames,
+          fps: a.fps,
+          nominalDurationMs: a.nominalDurationMs
+        }))
+      });
+
+      if (context.operatorAcceptanceRuns.findActionReceipt) {
+        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+          "begin",
+          input.campaignId,
+          input.actionId
+        );
+        if (existingReceipt) {
+          if (existingReceipt.requestHash !== requestHash) {
+            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+          }
+          return existingReceipt.response as unknown as BeginOperatorAcceptanceRunResponse;
+        }
+      }
+
       const scenes = await context.scenes.findByCampaignId(campaign.id);
       const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
 
-      const acceptanceRunId = randomUUID();
+      const acceptanceRunSeed = `acceptance-run:${campaign.id}:${currentPlan.planId}:${input.actionId}`;
+      const acceptanceRunId = deterministicUuid(acceptanceRunSeed);
       const now = new Date().toISOString();
 
       const run: OperatorAcceptanceRun = {
@@ -137,7 +360,7 @@ export class BeginOperatorAcceptanceRunUseCase {
           sceneId: scene.id,
           candidateProfileKey: candidateKey,
           grant,
-          requestId: `stage-${acceptanceRunId}-${scene.id}`,
+          requestId: `stage-${campaign.id}-${currentPlan.planId}-${scene.id}-${input.actionId}`,
           ownerKind: "staging_acceptance",
           acceptanceRunId
         });
@@ -160,19 +383,55 @@ export class BeginOperatorAcceptanceRunUseCase {
           currentAttemptOrdinal: 1,
           acceptedStagingJobId: stagingJobId,
           acceptedAttemptId: undefined,
-          acceptedAttemptOrdinal: undefined
+          acceptedAttemptOrdinal: undefined,
+          candidateSpecificationDigest:
+            allocation.profileSelection.kind === "staging_candidate"
+              ? allocation.profileSelection.specificationDigest
+              : undefined,
+          planId: currentPlan.planId
         });
       }
 
-      await context.operatorAcceptanceRuns.createRun(run, runScenes);
+      try {
+        await context.operatorAcceptanceRuns.createRun(run, runScenes);
+      } catch (createErr) {
+        if (context.operatorAcceptanceRuns.findActionReceipt) {
+          const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+            "begin",
+            input.campaignId,
+            input.actionId
+          );
+          if (existingReceipt) {
+            if (existingReceipt.requestHash !== requestHash) {
+              throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+            }
+            return existingReceipt.response as unknown as BeginOperatorAcceptanceRunResponse;
+          }
+        }
+        throw createErr;
+      }
 
-      return {
+      const response: BeginOperatorAcceptanceRunResponse = {
         acceptanceRunId,
         campaignId: campaign.id,
         status: "dispatched",
         sceneCount: sortedScenes.length,
         dispatchedJobIds
       };
+
+      if (context.operatorAcceptanceRuns.saveActionReceipt) {
+        await context.operatorAcceptanceRuns.saveActionReceipt({
+          actionId: input.actionId,
+          scope: "begin",
+          runOrCampaignId: input.campaignId,
+          realm: currentPlan.realm,
+          requestHash,
+          response: response as unknown as Record<string, unknown>,
+          createdAt: now
+        });
+      }
+
+      return response;
     });
   }
 }
@@ -197,6 +456,29 @@ export class AcceptOperatorAcceptanceSceneUseCase {
         throw new OperatorAcceptanceRunNotFoundError(input.acceptanceRunId);
       }
 
+      const requestHash = computeAcceptanceActionRequestHash("accept_scene", {
+        acceptanceRunId: input.acceptanceRunId,
+        sceneId: input.sceneId,
+        actionId: input.actionId,
+        expectedAttemptOrdinal: input.expectedAttemptOrdinal,
+        acceptedBy: input.acceptedBy
+      });
+
+      const actionKey = `${input.acceptanceRunId}:${input.sceneId}:${input.actionId}`;
+      if (context.operatorAcceptanceRuns.findActionReceipt) {
+        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+          "accept_scene",
+          input.acceptanceRunId,
+          actionKey
+        );
+        if (existingReceipt) {
+          if (existingReceipt.requestHash !== requestHash) {
+            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+          }
+          return existingReceipt.response as unknown as { readonly accepted: boolean };
+        }
+      }
+
       const runScenes = await context.operatorAcceptanceRuns.findRunScenes(input.acceptanceRunId);
       const scene = runScenes.find((s) => s.sceneId === input.sceneId);
       if (!scene) {
@@ -240,12 +522,10 @@ export class AcceptOperatorAcceptanceSceneUseCase {
         );
       }
 
-      if (!stemSource.measuredMedia) {
-        throw new CampaignDurationPlanningError(
-          "observation_authority_invalid",
-          `Video stem source for staging job '${stagingJobId}' is missing required measuredMedia`
-        );
-      }
+      validateAcceptanceStemSource(scene, stemSource, {
+        realm: run.realm,
+        evidenceOrigin: run.evidenceOrigin
+      });
 
       await context.operatorAcceptanceRuns.updateSceneAcceptedAttempt(
         input.acceptanceRunId,
@@ -255,7 +535,21 @@ export class AcceptOperatorAcceptanceSceneUseCase {
         scene.currentAttemptOrdinal
       );
 
-      return { accepted: true };
+      const response = { accepted: true };
+
+      if (context.operatorAcceptanceRuns.saveActionReceipt) {
+        await context.operatorAcceptanceRuns.saveActionReceipt({
+          actionId: actionKey,
+          scope: "accept_scene",
+          runOrCampaignId: input.acceptanceRunId,
+          realm: run.realm,
+          requestHash,
+          response: response as unknown as Record<string, unknown>,
+          createdAt: new Date().toISOString()
+        });
+      }
+
+      return response;
     });
   }
 }
@@ -279,6 +573,26 @@ export class AssembleOperatorAcceptanceRunUseCase {
         throw new OperatorAcceptanceRunNotFoundError(input.acceptanceRunId);
       }
 
+      const requestHash = computeAcceptanceActionRequestHash("assemble", {
+        acceptanceRunId: input.acceptanceRunId,
+        actionId: input.actionId,
+        requestedBy: input.requestedBy
+      });
+
+      if (context.operatorAcceptanceRuns.findActionReceipt) {
+        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+          "assemble",
+          input.acceptanceRunId,
+          input.actionId
+        );
+        if (existingReceipt) {
+          if (existingReceipt.requestHash !== requestHash) {
+            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+          }
+          return existingReceipt.response as unknown as AssembleOperatorAcceptanceRunResponse;
+        }
+      }
+
       if (
         (run.status === "assembling" || run.status === "completed") &&
         run.assemblyJobId &&
@@ -336,6 +650,10 @@ export class AssembleOperatorAcceptanceRunUseCase {
             `Generation manifest and video stem source not found for accepted staging job '${s.acceptedStagingJobId}'`
           );
         }
+        validateAcceptanceStemSource(s, stemSource, {
+          realm: run.realm,
+          evidenceOrigin: run.evidenceOrigin
+        });
         videoStems.push({
           order: idx,
           sceneId: s.sceneId,
@@ -371,11 +689,25 @@ export class AssembleOperatorAcceptanceRunUseCase {
         input.actionId
       );
 
-      return {
+      const response: AssembleOperatorAcceptanceRunResponse = {
         acceptanceRunId: run.acceptanceRunId,
         assemblyJobId,
         status: "assembling"
       };
+
+      if (context.operatorAcceptanceRuns.saveActionReceipt) {
+        await context.operatorAcceptanceRuns.saveActionReceipt({
+          actionId: input.actionId,
+          scope: "assemble",
+          runOrCampaignId: run.acceptanceRunId,
+          realm: run.realm,
+          requestHash,
+          response: response as unknown as Record<string, unknown>,
+          createdAt: new Date().toISOString()
+        });
+      }
+
+      return response;
     });
   }
 }
diff --git a/packages/application/src/use-cases/replan-campaign.test.ts b/packages/application/src/use-cases/replan-campaign.test.ts
index 676a502..57a21a7 100644
--- a/packages/application/src/use-cases/replan-campaign.test.ts
+++ b/packages/application/src/use-cases/replan-campaign.test.ts
@@ -2,10 +2,13 @@ import { describe, expect, it } from "vitest";
 import { Scene, type CampaignId, type CampaignRecord, type SceneId } from "@cco/domain";
 import {
   CampaignDurationPlanningError,
+  computeH3ReleaseKey,
   type CampaignDurationPlan,
   type DeployedRealm,
-  type ExecutionProfileSelection
+  type ExecutionProfileSelection,
+  type StagingCandidateProfileSelection
 } from "@cco/contracts";
+import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
 import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
 import { PreviewCampaignReplanUseCase, CommitCampaignReplanUseCase } from "./replan-campaign.js";
@@ -374,4 +377,308 @@ describe("Campaign duration replan and review guards", () => {
       expect(s0?.status).not.toBe("approved");
     });
   });
+
+  it("PreviewCampaignReplanUseCase and CommitCampaignReplanUseCase succeed for 243f candidate profile with stagingAuthSource", async () => {
+    const candidateKey = "H3_CANDIDATE_da62255eb7245c2cc0ac588325ccd3d3_V1";
+    const stagingCandidateSelection: StagingCandidateProfileSelection = {
+      kind: "staging_candidate",
+      profileKey: candidateKey,
+      specificationDigest: "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7",
+      targetId: "llama",
+      authorizationId: "auth-243f"
+    };
+
+    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
+      listAuthorizedCandidates: async () => [stagingCandidateSelection],
+      resolveCandidateGrant: async () => undefined
+    };
+
+    const mockRegistryReader = {
+      getCandidateProfile: () => undefined,
+      listCandidateProfiles: () => [],
+      isCandidateProfileKey: () => true,
+      resolveH3ProfileFrameCapabilities: (key: string | undefined) =>
+        key === candidateKey
+          ? {
+              profileKey: key,
+              route: "ref2v" as const,
+              routingMode: "reference_directed" as const,
+              width: 1344,
+              height: 768,
+              fps: 24,
+              allowedFrameCounts: [243],
+              isAllowedFrameCount: (f: number) => f === 243
+            }
+          : undefined,
+      isFrameCountAllowedForH3Profile: () => true
+    };
+
+    const { campaignId, scenes, uow } = setupCampaignWithScenes(2);
+    const stagingPlan = planFeasibleCampaignDuration({
+      campaignId,
+      targetTotalDurationMs: 20000,
+      selectedProfileSelection: stagingCandidateSelection,
+      realm: {
+        kind: "isolated_test",
+        testRealmId: "realm-1",
+        isolationDescriptorDigest: "a".repeat(64)
+      },
+      scope: "staging",
+      capabilities: new Map([
+        [candidateKey, mockRegistryReader.resolveH3ProfileFrameCapabilities(candidateKey)!]
+      ])
+    });
+
+    await uow.execute(async (context) => {
+      const camp = await context.campaigns!.findById(campaignId);
+      await context.campaigns!.save({
+        ...camp!,
+        targetTotalDurationMs: 20000
+      });
+      await context.durationPlans!.savePlan(stagingPlan);
+    });
+
+    const previewUseCase = new PreviewCampaignReplanUseCase({
+      uow,
+      stagingAuthSource: mockStagingAuthSource,
+      registryReader: mockRegistryReader
+    });
+
+    const previewResult = await previewUseCase.execute({
+      campaignId,
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: candidateKey
+    });
+
+    expect(previewResult.feasible).toBe(true);
+    expect(previewResult.proposedPlan?.allocations[0]?.frames).toBe(243);
+
+    const commitUseCase = new CommitCampaignReplanUseCase({
+      uow,
+      stagingAuthSource: mockStagingAuthSource,
+      registryReader: mockRegistryReader
+    });
+
+    const commitResult = await commitUseCase.execute({
+      campaignId,
+      actionId: "replan-staging-243f",
+      expectedPlanRevision: 1,
+      expectedSceneSpecRevisions: {
+        [scenes[0]!.id]: 1,
+        [scenes[1]!.id]: 1
+      },
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: candidateKey
+    });
+
+    expect(commitResult.newPlanRevision).toBe(2);
+    expect(commitResult.plan.allocations[0]?.frames).toBe(243);
+  });
+
+  it("PreviewCampaignReplanUseCase rejects single scene exceeding 15000ms max scene ceiling", async () => {
+    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);
+
+    await uow.execute(async (context) => {
+      const camp = await context.campaigns!.findById(campaignId);
+      await context.campaigns!.save({
+        ...camp!,
+        targetTotalDurationMs: 20000
+      });
+      await context.durationPlans!.savePlan(plan);
+    });
+
+    const previewUseCase = new PreviewCampaignReplanUseCase({ uow });
+
+    const previewResult = await previewUseCase.execute({
+      campaignId,
+      sceneIdDurations: {
+        [scenes[0]!.id]: 16000,
+        [scenes[1]!.id]: 4000
+      }
+    });
+
+    expect(previewResult.feasible).toBe(false);
+    expect(previewResult.error).toContain("exceeds maximum permissible scene duration 15000ms");
+  });
+
+  it("PreviewCampaignReplanUseCase and CommitCampaignReplanUseCase succeed for test-authorized released_production profile in production scope", async () => {
+    const releaseDigest = "b".repeat(64);
+    const releaseKey = computeH3ReleaseKey(releaseDigest, 1);
+    const spec = {
+      version: 1 as const,
+      route: "ref2v" as const,
+      routingMode: "reference_directed" as const,
+      workflowHash: "c".repeat(64),
+      frames: 243,
+      fps: 24 as const,
+      width: 1344,
+      height: 768,
+      sampler: "res_multistep",
+      scheduler: "simple",
+      steps: 4,
+      cfg: 1,
+      denoise: 1,
+      modelHashes: {
+        checkpoint: "1".repeat(64),
+        clip: "2".repeat(64),
+        audioVae: "3".repeat(64),
+        videoVae: "4".repeat(64),
+        turboLora: "5".repeat(64),
+        additionalModels: {}
+      },
+      attention: {
+        backend: "comfy_native" as const,
+        customNodeRevision: "none",
+        customNodeSourceHash: "none",
+        packageVersion: "none",
+        sparsitySettings: {
+          enabled: false as const,
+          method: "none" as const,
+          threshold: 0 as const
+        }
+      },
+      customNodes: [],
+      packageVersions: {
+        torch: "2.13.0+cu130",
+        comfyui: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
+      },
+      runnerSettings: {
+        runnerProfile: "dynamicvram-offload-v1",
+        offloadPolicy: "dynamicvram" as const,
+        requiresModelOffloading: true,
+        maxConcurrentGpuJobs: 1,
+        minFreeDiskGb: 20
+      },
+      expectedCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+      expectedPythonExecutable: "/bin/python3"
+    };
+
+    const releasedProfile = {
+      key: releaseKey,
+      version: 1 as const,
+      specificationDigest: releaseDigest,
+      specification: spec,
+      topology: {
+        prompt: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "prompt" },
+        seed: { nodeId: "2", classType: "RandomNoise", inputField: "noise_seed" },
+        frameCount: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "length" },
+        referenceImage: { nodeId: "3", classType: "LoadImage", inputField: "image" },
+        firstFrame: { nodeId: "3", classType: "LoadImage", inputField: "image" },
+        width: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "width" },
+        height: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "height" }
+      },
+      releaseId: "rel-1",
+      signedReleaseDigest: "d".repeat(64),
+      certificationRecordDigest: "e".repeat(64),
+      deploymentEnablementDigest: "f".repeat(64),
+      speedDecision: {
+        specificationDigest: releaseDigest,
+        specification: spec,
+        speedVerdict: "pass" as const,
+        qualityVerdict: "pass" as const,
+        overallVerdict: "pass" as const,
+        evidenceDigests: [],
+        operatorIdentity: "operator",
+        decidedAt: new Date().toISOString()
+      },
+      certificationVerdict: "released" as const,
+      operatorIdentity: "operator",
+      releasedAt: new Date().toISOString()
+    };
+
+    const mockProductionReleaseReader = {
+      listReleasedProfiles: async () => [releasedProfile],
+      getReleasedProfile: async (key: string) => (key === releaseKey ? releasedProfile : undefined),
+      isReleasedProfileKey: async (key: string) => key === releaseKey,
+      getDeploymentEnablementState: async () => undefined
+    };
+
+    const { campaignId, scenes, uow } = setupCampaignWithScenes(2);
+    const prodPlan = planFeasibleCampaignDuration({
+      campaignId,
+      targetTotalDurationMs: 20000,
+      selectedProfileSelection: {
+        kind: "released_production",
+        profileKey: releaseKey,
+        specificationDigest: releaseDigest,
+        releaseId: "rel-1",
+        signedReleaseDigest: "d".repeat(64),
+        certificationRecordDigest: "e".repeat(64),
+        deploymentEnablementDigest: "f".repeat(64)
+      },
+      realm: { kind: "deployed", deploymentId: "prod-deploy-1" },
+      scope: "production",
+      capabilities: new Map([
+        [
+          releaseKey,
+          {
+            profileKey: releaseKey,
+            route: "ref2v" as const,
+            routingMode: "reference_directed" as const,
+            width: 1344,
+            height: 768,
+            fps: 24,
+            allowedFrameCounts: [243],
+            isAllowedFrameCount: (f: number) => f === 243
+          }
+        ]
+      ])
+    });
+
+    await uow.execute(async (context) => {
+      const camp = await context.campaigns!.findById(campaignId);
+      await context.campaigns!.save({
+        ...camp!,
+        targetTotalDurationMs: 20000
+      });
+      await context.durationPlans!.savePlan(prodPlan);
+    });
+
+    const previewUseCase = new PreviewCampaignReplanUseCase({
+      uow,
+      productionReleaseReader: mockProductionReleaseReader
+    });
+
+    const previewResult = await previewUseCase.execute({
+      campaignId,
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: releaseKey
+    });
+
+    expect(previewResult.feasible).toBe(true);
+    expect(previewResult.proposedPlan?.allocations[0]?.frames).toBe(243);
+
+    const commitUseCase = new CommitCampaignReplanUseCase({
+      uow,
+      productionReleaseReader: mockProductionReleaseReader
+    });
+
+    const commitResult = await commitUseCase.execute({
+      campaignId,
+      actionId: "replan-prod-released-243f",
+      expectedPlanRevision: 1,
+      expectedSceneSpecRevisions: {
+        [scenes[0]!.id]: 1,
+        [scenes[1]!.id]: 1
+      },
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: releaseKey
+    });
+
+    expect(commitResult.newPlanRevision).toBe(2);
+    expect(commitResult.plan.allocations[0]?.frames).toBe(243);
+    expect(commitResult.plan.scope).toBe("production");
+  });
 });
diff --git a/packages/application/src/use-cases/replan-campaign.ts b/packages/application/src/use-cases/replan-campaign.ts
index f38f171..d181396 100644
--- a/packages/application/src/use-cases/replan-campaign.ts
+++ b/packages/application/src/use-cases/replan-campaign.ts
@@ -1,22 +1,30 @@
 import { createHash, randomUUID } from "node:crypto";
 import {
-  type CampaignDurationPlan,
   type ExecutionProfileSelection,
   type ReplanCampaignPreviewRequest,
   type ReplanCampaignPreviewResponse,
   type ReplanCampaignCommitRequest,
   type ReplanCampaignCommitResponse,
   type SceneDurationBinding,
-  type LegacyProductionProfileKey,
+  type H3CapabilityResolverReader,
+  type H3ProfileFrameCapability,
   computePlanBindingDigest,
-  isReleasedProductionProfileKey,
-  isStagingCandidateProfileKey,
   CampaignDurationPlanningError
 } from "@cco/contracts";
 import type { ReplanActionReceipt } from "../ports/campaign-duration-plan-repository.js";
 import type { UnitOfWork } from "../ports/unit-of-work.js";
+import type { ProductionReleaseCapabilityReader } from "../ports/production-release-ports.js";
+import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
 import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
+import { ProfileSelectionResolver } from "./profile-selection-resolver.js";
+
+export interface ReplanCampaignDependencies {
+  readonly uow: UnitOfWork;
+  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
+  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
+  readonly registryReader?: H3CapabilityResolverReader | undefined;
+}
 
 export function computeReplanRequestHash(input: ReplanCampaignCommitRequest): string {
   const sortedSceneDurations = Object.keys(input.sceneIdDurations)
@@ -33,43 +41,14 @@ export function computeReplanRequestHash(input: ReplanCampaignCommitRequest): st
     selectedProfileKey: input.selectedProfileKey ?? null,
     allowedDurationProfileKeys: input.allowedDurationProfileKeys
       ? [...input.allowedDurationProfileKeys].sort()
-      : null
+      : null,
+    principal: input.principal ?? null
   };
   return createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
 }
 
-function resolveProfileSelection(
-  key: string,
-  existingPlan?: CampaignDurationPlan
-): ExecutionProfileSelection {
-  if (existingPlan) {
-    for (const alloc of existingPlan.allocations) {
-      if (alloc.profileSelection.profileKey === key) {
-        return alloc.profileSelection;
-      }
-    }
-  }
-  if (isReleasedProductionProfileKey(key)) {
-    throw new CampaignDurationPlanningError(
-      "release_unavailable",
-      `Cannot fabricate unverified digests for released production profile: ${key}`
-    );
-  }
-  if (isStagingCandidateProfileKey(key)) {
-    throw new CampaignDurationPlanningError(
-      "capability_unavailable",
-      `Cannot fabricate unverified authorization grant for staging candidate profile: ${key}`
-    );
-  }
-  return {
-    kind: "legacy_production",
-    profileKey: key as LegacyProductionProfileKey,
-    version: 1
-  };
-}
-
 export class PreviewCampaignReplanUseCase {
-  constructor(private readonly deps: { readonly uow: UnitOfWork }) {}
+  constructor(private readonly deps: ReplanCampaignDependencies) {}
 
   async execute(input: ReplanCampaignPreviewRequest): Promise<ReplanCampaignPreviewResponse> {
     return await this.deps.uow.execute(async (context) => {
@@ -167,10 +146,52 @@ export class PreviewCampaignReplanUseCase {
       const allowedProfileKeys =
         input.allowedDurationProfileKeys ?? currentPlan.allowedDurationProfileKeys;
 
-      const selectedProfileSelection = resolveProfileSelection(selectedProfileKey, currentPlan);
-      const allowedProfileSelections = allowedProfileKeys.map((k: string) =>
-        resolveProfileSelection(k, currentPlan)
-      );
+      const resolver = new ProfileSelectionResolver({
+        productionReleaseReader: this.deps.productionReleaseReader,
+        stagingAuthSource: this.deps.stagingAuthSource,
+        registryReader: this.deps.registryReader
+      });
+
+      let capabilities: Map<string, H3ProfileFrameCapability>;
+      let selectedProfileSelection: ExecutionProfileSelection;
+      let allowedProfileSelections: readonly ExecutionProfileSelection[];
+      try {
+        capabilities = await resolver.buildCapabilitiesMap(input.principal);
+        selectedProfileSelection = await resolver.resolveSelection(
+          selectedProfileKey,
+          input.principal
+        );
+        allowedProfileSelections = await Promise.all(
+          allowedProfileKeys.map((k: string) => resolver.resolveSelection(k, input.principal))
+        );
+        resolver.verifyScopeAndRealm(
+          selectedProfileSelection,
+          currentPlan.scope,
+          currentPlan.realm
+        );
+        for (const allowed of allowedProfileSelections) {
+          resolver.verifyScopeAndRealm(allowed, currentPlan.scope, currentPlan.realm);
+        }
+        if (
+          !allowedProfileSelections.some(
+            (s) => s.profileKey === selectedProfileSelection.profileKey
+          )
+        ) {
+          return {
+            campaignId: input.campaignId,
+            feasible: false,
+            currentPlanRevision,
+            error: `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
+          };
+        }
+      } catch (err: unknown) {
+        return {
+          campaignId: input.campaignId,
+          feasible: false,
+          currentPlanRevision,
+          error: err instanceof Error ? err.message : String(err)
+        };
+      }
 
       try {
         const proposedPlan = planFeasibleCampaignDuration({
@@ -183,7 +204,8 @@ export class PreviewCampaignReplanUseCase {
           allowedProfileSelections,
           realm: currentPlan.realm,
           scope: currentPlan.scope,
-          envelope: currentPlan.envelope
+          envelope: currentPlan.envelope,
+          capabilities
         });
 
         return {
@@ -205,7 +227,7 @@ export class PreviewCampaignReplanUseCase {
 }
 
 export class CommitCampaignReplanUseCase {
-  constructor(private readonly deps: { readonly uow: UnitOfWork }) {}
+  constructor(private readonly deps: ReplanCampaignDependencies) {}
 
   async execute(input: ReplanCampaignCommitRequest): Promise<ReplanCampaignCommitResponse> {
     return await this.deps.uow.execute(async (context) => {
@@ -255,7 +277,7 @@ export class CommitCampaignReplanUseCase {
             `Action ID "${input.actionId}" was already processed with different request intent`
           );
         }
-        return existingReceipt.response;
+        return existingReceipt.response as ReplanCampaignCommitResponse;
       }
 
       const currentPlan = await context.durationPlans.findCurrentPlanByCampaignId(campaign.id);
@@ -326,10 +348,32 @@ export class CommitCampaignReplanUseCase {
       const allowedProfileKeys =
         input.allowedDurationProfileKeys ?? currentPlan.allowedDurationProfileKeys;
 
-      const selectedProfileSelection = resolveProfileSelection(selectedProfileKey, currentPlan);
-      const allowedProfileSelections = allowedProfileKeys.map((k: string) =>
-        resolveProfileSelection(k, currentPlan)
+      const resolver = new ProfileSelectionResolver({
+        productionReleaseReader: this.deps.productionReleaseReader,
+        stagingAuthSource: this.deps.stagingAuthSource,
+        registryReader: this.deps.registryReader
+      });
+
+      const capabilities = await resolver.buildCapabilitiesMap(input.principal);
+      const selectedProfileSelection = await resolver.resolveSelection(
+        selectedProfileKey,
+        input.principal
+      );
+      const allowedProfileSelections = await Promise.all(
+        allowedProfileKeys.map((k: string) => resolver.resolveSelection(k, input.principal))
       );
+      resolver.verifyScopeAndRealm(selectedProfileSelection, currentPlan.scope, currentPlan.realm);
+      for (const allowed of allowedProfileSelections) {
+        resolver.verifyScopeAndRealm(allowed, currentPlan.scope, currentPlan.realm);
+      }
+      if (
+        !allowedProfileSelections.some((s) => s.profileKey === selectedProfileSelection.profileKey)
+      ) {
+        throw new CampaignDurationPlanningError(
+          "no_feasible_allocation",
+          `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
+        );
+      }
 
       const newPlan = planFeasibleCampaignDuration({
         campaignId: campaign.id,
@@ -342,7 +386,8 @@ export class CommitCampaignReplanUseCase {
         allowedProfileSelections,
         realm: currentPlan.realm,
         scope: currentPlan.scope,
-        envelope: currentPlan.envelope
+        envelope: currentPlan.envelope,
+        capabilities
       });
 
       // Update all scenes: advance spec revision and invalidate approvals across entire campaign
diff --git a/packages/application/src/use-cases/stage-h3-candidate-render.ts b/packages/application/src/use-cases/stage-h3-candidate-render.ts
index 97b4156..9e519ed 100644
--- a/packages/application/src/use-cases/stage-h3-candidate-render.ts
+++ b/packages/application/src/use-cases/stage-h3-candidate-render.ts
@@ -164,6 +164,8 @@ export class StageH3CandidateRenderUseCase {
           existingJob.sceneId === input.sceneId &&
           injected.candidateProfileKey === input.candidateProfileKey &&
           injected.specRevision === snapshot.specRevision &&
+          (input.acceptanceRunId === undefined ||
+            injected.acceptanceRunId === input.acceptanceRunId) &&
           (existingGrant?.signature === input.grant.signature ||
             injected.grantSignature === input.grant.signature ||
             existingDigest === grantDigest);
diff --git a/packages/contracts/src/h3-candidate-registry.ts b/packages/contracts/src/h3-candidate-registry.ts
index c979aef..1a8e871 100644
--- a/packages/contracts/src/h3-candidate-registry.ts
+++ b/packages/contracts/src/h3-candidate-registry.ts
@@ -10,6 +10,7 @@ export interface H3CapabilityResolverReader {
     key: string | undefined
   ): Readonly<{ key: string; specification: H3CandidateExecutionSpecification }> | undefined;
   getProfileCapability?(key: string | undefined): H3ProfileFrameCapability | undefined;
+  resolveH3ProfileFrameCapabilities?(key: string | undefined): H3ProfileFrameCapability | undefined;
 }
 
 /**
@@ -114,6 +115,11 @@ export function resolveH3ProfileFrameCapabilities(
     if (directCap) return directCap;
   }
 
+  if (reader?.resolveH3ProfileFrameCapabilities) {
+    const directCap = reader.resolveH3ProfileFrameCapabilities(profileKeyOrId);
+    if (directCap) return directCap;
+  }
+
   if (reader?.getReleasedProfile) {
     const release = reader.getReleasedProfile(profileKeyOrId);
     if (release) {
diff --git a/packages/contracts/src/operator-acceptance.ts b/packages/contracts/src/operator-acceptance.ts
index ac6f8f3..602938e 100644
--- a/packages/contracts/src/operator-acceptance.ts
+++ b/packages/contracts/src/operator-acceptance.ts
@@ -1,6 +1,8 @@
 import { z } from "zod";
 import { ExecutionRealmSchema, EvidenceOriginSchema } from "./execution-realm.js";
 import { AssemblySpecSchema } from "./assembly-spec.js";
+import { sha256HashSchema } from "./persistent-media.js";
+import { AssemblyManifestSchema } from "./assembly-manifest.js";
 
 export const OperatorAcceptanceRunStatusSchema = z.enum([
   "dispatched",
@@ -45,9 +47,27 @@ export const AcceptanceRunSceneSchema = z
     currentAttemptOrdinal: z.number().int().positive().default(1),
     acceptedAttemptId: z.string().uuid().optional(),
     acceptedStagingJobId: z.string().optional(),
-    acceptedAttemptOrdinal: z.number().int().positive().optional()
+    acceptedAttemptOrdinal: z.number().int().positive().optional(),
+    candidateSpecificationDigest: sha256HashSchema.optional(),
+    planId: z.string().uuid().optional()
   })
-  .strict();
+  .strict()
+  .superRefine((val, ctx) => {
+    const hasAttempt = val.acceptedAttemptId !== undefined;
+    const hasOrdinal = val.acceptedAttemptOrdinal !== undefined;
+    if (hasAttempt !== hasOrdinal) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "acceptedAttemptId and acceptedAttemptOrdinal must be provided together"
+      });
+    }
+    if (hasAttempt && val.acceptedStagingJobId === undefined) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "acceptedStagingJobId is required when scene is accepted"
+      });
+    }
+  });
 export type AcceptanceRunScene = z.infer<typeof AcceptanceRunSceneSchema>;
 
 export const AcceptanceAssemblyJobStatusSchema = z.enum([
@@ -76,7 +96,29 @@ export const AcceptanceAssemblyJobSchema = z
     createdAt: z.string().datetime(),
     updatedAt: z.string().datetime()
   })
-  .strict();
+  .strict()
+  .superRefine((val, ctx) => {
+    if (val.status === "leased" || val.status === "rendering") {
+      if (!val.leaseToken || !val.leaseExpiresAt || !val.workerId) {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: `status '${val.status}' requires leaseToken, leaseExpiresAt, and workerId`
+        });
+      }
+    }
+    if (val.status === "completed" && !val.outputManifestId) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "status 'completed' requires outputManifestId"
+      });
+    }
+    if (val.status === "failed" && !val.failureReason) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "status 'failed' requires failureReason"
+      });
+    }
+  });
 export type AcceptanceAssemblyJob = z.infer<typeof AcceptanceAssemblyJobSchema>;
 
 export const AcceptanceAssemblyManifestSchema = z
@@ -85,12 +127,139 @@ export const AcceptanceAssemblyManifestSchema = z
     jobId: z.string().uuid(),
     acceptanceRunId: z.string().uuid(),
     campaignId: z.string().uuid(),
-    manifest: z.record(z.string(), z.unknown()),
+    realm: ExecutionRealmSchema,
+    evidenceOrigin: EvidenceOriginSchema,
+    planId: z.string().uuid(),
+    acceptedAttemptIds: z.array(z.string().uuid()),
+    manifest: AssemblyManifestSchema,
+    storageBucket: z.string().min(1),
+    storageKey: z.string().min(1),
+    storageSha256: sha256HashSchema,
+    manifestStorageBucket: z.string().min(1),
+    manifestStorageKey: z.string().min(1),
+    manifestStorageSha256: sha256HashSchema,
     createdAt: z.string().datetime()
   })
   .strict();
 export type AcceptanceAssemblyManifest = z.infer<typeof AcceptanceAssemblyManifestSchema>;
 
+export const OperatorAcceptanceActionScopeSchema = z.enum([
+  "begin",
+  "accept_scene",
+  "rerender_scene",
+  "assemble",
+  "complete"
+]);
+export type OperatorAcceptanceActionScope = z.infer<typeof OperatorAcceptanceActionScopeSchema>;
+
+export const OperatorAcceptanceActionReceiptSchema = z
+  .object({
+    actionId: z.string().trim().min(1),
+    scope: OperatorAcceptanceActionScopeSchema,
+    runOrCampaignId: z.string().uuid(),
+    realm: ExecutionRealmSchema,
+    requestHash: sha256HashSchema,
+    response: z.record(z.string(), z.unknown()),
+    createdAt: z.string().datetime()
+  })
+  .strict();
+export type OperatorAcceptanceActionReceipt = z.infer<typeof OperatorAcceptanceActionReceiptSchema>;
+
+export const AcceptanceRunReelStemLineageEntrySchema = z
+  .object({
+    sceneId: z.string().uuid(),
+    attemptId: z.string().uuid(),
+    storageKey: z.string(),
+    sha256: sha256HashSchema
+  })
+  .strict();
+export type AcceptanceRunReelStemLineageEntry = z.infer<
+  typeof AcceptanceRunReelStemLineageEntrySchema
+>;
+
+export const AcceptanceRunReelReadModelSchema = z.discriminatedUnion("status", [
+  z
+    .object({
+      status: z.literal("pending"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      message: z.string().optional()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("assembling"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      assemblyJobId: z.string().uuid(),
+      message: z.string().optional()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("completed"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      assemblyJobId: z.string().uuid(),
+      manifestId: z.string().uuid(),
+      manifest: AssemblyManifestSchema,
+      storageBucket: z.string().min(1),
+      storageKey: z.string().min(1),
+      storageSha256: sha256HashSchema,
+      manifestStorageBucket: z.string().min(1),
+      manifestStorageKey: z.string().min(1),
+      manifestStorageSha256: sha256HashSchema,
+      bytes: z.number().int().positive().optional(),
+      url: z.string().url(),
+      downloadUrl: z.string().url().optional(),
+      durationMs: z.number().int().positive(),
+      frameCount: z.number().int().positive(),
+      fps: z.number().positive(),
+      resolution: z
+        .object({
+          width: z.number().int().positive(),
+          height: z.number().int().positive()
+        })
+        .strict(),
+      stemLineage: z.array(AcceptanceRunReelStemLineageEntrySchema).optional(),
+      completedAt: z.string().datetime()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("failed"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      assemblyJobId: z.string().uuid().optional(),
+      failureReason: z.string()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("unavailable"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      reason: z.string()
+    })
+    .strict()
+]);
+export type AcceptanceRunReelReadModel = z.infer<typeof AcceptanceRunReelReadModelSchema>;
+
 export const BeginOperatorAcceptanceRunRequestSchema = z
   .object({
     campaignId: z.string().uuid(),
@@ -215,3 +384,17 @@ export class OperatorAcceptanceSceneNotAcceptedError extends Error {
     this.sceneId = sceneId;
   }
 }
+
+export class OperatorAcceptanceIdempotencyConflictError extends Error {
+  override readonly name = "OperatorAcceptanceIdempotencyConflictError";
+  readonly actionId: string;
+  readonly httpStatusCode = 409;
+
+  constructor(actionId: string, message?: string) {
+    super(
+      message ??
+        `Operator acceptance action '${actionId}' conflict: cannot replay action with different parameters`
+    );
+    this.actionId = actionId;
+  }
+}
diff --git a/packages/contracts/src/replan-campaign.ts b/packages/contracts/src/replan-campaign.ts
index e6524f0..0509d13 100644
--- a/packages/contracts/src/replan-campaign.ts
+++ b/packages/contracts/src/replan-campaign.ts
@@ -9,7 +9,8 @@ export const ReplanCampaignPreviewRequestSchema = z
     campaignId: z.string().uuid(),
     sceneIdDurations: z.record(z.string().uuid(), z.number().int().positive()),
     selectedProfileKey: z.string().trim().min(1).optional(),
-    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional()
+    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional(),
+    principal: z.string().trim().min(1).optional()
   })
   .strict();
 export type ReplanCampaignPreviewRequest = z.infer<typeof ReplanCampaignPreviewRequestSchema>;
@@ -33,7 +34,8 @@ export const ReplanCampaignCommitRequestSchema = z
     expectedSceneSpecRevisions: z.record(z.string().uuid(), z.number().int().positive()),
     sceneIdDurations: z.record(z.string().uuid(), z.number().int().positive()),
     selectedProfileKey: z.string().trim().min(1).optional(),
-    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional()
+    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional(),
+    principal: z.string().trim().min(1).optional()
   })
   .strict();
 export type ReplanCampaignCommitRequest = z.infer<typeof ReplanCampaignCommitRequestSchema>;
diff --git a/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts b/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts
index a243384..b0bb8f2 100644
--- a/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts
+++ b/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts
@@ -105,6 +105,8 @@ export interface FfmpegMediaAssemblerAdapterOptions {
   readonly defaultPreset?: string | undefined;
   readonly outputBucket?: string | undefined;
   readonly createAssemblyId?: ((spec: AssemblySpec) => string) | (() => string) | undefined;
+  readonly createOutputKey?:
+    ((campaignId: string, assemblyId: string, spec: AssemblySpec) => string) | undefined;
   readonly createStagingKey?: ((campaignId: string, assemblyId: string) => string) | undefined;
   readonly pythonPath?: string | undefined;
 }
@@ -129,6 +131,8 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
   private readonly defaultPreset: string;
   private readonly outputBucket: string;
   private readonly createAssemblyId: (spec: AssemblySpec) => string;
+  private readonly createOutputKey?:
+    ((campaignId: string, assemblyId: string, spec: AssemblySpec) => string) | undefined;
   private readonly createStagingKey?:
     ((campaignId: string, assemblyId: string) => string) | undefined;
 
@@ -180,6 +184,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
             ? (options.createAssemblyId as (s: AssemblySpec) => string)(spec)
             : (options.createAssemblyId as () => string)()
       : (spec: AssemblySpec) => computeAssemblyId(spec);
+    this.createOutputKey = options.createOutputKey;
     this.createStagingKey = options.createStagingKey;
   }
 
@@ -1018,11 +1023,25 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
 
       const outputBytes = await fs.readFile(outputPath);
       const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
-      const outputKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/output.mp4`;
+      const customInput = spec as {
+        outputKey?: string;
+        outputBucket?: string;
+        acceptanceRunId?: string;
+      };
+      const effectiveOutputBucket = customInput.outputBucket ?? this.outputBucket;
+      const outputKey =
+        customInput.outputKey ??
+        (customInput.acceptanceRunId
+          ? `acceptance-runs/${customInput.acceptanceRunId}/reel.mp4`
+          : this.createOutputKey
+            ? this.createOutputKey(spec.campaignId, assemblyId, spec)
+            : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/output.mp4`);
       const attemptId = randomUUID();
       const stagingKey = this.createStagingKey
         ? this.createStagingKey(spec.campaignId, assemblyId)
-        : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/.staging/${attemptId}/output.mp4`;
+        : customInput.acceptanceRunId
+          ? `acceptance-runs/${customInput.acceptanceRunId}/.staging/${attemptId}/output.mp4`
+          : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/.staging/${attemptId}/output.mp4`;
 
       const rawResult = {
         assemblyId,
@@ -1086,7 +1105,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
         },
         output: {
           media: {
-            bucket: this.outputBucket,
+            bucket: effectiveOutputBucket,
             key: outputKey,
             sha256: outputSha256,
             contentType: "video/mp4"
@@ -1096,7 +1115,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
           height: outputProbed.videoStream.height
         },
         stagingMedia: {
-          bucket: this.outputBucket,
+          bucket: effectiveOutputBucket,
           key: stagingKey
         },
         measuredFrameRate: outputProbed.videoStream.frameRate,
@@ -1106,7 +1125,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
       const executionResult = AssemblyExecutionResultSchema.parse(rawResult);
 
       const existingOutput = await this.objectStorage.getObject({
-        bucket: this.outputBucket,
+        bucket: effectiveOutputBucket,
         key: stagingKey
       });
       if (existingOutput) {
@@ -1135,7 +1154,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
       } else {
         try {
           await this.objectStorage.putObject({
-            bucket: this.outputBucket,
+            bucket: effectiveOutputBucket,
             key: stagingKey,
             body: outputBytes,
             contentType: "video/mp4",
@@ -1145,7 +1164,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
         } catch (err) {
           if (err instanceof ObjectAlreadyExistsError) {
             const concurrentOutput = await this.objectStorage.getObject({
-              bucket: this.outputBucket,
+              bucket: effectiveOutputBucket,
               key: stagingKey
             });
             if (!concurrentOutput || !concurrentOutput.body || concurrentOutput.body.length === 0) {
diff --git a/packages/infrastructure/src/index.ts b/packages/infrastructure/src/index.ts
index 1b28cbd..5908f8e 100644
--- a/packages/infrastructure/src/index.ts
+++ b/packages/infrastructure/src/index.ts
@@ -56,6 +56,7 @@ export { PostgresReviewEventStore } from "./postgres/repositories/postgres-revie
 export { PostgresCampaignDurationPlanRepository } from "./postgres/repositories/postgres-campaign-duration-plan-repository.js";
 export { PostgresOperatorAcceptanceRunRepository } from "./postgres/repositories/postgres-operator-acceptance-run-repository.js";
 export { PostgresAcceptanceAssemblyJobQueue } from "./postgres/repositories/postgres-acceptance-assembly-job-queue.js";
+export { PostgresAcceptanceAssemblyManifestRepository } from "./postgres/repositories/postgres-acceptance-assembly-manifest-repository.js";
 export { PostgresDeploymentEnablementStateRepository } from "./postgres/repositories/postgres-deployment-enablement-state-repository.js";
 export {
   PostgresProductEvidenceRepository,
diff --git a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
index dc534a3..ca9ee7b 100644
--- a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
+++ b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
@@ -499,7 +499,7 @@ describe("PostgreSQL audit immutability and application-role privileges integrat
     // Verify migration succeeds when no application role is configured
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
     const noRoleApplied = await runMigrations(client, { migrationsDirectory });
-    expect(noRoleApplied).toHaveLength(31);
+    expect(noRoleApplied).toHaveLength(32);
   });
 
   it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
diff --git a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
index da115dd..1e1d237 100644
--- a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
@@ -55,7 +55,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
   it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
 
-    expect(applied).toHaveLength(31);
+    expect(applied).toHaveLength(32);
     expect(applied[0]?.version).toBe("001");
     expect(applied[1]?.version).toBe("002");
     expect(applied[2]?.version).toBe("003");
@@ -87,6 +87,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
     expect(applied[28]?.version).toBe("029");
     expect(applied[29]?.version).toBe("030");
     expect(applied[30]?.version).toBe("031");
+    expect(applied[31]?.version).toBe("032");
 
     const schemaRes = await client.query(
       "SELECT version FROM schema_migrations ORDER BY version ASC"
@@ -122,7 +123,8 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       { version: "028" },
       { version: "029" },
       { version: "030" },
-      { version: "031" }
+      { version: "031" },
+      { version: "032" }
     ]);
 
     const tablesRes = await client.query<{ table_name: string }>(
@@ -162,6 +164,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "evidence_verification_events",
       "generation_manifests",
       "license_registry",
+      "operator_acceptance_action_receipts",
       "operator_acceptance_runs",
       "product_batch_facts",
       "product_batches",
diff --git a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
index 948d963..098ea08 100644
--- a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
+++ b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
@@ -68,7 +68,8 @@ describe("PostgreSQL job dispatch schema contract integration", () => {
     expect(applied.some((m) => m.version === "029")).toBe(true);
     expect(applied.some((m) => m.version === "030")).toBe(true);
     expect(applied.some((m) => m.version === "031")).toBe(true);
-    expect(applied[applied.length - 1]?.version).toBe("031");
+    expect(applied.some((m) => m.version === "032")).toBe(true);
+    expect(applied[applied.length - 1]?.version).toBe("032");
 
     // 2. Run it again and assert []
     const rerun = await runMigrations(client, { migrationsDirectory });
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts b/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts
index 08d2360..dea3584 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts
@@ -99,18 +99,17 @@ export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJob
     workerId: string,
     leaseDurationMs: number
   ): Promise<AcceptanceAssemblyJob | undefined> {
-    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
     const leaseToken = randomUUID();
     const query = `
       UPDATE acceptance_assembly_jobs
       SET status = 'leased',
           worker_id = $1,
           lease_token = $2,
-          lease_expires_at = $3,
+          lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
           updated_at = NOW()
       WHERE job_id = (
         SELECT job_id FROM acceptance_assembly_jobs
-        WHERE status = 'queued' OR (status = 'leased' AND lease_expires_at < NOW())
+        WHERE status = 'queued' OR (status IN ('leased', 'rendering') AND lease_expires_at < NOW())
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
@@ -118,26 +117,76 @@ export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJob
       RETURNING *;
     `;
 
-    const res = await this.client.query<JobRow>(query, [workerId, leaseToken, leaseExpiresAt]);
+    const res = await this.client.query<JobRow>(query, [workerId, leaseToken, leaseDurationMs]);
     if (res.rows.length === 0) return undefined;
     return mapRowToJob(res.rows[0]!);
   }
 
+  async start(jobId: string, leaseToken: string): Promise<void> {
+    const query = `
+      UPDATE acceptance_assembly_jobs
+      SET status = 'rendering',
+          updated_at = NOW()
+      WHERE job_id = $1 AND lease_token = $2::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
+    `;
+    const res = await this.client.query(query, [jobId, leaseToken]);
+    if (res.rowCount === 0) {
+      throw new Error(
+        `Failed to start acceptance assembly job ${jobId}: lease token mismatch, expired, or job not in leased/rendering status`
+      );
+    }
+  }
+
+  async heartbeat(jobId: string, leaseToken: string, leaseDurationMs: number): Promise<void> {
+    const query = `
+      UPDATE acceptance_assembly_jobs
+      SET lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
+          updated_at = NOW()
+      WHERE job_id = $1 AND lease_token = $2::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
+    `;
+    const res = await this.client.query(query, [jobId, leaseToken, leaseDurationMs]);
+    if (res.rowCount === 0) {
+      throw new Error(
+        `Failed to heartbeat acceptance assembly job ${jobId}: lease token mismatch, expired, or job not active`
+      );
+    }
+  }
+
   async complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void> {
     if (!leaseToken) {
       throw new Error(`Lease token is required to complete acceptance assembly job ${jobId}`);
     }
+    const existing = await this.findById(jobId);
+    if (existing && existing.status === "completed") {
+      if (existing.outputManifestId === outputManifestId) {
+        return;
+      }
+      throw new Error(
+        `Acceptance assembly job ${jobId} already completed with different manifest (expected ${existing.outputManifestId}, got ${outputManifestId})`
+      );
+    }
+
     const query = `
       UPDATE acceptance_assembly_jobs
       SET status = 'completed',
           output_manifest_id = $2,
+          lease_token = NULL,
+          lease_expires_at = NULL,
           updated_at = NOW()
-      WHERE job_id = $1 AND lease_token = $3::uuid;
+      WHERE job_id = $1 AND lease_token = $3::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
     `;
     const res = await this.client.query(query, [jobId, outputManifestId, leaseToken]);
     if (res.rowCount === 0) {
+      const recheck = await this.findById(jobId);
+      if (
+        recheck &&
+        recheck.status === "completed" &&
+        recheck.outputManifestId === outputManifestId
+      ) {
+        return;
+      }
       throw new Error(
-        `Failed to complete acceptance assembly job ${jobId}: lease token mismatch or job not found`
+        `Failed to complete acceptance assembly job ${jobId}: lease token mismatch, expired, or job not found`
       );
     }
   }
@@ -146,17 +195,24 @@ export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJob
     if (!leaseToken) {
       throw new Error(`Lease token is required to fail acceptance assembly job ${jobId}`);
     }
+    const existing = await this.findById(jobId);
+    if (existing && existing.status === "failed") {
+      return;
+    }
+
     const query = `
       UPDATE acceptance_assembly_jobs
       SET status = 'failed',
           failure_reason = $2,
+          lease_token = NULL,
+          lease_expires_at = NULL,
           updated_at = NOW()
-      WHERE job_id = $1 AND lease_token = $3::uuid;
+      WHERE job_id = $1 AND lease_token = $3::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
     `;
     const res = await this.client.query(query, [jobId, error, leaseToken]);
     if (res.rowCount === 0) {
       throw new Error(
-        `Failed to fail acceptance assembly job ${jobId}: lease token mismatch or job not found`
+        `Failed to fail acceptance assembly job ${jobId}: lease token mismatch, expired, or job not active`
       );
     }
   }
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
index ab5befd..e3af6aa 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
@@ -1,11 +1,13 @@
 import {
   decodeGenerationManifestOutputs,
   extractPrimaryVideoStemMedia,
+  IncompleteVideoStemSourceError,
   type GenerationManifestComponentIdentity,
   type GenerationManifestRepository,
   type VideoStemSourceRecord
 } from "@cco/application";
 import {
+  isStagingCandidateProfileKey,
   type ManifestMeasuredMedia,
   ManifestMeasuredMediaSchema,
   type ExecutionRealm,
@@ -56,11 +58,44 @@ export class PostgresGenerationManifestRepository implements GenerationManifestR
       // If outputs are not present or malformed, outputChecksumsSha256 remains empty
     }
 
+    const payloadRecord = payload as Record<string, unknown>;
+    const routingMode =
+      typeof payloadRecord.routingMode === "string" ? payloadRecord.routingMode : undefined;
+    const candidateSpecificationDigest =
+      typeof payloadRecord.candidateSpecificationDigest === "string"
+        ? payloadRecord.candidateSpecificationDigest
+        : undefined;
+
+    const isCandidateProfile =
+      typeof payload.renderProfile === "string" &&
+      (payload.renderProfile.startsWith("H3_CANDIDATE_") ||
+        isStagingCandidateProfileKey(payload.renderProfile) ||
+        Boolean(candidateSpecificationDigest));
+
+    const route =
+      payloadRecord.route === "ref2v" || payloadRecord.route === "i2v"
+        ? (payloadRecord.route as "ref2v" | "i2v")
+        : routingMode === "reference_directed"
+          ? ("ref2v" as const)
+          : routingMode === "frame_anchored"
+            ? ("i2v" as const)
+            : !isCandidateProfile &&
+                typeof payload.renderProfile === "string" &&
+                payload.renderProfile.toLowerCase().includes("ref2v")
+              ? ("ref2v" as const)
+              : !isCandidateProfile &&
+                  typeof payload.renderProfile === "string" &&
+                  payload.renderProfile.toLowerCase().includes("i2v")
+                ? ("i2v" as const)
+                : undefined;
+
     return {
       renderProfile: payload.renderProfile,
       renderProfileVersion:
         typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null,
-      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {})
+      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {}),
+      ...(route ? { route } : {}),
+      ...(candidateSpecificationDigest ? { candidateSpecificationDigest } : {})
     };
   }
 
@@ -107,14 +142,26 @@ export class PostgresGenerationManifestRepository implements GenerationManifestR
       typeof payload?.renderProfile === "string" &&
       /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(payload.renderProfile);
 
+    if (
+      row.job_execution_scope &&
+      payload?.executionScope &&
+      row.job_execution_scope !== payload.executionScope
+    ) {
+      throw new Error(
+        `Contradictory executionScope in manifest "${row.manifest_id}": job_execution_scope "${row.job_execution_scope}" does not match manifest payload executionScope "${payload.executionScope}"`
+      );
+    }
+
     const executionScope: "production" | "staging" | undefined =
-      row.job_execution_scope === "staging" ||
-      payload?.executionScope === "staging" ||
-      isCandidateProfile
-        ? "staging"
-        : row.job_execution_scope === "production" || payload?.executionScope === "production"
-          ? "production"
-          : undefined;
+      (row.job_execution_scope as "production" | "staging" | null) ??
+      (payload?.executionScope as "production" | "staging" | undefined) ??
+      (isCandidateProfile ? "staging" : undefined);
+
+    if (isCandidateProfile && executionScope === "production") {
+      throw new Error(
+        `Candidate generation manifest "${row.manifest_id}" cannot have production executionScope`
+      );
+    }
 
     let measuredMedia: ManifestMeasuredMedia | undefined;
     if (payload?.measuredMedia) {
@@ -148,10 +195,84 @@ export class PostgresGenerationManifestRepository implements GenerationManifestR
     const evidenceOrigin = payload?.evidenceOrigin as EvidenceOrigin | undefined;
     const simulationDescriptor = payload?.simulationDescriptor as SimulationDescriptor | undefined;
 
+    const renderProfile =
+      typeof payload?.renderProfile === "string" ? payload.renderProfile : undefined;
+    const sceneId = typeof payload?.sceneId === "string" ? payload.sceneId : undefined;
+    const candidateSpecificationDigest =
+      typeof payload?.candidateSpecificationDigest === "string"
+        ? payload.candidateSpecificationDigest
+        : undefined;
+    const specRevision =
+      typeof payload?.specRevision === "number" ? payload.specRevision : undefined;
+    const configuredMediaObj = payload?.configuredMedia as Record<string, unknown> | undefined;
+    const frames =
+      typeof payload?.frameCount === "number"
+        ? payload.frameCount
+        : typeof configuredMediaObj?.frameCount === "number"
+          ? (configuredMediaObj.frameCount as number)
+          : typeof payload?.frames === "number"
+            ? payload.frames
+            : undefined;
+    const fps =
+      typeof payload?.fps === "number"
+        ? payload.fps
+        : typeof configuredMediaObj?.fps === "number"
+          ? (configuredMediaObj.fps as number)
+          : undefined;
+
+    const payloadRoutingMode =
+      typeof payload?.routingMode === "string" ? payload.routingMode : undefined;
+    const route =
+      payload?.route === "ref2v" || payload?.route === "i2v"
+        ? (payload.route as "ref2v" | "i2v")
+        : payloadRoutingMode === "reference_directed"
+          ? ("ref2v" as const)
+          : payloadRoutingMode === "frame_anchored"
+            ? ("i2v" as const)
+            : !isCandidateProfile &&
+                typeof payload?.renderProfile === "string" &&
+                payload.renderProfile.toLowerCase().includes("ref2v")
+              ? ("ref2v" as const)
+              : !isCandidateProfile &&
+                  typeof payload?.renderProfile === "string" &&
+                  payload.renderProfile.toLowerCase().includes("i2v")
+                ? ("i2v" as const)
+                : undefined;
+
+    const outputChecksumsSha256: string[] = [];
+    if (payload) {
+      try {
+        const outputs = decodeGenerationManifestOutputs(
+          payload as Record<string, unknown>,
+          row.manifest_id
+        );
+        for (const out of outputs) {
+          outputChecksumsSha256.push(out.checksumSha256);
+        }
+      } catch (err) {
+        if (isCandidateProfile) {
+          throw new IncompleteVideoStemSourceError(
+            jobId,
+            `Failed to decode generation manifest outputs: ${(err as Error).message}`
+          );
+        }
+      }
+    }
+
     return {
       generationManifestId: row.manifest_id,
+      jobId,
       media,
       renderAttempt,
+      ...(renderProfile ? { renderProfile } : {}),
+      ...(route ? { route } : {}),
+      ...(payloadRoutingMode ? { routingMode: payloadRoutingMode } : {}),
+      ...(sceneId ? { sceneId } : {}),
+      ...(candidateSpecificationDigest ? { candidateSpecificationDigest } : {}),
+      ...(specRevision !== undefined ? { specRevision } : {}),
+      ...(frames !== undefined ? { frames } : {}),
+      ...(fps !== undefined ? { fps } : {}),
+      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {}),
       ...(executionScope ? { executionScope } : {}),
       ...(measuredMedia ? { measuredMedia } : {}),
       ...(realm ? { realm } : {}),
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts
index f0b5a50..b4e4062 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts
@@ -1,10 +1,14 @@
 import type { OperatorAcceptanceRunRepository } from "@cco/application";
 import {
   type AcceptanceRunScene,
+  type OperatorAcceptanceActionReceipt,
+  type OperatorAcceptanceActionScope,
   type OperatorAcceptanceRun,
   type OperatorAcceptanceRunStatus,
   OperatorAcceptanceRunSchema,
-  AcceptanceRunSceneSchema
+  AcceptanceRunSceneSchema,
+  OperatorAcceptanceActionReceiptSchema,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import type { Pool, PoolClient } from "pg";
 
@@ -38,6 +42,8 @@ interface SceneRow {
   accepted_attempt_id: string | null;
   accepted_staging_job_id: string | null;
   accepted_attempt_ordinal: number | null;
+  candidate_specification_digest: string | null;
+  plan_id: string | null;
 }
 
 function parseJsonField<T>(val: unknown): T {
@@ -90,7 +96,11 @@ function mapRowToScene(row: SceneRow): AcceptanceRunScene {
       : {}),
     ...(row.accepted_attempt_ordinal != null
       ? { acceptedAttemptOrdinal: row.accepted_attempt_ordinal }
-      : {})
+      : {}),
+    ...(row.candidate_specification_digest != null
+      ? { candidateSpecificationDigest: row.candidate_specification_digest }
+      : {}),
+    ...(row.plan_id != null ? { planId: row.plan_id } : {})
   };
   return AcceptanceRunSceneSchema.parse(raw);
 }
@@ -151,8 +161,10 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
           current_attempt_ordinal,
           accepted_attempt_id,
           accepted_staging_job_id,
-          accepted_attempt_ordinal
-        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
+          accepted_attempt_ordinal,
+          candidate_specification_digest,
+          plan_id
+        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (acceptance_run_id, scene_id) DO NOTHING;
       `;
       await this.client.query(sceneQuery, [
@@ -169,7 +181,9 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
         scene.currentAttemptOrdinal,
         scene.acceptedAttemptId ?? null,
         scene.acceptedStagingJobId ?? null,
-        scene.acceptedAttemptOrdinal ?? null
+        scene.acceptedAttemptOrdinal ?? null,
+        scene.candidateSpecificationDigest ?? null,
+        scene.planId ?? null
       ]);
     }
   }
@@ -224,20 +238,49 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
     assemblyJobId?: string,
     actionReceiptId?: string
   ): Promise<void> {
-    const query = `
-      UPDATE operator_acceptance_runs
-      SET status = $2,
-          assembly_job_id = COALESCE($3, assembly_job_id),
-          action_receipt_id = COALESCE($4, action_receipt_id),
-          updated_at = NOW()
-      WHERE acceptance_run_id = $1;
-    `;
-    await this.client.query(query, [
+    const isTerminalSettlement = status === "completed" || status === "failed";
+    const query =
+      isTerminalSettlement && assemblyJobId
+        ? `
+          UPDATE operator_acceptance_runs
+          SET status = $2,
+              assembly_job_id = COALESCE($3, assembly_job_id),
+              action_receipt_id = COALESCE($4, action_receipt_id),
+              updated_at = NOW()
+          WHERE acceptance_run_id = $1
+            AND (assembly_job_id = $3 OR assembly_job_id IS NULL)
+            AND (status = 'assembling' OR status = $2);
+        `
+        : `
+          UPDATE operator_acceptance_runs
+          SET status = $2,
+              assembly_job_id = COALESCE($3, assembly_job_id),
+              action_receipt_id = COALESCE($4, action_receipt_id),
+              updated_at = NOW()
+          WHERE acceptance_run_id = $1;
+        `;
+    const res = await this.client.query(query, [
       acceptanceRunId,
       status,
       assemblyJobId ?? null,
       actionReceiptId ?? null
     ]);
+    if (isTerminalSettlement && assemblyJobId && res.rowCount === 0) {
+      const existing = await this.findRunById(acceptanceRunId);
+      if (!existing) {
+        throw new Error(`Acceptance run '${acceptanceRunId}' not found`);
+      }
+      if (existing.status !== "assembling" && existing.status !== status) {
+        throw new Error(
+          `Cannot settle acceptance run '${acceptanceRunId}' from status '${existing.status}' to '${status}'`
+        );
+      }
+      if (existing.assemblyJobId && existing.assemblyJobId !== assemblyJobId) {
+        throw new Error(
+          `Cannot settle acceptance run '${acceptanceRunId}': assembly job mismatch (expected ${existing.assemblyJobId}, got ${assemblyJobId})`
+        );
+      }
+    }
   }
 
   async updateSceneAcceptedAttempt(
@@ -271,4 +314,87 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
     `;
     await this.client.query(query, [acceptanceRunId, sceneId, attemptId, ordinal]);
   }
+
+  async saveActionReceipt(receipt: OperatorAcceptanceActionReceipt): Promise<void> {
+    const existing = await this.findActionReceipt(
+      receipt.scope,
+      receipt.runOrCampaignId,
+      receipt.actionId
+    );
+    if (existing) {
+      if (existing.requestHash !== receipt.requestHash) {
+        throw new OperatorAcceptanceIdempotencyConflictError(receipt.actionId);
+      }
+      return;
+    }
+
+    const query = `
+      INSERT INTO operator_acceptance_action_receipts (
+        action_id,
+        scope,
+        run_or_campaign_id,
+        realm,
+        request_hash,
+        response,
+        created_at
+      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
+      ON CONFLICT (scope, run_or_campaign_id, action_id) DO NOTHING
+      RETURNING request_hash;
+    `;
+    const res = await this.client.query<{ request_hash: string }>(query, [
+      receipt.actionId,
+      receipt.scope,
+      receipt.runOrCampaignId,
+      JSON.stringify(receipt.realm),
+      receipt.requestHash,
+      JSON.stringify(receipt.response),
+      receipt.createdAt
+    ]);
+    if (res.rowCount === 0) {
+      const conflictReceipt = await this.findActionReceipt(
+        receipt.scope,
+        receipt.runOrCampaignId,
+        receipt.actionId
+      );
+      if (conflictReceipt && conflictReceipt.requestHash !== receipt.requestHash) {
+        throw new OperatorAcceptanceIdempotencyConflictError(receipt.actionId);
+      }
+    }
+  }
+
+  async findActionReceipt(
+    scope: OperatorAcceptanceActionScope | string,
+    runOrCampaignId: string,
+    actionId: string
+  ): Promise<OperatorAcceptanceActionReceipt | undefined> {
+    const query = `
+      SELECT * FROM operator_acceptance_action_receipts
+      WHERE scope = $1 AND run_or_campaign_id = $2 AND action_id = $3;
+    `;
+    const res = await this.client.query<{
+      action_id: string;
+      scope: string;
+      run_or_campaign_id: string;
+      realm: unknown;
+      request_hash: string;
+      response: unknown;
+      created_at: Date | string;
+    }>(query, [scope, runOrCampaignId, actionId]);
+
+    const row = res.rows[0];
+    if (!row) return undefined;
+
+    return OperatorAcceptanceActionReceiptSchema.parse({
+      actionId: row.action_id,
+      scope: row.scope,
+      runOrCampaignId: row.run_or_campaign_id,
+      realm: parseJsonField(row.realm),
+      requestHash: row.request_hash,
+      response: parseJsonField(row.response),
+      createdAt:
+        row.created_at instanceof Date
+          ? row.created_at.toISOString()
+          : new Date(row.created_at).toISOString()
+    });
+  }
 }
diff --git a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
index dd0ae62..4dd47e0 100644
--- a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
+++ b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
@@ -24,6 +24,7 @@ import { PostgresProductClaimRepository } from "../repositories/postgres-product
 import { PostgresCampaignDurationPlanRepository } from "../repositories/postgres-campaign-duration-plan-repository.js";
 import { PostgresOperatorAcceptanceRunRepository } from "../repositories/postgres-operator-acceptance-run-repository.js";
 import { PostgresAcceptanceAssemblyJobQueue } from "../repositories/postgres-acceptance-assembly-job-queue.js";
+import { PostgresAcceptanceAssemblyManifestRepository } from "../repositories/postgres-acceptance-assembly-manifest-repository.js";
 import { PostgresDeploymentEnablementStateRepository } from "../repositories/postgres-deployment-enablement-state-repository.js";
 
 export class PostgresUnitOfWork implements UnitOfWork {
@@ -65,6 +66,7 @@ export class PostgresUnitOfWork implements UnitOfWork {
         durationPlans: new PostgresCampaignDurationPlanRepository(client),
         operatorAcceptanceRuns: new PostgresOperatorAcceptanceRunRepository(client),
         acceptanceAssemblyJobs: new PostgresAcceptanceAssemblyJobQueue(client),
+        acceptanceAssemblyManifests: new PostgresAcceptanceAssemblyManifestRepository(client),
         deploymentEnablement: new PostgresDeploymentEnablementStateRepository(client)
       };
 
diff --git a/packages/infrastructure/src/storage/provision.integration.test.ts b/packages/infrastructure/src/storage/provision.integration.test.ts
index 85818b9..8e06cf9 100644
--- a/packages/infrastructure/src/storage/provision.integration.test.ts
+++ b/packages/infrastructure/src/storage/provision.integration.test.ts
@@ -42,16 +42,16 @@ describe("Storage Provisioning integration with real MinIO", () => {
     }
   });
 
-  it("provisions all five buckets and is idempotent on repeat execution", async () => {
+  it("provisions all six buckets and is idempotent on repeat execution", async () => {
     // 1. Initial provisioning on clean MinIO container
     const initialSummary = await provisionStorageBuckets({
       client: rawS3Client
     });
 
-    expect(initialSummary.results).toHaveLength(5);
-    expect(initialSummary.createdCount).toBe(5);
+    expect(initialSummary.results).toHaveLength(6);
+    expect(initialSummary.createdCount).toBe(6);
     expect(initialSummary.alreadyExistsCount).toBe(0);
-    expect(initialSummary.lifecycleAppliedCount).toBe(2); // temp (14d) and review (60d)
+    expect(initialSummary.lifecycleAppliedCount).toBe(3); // temp (14d), review (60d), and candidates (30d)
     expect(initialSummary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
 
     // 2. Second provisioning run against already provisioned buckets
@@ -59,10 +59,10 @@ describe("Storage Provisioning integration with real MinIO", () => {
       client: rawS3Client
     });
 
-    expect(repeatSummary.results).toHaveLength(5);
+    expect(repeatSummary.results).toHaveLength(6);
     expect(repeatSummary.createdCount).toBe(0);
-    expect(repeatSummary.alreadyExistsCount).toBe(5);
-    expect(repeatSummary.lifecycleAppliedCount).toBe(2);
+    expect(repeatSummary.alreadyExistsCount).toBe(6);
+    expect(repeatSummary.lifecycleAppliedCount).toBe(3);
     expect(repeatSummary.lifecycleSkippedCount).toBe(3);
   });
 
@@ -132,7 +132,7 @@ describe("Storage Provisioning integration with real MinIO", () => {
 
     // 2. Re-run provisioning
     const summary = await provisionStorageBuckets({ client: rawS3Client });
-    expect(summary.alreadyExistsCount).toBe(5);
+    expect(summary.alreadyExistsCount).toBe(6);
 
     // 3. Read back object and verify byte integrity
     const getRes = await rawS3Client.send(
diff --git a/packages/infrastructure/src/storage/provisioner.test.ts b/packages/infrastructure/src/storage/provisioner.test.ts
index 43be622..50ba301 100644
--- a/packages/infrastructure/src/storage/provisioner.test.ts
+++ b/packages/infrastructure/src/storage/provisioner.test.ts
@@ -122,16 +122,16 @@ describe("Storage Provisioner unit tests", () => {
     await expect(provisionBucket(client, BUCKETS.TEMP)).rejects.toThrow("Network timeout");
   });
 
-  it("provisions all five buckets in provisionStorageBuckets and returns summary", async () => {
+  it("provisions all six buckets in provisionStorageBuckets and returns summary", async () => {
     const sendFn = vi.fn().mockResolvedValue({});
     const client = createMockS3Client(sendFn);
 
     const summary = await provisionStorageBuckets({ client });
 
-    expect(summary.results).toHaveLength(5);
-    expect(summary.createdCount).toBe(5);
+    expect(summary.results).toHaveLength(6);
+    expect(summary.createdCount).toBe(6);
     expect(summary.alreadyExistsCount).toBe(0);
-    expect(summary.lifecycleAppliedCount).toBe(2); // temp and review
+    expect(summary.lifecycleAppliedCount).toBe(3); // temp, review, and candidates
     expect(summary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
   });
 
@@ -200,6 +200,20 @@ describe("Storage Provisioner unit tests", () => {
     const delEval = evaluateLifecycleEligibility({ bucket: BUCKETS.DELIVERY, objectAgeDays: 365 });
     expect(delEval.isEligibleForDeletion).toBe(false);
     expect(delEval.reason).toContain("campaign completion");
+
+    // godzspeed-candidates (30 days)
+    expect(
+      evaluateLifecycleEligibility({ bucket: BUCKETS.CANDIDATES, objectAgeDays: 31 })
+        .isEligibleForDeletion
+    ).toBe(true);
+    expect(
+      evaluateLifecycleEligibility({ bucket: BUCKETS.CANDIDATES, objectAgeDays: 30 })
+        .isEligibleForDeletion
+    ).toBe(true);
+    expect(
+      evaluateLifecycleEligibility({ bucket: BUCKETS.CANDIDATES, objectAgeDays: 29 })
+        .isEligibleForDeletion
+    ).toBe(false);
   });
 
   it("returns lifecycle configuration when GetBucketLifecycleConfigurationCommand succeeds", async () => {
diff --git a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
index d0d5b3d..dcc8ba0 100644
--- a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
+++ b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
@@ -93,7 +93,8 @@ describe("HostFsStorageTelemetryAdapter", () => {
       "godzspeed-review",
       "godzspeed-reference",
       "godzspeed-delivery",
-      "godzspeed-evidence"
+      "godzspeed-evidence",
+      "godzspeed-candidates"
     ]);
     expect(telemetry.buckets.every((b) => b.usedBytes === 0)).toBe(true);
   });
diff --git a/packages/shared/src/buckets.test.ts b/packages/shared/src/buckets.test.ts
index bfcece3..dc797fd 100644
--- a/packages/shared/src/buckets.test.ts
+++ b/packages/shared/src/buckets.test.ts
@@ -14,7 +14,8 @@ describe("bucket class constants and retention policies", () => {
       "godzspeed-review",
       "godzspeed-reference",
       "godzspeed-delivery",
-      "godzspeed-evidence"
+      "godzspeed-evidence",
+      "godzspeed-candidates"
     ]);
 
     expect(BUCKETS.TEMP).toBe("godzspeed-temp");
@@ -22,6 +23,7 @@ describe("bucket class constants and retention policies", () => {
     expect(BUCKETS.REFERENCE).toBe("godzspeed-reference");
     expect(BUCKETS.DELIVERY).toBe("godzspeed-delivery");
     expect(BUCKETS.EVIDENCE).toBe("godzspeed-evidence");
+    expect(BUCKETS.CANDIDATES).toBe("godzspeed-candidates");
   });
 
   it("type checks bucket names against union", () => {
@@ -91,4 +93,18 @@ describe("bucket class constants and retention policies", () => {
     const evidenceLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-evidence"];
     expect(evidenceLifecycle).toBeUndefined();
   });
+
+  it("defines 30-day automated expiry for godzspeed-candidates", () => {
+    const candidatesPolicy = BUCKET_RETENTION_POLICIES["godzspeed-candidates"];
+    expect(candidatesPolicy).toBeDefined();
+    expect(candidatesPolicy.bucket).toBe("godzspeed-candidates");
+    expect(candidatesPolicy.defaultRetentionDays).toBe(30);
+    expect(candidatesPolicy.isAutomatedExpiry).toBe(true);
+
+    const candidatesLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-candidates"];
+    expect(candidatesLifecycle).toBeDefined();
+    expect(candidatesLifecycle?.expirationDays).toBe(30);
+    expect(candidatesLifecycle?.status).toBe("Enabled");
+    expect(candidatesLifecycle?.ruleId).toBe("godzspeed-candidates-retention-30d");
+  });
 });
diff --git a/packages/shared/src/buckets.ts b/packages/shared/src/buckets.ts
index 2f61997..7b6d1f1 100644
--- a/packages/shared/src/buckets.ts
+++ b/packages/shared/src/buckets.ts
@@ -6,7 +6,8 @@ export const BUCKET_NAMES = [
   "godzspeed-review",
   "godzspeed-reference",
   "godzspeed-delivery",
-  "godzspeed-evidence"
+  "godzspeed-evidence",
+  "godzspeed-candidates"
 ] as const;
 
 export type BucketName = (typeof BUCKET_NAMES)[number];
@@ -16,7 +17,8 @@ export const BUCKETS = {
   REVIEW: "godzspeed-review",
   REFERENCE: "godzspeed-reference",
   DELIVERY: "godzspeed-delivery",
-  EVIDENCE: "godzspeed-evidence"
+  EVIDENCE: "godzspeed-evidence",
+  CANDIDATES: "godzspeed-candidates"
 } as const;
 
 export interface BucketRetentionPolicy {
@@ -64,6 +66,12 @@ export const BUCKET_RETENTION_POLICIES: Readonly<Record<BucketName, BucketRetent
       description:
         "immutable source evidence archive (retained indefinitely under regulatory hold; no automated expiry)",
       isAutomatedExpiry: false
+    },
+    "godzspeed-candidates": {
+      bucket: "godzspeed-candidates",
+      defaultRetentionDays: 30,
+      description: "operator acceptance candidates, staging test reels, simulation artifacts",
+      isAutomatedExpiry: true
     }
   });
 
@@ -84,5 +92,11 @@ export const BUCKET_LIFECYCLE_DEFINITIONS: Readonly<
   },
   "godzspeed-reference": undefined,
   "godzspeed-delivery": undefined,
-  "godzspeed-evidence": undefined
+  "godzspeed-evidence": undefined,
+  "godzspeed-candidates": {
+    ruleId: "godzspeed-candidates-retention-30d",
+    expirationDays: 30,
+    status: "Enabled",
+    prefix: ""
+  }
 });
```

Fix diff since previous review:

```diff
diff --git a/apps/control-api/src/http/errors.ts b/apps/control-api/src/http/errors.ts
index 323396c..57b151b 100644
--- a/apps/control-api/src/http/errors.ts
+++ b/apps/control-api/src/http/errors.ts
@@ -50,7 +50,8 @@ import {
   OperatorAcceptanceSceneNotFoundError,
   OperatorAcceptanceOrdinalMismatchError,
   OperatorAcceptanceInvalidStatusError,
-  OperatorAcceptanceSceneNotAcceptedError
+  OperatorAcceptanceSceneNotAcceptedError,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import {
   AlreadyAcceptedProductionAttemptError,
@@ -479,6 +480,20 @@ export function formatReviewError(error: unknown): {
     };
   }
 
+  if (
+    error instanceof OperatorAcceptanceIdempotencyConflictError ||
+    (error instanceof Error && error.name === "OperatorAcceptanceIdempotencyConflictError") ||
+    (error as { code?: string })?.code === "IDEMPOTENCY_CONFLICT"
+  ) {
+    return {
+      statusCode: 409,
+      body: {
+        code: "IDEMPOTENCY_CONFLICT",
+        message: (error as Error).message
+      }
+    };
+  }
+
   if (
     error instanceof OperatorAcceptanceInvalidStatusError ||
     error instanceof OperatorAcceptanceSceneNotAcceptedError
diff --git a/apps/control-api/src/http/routes/duration-planning-routes.test.ts b/apps/control-api/src/http/routes/duration-planning-routes.test.ts
index 6014994..a488dbe 100644
--- a/apps/control-api/src/http/routes/duration-planning-routes.test.ts
+++ b/apps/control-api/src/http/routes/duration-planning-routes.test.ts
@@ -35,9 +35,8 @@ const samplePlan = planFeasibleCampaignDuration({
     }
   ],
   realm: {
-    kind: "isolated_test",
-    testRealmId: "test-realm-1",
-    isolationDescriptorDigest: "0".repeat(64)
+    kind: "deployed",
+    deploymentId: "test-deploy-1"
   },
   scope: "production"
 });
@@ -161,7 +160,9 @@ class FakeUnitOfWork implements UnitOfWork {
       findRunSceneBySceneId: async () => undefined,
       updateRunStatus: async () => {},
       updateSceneAcceptedAttempt: async () => {},
-      updateSceneCurrentAttempt: async () => {}
+      updateSceneCurrentAttempt: async () => {},
+      saveActionReceipt: async () => {},
+      findActionReceipt: async () => undefined
     };
 
     return work({
@@ -434,4 +435,36 @@ describe("DurationPlanningRoutes", () => {
     expect(body.code).toBe("FORBIDDEN");
     expect(body.message).toContain("does not match authenticated identity");
   });
+
+  it("returns 404 for non-existent operator acceptance run reel", async () => {
+    const app = createControlApiApp(
+      { uow: new FakeUnitOfWork() },
+      { reviewerIdentityResolver: { resolve: async () => "Test Reviewer" } }
+    );
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/operator-acceptance/runs/01950c46-9e90-7d3d-82d2-8f1d3c000099/reel"
+    });
+
+    expect(res.statusCode).toBe(404);
+    const body = JSON.parse(res.body);
+    expect(body.code).toBe("NOT_FOUND");
+  });
+
+  it("returns 403 on GET acceptance run reel when reviewer is anonymous or unauthorized", async () => {
+    const app = createControlApiApp(
+      { uow: new FakeUnitOfWork() },
+      { reviewerIdentityResolver: { resolve: async () => "anonymous" } }
+    );
+
+    const res = await app.inject({
+      method: "GET",
+      url: "/api/operator-acceptance/runs/01950c46-9e90-7d3d-82d2-8f1d3c000099/reel"
+    });
+
+    expect(res.statusCode).toBe(403);
+    const body = JSON.parse(res.body);
+    expect(body.code).toBe("FORBIDDEN");
+  });
 });
diff --git a/apps/control-api/src/http/routes/duration-planning-routes.ts b/apps/control-api/src/http/routes/duration-planning-routes.ts
index 09e6950..8c23c90 100644
--- a/apps/control-api/src/http/routes/duration-planning-routes.ts
+++ b/apps/control-api/src/http/routes/duration-planning-routes.ts
@@ -1,5 +1,6 @@
 import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
 import type { ControlApiContainer, ReviewerIdentityResolver } from "../types.js";
+import type { ClientContextResolver } from "@cco/application";
 import {
   ReplanCampaignPreviewRequestSchema,
   ReplanCampaignPreviewResponseSchema,
@@ -9,12 +10,14 @@ import {
   BeginOperatorAcceptanceRunResponseSchema,
   AcceptAcceptanceSceneRequestSchema,
   AssembleOperatorAcceptanceRunRequestSchema,
-  AssembleOperatorAcceptanceRunResponseSchema
+  AssembleOperatorAcceptanceRunResponseSchema,
+  AcceptanceRunReelReadModelSchema
 } from "@cco/contracts";
 
 export interface DurationPlanningRoutesOptions {
   readonly container: ControlApiContainer;
   readonly reviewerIdentityResolver?: ReviewerIdentityResolver | undefined;
+  readonly clientContextResolver?: ClientContextResolver<FastifyRequest> | undefined;
 }
 
 export const campaignIdParamsSchema = {
@@ -109,7 +112,8 @@ export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOp
 
       const body = ReplanCampaignPreviewRequestSchema.parse({
         ...(request.body as Record<string, unknown>),
-        campaignId: request.params.campaignId
+        campaignId: request.params.campaignId,
+        principal: reviewerName
       });
 
       const result = await container.useCases.previewCampaignReplan.execute(body);
@@ -141,7 +145,8 @@ export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOp
 
       const body = ReplanCampaignCommitRequestSchema.parse({
         ...(request.body as Record<string, unknown>),
-        campaignId: request.params.campaignId
+        campaignId: request.params.campaignId,
+        principal: reviewerName
       });
 
       const result = await container.useCases.commitCampaignReplan.execute(body);
@@ -286,4 +291,45 @@ export const durationPlanningRoutes: FastifyPluginAsync<DurationPlanningRoutesOp
       return reply.status(200).send(response);
     }
   );
+
+  // 9. Resolve operator acceptance run reel
+  fastify.get<{ Params: { acceptanceRunId: string } }>(
+    "/api/operator-acceptance/runs/:acceptanceRunId/reel",
+    async (request, reply) => {
+      if (!container.useCases.resolveOperatorAcceptanceReel) {
+        throw new Error("ResolveOperatorAcceptanceReelUseCase is not configured on container.");
+      }
+
+      const reviewerName = await getReviewerIdentity(request);
+      const authorized = await checkReviewerAuthorization(reviewerName);
+      if (!authorized) {
+        return reply.status(403).send({
+          code: "FORBIDDEN",
+          message: `Reviewer '${reviewerName}' is not authorized to resolve operator acceptance run reel`
+        });
+      }
+
+      let clientId: string | undefined;
+      const clientResolver = opts.clientContextResolver;
+      if (clientResolver) {
+        try {
+          const resolved = await clientResolver.resolve(request);
+          if (resolved) {
+            clientId = resolved;
+          }
+        } catch {
+          // No client context
+        }
+      }
+
+      const result = await container.useCases.resolveOperatorAcceptanceReel.execute({
+        acceptanceRunId: request.params.acceptanceRunId,
+        reviewerName,
+        clientId
+      });
+
+      const response = AcceptanceRunReelReadModelSchema.parse(result);
+      return reply.status(200).send(response);
+    }
+  );
 };
diff --git a/apps/control-api/src/http/types.ts b/apps/control-api/src/http/types.ts
index 6ac235f..b418c9e 100644
--- a/apps/control-api/src/http/types.ts
+++ b/apps/control-api/src/http/types.ts
@@ -41,6 +41,7 @@ import {
   BeginOperatorAcceptanceRunUseCase,
   AcceptOperatorAcceptanceSceneUseCase,
   AssembleOperatorAcceptanceRunUseCase,
+  ResolveOperatorAcceptanceReelUseCase,
   type StageH3CandidateRenderUseCase,
   type H3CandidateRegistryReader,
   type RealmAdmissionContext,
@@ -152,6 +153,7 @@ export interface ControlApiUseCases {
   readonly beginOperatorAcceptanceRun?: BeginOperatorAcceptanceRunUseCase | undefined;
   readonly acceptOperatorAcceptanceScene?: AcceptOperatorAcceptanceSceneUseCase | undefined;
   readonly assembleOperatorAcceptanceRun?: AssembleOperatorAcceptanceRunUseCase | undefined;
+  readonly resolveOperatorAcceptanceReel?: ResolveOperatorAcceptanceReelUseCase | undefined;
   readonly createCampaign?: CreateCampaignUseCase | undefined;
   readonly createCampaignShell?: CreateCampaignShellUseCase | undefined;
   readonly createClient?: CreateClientUseCase | undefined;
@@ -603,10 +605,20 @@ export function createControlApiContainer(
     : undefined;
 
   const previewCampaignReplan = dependencies.uow
-    ? new PreviewCampaignReplanUseCase({ uow: dependencies.uow })
+    ? new PreviewCampaignReplanUseCase({
+        uow: dependencies.uow,
+        productionReleaseReader: dependencies.productionReleaseReader,
+        stagingAuthSource: dependencies.stagingAuthSource,
+        registryReader: dependencies.h3CandidateRegistryReader
+      })
     : undefined;
   const commitCampaignReplan = dependencies.uow
-    ? new CommitCampaignReplanUseCase({ uow: dependencies.uow })
+    ? new CommitCampaignReplanUseCase({
+        uow: dependencies.uow,
+        productionReleaseReader: dependencies.productionReleaseReader,
+        stagingAuthSource: dependencies.stagingAuthSource,
+        registryReader: dependencies.h3CandidateRegistryReader
+      })
     : undefined;
   const beginOperatorAcceptanceRun = dependencies.uow
     ? new BeginOperatorAcceptanceRunUseCase({
@@ -621,6 +633,15 @@ export function createControlApiContainer(
   const assembleOperatorAcceptanceRun = dependencies.uow
     ? new AssembleOperatorAcceptanceRunUseCase({ uow: dependencies.uow })
     : undefined;
+  const resolveOperatorAcceptanceReel = dependencies.uow
+    ? new ResolveOperatorAcceptanceReelUseCase({
+        uow: dependencies.uow,
+        ...(dependencies.objectStorage ? { objectStorage: dependencies.objectStorage } : {}),
+        ...(dependencies.reviewMediaDelivery
+          ? { mediaDelivery: dependencies.reviewMediaDelivery }
+          : {})
+      })
+    : undefined;
 
   return {
     dependencies,
@@ -675,7 +696,8 @@ export function createControlApiContainer(
       ...(commitCampaignReplan !== undefined ? { commitCampaignReplan } : {}),
       ...(beginOperatorAcceptanceRun !== undefined ? { beginOperatorAcceptanceRun } : {}),
       ...(acceptOperatorAcceptanceScene !== undefined ? { acceptOperatorAcceptanceScene } : {}),
-      ...(assembleOperatorAcceptanceRun !== undefined ? { assembleOperatorAcceptanceRun } : {})
+      ...(assembleOperatorAcceptanceRun !== undefined ? { assembleOperatorAcceptanceRun } : {}),
+      ...(resolveOperatorAcceptanceReel !== undefined ? { resolveOperatorAcceptanceReel } : {})
     },
     queries: {
       ...(dependencies.sceneReviewQueries !== undefined
diff --git a/apps/render-worker/src/cli/run-delivery-assembler.ts b/apps/render-worker/src/cli/run-delivery-assembler.ts
index ae85e18..4e74048 100644
--- a/apps/render-worker/src/cli/run-delivery-assembler.ts
+++ b/apps/render-worker/src/cli/run-delivery-assembler.ts
@@ -9,13 +9,16 @@ import {
   EnforceLicenseRouting,
   type GenerationManifestRepository,
   type MediaAssemblerPort,
-  type ObjectStoragePort
+  type ObjectStoragePort,
+  type UnitOfWork
 } from "@cco/application";
+import { BUCKETS } from "@cco/shared";
 import { type ComponentRef } from "@cco/contracts";
 import {
   FfmpegMediaAssemblerAdapter,
   JsonFileLicenseRegistryPort,
   PostgresGenerationManifestRepository,
+  PostgresUnitOfWork,
   S3ObjectStorage,
   type S3ObjectStorageOptions
 } from "@cco/infrastructure";
@@ -24,6 +27,7 @@ import {
   type DeliveryAssemblyControlApiClient
 } from "../control-api-client.js";
 import { DeliveryAssemblyWorker } from "../delivery-assembly-worker.js";
+import { AcceptanceDeliveryAssemblyWorker } from "../acceptance-delivery-assembly-worker.js";
 import type { WorkerLogger } from "../worker.js";
 
 const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../");
@@ -343,12 +347,130 @@ export async function createDeliveryReelAssembler(
   };
 }
 
+export interface AcceptanceDeliveryReelAssemblerOverrides {
+  readonly pool?: pg.Pool | undefined;
+  readonly uow?: UnitOfWork | undefined;
+  readonly generationManifestRepository?: GenerationManifestRepository | undefined;
+  readonly objectStorage?: ObjectStoragePort | undefined;
+  readonly mediaAssembler?: MediaAssemblerPort | undefined;
+  readonly envelopeReader?: AssemblyPlanningEnvelopeReader | undefined;
+  readonly runtimeComponents?: readonly ComponentRef[] | undefined;
+  readonly enforceLicenseRouting?: EnforceLicenseRouting | undefined;
+  readonly assembleDeliveryReelUseCase?: AssembleDeliveryReel | undefined;
+  readonly logger?: WorkerLogger | undefined;
+}
+
+export interface CreatedAcceptanceDeliveryReelAssembler {
+  readonly worker: AcceptanceDeliveryAssemblyWorker;
+  readonly pool: pg.Pool;
+  readonly assembleDeliveryReelUseCase: AssembleDeliveryReel;
+  readonly runtimeComponents: readonly ComponentRef[];
+  readonly cleanup: () => Promise<void>;
+}
+
+export async function createAcceptanceDeliveryReelAssembler(
+  config: DeliveryAssemblerRuntimeConfig,
+  overrides?: AcceptanceDeliveryReelAssemblerOverrides
+): Promise<CreatedAcceptanceDeliveryReelAssembler> {
+  const pool = overrides?.pool ?? new Pool({ connectionString: config.databaseUrl });
+  const ownsPool = !overrides?.pool;
+
+  const generationManifestRepository =
+    overrides?.generationManifestRepository ?? new PostgresGenerationManifestRepository(pool);
+
+  const objectStorage = overrides?.objectStorage ?? new S3ObjectStorage(config.s3Config);
+
+  const licenseRegistry = JsonFileLicenseRegistryPort.fromFile(config.licenseRegistryPath);
+  const enforceLicenseRouting =
+    overrides?.enforceLicenseRouting ?? new EnforceLicenseRouting({ registry: licenseRegistry });
+
+  const envelopeReader = overrides?.envelopeReader ?? new DefaultAssemblyPlanningEnvelopeReader();
+  const envelope = await envelopeReader.getEnvelope();
+
+  const mediaAssembler =
+    overrides?.mediaAssembler ??
+    new FfmpegMediaAssemblerAdapter({
+      ffmpegPath: config.ffmpegPath,
+      ffprobePath: config.ffprobePath,
+      workspaceRoot: config.assemblyWorkspaceRoot,
+      outputBucket: BUCKETS.CANDIDATES,
+      pythonPath: config.pythonPath,
+      maxStemCount: envelope.maxStemCount,
+      maxTotalDurationMs: envelope.maxExpectedTotalDurationMs,
+      objectStorage
+    });
+
+  const runtimeComponents =
+    overrides?.runtimeComponents ??
+    (mediaAssembler.getRuntimeComponents ? await mediaAssembler.getRuntimeComponents() : []);
+
+  const assembleDeliveryReelUseCase =
+    overrides?.assembleDeliveryReelUseCase ??
+    new AssembleDeliveryReel({
+      mediaAssembler,
+      objectStorage,
+      enforceLicenseRouting,
+      generationManifestRepository,
+      runtimeComponents
+    });
+
+  const uow = overrides?.uow ?? new PostgresUnitOfWork(pool);
+  const logger: WorkerLogger = overrides?.logger ?? console;
+
+  const worker = new AcceptanceDeliveryAssemblyWorker(
+    {
+      uow,
+      assembleDeliveryReel: async (params) => {
+        return assembleDeliveryReelUseCase.assemble(params);
+      },
+      objectStorage,
+      logger
+    },
+    {
+      workerId: config.workerId,
+      pollIntervalMs: config.pollIntervalMs,
+      lockTimeoutMs: config.leaseDurationMs
+    }
+  );
+
+  const cleanup = async () => {
+    if (ownsPool) {
+      await pool.end().catch(() => {});
+    }
+  };
+
+  return {
+    worker,
+    pool,
+    assembleDeliveryReelUseCase,
+    runtimeComponents,
+    cleanup
+  };
+}
+
 export async function runDeliveryAssemblerCli(
   argv: string[] = process.argv.slice(2),
   env: NodeJS.ProcessEnv = process.env
 ): Promise<void> {
   const config = parseDeliveryAssemblerRuntimeConfig(env, argv);
-  const assembler = await createDeliveryReelAssembler(config);
+  const getArg = (name: string): string | undefined => {
+    const prefix = `--${name}=`;
+    for (let i = 0; i < argv.length; i++) {
+      const arg = argv[i];
+      if (arg?.startsWith(prefix)) {
+        return arg.slice(prefix.length);
+      }
+      if (arg === `--${name}` && i + 1 < argv.length) {
+        return argv[i + 1];
+      }
+    }
+    return undefined;
+  };
+  const role = (getArg("role") ?? env.ASSEMBLER_ROLE ?? "delivery").trim();
+  const isAcceptance = role === "acceptance" || argv.includes("--acceptance");
+  const assembler = isAcceptance
+    ? await createAcceptanceDeliveryReelAssembler(config)
+    : await createDeliveryReelAssembler(config);
 
   const shutdown = async () => {
     console.info("Shutting down delivery assembly worker...");
diff --git a/apps/render-worker/src/index.ts b/apps/render-worker/src/index.ts
index 062275e..be46a17 100644
--- a/apps/render-worker/src/index.ts
+++ b/apps/render-worker/src/index.ts
@@ -1,2 +1,4 @@
 export const renderWorkerName = "render-worker";
 export * from "./voice-synthesis-factory.js";
+export * from "./acceptance-delivery-assembly-worker.js";
+export * from "./cli/run-delivery-assembler.js";
diff --git a/docs/CONTEXT.md b/docs/CONTEXT.md
index b194912..4c92944 100644
--- a/docs/CONTEXT.md
+++ b/docs/CONTEXT.md
@@ -295,5 +295,15 @@ Issue #426 delivers capability-aware campaign duration allocation, durable durat
 - **Campaign Replan Contract & Idempotency:** Campaign replans require complete vectors of scene durations and expected spec revisions summing strictly to the campaign target duration, acquire row locks, invalidate scene approvals while preserving allocation IDs, and record idempotent action receipts for safe action replay.
 - **Assembly Planning Envelope Safety:** Combinatorial candidate partitioning prunes states against maximum stem and duration envelope ceilings with fail-closed catalog limits, and campaign creation UI warns users when requested durations exceed assembly boundaries.
 
+### 9. Variable-Duration H3 CI Simulation & End-to-End Acceptance Lifecycle (#421.6 / Issue #427)
+
+Issue #427 delivers full simulation and regression coverage for variable-duration MiniMax-H3 production:
+- **Autonomous CI vs. Physical GPU Boundary:** CI simulation exercises the software control plane, duration allocation, staged rendering, review gating, worker assembly, and accepted reel readback. Physical GPU execution and hardware certification belong to the operator runbook (`docs/h3-acceptance-operator-runbook.md`).
+- **Simulated Connected Lifecycle & E2E Coverage:** Validates the end-to-end software path across Postgres, MinIO, and worker execution in `tests/integration/h3-variable-duration-lifecycle.e2e.integration.test.ts` and focused unit suites, verifying duration allocation, candidate staging, review gating, worker assembly, manifest storage, and reel readback with full stem lineage.
+- **Negative & Security Boundaries:** Rejects off-grid frame counts ($5 + 17k$), scene ceiling violations (>15,000ms `MAX_SCENE_DURATION_MS`), candidate rows with recorded `NO_GO` visual decisions, unapproved profile digests, cross-route licensing, parameter-conflicting replays (HTTP 409), and stem checksum mismatches.
+- **Legacy 5-Second Controls & Operator Release Gate:** Preserves legacy 5-second production profiles (`MINIMAX_H3_720P_5S_I2V_V1` and `MINIMAX_H3_720P_5S_REF2V_V1`). The production release reader strictly prevents advertising staging-only candidate lengths until the #428 release gate is satisfied on physical hardware.
+- **Reference Documentation:** [docs/h3-variable-duration-ci-coverage.md](h3-variable-duration-ci-coverage.md).
+
+
 
 
diff --git a/docs/h3-acceptance-operator-runbook.md b/docs/h3-acceptance-operator-runbook.md
index c19c09c..52261c5 100644
--- a/docs/h3-acceptance-operator-runbook.md
+++ b/docs/h3-acceptance-operator-runbook.md
@@ -159,6 +159,14 @@ If an operator aborts a candidate staging run or encounters fatal execution erro
    rm -f "$CCO_COMFYUI_DIR/input/stage_"*
    ```
 
+### Variable-Duration Release Gate (#428)
+
+Issue #427 establishes automated CI simulation and software regression coverage across duration allocation, staging acceptance dispatch, worker assembly, and accepted reel readback (`docs/h3-variable-duration-ci-coverage.md`).
+
+However, **CI simulation is not GPU certification**:
+- The public UI and production release reader (`ProductionReleaseCapabilityReader`) strictly withhold advertising variable-duration candidate lengths (e.g. 243f, 362f) from general production until the operator physical campaign is executed on the RTX 4090 host.
+- Only upon successful execution of this runbook with zero unmitigated visual defects (blackouts, limb corruption) may the operator promote candidate profiles into the production release catalog under issue #428.
+
 ## Open baseline questions
 
 (Populate this section only if the physical campaign surfaces a defect in H3 dispatch,
diff --git a/packages/application/src/ports/generation-manifest-repository.ts b/packages/application/src/ports/generation-manifest-repository.ts
index 004239f..e97da0d 100644
--- a/packages/application/src/ports/generation-manifest-repository.ts
+++ b/packages/application/src/ports/generation-manifest-repository.ts
@@ -33,10 +33,22 @@ export interface GenerationManifestComponentIdentity {
    * manifest references from being accepted into assembly provenance.
    */
   readonly outputChecksumsSha256?: readonly string[] | undefined;
+  readonly route?: "i2v" | "ref2v" | undefined;
+  readonly candidateSpecificationDigest?: string | undefined;
 }
 
 export interface VideoStemSourceRecord {
   readonly generationManifestId: string;
+  readonly jobId?: string | undefined;
+  readonly sceneId?: string | undefined;
+  readonly renderProfile?: string | undefined;
+  readonly route?: "i2v" | "ref2v" | undefined;
+  readonly routingMode?: string | undefined;
+  readonly candidateSpecificationDigest?: string | undefined;
+  readonly specRevision?: number | undefined;
+  readonly frames?: number | undefined;
+  readonly fps?: number | undefined;
+  readonly outputChecksumsSha256?: readonly string[] | undefined;
   readonly media: PersistentMediaRef;
   readonly renderAttempt: number;
   readonly executionScope?: "production" | "staging" | undefined;
diff --git a/packages/application/src/ports/operator-acceptance-ports.ts b/packages/application/src/ports/operator-acceptance-ports.ts
index 648ba2f..4ef967b 100644
--- a/packages/application/src/ports/operator-acceptance-ports.ts
+++ b/packages/application/src/ports/operator-acceptance-ports.ts
@@ -2,6 +2,8 @@ import type {
   AcceptanceAssemblyJob,
   AcceptanceAssemblyManifest,
   AcceptanceRunScene,
+  OperatorAcceptanceActionReceipt,
+  OperatorAcceptanceActionScope,
   OperatorAcceptanceRun,
   OperatorAcceptanceRunStatus
 } from "@cco/contracts";
@@ -31,6 +33,12 @@ export interface OperatorAcceptanceRunRepository {
     attemptId: string,
     ordinal: number
   ): Promise<void>;
+  saveActionReceipt(receipt: OperatorAcceptanceActionReceipt): Promise<void>;
+  findActionReceipt(
+    scope: OperatorAcceptanceActionScope | string,
+    runOrCampaignId: string,
+    actionId: string
+  ): Promise<OperatorAcceptanceActionReceipt | undefined>;
 }
 
 export interface AcceptanceAssemblyJobQueuePort {
@@ -38,6 +46,8 @@ export interface AcceptanceAssemblyJobQueuePort {
     job: Omit<AcceptanceAssemblyJob, "status" | "createdAt" | "updatedAt">
   ): Promise<AcceptanceAssemblyJob>;
   claim(workerId: string, leaseDurationMs: number): Promise<AcceptanceAssemblyJob | undefined>;
+  start(jobId: string, leaseToken: string): Promise<void>;
+  heartbeat(jobId: string, leaseToken: string, leaseDurationMs: number): Promise<void>;
   complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void>;
   fail(jobId: string, error: string, leaseToken?: string): Promise<void>;
   findById(jobId: string): Promise<AcceptanceAssemblyJob | undefined>;
diff --git a/packages/application/src/test-support/in-memory-scene-unit-of-work.ts b/packages/application/src/test-support/in-memory-scene-unit-of-work.ts
index adac552..bdb6e24 100644
--- a/packages/application/src/test-support/in-memory-scene-unit-of-work.ts
+++ b/packages/application/src/test-support/in-memory-scene-unit-of-work.ts
@@ -4,6 +4,7 @@ import type {
   AcceptanceAssemblyManifest,
   AcceptanceRunScene,
   CampaignDurationPlan,
+  OperatorAcceptanceActionReceipt,
   OperatorAcceptanceRun,
   ReviewEvent,
   SceneDurationBinding
@@ -125,6 +126,7 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
   private readonly _acceptanceRunScenes = new Map<string, AcceptanceRunScene[]>();
   private readonly _acceptanceJobs = new Map<string, AcceptanceAssemblyJob>();
   private readonly _acceptanceManifests = new Map<string, AcceptanceAssemblyManifest>();
+  private readonly _acceptanceActionReceipts = new Map<string, OperatorAcceptanceActionReceipt>();
   private readonly _campaignReferenceBibles = new Map<string, CampaignReferenceBibleEntry>();
   private readonly _campaignReferenceBibleChanges: CampaignReferenceBibleChange[] = [];
   private readonly _enqueuedAssemblyJobs: EnqueueDeliveryAssemblyJobInput[] = [];
@@ -368,6 +370,32 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
     return this;
   }
 
+  get generationManifests(): GenerationManifestRepository {
+    return {
+      getComponentIdentityById: async (manifestId: string) => {
+        for (const stem of this._seededVideoStemSources.values()) {
+          if (stem.generationManifestId === manifestId && stem.renderProfile) {
+            return {
+              renderProfile: stem.renderProfile,
+              renderProfileVersion: 1,
+              route:
+                stem.route ??
+                (stem.routingMode === "frame_anchored"
+                  ? ("i2v" as const)
+                  : stem.routingMode === "reference_directed"
+                    ? ("ref2v" as const)
+                    : undefined),
+              candidateSpecificationDigest: stem.candidateSpecificationDigest,
+              outputChecksumsSha256: stem.outputChecksumsSha256
+            };
+          }
+        }
+        return undefined;
+      },
+      findVideoStemSourceByJobId: async (jobId: string) => this._seededVideoStemSources.get(jobId)
+    };
+  }
+
   seedReferenceAsset(asset: ReferenceAsset): this {
     this._seededReferenceAssets.set(asset.id, asset);
     return this;
@@ -824,7 +852,26 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
     };
 
     const defaultGenerationManifests: GenerationManifestRepository = {
-      getComponentIdentityById: async () => undefined,
+      getComponentIdentityById: async (manifestId: string) => {
+        for (const stem of this._seededVideoStemSources.values()) {
+          if (stem.generationManifestId === manifestId && stem.renderProfile) {
+            return {
+              renderProfile: stem.renderProfile,
+              renderProfileVersion: 1,
+              route:
+                stem.route ??
+                (stem.routingMode === "frame_anchored"
+                  ? ("i2v" as const)
+                  : stem.routingMode === "reference_directed"
+                    ? ("ref2v" as const)
+                    : undefined),
+              candidateSpecificationDigest: stem.candidateSpecificationDigest,
+              outputChecksumsSha256: stem.outputChecksumsSha256
+            };
+          }
+        }
+        return undefined;
+      },
       findVideoStemSourceByJobId: async (jobId: string) => this._seededVideoStemSources.get(jobId)
     };
 
@@ -1237,7 +1284,10 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
       },
       operatorAcceptanceRuns: {
         createRun: async (run, scenes) => {
-          this._acceptanceRuns.set(run.acceptanceRunId, run);
+          this._acceptanceRuns.set(run.acceptanceRunId, {
+            ...run,
+            status: run.status ?? "dispatched"
+          });
           this._acceptanceRunScenes.set(run.acceptanceRunId, [...scenes]);
         },
         findRunById: async (acceptanceRunId) => {
@@ -1303,6 +1353,14 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
               };
             }
           }
+        },
+        saveActionReceipt: async (receipt) => {
+          const key = `${receipt.scope}:${receipt.runOrCampaignId}:${receipt.actionId}`;
+          this._acceptanceActionReceipts.set(key, receipt);
+        },
+        findActionReceipt: async (scope, runOrCampaignId, actionId) => {
+          const key = `${scope}:${runOrCampaignId}:${actionId}`;
+          return this._acceptanceActionReceipts.get(key);
         }
       },
       acceptanceAssemblyJobs: {
@@ -1333,6 +1391,30 @@ export class InMemorySceneUnitOfWork implements UnitOfWork {
           }
           return undefined;
         },
+        start: async (jobId, leaseToken) => {
+          const job = this._acceptanceJobs.get(jobId);
+          if (!job) throw new Error(`Job ${jobId} not found`);
+          if (leaseToken && job.leaseToken && job.leaseToken !== leaseToken) {
+            throw new Error(`Lease token mismatch on job ${jobId}`);
+          }
+          this._acceptanceJobs.set(jobId, {
+            ...job,
+            status: "rendering",
+            updatedAt: new Date().toISOString()
+          });
+        },
+        heartbeat: async (jobId, leaseToken, leaseDurationMs) => {
+          const job = this._acceptanceJobs.get(jobId);
+          if (!job) throw new Error(`Job ${jobId} not found`);
+          if (leaseToken && job.leaseToken && job.leaseToken !== leaseToken) {
+            throw new Error(`Lease token mismatch on job ${jobId}`);
+          }
+          this._acceptanceJobs.set(jobId, {
+            ...job,
+            leaseExpiresAt: new Date(Date.now() + leaseDurationMs).toISOString(),
+            updatedAt: new Date().toISOString()
+          });
+        },
         complete: async (jobId, outputManifestId, leaseToken) => {
           const job = this._acceptanceJobs.get(jobId);
           if (job) {
diff --git a/packages/application/src/use-cases/assemble-delivery-reel.test.ts b/packages/application/src/use-cases/assemble-delivery-reel.test.ts
index 9dac068..091b17e 100644
--- a/packages/application/src/use-cases/assemble-delivery-reel.test.ts
+++ b/packages/application/src/use-cases/assemble-delivery-reel.test.ts
@@ -19,6 +19,7 @@ import {
   AssemblyProvenanceConflictError,
   AssemblyVideoCommitError
 } from "./assemble-delivery-reel.js";
+import { BUCKETS } from "@cco/shared";
 import { EnforceLicenseRouting } from "./enforce-license-routing.js";
 import { LicenseRoutingError } from "./license-routing-error.js";
 
@@ -1548,4 +1549,192 @@ describe("AssembleDeliveryReel use case", () => {
     expect(mockAssembler.assemble).not.toHaveBeenCalled();
     expect(mockStorage.putObject).not.toHaveBeenCalled();
   });
+
+  it("denies assembly with zero ffmpeg spawn when a candidate stem is assembled for production delivery", async () => {
+    const mockStorage: ObjectStoragePort = {
+      putObject: vi.fn(),
+      copyObject: vi.fn(),
+      getObject: vi.fn(async () => undefined)
+    };
+    const mockAssembler: MediaAssemblerPort = {
+      assemble: vi.fn(async () => dummyExecutionResult)
+    };
+
+    const candidateGenManifestRepo: GenerationManifestRepository = {
+      getComponentIdentityById: vi.fn(async () => ({
+        renderProfile: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
+        renderProfileVersion: 1,
+        route: "ref2v" as const,
+        candidateSpecificationDigest:
+          "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7"
+      }))
+    };
+
+    const enforceLicenseRouting = createApprovedEnforceLicenseRouting();
+    const useCase = new AssembleDeliveryReel({
+      runtimeComponents: defaultRequiredComponents,
+      mediaAssembler: mockAssembler,
+      objectStorage: mockStorage,
+      enforceLicenseRouting,
+      generationManifestRepository: candidateGenManifestRepo
+    });
+
+    await expect(
+      useCase.assemble({
+        spec: validSpec,
+        targetBucket: BUCKETS.DELIVERY
+      })
+    ).rejects.toThrow(LicenseRoutingError);
+
+    expect(mockAssembler.assemble).not.toHaveBeenCalled();
+    expect(mockStorage.putObject).not.toHaveBeenCalled();
+  });
+
+  it("permits assembly when candidate stem is assembled for acceptance (BUCKETS.CANDIDATES)", async () => {
+    const mockStorage: ObjectStoragePort = {
+      putObject: vi.fn(async (input) => ({ bucket: input.bucket, key: input.key })),
+      copyObject: vi.fn(async (_from, to) => to),
+      getObject: vi.fn(async () => undefined)
+    };
+    const candidateExecutionResult: AssemblyExecutionResult = {
+      ...dummyExecutionResult,
+      output: {
+        ...dummyExecutionResult.output,
+        media: {
+          ...dummyExecutionResult.output.media,
+          bucket: BUCKETS.CANDIDATES
+        }
+      },
+      stagingMedia: {
+        bucket: BUCKETS.CANDIDATES,
+        key: "staging-video.mp4"
+      }
+    };
+    const mockAssembler: MediaAssemblerPort = {
+      assemble: vi.fn(async () => candidateExecutionResult)
+    };
+
+    const candidateGenManifestRepo: GenerationManifestRepository = {
+      getComponentIdentityById: vi.fn(async () => ({
+        renderProfile: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
+        renderProfileVersion: 1,
+        route: "ref2v" as const,
+        candidateSpecificationDigest:
+          "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7"
+      }))
+    };
+
+    const registry = {
+      getSnapshot: () => ({
+        schemaVersion: 1 as const,
+        registryRevision: "2026-10-24.1",
+        generatedAt: "2026-10-24T12:00:00.000Z",
+        entries: [
+          {
+            componentId: "ffmpeg",
+            componentType: "runtime" as const,
+            versionOrRevision: "n8.0.1",
+            status: "approved" as const,
+            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
+            reviewedAt: "2026-08-29T12:00:00.000Z",
+            policyRevision: "2026-08-29.1"
+          },
+          {
+            componentId: "MINIMAX_H3_720P_5S_REF2V_V1",
+            componentType: "model" as const,
+            versionOrRevision: "1",
+            status: "approved" as const,
+            licenseSource: "operator-signed",
+            reviewedAt: "2026-10-24T12:00:00.000Z",
+            policyRevision: "2026-10-24.1"
+          }
+        ]
+      })
+    };
+    const enforceLicenseRouting = new EnforceLicenseRouting({ registry });
+
+    const useCase = new AssembleDeliveryReel({
+      runtimeComponents: defaultRequiredComponents,
+      mediaAssembler: mockAssembler,
+      objectStorage: mockStorage,
+      enforceLicenseRouting,
+      generationManifestRepository: candidateGenManifestRepo
+    });
+
+    const result = await useCase.assemble({
+      spec: validSpec,
+      targetBucket: BUCKETS.CANDIDATES
+    });
+
+    expect(mockAssembler.assemble).toHaveBeenCalledTimes(1);
+    expect(result.manifest.output.media.bucket).toBe(BUCKETS.CANDIDATES);
+  });
+
+  it("denies assembly when Ref2V candidate stem cannot be satisfied by I2V approval (route distinction)", async () => {
+    const mockStorage: ObjectStoragePort = {
+      putObject: vi.fn(),
+      copyObject: vi.fn(),
+      getObject: vi.fn(async () => undefined)
+    };
+    const mockAssembler: MediaAssemblerPort = {
+      assemble: vi.fn(async () => dummyExecutionResult)
+    };
+
+    const candidateGenManifestRepo: GenerationManifestRepository = {
+      getComponentIdentityById: vi.fn(async () => ({
+        renderProfile: "H3_CANDIDATE_e6084e4f9004a591291f94c24998d10f_V1",
+        renderProfileVersion: 1,
+        route: "ref2v" as const,
+        candidateSpecificationDigest:
+          "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7"
+      }))
+    };
+
+    // Registry only approves I2V, not Ref2V
+    const registry = {
+      getSnapshot: () => ({
+        schemaVersion: 1 as const,
+        registryRevision: "2026-10-24.1",
+        generatedAt: "2026-10-24T12:00:00.000Z",
+        entries: [
+          {
+            componentId: "ffmpeg",
+            componentType: "runtime" as const,
+            versionOrRevision: "n8.0.1",
+            status: "approved" as const,
+            licenseSource: "Sprint 3.5 Assembly & Governance Host Runtime Capture",
+            reviewedAt: "2026-08-29T12:00:00.000Z",
+            policyRevision: "2026-08-29.1"
+          },
+          {
+            componentId: "MINIMAX_H3_720P_5S_I2V_V1",
+            componentType: "model" as const,
+            versionOrRevision: "1",
+            status: "approved" as const,
+            licenseSource: "operator-signed",
+            reviewedAt: "2026-10-24T12:00:00.000Z",
+            policyRevision: "2026-10-24.1"
+          }
+        ]
+      })
+    };
+    const enforceLicenseRouting = new EnforceLicenseRouting({ registry });
+
+    const useCase = new AssembleDeliveryReel({
+      runtimeComponents: defaultRequiredComponents,
+      mediaAssembler: mockAssembler,
+      objectStorage: mockStorage,
+      enforceLicenseRouting,
+      generationManifestRepository: candidateGenManifestRepo
+    });
+
+    await expect(
+      useCase.assemble({
+        spec: validSpec,
+        targetBucket: BUCKETS.REVIEW
+      })
+    ).rejects.toThrow(LicenseRoutingError);
+
+    expect(mockAssembler.assemble).not.toHaveBeenCalled();
+  });
 });
diff --git a/packages/application/src/use-cases/assemble-delivery-reel.ts b/packages/application/src/use-cases/assemble-delivery-reel.ts
index 1c00d26..2dce324 100644
--- a/packages/application/src/use-cases/assemble-delivery-reel.ts
+++ b/packages/application/src/use-cases/assemble-delivery-reel.ts
@@ -3,6 +3,7 @@ import {
   AssemblyManifestSchema,
   computeAssemblyId,
   createAssemblyManifest,
+  isStagingCandidateProfileKey,
   type AssemblyExecutionResult,
   type AssemblyManifest,
   type AssemblySpec,
@@ -111,6 +112,9 @@ export interface AssembleDeliveryReelDependencies {
 export interface AssembleDeliveryReelParams {
   readonly spec: AssemblySpec;
   readonly requiredComponents?: readonly ComponentRef[] | undefined;
+  readonly targetBucket?: string | undefined;
+  readonly outputKey?: string | undefined;
+  readonly acceptanceRunId?: string | undefined;
 }
 
 export class AssembleDeliveryReel {
@@ -147,6 +151,7 @@ export class AssembleDeliveryReel {
     // reference that cannot match any real registry entry, so the existing
     // evaluator denies it as "unknown_component" via its normal path
     // rather than needing a separate error type here.
+    const targetBucket = params.targetBucket ?? BUCKETS.DELIVERY;
     const resolvedIdentities = new Map<string, GenerationManifestComponentIdentity | undefined>();
     const generationComponents: ComponentRef[] = await Promise.all(
       spec.videoStems.map(async (stem): Promise<ComponentRef> => {
@@ -177,6 +182,48 @@ export class AssembleDeliveryReel {
             versionOrRevision: "unresolved"
           };
         }
+
+        const isCandidate =
+          isStagingCandidateProfileKey(identity.renderProfile) ||
+          Boolean(identity.candidateSpecificationDigest) ||
+          identity.renderProfile.startsWith("H3_CANDIDATE_");
+
+        if (isCandidate) {
+          if (targetBucket !== BUCKETS.CANDIDATES) {
+            return {
+              componentId: `ineligible-candidate-in-delivery:${identity.renderProfile}`,
+              componentType: "model",
+              versionOrRevision: "unresolved"
+            };
+          }
+          if (!identity.route || !identity.candidateSpecificationDigest) {
+            return {
+              componentId: `unresolved-candidate-route:${identity.renderProfile}`,
+              componentType: "model",
+              versionOrRevision: "unresolved"
+            };
+          }
+          if (identity.route === "ref2v") {
+            return {
+              componentId: "MINIMAX_H3_720P_5S_REF2V_V1",
+              componentType: "model",
+              versionOrRevision: "1"
+            };
+          } else if (identity.route === "i2v") {
+            return {
+              componentId: "MINIMAX_H3_720P_5S_I2V_V1",
+              componentType: "model",
+              versionOrRevision: "1"
+            };
+          } else {
+            return {
+              componentId: `unknown-candidate-route:${identity.renderProfile}`,
+              componentType: "model",
+              versionOrRevision: "unresolved"
+            };
+          }
+        }
+
         return {
           componentId: identity.renderProfile,
           componentType: "model",
@@ -237,10 +284,13 @@ export class AssembleDeliveryReel {
     // before any FFmpeg spawn or storage write, so the redundant-encode
     // avoidance this exists for is fully preserved.
     const assemblyId = computeAssemblyId(spec);
-    const earlyManifestKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
+    const earlyManifestKey =
+      targetBucket === BUCKETS.CANDIDATES && params.acceptanceRunId
+        ? `acceptance-runs/${params.acceptanceRunId}/manifest.json`
+        : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
     try {
       const existingManifestObj = await this.deps.objectStorage.getObject({
-        bucket: BUCKETS.DELIVERY,
+        bucket: targetBucket,
         key: earlyManifestKey
       });
       if (existingManifestObj) {
@@ -316,12 +366,37 @@ export class AssembleDeliveryReel {
           `Video stem with order ${stem.order} references generation manifest "${stem.generationManifestId}" with inconsistent output checksum (expected one of [${identity.outputChecksumsSha256.join(", ")}], got "${stem.media.sha256}")`
         );
       }
+
+      const isCandidate =
+        isStagingCandidateProfileKey(identity.renderProfile) ||
+        Boolean(identity.candidateSpecificationDigest) ||
+        identity.renderProfile.startsWith("H3_CANDIDATE_");
+      if (isCandidate) {
+        if (targetBucket !== BUCKETS.CANDIDATES) {
+          throw new AssemblySpecValidationError(
+            `Candidate stem "${identity.renderProfile}" is not permitted for target bucket "${targetBucket}"; must target "${BUCKETS.CANDIDATES}"`
+          );
+        }
+        if (!identity.route || !identity.candidateSpecificationDigest) {
+          throw new AssemblySpecValidationError(
+            `Candidate stem "${identity.renderProfile}" must specify both route and candidateSpecificationDigest`
+          );
+        }
+      }
     }
 
     // Step 3: Invoke MediaAssemblerPort for execution & media persistence
     let executionResult: AssemblyExecutionResult;
+    const assemblerInput = {
+      ...spec,
+      ...(params.targetBucket !== undefined ? { outputBucket: params.targetBucket } : {}),
+      ...(params.outputKey !== undefined ? { outputKey: params.outputKey } : {}),
+      ...(params.acceptanceRunId !== undefined ? { acceptanceRunId: params.acceptanceRunId } : {})
+    };
     try {
-      executionResult = await this.deps.mediaAssembler.assemble(spec);
+      executionResult = await this.deps.mediaAssembler.assemble(
+        assemblerInput as unknown as AssemblySpec
+      );
     } catch (err) {
       if (
         err instanceof Error &&
@@ -330,11 +405,14 @@ export class AssembleDeliveryReel {
       ) {
         const assemblyId =
           (err as { context?: { assemblyId?: string } }).context?.assemblyId ?? "unknown";
-        const manifestKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
+        const manifestKey =
+          targetBucket === BUCKETS.CANDIDATES && params.acceptanceRunId
+            ? `acceptance-runs/${params.acceptanceRunId}/manifest.json`
+            : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/manifest.json`;
         let existingManifest: AssemblyManifest | undefined;
         try {
           const existingManifestObj = await this.deps.objectStorage.getObject({
-            bucket: BUCKETS.DELIVERY,
+            bucket: targetBucket,
             key: manifestKey
           });
           if (existingManifestObj) {
@@ -354,6 +432,31 @@ export class AssembleDeliveryReel {
       throw err;
     }
 
+    if (
+      params.targetBucket !== undefined &&
+      executionResult.output.media.bucket !== params.targetBucket
+    ) {
+      throw new AssemblySpecValidationError(
+        `Media assembler output bucket "${executionResult.output.media.bucket}" does not match requested targetBucket "${params.targetBucket}"`
+      );
+    }
+    if (
+      params.targetBucket === BUCKETS.CANDIDATES &&
+      executionResult.output.media.bucket !== BUCKETS.CANDIDATES
+    ) {
+      throw new AssemblySpecValidationError(
+        `Candidate acceptance reel output bucket "${executionResult.output.media.bucket}" must be "${BUCKETS.CANDIDATES}"`
+      );
+    }
+    if (
+      params.acceptanceRunId !== undefined &&
+      !executionResult.output.media.key.startsWith(`acceptance-runs/${params.acceptanceRunId}/`)
+    ) {
+      throw new AssemblySpecValidationError(
+        `Acceptance reel output key "${executionResult.output.media.key}" violates acceptance namespace isolation (must start with "acceptance-runs/${params.acceptanceRunId}/")`
+      );
+    }
+
     // Step 4: Construct immutable AssemblyManifest from exact executed state
     const manifest = createAssemblyManifest({
       executionResult,
@@ -364,7 +467,10 @@ export class AssembleDeliveryReel {
     const manifestJson = JSON.stringify(manifest, null, 2);
     const manifestBytes = Buffer.from(manifestJson, "utf-8");
     const checksumSha256 = createHash("sha256").update(manifestBytes).digest("hex");
-    const manifestKey = `campaigns/${executionResult.campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`;
+    const manifestKey =
+      params.targetBucket === BUCKETS.CANDIDATES && params.acceptanceRunId
+        ? `acceptance-runs/${params.acceptanceRunId}/manifest.json`
+        : `campaigns/${executionResult.campaignId}/assemblies/${executionResult.assemblyId}/manifest.json`;
 
     // Step 4a: Check if an AssemblyManifest already exists for this identity (idempotency & conflict prevention)
     const existingManifestObj = await this.deps.objectStorage.getObject({
diff --git a/packages/application/src/use-cases/create-campaign-shell.test.ts b/packages/application/src/use-cases/create-campaign-shell.test.ts
index 4de082c..c3b1704 100644
--- a/packages/application/src/use-cases/create-campaign-shell.test.ts
+++ b/packages/application/src/use-cases/create-campaign-shell.test.ts
@@ -2,8 +2,10 @@ import { describe, expect, it } from "vitest";
 import {
   CampaignDurationPlanningError,
   type CreateCampaignShellRequest,
-  type H3CandidateProfile
+  type H3CandidateProfile,
+  type StagingCandidateProfileSelection
 } from "@cco/contracts";
+import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import type { CampaignId, CampaignShellRecord } from "@cco/domain";
 import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
 import { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
@@ -566,4 +568,108 @@ describe("CreateCampaignShellUseCase", () => {
       ).rejects.toThrow();
     });
   });
+
+  describe("Planning authorization enforcement on supplied selection objects and scope/realm compatibility", () => {
+    const candidateKey = "H3_CANDIDATE_11111111111111111111111111111111_V1";
+    const authorityCandidateSelection: StagingCandidateProfileSelection = {
+      kind: "staging_candidate",
+      profileKey: candidateKey,
+      specificationDigest: "1".repeat(64),
+      targetId: "target-host-1",
+      authorizationId: "auth-1"
+    };
+
+    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
+      listAuthorizedCandidates: async () => [authorityCandidateSelection],
+      resolveCandidateGrant: async () => undefined
+    };
+
+    const mockRegistryReader = {
+      getCandidateProfile: () => undefined,
+      listCandidateProfiles: () => [],
+      isCandidateProfileKey: () => true,
+      resolveH3ProfileFrameCapabilities: (key: string | undefined) =>
+        key === candidateKey
+          ? {
+              profileKey: key,
+              route: "ref2v" as const,
+              routingMode: "reference_directed" as const,
+              width: 1344,
+              height: 768,
+              fps: 24,
+              allowedFrameCounts: [243],
+              isAllowedFrameCount: (f: number) => f === 243
+            }
+          : undefined,
+      isFrameCountAllowedForH3Profile: () => true
+    };
+
+    it("rejects forged caller-supplied executionProfileSelection when specificationDigest mismatches authority", async () => {
+      const uow = new InMemorySceneUnitOfWork();
+      const useCase = new CreateCampaignShellUseCase(uow, {
+        stagingAuthSource: mockStagingAuthSource,
+        registryReader: mockRegistryReader
+      });
+
+      const forgedSelection: StagingCandidateProfileSelection = {
+        kind: "staging_candidate",
+        profileKey: candidateKey,
+        specificationDigest: "2".repeat(64), // Mismatch!
+        targetId: "target-host-1",
+        authorizationId: "auth-1"
+      };
+
+      await expect(
+        useCase.execute({
+          ...validRequest,
+          targetTotalDurationMs: 10000,
+          scope: "staging",
+          executionProfileSelection: forgedSelection
+        })
+      ).rejects.toThrow(CampaignDurationPlanningError);
+    });
+
+    it("rejects forged member in allowedProfileSelections", async () => {
+      const uow = new InMemorySceneUnitOfWork();
+      const useCase = new CreateCampaignShellUseCase(uow, {
+        stagingAuthSource: mockStagingAuthSource,
+        registryReader: mockRegistryReader
+      });
+
+      const forgedAllowed: StagingCandidateProfileSelection = {
+        kind: "staging_candidate",
+        profileKey: candidateKey,
+        specificationDigest: "9".repeat(64), // Mismatch!
+        targetId: "target-host-1",
+        authorizationId: "auth-1"
+      };
+
+      await expect(
+        useCase.execute({
+          ...validRequest,
+          targetTotalDurationMs: 10000,
+          scope: "staging",
+          selectedProfileKey: candidateKey,
+          allowedProfileSelections: [forgedAllowed]
+        })
+      ).rejects.toThrow(CampaignDurationPlanningError);
+    });
+
+    it("rejects staging candidate in production scope", async () => {
+      const uow = new InMemorySceneUnitOfWork();
+      const useCase = new CreateCampaignShellUseCase(uow, {
+        stagingAuthSource: mockStagingAuthSource,
+        registryReader: mockRegistryReader
+      });
+
+      await expect(
+        useCase.execute({
+          ...validRequest,
+          targetTotalDurationMs: 10000,
+          scope: "production",
+          selectedProfileKey: candidateKey
+        })
+      ).rejects.toThrow(CampaignDurationPlanningError);
+    });
+  });
 });
diff --git a/packages/application/src/use-cases/create-campaign-shell.ts b/packages/application/src/use-cases/create-campaign-shell.ts
index 77f62f3..635f9f2 100644
--- a/packages/application/src/use-cases/create-campaign-shell.ts
+++ b/packages/application/src/use-cases/create-campaign-shell.ts
@@ -5,13 +5,7 @@ import {
   type CreativeBrief,
   type ExecutionProfileSelection,
   type ExecutionRealm,
-  type RenderProfileKey,
-  type H3ProfileFrameCapability,
   type H3CapabilityResolverReader,
-  type ReleasedProductionProfileKey,
-  resolveH3ProfileFrameCapabilities,
-  isReleasedProductionProfileKey,
-  isStagingCandidateProfileKey,
   CampaignDurationPlanningError
 } from "@cco/contracts";
 import type {
@@ -33,6 +27,7 @@ import { CampaignIdempotencyConflictError } from "./campaign-idempotency-conflic
 import { computeCampaignRequestHash } from "./campaign-request-hash.js";
 import { resolveSceneCount } from "./scene-count-policy.js";
 import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
+import { ProfileSelectionResolver } from "./profile-selection-resolver.js";
 
 export interface CreateCampaignShellInput extends CreateCampaignShellRequest {
   readonly brief?: CreativeBrief | undefined;
@@ -185,115 +180,53 @@ export class CreateCampaignShellUseCase {
         `Conflicting profile selectors: executionProfileSelection profileKey "${input.executionProfileSelection.profileKey}" does not match targetEngineProfileId "${input.targetEngineProfileId}"`
       );
     }
-
-    const capabilities = new Map<string, H3ProfileFrameCapability>();
-
-    if (this.options?.productionReleaseReader) {
-      // A release-authority outage must not block an independently verified legacy-only
-      // request (issue #426): capture failures here as "no released capabilities available"
-      // rather than propagating. A request that actually needs a released profile still
-      // fails explicitly below, via resolveSelection's own getReleasedProfile call.
-      const releases = await this.options.productionReleaseReader
-        .listReleasedProfiles()
-        .catch(() => []);
-      for (const rel of releases) {
-        const frames = rel.specification.frames;
-        capabilities.set(
-          rel.key,
-          Object.freeze({
-            profileKey: rel.key,
-            route: rel.specification.route,
-            routingMode: rel.specification.routingMode,
-            width: rel.specification.width,
-            height: rel.specification.height,
-            fps: rel.specification.fps,
-            allowedFrameCounts: Object.freeze([frames]),
-            isAllowedFrameCount: (f: number) => f === frames
-          })
+    if (
+      input.allowedProfileSelections !== undefined &&
+      input.allowedDurationProfileKeys !== undefined
+    ) {
+      const allowedObjectKeys = new Set(input.allowedProfileSelections.map((s) => s.profileKey));
+      const allowedStringKeys = new Set(input.allowedDurationProfileKeys);
+      if (
+        allowedObjectKeys.size !== allowedStringKeys.size ||
+        ![...allowedObjectKeys].every((k) => allowedStringKeys.has(k))
+      ) {
+        throw new CampaignDurationPlanningError(
+          "no_feasible_allocation",
+          `Conflicting allowed profile selectors: allowedProfileSelections keys do not match allowedDurationProfileKeys`
         );
       }
     }
 
-    if (this.options?.stagingAuthSource) {
-      // Same independence guarantee as above, for a staging-authority outage.
-      const candidates = await this.options.stagingAuthSource
-        .listAuthorizedCandidates(input.principal)
-        .catch(() => []);
-      for (const cand of candidates) {
-        const cap = resolveH3ProfileFrameCapabilities(cand.profileKey, this.options.registryReader);
-        if (cap) {
-          capabilities.set(cand.profileKey, cap);
-        }
-      }
-    }
-
-    const resolveSelection = async (key: string): Promise<ExecutionProfileSelection> => {
-      if (isReleasedProductionProfileKey(key)) {
-        if (!this.options?.productionReleaseReader) {
-          throw new CampaignDurationPlanningError(
-            "release_unavailable",
-            `No production release reader configured for released profile: ${key}`
-          );
-        }
-        const rel = await this.options.productionReleaseReader.getReleasedProfile(key);
-        if (!rel) {
-          throw new CampaignDurationPlanningError(
-            "release_unavailable",
-            `Released profile ${key} is not available or not enabled`
-          );
-        }
-        return {
-          kind: "released_production",
-          profileKey: key as ReleasedProductionProfileKey,
-          specificationDigest: rel.specificationDigest,
-          releaseId: rel.releaseId,
-          signedReleaseDigest: rel.signedReleaseDigest,
-          certificationRecordDigest: rel.certificationRecordDigest,
-          deploymentEnablementDigest: rel.deploymentEnablementDigest
-        };
-      }
-
-      if (isStagingCandidateProfileKey(key)) {
-        if (!this.options?.stagingAuthSource) {
-          throw new CampaignDurationPlanningError(
-            "capability_unavailable",
-            `No staging authorization source configured for candidate profile: ${key}`
-          );
-        }
-        const candidates = await this.options.stagingAuthSource.listAuthorizedCandidates(
-          input.principal
-        );
-        const cand = candidates.find((c) => c.profileKey === key);
-        if (!cand) {
-          throw new CampaignDurationPlanningError(
-            "capability_unavailable",
-            `Staging candidate ${key} is not authorized`
-          );
-        }
-        return cand;
-      }
+    const resolver = new ProfileSelectionResolver({
+      productionReleaseReader: this.options?.productionReleaseReader,
+      stagingAuthSource: this.options?.stagingAuthSource,
+      registryReader: this.options?.registryReader
+    });
 
-      return {
-        kind: "legacy_production",
-        profileKey: key as RenderProfileKey,
-        version: 1
-      };
-    };
+    const capabilities = await resolver.buildCapabilitiesMap(input.principal);
 
     let selectedProfileSelection: ExecutionProfileSelection;
     if (input.executionProfileSelection) {
-      selectedProfileSelection = input.executionProfileSelection;
+      selectedProfileSelection = await resolver.verifyAndResolveSelection(
+        input.executionProfileSelection,
+        input.principal
+      );
     } else {
       const keyToResolve =
         input.selectedProfileKey ?? input.targetEngineProfileId ?? "MINIMAX_H3_720P_5S_I2V_V1";
-      selectedProfileSelection = await resolveSelection(keyToResolve);
+      selectedProfileSelection = await resolver.resolveSelection(keyToResolve, input.principal);
     }
 
-    let allowedProfileSelections: readonly ExecutionProfileSelection[] | undefined =
-      input.allowedProfileSelections;
-    if (!allowedProfileSelections && input.allowedDurationProfileKeys) {
+    let allowedProfileSelections: readonly ExecutionProfileSelection[] | undefined;
+    if (input.allowedProfileSelections) {
+      allowedProfileSelections = await Promise.all(
+        input.allowedProfileSelections.map((sel) =>
+          resolver.verifyAndResolveSelection(sel, input.principal)
+        )
+      );
+    } else if (input.allowedDurationProfileKeys) {
       allowedProfileSelections = await Promise.all(
-        input.allowedDurationProfileKeys.map((k) => resolveSelection(k))
+        input.allowedDurationProfileKeys.map((k) => resolver.resolveSelection(k, input.principal))
       );
     }
 
@@ -301,6 +234,24 @@ export class CreateCampaignShellUseCase {
       input.scope ??
       (selectedProfileSelection.kind === "staging_candidate" ? "staging" : "production");
 
+    resolver.verifyScopeAndRealm(selectedProfileSelection, scope, realm);
+    if (allowedProfileSelections) {
+      for (const allowed of allowedProfileSelections) {
+        resolver.verifyScopeAndRealm(allowed, scope, realm);
+      }
+    }
+
+    if (
+      allowedProfileSelections &&
+      allowedProfileSelections.length > 0 &&
+      !allowedProfileSelections.some((s) => s.profileKey === selectedProfileSelection.profileKey)
+    ) {
+      throw new CampaignDurationPlanningError(
+        "no_feasible_allocation",
+        `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
+      );
+    }
+
     const plan = planFeasibleCampaignDuration({
       campaignId,
       targetTotalDurationMs: input.targetTotalDurationMs,
diff --git a/packages/application/src/use-cases/index.ts b/packages/application/src/use-cases/index.ts
index 5d51124..2b7f10d 100644
--- a/packages/application/src/use-cases/index.ts
+++ b/packages/application/src/use-cases/index.ts
@@ -105,3 +105,5 @@ export * from "./stage-h3-candidate-render.js";
 export * from "./deterministic-duration-feasibility.js";
 export * from "./replan-campaign.js";
 export * from "./operator-acceptance-run.js";
+export * from "./resolve-operator-acceptance-reel.js";
+export * from "./profile-selection-resolver.js";
diff --git a/packages/application/src/use-cases/operator-acceptance-run.test.ts b/packages/application/src/use-cases/operator-acceptance-run.test.ts
index ada9598..df1b08a 100644
--- a/packages/application/src/use-cases/operator-acceptance-run.test.ts
+++ b/packages/application/src/use-cases/operator-acceptance-run.test.ts
@@ -15,7 +15,8 @@ import {
   type H3CandidateAuthorizationGrant,
   type H3CandidateProfileKey,
   type StagingCandidateProfileSelection,
-  CampaignDurationPlanningError
+  CampaignDurationPlanningError,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
@@ -206,18 +207,34 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     const mockStageRenderUseCase = {
       executeWithContext: async (_context: unknown, _input: unknown) => {
         const jobId = randomUUID();
+        const stageInput = _input as {
+          sceneId: SceneId;
+          candidateProfileKey: string;
+          acceptanceRunId: string;
+        };
         uow.seedVideoStemSource(jobId, {
           generationManifestId: randomUUID(),
+          jobId,
+          sceneId: stageInput.sceneId,
+          renderProfile: stageInput.candidateProfileKey,
+          route: "ref2v",
+          routingMode: "reference_directed",
+          candidateSpecificationDigest: "b".repeat(64),
+          specRevision: 1,
+          frames: 124,
+          fps: 24,
+          outputChecksumsSha256: ["0".repeat(64)],
           renderAttempt: 1,
           executionScope: "staging",
           ownerKind: "staging_acceptance",
+          acceptanceRunId: stageInput.acceptanceRunId,
           realm: isolatedTestRealm,
           evidenceOrigin: "simulated_test",
           measuredMedia: {
-            outputKey: "videos/stem-1.mp4",
+            outputKey: `videos/stem-${stageInput.sceneId}.mp4`,
             checksumSha256: "0".repeat(64),
             container: "ffprobe",
-            dimensions: { width: 720, height: 1280 },
+            dimensions: { width: 1344, height: 768 },
             frameCount: 124,
             fps: 24,
             durationMs: 5167,
@@ -226,7 +243,7 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
           },
           media: {
             bucket: "staging-bucket",
-            key: "videos/stem-1.mp4",
+            key: `videos/stem-${stageInput.sceneId}.mp4`,
             sha256: "0".repeat(64),
             contentType: "video/mp4"
           }
@@ -257,6 +274,23 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     expect(beginRes.sceneCount).toBe(2);
     expect(beginRes.dispatchedJobIds).toHaveLength(2);
 
+    // 1a. Idempotent replay of begin
+    const beginReplay = await beginUseCase.execute({
+      campaignId,
+      actionId: "act-begin-staging",
+      requestedBy: "operator"
+    });
+    expect(beginReplay).toEqual(beginRes);
+
+    // 1b. Idempotent conflict on begin with altered payload
+    await expect(
+      beginUseCase.execute({
+        campaignId,
+        actionId: "act-begin-staging",
+        requestedBy: "different-operator"
+      })
+    ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
+
     // 2. Attempt assemble before accepting scenes -> must fail
     await expect(
       assembleUseCase.execute({
@@ -276,6 +310,27 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     });
     expect(accept1.accepted).toBe(true);
 
+    // 3a. Idempotent replay of accept scene 1
+    const accept1Replay = await acceptUseCase.execute({
+      acceptanceRunId: beginRes.acceptanceRunId,
+      sceneId: scenes[0]!.id,
+      actionId: "act-accept-scene-1",
+      expectedAttemptOrdinal: 1,
+      acceptedBy: "operator"
+    });
+    expect(accept1Replay).toEqual(accept1);
+
+    // 3b. Idempotent conflict on accept scene 1
+    await expect(
+      acceptUseCase.execute({
+        acceptanceRunId: beginRes.acceptanceRunId,
+        sceneId: scenes[0]!.id,
+        actionId: "act-accept-scene-1",
+        expectedAttemptOrdinal: 2,
+        acceptedBy: "operator"
+      })
+    ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
+
     // Still cannot assemble (scene 2 not accepted)
     await expect(
       assembleUseCase.execute({
@@ -305,6 +360,23 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
     expect(assembleRes.status).toBe("assembling");
     expect(assembleRes.assemblyJobId).toBeDefined();
 
+    // 5a. Idempotent replay of assemble
+    const assembleReplay = await assembleUseCase.execute({
+      acceptanceRunId: beginRes.acceptanceRunId,
+      actionId: "act-assemble-final",
+      requestedBy: "operator"
+    });
+    expect(assembleReplay).toEqual(assembleRes);
+
+    // 5b. Idempotent conflict on assemble with altered requestedBy
+    await expect(
+      assembleUseCase.execute({
+        acceptanceRunId: beginRes.acceptanceRunId,
+        actionId: "act-assemble-final",
+        requestedBy: "different-operator"
+      })
+    ).rejects.toThrow(OperatorAcceptanceIdempotencyConflictError);
+
     // Verify stored acceptance run state
     await uow.execute(async (context) => {
       const run = await context.operatorAcceptanceRuns!.findRunById(beginRes.acceptanceRunId);
@@ -490,4 +562,98 @@ describe("Operator Acceptance Run lifecycle and execution isolation", () => {
       expect(res.assemblyJobId).toBeDefined();
     });
   });
+
+  it("AcceptOperatorAcceptanceSceneUseCase rejects stem with frame count mismatch or invalid checksum", async () => {
+    const { campaignId, scenes, stagingPlan, uow } = setupStagingCampaign(1);
+    await uow.execute(async (context) => {
+      await context.durationPlans!.savePlan(stagingPlan);
+    });
+
+    const mockGrant: H3CandidateAuthorizationGrant = {
+      payload: {
+        version: 1,
+        candidateKey: stagingCandidateRef2v.profileKey as H3CandidateProfileKey,
+        specificationDigest: "b".repeat(64),
+        goldMasterWorkflowHash: "c".repeat(64),
+        goldMasterModelHashesDigest: "d".repeat(64),
+        targetHostname: "test-host",
+        targetGpuUuid: "GPU-1234",
+        purpose: "staging",
+        scope: "staging",
+        issuedAt: new Date(Date.now() - 60_000).toISOString(),
+        expiresAt: new Date(Date.now() + 60_000).toISOString(),
+        operatorId: "operator-1"
+      },
+      signature: "0123456789abcdef".repeat(4),
+      signerKeyId: "auth-1"
+    };
+
+    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
+      listAuthorizedCandidates: async () => [
+        stagingCandidateRef2v as StagingCandidateProfileSelection
+      ],
+      resolveCandidateGrant: async () => mockGrant
+    };
+
+    const seededFrames = 999; // intentionally mismatched frames
+    const mockStageRenderUseCase = {
+      executeWithContext: async (_context: unknown, _input: unknown) => {
+        const jobId = randomUUID();
+        uow.seedVideoStemSource(jobId, {
+          generationManifestId: randomUUID(),
+          renderAttempt: 1,
+          executionScope: "staging",
+          ownerKind: "staging_acceptance",
+          realm: isolatedTestRealm,
+          evidenceOrigin: "simulated_test",
+          renderProfile: stagingCandidateRef2v.profileKey,
+          frames: seededFrames,
+          measuredMedia: {
+            outputKey: "videos/stem-bad.mp4",
+            checksumSha256: "0".repeat(64),
+            container: "ffprobe",
+            dimensions: { width: 720, height: 1280 },
+            frameCount: seededFrames,
+            fps: 24,
+            durationMs: 5167,
+            formatDurationMs: 5167,
+            measurement: "source_bytes"
+          },
+          media: {
+            bucket: "staging-bucket",
+            key: "videos/stem-bad.mp4",
+            sha256: "0".repeat(64),
+            contentType: "video/mp4"
+          }
+        });
+        return {
+          job: { jobId },
+          attemptId: randomUUID()
+        };
+      }
+    } as unknown as StageH3CandidateRenderUseCase;
+
+    const beginUseCase = new BeginOperatorAcceptanceRunUseCase({
+      uow,
+      stagingAuthSource: mockStagingAuthSource,
+      stageRenderUseCase: mockStageRenderUseCase
+    });
+    const acceptUseCase = new AcceptOperatorAcceptanceSceneUseCase({ uow });
+
+    const beginRes = await beginUseCase.execute({
+      campaignId,
+      actionId: "act-begin-mismatch-test",
+      requestedBy: "operator"
+    });
+
+    await expect(
+      acceptUseCase.execute({
+        acceptanceRunId: beginRes.acceptanceRunId,
+        sceneId: scenes[0]!.id,
+        actionId: "act-accept-bad-stem",
+        expectedAttemptOrdinal: 1,
+        acceptedBy: "operator"
+      })
+    ).rejects.toThrow(/does not match scene frames/i);
+  });
 });
diff --git a/packages/application/src/use-cases/operator-acceptance-run.ts b/packages/application/src/use-cases/operator-acceptance-run.ts
index d9e0bf2..e22a250 100644
--- a/packages/application/src/use-cases/operator-acceptance-run.ts
+++ b/packages/application/src/use-cases/operator-acceptance-run.ts
@@ -1,4 +1,4 @@
-import { randomUUID } from "node:crypto";
+import { createHash, randomUUID } from "node:crypto";
 import {
   type AcceptanceAssemblyJob,
   type AcceptanceRunScene,
@@ -7,12 +7,14 @@ import {
   type BeginOperatorAcceptanceRunRequest,
   type BeginOperatorAcceptanceRunResponse,
   type OperatorAcceptanceRun,
+  canonicalizeJson,
   CampaignDurationPlanningError,
   OperatorAcceptanceRunNotFoundError,
   OperatorAcceptanceSceneNotFoundError,
   OperatorAcceptanceOrdinalMismatchError,
   OperatorAcceptanceInvalidStatusError,
-  OperatorAcceptanceSceneNotAcceptedError
+  OperatorAcceptanceSceneNotAcceptedError,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import type { UnitOfWork } from "../ports/unit-of-work.js";
 import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
@@ -20,6 +22,192 @@ import type { StagingPlanningAuthorizationSource } from "../ports/staging-planni
 import type { VideoStemSourceRecord } from "../ports/generation-manifest-repository.js";
 import { validateAssemblySpec } from "../ports/assembly-spec.js";
 
+export function computeAcceptanceActionRequestHash(action: string, payload: unknown): string {
+  return createHash("sha256").update(canonicalizeJson({ action, payload })).digest("hex");
+}
+
+export function deterministicUuid(seed: string): string {
+  const hash = createHash("sha256").update(seed).digest("hex");
+  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
+}
+
+export function validateAcceptanceStemSource(
+  scene: AcceptanceRunScene,
+  stemSource: VideoStemSourceRecord,
+  expectedRunContext?: {
+    realm?: unknown;
+    evidenceOrigin?: unknown;
+  }
+): void {
+  if (!stemSource.renderProfile || stemSource.renderProfile !== scene.profileKey) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem renderProfile '${stemSource.renderProfile}' does not match scene profileKey '${scene.profileKey}'`
+    );
+  }
+
+  if (stemSource.frames === undefined || stemSource.frames !== scene.frames) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem frame count ${stemSource.frames} does not match scene frames ${scene.frames}`
+    );
+  }
+
+  if (stemSource.fps === undefined || Math.abs(stemSource.fps - scene.fps) > 0.01) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem fps ${stemSource.fps} does not match scene fps ${scene.fps}`
+    );
+  }
+
+  if (!stemSource.sceneId || stemSource.sceneId !== scene.sceneId) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem sceneId '${stemSource.sceneId}' does not match expected sceneId '${scene.sceneId}'`
+    );
+  }
+
+  if (
+    !scene.candidateSpecificationDigest ||
+    !stemSource.candidateSpecificationDigest ||
+    stemSource.candidateSpecificationDigest !== scene.candidateSpecificationDigest
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem candidateSpecificationDigest '${stemSource.candidateSpecificationDigest}' does not match expected '${scene.candidateSpecificationDigest}'`
+    );
+  }
+
+  if (stemSource.specRevision === undefined || stemSource.specRevision !== scene.specRevision) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem specRevision ${stemSource.specRevision} does not match scene specRevision ${scene.specRevision}`
+    );
+  }
+
+  if (stemSource.executionScope !== "staging") {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem executionScope '${stemSource.executionScope}' must be 'staging'`
+    );
+  }
+
+  if (stemSource.ownerKind !== "staging_acceptance") {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem ownerKind '${stemSource.ownerKind}' must be 'staging_acceptance'`
+    );
+  }
+
+  if (!stemSource.acceptanceRunId || stemSource.acceptanceRunId !== scene.acceptanceRunId) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem acceptanceRunId '${stemSource.acceptanceRunId}' does not match scene acceptanceRunId '${scene.acceptanceRunId}'`
+    );
+  }
+
+  if (!stemSource.realm) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem source is missing required realm`
+    );
+  }
+
+  if (!stemSource.evidenceOrigin) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem source is missing required evidenceOrigin`
+    );
+  }
+
+  if (
+    expectedRunContext?.realm &&
+    canonicalizeJson(stemSource.realm) !== canonicalizeJson(expectedRunContext.realm)
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem realm does not match acceptance run realm`
+    );
+  }
+
+  if (
+    expectedRunContext?.evidenceOrigin &&
+    stemSource.evidenceOrigin !== expectedRunContext.evidenceOrigin
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem evidenceOrigin '${stemSource.evidenceOrigin}' does not match acceptance run evidenceOrigin '${expectedRunContext.evidenceOrigin}'`
+    );
+  }
+
+  if (!stemSource.measuredMedia) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem source is missing required measuredMedia`
+    );
+  }
+
+  if (stemSource.measuredMedia.frameCount !== scene.frames) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia frameCount ${stemSource.measuredMedia.frameCount} does not match scene frames ${scene.frames}`
+    );
+  }
+
+  if (
+    stemSource.measuredMedia.fps === undefined ||
+    stemSource.measuredMedia.fps === null ||
+    Math.abs(stemSource.measuredMedia.fps - scene.fps) > 0.01
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia fps ${stemSource.measuredMedia.fps} does not match scene fps ${scene.fps}`
+    );
+  }
+
+  if (!stemSource.measuredMedia.dimensions) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      "Video stem measuredMedia is missing required dimensions"
+    );
+  }
+
+  if (
+    stemSource.measuredMedia.dimensions.width !== 1344 ||
+    stemSource.measuredMedia.dimensions.height !== 768
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia dimensions ${stemSource.measuredMedia.dimensions.width}x${stemSource.measuredMedia.dimensions.height} do not match configured 1344x768`
+    );
+  }
+
+  if (Math.abs(stemSource.measuredMedia.durationMs - scene.expectedDurationMs) > 355) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem measuredMedia duration ${stemSource.measuredMedia.durationMs}ms exceeds tolerance of expected duration ${scene.expectedDurationMs}ms`
+    );
+  }
+
+  if (!stemSource.media.sha256 || stemSource.media.sha256.length !== 64) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem media sha256 is invalid or empty`
+    );
+  }
+
+  if (
+    !stemSource.outputChecksumsSha256 ||
+    stemSource.outputChecksumsSha256.length === 0 ||
+    !stemSource.outputChecksumsSha256.includes(stemSource.media.sha256)
+  ) {
+    throw new CampaignDurationPlanningError(
+      "observation_authority_invalid",
+      `Video stem media sha256 '${stemSource.media.sha256}' is not present in outputChecksumsSha256`
+    );
+  }
+}
+
 export interface OperatorAcceptanceRunDependencies {
   readonly uow: UnitOfWork;
   readonly stageRenderUseCase?: StageH3CandidateRenderUseCase | undefined;
@@ -66,10 +254,45 @@ export class BeginOperatorAcceptanceRunUseCase {
         );
       }
 
+      const requestHash = computeAcceptanceActionRequestHash("begin", {
+        campaignId: input.campaignId,
+        actionId: input.actionId,
+        requestedBy: input.requestedBy,
+        planId: currentPlan.planId,
+        planRevision: currentPlan.revision,
+        realm: currentPlan.realm,
+        allocations: currentPlan.allocations.map((a) => ({
+          allocationId: a.allocationId,
+          profileKey: a.profileSelection.profileKey,
+          specificationDigest:
+            a.profileSelection.kind === "staging_candidate"
+              ? a.profileSelection.specificationDigest
+              : undefined,
+          frames: a.frames,
+          fps: a.fps,
+          nominalDurationMs: a.nominalDurationMs
+        }))
+      });
+
+      if (context.operatorAcceptanceRuns.findActionReceipt) {
+        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+          "begin",
+          input.campaignId,
+          input.actionId
+        );
+        if (existingReceipt) {
+          if (existingReceipt.requestHash !== requestHash) {
+            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+          }
+          return existingReceipt.response as unknown as BeginOperatorAcceptanceRunResponse;
+        }
+      }
+
       const scenes = await context.scenes.findByCampaignId(campaign.id);
       const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
 
-      const acceptanceRunId = randomUUID();
+      const acceptanceRunSeed = `acceptance-run:${campaign.id}:${currentPlan.planId}:${input.actionId}`;
+      const acceptanceRunId = deterministicUuid(acceptanceRunSeed);
       const now = new Date().toISOString();
 
       const run: OperatorAcceptanceRun = {
@@ -137,7 +360,7 @@ export class BeginOperatorAcceptanceRunUseCase {
           sceneId: scene.id,
           candidateProfileKey: candidateKey,
           grant,
-          requestId: `stage-${acceptanceRunId}-${scene.id}`,
+          requestId: `stage-${campaign.id}-${currentPlan.planId}-${scene.id}-${input.actionId}`,
           ownerKind: "staging_acceptance",
           acceptanceRunId
         });
@@ -160,19 +383,55 @@ export class BeginOperatorAcceptanceRunUseCase {
           currentAttemptOrdinal: 1,
           acceptedStagingJobId: stagingJobId,
           acceptedAttemptId: undefined,
-          acceptedAttemptOrdinal: undefined
+          acceptedAttemptOrdinal: undefined,
+          candidateSpecificationDigest:
+            allocation.profileSelection.kind === "staging_candidate"
+              ? allocation.profileSelection.specificationDigest
+              : undefined,
+          planId: currentPlan.planId
         });
       }
 
-      await context.operatorAcceptanceRuns.createRun(run, runScenes);
+      try {
+        await context.operatorAcceptanceRuns.createRun(run, runScenes);
+      } catch (createErr) {
+        if (context.operatorAcceptanceRuns.findActionReceipt) {
+          const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+            "begin",
+            input.campaignId,
+            input.actionId
+          );
+          if (existingReceipt) {
+            if (existingReceipt.requestHash !== requestHash) {
+              throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+            }
+            return existingReceipt.response as unknown as BeginOperatorAcceptanceRunResponse;
+          }
+        }
+        throw createErr;
+      }
 
-      return {
+      const response: BeginOperatorAcceptanceRunResponse = {
         acceptanceRunId,
         campaignId: campaign.id,
         status: "dispatched",
         sceneCount: sortedScenes.length,
         dispatchedJobIds
       };
+
+      if (context.operatorAcceptanceRuns.saveActionReceipt) {
+        await context.operatorAcceptanceRuns.saveActionReceipt({
+          actionId: input.actionId,
+          scope: "begin",
+          runOrCampaignId: input.campaignId,
+          realm: currentPlan.realm,
+          requestHash,
+          response: response as unknown as Record<string, unknown>,
+          createdAt: now
+        });
+      }
+
+      return response;
     });
   }
 }
@@ -197,6 +456,29 @@ export class AcceptOperatorAcceptanceSceneUseCase {
         throw new OperatorAcceptanceRunNotFoundError(input.acceptanceRunId);
       }
 
+      const requestHash = computeAcceptanceActionRequestHash("accept_scene", {
+        acceptanceRunId: input.acceptanceRunId,
+        sceneId: input.sceneId,
+        actionId: input.actionId,
+        expectedAttemptOrdinal: input.expectedAttemptOrdinal,
+        acceptedBy: input.acceptedBy
+      });
+
+      const actionKey = `${input.acceptanceRunId}:${input.sceneId}:${input.actionId}`;
+      if (context.operatorAcceptanceRuns.findActionReceipt) {
+        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+          "accept_scene",
+          input.acceptanceRunId,
+          actionKey
+        );
+        if (existingReceipt) {
+          if (existingReceipt.requestHash !== requestHash) {
+            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+          }
+          return existingReceipt.response as unknown as { readonly accepted: boolean };
+        }
+      }
+
       const runScenes = await context.operatorAcceptanceRuns.findRunScenes(input.acceptanceRunId);
       const scene = runScenes.find((s) => s.sceneId === input.sceneId);
       if (!scene) {
@@ -240,12 +522,10 @@ export class AcceptOperatorAcceptanceSceneUseCase {
         );
       }
 
-      if (!stemSource.measuredMedia) {
-        throw new CampaignDurationPlanningError(
-          "observation_authority_invalid",
-          `Video stem source for staging job '${stagingJobId}' is missing required measuredMedia`
-        );
-      }
+      validateAcceptanceStemSource(scene, stemSource, {
+        realm: run.realm,
+        evidenceOrigin: run.evidenceOrigin
+      });
 
       await context.operatorAcceptanceRuns.updateSceneAcceptedAttempt(
         input.acceptanceRunId,
@@ -255,7 +535,21 @@ export class AcceptOperatorAcceptanceSceneUseCase {
         scene.currentAttemptOrdinal
       );
 
-      return { accepted: true };
+      const response = { accepted: true };
+
+      if (context.operatorAcceptanceRuns.saveActionReceipt) {
+        await context.operatorAcceptanceRuns.saveActionReceipt({
+          actionId: actionKey,
+          scope: "accept_scene",
+          runOrCampaignId: input.acceptanceRunId,
+          realm: run.realm,
+          requestHash,
+          response: response as unknown as Record<string, unknown>,
+          createdAt: new Date().toISOString()
+        });
+      }
+
+      return response;
     });
   }
 }
@@ -279,6 +573,26 @@ export class AssembleOperatorAcceptanceRunUseCase {
         throw new OperatorAcceptanceRunNotFoundError(input.acceptanceRunId);
       }
 
+      const requestHash = computeAcceptanceActionRequestHash("assemble", {
+        acceptanceRunId: input.acceptanceRunId,
+        actionId: input.actionId,
+        requestedBy: input.requestedBy
+      });
+
+      if (context.operatorAcceptanceRuns.findActionReceipt) {
+        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
+          "assemble",
+          input.acceptanceRunId,
+          input.actionId
+        );
+        if (existingReceipt) {
+          if (existingReceipt.requestHash !== requestHash) {
+            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
+          }
+          return existingReceipt.response as unknown as AssembleOperatorAcceptanceRunResponse;
+        }
+      }
+
       if (
         (run.status === "assembling" || run.status === "completed") &&
         run.assemblyJobId &&
@@ -336,6 +650,10 @@ export class AssembleOperatorAcceptanceRunUseCase {
             `Generation manifest and video stem source not found for accepted staging job '${s.acceptedStagingJobId}'`
           );
         }
+        validateAcceptanceStemSource(s, stemSource, {
+          realm: run.realm,
+          evidenceOrigin: run.evidenceOrigin
+        });
         videoStems.push({
           order: idx,
           sceneId: s.sceneId,
@@ -371,11 +689,25 @@ export class AssembleOperatorAcceptanceRunUseCase {
         input.actionId
       );
 
-      return {
+      const response: AssembleOperatorAcceptanceRunResponse = {
         acceptanceRunId: run.acceptanceRunId,
         assemblyJobId,
         status: "assembling"
       };
+
+      if (context.operatorAcceptanceRuns.saveActionReceipt) {
+        await context.operatorAcceptanceRuns.saveActionReceipt({
+          actionId: input.actionId,
+          scope: "assemble",
+          runOrCampaignId: run.acceptanceRunId,
+          realm: run.realm,
+          requestHash,
+          response: response as unknown as Record<string, unknown>,
+          createdAt: new Date().toISOString()
+        });
+      }
+
+      return response;
     });
   }
 }
diff --git a/packages/application/src/use-cases/replan-campaign.test.ts b/packages/application/src/use-cases/replan-campaign.test.ts
index 676a502..57a21a7 100644
--- a/packages/application/src/use-cases/replan-campaign.test.ts
+++ b/packages/application/src/use-cases/replan-campaign.test.ts
@@ -2,10 +2,13 @@ import { describe, expect, it } from "vitest";
 import { Scene, type CampaignId, type CampaignRecord, type SceneId } from "@cco/domain";
 import {
   CampaignDurationPlanningError,
+  computeH3ReleaseKey,
   type CampaignDurationPlan,
   type DeployedRealm,
-  type ExecutionProfileSelection
+  type ExecutionProfileSelection,
+  type StagingCandidateProfileSelection
 } from "@cco/contracts";
+import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
 import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
 import { PreviewCampaignReplanUseCase, CommitCampaignReplanUseCase } from "./replan-campaign.js";
@@ -374,4 +377,308 @@ describe("Campaign duration replan and review guards", () => {
       expect(s0?.status).not.toBe("approved");
     });
   });
+
+  it("PreviewCampaignReplanUseCase and CommitCampaignReplanUseCase succeed for 243f candidate profile with stagingAuthSource", async () => {
+    const candidateKey = "H3_CANDIDATE_da62255eb7245c2cc0ac588325ccd3d3_V1";
+    const stagingCandidateSelection: StagingCandidateProfileSelection = {
+      kind: "staging_candidate",
+      profileKey: candidateKey,
+      specificationDigest: "da62255eb7245c2cc0ac588325ccd3d3518f5ac93e6e6775a21be5777eeaf0e7",
+      targetId: "llama",
+      authorizationId: "auth-243f"
+    };
+
+    const mockStagingAuthSource: StagingPlanningAuthorizationSource = {
+      listAuthorizedCandidates: async () => [stagingCandidateSelection],
+      resolveCandidateGrant: async () => undefined
+    };
+
+    const mockRegistryReader = {
+      getCandidateProfile: () => undefined,
+      listCandidateProfiles: () => [],
+      isCandidateProfileKey: () => true,
+      resolveH3ProfileFrameCapabilities: (key: string | undefined) =>
+        key === candidateKey
+          ? {
+              profileKey: key,
+              route: "ref2v" as const,
+              routingMode: "reference_directed" as const,
+              width: 1344,
+              height: 768,
+              fps: 24,
+              allowedFrameCounts: [243],
+              isAllowedFrameCount: (f: number) => f === 243
+            }
+          : undefined,
+      isFrameCountAllowedForH3Profile: () => true
+    };
+
+    const { campaignId, scenes, uow } = setupCampaignWithScenes(2);
+    const stagingPlan = planFeasibleCampaignDuration({
+      campaignId,
+      targetTotalDurationMs: 20000,
+      selectedProfileSelection: stagingCandidateSelection,
+      realm: {
+        kind: "isolated_test",
+        testRealmId: "realm-1",
+        isolationDescriptorDigest: "a".repeat(64)
+      },
+      scope: "staging",
+      capabilities: new Map([
+        [candidateKey, mockRegistryReader.resolveH3ProfileFrameCapabilities(candidateKey)!]
+      ])
+    });
+
+    await uow.execute(async (context) => {
+      const camp = await context.campaigns!.findById(campaignId);
+      await context.campaigns!.save({
+        ...camp!,
+        targetTotalDurationMs: 20000
+      });
+      await context.durationPlans!.savePlan(stagingPlan);
+    });
+
+    const previewUseCase = new PreviewCampaignReplanUseCase({
+      uow,
+      stagingAuthSource: mockStagingAuthSource,
+      registryReader: mockRegistryReader
+    });
+
+    const previewResult = await previewUseCase.execute({
+      campaignId,
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: candidateKey
+    });
+
+    expect(previewResult.feasible).toBe(true);
+    expect(previewResult.proposedPlan?.allocations[0]?.frames).toBe(243);
+
+    const commitUseCase = new CommitCampaignReplanUseCase({
+      uow,
+      stagingAuthSource: mockStagingAuthSource,
+      registryReader: mockRegistryReader
+    });
+
+    const commitResult = await commitUseCase.execute({
+      campaignId,
+      actionId: "replan-staging-243f",
+      expectedPlanRevision: 1,
+      expectedSceneSpecRevisions: {
+        [scenes[0]!.id]: 1,
+        [scenes[1]!.id]: 1
+      },
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: candidateKey
+    });
+
+    expect(commitResult.newPlanRevision).toBe(2);
+    expect(commitResult.plan.allocations[0]?.frames).toBe(243);
+  });
+
+  it("PreviewCampaignReplanUseCase rejects single scene exceeding 15000ms max scene ceiling", async () => {
+    const { campaignId, scenes, plan, uow } = setupCampaignWithScenes(2);
+
+    await uow.execute(async (context) => {
+      const camp = await context.campaigns!.findById(campaignId);
+      await context.campaigns!.save({
+        ...camp!,
+        targetTotalDurationMs: 20000
+      });
+      await context.durationPlans!.savePlan(plan);
+    });
+
+    const previewUseCase = new PreviewCampaignReplanUseCase({ uow });
+
+    const previewResult = await previewUseCase.execute({
+      campaignId,
+      sceneIdDurations: {
+        [scenes[0]!.id]: 16000,
+        [scenes[1]!.id]: 4000
+      }
+    });
+
+    expect(previewResult.feasible).toBe(false);
+    expect(previewResult.error).toContain("exceeds maximum permissible scene duration 15000ms");
+  });
+
+  it("PreviewCampaignReplanUseCase and CommitCampaignReplanUseCase succeed for test-authorized released_production profile in production scope", async () => {
+    const releaseDigest = "b".repeat(64);
+    const releaseKey = computeH3ReleaseKey(releaseDigest, 1);
+    const spec = {
+      version: 1 as const,
+      route: "ref2v" as const,
+      routingMode: "reference_directed" as const,
+      workflowHash: "c".repeat(64),
+      frames: 243,
+      fps: 24 as const,
+      width: 1344,
+      height: 768,
+      sampler: "res_multistep",
+      scheduler: "simple",
+      steps: 4,
+      cfg: 1,
+      denoise: 1,
+      modelHashes: {
+        checkpoint: "1".repeat(64),
+        clip: "2".repeat(64),
+        audioVae: "3".repeat(64),
+        videoVae: "4".repeat(64),
+        turboLora: "5".repeat(64),
+        additionalModels: {}
+      },
+      attention: {
+        backend: "comfy_native" as const,
+        customNodeRevision: "none",
+        customNodeSourceHash: "none",
+        packageVersion: "none",
+        sparsitySettings: {
+          enabled: false as const,
+          method: "none" as const,
+          threshold: 0 as const
+        }
+      },
+      customNodes: [],
+      packageVersions: {
+        torch: "2.13.0+cu130",
+        comfyui: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
+      },
+      runnerSettings: {
+        runnerProfile: "dynamicvram-offload-v1",
+        offloadPolicy: "dynamicvram" as const,
+        requiresModelOffloading: true,
+        maxConcurrentGpuJobs: 1,
+        minFreeDiskGb: 20
+      },
+      expectedCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+      expectedPythonExecutable: "/bin/python3"
+    };
+
+    const releasedProfile = {
+      key: releaseKey,
+      version: 1 as const,
+      specificationDigest: releaseDigest,
+      specification: spec,
+      topology: {
+        prompt: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "prompt" },
+        seed: { nodeId: "2", classType: "RandomNoise", inputField: "noise_seed" },
+        frameCount: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "length" },
+        referenceImage: { nodeId: "3", classType: "LoadImage", inputField: "image" },
+        firstFrame: { nodeId: "3", classType: "LoadImage", inputField: "image" },
+        width: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "width" },
+        height: { nodeId: "1", classType: "MiniMaxH3ReferenceToVideo", inputField: "height" }
+      },
+      releaseId: "rel-1",
+      signedReleaseDigest: "d".repeat(64),
+      certificationRecordDigest: "e".repeat(64),
+      deploymentEnablementDigest: "f".repeat(64),
+      speedDecision: {
+        specificationDigest: releaseDigest,
+        specification: spec,
+        speedVerdict: "pass" as const,
+        qualityVerdict: "pass" as const,
+        overallVerdict: "pass" as const,
+        evidenceDigests: [],
+        operatorIdentity: "operator",
+        decidedAt: new Date().toISOString()
+      },
+      certificationVerdict: "released" as const,
+      operatorIdentity: "operator",
+      releasedAt: new Date().toISOString()
+    };
+
+    const mockProductionReleaseReader = {
+      listReleasedProfiles: async () => [releasedProfile],
+      getReleasedProfile: async (key: string) => (key === releaseKey ? releasedProfile : undefined),
+      isReleasedProfileKey: async (key: string) => key === releaseKey,
+      getDeploymentEnablementState: async () => undefined
+    };
+
+    const { campaignId, scenes, uow } = setupCampaignWithScenes(2);
+    const prodPlan = planFeasibleCampaignDuration({
+      campaignId,
+      targetTotalDurationMs: 20000,
+      selectedProfileSelection: {
+        kind: "released_production",
+        profileKey: releaseKey,
+        specificationDigest: releaseDigest,
+        releaseId: "rel-1",
+        signedReleaseDigest: "d".repeat(64),
+        certificationRecordDigest: "e".repeat(64),
+        deploymentEnablementDigest: "f".repeat(64)
+      },
+      realm: { kind: "deployed", deploymentId: "prod-deploy-1" },
+      scope: "production",
+      capabilities: new Map([
+        [
+          releaseKey,
+          {
+            profileKey: releaseKey,
+            route: "ref2v" as const,
+            routingMode: "reference_directed" as const,
+            width: 1344,
+            height: 768,
+            fps: 24,
+            allowedFrameCounts: [243],
+            isAllowedFrameCount: (f: number) => f === 243
+          }
+        ]
+      ])
+    });
+
+    await uow.execute(async (context) => {
+      const camp = await context.campaigns!.findById(campaignId);
+      await context.campaigns!.save({
+        ...camp!,
+        targetTotalDurationMs: 20000
+      });
+      await context.durationPlans!.savePlan(prodPlan);
+    });
+
+    const previewUseCase = new PreviewCampaignReplanUseCase({
+      uow,
+      productionReleaseReader: mockProductionReleaseReader
+    });
+
+    const previewResult = await previewUseCase.execute({
+      campaignId,
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: releaseKey
+    });
+
+    expect(previewResult.feasible).toBe(true);
+    expect(previewResult.proposedPlan?.allocations[0]?.frames).toBe(243);
+
+    const commitUseCase = new CommitCampaignReplanUseCase({
+      uow,
+      productionReleaseReader: mockProductionReleaseReader
+    });
+
+    const commitResult = await commitUseCase.execute({
+      campaignId,
+      actionId: "replan-prod-released-243f",
+      expectedPlanRevision: 1,
+      expectedSceneSpecRevisions: {
+        [scenes[0]!.id]: 1,
+        [scenes[1]!.id]: 1
+      },
+      sceneIdDurations: {
+        [scenes[0]!.id]: 10000,
+        [scenes[1]!.id]: 10000
+      },
+      selectedProfileKey: releaseKey
+    });
+
+    expect(commitResult.newPlanRevision).toBe(2);
+    expect(commitResult.plan.allocations[0]?.frames).toBe(243);
+    expect(commitResult.plan.scope).toBe("production");
+  });
 });
diff --git a/packages/application/src/use-cases/replan-campaign.ts b/packages/application/src/use-cases/replan-campaign.ts
index f38f171..d181396 100644
--- a/packages/application/src/use-cases/replan-campaign.ts
+++ b/packages/application/src/use-cases/replan-campaign.ts
@@ -1,22 +1,30 @@
 import { createHash, randomUUID } from "node:crypto";
 import {
-  type CampaignDurationPlan,
   type ExecutionProfileSelection,
   type ReplanCampaignPreviewRequest,
   type ReplanCampaignPreviewResponse,
   type ReplanCampaignCommitRequest,
   type ReplanCampaignCommitResponse,
   type SceneDurationBinding,
-  type LegacyProductionProfileKey,
+  type H3CapabilityResolverReader,
+  type H3ProfileFrameCapability,
   computePlanBindingDigest,
-  isReleasedProductionProfileKey,
-  isStagingCandidateProfileKey,
   CampaignDurationPlanningError
 } from "@cco/contracts";
 import type { ReplanActionReceipt } from "../ports/campaign-duration-plan-repository.js";
 import type { UnitOfWork } from "../ports/unit-of-work.js";
+import type { ProductionReleaseCapabilityReader } from "../ports/production-release-ports.js";
+import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
 import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";
 import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
+import { ProfileSelectionResolver } from "./profile-selection-resolver.js";
+
+export interface ReplanCampaignDependencies {
+  readonly uow: UnitOfWork;
+  readonly productionReleaseReader?: ProductionReleaseCapabilityReader | undefined;
+  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
+  readonly registryReader?: H3CapabilityResolverReader | undefined;
+}
 
 export function computeReplanRequestHash(input: ReplanCampaignCommitRequest): string {
   const sortedSceneDurations = Object.keys(input.sceneIdDurations)
@@ -33,43 +41,14 @@ export function computeReplanRequestHash(input: ReplanCampaignCommitRequest): st
     selectedProfileKey: input.selectedProfileKey ?? null,
     allowedDurationProfileKeys: input.allowedDurationProfileKeys
       ? [...input.allowedDurationProfileKeys].sort()
-      : null
+      : null,
+    principal: input.principal ?? null
   };
   return createHash("sha256").update(JSON.stringify(canonicalPayload)).digest("hex");
 }
 
-function resolveProfileSelection(
-  key: string,
-  existingPlan?: CampaignDurationPlan
-): ExecutionProfileSelection {
-  if (existingPlan) {
-    for (const alloc of existingPlan.allocations) {
-      if (alloc.profileSelection.profileKey === key) {
-        return alloc.profileSelection;
-      }
-    }
-  }
-  if (isReleasedProductionProfileKey(key)) {
-    throw new CampaignDurationPlanningError(
-      "release_unavailable",
-      `Cannot fabricate unverified digests for released production profile: ${key}`
-    );
-  }
-  if (isStagingCandidateProfileKey(key)) {
-    throw new CampaignDurationPlanningError(
-      "capability_unavailable",
-      `Cannot fabricate unverified authorization grant for staging candidate profile: ${key}`
-    );
-  }
-  return {
-    kind: "legacy_production",
-    profileKey: key as LegacyProductionProfileKey,
-    version: 1
-  };
-}
-
 export class PreviewCampaignReplanUseCase {
-  constructor(private readonly deps: { readonly uow: UnitOfWork }) {}
+  constructor(private readonly deps: ReplanCampaignDependencies) {}
 
   async execute(input: ReplanCampaignPreviewRequest): Promise<ReplanCampaignPreviewResponse> {
     return await this.deps.uow.execute(async (context) => {
@@ -167,10 +146,52 @@ export class PreviewCampaignReplanUseCase {
       const allowedProfileKeys =
         input.allowedDurationProfileKeys ?? currentPlan.allowedDurationProfileKeys;
 
-      const selectedProfileSelection = resolveProfileSelection(selectedProfileKey, currentPlan);
-      const allowedProfileSelections = allowedProfileKeys.map((k: string) =>
-        resolveProfileSelection(k, currentPlan)
-      );
+      const resolver = new ProfileSelectionResolver({
+        productionReleaseReader: this.deps.productionReleaseReader,
+        stagingAuthSource: this.deps.stagingAuthSource,
+        registryReader: this.deps.registryReader
+      });
+
+      let capabilities: Map<string, H3ProfileFrameCapability>;
+      let selectedProfileSelection: ExecutionProfileSelection;
+      let allowedProfileSelections: readonly ExecutionProfileSelection[];
+      try {
+        capabilities = await resolver.buildCapabilitiesMap(input.principal);
+        selectedProfileSelection = await resolver.resolveSelection(
+          selectedProfileKey,
+          input.principal
+        );
+        allowedProfileSelections = await Promise.all(
+          allowedProfileKeys.map((k: string) => resolver.resolveSelection(k, input.principal))
+        );
+        resolver.verifyScopeAndRealm(
+          selectedProfileSelection,
+          currentPlan.scope,
+          currentPlan.realm
+        );
+        for (const allowed of allowedProfileSelections) {
+          resolver.verifyScopeAndRealm(allowed, currentPlan.scope, currentPlan.realm);
+        }
+        if (
+          !allowedProfileSelections.some(
+            (s) => s.profileKey === selectedProfileSelection.profileKey
+          )
+        ) {
+          return {
+            campaignId: input.campaignId,
+            feasible: false,
+            currentPlanRevision,
+            error: `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
+          };
+        }
+      } catch (err: unknown) {
+        return {
+          campaignId: input.campaignId,
+          feasible: false,
+          currentPlanRevision,
+          error: err instanceof Error ? err.message : String(err)
+        };
+      }
 
       try {
         const proposedPlan = planFeasibleCampaignDuration({
@@ -183,7 +204,8 @@ export class PreviewCampaignReplanUseCase {
           allowedProfileSelections,
           realm: currentPlan.realm,
           scope: currentPlan.scope,
-          envelope: currentPlan.envelope
+          envelope: currentPlan.envelope,
+          capabilities
         });
 
         return {
@@ -205,7 +227,7 @@ export class PreviewCampaignReplanUseCase {
 }
 
 export class CommitCampaignReplanUseCase {
-  constructor(private readonly deps: { readonly uow: UnitOfWork }) {}
+  constructor(private readonly deps: ReplanCampaignDependencies) {}
 
   async execute(input: ReplanCampaignCommitRequest): Promise<ReplanCampaignCommitResponse> {
     return await this.deps.uow.execute(async (context) => {
@@ -255,7 +277,7 @@ export class CommitCampaignReplanUseCase {
             `Action ID "${input.actionId}" was already processed with different request intent`
           );
         }
-        return existingReceipt.response;
+        return existingReceipt.response as ReplanCampaignCommitResponse;
       }
 
       const currentPlan = await context.durationPlans.findCurrentPlanByCampaignId(campaign.id);
@@ -326,10 +348,32 @@ export class CommitCampaignReplanUseCase {
       const allowedProfileKeys =
         input.allowedDurationProfileKeys ?? currentPlan.allowedDurationProfileKeys;
 
-      const selectedProfileSelection = resolveProfileSelection(selectedProfileKey, currentPlan);
-      const allowedProfileSelections = allowedProfileKeys.map((k: string) =>
-        resolveProfileSelection(k, currentPlan)
+      const resolver = new ProfileSelectionResolver({
+        productionReleaseReader: this.deps.productionReleaseReader,
+        stagingAuthSource: this.deps.stagingAuthSource,
+        registryReader: this.deps.registryReader
+      });
+
+      const capabilities = await resolver.buildCapabilitiesMap(input.principal);
+      const selectedProfileSelection = await resolver.resolveSelection(
+        selectedProfileKey,
+        input.principal
+      );
+      const allowedProfileSelections = await Promise.all(
+        allowedProfileKeys.map((k: string) => resolver.resolveSelection(k, input.principal))
       );
+      resolver.verifyScopeAndRealm(selectedProfileSelection, currentPlan.scope, currentPlan.realm);
+      for (const allowed of allowedProfileSelections) {
+        resolver.verifyScopeAndRealm(allowed, currentPlan.scope, currentPlan.realm);
+      }
+      if (
+        !allowedProfileSelections.some((s) => s.profileKey === selectedProfileSelection.profileKey)
+      ) {
+        throw new CampaignDurationPlanningError(
+          "no_feasible_allocation",
+          `Selected profile "${selectedProfileSelection.profileKey}" is not among allowedProfileSelections`
+        );
+      }
 
       const newPlan = planFeasibleCampaignDuration({
         campaignId: campaign.id,
@@ -342,7 +386,8 @@ export class CommitCampaignReplanUseCase {
         allowedProfileSelections,
         realm: currentPlan.realm,
         scope: currentPlan.scope,
-        envelope: currentPlan.envelope
+        envelope: currentPlan.envelope,
+        capabilities
       });
 
       // Update all scenes: advance spec revision and invalidate approvals across entire campaign
diff --git a/packages/application/src/use-cases/stage-h3-candidate-render.ts b/packages/application/src/use-cases/stage-h3-candidate-render.ts
index 97b4156..9e519ed 100644
--- a/packages/application/src/use-cases/stage-h3-candidate-render.ts
+++ b/packages/application/src/use-cases/stage-h3-candidate-render.ts
@@ -164,6 +164,8 @@ export class StageH3CandidateRenderUseCase {
           existingJob.sceneId === input.sceneId &&
           injected.candidateProfileKey === input.candidateProfileKey &&
           injected.specRevision === snapshot.specRevision &&
+          (input.acceptanceRunId === undefined ||
+            injected.acceptanceRunId === input.acceptanceRunId) &&
           (existingGrant?.signature === input.grant.signature ||
             injected.grantSignature === input.grant.signature ||
             existingDigest === grantDigest);
diff --git a/packages/contracts/src/h3-candidate-registry.ts b/packages/contracts/src/h3-candidate-registry.ts
index c979aef..1a8e871 100644
--- a/packages/contracts/src/h3-candidate-registry.ts
+++ b/packages/contracts/src/h3-candidate-registry.ts
@@ -10,6 +10,7 @@ export interface H3CapabilityResolverReader {
     key: string | undefined
   ): Readonly<{ key: string; specification: H3CandidateExecutionSpecification }> | undefined;
   getProfileCapability?(key: string | undefined): H3ProfileFrameCapability | undefined;
+  resolveH3ProfileFrameCapabilities?(key: string | undefined): H3ProfileFrameCapability | undefined;
 }
 
 /**
@@ -114,6 +115,11 @@ export function resolveH3ProfileFrameCapabilities(
     if (directCap) return directCap;
   }
 
+  if (reader?.resolveH3ProfileFrameCapabilities) {
+    const directCap = reader.resolveH3ProfileFrameCapabilities(profileKeyOrId);
+    if (directCap) return directCap;
+  }
+
   if (reader?.getReleasedProfile) {
     const release = reader.getReleasedProfile(profileKeyOrId);
     if (release) {
diff --git a/packages/contracts/src/operator-acceptance.ts b/packages/contracts/src/operator-acceptance.ts
index ac6f8f3..602938e 100644
--- a/packages/contracts/src/operator-acceptance.ts
+++ b/packages/contracts/src/operator-acceptance.ts
@@ -1,6 +1,8 @@
 import { z } from "zod";
 import { ExecutionRealmSchema, EvidenceOriginSchema } from "./execution-realm.js";
 import { AssemblySpecSchema } from "./assembly-spec.js";
+import { sha256HashSchema } from "./persistent-media.js";
+import { AssemblyManifestSchema } from "./assembly-manifest.js";
 
 export const OperatorAcceptanceRunStatusSchema = z.enum([
   "dispatched",
@@ -45,9 +47,27 @@ export const AcceptanceRunSceneSchema = z
     currentAttemptOrdinal: z.number().int().positive().default(1),
     acceptedAttemptId: z.string().uuid().optional(),
     acceptedStagingJobId: z.string().optional(),
-    acceptedAttemptOrdinal: z.number().int().positive().optional()
+    acceptedAttemptOrdinal: z.number().int().positive().optional(),
+    candidateSpecificationDigest: sha256HashSchema.optional(),
+    planId: z.string().uuid().optional()
   })
-  .strict();
+  .strict()
+  .superRefine((val, ctx) => {
+    const hasAttempt = val.acceptedAttemptId !== undefined;
+    const hasOrdinal = val.acceptedAttemptOrdinal !== undefined;
+    if (hasAttempt !== hasOrdinal) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "acceptedAttemptId and acceptedAttemptOrdinal must be provided together"
+      });
+    }
+    if (hasAttempt && val.acceptedStagingJobId === undefined) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "acceptedStagingJobId is required when scene is accepted"
+      });
+    }
+  });
 export type AcceptanceRunScene = z.infer<typeof AcceptanceRunSceneSchema>;
 
 export const AcceptanceAssemblyJobStatusSchema = z.enum([
@@ -76,7 +96,29 @@ export const AcceptanceAssemblyJobSchema = z
     createdAt: z.string().datetime(),
     updatedAt: z.string().datetime()
   })
-  .strict();
+  .strict()
+  .superRefine((val, ctx) => {
+    if (val.status === "leased" || val.status === "rendering") {
+      if (!val.leaseToken || !val.leaseExpiresAt || !val.workerId) {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: `status '${val.status}' requires leaseToken, leaseExpiresAt, and workerId`
+        });
+      }
+    }
+    if (val.status === "completed" && !val.outputManifestId) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "status 'completed' requires outputManifestId"
+      });
+    }
+    if (val.status === "failed" && !val.failureReason) {
+      ctx.addIssue({
+        code: z.ZodIssueCode.custom,
+        message: "status 'failed' requires failureReason"
+      });
+    }
+  });
 export type AcceptanceAssemblyJob = z.infer<typeof AcceptanceAssemblyJobSchema>;
 
 export const AcceptanceAssemblyManifestSchema = z
@@ -85,12 +127,139 @@ export const AcceptanceAssemblyManifestSchema = z
     jobId: z.string().uuid(),
     acceptanceRunId: z.string().uuid(),
     campaignId: z.string().uuid(),
-    manifest: z.record(z.string(), z.unknown()),
+    realm: ExecutionRealmSchema,
+    evidenceOrigin: EvidenceOriginSchema,
+    planId: z.string().uuid(),
+    acceptedAttemptIds: z.array(z.string().uuid()),
+    manifest: AssemblyManifestSchema,
+    storageBucket: z.string().min(1),
+    storageKey: z.string().min(1),
+    storageSha256: sha256HashSchema,
+    manifestStorageBucket: z.string().min(1),
+    manifestStorageKey: z.string().min(1),
+    manifestStorageSha256: sha256HashSchema,
     createdAt: z.string().datetime()
   })
   .strict();
 export type AcceptanceAssemblyManifest = z.infer<typeof AcceptanceAssemblyManifestSchema>;
 
+export const OperatorAcceptanceActionScopeSchema = z.enum([
+  "begin",
+  "accept_scene",
+  "rerender_scene",
+  "assemble",
+  "complete"
+]);
+export type OperatorAcceptanceActionScope = z.infer<typeof OperatorAcceptanceActionScopeSchema>;
+
+export const OperatorAcceptanceActionReceiptSchema = z
+  .object({
+    actionId: z.string().trim().min(1),
+    scope: OperatorAcceptanceActionScopeSchema,
+    runOrCampaignId: z.string().uuid(),
+    realm: ExecutionRealmSchema,
+    requestHash: sha256HashSchema,
+    response: z.record(z.string(), z.unknown()),
+    createdAt: z.string().datetime()
+  })
+  .strict();
+export type OperatorAcceptanceActionReceipt = z.infer<typeof OperatorAcceptanceActionReceiptSchema>;
+
+export const AcceptanceRunReelStemLineageEntrySchema = z
+  .object({
+    sceneId: z.string().uuid(),
+    attemptId: z.string().uuid(),
+    storageKey: z.string(),
+    sha256: sha256HashSchema
+  })
+  .strict();
+export type AcceptanceRunReelStemLineageEntry = z.infer<
+  typeof AcceptanceRunReelStemLineageEntrySchema
+>;
+
+export const AcceptanceRunReelReadModelSchema = z.discriminatedUnion("status", [
+  z
+    .object({
+      status: z.literal("pending"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      message: z.string().optional()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("assembling"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      assemblyJobId: z.string().uuid(),
+      message: z.string().optional()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("completed"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      assemblyJobId: z.string().uuid(),
+      manifestId: z.string().uuid(),
+      manifest: AssemblyManifestSchema,
+      storageBucket: z.string().min(1),
+      storageKey: z.string().min(1),
+      storageSha256: sha256HashSchema,
+      manifestStorageBucket: z.string().min(1),
+      manifestStorageKey: z.string().min(1),
+      manifestStorageSha256: sha256HashSchema,
+      bytes: z.number().int().positive().optional(),
+      url: z.string().url(),
+      downloadUrl: z.string().url().optional(),
+      durationMs: z.number().int().positive(),
+      frameCount: z.number().int().positive(),
+      fps: z.number().positive(),
+      resolution: z
+        .object({
+          width: z.number().int().positive(),
+          height: z.number().int().positive()
+        })
+        .strict(),
+      stemLineage: z.array(AcceptanceRunReelStemLineageEntrySchema).optional(),
+      completedAt: z.string().datetime()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("failed"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      assemblyJobId: z.string().uuid().optional(),
+      failureReason: z.string()
+    })
+    .strict(),
+  z
+    .object({
+      status: z.literal("unavailable"),
+      acceptanceRunId: z.string().uuid(),
+      campaignId: z.string().uuid(),
+      realm: ExecutionRealmSchema,
+      evidenceOrigin: EvidenceOriginSchema,
+      updatedAt: z.string().datetime(),
+      reason: z.string()
+    })
+    .strict()
+]);
+export type AcceptanceRunReelReadModel = z.infer<typeof AcceptanceRunReelReadModelSchema>;
+
 export const BeginOperatorAcceptanceRunRequestSchema = z
   .object({
     campaignId: z.string().uuid(),
@@ -215,3 +384,17 @@ export class OperatorAcceptanceSceneNotAcceptedError extends Error {
     this.sceneId = sceneId;
   }
 }
+
+export class OperatorAcceptanceIdempotencyConflictError extends Error {
+  override readonly name = "OperatorAcceptanceIdempotencyConflictError";
+  readonly actionId: string;
+  readonly httpStatusCode = 409;
+
+  constructor(actionId: string, message?: string) {
+    super(
+      message ??
+        `Operator acceptance action '${actionId}' conflict: cannot replay action with different parameters`
+    );
+    this.actionId = actionId;
+  }
+}
diff --git a/packages/contracts/src/replan-campaign.ts b/packages/contracts/src/replan-campaign.ts
index e6524f0..0509d13 100644
--- a/packages/contracts/src/replan-campaign.ts
+++ b/packages/contracts/src/replan-campaign.ts
@@ -9,7 +9,8 @@ export const ReplanCampaignPreviewRequestSchema = z
     campaignId: z.string().uuid(),
     sceneIdDurations: z.record(z.string().uuid(), z.number().int().positive()),
     selectedProfileKey: z.string().trim().min(1).optional(),
-    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional()
+    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional(),
+    principal: z.string().trim().min(1).optional()
   })
   .strict();
 export type ReplanCampaignPreviewRequest = z.infer<typeof ReplanCampaignPreviewRequestSchema>;
@@ -33,7 +34,8 @@ export const ReplanCampaignCommitRequestSchema = z
     expectedSceneSpecRevisions: z.record(z.string().uuid(), z.number().int().positive()),
     sceneIdDurations: z.record(z.string().uuid(), z.number().int().positive()),
     selectedProfileKey: z.string().trim().min(1).optional(),
-    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional()
+    allowedDurationProfileKeys: z.array(z.string().trim().min(1)).optional(),
+    principal: z.string().trim().min(1).optional()
   })
   .strict();
 export type ReplanCampaignCommitRequest = z.infer<typeof ReplanCampaignCommitRequestSchema>;
diff --git a/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts b/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts
index a243384..b0bb8f2 100644
--- a/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts
+++ b/packages/infrastructure/src/ffmpeg/ffmpeg-media-assembler-adapter.ts
@@ -105,6 +105,8 @@ export interface FfmpegMediaAssemblerAdapterOptions {
   readonly defaultPreset?: string | undefined;
   readonly outputBucket?: string | undefined;
   readonly createAssemblyId?: ((spec: AssemblySpec) => string) | (() => string) | undefined;
+  readonly createOutputKey?:
+    ((campaignId: string, assemblyId: string, spec: AssemblySpec) => string) | undefined;
   readonly createStagingKey?: ((campaignId: string, assemblyId: string) => string) | undefined;
   readonly pythonPath?: string | undefined;
 }
@@ -129,6 +131,8 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
   private readonly defaultPreset: string;
   private readonly outputBucket: string;
   private readonly createAssemblyId: (spec: AssemblySpec) => string;
+  private readonly createOutputKey?:
+    ((campaignId: string, assemblyId: string, spec: AssemblySpec) => string) | undefined;
   private readonly createStagingKey?:
     ((campaignId: string, assemblyId: string) => string) | undefined;
 
@@ -180,6 +184,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
             ? (options.createAssemblyId as (s: AssemblySpec) => string)(spec)
             : (options.createAssemblyId as () => string)()
       : (spec: AssemblySpec) => computeAssemblyId(spec);
+    this.createOutputKey = options.createOutputKey;
     this.createStagingKey = options.createStagingKey;
   }
 
@@ -1018,11 +1023,25 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
 
       const outputBytes = await fs.readFile(outputPath);
       const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
-      const outputKey = `campaigns/${spec.campaignId}/assemblies/${assemblyId}/output.mp4`;
+      const customInput = spec as {
+        outputKey?: string;
+        outputBucket?: string;
+        acceptanceRunId?: string;
+      };
+      const effectiveOutputBucket = customInput.outputBucket ?? this.outputBucket;
+      const outputKey =
+        customInput.outputKey ??
+        (customInput.acceptanceRunId
+          ? `acceptance-runs/${customInput.acceptanceRunId}/reel.mp4`
+          : this.createOutputKey
+            ? this.createOutputKey(spec.campaignId, assemblyId, spec)
+            : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/output.mp4`);
       const attemptId = randomUUID();
       const stagingKey = this.createStagingKey
         ? this.createStagingKey(spec.campaignId, assemblyId)
-        : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/.staging/${attemptId}/output.mp4`;
+        : customInput.acceptanceRunId
+          ? `acceptance-runs/${customInput.acceptanceRunId}/.staging/${attemptId}/output.mp4`
+          : `campaigns/${spec.campaignId}/assemblies/${assemblyId}/.staging/${attemptId}/output.mp4`;
 
       const rawResult = {
         assemblyId,
@@ -1086,7 +1105,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
         },
         output: {
           media: {
-            bucket: this.outputBucket,
+            bucket: effectiveOutputBucket,
             key: outputKey,
             sha256: outputSha256,
             contentType: "video/mp4"
@@ -1096,7 +1115,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
           height: outputProbed.videoStream.height
         },
         stagingMedia: {
-          bucket: this.outputBucket,
+          bucket: effectiveOutputBucket,
           key: stagingKey
         },
         measuredFrameRate: outputProbed.videoStream.frameRate,
@@ -1106,7 +1125,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
       const executionResult = AssemblyExecutionResultSchema.parse(rawResult);
 
       const existingOutput = await this.objectStorage.getObject({
-        bucket: this.outputBucket,
+        bucket: effectiveOutputBucket,
         key: stagingKey
       });
       if (existingOutput) {
@@ -1135,7 +1154,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
       } else {
         try {
           await this.objectStorage.putObject({
-            bucket: this.outputBucket,
+            bucket: effectiveOutputBucket,
             key: stagingKey,
             body: outputBytes,
             contentType: "video/mp4",
@@ -1145,7 +1164,7 @@ export class FfmpegMediaAssemblerAdapter implements ConcreteMediaAssemblerPort {
         } catch (err) {
           if (err instanceof ObjectAlreadyExistsError) {
             const concurrentOutput = await this.objectStorage.getObject({
-              bucket: this.outputBucket,
+              bucket: effectiveOutputBucket,
               key: stagingKey
             });
             if (!concurrentOutput || !concurrentOutput.body || concurrentOutput.body.length === 0) {
diff --git a/packages/infrastructure/src/index.ts b/packages/infrastructure/src/index.ts
index 1b28cbd..5908f8e 100644
--- a/packages/infrastructure/src/index.ts
+++ b/packages/infrastructure/src/index.ts
@@ -56,6 +56,7 @@ export { PostgresReviewEventStore } from "./postgres/repositories/postgres-revie
 export { PostgresCampaignDurationPlanRepository } from "./postgres/repositories/postgres-campaign-duration-plan-repository.js";
 export { PostgresOperatorAcceptanceRunRepository } from "./postgres/repositories/postgres-operator-acceptance-run-repository.js";
 export { PostgresAcceptanceAssemblyJobQueue } from "./postgres/repositories/postgres-acceptance-assembly-job-queue.js";
+export { PostgresAcceptanceAssemblyManifestRepository } from "./postgres/repositories/postgres-acceptance-assembly-manifest-repository.js";
 export { PostgresDeploymentEnablementStateRepository } from "./postgres/repositories/postgres-deployment-enablement-state-repository.js";
 export {
   PostgresProductEvidenceRepository,
diff --git a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
index dc534a3..ca9ee7b 100644
--- a/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
+++ b/packages/infrastructure/src/postgres/audit-protections.integration.test.ts
@@ -499,7 +499,7 @@ describe("PostgreSQL audit immutability and application-role privileges integrat
     // Verify migration succeeds when no application role is configured
     await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
     const noRoleApplied = await runMigrations(client, { migrationsDirectory });
-    expect(noRoleApplied).toHaveLength(31);
+    expect(noRoleApplied).toHaveLength(32);
   });
 
   it("fails closed when application role has effective UPDATE or DELETE privilege on storyboard_candidates", async () => {
diff --git a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
index da115dd..1e1d237 100644
--- a/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
+++ b/packages/infrastructure/src/postgres/baseline-schema.integration.test.ts
@@ -55,7 +55,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
   it("migrates an empty PostgreSQL 18.6 database through the baseline", async () => {
     const applied = await runMigrations(client, { migrationsDirectory });
 
-    expect(applied).toHaveLength(31);
+    expect(applied).toHaveLength(32);
     expect(applied[0]?.version).toBe("001");
     expect(applied[1]?.version).toBe("002");
     expect(applied[2]?.version).toBe("003");
@@ -87,6 +87,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
     expect(applied[28]?.version).toBe("029");
     expect(applied[29]?.version).toBe("030");
     expect(applied[30]?.version).toBe("031");
+    expect(applied[31]?.version).toBe("032");
 
     const schemaRes = await client.query(
       "SELECT version FROM schema_migrations ORDER BY version ASC"
@@ -122,7 +123,8 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       { version: "028" },
       { version: "029" },
       { version: "030" },
-      { version: "031" }
+      { version: "031" },
+      { version: "032" }
     ]);
 
     const tablesRes = await client.query<{ table_name: string }>(
@@ -162,6 +164,7 @@ describe("PostgreSQL 18.6 baseline schema integration", () => {
       "evidence_verification_events",
       "generation_manifests",
       "license_registry",
+      "operator_acceptance_action_receipts",
       "operator_acceptance_runs",
       "product_batch_facts",
       "product_batches",
diff --git a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
index 948d963..098ea08 100644
--- a/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
+++ b/packages/infrastructure/src/postgres/job-dispatch-contract.integration.test.ts
@@ -68,7 +68,8 @@ describe("PostgreSQL job dispatch schema contract integration", () => {
     expect(applied.some((m) => m.version === "029")).toBe(true);
     expect(applied.some((m) => m.version === "030")).toBe(true);
     expect(applied.some((m) => m.version === "031")).toBe(true);
-    expect(applied[applied.length - 1]?.version).toBe("031");
+    expect(applied.some((m) => m.version === "032")).toBe(true);
+    expect(applied[applied.length - 1]?.version).toBe("032");
 
     // 2. Run it again and assert []
     const rerun = await runMigrations(client, { migrationsDirectory });
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts b/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts
index 08d2360..dea3584 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-acceptance-assembly-job-queue.ts
@@ -99,18 +99,17 @@ export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJob
     workerId: string,
     leaseDurationMs: number
   ): Promise<AcceptanceAssemblyJob | undefined> {
-    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs).toISOString();
     const leaseToken = randomUUID();
     const query = `
       UPDATE acceptance_assembly_jobs
       SET status = 'leased',
           worker_id = $1,
           lease_token = $2,
-          lease_expires_at = $3,
+          lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
           updated_at = NOW()
       WHERE job_id = (
         SELECT job_id FROM acceptance_assembly_jobs
-        WHERE status = 'queued' OR (status = 'leased' AND lease_expires_at < NOW())
+        WHERE status = 'queued' OR (status IN ('leased', 'rendering') AND lease_expires_at < NOW())
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
@@ -118,26 +117,76 @@ export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJob
       RETURNING *;
     `;
 
-    const res = await this.client.query<JobRow>(query, [workerId, leaseToken, leaseExpiresAt]);
+    const res = await this.client.query<JobRow>(query, [workerId, leaseToken, leaseDurationMs]);
     if (res.rows.length === 0) return undefined;
     return mapRowToJob(res.rows[0]!);
   }
 
+  async start(jobId: string, leaseToken: string): Promise<void> {
+    const query = `
+      UPDATE acceptance_assembly_jobs
+      SET status = 'rendering',
+          updated_at = NOW()
+      WHERE job_id = $1 AND lease_token = $2::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
+    `;
+    const res = await this.client.query(query, [jobId, leaseToken]);
+    if (res.rowCount === 0) {
+      throw new Error(
+        `Failed to start acceptance assembly job ${jobId}: lease token mismatch, expired, or job not in leased/rendering status`
+      );
+    }
+  }
+
+  async heartbeat(jobId: string, leaseToken: string, leaseDurationMs: number): Promise<void> {
+    const query = `
+      UPDATE acceptance_assembly_jobs
+      SET lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
+          updated_at = NOW()
+      WHERE job_id = $1 AND lease_token = $2::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
+    `;
+    const res = await this.client.query(query, [jobId, leaseToken, leaseDurationMs]);
+    if (res.rowCount === 0) {
+      throw new Error(
+        `Failed to heartbeat acceptance assembly job ${jobId}: lease token mismatch, expired, or job not active`
+      );
+    }
+  }
+
   async complete(jobId: string, outputManifestId: string, leaseToken?: string): Promise<void> {
     if (!leaseToken) {
       throw new Error(`Lease token is required to complete acceptance assembly job ${jobId}`);
     }
+    const existing = await this.findById(jobId);
+    if (existing && existing.status === "completed") {
+      if (existing.outputManifestId === outputManifestId) {
+        return;
+      }
+      throw new Error(
+        `Acceptance assembly job ${jobId} already completed with different manifest (expected ${existing.outputManifestId}, got ${outputManifestId})`
+      );
+    }
+
     const query = `
       UPDATE acceptance_assembly_jobs
       SET status = 'completed',
           output_manifest_id = $2,
+          lease_token = NULL,
+          lease_expires_at = NULL,
           updated_at = NOW()
-      WHERE job_id = $1 AND lease_token = $3::uuid;
+      WHERE job_id = $1 AND lease_token = $3::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
     `;
     const res = await this.client.query(query, [jobId, outputManifestId, leaseToken]);
     if (res.rowCount === 0) {
+      const recheck = await this.findById(jobId);
+      if (
+        recheck &&
+        recheck.status === "completed" &&
+        recheck.outputManifestId === outputManifestId
+      ) {
+        return;
+      }
       throw new Error(
-        `Failed to complete acceptance assembly job ${jobId}: lease token mismatch or job not found`
+        `Failed to complete acceptance assembly job ${jobId}: lease token mismatch, expired, or job not found`
       );
     }
   }
@@ -146,17 +195,24 @@ export class PostgresAcceptanceAssemblyJobQueue implements AcceptanceAssemblyJob
     if (!leaseToken) {
       throw new Error(`Lease token is required to fail acceptance assembly job ${jobId}`);
     }
+    const existing = await this.findById(jobId);
+    if (existing && existing.status === "failed") {
+      return;
+    }
+
     const query = `
       UPDATE acceptance_assembly_jobs
       SET status = 'failed',
           failure_reason = $2,
+          lease_token = NULL,
+          lease_expires_at = NULL,
           updated_at = NOW()
-      WHERE job_id = $1 AND lease_token = $3::uuid;
+      WHERE job_id = $1 AND lease_token = $3::uuid AND (status = 'leased' OR status = 'rendering') AND lease_expires_at > NOW();
     `;
     const res = await this.client.query(query, [jobId, error, leaseToken]);
     if (res.rowCount === 0) {
       throw new Error(
-        `Failed to fail acceptance assembly job ${jobId}: lease token mismatch or job not found`
+        `Failed to fail acceptance assembly job ${jobId}: lease token mismatch, expired, or job not active`
       );
     }
   }
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
index ab5befd..e3af6aa 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-generation-manifest-repository.ts
@@ -1,11 +1,13 @@
 import {
   decodeGenerationManifestOutputs,
   extractPrimaryVideoStemMedia,
+  IncompleteVideoStemSourceError,
   type GenerationManifestComponentIdentity,
   type GenerationManifestRepository,
   type VideoStemSourceRecord
 } from "@cco/application";
 import {
+  isStagingCandidateProfileKey,
   type ManifestMeasuredMedia,
   ManifestMeasuredMediaSchema,
   type ExecutionRealm,
@@ -56,11 +58,44 @@ export class PostgresGenerationManifestRepository implements GenerationManifestR
       // If outputs are not present or malformed, outputChecksumsSha256 remains empty
     }
 
+    const payloadRecord = payload as Record<string, unknown>;
+    const routingMode =
+      typeof payloadRecord.routingMode === "string" ? payloadRecord.routingMode : undefined;
+    const candidateSpecificationDigest =
+      typeof payloadRecord.candidateSpecificationDigest === "string"
+        ? payloadRecord.candidateSpecificationDigest
+        : undefined;
+
+    const isCandidateProfile =
+      typeof payload.renderProfile === "string" &&
+      (payload.renderProfile.startsWith("H3_CANDIDATE_") ||
+        isStagingCandidateProfileKey(payload.renderProfile) ||
+        Boolean(candidateSpecificationDigest));
+
+    const route =
+      payloadRecord.route === "ref2v" || payloadRecord.route === "i2v"
+        ? (payloadRecord.route as "ref2v" | "i2v")
+        : routingMode === "reference_directed"
+          ? ("ref2v" as const)
+          : routingMode === "frame_anchored"
+            ? ("i2v" as const)
+            : !isCandidateProfile &&
+                typeof payload.renderProfile === "string" &&
+                payload.renderProfile.toLowerCase().includes("ref2v")
+              ? ("ref2v" as const)
+              : !isCandidateProfile &&
+                  typeof payload.renderProfile === "string" &&
+                  payload.renderProfile.toLowerCase().includes("i2v")
+                ? ("i2v" as const)
+                : undefined;
+
     return {
       renderProfile: payload.renderProfile,
       renderProfileVersion:
         typeof payload.renderProfileVersion === "number" ? payload.renderProfileVersion : null,
-      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {})
+      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {}),
+      ...(route ? { route } : {}),
+      ...(candidateSpecificationDigest ? { candidateSpecificationDigest } : {})
     };
   }
 
@@ -107,14 +142,26 @@ export class PostgresGenerationManifestRepository implements GenerationManifestR
       typeof payload?.renderProfile === "string" &&
       /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/.test(payload.renderProfile);
 
+    if (
+      row.job_execution_scope &&
+      payload?.executionScope &&
+      row.job_execution_scope !== payload.executionScope
+    ) {
+      throw new Error(
+        `Contradictory executionScope in manifest "${row.manifest_id}": job_execution_scope "${row.job_execution_scope}" does not match manifest payload executionScope "${payload.executionScope}"`
+      );
+    }
+
     const executionScope: "production" | "staging" | undefined =
-      row.job_execution_scope === "staging" ||
-      payload?.executionScope === "staging" ||
-      isCandidateProfile
-        ? "staging"
-        : row.job_execution_scope === "production" || payload?.executionScope === "production"
-          ? "production"
-          : undefined;
+      (row.job_execution_scope as "production" | "staging" | null) ??
+      (payload?.executionScope as "production" | "staging" | undefined) ??
+      (isCandidateProfile ? "staging" : undefined);
+
+    if (isCandidateProfile && executionScope === "production") {
+      throw new Error(
+        `Candidate generation manifest "${row.manifest_id}" cannot have production executionScope`
+      );
+    }
 
     let measuredMedia: ManifestMeasuredMedia | undefined;
     if (payload?.measuredMedia) {
@@ -148,10 +195,84 @@ export class PostgresGenerationManifestRepository implements GenerationManifestR
     const evidenceOrigin = payload?.evidenceOrigin as EvidenceOrigin | undefined;
     const simulationDescriptor = payload?.simulationDescriptor as SimulationDescriptor | undefined;
 
+    const renderProfile =
+      typeof payload?.renderProfile === "string" ? payload.renderProfile : undefined;
+    const sceneId = typeof payload?.sceneId === "string" ? payload.sceneId : undefined;
+    const candidateSpecificationDigest =
+      typeof payload?.candidateSpecificationDigest === "string"
+        ? payload.candidateSpecificationDigest
+        : undefined;
+    const specRevision =
+      typeof payload?.specRevision === "number" ? payload.specRevision : undefined;
+    const configuredMediaObj = payload?.configuredMedia as Record<string, unknown> | undefined;
+    const frames =
+      typeof payload?.frameCount === "number"
+        ? payload.frameCount
+        : typeof configuredMediaObj?.frameCount === "number"
+          ? (configuredMediaObj.frameCount as number)
+          : typeof payload?.frames === "number"
+            ? payload.frames
+            : undefined;
+    const fps =
+      typeof payload?.fps === "number"
+        ? payload.fps
+        : typeof configuredMediaObj?.fps === "number"
+          ? (configuredMediaObj.fps as number)
+          : undefined;
+
+    const payloadRoutingMode =
+      typeof payload?.routingMode === "string" ? payload.routingMode : undefined;
+    const route =
+      payload?.route === "ref2v" || payload?.route === "i2v"
+        ? (payload.route as "ref2v" | "i2v")
+        : payloadRoutingMode === "reference_directed"
+          ? ("ref2v" as const)
+          : payloadRoutingMode === "frame_anchored"
+            ? ("i2v" as const)
+            : !isCandidateProfile &&
+                typeof payload?.renderProfile === "string" &&
+                payload.renderProfile.toLowerCase().includes("ref2v")
+              ? ("ref2v" as const)
+              : !isCandidateProfile &&
+                  typeof payload?.renderProfile === "string" &&
+                  payload.renderProfile.toLowerCase().includes("i2v")
+                ? ("i2v" as const)
+                : undefined;
+
+    const outputChecksumsSha256: string[] = [];
+    if (payload) {
+      try {
+        const outputs = decodeGenerationManifestOutputs(
+          payload as Record<string, unknown>,
+          row.manifest_id
+        );
+        for (const out of outputs) {
+          outputChecksumsSha256.push(out.checksumSha256);
+        }
+      } catch (err) {
+        if (isCandidateProfile) {
+          throw new IncompleteVideoStemSourceError(
+            jobId,
+            `Failed to decode generation manifest outputs: ${(err as Error).message}`
+          );
+        }
+      }
+    }
+
     return {
       generationManifestId: row.manifest_id,
+      jobId,
       media,
       renderAttempt,
+      ...(renderProfile ? { renderProfile } : {}),
+      ...(route ? { route } : {}),
+      ...(payloadRoutingMode ? { routingMode: payloadRoutingMode } : {}),
+      ...(sceneId ? { sceneId } : {}),
+      ...(candidateSpecificationDigest ? { candidateSpecificationDigest } : {}),
+      ...(specRevision !== undefined ? { specRevision } : {}),
+      ...(frames !== undefined ? { frames } : {}),
+      ...(fps !== undefined ? { fps } : {}),
+      ...(outputChecksumsSha256.length > 0 ? { outputChecksumsSha256 } : {}),
       ...(executionScope ? { executionScope } : {}),
       ...(measuredMedia ? { measuredMedia } : {}),
       ...(realm ? { realm } : {}),
diff --git a/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts b/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts
index f0b5a50..b4e4062 100644
--- a/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts
+++ b/packages/infrastructure/src/postgres/repositories/postgres-operator-acceptance-run-repository.ts
@@ -1,10 +1,14 @@
 import type { OperatorAcceptanceRunRepository } from "@cco/application";
 import {
   type AcceptanceRunScene,
+  type OperatorAcceptanceActionReceipt,
+  type OperatorAcceptanceActionScope,
   type OperatorAcceptanceRun,
   type OperatorAcceptanceRunStatus,
   OperatorAcceptanceRunSchema,
-  AcceptanceRunSceneSchema
+  AcceptanceRunSceneSchema,
+  OperatorAcceptanceActionReceiptSchema,
+  OperatorAcceptanceIdempotencyConflictError
 } from "@cco/contracts";
 import type { Pool, PoolClient } from "pg";
 
@@ -38,6 +42,8 @@ interface SceneRow {
   accepted_attempt_id: string | null;
   accepted_staging_job_id: string | null;
   accepted_attempt_ordinal: number | null;
+  candidate_specification_digest: string | null;
+  plan_id: string | null;
 }
 
 function parseJsonField<T>(val: unknown): T {
@@ -90,7 +96,11 @@ function mapRowToScene(row: SceneRow): AcceptanceRunScene {
       : {}),
     ...(row.accepted_attempt_ordinal != null
       ? { acceptedAttemptOrdinal: row.accepted_attempt_ordinal }
-      : {})
+      : {}),
+    ...(row.candidate_specification_digest != null
+      ? { candidateSpecificationDigest: row.candidate_specification_digest }
+      : {}),
+    ...(row.plan_id != null ? { planId: row.plan_id } : {})
   };
   return AcceptanceRunSceneSchema.parse(raw);
 }
@@ -151,8 +161,10 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
           current_attempt_ordinal,
           accepted_attempt_id,
           accepted_staging_job_id,
-          accepted_attempt_ordinal
-        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
+          accepted_attempt_ordinal,
+          candidate_specification_digest,
+          plan_id
+        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (acceptance_run_id, scene_id) DO NOTHING;
       `;
       await this.client.query(sceneQuery, [
@@ -169,7 +181,9 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
         scene.currentAttemptOrdinal,
         scene.acceptedAttemptId ?? null,
         scene.acceptedStagingJobId ?? null,
-        scene.acceptedAttemptOrdinal ?? null
+        scene.acceptedAttemptOrdinal ?? null,
+        scene.candidateSpecificationDigest ?? null,
+        scene.planId ?? null
       ]);
     }
   }
@@ -224,20 +238,49 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
     assemblyJobId?: string,
     actionReceiptId?: string
   ): Promise<void> {
-    const query = `
-      UPDATE operator_acceptance_runs
-      SET status = $2,
-          assembly_job_id = COALESCE($3, assembly_job_id),
-          action_receipt_id = COALESCE($4, action_receipt_id),
-          updated_at = NOW()
-      WHERE acceptance_run_id = $1;
-    `;
-    await this.client.query(query, [
+    const isTerminalSettlement = status === "completed" || status === "failed";
+    const query =
+      isTerminalSettlement && assemblyJobId
+        ? `
+          UPDATE operator_acceptance_runs
+          SET status = $2,
+              assembly_job_id = COALESCE($3, assembly_job_id),
+              action_receipt_id = COALESCE($4, action_receipt_id),
+              updated_at = NOW()
+          WHERE acceptance_run_id = $1
+            AND (assembly_job_id = $3 OR assembly_job_id IS NULL)
+            AND (status = 'assembling' OR status = $2);
+        `
+        : `
+          UPDATE operator_acceptance_runs
+          SET status = $2,
+              assembly_job_id = COALESCE($3, assembly_job_id),
+              action_receipt_id = COALESCE($4, action_receipt_id),
+              updated_at = NOW()
+          WHERE acceptance_run_id = $1;
+        `;
+    const res = await this.client.query(query, [
       acceptanceRunId,
       status,
       assemblyJobId ?? null,
       actionReceiptId ?? null
     ]);
+    if (isTerminalSettlement && assemblyJobId && res.rowCount === 0) {
+      const existing = await this.findRunById(acceptanceRunId);
+      if (!existing) {
+        throw new Error(`Acceptance run '${acceptanceRunId}' not found`);
+      }
+      if (existing.status !== "assembling" && existing.status !== status) {
+        throw new Error(
+          `Cannot settle acceptance run '${acceptanceRunId}' from status '${existing.status}' to '${status}'`
+        );
+      }
+      if (existing.assemblyJobId && existing.assemblyJobId !== assemblyJobId) {
+        throw new Error(
+          `Cannot settle acceptance run '${acceptanceRunId}': assembly job mismatch (expected ${existing.assemblyJobId}, got ${assemblyJobId})`
+        );
+      }
+    }
   }
 
   async updateSceneAcceptedAttempt(
@@ -271,4 +314,87 @@ export class PostgresOperatorAcceptanceRunRepository implements OperatorAcceptan
     `;
     await this.client.query(query, [acceptanceRunId, sceneId, attemptId, ordinal]);
   }
+
+  async saveActionReceipt(receipt: OperatorAcceptanceActionReceipt): Promise<void> {
+    const existing = await this.findActionReceipt(
+      receipt.scope,
+      receipt.runOrCampaignId,
+      receipt.actionId
+    );
+    if (existing) {
+      if (existing.requestHash !== receipt.requestHash) {
+        throw new OperatorAcceptanceIdempotencyConflictError(receipt.actionId);
+      }
+      return;
+    }
+
+    const query = `
+      INSERT INTO operator_acceptance_action_receipts (
+        action_id,
+        scope,
+        run_or_campaign_id,
+        realm,
+        request_hash,
+        response,
+        created_at
+      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
+      ON CONFLICT (scope, run_or_campaign_id, action_id) DO NOTHING
+      RETURNING request_hash;
+    `;
+    const res = await this.client.query<{ request_hash: string }>(query, [
+      receipt.actionId,
+      receipt.scope,
+      receipt.runOrCampaignId,
+      JSON.stringify(receipt.realm),
+      receipt.requestHash,
+      JSON.stringify(receipt.response),
+      receipt.createdAt
+    ]);
+    if (res.rowCount === 0) {
+      const conflictReceipt = await this.findActionReceipt(
+        receipt.scope,
+        receipt.runOrCampaignId,
+        receipt.actionId
+      );
+      if (conflictReceipt && conflictReceipt.requestHash !== receipt.requestHash) {
+        throw new OperatorAcceptanceIdempotencyConflictError(receipt.actionId);
+      }
+    }
+  }
+
+  async findActionReceipt(
+    scope: OperatorAcceptanceActionScope | string,
+    runOrCampaignId: string,
+    actionId: string
+  ): Promise<OperatorAcceptanceActionReceipt | undefined> {
+    const query = `
+      SELECT * FROM operator_acceptance_action_receipts
+      WHERE scope = $1 AND run_or_campaign_id = $2 AND action_id = $3;
+    `;
+    const res = await this.client.query<{
+      action_id: string;
+      scope: string;
+      run_or_campaign_id: string;
+      realm: unknown;
+      request_hash: string;
+      response: unknown;
+      created_at: Date | string;
+    }>(query, [scope, runOrCampaignId, actionId]);
+
+    const row = res.rows[0];
+    if (!row) return undefined;
+
+    return OperatorAcceptanceActionReceiptSchema.parse({
+      actionId: row.action_id,
+      scope: row.scope,
+      runOrCampaignId: row.run_or_campaign_id,
+      realm: parseJsonField(row.realm),
+      requestHash: row.request_hash,
+      response: parseJsonField(row.response),
+      createdAt:
+        row.created_at instanceof Date
+          ? row.created_at.toISOString()
+          : new Date(row.created_at).toISOString()
+    });
+  }
 }
diff --git a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
index dd0ae62..4dd47e0 100644
--- a/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
+++ b/packages/infrastructure/src/postgres/uow/postgres-unit-of-work.ts
@@ -24,6 +24,7 @@ import { PostgresProductClaimRepository } from "../repositories/postgres-product
 import { PostgresCampaignDurationPlanRepository } from "../repositories/postgres-campaign-duration-plan-repository.js";
 import { PostgresOperatorAcceptanceRunRepository } from "../repositories/postgres-operator-acceptance-run-repository.js";
 import { PostgresAcceptanceAssemblyJobQueue } from "../repositories/postgres-acceptance-assembly-job-queue.js";
+import { PostgresAcceptanceAssemblyManifestRepository } from "../repositories/postgres-acceptance-assembly-manifest-repository.js";
 import { PostgresDeploymentEnablementStateRepository } from "../repositories/postgres-deployment-enablement-state-repository.js";
 
 export class PostgresUnitOfWork implements UnitOfWork {
@@ -65,6 +66,7 @@ export class PostgresUnitOfWork implements UnitOfWork {
         durationPlans: new PostgresCampaignDurationPlanRepository(client),
         operatorAcceptanceRuns: new PostgresOperatorAcceptanceRunRepository(client),
         acceptanceAssemblyJobs: new PostgresAcceptanceAssemblyJobQueue(client),
+        acceptanceAssemblyManifests: new PostgresAcceptanceAssemblyManifestRepository(client),
         deploymentEnablement: new PostgresDeploymentEnablementStateRepository(client)
       };
 
diff --git a/packages/infrastructure/src/storage/provision.integration.test.ts b/packages/infrastructure/src/storage/provision.integration.test.ts
index 85818b9..8e06cf9 100644
--- a/packages/infrastructure/src/storage/provision.integration.test.ts
+++ b/packages/infrastructure/src/storage/provision.integration.test.ts
@@ -42,16 +42,16 @@ describe("Storage Provisioning integration with real MinIO", () => {
     }
   });
 
-  it("provisions all five buckets and is idempotent on repeat execution", async () => {
+  it("provisions all six buckets and is idempotent on repeat execution", async () => {
     // 1. Initial provisioning on clean MinIO container
     const initialSummary = await provisionStorageBuckets({
       client: rawS3Client
     });
 
-    expect(initialSummary.results).toHaveLength(5);
-    expect(initialSummary.createdCount).toBe(5);
+    expect(initialSummary.results).toHaveLength(6);
+    expect(initialSummary.createdCount).toBe(6);
     expect(initialSummary.alreadyExistsCount).toBe(0);
-    expect(initialSummary.lifecycleAppliedCount).toBe(2); // temp (14d) and review (60d)
+    expect(initialSummary.lifecycleAppliedCount).toBe(3); // temp (14d), review (60d), and candidates (30d)
     expect(initialSummary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
 
     // 2. Second provisioning run against already provisioned buckets
@@ -59,10 +59,10 @@ describe("Storage Provisioning integration with real MinIO", () => {
       client: rawS3Client
     });
 
-    expect(repeatSummary.results).toHaveLength(5);
+    expect(repeatSummary.results).toHaveLength(6);
     expect(repeatSummary.createdCount).toBe(0);
-    expect(repeatSummary.alreadyExistsCount).toBe(5);
-    expect(repeatSummary.lifecycleAppliedCount).toBe(2);
+    expect(repeatSummary.alreadyExistsCount).toBe(6);
+    expect(repeatSummary.lifecycleAppliedCount).toBe(3);
     expect(repeatSummary.lifecycleSkippedCount).toBe(3);
   });
 
@@ -132,7 +132,7 @@ describe("Storage Provisioning integration with real MinIO", () => {
 
     // 2. Re-run provisioning
     const summary = await provisionStorageBuckets({ client: rawS3Client });
-    expect(summary.alreadyExistsCount).toBe(5);
+    expect(summary.alreadyExistsCount).toBe(6);
 
     // 3. Read back object and verify byte integrity
     const getRes = await rawS3Client.send(
diff --git a/packages/infrastructure/src/storage/provisioner.test.ts b/packages/infrastructure/src/storage/provisioner.test.ts
index 43be622..50ba301 100644
--- a/packages/infrastructure/src/storage/provisioner.test.ts
+++ b/packages/infrastructure/src/storage/provisioner.test.ts
@@ -122,16 +122,16 @@ describe("Storage Provisioner unit tests", () => {
     await expect(provisionBucket(client, BUCKETS.TEMP)).rejects.toThrow("Network timeout");
   });
 
-  it("provisions all five buckets in provisionStorageBuckets and returns summary", async () => {
+  it("provisions all six buckets in provisionStorageBuckets and returns summary", async () => {
     const sendFn = vi.fn().mockResolvedValue({});
     const client = createMockS3Client(sendFn);
 
     const summary = await provisionStorageBuckets({ client });
 
-    expect(summary.results).toHaveLength(5);
-    expect(summary.createdCount).toBe(5);
+    expect(summary.results).toHaveLength(6);
+    expect(summary.createdCount).toBe(6);
     expect(summary.alreadyExistsCount).toBe(0);
-    expect(summary.lifecycleAppliedCount).toBe(2); // temp and review
+    expect(summary.lifecycleAppliedCount).toBe(3); // temp, review, and candidates
     expect(summary.lifecycleSkippedCount).toBe(3); // reference, delivery, and evidence
   });
 
@@ -200,6 +200,20 @@ describe("Storage Provisioner unit tests", () => {
     const delEval = evaluateLifecycleEligibility({ bucket: BUCKETS.DELIVERY, objectAgeDays: 365 });
     expect(delEval.isEligibleForDeletion).toBe(false);
     expect(delEval.reason).toContain("campaign completion");
+
+    // godzspeed-candidates (30 days)
+    expect(
+      evaluateLifecycleEligibility({ bucket: BUCKETS.CANDIDATES, objectAgeDays: 31 })
+        .isEligibleForDeletion
+    ).toBe(true);
+    expect(
+      evaluateLifecycleEligibility({ bucket: BUCKETS.CANDIDATES, objectAgeDays: 30 })
+        .isEligibleForDeletion
+    ).toBe(true);
+    expect(
+      evaluateLifecycleEligibility({ bucket: BUCKETS.CANDIDATES, objectAgeDays: 29 })
+        .isEligibleForDeletion
+    ).toBe(false);
   });
 
   it("returns lifecycle configuration when GetBucketLifecycleConfigurationCommand succeeds", async () => {
diff --git a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
index d0d5b3d..dcc8ba0 100644
--- a/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
+++ b/packages/infrastructure/src/telemetry/storage-telemetry-adapter.test.ts
@@ -93,7 +93,8 @@ describe("HostFsStorageTelemetryAdapter", () => {
       "godzspeed-review",
       "godzspeed-reference",
       "godzspeed-delivery",
-      "godzspeed-evidence"
+      "godzspeed-evidence",
+      "godzspeed-candidates"
     ]);
     expect(telemetry.buckets.every((b) => b.usedBytes === 0)).toBe(true);
   });
diff --git a/packages/shared/src/buckets.test.ts b/packages/shared/src/buckets.test.ts
index bfcece3..dc797fd 100644
--- a/packages/shared/src/buckets.test.ts
+++ b/packages/shared/src/buckets.test.ts
@@ -14,7 +14,8 @@ describe("bucket class constants and retention policies", () => {
       "godzspeed-review",
       "godzspeed-reference",
       "godzspeed-delivery",
-      "godzspeed-evidence"
+      "godzspeed-evidence",
+      "godzspeed-candidates"
     ]);
 
     expect(BUCKETS.TEMP).toBe("godzspeed-temp");
@@ -22,6 +23,7 @@ describe("bucket class constants and retention policies", () => {
     expect(BUCKETS.REFERENCE).toBe("godzspeed-reference");
     expect(BUCKETS.DELIVERY).toBe("godzspeed-delivery");
     expect(BUCKETS.EVIDENCE).toBe("godzspeed-evidence");
+    expect(BUCKETS.CANDIDATES).toBe("godzspeed-candidates");
   });
 
   it("type checks bucket names against union", () => {
@@ -91,4 +93,18 @@ describe("bucket class constants and retention policies", () => {
     const evidenceLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-evidence"];
     expect(evidenceLifecycle).toBeUndefined();
   });
+
+  it("defines 30-day automated expiry for godzspeed-candidates", () => {
+    const candidatesPolicy = BUCKET_RETENTION_POLICIES["godzspeed-candidates"];
+    expect(candidatesPolicy).toBeDefined();
+    expect(candidatesPolicy.bucket).toBe("godzspeed-candidates");
+    expect(candidatesPolicy.defaultRetentionDays).toBe(30);
+    expect(candidatesPolicy.isAutomatedExpiry).toBe(true);
+
+    const candidatesLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-candidates"];
+    expect(candidatesLifecycle).toBeDefined();
+    expect(candidatesLifecycle?.expirationDays).toBe(30);
+    expect(candidatesLifecycle?.status).toBe("Enabled");
+    expect(candidatesLifecycle?.ruleId).toBe("godzspeed-candidates-retention-30d");
+  });
 });
diff --git a/packages/shared/src/buckets.ts b/packages/shared/src/buckets.ts
index 2f61997..7b6d1f1 100644
--- a/packages/shared/src/buckets.ts
+++ b/packages/shared/src/buckets.ts
@@ -6,7 +6,8 @@ export const BUCKET_NAMES = [
   "godzspeed-review",
   "godzspeed-reference",
   "godzspeed-delivery",
-  "godzspeed-evidence"
+  "godzspeed-evidence",
+  "godzspeed-candidates"
 ] as const;
 
 export type BucketName = (typeof BUCKET_NAMES)[number];
@@ -16,7 +17,8 @@ export const BUCKETS = {
   REVIEW: "godzspeed-review",
   REFERENCE: "godzspeed-reference",
   DELIVERY: "godzspeed-delivery",
-  EVIDENCE: "godzspeed-evidence"
+  EVIDENCE: "godzspeed-evidence",
+  CANDIDATES: "godzspeed-candidates"
 } as const;
 
 export interface BucketRetentionPolicy {
@@ -64,6 +66,12 @@ export const BUCKET_RETENTION_POLICIES: Readonly<Record<BucketName, BucketRetent
       description:
         "immutable source evidence archive (retained indefinitely under regulatory hold; no automated expiry)",
       isAutomatedExpiry: false
+    },
+    "godzspeed-candidates": {
+      bucket: "godzspeed-candidates",
+      defaultRetentionDays: 30,
+      description: "operator acceptance candidates, staging test reels, simulation artifacts",
+      isAutomatedExpiry: true
     }
   });
 
@@ -84,5 +92,11 @@ export const BUCKET_LIFECYCLE_DEFINITIONS: Readonly<
   },
   "godzspeed-reference": undefined,
   "godzspeed-delivery": undefined,
-  "godzspeed-evidence": undefined
+  "godzspeed-evidence": undefined,
+  "godzspeed-candidates": {
+    ruleId: "godzspeed-candidates-retention-30d",
+    expirationDays: 30,
+    status: "Enabled",
+    prefix: ""
+  }
 });
```

## REQUIRED OUTPUT CONTRACT

All string values in the JSON output must be valid JSON string literals. If evidence, rationale, summary, or other freeform text (including embedded Markdown such as design_md/plan_md) quotes a code identifier, file path, backslash-containing path, or literal string, escape every `"` as `\"` and every backslash as `\\` inside that value. Do not emit a raw, unescaped `"` or `\` inside a JSON string.

You MUST write your review directly to `./follow-up-review-result.json`.
Writing your verdict or evaluations as markdown prose, stdout output, or conversational summaries CANNOT replace `./follow-up-review-result.json`. If `./follow-up-review-result.json` is missing or fails JSON/schema validation, this phase fails contract validation.

### Allowed Verdict Values
The `verdict` field must be exactly one of the following accepted enum literals:
- `APPROVE`
- `REQUEST_CHANGES`
- `approve`
- `request_changes`
- `PASS`
- `FAIL`
- `pass`
- `fail`

CRITICAL: The literal `"APPROVED"` is NOT valid and will cause schema validation rejection. You must use `"APPROVE"` (or `"REQUEST_CHANGES"`).

### JSON Schema & Field Requirements
Write valid JSON to `./follow-up-review-result.json` matching the schema:
- `verdict` (string, required): Exactly one of the accepted enum literals above (`"APPROVE"` or `"REQUEST_CHANGES"`).
- `evaluations` (array of objects, default: `[]`):
  For each finding in the ledger:
  - `finding_id` (string, required, non-empty): Exact finding ID from the ledger.
  - `resolved` (boolean, required): `true` if verified resolved, `false` otherwise.
  - `evidence` (string, required, non-empty): Concrete file:line citations and verification evidence.
  - `rationale` (string, optional): Context or explanation for the evaluation.
- `new_findings` (array of objects, optional, default: `[]`): Any new defects or regressions discovered.
- `summary` (string, optional): High-level summary of the follow-up review.
- `review_md` (string, optional): Markdown-formatted review notes.

```json
{
  "verdict": "APPROVE",
  "evaluations": [
    {
      "finding_id": "Finding ID from ledger",
      "resolved": true,
      "evidence": "Evidence citing exact file:line showing resolution",
      "rationale": "Optional explanation"
    }
  ],
  "new_findings": [
    {
      "severity": "critical",
      "files": ["path/to/file.ts"],
      "evidence": "Concrete evidence",
      "rationale": "Why this matters",
      "minimal_correction": "Smallest correction",
      "blocking": true
    }
  ],
  "summary": "Summary of follow-up review."
}
```

## TASK

Perform a focused follow-up review grounded in the issue, acceptance criteria, design, accumulated finding ledger, and diffs above.

Your responsibilities:

1. **Evaluate Prior Findings**:
   - For every unresolved finding in the accumulated finding ledger, evaluate whether it is now `resolved: true` or `resolved: false`.
   - Do not evaluate resolution solely from the fix diff or from new/changed tests near the finding's originally cited files. A fix diff shows what changed; it does not show what the finding actually required to be true. Independently trace the finding's full causal chain — from the root symptom described in its `rationale` through to the actual runtime behavior it concerns — even when that chain passes through files the fix diff did not touch.
   - When proving a prior finding resolved, trace that finding through any authoritative production artifacts (e.g. repository-owned runtime configuration, templates, profiles, schemas, workflows, migrations, contracts) that materially participate in its causal chain. Inspect only the production artifacts materially required by those causal chains to keep the follow-up review focused.
   - Synthetic tests or constructed fixtures are supporting evidence only and cannot establish resolution when they materially differ from authoritative production artifacts or construct configurations absent from production.
   - A finding is not resolved merely because validation now accepts the input, a type now allows the field, or a new test asserts an intermediate value (e.g. a value is recorded in an output object). Confirm the underlying guarantee stated in the finding's rationale actually holds at the point where it matters (e.g. if the finding is about a value being _used_, not just accepted or recorded, verify the code path that consumes it was actually changed).
   - A finding resolution is not correct if it merely changes the failure mode or converts one failure into an unavoidable downstream failure, leaving the supported production configuration internally unsatisfiable. Confirm that at least one valid end-to-end success path exists under the actual supported production configuration for the corrected behavior.
   - For capability-dependent behavior touched by the finding, confirm consistency among declared capabilities, validation rules, runtime behavior, and output/provenance contracts when materially relevant.
   - **External Authority vs. Check Manipulation (Anti-Goodhart)**:
     - Distinguish "the code/data was changed to make the check pass" from "the underlying real-world condition was verified or established".
     - For any finding whose blocking condition traces to an external authority (legal sign-off, commercial licensing review, physical hardware/certification, human operator action) rather than a code defect: automated code changes or self-authored metadata changes CANNOT resolve the finding.
     - A finding is NOT resolved if the fixer modified production compliance registries, license registries, security exception lists, or governance metadata (e.g. flipping `review_required` or `blocked` to `approved` with self-authored notes or without external authority). Such modifications constitute fabricated compliance data rather than genuine resolution.
     - If the fix diff alters production governance/licensing registries without external authority, or weakens fail-closed compliance gates to make a test pass:
       - Mark the prior finding `resolved: false`.
       - Flag a NEW critical/high-severity blocking finding citing compliance data fabrication or weakening fail-closed policy.
       - Set verdict to `REQUEST_CHANGES`.
   - Cite the exact file/line(s) that establish the full chain is closed — not just the file/line(s) the fix diff touched — as your evidence.
2. **Detect Material Regressions or Exposed Gaps**:
   - Verify that the fix did not introduce material regressions, expose new gaps violating the issue's requirements or Acceptance Criteria, or leave the supported production configuration in an unsatisfiable state.
   - Do not turn follow-up review into an unrestricted second whole-change review; keep new discoveries anchored to the fix and the requirements.
   - Do not manufacture findings or raise unrelated stylistic preferences.
3. **Verdict**:
   - `APPROVE` if all previous blocking findings are resolved and no new blocking defects exist.
   - `REQUEST_CHANGES` if any finding remains unresolved or a new material defect was introduced.

### Workspace Bookkeeping (Do Not Flag)

If you inspect `git status` or the worktree directly, you will see untracked files. The orchestrator pipeline itself writes and reads its own bookkeeping files across phases; the exact ones currently present are listed below.

(none currently untracked in this worktree)

This exemption is narrow: it applies only to the exact untracked paths listed, as they exist right now. It does not extend to tracked files (even ones with the same name), to any content or behavior change in the branch diff, or to `.gitignore`/`.prettierignore` modifications — an implementation change that widens an ignore file to hide unrelated untracked output is still a real finding and must be evaluated normally. A prior finding about scope/hygiene is resolved on this basis only when its own cited evidence was solely the presence of these exact listed paths.

## CRITICAL RULES

- This is a read-only review. Do not modify source code or create scratch files in the worktree.
- Do not switch git branches.
- Do not ask questions.
- Write `./follow-up-review-result.json` before stopping.
- Markdown prose, stdout output, or comments cannot substitute for `./follow-up-review-result.json`.
- If `./follow-up-review-result.json` already exists and needs revision (e.g. a second pass over your own review found something new), rewrite the entire file from scratch. Do not patch/diff-edit it — context-based patch tools are unreliable against large JSON arrays, since they require reproducing exact surrounding text; a failed or partial patch application can silently corrupt the file.


## CORRECTION REQUIRED (Attempt 2 of 2)

Your previous review attempt failed contract validation:
- **Failure category:** missing_artifact
- **Required artifact path:** ./follow-up-review-result.json
- **Diagnostic detail:**
```
Required result artifact 'follow-up-review-result.json' was not created (contract violation: missing_required_artifact)
```

### Allowed Verdict Values
The `verdict` field must be exactly one of the following accepted enum literals:
- `APPROVE`
- `REQUEST_CHANGES`
- `approve`
- `request_changes`
- `PASS`
- `FAIL`
- `pass`
- `fail`

### Schema Requirements for ./follow-up-review-result.json
You must write a complete, valid JSON artifact directly to ./follow-up-review-result.json. Markdown prose, stdout output, or summary comments cannot substitute for this required JSON file. Inspect the supplied review evidence and produce a complete JSON result.

Field requirements:
- `verdict` (string, required): Exactly one of the accepted enum literals listed above.
- `evaluations` (array of objects, default: `[]`):
  Each evaluation entry must contain:
  - `finding_id` (string, required, non-empty): ID of the evaluated finding from the ledger.
  - `resolved` (boolean, required): `true` if verified resolved, `false` otherwise.
  - `evidence` (string, required, non-empty): Concrete evidence verifying resolution or explaining non-resolution.
  - `rationale` (string, optional): Additional context or reasoning.
- `new_findings` (array of objects, optional, default: `[]`): New findings or regressions detected.
- `summary` (string, optional): High-level review summary.
- `review_md` (string, optional): Optional markdown review notes.

Inspect the supplied review evidence and write the complete JSON result to ./follow-up-review-result.json before completing.
