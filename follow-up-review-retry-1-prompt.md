You are performing a follow-up review of code changes made in response to earlier review findings.

## CONTEXT

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-467
Issue number: 467

Issue description & acceptance criteria:
# [421.13] Prepare isolated MiniMax-H3 TeaCache timestep-caching experiments

## Parent
#421 — Production-viable longer MiniMax-H3 shots.

## Execution classification
**Autonomous engineering / offline test / documentation only.** Ready to run independently of ongoing distillation tests in #445, using merged #441 (instrumentation), #442 (experimental variant conventions) and #443 (distillation variants) as reference. **Operator-only live RTX 4090 measurements and human visual acceptance belong to #445** (or a separate explicit operator benchmark if #445 has finished). This is an **optional research path**, not a new blocking dependency on existing #445 work.

## Objective
Implement a strictly isolated, reproducible **MiniMax-H3 TeaCache timestep-caching experiment** to evaluate if skipping redundant model forward passes can lower end-to-end latency on our offloaded 24GB RTX 4090 **without unacceptable continuity, reference fidelity, camera motion or appearance regressions**.

## Grounded starting point
- Existing canonical I2V/Ref2V H3 workflows at `templates/minimax_h3_720p_i2v_124f_api.json` and `templates/minimax_h3_720p_ref2v_124f_api.json` use `UNETLoader`, `BasicScheduler` 20 steps / `res_multistep`, `SamplerCustomAdvanced`, and the pinned INT8 ConvRot model. Current production profiles and hashes must remain immutable.
- #441 provides experiment provenance/phase timing; #442 provides isolated attention variant contracts and compatibility gates; #443 provides isolated distillation recipes. TeaCache must be a distinct experimental family.
- Candidate upstream implementation: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT; pin and review exact source commit before use).
- Upstream `MiniMaxH3TeaCache` node declares MODEL input/output, `rel_l1_thresh`, `start_step`, `end_step`, `total_steps` and wraps `ModelPatcher.set_model_unet_function_wrapper`; upstream defaults threshold=0.15, start=2, end=-2, steps=20. Treat these as **experimental parameters, not validated production choices**.
- Upstream README reports ~3x improvement on a **64GB VRAM CMP 170HX at 1024x576, 124f, 20 steps**, **not our 4090/1344x768/dynamic-offload workload**. Its source uses an uncalibrated raw relative-L1 approximation; model-quality equivalence and H3 reference/audio conditioning compatibility must be verified, not assumed.
- #445 operator findings: baseline 243f/20-step output can be commercially acceptable on full-video review; I2V FL2VA Turbo-8 (~2.2x improvement on 124f) showed a serious scene-substitution failure on one test seed and is **not approved for shipping**. TeaCache is a separate quality/speed tradeoff to evaluate against the accepted baseline.

## Engineering scope
1. **Audit before integrate.** Pin candidate Git commit, MIT license, dependency versions, public source and executable node signature. Verify compatibility with the **actual pinned ComfyUI core** (`.comfyui-version`) and with both `MiniMaxH3ImageToVideo` and `MiniMaxH3ReferenceToVideo`; mark unknown/unsupported routes fail closed. Review wrapper API, output semantics and conditioning shape. Do not assume a generic TeaCache fork supports H3.
2. **Model-safe per-run caching.** Audit that the wrapper state is reset for every individual inference/sampler execution, including retries, interrupted runs, reruns, seed changes, independent requests, multiple sampler invocations and queue concurrency. Verify total step count equals the actual scheduler count; reject mismatches. Never reuse stale cached latents/model outputs across scenes or routes. Probe that cache hits truly skip forward passes and that no silent dense/full-compute fallback is counted as speedup.
3. **Experiment-only workflow**: Extend the established isolated #422/#441/#442 harness using a separate variant identity, node/checkpoint/plugin commit SHA, graph/hash provenance and explicit CLI/descriptor knobs for threshold/start/end/total steps. Patch the *experiment clone* of the model graph, with correct downstream MODEL wiring to the guider/scheduler and no changes to production templates or their certified gold-master hashes. Keep runner, resolution, seed, prompt, conditioning references and duration fixed within each comparison.
4. **Parameter & compatibility guards**: Define a conservative threshold grid (e.g. 0.05, 0.10, 0.15 as research candidates) and disable-by-default control. Guard unsafe step windows or inconsistent scheduler definitions. For initial comparisons require **base 20-step, dense attention**, no Turbo/Lightning/FastH3, and default pinned checkpoint so only caching changes. Any combination with distillation/attention is a **second phase**, only following separate operator-positive quality results and documented compatibility review.
5. **Instrumentation**: Record effective TeaCache version/knobs; true model forward-pass count, cache reuse/hit count, total effective steps, model/conditioning phase timings, full wall time, peak VRAM, host RAM/swap and output ffprobe facts. Detect a no-op variant (zero hits) and clearly record it. Preserve reference image manifest hashes and output hashes. Actual device data comes only from live operator execution.
6. **Offline contract/unit tests**: Deterministic clone/patch topology, immutable base template, single factor comparator invariants, state isolation across repeated requests/failed retries, cache-count invariants, invalid threshold/window/step rejection, route guards, missing custom-node/kernel failure, wrong-source-hash failure, no-op reporting, and optional incompatibility with other optimization patches. Use mocks only for logic tests; never fabricate performance measurements or real visual verdicts.
7. **Operator runbook**: reproducible installation/isolation/teardown steps, exact baseline/TeaCache matched pairs, cache window / threshold sweep plan, `i2v` and `ref2v` separately, staged frame counts **124f → 243f → 362f** only if earlier quality/resource evidence supports escalation, 3+ seeds for initial quality signal where feasible, and full-video human assessment of subject identity, wardrobe, background, camera motion, temporal stability, audio and reference matching. Include explicit safe abort, evidence retention, and GO/NO-GO form.

## Benchmark gate — #445 operator, not part of autonomous issue closure
Operator performs real RTX 4090 matched baseline vs TeaCache; measure actual **end-to-end** and sampling-only speedups, memory/offload/PCIe effects and true cache-hit counts on matched 1344x768 I2V and then Ref2V as supported. Reuse operator-accepted visual baseline and multiple seeds. **Do not infer 3x from upstream.** Compare with the best acceptable distillation variant *separately*, and evaluate combinations only after independent approval and correct optimizer identity handling.

## Acceptance criteria for THIS autonomous issue
- [ ] H3-specific TeaCache implementation and source/commit/license/security/ComfyUI compatibility documented and pinned; unsupported status fails closed.
- [ ] Isolated experimental graph/CLI/descriptor works offline with validated MODEL graph connectivity, scheduler step matching, and reproducible hashes.
- [ ] Cache state isolation and parameter validation covered by tests; no cross-job contamination or silent optimized-path fallback.
- [ ] Experiment report schema captures per-run cache hits/real calls, actual sampling and total durations, output facts, and unknown fields without synthesized data.
- [ ] Unmodified, hash-identical production templates/profile records and worker behavior; TeaCache remains **disabled** in ordinary production/ShotPlan routing.
- [ ] Reproducible operator runbook with staged speed+quality comparison and licensing/release gates.
- [ ] Relevant `pnpm test`, build, lint, typecheck and architecture checks pass; real hardware results and creative acceptance **explicitly not claimed**.

## Non-goals
- Live GPU tests, full operator matrix, production certification or general-user rollout.
- Combining cache+Turbo, cache+Sage/Veda/native sparse before individual validation.
- Changing the pinned ComfyUI core or globally installing an unreviewed plugin.
- Treating TeaCache README results as forecasts or claiming identical output pixels with cache on/off.
- Making #445 or #424–#428 wait for this optional experiment if another route already qualifies.

## Downstream
**Cross-reference #445** as an *optional* additional controlled operator comparison when ready. Only if operator approves the exact TeaCache combination should #424 versioned profile contracts and #428 production acceptance include its hashes, thresholds and runtime identity.


Issue comments:


Design document:
# Isolated MiniMax-H3 TeaCache experiment design

## Scope and authority

Issue #467 adds an optional, disabled-by-default research family to the existing MiniMax-H3 experiment harness. Deliver source audit, a hardened H3-specific experimental node, offline preparation/validation, trustworthy observation contracts, comparison logic, tests, and an operator runbook. Do not run GPU inference, install into production, certify profiles, claim visual equivalence, or produce hardware evidence. This issue does not block #445 or #424–#428. No changes to ordinary ShotPlan routing, production workers, accepted profile catalogs, or production license admission are required.

Requirements are the supplied issue and comments. Repository evidence consulted: AGENTS.md; docs/CONTEXT.md (the context file is under docs, with no root CONTEXT.md); ADRs 0001, 0007, and 0008; attention and step-reduction experiment docs; canonical templates; contracts, application service/compiler/comparator, infrastructure collector/runtime verification, CLI, and corresponding tests. Work stays in this worktree. No operator-local configuration is consulted.

## Current implementation and constraints

- apps/render-worker/src/cli/experiment-minimax-h3.ts composes the existing prepare, validate, run, reconcile, compare, cleanup, catalog, and sidecar commands. Prepare/validate can work offline. Execution uses owned child processes, attempt tokens, a physical GPU lock, target preflight, runtime verification, and a pre-submit capability handshake.
- packages/application/src/experiments/minimax-h3-experiment-service.ts derives clones and binds workflow, descriptor, reference-manifest, model, pin, runtime, and provenance digests. It already supports V1 and strict V2 descriptors/results. Extend this integration with focused TeaCache modules rather than creating another launcher or expanding production dispatch.
- packages/contracts/src/minimax-h3-experiment-v2.ts has typed factor changes and invariant projection, runtime manifests, strict schema refinements, phase accounting and unknown-capable results. There is no cache-specific factor/request/observation today. TeaCache is neither an attention backend nor a distilled sampling recipe.
- minimax-h3-attention-topology.ts currently requires BasicScheduler node 9 to use UNETLoader node 6 and dense BasicGuider node 16 to connect directly to node 6. The step-reduction compiler also restores direct baseline wiring and deletes optimization nodes. Running either validator unchanged after TeaCache insertion would reject or erase the cache graph. Add an explicit TeaCache topology validation path; retain all current attention-only and recipe-only rules. Share route/wiring checks only where practical, without making arbitrary MODEL chains acceptable.
- Canonical I2V and Ref2V both use node 6 UNETLoader with minimax_h3_ref2va_pruned_int8_convrot.safetensors, node 9 BasicScheduler with simple/20/denoise=1, node 17 res_multistep, node 16 BasicGuider, and node 14 SamplerCustomAdvanced. Do not silently substitute the FL2VA checkpoint merely because the route is I2V or because upstream measured FL2VA. The pinned canonical checkpoint digest is 9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779.
- experiments/minimax-h3-attention/catalog.json currently marks even pinned dense entries unverified/runnable=false and security review pending. TeaCache must not manufacture support by reusing those entries as approved. Give its family explicit source/route compatibility and admission evidence, reuse runtime verification mechanics, and preserve existing attention catalog decisions.
- The collector already hooks SamplerCustomAdvanced.execute/sample and chains guider.sample callbacks for step/attention accounting. Extend that same hook installation path; do not stack a competing sampler monkeypatch. Its current sampling metadata may default a scheduler name to simple; TeaCache scheduler identity must come from the verified graph and actual sigma sequence, not that fallback string.
- AGENTS.md forbids authored evidence in certification/, baseline/, and config/render-profiles/. Proposed new metadata lives under experiments/minimax-h3-teacache/ and docs; actual future run artifacts remain under .ai-runs/minimax-h3-experiments/. No fabricated metrics or signed decisions are committed.

## Source audit and pin

Planning inspected the public candidate at commit **4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f**. Use this immutable candidate, not main or an assumed release tag. Its pyproject declares version 0.1.0, Python >=3.10, no additional declared dependencies, and expects host-provided torch. MIT copyright 2026 Icyoung is present. Reviewed entry files contain ordinary Python imports, dataclass/cache logic, and node registration; no download, shell execution, opaque binary, or install-time code was found in these inspected files. This is a limited source inspection, not a completed transitive dependency or runtime security approval.

Pin these upstream byte hashes in a source manifest during implementation:

| File | SHA-256 |
| --- | --- |
| nodes.py | dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287 |
| teacache.py | 97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f |
| LICENSE | ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67 |
| pyproject.toml | e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be |
| __init__.py | 8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416 |

The executable node key is MiniMaxH3TeaCache, class MiniMaxH3TeaCacheNode, FUNCTION apply, MODEL input/output slot 0. Inputs are model, rel_l1_thresh (FLOAT, default .15, actual source range 0–.5), start_step (INT, default 2), end_step (INT, default -2), total_steps (INT, default 20). The README range differs from the source; source is authoritative for the audited API, while our narrower grid governs this experiment.

Sources: [node source](https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py), [cache source](https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/teacache.py), [dependency metadata](https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/pyproject.toml), and [license](https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE).

### Findings requiring adaptation

1. Upstream constructs state during node apply and closes over it. ComfyUI may reuse cached graph outputs; this is not a guarantee of fresh state for each sampler call, retry, interruption, or independent request.
2. step_idx advances on every wrapper call and never checks sigmas, scheduler count, conditioning branch, or sampler boundaries. More than one evaluation per logical step invalidates its window interpretation.
3. Cached input/output use detach without clone, so external in-place changes can alias retained storage. There is no model/conditioning/layout identity check and no concurrent-execution guard.
4. It returns a previous complete apply_model output unchanged. On the actual pinned core, this is a denoised prediction, not an unconverted transformer velocity: BaseModel._apply_model invokes diffusion_model, packs streams, and calls model_sampling.calculate_denoised before returning. Reusing this tensor is an intentional approximation with potential severe motion/identity/audio errors. It is not proof of calibrated TeaCache residual caching or pixel equivalence.
5. Raw relative-L1 accumulation uses the last real input, float32 full-latent operations, and .item(). These introduce extra allocation and synchronization; packed video can dominate an audio stream's error. There are no validated H3 polynomial coefficients. Do not invent calibration or claim reduced error.
6. Upstream counters are self-reported wrapper calls, not independent proof that the transformer was skipped. There are no parameter guards or complete lifecycle/error observations.

Decision: integrate a clearly named, repository-owned experimental adaptation (proposed class key CCOMiniMaxH3TeaCache), retaining MIT notices and pinning both upstream ancestry and the exact local executable bytes/algorithm version. Do not install the unmodified plugin and imply these findings are fixed. Keep the raw-L1/previous-denoised-output approximation explicit in provenance; polynomial calibration, residual algorithm redesign, and other cache algorithms are outside this issue.

## Pinned-core compatibility and support semantics

.comfyui-version pins **55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc**. Public source at this exact revision was available for inspection. ModelPatcher.set_model_unet_function_wrapper writes model_options.model_function_wrapper; samplers invoke it with apply_model and input/timestep/c/cond_or_uncond. H3 uses packed AV tensors in sampling, with latent_shapes and minimax_payload carrying references, keyframes, token tags, audio scale and conditioning. Both route nodes return conditioning in slot 0 and latent in slot 1. Reference images are re-injected inside real H3 model evaluations; skipped forwards do not re-evaluate their influence.

Pinned source references: [wrapper API](https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py), [wrapper call site](https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/samplers.py), [H3 and output semantics](https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_base.py), [route signatures](https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy_extras/nodes_minimax_h3.py), [sampler execution](https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy_extras/nodes_custom_sampler.py), and [res_multistep loop](https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/k_diffusion/sampling.py).

Record source/API compatibility separately from target-runtime verification and human quality acceptance. Structural source compatibility enables offline graphs; it is not device compatibility or commercial approval. Initial support is limited to the canonical BasicGuider, one-condition batch, packed AV image-reference routes, simple scheduler, res_multistep, base 20 steps, pinned checkpoint and dense SDPA. Input audio/video guides, other models, changed precision, unknown payload/layouts, CFG branching, extra optimizers, and other core revisions fail closed until reviewed. Audit I2V first/optional last-frame and Ref2V ordered image references separately. If a route cannot be structurally supported, preserve an explicit unsupported reason and deny its preparation/execution instead of falling back or switching route.

The adaptation needs only host torch plus the pinned core dependencies. Reuse the established torch 2.5.1+cu124 experiment substrate declaration as a candidate, verify its full dependency closure and compatibility with this core rather than assuming it works, and pin exact dependency artifacts before admitting an operator run. Missing/unavailable artifacts leave runtime status unverified. No kernel package is added for TeaCache. A missing dense kernel/custom node or incorrect source hash is fatal. Do not bump the core to resolve incompatibility.

## Contracts, CLI, and graph

Add a dedicated teacacheRequest and teacacheObservation with their own versioned schemas in a TeaCache contracts module and additive optional V2 descriptor/result fields. Preserve parsing of historical V1/V2 artifacts, existing digests for descriptors without the new fields, and all current attention/recipe semantics. Document that older strict readers cannot read newly extended TeaCache artifacts. Use a distinct TeaCache instrumentation protocol/version when its hooks are required; legacy hook requirements remain unchanged.

Expose catalog --type teacache and explicit prepare controls: --teacache off|raw-l1-v1 (default off), --teacache-threshold, --teacache-start-step, --teacache-end-step, --teacache-total-steps, plus --teacache-matched-control for a cache-disabled baseline using the identical isolated substrate. Reject stray cache knobs with off, except the explicitly matched control identity. Require all candidate knobs explicitly; upstream defaults are documentation, not hidden experimental decisions. Initial threshold allowlist is .05/.10/.15. Total steps must be 20 and equal node 9 steps and actual len(sigmas)-1. Define zero-based half-open cache window [start,end); negative end resolves as total_steps+end. Require at least first two and last two steps real: 2 <= start < effective_end <= 18. Persist raw and normalized windows. Reject NaN/infinity, unsafe integers, empty windows, denoise other than 1, altered schedules/checkpoints, LoRA, sigma shifts, Sage/Veda/native sparse/FastH3, and unknown model patches/attention flags.

Clone the prepared canonical graph, insert exactly one audited MODEL patch at a collision-checked deterministic ID (proposed 401), connect 6:0 -> cache MODEL input -> 16.model at output 0, and connect 9.model to the same patched MODEL. Scheduler calculation itself never opens a cache session; the clone retains the same model_sampling object. Keep 14's guider/sigmas/conditioning-latent links and all encode/decode/audio/save/reference connections unchanged. Validate exact class, slots, reachability, no bypass, no cycle, no extra model consumers/patches/samplers, node signatures and unchanged conditioning. Off/control graphs retain the canonical direct MODEL links. Derive/check in the correct order and dispatch to the TeaCache-specific topology validator rather than relaxing dense topology for everyone.

Bind upstream commit/source hashes, local adapter hash and version, core source hashes, dependency/artifact lock digest, collector/hook digests, route compatibility evidence, checkpoint, threshold/window, and derived graph to the descriptor digest. Do not label local modified bytes with only the upstream commit. Runtime lock and loaded custom-node/collector identity are independently observed before submission and at reconciliation.

## Per-sampler state and execution safety

The patch node installs immutable configuration and a wrapper resolving an execution-local session; it must not capture mutable cache tensors on a long-lived graph/model. Extend the existing collector sampler hook to open a session at every actual SamplerCustomAdvanced execution and close it in finally on success, error, cancellation, or interruption. Bind session to runId, attempt token, prompt execution, sampler invocation ID, patched model identity, route and immutable conditioning manifest. Use execution-local context plus explicit model ownership; unrelated contexts cannot see each other's tensors. Reject reentrant/concurrent use of the same mutable model/guider rather than serially sharing cached state. Independently owned instances can have separate sessions; actual GPU execution remains serialized by the existing lock.

Validate the actual sigma sequence at entry: finite, strictly descending, canonical simple schedule, 21 entries for 20 intervals. Map wrapper timesteps to that sequence and callback completion; do not derive a logical step from a total wrapper counter. Under the initially supported BasicGuider contract require exactly one eligible evaluation per sigma interval. Duplicate, out-of-order, extra-branch or unexpected layout/conditioning calls abort as unsupported; do not quietly compute dense and mark the run optimized. Multiple sequential sampler invocations, including ones using a cached patch-node output, always receive fresh sessions and independent counters. Initial prepared graphs contain one sampler; runtime boundary logic still protects repeated invocations and adversarial tests.

Cache detached clones of the last real input and denoised output. Preserve the audited raw-L1 accumulator semantics; require finite values, matching shape/device/dtype/packed AV layout and stable conditioning identity. Every hit returns a protected tensor of the exact expected output structure and invokes no underlying model. Protected early/final steps must always execute real forwards. A wrapper call without a valid owned session, an existing competing model wrapper, or a lifecycle/identity mismatch is a terminal error. Cleanup releases tensors and context tokens even after exceptions; never use seed equality as a reset heuristic.

## Observations and comparison

Extend the existing phase-event protocol and collector handshake for cache session start/end, per-evaluation hit/real decisions, configuration/version/loaded-source observations, and independently counted H3 diffusion_model forwards. Count entry, successful completion, and failed real calls separately. Correlate with sampler/step/attempt IDs and underlying model hook; do not equate attention calls with model forwards. On a completed supported session, wrapper evaluations = successful real calls + hits, completed logical steps = 20, and independently completed transformer forwards = real calls; hits must have zero nested forwards. Failed attempts retain partial counts with incomplete coverage and never merge into a later attempt. Cache lifecycle hooks must appear as attached in the capability handshake.

Observation includes requested and effective knobs, all session IDs, actual scheduler count, call/hit counts, coverage and failure reasons, and status such as verified/no_op/failed/unknown. Unknown is null plus a reason, not zero. A completed, instrumented candidate with zero hits is no_op and ineligible for TeaCache speedup claims even if its raw wall time happens to improve. Mismatched identity, incomplete coverage, unexpected full-compute calls on hits, fallback, or errors likewise make ratios null. Dense attention on real steps is expected, so do not classify it as TeaCache fallback; dense attention coverage counts naturally shrink with cache hits.

Reuse phase timing, full owned-execution wall time, output ffprobe facts, GPU/host memory and swap samples, reference hashes and output hashes. Include sampling and conditioning/model-load durations, cache-decision overhead, and optional measured PCIe/offload counters with explicit unavailable reasons. Distinguish sampled peaks from allocator-exact peaks and unobserved PCIe traffic from measured zero. Never synthesize unavailable VRAM, RAM, timings, outputs or visual verdicts. Preparation writes only an empty measurement template.

Add a typed caching.configuration factor. The candidate declares exactly that change from a cache-off matched control, including the effective configuration/algorithm identity. Both runs must load the same local adapter, packages, core, collector and hooks, even though the control has no cache patch. The control session independently counts real forwards. Require identical route, geometry, frames/fps/duration, seed, prompts, reference order/content/roles/ref_image_size, checkpoint and auxiliary model hashes, sampler/scheduler/denoise, runner/offload settings, and observed runtime/GPU substrate. Confirm declared before/after against actual graphs, descriptors and observed identities; masking the factor must not mask runtime/model/attention drift. Normalize only the exact allowed patch and MODEL-edge differences in graph comparison. Existing baseline link checks at run admission and final compare must share this policy.

Report measured baseline/candidate end-to-end and sampling-wall ratios only with complete successful matched evidence and positive hits. Keep raw diagnostic timings for no-op/failed runs. Human quality remains unknown until an imported full-video review; no metric implies creative acceptance.

## Operator boundary, risks, and downstream traceability

Provide isolated checkout/venv and hash-checked adapter staging, read-only shared weights, separate loopback port/run root, no global plugin installation or core mutation, and owned-process teardown. Retain pre/post production identity manifests, run descriptors, raw phase/telemetry logs, attempts, inputs/hashes, outputs/probes/hashes, environment/lock identities and human review sidecars. Cleanup must retain evidence and release only owned resources.

Runbook pairs cache-off matched control with explicit .05/.10/.15 candidates at [2,18), followed by narrower safe windows only as separately identified cells. Run I2V and Ref2V separately at 1344x768, 24fps, 20 steps and the pinned checkpoint; start at 124f with 3+ matched seeds where feasible. Escalate to 243f and then 362f only after prior full-video quality/resource evidence supports it. Record sampling-only and end-to-end latency, memory/offload/PCIe effects and independently verified hits; never forecast the upstream 64GB CMP 170HX result for 24GB 4090 offload. Include abort triggers for identity/conditioning errors, OOM/swap/resource policy, broken counters, fallback and severe visual defects, plus evidence retention and safe process/lock cleanup.

GO/NO-GO form records exact identity, matched pairs/seeds, measurements/unknowns, cache coverage/no-op, full-video subject/face/wardrobe/product/background continuity, camera motion, temporal stability, audio/sync, reference matching, resources, reviewer and licensing/release status. Baseline 243f acceptability and FL2VA Turbo scene-substitution findings are issue context, not newly verified evidence. Compare the best acceptable distilled route in a separate study. Cache+distillation/attention is a second phase requiring separately positive operator evidence and compatibility review; this issue's CLI rejects those combinations.

| Consumer | Capability enabled | Obligation in this issue |
| --- | --- | --- |
| #445 or separate operator benchmark | Reproducible optional TeaCache matched comparisons with authentic counters and review | Deliver runbook/contracts and offline tests; no live matrix or phase sign-off |
| #424 profile contracts | Exact future cache identity, knobs and hashes can be represented in evidence | Document mapping/any future schema gap; do not register/promote a profile |
| #428 release acceptance | Future operator can bind exact reviewed combination to measured artifacts | Preserve isolation and evidence identities; no certification or signed release gate execution |

Principal risks are upstream approximation quality, audio error hidden by packed relative-L1, tensor retention on 24GB/offload, synchronization overhead exceeding saved compute, cached graph execution, conditioning batching, and source/API drift. Offline tests establish logic and structural compatibility only. Unknown target dependencies and hardware behavior remain explicit; a blocked route/runtime is a legitimate research result and never an excuse to bypass guards.

Implementation plan:
# Implementation plan

## 1. Freeze audit evidence and define the experimental identity

Read the source at the design's pinned upstream and core SHAs again during implementation, verify byte hashes and all imported/executable files, and store an audit/source manifest, API signature fixture, route compatibility table and experiment catalog under experiments/minimax-h3-teacache/. Document lifecycle, denoised-output approximation, AV layout, dependency/security/license findings and remaining unknowns in docs/minimax-h3-teacache-source-audit.md. Retain the MIT notice for adapted code. Store exact dependency requirements and artifact locks only when verified; unavailable closure keeps execution blocked. Separate source-compatible, runtime-verified, unsupported and human-accepted facts.

Use the existing runtime substrate requirements rather than inventing wheel hashes or assuming the attention catalog is admitted. Do not execute upstream code, globally install the plugin, change .comfyui-version, or fetch weights as part of the audit.

Validation: offline manifest/API parsing and digest tests; assert wrong upstream/local hashes and unsupported route/core statuses fail closed. Source evidence fixtures contain public source facts, not hardware measurements.

## 2. Add dedicated cache contracts and provenance

Introduce packages/contracts/src/minimax-h3-teacache.ts and tests for the catalog, versioned request/effective configuration, normalized window, source/adapter identity, session events, observations, coverage, no-op and unknown states. Integrate optional TeaCache fields with strict V2 descriptor/results, empty measurement creation, factor union, descriptor hashing, comparison projection and exports. Add caching.configuration with typed before/after values; require canonical-base-20, dense attention and default checkpoint whenever TeaCache is requested. Preserve historical artifacts and unchanged hashes for descriptors with no new fields. Do not overload samplingRecipe or attentionRequest with a cache backend.

Tests include threshold grid and nonfinite/invalid numbers; signed end normalization and boundary/off-by-one cases; scheduler/total-step/denoise mismatch; explicit disabled/default behavior; forbidden combined optimizers; incompatible route; invalid counter relationships; null versus observed zero; no-op; partial failed attempts; old V1/V2 fixtures and cache identity digest sensitivity.

Validation command: pnpm vitest run packages/contracts/src/minimax-h3-teacache.test.ts packages/contracts/src/minimax-h3-experiment-v2.test.ts packages/contracts/src/minimax-h3-experiment.test.ts

## 3. Implement the isolated node and sampler-session lifecycle

Add the repository-owned adapted Python custom-node package under experiments/minimax-h3-teacache/ (or an infrastructure-owned package with equivalent isolated staging). Use the design's immutable patch configuration, execution-local sessions, ownership guard, detached cloned tensors, bounded windows, actual sigma/step checks, stable route/conditioning/layout identity and finally cleanup. Keep upstream raw-L1 and previous-denoised-output semantics explicit and versioned. Reject a preexisting wrapper and unsupported shapes/branches before cache reuse. Do not add a production node-loading path.

Extend the existing infrastructure collector's SamplerCustomAdvanced hook to enter/exit sessions and chain existing callbacks without duplicating attention/timing hooks. Independently instrument the actual bound H3 diffusion_model forward for real-work evidence. Increment successful counts only after return, retain attempted/failed counts on errors, and correlate all events with attempt and invocation IDs. Protect against cached patch-node outputs, multiple sequential sampler invocations and a wrapper executing outside a session. Reject concurrent/reentrant access to the same mutable model/guider; separate owned model instances have disjoint sessions. Ensure any new Python package is available in built execution using the existing postbuild packaging mechanism or a source path included and verified in the runtime manifest.

Add Vitest-driven Python subprocess tests using the collector-test pattern, with small deterministic fake tensors/model stubs for logic. Prove a hit never calls the underlying forward and output/input alias mutation cannot contaminate later calls. Exercise repeated prompts without re-running node apply, changed seed/scene/route, retries after failure, interruption, two sampler calls on one patched model, context interleaving, same-instance concurrency rejection, empty/mismatched sigma schedules, duplicate timestep/conditional calls, missing session, and cleanup after every failure. Mocks verify logic only; retain source-based compatibility evidence separately.

Validation command: pnpm vitest run packages/infrastructure/src/experiments/minimax-h3-teacache.test.ts packages/infrastructure/src/experiments/minimax-h3-collector.test.ts

## 4. Derive and validate graphs; expose offline CLI preparation

Add focused application catalog/topology modules with deterministic clone-and-patch behavior. Integrate prepare and validate in minimax-h3-experiment-service.ts and PrepareMinimaxH3ExperimentOptions in application ports. Patch only the cloned graph and implement exact MODEL links to both guider and scheduler, unchanged conditioning/latent/audio pipeline, scheduler identity, collision checks, no extra sampler/optimizer and no bypass/cycle. Dispatch TeaCache descriptors through their explicit validator, preserving existing attention and step-reduction validators for their families.

Extend the existing CLI help/parser/catalog with --type teacache and the design's explicit controls. Matched controls use the same environment identity and count hooks while caching stays off. Offline prepare/validate must neither start a process nor probe a GPU and must write requested settings plus null measurement fields, not claimed execution results. Add a repeatable hash/config identity for each threshold/window cell and reject stray knobs/other optimization requests.

Tests load both actual canonical templates, deep-freeze inputs, derive repeatedly, and verify exact node/slot topology and deterministic canonical digests. Mutate one link/class/slot/checkpoint/scheduler/conditioning-reference field at a time and expect rejection. Assert byte hashes and canonical gold-master digests are unchanged; independently verify unmodified production profile/pin/provenance files. Use actual graph fixtures for TeaCache tests instead of minimal old mocks that omit required MODEL nodes. Cover CLI missing arguments, defaults, invalid combinations, offline-only behavior and unsupported routes.

Validation command: pnpm vitest run packages/application/src/experiments/minimax-h3-teacache-topology.test.ts packages/application/src/experiments/minimax-h3-experiment.test.ts packages/application/src/experiments/minimax-h3-attention-topology.test.ts packages/application/src/experiments/minimax-h3-step-reduction-compiler.test.ts apps/render-worker/src/cli/experiment-minimax-h3.test.ts

## 5. Enforce runtime identity and extend the pre-submit handshake

Extend infrastructure runtime registry/preflight and collector capability evidence to verify the exact local node module/package files, upstream source manifest, core signatures/hashes, dense dependencies, attached cache sampler/model hooks, and immutable effective configuration. Include TeaCache hook requirements only for the new protocol. Use existing runId/attemptToken/nonce anti-replay and observed artifact identity checks; recompute local adapter identity from loaded code, not a caller-provided label. Preserve GPU locking, owned child-process isolation, timeout/abort behavior, pre-submit checks and reconciliation identity checks.

The run command must refuse unknown/unsupported source/route/runtime, missing node/module/kernel, mismatched node signature, dirty/wrong executable hashes, conflicting patches/flags and unattached lifecycle/model hooks. It must not submit a prompt on failure. Validate cached node state cannot survive a new attempt. Unknown physical runtime observations remain unknown until operator execution. Test these paths via existing injected ports/fake child environments; do not contact a render host.

Validation command: pnpm vitest run packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts packages/infrastructure/src/experiments/minimax-h3-target-preflight-lock-toctou.test.ts packages/infrastructure/src/experiments/minimax-h3-collector.test.ts packages/application/src/experiments/minimax-h3-experiment.test.ts

## 6. Reconcile counters and admit only true single-factor comparisons

Add a focused application TeaCache event reducer and extend reconciliation/report schemas. Reconcile raw events by attempt and sampler invocation, preserve partial failures, and reject missing/duplicate terminal events, counter disagreement, lost attribution and real forwards inside hit spans. Distinguish successful zero-hit no_op from missing observation. Attach effective cache/version/source facts while retaining existing phase, full wall time, telemetry, host memory/swap and ffprobe/output hashing paths. Add optional measured transfer/offload information only with genuine coverage; document unknown PCIe facts instead of reconstructing them from assumptions.

Extend minimax-h3-comparator.ts and baseline admission to validate the new typed factor against actual candidate/control descriptors/graphs and effective observations. Enforce equal runtime substrate with the same adapter loaded on both sides; only patch/config and the exact two MODEL-edge rewrites differ. Keep sampler, checkpoint, attention, runner/offload, geometry/duration, seed, prompts, ref_image_size and reference manifests fixed. Require positive candidate hits, consistent independent forward counts and complete successful coverage before ratios. Zero hits, fallback, identity mismatch, incomplete attempts and historical uninstrumented baselines produce null TeaCache speedups with reasons. Retain raw durations and quality unknowns. Adjust attention coverage expectations to real forwards without weakening dense backend verification.

Tests cover verified hit/no-hit flows; real calls on alleged hits; missing/failed forwards; duplicate or mixed-attempt events; wrong observed configuration/source; hidden optimizer; undeclared graph mutations; seed/prompt/reference/order/geometry/checkpoint/runtime/runner drift; baseline with caching enabled; same cached session reused; sampling/wall timing completeness; and historical comparison regressions. Synthetic event values must be labeled as test fixtures and never published as benchmark reports.

Validation command: pnpm vitest run packages/application/src/experiments/minimax-h3-teacache-reducer.test.ts packages/application/src/experiments/minimax-h3-comparator.test.ts packages/application/src/experiments/minimax-h3-timing-reducer.test.ts packages/application/src/experiments/minimax-h3-attention-reducer.test.ts

## 7. Publish operator instructions and verify isolation

Write docs/minimax-h3-teacache-experiments.md and docs/minimax-h3-teacache-report-template.md. Supply exact implemented CLI examples for isolated install/hash verification, catalog, matched control and each threshold/window, prepare/validate, run, reconcile, compare, sidecar import, abort and evidence-preserving cleanup. Installation must stage only audited adapter bytes into an isolated pinned-core checkout, with a verified dependency lock, separate venv/port and read-only weights. Preserve production checksums before and after; teardown only the owned child/staged package/environment.

Document separate I2V/Ref2V matched 1344x768 runs, 3+ seeds where feasible, 124f -> 243f -> 362f conditional escalation, full-video quality rubric including audio and scene substitution, no-op handling, resource stop policy and GO/NO-GO/release form. Link this as an optional #445 operator comparison or separate operator benchmark if #445 is finished. Explain upstream measurements cannot forecast 4090 results, accepted baseline context is not a new measurement, and cache+distillation/attention is excluded pending independent approval. Describe future #424/#428 contract mapping without making their live runs/signatures/promotion a closure gate.

Finish with source/artifact isolation assertions and regression tests showing normal worker/ShotPlan behavior and production profile hashes remain unchanged. Do not modify or author files under forbidden evidence directories. Baseline template byte hashes observed during planning are fafa26157c78c8bb29ca9da30d7a7e970ac583c6bde547c53d59e6e692a8a54e (I2V) and c6c4866fb51f95ba7b02eb162b94da7b16910b24f6cb9dbd21c6a5233548f5ed (Ref2V); these byte digests are distinct from the repository's canonical JSON workflow hashes, which must also remain unchanged.

## Validation and completion

This planning task changes only result.json and does not run implementation validation. During implementation, run the focused tests at each step, then pnpm build, pnpm lint, pnpm typecheck, pnpm test, pnpm boundaries and pnpm format. Use the repository's existing six validation tiers in order for the final effective gate: hygiene/install, isolated format write, isolated format check, cache preparation/build, fast deterministic gates, and heavy suites. Preserve .ai-orchestrator.json rather than duplicating inherited commands. pnpm test:db remains required in its existing tier and uses vitest.integration.config.ts with Docker; never invoke *.integration.test.ts through the default unit config. New Python logic tests run through Vitest and require no new validation command. If a genuinely new command is needed, map it into validation.tiers and retain complete tier coverage.

Full gates include check:hooks, install --frozen-lockfile, format:fix, format, preValidation/build, lint/typecheck/test/test:bash/boundaries/check:control-plane, then test:db/test:assembly/test:kokoro/test:piper/test:ltx-production/test:whisperx under existing pinned-environment requirements. Do not interpret an unavailable Docker/model dependency as a TeaCache test pass; report concrete environmental blockers. None of these checks authorize TeaCache live GPU execution.

Review completion against the issue: public source/commit/license/dependency/security/core/route audit pinned; deterministic experiment clone and CLI with verified scheduler/model wiring; per-sampler isolation tests; true forward/hit observation with no-op/unknown semantics and no silent fallback; immutable production artifacts/default routing; reproducible staged operator runbook; relevant engineering gates passing. Hardware speedups, visual approval, downstream candidate registration and production certification are explicitly absent from the autonomous completion claim.

Accumulated review findings ledger:

```
### UNRESOLVED BLOCKING FINDINGS:
- **[AC-1] [HIGH]** Failed requirement: H3-specific TeaCache implementation and source/commit/license/security/ComfyUI compatibility documented and pinned; unsupported status fails closed.
  Evidence: Upstream commit, MIT notice, API fixture and upstream file hashes exist in experiments/minimax-h3-teacache/source-manifest.json. However, minimax-h3-experiment-service.ts:2103 sets adapterDigest to the hash of the upstream hash dictionary, not the local executable package. No local adapter byte manifest, core source hash binding, or TeaCache loaded-source verification exists in the infrastructure runtime verifier. The audit also claims sampler lifecycle and independent forward hooks that the collector does not implement. Keeping the catalog unverified/non-runnable is appropriate, but does not supply these missing engineering contracts.
  Required Fix: Implement requirement to satisfy: H3-specific TeaCache implementation and source/commit/license/security/ComfyUI compatibility documented and pinned; unsupported status fails closed.
  Source: spec-review (iteration 0)

- **[AC-2] [HIGH]** Failed requirement: Isolated experimental graph/CLI/descriptor works offline with validated MODEL graph connectivity, scheduler step matching, and reproducible hashes.
  Evidence: Default candidate preparation clones canonical graphs, inserts node 401 and rewires both MODEL consumers. Nevertheless, the attention branch at minimax-h3-experiment-service.ts:1090 precedes the TeaCache branch at 1138: explicitly selecting allowed dense attention skips TeaCache derivation and request creation. Actual sampler sigma matching is not integrated. Required explicit candidate controls are replaced with implicit defaults.
  Required Fix: Implement requirement to satisfy: Isolated experimental graph/CLI/descriptor works offline with validated MODEL graph connectivity, scheduler step matching, and reproducible hashes.
  Source: spec-review (iteration 0)

- **[AC-3] [HIGH]** Failed requirement: Cache state isolation and parameter validation covered by tests; no cross-job contamination or silent optimized-path fallback.
  Evidence: The collector never creates, binds, advances or finally-cleans TeaCacheSession. nodes.py:78-84 accepts any active session without checking its model_id/configuration. teacache.py accepts absent sigmas, does not validate wrapper timesteps/conditioning/route, and never enforces one evaluation per step. No Python lifecycle/isolation tests are supplied. Threshold allowlisting and explicit/off-mode knob validation are missing.
  Required Fix: Implement requirement to satisfy: Cache state isolation and parameter validation covered by tests; no cross-job contamination or silent optimized-path fallback.
  Source: spec-review (iteration 0)

- **[AC-4] [HIGH]** Failed requirement: Experiment report schema captures per-run cache hits/real calls, actual sampling and total durations, output facts, and unknown fields without synthesized data.
  Evidence: Existing timing/probe/output fields are retained, but minimax-h3-teacache-reducer.ts:162-164 synthesizes independent model forwards from wrapper decisions, and line 190 copies requested configuration into effective configuration. Missing observations use numeric zero rather than null. Sessions, successful/failed independent forwards, terminal coverage and effective source/configuration are not validated. The comparator admits an uninstrumented control.
  Required Fix: Implement requirement to satisfy: Experiment report schema captures per-run cache hits/real calls, actual sampling and total durations, output facts, and unknown fields without synthesized data.
  Source: spec-review (iteration 0)

- **[AC-5] [HIGH]** Failed requirement: Reproducible operator runbook with staged speed+quality comparison and licensing/release gates.
  Evidence: The runbook includes a threshold grid, seeds and duration stages, but its commands invoke the nonexistent cco:experiment:minimax-h3 script, unsupported --out-dir/--descriptor flags, execute subcommand and --candidate comparison flag. It omits reproducible isolated checkout/venv/hash-checked staging, owned teardown/evidence retention and explicit licensing/release sign-off. It incorrectly instructs an FL2VA checkpoint for I2V despite both canonical graphs using ref2va. The quality form omits audio/sync acceptance.
  Required Fix: Implement requirement to satisfy: Reproducible operator runbook with staged speed+quality comparison and licensing/release gates.
  Source: spec-review (iteration 0)

- **[F-da00b38b] [HIGH]** The required H3 execution boundary, state isolation, actual scheduler enforcement and independent model instrumentation are unimplemented. Even after authentic runtime admission the normal sampling path cannot operate this node. Context variables alone do not establish model/conditioning ownership, retry isolation or cleanup. Catalog blocking is legitimate but does not fulfill these offline engineering requirements.
  Files: packages/infrastructure/src/experiments/minimax-h3-collector.py, experiments/minimax-h3-teacache/nodes.py, experiments/minimax-h3-teacache/teacache.py, docs/minimax-h3-teacache-source-audit.md
  Evidence: The existing SamplerCustomAdvanced hook at collector.py:1574-1690 never imports or binds a TeaCache session; packages/infrastructure contains no TeaCache hooks. The node requires an active session but accepts any session at nodes.py:84. Session model_id is unused, sigmas are optional, and advance_step accepts any index without timestep/callback or one-evaluation-per-step checks. There are no infrastructure Python lifecycle tests. Direct probes confirmed foreign-session acceptance and unchecked step 999.
  Required Fix: Extend the existing sampler hook with owned execution-local session entry/finally cleanup, immutable model/route/conditioning/config identity, validated actual sigma/timestep progression and independent successful/failed H3 forward hooks. Add deterministic Python tests covering reruns, failure/retry, cached node outputs, concurrent ownership and unexpected calls. Keep runtime admission blocked until authentic prerequisites are met.
  Source: spec-review (iteration 0)

- **[F-e50b47fb] [HIGH]** Provenance does not describe the locally executed implementation. Changing adapted Python code leaves the recorded adapter identity unchanged, defeating wrong-source-hash rejection. Unknown dependency/runtime admission may remain blocked, but immutable source identity and its verifier must exist before this autonomous work is complete.
  Files: packages/application/src/experiments/minimax-h3-experiment-service.ts, experiments/minimax-h3-teacache/source-manifest.json, packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
  Evidence: At service.ts:2103 adapterDigest is sha256Hex(canonicalizeJson(TEACACHE_SOURCE_FILE_HASHES)); those are upstream file hashes, including files absent from the adapted package. Neither manifest nor runtime registry pins/recomputes adapted nodes.py, teacache.py and __init__.py bytes. No TeaCache-specific hook protocol/handshake or loaded adapter hash verification is present. The candidate requirements file lists versions without a verified artifact closure.
  Required Fix: Hash and bind the exact local executable package, core source/API evidence, dependency lock and required collector hooks separately from upstream ancestry; verify the loaded identities before submission and reconciliation on both candidate and matched control. Test local-byte drift and missing hooks. Preserve explicit unverified status for unavailable dependency artifacts.
  Source: spec-review (iteration 0)

- **[F-0ce1c4a0] [HIGH]** This synthesizes unobserved compute/configuration evidence and can certify incomplete or misattributed execution. It violates independent skip verification, session/attempt coverage, no fallback and null-with-reason semantics.
  Files: packages/application/src/experiments/minimax-h3-teacache-reducer.ts, packages/contracts/src/minimax-h3-teacache.ts, packages/application/src/experiments/minimax-h3-teacache-reducer.test.ts
  Evidence: Reducer lines 162-164 replace missing independent forwards with decision counts; line 190 promotes requestedConfig to effectiveConfig. It counts generic decision metadata without validating unique logical steps, session ownership or terminal events. A source-level in-memory probe with twenty duplicate step-zero decisions, one sampling start, no session end and zero independent forwards returned verified/complete with fourteen recorded model forwards. Unknown counters are forced to zero by nonnullable schemas.
  Required Fix: Reconcile independently observed entry/completion/failure events per owned attempt/session/step, require terminal coverage and matching effective identities, reject duplicates/disagreement/hit-nested forwards, remove inferred-forward/configuration fallbacks, and represent unobserved facts as null with reasons. Add adversarial event-stream tests.
  Source: spec-review (iteration 0)

- **[F-b198895c] [HIGH]** The intended single-factor comparison can use an uninstrumented ordinary baseline and unverified effective candidate configuration. It does not establish that both runs loaded the same adapter/hooks or that actual compute was skipped, so reported speedups are not admitted evidence under the anchored design.
  Files: packages/application/src/experiments/minimax-h3-comparator.ts, packages/application/src/experiments/minimax-h3-comparator.test.ts, packages/application/src/experiments/minimax-h3-experiment-service.ts
  Evidence: Comparator.ts:253-265 returns valid for mode off when observation is absent. Active validation does not check effectiveConfig against the request or require independently observed forward counts to equal wrapper successful forwards. The positive TeaCache comparator test creates a control without teacacheObservation and a candidate with requestedConfig/effectiveConfig=null, yet expects both ratios. The matched-control descriptor requires neither the adapter node nor a distinct cache hook protocol, and reconciliation only collects TeaCache evidence for teacacheRequest.
  Required Fix: Give the cache-off matched control explicit adapter/hook identity and independent real-forward observations. Require complete successful control and candidate coverage, identical observed substrate, matched effective configuration and independent count equality; otherwise leave ratios null. Apply the same policy at run admission and final comparison and invert the current permissive positive fixture.
  Source: spec-review (iteration 0)

- **[F-eaeb5ddc] [HIGH]** The autonomous deliverable must enable reproducible operator work. These instructions fail before offline preparation and can change the comparison model; the missing isolation and release instructions leave the anchored operator handoff incomplete.
  Files: docs/minimax-h3-teacache-experiments.md, docs/minimax-h3-teacache-report-template.md
  Evidence: Runbook lines 206-278 use cco:experiment:minimax-h3, --out-dir, --descriptor, execute and --candidate; these disagree with package.json and the CLI parser. Preparation examples also omit required input/prompt/target/runtime/run ID controls. The runbook prescribes FL2VA for I2V although both canonical production templates use ref2va. It supplies no isolated checkout/venv/hash staging or owned cleanup/evidence retention commands, and no explicit audio/sync and licensing/release sign-off form.
  Required Fix: Replace examples with parser-tested implemented commands and all required inputs; document isolated pinned-core/venv setup, verified adapter staging, read-only weights, separate port/run root, identity manifests, retained evidence and owned teardown. Use ref2va on both initial routes, explain unknown admission prerequisites, and add audio/full-video and licensing/release gates to the staged GO/NO-GO form.
  Source: spec-review (iteration 0)

- **[F-4d27774c] [CRITICAL]** The Python caching node and session lifecycle are non-functional and unsafe at runtime: (1) no sampler hook ever opens, advances, or cleans up a TeaCacheSession, so any patched model invocation unconditionally fails with a missing-session RuntimeError; (2) a session bound in context is accepted by any patched model instance without checking model_id or configuration identity; (3) multiple evaluations in the same step are not rejected and will falsely hit the cache against the just-recorded last_real_input (rel_l1 == 0.0); and (4) NaN thresholds and out-of-range step indices bypass validation.
  Files: experiments/minimax-h3-teacache/nodes.py, experiments/minimax-h3-teacache/teacache.py, packages/infrastructure/src/experiments/minimax-h3-collector.py
  Evidence: In experiments/minimax-h3-teacache/nodes.py:78-84, teacache_unet_wrapper calls get_active_session() and raises RuntimeError if None, but packages/infrastructure/src/experiments/minimax-h3-collector.py has zero references to TeaCacheSession or set_active_session/reset_active_session. Furthermore, nodes.py:78-84 never compares session.model_id against patch_config["model_id"] (teacache.py:39 stores self.model_id but never reads it). In teacache.py:49-53 and 83-158, self.step_idx never advances during evaluate(), self.evaluations_in_current_step is incremented (lines 131, 145) but never checked to reject duplicate/multi-branch evaluations within the same step, advance_step(step_index) (lines 78-81) performs no bounds or sigma/timestep checks, and nodes.py:45 / teacache.py:29 use `rel_l1_thresh <= 0 or rel_l1_thresh > 0.5` which evaluates to False for float("nan").
  Required Fix: Integrate TeaCacheSession lifecycle creation, sigma validation, per-step advancement, diffusion_model forward counting, and finally-block cleanup into the SamplerCustomAdvanced hook in packages/infrastructure/src/experiments/minimax-h3-collector.py. In nodes.py and teacache.py, enforce math.isfinite(rel_l1_thresh) and allowlist membership, verify session.model_id and config match the patched model in teacache_unet_wrapper, reject evaluations_in_current_step > 0 within a step interval, and validate timestep/sigma alignment.
  Source: quality-review (iteration 0)

- **[F-a015a42e] [CRITICAL]** Synthesizing modelForwardsRecorded from the wrapper's self-reported forwardCallsRecorded defeats independent verification that cache hits skipped underlying diffusion_model forward passes. Additionally, copying requestedConfig into effectiveConfig fabricates runtime configuration provenance, and returning status: "verified" when coverage.complete is false or when modelForwardsRecorded disagrees with forwardCallsRecorded produces contradictory and untrustworthy experiment results.
  Files: packages/application/src/experiments/minimax-h3-teacache-reducer.ts, packages/contracts/src/minimax-h3-experiment-v2.ts
  Evidence: In packages/application/src/experiments/minimax-h3-teacache-reducer.ts:162-165: `if (modelForwardsRecorded === 0 && forwardCallsRecorded > 0) { modelForwardsRecorded = forwardCallsRecorded; }`. At lines 167-185, finalStatus is never set to "failed" when modelForwardsRecorded !== forwardCallsRecorded, and finalStatus remains "verified" even when coverage.complete is false (e.g. when identityValidated is false or samplingCallsRecorded === 0). At line 190, `effectiveConfig: finalStatus !== "failed" ? requestedConfig : null` copies requestedConfig instead of parsing observed session configuration from runtime events.
  Required Fix: Remove the fallback that copies forwardCallsRecorded into modelForwardsRecorded. Require independent diffusion_model forward events to match forwardCallsRecorded (and equal 0 during hit spans), derive effectiveConfig strictly from observed session_init event metadata (failing when mismatched with requestedConfig), and require coverage.complete === true before setting status to "verified" in both reduceTeaCacheObservation and MinimaxH3ExperimentResultV2Schema.
  Source: quality-review (iteration 0)

- **[F-14b6fd00] [HIGH]** Computing adapterDigest from a static constant of upstream hashes means local modifications or corruption in experiments/minimax-h3-teacache/{nodes.py,teacache.py,__init__.py,source-manifest.json} are never bound to the descriptor digest or detected by validateExperiment(). Moreover, compatibility.relativeToRuntimeManifestDigest does not match the digest of descriptor.requiredRuntime, and the runtime registry has no verification path for the adapted custom node.
  Files: packages/application/src/experiments/minimax-h3-experiment-service.ts, packages/contracts/src/minimax-h3-teacache.ts, packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
  Evidence: In packages/application/src/experiments/minimax-h3-experiment-service.ts:2103, adapterDigest is computed as `sha256Hex(canonicalizeJson(TEACACHE_SOURCE_FILE_HASHES))`, where TEACACHE_SOURCE_FILE_HASHES (packages/contracts/src/minimax-h3-teacache.ts:22-28) contains hardcoded upstream file hashes rather than hashing the local adapted files in experiments/minimax-h3-teacache/. At line 1971, compatibility.relativeToRuntimeManifestDigest is set to baseRuntimeManifestDigest while requiredRuntime at line 2028 is set to teaCacheRequiredRuntime (which appends CCOMiniMaxH3TeaCache to requiredNodes). Meanwhile, packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts (lines 237-247, 821-838) has no source mapping or adapter support for CCOMiniMaxH3TeaCache.
  Required Fix: Compute and verify local adapter file hashes from experiments/minimax-h3-teacache/ on disk during prepareExperiment and validateExperiment (keeping upstream source-manifest hashes distinct from the local adapter digest), bind compatibility.relativeToRuntimeManifestDigest to the actual teaCacheRequiredRuntime digest, and teach the runtime registry / preflight verifier to verify staged CCOMiniMaxH3TeaCache files against the pinned adapter digest.
  Source: quality-review (iteration 0)

- **[F-08a9a66e] [HIGH]** A null `before` or `after` in a schema-valid `caching.configuration` factor change crashes compareMinimaxH3Experiments with an unhandled TypeError. Auto-injecting `caching.configuration` into `declaredPaths` masks undeclared topology digest differences in `computeInvariantProjectionKey`. Admitting uninstrumented baselines and unchecked effectiveConfig/modelForwardsRecorded allows invalid pairs to produce speedup ratios.
  Files: packages/application/src/experiments/minimax-h3-comparator.ts
  Evidence: In packages/application/src/experiments/minimax-h3-comparator.ts:825-840, `beforeObj` and `afterObj` are cast from `factor.before` and `factor.after` (which FactorChangeCachingConfigSchema allows to be null) and dereferenced via `beforeObj.mode !== baseMode || afterObj.mode !== varMode` without null checks. At lines 344-352, compareMinimaxH3Experiments auto-pushes "caching.configuration" into declaredPaths even when variantDescV2.experimentVariant.changedFactors omitted it. At lines 253-266, evaluateTeaCacheObservationEligibility returns valid: true for baseline mode "off" when observation is undefined/null, and for variant mode "raw-l1-v1" never verifies obs.effectiveConfig against variantDescV2.teacacheRequest or obs.coverage.modelForwardsRecorded === obs.forwardCallsRecorded.
  Required Fix: Guard against null `factor.before` / `factor.after` and validate all caching factor fields (mode, relL1Thresh, startStep, endStep, totalSteps, topologyDigest, adapterVersion) against baseline and variant descriptors; require `caching.configuration` to be explicitly declared in `changedFactors` rather than auto-injecting it; and require verified baseline control observations and matching `effectiveConfig` / `modelForwardsRecorded` in `evaluateTeaCacheObservationEligibility`.
  Source: quality-review (iteration 0)

- **[F-ce2b3eba] [HIGH]** The core Python caching implementation has zero test coverage, allowing broken session lifecycle and parameter validation bugs to go undetected, while the TypeScript reconciliation test asserts a contradictory partial state on a failed run.
  Files: packages/application/src/experiments/minimax-h3-experiment.test.ts
  Evidence: There are no unit or subprocess tests exercising experiments/minimax-h3-teacache/teacache.py or experiments/minimax-h3-teacache/nodes.py. Additionally, in packages/application/src/experiments/minimax-h3-experiment.test.ts:5034-5162 ("reconciles TeaCache phase events into teacacheObservation in result.json"), the test emits point_event records without any sampling span_start/span_end, causing reconciled.execution.status to fail with "teacache_incomplete_coverage" and coverage.complete to be false, while the test only asserts `expect(reconciled.teacacheObservation?.status).toBe("verified")`.
  Required Fix: Add deterministic Python subprocess unit tests covering TeaCacheSession and CCOMiniMaxH3TeaCacheNode (session lifecycle, model ownership, step window bounds, tensor clone isolation, multi-branch/reentrancy rejection, and cleanup on error), and fix the reconciliation test in minimax-h3-experiment.test.ts to include complete sampling spans and assert execution status and coverage completeness.
  Source: quality-review (iteration 0)

- **[F-263916a8] [MEDIUM]** An operator following the runbook cannot execute any step because the script name, subcommands, and CLI flags do not exist in `apps/render-worker/src/cli/experiment-minimax-h3.ts`, and the checkpoint note contradicts the enforced contract.
  Files: docs/minimax-h3-teacache-experiments.md
  Evidence: In docs/minimax-h3-teacache-experiments.md:206-279, every CLI command uses `pnpm cco:experiment:minimax-h3` (actual script in package.json is `pnpm experiment:minimax-h3`), `prepare` uses `--out-dir` and omits mandatory `--inputs`, `--prompt`, `--target-host`, `--gpu-uuid`, `--comfyui-dir`, `--python`, and `--run-id`, `validate` uses `--descriptor` instead of `--run-dir`, Step 6 invokes a non-existent `execute --descriptor` subcommand instead of `run --run-dir ... --stop-policy ...`, and `compare` uses `--candidate` and `--out-dir` instead of `--variant-run-dir` and `--output`. Line 51 also states I2V uses `minimax_h3_fl2va_pruned_int8_convrot.safetensors`, whereas canonical I2V and TeaCache require `minimax_h3_ref2va_pruned_int8_convrot.safetensors`.
  Required Fix: Update `docs/minimax-h3-teacache-experiments.md` to use the actual `pnpm experiment:minimax-h3` script, valid subcommands (`prepare`, `validate`, `run`, `reconcile`, `compare`, `import-sidecar`, `cleanup`), and exact required CLI flags, and align the canonical checkpoint description with the pinned `ref2va` checkpoint.
  Source: quality-review (iteration 0)

- **[F-69cbb935] [HIGH]** The newly added collector lifecycle does not bind the state consulted by a normally package-loaded ComfyUI node; inference still fails with missing session. Repository path fallback does not repair module identity.
  Files: packages/infrastructure/src/experiments/minimax-h3-collector.py, experiments/minimax-h3-teacache/__init__.py, experiments/minimax-h3-teacache/nodes.py
  Evidence: Collector resolver at minimax-h3-collector.py:641-665 imports top-level teacache; the custom-node package imports its relative teacache at __init__.py:8 and nodes.py:9. Those are distinct Python modules with distinct ContextVars. A read-only importlib probe loading the package and then binding the top-level session printed Package session sees collector binding: False. Runbook staging at docs/minimax-h3-teacache-experiments.md:211-215 supplies a package under custom_nodes, which the resolver does not locate.
  Required Fix: Resolve the exact already-loaded adapter module through the registered node/wrapper identity and bind its session API; require matching loaded hashes. Test package-style loading through the real collector hook, without top-level import shortcuts.
  Source: spec-review (iteration 4)

### PREVIOUSLY RESOLVED FINDINGS (REGRESSION CHECKLIST):
- **[F-8b4981a9] [RESOLVED in iter 7]** Experimental cells can use unreviewed thresholds or silently different/truncated controls, and disabled requests can conceal stray configuration. This contradicts the explicit parameter and conservative grid policy.
  Resolution Evidence: CLI experiment-minimax-h3.ts:741-840 and service.ts:947-1008 retain explicit candidate controls, stray-knob and conflicting-mode rejection. contracts/minimax-h3-teacache.ts:330-339 checks exact grid membership. CLI 64 tests and TeaCache contracts 15 tests pass.
  Source: spec-review

- **[F-f4a3cea3] [RESOLVED in iter 7]** An explicitly supported CLI configuration cannot prepare the requested TeaCache experiment; it either fails unrelated attention evidence or silently prepares dense attention without caching. This is an optimized-path no-op at preparation, not the required reported runtime no_op.
  Resolution Evidence: service.ts:1145-1203 derives candidate/control before the attention derivation branch, :2171-2207 records teacacheRequest, and :2773-2882 selects TeaCache topology validation. Both actual canonical route preparation/validation tests pass in the 73-test service suite.
  Source: spec-review

- **[F-fbeb2241] [RESOLVED in iter 7]** Passing `--teacache raw-l1-v1 --attention-variant dense` passes CLI/service guards but silently skips the `else if (isTeaCache)` branch, producing an unpatched dense graph with no teacacheRequest. Conversely, passing `--teacache off --teacache-threshold 0.1` or `--teacache raw-l1-v1 --teacache-matched-control` is silently accepted, and arbitrary thresholds outside the [0.05, 0.10, 0.15] candidate grid are admitted.
  Resolution Evidence: service.ts:1145-1203 orders TeaCache before explicit attention; CLI.ts:741-840 and service.ts:947-1008 reject mixed modes, stray knobs and missing explicit controls. contracts/minimax-h3-teacache.ts:330-339 preserves exact grid membership. CLI and canonical preparation tests pass.
  Source: quality-review

- **[F-8f500f24] [RESOLVED in iter 7]** Tampered graphs containing LoRA loaders, sigma shifts, extra TeaCache or sparse attention patches at non-301/302/303 node IDs, altered scheduler steps/denoise, broken conditioning links, or model cycles pass validateTeaCacheTopology.
  Resolution Evidence: minimax-h3-teacache-topology.ts:149-198 scans forbidden patches/samplers, :209-317 enforces canonical graph edges/model/schedule, and :422-440 checks model cycles. service.ts:2834-2868 reconstructs the TeaCache graph and :2970-2977 compares the full graph. All 11 topology tests and 73 service tests pass.
  Source: quality-review

- **[F-aa1074e5] [RESOLVED in iter 7]** Every documented candidate using --teacache-end-step -2 is rejected during reconciliation even if sampling otherwise succeeds; fixtures bypass the actual event producer. Per-step attribution is also lost and hidden by summary-only admission.
  Resolution Evidence: teacache.py:57 retains raw_end_step; collector.py:1791-1794 and :1925-1928 emit raw and normalized windows, and teacache.py:200-220 emits stepIndex. reducer.ts:155-160 reads step attribution and :260-268 accepts the equivalent end window. Canonical service reconciliation test passes with endStep=-2.
  Source: spec-review

- **[F-cf1f3d81] [RESOLVED in iter 7]** Once the new collector session is bound, the first real forward still cannot receive the actual H3 conditioning payload. This prevents a valid inference path or silently drops conditioning with a permissive model API. Non-runnable catalog status does not implement the required offline H3 adapter contract.
  Resolution Evidence: teacache.py:225-229 unpacks c into apply_model(input, timestep, **c), and nodes.py:88-105 delegates to that path. collector.py:641-659 and :1769-1780 use the wrapper-associated session module. The strict H3 envelope test at minimax-h3-teacache.unit.test.ts:603-684 passes.
  Source: spec-review

- **[F-a60aaa48] [RESOLVED in iter 7]** The strengthened equality gate makes the authentic matched control internally unsatisfiable even after runtime admission. A legitimate operator pair cannot reconcile and produce comparison metrics. Additionally each diffusion-forward span is counted as another sampler invocation by reducer.ts:75-85.
  Resolution Evidence: collector.py:1715-1745 emits independently completed model spans parented to the sampler; :1950-1968 emits the disabled control forward summary. reducer.ts:75-87 excludes nested model spans from sampler count and :200-204 consumes the control forward summary while :208-221 independently counts completions; :316-324 and :359-360 require both control counts to equal 20. Result-schema equality at minimax-h3-experiment-v2.ts:2436-2446 and comparator.ts:284-302 are now consistent with that producer.
  Source: spec-review

```

Deterministic validation evidence:

```
Validation result: passed (fingerprint: 90a0e45770d3)
```



Complete branch diff against base:

```diff
diff --git a/apps/render-worker/src/cli/experiment-minimax-h3.test.ts b/apps/render-worker/src/cli/experiment-minimax-h3.test.ts
index 424354b..f292b0c 100644
--- a/apps/render-worker/src/cli/experiment-minimax-h3.test.ts
+++ b/apps/render-worker/src/cli/experiment-minimax-h3.test.ts
@@ -39,6 +39,7 @@ import {
   type MinimaxH3ExperimentResult,
   type MinimaxH3TelemetrySample,
   type MinimaxH3AnyExperimentDescriptor,
+  type MinimaxH3ExperimentDescriptorV2,
   type MinimaxH3AnyExperimentResult,
   type MinimaxH3ContinuityReviewSidecar,
   type ContinuityScenario
@@ -57,7 +58,7 @@ const mockI2vTemplate = {
   },
   "9": {
     class_type: "BasicScheduler",
-    inputs: { model: ["6", 0], scheduler: "simple", steps: 20 }
+    inputs: { model: ["6", 0], scheduler: "simple", steps: 20, denoise: 1 }
   },
   "14": {
     class_type: "SamplerCustomAdvanced",
@@ -2711,6 +2712,302 @@ describe("experiment:minimax-h3 CLI", () => {
       if (prepExit !== 0) {
         expect(stderr).toEqual([]);
       }
+      if (prepExit !== 0) {
+        console.error("DEBUG STDERR:", stderr);
+      }
+      expect(prepExit).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(parsed.status).toBe("prepared");
+
+      const valExit = await runExperimentCli(
+        [
+          "validate",
+          "--run-dir",
+          parsed.runDir,
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments"
+        ],
+        deps
+      );
+      expect(valExit).toBe(0);
+      const valOutput = JSON.parse(stdout[1]!);
+      expect(valOutput.status).toBe("valid");
+      expect(valOutput.graphValid).toBe(true);
+    });
+  });
+
+  describe("TeaCache CLI Flags", () => {
+    it("lists all TeaCache catalog entries with catalog --teacache", async () => {
+      const { deps, stdout } = createMockDeps();
+      const exitCode = await runExperimentCli(["catalog", "--teacache"], deps);
+      expect(exitCode).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(Array.isArray(parsed)).toBe(true);
+      expect(parsed.length).toBeGreaterThanOrEqual(4);
+      const scopes = parsed.map((e: { scope: string }) => e.scope);
+      expect(scopes).toContain("teacache-raw-l1-i2v");
+      expect(scopes).toContain("teacache-raw-l1-ref2v");
+      expect(scopes).toContain("teacache-matched-control-i2v");
+      expect(scopes).toContain("teacache-matched-control-ref2v");
+    });
+
+    it("filters TeaCache entries with catalog --type teacache --route i2v", async () => {
+      const { deps, stdout } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        ["catalog", "--type", "teacache", "--route", "i2v"],
+        deps
+      );
+      expect(exitCode).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(Array.isArray(parsed)).toBe(true);
+      expect(parsed.length).toBe(2);
+      expect(parsed.every((e: { route: string }) => e.route === "i2v")).toBe(true);
+    });
+
+    it("filters TeaCache entries by variant with catalog --teacache --route ref2v --teacache-variant raw-l1-v1", async () => {
+      const { deps, stdout } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        ["catalog", "--teacache", "--route", "ref2v", "--teacache-variant", "raw-l1-v1"],
+        deps
+      );
+      expect(exitCode).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(Array.isArray(parsed)).toBe(true);
+      expect(parsed.length).toBe(1);
+      expect(parsed[0].scope).toBe("teacache-raw-l1-ref2v");
+      expect(parsed[0].variantName).toBe("teacache-raw-l1");
+    });
+
+    it("rejects invalid --teacache mode", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-bad-teacache-mode",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "turbo"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("--teacache must be 'off' or 'raw-l1-v1'");
+    });
+
+    it("rejects combining --teacache with distillation --sampling-recipe", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-distill",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--sampling-recipe",
+          "fl2va-turbo-8"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("Cannot combine TeaCache with distillation --sampling-recipe");
+    });
+
+    it("rejects combining --teacache with --checkpoint-override", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-cp",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--checkpoint-override",
+          "fl2va"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("Cannot combine TeaCache with --checkpoint-override");
+    });
+
+    it("rejects combining --teacache with non-dense attention variant", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-attn",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--attention-variant",
+          "sage"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        'TeaCache currently requires dense attention, got --attention-variant "sage"'
+      );
+    });
+
+    it("rejects combining --teacache with non-20 step override", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-steps",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--step-override",
+          "15"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("TeaCache currently requires 20 steps, got --step-override 15");
+    });
+
+    it("prepares and validates experiment with --teacache raw-l1-v1 and custom threshold", async () => {
+      const { deps, stdout, store } = createMockDeps();
+      const prepExit = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-teacache-010",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10",
+          "--teacache-start-step",
+          "2",
+          "--teacache-end-step",
+          "-2",
+          "--teacache-total-steps",
+          "20"
+        ],
+        deps
+      );
       expect(prepExit).toBe(0);
       const parsed = JSON.parse(stdout[0]!);
       expect(parsed.status).toBe("prepared");
@@ -2729,6 +3026,269 @@ describe("experiment:minimax-h3 CLI", () => {
       const valOutput = JSON.parse(stdout[1]!);
       expect(valOutput.status).toBe("valid");
       expect(valOutput.graphValid).toBe(true);
+
+      // Verify the stored descriptor has teacacheRequest configured
+      const desc = store.descriptor as MinimaxH3ExperimentDescriptorV2;
+      expect(desc.teacacheRequest).toBeDefined();
+      expect(desc.teacacheRequest?.mode).toBe("raw-l1-v1");
+      expect(desc.teacacheRequest?.relL1Thresh).toBe(0.1);
+      expect(desc.experimentVariant.changedFactors).toContainEqual(
+        expect.objectContaining({
+          path: "caching.configuration"
+        })
+      );
+    });
+
+    it("prepares and validates matched control experiment with --teacache-matched-control", async () => {
+      const { deps, stdout, store } = createMockDeps();
+      const prepExit = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-teacache-matched-ctl",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache-matched-control"
+        ],
+        deps
+      );
+      expect(prepExit).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(parsed.status).toBe("prepared");
+
+      const valExit = await runExperimentCli(
+        [
+          "validate",
+          "--run-dir",
+          parsed.runDir,
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments"
+        ],
+        deps
+      );
+      expect(valExit).toBe(0);
+      const valOutput = JSON.parse(stdout[1]!);
+      expect(valOutput.status).toBe("valid");
+      expect(valOutput.graphValid).toBe(true);
+
+      const desc = store.descriptor as MinimaxH3ExperimentDescriptorV2;
+      expect(desc.teacacheRequest).toBeDefined();
+      expect(desc.teacacheRequest?.mode).toBe("off");
+      expect(desc.teacacheRequest?.patchNode).toBeNull();
+      expect(desc.experimentVariant.changedFactors).toEqual([]);
+    });
+
+    it("rejects combining --teacache with --teacache-matched-control", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-both",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-matched-control"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        "Cannot combine --teacache raw-l1-v1 with --teacache-matched-control"
+      );
+    });
+
+    it("rejects stray knobs when --teacache is not raw-l1-v1", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-stray-knobs",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache-threshold",
+          "0.10"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        "TeaCache parameter knobs (--teacache-threshold, --teacache-start-step, --teacache-end-step, --teacache-total-steps) can only be specified when --teacache is active (raw-l1-v1)"
+      );
+    });
+
+    it("rejects active TeaCache candidate when missing required knobs", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-missing-knobs",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        "Active TeaCache candidate run requires explicit knobs: --teacache-threshold, --teacache-start-step, --teacache-end-step, and --teacache-total-steps must all be specified"
+      );
+    });
+
+    it("rejects invalid float for --teacache-threshold", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-invalid-float",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10abc"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("--teacache-threshold must be a valid finite number");
+    });
+
+    it("rejects invalid integer for --teacache-start-step", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-invalid-int",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10",
+          "--teacache-start-step",
+          "2.5"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("--teacache-start-step must be an integer");
     });
   });
 });
diff --git a/apps/render-worker/src/cli/experiment-minimax-h3.ts b/apps/render-worker/src/cli/experiment-minimax-h3.ts
index 6997d8a..a584792 100644
--- a/apps/render-worker/src/cli/experiment-minimax-h3.ts
+++ b/apps/render-worker/src/cli/experiment-minimax-h3.ts
@@ -6,6 +6,7 @@ import {
   MinimaxH3ExperimentService,
   compareMinimaxH3Experiments,
   listAttentionCatalogEntries,
+  listTeaCacheCatalogEntries,
   listSamplingRecipes,
   validateRecipeRouteCompatibility,
   expandContinuityStudyPlan,
@@ -47,6 +48,7 @@ import {
   type MinimaxH3ExperimentResultV2,
   type MinimaxH3ProcessRecord,
   type MinimaxH3AttentionVariantName,
+  type MinimaxH3TeaCacheVariantName,
   type MinimaxH3ContinuityStudySpec,
   type MinimaxH3ContinuityReviewSidecar
 } from "@cco/contracts";
@@ -160,6 +162,12 @@ Options for 'prepare':
   --attention-variant <variant>  Attention variant ('dense' | 'sage' | 'native-sol-attn' | 'veda')
   --matched-variant <variant>    Matched dense control target variant ('sage' | 'native-sol-attn' | 'veda')
   --comfyui-core-revision <rev>  Override ComfyUI core revision for catalog lookup (e.g. for upgraded dense control)
+  --teacache <off|raw-l1-v1>     TeaCache timestep caching mode (default: off)
+  --teacache-threshold <float>   TeaCache relative L1 threshold (e.g. 0.05, 0.1, 0.15)
+  --teacache-start-step <int>    TeaCache caching start step (e.g. 2)
+  --teacache-end-step <int>      TeaCache caching end step (e.g. -2 or 18)
+  --teacache-total-steps <int>   TeaCache total scheduler steps (must be 20)
+  --teacache-matched-control     Prepare matched unpatched control run for TeaCache comparison
 
 Options for 'validate':
   --run-dir <path>               Prepared run directory path (required)
@@ -194,8 +202,11 @@ Options for 'import-sidecar':
   --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
 
 Options for 'catalog':
+  --type <attention|recipes|teacache> Catalog type to inspect (default: attention)
   --route <i2v|ref2v>            Filter catalog entries by route (optional)
   --attention-variant <variant>  Filter catalog entries by attention variant (optional)
+  --teacache                     List TeaCache catalog entries
+  --teacache-variant <name>      Filter TeaCache catalog entries by variant name ('teacache-raw-l1' | 'matched-control')
 `);
 }
 
@@ -206,6 +217,14 @@ function parseStrictInt(str?: string): number | null {
   return Number.isSafeInteger(num) ? num : null;
 }
 
+function parseStrictFloat(str?: string): number | null {
+  if (!str) return null;
+  const trimmed = str.trim();
+  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
+  const num = Number(trimmed);
+  return Number.isFinite(num) ? num : null;
+}
+
 export function parseArgs(rawArgs: readonly string[]): {
   subcommand: string;
   flags: Record<string, string>;
@@ -260,7 +279,7 @@ export function parseArgs(rawArgs: readonly string[]): {
         flags[k] = v;
       } else {
         const next = rawArgs[i + 1];
-        if (next && !next.startsWith("-")) {
+        if (next && (!next.startsWith("-") || /^-\d+(\.\d+)?$/.test(next))) {
           if (seenFlags.has(body)) {
             duplicateFlags.push(body);
           }
@@ -318,7 +337,13 @@ const ALLOWED_FLAGS_BY_SUBCOMMAND: Record<string, Set<string>> = {
     "attention-variant",
     "matched-variant",
     "comfyui-core-revision",
-    "core-revision"
+    "core-revision",
+    "teacache",
+    "teacache-threshold",
+    "teacache-start-step",
+    "teacache-end-step",
+    "teacache-total-steps",
+    "teacache-matched-control"
   ]),
   validate: new Set(["run-dir", "output-root", "templates-dir"]),
   run: new Set(["run-dir", "output-root", "stop-policy", "baseline-run-dir", "templates-dir"]),
@@ -343,7 +368,9 @@ const ALLOWED_FLAGS_BY_SUBCOMMAND: Record<string, Set<string>> = {
     "comfyui-core-revision",
     "core-revision",
     "recipes",
-    "type"
+    "type",
+    "teacache",
+    "teacache-variant"
   ]),
   "plan-study": new Set(["study", "file", "output", "output-root", "json"]),
   "prepare-study": new Set([
@@ -400,6 +427,12 @@ const VALUE_FLAGS = new Set([
   "matched-variant",
   "comfyui-core-revision",
   "core-revision",
+  "teacache",
+  "teacache-threshold",
+  "teacache-start-step",
+  "teacache-end-step",
+  "teacache-total-steps",
+  "teacache-variant",
   "run-dir",
   "stop-policy",
   "baseline-run-dir",
@@ -459,6 +492,9 @@ export async function runExperimentCli(
   }
 
   for (const key of booleanFlags) {
+    if (subcommand === "catalog" && (key === "teacache" || key === "recipes")) {
+      continue;
+    }
     if (VALUE_FLAGS.has(key)) {
       stderr(`Error: Flag "--${key}" requires a value.`);
       return 1;
@@ -691,6 +727,118 @@ export async function runExperimentCli(
           samplingRecipe = sr as MinimaxH3SamplingRecipeName;
         }
 
+        let teacache: "off" | "raw-l1-v1" | undefined;
+        if (flags["teacache"] !== undefined) {
+          const tc = flags["teacache"].toLowerCase();
+          if (tc !== "off" && tc !== "raw-l1-v1") {
+            stderr("Error: --teacache must be 'off' or 'raw-l1-v1'.");
+            return 1;
+          }
+          teacache = tc as "off" | "raw-l1-v1";
+        }
+
+        const teacacheMatchedControl = booleanFlags.has("teacache-matched-control");
+
+        if (teacache === "raw-l1-v1" && teacacheMatchedControl) {
+          stderr(
+            "Error: Cannot combine --teacache raw-l1-v1 with --teacache-matched-control; select either candidate or matched control."
+          );
+          return 1;
+        }
+
+        let teacacheThreshold: number | undefined;
+        if (flags["teacache-threshold"] !== undefined) {
+          const parsed = parseStrictFloat(flags["teacache-threshold"]);
+          if (parsed === null) {
+            stderr(
+              "Error: --teacache-threshold must be a valid finite number (e.g. 0.05, 0.1, 0.15)."
+            );
+            return 1;
+          }
+          teacacheThreshold = parsed;
+        }
+
+        let teacacheStartStep: number | undefined;
+        if (flags["teacache-start-step"] !== undefined) {
+          const parsed = parseStrictInt(flags["teacache-start-step"]);
+          if (parsed === null) {
+            stderr("Error: --teacache-start-step must be an integer.");
+            return 1;
+          }
+          teacacheStartStep = parsed;
+        }
+
+        let teacacheEndStep: number | undefined;
+        if (flags["teacache-end-step"] !== undefined) {
+          const parsed = parseStrictInt(flags["teacache-end-step"]);
+          if (parsed === null) {
+            stderr("Error: --teacache-end-step must be an integer.");
+            return 1;
+          }
+          teacacheEndStep = parsed;
+        }
+
+        let teacacheTotalSteps: number | undefined;
+        if (flags["teacache-total-steps"] !== undefined) {
+          const parsed = parseStrictInt(flags["teacache-total-steps"]);
+          if (parsed === null) {
+            stderr("Error: --teacache-total-steps must be an integer.");
+            return 1;
+          }
+          teacacheTotalSteps = parsed;
+        }
+
+        const isTeaCacheActive = teacache === "raw-l1-v1" || teacacheMatchedControl;
+        if (isTeaCacheActive) {
+          if (samplingRecipe !== undefined) {
+            stderr("Error: Cannot combine TeaCache with distillation --sampling-recipe.");
+            return 1;
+          }
+          if (checkpointOverride !== undefined) {
+            stderr("Error: Cannot combine TeaCache with --checkpoint-override.");
+            return 1;
+          }
+          if (attentionVariant !== undefined && attentionVariant !== "dense") {
+            stderr(
+              `Error: TeaCache currently requires dense attention, got --attention-variant "${attentionVariant}".`
+            );
+            return 1;
+          }
+          if (stepOverride !== undefined && stepOverride !== 20) {
+            stderr(
+              `Error: TeaCache currently requires 20 steps, got --step-override ${stepOverride}.`
+            );
+            return 1;
+          }
+        }
+
+        const hasKnobs =
+          teacacheThreshold !== undefined ||
+          teacacheStartStep !== undefined ||
+          teacacheEndStep !== undefined ||
+          teacacheTotalSteps !== undefined;
+
+        if (teacache !== "raw-l1-v1" && hasKnobs) {
+          stderr(
+            "Error: TeaCache parameter knobs (--teacache-threshold, --teacache-start-step, --teacache-end-step, --teacache-total-steps) can only be specified when --teacache is active (raw-l1-v1)."
+          );
+          return 1;
+        }
+
+        if (teacache === "raw-l1-v1") {
+          if (
+            teacacheThreshold === undefined ||
+            teacacheStartStep === undefined ||
+            teacacheEndStep === undefined ||
+            teacacheTotalSteps === undefined
+          ) {
+            stderr(
+              "Error: Active TeaCache candidate run requires explicit knobs: --teacache-threshold, --teacache-start-step, --teacache-end-step, and --teacache-total-steps must all be specified."
+            );
+            return 1;
+          }
+        }
+
         const coreRevision = flags["comfyui-core-revision"] ?? flags["core-revision"];
 
         const resolvedTemplatesDir = resolveCliPath(flags["templates-dir"]);
@@ -722,7 +870,13 @@ export async function runExperimentCli(
           ...(attentionVariant !== undefined ? { attentionVariant } : {}),
           ...(matchedVariant !== undefined ? { matchedVariant } : {}),
           ...(coreRevision !== undefined ? { coreRevision } : {}),
-          ...(samplingRecipe !== undefined ? { samplingRecipe } : {})
+          ...(samplingRecipe !== undefined ? { samplingRecipe } : {}),
+          ...(teacache !== undefined ? { teacache } : {}),
+          ...(teacacheThreshold !== undefined ? { teacacheThreshold } : {}),
+          ...(teacacheStartStep !== undefined ? { teacacheStartStep } : {}),
+          ...(teacacheEndStep !== undefined ? { teacacheEndStep } : {}),
+          ...(teacacheTotalSteps !== undefined ? { teacacheTotalSteps } : {}),
+          ...(teacacheMatchedControl ? { teacacheMatchedControl: true } : {})
         });
 
         stdout(
@@ -1575,6 +1729,28 @@ export async function runExperimentCli(
           return 0;
         }
 
+        if (
+          booleanFlags.has("teacache") ||
+          flags["type"] === "teacache" ||
+          flags["teacache"] !== undefined
+        ) {
+          const rawVariant = flags["teacache-variant"] ?? flags["teacache"] ?? flags["variant"];
+          const normalizedVariant: MinimaxH3TeaCacheVariantName | undefined =
+            rawVariant === "raw-l1-v1" || rawVariant === "teacache-raw-l1"
+              ? "teacache-raw-l1"
+              : rawVariant === "matched-control"
+                ? "matched-control"
+                : rawVariant === "off"
+                  ? "off"
+                  : undefined;
+          const entries = listTeaCacheCatalogEntries({
+            ...(routeFilter !== undefined ? { route: routeFilter } : {}),
+            ...(normalizedVariant !== undefined ? { variantName: normalizedVariant } : {})
+          });
+          stdout(JSON.stringify(entries, null, 2));
+          return 0;
+        }
+
         const variantFilter = (flags["attention-variant"] ?? flags["variant"]) as
           MinimaxH3AttentionVariantName | undefined;
 
diff --git a/docs/minimax-h3-teacache-experiments.md b/docs/minimax-h3-teacache-experiments.md
new file mode 100644
index 0000000..db1a7fb
--- /dev/null
+++ b/docs/minimax-h3-teacache-experiments.md
@@ -0,0 +1,453 @@
+# MiniMax-H3 TeaCache Timestep-Caching Experiments Specification & Operator Runbook
+
+## 1. Purpose, Executive Summary & Non-Production Governance Boundary
+
+This document defines the research, provenance, graph compilation, observation reduction, and candidate evaluation framework for isolated **MiniMax-H3 TeaCache timestep-caching experiments** (Issue #467, child of #421).
+
+### Executive Summary
+TeaCache is a training-free inference acceleration approach that computes the relative L1 change of model input embeddings across consecutive sampling timesteps. When the relative difference falls below a calibrated threshold ($\tau$), the model forward pass is skipped and the previous timestep's output velocity/noise prediction is reused. Upstream reports approximately a 3x speedup on a high-VRAM workstation (64GB CMP 170HX) at 1024x576, 124 frames, 20 steps. However, our production target is a 24GB NVIDIA GeForce RTX 4090 operating under dynamic layer offloading at 1344x768 resolution. This specification provides the hardened, strictly isolated engineering framework to evaluate whether TeaCache can reduce sampling latency without unacceptable regressions in visual continuity, subject identity, motion smoothness, or reference adherence.
+
+### Strict Governance Boundary Rules
+- **Non-Production Isolation:** This research family is strictly optional, experimental, and disabled by default. It must never alter production render profiles (`MINIMAX_H3_720P_5S_I2V_V1`, `MINIMAX_H3_720P_5S_REF2V_V1`), default ComfyUI launch scripts, or production worker routing.
+- **Immutable Canonical Baselines:** Production workflow templates (`templates/minimax_h3_720p_i2v_124f_api.json`, `templates/minimax_h3_720p_ref2v_124f_api.json`), pinned model checkpoints, and the pinned ComfyUI core revision (`55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`) remain strictly immutable.
+- **Evidence Paths Never Agent-Authored:** Per repository rules in `AGENTS.md`, directories under `certification/`, `baseline/`, and `config/render-profiles/` contain physical hardware measurements. Automated coding agents must never author synthetic measurements or fabricate hardware speedup certifications.
+- **Operator Execution Only:** Physical execution on dedicated NVIDIA RTX 4090 hosts, hardware timing benchmarking, visual quality inspection, and promotion decisions belong exclusively to human operators and operator agents within Issue #445 (or downstream promotion tasks #424–#428).
+
+---
+
+## 2. Pinned Upstream Provenance & Audit Summary
+
+The upstream implementation has been audited, pinned, and adapted with fail-closed safety controls. Detailed audit findings and architectural mitigations are documented in `docs/minimax-h3-teacache-source-audit.md`.
+
+### Source Identification & Manifest
+- **Candidate Repository:** `https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache`
+- **Pinned Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
+- **Upstream License:** MIT License (Copyright (c) 2025 Icyoung)
+- **Source Manifest:** `experiments/minimax-h3-teacache/source-manifest.json`
+- **Substrate Environment:** CPython 3.12, PyTorch 2.5.1+cu124, CUDA 12.4 (`experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt`)
+
+### Upstream Limitations & Hardened In-Tree Architecture
+Upstream's implementation exhibits several vulnerabilities that make it unsuitable for unmitigated execution:
+1. **Module-Global State Leakage:** Upstream stored session state on the custom node instance across runs, causing cross-job contamination during batch processing, retries, or concurrent queues.
+   *Mitigation:* Replaced with Python `contextvars.ContextVar` binding session state strictly to the active task execution context, with defensive reset on lifecycle entry and termination.
+2. **In-Place Tensor Mutation:** Upstream cached tensor references without detaching or cloning, risking silent memory corruption across forward passes.
+   *Mitigation:* Enforced defensive `.detach().clone()` on all cached latent tensors and intermediate velocities.
+3. **Step Count Discrepancies:** Upstream silently allowed mismatches between the node's `total_steps` parameter and the actual scheduler step count.
+   *Mitigation:* Preflight parameter validation and runtime sigma matching require that `total_steps` matches `scheduler.steps` exactly (default 20); mismatches raise fail-closed exceptions.
+4. **Unverified Compute Skipping:** Upstream lacked instrumentation to verify that skipped forward passes actually bypassed heavy neural network execution.
+   *Mitigation:* Dedicated lifecycle hooks and telemetry reduction enforce that zero nested forward passes occur during cache hits; any nested forward pass causes immediate disqualification.
+5. **Node Key Isolation:** Hardened implementation exposes `CCOMiniMaxH3TeaCache` with backwards-compatible alias `MiniMaxH3TeaCache`, packaged in `experiments/minimax-h3-teacache/` and isolated from global ComfyUI directories.
+
+---
+
+## 3. Mutual Exclusivity & Single-Factor Controlled Rules
+
+To establish scientific validity and prevent confounding interactions, TeaCache experiments are governed by strict single-factor rules:
+
+### Mutual Exclusivity Gates
+1. **No Distillation Combinations:** TeaCache must NOT be combined with distilled checkpoints (e.g. `fastvideo_fasth3_8step_v2`) or Turbo/Lightning LoRAs (e.g. `minimax_h3_fl2v_turbo_8step_v1.0`, `minimax_h3_ref2v_turbo_4step_v0.1`). Distillation modifies the ODE trajectory and step dynamics, invalidating the standard relative L1 difference assumption.
+2. **No Accelerated Attention Combinations:** TeaCache must NOT be combined with non-standard attention backends (SageAttention, Veda, Native Sol-Attn) in initial evaluation. It strictly requires the canonical PyTorch SDPA dense backend.
+3. **Step Schedule Invariance:** TeaCache must operate on the canonical 20-step schedule (`res_multistep` or `simple`). Step reduction is achieved via timestep caching, not scheduler truncation.
+4. **Model Checkpoint Invariance:** Initial experiments require the canonical pinned INT8 ConvRot checkpoint (`minimax_h3_ref2va_pruned_int8_convrot.safetensors` across both I2V and Ref2V routes as defined in canonical production templates).
+
+### Matched Control Invariant Pair
+Every TeaCache candidate run (`raw-l1-v1`) must have an exact matched control baseline run (`off` / `matched-control`) executed under identical conditions:
+- **Identical Route:** `i2v` (`frame_anchored`) or `ref2v` (`reference_directed`).
+- **Identical Resolution & Cadence:** `1344x768` at 24 fps.
+- **Identical Frame Count:** 124 frames (5.167s) for initial screening.
+- **Identical Random Seed:** Same PRNG seed (e.g. `42`, `101`, `2024`).
+- **Identical Prompt & Conditioning:** Exact SHA-256 match of input images, audio tokens, and text prompts.
+- **Identical Substrate:** Same host hardware, CUDA driver, PyTorch version, and ComfyUI core revision.
+
+---
+
+## 4. Graph Topologies & Topological Rewiring
+
+The experiment service dynamically derives the experiment workflow graph from canonical templates without mutating on-disk templates.
+
+### Canonical Baseline Topology (Control / Off)
+In the canonical unpatched workflow, `UNETLoader` (node 6) connects directly to both `BasicGuider` (node 16) and `BasicScheduler` (node 9):
+
+```mermaid
+flowchart LR
+    UNET["Node 6: UNETLoader<br/>(minimax_h3_int8)"] -->|model| SCHED["Node 9: BasicScheduler<br/>(20 steps)"]
+    UNET -->|model| GUIDER["Node 16: BasicGuider"]
+    COND["Node 104 / 105: Conditioning<br/>(I2V or Ref2V)"] -->|conditioning| GUIDER
+    GUIDER -->|guider| SAMPLER["Node 14: SamplerCustomAdvanced"]
+    SCHED -->|sigmas| SAMPLER
+    SAMPLER -->|latent| DECODE["Node 10: VAEDecode"]
+```
+
+### TeaCache Patched Topology (`raw-l1-v1`)
+In the active TeaCache variant, patch node 401 (`CCOMiniMaxH3TeaCache`) intercepts the model connection from `UNETLoader` (node 6) and supplies the patched model to both `BasicGuider` (node 16) and `BasicScheduler` (node 9):
+
+```mermaid
+flowchart LR
+    UNET["Node 6: UNETLoader<br/>(minimax_h3_int8)"] -->|model| TC["Node 401: CCOMiniMaxH3TeaCache<br/>(threshold, window, steps)"]
+    TC -->|model| SCHED["Node 9: BasicScheduler<br/>(20 steps)"]
+    TC -->|model| GUIDER["Node 16: BasicGuider"]
+    COND["Node 104 / 105: Conditioning<br/>(I2V or Ref2V)"] -->|conditioning| GUIDER
+    GUIDER -->|guider| SAMPLER["Node 14: SamplerCustomAdvanced"]
+    SCHED -->|sigmas| SAMPLER
+    SAMPLER -->|latent| DECODE["Node 10: VAEDecode"]
+```
+
+### Topological Invariants
+1. Node 401 connects input `model` to `["6", 0]`.
+2. Node 16 connects input `model` to `["401", 0]`.
+3. Node 9 connects input `model` to `["401", 0]`.
+4. Conditioning connections (nodes 104/105) and VAE decode connections (nodes 10/12/13) remain completely untouched.
+5. In unpatched baseline runs, node 401 is omitted entirely; nodes 16 and 9 connect directly to `["6", 0]`.
+
+---
+
+## 5. Parameter Grid & Staged Evaluation Matrix
+
+Experimental evaluation follows a conservative, staged progression to avoid premature escalation and compute waste.
+
+### Candidate Parameter Grid
+| Parameter | Conservative Grid Value | Intermediate Grid Value | Upstream Default | Unit / Notes |
+| :--- | :--- | :--- | :--- | :--- |
+| `rel_l1_thresh` | `0.05` | `0.10` | `0.15` | Relative L1 threshold $\tau$ |
+| `start_step` | `2` | `2` | `2` | Initial burn-in steps (no caching) |
+| `end_step` | `-2` (step 18) | `-2` (step 18) | `-2` (step 18) | Final refinement steps (no caching) |
+| `total_steps` | `20` | `20` | `20` | Must equal scheduler total steps |
+
+*Note: Steps 0 and 1 establish coarse scene structure and must compute full forwards. Steps 18 and 19 resolve fine high-frequency details and must compute full forwards. Caching occurs strictly within steps [2, 17].*
+
+### Staged Progression Matrix
+```mermaid
+flowchart TD
+    S1["Stage 1: I2V 124f Screening<br/>(Thresholds: 0.05, 0.10, 0.15 across 3 seeds)"]
+    S1 -->|Review Metrics & Visuals| G1{"Stage 1 Gate<br/>Speedup > 1.25x &<br/>No Severe Artifacts?"}
+    G1 -->|Yes| S2["Stage 2: Ref2V 124f Validation<br/>(Multi-reference identity & wardrobe)"]
+    G1 -->|No| R1["Reject / Tune Threshold"]
+    S2 -->|Review Reference Adherence| G2{"Stage 2 Gate<br/>Identity Retained &<br/>Speedup Confirmed?"}
+    G2 -->|Yes| S3["Stage 3: Variable Duration Escalation<br/>(243f, 362f Extended Shots)"]
+    G2 -->|No| R2["Hold at I2V Only"]
+    S3 -->|Review Long-Shot Drift| G3{"Stage 3 Gate<br/>Temporal Stability &<br/>Memory Headroom?"}
+    G3 -->|Yes| P["Submit to Operator Promotion Review (#445)"]
+    G3 -->|No| H["Cap Duration at 124f"]
+```
+
+#### Stage 1: I2V 124-Frame Screening (5.167 seconds)
+- Focus: Core algorithm verification, hit rate measurement, and baseline artifact assessment.
+- Sweep `rel_l1_thresh` at `0.05`, `0.10`, and `0.15`.
+- Evaluate across at least 3 distinct seeds (e.g. `42`, `101`, `2024`) to detect seed sensitivity.
+
+#### Stage 2: Ref2V 124-Frame Validation (5.167 seconds)
+- Focus: Reference conditioning stability with multi-picture prompt tags.
+- Verify whether skipping forward passes impairs character identity retention or reference wardrobe binding.
+
+#### Stage 3: Variable Duration Escalation (Conditional)
+- Only if Stage 1 and Stage 2 show acceptable visual quality:
+  - **243 frames (~10.125s):** Test long-term motion and identity consistency.
+  - **362 frames (~15.083s):** Test extreme shot duration and GPU VRAM offload stability.
+
+---
+
+## 6. RTX 4090 Hardware Profile & Dynamic Offloading Dynamics
+
+Inference execution on 24GB RTX 4090 involves distinct hardware behaviors that contrast with upstream's high-VRAM workstation setup:
+
+1. **Layer Offloading vs Compute:**
+   MiniMax-H3's large INT8 DiT requires dynamic CPU offloading to fit in 24GB VRAM alongside the 32B multimodal text encoder and VAEs. During normal execution, weights stream across the PCIe bus for every model forward pass.
+2. **PCIe Savings from Timestep Skipping:**
+   When TeaCache hits and skips a forward pass, it avoids not only CUDA kernel execution but also the PCIe bus transmission of model layers for that step. This can provide meaningful latency reduction even with dynamic offload overhead.
+3. **Host RAM Buffers:**
+   Cached latent tensors must be pinned in system memory or GPU VRAM. Ensure system host RAM remains below the 64GB safety ceiling to prevent OS swap thrashing.
+4. **VRAM Safety Margin:**
+   Peak VRAM must remain under 23,500 MiB (giving a 500 MiB safety buffer before the 24,576 MiB hardware ceiling).
+
+---
+
+## 7. Fail-Closed Telemetry, Accounting & Fallback Detection
+
+The TeaCache experiment reducer (`minimax-h3-teacache-reducer.ts`) and comparator (`minimax-h3-comparator.ts`) enforce strict telemetry integrity:
+
+### Telemetry Invariant Checks
+1. **Cache Hit Accounting:**
+   - Every sampling step records whether it executed a full forward pass (`full`) or skipped execution via cache (`skip`).
+   - $\text{Total Steps} = \text{Forward Calls} + \text{Cache Hits}$.
+2. **Zero Nested Forward Passes:**
+   - During a cache hit, the underlying model must NOT execute any internal forward passes. Nested forward calls on cache hits must be strictly 0.
+   - Any nested forward pass indicates wrapper leak and causes immediate evaluation failure.
+3. **No-Op Detection:**
+   - If a candidate run yields 0 cache hits ($\text{hits} = 0$), status is classified as `no_op`.
+   - `no_op` runs are disqualified from claiming speedup metrics (`samplingWallEligible = false`, `metrics = null`).
+4. **Zero Fallback Tolerance:**
+   - Any runtime error or fallback to dense computation without caching is captured as an execution failure.
+5. **No Synthetic Metrics:**
+   - Timing ratios and speedup metrics are calculated strictly from measured wall time in milliseconds (`variant / baseline`).
+
+---
+
+## 8. Step-by-Step Operator Runbook
+
+This section details the exact CLI commands and operational workflow for operators executing TeaCache experiments on RTX 4090 render hosts.
+
+### Step 1: Environment Preparation, Isolated Checkout/Venv & Substrate Check
+Verify CUDA driver, isolated ComfyUI checkout at pinned core revision, isolated Python virtual environment, read-only model weight checksums, and hash-verified adapter staging:
+```bash
+# Set once, from inside your comfy-content-orchestrator checkout. Every
+# command below is written with an explicit path or explicit --cd so none
+# of them depend on your shell's current directory -- `cd` into the
+# isolated ComfyUI checkout happens exactly once, for the git checkout
+# step, and is immediately followed by `cd -` back.
+CCO_REPO_ROOT="$(pwd)"
+COMFYUI_ISOLATED_DIR=/opt/comfyui-isolated-teacache
+
+# Verify GPU visibility and driver
+nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
+
+# 1. Prepare dedicated isolated ComfyUI checkout (never mutate production or global /opt/comfyui)
+git clone https://github.com/Comfy-Org/ComfyUI.git "$COMFYUI_ISOLATED_DIR"
+(cd "$COMFYUI_ISOLATED_DIR" && git checkout 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc)
+"$CCO_REPO_ROOT/scripts/check-comfyui-version.sh"
+
+# 2. Setup isolated virtualenv and install pinned experiment requirements
+python3 -m venv "$COMFYUI_ISOLATED_DIR/.venv"
+source "$COMFYUI_ISOLATED_DIR/.venv/bin/activate"
+pip install -r "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt"
+python3 --version  # Must be 3.11.x or 3.12.x
+pip list | grep -E "torch|comfy"
+
+# 3. Verify MiniMax-H3 weights exist, are mounted read-only, and match pinned SHA-256
+"$CCO_REPO_ROOT/scripts/check-minimax-h3-version.sh"
+
+# 4. Stage hardened TeaCache custom node into isolated custom_nodes directory and verify file hashes
+mkdir -p "$COMFYUI_ISOLATED_DIR/custom_nodes/cco-minimax-h3-teacache"
+cp "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/__init__.py" \
+   "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/nodes.py" \
+   "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/teacache.py" \
+   "$COMFYUI_ISOLATED_DIR/custom_nodes/cco-minimax-h3-teacache/"
+
+# Verify staged file SHA-256 matches pinned in-tree adapter file hashes
+sha256sum "$COMFYUI_ISOLATED_DIR/custom_nodes/cco-minimax-h3-teacache/"*
+```
+
+### Step 2: Catalog Inspection
+Verify that TeaCache entries are recognized in the experiment catalog:
+```bash
+pnpm experiment:minimax-h3 catalog --teacache
+```
+Expected output: Catalog listing displaying `teacache-raw-l1-i2v`, `teacache-raw-l1-ref2v`, and matched controls.
+
+### Step 3: Prepare Matched Baseline Control Run
+Generate the unpatched baseline experiment descriptor using dedicated loopback port 8199 and isolated ComfyUI:
+```bash
+pnpm experiment:minimax-h3 prepare \
+  --route i2v \
+  --frames 124 \
+  --seed 42 \
+  --inputs manifest-i2v.json \
+  --prompt "A cinematic shot of a person smiling warmly, natural lighting" \
+  --target-host render-worker-01 \
+  --gpu-uuid GPU-12345678-1234-1234-1234-123456789abc \
+  --comfyui-dir /opt/comfyui-isolated-teacache \
+  --python /opt/comfyui-isolated-teacache/.venv/bin/python3 \
+  --port 8199 \
+  --run-id baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --teacache-matched-control
+```
+
+### Step 4: Prepare TeaCache Candidate Run
+Generate the patched TeaCache experiment descriptor with required explicit knobs:
+```bash
+pnpm experiment:minimax-h3 prepare \
+  --route i2v \
+  --frames 124 \
+  --seed 42 \
+  --inputs manifest-i2v.json \
+  --prompt "A cinematic shot of a person smiling warmly, natural lighting" \
+  --target-host render-worker-01 \
+  --gpu-uuid GPU-12345678-1234-1234-1234-123456789abc \
+  --comfyui-dir /opt/comfyui-isolated-teacache \
+  --python /opt/comfyui-isolated-teacache/.venv/bin/python3 \
+  --port 8199 \
+  --run-id candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --teacache raw-l1-v1 \
+  --teacache-threshold 0.10 \
+  --teacache-start-step 2 \
+  --teacache-end-step -2 \
+  --teacache-total-steps 20
+```
+
+### Step 5: Offline Semantic Validation
+Validate both descriptors against graph topology and runtime invariants:
+```bash
+# Validate baseline control
+pnpm experiment:minimax-h3 validate \
+  --run-dir .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+
+# Validate candidate variant
+pnpm experiment:minimax-h3 validate \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+```
+
+### Step 6: Physical Execution (Operator on RTX 4090)
+Execute both runs sequentially under clean system conditions (restarting background services if necessary to clear VRAM fragmentation).
+A stop-policy JSON file (e.g. `/opt/comfyui-isolated-teacache/operator-stop-policy.json`) is strictly required when executing `run`:
+
+```bash
+# Define operator-authored stop policy
+cat << 'EOF' > /opt/comfyui-isolated-teacache/operator-stop-policy.json
+{
+  "policyId": "rtx-4090-minimax-h3-default-stop-v1",
+  "maxPeakVramMb": 24000,
+  "maxHostRamMb": 60000,
+  "maxSwapUsedMb": 4096,
+  "maxSwapDeltaMb": 2048,
+  "maxExecutionDurationMs": 1200000,
+  "requireCompleteTelemetry": true,
+  "requireConformantProbe": true,
+  "visualStopConditions": [
+    "severe_flicker_or_tearing",
+    "subject_identity_collapse",
+    "extreme_motion_blur_or_distortion"
+  ]
+}
+EOF
+
+# Execute baseline control
+pnpm experiment:minimax-h3 run \
+  --run-dir .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json
+
+# Execute candidate variant
+pnpm experiment:minimax-h3 run \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json
+```
+
+### Step 7: Telemetry Reconciliation
+Reduce raw execution events into structured observation facts:
+```bash
+# Reconcile baseline
+pnpm experiment:minimax-h3 reconcile \
+  --run-dir .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+
+# Reconcile candidate
+pnpm experiment:minimax-h3 reconcile \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+```
+
+### Step 8: Comparative Evaluation
+Run the automated invariant and metric comparator:
+```bash
+pnpm experiment:minimax-h3 compare \
+  --baseline .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --variant .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+```
+
+### Step 9: Probed Video Asset Verification
+Verify output media container and streams via `ffprobe`:
+```bash
+ffprobe -v error -select_streams v:0 \
+  -show_entries stream=width,height,r_frame_rate,nb_frames,codec_name \
+  -of json .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/output.mp4
+
+# Verify audio stream presence and synchronization
+ffprobe -v error -select_streams a:0 \
+  -show_entries stream=codec_name,sample_rate,channels \
+  -of json .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/output.mp4
+```
+
+### Step 10: Operator Decision Sidecar Import
+Validate and import the human continuity and quality review sidecar:
+```bash
+# Validate sidecar schema and criteria
+pnpm experiment:minimax-h3 validate-sidecar \
+  --sidecar .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/operator-decision.json \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42
+
+# Import approved sidecar into result.json
+pnpm experiment:minimax-h3 import-sidecar \
+  --sidecar .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/operator-decision.json \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42
+```
+
+### Step 11: Workspace Cleanup & Evidence Retention
+Preserve all durable evidence while cleaning up owned child processes and ephemeral staging directories:
+```bash
+# 1. Retain all durable execution evidence (descriptors, results, events.jsonl, capability handshakes, output videos, sidecars):
+pnpm experiment:minimax-h3 cleanup \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42
+
+# Optional: To remove heavy raw output video while preserving result.json, events.jsonl, and logs:
+# pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 --remove-outputs
+
+# 2. Owned teardown: clean up isolated staged custom node files and deactivate isolated virtualenv
+rm -rf /opt/comfyui-isolated-teacache/custom_nodes/cco-minimax-h3-teacache
+deactivate
+```
+
+---
+
+## 9. Qualitative Visual Evaluation Rubric & Creative Regressions
+
+TeaCache introduces specific temporal approximation artifacts that cannot be assessed through loss functions alone. Operators must inspect full-motion video playback on calibrated monitors across seven evaluation dimensions:
+
+### 1. Subject Identity & Facial Coherence
+- **Check:** Does the subject's face maintain bone structure, eye shape, and skin tone across timesteps?
+- **Failure Mode:** Facial morphing, features drifting toward a generic average, or micro-expression freezing.
+
+### 2. Wardrobe & Fine Fabric Textures
+- **Check:** Are fabric weaves, garment seams, embroidery, and small accessories sharp and continuous?
+- **Failure Mode:** Texture smoothing, sudden blotchiness, or geometric flattening of intricate clothing patterns.
+
+### 3. Scene Background Continuity & Spatial Stability
+- **Check:** Do background architecture, trees, horizon lines, and furniture remain spatially locked?
+- **Failure Mode:** Background swimming, phantom objects appearing/disappearing, or scene replacement.
+
+### 4. Motion Smoothness & Trajectory Jerk
+- **Check:** Is character and camera motion continuous and natural throughout the 5+ second shot?
+- **Failure Mode:** Sudden acceleration/deceleration shudder when switching between cached and computed steps.
+
+### 5. Temporal Flicker & High-Frequency Shimmer
+- **Check:** Is there persistent luminance flicker or high-frequency pixel crawling across consecutive frames?
+- **Failure Mode:** Aliasing shimmer on sharp contrast edges and hair strands.
+
+### 6. Reference Adherence (Ref2V Route Only)
+- **Check:** Does the generated character match the reference image manifest in clothing, hairstyle, and lighting?
+- **Failure Mode:** Reference conditioning decoupling where the model ignores picture prompts during skipped steps.
+
+### 7. Audio / Video Synchronization & Playback Integrity
+- **Check:** Does speech or sound remain strictly in sync with on-screen character motion and visual events without temporal drift?
+- **Failure Mode:** Audio latency offset, popping, crackling, or dropped samples during skipped compute intervals.
+
+---
+
+## 10. Safe Abort Triggers & Formal GO/NO-GO Criteria
+
+### Safe Abort Triggers
+The operator must terminate execution immediately if any of the following triggers occur:
+1. **GPU Memory Overrun:** VRAM consumption exceeds 23,500 MiB or triggers a CUDA Out-Of-Memory (OOM) exception.
+2. **Host RAM Exhaustion:** System RAM exceeds 60,000 MiB or swap activity begins (`vmstat 1` swap-in > 0).
+3. **Nested Forward Calls:** Reconciled telemetry indicates `nestedForwardCallsRecorded > 0`.
+4. **Catastrophic Quality Collapse:** Severe visual tearing, black frames, or complete scene replacement.
+5. **No-Op Execution:** Cache hits recorded is 0 after completing the sampling loop.
+
+### Formal GO/NO-GO Gate Decision
+| Evaluation Criterion | Mandatory Requirement | Threshold for "GO" |
+| :--- | :--- | :--- |
+| **End-to-End Latency Speedup** | Sampling wall-time ratio variant/baseline $< 0.85$ | $\ge 15\%$ sampling wall time reduction ($\le 0.85\times$) |
+| **Cache Hit Efficiency** | Cache hits $\ge 3$ out of 20 steps ($\ge 15\%$) | $30\% - 50\%$ cache hits ($6-10$ steps skipped) |
+| **Resource Envelope** | Peak VRAM $\le 23,500\text{ MiB}$, Peak RAM $\le 60\text{ GiB}$ | Fully compliant with zero swap thrashing |
+| **Visual Quality Score** | No severe defects across identity, scene, motion | Rated "Pass" or "Acceptable Minor Drift" across all seeds |
+| **Reference Fidelity** | Ref2V conditioning retains character binding | 100% adherence to staged reference images |
+| **AV Sync & Audio Quality** | Audio in sync, zero audio pop/dropout | Verified full audio playback continuity |
+| **Legal & Licensing Sign-off** | MIT License compliance verified | Upstream copyright and MIT license attributed |
+| **Evidence Retention** | Complete run directory committed | Durable retention of `.ai-runs/`, events, and configs |
+
+- **GO Decision:** All mandatory requirements met across all 3 seeds at candidate threshold. Operator signs evaluation report and submits to #445 for integration consideration.
+- **NO-GO Decision:** Excessive visual artifacts, speedup below $15\%$, or stability failures. The candidate variant remains isolated in the research catalog and is NOT approved for profile promotion.
diff --git a/docs/minimax-h3-teacache-report-template.md b/docs/minimax-h3-teacache-report-template.md
new file mode 100644
index 0000000..a565880
--- /dev/null
+++ b/docs/minimax-h3-teacache-report-template.md
@@ -0,0 +1,162 @@
+# MiniMax-H3 TeaCache Timestep-Caching Candidate Evaluation Report Template
+
+> **OPERATOR INSTRUCTIONS:**
+> This template is a **blank** evaluation form and runbook for live physical execution on dedicated NVIDIA RTX 4090 GPU render hosts (Issue #445).
+> Per `AGENTS.md` and repository governance rules, automated agents must **never** author synthetic hardware measurements or pre-populate GO/NO-GO verdicts.
+> Complete each section only after executing both the baseline control and candidate TeaCache variant under identical physical conditions.
+> See the specification document [MiniMax-H3 TeaCache Timestep-Caching Experiments Specification](minimax-h3-teacache-experiments.md) for full catalog definitions, parameter bounds, and topological rules.
+> All CLI commands below are runnable and self-contained. Fill in the observed results, resource metrics, creative rubric assessments, and final disposition upon physical execution.
+
+---
+
+## 1. Experiment Metadata & Provenance
+
+- **Evaluation Date:** `<YYYY-MM-DD>`
+- **Operator Name / ID:** `<operator-identity>`
+- **Target Host Name:** `<hostname>`
+- **NVIDIA GPU Model & UUID:** `<NVIDIA RTX 4090 / GPU-UUID>`
+- **Driver & CUDA Build:** `<Driver Version> / <CUDA Build>`
+- **ComfyUI Core Revision:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
+- **TeaCache Node Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
+- **Route:** `[ ] i2v` | `[ ] ref2v`
+- **Frame Count:** `[ ] 124f (5.17s)` | `[ ] 243f (10.13s)` | `[ ] 362f (15.08s)`
+- **Random Seed:** `<e.g. 42>`
+- **Candidate TeaCache Variant:** `[ ] raw-l1-v1`
+- **Candidate Parameters:**
+  - `rel_l1_thresh`: `<e.g. 0.05, 0.10, 0.15>`
+  - `start_step`: `<e.g. 2>`
+  - `end_step`: `<e.g. -2>`
+  - `total_steps`: `20`
+- **Baseline Control Run ID:** `<h3-tc-baseline-...>`
+- **Candidate Variant Run ID:** `<h3-tc-candidate-...>`
+- **Topology Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
+- **Configuration Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
+- **Runtime Lock Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
+- **Admission Verdict:** `[ ] Admitted` | `[ ] Rejected`
+
+---
+
+## 2. Controlled Invariants Verification
+
+All invariants must be strictly verified before comparing timing metrics:
+
+- [ ] **Route Identical:** `i2v` or `ref2v` matches baseline
+- [ ] **Frame Count Identical:** Exactly 124 frames (or staged 243f/362f)
+- [ ] **Geometry & Cadence Identical:** Exactly `1344x768` at 24 fps
+- [ ] **Noise Seed Identical:** Same random seed across pair
+- [ ] **Scheduler Steps Identical:** Exactly 20 steps (`res_multistep` or `simple`)
+- [ ] **Conditioning Inputs Identical:** SHA-256 match on staged input assets
+- [ ] **Single Factor Change:** `caching.configuration` is the sole variable changed
+- [ ] **Dense Attention Preserved:** PyTorch SDPA dense attention used across both runs (no Sage/Veda/Native Sol-Attn)
+- [ ] **Standard Checkpoint Preserved:** Canonical INT8 ConvRot model used (no Turbo/Lightning/FastH3 distillation)
+- [ ] **Runtime Substrate Verified:** Baseline and candidate executed on identical virtual environment and package versions
+- [ ] **Runner Policy Identical:** Same memory management policy (`dynamicvram-offload-v1`)
+- [ ] **Operator Stop Policy Enforced:** Executed with identical operator-authored stop policy (`--stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json`)
+
+---
+
+## 3. TeaCache Topology & Node Configuration Audit
+
+- [ ] **Node 401 Present:** Candidate graph contains node 401 with class `CCOMiniMaxH3TeaCache`
+- [ ] **Model Interception:** Node 401 input `model` wired to `["6", 0]`
+- [ ] **Guider Rewiring:** Node 16 (`BasicGuider`) input `model` wired to `["401", 0]`
+- [ ] **Scheduler Rewiring:** Node 9 (`BasicScheduler`) input `model` wired to `["401", 0]`
+- [ ] **Control Node 401 Absent:** Baseline control graph contains no node 401; nodes 16 and 9 wire to `["6", 0]`
+- [ ] **Conditioning Intact:** Nodes 104/105 conditioning connections completely unmodified
+- [ ] **No Competing Wrappers:** Confirmed no competing model wrappers or LoRA loaders stacked onto model path
+
+---
+
+## 4. Telemetry & Execution Accounting
+
+### Timestep Caching Accounting
+| Metric | Baseline Control (`off`) | Candidate Variant (`raw-l1-v1`) | Requirement | Status |
+| :--- | :--- | :--- | :--- | :--- |
+| Model Forward Passes | 20 | `<forward-calls>` | Recorded | `[PASS / FAIL]` |
+| Timestep Cache Hits | 0 | `<cache-hits>` | $\ge 1$ (No `no_op`) | `[PASS / FAIL]` |
+| Cache Hit Rate (%) | 0.0% | `<hit-rate>%` | Recorded | `[PASS / FAIL]` |
+| Nested Forwards on Cache Hit | 0 | 0 | Exactly 0 (No leak) | `[PASS / FAIL]` |
+| Effective Sampling Steps | 20 | 20 | Matches scheduler | `[PASS / FAIL]` |
+| No-Op Classification | N/A | `[ ] Verified` | `status != "no_op"` | `[PASS / FAIL]` |
+
+### Phase Timings (Milliseconds)
+| Phase | Baseline Control (ms) | Candidate Variant (ms) | Delta (ms) | Ratio (Variant/Base) | Status |
+| :--- | :--- | :--- | :--- | :--- | :--- |
+| Environment Startup | | | | | `[measured/unknown]` |
+| Model Loading | | | | | `[measured/unknown]` |
+| Conditioning | | | | | `[measured/unknown]` |
+| Sampling Wall Time | | | | | `[measured/unknown]` |
+| - Per-Step Mean | | | | | `[measured/unknown]` |
+| VAE Video Decode | | | | | `[measured/unknown]` |
+| Mux & Save | | | | | `[measured/unknown]` |
+| Whole Attempt Wall Time | | | | | `[measured/unknown]` |
+
+---
+
+## 5. Resource Envelope (RTX 4090 24GB VRAM)
+
+| Resource | Baseline Control | Candidate Variant | Delta | Safety Threshold | Within Limits |
+| :--- | :--- | :--- | :--- | :--- | :--- |
+| Peak VRAM (MiB) | | | | $\le 23,500\text{ MiB}$ | `[YES / NO]` |
+| Peak Host RAM (MiB) | | | | $\le 60,000\text{ MiB}$ | `[YES / NO]` |
+| Swap Activity Delta (MiB) | | | | $0\text{ MiB}$ | `[YES / NO]` |
+
+---
+
+## 6. Output Conformance & Probed Media Facts
+
+- [ ] **Probed Video Geometry:** `1344x768` (ffprobe verified)
+- [ ] **Probed Video Duration:** 5.167s / 124 frames (ffprobe verified)
+- [ ] **Container Format:** MP4 (H.264 / AAC)
+- [ ] **Video Stream Codec:** `h264` (yuv420p)
+- [ ] **Audio Stream Codec:** `aac` (stereo, 44100 Hz or 48000 Hz)
+- [ ] **Audio / Video Synchronization:** Audio stream remains synchronized with video motion without lip-sync drift or temporal offset
+- [ ] **Audio Playback Continuity:** Audio plays smoothly with zero pops, clicks, or dropouts across cache-skipped step intervals
+- [ ] **No Corrupted / Black Frames:** Output video verified complete from frame 0 to end
+
+---
+
+## 7. Qualitative Visual Quality Review
+
+*Score each category: `1 (Severe Regression)` to `5 (Indistinguishable from Baseline Control)`.*
+
+| Evaluation Dimension | Score (1-5) | Specific Visual Observations | Status |
+| :--- | :---: | :--- | :--- |
+| **Subject Identity & Face** | | | `[Pass / Fail]` |
+| **Wardrobe & Fine Textures** | | | `[Pass / Fail]` |
+| **Scene Background Stability** | | | `[Pass / Fail]` |
+| **Motion Smoothness & Trajectory** | | | `[Pass / Fail]` |
+| **Temporal Flicker & Shimmer** | | | `[Pass / Fail]` |
+| **Reference Adherence (Ref2V)** | | | `[Pass / Fail / N/A]` |
+| **Audio & Sync Fidelity** | | | `[Pass / Fail]` |
+
+---
+
+## 8. Anomaly & Incident Log
+
+| Step / Timestamp | Event / Observation | Impact on Run | Action Taken |
+| :--- | :--- | :--- | :--- |
+| | | | |
+
+---
+
+## 9. Operator Sign-Off & Disposition
+
+### Recommendation Summary
+- **Overall Execution Result:** `[ ] SUCCESS` | `[ ] REJECTED` | `[ ] ABORTED`
+- **Observed Sampling Wall-Time Speedup:** `<ratio or N/A>`
+- **Observed Cache Hit Rate:** `<hit-rate or N/A>`
+- **Visual Acceptability:** `[ ] ACCEPTABLE` | `[ ] UNACCEPTABLE DEFECTS`
+- **Audio & Playback Integrity:** `[ ] ACCEPTABLE` | `[ ] UNACCEPTABLE DEFECTS`
+
+### Disposition Decision
+- [ ] **RECOMMEND PROMOTION REVIEW (#445):** Candidate threshold demonstrates reproducible sampling acceleration ($\ge 15\%$), zero stability failures, and commercially acceptable visual quality across all test seeds.
+- [ ] **REQUIRE RE-TUNING:** Threshold too aggressive (artifacts) or too conservative (insufficient speedup). Further parameter sweep needed.
+- [ ] **REJECT CANDIDATE:** Fundamental visual regressions, motion shudder, or unresolvable offload overhead negate benefits. Candidate remains disabled in catalog.
+
+### Mandatory Sign-Off Gates
+- [ ] **Licensing & Release Sign-off:** Verified upstream MIT License compliance (`experiments/minimax-h3-teacache/LICENSE`, copyright attribution to Icyoung, and non-encumbered open-source distribution). Approved for release gate review.
+- [ ] **Evidence Retention Sign-off:** All raw run directories (`.ai-runs/`), telemetry streams (`events.jsonl`), runtime manifests, reconstructed configs, and probed artifacts are securely retained and committed to durable evidence storage.
+
+**Operator Signature:** `___________________________`  
+**Date:** `YYYY-MM-DD`
diff --git a/docs/minimax-h3-teacache-source-audit.md b/docs/minimax-h3-teacache-source-audit.md
new file mode 100644
index 0000000..3f3120b
--- /dev/null
+++ b/docs/minimax-h3-teacache-source-audit.md
@@ -0,0 +1,88 @@
+# MiniMax-H3 TeaCache Source Audit & Adaptation Specification
+
+## 1. Upstream Audit & Cryptographic Pin
+
+This document records the architectural and security audit of the upstream MiniMax-H3 TeaCache candidate implementation, evaluated for isolated timestep-caching experiments under Issue #467.
+
+### Pinned Upstream Identity
+- **Repository:** `https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache`
+- **Candidate Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
+- **License:** MIT License (`Copyright (c) 2026 Icyoung`)
+- **Pyproject Version:** `0.1.0` (Python requirement `>=3.10`, dependencies: none beyond host PyTorch)
+
+### Audited Source File Hashes
+
+| File | SHA-256 Digest | Audit Status |
+| :--- | :--- | :--- |
+| `nodes.py` | `dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287` | Audited |
+| `teacache.py` | `97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f` | Audited |
+| `LICENSE` | `ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67` | Verified MIT |
+| `pyproject.toml` | `e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be` | Audited |
+| `__init__.py` | `8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416` | Audited |
+
+Security inspection confirms that the audited candidate files contain ordinary Python dataclass, tensor manipulation, and ComfyUI node registration code. No arbitrary network downloads, child process spawning, shell execution, or binary extensions are present.
+
+---
+
+## 2. Pinned ComfyUI Core Compatibility & Output Semantics
+
+The target environment runs ComfyUI core pinned at commit `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc` (ComfyUI v0.33.0).
+
+### Core Dispatch Compatibility
+- `ModelPatcher.set_model_unet_function_wrapper`: Supported on pinned core. It registers `model_options["model_function_wrapper"]`.
+- When sampling executes (e.g. within `comfy.samplers` or `comfy_extras.nodes_custom_sampler.SamplerCustomAdvanced`), the wrapper intercepts model evaluation as:
+  ```python
+  model_function_wrapper(apply_model, {"input": x, "timestep": timestep, "c": c, "cond_or_uncond": cond_or_uncond})
+  ```
+- **H3 Model Semantics:** In MiniMax-H3, `BaseModel._apply_model` calls `diffusion_model` on packed AV tensors, concatenates stream outputs, and computes denoised predictions via `model_sampling.calculate_denoised`.
+- **Denoised Output Reuse Approximation:** The upstream node caches and returns the previous output of `apply_model`. On the pinned core, this returns the denoised prediction, not an intermediate transformer residual or velocity. Reusing this tensor is an intentional approximation that risks cumulative motion, identity, and audio degradation.
+
+### Generation Route Compatibility
+- **I2V (`MiniMaxH3ImageToVideo`):** Supported. Node returns conditioning in slot 0 and packed latent in slot 1.
+- **Ref2V (`MiniMaxH3ReferenceToVideo`):** Supported. Ordered reference images are embedded into conditioning and injected inside diffusion evaluations.
+- **Fail-Closed Policy:** Any route using unknown conditioning schemas, variable sigma shifts, or altered precision must fail closed.
+
+---
+
+## 3. Upstream Analysis & Required Architectural Adaptations
+
+Static audit identified six critical issues in upstream `4cbb50d6` that prevent unadapted production deployment:
+
+1. **Unmanaged Long-Lived State:** Upstream instantiates a cache state dataclass during node `apply()` and closes over it in the wrapper. Because ComfyUI's execution cache can reuse outputs across multiple prompt submissions, this state is not reset on subsequent runs, prompt retries, or seed changes.
+2. **Unbounded Step Counter:** Upstream increments `step_idx` on every wrapper invocation without verifying the actual sigma sequence, scheduler step count, or multi-branch evaluation. If guider evaluates multiple branches or if steps are interrupted, step indexing desynchronizes.
+3. **Tensor Aliasing via Detach without Clone:** Upstream caches `input.detach()` and `output.detach()`. If downstream nodes or samplers mutate tensors in place, cached state is corrupted.
+4. **Denoised Prediction Reuse:** Upstream returns the previous full denoised model output. While this avoids transformer compute, packed video and audio latents can experience drift. This must be recorded as an experimental approximation (`raw-l1-v1`), not exact mathematical equivalence.
+5. **Raw Relative-L1 Accumulation:** Upstream calculates `rel_l1 = (curr - prev).abs().mean() / prev.abs().mean()`. Without polynomial calibration, large video latent deltas can obscure audio latent differences.
+6. **Self-Reported Counters:** Upstream counts wrapper calls internally. The test harness requires independent interception of `diffusion_model` forwards to verify that compute was truly skipped.
+
+---
+
+## 4. Repository-Owned Adapted Node: `CCOMiniMaxH3TeaCache`
+
+To resolve these findings while preserving the candidate's core algorithm, the repository provides an isolated adapted node (`CCOMiniMaxH3TeaCacheNode`):
+
+- **Node Key:** `CCOMiniMaxH3TeaCache`
+- **Adapter Version:** `0.1.0-cco-experimental`
+
+### Local In-Tree Adapter File Hashes
+| File | SHA-256 Digest | Role |
+| :--- | :--- | :--- |
+| `__init__.py` | `db3a565640d2052fda48f90f22734343a55285edcedd0305faf813e0e8fbbca4` | Node mapping registration & export |
+| `nodes.py` | `74f3616d6fe786c6400975b1b5c38a1a6263ee06bf7579b3a65f85d434d03c56` | ComfyUI custom node definition & input validation |
+| `teacache.py` | `139d920f353ed186b7516ca5edc93bd15f39c1eb749c6efb3fa39b992e0f4fdf` | Session management, sigma validation, tensor caching |
+
+- **Execution-Local Session Lifecycle:** Each `SamplerCustomAdvanced` invocation creates an isolated `TeaCacheSession` bound via context variables (`contextvars`). The session is strictly cleaned up in a `finally` block on completion or error.
+- **Tensor Isolation:** Cached inputs and outputs are explicitly cloned (`.detach().clone()`).
+- **Sigma Schedule Validation:** The session validates a canonical 20-step schedule (21 strictly descending finite sigmas) at initialization and maps logical steps directly.
+- **Independent Instrumentation:** The collector hooks `BaseModel._apply_model` / `diffusion_model` to verify that cache hits perform zero transformer evaluations.
+- **Parameter Bounds:**
+  - `rel_l1_thresh`: Conservative candidate grid `{0.05, 0.10, 0.15}`.
+  - Step window: Half-open interval `[start_step, end_step)`. Enforces at least the first 2 and last 2 steps remain unskipped: `2 <= start_step < effective_end <= 18`.
+
+---
+
+## 5. Security, Licensing, & Governance Boundary
+
+- The adapted code retains upstream MIT copyright notices.
+- Caching is disabled by default in all production ShotPlan routes and worker execution.
+- No hardware speedup claims or aesthetic approvals are asserted by offline CI. Live measurements and visual reviews are governed strictly by Issue #445.
diff --git a/experiments/minimax-h3-teacache/LICENSE b/experiments/minimax-h3-teacache/LICENSE
new file mode 100644
index 0000000..0756b62
--- /dev/null
+++ b/experiments/minimax-h3-teacache/LICENSE
@@ -0,0 +1,22 @@
+MIT License
+
+Copyright (c) 2026 Icyoung
+Adapted for Comfy Content Orchestrator (CCO)
+
+Permission is hereby granted, free of charge, to any person obtaining a copy
+of this software and associated documentation files (the "Software"), to deal
+in the Software without restriction, including without limitation the rights
+to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+copies of the Software, and to permit persons to whom the Software is
+furnished to do so, subject to the following conditions:
+
+The above copyright notice and this permission notice shall be included in all
+copies or substantial portions of the Software.
+
+THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+SOFTWARE.
diff --git a/experiments/minimax-h3-teacache/__init__.py b/experiments/minimax-h3-teacache/__init__.py
new file mode 100644
index 0000000..2538d51
--- /dev/null
+++ b/experiments/minimax-h3-teacache/__init__.py
@@ -0,0 +1,36 @@
+"""
+MiniMax-H3 TeaCache ComfyUI Custom Node Package (CCO Adapted)
+Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
+"""
+
+try:
+    from . import teacache as _teacache_mod
+    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, CCOMiniMaxH3TeaCacheNode
+    from .teacache import (
+        TeaCacheSession,
+        get_active_session,
+        set_active_session,
+        reset_active_session,
+        SUPPORTED_THRESHOLDS,
+    )
+except ImportError:
+    import teacache as _teacache_mod
+    from nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, CCOMiniMaxH3TeaCacheNode
+    from teacache import (
+        TeaCacheSession,
+        get_active_session,
+        set_active_session,
+        reset_active_session,
+        SUPPORTED_THRESHOLDS,
+    )
+
+__all__ = [
+    "NODE_CLASS_MAPPINGS",
+    "NODE_DISPLAY_NAME_MAPPINGS",
+    "CCOMiniMaxH3TeaCacheNode",
+    "TeaCacheSession",
+    "get_active_session",
+    "set_active_session",
+    "reset_active_session",
+    "SUPPORTED_THRESHOLDS",
+]
diff --git a/experiments/minimax-h3-teacache/catalog.json b/experiments/minimax-h3-teacache/catalog.json
new file mode 100644
index 0000000..e99d061
--- /dev/null
+++ b/experiments/minimax-h3-teacache/catalog.json
@@ -0,0 +1,252 @@
+[
+  {
+    "variantName": "teacache-raw-l1",
+    "route": "i2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-raw-l1-i2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [0.05, 0.1, 0.15],
+    "defaultThreshold": 0.15,
+    "stepWindow": {
+      "minStartStep": 2,
+      "maxEndStep": 18,
+      "defaultStartStep": 2,
+      "defaultEndStep": 18,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Stage CCOMiniMaxH3TeaCache experimental custom node; no extra wheel packages.",
+      "teardownRecipe": "Remove staged custom node and restore clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending",
+      "Candidate timestep caching approximation requires live RTX 4090 visual and continuity review (#445)"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py",
+        "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+        "digest": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
+        "assertion": "Upstream MiniMaxH3TeaCache node registers MODEL patch wrapping set_model_unet_function_wrapper."
+      },
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Pinned ComfyUI core provides ModelPatcher.set_model_unet_function_wrapper."
+      }
+    ],
+    "catalogDigest": "49965bc2504b97062b2f64d93d7502daabca9a2dfb3a0df8cfdd15d7a99dd90b"
+  },
+  {
+    "variantName": "matched-control",
+    "route": "i2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-matched-control-i2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [],
+    "defaultThreshold": 0,
+    "stepWindow": {
+      "minStartStep": 0,
+      "maxEndStep": 0,
+      "defaultStartStep": 0,
+      "defaultEndStep": 0,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Identical substrate to candidate without TeaCache patch.",
+      "teardownRecipe": "Preserve clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Baseline matched control runs dense 20-step sampling on identical substrate with caching disabled."
+      }
+    ],
+    "catalogDigest": "6270a82be24dec78ba87f24313ba3079b879e63afbdb5c97cb3aaa773200d5c0"
+  },
+  {
+    "variantName": "teacache-raw-l1",
+    "route": "ref2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-raw-l1-ref2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [0.05, 0.1, 0.15],
+    "defaultThreshold": 0.15,
+    "stepWindow": {
+      "minStartStep": 2,
+      "maxEndStep": 18,
+      "defaultStartStep": 2,
+      "defaultEndStep": 18,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Stage CCOMiniMaxH3TeaCache experimental custom node; no extra wheel packages.",
+      "teardownRecipe": "Remove staged custom node and restore clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending",
+      "Candidate timestep caching approximation requires live RTX 4090 visual and continuity review (#445)"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py",
+        "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+        "digest": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
+        "assertion": "Upstream MiniMaxH3TeaCache node registers MODEL patch wrapping set_model_unet_function_wrapper."
+      },
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Pinned ComfyUI core provides ModelPatcher.set_model_unet_function_wrapper."
+      }
+    ],
+    "catalogDigest": "6423d231905f0c2395e1e69ce85c602a0d0399e6f73d4fbe8acb7d066d3abd27"
+  },
+  {
+    "variantName": "matched-control",
+    "route": "ref2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-matched-control-ref2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [],
+    "defaultThreshold": 0,
+    "stepWindow": {
+      "minStartStep": 0,
+      "maxEndStep": 0,
+      "defaultStartStep": 0,
+      "defaultEndStep": 0,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Identical substrate to candidate without TeaCache patch.",
+      "teardownRecipe": "Preserve clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Baseline matched control runs dense 20-step sampling on identical substrate with caching disabled."
+      }
+    ],
+    "catalogDigest": "e18b76df4ccc13366dd9d9060d1991a26fd36be53f0203a75672e8d7939a94d9"
+  }
+]
diff --git a/experiments/minimax-h3-teacache/fixtures/teacache-api.json b/experiments/minimax-h3-teacache/fixtures/teacache-api.json
new file mode 100644
index 0000000..4dfab4f
--- /dev/null
+++ b/experiments/minimax-h3-teacache/fixtures/teacache-api.json
@@ -0,0 +1,20 @@
+{
+  "upstreamRepository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+  "upstreamCommit": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+  "targetCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+  "upstreamNodeKey": "MiniMaxH3TeaCache",
+  "upstreamClassType": "MiniMaxH3TeaCacheNode",
+  "adaptedNodeKey": "CCOMiniMaxH3TeaCache",
+  "adaptedClassType": "CCOMiniMaxH3TeaCacheNode",
+  "inputSignature": {
+    "required": {
+      "model": ["MODEL"],
+      "rel_l1_thresh": ["FLOAT", { "default": 0.15, "min": 0.0, "max": 0.5, "step": 0.01 }],
+      "start_step": ["INT", { "default": 2, "min": 0, "max": 100, "step": 1 }],
+      "end_step": ["INT", { "default": -2, "min": -100, "max": 100, "step": 1 }],
+      "total_steps": ["INT", { "default": 20, "min": 1, "max": 1000, "step": 1 }]
+    }
+  },
+  "returnTypes": ["MODEL"],
+  "notes": "Adapted repository-owned TeaCache patch node wraps ModelPatcher.set_model_unet_function_wrapper with execution-local lifecycle sessions."
+}
diff --git a/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt b/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt
new file mode 100644
index 0000000..86b497a
--- /dev/null
+++ b/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt
@@ -0,0 +1,20 @@
+# ==============================================================================
+# Lockfile: MiniMax-H3 TeaCache Isolated Candidate Environment
+# ==============================================================================
+# Platform Metadata:
+#   OS: Linux x86_64 (glibc >= 2.35)
+#   Python: CPython 3.12 (ABI cp312)
+#   CUDA: 12.4
+#   PyTorch Toolchain: 2.5.1+cu124
+#
+# Candidate: CCOMiniMaxH3TeaCache (adapted from upstream 4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f)
+# Upstream pyproject.toml specifies:
+#   version = "0.1.0"
+#   requires-python = ">=3.10"
+#   dependencies = []
+#
+# No external compiled kernels or wheels required; uses host PyTorch and ComfyUI core.
+# Host PyTorch dependency:
+torch==2.5.1+cu124
+torchvision==0.20.1+cu124
+torchaudio==2.5.1+cu124
diff --git a/experiments/minimax-h3-teacache/nodes.py b/experiments/minimax-h3-teacache/nodes.py
new file mode 100644
index 0000000..410c64a
--- /dev/null
+++ b/experiments/minimax-h3-teacache/nodes.py
@@ -0,0 +1,127 @@
+"""
+MiniMax-H3 TeaCache ComfyUI Custom Node (CCO Adapted)
+Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
+"""
+
+import math
+from typing import Any, Dict, Tuple
+try:
+    from . import teacache as _teacache_mod
+    from .teacache import get_active_session, SUPPORTED_THRESHOLDS
+except ImportError:
+    import teacache as _teacache_mod
+    from teacache import get_active_session, SUPPORTED_THRESHOLDS
+
+
+class CCOMiniMaxH3TeaCacheNode:
+    _teacache_module = _teacache_mod
+
+    @classmethod
+    def INPUT_TYPES(cls):
+        return {
+            "required": {
+                "model": ("MODEL",),
+                "rel_l1_thresh": (
+                    "FLOAT",
+                    {"default": 0.15, "min": 0.0, "max": 0.5, "step": 0.01},
+                ),
+                "start_step": ("INT", {"default": 2, "min": 0, "max": 100, "step": 1}),
+                "end_step": ("INT", {"default": -2, "min": -100, "max": 100, "step": 1}),
+                "total_steps": ("INT", {"default": 20, "min": 1, "max": 1000, "step": 1}),
+            }
+        }
+
+    RETURN_TYPES = ("MODEL",)
+    RETURN_NAMES = ("model",)
+    FUNCTION = "apply"
+    CATEGORY = "model_patches/unet"
+
+    def apply(
+        self,
+        model: Any,
+        rel_l1_thresh: float,
+        start_step: int,
+        end_step: int,
+        total_steps: int,
+    ) -> Tuple[Any]:
+        # Validate parameter bounds
+        if isinstance(total_steps, bool) or not isinstance(total_steps, int) or total_steps != 20:
+            raise ValueError(f"TeaCache requires total_steps == 20, got {total_steps}")
+        if isinstance(rel_l1_thresh, bool) or not isinstance(rel_l1_thresh, (int, float)) or not math.isfinite(rel_l1_thresh):
+            raise ValueError(f"rel_l1_thresh must be a finite number, got {rel_l1_thresh}")
+        if round(float(rel_l1_thresh), 4) not in SUPPORTED_THRESHOLDS:
+            raise ValueError(
+                f"rel_l1_thresh must be one of {SUPPORTED_THRESHOLDS}, got {rel_l1_thresh}"
+            )
+
+        if isinstance(start_step, bool) or isinstance(end_step, bool) or not isinstance(start_step, int) or not isinstance(end_step, int):
+            raise ValueError("start_step and end_step must be integers")
+        norm_end = total_steps + end_step if end_step < 0 else end_step
+        if start_step < 2 or norm_end > 18 or start_step >= norm_end:
+            raise ValueError(
+                f"Invalid step window [{start_step}, {norm_end}); must satisfy 2 <= start < end <= 18"
+            )
+
+        m = model.clone() if hasattr(model, "clone") else model
+        opts = getattr(m, "model_options", None)
+        if opts is None:
+            opts = {}
+            m.model_options = opts
+
+        # Reject competing wrappers
+        existing_wrapper = opts.get("model_function_wrapper")
+        if existing_wrapper is not None:
+            raise RuntimeError(
+                "Competing model_function_wrapper already registered on model. TeaCache cannot be combined with existing wrapper."
+            )
+
+        patch_config = {
+            "rel_l1_thresh": float(rel_l1_thresh),
+            "start_step": int(start_step),
+            "end_step": int(end_step),
+            "normalized_end_step": int(norm_end),
+            "total_steps": int(total_steps),
+            "model_id": id(m),
+        }
+        opts["teacache_config"] = patch_config
+
+        def teacache_unet_wrapper(apply_model: Any, kwargs: Dict[str, Any]) -> Any:
+            session = _teacache_mod.get_active_session()
+            if session is None:
+                raise RuntimeError(
+                    "TeaCache model wrapper called without an active execution session"
+                )
+            if session.model_id != patch_config["model_id"]:
+                raise RuntimeError(
+                    f"TeaCacheSession model_id mismatch: session bound to {session.model_id}, "
+                    f"wrapper called on {patch_config['model_id']}"
+                )
+            if round(session.rel_l1_thresh, 4) != round(patch_config["rel_l1_thresh"], 4):
+                raise RuntimeError("TeaCacheSession rel_l1_thresh does not match patched model config")
+            if session.start_step != patch_config["start_step"] or session.end_step != patch_config["normalized_end_step"]:
+                raise RuntimeError("TeaCacheSession step window does not match patched model config")
+            if session.total_steps != patch_config["total_steps"]:
+                raise RuntimeError("TeaCacheSession total_steps does not match patched model config")
+            return session.evaluate(apply_model, kwargs)
+
+        teacache_unet_wrapper._cco_teacache = True
+        teacache_unet_wrapper._teacache_module = _teacache_mod
+        teacache_unet_wrapper._teacache_config = patch_config
+
+        if hasattr(m, "set_model_unet_function_wrapper"):
+            m.set_model_unet_function_wrapper(teacache_unet_wrapper)
+        else:
+            opts["model_function_wrapper"] = teacache_unet_wrapper
+
+        return (m,)
+
+
+NODE_CLASS_MAPPINGS = {
+    "CCOMiniMaxH3TeaCache": CCOMiniMaxH3TeaCacheNode,
+    "MiniMaxH3TeaCache": CCOMiniMaxH3TeaCacheNode,
+}
+
+NODE_DISPLAY_NAME_MAPPINGS = {
+    "CCOMiniMaxH3TeaCache": "MiniMax-H3 TeaCache (CCO Adapted)",
+    "MiniMaxH3TeaCache": "MiniMax-H3 TeaCache (Upstream Compatibility)",
+}
diff --git a/experiments/minimax-h3-teacache/source-manifest.json b/experiments/minimax-h3-teacache/source-manifest.json
new file mode 100644
index 0000000..1ed5ed6
--- /dev/null
+++ b/experiments/minimax-h3-teacache/source-manifest.json
@@ -0,0 +1,53 @@
+{
+  "upstream": {
+    "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+    "commit": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+    "license": "MIT",
+    "licenseCopyright": "Copyright (c) 2026 Icyoung",
+    "pyprojectVersion": "0.1.0",
+    "pythonRequirement": ">=3.10",
+    "sourceFiles": {
+      "nodes.py": {
+        "sha256": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287"
+      },
+      "teacache.py": {
+        "sha256": "97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f"
+      },
+      "LICENSE": {
+        "sha256": "ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67"
+      },
+      "pyproject.toml": {
+        "sha256": "e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be"
+      },
+      "__init__.py": {
+        "sha256": "8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416"
+      }
+    }
+  },
+  "adaptedNode": {
+    "nodeClass": "CCOMiniMaxH3TeaCacheNode",
+    "nodeKey": "CCOMiniMaxH3TeaCache",
+    "adapterVersion": "0.1.0-cco-experimental",
+    "algorithm": "raw-l1-v1",
+    "targetComfyUiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "localFiles": {
+      "__init__.py": {
+        "sha256": "3b14b0a4da6f0fa366d8da492ea85ce74f2a63f18336ac63970d9d2bfe128c94"
+      },
+      "nodes.py": {
+        "sha256": "ea16ae7ced6ab1ddfe7ba729a0a0c7047827f1e5601c6fd5c8363b837dd17d2c"
+      },
+      "teacache.py": {
+        "sha256": "ffd3c347182b31d85677e24c1bcf5386f0f49b354690a01e545c972c9756a19a"
+      }
+    },
+    "adaptationFindings": [
+      "F1: Upstream constructs state during node apply and closes over it; ComfyUI graph caching may reuse node output without re-executing apply. Adaptation uses execution-local session management scoped to each SamplerCustomAdvanced invocation.",
+      "F2: Upstream step counter advances on every wrapper call without checking sigmas, scheduler steps, or guider branching. Adaptation bounds step index strictly to the validated 20-interval sigma schedule.",
+      "F3: Upstream uses detach() without clone(), risking tensor aliasing if consumers mutate in place. Adaptation detaches and clones cached tensors.",
+      "F4: Upstream returns previous complete apply_model output (denoised prediction), which is an uncalibrated approximation on H3 packed AV streams. Adaptation preserves this explicit raw-L1 approximation with strict provenance tracking.",
+      "F5: Upstream uses raw relative-L1 on packed AV latents without polynomial rescale. Adaptation maintains the audited raw-L1 formula with finite value checks.",
+      "F6: Upstream counters are self-reported. Adaptation adds independent diffusion_model forward interception to prove skips."
+    ]
+  }
+}
diff --git a/experiments/minimax-h3-teacache/teacache.py b/experiments/minimax-h3-teacache/teacache.py
new file mode 100644
index 0000000..5207cb1
--- /dev/null
+++ b/experiments/minimax-h3-teacache/teacache.py
@@ -0,0 +1,327 @@
+"""
+MiniMax-H3 TeaCache Session & Caching Engine (CCO Adapted)
+Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
+"""
+
+import contextvars
+import math
+import sys
+import threading
+from typing import Any, Dict, List, Optional, Tuple
+
+SUPPORTED_THRESHOLDS = (0.05, 0.1, 0.15)
+
+_SHARED_VAR_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_SESSION_VAR"
+if hasattr(sys, _SHARED_VAR_KEY):
+    _ACTIVE_TEACACHE_SESSION = getattr(sys, _SHARED_VAR_KEY)
+else:
+    _ACTIVE_TEACACHE_SESSION = contextvars.ContextVar(
+        "_ACTIVE_TEACACHE_SESSION", default=None
+    )
+    setattr(sys, _SHARED_VAR_KEY, _ACTIVE_TEACACHE_SESSION)
+
+# Process-wide registry of model_ids with a currently-active TeaCache session.
+# Guards against two sessions being activated for the same model concurrently
+# (e.g. nested/re-entrant sampling, or a leaked session from a prior failed
+# setup) regardless of which asyncio/thread context activated them -- the
+# ContextVar alone only isolates *context*, not *model identity*.
+_ACTIVE_MODEL_IDS_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_MODEL_IDS"
+_ACTIVE_MODEL_IDS_LOCK_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_MODEL_IDS_LOCK"
+if hasattr(sys, _ACTIVE_MODEL_IDS_KEY):
+    _ACTIVE_MODEL_IDS = getattr(sys, _ACTIVE_MODEL_IDS_KEY)
+    _ACTIVE_MODEL_IDS_LOCK = getattr(sys, _ACTIVE_MODEL_IDS_LOCK_KEY)
+else:
+    _ACTIVE_MODEL_IDS = set()
+    _ACTIVE_MODEL_IDS_LOCK = threading.Lock()
+    setattr(sys, _ACTIVE_MODEL_IDS_KEY, _ACTIVE_MODEL_IDS)
+    setattr(sys, _ACTIVE_MODEL_IDS_LOCK_KEY, _ACTIVE_MODEL_IDS_LOCK)
+
+
+class TeaCacheSession:
+    def __init__(
+        self,
+        session_id: str,
+        model_id: Any,
+        rel_l1_thresh: float,
+        start_step: int,
+        end_step: int,
+        total_steps: int = 20,
+        sigmas: Optional[List[float]] = None,
+        event_callback: Optional[Any] = None,
+    ):
+        if sigmas is None:
+            raise ValueError(
+                "sigmas schedule is required: TeaCache cannot verify step/timestep "
+                "alignment without the sampler's actual sigma schedule"
+            )
+        if isinstance(total_steps, bool) or not isinstance(total_steps, int) or total_steps != 20:
+            raise ValueError(f"total_steps must be 20, got {total_steps}")
+        if isinstance(rel_l1_thresh, bool) or not isinstance(rel_l1_thresh, (int, float)) or not math.isfinite(rel_l1_thresh):
+            raise ValueError(f"rel_l1_thresh must be a finite number, got {rel_l1_thresh}")
+        if round(float(rel_l1_thresh), 4) not in SUPPORTED_THRESHOLDS:
+            raise ValueError(
+                f"rel_l1_thresh must be one of {SUPPORTED_THRESHOLDS}, got {rel_l1_thresh}"
+            )
+        if isinstance(start_step, bool) or isinstance(end_step, bool) or not isinstance(start_step, int) or not isinstance(end_step, int):
+            raise ValueError("start_step and end_step must be integers")
+
+        effective_end = total_steps + end_step if end_step < 0 else end_step
+        if start_step < 2 or effective_end > 18 or start_step >= effective_end:
+            raise ValueError(
+                f"Invalid step window [{start_step}, {effective_end}); must satisfy 2 <= start < end <= 18"
+            )
+
+        self.session_id = str(session_id)
+        self.model_id = model_id
+        self.rel_l1_thresh = float(rel_l1_thresh)
+        self.start_step = int(start_step)
+        self.raw_end_step = int(end_step)
+        self.end_step = int(effective_end)
+        self.normalized_end_step = int(effective_end)
+        self.total_steps = int(total_steps)
+        self.event_callback = event_callback
+
+        self.accumulated_rel_l1 = 0.0
+        self.last_real_input = None
+        self.last_real_output = None
+        self.step_idx = -1
+        self.forward_calls_count = 0
+        self.cache_hits_count = 0
+        self.nested_forwards_on_hits = 0
+        self.evaluations_in_current_step = 0
+        self.is_evaluating = False
+        self.is_evaluating_hit = False
+        self.is_active = True
+        self.conditioning_fingerprint: Optional[Tuple[Any, ...]] = None
+        self._lock = threading.Lock()
+
+        # Validate sigmas if provided
+        self.sigmas: Optional[List[float]] = None
+        if sigmas is not None:
+            self.set_and_validate_sigmas(sigmas)
+
+    def set_and_validate_sigmas(self, sigmas: List[float]):
+        if len(sigmas) != self.total_steps + 1:
+            raise ValueError(
+                f"Expected schedule with {self.total_steps + 1} sigmas for {self.total_steps} steps, got {len(sigmas)}"
+            )
+        for i, s in enumerate(sigmas):
+            val = float(s)
+            if not math.isfinite(val):
+                raise ValueError(f"Sigma at index {i} is non-finite: {s}")
+            if i > 0 and val >= float(sigmas[i - 1]):
+                raise ValueError(
+                    f"Sigma schedule is not strictly descending at index {i}: {sigmas[i - 1]} -> {val}"
+                )
+        self.sigmas = [float(s) for s in sigmas]
+
+    def advance_step(self, step_index: int):
+        with self._lock:
+            if not self.is_active:
+                raise RuntimeError("Cannot advance step on inactive or cleaned-up TeaCacheSession")
+            if isinstance(step_index, bool) or not isinstance(step_index, int) or not (0 <= step_index < self.total_steps):
+                raise ValueError(
+                    f"step_index must be an integer in [0, {self.total_steps}), got {step_index}"
+                )
+            if self.step_idx == -1:
+                if step_index != 0:
+                    raise ValueError(f"First step advancement must be to step 0, got {step_index}")
+            else:
+                if step_index <= self.step_idx:
+                    raise ValueError(
+                        f"step_index cannot repeat or go backwards: current {self.step_idx}, got {step_index}"
+                    )
+                if step_index > self.step_idx + 1:
+                    raise ValueError(
+                        f"step_index jumped non-sequentially: current {self.step_idx}, got {step_index}"
+                    )
+            self.step_idx = int(step_index)
+            self.evaluations_in_current_step = 0
+
+    def evaluate(self, apply_model: Any, kwargs: Dict[str, Any]) -> Any:
+        with self._lock:
+            if not self.is_active:
+                raise RuntimeError("Cannot evaluate on inactive or cleaned-up TeaCacheSession")
+            if self.step_idx < 0:
+                raise RuntimeError("Cannot evaluate on TeaCacheSession before first step advancement")
+            if self.is_evaluating:
+                raise RuntimeError(
+                    "Concurrent or reentrant evaluation on the same TeaCacheSession is forbidden"
+                )
+            if self.evaluations_in_current_step > 0:
+                raise RuntimeError(
+                    f"Duplicate or multi-branch evaluation detected in step {self.step_idx}: "
+                    "exactly one evaluation per step interval is supported"
+                )
+            self.is_evaluating = True
+
+        try:
+            curr_input = kwargs.get("input")
+            if curr_input is None:
+                raise ValueError("kwargs missing 'input' tensor")
+
+            # Validate timestep alignment against the pinned sigma schedule.
+            # Both sides are mandatory (fail-closed): a missing timestep or an
+            # unreadable/mismatched value must abort the step, not silently
+            # skip the scheduler-conformance check.
+            curr_timestep = kwargs.get("timestep")
+            if curr_timestep is None:
+                raise ValueError(
+                    f"kwargs missing 'timestep' tensor at step {self.step_idx}; "
+                    "cannot verify scheduler alignment"
+                )
+            expected_sigma = self.sigmas[self.step_idx]
+            try:
+                ts_val = float(curr_timestep.item() if hasattr(curr_timestep, "item") else curr_timestep)
+            except Exception as conv_err:
+                raise ValueError(
+                    f"Timestep at step {self.step_idx} is not convertible to a finite scalar: {conv_err}"
+                ) from conv_err
+            if not math.isfinite(ts_val) or abs(ts_val - expected_sigma) > 1e-1:
+                raise ValueError(
+                    f"Timestep {ts_val} does not match expected schedule sigma {expected_sigma} at step {self.step_idx}"
+                )
+
+            cond_or_uncond = kwargs.get("cond_or_uncond")
+            if cond_or_uncond is not None:
+                if isinstance(cond_or_uncond, (list, tuple)) and len(cond_or_uncond) > 1:
+                    raise RuntimeError(
+                        f"Multi-condition/CFG branching is unsupported by TeaCache: cond_or_uncond={cond_or_uncond}"
+                    )
+
+            # Bind this session to the specific route/conditioning shape it was
+            # first called with. A cached output is only a valid substitute for
+            # a later real forward if the surrounding conditioning manifest
+            # (which keys are present, their kind, and the cond/uncond arity)
+            # is unchanged -- otherwise the cache would silently serve output
+            # computed under a different route (e.g. I2V vs Ref2V) or a
+            # different reference-image binding.
+            c = kwargs.get("c")
+            c_fingerprint_keys = tuple(sorted(c.keys())) if isinstance(c, dict) else None
+            fingerprint = (
+                tuple(sorted(k for k in kwargs if k not in ("input", "timestep", "c"))),
+                c_fingerprint_keys,
+                len(cond_or_uncond) if isinstance(cond_or_uncond, (list, tuple)) else cond_or_uncond,
+            )
+            if self.conditioning_fingerprint is None:
+                self.conditioning_fingerprint = fingerprint
+            elif self.conditioning_fingerprint != fingerprint:
+                raise RuntimeError(
+                    "Conditioning manifest changed mid-session: TeaCache was bound to "
+                    f"{self.conditioning_fingerprint}, saw {fingerprint} at step {self.step_idx}. "
+                    "A cached forward output cannot be reused across a route/conditioning change."
+                )
+
+            in_window = self.start_step <= self.step_idx < self.end_step
+            should_hit = False
+            rel_l1 = 0.0
+
+            if in_window and self.last_real_input is not None and self.last_real_output is not None:
+                if curr_input.shape != self.last_real_input.shape:
+                    raise ValueError(
+                        f"Input tensor shape mismatch with cached state: {curr_input.shape} vs {self.last_real_input.shape}"
+                    )
+                if curr_input.dtype != self.last_real_input.dtype:
+                    raise ValueError(
+                        f"Input tensor dtype mismatch with cached state: {curr_input.dtype} vs {self.last_real_input.dtype}"
+                    )
+                if curr_input.device != self.last_real_input.device:
+                    raise ValueError(
+                        f"Input tensor device mismatch with cached state: {curr_input.device} vs {self.last_real_input.device}"
+                    )
+
+                # Relative L1 calculation
+                diff = (curr_input.float() - self.last_real_input.float()).abs().mean()
+                norm = self.last_real_input.float().abs().mean()
+                if norm == 0:
+                    rel_l1 = 0.0
+                else:
+                    rel_l1 = (diff / norm).item()
+
+                if not math.isfinite(rel_l1) or rel_l1 < 0:
+                    raise ValueError(f"Non-finite or negative relative L1 computed: {rel_l1}")
+
+                if self.accumulated_rel_l1 + rel_l1 < self.rel_l1_thresh:
+                    should_hit = True
+                    self.accumulated_rel_l1 += rel_l1
+
+            if should_hit:
+                self.is_evaluating_hit = True
+                self.cache_hits_count += 1
+                self.evaluations_in_current_step += 1
+                if self.event_callback:
+                    self.event_callback(
+                        event="cache_hit",
+                        stepIndex=self.step_idx,
+                        step_index=self.step_idx,
+                        rel_l1=rel_l1,
+                        accumulated_rel_l1=self.accumulated_rel_l1,
+                        thresh=self.rel_l1_thresh,
+                    )
+                # Output clone prevents in-place mutation of cached output
+                return self.last_real_output.clone()
+            else:
+                self.is_evaluating_hit = False
+                self.accumulated_rel_l1 = 0.0
+                self.forward_calls_count += 1
+                self.evaluations_in_current_step += 1
+                if self.event_callback:
+                    self.event_callback(
+                        event="cache_miss",
+                        stepIndex=self.step_idx,
+                        step_index=self.step_idx,
+                        rel_l1=rel_l1,
+                        accumulated_rel_l1=self.accumulated_rel_l1,
+                        thresh=self.rel_l1_thresh,
+                    )
+                c = kwargs.get("c")
+                c_kwargs = c if isinstance(c, dict) else {k: v for k, v in kwargs.items() if k not in ("input", "timestep", "cond_or_uncond")}
+                if curr_timestep is not None:
+                    try:
+                        out = apply_model(curr_input, curr_timestep, **c_kwargs)
+                    except TypeError as te:
+                        if "positional argument" in str(te):
+                            out = apply_model(curr_input, **c_kwargs)
+                        else:
+                            raise
+                else:
+                    out = apply_model(curr_input, **c_kwargs)
+                self.last_real_input = curr_input.detach().clone()
+                self.last_real_output = out.detach().clone()
+                return out
+        finally:
+            with self._lock:
+                self.is_evaluating = False
+                self.is_evaluating_hit = False
+
+    def cleanup(self):
+        with self._lock:
+            self.last_real_input = None
+            self.last_real_output = None
+            self.is_active = False
+            self.is_evaluating = False
+            self.is_evaluating_hit = False
+        with _ACTIVE_MODEL_IDS_LOCK:
+            _ACTIVE_MODEL_IDS.discard(self.model_id)
+
+
+def get_active_session() -> Optional[TeaCacheSession]:
+    return _ACTIVE_TEACACHE_SESSION.get()
+
+
+def set_active_session(session: Optional[TeaCacheSession]) -> Any:
+    if session is not None:
+        with _ACTIVE_MODEL_IDS_LOCK:
+            if session.model_id in _ACTIVE_MODEL_IDS:
+                raise RuntimeError(
+                    f"A TeaCache session is already active for model_id={session.model_id!r}. "
+                    "Nested or re-entrant sessions on the same model are forbidden -- "
+                    "the prior session was either never cleaned up (a leaked session from "
+                    "a failed setup) or this call is genuinely concurrent/re-entrant."
+                )
+            _ACTIVE_MODEL_IDS.add(session.model_id)
+    return _ACTIVE_TEACACHE_SESSION.set(session)
+
+
+def reset_active_session(token: Any):
+    _ACTIVE_TEACACHE_SESSION.reset(token)
diff --git a/packages/application/src/experiments/index.ts b/packages/application/src/experiments/index.ts
index 5c6f09b..5f36db0 100644
--- a/packages/application/src/experiments/index.ts
+++ b/packages/application/src/experiments/index.ts
@@ -4,6 +4,9 @@ export * from "./minimax-h3-timing-reducer.js";
 export * from "./minimax-h3-comparator.js";
 export * from "./minimax-h3-attention-catalog.js";
 export * from "./minimax-h3-attention-topology.js";
+export * from "./minimax-h3-teacache-topology.js";
+export * from "./minimax-h3-teacache-catalog.js";
+export * from "./minimax-h3-teacache-reducer.js";
 export * from "./minimax-h3-attention-reducer.js";
 export * from "./minimax-h3-step-reduction-catalog.js";
 export * from "./minimax-h3-step-reduction-compiler.js";
diff --git a/packages/application/src/experiments/minimax-h3-comparator.test.ts b/packages/application/src/experiments/minimax-h3-comparator.test.ts
index 3500065..19391e1 100644
--- a/packages/application/src/experiments/minimax-h3-comparator.test.ts
+++ b/packages/application/src/experiments/minimax-h3-comparator.test.ts
@@ -21,8 +21,11 @@ import {
   type MinimaxH3ExperimentEvent,
   type MinimaxH3AnyExperimentDescriptor,
   type MinimaxH3AnyExperimentResult,
-  type MinimaxH3ObservedProvenance
+  type MinimaxH3ObservedProvenance,
+  type MinimaxH3InstrumentationEvent,
+  MinimaxH3ExperimentResultV2Schema
 } from "@cco/contracts";
+import { reduceTeaCacheObservation } from "./minimax-h3-teacache-reducer.js";
 import { sha256Hex, MinimaxH3ExperimentService } from "./minimax-h3-experiment-service.js";
 import type { MinimaxH3ExperimentStorePort } from "../ports/minimax-h3-experiment-ports.js";
 
@@ -4074,4 +4077,1074 @@ describe("Service-generated Matched Pairs Admission and Comparison", () => {
       ).toBe(true);
     });
   });
+
+  describe("TeaCache Comparator Admission & Speedup Gating", () => {
+    it("admits matched baseline and TeaCache candidate pair with calculated speedup ratios", async () => {
+      const service = setupServiceWithTemplates();
+      const prompt = "A cinematic shot of a sunset over the ocean";
+
+      const { descriptor: baseDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-pair-base",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        teacacheMatchedControl: true,
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const { descriptor: varDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-pair-var",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        teacache: "raw-l1-v1",
+        teacacheThreshold: 0.15,
+        teacacheStartStep: 2,
+        teacacheEndStep: -2,
+        teacacheTotalSteps: 20,
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
+        phaseAccounting: {
+          ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
+          status: "complete",
+          wholeAttemptWallMs: 420000,
+          samplingWallTimeMs: 380000
+        },
+        teacacheObservation: {
+          status: "verified",
+          mode: "off",
+          requestedConfig: null,
+          effectiveConfig: null,
+          totalSteps: 20,
+          forwardCallsRecorded: 20,
+          cacheHitsRecorded: 0,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 20,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 380000,
+            modelForwardElapsedMs: 350000,
+            decisionOverheadMs: 0,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+
+      const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
+        execution: {
+          ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).execution,
+          latencyMs: 280000
+        },
+        phaseAccounting: {
+          ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
+          status: "complete",
+          wholeAttemptWallMs: 280000,
+          samplingWallTimeMs: 240000
+        },
+        teacacheObservation: {
+          status: "verified",
+          mode: "raw-l1-v1",
+          requestedConfig: {
+            mode: "raw-l1-v1",
+            relL1Thresh: 0.15,
+            startStep: 2,
+            endStep: -2,
+            totalSteps: 20,
+            normalizedStartStep: 2,
+            normalizedEndStep: 18
+          },
+          effectiveConfig: {
+            mode: "raw-l1-v1",
+            relL1Thresh: 0.15,
+            startStep: 2,
+            endStep: -2,
+            totalSteps: 20,
+            normalizedStartStep: 2,
+            normalizedEndStep: 18
+          },
+          totalSteps: 20,
+          forwardCallsRecorded: 14,
+          cacheHitsRecorded: 6,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 14,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 240000,
+            modelForwardElapsedMs: 220000,
+            decisionOverheadMs: 15,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+
+      const report = compareMinimaxH3Experiments({
+        baselineDescriptor: baseDesc,
+        baselineResult: baseResult,
+        variantDescriptor: varDesc,
+        variantResult: varResult
+      });
+
+      expect(report.structuralAdmission.eligible).toBe(true);
+      expect(report.structuralAdmission.invariantProjectionKey).toBeTruthy();
+      expect(report.metricEligibility.samplingWallEligible).toBe(true);
+      expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(240000 / 380000, 2);
+      expect(report.metrics?.wallTimeRatio).toBeCloseTo(280000 / 420000, 2);
+    });
+
+    it("disqualifies speedup metrics when TeaCache observation status is no_op (0 cache hits)", async () => {
+      const service = setupServiceWithTemplates();
+      const prompt = "A cinematic shot of a sunset over the ocean";
+
+      const { descriptor: baseDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-noop-base",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        teacacheMatchedControl: true,
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const { descriptor: varDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-noop-var",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        teacache: "raw-l1-v1",
+        teacacheThreshold: 0.05,
+        teacacheStartStep: 2,
+        teacacheEndStep: -2,
+        teacacheTotalSteps: 20,
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
+        teacacheObservation: {
+          status: "verified",
+          mode: "off",
+          requestedConfig: null,
+          effectiveConfig: null,
+          totalSteps: 20,
+          forwardCallsRecorded: 20,
+          cacheHitsRecorded: 0,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 20,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 380000,
+            modelForwardElapsedMs: 350000,
+            decisionOverheadMs: 0,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+      const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
+        teacacheObservation: {
+          status: "no_op",
+          mode: "raw-l1-v1",
+          requestedConfig: null,
+          effectiveConfig: null,
+          totalSteps: 20,
+          forwardCallsRecorded: 20,
+          cacheHitsRecorded: 0,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 20,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 380000,
+            modelForwardElapsedMs: 350000,
+            decisionOverheadMs: 15,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+
+      const report = compareMinimaxH3Experiments({
+        baselineDescriptor: baseDesc,
+        baselineResult: baseResult,
+        variantDescriptor: varDesc,
+        variantResult: varResult
+      });
+
+      expect(report.metricEligibility.samplingWallEligible).toBe(false);
+      expect(report.metricEligibility.reasons.some((r) => r.includes("0 cache hits"))).toBe(true);
+      expect(report.metrics).toBeNull();
+    });
+
+    it("disqualifies speedup metrics when TeaCache observation records nested forward passes on hits", async () => {
+      const service = setupServiceWithTemplates();
+      const prompt = "A cinematic shot of a sunset over the ocean";
+
+      const { descriptor: baseDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-contam-base",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        comfyUiDir: "/opt/comfyui",
+        py

... [diff truncated: 396,957 characters exceeds the 250,000-character prompt budget; showing the first and last portions. Rely on the finding ledger and the since-last-review diff for the authoritative record of what changed and what remains unresolved.] ...

sons.length > 0) {
+    finalStatus = "failed";
+    failureReason = failureReasons.join("; ");
+  } else if (teacacheRequest.mode === "raw-l1-v1" && cacheHitsRecorded === 0) {
+    finalStatus = "no_op";
+    failureReason = null;
+  } else {
+    finalStatus = "verified";
+    failureReason = null;
+  }
+
+  // A set of 20 distinct step values is not the same guarantee as "steps 0
+  // through 19 were each evaluated once" -- e.g. 20 distinct but
+  // out-of-range indices (observed from an adversarial/malformed stream)
+  // would pass a bare size check. Require the exact contiguous range.
+  let stepsCoverFullRange = seenSteps.size === 20;
+  if (stepsCoverFullRange) {
+    for (let i = 0; i < 20; i++) {
+      if (!seenSteps.has(i)) {
+        stepsCoverFullRange = false;
+        break;
+      }
+    }
+  }
+
+  const complete =
+    identityValidated &&
+    finalStatus !== "failed" &&
+    samplingCallsRecorded > 0 &&
+    samplingSpanEndSeen &&
+    (teacacheRequest.mode === "off"
+      ? modelForwardsRecorded === 20 && forwardCallsRecorded === 20
+      : sessionEndSeen &&
+        stepsCoverFullRange &&
+        duplicateStepEvaluations === 0 &&
+        forwardCallsRecorded + cacheHitsRecorded === 20 &&
+        modelForwardsRecorded === forwardCallsRecorded);
+
+  // Require coverage.complete === true before setting status to "verified"
+  if (finalStatus === "verified" && !complete) {
+    finalStatus = "failed";
+    failureReason = failureReason ?? "Measurement coverage incomplete or unverified";
+  }
+
+  return {
+    status: finalStatus,
+    mode: teacacheRequest.mode,
+    requestedConfig,
+    effectiveConfig: finalStatus !== "failed" ? observedEffectiveConfig : null,
+    totalSteps: 20,
+    forwardCallsRecorded,
+    cacheHitsRecorded,
+    nestedForwardsOnHits,
+    coverage: {
+      samplingCallsRecorded,
+      modelForwardsRecorded: hasCacheEvents ? modelForwardsRecorded : null,
+      complete
+    },
+    timings: {
+      samplingWallMs,
+      modelForwardElapsedMs: null,
+      decisionOverheadMs: null,
+      timingUnavailableReason: null
+    },
+    failureReason,
+    sessionId,
+    sessionAttempts
+  };
+}
diff --git a/packages/application/src/experiments/minimax-h3-teacache-topology.test.ts b/packages/application/src/experiments/minimax-h3-teacache-topology.test.ts
new file mode 100644
index 0000000..395e89c
--- /dev/null
+++ b/packages/application/src/experiments/minimax-h3-teacache-topology.test.ts
@@ -0,0 +1,293 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+import { deriveTeaCacheGraph, validateTeaCacheTopology } from "./minimax-h3-teacache-topology.js";
+import {
+  TEACACHE_NODE_KEY,
+  TEACACHE_PATCH_NODE_ID,
+  type MinimaxH3TeaCacheConfig
+} from "@cco/contracts";
+
+function loadCanonicalTemplate(route: "i2v" | "ref2v"): Record<string, unknown> {
+  const fileName =
+    route === "i2v"
+      ? "templates/minimax_h3_720p_i2v_124f_api.json"
+      : "templates/minimax_h3_720p_ref2v_124f_api.json";
+  const content = readFileSync(resolve(process.cwd(), fileName), "utf8");
+  return JSON.parse(content) as Record<string, unknown>;
+}
+
+describe("MiniMax-H3 TeaCache Topology", () => {
+  const candidateConfig: MinimaxH3TeaCacheConfig = {
+    mode: "raw-l1-v1",
+    relL1Thresh: 0.15,
+    startStep: 2,
+    endStep: -2,
+    totalSteps: 20,
+    normalizedStartStep: 2,
+    normalizedEndStep: 18
+  };
+
+  const offConfig: MinimaxH3TeaCacheConfig = {
+    mode: "off",
+    relL1Thresh: 0.15,
+    startStep: 2,
+    endStep: -2,
+    totalSteps: 20,
+    normalizedStartStep: 2,
+    normalizedEndStep: 18
+  };
+
+  it("derives and validates isolated TeaCache graph on i2v route", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph, patchNode, topologyDigest } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    expect(patchNode).not.toBeNull();
+    expect(topologyDigest).toMatch(/^[a-f0-9]{64}$/);
+    expect(patchNode?.nodeId).toBe(TEACACHE_PATCH_NODE_ID);
+    expect(patchNode?.classType).toBe(TEACACHE_NODE_KEY);
+    expect(patchNode?.inputs.model).toEqual(["6", 0]);
+    expect(patchNode?.inputs.rel_l1_thresh).toBe(0.15);
+    expect(patchNode?.inputs.start_step).toBe(2);
+    expect(patchNode?.inputs.end_step).toBe(-2);
+    expect(patchNode?.inputs.total_steps).toBe(20);
+
+    const guider = graph["16"] as { inputs?: { model?: unknown } };
+    const scheduler = graph["9"] as { inputs?: { model?: unknown } };
+    expect(guider.inputs?.model).toEqual([TEACACHE_PATCH_NODE_ID, 0]);
+    expect(scheduler.inputs?.model).toEqual([TEACACHE_PATCH_NODE_ID, 0]);
+
+    const validation = validateTeaCacheTopology(graph, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(validation.valid).toBe(true);
+    expect(validation.errors).toEqual([]);
+  });
+
+  it("derives and validates isolated TeaCache graph on ref2v route", () => {
+    const baseGraph = loadCanonicalTemplate("ref2v");
+    const { graph, patchNode } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "ref2v",
+      config: candidateConfig
+    });
+
+    expect(patchNode).not.toBeNull();
+    const validation = validateTeaCacheTopology(graph, {
+      expectedMode: "raw-l1-v1",
+      route: "ref2v",
+      expectedConfig: candidateConfig
+    });
+    expect(validation.valid).toBe(true);
+    expect(validation.errors).toEqual([]);
+  });
+
+  it("derives clean unpatched graph when mode is 'off'", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph, patchNode } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: offConfig
+    });
+
+    expect(patchNode).toBeNull();
+    expect(graph[TEACACHE_PATCH_NODE_ID]).toBeUndefined();
+
+    const guider = graph["16"] as { inputs?: { model?: unknown } };
+    const scheduler = graph["9"] as { inputs?: { model?: unknown } };
+    expect(guider.inputs?.model).toEqual(["6", 0]);
+    expect(scheduler.inputs?.model).toEqual(["6", 0]);
+
+    const validation = validateTeaCacheTopology(graph, {
+      expectedMode: "off",
+      route: "i2v",
+      expectedConfig: offConfig
+    });
+    expect(validation.valid).toBe(true);
+    expect(validation.errors).toEqual([]);
+  });
+
+  it("rejects graph when TeaCache patch node is miswired or missing", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    // Tamper: disconnect guider back to node 6
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["16"].inputs.model = ["6", 0];
+
+    const val1 = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(val1.valid).toBe(false);
+    expect(val1.errors.some((e) => e.includes("BasicGuider"))).toBe(true);
+
+    // Tamper: delete patch node
+    const deleted = JSON.parse(JSON.stringify(graph));
+    delete deleted[TEACACHE_PATCH_NODE_ID];
+
+    const val2 = validateTeaCacheTopology(deleted, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(val2.valid).toBe(false);
+    expect(val2.errors.some((e) => e.includes("missing from graph"))).toBe(true);
+  });
+
+  it("rejects graph when extraneous optimization patches are present", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    // Tamper: add a sparse attention patch node 301
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["301"] = {
+      class_type: "ModelSparseAttention",
+      inputs: { model: ["6", 0] }
+    };
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("Extraneous optimization patch node"))).toBe(true);
+  });
+
+  it("rejects graph when mode is 'off' but patch node is present", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const val = validateTeaCacheTopology(graph, {
+      expectedMode: "off",
+      route: "i2v",
+      expectedConfig: offConfig
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("must not be present"))).toBe(true);
+  });
+
+  it("rejects graph with unauthorized LoRA loader or optimizer patches", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["505"] = {
+      class_type: "LoraLoaderModelOnly",
+      inputs: { model: ["401", 0], lora_name: "test.safetensors" }
+    };
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("Unauthorized optimization/LoRA node"))).toBe(true);
+  });
+
+  it("rejects graph when scheduler steps/scheduler/denoise are altered", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["9"].inputs.steps = 10;
+    tampered["9"].inputs.scheduler = "karras";
+    tampered["9"].inputs.denoise = 0.8;
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("input 'steps' must be 20"))).toBe(true);
+    expect(val.errors.some((e) => e.includes("input 'scheduler' must be \"simple\""))).toBe(true);
+    expect(val.errors.some((e) => e.includes("input 'denoise' must be 1"))).toBe(true);
+  });
+
+  it("rejects graph when UNETLoader has non-canonical checkpoint", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["6"].inputs.unet_name = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("input 'unet_name' must be"))).toBe(true);
+  });
+
+  it("rejects graph when patch node inputs fail schema validation even without expectedConfig", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    // Set invalid threshold (not in allowlist)
+    tampered["401"].inputs.rel_l1_thresh = 0.99;
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("inputs failed schema validation"))).toBe(true);
+  });
+
+  it("rejects graph when model chain contains a cycle", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    // Create cycle 401 -> 16 -> 401
+    tampered["401"].inputs.model = ["16", 0];
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("contains a cycle"))).toBe(true);
+  });
+});
diff --git a/packages/application/src/experiments/minimax-h3-teacache-topology.ts b/packages/application/src/experiments/minimax-h3-teacache-topology.ts
new file mode 100644
index 0000000..dd3b4cd
--- /dev/null
+++ b/packages/application/src/experiments/minimax-h3-teacache-topology.ts
@@ -0,0 +1,469 @@
+import {
+  computeTeaCacheTopologyDigest,
+  TEACACHE_NODE_KEY,
+  TEACACHE_PATCH_NODE_ID,
+  MinimaxH3TeaCachePatchNodeInputsSchema,
+  type MinimaxH3TeaCacheConfig,
+  type MinimaxH3TeaCacheMode,
+  type MinimaxH3TeaCachePatchNode
+} from "@cco/contracts";
+import type { ComfyNode } from "./minimax-h3-attention-topology.js";
+
+export interface DeriveTeaCacheGraphOptions {
+  baseWorkflow: Record<string, unknown>;
+  route: "i2v" | "ref2v";
+  config: MinimaxH3TeaCacheConfig;
+}
+
+export interface DerivedTeaCacheResult {
+  graph: Record<string, unknown>;
+  patchNode: MinimaxH3TeaCachePatchNode | null;
+  topologyDigest: string;
+}
+
+export function deriveTeaCacheGraph(options: DeriveTeaCacheGraphOptions): DerivedTeaCacheResult {
+  const { baseWorkflow, config } = options;
+
+  const derived = JSON.parse(JSON.stringify(baseWorkflow)) as Record<string, ComfyNode>;
+
+  const unetNodeId = "6";
+  const schedulerNodeId = "9";
+  const guiderNodeId = "16";
+  const patchNodeId = TEACACHE_PATCH_NODE_ID;
+
+  if (!derived[unetNodeId]) {
+    throw new Error(`Base graph is missing required UNETLoader node (id: "${unetNodeId}")`);
+  }
+  if (!derived[schedulerNodeId]) {
+    throw new Error(
+      `Base graph is missing required BasicScheduler node (id: "${schedulerNodeId}")`
+    );
+  }
+  if (!derived[guiderNodeId]) {
+    throw new Error(`Base graph is missing required BasicGuider node (id: "${guiderNodeId}")`);
+  }
+
+  if (config.mode === "raw-l1-v1") {
+    // Collision check: patchNodeId must not collide with base workflow unless it was already a TeaCache patch
+    if (derived[patchNodeId] && derived[patchNodeId].class_type !== TEACACHE_NODE_KEY) {
+      throw new Error(
+        `Node ID collision: node "${patchNodeId}" already exists in graph with class "${derived[patchNodeId].class_type}".`
+      );
+    }
+
+    const patchNode: MinimaxH3TeaCachePatchNode = {
+      nodeId: patchNodeId,
+      classType: TEACACHE_NODE_KEY,
+      inputs: {
+        model: [unetNodeId, 0],
+        rel_l1_thresh: config.relL1Thresh,
+        start_step: config.startStep,
+        end_step: config.endStep,
+        total_steps: 20
+      }
+    };
+
+    derived[patchNodeId] = {
+      inputs: {
+        model: [unetNodeId, 0],
+        rel_l1_thresh: config.relL1Thresh,
+        start_step: config.startStep,
+        end_step: config.endStep,
+        total_steps: 20
+      },
+      class_type: TEACACHE_NODE_KEY,
+      _meta: {
+        title: "MiniMax-H3 TeaCache (Experimental)"
+      }
+    };
+
+    if (!derived[schedulerNodeId].inputs) {
+      derived[schedulerNodeId].inputs = {};
+    }
+    derived[schedulerNodeId].inputs.model = [patchNodeId, 0];
+
+    if (!derived[guiderNodeId].inputs) {
+      derived[guiderNodeId].inputs = {};
+    }
+    derived[guiderNodeId].inputs.model = [patchNodeId, 0];
+
+    // Remove any incompatible patch nodes
+    delete derived["301"];
+    delete derived["302"];
+    delete derived["303"];
+
+    const topologyDigest = computeTeaCacheTopologyDigest(patchNode);
+    return { graph: derived, patchNode, topologyDigest };
+  } else {
+    // Cache off / matched control: direct UNETLoader wiring
+    if (!derived[schedulerNodeId].inputs) {
+      derived[schedulerNodeId].inputs = {};
+    }
+    derived[schedulerNodeId].inputs.model = [unetNodeId, 0];
+
+    if (!derived[guiderNodeId].inputs) {
+      derived[guiderNodeId].inputs = {};
+    }
+    derived[guiderNodeId].inputs.model = [unetNodeId, 0];
+
+    delete derived[patchNodeId];
+    delete derived["301"];
+    delete derived["302"];
+    delete derived["303"];
+
+    const topologyDigest = computeTeaCacheTopologyDigest(null);
+    return { graph: derived, patchNode: null, topologyDigest };
+  }
+}
+
+export interface ValidateTeaCacheTopologyOptions {
+  expectedMode: MinimaxH3TeaCacheMode;
+  route: "i2v" | "ref2v";
+  expectedConfig?: MinimaxH3TeaCacheConfig | null | undefined;
+}
+
+export function validateTeaCacheTopology(
+  rawGraph: Record<string, unknown>,
+  options: ValidateTeaCacheTopologyOptions
+): {
+  valid: boolean;
+  errors: string[];
+  topologyDigest: string;
+} {
+  const graph = rawGraph as Record<string, ComfyNode>;
+  const { expectedMode, route, expectedConfig } = options;
+  const errors: string[] = [];
+
+  const unetLoaderId = "6";
+  const schedulerNodeId = "9";
+  const samplerNodeId = "14";
+  const guiderNodeId = "16";
+  const patchNodeId = TEACACHE_PATCH_NODE_ID;
+  const i2vConditioningNodeId = "104";
+  const ref2vConditioningNodeId = "105";
+
+  if (Object.keys(graph).length === 0) {
+    errors.push("Workflow graph is empty (contains 0 nodes).");
+  }
+
+  // Scan ALL nodes for unauthorized optimizers, patches, LoRAs, or duplicate samplers
+  const FORBIDDEN_CLASS_TYPES = new Set([
+    "LoraLoader",
+    "LoraLoaderModelOnly",
+    "ModelAttentionBackend",
+    "BlockSparseAttention",
+    "ModelSparseAttention",
+    "VedaSparseAttention",
+    "MiniMaxH3SigmaShift"
+  ]);
+
+  for (const [nodeId, node] of Object.entries(graph)) {
+    const classType = node?.class_type ?? "";
+    if (
+      FORBIDDEN_CLASS_TYPES.has(classType) ||
+      classType.includes("Lora") ||
+      classType.includes("LoRA")
+    ) {
+      errors.push(
+        `Unauthorized optimization/LoRA node "${nodeId}" (${classType}) detected in graph. TeaCache must be strictly isolated.`
+      );
+    }
+    if (classType.includes("TeaCache") || classType === TEACACHE_NODE_KEY) {
+      if (expectedMode === "off") {
+        errors.push(
+          `TeaCache patch node "${nodeId}" (${classType}) must not be present when TeaCache is disabled (mode: 'off').`
+        );
+      } else if (nodeId !== patchNodeId) {
+        errors.push(
+          `Unauthorized duplicate or misplaced TeaCache node "${nodeId}" (${classType}) detected. Only node "${patchNodeId}" is authorized.`
+        );
+      }
+    }
+    if (classType.includes("SparseAttention") || classType.includes("AttentionBackend")) {
+      errors.push(
+        `Unauthorized attention optimization node "${nodeId}" (${classType}) detected. TeaCache requires dense attention.`
+      );
+    }
+    if (
+      classType === "SamplerCustomAdvanced" ||
+      classType === "KSampler" ||
+      classType === "KSamplerAdvanced"
+    ) {
+      if (nodeId !== samplerNodeId) {
+        errors.push(
+          `Unauthorized duplicate or misplaced sampler node "${nodeId}" (${classType}) detected. Only node "${samplerNodeId}" is authorized.`
+        );
+      }
+    }
+  }
+
+  const requiredNodeIds = [unetLoaderId, schedulerNodeId, samplerNodeId, guiderNodeId];
+  for (const id of requiredNodeIds) {
+    if (!graph[id]) {
+      errors.push(`Required pipeline node ${id} is missing from workflow graph.`);
+    } else if (!graph[id]?.inputs || Object.keys(graph[id]?.inputs ?? {}).length === 0) {
+      errors.push(`Required pipeline node ${id} has missing or empty inputs.`);
+    }
+  }
+
+  // UNETLoader invariant: checkpoint filename
+  if (graph[unetLoaderId]) {
+    const unetName = graph[unetLoaderId]?.inputs?.unet_name;
+    const expectedUnetName = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
+    if (unetName !== expectedUnetName) {
+      errors.push(
+        `UNETLoader (node ${unetLoaderId}) input 'unet_name' must be "${expectedUnetName}", got "${unetName}".`
+      );
+    }
+  }
+
+  // BasicScheduler invariants: steps === 20, scheduler === "simple", denoise === 1
+  if (graph[schedulerNodeId]) {
+    const schedInputs = graph[schedulerNodeId]?.inputs;
+    if (schedInputs?.steps !== 20) {
+      errors.push(
+        `BasicScheduler (node ${schedulerNodeId}) input 'steps' must be 20, got ${schedInputs?.steps}.`
+      );
+    }
+    if (schedInputs?.scheduler !== "simple") {
+      errors.push(
+        `BasicScheduler (node ${schedulerNodeId}) input 'scheduler' must be "simple", got "${schedInputs?.scheduler}".`
+      );
+    }
+    if (schedInputs?.denoise !== 1) {
+      errors.push(
+        `BasicScheduler (node ${schedulerNodeId}) input 'denoise' must be 1, got ${schedInputs?.denoise}.`
+      );
+    }
+  }
+
+  // BasicGuider invariant: conditioning input connection
+  if (graph[guiderNodeId]) {
+    const expectedCondNodeId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
+    const condConn = graph[guiderNodeId]?.inputs?.conditioning;
+    if (!Array.isArray(condConn) || condConn[0] !== expectedCondNodeId || condConn[1] !== 0) {
+      errors.push(
+        `BasicGuider (node ${guiderNodeId}) input 'conditioning' must connect to node ${expectedCondNodeId} slot 0, got ${JSON.stringify(condConn)}.`
+      );
+    }
+  }
+
+  if (route === "i2v") {
+    if (!graph[i2vConditioningNodeId]) {
+      errors.push(
+        `Route 'i2v' requires MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) to be present in graph.`
+      );
+    }
+    if (!graph["20"]) {
+      errors.push(
+        `Route 'i2v' requires LoadImage (node 20) for first_frame to be present in graph.`
+      );
+    } else if (graph[i2vConditioningNodeId]) {
+      const imgConn = graph[i2vConditioningNodeId]?.inputs?.first_frame;
+      if (!Array.isArray(imgConn) || imgConn[0] !== "20" || imgConn[1] !== 0) {
+        errors.push(
+          `MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) input 'first_frame' must connect to LoadImage (node 20) slot 0, got ${JSON.stringify(imgConn)}.`
+        );
+      }
+    }
+  } else {
+    if (!graph[ref2vConditioningNodeId]) {
+      errors.push(
+        `Route 'ref2v' requires MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}) to be present in graph.`
+      );
+    } else {
+      const node105 = graph[ref2vConditioningNodeId];
+      if (node105?.inputs) {
+        for (const [key, val] of Object.entries(node105.inputs)) {
+          if (key.startsWith("ref_images.") && Array.isArray(val) && typeof val[0] === "string") {
+            const refNodeId = val[0];
+            const refNode = graph[refNodeId];
+            if (!refNode) {
+              errors.push(
+                `MiniMaxH3ReferenceToVideo input '${key}' connects to missing node "${refNodeId}".`
+              );
+            } else if (refNode.class_type !== "LoadImage") {
+              errors.push(
+                `MiniMaxH3ReferenceToVideo input '${key}' must connect to LoadImage, got "${refNode.class_type}" on node "${refNodeId}".`
+              );
+            }
+          }
+        }
+      }
+    }
+  }
+
+  // Sampler Custom Advanced checks
+  if (graph[samplerNodeId]) {
+    const guiderConn = graph[samplerNodeId]?.inputs?.guider;
+    if (!Array.isArray(guiderConn) || guiderConn[0] !== guiderNodeId || guiderConn[1] !== 0) {
+      errors.push(
+        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'guider' must connect to BasicGuider (node ${guiderNodeId}) slot 0.`
+      );
+    }
+    const sigmasConn = graph[samplerNodeId]?.inputs?.sigmas;
+    if (!Array.isArray(sigmasConn) || sigmasConn[0] !== schedulerNodeId || sigmasConn[1] !== 0) {
+      errors.push(
+        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'sigmas' must connect to BasicScheduler (node ${schedulerNodeId}) slot 0.`
+      );
+    }
+    const expectedCondId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
+    const latentConn = graph[samplerNodeId]?.inputs?.latent_image;
+    if (!Array.isArray(latentConn) || latentConn[0] !== expectedCondId || latentConn[1] !== 1) {
+      errors.push(
+        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'latent_image' must connect to node ${expectedCondId} slot 1.`
+      );
+    }
+  }
+
+  if (expectedMode === "raw-l1-v1") {
+    const patch = graph[patchNodeId];
+    if (!patch) {
+      errors.push(`TeaCache patch node (node ${patchNodeId}) is missing from graph.`);
+    } else {
+      if (patch.class_type !== TEACACHE_NODE_KEY) {
+        errors.push(
+          `TeaCache patch node ${patchNodeId} class_type must be "${TEACACHE_NODE_KEY}", got "${patch.class_type}".`
+        );
+      }
+      const modelConn = patch.inputs?.model;
+      if (!Array.isArray(modelConn) || modelConn[0] !== unetLoaderId || modelConn[1] !== 0) {
+        errors.push(
+          `TeaCache patch node ${patchNodeId} input 'model' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got ${JSON.stringify(modelConn)}.`
+        );
+      }
+      if (patch.inputs) {
+        const schemaRes = MinimaxH3TeaCachePatchNodeInputsSchema.safeParse(patch.inputs);
+        if (!schemaRes.success) {
+          errors.push(
+            `TeaCache patch node ${patchNodeId} inputs failed schema validation: ${schemaRes.error.message}`
+          );
+        }
+      } else {
+        errors.push(`TeaCache patch node ${patchNodeId} has missing or empty inputs.`);
+      }
+      if (expectedConfig) {
+        if (patch.inputs?.rel_l1_thresh !== expectedConfig.relL1Thresh) {
+          errors.push(
+            `TeaCache patch node rel_l1_thresh mismatch: expected ${expectedConfig.relL1Thresh}, got ${patch.inputs?.rel_l1_thresh}.`
+          );
+        }
+        if (patch.inputs?.start_step !== expectedConfig.startStep) {
+          errors.push(
+            `TeaCache patch node start_step mismatch: expected ${expectedConfig.startStep}, got ${patch.inputs?.start_step}.`
+          );
+        }
+        if (patch.inputs?.end_step !== expectedConfig.endStep) {
+          errors.push(
+            `TeaCache patch node end_step mismatch: expected ${expectedConfig.endStep}, got ${patch.inputs?.end_step}.`
+          );
+        }
+        if (patch.inputs?.total_steps !== 20) {
+          errors.push(
+            `TeaCache patch node total_steps mismatch: expected 20, got ${patch.inputs?.total_steps}.`
+          );
+        }
+      }
+    }
+
+    // BasicGuider and BasicScheduler must both connect to patchNodeId slot 0
+    if (graph[guiderNodeId]) {
+      const guiderModel = graph[guiderNodeId]?.inputs?.model;
+      if (!Array.isArray(guiderModel) || guiderModel[0] !== patchNodeId || guiderModel[1] !== 0) {
+        errors.push(
+          `BasicGuider (node ${guiderNodeId}) input 'model' must connect to TeaCache (node ${patchNodeId}) slot 0, got ${JSON.stringify(guiderModel)}.`
+        );
+      }
+    }
+    if (graph[schedulerNodeId]) {
+      const schedModel = graph[schedulerNodeId]?.inputs?.model;
+      if (!Array.isArray(schedModel) || schedModel[0] !== patchNodeId || schedModel[1] !== 0) {
+        errors.push(
+          `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect to TeaCache (node ${patchNodeId}) slot 0, got ${JSON.stringify(schedModel)}.`
+        );
+      }
+    }
+
+    // Reject extraneous patch nodes
+    for (const badId of ["301", "302", "303"]) {
+      if (graph[badId]) {
+        errors.push(
+          `Extraneous optimization patch node ${badId} (${graph[badId].class_type}) detected. TeaCache must be strictly isolated.`
+        );
+      }
+    }
+  } else {
+    // Mode off: direct connections to node 6
+    for (const badId of ["301", "302", "303", patchNodeId]) {
+      if (graph[badId]) {
+        errors.push(
+          `Extraneous optimization patch node ${badId} (${graph[badId].class_type}) detected. Mode 'off' must not contain optimization nodes.`
+        );
+      }
+    }
+    if (graph[guiderNodeId]) {
+      const guiderModel = graph[guiderNodeId]?.inputs?.model;
+      if (!Array.isArray(guiderModel) || guiderModel[0] !== unetLoaderId || guiderModel[1] !== 0) {
+        errors.push(
+          `BasicGuider (node ${guiderNodeId}) input 'model' must connect directly to UNETLoader (node ${unetLoaderId}) slot 0 when caching is off, got ${JSON.stringify(guiderModel)}.`
+        );
+      }
+    }
+    if (graph[schedulerNodeId]) {
+      const schedModel = graph[schedulerNodeId]?.inputs?.model;
+      if (!Array.isArray(schedModel) || schedModel[0] !== unetLoaderId || schedModel[1] !== 0) {
+        errors.push(
+          `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect directly to UNETLoader (node ${unetLoaderId}) slot 0 when caching is off, got ${JSON.stringify(schedModel)}.`
+        );
+      }
+    }
+  }
+
+  // Model-chain cycle check and path validation
+  function checkModelChain(startNodeId: string, visited: Set<string>): boolean {
+    if (visited.has(startNodeId)) return false; // cycle
+    visited.add(startNodeId);
+    if (startNodeId === unetLoaderId) return true;
+    const node = graph[startNodeId];
+    if (!node || !node.inputs) return false;
+    const modelConn = node.inputs.model;
+    if (!Array.isArray(modelConn) || typeof modelConn[0] !== "string") return false;
+    return checkModelChain(modelConn[0], new Set(visited));
+  }
+  if (graph[guiderNodeId] && !checkModelChain(guiderNodeId, new Set())) {
+    errors.push(
+      `BasicGuider (node ${guiderNodeId}) model chain contains a cycle or does not terminate at UNETLoader.`
+    );
+  }
+  if (graph[schedulerNodeId] && !checkModelChain(schedulerNodeId, new Set())) {
+    errors.push(
+      `BasicScheduler (node ${schedulerNodeId}) model chain contains a cycle or does not terminate at UNETLoader.`
+    );
+  }
+
+  let patchNode: MinimaxH3TeaCachePatchNode | null = null;
+  const patch = graph[patchNodeId];
+  if (expectedMode === "raw-l1-v1" && patch) {
+    if (patch.class_type === TEACACHE_NODE_KEY && patch.inputs) {
+      const parsedInputs = MinimaxH3TeaCachePatchNodeInputsSchema.safeParse(patch.inputs);
+      if (parsedInputs.success) {
+        patchNode = {
+          nodeId: patchNodeId,
+          classType: TEACACHE_NODE_KEY,
+          inputs: parsedInputs.data
+        };
+      } else {
+        errors.push(
+          `TeaCache patch node ${patchNodeId} inputs failed schema validation: ${parsedInputs.error.message}`
+        );
+      }
+    }
+  }
+  const topologyDigest = computeTeaCacheTopologyDigest(patchNode);
+
+  return {
+    valid: errors.length === 0,
+    errors,
+    topologyDigest
+  };
+}
diff --git a/packages/application/src/ports/minimax-h3-experiment-ports.ts b/packages/application/src/ports/minimax-h3-experiment-ports.ts
index 7766ffd..2c88406 100644
--- a/packages/application/src/ports/minimax-h3-experiment-ports.ts
+++ b/packages/application/src/ports/minimax-h3-experiment-ports.ts
@@ -339,6 +339,12 @@ export interface PrepareMinimaxH3ExperimentOptions {
   coreRevision?: string;
   matchedVariant?: MinimaxH3AttentionVariantName;
   samplingRecipe?: MinimaxH3SamplingRecipeName;
+  teacache?: "off" | "raw-l1-v1";
+  teacacheThreshold?: number;
+  teacacheStartStep?: number;
+  teacacheEndStep?: number;
+  teacacheTotalSteps?: number;
+  teacacheMatchedControl?: boolean;
   env?: Record<string, string>;
   fixturesDir?: string;
 }
diff --git a/packages/contracts/src/index.ts b/packages/contracts/src/index.ts
index 8fe56ce..8fd35a5 100644
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -35,6 +35,7 @@ export * from "./minimax-h3-experiment.js";
 export * from "./minimax-h3-experiment-v2.js";
 export * from "./minimax-h3-attention.js";
 export * from "./minimax-h3-continuity.js";
+export * from "./minimax-h3-teacache.js";
 export * from "./h3-candidate-profile.js";
 export * from "./h3-capability-decision.js";
 export * from "./h3-candidate-registry.js";
diff --git a/packages/contracts/src/minimax-h3-experiment-v2.ts b/packages/contracts/src/minimax-h3-experiment-v2.ts
index 753ba95..7c76de3 100644
--- a/packages/contracts/src/minimax-h3-experiment-v2.ts
+++ b/packages/contracts/src/minimax-h3-experiment-v2.ts
@@ -45,6 +45,12 @@ import {
   type MinimaxH3AttentionCatalogEntry,
   type MinimaxH3AttentionObservation
 } from "./minimax-h3-attention.js";
+import {
+  MinimaxH3TeaCacheRequestSchema,
+  MinimaxH3TeaCacheObservationSchema,
+  FactorChangeCachingConfigSummarySchema,
+  createEmptyTeaCacheObservation
+} from "./minimax-h3-teacache.js";
 
 export const MinimaxH3ExperimentDescriptorV1Schema = MinimaxH3ExperimentDescriptorSchema;
 export type MinimaxH3ExperimentDescriptorV1 = MinimaxH3ExperimentDescriptor;
@@ -1108,6 +1114,15 @@ export const FactorChangeSigmaShiftSchema = z
   })
   .strict();
 
+export const FactorChangeCachingConfigSchema = z
+  .object({
+    path: z.literal("caching.configuration"),
+    before: FactorChangeCachingConfigSummarySchema.nullable(),
+    after: FactorChangeCachingConfigSummarySchema.nullable(),
+    rationale: z.string().min(1).optional()
+  })
+  .strict();
+
 export const MinimaxH3FactorChangeSchema = z.discriminatedUnion("path", [
   FactorChangePositivePromptSchema,
   FactorChangeNegativePromptSchema,
@@ -1117,6 +1132,7 @@ export const MinimaxH3FactorChangeSchema = z.discriminatedUnion("path", [
   FactorChangeSamplingSettingsSchema,
   FactorChangeSigmaShiftSchema,
   FactorChangeAttentionConfigSchema,
+  FactorChangeCachingConfigSchema,
   FactorChangeMemoryOffloadSchema,
   FactorChangeDecodeConfigSchema,
   FactorChangeRuntimeManifestSchema
@@ -1711,7 +1727,8 @@ export const MinimaxH3ExperimentDescriptorV2Schema = z
     stepOverride: z.number().int().positive().max(100).nullable().optional(),
     checkpointOverride: z.enum(["ref2va", "fl2va"]).nullable().optional(),
     attentionRequest: MinimaxH3AttentionRequestSchema.optional(),
-    samplingRecipe: MinimaxH3SamplingRecipeSchema.optional()
+    samplingRecipe: MinimaxH3SamplingRecipeSchema.optional(),
+    teacacheRequest: MinimaxH3TeaCacheRequestSchema.optional()
   })
   .strict()
   .superRefine((val, ctx) => {
@@ -2269,6 +2286,37 @@ export const MinimaxH3ExperimentDescriptorV2Schema = z
         });
       }
     }
+
+    if (val.teacacheRequest && val.teacacheRequest.mode === "raw-l1-v1") {
+      if (val.samplingRecipe && val.samplingRecipe.name !== "canonical-base-20") {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: `TeaCache cannot be combined with non-canonical samplingRecipe "${val.samplingRecipe.name}" in initial phase`,
+          path: ["samplingRecipe"]
+        });
+      }
+      if (val.stepOverride !== null && val.stepOverride !== undefined) {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: "TeaCache cannot be combined with stepOverride; base 20-step required",
+          path: ["stepOverride"]
+        });
+      }
+      if (val.checkpointOverride !== null && val.checkpointOverride !== undefined) {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: "TeaCache cannot be combined with checkpointOverride; base checkpoint required",
+          path: ["checkpointOverride"]
+        });
+      }
+      if (val.attentionRequest && val.attentionRequest.attentionVariant !== "dense") {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: `TeaCache cannot be combined with accelerated attentionVariant "${val.attentionRequest.attentionVariant}" in initial phase`,
+          path: ["attentionRequest"]
+        });
+      }
+    }
   });
 export type MinimaxH3ExperimentDescriptorV2 = z.infer<typeof MinimaxH3ExperimentDescriptorV2Schema>;
 
@@ -2310,7 +2358,8 @@ export const MinimaxH3ExperimentResultV2Schema = z
     compatibility: MinimaxH3CompatibilityAssessmentSchema,
     phaseAccounting: MinimaxH3PhaseAccountingResultSchema,
     instrumentationReport: MinimaxH3InstrumentationReportSchema,
-    attentionObservation: MinimaxH3AttentionObservationSchema.optional()
+    attentionObservation: MinimaxH3AttentionObservationSchema.optional(),
+    teacacheObservation: MinimaxH3TeaCacheObservationSchema.optional()
   })
   .strict()
   .superRefine((val, ctx) => {
@@ -2362,6 +2411,70 @@ export const MinimaxH3ExperimentResultV2Schema = z
         });
       }
     }
+
+    if (val.teacacheObservation) {
+      if (val.teacacheObservation.status === "verified") {
+        if (!val.teacacheObservation.coverage?.complete) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message:
+              "teacacheObservation with status 'verified' requires coverage.complete === true",
+            path: ["teacacheObservation", "coverage", "complete"]
+          });
+        }
+        if (
+          val.teacacheObservation.forwardCallsRecorded === null ||
+          val.teacacheObservation.cacheHitsRecorded === null
+        ) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message:
+              "teacacheObservation with status 'verified' requires non-null forwardCallsRecorded and cacheHitsRecorded",
+            path: ["teacacheObservation", "forwardCallsRecorded"]
+          });
+        }
+        if (
+          val.teacacheObservation.coverage?.modelForwardsRecorded !==
+          val.teacacheObservation.forwardCallsRecorded
+        ) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message:
+              "teacacheObservation with status 'verified' requires modelForwardsRecorded === forwardCallsRecorded",
+            path: ["teacacheObservation", "coverage", "modelForwardsRecorded"]
+          });
+        }
+        if (val.teacacheObservation.mode === "raw-l1-v1") {
+          if (val.teacacheObservation.cacheHitsRecorded === 0) {
+            ctx.addIssue({
+              code: z.ZodIssueCode.custom,
+              message:
+                "teacacheObservation with status 'verified' requires positive cacheHitsRecorded; 0 hits must be reported as 'no_op'",
+              path: ["teacacheObservation", "cacheHitsRecorded"]
+            });
+          }
+          if (val.teacacheObservation.effectiveConfig === null) {
+            ctx.addIssue({
+              code: z.ZodIssueCode.custom,
+              message:
+                "teacacheObservation with status 'verified' requires non-null effectiveConfig",
+              path: ["teacacheObservation", "effectiveConfig"]
+            });
+          }
+        }
+        if (
+          val.teacacheObservation.nestedForwardsOnHits !== null &&
+          val.teacacheObservation.nestedForwardsOnHits !== undefined &&
+          val.teacacheObservation.nestedForwardsOnHits > 0
+        ) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message: "teacacheObservation with status 'verified' cannot have nestedForwardsOnHits",
+            path: ["teacacheObservation", "nestedForwardsOnHits"]
+          });
+        }
+      }
+    }
   });
 export type MinimaxH3ExperimentResultV2 = z.infer<typeof MinimaxH3ExperimentResultV2Schema>;
 
@@ -2565,6 +2678,7 @@ export function computeInvariantProjectionKey(options: {
     audioShift: number;
   };
   attentionTopologyDigest?: string;
+  teacacheTopologyDigest?: string;
   runtimeManifestDigest?: string;
   coreRevision?: string;
 }): string {
@@ -2611,6 +2725,9 @@ export function computeInvariantProjectionKey(options: {
     attentionTopology: declaredSet.has("attention.configuration")
       ? "<DECLARED_FACTOR_VARIATION>"
       : (options.attentionTopologyDigest ?? "default"),
+    cachingConfiguration: declaredSet.has("caching.configuration")
+      ? "<DECLARED_FACTOR_VARIATION>"
+      : (options.teacacheTopologyDigest ?? "default"),
     runtimeManifest: declaredSet.has("runtime.manifest")
       ? "<DECLARED_FACTOR_VARIATION>"
       : (options.runtimeManifestDigest ?? "default"),
@@ -2858,6 +2975,11 @@ export function createEmptyMinimaxH3MeasurementTemplateV2(
             }
           }
         }
+      : {}),
+    ...(descriptor.teacacheRequest
+      ? {
+          teacacheObservation: createEmptyTeaCacheObservation(descriptor.teacacheRequest)
+        }
       : {})
   };
 }
diff --git a/packages/contracts/src/minimax-h3-teacache.test.ts b/packages/contracts/src/minimax-h3-teacache.test.ts
new file mode 100644
index 0000000..cdd7acb
--- /dev/null
+++ b/packages/contracts/src/minimax-h3-teacache.test.ts
@@ -0,0 +1,382 @@
+import { describe, it, expect } from "vitest";
+import {
+  MinimaxH3TeaCacheModeSchema,
+  MinimaxH3TeaCacheRequestSchema,
+  MinimaxH3TeaCacheObservationSchema,
+  normalizeTeaCacheWindow,
+  validateTeaCacheParameters,
+  computeTeaCacheTopologyDigest,
+  computeTeaCacheConfigDigest,
+  createEmptyTeaCacheObservation,
+  TEACACHE_UPSTREAM_COMMIT,
+  TEACACHE_ADAPTER_VERSION,
+  TEACACHE_NODE_KEY,
+  type MinimaxH3TeaCacheRequest
+} from "./minimax-h3-teacache.js";
+import { MinimaxH3FactorChangeSchema } from "./minimax-h3-experiment-v2.js";
+
+describe("MiniMax-H3 TeaCache Contracts", () => {
+  describe("MinimaxH3TeaCacheModeSchema", () => {
+    it("admits valid mode values", () => {
+      expect(MinimaxH3TeaCacheModeSchema.parse("off")).toBe("off");
+      expect(MinimaxH3TeaCacheModeSchema.parse("raw-l1-v1")).toBe("raw-l1-v1");
+    });
+
+    it("rejects unknown modes", () => {
+      expect(() => MinimaxH3TeaCacheModeSchema.parse("taylor-v1")).toThrow();
+      expect(() => MinimaxH3TeaCacheModeSchema.parse("residual-v2")).toThrow();
+    });
+  });
+
+  describe("normalizeTeaCacheWindow & validateTeaCacheParameters", () => {
+    it("normalizes negative endStep relative to totalSteps", () => {
+      const res = normalizeTeaCacheWindow({
+        startStep: 2,
+        endStep: -2,
+        totalSteps: 20
+      });
+      expect(res.normalizedStartStep).toBe(2);
+      expect(res.normalizedEndStep).toBe(18);
+      expect(res.totalSteps).toBe(20);
+    });
+
+    it("normalizes explicit positive endStep", () => {
+      const res = normalizeTeaCacheWindow({
+        startStep: 4,
+        endStep: 16,
+        totalSteps: 20
+      });
+      expect(res.normalizedStartStep).toBe(4);
+      expect(res.normalizedEndStep).toBe(16);
+    });
+
+    it("rejects startStep < 2 to protect initial forward passes", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 0,
+          endStep: 18,
+          totalSteps: 20
+        })
+      ).toThrow(/startStep must be >= 2/);
+
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 1,
+          endStep: 18,
+          totalSteps: 20
+        })
+      ).toThrow(/startStep must be >= 2/);
+    });
+
+    it("rejects effectiveEnd > 18 to protect final refinement steps", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 2,
+          endStep: 19,
+          totalSteps: 20
+        })
+      ).toThrow(/effective endStep must be <= 18/);
+
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 2,
+          endStep: -1,
+          totalSteps: 20
+        })
+      ).toThrow(/effective endStep must be <= 18/);
+    });
+
+    it("rejects empty or inverted window", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 10,
+          endStep: 10,
+          totalSteps: 20
+        })
+      ).toThrow(/empty or inverted/);
+
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 12,
+          endStep: 8,
+          totalSteps: 20
+        })
+      ).toThrow(/empty or inverted/);
+    });
+
+    it("rejects totalSteps other than 20", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 2,
+          endStep: 18,
+          totalSteps: 8
+        })
+      ).toThrow(/total_steps to be exactly 20/);
+    });
+
+    it("validates parameters and bounds relL1Thresh", () => {
+      const valid = validateTeaCacheParameters({
+        relL1Thresh: 0.15,
+        startStep: 2,
+        endStep: -2,
+        totalSteps: 20
+      });
+      expect(valid.relL1Thresh).toBe(0.15);
+      expect(valid.normalizedStartStep).toBe(2);
+      expect(valid.normalizedEndStep).toBe(18);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: 0,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/rel_l1_thresh must be one of/);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: 0.6,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/rel_l1_thresh must be one of/);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: 0.12,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/rel_l1_thresh must be one of/);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: Number.NaN,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/must be a finite number/);
+    });
+  });
+
+  describe("MinimaxH3TeaCacheRequestSchema", () => {
+    it("parses valid TeaCache request", () => {
+      const req: MinimaxH3TeaCacheRequest = {
+        mode: "raw-l1-v1",
+        relL1Thresh: 0.15,
+        startStep: 2,
+        endStep: -2,
+        totalSteps: 20,
+        normalizedStartStep: 2,
+        normalizedEndStep: 18,
+        upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
+        adapterVersion: TEACACHE_ADAPTER_VERSION,
+        adapterDigest: "a".repeat(64),
+        catalogDigest: "b".repeat(64),
+        topologyDigest: "c".repeat(64),
+        patchNode: {
+          nodeId: "401",
+          classType: TEACACHE_NODE_KEY,
+          inputs: {
+            model: ["6", 0],
+            rel_l1_thresh: 0.15,
+            start_step: 2,
+            end_step: -2,
+            total_steps: 20
+          }
+        }
+      };
+
+      const parsed = MinimaxH3TeaCacheRequestSchema.parse(req);
+      expect(parsed.mode).toBe("raw-l1-v1");
+      expect(parsed.patchNode?.nodeId).toBe("401");
+      expect(parsed.patchNode?.classType).toBe("CCOMiniMaxH3TeaCache");
+    });
+  });
+
+  describe("MinimaxH3TeaCacheObservationSchema", () => {
+    it("parses verified observation", () => {
+      const obs = {
+        status: "verified" as const,
+        mode: "raw-l1-v1" as const,
+        requestedConfig: {
+          mode: "raw-l1-v1" as const,
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20 as const,
+          normalizedStartStep: 2,
+          normalizedEndStep: 18
+        },
+        effectiveConfig: {
+          mode: "raw-l1-v1" as const,
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20 as const,
+          normalizedStartStep: 2,
+          normalizedEndStep: 18
+        },
+        totalSteps: 20,
+        forwardCallsRecorded: 12,
+        cacheHitsRecorded: 8,
+        nestedForwardsOnHits: 0,
+        coverage: {
+          samplingCallsRecorded: 1,
+          modelForwardsRecorded: 12,
+          complete: true
+        },
+        timings: {
+          samplingWallMs: 42100,
+          modelForwardElapsedMs: 38200,
+          decisionOverheadMs: 120,
+          timingUnavailableReason: null
+        },
+        failureReason: null
+      };
+
+      const parsed = MinimaxH3TeaCacheObservationSchema.parse(obs);
+      expect(parsed.status).toBe("verified");
+      expect(parsed.forwardCallsRecorded).toBe(12);
+      expect(parsed.cacheHitsRecorded).toBe(8);
+    });
+
+    it("parses no_op observation with zero hits", () => {
+      const obs = {
+        status: "no_op" as const,
+        mode: "raw-l1-v1" as const,
+        requestedConfig: null,
+        effectiveConfig: null,
+        totalSteps: 20,
+        forwardCallsRecorded: 20,
+        cacheHitsRecorded: 0,
+        coverage: {
+          samplingCallsRecorded: 1,
+          modelForwardsRecorded: 20,
+          complete: true
+        },
+        timings: {
+          samplingWallMs: 58000,
+          modelForwardElapsedMs: 56000,
+          decisionOverheadMs: 150
+        }
+      };
+
+      const parsed = MinimaxH3TeaCacheObservationSchema.parse(obs);
+      expect(parsed.status).toBe("no_op");
+      expect(parsed.cacheHitsRecorded).toBe(0);
+    });
+  });
+
+  describe("FactorChangeCachingConfigSchema in MinimaxH3FactorChangeSchema", () => {
+    it("parses caching.configuration factor change", () => {
+      const factor = {
+        path: "caching.configuration",
+        before: {
+          mode: "off",
+          relL1Thresh: null,
+          startStep: null,
+          endStep: null,
+          totalSteps: null,
+          topologyDigest: "0".repeat(64),
+          adapterVersion: null
+        },
+        after: {
+          mode: "raw-l1-v1",
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20,
+          topologyDigest: "1".repeat(64),
+          adapterVersion: TEACACHE_ADAPTER_VERSION
+        },
+        rationale: "TeaCache timestep caching experiment"
+      };
+
+      const parsed = MinimaxH3FactorChangeSchema.parse(factor);
+      expect(parsed.path).toBe("caching.configuration");
+    });
+  });
+
+  describe("computeTeaCacheTopologyDigest & computeTeaCacheConfigDigest", () => {
+    it("computes deterministic digests", () => {
+      const patch = {
+        nodeId: "401",
+        classType: TEACACHE_NODE_KEY as typeof TEACACHE_NODE_KEY,
+        inputs: {
+          model: ["6", 0] as [string, number],
+          rel_l1_thresh: 0.15,
+          start_step: 2,
+          end_step: -2,
+          total_steps: 20
+        }
+      };
+
+      const d1 = computeTeaCacheTopologyDigest(patch);
+      const d2 = computeTeaCacheTopologyDigest(patch);
+      expect(d1).toBe(d2);
+      expect(d1).toMatch(/^[0-9a-f]{64}$/);
+
+      const dNull = computeTeaCacheTopologyDigest(null);
+      expect(dNull).not.toBe(d1);
+
+      const cfgDigest = computeTeaCacheConfigDigest({
+        workflowDigest: "a".repeat(64),
+        argv: ["--listen"],
+        teacacheConfig: {
+          mode: "raw-l1-v1",
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20,
+          normalizedStartStep: 2,
+          normalizedEndStep: 18
+        }
+      });
+      expect(cfgDigest).toMatch(/^[0-9a-f]{64}$/);
+    });
+  });
+
+  describe("createEmptyTeaCacheObservation", () => {
+    it("initializes empty observation with requested config and unknown timings", () => {
+      const req: MinimaxH3TeaCacheRequest = {
+        mode: "raw-l1-v1",
+        relL1Thresh: 0.1,
+        startStep: 2,
+        endStep: 18,
+        totalSteps: 20,
+        normalizedStartStep: 2,
+        normalizedEndStep: 18,
+        upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
+        adapterVersion: TEACACHE_ADAPTER_VERSION,
+        adapterDigest: "a".repeat(64),
+        catalogDigest: "b".repeat(64),
+        topologyDigest: "c".repeat(64),
+        patchNode: {
+          nodeId: "401",
+          classType: TEACACHE_NODE_KEY,
+          inputs: {
+            model: ["6", 0],
+            rel_l1_thresh: 0.1,
+            start_step: 2,
+            end_step: 18,
+            total_steps: 20
+          }
+        }
+      };
+
+      const empty = createEmptyTeaCacheObservation(req);
+      expect(empty.status).toBe("unknown");
+      expect(empty.mode).toBe("raw-l1-v1");
+      expect(empty.requestedConfig?.relL1Thresh).toBe(0.1);
+      expect(empty.forwardCallsRecorded).toBeNull();
+      expect(empty.cacheHitsRecorded).toBeNull();
+      expect(empty.coverage.complete).toBe(false);
+      expect(empty.timings.timingUnavailableReason).toBe("Prior to execution");
+    });
+  });
+});
diff --git a/packages/contracts/src/minimax-h3-teacache.ts b/packages/contracts/src/minimax-h3-teacache.ts
new file mode 100644
index 0000000..921a5e0
--- /dev/null
+++ b/packages/contracts/src/minimax-h3-teacache.ts
@@ -0,0 +1,426 @@
+import { z } from "zod";
+import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";
+import { sha256HashSchema } from "./persistent-media.js";
+import { MinimaxH3SourceEvidenceRefSchema } from "./minimax-h3-attention.js";
+
+// ---------------------------------------------------------------------------
+// Constants & Pinned Identities
+// ---------------------------------------------------------------------------
+export const TEACACHE_UPSTREAM_COMMIT = "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f";
+export const TEACACHE_UPSTREAM_REPO = "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache";
+export const TEACACHE_ADAPTER_VERSION = "0.1.0-cco-experimental";
+export const TEACACHE_NODE_CLASS = "CCOMiniMaxH3TeaCacheNode";
+export const TEACACHE_NODE_KEY = "CCOMiniMaxH3TeaCache";
+export const TEACACHE_PATCH_NODE_ID = "401";
+
+export const TEACACHE_SUPPORTED_THRESHOLDS = Object.freeze([0.05, 0.1, 0.15]);
+export const TEACACHE_DEFAULT_THRESHOLD = 0.15;
+export const TEACACHE_DEFAULT_START_STEP = 2;
+export const TEACACHE_DEFAULT_END_STEP = -2;
+export const TEACACHE_TOTAL_STEPS = 20;
+
+export const TEACACHE_SOURCE_FILE_HASHES = Object.freeze({
+  "nodes.py": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
+  "teacache.py": "97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f",
+  LICENSE: "ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67",
+  "pyproject.toml": "e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be",
+  "__init__.py": "8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416"
+});
+
+export const TEACACHE_LOCAL_ADAPTER_FILE_HASHES = Object.freeze({
+  "__init__.py": "3b14b0a4da6f0fa366d8da492ea85ce74f2a63f18336ac63970d9d2bfe128c94",
+  "nodes.py": "ea16ae7ced6ab1ddfe7ba729a0a0c7047827f1e5601c6fd5c8363b837dd17d2c",
+  // Updated for issue #467 follow-up-review fixes: mandatory sigmas/timestep
+  // validation, same-model session-ownership guard, and conditioning-manifest
+  // binding added to TeaCacheSession (see teacache.py).
+  "teacache.py": "ffd3c347182b31d85677e24c1bcf5386f0f49b354690a01e545c972c9756a19a"
+});
+
+export const TEACACHE_LOCAL_ADAPTER_DIGEST = sha256Hex(
+  canonicalizeJson(TEACACHE_LOCAL_ADAPTER_FILE_HASHES)
+);
+
+export function computeLocalTeaCacheAdapterDigest(fileHashes: Record<string, string>): string {
+  return sha256Hex(canonicalizeJson(fileHashes));
+}
+
+// ---------------------------------------------------------------------------
+// Schemas
+// ---------------------------------------------------------------------------
+export const MinimaxH3TeaCacheModeSchema = z.enum(["off", "raw-l1-v1"]);
+export type MinimaxH3TeaCacheMode = z.infer<typeof MinimaxH3TeaCacheModeSchema>;
+
+export const MinimaxH3TeaCachePatchNodeInputsSchema = z
+  .object({
+    model: z.tuple([z.string().min(1), z.number().int().nonnegative()]),
+    rel_l1_thresh: z
+      .number()
+      .refine(
+        (v) =>
+          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
+        {
+          message: `rel_l1_thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
+        }
+      ),
+    start_step: z.number().int().min(0),
+    end_step: z.number().int(),
+    total_steps: z.number().int().positive()
+  })
+  .strict();
+export type MinimaxH3TeaCachePatchNodeInputs = z.infer<
+  typeof MinimaxH3TeaCachePatchNodeInputsSchema
+>;
+
+export const MinimaxH3TeaCachePatchNodeSchema = z
+  .object({
+    nodeId: z.string().min(1),
+    classType: z.literal(TEACACHE_NODE_KEY),
+    inputs: MinimaxH3TeaCachePatchNodeInputsSchema
+  })
+  .strict();
+export type MinimaxH3TeaCachePatchNode = z.infer<typeof MinimaxH3TeaCachePatchNodeSchema>;
+
+export const MinimaxH3TeaCacheConfigSchema = z
+  .object({
+    mode: MinimaxH3TeaCacheModeSchema,
+    relL1Thresh: z
+      .number()
+      .refine(
+        (v) =>
+          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
+        {
+          message: `relL1Thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
+        }
+      ),
+    startStep: z.number().int().min(0),
+    endStep: z.number().int(),
+    totalSteps: z.literal(20),
+    normalizedStartStep: z.number().int().min(2),
+    normalizedEndStep: z.number().int().max(18)
+  })
+  .strict();
+export type MinimaxH3TeaCacheConfig = z.infer<typeof MinimaxH3TeaCacheConfigSchema>;
+
+export const MinimaxH3TeaCacheRequestSchema = z
+  .object({
+    mode: MinimaxH3TeaCacheModeSchema,
+    relL1Thresh: z
+      .number()
+      .refine(
+        (v) =>
+          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
+        {
+          message: `relL1Thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
+        }
+      ),
+    startStep: z.number().int().min(0),
+    endStep: z.number().int(),
+    totalSteps: z.literal(20),
+    normalizedStartStep: z.number().int().min(2),
+    normalizedEndStep: z.number().int().max(18),
+    upstreamCommit: z.string().min(1),
+    adapterVersion: z.string().min(1),
+    adapterDigest: sha256HashSchema,
+    catalogDigest: sha256HashSchema,
+    topologyDigest: sha256HashSchema,
+    patchNode: MinimaxH3TeaCachePatchNodeSchema.nullable()
+  })
+  .strict();
+export type MinimaxH3TeaCacheRequest = z.infer<typeof MinimaxH3TeaCacheRequestSchema>;
+
+export const MinimaxH3TeaCacheObservationCoverageSchema = z
+  .object({
+    samplingCallsRecorded: z.number().int().nonnegative(),
+    modelForwardsRecorded: z.number().int().nonnegative().nullable(),
+    complete: z.boolean()
+  })
+  .strict();
+export type MinimaxH3TeaCacheObservationCoverage = z.infer<
+  typeof MinimaxH3TeaCacheObservationCoverageSchema
+>;
+
+export const MinimaxH3TeaCacheObservationTimingsSchema = z
+  .object({
+    samplingWallMs: z.number().nonnegative().nullable(),
+    modelForwardElapsedMs: z.number().nonnegative().nullable(),
+    decisionOverheadMs: z.number().nonnegative().nullable(),
+    timingUnavailableReason: z.string().min(1).nullable().optional()
+  })
+  .strict();
+export type MinimaxH3TeaCacheObservationTimings = z.infer<
+  typeof MinimaxH3TeaCacheObservationTimingsSchema
+>;
+
+export const MinimaxH3TeaCacheObservationSchema = z
+  .object({
+    status: z.enum(["verified", "no_op", "failed", "unknown"]),
+    mode: MinimaxH3TeaCacheModeSchema,
+    requestedConfig: MinimaxH3TeaCacheConfigSchema.nullable(),
+    effectiveConfig: MinimaxH3TeaCacheConfigSchema.nullable(),
+    totalSteps: z.number().int().nonnegative(),
+    forwardCallsRecorded: z.number().int().nonnegative().nullable(),
+    cacheHitsRecorded: z.number().int().nonnegative().nullable(),
+    unattributedCallsRecorded: z.number().int().nonnegative().optional(),
+    nestedForwardsOnHits: z.number().int().nonnegative().nullable().optional(),
+    coverage: MinimaxH3TeaCacheObservationCoverageSchema,
+    timings: MinimaxH3TeaCacheObservationTimingsSchema,
+    failureReason: z.string().min(1).nullable().optional(),
+    sessionId: z.string().min(1).nullable().optional(),
+    sessionAttempts: z.number().int().nonnegative().optional()
+  })
+  .strict();
+export type MinimaxH3TeaCacheObservation = z.infer<typeof MinimaxH3TeaCacheObservationSchema>;
+
+export const FactorChangeCachingConfigSummarySchema = z
+  .object({
+    mode: MinimaxH3TeaCacheModeSchema,
+    relL1Thresh: z.number().nullable().optional(),
+    startStep: z.number().int().nullable().optional(),
+    endStep: z.number().int().nullable().optional(),
+    totalSteps: z.number().int().nullable().optional(),
+    topologyDigest: sha256HashSchema.nullable().optional(),
+    adapterVersion: z.string().nullable().optional()
+  })
+  .strict();
+export type FactorChangeCachingConfigSummary = z.infer<
+  typeof FactorChangeCachingConfigSummarySchema
+>;
+
+export const MinimaxH3TeaCacheVariantNameSchema = z.enum([
+  "teacache-raw-l1",
+  "matched-control",
+  "off"
+]);
+export type MinimaxH3TeaCacheVariantName = z.infer<typeof MinimaxH3TeaCacheVariantNameSchema>;
+
+export const MinimaxH3TeaCacheCatalogEntrySchema = z
+  .object({
+    variantName: MinimaxH3TeaCacheVariantNameSchema,
+    route: z.enum(["i2v", "ref2v"]),
+    compatibilityState: z.enum(["supported", "unverified", "unsupported"]),
+    scope: z.string().min(1),
+    comfyuiCoreRevision: z.string().min(1),
+    customNode: z
+      .object({
+        name: z.string().min(1),
+        repository: z.string().min(1),
+        revision: z.string().min(1),
+        entrypoint: z.string().optional()
+      })
+      .strict(),
+    runnable: z.boolean(),
+    supportedThresholds: z.array(z.number()),
+    defaultThreshold: z.number(),
+    stepWindow: z
+      .object({
+        minStartStep: z.number().int(),
+        maxEndStep: z.number().int(),
+        defaultStartStep: z.number().int(),
+        defaultEndStep: z.number().int(),
+        requiredTotalSteps: z.literal(20)
+      })
+      .strict(),
+    pythonPackages: z.array(
+      z
+        .object({
+          name: z.string().min(1),
+          version: z.string().min(1),
+          artifactHash: sha256HashSchema.optional(),
+          artifactMethod: z.string().optional(),
+          importModule: z.string().optional()
+        })
+        .strict()
+    ),
+    cudaRequirement: z.string().min(1),
+    computeCapability: z.string().min(1),
+    checkpointCompatibility: z
+      .object({
+        filename: z.string().min(1),
+        sha256: sha256HashSchema,
+        taskMode: z.string().min(1)
+      })
+      .strict(),
+    licensing: z
+      .object({
+        status: z.enum(["approved", "restricted", "review_required", "unverified"]),
+        licenseSourceRef: z.string().min(1),
+        securityReviewStatus: z.enum(["passed", "pending", "flagged"])
+      })
+      .strict(),
+    isolationInstructions: z
+      .object({
+        venvSetup: z.string().min(1),
+        installRecipe: z.string().min(1),
+        teardownRecipe: z.string().min(1)
+      })
+      .strict(),
+    blockers: z.array(z.string().min(1)),
+    evidence: z.array(MinimaxH3SourceEvidenceRefSchema),
+    catalogDigest: sha256HashSchema
+  })
+  .strict();
+export type MinimaxH3TeaCacheCatalogEntry = z.infer<typeof MinimaxH3TeaCacheCatalogEntrySchema>;
+
+// ---------------------------------------------------------------------------
+// Helper Functions
+// ---------------------------------------------------------------------------
+export function normalizeTeaCacheWindow(params: {
+  startStep: number;
+  endStep: number;
+  totalSteps: number;
+}): {
+  startStep: number;
+  endStep: number;
+  totalSteps: 20;
+  normalizedStartStep: number;
+  normalizedEndStep: number;
+} {
+  const { startStep, endStep, totalSteps } = params;
+  if (totalSteps !== TEACACHE_TOTAL_STEPS) {
+    throw new Error(
+      `TeaCache currently requires total_steps to be exactly ${TEACACHE_TOTAL_STEPS}, got ${totalSteps}.`
+    );
+  }
+
+  if (!Number.isInteger(startStep) || !Number.isInteger(endStep)) {
+    throw new Error(
+      `TeaCache step window boundaries must be integers, got start=${startStep}, end=${endStep}.`
+    );
+  }
+
+  const effectiveEnd = endStep < 0 ? totalSteps + endStep : endStep;
+
+  if (startStep < 2) {
+    throw new Error(
+      `TeaCache startStep must be >= 2 to preserve early denoising steps, got ${startStep}.`
+    );
+  }
+
+  if (effectiveEnd > 18) {
+    throw new Error(
+      `TeaCache effective endStep must be <= 18 to preserve final denoising steps, got ${effectiveEnd} (from end_step ${endStep}).`
+    );
+  }
+
+  if (startStep >= effectiveEnd) {
+    throw new Error(
+      `TeaCache window [start_step, effective_end) is empty or inverted: [${startStep}, ${effectiveEnd}).`
+    );
+  }
+
+  return {
+    startStep,
+    endStep,
+    totalSteps: 20,
+    normalizedStartStep: startStep,
+    normalizedEndStep: effectiveEnd
+  };
+}
+
+export function validateTeaCacheParameters(params: {
+  relL1Thresh: number;
+  startStep: number;
+  endStep: number;
+  totalSteps: number;
+}): {
+  relL1Thresh: number;
+  startStep: number;
+  endStep: number;
+  totalSteps: 20;
+  normalizedStartStep: number;
+  normalizedEndStep: number;
+} {
+  const { relL1Thresh } = params;
+  if (typeof relL1Thresh !== "number" || !Number.isFinite(relL1Thresh)) {
+    throw new Error(`TeaCache rel_l1_thresh must be a finite number, got ${relL1Thresh}.`);
+  }
+
+  if (!(TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(relL1Thresh)) {
+    throw new Error(
+      `TeaCache rel_l1_thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}], got ${relL1Thresh}.`
+    );
+  }
+
+  const window = normalizeTeaCacheWindow({
+    startStep: params.startStep,
+    endStep: params.endStep,
+    totalSteps: params.totalSteps
+  });
+
+  return {
+    relL1Thresh,
+    ...window
+  };
+}
+
+export function computeTeaCacheTopologyDigest(
+  patch: MinimaxH3TeaCachePatchNode | null | undefined
+): string {
+  if (!patch) {
+    return sha256Hex(canonicalizeJson(null));
+  }
+  return sha256Hex(canonicalizeJson(patch));
+}
+
+export function computeTeaCacheConfigDigest(params: {
+  workflowDigest: string;
+  argv: readonly string[];
+  teacacheConfig: MinimaxH3TeaCacheConfig | null | undefined;
+}): string {
+  return sha256Hex(
+    canonicalizeJson({
+      workflowDigest: params.workflowDigest,
+      argv: params.argv,
+      teacacheConfig: params.teacacheConfig ?? null
+    })
+  );
+}
+
+export function computeTeaCacheCatalogDigest(
+  entry: Omit<MinimaxH3TeaCacheCatalogEntry, "catalogDigest"> | MinimaxH3TeaCacheCatalogEntry
+): string {
+  const copy = { ...entry } as Record<string, unknown>;
+  delete copy.catalogDigest;
+  return sha256Hex(canonicalizeJson(copy));
+}
+
+export function createEmptyTeaCacheObservation(
+  request?: MinimaxH3TeaCacheRequest | null
+): MinimaxH3TeaCacheObservation {
+  const mode = request?.mode ?? "off";
+  const requestedConfig: MinimaxH3TeaCacheConfig | null =
+    request && request.mode !== "off"
+      ? {
+          mode: request.mode,
+          relL1Thresh: request.relL1Thresh,
+          startStep: request.startStep,
+          endStep: request.endStep,
+          totalSteps: 20,
+          normalizedStartStep: request.normalizedStartStep,
+          normalizedEndStep: request.normalizedEndStep
+        }
+      : null;
+
+  return {
+    status: "unknown",
+    mode,
+    requestedConfig,
+    effectiveConfig: null,
+    totalSteps: request?.totalSteps ?? 20,
+    forwardCallsRecorded: null,
+    cacheHitsRecorded: null,
+    nestedForwardsOnHits: null,
+    coverage: {
+      samplingCallsRecorded: 0,
+      modelForwardsRecorded: null,
+      complete: false
+    },
+    timings: {
+      samplingWallMs: null,
+      modelForwardElapsedMs: null,
+      decisionOverheadMs: null,
+      timingUnavailableReason: "Prior to execution"
+    },
+    failureReason: null
+  };
+}
diff --git a/packages/infrastructure/src/experiments/minimax-h3-collector.py b/packages/infrastructure/src/experiments/minimax-h3-collector.py
index ea1fc16..2b709e0 100644
--- a/packages/infrastructure/src/experiments/minimax-h3-collector.py
+++ b/packages/infrastructure/src/experiments/minimax-h3-collector.py
@@ -638,6 +638,149 @@ VERIFIED_VEDA_EXCLUSION_REASONS = frozenset(
     _VEDA_EXCLUSION_SPEC.get("supportedExclusionReasons", ["full-attention layer", "full-attention step"])
 )
 
+def _resolve_teacache_module(guider=None, model_patcher=None):
+    # 1. Inspect model_patcher or guider for wrapped model
+    mp = model_patcher
+    if mp is None and guider is not None:
+        mp = getattr(guider, "model_patcher", None) or getattr(guider, "model", None)
+    if mp is not None:
+        opts = getattr(mp, "model_options", None)
+        if isinstance(opts, dict):
+            wrapper = opts.get("model_function_wrapper")
+            while hasattr(wrapper, "__wrapped__"):
+                wrapper = getattr(wrapper, "__wrapped__")
+            if wrapper is not None:
+                mod = getattr(wrapper, "_teacache_module", None)
+                if mod is not None and hasattr(mod, "TeaCacheSession"):
+                    return mod
+                fn_globals = getattr(wrapper, "__globals__", {})
+                mod = fn_globals.get("_teacache_mod") or fn_globals.get("teacache")
+                if mod is not None and hasattr(mod, "TeaCacheSession"):
+                    return mod
+
+    # 2. Check ComfyUI registered node classes if available
+    try:
+        import nodes as comfy_nodes
+        mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
+        for key in ("CCOMiniMaxH3TeaCache", "MiniMaxH3TeaCache"):
+            if key in mappings:
+                cls = mappings[key]
+                mod = getattr(cls, "_teacache_module", None)
+                if mod is not None and hasattr(mod, "TeaCacheSession"):
+                    return mod
+                cls_mod = sys.modules.get(cls.__module__)
+                if cls_mod is not None:
+                    mod = getattr(cls_mod, "_teacache_mod", None) or getattr(cls_mod, "teacache", None)
+                    if mod is not None and hasattr(mod, "TeaCacheSession"):
+                        return mod
+    except Exception:
+        pass
+
+    # 3. Search sys.modules for loaded adapter packages
+    for mod_name, mod in list(sys.modules.items()):
+        if mod is not None and hasattr(mod, "CCOMiniMaxH3TeaCacheNode"):
+            tc_mod = getattr(mod, "_teacache_module", None) or getattr(mod, "_teacache_mod", None) or getattr(mod, "teacache", None)
+            if tc_mod is not None and hasattr(tc_mod, "TeaCacheSession"):
+                return tc_mod
+
+    for mod_name, mod in list(sys.modules.items()):
+        if mod is not None and (mod_name.endswith(".teacache") or mod_name == "teacache"):
+            if hasattr(mod, "TeaCacheSession") and hasattr(mod, "get_active_session") and hasattr(mod, "set_active_session"):
+                return mod
+
+    # 4. Check custom_nodes directories for staged cco-minimax-h3-teacache
+    for base in [os.getcwd(), "/opt/comfyui-isolated-teacache"]:
+        cn_dir = os.path.join(base, "custom_nodes")
+        if os.path.isdir(cn_dir):
+            for entry in ["cco-minimax-h3-teacache", "ComfyUI-MiniMaxH3-TeaCache", "minimax-h3-teacache"]:
+                pkg_path = os.path.join(cn_dir, entry)
+                tc_file = os.path.join(pkg_path, "teacache.py")
+                if os.path.isfile(tc_file):
+                    try:
+                        import importlib.util
+                        spec = importlib.util.spec_from_file_location(f"custom_nodes_{entry.replace('-', '_')}_teacache", tc_file)
+                        if spec and spec.loader:
+                            mod = importlib.util.module_from_spec(spec)
+                            spec.loader.exec_module(mod)
+                            if hasattr(mod, "TeaCacheSession"):
+                                return mod
+                    except Exception:
+                        pass
+
+    # 5. Fallback import
+    try:
+        from experiments.minimax_h3_teacache import teacache
+        return teacache
+    except Exception:
+        pass
+    try:
+        import teacache
+        return teacache
+    except Exception:
+        pass
+    candidates = [
+        os.path.join(os.getcwd(), "experiments", "minimax-h3-teacache"),
+        os.path.join(os.path.dirname(__file__), "../../../../experiments/minimax-h3-teacache")
+    ]
+    for cdir in candidates:
+        norm = os.path.normpath(cdir)
+        if os.path.exists(norm) and norm not in sys.path:
+            sys.path.insert(0, norm)
+            try:
+                import teacache
+                return teacache
+            except Exception:
+                pass
+    return None
+
+# Pinned post-adaptation local-file digest for the staged TeaCache adapter
+# package, matching packages/contracts/src/minimax-h3-teacache.ts's
+# TEACACHE_LOCAL_ADAPTER_DIGEST exactly (same three files, same
+# json.dumps(sort_keys=True, separators=(",", ":")) canonicalization). Kept
+# here (rather than only checked statically pre-run by runtime-registry.ts)
+# so the digest of the module *actually resolved and bound* at sampling time
+# is itself verified -- a static pre-flight check cannot prove that a later
+# runtime resolution step didn't substitute a different, unverified copy.
+TEACACHE_LOCAL_ADAPTER_DIGEST = "0f5fa82271230dfe93567f7cbe07d8e1d5af13998f6efde68c3918c30e6673d7"
+
+
+def _compute_teacache_adapter_digest(package_dir: str) -> Optional[str]:
+    try:
+        file_hashes = {}
+        for fname in ("__init__.py", "nodes.py", "teacache.py"):
+            fpath = os.path.join(package_dir, fname)
+            if not os.path.isfile(fpath):
+                return None
+            with open(fpath, "rb") as f:
+                file_hashes[fname] = hashlib.sha256(f.read()).hexdigest()
+        payload = json.dumps(file_hashes, sort_keys=True, separators=(",", ":"))
+        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
+    except Exception:
+        return None
+
+
+def _verify_teacache_adapter_identity(tc_mod) -> Dict[str, Any]:
+    """Hash the actually-resolved adapter module's directory and compare
+    against the pinned local-adapter digest. Returns a dict describing the
+    verification outcome; never raises (the caller decides how to act)."""
+    mod_file = getattr(tc_mod, "__file__", None)
+    if not mod_file:
+        return {"verified": False, "reason": "resolved_module_has_no___file__"}
+    package_dir = os.path.dirname(os.path.abspath(mod_file))
+    digest = _compute_teacache_adapter_digest(package_dir)
+    if digest is None:
+        return {"verified": False, "reason": "missing_adapter_files", "packageDir": package_dir}
+    if digest != TEACACHE_LOCAL_ADAPTER_DIGEST:
+        return {
+            "verified": False,
+            "reason": "digest_mismatch",
+            "packageDir": package_dir,
+            "observedDigest": digest,
+            "expectedDigest": TEACACHE_LOCAL_ADAPTER_DIGEST
+        }
+    return {"verified": True, "packageDir": package_dir, "observedDigest": digest}
+
+
 def extract_layer_and_step(args, kwargs):
     layer = None
     step = None
@@ -1284,6 +1427,14 @@ def register_capability_route(prompt_server, collector: Collector):
             except Exception:
                 pass
 
+            teacache_adapter_identity = None
+            try:
+                _tc_mod_probe = _resolve_teacache_module()
+                if _tc_mod_probe is not None:
+                    teacache_adapter_identity = _verify_teacache_adapter_identity(_tc_mod_probe)
+            except Exception:
+                pass
+
             all_hooks_attached = bool(installed_hooks and all(h.get("attached", False) for h in installed_hooks))
             if _HOOK_INSTALL_ERROR:
                 status_val = "failed"
@@ -1316,6 +1467,7 @@ def register_capability_route(prompt_server, collector: Collector):
                 "registeredNodes": registered_nodes,
                 "packageIdentities": package_identities,
                 "sourceIdentities": source_identities,
+                "teacacheAdapterIdentity": teacache_adapter_identity,
                 "runtimeVersions": {
                     "pythonVersion": python_ver,
                     "pythonExecutableHash": python_executable_hash,
@@ -1589,11 +1741,178 @@ def _install_hooks_inner(collector: Collector):
                 buf = StepIntervalBuffer()
                 token_buf = _SAMPLING_STEP_CALL_BUFFER.set(buf)
 
+                # Inspect guider / model_patcher for TeaCache and diffusion_model
+                model_patcher = getattr(guider, "model_patcher", None)
+                if model_patcher is None:
+                    model_patcher = getattr(guider, "model", None)
+
+                teacache_config = None
+                if model_patcher is not None and hasattr(model_patcher, "model_options") and isinstance(model_patcher.model_options, dict):
+                    teacache_config = model_patcher.model_options.get("teacache_config")
+                if teacache_config is None and hasattr(guider, "model_options") and isinstance(guider.model_options, dict):
+                    teacache_config = guider.model_options.get("teacache_config")
+
+                base_model = getattr(model_patcher, "model", None) if model_patcher else None
+                if base_model is None:
+                    base_model = getattr(guider, "model", None)
+                diffusion_model = getattr(base_model, "diffusion_model", None) if base_model else None
+
+                # Hook diffusion_model.forward for independent forward counting
+                orig_diff_forward = getattr(diffusion_model, "forward", None) if diffusion_model else None
+                diff_forward_count = 0
+                tc_session = None
+                tc_token = None
+                if orig_diff_forward is not None and callable(orig_diff_forward):
+                    def hooked_diff_forward(*df_args, **df_kwargs):
+                        nonlocal diff_forward_count
+                        if tc_session is not None and getattr(tc_session, "is_evaluating_hit", False):
+                            tc_session.nested_forwards_on_hits += 1
+                        now_start = now_mono_ms()
+                        df_span_id = collector.next_span_id("diff_fwd")
+                        collector.emit(
+                            "sampling",
+                            "span_start",
+                            span_id=df_span_id,
+                            parent_span_id=sampler_span_id,
+                            monotonic_ms=now_start,
+                            metadata={"modelForwardCall": True, "phase": "diffusion_forward"}
+                        )
+                        try:
+                            res = orig_diff_forward(*df_args, **df_kwargs)
+                            diff_forward_count += 1
+                            collector.emit(
+                                "sampling",
+                                "span_end",
+                                span_id=df_span_id,
+                                parent_span_id=sampler_span_id,
+                                monotonic_ms=now_mono_ms(),
+                                outcome="success",
+                                metadata={"modelForwardCall": True, "phase": "diffusion_forward"}
+                            )
+                            return res
+                        except Exception as e:
+                            collector.emit(
+                                "sampling",
+                                "span_end",
+                                span_id=df_span_id,
+                                parent_span_id=sampler_span_id,
+                                monotonic_ms=now_mono_ms(),
+                                outcome="failed",
+                                error={"message": str(e), "exceptionType": type(e).__name__},
+                                metadata={"modelForwardCall": True, "phase": "diffusion_forward"}
+                            )
+                            raise
+                    diffusion_model.forward = hooked_diff_forward
+
+                # Setup TeaCache session if configured. This is deliberately
+                # fail-closed: if anything after a real session object exists
+                # raises (set_active_session's ownership check, advance_step's
+                # validation, or the emit below), we must not leave a session
+                # registered as active -- that would leak into every later
+                # render in this process and either permanently block the
+                # model_id (ownership guard) or let the dead session's stale
+                # state be read by an unrelated later run. On any failure here
+                # we unwind whatever was partially set up and re-raise rather
+                # than silently continuing without TeaCache.
+                tc_mod = _resolve_teacache_module(guider=guider, model_patcher=model_patcher)
+                tc_adapter_identity = None
+                if tc_mod is not None:
+                    tc_adapter_identity = _verify_teacache_adapter_identity(tc_mod)
+                    if teacache_config is not None and not tc_adapter_identity.get("verified"):
+                        raise RuntimeError(
+                            "TeaCache adapter identity verification failed: "
+                            f"{tc_adapter_identity}. Refusing to use an unverified/substituted "
+                            "adapter module for a configured TeaCache render."
+                        )
+                if tc_mod is not None and teacache_config is not None:
+                    def on_tc_event(*cb_args, **cb_kwargs):
+                        evt_name = cb_kwargs.get("event", "unknown")
+                        collector.emit(
+                            "sampling",
+                            "point_event",
+                            metadata={
+                                "teacacheEvent": evt_name,
+                                **cb_kwargs
+                            }
+                        )
+                    sigmas_list = sigmas.tolist() if hasattr(sigmas, "tolist") else list(sigmas) if isinstance(sigmas, (list, tuple)) else None
+                    session_id = collector.next_span_id("teacache_session")
+                    tc_thresh = teacache_config.get("rel_l1_thresh", teacache_config.get("threshold", 0.15))
+                    tc_start = teacache_config.get("start_step", 2)
+                    tc_end = teacache_config.get("end_step", -2)
+                    tc_total = teacache_config.get("total_steps", 20)
+                    tc_session = tc_mod.TeaCacheSession(
+                        session_id=session_id,
+                        model_id=teacache_config.get("model_id"),
+                        rel_l1_thresh=tc_thresh,
+                        start_step=tc_start,
+                        end_step=tc_end,
+                        total_steps=tc_total,
+                        sigmas=sigmas_list,
+                        event_callback=on_tc_event
+                    )
+                    try:
+                        tc_token = tc_mod.set_active_session(tc_session)
+                        tc_session.advance_step(0)
+                        collector.emit(
+                            "sampling",
+                            "point_event",
+                            metadata={
+                                "teacacheEvent": "session_init",
+                                "sessionId": tc_session.session_id,
+                                "adapterIdentity": tc_adapter_identity,
+                                "effectiveConfig": {
+                                    "mode": "raw-l1-v1",
+                                    "relL1Thresh": tc_session.rel_l1_thresh,
+                                    "startStep": tc_session.start_step,
+                                    "endStep": getattr(tc_session, "raw_end_step", tc_session.end_step),
+                                    "totalSteps": tc_session.total_steps,
+                                    "normalizedStartStep": tc_session.start_step,
+                                    "normalizedEndStep": tc_session.end_step
+                                }
+                            }
+                        )
+                    except Exception:
+                        try:
+                            tc_session.cleanup()
+                        finally:
+                            if tc_token is not None:
+                                tc_mod.reset_active_session(tc_token)
+                            tc_session = None
+                            tc_token = None
+                        raise
+                elif tc_session is None and os.environ.get("CCO_EXPERIMENT_TEACACHE_MODE") == "off":
+                    collector.emit(
+                        "sampling",
+                        "point_event",
+                        metadata={
+                            "teacacheEvent": "session_init",
+                            "effectiveConfig": {
+                                "mode": "off",
+                                "relL1Thresh": 0.15,
+                                "startStep": 2,
+                                "endStep": 18,
+                                "totalSteps": 20,
+                                "normalizedStartStep": 2,
+                                "normalizedEndStep": 18
+                            }
+                        }
+                    )
+
                 def step_callback(chain_cb):
                     def cb(step, x0, x, total_s, *cb_args, **cb_kwargs):
                         cur_idx = _parse_nonnegative_int(step)
                         if cur_idx is not None:
                             flush_step_buffer(cur_idx)
+                            if tc_session is not None:
+                                if cur_idx + 1 < tc_session.total_steps:
+                                    # Deliberately not caught: a session-state
+                                    # error here means TeaCache's step/cache
+                                    # invariants are already violated, and
+                                    # continuing to sample with a corrupted
+                                    # session would silently serve wrong
+                                    # cached output. Fail the render instead.
+                                    tc_session.advance_step(cur_idx + 1)
                             if cur_idx not in state["seen_steps"]:
                                 state["seen_steps"].add(cur_idx)
                                 now = now_mono_ms()
@@ -1668,6 +1987,68 @@ def _install_hooks_inner(collector: Collector):
                     )
                     raise
                 finally:
+                    if orig_diff_forward is not None and diffusion_model is not None:
+                        diffusion_model.forward = orig_diff_forward
+
+                    if tc_session is not None:
+                        try:
+                            summary = {
+                                "mode": "raw-l1-v1",
+                                "sessionId": tc_session.session_id,
+                                "forwardCalls": tc_session.forward_calls_count,
+                                "cacheHits": tc_session.cache_hits_count,
+                                "totalSteps": tc_session.total_steps,
+                                "nestedForwardsOnHits": tc_session.nested_forwards_on_hits,
+                                "effectiveConfig": {
+                                    "mode": "raw-l1-v1",
+                                    "relL1Thresh": tc_session.rel_l1_thresh,
+                                    "startStep": tc_session.start_step,
+                                    "endStep": getattr(tc_session, "raw_end_step", tc_session.end_step),
+                                    "totalSteps": tc_session.total_steps,
+                                    "normalizedStartStep": tc_session.start_step,
+                                    "normalizedEndStep": tc_session.end_step
+                                }
+                            }
+                            collector.emit(
+                                "sampling",
+                                "point_event",
+                                metadata={
+                                    "teacacheSession": "end",
+                                    "summary": summary,
+                                    "teacacheSummary": {
+                                        "status": "verified" if tc_session.cache_hits_count > 0 else "no_op",
+                                        "forwardCallsRecorded": tc_session.forward_calls_count,
+                                        "cacheHitsRecorded": tc_session.cache_hits_count,
+                                        "modelForwardsRecorded": diff_forward_count,
+                                        "nestedForwardsOnHits": tc_session.nested_forwards_on_hits
+                                    }
+                                }
+                            )
+                        finally:
+                            tc_session.cleanup()
+                            if tc_token is not None and tc_mod is not None:
+                                tc_mod.reset_active_session(tc_token)
+                    elif os.environ.get("CCO_EXPERIMENT_TEACACHE_MODE") == "off":
+                        collector.emit(
+                            "sampling",
+                            "point_event",
+                            metadata={
+                                "teacacheSession": "end",
+                                "summary": {
+                                    "mode": "off",
+                                    "forwardCalls": diff_forward_count,
+                                    "cacheHits": 0
+                                },
+                                "teacacheSummary": {
+                                    "status": "verified",
+                                    "forwardCallsRecorded": diff_forward_count,
+                                    "cacheHitsRecorded": 0,
+                                    "modelForwardsRecorded": diff_forward_count,
+                                    "nestedForwardsOnHits": 0
+                                }
+                            }
+                        )
+
                     if buf is not None and buf.pending_calls:
                         with _ATTENTION_TRACKER._lock:
                             unflushed = len(buf.pending_calls)
diff --git a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts
index 74fba8d..984ae31 100644
--- a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts
+++ b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts
@@ -347,6 +347,77 @@ exec /usr/bin/python3 "$@"
     expect(res.status).toBe("verified");
   });
 
+  it("accepts CCOMiniMaxH3TeaCache on pinned adapter when adapter files match pinned digest", async () => {
+    const adapter = new CurrentPinExperimentRuntimeAdapter();
+    const manifestWithTeaCache: MinimaxH3RequiredRuntimeManifest = {
+      ...baseManifest,
+      coreRevision: PINNED_COMFYUI_CORE_REVISION,
+      requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }, { name: "CCOMiniMaxH3TeaCache" }],
+      pythonPackages: [{ name: "json", version: "" }]
+    };
+
+    const res = await adapter.verify({
+      comfyUiDir: mockComfyDir,
+      pythonPath: mockPythonPath,
+      requiredRuntime: manifestWithTeaCache
+    });
+
+    expect(res.ok).toBe(true);
+    expect(res.status).toBe("verified");
+  });
+
+  it("rejects CCOMiniMaxH3TeaCache on pinned adapter when adapter files are tampered", async () => {
+    const adapter = new CurrentPinExperimentRuntimeAdapter();
+    const tamperedComfyDir = path.join(mockRootDir, "tampered-teacache-comfy-dir");
+    fs.mkdirSync(path.join(tamperedComfyDir, "comfy_extras"), { recursive: true });
+    fs.mkdirSync(path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache"), {
+      recursive: true
+    });
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "comfy_extras", "nodes_minimax_h3.py"),
+      "class MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\n"
+    );
+    // Write tampered node files
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache", "nodes.py"),
+      "class CCOMiniMaxH3TeaCacheNode:\n    INPUT_TYPES = {}\n"
+    );
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache", "__init__.py"),
+      "# tampered\n"
+    );
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache", "teacache.py"),
+      "# tampered\n"
+    );
+
+    execSync("git init -b main", { cwd: tamperedComfyDir });
+    execSync('git config user.email "test@test.com"', { cwd: tamperedComfyDir });
+    execSync('git config user.name "Test"', { cwd: tamperedComfyDir });
+    execSync("git add .", { cwd: tamperedComfyDir });
+    execSync('git commit -m "init"', { cwd: tamperedComfyDir });
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, ".git", "HEAD"),
+      `${PINNED_COMFYUI_CORE_REVISION}\n`
+    );
+
+    const manifestWithTeaCache: MinimaxH3RequiredRuntimeManifest = {
+      ...baseManifest,
+      coreRevision: PINNED_COMFYUI_CORE_REVISION,
+      requiredNodes: [{ name: "CCOMiniMaxH3TeaCache" }]
+    };
+
+    const res = await adapter.verify({
+      comfyUiDir: tamperedComfyDir,
+      pythonPath: mockPythonPath,
+      requiredRuntime: manifestWithTeaCache
+    });
+
+    expect(res.ok).toBe(false);
+    expect(res.status).toBe("conflict");
+    expect(res.blocker).toContain("TeaCache local adapter digest mismatch");
+  });
+
   it("FastH3 isolated upgrade adapter verifies supported nodes", async () => {
     const registry = new ExperimentRuntimeRegistry();
     const adapter = registry.getAdapter(FASTH3_ISOLATED_CORE_REVISION);
diff --git a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
index 5286528..555438b 100644
--- a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
+++ b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
@@ -12,7 +12,9 @@ import {
   type MinimaxH3RequiredRuntimeManifest,
   type MinimaxH3ObservedProvenance,
   compareDottedVersions,
-  satisfiesDriverConstraint
+  satisfiesDriverConstraint,
+  TEACACHE_LOCAL_ADAPTER_DIGEST,
+  computeLocalTeaCacheAdapterDigest
 } from "@cco/contracts";
 
 const execFileAsync = promisify(execFile);
@@ -243,7 +245,8 @@ const NODE_SOURCE_FILES: Record<string, string> = {
   ModelSparseAttention: "comfy_extras/nodes_sparse_attention.py",
   VedaSparseAttention: "comfy_extras/nodes_sparse_attention.py",
   ModelAttentionBackend: "comfy_extras/nodes_model_advanced.py",
-  LoraLoaderModelOnly: "nodes.py"
+  LoraLoaderModelOnly: "nodes.py",
+  CCOMiniMaxH3TeaCache: "custom_nodes/ComfyUI-MiniMaxH3-TeaCache/nodes.py"
 };
 
 function extractClassBlock(
@@ -306,6 +309,71 @@ async function verifyRequiredNodeDefinitions(
   requiredNodes: ReadonlyArray<{ name: string }>
 ): Promise<{ ok: boolean; blocker?: string }> {
   for (const node of requiredNodes) {
+    if (node.name === "CCOMiniMaxH3TeaCache") {
+      const candidates = [
+        resolve(resolvedDir, "custom_nodes/cco-minimax-h3-teacache"),
+        resolve(resolvedDir, "custom_nodes/ComfyUI-MiniMaxH3-TeaCache"),
+        resolve(resolvedDir, "custom_nodes/minimax-h3-teacache"),
+        resolve(process.cwd(), "experiments/minimax-h3-teacache")
+      ];
+      let foundDir: string | null = null;
+      for (const cand of candidates) {
+        if (existsSync(cand) && existsSync(resolve(cand, "nodes.py"))) {
+          foundDir = cand;
+          break;
+        }
+      }
+      if (!foundDir) {
+        return {
+          ok: false,
+          blocker: `Required node "CCOMiniMaxH3TeaCache" source files not found in custom_nodes/ComfyUI-MiniMaxH3-TeaCache or experiments/minimax-h3-teacache.`
+        };
+      }
+      const fullPath = resolve(foundDir, "nodes.py");
+      try {
+        const content = await readFile(fullPath, "utf8");
+        const classBlock =
+          extractClassBlock(content, "CCOMiniMaxH3TeaCacheNode") ??
+          extractClassBlock(content, "CCOMiniMaxH3TeaCache");
+        const definesClassWithSchema = classBlock !== null && classHasSchema(classBlock);
+        const registersMapping = isNodeExplicitlyMapped(content, "CCOMiniMaxH3TeaCache");
+
+        if (!definesClassWithSchema && !registersMapping) {
+          return {
+            ok: false,
+            blocker: `${fullPath} does not define a schema-valid ComfyUI node class or register "CCOMiniMaxH3TeaCache" in NODE_CLASS_MAPPINGS.`
+          };
+        }
+
+        const requiredFiles = ["__init__.py", "nodes.py", "teacache.py"];
+        const observedHashes: Record<string, string> = {};
+        for (const rf of requiredFiles) {
+          const fPath = resolve(foundDir, rf);
+          if (!existsSync(fPath)) {
+            return {
+              ok: false,
+              blocker: `TeaCache adapter missing required file "${rf}" in ${foundDir}`
+            };
+          }
+          const buf = await readFile(fPath);
+          observedHashes[rf] = createHash("sha256").update(buf).digest("hex");
+        }
+        const digest = computeLocalTeaCacheAdapterDigest(observedHashes);
+        if (digest !== TEACACHE_LOCAL_ADAPTER_DIGEST) {
+          return {
+            ok: false,
+            blocker: `TeaCache local adapter digest mismatch in ${foundDir}: expected ${TEACACHE_LOCAL_ADAPTER_DIGEST}, computed ${digest}`
+          };
+        }
+      } catch (err) {
+        return {
+          ok: false,
+          blocker: `Failed to verify CCOMiniMaxH3TeaCache in ${foundDir}: ${(err as Error).message}`
+        };
+      }
+      continue;
+    }
+
     const relFile = NODE_SOURCE_FILES[node.name];
     if (!relFile) {
       return {
@@ -823,7 +891,11 @@ export class CurrentPinExperimentRuntimeAdapter implements ExperimentRuntimeAdap
       "MiniMaxH3ReferenceToVideo",
       "EmptyMiniMaxH3LatentAV"
     ]);
-    const SUPPORTED_NODES = new Set([...CANONICAL_H3_NODES, "LoraLoaderModelOnly"]);
+    const SUPPORTED_NODES = new Set([
+      ...CANONICAL_H3_NODES,
+      "LoraLoaderModelOnly",
+      "CCOMiniMaxH3TeaCache"
+    ]);
 
     return verifyRuntimeSubstrate(this, options, (requiredNodes) => {
       for (const node of requiredNodes) {
@@ -850,7 +922,8 @@ export class IsolatedUpgradeExperimentRuntimeAdapter implements ExperimentRuntim
     const CANONICAL_H3_NODES = [
       "MiniMaxH3ImageToVideo",
       "MiniMaxH3ReferenceToVideo",
-      "EmptyMiniMaxH3LatentAV"
+      "EmptyMiniMaxH3LatentAV",
+      "CCOMiniMaxH3TeaCache"
     ];
     this.supportedNodes = Array.from(new Set([...CANONICAL_H3_NODES, ...supportedNodes]));
   }
diff --git a/packages/infrastructure/src/experiments/minimax-h3-teacache.unit.test.ts b/packages/infrastructure/src/experiments/minimax-h3-teacache.unit.test.ts
new file mode 100644
index 0000000..778a981
--- /dev/null
+++ b/packages/infrastructure/src/experiments/minimax-h3-teacache.unit.test.ts
@@ -0,0 +1,794 @@
+import { spawnSync } from "node:child_process";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+const TEACACHE_DIR = resolve("experiments/minimax-h3-teacache");
+
+function runPythonTest(code: string): { status: number | null; stdout: string; stderr: string } {
+  const result = spawnSync("python3", ["-c", code], {
+    env: {
+      ...process.env,
+      PYTHONPATH: TEACACHE_DIR
+    },
+    encoding: "utf-8"
+  });
+  return {
+    status: result.status,
+    stdout: result.stdout ?? "",
+    stderr: result.stderr ?? ""
+  };
+}
+
+describe("MiniMax-H3 TeaCache Python Implementation", () => {
+  describe("TeaCacheSession Parameter Validation & Boundaries", () => {
+    it("accepts allowlisted thresholds (0.05, 0.1, 0.15) with 20 steps", () => {
+      const code = `
+import teacache
+
+for thresh in (0.05, 0.1, 0.15):
+    sess = teacache.TeaCacheSession(
+        session_id="test-sess",
+        model_id="test-model",
+        rel_l1_thresh=thresh,
+        start_step=2,
+        end_step=-2,
+        total_steps=20,
+        sigmas=list(range(21, 0, -1))
+    )
+    assert sess.rel_l1_thresh == thresh
+    assert sess.total_steps == 20
+    assert sess.start_step == 2
+    assert sess.end_step == 18
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("requires a sigma schedule and rejects omitted sigmas (issue #467)", () => {
+      const code = `
+import teacache
+
+try:
+    teacache.TeaCacheSession(
+        session_id="test-sess",
+        model_id="test-model",
+        rel_l1_thresh=0.15,
+        start_step=2,
+        end_step=-2,
+        total_steps=20
+    )
+    assert False, "Expected ValueError when sigmas is omitted"
+except ValueError as e:
+    assert "sigmas schedule is required" in str(e)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects unallowlisted, non-finite, and invalid thresholds", () => {
+      const code = `
+import teacache
+import math
+
+invalid_thresholds = [0.0, 0.08, 0.2, -0.15, float("inf"), float("-inf"), float("nan"), "0.15", None]
+
+for t in invalid_thresholds:
+    try:
+        teacache.TeaCacheSession(
+            session_id="test-sess",
+            model_id="test-model",
+            rel_l1_thresh=t,
+            start_step=2,
+            end_step=-2,
+            total_steps=20
+        )
+        assert False, f"Expected ValueError for threshold {t}"
+    except (ValueError, TypeError):
+        pass
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects total_steps != 20 or non-integer total_steps", () => {
+      const code = `
+import teacache
+
+invalid_steps = [10, 15, 25, 4, "20", 20.0, None]
+
+for s in invalid_steps:
+    try:
+        teacache.TeaCacheSession(
+            session_id="test-sess",
+            model_id="test-model",
+            rel_l1_thresh=0.15,
+            start_step=2,
+            end_step=-2,
+            total_steps=s
+        )
+        assert False, f"Expected ValueError for total_steps {s}"
+    except (ValueError, TypeError):
+        pass
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects invalid windows where start_step >= end_step", () => {
+      const code = `
+import teacache
+
+try:
+    teacache.TeaCacheSession(
+        session_id="test-sess",
+        model_id="test-model",
+        rel_l1_thresh=0.15,
+        start_step=15,
+        end_step=10,
+        total_steps=20,
+        sigmas=list(range(21, 0, -1))
+    )
+    assert False, "Expected ValueError for start_step >= end_step"
+except ValueError as e:
+    assert "Invalid step window" in str(e)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+
+  describe("TeaCacheSession Step Sequencing & State Isolation", () => {
+    it("enforces strict sequential step advancement and rejects jumps or duplicates", () => {
+      const code = `
+import teacache
+
+sess = teacache.TeaCacheSession(
+    session_id="test-seq",
+    model_id="test-model",
+    rel_l1_thresh=0.15,
+    start_step=2,
+    end_step=-2,
+    total_steps=20,
+    sigmas=list(range(21, 0, -1))
+)
+
+# Step 0 ok
+sess.advance_step(0)
+
+# Duplicate step 0 must fail
+try:
+    sess.advance_step(0)
+    assert False, "Expected ValueError on duplicate step 0"
+except ValueError as e:
+    assert "repeat" in str(e).lower() or "backwards" in str(e).lower()
+
+# Skipping step 1 directly to step 2 must fail
+try:
+    sess.advance_step(2)
+    assert False, "Expected ValueError on non-sequential step jump"
+except ValueError as e:
+    assert "jumped" in str(e).lower() or "non-sequentially" in str(e).lower()
+
+# Sequential step 1 ok
+sess.advance_step(1)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("clones cached tensor outputs on hit and evaluate to prevent mutation", () => {
+      const code = `
+import teacache
+
+class MockFloat:
+    def __init__(self, val):
+        self.val = val
+    def item(self):
+        return self.val
+    def __truediv__(self, other):
+        v = other.val if isinstance(other, MockFloat) else other
+        return MockFloat(self.val / v)
+    def __add__(self, other):
+        v = other.val if isinstance(other, MockFloat) else other
+        return MockFloat(self.val + v)
+
+class MockTensor:
+    def __init__(self, val, mean_val=1.0):
+        self.val = val
+        self.mean_val = mean_val
+        self.cloned = False
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+
+    def detach(self):
+        return self
+
+    def float(self):
+        return self
+
+    def clone(self):
+        c = MockTensor(self.val, self.mean_val)
+        c.cloned = True
+        return c
+
+    def abs(self):
+        return self
+
+    def mean(self):
+        return MockFloat(self.mean_val)
+
+    def __sub__(self, other):
+        return MockTensor("sub", mean_val=0.0001)
+
+sess = teacache.TeaCacheSession(
+    session_id="test-clone",
+    model_id="test-model",
+    rel_l1_thresh=0.15,
+    start_step=2,
+    end_step=-2,
+    total_steps=20,
+    sigmas=list(range(21, 0, -1))
+)
+
+# Advance steps 0 and 1 (before window)
+sess.advance_step(0)
+sess.advance_step(1)
+
+# Step 2: first window step, full forward pass
+sess.advance_step(2)
+out1 = sess.evaluate(lambda inp, **kw: MockTensor("out1"), {"input": MockTensor("inp1"), "timestep": 19.0})
+assert sess.last_real_output is not None
+assert sess.last_real_output.cloned is True
+
+# Step 3: cache hit (accumulated rel_l1 0.01 < 0.15)
+sess.advance_step(3)
+out2 = sess.evaluate(lambda inp, **kw: MockTensor("out2"), {"input": MockTensor("inp2"), "timestep": 18.0})
+
+# Assert that out2 is a cloned copy, not identical reference
+assert out2.cloned is True
+assert out2 is not sess.last_real_output
+assert sess.cache_hits_count == 1
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("isolates active sessions and prevents concurrent or uncleaned sessions", () => {
+      const code = `
+import teacache
+
+sigmas = list(range(21, 0, -1))
+sess1 = teacache.TeaCacheSession("s1", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
+sess2 = teacache.TeaCacheSession("s2", "m2", 0.15, 2, -2, 20, sigmas=sigmas)
+
+tok1 = teacache.set_active_session(sess1)
+assert teacache.get_active_session() is sess1
+
+# Reset session
+teacache.reset_active_session(tok1)
+assert teacache.get_active_session() is None
+
+# Now setting sess2 succeeds
+tok2 = teacache.set_active_session(sess2)
+assert teacache.get_active_session() is sess2
+teacache.reset_active_session(tok2)
+assert teacache.get_active_session() is None
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects a second session activation for the same model_id while one is already active (issue #467)", () => {
+      const code = `
+import teacache
+
+sigmas = list(range(21, 0, -1))
+sess_a = teacache.TeaCacheSession("s-a", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
+sess_b = teacache.TeaCacheSession("s-b", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
+
+tok_a = teacache.set_active_session(sess_a)
+try:
+    teacache.set_active_session(sess_b)
+    assert False, "Expected RuntimeError on same-model nested session activation"
+except RuntimeError as e:
+    assert "already active for model_id" in str(e)
+finally:
+    teacache.reset_active_session(tok_a)
+    sess_a.cleanup()
+
+# After sess_a.cleanup() releases the model_id, a new session for the same
+# model_id may be activated.
+tok_b = teacache.set_active_session(sess_b)
+assert teacache.get_active_session() is sess_b
+teacache.reset_active_session(tok_b)
+sess_b.cleanup()
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("binds a session to the conditioning manifest shape seen on its first evaluate call and rejects a later change (issue #467)", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sigmas = list(range(21, 0, -1))
+sess = teacache.TeaCacheSession("s-cond", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
+sess.advance_step(0)
+
+# First call establishes the conditioning fingerprint.
+out1 = sess.evaluate(
+    lambda inp, **kw: MockTensor(),
+    {"input": MockTensor(), "timestep": 21.0, "c": {"cross_attention": "x"}}
+)
+
+sess.advance_step(1)
+try:
+    # A different set of conditioning keys mid-session must be rejected --
+    # reusing a cached forward output computed under a different route
+    # would be silently wrong.
+    sess.evaluate(
+        lambda inp, **kw: MockTensor(),
+        {"input": MockTensor(), "timestep": 20.0, "c": {"cross_attention": "x", "extra_key": "y"}}
+    )
+    assert False, "Expected RuntimeError on conditioning manifest change"
+except RuntimeError as e:
+    assert "Conditioning manifest changed mid-session" in str(e)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+
+  describe("CCOMiniMaxH3TeaCacheNode ComfyUI Wrapper & Model Verification", () => {
+    it("validates node metadata and input types schema", () => {
+      const code = `
+import nodes
+
+node = nodes.CCOMiniMaxH3TeaCacheNode()
+input_types = nodes.CCOMiniMaxH3TeaCacheNode.INPUT_TYPES()
+assert "required" in input_types
+req = input_types["required"]
+assert "model" in req
+assert "rel_l1_thresh" in req
+assert "start_step" in req
+assert "end_step" in req
+assert "total_steps" in req
+assert nodes.CCOMiniMaxH3TeaCacheNode.RETURN_TYPES == ("MODEL",)
+assert nodes.CCOMiniMaxH3TeaCacheNode.CATEGORY == "model_patches/unet"
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects unallowlisted thresholds at node execution time", () => {
+      const code = `
+import nodes
+import math
+
+node = nodes.CCOMiniMaxH3TeaCacheNode()
+
+class MockModelPatcher:
+    pass
+
+model = MockModelPatcher()
+
+for bad in [0.08, float("nan"), float("inf"), True, False, "0.15", None]:
+    try:
+        node.apply(model, rel_l1_thresh=bad, start_step=2, end_step=-2, total_steps=20)
+        assert False, f"Expected ValueError/TypeError on invalid threshold {bad}"
+    except (ValueError, TypeError):
+        pass
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects multi-branch duplicate evaluations within the same step interval", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sigmas = list(range(21, 0, -1))
+sess = teacache.TeaCacheSession("s-multi", model_id="m1", rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
+sess.advance_step(0)
+
+# First evaluation in step 0 succeeds
+out1 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 21.0})
+
+# Second evaluation in step 0 must fail (multi-branch / duplicate rejection)
+try:
+    sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 21.0})
+    assert False, "Expected RuntimeError on duplicate evaluation in step 0"
+except RuntimeError as e:
+    assert "Duplicate or multi-branch evaluation detected" in str(e)
+
+# Advance to step 1: evaluation succeeds again
+sess.advance_step(1)
+out2 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 20.0})
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("verifies active session model ownership and parameter match", () => {
+      const code = `
+import nodes
+import teacache
+
+node = nodes.CCOMiniMaxH3TeaCacheNode()
+
+class MockModelPatcher:
+    def __init__(self):
+        self.wrapper = None
+
+    def clone(self):
+        c = MockModelPatcher()
+        c.wrapper = self.wrapper
+        return c
+
+    def set_model_unet_function_wrapper(self, wrapper):
+        self.wrapper = wrapper
+
+m1 = MockModelPatcher()
+m2 = MockModelPatcher()
+
+# Patch m1 with threshold 0.15
+res1 = node.apply(m1, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
+m1_patched = res1[0]
+w1 = m1_patched.wrapper
+assert w1 is not None
+
+# 1. Calling wrapper without active session must fail
+try:
+    w1(lambda inp: inp, {"input": "test"})
+    assert False, "Expected RuntimeError when no active session"
+except RuntimeError as e:
+    assert "without an active execution session" in str(e)
+
+sigmas = list(range(21, 0, -1))
+
+# 2. Register session bound to different model_id (id of m2)
+sess_m2 = teacache.TeaCacheSession("s-m2", model_id=id(m2), rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
+tok2 = teacache.set_active_session(sess_m2)
+try:
+    w1(lambda inp: inp, {"input": "test"})
+    assert False, "Expected RuntimeError on model_id mismatch"
+except RuntimeError as e:
+    assert "model_id mismatch" in str(e)
+finally:
+    teacache.reset_active_session(tok2)
+
+# 3. Register session bound to m1_patched but with different threshold (0.10)
+sess_diff_thresh = teacache.TeaCacheSession("s-diff", model_id=id(m1_patched), rel_l1_thresh=0.10, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
+tok3 = teacache.set_active_session(sess_diff_thresh)
+try:
+    w1(lambda inp: inp, {"input": "test"})
+    assert False, "Expected RuntimeError on threshold mismatch"
+except RuntimeError as e:
+    assert "rel_l1_thresh does not match" in str(e)
+finally:
+    teacache.reset_active_session(tok3)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+
+  describe("TeaCacheSession Lifecycle, Timestep Alignment & Error Recovery", () => {
+    it("validates sigma schedule and rejects invalid length, non-finite, or non-descending sigmas", () => {
+      const code = `
+import teacache
+
+# Valid sigmas: 21 strictly descending finite values
+valid_sigmas = list(range(21, 0, -1))
+sess = teacache.TeaCacheSession("s-sigmas", "m1", 0.15, 2, -2, 20, sigmas=valid_sigmas)
+assert sess.sigmas == [float(s) for s in valid_sigmas]
+
+# Reject wrong length (20 instead of 21)
+try:
+    teacache.TeaCacheSession("s-bad-len", "m1", 0.15, 2, -2, 20, sigmas=list(range(20, 0, -1)))
+    assert False, "Expected ValueError on wrong sigmas length"
+except ValueError as e:
+    assert "Expected schedule with 21 sigmas" in str(e)
+
+# Reject non-descending sigmas
+try:
+    non_desc = list(range(21, 0, -1))
+    non_desc[5] = non_desc[4] + 1  # not descending
+    teacache.TeaCacheSession("s-non-desc", "m1", 0.15, 2, -2, 20, sigmas=non_desc)
+    assert False, "Expected ValueError on non-descending sigmas"
+except ValueError as e:
+    assert "strictly descending" in str(e)
+
+# Reject non-finite sigmas
+try:
+    bad_sigmas = list(range(21, 0, -1))
+    bad_sigmas[3] = float("nan")
+    teacache.TeaCacheSession("s-nan", "m1", 0.15, 2, -2, 20, sigmas=bad_sigmas)
+    assert False, "Expected ValueError on NaN sigma"
+except ValueError as e:
+    assert "non-finite" in str(e)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("validates timestep alignment against schedule and rejects mismatches", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sigmas = [float(20 - i) for i in range(21)]
+sess = teacache.TeaCacheSession("s-ts", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
+sess.advance_step(0)
+
+# Timestep matching sigmas[0] (20.0) succeeds
+out1 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 20.0})
+
+# Timestep mismatching sigmas[1] (e.g. 5.0 instead of 19.0) raises ValueError
+sess.advance_step(1)
+try:
+    sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 5.0})
+    assert False, "Expected ValueError on mismatched timestep"
+except ValueError as e:
+    assert "does not match expected schedule sigma" in str(e)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("cleans up state properly on exception and releases tensor references", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sess = teacache.TeaCacheSession("s-err", "m1", 0.15, 2, -2, 20, sigmas=list(range(21, 0, -1)))
+sess.advance_step(0)
+
+def failing_forward(inp, **kw):
+    raise RuntimeError("Synthetic model crash")
+
+try:
+    sess.evaluate(failing_forward, {"input": MockTensor(), "timestep": 21.0})
+    assert False, "Expected forward failure"
+except RuntimeError as e:
+    assert "Synthetic model crash" in str(e)
+
+# Verify is_evaluating lock was released in finally
+assert sess.is_evaluating is False
+
+# Clean up session
+sess.cleanup()
+assert sess.is_active is False
+assert sess.last_real_input is None
+assert sess.last_real_output is None
+
+# Operations on cleaned-up session fail
+try:
+    sess.advance_step(1)
+    assert False, "Expected RuntimeError on inactive session"
+except RuntimeError as e:
+    assert "inactive or cleaned-up" in str(e)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("resolves package-style custom_nodes adapter module and binds session ContextVar across wrapper", () => {
+      const code = `
+import importlib.util
+import os
+import sys
+
+pkg_dir = os.path.abspath('experiments/minimax-h3-teacache')
+init_file = os.path.join(pkg_dir, '__init__.py')
+spec = importlib.util.spec_from_file_location('custom_nodes_teacache', init_file, submodule_search_locations=[pkg_dir])
+pkg = importlib.util.module_from_spec(spec)
+sys.modules['custom_nodes_teacache'] = pkg
+spec.loader.exec_module(pkg)
+
+node_cls = pkg.NODE_CLASS_MAPPINGS['CCOMiniMaxH3TeaCache']
+node = node_cls()
+
+class MockModel:
+    def __init__(self):
+        self.model_options = {}
+    def set_model_unet_function_wrapper(self, w):
+        self.model_options['model_function_wrapper'] = w
+
+m = MockModel()
+node.apply(m, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
+
+collector_path = os.path.abspath('packages/infrastructure/src/experiments/minimax-h3-collector.py')
+c_spec = importlib.util.spec_from_file_location('collector_mod', collector_path)
+c_mod = importlib.util.module_from_spec(c_spec)
+c_spec.loader.exec_module(c_mod)
+
+resolved_mod = c_mod._resolve_teacache_module(model_patcher=m)
+assert resolved_mod is not None, 'resolved_mod is None'
+assert resolved_mod is pkg._teacache_mod, f'Module mismatch: {resolved_mod} vs {pkg._teacache_mod}'
+
+sess = resolved_mod.TeaCacheSession('test-pkg', id(m), 0.15, 2, -2, 20, sigmas=list(range(21, 0, -1)))
+tok = resolved_mod.set_active_session(sess)
+
+wrapper = m.model_options['model_function_wrapper']
+sess.advance_step(0)
+
+class MockTensor:
+    def __init__(self): self.shape = (1, 16, 20, 20); self.dtype = 'float32'; self.device = 'cuda:0'
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+out = wrapper(lambda inp, **kw: MockTensor(), {'input': MockTensor(), 'timestep': 21.0})
+assert out is not None
+assert sess.forward_calls_count == 1
+resolved_mod.reset_active_session(tok)
+sess.cleanup()
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("unpacks pinned wrapper API envelope and passes strict H3 conditioning to apply_model", () => {
+      const code = `
+import importlib.util
+import os
+import sys
+
+pkg_dir = os.path.abspath('experiments/minimax-h3-teacache')
+init_file = os.path.join(pkg_dir, '__init__.py')
+spec = importlib.util.spec_from_file_location('custom_nodes_h3_tc', init_file, submodule_search_locations=[pkg_dir])
+pkg = importlib.util.module_from_spec(spec)
+sys.modules['custom_nodes_h3_tc'] = pkg
+spec.loader.exec_module(pkg)
+
+node_cls = pkg.NODE_CLASS_MAPPINGS['CCOMiniMaxH3TeaCache']
+node = node_cls()
+
+class MockModel:
+    def __init__(self):
+        self.model_options = {}
+    def set_model_unet_function_wrapper(self, w):
+        self.model_options['model_function_wrapper'] = w
+
+m = MockModel()
+node.apply(m, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
+
+wrapper = m.model_options['model_function_wrapper']
+
+sigmas = [float(20 - i) for i in range(21)]
+sess = pkg.TeaCacheSession('test-h3-cond', id(m), 0.15, 2, -2, 20, sigmas=sigmas)
+tok = pkg.set_active_session(sess)
+sess.advance_step(0)
+
+class MockTensor:
+    def __init__(self): self.shape = (1, 16, 20, 20); self.dtype = 'float32'; self.device = 'cuda:0'
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+received_kwargs = {}
+def strict_apply_model(x, t, **c_kw):
+    received_kwargs['x'] = x
+    received_kwargs['t'] = t
+    received_kwargs.update(c_kw)
+    return MockTensor()
+
+h3_envelope = {
+    'input': MockTensor(),
+    'timestep': 20.0,
+    'c': {
+        'cross_attention': 'mock_cross_attention',
+        'latent_shapes': (1, 16, 20, 20),
+        'minimax_payload': {'tokens': 512, 'audio_scale': 1.0}
+    },
+    'cond_or_uncond': [0]
+}
+
+out = wrapper(strict_apply_model, h3_envelope)
+assert out is not None
+assert received_kwargs['t'] == 20.0
+assert received_kwargs['cross_attention'] == 'mock_cross_attention'
+assert received_kwargs['latent_shapes'] == (1, 16, 20, 20)
+assert received_kwargs['minimax_payload'] == {'tokens': 512, 'audio_scale': 1.0}
+assert 'c' not in received_kwargs
+assert 'cond_or_uncond' not in received_kwargs
+
+sess.advance_step(1)
+multi_cfg_envelope = {
+    'input': MockTensor(),
+    'timestep': 19.0,
+    'c': {'cross_attention': 'mock'},
+    'cond_or_uncond': [0, 1]
+}
+try:
+    wrapper(strict_apply_model, multi_cfg_envelope)
+    assert False, "Expected multi-branch CFG to be rejected"
+except RuntimeError as e:
+    assert "Multi-condition/CFG branching is unsupported" in str(e)
+
+pkg.reset_active_session(tok)
+sess.cleanup()
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+});
```

Fix diff since previous review:

```diff
diff --git a/apps/render-worker/src/cli/experiment-minimax-h3.test.ts b/apps/render-worker/src/cli/experiment-minimax-h3.test.ts
index 424354b..f292b0c 100644
--- a/apps/render-worker/src/cli/experiment-minimax-h3.test.ts
+++ b/apps/render-worker/src/cli/experiment-minimax-h3.test.ts
@@ -39,6 +39,7 @@ import {
   type MinimaxH3ExperimentResult,
   type MinimaxH3TelemetrySample,
   type MinimaxH3AnyExperimentDescriptor,
+  type MinimaxH3ExperimentDescriptorV2,
   type MinimaxH3AnyExperimentResult,
   type MinimaxH3ContinuityReviewSidecar,
   type ContinuityScenario
@@ -57,7 +58,7 @@ const mockI2vTemplate = {
   },
   "9": {
     class_type: "BasicScheduler",
-    inputs: { model: ["6", 0], scheduler: "simple", steps: 20 }
+    inputs: { model: ["6", 0], scheduler: "simple", steps: 20, denoise: 1 }
   },
   "14": {
     class_type: "SamplerCustomAdvanced",
@@ -2711,6 +2712,302 @@ describe("experiment:minimax-h3 CLI", () => {
       if (prepExit !== 0) {
         expect(stderr).toEqual([]);
       }
+      if (prepExit !== 0) {
+        console.error("DEBUG STDERR:", stderr);
+      }
+      expect(prepExit).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(parsed.status).toBe("prepared");
+
+      const valExit = await runExperimentCli(
+        [
+          "validate",
+          "--run-dir",
+          parsed.runDir,
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments"
+        ],
+        deps
+      );
+      expect(valExit).toBe(0);
+      const valOutput = JSON.parse(stdout[1]!);
+      expect(valOutput.status).toBe("valid");
+      expect(valOutput.graphValid).toBe(true);
+    });
+  });
+
+  describe("TeaCache CLI Flags", () => {
+    it("lists all TeaCache catalog entries with catalog --teacache", async () => {
+      const { deps, stdout } = createMockDeps();
+      const exitCode = await runExperimentCli(["catalog", "--teacache"], deps);
+      expect(exitCode).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(Array.isArray(parsed)).toBe(true);
+      expect(parsed.length).toBeGreaterThanOrEqual(4);
+      const scopes = parsed.map((e: { scope: string }) => e.scope);
+      expect(scopes).toContain("teacache-raw-l1-i2v");
+      expect(scopes).toContain("teacache-raw-l1-ref2v");
+      expect(scopes).toContain("teacache-matched-control-i2v");
+      expect(scopes).toContain("teacache-matched-control-ref2v");
+    });
+
+    it("filters TeaCache entries with catalog --type teacache --route i2v", async () => {
+      const { deps, stdout } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        ["catalog", "--type", "teacache", "--route", "i2v"],
+        deps
+      );
+      expect(exitCode).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(Array.isArray(parsed)).toBe(true);
+      expect(parsed.length).toBe(2);
+      expect(parsed.every((e: { route: string }) => e.route === "i2v")).toBe(true);
+    });
+
+    it("filters TeaCache entries by variant with catalog --teacache --route ref2v --teacache-variant raw-l1-v1", async () => {
+      const { deps, stdout } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        ["catalog", "--teacache", "--route", "ref2v", "--teacache-variant", "raw-l1-v1"],
+        deps
+      );
+      expect(exitCode).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(Array.isArray(parsed)).toBe(true);
+      expect(parsed.length).toBe(1);
+      expect(parsed[0].scope).toBe("teacache-raw-l1-ref2v");
+      expect(parsed[0].variantName).toBe("teacache-raw-l1");
+    });
+
+    it("rejects invalid --teacache mode", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-bad-teacache-mode",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "turbo"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("--teacache must be 'off' or 'raw-l1-v1'");
+    });
+
+    it("rejects combining --teacache with distillation --sampling-recipe", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-distill",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--sampling-recipe",
+          "fl2va-turbo-8"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("Cannot combine TeaCache with distillation --sampling-recipe");
+    });
+
+    it("rejects combining --teacache with --checkpoint-override", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-cp",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--checkpoint-override",
+          "fl2va"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("Cannot combine TeaCache with --checkpoint-override");
+    });
+
+    it("rejects combining --teacache with non-dense attention variant", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-attn",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--attention-variant",
+          "sage"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        'TeaCache currently requires dense attention, got --attention-variant "sage"'
+      );
+    });
+
+    it("rejects combining --teacache with non-20 step override", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-steps",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--step-override",
+          "15"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("TeaCache currently requires 20 steps, got --step-override 15");
+    });
+
+    it("prepares and validates experiment with --teacache raw-l1-v1 and custom threshold", async () => {
+      const { deps, stdout, store } = createMockDeps();
+      const prepExit = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-teacache-010",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10",
+          "--teacache-start-step",
+          "2",
+          "--teacache-end-step",
+          "-2",
+          "--teacache-total-steps",
+          "20"
+        ],
+        deps
+      );
       expect(prepExit).toBe(0);
       const parsed = JSON.parse(stdout[0]!);
       expect(parsed.status).toBe("prepared");
@@ -2729,6 +3026,269 @@ describe("experiment:minimax-h3 CLI", () => {
       const valOutput = JSON.parse(stdout[1]!);
       expect(valOutput.status).toBe("valid");
       expect(valOutput.graphValid).toBe(true);
+
+      // Verify the stored descriptor has teacacheRequest configured
+      const desc = store.descriptor as MinimaxH3ExperimentDescriptorV2;
+      expect(desc.teacacheRequest).toBeDefined();
+      expect(desc.teacacheRequest?.mode).toBe("raw-l1-v1");
+      expect(desc.teacacheRequest?.relL1Thresh).toBe(0.1);
+      expect(desc.experimentVariant.changedFactors).toContainEqual(
+        expect.objectContaining({
+          path: "caching.configuration"
+        })
+      );
+    });
+
+    it("prepares and validates matched control experiment with --teacache-matched-control", async () => {
+      const { deps, stdout, store } = createMockDeps();
+      const prepExit = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-teacache-matched-ctl",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache-matched-control"
+        ],
+        deps
+      );
+      expect(prepExit).toBe(0);
+      const parsed = JSON.parse(stdout[0]!);
+      expect(parsed.status).toBe("prepared");
+
+      const valExit = await runExperimentCli(
+        [
+          "validate",
+          "--run-dir",
+          parsed.runDir,
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments"
+        ],
+        deps
+      );
+      expect(valExit).toBe(0);
+      const valOutput = JSON.parse(stdout[1]!);
+      expect(valOutput.status).toBe("valid");
+      expect(valOutput.graphValid).toBe(true);
+
+      const desc = store.descriptor as MinimaxH3ExperimentDescriptorV2;
+      expect(desc.teacacheRequest).toBeDefined();
+      expect(desc.teacacheRequest?.mode).toBe("off");
+      expect(desc.teacacheRequest?.patchNode).toBeNull();
+      expect(desc.experimentVariant.changedFactors).toEqual([]);
+    });
+
+    it("rejects combining --teacache with --teacache-matched-control", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-incompat-tc-both",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-matched-control"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        "Cannot combine --teacache raw-l1-v1 with --teacache-matched-control"
+      );
+    });
+
+    it("rejects stray knobs when --teacache is not raw-l1-v1", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-stray-knobs",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache-threshold",
+          "0.10"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        "TeaCache parameter knobs (--teacache-threshold, --teacache-start-step, --teacache-end-step, --teacache-total-steps) can only be specified when --teacache is active (raw-l1-v1)"
+      );
+    });
+
+    it("rejects active TeaCache candidate when missing required knobs", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-missing-knobs",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain(
+        "Active TeaCache candidate run requires explicit knobs: --teacache-threshold, --teacache-start-step, --teacache-end-step, and --teacache-total-steps must all be specified"
+      );
+    });
+
+    it("rejects invalid float for --teacache-threshold", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-invalid-float",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10abc"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("--teacache-threshold must be a valid finite number");
+    });
+
+    it("rejects invalid integer for --teacache-start-step", async () => {
+      const { deps, stderr } = createMockDeps();
+      const exitCode = await runExperimentCli(
+        [
+          "prepare",
+          "--route",
+          "i2v",
+          "--frames",
+          "124",
+          "--seed",
+          "42",
+          "--inputs",
+          "inputs.json",
+          "--prompt",
+          "A test prompt",
+          "--target-host",
+          "render-worker-01",
+          "--gpu-uuid",
+          "GPU-12345678-1234-1234-1234-123456789abc",
+          "--comfyui-dir",
+          "/opt/comfyui",
+          "--python",
+          "/usr/bin/python3",
+          "--run-id",
+          "run-invalid-int",
+          "--output-root",
+          ".ai-runs/minimax-h3-experiments",
+          "--teacache",
+          "raw-l1-v1",
+          "--teacache-threshold",
+          "0.10",
+          "--teacache-start-step",
+          "2.5"
+        ],
+        deps
+      );
+      expect(exitCode).toBe(1);
+      expect(stderr[0]).toContain("--teacache-start-step must be an integer");
     });
   });
 });
diff --git a/apps/render-worker/src/cli/experiment-minimax-h3.ts b/apps/render-worker/src/cli/experiment-minimax-h3.ts
index 6997d8a..a584792 100644
--- a/apps/render-worker/src/cli/experiment-minimax-h3.ts
+++ b/apps/render-worker/src/cli/experiment-minimax-h3.ts
@@ -6,6 +6,7 @@ import {
   MinimaxH3ExperimentService,
   compareMinimaxH3Experiments,
   listAttentionCatalogEntries,
+  listTeaCacheCatalogEntries,
   listSamplingRecipes,
   validateRecipeRouteCompatibility,
   expandContinuityStudyPlan,
@@ -47,6 +48,7 @@ import {
   type MinimaxH3ExperimentResultV2,
   type MinimaxH3ProcessRecord,
   type MinimaxH3AttentionVariantName,
+  type MinimaxH3TeaCacheVariantName,
   type MinimaxH3ContinuityStudySpec,
   type MinimaxH3ContinuityReviewSidecar
 } from "@cco/contracts";
@@ -160,6 +162,12 @@ Options for 'prepare':
   --attention-variant <variant>  Attention variant ('dense' | 'sage' | 'native-sol-attn' | 'veda')
   --matched-variant <variant>    Matched dense control target variant ('sage' | 'native-sol-attn' | 'veda')
   --comfyui-core-revision <rev>  Override ComfyUI core revision for catalog lookup (e.g. for upgraded dense control)
+  --teacache <off|raw-l1-v1>     TeaCache timestep caching mode (default: off)
+  --teacache-threshold <float>   TeaCache relative L1 threshold (e.g. 0.05, 0.1, 0.15)
+  --teacache-start-step <int>    TeaCache caching start step (e.g. 2)
+  --teacache-end-step <int>      TeaCache caching end step (e.g. -2 or 18)
+  --teacache-total-steps <int>   TeaCache total scheduler steps (must be 20)
+  --teacache-matched-control     Prepare matched unpatched control run for TeaCache comparison
 
 Options for 'validate':
   --run-dir <path>               Prepared run directory path (required)
@@ -194,8 +202,11 @@ Options for 'import-sidecar':
   --output-root <dir>            Experiment output root (default: ${DEFAULT_OUTPUT_ROOT})
 
 Options for 'catalog':
+  --type <attention|recipes|teacache> Catalog type to inspect (default: attention)
   --route <i2v|ref2v>            Filter catalog entries by route (optional)
   --attention-variant <variant>  Filter catalog entries by attention variant (optional)
+  --teacache                     List TeaCache catalog entries
+  --teacache-variant <name>      Filter TeaCache catalog entries by variant name ('teacache-raw-l1' | 'matched-control')
 `);
 }
 
@@ -206,6 +217,14 @@ function parseStrictInt(str?: string): number | null {
   return Number.isSafeInteger(num) ? num : null;
 }
 
+function parseStrictFloat(str?: string): number | null {
+  if (!str) return null;
+  const trimmed = str.trim();
+  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
+  const num = Number(trimmed);
+  return Number.isFinite(num) ? num : null;
+}
+
 export function parseArgs(rawArgs: readonly string[]): {
   subcommand: string;
   flags: Record<string, string>;
@@ -260,7 +279,7 @@ export function parseArgs(rawArgs: readonly string[]): {
         flags[k] = v;
       } else {
         const next = rawArgs[i + 1];
-        if (next && !next.startsWith("-")) {
+        if (next && (!next.startsWith("-") || /^-\d+(\.\d+)?$/.test(next))) {
           if (seenFlags.has(body)) {
             duplicateFlags.push(body);
           }
@@ -318,7 +337,13 @@ const ALLOWED_FLAGS_BY_SUBCOMMAND: Record<string, Set<string>> = {
     "attention-variant",
     "matched-variant",
     "comfyui-core-revision",
-    "core-revision"
+    "core-revision",
+    "teacache",
+    "teacache-threshold",
+    "teacache-start-step",
+    "teacache-end-step",
+    "teacache-total-steps",
+    "teacache-matched-control"
   ]),
   validate: new Set(["run-dir", "output-root", "templates-dir"]),
   run: new Set(["run-dir", "output-root", "stop-policy", "baseline-run-dir", "templates-dir"]),
@@ -343,7 +368,9 @@ const ALLOWED_FLAGS_BY_SUBCOMMAND: Record<string, Set<string>> = {
     "comfyui-core-revision",
     "core-revision",
     "recipes",
-    "type"
+    "type",
+    "teacache",
+    "teacache-variant"
   ]),
   "plan-study": new Set(["study", "file", "output", "output-root", "json"]),
   "prepare-study": new Set([
@@ -400,6 +427,12 @@ const VALUE_FLAGS = new Set([
   "matched-variant",
   "comfyui-core-revision",
   "core-revision",
+  "teacache",
+  "teacache-threshold",
+  "teacache-start-step",
+  "teacache-end-step",
+  "teacache-total-steps",
+  "teacache-variant",
   "run-dir",
   "stop-policy",
   "baseline-run-dir",
@@ -459,6 +492,9 @@ export async function runExperimentCli(
   }
 
   for (const key of booleanFlags) {
+    if (subcommand === "catalog" && (key === "teacache" || key === "recipes")) {
+      continue;
+    }
     if (VALUE_FLAGS.has(key)) {
       stderr(`Error: Flag "--${key}" requires a value.`);
       return 1;
@@ -691,6 +727,118 @@ export async function runExperimentCli(
           samplingRecipe = sr as MinimaxH3SamplingRecipeName;
         }
 
+        let teacache: "off" | "raw-l1-v1" | undefined;
+        if (flags["teacache"] !== undefined) {
+          const tc = flags["teacache"].toLowerCase();
+          if (tc !== "off" && tc !== "raw-l1-v1") {
+            stderr("Error: --teacache must be 'off' or 'raw-l1-v1'.");
+            return 1;
+          }
+          teacache = tc as "off" | "raw-l1-v1";
+        }
+
+        const teacacheMatchedControl = booleanFlags.has("teacache-matched-control");
+
+        if (teacache === "raw-l1-v1" && teacacheMatchedControl) {
+          stderr(
+            "Error: Cannot combine --teacache raw-l1-v1 with --teacache-matched-control; select either candidate or matched control."
+          );
+          return 1;
+        }
+
+        let teacacheThreshold: number | undefined;
+        if (flags["teacache-threshold"] !== undefined) {
+          const parsed = parseStrictFloat(flags["teacache-threshold"]);
+          if (parsed === null) {
+            stderr(
+              "Error: --teacache-threshold must be a valid finite number (e.g. 0.05, 0.1, 0.15)."
+            );
+            return 1;
+          }
+          teacacheThreshold = parsed;
+        }
+
+        let teacacheStartStep: number | undefined;
+        if (flags["teacache-start-step"] !== undefined) {
+          const parsed = parseStrictInt(flags["teacache-start-step"]);
+          if (parsed === null) {
+            stderr("Error: --teacache-start-step must be an integer.");
+            return 1;
+          }
+          teacacheStartStep = parsed;
+        }
+
+        let teacacheEndStep: number | undefined;
+        if (flags["teacache-end-step"] !== undefined) {
+          const parsed = parseStrictInt(flags["teacache-end-step"]);
+          if (parsed === null) {
+            stderr("Error: --teacache-end-step must be an integer.");
+            return 1;
+          }
+          teacacheEndStep = parsed;
+        }
+
+        let teacacheTotalSteps: number | undefined;
+        if (flags["teacache-total-steps"] !== undefined) {
+          const parsed = parseStrictInt(flags["teacache-total-steps"]);
+          if (parsed === null) {
+            stderr("Error: --teacache-total-steps must be an integer.");
+            return 1;
+          }
+          teacacheTotalSteps = parsed;
+        }
+
+        const isTeaCacheActive = teacache === "raw-l1-v1" || teacacheMatchedControl;
+        if (isTeaCacheActive) {
+          if (samplingRecipe !== undefined) {
+            stderr("Error: Cannot combine TeaCache with distillation --sampling-recipe.");
+            return 1;
+          }
+          if (checkpointOverride !== undefined) {
+            stderr("Error: Cannot combine TeaCache with --checkpoint-override.");
+            return 1;
+          }
+          if (attentionVariant !== undefined && attentionVariant !== "dense") {
+            stderr(
+              `Error: TeaCache currently requires dense attention, got --attention-variant "${attentionVariant}".`
+            );
+            return 1;
+          }
+          if (stepOverride !== undefined && stepOverride !== 20) {
+            stderr(
+              `Error: TeaCache currently requires 20 steps, got --step-override ${stepOverride}.`
+            );
+            return 1;
+          }
+        }
+
+        const hasKnobs =
+          teacacheThreshold !== undefined ||
+          teacacheStartStep !== undefined ||
+          teacacheEndStep !== undefined ||
+          teacacheTotalSteps !== undefined;
+
+        if (teacache !== "raw-l1-v1" && hasKnobs) {
+          stderr(
+            "Error: TeaCache parameter knobs (--teacache-threshold, --teacache-start-step, --teacache-end-step, --teacache-total-steps) can only be specified when --teacache is active (raw-l1-v1)."
+          );
+          return 1;
+        }
+
+        if (teacache === "raw-l1-v1") {
+          if (
+            teacacheThreshold === undefined ||
+            teacacheStartStep === undefined ||
+            teacacheEndStep === undefined ||
+            teacacheTotalSteps === undefined
+          ) {
+            stderr(
+              "Error: Active TeaCache candidate run requires explicit knobs: --teacache-threshold, --teacache-start-step, --teacache-end-step, and --teacache-total-steps must all be specified."
+            );
+            return 1;
+          }
+        }
+
         const coreRevision = flags["comfyui-core-revision"] ?? flags["core-revision"];
 
         const resolvedTemplatesDir = resolveCliPath(flags["templates-dir"]);
@@ -722,7 +870,13 @@ export async function runExperimentCli(
           ...(attentionVariant !== undefined ? { attentionVariant } : {}),
           ...(matchedVariant !== undefined ? { matchedVariant } : {}),
           ...(coreRevision !== undefined ? { coreRevision } : {}),
-          ...(samplingRecipe !== undefined ? { samplingRecipe } : {})
+          ...(samplingRecipe !== undefined ? { samplingRecipe } : {}),
+          ...(teacache !== undefined ? { teacache } : {}),
+          ...(teacacheThreshold !== undefined ? { teacacheThreshold } : {}),
+          ...(teacacheStartStep !== undefined ? { teacacheStartStep } : {}),
+          ...(teacacheEndStep !== undefined ? { teacacheEndStep } : {}),
+          ...(teacacheTotalSteps !== undefined ? { teacacheTotalSteps } : {}),
+          ...(teacacheMatchedControl ? { teacacheMatchedControl: true } : {})
         });
 
         stdout(
@@ -1575,6 +1729,28 @@ export async function runExperimentCli(
           return 0;
         }
 
+        if (
+          booleanFlags.has("teacache") ||
+          flags["type"] === "teacache" ||
+          flags["teacache"] !== undefined
+        ) {
+          const rawVariant = flags["teacache-variant"] ?? flags["teacache"] ?? flags["variant"];
+          const normalizedVariant: MinimaxH3TeaCacheVariantName | undefined =
+            rawVariant === "raw-l1-v1" || rawVariant === "teacache-raw-l1"
+              ? "teacache-raw-l1"
+              : rawVariant === "matched-control"
+                ? "matched-control"
+                : rawVariant === "off"
+                  ? "off"
+                  : undefined;
+          const entries = listTeaCacheCatalogEntries({
+            ...(routeFilter !== undefined ? { route: routeFilter } : {}),
+            ...(normalizedVariant !== undefined ? { variantName: normalizedVariant } : {})
+          });
+          stdout(JSON.stringify(entries, null, 2));
+          return 0;
+        }
+
         const variantFilter = (flags["attention-variant"] ?? flags["variant"]) as
           MinimaxH3AttentionVariantName | undefined;
 
diff --git a/docs/minimax-h3-teacache-experiments.md b/docs/minimax-h3-teacache-experiments.md
new file mode 100644
index 0000000..db1a7fb
--- /dev/null
+++ b/docs/minimax-h3-teacache-experiments.md
@@ -0,0 +1,453 @@
+# MiniMax-H3 TeaCache Timestep-Caching Experiments Specification & Operator Runbook
+
+## 1. Purpose, Executive Summary & Non-Production Governance Boundary
+
+This document defines the research, provenance, graph compilation, observation reduction, and candidate evaluation framework for isolated **MiniMax-H3 TeaCache timestep-caching experiments** (Issue #467, child of #421).
+
+### Executive Summary
+TeaCache is a training-free inference acceleration approach that computes the relative L1 change of model input embeddings across consecutive sampling timesteps. When the relative difference falls below a calibrated threshold ($\tau$), the model forward pass is skipped and the previous timestep's output velocity/noise prediction is reused. Upstream reports approximately a 3x speedup on a high-VRAM workstation (64GB CMP 170HX) at 1024x576, 124 frames, 20 steps. However, our production target is a 24GB NVIDIA GeForce RTX 4090 operating under dynamic layer offloading at 1344x768 resolution. This specification provides the hardened, strictly isolated engineering framework to evaluate whether TeaCache can reduce sampling latency without unacceptable regressions in visual continuity, subject identity, motion smoothness, or reference adherence.
+
+### Strict Governance Boundary Rules
+- **Non-Production Isolation:** This research family is strictly optional, experimental, and disabled by default. It must never alter production render profiles (`MINIMAX_H3_720P_5S_I2V_V1`, `MINIMAX_H3_720P_5S_REF2V_V1`), default ComfyUI launch scripts, or production worker routing.
+- **Immutable Canonical Baselines:** Production workflow templates (`templates/minimax_h3_720p_i2v_124f_api.json`, `templates/minimax_h3_720p_ref2v_124f_api.json`), pinned model checkpoints, and the pinned ComfyUI core revision (`55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`) remain strictly immutable.
+- **Evidence Paths Never Agent-Authored:** Per repository rules in `AGENTS.md`, directories under `certification/`, `baseline/`, and `config/render-profiles/` contain physical hardware measurements. Automated coding agents must never author synthetic measurements or fabricate hardware speedup certifications.
+- **Operator Execution Only:** Physical execution on dedicated NVIDIA RTX 4090 hosts, hardware timing benchmarking, visual quality inspection, and promotion decisions belong exclusively to human operators and operator agents within Issue #445 (or downstream promotion tasks #424–#428).
+
+---
+
+## 2. Pinned Upstream Provenance & Audit Summary
+
+The upstream implementation has been audited, pinned, and adapted with fail-closed safety controls. Detailed audit findings and architectural mitigations are documented in `docs/minimax-h3-teacache-source-audit.md`.
+
+### Source Identification & Manifest
+- **Candidate Repository:** `https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache`
+- **Pinned Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
+- **Upstream License:** MIT License (Copyright (c) 2025 Icyoung)
+- **Source Manifest:** `experiments/minimax-h3-teacache/source-manifest.json`
+- **Substrate Environment:** CPython 3.12, PyTorch 2.5.1+cu124, CUDA 12.4 (`experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt`)
+
+### Upstream Limitations & Hardened In-Tree Architecture
+Upstream's implementation exhibits several vulnerabilities that make it unsuitable for unmitigated execution:
+1. **Module-Global State Leakage:** Upstream stored session state on the custom node instance across runs, causing cross-job contamination during batch processing, retries, or concurrent queues.
+   *Mitigation:* Replaced with Python `contextvars.ContextVar` binding session state strictly to the active task execution context, with defensive reset on lifecycle entry and termination.
+2. **In-Place Tensor Mutation:** Upstream cached tensor references without detaching or cloning, risking silent memory corruption across forward passes.
+   *Mitigation:* Enforced defensive `.detach().clone()` on all cached latent tensors and intermediate velocities.
+3. **Step Count Discrepancies:** Upstream silently allowed mismatches between the node's `total_steps` parameter and the actual scheduler step count.
+   *Mitigation:* Preflight parameter validation and runtime sigma matching require that `total_steps` matches `scheduler.steps` exactly (default 20); mismatches raise fail-closed exceptions.
+4. **Unverified Compute Skipping:** Upstream lacked instrumentation to verify that skipped forward passes actually bypassed heavy neural network execution.
+   *Mitigation:* Dedicated lifecycle hooks and telemetry reduction enforce that zero nested forward passes occur during cache hits; any nested forward pass causes immediate disqualification.
+5. **Node Key Isolation:** Hardened implementation exposes `CCOMiniMaxH3TeaCache` with backwards-compatible alias `MiniMaxH3TeaCache`, packaged in `experiments/minimax-h3-teacache/` and isolated from global ComfyUI directories.
+
+---
+
+## 3. Mutual Exclusivity & Single-Factor Controlled Rules
+
+To establish scientific validity and prevent confounding interactions, TeaCache experiments are governed by strict single-factor rules:
+
+### Mutual Exclusivity Gates
+1. **No Distillation Combinations:** TeaCache must NOT be combined with distilled checkpoints (e.g. `fastvideo_fasth3_8step_v2`) or Turbo/Lightning LoRAs (e.g. `minimax_h3_fl2v_turbo_8step_v1.0`, `minimax_h3_ref2v_turbo_4step_v0.1`). Distillation modifies the ODE trajectory and step dynamics, invalidating the standard relative L1 difference assumption.
+2. **No Accelerated Attention Combinations:** TeaCache must NOT be combined with non-standard attention backends (SageAttention, Veda, Native Sol-Attn) in initial evaluation. It strictly requires the canonical PyTorch SDPA dense backend.
+3. **Step Schedule Invariance:** TeaCache must operate on the canonical 20-step schedule (`res_multistep` or `simple`). Step reduction is achieved via timestep caching, not scheduler truncation.
+4. **Model Checkpoint Invariance:** Initial experiments require the canonical pinned INT8 ConvRot checkpoint (`minimax_h3_ref2va_pruned_int8_convrot.safetensors` across both I2V and Ref2V routes as defined in canonical production templates).
+
+### Matched Control Invariant Pair
+Every TeaCache candidate run (`raw-l1-v1`) must have an exact matched control baseline run (`off` / `matched-control`) executed under identical conditions:
+- **Identical Route:** `i2v` (`frame_anchored`) or `ref2v` (`reference_directed`).
+- **Identical Resolution & Cadence:** `1344x768` at 24 fps.
+- **Identical Frame Count:** 124 frames (5.167s) for initial screening.
+- **Identical Random Seed:** Same PRNG seed (e.g. `42`, `101`, `2024`).
+- **Identical Prompt & Conditioning:** Exact SHA-256 match of input images, audio tokens, and text prompts.
+- **Identical Substrate:** Same host hardware, CUDA driver, PyTorch version, and ComfyUI core revision.
+
+---
+
+## 4. Graph Topologies & Topological Rewiring
+
+The experiment service dynamically derives the experiment workflow graph from canonical templates without mutating on-disk templates.
+
+### Canonical Baseline Topology (Control / Off)
+In the canonical unpatched workflow, `UNETLoader` (node 6) connects directly to both `BasicGuider` (node 16) and `BasicScheduler` (node 9):
+
+```mermaid
+flowchart LR
+    UNET["Node 6: UNETLoader<br/>(minimax_h3_int8)"] -->|model| SCHED["Node 9: BasicScheduler<br/>(20 steps)"]
+    UNET -->|model| GUIDER["Node 16: BasicGuider"]
+    COND["Node 104 / 105: Conditioning<br/>(I2V or Ref2V)"] -->|conditioning| GUIDER
+    GUIDER -->|guider| SAMPLER["Node 14: SamplerCustomAdvanced"]
+    SCHED -->|sigmas| SAMPLER
+    SAMPLER -->|latent| DECODE["Node 10: VAEDecode"]
+```
+
+### TeaCache Patched Topology (`raw-l1-v1`)
+In the active TeaCache variant, patch node 401 (`CCOMiniMaxH3TeaCache`) intercepts the model connection from `UNETLoader` (node 6) and supplies the patched model to both `BasicGuider` (node 16) and `BasicScheduler` (node 9):
+
+```mermaid
+flowchart LR
+    UNET["Node 6: UNETLoader<br/>(minimax_h3_int8)"] -->|model| TC["Node 401: CCOMiniMaxH3TeaCache<br/>(threshold, window, steps)"]
+    TC -->|model| SCHED["Node 9: BasicScheduler<br/>(20 steps)"]
+    TC -->|model| GUIDER["Node 16: BasicGuider"]
+    COND["Node 104 / 105: Conditioning<br/>(I2V or Ref2V)"] -->|conditioning| GUIDER
+    GUIDER -->|guider| SAMPLER["Node 14: SamplerCustomAdvanced"]
+    SCHED -->|sigmas| SAMPLER
+    SAMPLER -->|latent| DECODE["Node 10: VAEDecode"]
+```
+
+### Topological Invariants
+1. Node 401 connects input `model` to `["6", 0]`.
+2. Node 16 connects input `model` to `["401", 0]`.
+3. Node 9 connects input `model` to `["401", 0]`.
+4. Conditioning connections (nodes 104/105) and VAE decode connections (nodes 10/12/13) remain completely untouched.
+5. In unpatched baseline runs, node 401 is omitted entirely; nodes 16 and 9 connect directly to `["6", 0]`.
+
+---
+
+## 5. Parameter Grid & Staged Evaluation Matrix
+
+Experimental evaluation follows a conservative, staged progression to avoid premature escalation and compute waste.
+
+### Candidate Parameter Grid
+| Parameter | Conservative Grid Value | Intermediate Grid Value | Upstream Default | Unit / Notes |
+| :--- | :--- | :--- | :--- | :--- |
+| `rel_l1_thresh` | `0.05` | `0.10` | `0.15` | Relative L1 threshold $\tau$ |
+| `start_step` | `2` | `2` | `2` | Initial burn-in steps (no caching) |
+| `end_step` | `-2` (step 18) | `-2` (step 18) | `-2` (step 18) | Final refinement steps (no caching) |
+| `total_steps` | `20` | `20` | `20` | Must equal scheduler total steps |
+
+*Note: Steps 0 and 1 establish coarse scene structure and must compute full forwards. Steps 18 and 19 resolve fine high-frequency details and must compute full forwards. Caching occurs strictly within steps [2, 17].*
+
+### Staged Progression Matrix
+```mermaid
+flowchart TD
+    S1["Stage 1: I2V 124f Screening<br/>(Thresholds: 0.05, 0.10, 0.15 across 3 seeds)"]
+    S1 -->|Review Metrics & Visuals| G1{"Stage 1 Gate<br/>Speedup > 1.25x &<br/>No Severe Artifacts?"}
+    G1 -->|Yes| S2["Stage 2: Ref2V 124f Validation<br/>(Multi-reference identity & wardrobe)"]
+    G1 -->|No| R1["Reject / Tune Threshold"]
+    S2 -->|Review Reference Adherence| G2{"Stage 2 Gate<br/>Identity Retained &<br/>Speedup Confirmed?"}
+    G2 -->|Yes| S3["Stage 3: Variable Duration Escalation<br/>(243f, 362f Extended Shots)"]
+    G2 -->|No| R2["Hold at I2V Only"]
+    S3 -->|Review Long-Shot Drift| G3{"Stage 3 Gate<br/>Temporal Stability &<br/>Memory Headroom?"}
+    G3 -->|Yes| P["Submit to Operator Promotion Review (#445)"]
+    G3 -->|No| H["Cap Duration at 124f"]
+```
+
+#### Stage 1: I2V 124-Frame Screening (5.167 seconds)
+- Focus: Core algorithm verification, hit rate measurement, and baseline artifact assessment.
+- Sweep `rel_l1_thresh` at `0.05`, `0.10`, and `0.15`.
+- Evaluate across at least 3 distinct seeds (e.g. `42`, `101`, `2024`) to detect seed sensitivity.
+
+#### Stage 2: Ref2V 124-Frame Validation (5.167 seconds)
+- Focus: Reference conditioning stability with multi-picture prompt tags.
+- Verify whether skipping forward passes impairs character identity retention or reference wardrobe binding.
+
+#### Stage 3: Variable Duration Escalation (Conditional)
+- Only if Stage 1 and Stage 2 show acceptable visual quality:
+  - **243 frames (~10.125s):** Test long-term motion and identity consistency.
+  - **362 frames (~15.083s):** Test extreme shot duration and GPU VRAM offload stability.
+
+---
+
+## 6. RTX 4090 Hardware Profile & Dynamic Offloading Dynamics
+
+Inference execution on 24GB RTX 4090 involves distinct hardware behaviors that contrast with upstream's high-VRAM workstation setup:
+
+1. **Layer Offloading vs Compute:**
+   MiniMax-H3's large INT8 DiT requires dynamic CPU offloading to fit in 24GB VRAM alongside the 32B multimodal text encoder and VAEs. During normal execution, weights stream across the PCIe bus for every model forward pass.
+2. **PCIe Savings from Timestep Skipping:**
+   When TeaCache hits and skips a forward pass, it avoids not only CUDA kernel execution but also the PCIe bus transmission of model layers for that step. This can provide meaningful latency reduction even with dynamic offload overhead.
+3. **Host RAM Buffers:**
+   Cached latent tensors must be pinned in system memory or GPU VRAM. Ensure system host RAM remains below the 64GB safety ceiling to prevent OS swap thrashing.
+4. **VRAM Safety Margin:**
+   Peak VRAM must remain under 23,500 MiB (giving a 500 MiB safety buffer before the 24,576 MiB hardware ceiling).
+
+---
+
+## 7. Fail-Closed Telemetry, Accounting & Fallback Detection
+
+The TeaCache experiment reducer (`minimax-h3-teacache-reducer.ts`) and comparator (`minimax-h3-comparator.ts`) enforce strict telemetry integrity:
+
+### Telemetry Invariant Checks
+1. **Cache Hit Accounting:**
+   - Every sampling step records whether it executed a full forward pass (`full`) or skipped execution via cache (`skip`).
+   - $\text{Total Steps} = \text{Forward Calls} + \text{Cache Hits}$.
+2. **Zero Nested Forward Passes:**
+   - During a cache hit, the underlying model must NOT execute any internal forward passes. Nested forward calls on cache hits must be strictly 0.
+   - Any nested forward pass indicates wrapper leak and causes immediate evaluation failure.
+3. **No-Op Detection:**
+   - If a candidate run yields 0 cache hits ($\text{hits} = 0$), status is classified as `no_op`.
+   - `no_op` runs are disqualified from claiming speedup metrics (`samplingWallEligible = false`, `metrics = null`).
+4. **Zero Fallback Tolerance:**
+   - Any runtime error or fallback to dense computation without caching is captured as an execution failure.
+5. **No Synthetic Metrics:**
+   - Timing ratios and speedup metrics are calculated strictly from measured wall time in milliseconds (`variant / baseline`).
+
+---
+
+## 8. Step-by-Step Operator Runbook
+
+This section details the exact CLI commands and operational workflow for operators executing TeaCache experiments on RTX 4090 render hosts.
+
+### Step 1: Environment Preparation, Isolated Checkout/Venv & Substrate Check
+Verify CUDA driver, isolated ComfyUI checkout at pinned core revision, isolated Python virtual environment, read-only model weight checksums, and hash-verified adapter staging:
+```bash
+# Set once, from inside your comfy-content-orchestrator checkout. Every
+# command below is written with an explicit path or explicit --cd so none
+# of them depend on your shell's current directory -- `cd` into the
+# isolated ComfyUI checkout happens exactly once, for the git checkout
+# step, and is immediately followed by `cd -` back.
+CCO_REPO_ROOT="$(pwd)"
+COMFYUI_ISOLATED_DIR=/opt/comfyui-isolated-teacache
+
+# Verify GPU visibility and driver
+nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader
+
+# 1. Prepare dedicated isolated ComfyUI checkout (never mutate production or global /opt/comfyui)
+git clone https://github.com/Comfy-Org/ComfyUI.git "$COMFYUI_ISOLATED_DIR"
+(cd "$COMFYUI_ISOLATED_DIR" && git checkout 55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc)
+"$CCO_REPO_ROOT/scripts/check-comfyui-version.sh"
+
+# 2. Setup isolated virtualenv and install pinned experiment requirements
+python3 -m venv "$COMFYUI_ISOLATED_DIR/.venv"
+source "$COMFYUI_ISOLATED_DIR/.venv/bin/activate"
+pip install -r "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt"
+python3 --version  # Must be 3.11.x or 3.12.x
+pip list | grep -E "torch|comfy"
+
+# 3. Verify MiniMax-H3 weights exist, are mounted read-only, and match pinned SHA-256
+"$CCO_REPO_ROOT/scripts/check-minimax-h3-version.sh"
+
+# 4. Stage hardened TeaCache custom node into isolated custom_nodes directory and verify file hashes
+mkdir -p "$COMFYUI_ISOLATED_DIR/custom_nodes/cco-minimax-h3-teacache"
+cp "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/__init__.py" \
+   "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/nodes.py" \
+   "$CCO_REPO_ROOT/experiments/minimax-h3-teacache/teacache.py" \
+   "$COMFYUI_ISOLATED_DIR/custom_nodes/cco-minimax-h3-teacache/"
+
+# Verify staged file SHA-256 matches pinned in-tree adapter file hashes
+sha256sum "$COMFYUI_ISOLATED_DIR/custom_nodes/cco-minimax-h3-teacache/"*
+```
+
+### Step 2: Catalog Inspection
+Verify that TeaCache entries are recognized in the experiment catalog:
+```bash
+pnpm experiment:minimax-h3 catalog --teacache
+```
+Expected output: Catalog listing displaying `teacache-raw-l1-i2v`, `teacache-raw-l1-ref2v`, and matched controls.
+
+### Step 3: Prepare Matched Baseline Control Run
+Generate the unpatched baseline experiment descriptor using dedicated loopback port 8199 and isolated ComfyUI:
+```bash
+pnpm experiment:minimax-h3 prepare \
+  --route i2v \
+  --frames 124 \
+  --seed 42 \
+  --inputs manifest-i2v.json \
+  --prompt "A cinematic shot of a person smiling warmly, natural lighting" \
+  --target-host render-worker-01 \
+  --gpu-uuid GPU-12345678-1234-1234-1234-123456789abc \
+  --comfyui-dir /opt/comfyui-isolated-teacache \
+  --python /opt/comfyui-isolated-teacache/.venv/bin/python3 \
+  --port 8199 \
+  --run-id baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --teacache-matched-control
+```
+
+### Step 4: Prepare TeaCache Candidate Run
+Generate the patched TeaCache experiment descriptor with required explicit knobs:
+```bash
+pnpm experiment:minimax-h3 prepare \
+  --route i2v \
+  --frames 124 \
+  --seed 42 \
+  --inputs manifest-i2v.json \
+  --prompt "A cinematic shot of a person smiling warmly, natural lighting" \
+  --target-host render-worker-01 \
+  --gpu-uuid GPU-12345678-1234-1234-1234-123456789abc \
+  --comfyui-dir /opt/comfyui-isolated-teacache \
+  --python /opt/comfyui-isolated-teacache/.venv/bin/python3 \
+  --port 8199 \
+  --run-id candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --teacache raw-l1-v1 \
+  --teacache-threshold 0.10 \
+  --teacache-start-step 2 \
+  --teacache-end-step -2 \
+  --teacache-total-steps 20
+```
+
+### Step 5: Offline Semantic Validation
+Validate both descriptors against graph topology and runtime invariants:
+```bash
+# Validate baseline control
+pnpm experiment:minimax-h3 validate \
+  --run-dir .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+
+# Validate candidate variant
+pnpm experiment:minimax-h3 validate \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+```
+
+### Step 6: Physical Execution (Operator on RTX 4090)
+Execute both runs sequentially under clean system conditions (restarting background services if necessary to clear VRAM fragmentation).
+A stop-policy JSON file (e.g. `/opt/comfyui-isolated-teacache/operator-stop-policy.json`) is strictly required when executing `run`:
+
+```bash
+# Define operator-authored stop policy
+cat << 'EOF' > /opt/comfyui-isolated-teacache/operator-stop-policy.json
+{
+  "policyId": "rtx-4090-minimax-h3-default-stop-v1",
+  "maxPeakVramMb": 24000,
+  "maxHostRamMb": 60000,
+  "maxSwapUsedMb": 4096,
+  "maxSwapDeltaMb": 2048,
+  "maxExecutionDurationMs": 1200000,
+  "requireCompleteTelemetry": true,
+  "requireConformantProbe": true,
+  "visualStopConditions": [
+    "severe_flicker_or_tearing",
+    "subject_identity_collapse",
+    "extreme_motion_blur_or_distortion"
+  ]
+}
+EOF
+
+# Execute baseline control
+pnpm experiment:minimax-h3 run \
+  --run-dir .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json
+
+# Execute candidate variant
+pnpm experiment:minimax-h3 run \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments \
+  --stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json
+```
+
+### Step 7: Telemetry Reconciliation
+Reduce raw execution events into structured observation facts:
+```bash
+# Reconcile baseline
+pnpm experiment:minimax-h3 reconcile \
+  --run-dir .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+
+# Reconcile candidate
+pnpm experiment:minimax-h3 reconcile \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+```
+
+### Step 8: Comparative Evaluation
+Run the automated invariant and metric comparator:
+```bash
+pnpm experiment:minimax-h3 compare \
+  --baseline .ai-runs/minimax-h3-experiments/baseline-i2v-s42 \
+  --variant .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 \
+  --output-root .ai-runs/minimax-h3-experiments
+```
+
+### Step 9: Probed Video Asset Verification
+Verify output media container and streams via `ffprobe`:
+```bash
+ffprobe -v error -select_streams v:0 \
+  -show_entries stream=width,height,r_frame_rate,nb_frames,codec_name \
+  -of json .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/output.mp4
+
+# Verify audio stream presence and synchronization
+ffprobe -v error -select_streams a:0 \
+  -show_entries stream=codec_name,sample_rate,channels \
+  -of json .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/output.mp4
+```
+
+### Step 10: Operator Decision Sidecar Import
+Validate and import the human continuity and quality review sidecar:
+```bash
+# Validate sidecar schema and criteria
+pnpm experiment:minimax-h3 validate-sidecar \
+  --sidecar .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/operator-decision.json \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42
+
+# Import approved sidecar into result.json
+pnpm experiment:minimax-h3 import-sidecar \
+  --sidecar .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42/operator-decision.json \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42
+```
+
+### Step 11: Workspace Cleanup & Evidence Retention
+Preserve all durable evidence while cleaning up owned child processes and ephemeral staging directories:
+```bash
+# 1. Retain all durable execution evidence (descriptors, results, events.jsonl, capability handshakes, output videos, sidecars):
+pnpm experiment:minimax-h3 cleanup \
+  --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42
+
+# Optional: To remove heavy raw output video while preserving result.json, events.jsonl, and logs:
+# pnpm experiment:minimax-h3 cleanup --run-dir .ai-runs/minimax-h3-experiments/candidate-i2v-t10-s42 --remove-outputs
+
+# 2. Owned teardown: clean up isolated staged custom node files and deactivate isolated virtualenv
+rm -rf /opt/comfyui-isolated-teacache/custom_nodes/cco-minimax-h3-teacache
+deactivate
+```
+
+---
+
+## 9. Qualitative Visual Evaluation Rubric & Creative Regressions
+
+TeaCache introduces specific temporal approximation artifacts that cannot be assessed through loss functions alone. Operators must inspect full-motion video playback on calibrated monitors across seven evaluation dimensions:
+
+### 1. Subject Identity & Facial Coherence
+- **Check:** Does the subject's face maintain bone structure, eye shape, and skin tone across timesteps?
+- **Failure Mode:** Facial morphing, features drifting toward a generic average, or micro-expression freezing.
+
+### 2. Wardrobe & Fine Fabric Textures
+- **Check:** Are fabric weaves, garment seams, embroidery, and small accessories sharp and continuous?
+- **Failure Mode:** Texture smoothing, sudden blotchiness, or geometric flattening of intricate clothing patterns.
+
+### 3. Scene Background Continuity & Spatial Stability
+- **Check:** Do background architecture, trees, horizon lines, and furniture remain spatially locked?
+- **Failure Mode:** Background swimming, phantom objects appearing/disappearing, or scene replacement.
+
+### 4. Motion Smoothness & Trajectory Jerk
+- **Check:** Is character and camera motion continuous and natural throughout the 5+ second shot?
+- **Failure Mode:** Sudden acceleration/deceleration shudder when switching between cached and computed steps.
+
+### 5. Temporal Flicker & High-Frequency Shimmer
+- **Check:** Is there persistent luminance flicker or high-frequency pixel crawling across consecutive frames?
+- **Failure Mode:** Aliasing shimmer on sharp contrast edges and hair strands.
+
+### 6. Reference Adherence (Ref2V Route Only)
+- **Check:** Does the generated character match the reference image manifest in clothing, hairstyle, and lighting?
+- **Failure Mode:** Reference conditioning decoupling where the model ignores picture prompts during skipped steps.
+
+### 7. Audio / Video Synchronization & Playback Integrity
+- **Check:** Does speech or sound remain strictly in sync with on-screen character motion and visual events without temporal drift?
+- **Failure Mode:** Audio latency offset, popping, crackling, or dropped samples during skipped compute intervals.
+
+---
+
+## 10. Safe Abort Triggers & Formal GO/NO-GO Criteria
+
+### Safe Abort Triggers
+The operator must terminate execution immediately if any of the following triggers occur:
+1. **GPU Memory Overrun:** VRAM consumption exceeds 23,500 MiB or triggers a CUDA Out-Of-Memory (OOM) exception.
+2. **Host RAM Exhaustion:** System RAM exceeds 60,000 MiB or swap activity begins (`vmstat 1` swap-in > 0).
+3. **Nested Forward Calls:** Reconciled telemetry indicates `nestedForwardCallsRecorded > 0`.
+4. **Catastrophic Quality Collapse:** Severe visual tearing, black frames, or complete scene replacement.
+5. **No-Op Execution:** Cache hits recorded is 0 after completing the sampling loop.
+
+### Formal GO/NO-GO Gate Decision
+| Evaluation Criterion | Mandatory Requirement | Threshold for "GO" |
+| :--- | :--- | :--- |
+| **End-to-End Latency Speedup** | Sampling wall-time ratio variant/baseline $< 0.85$ | $\ge 15\%$ sampling wall time reduction ($\le 0.85\times$) |
+| **Cache Hit Efficiency** | Cache hits $\ge 3$ out of 20 steps ($\ge 15\%$) | $30\% - 50\%$ cache hits ($6-10$ steps skipped) |
+| **Resource Envelope** | Peak VRAM $\le 23,500\text{ MiB}$, Peak RAM $\le 60\text{ GiB}$ | Fully compliant with zero swap thrashing |
+| **Visual Quality Score** | No severe defects across identity, scene, motion | Rated "Pass" or "Acceptable Minor Drift" across all seeds |
+| **Reference Fidelity** | Ref2V conditioning retains character binding | 100% adherence to staged reference images |
+| **AV Sync & Audio Quality** | Audio in sync, zero audio pop/dropout | Verified full audio playback continuity |
+| **Legal & Licensing Sign-off** | MIT License compliance verified | Upstream copyright and MIT license attributed |
+| **Evidence Retention** | Complete run directory committed | Durable retention of `.ai-runs/`, events, and configs |
+
+- **GO Decision:** All mandatory requirements met across all 3 seeds at candidate threshold. Operator signs evaluation report and submits to #445 for integration consideration.
+- **NO-GO Decision:** Excessive visual artifacts, speedup below $15\%$, or stability failures. The candidate variant remains isolated in the research catalog and is NOT approved for profile promotion.
diff --git a/docs/minimax-h3-teacache-report-template.md b/docs/minimax-h3-teacache-report-template.md
new file mode 100644
index 0000000..a565880
--- /dev/null
+++ b/docs/minimax-h3-teacache-report-template.md
@@ -0,0 +1,162 @@
+# MiniMax-H3 TeaCache Timestep-Caching Candidate Evaluation Report Template
+
+> **OPERATOR INSTRUCTIONS:**
+> This template is a **blank** evaluation form and runbook for live physical execution on dedicated NVIDIA RTX 4090 GPU render hosts (Issue #445).
+> Per `AGENTS.md` and repository governance rules, automated agents must **never** author synthetic hardware measurements or pre-populate GO/NO-GO verdicts.
+> Complete each section only after executing both the baseline control and candidate TeaCache variant under identical physical conditions.
+> See the specification document [MiniMax-H3 TeaCache Timestep-Caching Experiments Specification](minimax-h3-teacache-experiments.md) for full catalog definitions, parameter bounds, and topological rules.
+> All CLI commands below are runnable and self-contained. Fill in the observed results, resource metrics, creative rubric assessments, and final disposition upon physical execution.
+
+---
+
+## 1. Experiment Metadata & Provenance
+
+- **Evaluation Date:** `<YYYY-MM-DD>`
+- **Operator Name / ID:** `<operator-identity>`
+- **Target Host Name:** `<hostname>`
+- **NVIDIA GPU Model & UUID:** `<NVIDIA RTX 4090 / GPU-UUID>`
+- **Driver & CUDA Build:** `<Driver Version> / <CUDA Build>`
+- **ComfyUI Core Revision:** `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
+- **TeaCache Node Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
+- **Route:** `[ ] i2v` | `[ ] ref2v`
+- **Frame Count:** `[ ] 124f (5.17s)` | `[ ] 243f (10.13s)` | `[ ] 362f (15.08s)`
+- **Random Seed:** `<e.g. 42>`
+- **Candidate TeaCache Variant:** `[ ] raw-l1-v1`
+- **Candidate Parameters:**
+  - `rel_l1_thresh`: `<e.g. 0.05, 0.10, 0.15>`
+  - `start_step`: `<e.g. 2>`
+  - `end_step`: `<e.g. -2>`
+  - `total_steps`: `20`
+- **Baseline Control Run ID:** `<h3-tc-baseline-...>`
+- **Candidate Variant Run ID:** `<h3-tc-candidate-...>`
+- **Topology Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
+- **Configuration Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
+- **Runtime Lock Digest (Baseline / Candidate):** `<sha256-hex>` / `<sha256-hex>`
+- **Admission Verdict:** `[ ] Admitted` | `[ ] Rejected`
+
+---
+
+## 2. Controlled Invariants Verification
+
+All invariants must be strictly verified before comparing timing metrics:
+
+- [ ] **Route Identical:** `i2v` or `ref2v` matches baseline
+- [ ] **Frame Count Identical:** Exactly 124 frames (or staged 243f/362f)
+- [ ] **Geometry & Cadence Identical:** Exactly `1344x768` at 24 fps
+- [ ] **Noise Seed Identical:** Same random seed across pair
+- [ ] **Scheduler Steps Identical:** Exactly 20 steps (`res_multistep` or `simple`)
+- [ ] **Conditioning Inputs Identical:** SHA-256 match on staged input assets
+- [ ] **Single Factor Change:** `caching.configuration` is the sole variable changed
+- [ ] **Dense Attention Preserved:** PyTorch SDPA dense attention used across both runs (no Sage/Veda/Native Sol-Attn)
+- [ ] **Standard Checkpoint Preserved:** Canonical INT8 ConvRot model used (no Turbo/Lightning/FastH3 distillation)
+- [ ] **Runtime Substrate Verified:** Baseline and candidate executed on identical virtual environment and package versions
+- [ ] **Runner Policy Identical:** Same memory management policy (`dynamicvram-offload-v1`)
+- [ ] **Operator Stop Policy Enforced:** Executed with identical operator-authored stop policy (`--stop-policy /opt/comfyui-isolated-teacache/operator-stop-policy.json`)
+
+---
+
+## 3. TeaCache Topology & Node Configuration Audit
+
+- [ ] **Node 401 Present:** Candidate graph contains node 401 with class `CCOMiniMaxH3TeaCache`
+- [ ] **Model Interception:** Node 401 input `model` wired to `["6", 0]`
+- [ ] **Guider Rewiring:** Node 16 (`BasicGuider`) input `model` wired to `["401", 0]`
+- [ ] **Scheduler Rewiring:** Node 9 (`BasicScheduler`) input `model` wired to `["401", 0]`
+- [ ] **Control Node 401 Absent:** Baseline control graph contains no node 401; nodes 16 and 9 wire to `["6", 0]`
+- [ ] **Conditioning Intact:** Nodes 104/105 conditioning connections completely unmodified
+- [ ] **No Competing Wrappers:** Confirmed no competing model wrappers or LoRA loaders stacked onto model path
+
+---
+
+## 4. Telemetry & Execution Accounting
+
+### Timestep Caching Accounting
+| Metric | Baseline Control (`off`) | Candidate Variant (`raw-l1-v1`) | Requirement | Status |
+| :--- | :--- | :--- | :--- | :--- |
+| Model Forward Passes | 20 | `<forward-calls>` | Recorded | `[PASS / FAIL]` |
+| Timestep Cache Hits | 0 | `<cache-hits>` | $\ge 1$ (No `no_op`) | `[PASS / FAIL]` |
+| Cache Hit Rate (%) | 0.0% | `<hit-rate>%` | Recorded | `[PASS / FAIL]` |
+| Nested Forwards on Cache Hit | 0 | 0 | Exactly 0 (No leak) | `[PASS / FAIL]` |
+| Effective Sampling Steps | 20 | 20 | Matches scheduler | `[PASS / FAIL]` |
+| No-Op Classification | N/A | `[ ] Verified` | `status != "no_op"` | `[PASS / FAIL]` |
+
+### Phase Timings (Milliseconds)
+| Phase | Baseline Control (ms) | Candidate Variant (ms) | Delta (ms) | Ratio (Variant/Base) | Status |
+| :--- | :--- | :--- | :--- | :--- | :--- |
+| Environment Startup | | | | | `[measured/unknown]` |
+| Model Loading | | | | | `[measured/unknown]` |
+| Conditioning | | | | | `[measured/unknown]` |
+| Sampling Wall Time | | | | | `[measured/unknown]` |
+| - Per-Step Mean | | | | | `[measured/unknown]` |
+| VAE Video Decode | | | | | `[measured/unknown]` |
+| Mux & Save | | | | | `[measured/unknown]` |
+| Whole Attempt Wall Time | | | | | `[measured/unknown]` |
+
+---
+
+## 5. Resource Envelope (RTX 4090 24GB VRAM)
+
+| Resource | Baseline Control | Candidate Variant | Delta | Safety Threshold | Within Limits |
+| :--- | :--- | :--- | :--- | :--- | :--- |
+| Peak VRAM (MiB) | | | | $\le 23,500\text{ MiB}$ | `[YES / NO]` |
+| Peak Host RAM (MiB) | | | | $\le 60,000\text{ MiB}$ | `[YES / NO]` |
+| Swap Activity Delta (MiB) | | | | $0\text{ MiB}$ | `[YES / NO]` |
+
+---
+
+## 6. Output Conformance & Probed Media Facts
+
+- [ ] **Probed Video Geometry:** `1344x768` (ffprobe verified)
+- [ ] **Probed Video Duration:** 5.167s / 124 frames (ffprobe verified)
+- [ ] **Container Format:** MP4 (H.264 / AAC)
+- [ ] **Video Stream Codec:** `h264` (yuv420p)
+- [ ] **Audio Stream Codec:** `aac` (stereo, 44100 Hz or 48000 Hz)
+- [ ] **Audio / Video Synchronization:** Audio stream remains synchronized with video motion without lip-sync drift or temporal offset
+- [ ] **Audio Playback Continuity:** Audio plays smoothly with zero pops, clicks, or dropouts across cache-skipped step intervals
+- [ ] **No Corrupted / Black Frames:** Output video verified complete from frame 0 to end
+
+---
+
+## 7. Qualitative Visual Quality Review
+
+*Score each category: `1 (Severe Regression)` to `5 (Indistinguishable from Baseline Control)`.*
+
+| Evaluation Dimension | Score (1-5) | Specific Visual Observations | Status |
+| :--- | :---: | :--- | :--- |
+| **Subject Identity & Face** | | | `[Pass / Fail]` |
+| **Wardrobe & Fine Textures** | | | `[Pass / Fail]` |
+| **Scene Background Stability** | | | `[Pass / Fail]` |
+| **Motion Smoothness & Trajectory** | | | `[Pass / Fail]` |
+| **Temporal Flicker & Shimmer** | | | `[Pass / Fail]` |
+| **Reference Adherence (Ref2V)** | | | `[Pass / Fail / N/A]` |
+| **Audio & Sync Fidelity** | | | `[Pass / Fail]` |
+
+---
+
+## 8. Anomaly & Incident Log
+
+| Step / Timestamp | Event / Observation | Impact on Run | Action Taken |
+| :--- | :--- | :--- | :--- |
+| | | | |
+
+---
+
+## 9. Operator Sign-Off & Disposition
+
+### Recommendation Summary
+- **Overall Execution Result:** `[ ] SUCCESS` | `[ ] REJECTED` | `[ ] ABORTED`
+- **Observed Sampling Wall-Time Speedup:** `<ratio or N/A>`
+- **Observed Cache Hit Rate:** `<hit-rate or N/A>`
+- **Visual Acceptability:** `[ ] ACCEPTABLE` | `[ ] UNACCEPTABLE DEFECTS`
+- **Audio & Playback Integrity:** `[ ] ACCEPTABLE` | `[ ] UNACCEPTABLE DEFECTS`
+
+### Disposition Decision
+- [ ] **RECOMMEND PROMOTION REVIEW (#445):** Candidate threshold demonstrates reproducible sampling acceleration ($\ge 15\%$), zero stability failures, and commercially acceptable visual quality across all test seeds.
+- [ ] **REQUIRE RE-TUNING:** Threshold too aggressive (artifacts) or too conservative (insufficient speedup). Further parameter sweep needed.
+- [ ] **REJECT CANDIDATE:** Fundamental visual regressions, motion shudder, or unresolvable offload overhead negate benefits. Candidate remains disabled in catalog.
+
+### Mandatory Sign-Off Gates
+- [ ] **Licensing & Release Sign-off:** Verified upstream MIT License compliance (`experiments/minimax-h3-teacache/LICENSE`, copyright attribution to Icyoung, and non-encumbered open-source distribution). Approved for release gate review.
+- [ ] **Evidence Retention Sign-off:** All raw run directories (`.ai-runs/`), telemetry streams (`events.jsonl`), runtime manifests, reconstructed configs, and probed artifacts are securely retained and committed to durable evidence storage.
+
+**Operator Signature:** `___________________________`  
+**Date:** `YYYY-MM-DD`
diff --git a/docs/minimax-h3-teacache-source-audit.md b/docs/minimax-h3-teacache-source-audit.md
new file mode 100644
index 0000000..3f3120b
--- /dev/null
+++ b/docs/minimax-h3-teacache-source-audit.md
@@ -0,0 +1,88 @@
+# MiniMax-H3 TeaCache Source Audit & Adaptation Specification
+
+## 1. Upstream Audit & Cryptographic Pin
+
+This document records the architectural and security audit of the upstream MiniMax-H3 TeaCache candidate implementation, evaluated for isolated timestep-caching experiments under Issue #467.
+
+### Pinned Upstream Identity
+- **Repository:** `https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache`
+- **Candidate Commit:** `4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f`
+- **License:** MIT License (`Copyright (c) 2026 Icyoung`)
+- **Pyproject Version:** `0.1.0` (Python requirement `>=3.10`, dependencies: none beyond host PyTorch)
+
+### Audited Source File Hashes
+
+| File | SHA-256 Digest | Audit Status |
+| :--- | :--- | :--- |
+| `nodes.py` | `dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287` | Audited |
+| `teacache.py` | `97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f` | Audited |
+| `LICENSE` | `ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67` | Verified MIT |
+| `pyproject.toml` | `e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be` | Audited |
+| `__init__.py` | `8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416` | Audited |
+
+Security inspection confirms that the audited candidate files contain ordinary Python dataclass, tensor manipulation, and ComfyUI node registration code. No arbitrary network downloads, child process spawning, shell execution, or binary extensions are present.
+
+---
+
+## 2. Pinned ComfyUI Core Compatibility & Output Semantics
+
+The target environment runs ComfyUI core pinned at commit `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc` (ComfyUI v0.33.0).
+
+### Core Dispatch Compatibility
+- `ModelPatcher.set_model_unet_function_wrapper`: Supported on pinned core. It registers `model_options["model_function_wrapper"]`.
+- When sampling executes (e.g. within `comfy.samplers` or `comfy_extras.nodes_custom_sampler.SamplerCustomAdvanced`), the wrapper intercepts model evaluation as:
+  ```python
+  model_function_wrapper(apply_model, {"input": x, "timestep": timestep, "c": c, "cond_or_uncond": cond_or_uncond})
+  ```
+- **H3 Model Semantics:** In MiniMax-H3, `BaseModel._apply_model` calls `diffusion_model` on packed AV tensors, concatenates stream outputs, and computes denoised predictions via `model_sampling.calculate_denoised`.
+- **Denoised Output Reuse Approximation:** The upstream node caches and returns the previous output of `apply_model`. On the pinned core, this returns the denoised prediction, not an intermediate transformer residual or velocity. Reusing this tensor is an intentional approximation that risks cumulative motion, identity, and audio degradation.
+
+### Generation Route Compatibility
+- **I2V (`MiniMaxH3ImageToVideo`):** Supported. Node returns conditioning in slot 0 and packed latent in slot 1.
+- **Ref2V (`MiniMaxH3ReferenceToVideo`):** Supported. Ordered reference images are embedded into conditioning and injected inside diffusion evaluations.
+- **Fail-Closed Policy:** Any route using unknown conditioning schemas, variable sigma shifts, or altered precision must fail closed.
+
+---
+
+## 3. Upstream Analysis & Required Architectural Adaptations
+
+Static audit identified six critical issues in upstream `4cbb50d6` that prevent unadapted production deployment:
+
+1. **Unmanaged Long-Lived State:** Upstream instantiates a cache state dataclass during node `apply()` and closes over it in the wrapper. Because ComfyUI's execution cache can reuse outputs across multiple prompt submissions, this state is not reset on subsequent runs, prompt retries, or seed changes.
+2. **Unbounded Step Counter:** Upstream increments `step_idx` on every wrapper invocation without verifying the actual sigma sequence, scheduler step count, or multi-branch evaluation. If guider evaluates multiple branches or if steps are interrupted, step indexing desynchronizes.
+3. **Tensor Aliasing via Detach without Clone:** Upstream caches `input.detach()` and `output.detach()`. If downstream nodes or samplers mutate tensors in place, cached state is corrupted.
+4. **Denoised Prediction Reuse:** Upstream returns the previous full denoised model output. While this avoids transformer compute, packed video and audio latents can experience drift. This must be recorded as an experimental approximation (`raw-l1-v1`), not exact mathematical equivalence.
+5. **Raw Relative-L1 Accumulation:** Upstream calculates `rel_l1 = (curr - prev).abs().mean() / prev.abs().mean()`. Without polynomial calibration, large video latent deltas can obscure audio latent differences.
+6. **Self-Reported Counters:** Upstream counts wrapper calls internally. The test harness requires independent interception of `diffusion_model` forwards to verify that compute was truly skipped.
+
+---
+
+## 4. Repository-Owned Adapted Node: `CCOMiniMaxH3TeaCache`
+
+To resolve these findings while preserving the candidate's core algorithm, the repository provides an isolated adapted node (`CCOMiniMaxH3TeaCacheNode`):
+
+- **Node Key:** `CCOMiniMaxH3TeaCache`
+- **Adapter Version:** `0.1.0-cco-experimental`
+
+### Local In-Tree Adapter File Hashes
+| File | SHA-256 Digest | Role |
+| :--- | :--- | :--- |
+| `__init__.py` | `db3a565640d2052fda48f90f22734343a55285edcedd0305faf813e0e8fbbca4` | Node mapping registration & export |
+| `nodes.py` | `74f3616d6fe786c6400975b1b5c38a1a6263ee06bf7579b3a65f85d434d03c56` | ComfyUI custom node definition & input validation |
+| `teacache.py` | `139d920f353ed186b7516ca5edc93bd15f39c1eb749c6efb3fa39b992e0f4fdf` | Session management, sigma validation, tensor caching |
+
+- **Execution-Local Session Lifecycle:** Each `SamplerCustomAdvanced` invocation creates an isolated `TeaCacheSession` bound via context variables (`contextvars`). The session is strictly cleaned up in a `finally` block on completion or error.
+- **Tensor Isolation:** Cached inputs and outputs are explicitly cloned (`.detach().clone()`).
+- **Sigma Schedule Validation:** The session validates a canonical 20-step schedule (21 strictly descending finite sigmas) at initialization and maps logical steps directly.
+- **Independent Instrumentation:** The collector hooks `BaseModel._apply_model` / `diffusion_model` to verify that cache hits perform zero transformer evaluations.
+- **Parameter Bounds:**
+  - `rel_l1_thresh`: Conservative candidate grid `{0.05, 0.10, 0.15}`.
+  - Step window: Half-open interval `[start_step, end_step)`. Enforces at least the first 2 and last 2 steps remain unskipped: `2 <= start_step < effective_end <= 18`.
+
+---
+
+## 5. Security, Licensing, & Governance Boundary
+
+- The adapted code retains upstream MIT copyright notices.
+- Caching is disabled by default in all production ShotPlan routes and worker execution.
+- No hardware speedup claims or aesthetic approvals are asserted by offline CI. Live measurements and visual reviews are governed strictly by Issue #445.
diff --git a/experiments/minimax-h3-teacache/LICENSE b/experiments/minimax-h3-teacache/LICENSE
new file mode 100644
index 0000000..0756b62
--- /dev/null
+++ b/experiments/minimax-h3-teacache/LICENSE
@@ -0,0 +1,22 @@
+MIT License
+
+Copyright (c) 2026 Icyoung
+Adapted for Comfy Content Orchestrator (CCO)
+
+Permission is hereby granted, free of charge, to any person obtaining a copy
+of this software and associated documentation files (the "Software"), to deal
+in the Software without restriction, including without limitation the rights
+to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+copies of the Software, and to permit persons to whom the Software is
+furnished to do so, subject to the following conditions:
+
+The above copyright notice and this permission notice shall be included in all
+copies or substantial portions of the Software.
+
+THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+SOFTWARE.
diff --git a/experiments/minimax-h3-teacache/__init__.py b/experiments/minimax-h3-teacache/__init__.py
new file mode 100644
index 0000000..2538d51
--- /dev/null
+++ b/experiments/minimax-h3-teacache/__init__.py
@@ -0,0 +1,36 @@
+"""
+MiniMax-H3 TeaCache ComfyUI Custom Node Package (CCO Adapted)
+Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
+"""
+
+try:
+    from . import teacache as _teacache_mod
+    from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, CCOMiniMaxH3TeaCacheNode
+    from .teacache import (
+        TeaCacheSession,
+        get_active_session,
+        set_active_session,
+        reset_active_session,
+        SUPPORTED_THRESHOLDS,
+    )
+except ImportError:
+    import teacache as _teacache_mod
+    from nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS, CCOMiniMaxH3TeaCacheNode
+    from teacache import (
+        TeaCacheSession,
+        get_active_session,
+        set_active_session,
+        reset_active_session,
+        SUPPORTED_THRESHOLDS,
+    )
+
+__all__ = [
+    "NODE_CLASS_MAPPINGS",
+    "NODE_DISPLAY_NAME_MAPPINGS",
+    "CCOMiniMaxH3TeaCacheNode",
+    "TeaCacheSession",
+    "get_active_session",
+    "set_active_session",
+    "reset_active_session",
+    "SUPPORTED_THRESHOLDS",
+]
diff --git a/experiments/minimax-h3-teacache/catalog.json b/experiments/minimax-h3-teacache/catalog.json
new file mode 100644
index 0000000..e99d061
--- /dev/null
+++ b/experiments/minimax-h3-teacache/catalog.json
@@ -0,0 +1,252 @@
+[
+  {
+    "variantName": "teacache-raw-l1",
+    "route": "i2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-raw-l1-i2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [0.05, 0.1, 0.15],
+    "defaultThreshold": 0.15,
+    "stepWindow": {
+      "minStartStep": 2,
+      "maxEndStep": 18,
+      "defaultStartStep": 2,
+      "defaultEndStep": 18,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Stage CCOMiniMaxH3TeaCache experimental custom node; no extra wheel packages.",
+      "teardownRecipe": "Remove staged custom node and restore clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending",
+      "Candidate timestep caching approximation requires live RTX 4090 visual and continuity review (#445)"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py",
+        "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+        "digest": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
+        "assertion": "Upstream MiniMaxH3TeaCache node registers MODEL patch wrapping set_model_unet_function_wrapper."
+      },
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Pinned ComfyUI core provides ModelPatcher.set_model_unet_function_wrapper."
+      }
+    ],
+    "catalogDigest": "49965bc2504b97062b2f64d93d7502daabca9a2dfb3a0df8cfdd15d7a99dd90b"
+  },
+  {
+    "variantName": "matched-control",
+    "route": "i2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-matched-control-i2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [],
+    "defaultThreshold": 0,
+    "stepWindow": {
+      "minStartStep": 0,
+      "maxEndStep": 0,
+      "defaultStartStep": 0,
+      "defaultEndStep": 0,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Identical substrate to candidate without TeaCache patch.",
+      "teardownRecipe": "Preserve clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Baseline matched control runs dense 20-step sampling on identical substrate with caching disabled."
+      }
+    ],
+    "catalogDigest": "6270a82be24dec78ba87f24313ba3079b879e63afbdb5c97cb3aaa773200d5c0"
+  },
+  {
+    "variantName": "teacache-raw-l1",
+    "route": "ref2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-raw-l1-ref2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [0.05, 0.1, 0.15],
+    "defaultThreshold": 0.15,
+    "stepWindow": {
+      "minStartStep": 2,
+      "maxEndStep": 18,
+      "defaultStartStep": 2,
+      "defaultEndStep": 18,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Stage CCOMiniMaxH3TeaCache experimental custom node; no extra wheel packages.",
+      "teardownRecipe": "Remove staged custom node and restore clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending",
+      "Candidate timestep caching approximation requires live RTX 4090 visual and continuity review (#445)"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/nodes.py",
+        "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+        "digest": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
+        "assertion": "Upstream MiniMaxH3TeaCache node registers MODEL patch wrapping set_model_unet_function_wrapper."
+      },
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Pinned ComfyUI core provides ModelPatcher.set_model_unet_function_wrapper."
+      }
+    ],
+    "catalogDigest": "6423d231905f0c2395e1e69ce85c602a0d0399e6f73d4fbe8acb7d066d3abd27"
+  },
+  {
+    "variantName": "matched-control",
+    "route": "ref2v",
+    "compatibilityState": "unverified",
+    "scope": "teacache-matched-control-ref2v",
+    "comfyuiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "customNode": {
+      "name": "CCOMiniMaxH3TeaCache",
+      "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+      "revision": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+      "entrypoint": "nodes.py"
+    },
+    "runnable": false,
+    "supportedThresholds": [],
+    "defaultThreshold": 0,
+    "stepWindow": {
+      "minStartStep": 0,
+      "maxEndStep": 0,
+      "defaultStartStep": 0,
+      "defaultEndStep": 0,
+      "requiredTotalSteps": 20
+    },
+    "pythonPackages": [
+      {
+        "name": "torch",
+        "version": "2.5.1+cu124",
+        "importModule": "torch"
+      }
+    ],
+    "cudaRequirement": ">=12.4",
+    "computeCapability": "sm_89",
+    "checkpointCompatibility": {
+      "filename": "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
+      "sha256": "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
+      "taskMode": "ref2va_pruned_int8"
+    },
+    "licensing": {
+      "status": "review_required",
+      "licenseSourceRef": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache/blob/4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f/LICENSE",
+      "securityReviewStatus": "pending"
+    },
+    "isolationInstructions": {
+      "venvSetup": "Standard pinned production venv with PyTorch 2.5.1+cu124.",
+      "installRecipe": "Identical substrate to candidate without TeaCache patch.",
+      "teardownRecipe": "Preserve clean environment."
+    },
+    "blockers": [
+      "Target runtime environment not yet inspected for hardware PyTorch/CUDA dispatch verification",
+      "Security review pending"
+    ],
+    "evidence": [
+      {
+        "url": "https://github.com/Comfy-Org/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_patcher.py",
+        "revision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+        "assertion": "Baseline matched control runs dense 20-step sampling on identical substrate with caching disabled."
+      }
+    ],
+    "catalogDigest": "e18b76df4ccc13366dd9d9060d1991a26fd36be53f0203a75672e8d7939a94d9"
+  }
+]
diff --git a/experiments/minimax-h3-teacache/fixtures/teacache-api.json b/experiments/minimax-h3-teacache/fixtures/teacache-api.json
new file mode 100644
index 0000000..4dfab4f
--- /dev/null
+++ b/experiments/minimax-h3-teacache/fixtures/teacache-api.json
@@ -0,0 +1,20 @@
+{
+  "upstreamRepository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+  "upstreamCommit": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+  "targetCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+  "upstreamNodeKey": "MiniMaxH3TeaCache",
+  "upstreamClassType": "MiniMaxH3TeaCacheNode",
+  "adaptedNodeKey": "CCOMiniMaxH3TeaCache",
+  "adaptedClassType": "CCOMiniMaxH3TeaCacheNode",
+  "inputSignature": {
+    "required": {
+      "model": ["MODEL"],
+      "rel_l1_thresh": ["FLOAT", { "default": 0.15, "min": 0.0, "max": 0.5, "step": 0.01 }],
+      "start_step": ["INT", { "default": 2, "min": 0, "max": 100, "step": 1 }],
+      "end_step": ["INT", { "default": -2, "min": -100, "max": 100, "step": 1 }],
+      "total_steps": ["INT", { "default": 20, "min": 1, "max": 1000, "step": 1 }]
+    }
+  },
+  "returnTypes": ["MODEL"],
+  "notes": "Adapted repository-owned TeaCache patch node wraps ModelPatcher.set_model_unet_function_wrapper with execution-local lifecycle sessions."
+}
diff --git a/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt b/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt
new file mode 100644
index 0000000..86b497a
--- /dev/null
+++ b/experiments/minimax-h3-teacache/locks/requirements-teacache-cu124.txt
@@ -0,0 +1,20 @@
+# ==============================================================================
+# Lockfile: MiniMax-H3 TeaCache Isolated Candidate Environment
+# ==============================================================================
+# Platform Metadata:
+#   OS: Linux x86_64 (glibc >= 2.35)
+#   Python: CPython 3.12 (ABI cp312)
+#   CUDA: 12.4
+#   PyTorch Toolchain: 2.5.1+cu124
+#
+# Candidate: CCOMiniMaxH3TeaCache (adapted from upstream 4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f)
+# Upstream pyproject.toml specifies:
+#   version = "0.1.0"
+#   requires-python = ">=3.10"
+#   dependencies = []
+#
+# No external compiled kernels or wheels required; uses host PyTorch and ComfyUI core.
+# Host PyTorch dependency:
+torch==2.5.1+cu124
+torchvision==0.20.1+cu124
+torchaudio==2.5.1+cu124
diff --git a/experiments/minimax-h3-teacache/nodes.py b/experiments/minimax-h3-teacache/nodes.py
new file mode 100644
index 0000000..410c64a
--- /dev/null
+++ b/experiments/minimax-h3-teacache/nodes.py
@@ -0,0 +1,127 @@
+"""
+MiniMax-H3 TeaCache ComfyUI Custom Node (CCO Adapted)
+Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
+"""
+
+import math
+from typing import Any, Dict, Tuple
+try:
+    from . import teacache as _teacache_mod
+    from .teacache import get_active_session, SUPPORTED_THRESHOLDS
+except ImportError:
+    import teacache as _teacache_mod
+    from teacache import get_active_session, SUPPORTED_THRESHOLDS
+
+
+class CCOMiniMaxH3TeaCacheNode:
+    _teacache_module = _teacache_mod
+
+    @classmethod
+    def INPUT_TYPES(cls):
+        return {
+            "required": {
+                "model": ("MODEL",),
+                "rel_l1_thresh": (
+                    "FLOAT",
+                    {"default": 0.15, "min": 0.0, "max": 0.5, "step": 0.01},
+                ),
+                "start_step": ("INT", {"default": 2, "min": 0, "max": 100, "step": 1}),
+                "end_step": ("INT", {"default": -2, "min": -100, "max": 100, "step": 1}),
+                "total_steps": ("INT", {"default": 20, "min": 1, "max": 1000, "step": 1}),
+            }
+        }
+
+    RETURN_TYPES = ("MODEL",)
+    RETURN_NAMES = ("model",)
+    FUNCTION = "apply"
+    CATEGORY = "model_patches/unet"
+
+    def apply(
+        self,
+        model: Any,
+        rel_l1_thresh: float,
+        start_step: int,
+        end_step: int,
+        total_steps: int,
+    ) -> Tuple[Any]:
+        # Validate parameter bounds
+        if isinstance(total_steps, bool) or not isinstance(total_steps, int) or total_steps != 20:
+            raise ValueError(f"TeaCache requires total_steps == 20, got {total_steps}")
+        if isinstance(rel_l1_thresh, bool) or not isinstance(rel_l1_thresh, (int, float)) or not math.isfinite(rel_l1_thresh):
+            raise ValueError(f"rel_l1_thresh must be a finite number, got {rel_l1_thresh}")
+        if round(float(rel_l1_thresh), 4) not in SUPPORTED_THRESHOLDS:
+            raise ValueError(
+                f"rel_l1_thresh must be one of {SUPPORTED_THRESHOLDS}, got {rel_l1_thresh}"
+            )
+
+        if isinstance(start_step, bool) or isinstance(end_step, bool) or not isinstance(start_step, int) or not isinstance(end_step, int):
+            raise ValueError("start_step and end_step must be integers")
+        norm_end = total_steps + end_step if end_step < 0 else end_step
+        if start_step < 2 or norm_end > 18 or start_step >= norm_end:
+            raise ValueError(
+                f"Invalid step window [{start_step}, {norm_end}); must satisfy 2 <= start < end <= 18"
+            )
+
+        m = model.clone() if hasattr(model, "clone") else model
+        opts = getattr(m, "model_options", None)
+        if opts is None:
+            opts = {}
+            m.model_options = opts
+
+        # Reject competing wrappers
+        existing_wrapper = opts.get("model_function_wrapper")
+        if existing_wrapper is not None:
+            raise RuntimeError(
+                "Competing model_function_wrapper already registered on model. TeaCache cannot be combined with existing wrapper."
+            )
+
+        patch_config = {
+            "rel_l1_thresh": float(rel_l1_thresh),
+            "start_step": int(start_step),
+            "end_step": int(end_step),
+            "normalized_end_step": int(norm_end),
+            "total_steps": int(total_steps),
+            "model_id": id(m),
+        }
+        opts["teacache_config"] = patch_config
+
+        def teacache_unet_wrapper(apply_model: Any, kwargs: Dict[str, Any]) -> Any:
+            session = _teacache_mod.get_active_session()
+            if session is None:
+                raise RuntimeError(
+                    "TeaCache model wrapper called without an active execution session"
+                )
+            if session.model_id != patch_config["model_id"]:
+                raise RuntimeError(
+                    f"TeaCacheSession model_id mismatch: session bound to {session.model_id}, "
+                    f"wrapper called on {patch_config['model_id']}"
+                )
+            if round(session.rel_l1_thresh, 4) != round(patch_config["rel_l1_thresh"], 4):
+                raise RuntimeError("TeaCacheSession rel_l1_thresh does not match patched model config")
+            if session.start_step != patch_config["start_step"] or session.end_step != patch_config["normalized_end_step"]:
+                raise RuntimeError("TeaCacheSession step window does not match patched model config")
+            if session.total_steps != patch_config["total_steps"]:
+                raise RuntimeError("TeaCacheSession total_steps does not match patched model config")
+            return session.evaluate(apply_model, kwargs)
+
+        teacache_unet_wrapper._cco_teacache = True
+        teacache_unet_wrapper._teacache_module = _teacache_mod
+        teacache_unet_wrapper._teacache_config = patch_config
+
+        if hasattr(m, "set_model_unet_function_wrapper"):
+            m.set_model_unet_function_wrapper(teacache_unet_wrapper)
+        else:
+            opts["model_function_wrapper"] = teacache_unet_wrapper
+
+        return (m,)
+
+
+NODE_CLASS_MAPPINGS = {
+    "CCOMiniMaxH3TeaCache": CCOMiniMaxH3TeaCacheNode,
+    "MiniMaxH3TeaCache": CCOMiniMaxH3TeaCacheNode,
+}
+
+NODE_DISPLAY_NAME_MAPPINGS = {
+    "CCOMiniMaxH3TeaCache": "MiniMax-H3 TeaCache (CCO Adapted)",
+    "MiniMaxH3TeaCache": "MiniMax-H3 TeaCache (Upstream Compatibility)",
+}
diff --git a/experiments/minimax-h3-teacache/source-manifest.json b/experiments/minimax-h3-teacache/source-manifest.json
new file mode 100644
index 0000000..1ed5ed6
--- /dev/null
+++ b/experiments/minimax-h3-teacache/source-manifest.json
@@ -0,0 +1,53 @@
+{
+  "upstream": {
+    "repository": "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache",
+    "commit": "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f",
+    "license": "MIT",
+    "licenseCopyright": "Copyright (c) 2026 Icyoung",
+    "pyprojectVersion": "0.1.0",
+    "pythonRequirement": ">=3.10",
+    "sourceFiles": {
+      "nodes.py": {
+        "sha256": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287"
+      },
+      "teacache.py": {
+        "sha256": "97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f"
+      },
+      "LICENSE": {
+        "sha256": "ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67"
+      },
+      "pyproject.toml": {
+        "sha256": "e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be"
+      },
+      "__init__.py": {
+        "sha256": "8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416"
+      }
+    }
+  },
+  "adaptedNode": {
+    "nodeClass": "CCOMiniMaxH3TeaCacheNode",
+    "nodeKey": "CCOMiniMaxH3TeaCache",
+    "adapterVersion": "0.1.0-cco-experimental",
+    "algorithm": "raw-l1-v1",
+    "targetComfyUiCoreRevision": "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
+    "localFiles": {
+      "__init__.py": {
+        "sha256": "3b14b0a4da6f0fa366d8da492ea85ce74f2a63f18336ac63970d9d2bfe128c94"
+      },
+      "nodes.py": {
+        "sha256": "ea16ae7ced6ab1ddfe7ba729a0a0c7047827f1e5601c6fd5c8363b837dd17d2c"
+      },
+      "teacache.py": {
+        "sha256": "ffd3c347182b31d85677e24c1bcf5386f0f49b354690a01e545c972c9756a19a"
+      }
+    },
+    "adaptationFindings": [
+      "F1: Upstream constructs state during node apply and closes over it; ComfyUI graph caching may reuse node output without re-executing apply. Adaptation uses execution-local session management scoped to each SamplerCustomAdvanced invocation.",
+      "F2: Upstream step counter advances on every wrapper call without checking sigmas, scheduler steps, or guider branching. Adaptation bounds step index strictly to the validated 20-interval sigma schedule.",
+      "F3: Upstream uses detach() without clone(), risking tensor aliasing if consumers mutate in place. Adaptation detaches and clones cached tensors.",
+      "F4: Upstream returns previous complete apply_model output (denoised prediction), which is an uncalibrated approximation on H3 packed AV streams. Adaptation preserves this explicit raw-L1 approximation with strict provenance tracking.",
+      "F5: Upstream uses raw relative-L1 on packed AV latents without polynomial rescale. Adaptation maintains the audited raw-L1 formula with finite value checks.",
+      "F6: Upstream counters are self-reported. Adaptation adds independent diffusion_model forward interception to prove skips."
+    ]
+  }
+}
diff --git a/experiments/minimax-h3-teacache/teacache.py b/experiments/minimax-h3-teacache/teacache.py
new file mode 100644
index 0000000..5207cb1
--- /dev/null
+++ b/experiments/minimax-h3-teacache/teacache.py
@@ -0,0 +1,327 @@
+"""
+MiniMax-H3 TeaCache Session & Caching Engine (CCO Adapted)
+Upstream ancestry: https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache (MIT)
+"""
+
+import contextvars
+import math
+import sys
+import threading
+from typing import Any, Dict, List, Optional, Tuple
+
+SUPPORTED_THRESHOLDS = (0.05, 0.1, 0.15)
+
+_SHARED_VAR_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_SESSION_VAR"
+if hasattr(sys, _SHARED_VAR_KEY):
+    _ACTIVE_TEACACHE_SESSION = getattr(sys, _SHARED_VAR_KEY)
+else:
+    _ACTIVE_TEACACHE_SESSION = contextvars.ContextVar(
+        "_ACTIVE_TEACACHE_SESSION", default=None
+    )
+    setattr(sys, _SHARED_VAR_KEY, _ACTIVE_TEACACHE_SESSION)
+
+# Process-wide registry of model_ids with a currently-active TeaCache session.
+# Guards against two sessions being activated for the same model concurrently
+# (e.g. nested/re-entrant sampling, or a leaked session from a prior failed
+# setup) regardless of which asyncio/thread context activated them -- the
+# ContextVar alone only isolates *context*, not *model identity*.
+_ACTIVE_MODEL_IDS_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_MODEL_IDS"
+_ACTIVE_MODEL_IDS_LOCK_KEY = "_CCO_MINIMAX_H3_TEACACHE_ACTIVE_MODEL_IDS_LOCK"
+if hasattr(sys, _ACTIVE_MODEL_IDS_KEY):
+    _ACTIVE_MODEL_IDS = getattr(sys, _ACTIVE_MODEL_IDS_KEY)
+    _ACTIVE_MODEL_IDS_LOCK = getattr(sys, _ACTIVE_MODEL_IDS_LOCK_KEY)
+else:
+    _ACTIVE_MODEL_IDS = set()
+    _ACTIVE_MODEL_IDS_LOCK = threading.Lock()
+    setattr(sys, _ACTIVE_MODEL_IDS_KEY, _ACTIVE_MODEL_IDS)
+    setattr(sys, _ACTIVE_MODEL_IDS_LOCK_KEY, _ACTIVE_MODEL_IDS_LOCK)
+
+
+class TeaCacheSession:
+    def __init__(
+        self,
+        session_id: str,
+        model_id: Any,
+        rel_l1_thresh: float,
+        start_step: int,
+        end_step: int,
+        total_steps: int = 20,
+        sigmas: Optional[List[float]] = None,
+        event_callback: Optional[Any] = None,
+    ):
+        if sigmas is None:
+            raise ValueError(
+                "sigmas schedule is required: TeaCache cannot verify step/timestep "
+                "alignment without the sampler's actual sigma schedule"
+            )
+        if isinstance(total_steps, bool) or not isinstance(total_steps, int) or total_steps != 20:
+            raise ValueError(f"total_steps must be 20, got {total_steps}")
+        if isinstance(rel_l1_thresh, bool) or not isinstance(rel_l1_thresh, (int, float)) or not math.isfinite(rel_l1_thresh):
+            raise ValueError(f"rel_l1_thresh must be a finite number, got {rel_l1_thresh}")
+        if round(float(rel_l1_thresh), 4) not in SUPPORTED_THRESHOLDS:
+            raise ValueError(
+                f"rel_l1_thresh must be one of {SUPPORTED_THRESHOLDS}, got {rel_l1_thresh}"
+            )
+        if isinstance(start_step, bool) or isinstance(end_step, bool) or not isinstance(start_step, int) or not isinstance(end_step, int):
+            raise ValueError("start_step and end_step must be integers")
+
+        effective_end = total_steps + end_step if end_step < 0 else end_step
+        if start_step < 2 or effective_end > 18 or start_step >= effective_end:
+            raise ValueError(
+                f"Invalid step window [{start_step}, {effective_end}); must satisfy 2 <= start < end <= 18"
+            )
+
+        self.session_id = str(session_id)
+        self.model_id = model_id
+        self.rel_l1_thresh = float(rel_l1_thresh)
+        self.start_step = int(start_step)
+        self.raw_end_step = int(end_step)
+        self.end_step = int(effective_end)
+        self.normalized_end_step = int(effective_end)
+        self.total_steps = int(total_steps)
+        self.event_callback = event_callback
+
+        self.accumulated_rel_l1 = 0.0
+        self.last_real_input = None
+        self.last_real_output = None
+        self.step_idx = -1
+        self.forward_calls_count = 0
+        self.cache_hits_count = 0
+        self.nested_forwards_on_hits = 0
+        self.evaluations_in_current_step = 0
+        self.is_evaluating = False
+        self.is_evaluating_hit = False
+        self.is_active = True
+        self.conditioning_fingerprint: Optional[Tuple[Any, ...]] = None
+        self._lock = threading.Lock()
+
+        # Validate sigmas if provided
+        self.sigmas: Optional[List[float]] = None
+        if sigmas is not None:
+            self.set_and_validate_sigmas(sigmas)
+
+    def set_and_validate_sigmas(self, sigmas: List[float]):
+        if len(sigmas) != self.total_steps + 1:
+            raise ValueError(
+                f"Expected schedule with {self.total_steps + 1} sigmas for {self.total_steps} steps, got {len(sigmas)}"
+            )
+        for i, s in enumerate(sigmas):
+            val = float(s)
+            if not math.isfinite(val):
+                raise ValueError(f"Sigma at index {i} is non-finite: {s}")
+            if i > 0 and val >= float(sigmas[i - 1]):
+                raise ValueError(
+                    f"Sigma schedule is not strictly descending at index {i}: {sigmas[i - 1]} -> {val}"
+                )
+        self.sigmas = [float(s) for s in sigmas]
+
+    def advance_step(self, step_index: int):
+        with self._lock:
+            if not self.is_active:
+                raise RuntimeError("Cannot advance step on inactive or cleaned-up TeaCacheSession")
+            if isinstance(step_index, bool) or not isinstance(step_index, int) or not (0 <= step_index < self.total_steps):
+                raise ValueError(
+                    f"step_index must be an integer in [0, {self.total_steps}), got {step_index}"
+                )
+            if self.step_idx == -1:
+                if step_index != 0:
+                    raise ValueError(f"First step advancement must be to step 0, got {step_index}")
+            else:
+                if step_index <= self.step_idx:
+                    raise ValueError(
+                        f"step_index cannot repeat or go backwards: current {self.step_idx}, got {step_index}"
+                    )
+                if step_index > self.step_idx + 1:
+                    raise ValueError(
+                        f"step_index jumped non-sequentially: current {self.step_idx}, got {step_index}"
+                    )
+            self.step_idx = int(step_index)
+            self.evaluations_in_current_step = 0
+
+    def evaluate(self, apply_model: Any, kwargs: Dict[str, Any]) -> Any:
+        with self._lock:
+            if not self.is_active:
+                raise RuntimeError("Cannot evaluate on inactive or cleaned-up TeaCacheSession")
+            if self.step_idx < 0:
+                raise RuntimeError("Cannot evaluate on TeaCacheSession before first step advancement")
+            if self.is_evaluating:
+                raise RuntimeError(
+                    "Concurrent or reentrant evaluation on the same TeaCacheSession is forbidden"
+                )
+            if self.evaluations_in_current_step > 0:
+                raise RuntimeError(
+                    f"Duplicate or multi-branch evaluation detected in step {self.step_idx}: "
+                    "exactly one evaluation per step interval is supported"
+                )
+            self.is_evaluating = True
+
+        try:
+            curr_input = kwargs.get("input")
+            if curr_input is None:
+                raise ValueError("kwargs missing 'input' tensor")
+
+            # Validate timestep alignment against the pinned sigma schedule.
+            # Both sides are mandatory (fail-closed): a missing timestep or an
+            # unreadable/mismatched value must abort the step, not silently
+            # skip the scheduler-conformance check.
+            curr_timestep = kwargs.get("timestep")
+            if curr_timestep is None:
+                raise ValueError(
+                    f"kwargs missing 'timestep' tensor at step {self.step_idx}; "
+                    "cannot verify scheduler alignment"
+                )
+            expected_sigma = self.sigmas[self.step_idx]
+            try:
+                ts_val = float(curr_timestep.item() if hasattr(curr_timestep, "item") else curr_timestep)
+            except Exception as conv_err:
+                raise ValueError(
+                    f"Timestep at step {self.step_idx} is not convertible to a finite scalar: {conv_err}"
+                ) from conv_err
+            if not math.isfinite(ts_val) or abs(ts_val - expected_sigma) > 1e-1:
+                raise ValueError(
+                    f"Timestep {ts_val} does not match expected schedule sigma {expected_sigma} at step {self.step_idx}"
+                )
+
+            cond_or_uncond = kwargs.get("cond_or_uncond")
+            if cond_or_uncond is not None:
+                if isinstance(cond_or_uncond, (list, tuple)) and len(cond_or_uncond) > 1:
+                    raise RuntimeError(
+                        f"Multi-condition/CFG branching is unsupported by TeaCache: cond_or_uncond={cond_or_uncond}"
+                    )
+
+            # Bind this session to the specific route/conditioning shape it was
+            # first called with. A cached output is only a valid substitute for
+            # a later real forward if the surrounding conditioning manifest
+            # (which keys are present, their kind, and the cond/uncond arity)
+            # is unchanged -- otherwise the cache would silently serve output
+            # computed under a different route (e.g. I2V vs Ref2V) or a
+            # different reference-image binding.
+            c = kwargs.get("c")
+            c_fingerprint_keys = tuple(sorted(c.keys())) if isinstance(c, dict) else None
+            fingerprint = (
+                tuple(sorted(k for k in kwargs if k not in ("input", "timestep", "c"))),
+                c_fingerprint_keys,
+                len(cond_or_uncond) if isinstance(cond_or_uncond, (list, tuple)) else cond_or_uncond,
+            )
+            if self.conditioning_fingerprint is None:
+                self.conditioning_fingerprint = fingerprint
+            elif self.conditioning_fingerprint != fingerprint:
+                raise RuntimeError(
+                    "Conditioning manifest changed mid-session: TeaCache was bound to "
+                    f"{self.conditioning_fingerprint}, saw {fingerprint} at step {self.step_idx}. "
+                    "A cached forward output cannot be reused across a route/conditioning change."
+                )
+
+            in_window = self.start_step <= self.step_idx < self.end_step
+            should_hit = False
+            rel_l1 = 0.0
+
+            if in_window and self.last_real_input is not None and self.last_real_output is not None:
+                if curr_input.shape != self.last_real_input.shape:
+                    raise ValueError(
+                        f"Input tensor shape mismatch with cached state: {curr_input.shape} vs {self.last_real_input.shape}"
+                    )
+                if curr_input.dtype != self.last_real_input.dtype:
+                    raise ValueError(
+                        f"Input tensor dtype mismatch with cached state: {curr_input.dtype} vs {self.last_real_input.dtype}"
+                    )
+                if curr_input.device != self.last_real_input.device:
+                    raise ValueError(
+                        f"Input tensor device mismatch with cached state: {curr_input.device} vs {self.last_real_input.device}"
+                    )
+
+                # Relative L1 calculation
+                diff = (curr_input.float() - self.last_real_input.float()).abs().mean()
+                norm = self.last_real_input.float().abs().mean()
+                if norm == 0:
+                    rel_l1 = 0.0
+                else:
+                    rel_l1 = (diff / norm).item()
+
+                if not math.isfinite(rel_l1) or rel_l1 < 0:
+                    raise ValueError(f"Non-finite or negative relative L1 computed: {rel_l1}")
+
+                if self.accumulated_rel_l1 + rel_l1 < self.rel_l1_thresh:
+                    should_hit = True
+                    self.accumulated_rel_l1 += rel_l1
+
+            if should_hit:
+                self.is_evaluating_hit = True
+                self.cache_hits_count += 1
+                self.evaluations_in_current_step += 1
+                if self.event_callback:
+                    self.event_callback(
+                        event="cache_hit",
+                        stepIndex=self.step_idx,
+                        step_index=self.step_idx,
+                        rel_l1=rel_l1,
+                        accumulated_rel_l1=self.accumulated_rel_l1,
+                        thresh=self.rel_l1_thresh,
+                    )
+                # Output clone prevents in-place mutation of cached output
+                return self.last_real_output.clone()
+            else:
+                self.is_evaluating_hit = False
+                self.accumulated_rel_l1 = 0.0
+                self.forward_calls_count += 1
+                self.evaluations_in_current_step += 1
+                if self.event_callback:
+                    self.event_callback(
+                        event="cache_miss",
+                        stepIndex=self.step_idx,
+                        step_index=self.step_idx,
+                        rel_l1=rel_l1,
+                        accumulated_rel_l1=self.accumulated_rel_l1,
+                        thresh=self.rel_l1_thresh,
+                    )
+                c = kwargs.get("c")
+                c_kwargs = c if isinstance(c, dict) else {k: v for k, v in kwargs.items() if k not in ("input", "timestep", "cond_or_uncond")}
+                if curr_timestep is not None:
+                    try:
+                        out = apply_model(curr_input, curr_timestep, **c_kwargs)
+                    except TypeError as te:
+                        if "positional argument" in str(te):
+                            out = apply_model(curr_input, **c_kwargs)
+                        else:
+                            raise
+                else:
+                    out = apply_model(curr_input, **c_kwargs)
+                self.last_real_input = curr_input.detach().clone()
+                self.last_real_output = out.detach().clone()
+                return out
+        finally:
+            with self._lock:
+                self.is_evaluating = False
+                self.is_evaluating_hit = False
+
+    def cleanup(self):
+        with self._lock:
+            self.last_real_input = None
+            self.last_real_output = None
+            self.is_active = False
+            self.is_evaluating = False
+            self.is_evaluating_hit = False
+        with _ACTIVE_MODEL_IDS_LOCK:
+            _ACTIVE_MODEL_IDS.discard(self.model_id)
+
+
+def get_active_session() -> Optional[TeaCacheSession]:
+    return _ACTIVE_TEACACHE_SESSION.get()
+
+
+def set_active_session(session: Optional[TeaCacheSession]) -> Any:
+    if session is not None:
+        with _ACTIVE_MODEL_IDS_LOCK:
+            if session.model_id in _ACTIVE_MODEL_IDS:
+                raise RuntimeError(
+                    f"A TeaCache session is already active for model_id={session.model_id!r}. "
+                    "Nested or re-entrant sessions on the same model are forbidden -- "
+                    "the prior session was either never cleaned up (a leaked session from "
+                    "a failed setup) or this call is genuinely concurrent/re-entrant."
+                )
+            _ACTIVE_MODEL_IDS.add(session.model_id)
+    return _ACTIVE_TEACACHE_SESSION.set(session)
+
+
+def reset_active_session(token: Any):
+    _ACTIVE_TEACACHE_SESSION.reset(token)
diff --git a/packages/application/src/experiments/index.ts b/packages/application/src/experiments/index.ts
index 5c6f09b..5f36db0 100644
--- a/packages/application/src/experiments/index.ts
+++ b/packages/application/src/experiments/index.ts
@@ -4,6 +4,9 @@ export * from "./minimax-h3-timing-reducer.js";
 export * from "./minimax-h3-comparator.js";
 export * from "./minimax-h3-attention-catalog.js";
 export * from "./minimax-h3-attention-topology.js";
+export * from "./minimax-h3-teacache-topology.js";
+export * from "./minimax-h3-teacache-catalog.js";
+export * from "./minimax-h3-teacache-reducer.js";
 export * from "./minimax-h3-attention-reducer.js";
 export * from "./minimax-h3-step-reduction-catalog.js";
 export * from "./minimax-h3-step-reduction-compiler.js";
diff --git a/packages/application/src/experiments/minimax-h3-comparator.test.ts b/packages/application/src/experiments/minimax-h3-comparator.test.ts
index 3500065..19391e1 100644
--- a/packages/application/src/experiments/minimax-h3-comparator.test.ts
+++ b/packages/application/src/experiments/minimax-h3-comparator.test.ts
@@ -21,8 +21,11 @@ import {
   type MinimaxH3ExperimentEvent,
   type MinimaxH3AnyExperimentDescriptor,
   type MinimaxH3AnyExperimentResult,
-  type MinimaxH3ObservedProvenance
+  type MinimaxH3ObservedProvenance,
+  type MinimaxH3InstrumentationEvent,
+  MinimaxH3ExperimentResultV2Schema
 } from "@cco/contracts";
+import { reduceTeaCacheObservation } from "./minimax-h3-teacache-reducer.js";
 import { sha256Hex, MinimaxH3ExperimentService } from "./minimax-h3-experiment-service.js";
 import type { MinimaxH3ExperimentStorePort } from "../ports/minimax-h3-experiment-ports.js";
 
@@ -4074,4 +4077,1074 @@ describe("Service-generated Matched Pairs Admission and Comparison", () => {
       ).toBe(true);
     });
   });
+
+  describe("TeaCache Comparator Admission & Speedup Gating", () => {
+    it("admits matched baseline and TeaCache candidate pair with calculated speedup ratios", async () => {
+      const service = setupServiceWithTemplates();
+      const prompt = "A cinematic shot of a sunset over the ocean";
+
+      const { descriptor: baseDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-pair-base",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        teacacheMatchedControl: true,
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const { descriptor: varDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-pair-var",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        teacache: "raw-l1-v1",
+        teacacheThreshold: 0.15,
+        teacacheStartStep: 2,
+        teacacheEndStep: -2,
+        teacacheTotalSteps: 20,
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
+        phaseAccounting: {
+          ...createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
+          status: "complete",
+          wholeAttemptWallMs: 420000,
+          samplingWallTimeMs: 380000
+        },
+        teacacheObservation: {
+          status: "verified",
+          mode: "off",
+          requestedConfig: null,
+          effectiveConfig: null,
+          totalSteps: 20,
+          forwardCallsRecorded: 20,
+          cacheHitsRecorded: 0,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 20,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 380000,
+            modelForwardElapsedMs: 350000,
+            decisionOverheadMs: 0,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+
+      const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
+        execution: {
+          ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).execution,
+          latencyMs: 280000
+        },
+        phaseAccounting: {
+          ...createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2).phaseAccounting,
+          status: "complete",
+          wholeAttemptWallMs: 280000,
+          samplingWallTimeMs: 240000
+        },
+        teacacheObservation: {
+          status: "verified",
+          mode: "raw-l1-v1",
+          requestedConfig: {
+            mode: "raw-l1-v1",
+            relL1Thresh: 0.15,
+            startStep: 2,
+            endStep: -2,
+            totalSteps: 20,
+            normalizedStartStep: 2,
+            normalizedEndStep: 18
+          },
+          effectiveConfig: {
+            mode: "raw-l1-v1",
+            relL1Thresh: 0.15,
+            startStep: 2,
+            endStep: -2,
+            totalSteps: 20,
+            normalizedStartStep: 2,
+            normalizedEndStep: 18
+          },
+          totalSteps: 20,
+          forwardCallsRecorded: 14,
+          cacheHitsRecorded: 6,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 14,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 240000,
+            modelForwardElapsedMs: 220000,
+            decisionOverheadMs: 15,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+
+      const report = compareMinimaxH3Experiments({
+        baselineDescriptor: baseDesc,
+        baselineResult: baseResult,
+        variantDescriptor: varDesc,
+        variantResult: varResult
+      });
+
+      expect(report.structuralAdmission.eligible).toBe(true);
+      expect(report.structuralAdmission.invariantProjectionKey).toBeTruthy();
+      expect(report.metricEligibility.samplingWallEligible).toBe(true);
+      expect(report.metrics?.samplingWallTimeRatio).toBeCloseTo(240000 / 380000, 2);
+      expect(report.metrics?.wallTimeRatio).toBeCloseTo(280000 / 420000, 2);
+    });
+
+    it("disqualifies speedup metrics when TeaCache observation status is no_op (0 cache hits)", async () => {
+      const service = setupServiceWithTemplates();
+      const prompt = "A cinematic shot of a sunset over the ocean";
+
+      const { descriptor: baseDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-noop-base",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        teacacheMatchedControl: true,
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const { descriptor: varDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-noop-var",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        teacache: "raw-l1-v1",
+        teacacheThreshold: 0.05,
+        teacacheStartStep: 2,
+        teacacheEndStep: -2,
+        teacacheTotalSteps: 20,
+        comfyUiDir: "/opt/comfyui",
+        pythonPath: "/usr/bin/python3",
+        inputManifestPath: "manifest-i2v.json"
+      });
+
+      const baseResult = createCompletedResultV2(baseDesc as MinimaxH3ExperimentDescriptorV2, {
+        teacacheObservation: {
+          status: "verified",
+          mode: "off",
+          requestedConfig: null,
+          effectiveConfig: null,
+          totalSteps: 20,
+          forwardCallsRecorded: 20,
+          cacheHitsRecorded: 0,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 20,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 380000,
+            modelForwardElapsedMs: 350000,
+            decisionOverheadMs: 0,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+      const varResult = createCompletedResultV2(varDesc as MinimaxH3ExperimentDescriptorV2, {
+        teacacheObservation: {
+          status: "no_op",
+          mode: "raw-l1-v1",
+          requestedConfig: null,
+          effectiveConfig: null,
+          totalSteps: 20,
+          forwardCallsRecorded: 20,
+          cacheHitsRecorded: 0,
+          nestedForwardsOnHits: 0,
+          coverage: {
+            samplingCallsRecorded: 1,
+            modelForwardsRecorded: 20,
+            complete: true
+          },
+          timings: {
+            samplingWallMs: 380000,
+            modelForwardElapsedMs: 350000,
+            decisionOverheadMs: 15,
+            timingUnavailableReason: null
+          },
+          failureReason: null
+        }
+      });
+
+      const report = compareMinimaxH3Experiments({
+        baselineDescriptor: baseDesc,
+        baselineResult: baseResult,
+        variantDescriptor: varDesc,
+        variantResult: varResult
+      });
+
+      expect(report.metricEligibility.samplingWallEligible).toBe(false);
+      expect(report.metricEligibility.reasons.some((r) => r.includes("0 cache hits"))).toBe(true);
+      expect(report.metrics).toBeNull();
+    });
+
+    it("disqualifies speedup metrics when TeaCache observation records nested forward passes on hits", async () => {
+      const service = setupServiceWithTemplates();
+      const prompt = "A cinematic shot of a sunset over the ocean";
+
+      const { descriptor: baseDesc } = await service.prepareExperiment({
+        route: "i2v",
+        frames: 124,
+        seed: 42,
+        prompt,
+        operatorLabel: "operator",
+        runId: "tc-contam-base",
+        outputRoot: ".ai-runs/minimax-h3-experiments",
+        targetHost: "render-worker-01",
+        gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
+        comfyUiDir: "/opt/comfyui",
+        py

... [diff truncated: 396,957 characters exceeds the 250,000-character prompt budget; showing the first and last portions. Rely on the finding ledger and the since-last-review diff for the authoritative record of what changed and what remains unresolved.] ...

sons.length > 0) {
+    finalStatus = "failed";
+    failureReason = failureReasons.join("; ");
+  } else if (teacacheRequest.mode === "raw-l1-v1" && cacheHitsRecorded === 0) {
+    finalStatus = "no_op";
+    failureReason = null;
+  } else {
+    finalStatus = "verified";
+    failureReason = null;
+  }
+
+  // A set of 20 distinct step values is not the same guarantee as "steps 0
+  // through 19 were each evaluated once" -- e.g. 20 distinct but
+  // out-of-range indices (observed from an adversarial/malformed stream)
+  // would pass a bare size check. Require the exact contiguous range.
+  let stepsCoverFullRange = seenSteps.size === 20;
+  if (stepsCoverFullRange) {
+    for (let i = 0; i < 20; i++) {
+      if (!seenSteps.has(i)) {
+        stepsCoverFullRange = false;
+        break;
+      }
+    }
+  }
+
+  const complete =
+    identityValidated &&
+    finalStatus !== "failed" &&
+    samplingCallsRecorded > 0 &&
+    samplingSpanEndSeen &&
+    (teacacheRequest.mode === "off"
+      ? modelForwardsRecorded === 20 && forwardCallsRecorded === 20
+      : sessionEndSeen &&
+        stepsCoverFullRange &&
+        duplicateStepEvaluations === 0 &&
+        forwardCallsRecorded + cacheHitsRecorded === 20 &&
+        modelForwardsRecorded === forwardCallsRecorded);
+
+  // Require coverage.complete === true before setting status to "verified"
+  if (finalStatus === "verified" && !complete) {
+    finalStatus = "failed";
+    failureReason = failureReason ?? "Measurement coverage incomplete or unverified";
+  }
+
+  return {
+    status: finalStatus,
+    mode: teacacheRequest.mode,
+    requestedConfig,
+    effectiveConfig: finalStatus !== "failed" ? observedEffectiveConfig : null,
+    totalSteps: 20,
+    forwardCallsRecorded,
+    cacheHitsRecorded,
+    nestedForwardsOnHits,
+    coverage: {
+      samplingCallsRecorded,
+      modelForwardsRecorded: hasCacheEvents ? modelForwardsRecorded : null,
+      complete
+    },
+    timings: {
+      samplingWallMs,
+      modelForwardElapsedMs: null,
+      decisionOverheadMs: null,
+      timingUnavailableReason: null
+    },
+    failureReason,
+    sessionId,
+    sessionAttempts
+  };
+}
diff --git a/packages/application/src/experiments/minimax-h3-teacache-topology.test.ts b/packages/application/src/experiments/minimax-h3-teacache-topology.test.ts
new file mode 100644
index 0000000..395e89c
--- /dev/null
+++ b/packages/application/src/experiments/minimax-h3-teacache-topology.test.ts
@@ -0,0 +1,293 @@
+import { readFileSync } from "node:fs";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+import { deriveTeaCacheGraph, validateTeaCacheTopology } from "./minimax-h3-teacache-topology.js";
+import {
+  TEACACHE_NODE_KEY,
+  TEACACHE_PATCH_NODE_ID,
+  type MinimaxH3TeaCacheConfig
+} from "@cco/contracts";
+
+function loadCanonicalTemplate(route: "i2v" | "ref2v"): Record<string, unknown> {
+  const fileName =
+    route === "i2v"
+      ? "templates/minimax_h3_720p_i2v_124f_api.json"
+      : "templates/minimax_h3_720p_ref2v_124f_api.json";
+  const content = readFileSync(resolve(process.cwd(), fileName), "utf8");
+  return JSON.parse(content) as Record<string, unknown>;
+}
+
+describe("MiniMax-H3 TeaCache Topology", () => {
+  const candidateConfig: MinimaxH3TeaCacheConfig = {
+    mode: "raw-l1-v1",
+    relL1Thresh: 0.15,
+    startStep: 2,
+    endStep: -2,
+    totalSteps: 20,
+    normalizedStartStep: 2,
+    normalizedEndStep: 18
+  };
+
+  const offConfig: MinimaxH3TeaCacheConfig = {
+    mode: "off",
+    relL1Thresh: 0.15,
+    startStep: 2,
+    endStep: -2,
+    totalSteps: 20,
+    normalizedStartStep: 2,
+    normalizedEndStep: 18
+  };
+
+  it("derives and validates isolated TeaCache graph on i2v route", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph, patchNode, topologyDigest } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    expect(patchNode).not.toBeNull();
+    expect(topologyDigest).toMatch(/^[a-f0-9]{64}$/);
+    expect(patchNode?.nodeId).toBe(TEACACHE_PATCH_NODE_ID);
+    expect(patchNode?.classType).toBe(TEACACHE_NODE_KEY);
+    expect(patchNode?.inputs.model).toEqual(["6", 0]);
+    expect(patchNode?.inputs.rel_l1_thresh).toBe(0.15);
+    expect(patchNode?.inputs.start_step).toBe(2);
+    expect(patchNode?.inputs.end_step).toBe(-2);
+    expect(patchNode?.inputs.total_steps).toBe(20);
+
+    const guider = graph["16"] as { inputs?: { model?: unknown } };
+    const scheduler = graph["9"] as { inputs?: { model?: unknown } };
+    expect(guider.inputs?.model).toEqual([TEACACHE_PATCH_NODE_ID, 0]);
+    expect(scheduler.inputs?.model).toEqual([TEACACHE_PATCH_NODE_ID, 0]);
+
+    const validation = validateTeaCacheTopology(graph, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(validation.valid).toBe(true);
+    expect(validation.errors).toEqual([]);
+  });
+
+  it("derives and validates isolated TeaCache graph on ref2v route", () => {
+    const baseGraph = loadCanonicalTemplate("ref2v");
+    const { graph, patchNode } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "ref2v",
+      config: candidateConfig
+    });
+
+    expect(patchNode).not.toBeNull();
+    const validation = validateTeaCacheTopology(graph, {
+      expectedMode: "raw-l1-v1",
+      route: "ref2v",
+      expectedConfig: candidateConfig
+    });
+    expect(validation.valid).toBe(true);
+    expect(validation.errors).toEqual([]);
+  });
+
+  it("derives clean unpatched graph when mode is 'off'", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph, patchNode } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: offConfig
+    });
+
+    expect(patchNode).toBeNull();
+    expect(graph[TEACACHE_PATCH_NODE_ID]).toBeUndefined();
+
+    const guider = graph["16"] as { inputs?: { model?: unknown } };
+    const scheduler = graph["9"] as { inputs?: { model?: unknown } };
+    expect(guider.inputs?.model).toEqual(["6", 0]);
+    expect(scheduler.inputs?.model).toEqual(["6", 0]);
+
+    const validation = validateTeaCacheTopology(graph, {
+      expectedMode: "off",
+      route: "i2v",
+      expectedConfig: offConfig
+    });
+    expect(validation.valid).toBe(true);
+    expect(validation.errors).toEqual([]);
+  });
+
+  it("rejects graph when TeaCache patch node is miswired or missing", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    // Tamper: disconnect guider back to node 6
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["16"].inputs.model = ["6", 0];
+
+    const val1 = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(val1.valid).toBe(false);
+    expect(val1.errors.some((e) => e.includes("BasicGuider"))).toBe(true);
+
+    // Tamper: delete patch node
+    const deleted = JSON.parse(JSON.stringify(graph));
+    delete deleted[TEACACHE_PATCH_NODE_ID];
+
+    const val2 = validateTeaCacheTopology(deleted, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(val2.valid).toBe(false);
+    expect(val2.errors.some((e) => e.includes("missing from graph"))).toBe(true);
+  });
+
+  it("rejects graph when extraneous optimization patches are present", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    // Tamper: add a sparse attention patch node 301
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["301"] = {
+      class_type: "ModelSparseAttention",
+      inputs: { model: ["6", 0] }
+    };
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v",
+      expectedConfig: candidateConfig
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("Extraneous optimization patch node"))).toBe(true);
+  });
+
+  it("rejects graph when mode is 'off' but patch node is present", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const val = validateTeaCacheTopology(graph, {
+      expectedMode: "off",
+      route: "i2v",
+      expectedConfig: offConfig
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("must not be present"))).toBe(true);
+  });
+
+  it("rejects graph with unauthorized LoRA loader or optimizer patches", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["505"] = {
+      class_type: "LoraLoaderModelOnly",
+      inputs: { model: ["401", 0], lora_name: "test.safetensors" }
+    };
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("Unauthorized optimization/LoRA node"))).toBe(true);
+  });
+
+  it("rejects graph when scheduler steps/scheduler/denoise are altered", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["9"].inputs.steps = 10;
+    tampered["9"].inputs.scheduler = "karras";
+    tampered["9"].inputs.denoise = 0.8;
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("input 'steps' must be 20"))).toBe(true);
+    expect(val.errors.some((e) => e.includes("input 'scheduler' must be \"simple\""))).toBe(true);
+    expect(val.errors.some((e) => e.includes("input 'denoise' must be 1"))).toBe(true);
+  });
+
+  it("rejects graph when UNETLoader has non-canonical checkpoint", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    tampered["6"].inputs.unet_name = "minimax_h3_fl2va_pruned_int8_convrot.safetensors";
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("input 'unet_name' must be"))).toBe(true);
+  });
+
+  it("rejects graph when patch node inputs fail schema validation even without expectedConfig", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    // Set invalid threshold (not in allowlist)
+    tampered["401"].inputs.rel_l1_thresh = 0.99;
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("inputs failed schema validation"))).toBe(true);
+  });
+
+  it("rejects graph when model chain contains a cycle", () => {
+    const baseGraph = loadCanonicalTemplate("i2v");
+    const { graph } = deriveTeaCacheGraph({
+      baseWorkflow: baseGraph,
+      route: "i2v",
+      config: candidateConfig
+    });
+
+    const tampered = JSON.parse(JSON.stringify(graph));
+    // Create cycle 401 -> 16 -> 401
+    tampered["401"].inputs.model = ["16", 0];
+
+    const val = validateTeaCacheTopology(tampered, {
+      expectedMode: "raw-l1-v1",
+      route: "i2v"
+    });
+    expect(val.valid).toBe(false);
+    expect(val.errors.some((e) => e.includes("contains a cycle"))).toBe(true);
+  });
+});
diff --git a/packages/application/src/experiments/minimax-h3-teacache-topology.ts b/packages/application/src/experiments/minimax-h3-teacache-topology.ts
new file mode 100644
index 0000000..dd3b4cd
--- /dev/null
+++ b/packages/application/src/experiments/minimax-h3-teacache-topology.ts
@@ -0,0 +1,469 @@
+import {
+  computeTeaCacheTopologyDigest,
+  TEACACHE_NODE_KEY,
+  TEACACHE_PATCH_NODE_ID,
+  MinimaxH3TeaCachePatchNodeInputsSchema,
+  type MinimaxH3TeaCacheConfig,
+  type MinimaxH3TeaCacheMode,
+  type MinimaxH3TeaCachePatchNode
+} from "@cco/contracts";
+import type { ComfyNode } from "./minimax-h3-attention-topology.js";
+
+export interface DeriveTeaCacheGraphOptions {
+  baseWorkflow: Record<string, unknown>;
+  route: "i2v" | "ref2v";
+  config: MinimaxH3TeaCacheConfig;
+}
+
+export interface DerivedTeaCacheResult {
+  graph: Record<string, unknown>;
+  patchNode: MinimaxH3TeaCachePatchNode | null;
+  topologyDigest: string;
+}
+
+export function deriveTeaCacheGraph(options: DeriveTeaCacheGraphOptions): DerivedTeaCacheResult {
+  const { baseWorkflow, config } = options;
+
+  const derived = JSON.parse(JSON.stringify(baseWorkflow)) as Record<string, ComfyNode>;
+
+  const unetNodeId = "6";
+  const schedulerNodeId = "9";
+  const guiderNodeId = "16";
+  const patchNodeId = TEACACHE_PATCH_NODE_ID;
+
+  if (!derived[unetNodeId]) {
+    throw new Error(`Base graph is missing required UNETLoader node (id: "${unetNodeId}")`);
+  }
+  if (!derived[schedulerNodeId]) {
+    throw new Error(
+      `Base graph is missing required BasicScheduler node (id: "${schedulerNodeId}")`
+    );
+  }
+  if (!derived[guiderNodeId]) {
+    throw new Error(`Base graph is missing required BasicGuider node (id: "${guiderNodeId}")`);
+  }
+
+  if (config.mode === "raw-l1-v1") {
+    // Collision check: patchNodeId must not collide with base workflow unless it was already a TeaCache patch
+    if (derived[patchNodeId] && derived[patchNodeId].class_type !== TEACACHE_NODE_KEY) {
+      throw new Error(
+        `Node ID collision: node "${patchNodeId}" already exists in graph with class "${derived[patchNodeId].class_type}".`
+      );
+    }
+
+    const patchNode: MinimaxH3TeaCachePatchNode = {
+      nodeId: patchNodeId,
+      classType: TEACACHE_NODE_KEY,
+      inputs: {
+        model: [unetNodeId, 0],
+        rel_l1_thresh: config.relL1Thresh,
+        start_step: config.startStep,
+        end_step: config.endStep,
+        total_steps: 20
+      }
+    };
+
+    derived[patchNodeId] = {
+      inputs: {
+        model: [unetNodeId, 0],
+        rel_l1_thresh: config.relL1Thresh,
+        start_step: config.startStep,
+        end_step: config.endStep,
+        total_steps: 20
+      },
+      class_type: TEACACHE_NODE_KEY,
+      _meta: {
+        title: "MiniMax-H3 TeaCache (Experimental)"
+      }
+    };
+
+    if (!derived[schedulerNodeId].inputs) {
+      derived[schedulerNodeId].inputs = {};
+    }
+    derived[schedulerNodeId].inputs.model = [patchNodeId, 0];
+
+    if (!derived[guiderNodeId].inputs) {
+      derived[guiderNodeId].inputs = {};
+    }
+    derived[guiderNodeId].inputs.model = [patchNodeId, 0];
+
+    // Remove any incompatible patch nodes
+    delete derived["301"];
+    delete derived["302"];
+    delete derived["303"];
+
+    const topologyDigest = computeTeaCacheTopologyDigest(patchNode);
+    return { graph: derived, patchNode, topologyDigest };
+  } else {
+    // Cache off / matched control: direct UNETLoader wiring
+    if (!derived[schedulerNodeId].inputs) {
+      derived[schedulerNodeId].inputs = {};
+    }
+    derived[schedulerNodeId].inputs.model = [unetNodeId, 0];
+
+    if (!derived[guiderNodeId].inputs) {
+      derived[guiderNodeId].inputs = {};
+    }
+    derived[guiderNodeId].inputs.model = [unetNodeId, 0];
+
+    delete derived[patchNodeId];
+    delete derived["301"];
+    delete derived["302"];
+    delete derived["303"];
+
+    const topologyDigest = computeTeaCacheTopologyDigest(null);
+    return { graph: derived, patchNode: null, topologyDigest };
+  }
+}
+
+export interface ValidateTeaCacheTopologyOptions {
+  expectedMode: MinimaxH3TeaCacheMode;
+  route: "i2v" | "ref2v";
+  expectedConfig?: MinimaxH3TeaCacheConfig | null | undefined;
+}
+
+export function validateTeaCacheTopology(
+  rawGraph: Record<string, unknown>,
+  options: ValidateTeaCacheTopologyOptions
+): {
+  valid: boolean;
+  errors: string[];
+  topologyDigest: string;
+} {
+  const graph = rawGraph as Record<string, ComfyNode>;
+  const { expectedMode, route, expectedConfig } = options;
+  const errors: string[] = [];
+
+  const unetLoaderId = "6";
+  const schedulerNodeId = "9";
+  const samplerNodeId = "14";
+  const guiderNodeId = "16";
+  const patchNodeId = TEACACHE_PATCH_NODE_ID;
+  const i2vConditioningNodeId = "104";
+  const ref2vConditioningNodeId = "105";
+
+  if (Object.keys(graph).length === 0) {
+    errors.push("Workflow graph is empty (contains 0 nodes).");
+  }
+
+  // Scan ALL nodes for unauthorized optimizers, patches, LoRAs, or duplicate samplers
+  const FORBIDDEN_CLASS_TYPES = new Set([
+    "LoraLoader",
+    "LoraLoaderModelOnly",
+    "ModelAttentionBackend",
+    "BlockSparseAttention",
+    "ModelSparseAttention",
+    "VedaSparseAttention",
+    "MiniMaxH3SigmaShift"
+  ]);
+
+  for (const [nodeId, node] of Object.entries(graph)) {
+    const classType = node?.class_type ?? "";
+    if (
+      FORBIDDEN_CLASS_TYPES.has(classType) ||
+      classType.includes("Lora") ||
+      classType.includes("LoRA")
+    ) {
+      errors.push(
+        `Unauthorized optimization/LoRA node "${nodeId}" (${classType}) detected in graph. TeaCache must be strictly isolated.`
+      );
+    }
+    if (classType.includes("TeaCache") || classType === TEACACHE_NODE_KEY) {
+      if (expectedMode === "off") {
+        errors.push(
+          `TeaCache patch node "${nodeId}" (${classType}) must not be present when TeaCache is disabled (mode: 'off').`
+        );
+      } else if (nodeId !== patchNodeId) {
+        errors.push(
+          `Unauthorized duplicate or misplaced TeaCache node "${nodeId}" (${classType}) detected. Only node "${patchNodeId}" is authorized.`
+        );
+      }
+    }
+    if (classType.includes("SparseAttention") || classType.includes("AttentionBackend")) {
+      errors.push(
+        `Unauthorized attention optimization node "${nodeId}" (${classType}) detected. TeaCache requires dense attention.`
+      );
+    }
+    if (
+      classType === "SamplerCustomAdvanced" ||
+      classType === "KSampler" ||
+      classType === "KSamplerAdvanced"
+    ) {
+      if (nodeId !== samplerNodeId) {
+        errors.push(
+          `Unauthorized duplicate or misplaced sampler node "${nodeId}" (${classType}) detected. Only node "${samplerNodeId}" is authorized.`
+        );
+      }
+    }
+  }
+
+  const requiredNodeIds = [unetLoaderId, schedulerNodeId, samplerNodeId, guiderNodeId];
+  for (const id of requiredNodeIds) {
+    if (!graph[id]) {
+      errors.push(`Required pipeline node ${id} is missing from workflow graph.`);
+    } else if (!graph[id]?.inputs || Object.keys(graph[id]?.inputs ?? {}).length === 0) {
+      errors.push(`Required pipeline node ${id} has missing or empty inputs.`);
+    }
+  }
+
+  // UNETLoader invariant: checkpoint filename
+  if (graph[unetLoaderId]) {
+    const unetName = graph[unetLoaderId]?.inputs?.unet_name;
+    const expectedUnetName = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";
+    if (unetName !== expectedUnetName) {
+      errors.push(
+        `UNETLoader (node ${unetLoaderId}) input 'unet_name' must be "${expectedUnetName}", got "${unetName}".`
+      );
+    }
+  }
+
+  // BasicScheduler invariants: steps === 20, scheduler === "simple", denoise === 1
+  if (graph[schedulerNodeId]) {
+    const schedInputs = graph[schedulerNodeId]?.inputs;
+    if (schedInputs?.steps !== 20) {
+      errors.push(
+        `BasicScheduler (node ${schedulerNodeId}) input 'steps' must be 20, got ${schedInputs?.steps}.`
+      );
+    }
+    if (schedInputs?.scheduler !== "simple") {
+      errors.push(
+        `BasicScheduler (node ${schedulerNodeId}) input 'scheduler' must be "simple", got "${schedInputs?.scheduler}".`
+      );
+    }
+    if (schedInputs?.denoise !== 1) {
+      errors.push(
+        `BasicScheduler (node ${schedulerNodeId}) input 'denoise' must be 1, got ${schedInputs?.denoise}.`
+      );
+    }
+  }
+
+  // BasicGuider invariant: conditioning input connection
+  if (graph[guiderNodeId]) {
+    const expectedCondNodeId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
+    const condConn = graph[guiderNodeId]?.inputs?.conditioning;
+    if (!Array.isArray(condConn) || condConn[0] !== expectedCondNodeId || condConn[1] !== 0) {
+      errors.push(
+        `BasicGuider (node ${guiderNodeId}) input 'conditioning' must connect to node ${expectedCondNodeId} slot 0, got ${JSON.stringify(condConn)}.`
+      );
+    }
+  }
+
+  if (route === "i2v") {
+    if (!graph[i2vConditioningNodeId]) {
+      errors.push(
+        `Route 'i2v' requires MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) to be present in graph.`
+      );
+    }
+    if (!graph["20"]) {
+      errors.push(
+        `Route 'i2v' requires LoadImage (node 20) for first_frame to be present in graph.`
+      );
+    } else if (graph[i2vConditioningNodeId]) {
+      const imgConn = graph[i2vConditioningNodeId]?.inputs?.first_frame;
+      if (!Array.isArray(imgConn) || imgConn[0] !== "20" || imgConn[1] !== 0) {
+        errors.push(
+          `MiniMaxH3ImageToVideo (node ${i2vConditioningNodeId}) input 'first_frame' must connect to LoadImage (node 20) slot 0, got ${JSON.stringify(imgConn)}.`
+        );
+      }
+    }
+  } else {
+    if (!graph[ref2vConditioningNodeId]) {
+      errors.push(
+        `Route 'ref2v' requires MiniMaxH3ReferenceToVideo (node ${ref2vConditioningNodeId}) to be present in graph.`
+      );
+    } else {
+      const node105 = graph[ref2vConditioningNodeId];
+      if (node105?.inputs) {
+        for (const [key, val] of Object.entries(node105.inputs)) {
+          if (key.startsWith("ref_images.") && Array.isArray(val) && typeof val[0] === "string") {
+            const refNodeId = val[0];
+            const refNode = graph[refNodeId];
+            if (!refNode) {
+              errors.push(
+                `MiniMaxH3ReferenceToVideo input '${key}' connects to missing node "${refNodeId}".`
+              );
+            } else if (refNode.class_type !== "LoadImage") {
+              errors.push(
+                `MiniMaxH3ReferenceToVideo input '${key}' must connect to LoadImage, got "${refNode.class_type}" on node "${refNodeId}".`
+              );
+            }
+          }
+        }
+      }
+    }
+  }
+
+  // Sampler Custom Advanced checks
+  if (graph[samplerNodeId]) {
+    const guiderConn = graph[samplerNodeId]?.inputs?.guider;
+    if (!Array.isArray(guiderConn) || guiderConn[0] !== guiderNodeId || guiderConn[1] !== 0) {
+      errors.push(
+        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'guider' must connect to BasicGuider (node ${guiderNodeId}) slot 0.`
+      );
+    }
+    const sigmasConn = graph[samplerNodeId]?.inputs?.sigmas;
+    if (!Array.isArray(sigmasConn) || sigmasConn[0] !== schedulerNodeId || sigmasConn[1] !== 0) {
+      errors.push(
+        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'sigmas' must connect to BasicScheduler (node ${schedulerNodeId}) slot 0.`
+      );
+    }
+    const expectedCondId = route === "i2v" ? i2vConditioningNodeId : ref2vConditioningNodeId;
+    const latentConn = graph[samplerNodeId]?.inputs?.latent_image;
+    if (!Array.isArray(latentConn) || latentConn[0] !== expectedCondId || latentConn[1] !== 1) {
+      errors.push(
+        `SamplerCustomAdvanced (node ${samplerNodeId}) input 'latent_image' must connect to node ${expectedCondId} slot 1.`
+      );
+    }
+  }
+
+  if (expectedMode === "raw-l1-v1") {
+    const patch = graph[patchNodeId];
+    if (!patch) {
+      errors.push(`TeaCache patch node (node ${patchNodeId}) is missing from graph.`);
+    } else {
+      if (patch.class_type !== TEACACHE_NODE_KEY) {
+        errors.push(
+          `TeaCache patch node ${patchNodeId} class_type must be "${TEACACHE_NODE_KEY}", got "${patch.class_type}".`
+        );
+      }
+      const modelConn = patch.inputs?.model;
+      if (!Array.isArray(modelConn) || modelConn[0] !== unetLoaderId || modelConn[1] !== 0) {
+        errors.push(
+          `TeaCache patch node ${patchNodeId} input 'model' must connect to UNETLoader (node ${unetLoaderId}) slot 0, got ${JSON.stringify(modelConn)}.`
+        );
+      }
+      if (patch.inputs) {
+        const schemaRes = MinimaxH3TeaCachePatchNodeInputsSchema.safeParse(patch.inputs);
+        if (!schemaRes.success) {
+          errors.push(
+            `TeaCache patch node ${patchNodeId} inputs failed schema validation: ${schemaRes.error.message}`
+          );
+        }
+      } else {
+        errors.push(`TeaCache patch node ${patchNodeId} has missing or empty inputs.`);
+      }
+      if (expectedConfig) {
+        if (patch.inputs?.rel_l1_thresh !== expectedConfig.relL1Thresh) {
+          errors.push(
+            `TeaCache patch node rel_l1_thresh mismatch: expected ${expectedConfig.relL1Thresh}, got ${patch.inputs?.rel_l1_thresh}.`
+          );
+        }
+        if (patch.inputs?.start_step !== expectedConfig.startStep) {
+          errors.push(
+            `TeaCache patch node start_step mismatch: expected ${expectedConfig.startStep}, got ${patch.inputs?.start_step}.`
+          );
+        }
+        if (patch.inputs?.end_step !== expectedConfig.endStep) {
+          errors.push(
+            `TeaCache patch node end_step mismatch: expected ${expectedConfig.endStep}, got ${patch.inputs?.end_step}.`
+          );
+        }
+        if (patch.inputs?.total_steps !== 20) {
+          errors.push(
+            `TeaCache patch node total_steps mismatch: expected 20, got ${patch.inputs?.total_steps}.`
+          );
+        }
+      }
+    }
+
+    // BasicGuider and BasicScheduler must both connect to patchNodeId slot 0
+    if (graph[guiderNodeId]) {
+      const guiderModel = graph[guiderNodeId]?.inputs?.model;
+      if (!Array.isArray(guiderModel) || guiderModel[0] !== patchNodeId || guiderModel[1] !== 0) {
+        errors.push(
+          `BasicGuider (node ${guiderNodeId}) input 'model' must connect to TeaCache (node ${patchNodeId}) slot 0, got ${JSON.stringify(guiderModel)}.`
+        );
+      }
+    }
+    if (graph[schedulerNodeId]) {
+      const schedModel = graph[schedulerNodeId]?.inputs?.model;
+      if (!Array.isArray(schedModel) || schedModel[0] !== patchNodeId || schedModel[1] !== 0) {
+        errors.push(
+          `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect to TeaCache (node ${patchNodeId}) slot 0, got ${JSON.stringify(schedModel)}.`
+        );
+      }
+    }
+
+    // Reject extraneous patch nodes
+    for (const badId of ["301", "302", "303"]) {
+      if (graph[badId]) {
+        errors.push(
+          `Extraneous optimization patch node ${badId} (${graph[badId].class_type}) detected. TeaCache must be strictly isolated.`
+        );
+      }
+    }
+  } else {
+    // Mode off: direct connections to node 6
+    for (const badId of ["301", "302", "303", patchNodeId]) {
+      if (graph[badId]) {
+        errors.push(
+          `Extraneous optimization patch node ${badId} (${graph[badId].class_type}) detected. Mode 'off' must not contain optimization nodes.`
+        );
+      }
+    }
+    if (graph[guiderNodeId]) {
+      const guiderModel = graph[guiderNodeId]?.inputs?.model;
+      if (!Array.isArray(guiderModel) || guiderModel[0] !== unetLoaderId || guiderModel[1] !== 0) {
+        errors.push(
+          `BasicGuider (node ${guiderNodeId}) input 'model' must connect directly to UNETLoader (node ${unetLoaderId}) slot 0 when caching is off, got ${JSON.stringify(guiderModel)}.`
+        );
+      }
+    }
+    if (graph[schedulerNodeId]) {
+      const schedModel = graph[schedulerNodeId]?.inputs?.model;
+      if (!Array.isArray(schedModel) || schedModel[0] !== unetLoaderId || schedModel[1] !== 0) {
+        errors.push(
+          `BasicScheduler (node ${schedulerNodeId}) input 'model' must connect directly to UNETLoader (node ${unetLoaderId}) slot 0 when caching is off, got ${JSON.stringify(schedModel)}.`
+        );
+      }
+    }
+  }
+
+  // Model-chain cycle check and path validation
+  function checkModelChain(startNodeId: string, visited: Set<string>): boolean {
+    if (visited.has(startNodeId)) return false; // cycle
+    visited.add(startNodeId);
+    if (startNodeId === unetLoaderId) return true;
+    const node = graph[startNodeId];
+    if (!node || !node.inputs) return false;
+    const modelConn = node.inputs.model;
+    if (!Array.isArray(modelConn) || typeof modelConn[0] !== "string") return false;
+    return checkModelChain(modelConn[0], new Set(visited));
+  }
+  if (graph[guiderNodeId] && !checkModelChain(guiderNodeId, new Set())) {
+    errors.push(
+      `BasicGuider (node ${guiderNodeId}) model chain contains a cycle or does not terminate at UNETLoader.`
+    );
+  }
+  if (graph[schedulerNodeId] && !checkModelChain(schedulerNodeId, new Set())) {
+    errors.push(
+      `BasicScheduler (node ${schedulerNodeId}) model chain contains a cycle or does not terminate at UNETLoader.`
+    );
+  }
+
+  let patchNode: MinimaxH3TeaCachePatchNode | null = null;
+  const patch = graph[patchNodeId];
+  if (expectedMode === "raw-l1-v1" && patch) {
+    if (patch.class_type === TEACACHE_NODE_KEY && patch.inputs) {
+      const parsedInputs = MinimaxH3TeaCachePatchNodeInputsSchema.safeParse(patch.inputs);
+      if (parsedInputs.success) {
+        patchNode = {
+          nodeId: patchNodeId,
+          classType: TEACACHE_NODE_KEY,
+          inputs: parsedInputs.data
+        };
+      } else {
+        errors.push(
+          `TeaCache patch node ${patchNodeId} inputs failed schema validation: ${parsedInputs.error.message}`
+        );
+      }
+    }
+  }
+  const topologyDigest = computeTeaCacheTopologyDigest(patchNode);
+
+  return {
+    valid: errors.length === 0,
+    errors,
+    topologyDigest
+  };
+}
diff --git a/packages/application/src/ports/minimax-h3-experiment-ports.ts b/packages/application/src/ports/minimax-h3-experiment-ports.ts
index 7766ffd..2c88406 100644
--- a/packages/application/src/ports/minimax-h3-experiment-ports.ts
+++ b/packages/application/src/ports/minimax-h3-experiment-ports.ts
@@ -339,6 +339,12 @@ export interface PrepareMinimaxH3ExperimentOptions {
   coreRevision?: string;
   matchedVariant?: MinimaxH3AttentionVariantName;
   samplingRecipe?: MinimaxH3SamplingRecipeName;
+  teacache?: "off" | "raw-l1-v1";
+  teacacheThreshold?: number;
+  teacacheStartStep?: number;
+  teacacheEndStep?: number;
+  teacacheTotalSteps?: number;
+  teacacheMatchedControl?: boolean;
   env?: Record<string, string>;
   fixturesDir?: string;
 }
diff --git a/packages/contracts/src/index.ts b/packages/contracts/src/index.ts
index 8fe56ce..8fd35a5 100644
--- a/packages/contracts/src/index.ts
+++ b/packages/contracts/src/index.ts
@@ -35,6 +35,7 @@ export * from "./minimax-h3-experiment.js";
 export * from "./minimax-h3-experiment-v2.js";
 export * from "./minimax-h3-attention.js";
 export * from "./minimax-h3-continuity.js";
+export * from "./minimax-h3-teacache.js";
 export * from "./h3-candidate-profile.js";
 export * from "./h3-capability-decision.js";
 export * from "./h3-candidate-registry.js";
diff --git a/packages/contracts/src/minimax-h3-experiment-v2.ts b/packages/contracts/src/minimax-h3-experiment-v2.ts
index 753ba95..7c76de3 100644
--- a/packages/contracts/src/minimax-h3-experiment-v2.ts
+++ b/packages/contracts/src/minimax-h3-experiment-v2.ts
@@ -45,6 +45,12 @@ import {
   type MinimaxH3AttentionCatalogEntry,
   type MinimaxH3AttentionObservation
 } from "./minimax-h3-attention.js";
+import {
+  MinimaxH3TeaCacheRequestSchema,
+  MinimaxH3TeaCacheObservationSchema,
+  FactorChangeCachingConfigSummarySchema,
+  createEmptyTeaCacheObservation
+} from "./minimax-h3-teacache.js";
 
 export const MinimaxH3ExperimentDescriptorV1Schema = MinimaxH3ExperimentDescriptorSchema;
 export type MinimaxH3ExperimentDescriptorV1 = MinimaxH3ExperimentDescriptor;
@@ -1108,6 +1114,15 @@ export const FactorChangeSigmaShiftSchema = z
   })
   .strict();
 
+export const FactorChangeCachingConfigSchema = z
+  .object({
+    path: z.literal("caching.configuration"),
+    before: FactorChangeCachingConfigSummarySchema.nullable(),
+    after: FactorChangeCachingConfigSummarySchema.nullable(),
+    rationale: z.string().min(1).optional()
+  })
+  .strict();
+
 export const MinimaxH3FactorChangeSchema = z.discriminatedUnion("path", [
   FactorChangePositivePromptSchema,
   FactorChangeNegativePromptSchema,
@@ -1117,6 +1132,7 @@ export const MinimaxH3FactorChangeSchema = z.discriminatedUnion("path", [
   FactorChangeSamplingSettingsSchema,
   FactorChangeSigmaShiftSchema,
   FactorChangeAttentionConfigSchema,
+  FactorChangeCachingConfigSchema,
   FactorChangeMemoryOffloadSchema,
   FactorChangeDecodeConfigSchema,
   FactorChangeRuntimeManifestSchema
@@ -1711,7 +1727,8 @@ export const MinimaxH3ExperimentDescriptorV2Schema = z
     stepOverride: z.number().int().positive().max(100).nullable().optional(),
     checkpointOverride: z.enum(["ref2va", "fl2va"]).nullable().optional(),
     attentionRequest: MinimaxH3AttentionRequestSchema.optional(),
-    samplingRecipe: MinimaxH3SamplingRecipeSchema.optional()
+    samplingRecipe: MinimaxH3SamplingRecipeSchema.optional(),
+    teacacheRequest: MinimaxH3TeaCacheRequestSchema.optional()
   })
   .strict()
   .superRefine((val, ctx) => {
@@ -2269,6 +2286,37 @@ export const MinimaxH3ExperimentDescriptorV2Schema = z
         });
       }
     }
+
+    if (val.teacacheRequest && val.teacacheRequest.mode === "raw-l1-v1") {
+      if (val.samplingRecipe && val.samplingRecipe.name !== "canonical-base-20") {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: `TeaCache cannot be combined with non-canonical samplingRecipe "${val.samplingRecipe.name}" in initial phase`,
+          path: ["samplingRecipe"]
+        });
+      }
+      if (val.stepOverride !== null && val.stepOverride !== undefined) {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: "TeaCache cannot be combined with stepOverride; base 20-step required",
+          path: ["stepOverride"]
+        });
+      }
+      if (val.checkpointOverride !== null && val.checkpointOverride !== undefined) {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: "TeaCache cannot be combined with checkpointOverride; base checkpoint required",
+          path: ["checkpointOverride"]
+        });
+      }
+      if (val.attentionRequest && val.attentionRequest.attentionVariant !== "dense") {
+        ctx.addIssue({
+          code: z.ZodIssueCode.custom,
+          message: `TeaCache cannot be combined with accelerated attentionVariant "${val.attentionRequest.attentionVariant}" in initial phase`,
+          path: ["attentionRequest"]
+        });
+      }
+    }
   });
 export type MinimaxH3ExperimentDescriptorV2 = z.infer<typeof MinimaxH3ExperimentDescriptorV2Schema>;
 
@@ -2310,7 +2358,8 @@ export const MinimaxH3ExperimentResultV2Schema = z
     compatibility: MinimaxH3CompatibilityAssessmentSchema,
     phaseAccounting: MinimaxH3PhaseAccountingResultSchema,
     instrumentationReport: MinimaxH3InstrumentationReportSchema,
-    attentionObservation: MinimaxH3AttentionObservationSchema.optional()
+    attentionObservation: MinimaxH3AttentionObservationSchema.optional(),
+    teacacheObservation: MinimaxH3TeaCacheObservationSchema.optional()
   })
   .strict()
   .superRefine((val, ctx) => {
@@ -2362,6 +2411,70 @@ export const MinimaxH3ExperimentResultV2Schema = z
         });
       }
     }
+
+    if (val.teacacheObservation) {
+      if (val.teacacheObservation.status === "verified") {
+        if (!val.teacacheObservation.coverage?.complete) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message:
+              "teacacheObservation with status 'verified' requires coverage.complete === true",
+            path: ["teacacheObservation", "coverage", "complete"]
+          });
+        }
+        if (
+          val.teacacheObservation.forwardCallsRecorded === null ||
+          val.teacacheObservation.cacheHitsRecorded === null
+        ) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message:
+              "teacacheObservation with status 'verified' requires non-null forwardCallsRecorded and cacheHitsRecorded",
+            path: ["teacacheObservation", "forwardCallsRecorded"]
+          });
+        }
+        if (
+          val.teacacheObservation.coverage?.modelForwardsRecorded !==
+          val.teacacheObservation.forwardCallsRecorded
+        ) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message:
+              "teacacheObservation with status 'verified' requires modelForwardsRecorded === forwardCallsRecorded",
+            path: ["teacacheObservation", "coverage", "modelForwardsRecorded"]
+          });
+        }
+        if (val.teacacheObservation.mode === "raw-l1-v1") {
+          if (val.teacacheObservation.cacheHitsRecorded === 0) {
+            ctx.addIssue({
+              code: z.ZodIssueCode.custom,
+              message:
+                "teacacheObservation with status 'verified' requires positive cacheHitsRecorded; 0 hits must be reported as 'no_op'",
+              path: ["teacacheObservation", "cacheHitsRecorded"]
+            });
+          }
+          if (val.teacacheObservation.effectiveConfig === null) {
+            ctx.addIssue({
+              code: z.ZodIssueCode.custom,
+              message:
+                "teacacheObservation with status 'verified' requires non-null effectiveConfig",
+              path: ["teacacheObservation", "effectiveConfig"]
+            });
+          }
+        }
+        if (
+          val.teacacheObservation.nestedForwardsOnHits !== null &&
+          val.teacacheObservation.nestedForwardsOnHits !== undefined &&
+          val.teacacheObservation.nestedForwardsOnHits > 0
+        ) {
+          ctx.addIssue({
+            code: z.ZodIssueCode.custom,
+            message: "teacacheObservation with status 'verified' cannot have nestedForwardsOnHits",
+            path: ["teacacheObservation", "nestedForwardsOnHits"]
+          });
+        }
+      }
+    }
   });
 export type MinimaxH3ExperimentResultV2 = z.infer<typeof MinimaxH3ExperimentResultV2Schema>;
 
@@ -2565,6 +2678,7 @@ export function computeInvariantProjectionKey(options: {
     audioShift: number;
   };
   attentionTopologyDigest?: string;
+  teacacheTopologyDigest?: string;
   runtimeManifestDigest?: string;
   coreRevision?: string;
 }): string {
@@ -2611,6 +2725,9 @@ export function computeInvariantProjectionKey(options: {
     attentionTopology: declaredSet.has("attention.configuration")
       ? "<DECLARED_FACTOR_VARIATION>"
       : (options.attentionTopologyDigest ?? "default"),
+    cachingConfiguration: declaredSet.has("caching.configuration")
+      ? "<DECLARED_FACTOR_VARIATION>"
+      : (options.teacacheTopologyDigest ?? "default"),
     runtimeManifest: declaredSet.has("runtime.manifest")
       ? "<DECLARED_FACTOR_VARIATION>"
       : (options.runtimeManifestDigest ?? "default"),
@@ -2858,6 +2975,11 @@ export function createEmptyMinimaxH3MeasurementTemplateV2(
             }
           }
         }
+      : {}),
+    ...(descriptor.teacacheRequest
+      ? {
+          teacacheObservation: createEmptyTeaCacheObservation(descriptor.teacacheRequest)
+        }
       : {})
   };
 }
diff --git a/packages/contracts/src/minimax-h3-teacache.test.ts b/packages/contracts/src/minimax-h3-teacache.test.ts
new file mode 100644
index 0000000..cdd7acb
--- /dev/null
+++ b/packages/contracts/src/minimax-h3-teacache.test.ts
@@ -0,0 +1,382 @@
+import { describe, it, expect } from "vitest";
+import {
+  MinimaxH3TeaCacheModeSchema,
+  MinimaxH3TeaCacheRequestSchema,
+  MinimaxH3TeaCacheObservationSchema,
+  normalizeTeaCacheWindow,
+  validateTeaCacheParameters,
+  computeTeaCacheTopologyDigest,
+  computeTeaCacheConfigDigest,
+  createEmptyTeaCacheObservation,
+  TEACACHE_UPSTREAM_COMMIT,
+  TEACACHE_ADAPTER_VERSION,
+  TEACACHE_NODE_KEY,
+  type MinimaxH3TeaCacheRequest
+} from "./minimax-h3-teacache.js";
+import { MinimaxH3FactorChangeSchema } from "./minimax-h3-experiment-v2.js";
+
+describe("MiniMax-H3 TeaCache Contracts", () => {
+  describe("MinimaxH3TeaCacheModeSchema", () => {
+    it("admits valid mode values", () => {
+      expect(MinimaxH3TeaCacheModeSchema.parse("off")).toBe("off");
+      expect(MinimaxH3TeaCacheModeSchema.parse("raw-l1-v1")).toBe("raw-l1-v1");
+    });
+
+    it("rejects unknown modes", () => {
+      expect(() => MinimaxH3TeaCacheModeSchema.parse("taylor-v1")).toThrow();
+      expect(() => MinimaxH3TeaCacheModeSchema.parse("residual-v2")).toThrow();
+    });
+  });
+
+  describe("normalizeTeaCacheWindow & validateTeaCacheParameters", () => {
+    it("normalizes negative endStep relative to totalSteps", () => {
+      const res = normalizeTeaCacheWindow({
+        startStep: 2,
+        endStep: -2,
+        totalSteps: 20
+      });
+      expect(res.normalizedStartStep).toBe(2);
+      expect(res.normalizedEndStep).toBe(18);
+      expect(res.totalSteps).toBe(20);
+    });
+
+    it("normalizes explicit positive endStep", () => {
+      const res = normalizeTeaCacheWindow({
+        startStep: 4,
+        endStep: 16,
+        totalSteps: 20
+      });
+      expect(res.normalizedStartStep).toBe(4);
+      expect(res.normalizedEndStep).toBe(16);
+    });
+
+    it("rejects startStep < 2 to protect initial forward passes", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 0,
+          endStep: 18,
+          totalSteps: 20
+        })
+      ).toThrow(/startStep must be >= 2/);
+
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 1,
+          endStep: 18,
+          totalSteps: 20
+        })
+      ).toThrow(/startStep must be >= 2/);
+    });
+
+    it("rejects effectiveEnd > 18 to protect final refinement steps", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 2,
+          endStep: 19,
+          totalSteps: 20
+        })
+      ).toThrow(/effective endStep must be <= 18/);
+
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 2,
+          endStep: -1,
+          totalSteps: 20
+        })
+      ).toThrow(/effective endStep must be <= 18/);
+    });
+
+    it("rejects empty or inverted window", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 10,
+          endStep: 10,
+          totalSteps: 20
+        })
+      ).toThrow(/empty or inverted/);
+
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 12,
+          endStep: 8,
+          totalSteps: 20
+        })
+      ).toThrow(/empty or inverted/);
+    });
+
+    it("rejects totalSteps other than 20", () => {
+      expect(() =>
+        normalizeTeaCacheWindow({
+          startStep: 2,
+          endStep: 18,
+          totalSteps: 8
+        })
+      ).toThrow(/total_steps to be exactly 20/);
+    });
+
+    it("validates parameters and bounds relL1Thresh", () => {
+      const valid = validateTeaCacheParameters({
+        relL1Thresh: 0.15,
+        startStep: 2,
+        endStep: -2,
+        totalSteps: 20
+      });
+      expect(valid.relL1Thresh).toBe(0.15);
+      expect(valid.normalizedStartStep).toBe(2);
+      expect(valid.normalizedEndStep).toBe(18);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: 0,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/rel_l1_thresh must be one of/);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: 0.6,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/rel_l1_thresh must be one of/);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: 0.12,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/rel_l1_thresh must be one of/);
+
+      expect(() =>
+        validateTeaCacheParameters({
+          relL1Thresh: Number.NaN,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20
+        })
+      ).toThrow(/must be a finite number/);
+    });
+  });
+
+  describe("MinimaxH3TeaCacheRequestSchema", () => {
+    it("parses valid TeaCache request", () => {
+      const req: MinimaxH3TeaCacheRequest = {
+        mode: "raw-l1-v1",
+        relL1Thresh: 0.15,
+        startStep: 2,
+        endStep: -2,
+        totalSteps: 20,
+        normalizedStartStep: 2,
+        normalizedEndStep: 18,
+        upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
+        adapterVersion: TEACACHE_ADAPTER_VERSION,
+        adapterDigest: "a".repeat(64),
+        catalogDigest: "b".repeat(64),
+        topologyDigest: "c".repeat(64),
+        patchNode: {
+          nodeId: "401",
+          classType: TEACACHE_NODE_KEY,
+          inputs: {
+            model: ["6", 0],
+            rel_l1_thresh: 0.15,
+            start_step: 2,
+            end_step: -2,
+            total_steps: 20
+          }
+        }
+      };
+
+      const parsed = MinimaxH3TeaCacheRequestSchema.parse(req);
+      expect(parsed.mode).toBe("raw-l1-v1");
+      expect(parsed.patchNode?.nodeId).toBe("401");
+      expect(parsed.patchNode?.classType).toBe("CCOMiniMaxH3TeaCache");
+    });
+  });
+
+  describe("MinimaxH3TeaCacheObservationSchema", () => {
+    it("parses verified observation", () => {
+      const obs = {
+        status: "verified" as const,
+        mode: "raw-l1-v1" as const,
+        requestedConfig: {
+          mode: "raw-l1-v1" as const,
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20 as const,
+          normalizedStartStep: 2,
+          normalizedEndStep: 18
+        },
+        effectiveConfig: {
+          mode: "raw-l1-v1" as const,
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20 as const,
+          normalizedStartStep: 2,
+          normalizedEndStep: 18
+        },
+        totalSteps: 20,
+        forwardCallsRecorded: 12,
+        cacheHitsRecorded: 8,
+        nestedForwardsOnHits: 0,
+        coverage: {
+          samplingCallsRecorded: 1,
+          modelForwardsRecorded: 12,
+          complete: true
+        },
+        timings: {
+          samplingWallMs: 42100,
+          modelForwardElapsedMs: 38200,
+          decisionOverheadMs: 120,
+          timingUnavailableReason: null
+        },
+        failureReason: null
+      };
+
+      const parsed = MinimaxH3TeaCacheObservationSchema.parse(obs);
+      expect(parsed.status).toBe("verified");
+      expect(parsed.forwardCallsRecorded).toBe(12);
+      expect(parsed.cacheHitsRecorded).toBe(8);
+    });
+
+    it("parses no_op observation with zero hits", () => {
+      const obs = {
+        status: "no_op" as const,
+        mode: "raw-l1-v1" as const,
+        requestedConfig: null,
+        effectiveConfig: null,
+        totalSteps: 20,
+        forwardCallsRecorded: 20,
+        cacheHitsRecorded: 0,
+        coverage: {
+          samplingCallsRecorded: 1,
+          modelForwardsRecorded: 20,
+          complete: true
+        },
+        timings: {
+          samplingWallMs: 58000,
+          modelForwardElapsedMs: 56000,
+          decisionOverheadMs: 150
+        }
+      };
+
+      const parsed = MinimaxH3TeaCacheObservationSchema.parse(obs);
+      expect(parsed.status).toBe("no_op");
+      expect(parsed.cacheHitsRecorded).toBe(0);
+    });
+  });
+
+  describe("FactorChangeCachingConfigSchema in MinimaxH3FactorChangeSchema", () => {
+    it("parses caching.configuration factor change", () => {
+      const factor = {
+        path: "caching.configuration",
+        before: {
+          mode: "off",
+          relL1Thresh: null,
+          startStep: null,
+          endStep: null,
+          totalSteps: null,
+          topologyDigest: "0".repeat(64),
+          adapterVersion: null
+        },
+        after: {
+          mode: "raw-l1-v1",
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20,
+          topologyDigest: "1".repeat(64),
+          adapterVersion: TEACACHE_ADAPTER_VERSION
+        },
+        rationale: "TeaCache timestep caching experiment"
+      };
+
+      const parsed = MinimaxH3FactorChangeSchema.parse(factor);
+      expect(parsed.path).toBe("caching.configuration");
+    });
+  });
+
+  describe("computeTeaCacheTopologyDigest & computeTeaCacheConfigDigest", () => {
+    it("computes deterministic digests", () => {
+      const patch = {
+        nodeId: "401",
+        classType: TEACACHE_NODE_KEY as typeof TEACACHE_NODE_KEY,
+        inputs: {
+          model: ["6", 0] as [string, number],
+          rel_l1_thresh: 0.15,
+          start_step: 2,
+          end_step: -2,
+          total_steps: 20
+        }
+      };
+
+      const d1 = computeTeaCacheTopologyDigest(patch);
+      const d2 = computeTeaCacheTopologyDigest(patch);
+      expect(d1).toBe(d2);
+      expect(d1).toMatch(/^[0-9a-f]{64}$/);
+
+      const dNull = computeTeaCacheTopologyDigest(null);
+      expect(dNull).not.toBe(d1);
+
+      const cfgDigest = computeTeaCacheConfigDigest({
+        workflowDigest: "a".repeat(64),
+        argv: ["--listen"],
+        teacacheConfig: {
+          mode: "raw-l1-v1",
+          relL1Thresh: 0.15,
+          startStep: 2,
+          endStep: -2,
+          totalSteps: 20,
+          normalizedStartStep: 2,
+          normalizedEndStep: 18
+        }
+      });
+      expect(cfgDigest).toMatch(/^[0-9a-f]{64}$/);
+    });
+  });
+
+  describe("createEmptyTeaCacheObservation", () => {
+    it("initializes empty observation with requested config and unknown timings", () => {
+      const req: MinimaxH3TeaCacheRequest = {
+        mode: "raw-l1-v1",
+        relL1Thresh: 0.1,
+        startStep: 2,
+        endStep: 18,
+        totalSteps: 20,
+        normalizedStartStep: 2,
+        normalizedEndStep: 18,
+        upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
+        adapterVersion: TEACACHE_ADAPTER_VERSION,
+        adapterDigest: "a".repeat(64),
+        catalogDigest: "b".repeat(64),
+        topologyDigest: "c".repeat(64),
+        patchNode: {
+          nodeId: "401",
+          classType: TEACACHE_NODE_KEY,
+          inputs: {
+            model: ["6", 0],
+            rel_l1_thresh: 0.1,
+            start_step: 2,
+            end_step: 18,
+            total_steps: 20
+          }
+        }
+      };
+
+      const empty = createEmptyTeaCacheObservation(req);
+      expect(empty.status).toBe("unknown");
+      expect(empty.mode).toBe("raw-l1-v1");
+      expect(empty.requestedConfig?.relL1Thresh).toBe(0.1);
+      expect(empty.forwardCallsRecorded).toBeNull();
+      expect(empty.cacheHitsRecorded).toBeNull();
+      expect(empty.coverage.complete).toBe(false);
+      expect(empty.timings.timingUnavailableReason).toBe("Prior to execution");
+    });
+  });
+});
diff --git a/packages/contracts/src/minimax-h3-teacache.ts b/packages/contracts/src/minimax-h3-teacache.ts
new file mode 100644
index 0000000..921a5e0
--- /dev/null
+++ b/packages/contracts/src/minimax-h3-teacache.ts
@@ -0,0 +1,426 @@
+import { z } from "zod";
+import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";
+import { sha256HashSchema } from "./persistent-media.js";
+import { MinimaxH3SourceEvidenceRefSchema } from "./minimax-h3-attention.js";
+
+// ---------------------------------------------------------------------------
+// Constants & Pinned Identities
+// ---------------------------------------------------------------------------
+export const TEACACHE_UPSTREAM_COMMIT = "4cbb50d69c73a19a5d6ec42c5aec1989d5a04b6f";
+export const TEACACHE_UPSTREAM_REPO = "https://github.com/Icyoung/ComfyUI-MiniMaxH3-TeaCache";
+export const TEACACHE_ADAPTER_VERSION = "0.1.0-cco-experimental";
+export const TEACACHE_NODE_CLASS = "CCOMiniMaxH3TeaCacheNode";
+export const TEACACHE_NODE_KEY = "CCOMiniMaxH3TeaCache";
+export const TEACACHE_PATCH_NODE_ID = "401";
+
+export const TEACACHE_SUPPORTED_THRESHOLDS = Object.freeze([0.05, 0.1, 0.15]);
+export const TEACACHE_DEFAULT_THRESHOLD = 0.15;
+export const TEACACHE_DEFAULT_START_STEP = 2;
+export const TEACACHE_DEFAULT_END_STEP = -2;
+export const TEACACHE_TOTAL_STEPS = 20;
+
+export const TEACACHE_SOURCE_FILE_HASHES = Object.freeze({
+  "nodes.py": "dc70a1e0b8c1a305ab70b47bada8f7600f35e0e4eb6282e1dd7369cf316f4287",
+  "teacache.py": "97aa9dedcd360e7a861e4eb9e9a94c922b3ebee730dee4bd18799250a8bf217f",
+  LICENSE: "ae094efee2f41309823764a9d7d82871b4d1a271ae343f4e7cbdff61f2c5da67",
+  "pyproject.toml": "e1c1e4f6737985fc5bba11c91934a072cf1b11b710346aa5e0620a26886289be",
+  "__init__.py": "8a92598329096c262dd4ce55375e0b4908a4d6bf20f9f38a4988ab03e2d12416"
+});
+
+export const TEACACHE_LOCAL_ADAPTER_FILE_HASHES = Object.freeze({
+  "__init__.py": "3b14b0a4da6f0fa366d8da492ea85ce74f2a63f18336ac63970d9d2bfe128c94",
+  "nodes.py": "ea16ae7ced6ab1ddfe7ba729a0a0c7047827f1e5601c6fd5c8363b837dd17d2c",
+  // Updated for issue #467 follow-up-review fixes: mandatory sigmas/timestep
+  // validation, same-model session-ownership guard, and conditioning-manifest
+  // binding added to TeaCacheSession (see teacache.py).
+  "teacache.py": "ffd3c347182b31d85677e24c1bcf5386f0f49b354690a01e545c972c9756a19a"
+});
+
+export const TEACACHE_LOCAL_ADAPTER_DIGEST = sha256Hex(
+  canonicalizeJson(TEACACHE_LOCAL_ADAPTER_FILE_HASHES)
+);
+
+export function computeLocalTeaCacheAdapterDigest(fileHashes: Record<string, string>): string {
+  return sha256Hex(canonicalizeJson(fileHashes));
+}
+
+// ---------------------------------------------------------------------------
+// Schemas
+// ---------------------------------------------------------------------------
+export const MinimaxH3TeaCacheModeSchema = z.enum(["off", "raw-l1-v1"]);
+export type MinimaxH3TeaCacheMode = z.infer<typeof MinimaxH3TeaCacheModeSchema>;
+
+export const MinimaxH3TeaCachePatchNodeInputsSchema = z
+  .object({
+    model: z.tuple([z.string().min(1), z.number().int().nonnegative()]),
+    rel_l1_thresh: z
+      .number()
+      .refine(
+        (v) =>
+          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
+        {
+          message: `rel_l1_thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
+        }
+      ),
+    start_step: z.number().int().min(0),
+    end_step: z.number().int(),
+    total_steps: z.number().int().positive()
+  })
+  .strict();
+export type MinimaxH3TeaCachePatchNodeInputs = z.infer<
+  typeof MinimaxH3TeaCachePatchNodeInputsSchema
+>;
+
+export const MinimaxH3TeaCachePatchNodeSchema = z
+  .object({
+    nodeId: z.string().min(1),
+    classType: z.literal(TEACACHE_NODE_KEY),
+    inputs: MinimaxH3TeaCachePatchNodeInputsSchema
+  })
+  .strict();
+export type MinimaxH3TeaCachePatchNode = z.infer<typeof MinimaxH3TeaCachePatchNodeSchema>;
+
+export const MinimaxH3TeaCacheConfigSchema = z
+  .object({
+    mode: MinimaxH3TeaCacheModeSchema,
+    relL1Thresh: z
+      .number()
+      .refine(
+        (v) =>
+          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
+        {
+          message: `relL1Thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
+        }
+      ),
+    startStep: z.number().int().min(0),
+    endStep: z.number().int(),
+    totalSteps: z.literal(20),
+    normalizedStartStep: z.number().int().min(2),
+    normalizedEndStep: z.number().int().max(18)
+  })
+  .strict();
+export type MinimaxH3TeaCacheConfig = z.infer<typeof MinimaxH3TeaCacheConfigSchema>;
+
+export const MinimaxH3TeaCacheRequestSchema = z
+  .object({
+    mode: MinimaxH3TeaCacheModeSchema,
+    relL1Thresh: z
+      .number()
+      .refine(
+        (v) =>
+          Number.isFinite(v) && (TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(v),
+        {
+          message: `relL1Thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}]`
+        }
+      ),
+    startStep: z.number().int().min(0),
+    endStep: z.number().int(),
+    totalSteps: z.literal(20),
+    normalizedStartStep: z.number().int().min(2),
+    normalizedEndStep: z.number().int().max(18),
+    upstreamCommit: z.string().min(1),
+    adapterVersion: z.string().min(1),
+    adapterDigest: sha256HashSchema,
+    catalogDigest: sha256HashSchema,
+    topologyDigest: sha256HashSchema,
+    patchNode: MinimaxH3TeaCachePatchNodeSchema.nullable()
+  })
+  .strict();
+export type MinimaxH3TeaCacheRequest = z.infer<typeof MinimaxH3TeaCacheRequestSchema>;
+
+export const MinimaxH3TeaCacheObservationCoverageSchema = z
+  .object({
+    samplingCallsRecorded: z.number().int().nonnegative(),
+    modelForwardsRecorded: z.number().int().nonnegative().nullable(),
+    complete: z.boolean()
+  })
+  .strict();
+export type MinimaxH3TeaCacheObservationCoverage = z.infer<
+  typeof MinimaxH3TeaCacheObservationCoverageSchema
+>;
+
+export const MinimaxH3TeaCacheObservationTimingsSchema = z
+  .object({
+    samplingWallMs: z.number().nonnegative().nullable(),
+    modelForwardElapsedMs: z.number().nonnegative().nullable(),
+    decisionOverheadMs: z.number().nonnegative().nullable(),
+    timingUnavailableReason: z.string().min(1).nullable().optional()
+  })
+  .strict();
+export type MinimaxH3TeaCacheObservationTimings = z.infer<
+  typeof MinimaxH3TeaCacheObservationTimingsSchema
+>;
+
+export const MinimaxH3TeaCacheObservationSchema = z
+  .object({
+    status: z.enum(["verified", "no_op", "failed", "unknown"]),
+    mode: MinimaxH3TeaCacheModeSchema,
+    requestedConfig: MinimaxH3TeaCacheConfigSchema.nullable(),
+    effectiveConfig: MinimaxH3TeaCacheConfigSchema.nullable(),
+    totalSteps: z.number().int().nonnegative(),
+    forwardCallsRecorded: z.number().int().nonnegative().nullable(),
+    cacheHitsRecorded: z.number().int().nonnegative().nullable(),
+    unattributedCallsRecorded: z.number().int().nonnegative().optional(),
+    nestedForwardsOnHits: z.number().int().nonnegative().nullable().optional(),
+    coverage: MinimaxH3TeaCacheObservationCoverageSchema,
+    timings: MinimaxH3TeaCacheObservationTimingsSchema,
+    failureReason: z.string().min(1).nullable().optional(),
+    sessionId: z.string().min(1).nullable().optional(),
+    sessionAttempts: z.number().int().nonnegative().optional()
+  })
+  .strict();
+export type MinimaxH3TeaCacheObservation = z.infer<typeof MinimaxH3TeaCacheObservationSchema>;
+
+export const FactorChangeCachingConfigSummarySchema = z
+  .object({
+    mode: MinimaxH3TeaCacheModeSchema,
+    relL1Thresh: z.number().nullable().optional(),
+    startStep: z.number().int().nullable().optional(),
+    endStep: z.number().int().nullable().optional(),
+    totalSteps: z.number().int().nullable().optional(),
+    topologyDigest: sha256HashSchema.nullable().optional(),
+    adapterVersion: z.string().nullable().optional()
+  })
+  .strict();
+export type FactorChangeCachingConfigSummary = z.infer<
+  typeof FactorChangeCachingConfigSummarySchema
+>;
+
+export const MinimaxH3TeaCacheVariantNameSchema = z.enum([
+  "teacache-raw-l1",
+  "matched-control",
+  "off"
+]);
+export type MinimaxH3TeaCacheVariantName = z.infer<typeof MinimaxH3TeaCacheVariantNameSchema>;
+
+export const MinimaxH3TeaCacheCatalogEntrySchema = z
+  .object({
+    variantName: MinimaxH3TeaCacheVariantNameSchema,
+    route: z.enum(["i2v", "ref2v"]),
+    compatibilityState: z.enum(["supported", "unverified", "unsupported"]),
+    scope: z.string().min(1),
+    comfyuiCoreRevision: z.string().min(1),
+    customNode: z
+      .object({
+        name: z.string().min(1),
+        repository: z.string().min(1),
+        revision: z.string().min(1),
+        entrypoint: z.string().optional()
+      })
+      .strict(),
+    runnable: z.boolean(),
+    supportedThresholds: z.array(z.number()),
+    defaultThreshold: z.number(),
+    stepWindow: z
+      .object({
+        minStartStep: z.number().int(),
+        maxEndStep: z.number().int(),
+        defaultStartStep: z.number().int(),
+        defaultEndStep: z.number().int(),
+        requiredTotalSteps: z.literal(20)
+      })
+      .strict(),
+    pythonPackages: z.array(
+      z
+        .object({
+          name: z.string().min(1),
+          version: z.string().min(1),
+          artifactHash: sha256HashSchema.optional(),
+          artifactMethod: z.string().optional(),
+          importModule: z.string().optional()
+        })
+        .strict()
+    ),
+    cudaRequirement: z.string().min(1),
+    computeCapability: z.string().min(1),
+    checkpointCompatibility: z
+      .object({
+        filename: z.string().min(1),
+        sha256: sha256HashSchema,
+        taskMode: z.string().min(1)
+      })
+      .strict(),
+    licensing: z
+      .object({
+        status: z.enum(["approved", "restricted", "review_required", "unverified"]),
+        licenseSourceRef: z.string().min(1),
+        securityReviewStatus: z.enum(["passed", "pending", "flagged"])
+      })
+      .strict(),
+    isolationInstructions: z
+      .object({
+        venvSetup: z.string().min(1),
+        installRecipe: z.string().min(1),
+        teardownRecipe: z.string().min(1)
+      })
+      .strict(),
+    blockers: z.array(z.string().min(1)),
+    evidence: z.array(MinimaxH3SourceEvidenceRefSchema),
+    catalogDigest: sha256HashSchema
+  })
+  .strict();
+export type MinimaxH3TeaCacheCatalogEntry = z.infer<typeof MinimaxH3TeaCacheCatalogEntrySchema>;
+
+// ---------------------------------------------------------------------------
+// Helper Functions
+// ---------------------------------------------------------------------------
+export function normalizeTeaCacheWindow(params: {
+  startStep: number;
+  endStep: number;
+  totalSteps: number;
+}): {
+  startStep: number;
+  endStep: number;
+  totalSteps: 20;
+  normalizedStartStep: number;
+  normalizedEndStep: number;
+} {
+  const { startStep, endStep, totalSteps } = params;
+  if (totalSteps !== TEACACHE_TOTAL_STEPS) {
+    throw new Error(
+      `TeaCache currently requires total_steps to be exactly ${TEACACHE_TOTAL_STEPS}, got ${totalSteps}.`
+    );
+  }
+
+  if (!Number.isInteger(startStep) || !Number.isInteger(endStep)) {
+    throw new Error(
+      `TeaCache step window boundaries must be integers, got start=${startStep}, end=${endStep}.`
+    );
+  }
+
+  const effectiveEnd = endStep < 0 ? totalSteps + endStep : endStep;
+
+  if (startStep < 2) {
+    throw new Error(
+      `TeaCache startStep must be >= 2 to preserve early denoising steps, got ${startStep}.`
+    );
+  }
+
+  if (effectiveEnd > 18) {
+    throw new Error(
+      `TeaCache effective endStep must be <= 18 to preserve final denoising steps, got ${effectiveEnd} (from end_step ${endStep}).`
+    );
+  }
+
+  if (startStep >= effectiveEnd) {
+    throw new Error(
+      `TeaCache window [start_step, effective_end) is empty or inverted: [${startStep}, ${effectiveEnd}).`
+    );
+  }
+
+  return {
+    startStep,
+    endStep,
+    totalSteps: 20,
+    normalizedStartStep: startStep,
+    normalizedEndStep: effectiveEnd
+  };
+}
+
+export function validateTeaCacheParameters(params: {
+  relL1Thresh: number;
+  startStep: number;
+  endStep: number;
+  totalSteps: number;
+}): {
+  relL1Thresh: number;
+  startStep: number;
+  endStep: number;
+  totalSteps: 20;
+  normalizedStartStep: number;
+  normalizedEndStep: number;
+} {
+  const { relL1Thresh } = params;
+  if (typeof relL1Thresh !== "number" || !Number.isFinite(relL1Thresh)) {
+    throw new Error(`TeaCache rel_l1_thresh must be a finite number, got ${relL1Thresh}.`);
+  }
+
+  if (!(TEACACHE_SUPPORTED_THRESHOLDS as readonly number[]).includes(relL1Thresh)) {
+    throw new Error(
+      `TeaCache rel_l1_thresh must be one of [${TEACACHE_SUPPORTED_THRESHOLDS.join(", ")}], got ${relL1Thresh}.`
+    );
+  }
+
+  const window = normalizeTeaCacheWindow({
+    startStep: params.startStep,
+    endStep: params.endStep,
+    totalSteps: params.totalSteps
+  });
+
+  return {
+    relL1Thresh,
+    ...window
+  };
+}
+
+export function computeTeaCacheTopologyDigest(
+  patch: MinimaxH3TeaCachePatchNode | null | undefined
+): string {
+  if (!patch) {
+    return sha256Hex(canonicalizeJson(null));
+  }
+  return sha256Hex(canonicalizeJson(patch));
+}
+
+export function computeTeaCacheConfigDigest(params: {
+  workflowDigest: string;
+  argv: readonly string[];
+  teacacheConfig: MinimaxH3TeaCacheConfig | null | undefined;
+}): string {
+  return sha256Hex(
+    canonicalizeJson({
+      workflowDigest: params.workflowDigest,
+      argv: params.argv,
+      teacacheConfig: params.teacacheConfig ?? null
+    })
+  );
+}
+
+export function computeTeaCacheCatalogDigest(
+  entry: Omit<MinimaxH3TeaCacheCatalogEntry, "catalogDigest"> | MinimaxH3TeaCacheCatalogEntry
+): string {
+  const copy = { ...entry } as Record<string, unknown>;
+  delete copy.catalogDigest;
+  return sha256Hex(canonicalizeJson(copy));
+}
+
+export function createEmptyTeaCacheObservation(
+  request?: MinimaxH3TeaCacheRequest | null
+): MinimaxH3TeaCacheObservation {
+  const mode = request?.mode ?? "off";
+  const requestedConfig: MinimaxH3TeaCacheConfig | null =
+    request && request.mode !== "off"
+      ? {
+          mode: request.mode,
+          relL1Thresh: request.relL1Thresh,
+          startStep: request.startStep,
+          endStep: request.endStep,
+          totalSteps: 20,
+          normalizedStartStep: request.normalizedStartStep,
+          normalizedEndStep: request.normalizedEndStep
+        }
+      : null;
+
+  return {
+    status: "unknown",
+    mode,
+    requestedConfig,
+    effectiveConfig: null,
+    totalSteps: request?.totalSteps ?? 20,
+    forwardCallsRecorded: null,
+    cacheHitsRecorded: null,
+    nestedForwardsOnHits: null,
+    coverage: {
+      samplingCallsRecorded: 0,
+      modelForwardsRecorded: null,
+      complete: false
+    },
+    timings: {
+      samplingWallMs: null,
+      modelForwardElapsedMs: null,
+      decisionOverheadMs: null,
+      timingUnavailableReason: "Prior to execution"
+    },
+    failureReason: null
+  };
+}
diff --git a/packages/infrastructure/src/experiments/minimax-h3-collector.py b/packages/infrastructure/src/experiments/minimax-h3-collector.py
index ea1fc16..2b709e0 100644
--- a/packages/infrastructure/src/experiments/minimax-h3-collector.py
+++ b/packages/infrastructure/src/experiments/minimax-h3-collector.py
@@ -638,6 +638,149 @@ VERIFIED_VEDA_EXCLUSION_REASONS = frozenset(
     _VEDA_EXCLUSION_SPEC.get("supportedExclusionReasons", ["full-attention layer", "full-attention step"])
 )
 
+def _resolve_teacache_module(guider=None, model_patcher=None):
+    # 1. Inspect model_patcher or guider for wrapped model
+    mp = model_patcher
+    if mp is None and guider is not None:
+        mp = getattr(guider, "model_patcher", None) or getattr(guider, "model", None)
+    if mp is not None:
+        opts = getattr(mp, "model_options", None)
+        if isinstance(opts, dict):
+            wrapper = opts.get("model_function_wrapper")
+            while hasattr(wrapper, "__wrapped__"):
+                wrapper = getattr(wrapper, "__wrapped__")
+            if wrapper is not None:
+                mod = getattr(wrapper, "_teacache_module", None)
+                if mod is not None and hasattr(mod, "TeaCacheSession"):
+                    return mod
+                fn_globals = getattr(wrapper, "__globals__", {})
+                mod = fn_globals.get("_teacache_mod") or fn_globals.get("teacache")
+                if mod is not None and hasattr(mod, "TeaCacheSession"):
+                    return mod
+
+    # 2. Check ComfyUI registered node classes if available
+    try:
+        import nodes as comfy_nodes
+        mappings = getattr(comfy_nodes, "NODE_CLASS_MAPPINGS", {})
+        for key in ("CCOMiniMaxH3TeaCache", "MiniMaxH3TeaCache"):
+            if key in mappings:
+                cls = mappings[key]
+                mod = getattr(cls, "_teacache_module", None)
+                if mod is not None and hasattr(mod, "TeaCacheSession"):
+                    return mod
+                cls_mod = sys.modules.get(cls.__module__)
+                if cls_mod is not None:
+                    mod = getattr(cls_mod, "_teacache_mod", None) or getattr(cls_mod, "teacache", None)
+                    if mod is not None and hasattr(mod, "TeaCacheSession"):
+                        return mod
+    except Exception:
+        pass
+
+    # 3. Search sys.modules for loaded adapter packages
+    for mod_name, mod in list(sys.modules.items()):
+        if mod is not None and hasattr(mod, "CCOMiniMaxH3TeaCacheNode"):
+            tc_mod = getattr(mod, "_teacache_module", None) or getattr(mod, "_teacache_mod", None) or getattr(mod, "teacache", None)
+            if tc_mod is not None and hasattr(tc_mod, "TeaCacheSession"):
+                return tc_mod
+
+    for mod_name, mod in list(sys.modules.items()):
+        if mod is not None and (mod_name.endswith(".teacache") or mod_name == "teacache"):
+            if hasattr(mod, "TeaCacheSession") and hasattr(mod, "get_active_session") and hasattr(mod, "set_active_session"):
+                return mod
+
+    # 4. Check custom_nodes directories for staged cco-minimax-h3-teacache
+    for base in [os.getcwd(), "/opt/comfyui-isolated-teacache"]:
+        cn_dir = os.path.join(base, "custom_nodes")
+        if os.path.isdir(cn_dir):
+            for entry in ["cco-minimax-h3-teacache", "ComfyUI-MiniMaxH3-TeaCache", "minimax-h3-teacache"]:
+                pkg_path = os.path.join(cn_dir, entry)
+                tc_file = os.path.join(pkg_path, "teacache.py")
+                if os.path.isfile(tc_file):
+                    try:
+                        import importlib.util
+                        spec = importlib.util.spec_from_file_location(f"custom_nodes_{entry.replace('-', '_')}_teacache", tc_file)
+                        if spec and spec.loader:
+                            mod = importlib.util.module_from_spec(spec)
+                            spec.loader.exec_module(mod)
+                            if hasattr(mod, "TeaCacheSession"):
+                                return mod
+                    except Exception:
+                        pass
+
+    # 5. Fallback import
+    try:
+        from experiments.minimax_h3_teacache import teacache
+        return teacache
+    except Exception:
+        pass
+    try:
+        import teacache
+        return teacache
+    except Exception:
+        pass
+    candidates = [
+        os.path.join(os.getcwd(), "experiments", "minimax-h3-teacache"),
+        os.path.join(os.path.dirname(__file__), "../../../../experiments/minimax-h3-teacache")
+    ]
+    for cdir in candidates:
+        norm = os.path.normpath(cdir)
+        if os.path.exists(norm) and norm not in sys.path:
+            sys.path.insert(0, norm)
+            try:
+                import teacache
+                return teacache
+            except Exception:
+                pass
+    return None
+
+# Pinned post-adaptation local-file digest for the staged TeaCache adapter
+# package, matching packages/contracts/src/minimax-h3-teacache.ts's
+# TEACACHE_LOCAL_ADAPTER_DIGEST exactly (same three files, same
+# json.dumps(sort_keys=True, separators=(",", ":")) canonicalization). Kept
+# here (rather than only checked statically pre-run by runtime-registry.ts)
+# so the digest of the module *actually resolved and bound* at sampling time
+# is itself verified -- a static pre-flight check cannot prove that a later
+# runtime resolution step didn't substitute a different, unverified copy.
+TEACACHE_LOCAL_ADAPTER_DIGEST = "0f5fa82271230dfe93567f7cbe07d8e1d5af13998f6efde68c3918c30e6673d7"
+
+
+def _compute_teacache_adapter_digest(package_dir: str) -> Optional[str]:
+    try:
+        file_hashes = {}
+        for fname in ("__init__.py", "nodes.py", "teacache.py"):
+            fpath = os.path.join(package_dir, fname)
+            if not os.path.isfile(fpath):
+                return None
+            with open(fpath, "rb") as f:
+                file_hashes[fname] = hashlib.sha256(f.read()).hexdigest()
+        payload = json.dumps(file_hashes, sort_keys=True, separators=(",", ":"))
+        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
+    except Exception:
+        return None
+
+
+def _verify_teacache_adapter_identity(tc_mod) -> Dict[str, Any]:
+    """Hash the actually-resolved adapter module's directory and compare
+    against the pinned local-adapter digest. Returns a dict describing the
+    verification outcome; never raises (the caller decides how to act)."""
+    mod_file = getattr(tc_mod, "__file__", None)
+    if not mod_file:
+        return {"verified": False, "reason": "resolved_module_has_no___file__"}
+    package_dir = os.path.dirname(os.path.abspath(mod_file))
+    digest = _compute_teacache_adapter_digest(package_dir)
+    if digest is None:
+        return {"verified": False, "reason": "missing_adapter_files", "packageDir": package_dir}
+    if digest != TEACACHE_LOCAL_ADAPTER_DIGEST:
+        return {
+            "verified": False,
+            "reason": "digest_mismatch",
+            "packageDir": package_dir,
+            "observedDigest": digest,
+            "expectedDigest": TEACACHE_LOCAL_ADAPTER_DIGEST
+        }
+    return {"verified": True, "packageDir": package_dir, "observedDigest": digest}
+
+
 def extract_layer_and_step(args, kwargs):
     layer = None
     step = None
@@ -1284,6 +1427,14 @@ def register_capability_route(prompt_server, collector: Collector):
             except Exception:
                 pass
 
+            teacache_adapter_identity = None
+            try:
+                _tc_mod_probe = _resolve_teacache_module()
+                if _tc_mod_probe is not None:
+                    teacache_adapter_identity = _verify_teacache_adapter_identity(_tc_mod_probe)
+            except Exception:
+                pass
+
             all_hooks_attached = bool(installed_hooks and all(h.get("attached", False) for h in installed_hooks))
             if _HOOK_INSTALL_ERROR:
                 status_val = "failed"
@@ -1316,6 +1467,7 @@ def register_capability_route(prompt_server, collector: Collector):
                 "registeredNodes": registered_nodes,
                 "packageIdentities": package_identities,
                 "sourceIdentities": source_identities,
+                "teacacheAdapterIdentity": teacache_adapter_identity,
                 "runtimeVersions": {
                     "pythonVersion": python_ver,
                     "pythonExecutableHash": python_executable_hash,
@@ -1589,11 +1741,178 @@ def _install_hooks_inner(collector: Collector):
                 buf = StepIntervalBuffer()
                 token_buf = _SAMPLING_STEP_CALL_BUFFER.set(buf)
 
+                # Inspect guider / model_patcher for TeaCache and diffusion_model
+                model_patcher = getattr(guider, "model_patcher", None)
+                if model_patcher is None:
+                    model_patcher = getattr(guider, "model", None)
+
+                teacache_config = None
+                if model_patcher is not None and hasattr(model_patcher, "model_options") and isinstance(model_patcher.model_options, dict):
+                    teacache_config = model_patcher.model_options.get("teacache_config")
+                if teacache_config is None and hasattr(guider, "model_options") and isinstance(guider.model_options, dict):
+                    teacache_config = guider.model_options.get("teacache_config")
+
+                base_model = getattr(model_patcher, "model", None) if model_patcher else None
+                if base_model is None:
+                    base_model = getattr(guider, "model", None)
+                diffusion_model = getattr(base_model, "diffusion_model", None) if base_model else None
+
+                # Hook diffusion_model.forward for independent forward counting
+                orig_diff_forward = getattr(diffusion_model, "forward", None) if diffusion_model else None
+                diff_forward_count = 0
+                tc_session = None
+                tc_token = None
+                if orig_diff_forward is not None and callable(orig_diff_forward):
+                    def hooked_diff_forward(*df_args, **df_kwargs):
+                        nonlocal diff_forward_count
+                        if tc_session is not None and getattr(tc_session, "is_evaluating_hit", False):
+                            tc_session.nested_forwards_on_hits += 1
+                        now_start = now_mono_ms()
+                        df_span_id = collector.next_span_id("diff_fwd")
+                        collector.emit(
+                            "sampling",
+                            "span_start",
+                            span_id=df_span_id,
+                            parent_span_id=sampler_span_id,
+                            monotonic_ms=now_start,
+                            metadata={"modelForwardCall": True, "phase": "diffusion_forward"}
+                        )
+                        try:
+                            res = orig_diff_forward(*df_args, **df_kwargs)
+                            diff_forward_count += 1
+                            collector.emit(
+                                "sampling",
+                                "span_end",
+                                span_id=df_span_id,
+                                parent_span_id=sampler_span_id,
+                                monotonic_ms=now_mono_ms(),
+                                outcome="success",
+                                metadata={"modelForwardCall": True, "phase": "diffusion_forward"}
+                            )
+                            return res
+                        except Exception as e:
+                            collector.emit(
+                                "sampling",
+                                "span_end",
+                                span_id=df_span_id,
+                                parent_span_id=sampler_span_id,
+                                monotonic_ms=now_mono_ms(),
+                                outcome="failed",
+                                error={"message": str(e), "exceptionType": type(e).__name__},
+                                metadata={"modelForwardCall": True, "phase": "diffusion_forward"}
+                            )
+                            raise
+                    diffusion_model.forward = hooked_diff_forward
+
+                # Setup TeaCache session if configured. This is deliberately
+                # fail-closed: if anything after a real session object exists
+                # raises (set_active_session's ownership check, advance_step's
+                # validation, or the emit below), we must not leave a session
+                # registered as active -- that would leak into every later
+                # render in this process and either permanently block the
+                # model_id (ownership guard) or let the dead session's stale
+                # state be read by an unrelated later run. On any failure here
+                # we unwind whatever was partially set up and re-raise rather
+                # than silently continuing without TeaCache.
+                tc_mod = _resolve_teacache_module(guider=guider, model_patcher=model_patcher)
+                tc_adapter_identity = None
+                if tc_mod is not None:
+                    tc_adapter_identity = _verify_teacache_adapter_identity(tc_mod)
+                    if teacache_config is not None and not tc_adapter_identity.get("verified"):
+                        raise RuntimeError(
+                            "TeaCache adapter identity verification failed: "
+                            f"{tc_adapter_identity}. Refusing to use an unverified/substituted "
+                            "adapter module for a configured TeaCache render."
+                        )
+                if tc_mod is not None and teacache_config is not None:
+                    def on_tc_event(*cb_args, **cb_kwargs):
+                        evt_name = cb_kwargs.get("event", "unknown")
+                        collector.emit(
+                            "sampling",
+                            "point_event",
+                            metadata={
+                                "teacacheEvent": evt_name,
+                                **cb_kwargs
+                            }
+                        )
+                    sigmas_list = sigmas.tolist() if hasattr(sigmas, "tolist") else list(sigmas) if isinstance(sigmas, (list, tuple)) else None
+                    session_id = collector.next_span_id("teacache_session")
+                    tc_thresh = teacache_config.get("rel_l1_thresh", teacache_config.get("threshold", 0.15))
+                    tc_start = teacache_config.get("start_step", 2)
+                    tc_end = teacache_config.get("end_step", -2)
+                    tc_total = teacache_config.get("total_steps", 20)
+                    tc_session = tc_mod.TeaCacheSession(
+                        session_id=session_id,
+                        model_id=teacache_config.get("model_id"),
+                        rel_l1_thresh=tc_thresh,
+                        start_step=tc_start,
+                        end_step=tc_end,
+                        total_steps=tc_total,
+                        sigmas=sigmas_list,
+                        event_callback=on_tc_event
+                    )
+                    try:
+                        tc_token = tc_mod.set_active_session(tc_session)
+                        tc_session.advance_step(0)
+                        collector.emit(
+                            "sampling",
+                            "point_event",
+                            metadata={
+                                "teacacheEvent": "session_init",
+                                "sessionId": tc_session.session_id,
+                                "adapterIdentity": tc_adapter_identity,
+                                "effectiveConfig": {
+                                    "mode": "raw-l1-v1",
+                                    "relL1Thresh": tc_session.rel_l1_thresh,
+                                    "startStep": tc_session.start_step,
+                                    "endStep": getattr(tc_session, "raw_end_step", tc_session.end_step),
+                                    "totalSteps": tc_session.total_steps,
+                                    "normalizedStartStep": tc_session.start_step,
+                                    "normalizedEndStep": tc_session.end_step
+                                }
+                            }
+                        )
+                    except Exception:
+                        try:
+                            tc_session.cleanup()
+                        finally:
+                            if tc_token is not None:
+                                tc_mod.reset_active_session(tc_token)
+                            tc_session = None
+                            tc_token = None
+                        raise
+                elif tc_session is None and os.environ.get("CCO_EXPERIMENT_TEACACHE_MODE") == "off":
+                    collector.emit(
+                        "sampling",
+                        "point_event",
+                        metadata={
+                            "teacacheEvent": "session_init",
+                            "effectiveConfig": {
+                                "mode": "off",
+                                "relL1Thresh": 0.15,
+                                "startStep": 2,
+                                "endStep": 18,
+                                "totalSteps": 20,
+                                "normalizedStartStep": 2,
+                                "normalizedEndStep": 18
+                            }
+                        }
+                    )
+
                 def step_callback(chain_cb):
                     def cb(step, x0, x, total_s, *cb_args, **cb_kwargs):
                         cur_idx = _parse_nonnegative_int(step)
                         if cur_idx is not None:
                             flush_step_buffer(cur_idx)
+                            if tc_session is not None:
+                                if cur_idx + 1 < tc_session.total_steps:
+                                    # Deliberately not caught: a session-state
+                                    # error here means TeaCache's step/cache
+                                    # invariants are already violated, and
+                                    # continuing to sample with a corrupted
+                                    # session would silently serve wrong
+                                    # cached output. Fail the render instead.
+                                    tc_session.advance_step(cur_idx + 1)
                             if cur_idx not in state["seen_steps"]:
                                 state["seen_steps"].add(cur_idx)
                                 now = now_mono_ms()
@@ -1668,6 +1987,68 @@ def _install_hooks_inner(collector: Collector):
                     )
                     raise
                 finally:
+                    if orig_diff_forward is not None and diffusion_model is not None:
+                        diffusion_model.forward = orig_diff_forward
+
+                    if tc_session is not None:
+                        try:
+                            summary = {
+                                "mode": "raw-l1-v1",
+                                "sessionId": tc_session.session_id,
+                                "forwardCalls": tc_session.forward_calls_count,
+                                "cacheHits": tc_session.cache_hits_count,
+                                "totalSteps": tc_session.total_steps,
+                                "nestedForwardsOnHits": tc_session.nested_forwards_on_hits,
+                                "effectiveConfig": {
+                                    "mode": "raw-l1-v1",
+                                    "relL1Thresh": tc_session.rel_l1_thresh,
+                                    "startStep": tc_session.start_step,
+                                    "endStep": getattr(tc_session, "raw_end_step", tc_session.end_step),
+                                    "totalSteps": tc_session.total_steps,
+                                    "normalizedStartStep": tc_session.start_step,
+                                    "normalizedEndStep": tc_session.end_step
+                                }
+                            }
+                            collector.emit(
+                                "sampling",
+                                "point_event",
+                                metadata={
+                                    "teacacheSession": "end",
+                                    "summary": summary,
+                                    "teacacheSummary": {
+                                        "status": "verified" if tc_session.cache_hits_count > 0 else "no_op",
+                                        "forwardCallsRecorded": tc_session.forward_calls_count,
+                                        "cacheHitsRecorded": tc_session.cache_hits_count,
+                                        "modelForwardsRecorded": diff_forward_count,
+                                        "nestedForwardsOnHits": tc_session.nested_forwards_on_hits
+                                    }
+                                }
+                            )
+                        finally:
+                            tc_session.cleanup()
+                            if tc_token is not None and tc_mod is not None:
+                                tc_mod.reset_active_session(tc_token)
+                    elif os.environ.get("CCO_EXPERIMENT_TEACACHE_MODE") == "off":
+                        collector.emit(
+                            "sampling",
+                            "point_event",
+                            metadata={
+                                "teacacheSession": "end",
+                                "summary": {
+                                    "mode": "off",
+                                    "forwardCalls": diff_forward_count,
+                                    "cacheHits": 0
+                                },
+                                "teacacheSummary": {
+                                    "status": "verified",
+                                    "forwardCallsRecorded": diff_forward_count,
+                                    "cacheHitsRecorded": 0,
+                                    "modelForwardsRecorded": diff_forward_count,
+                                    "nestedForwardsOnHits": 0
+                                }
+                            }
+                        )
+
                     if buf is not None and buf.pending_calls:
                         with _ATTENTION_TRACKER._lock:
                             unflushed = len(buf.pending_calls)
diff --git a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts
index 74fba8d..984ae31 100644
--- a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts
+++ b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.test.ts
@@ -347,6 +347,77 @@ exec /usr/bin/python3 "$@"
     expect(res.status).toBe("verified");
   });
 
+  it("accepts CCOMiniMaxH3TeaCache on pinned adapter when adapter files match pinned digest", async () => {
+    const adapter = new CurrentPinExperimentRuntimeAdapter();
+    const manifestWithTeaCache: MinimaxH3RequiredRuntimeManifest = {
+      ...baseManifest,
+      coreRevision: PINNED_COMFYUI_CORE_REVISION,
+      requiredNodes: [{ name: "MiniMaxH3ImageToVideo" }, { name: "CCOMiniMaxH3TeaCache" }],
+      pythonPackages: [{ name: "json", version: "" }]
+    };
+
+    const res = await adapter.verify({
+      comfyUiDir: mockComfyDir,
+      pythonPath: mockPythonPath,
+      requiredRuntime: manifestWithTeaCache
+    });
+
+    expect(res.ok).toBe(true);
+    expect(res.status).toBe("verified");
+  });
+
+  it("rejects CCOMiniMaxH3TeaCache on pinned adapter when adapter files are tampered", async () => {
+    const adapter = new CurrentPinExperimentRuntimeAdapter();
+    const tamperedComfyDir = path.join(mockRootDir, "tampered-teacache-comfy-dir");
+    fs.mkdirSync(path.join(tamperedComfyDir, "comfy_extras"), { recursive: true });
+    fs.mkdirSync(path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache"), {
+      recursive: true
+    });
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "comfy_extras", "nodes_minimax_h3.py"),
+      "class MiniMaxH3ImageToVideo:\n    INPUT_TYPES = {}\n"
+    );
+    // Write tampered node files
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache", "nodes.py"),
+      "class CCOMiniMaxH3TeaCacheNode:\n    INPUT_TYPES = {}\n"
+    );
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache", "__init__.py"),
+      "# tampered\n"
+    );
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, "custom_nodes", "cco-minimax-h3-teacache", "teacache.py"),
+      "# tampered\n"
+    );
+
+    execSync("git init -b main", { cwd: tamperedComfyDir });
+    execSync('git config user.email "test@test.com"', { cwd: tamperedComfyDir });
+    execSync('git config user.name "Test"', { cwd: tamperedComfyDir });
+    execSync("git add .", { cwd: tamperedComfyDir });
+    execSync('git commit -m "init"', { cwd: tamperedComfyDir });
+    fs.writeFileSync(
+      path.join(tamperedComfyDir, ".git", "HEAD"),
+      `${PINNED_COMFYUI_CORE_REVISION}\n`
+    );
+
+    const manifestWithTeaCache: MinimaxH3RequiredRuntimeManifest = {
+      ...baseManifest,
+      coreRevision: PINNED_COMFYUI_CORE_REVISION,
+      requiredNodes: [{ name: "CCOMiniMaxH3TeaCache" }]
+    };
+
+    const res = await adapter.verify({
+      comfyUiDir: tamperedComfyDir,
+      pythonPath: mockPythonPath,
+      requiredRuntime: manifestWithTeaCache
+    });
+
+    expect(res.ok).toBe(false);
+    expect(res.status).toBe("conflict");
+    expect(res.blocker).toContain("TeaCache local adapter digest mismatch");
+  });
+
   it("FastH3 isolated upgrade adapter verifies supported nodes", async () => {
     const registry = new ExperimentRuntimeRegistry();
     const adapter = registry.getAdapter(FASTH3_ISOLATED_CORE_REVISION);
diff --git a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
index 5286528..555438b 100644
--- a/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
+++ b/packages/infrastructure/src/experiments/minimax-h3-runtime-registry.ts
@@ -12,7 +12,9 @@ import {
   type MinimaxH3RequiredRuntimeManifest,
   type MinimaxH3ObservedProvenance,
   compareDottedVersions,
-  satisfiesDriverConstraint
+  satisfiesDriverConstraint,
+  TEACACHE_LOCAL_ADAPTER_DIGEST,
+  computeLocalTeaCacheAdapterDigest
 } from "@cco/contracts";
 
 const execFileAsync = promisify(execFile);
@@ -243,7 +245,8 @@ const NODE_SOURCE_FILES: Record<string, string> = {
   ModelSparseAttention: "comfy_extras/nodes_sparse_attention.py",
   VedaSparseAttention: "comfy_extras/nodes_sparse_attention.py",
   ModelAttentionBackend: "comfy_extras/nodes_model_advanced.py",
-  LoraLoaderModelOnly: "nodes.py"
+  LoraLoaderModelOnly: "nodes.py",
+  CCOMiniMaxH3TeaCache: "custom_nodes/ComfyUI-MiniMaxH3-TeaCache/nodes.py"
 };
 
 function extractClassBlock(
@@ -306,6 +309,71 @@ async function verifyRequiredNodeDefinitions(
   requiredNodes: ReadonlyArray<{ name: string }>
 ): Promise<{ ok: boolean; blocker?: string }> {
   for (const node of requiredNodes) {
+    if (node.name === "CCOMiniMaxH3TeaCache") {
+      const candidates = [
+        resolve(resolvedDir, "custom_nodes/cco-minimax-h3-teacache"),
+        resolve(resolvedDir, "custom_nodes/ComfyUI-MiniMaxH3-TeaCache"),
+        resolve(resolvedDir, "custom_nodes/minimax-h3-teacache"),
+        resolve(process.cwd(), "experiments/minimax-h3-teacache")
+      ];
+      let foundDir: string | null = null;
+      for (const cand of candidates) {
+        if (existsSync(cand) && existsSync(resolve(cand, "nodes.py"))) {
+          foundDir = cand;
+          break;
+        }
+      }
+      if (!foundDir) {
+        return {
+          ok: false,
+          blocker: `Required node "CCOMiniMaxH3TeaCache" source files not found in custom_nodes/ComfyUI-MiniMaxH3-TeaCache or experiments/minimax-h3-teacache.`
+        };
+      }
+      const fullPath = resolve(foundDir, "nodes.py");
+      try {
+        const content = await readFile(fullPath, "utf8");
+        const classBlock =
+          extractClassBlock(content, "CCOMiniMaxH3TeaCacheNode") ??
+          extractClassBlock(content, "CCOMiniMaxH3TeaCache");
+        const definesClassWithSchema = classBlock !== null && classHasSchema(classBlock);
+        const registersMapping = isNodeExplicitlyMapped(content, "CCOMiniMaxH3TeaCache");
+
+        if (!definesClassWithSchema && !registersMapping) {
+          return {
+            ok: false,
+            blocker: `${fullPath} does not define a schema-valid ComfyUI node class or register "CCOMiniMaxH3TeaCache" in NODE_CLASS_MAPPINGS.`
+          };
+        }
+
+        const requiredFiles = ["__init__.py", "nodes.py", "teacache.py"];
+        const observedHashes: Record<string, string> = {};
+        for (const rf of requiredFiles) {
+          const fPath = resolve(foundDir, rf);
+          if (!existsSync(fPath)) {
+            return {
+              ok: false,
+              blocker: `TeaCache adapter missing required file "${rf}" in ${foundDir}`
+            };
+          }
+          const buf = await readFile(fPath);
+          observedHashes[rf] = createHash("sha256").update(buf).digest("hex");
+        }
+        const digest = computeLocalTeaCacheAdapterDigest(observedHashes);
+        if (digest !== TEACACHE_LOCAL_ADAPTER_DIGEST) {
+          return {
+            ok: false,
+            blocker: `TeaCache local adapter digest mismatch in ${foundDir}: expected ${TEACACHE_LOCAL_ADAPTER_DIGEST}, computed ${digest}`
+          };
+        }
+      } catch (err) {
+        return {
+          ok: false,
+          blocker: `Failed to verify CCOMiniMaxH3TeaCache in ${foundDir}: ${(err as Error).message}`
+        };
+      }
+      continue;
+    }
+
     const relFile = NODE_SOURCE_FILES[node.name];
     if (!relFile) {
       return {
@@ -823,7 +891,11 @@ export class CurrentPinExperimentRuntimeAdapter implements ExperimentRuntimeAdap
       "MiniMaxH3ReferenceToVideo",
       "EmptyMiniMaxH3LatentAV"
     ]);
-    const SUPPORTED_NODES = new Set([...CANONICAL_H3_NODES, "LoraLoaderModelOnly"]);
+    const SUPPORTED_NODES = new Set([
+      ...CANONICAL_H3_NODES,
+      "LoraLoaderModelOnly",
+      "CCOMiniMaxH3TeaCache"
+    ]);
 
     return verifyRuntimeSubstrate(this, options, (requiredNodes) => {
       for (const node of requiredNodes) {
@@ -850,7 +922,8 @@ export class IsolatedUpgradeExperimentRuntimeAdapter implements ExperimentRuntim
     const CANONICAL_H3_NODES = [
       "MiniMaxH3ImageToVideo",
       "MiniMaxH3ReferenceToVideo",
-      "EmptyMiniMaxH3LatentAV"
+      "EmptyMiniMaxH3LatentAV",
+      "CCOMiniMaxH3TeaCache"
     ];
     this.supportedNodes = Array.from(new Set([...CANONICAL_H3_NODES, ...supportedNodes]));
   }
diff --git a/packages/infrastructure/src/experiments/minimax-h3-teacache.unit.test.ts b/packages/infrastructure/src/experiments/minimax-h3-teacache.unit.test.ts
new file mode 100644
index 0000000..778a981
--- /dev/null
+++ b/packages/infrastructure/src/experiments/minimax-h3-teacache.unit.test.ts
@@ -0,0 +1,794 @@
+import { spawnSync } from "node:child_process";
+import { resolve } from "node:path";
+import { describe, expect, it } from "vitest";
+
+const TEACACHE_DIR = resolve("experiments/minimax-h3-teacache");
+
+function runPythonTest(code: string): { status: number | null; stdout: string; stderr: string } {
+  const result = spawnSync("python3", ["-c", code], {
+    env: {
+      ...process.env,
+      PYTHONPATH: TEACACHE_DIR
+    },
+    encoding: "utf-8"
+  });
+  return {
+    status: result.status,
+    stdout: result.stdout ?? "",
+    stderr: result.stderr ?? ""
+  };
+}
+
+describe("MiniMax-H3 TeaCache Python Implementation", () => {
+  describe("TeaCacheSession Parameter Validation & Boundaries", () => {
+    it("accepts allowlisted thresholds (0.05, 0.1, 0.15) with 20 steps", () => {
+      const code = `
+import teacache
+
+for thresh in (0.05, 0.1, 0.15):
+    sess = teacache.TeaCacheSession(
+        session_id="test-sess",
+        model_id="test-model",
+        rel_l1_thresh=thresh,
+        start_step=2,
+        end_step=-2,
+        total_steps=20,
+        sigmas=list(range(21, 0, -1))
+    )
+    assert sess.rel_l1_thresh == thresh
+    assert sess.total_steps == 20
+    assert sess.start_step == 2
+    assert sess.end_step == 18
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("requires a sigma schedule and rejects omitted sigmas (issue #467)", () => {
+      const code = `
+import teacache
+
+try:
+    teacache.TeaCacheSession(
+        session_id="test-sess",
+        model_id="test-model",
+        rel_l1_thresh=0.15,
+        start_step=2,
+        end_step=-2,
+        total_steps=20
+    )
+    assert False, "Expected ValueError when sigmas is omitted"
+except ValueError as e:
+    assert "sigmas schedule is required" in str(e)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects unallowlisted, non-finite, and invalid thresholds", () => {
+      const code = `
+import teacache
+import math
+
+invalid_thresholds = [0.0, 0.08, 0.2, -0.15, float("inf"), float("-inf"), float("nan"), "0.15", None]
+
+for t in invalid_thresholds:
+    try:
+        teacache.TeaCacheSession(
+            session_id="test-sess",
+            model_id="test-model",
+            rel_l1_thresh=t,
+            start_step=2,
+            end_step=-2,
+            total_steps=20
+        )
+        assert False, f"Expected ValueError for threshold {t}"
+    except (ValueError, TypeError):
+        pass
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects total_steps != 20 or non-integer total_steps", () => {
+      const code = `
+import teacache
+
+invalid_steps = [10, 15, 25, 4, "20", 20.0, None]
+
+for s in invalid_steps:
+    try:
+        teacache.TeaCacheSession(
+            session_id="test-sess",
+            model_id="test-model",
+            rel_l1_thresh=0.15,
+            start_step=2,
+            end_step=-2,
+            total_steps=s
+        )
+        assert False, f"Expected ValueError for total_steps {s}"
+    except (ValueError, TypeError):
+        pass
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects invalid windows where start_step >= end_step", () => {
+      const code = `
+import teacache
+
+try:
+    teacache.TeaCacheSession(
+        session_id="test-sess",
+        model_id="test-model",
+        rel_l1_thresh=0.15,
+        start_step=15,
+        end_step=10,
+        total_steps=20,
+        sigmas=list(range(21, 0, -1))
+    )
+    assert False, "Expected ValueError for start_step >= end_step"
+except ValueError as e:
+    assert "Invalid step window" in str(e)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+
+  describe("TeaCacheSession Step Sequencing & State Isolation", () => {
+    it("enforces strict sequential step advancement and rejects jumps or duplicates", () => {
+      const code = `
+import teacache
+
+sess = teacache.TeaCacheSession(
+    session_id="test-seq",
+    model_id="test-model",
+    rel_l1_thresh=0.15,
+    start_step=2,
+    end_step=-2,
+    total_steps=20,
+    sigmas=list(range(21, 0, -1))
+)
+
+# Step 0 ok
+sess.advance_step(0)
+
+# Duplicate step 0 must fail
+try:
+    sess.advance_step(0)
+    assert False, "Expected ValueError on duplicate step 0"
+except ValueError as e:
+    assert "repeat" in str(e).lower() or "backwards" in str(e).lower()
+
+# Skipping step 1 directly to step 2 must fail
+try:
+    sess.advance_step(2)
+    assert False, "Expected ValueError on non-sequential step jump"
+except ValueError as e:
+    assert "jumped" in str(e).lower() or "non-sequentially" in str(e).lower()
+
+# Sequential step 1 ok
+sess.advance_step(1)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("clones cached tensor outputs on hit and evaluate to prevent mutation", () => {
+      const code = `
+import teacache
+
+class MockFloat:
+    def __init__(self, val):
+        self.val = val
+    def item(self):
+        return self.val
+    def __truediv__(self, other):
+        v = other.val if isinstance(other, MockFloat) else other
+        return MockFloat(self.val / v)
+    def __add__(self, other):
+        v = other.val if isinstance(other, MockFloat) else other
+        return MockFloat(self.val + v)
+
+class MockTensor:
+    def __init__(self, val, mean_val=1.0):
+        self.val = val
+        self.mean_val = mean_val
+        self.cloned = False
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+
+    def detach(self):
+        return self
+
+    def float(self):
+        return self
+
+    def clone(self):
+        c = MockTensor(self.val, self.mean_val)
+        c.cloned = True
+        return c
+
+    def abs(self):
+        return self
+
+    def mean(self):
+        return MockFloat(self.mean_val)
+
+    def __sub__(self, other):
+        return MockTensor("sub", mean_val=0.0001)
+
+sess = teacache.TeaCacheSession(
+    session_id="test-clone",
+    model_id="test-model",
+    rel_l1_thresh=0.15,
+    start_step=2,
+    end_step=-2,
+    total_steps=20,
+    sigmas=list(range(21, 0, -1))
+)
+
+# Advance steps 0 and 1 (before window)
+sess.advance_step(0)
+sess.advance_step(1)
+
+# Step 2: first window step, full forward pass
+sess.advance_step(2)
+out1 = sess.evaluate(lambda inp, **kw: MockTensor("out1"), {"input": MockTensor("inp1"), "timestep": 19.0})
+assert sess.last_real_output is not None
+assert sess.last_real_output.cloned is True
+
+# Step 3: cache hit (accumulated rel_l1 0.01 < 0.15)
+sess.advance_step(3)
+out2 = sess.evaluate(lambda inp, **kw: MockTensor("out2"), {"input": MockTensor("inp2"), "timestep": 18.0})
+
+# Assert that out2 is a cloned copy, not identical reference
+assert out2.cloned is True
+assert out2 is not sess.last_real_output
+assert sess.cache_hits_count == 1
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("isolates active sessions and prevents concurrent or uncleaned sessions", () => {
+      const code = `
+import teacache
+
+sigmas = list(range(21, 0, -1))
+sess1 = teacache.TeaCacheSession("s1", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
+sess2 = teacache.TeaCacheSession("s2", "m2", 0.15, 2, -2, 20, sigmas=sigmas)
+
+tok1 = teacache.set_active_session(sess1)
+assert teacache.get_active_session() is sess1
+
+# Reset session
+teacache.reset_active_session(tok1)
+assert teacache.get_active_session() is None
+
+# Now setting sess2 succeeds
+tok2 = teacache.set_active_session(sess2)
+assert teacache.get_active_session() is sess2
+teacache.reset_active_session(tok2)
+assert teacache.get_active_session() is None
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects a second session activation for the same model_id while one is already active (issue #467)", () => {
+      const code = `
+import teacache
+
+sigmas = list(range(21, 0, -1))
+sess_a = teacache.TeaCacheSession("s-a", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
+sess_b = teacache.TeaCacheSession("s-b", "shared-model", 0.15, 2, -2, 20, sigmas=sigmas)
+
+tok_a = teacache.set_active_session(sess_a)
+try:
+    teacache.set_active_session(sess_b)
+    assert False, "Expected RuntimeError on same-model nested session activation"
+except RuntimeError as e:
+    assert "already active for model_id" in str(e)
+finally:
+    teacache.reset_active_session(tok_a)
+    sess_a.cleanup()
+
+# After sess_a.cleanup() releases the model_id, a new session for the same
+# model_id may be activated.
+tok_b = teacache.set_active_session(sess_b)
+assert teacache.get_active_session() is sess_b
+teacache.reset_active_session(tok_b)
+sess_b.cleanup()
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("binds a session to the conditioning manifest shape seen on its first evaluate call and rejects a later change (issue #467)", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sigmas = list(range(21, 0, -1))
+sess = teacache.TeaCacheSession("s-cond", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
+sess.advance_step(0)
+
+# First call establishes the conditioning fingerprint.
+out1 = sess.evaluate(
+    lambda inp, **kw: MockTensor(),
+    {"input": MockTensor(), "timestep": 21.0, "c": {"cross_attention": "x"}}
+)
+
+sess.advance_step(1)
+try:
+    # A different set of conditioning keys mid-session must be rejected --
+    # reusing a cached forward output computed under a different route
+    # would be silently wrong.
+    sess.evaluate(
+        lambda inp, **kw: MockTensor(),
+        {"input": MockTensor(), "timestep": 20.0, "c": {"cross_attention": "x", "extra_key": "y"}}
+    )
+    assert False, "Expected RuntimeError on conditioning manifest change"
+except RuntimeError as e:
+    assert "Conditioning manifest changed mid-session" in str(e)
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+
+  describe("CCOMiniMaxH3TeaCacheNode ComfyUI Wrapper & Model Verification", () => {
+    it("validates node metadata and input types schema", () => {
+      const code = `
+import nodes
+
+node = nodes.CCOMiniMaxH3TeaCacheNode()
+input_types = nodes.CCOMiniMaxH3TeaCacheNode.INPUT_TYPES()
+assert "required" in input_types
+req = input_types["required"]
+assert "model" in req
+assert "rel_l1_thresh" in req
+assert "start_step" in req
+assert "end_step" in req
+assert "total_steps" in req
+assert nodes.CCOMiniMaxH3TeaCacheNode.RETURN_TYPES == ("MODEL",)
+assert nodes.CCOMiniMaxH3TeaCacheNode.CATEGORY == "model_patches/unet"
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects unallowlisted thresholds at node execution time", () => {
+      const code = `
+import nodes
+import math
+
+node = nodes.CCOMiniMaxH3TeaCacheNode()
+
+class MockModelPatcher:
+    pass
+
+model = MockModelPatcher()
+
+for bad in [0.08, float("nan"), float("inf"), True, False, "0.15", None]:
+    try:
+        node.apply(model, rel_l1_thresh=bad, start_step=2, end_step=-2, total_steps=20)
+        assert False, f"Expected ValueError/TypeError on invalid threshold {bad}"
+    except (ValueError, TypeError):
+        pass
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("rejects multi-branch duplicate evaluations within the same step interval", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sigmas = list(range(21, 0, -1))
+sess = teacache.TeaCacheSession("s-multi", model_id="m1", rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
+sess.advance_step(0)
+
+# First evaluation in step 0 succeeds
+out1 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 21.0})
+
+# Second evaluation in step 0 must fail (multi-branch / duplicate rejection)
+try:
+    sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 21.0})
+    assert False, "Expected RuntimeError on duplicate evaluation in step 0"
+except RuntimeError as e:
+    assert "Duplicate or multi-branch evaluation detected" in str(e)
+
+# Advance to step 1: evaluation succeeds again
+sess.advance_step(1)
+out2 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 20.0})
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("verifies active session model ownership and parameter match", () => {
+      const code = `
+import nodes
+import teacache
+
+node = nodes.CCOMiniMaxH3TeaCacheNode()
+
+class MockModelPatcher:
+    def __init__(self):
+        self.wrapper = None
+
+    def clone(self):
+        c = MockModelPatcher()
+        c.wrapper = self.wrapper
+        return c
+
+    def set_model_unet_function_wrapper(self, wrapper):
+        self.wrapper = wrapper
+
+m1 = MockModelPatcher()
+m2 = MockModelPatcher()
+
+# Patch m1 with threshold 0.15
+res1 = node.apply(m1, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
+m1_patched = res1[0]
+w1 = m1_patched.wrapper
+assert w1 is not None
+
+# 1. Calling wrapper without active session must fail
+try:
+    w1(lambda inp: inp, {"input": "test"})
+    assert False, "Expected RuntimeError when no active session"
+except RuntimeError as e:
+    assert "without an active execution session" in str(e)
+
+sigmas = list(range(21, 0, -1))
+
+# 2. Register session bound to different model_id (id of m2)
+sess_m2 = teacache.TeaCacheSession("s-m2", model_id=id(m2), rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
+tok2 = teacache.set_active_session(sess_m2)
+try:
+    w1(lambda inp: inp, {"input": "test"})
+    assert False, "Expected RuntimeError on model_id mismatch"
+except RuntimeError as e:
+    assert "model_id mismatch" in str(e)
+finally:
+    teacache.reset_active_session(tok2)
+
+# 3. Register session bound to m1_patched but with different threshold (0.10)
+sess_diff_thresh = teacache.TeaCacheSession("s-diff", model_id=id(m1_patched), rel_l1_thresh=0.10, start_step=2, end_step=-2, total_steps=20, sigmas=sigmas)
+tok3 = teacache.set_active_session(sess_diff_thresh)
+try:
+    w1(lambda inp: inp, {"input": "test"})
+    assert False, "Expected RuntimeError on threshold mismatch"
+except RuntimeError as e:
+    assert "rel_l1_thresh does not match" in str(e)
+finally:
+    teacache.reset_active_session(tok3)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+
+  describe("TeaCacheSession Lifecycle, Timestep Alignment & Error Recovery", () => {
+    it("validates sigma schedule and rejects invalid length, non-finite, or non-descending sigmas", () => {
+      const code = `
+import teacache
+
+# Valid sigmas: 21 strictly descending finite values
+valid_sigmas = list(range(21, 0, -1))
+sess = teacache.TeaCacheSession("s-sigmas", "m1", 0.15, 2, -2, 20, sigmas=valid_sigmas)
+assert sess.sigmas == [float(s) for s in valid_sigmas]
+
+# Reject wrong length (20 instead of 21)
+try:
+    teacache.TeaCacheSession("s-bad-len", "m1", 0.15, 2, -2, 20, sigmas=list(range(20, 0, -1)))
+    assert False, "Expected ValueError on wrong sigmas length"
+except ValueError as e:
+    assert "Expected schedule with 21 sigmas" in str(e)
+
+# Reject non-descending sigmas
+try:
+    non_desc = list(range(21, 0, -1))
+    non_desc[5] = non_desc[4] + 1  # not descending
+    teacache.TeaCacheSession("s-non-desc", "m1", 0.15, 2, -2, 20, sigmas=non_desc)
+    assert False, "Expected ValueError on non-descending sigmas"
+except ValueError as e:
+    assert "strictly descending" in str(e)
+
+# Reject non-finite sigmas
+try:
+    bad_sigmas = list(range(21, 0, -1))
+    bad_sigmas[3] = float("nan")
+    teacache.TeaCacheSession("s-nan", "m1", 0.15, 2, -2, 20, sigmas=bad_sigmas)
+    assert False, "Expected ValueError on NaN sigma"
+except ValueError as e:
+    assert "non-finite" in str(e)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("validates timestep alignment against schedule and rejects mismatches", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sigmas = [float(20 - i) for i in range(21)]
+sess = teacache.TeaCacheSession("s-ts", "m1", 0.15, 2, -2, 20, sigmas=sigmas)
+sess.advance_step(0)
+
+# Timestep matching sigmas[0] (20.0) succeeds
+out1 = sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 20.0})
+
+# Timestep mismatching sigmas[1] (e.g. 5.0 instead of 19.0) raises ValueError
+sess.advance_step(1)
+try:
+    sess.evaluate(lambda inp, **kw: MockTensor(), {"input": MockTensor(), "timestep": 5.0})
+    assert False, "Expected ValueError on mismatched timestep"
+except ValueError as e:
+    assert "does not match expected schedule sigma" in str(e)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("cleans up state properly on exception and releases tensor references", () => {
+      const code = `
+import teacache
+
+class MockTensor:
+    def __init__(self):
+        self.shape = (1, 16, 20, 20)
+        self.dtype = "float32"
+        self.device = "cuda:0"
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+sess = teacache.TeaCacheSession("s-err", "m1", 0.15, 2, -2, 20, sigmas=list(range(21, 0, -1)))
+sess.advance_step(0)
+
+def failing_forward(inp, **kw):
+    raise RuntimeError("Synthetic model crash")
+
+try:
+    sess.evaluate(failing_forward, {"input": MockTensor(), "timestep": 21.0})
+    assert False, "Expected forward failure"
+except RuntimeError as e:
+    assert "Synthetic model crash" in str(e)
+
+# Verify is_evaluating lock was released in finally
+assert sess.is_evaluating is False
+
+# Clean up session
+sess.cleanup()
+assert sess.is_active is False
+assert sess.last_real_input is None
+assert sess.last_real_output is None
+
+# Operations on cleaned-up session fail
+try:
+    sess.advance_step(1)
+    assert False, "Expected RuntimeError on inactive session"
+except RuntimeError as e:
+    assert "inactive or cleaned-up" in str(e)
+
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("resolves package-style custom_nodes adapter module and binds session ContextVar across wrapper", () => {
+      const code = `
+import importlib.util
+import os
+import sys
+
+pkg_dir = os.path.abspath('experiments/minimax-h3-teacache')
+init_file = os.path.join(pkg_dir, '__init__.py')
+spec = importlib.util.spec_from_file_location('custom_nodes_teacache', init_file, submodule_search_locations=[pkg_dir])
+pkg = importlib.util.module_from_spec(spec)
+sys.modules['custom_nodes_teacache'] = pkg
+spec.loader.exec_module(pkg)
+
+node_cls = pkg.NODE_CLASS_MAPPINGS['CCOMiniMaxH3TeaCache']
+node = node_cls()
+
+class MockModel:
+    def __init__(self):
+        self.model_options = {}
+    def set_model_unet_function_wrapper(self, w):
+        self.model_options['model_function_wrapper'] = w
+
+m = MockModel()
+node.apply(m, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
+
+collector_path = os.path.abspath('packages/infrastructure/src/experiments/minimax-h3-collector.py')
+c_spec = importlib.util.spec_from_file_location('collector_mod', collector_path)
+c_mod = importlib.util.module_from_spec(c_spec)
+c_spec.loader.exec_module(c_mod)
+
+resolved_mod = c_mod._resolve_teacache_module(model_patcher=m)
+assert resolved_mod is not None, 'resolved_mod is None'
+assert resolved_mod is pkg._teacache_mod, f'Module mismatch: {resolved_mod} vs {pkg._teacache_mod}'
+
+sess = resolved_mod.TeaCacheSession('test-pkg', id(m), 0.15, 2, -2, 20, sigmas=list(range(21, 0, -1)))
+tok = resolved_mod.set_active_session(sess)
+
+wrapper = m.model_options['model_function_wrapper']
+sess.advance_step(0)
+
+class MockTensor:
+    def __init__(self): self.shape = (1, 16, 20, 20); self.dtype = 'float32'; self.device = 'cuda:0'
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+out = wrapper(lambda inp, **kw: MockTensor(), {'input': MockTensor(), 'timestep': 21.0})
+assert out is not None
+assert sess.forward_calls_count == 1
+resolved_mod.reset_active_session(tok)
+sess.cleanup()
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+
+    it("unpacks pinned wrapper API envelope and passes strict H3 conditioning to apply_model", () => {
+      const code = `
+import importlib.util
+import os
+import sys
+
+pkg_dir = os.path.abspath('experiments/minimax-h3-teacache')
+init_file = os.path.join(pkg_dir, '__init__.py')
+spec = importlib.util.spec_from_file_location('custom_nodes_h3_tc', init_file, submodule_search_locations=[pkg_dir])
+pkg = importlib.util.module_from_spec(spec)
+sys.modules['custom_nodes_h3_tc'] = pkg
+spec.loader.exec_module(pkg)
+
+node_cls = pkg.NODE_CLASS_MAPPINGS['CCOMiniMaxH3TeaCache']
+node = node_cls()
+
+class MockModel:
+    def __init__(self):
+        self.model_options = {}
+    def set_model_unet_function_wrapper(self, w):
+        self.model_options['model_function_wrapper'] = w
+
+m = MockModel()
+node.apply(m, rel_l1_thresh=0.15, start_step=2, end_step=-2, total_steps=20)
+
+wrapper = m.model_options['model_function_wrapper']
+
+sigmas = [float(20 - i) for i in range(21)]
+sess = pkg.TeaCacheSession('test-h3-cond', id(m), 0.15, 2, -2, 20, sigmas=sigmas)
+tok = pkg.set_active_session(sess)
+sess.advance_step(0)
+
+class MockTensor:
+    def __init__(self): self.shape = (1, 16, 20, 20); self.dtype = 'float32'; self.device = 'cuda:0'
+    def detach(self): return self
+    def float(self): return self
+    def clone(self): return MockTensor()
+
+received_kwargs = {}
+def strict_apply_model(x, t, **c_kw):
+    received_kwargs['x'] = x
+    received_kwargs['t'] = t
+    received_kwargs.update(c_kw)
+    return MockTensor()
+
+h3_envelope = {
+    'input': MockTensor(),
+    'timestep': 20.0,
+    'c': {
+        'cross_attention': 'mock_cross_attention',
+        'latent_shapes': (1, 16, 20, 20),
+        'minimax_payload': {'tokens': 512, 'audio_scale': 1.0}
+    },
+    'cond_or_uncond': [0]
+}
+
+out = wrapper(strict_apply_model, h3_envelope)
+assert out is not None
+assert received_kwargs['t'] == 20.0
+assert received_kwargs['cross_attention'] == 'mock_cross_attention'
+assert received_kwargs['latent_shapes'] == (1, 16, 20, 20)
+assert received_kwargs['minimax_payload'] == {'tokens': 512, 'audio_scale': 1.0}
+assert 'c' not in received_kwargs
+assert 'cond_or_uncond' not in received_kwargs
+
+sess.advance_step(1)
+multi_cfg_envelope = {
+    'input': MockTensor(),
+    'timestep': 19.0,
+    'c': {'cross_attention': 'mock'},
+    'cond_or_uncond': [0, 1]
+}
+try:
+    wrapper(strict_apply_model, multi_cfg_envelope)
+    assert False, "Expected multi-branch CFG to be rejected"
+except RuntimeError as e:
+    assert "Multi-condition/CFG branching is unsupported" in str(e)
+
+pkg.reset_active_session(tok)
+sess.cleanup()
+print("SUCCESS")
+`;
+      const res = runPythonTest(code);
+      expect(res.status).toBe(0);
+      expect(res.stdout).toContain("SUCCESS");
+    });
+  });
+});
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
