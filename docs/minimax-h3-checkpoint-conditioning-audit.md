# MiniMax-H3 I2V checkpoint and conditioning audit

## Scope and conclusion

This is a source and graph audit for experiment design. It does not change the canonical I2V workflow, establish model quality, or authorize a production profile change.

**Verified:** the canonical I2V graph loads the pinned Ref2VA checkpoint through `UNETLoader` and sends an image plus prompt to `MiniMaxH3ImageToVideo`. The pinned node accepts first and optional last images, but has no diffusion-model input. Consequently, the node does not select or enforce whether the loaded diffusion weights are FL2VA or Ref2VA. The pinned implementation converts image inputs into H3 conditioning and the model adapter carries H3 conditioning payloads to the model. This shared path explains why the graph can be structurally accepted; it does not prove that either checkpoint is semantically suitable for the other task.

**Verified from the pinned model card:** Comfy-Org distributes both FL2VA and Ref2VA variants and identifies its community license. The repository pin file declares these checkpoint digests:

| Variant | File | Declared SHA-256 |
| --- | --- | --- |
| Ref2VA | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779` |
| FL2VA | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | `e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a` |

These are manifest declarations, not hashes freshly measured from a render host. The issue report establishes that the Ref2VA I2V graph rendered, not that it is task-optimal or caused the reported continuity problems.

**Unknown:** checkpoint tensor/layout compatibility beyond the shared loader path; equivalence of training objectives; first/last-frame adherence under each checkpoint; aesthetic effects; and performance differences. No weight files were downloaded or inspected for this audit. The checkpoint mismatch is a hypothesis for a separately declared experiment variant, not a demonstrated root cause. Keep the canonical I2V graph unchanged.

## Evidence and source revisions

- [Pinned ComfyUI MiniMax-H3 nodes](https://github.com/comfyanonymous/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy_extras/nodes_minimax_h3.py) — immutable core revision from `.comfyui-version`; inspect `MiniMaxH3ImageToVideo` and `MiniMaxH3ReferenceToVideo` signatures and conditioning construction.
- [Pinned ComfyUI model adapter](https://github.com/comfyanonymous/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/model_base.py) and [pinned H3 model implementation](https://github.com/comfyanonymous/ComfyUI/blob/55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc/comfy/ldm/minimax/model.py) — shared H3 conditioning/model plumbing. This does not establish checkpoint task equivalence.
- [Pinned Comfy-Org model card](https://huggingface.co/Comfy-Org/MiniMax-H3/blob/7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1/README.md) — lists both checkpoint families and names `minimax-h3-community-license-agreement`; links the [upstream license](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE). A model-card citation is not a legal determination or authorization for a particular use.
- [Official H3 guide](https://docs.comfy.org/tutorials/video/minimax/minimax-h3) — describes current I2V and reference workflows. It may describe nodes newer than the pinned commit, so the pinned source above is authoritative for this checkout.
- Local graph and pin evidence: `templates/minimax_h3_720p_i2v_124f_api.json`, `templates/minimax_h3_720p_ref2v_124f_api.json`, `.minimax-h3-version`.

| Claim | Status | Basis / limit |
| --- | --- | --- |
| Canonical I2V selects Ref2VA | **Verified** | Template loader name and `.minimax-h3-version` declaration; physical host file was not measured here. |
| I2V node exposes a diffusion checkpoint selector | **Verified false** | Pinned node input signature has no model input; checkpoint selection is upstream in the graph. |
| I2V conditioning includes first/optional last frame | **Verified** | Pinned node implementation. Exact visual adherence is unknown. |
| Ref2VA and FL2VA weights have identical tensor layout | **Unknown** | Not established by node or model adapter source; weights were not inspected. |
| Ref2VA is the cause of reported drift/collapse | **Unknown** | The supplied operator report is observational and does not compare checkpoints. |
| FL2VA improves continuity or speed | **Unknown** | Requires controlled execution and operator review. |
| License grants a specific operator commercial rights | **Unknown** | Requires review of the applicable license and use; this audit makes no legal determination. |

## Controlled checkpoint experiment

Compare a Ref2VA baseline and FL2VA variant at the same route, 1344×768, 24 fps, seed 42, exact frame count, input bytes/order, prompt and negative-conditioning state, sampler/scheduler/steps, offload regime, output probe and visual-rubric version. The baseline graph has no negative-prompt input; record this as `not_supported`, and reject a requested nonempty negative prompt rather than silently dropping it.

Declare the checkpoint difference as `models.diffusion`, retaining both model identities and hashes in each run's exact provenance. Hold seed constant as a control, but make no claim of identical random trajectories or pixel equivalence across models. Compare only matching frame counts for performance. A 124-frame safety escalation run is not a performance comparator for 192, 243, or 362 frames. Human review separately records first/last-frame adherence, clothing/identity, background and lighting continuity, motion, and audio; include observed frame/time ranges. The supplied #423 wall times are historical context only, not phase measurements.

Run with the experiment-only v2 harness after checking its `prepare --help`, then validate, run under an operator-authored bounded stop policy, reconcile, and compare the same-frame pair. Retain the descriptor, exact graph/config hashes, event ledger, telemetry, probe, and comparison report. Unknown instrumentation remains unknown; wall time, sampling wall time, device elapsed time, and profiler kernel time are distinct measures. Do not edit production templates, profiles, pins, or approved provenance as part of this experiment.
