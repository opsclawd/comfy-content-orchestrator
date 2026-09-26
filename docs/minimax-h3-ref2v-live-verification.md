# MiniMax-H3 `ref_images` Autogrow Wiring — Live Verification (Issue #328)

## Purpose

ADR-0007 §11.1 fenced an empirical uncertainty: the exact ComfyUI node graph
topology for supplying multiple reference images to `MiniMaxH3ReferenceToVideo`'s
`ref_images` input was unverified against the live render host. This document
records the live verification performed to close that uncertainty for the
`reference_directed` implementation in issue #328.

## Method

Verification was performed directly against the pinned ComfyUI installation on
the RTX 4090 render worker (ComfyUI `0.33.0`, core revision
`55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`, matching `.comfyui-version`).

1. Read the real node source
   (`comfy_extras/nodes_minimax_h3.py::MiniMaxH3ReferenceToVideo.define_schema`)
   directly on the render worker, confirming `ref_images` is declared as
   `io.Autogrow.Input` with `TemplatePrefix(prefix="ref_image_", min=0, max=9)` —
   i.e. up to 9 independently-addressable slots (`ref_images.ref_image_0`
   through `ref_images.ref_image_8`), not a single batched `IMAGE` tensor.
2. Cross-checked against the official example workflow
   (`comfyui_workflow_templates_json/templates/video_minimax_h3_r2v.json`),
   which wires each slot with its own dotted key
   (e.g. `"name": "ref_images.ref_image_0"`), confirming the API-format
   representation used by `templates/minimax_h3_720p_ref2v_124f_api.json`.
3. **Live submission (N=2):** built the exact mutated graph the render-worker
   would produce for two active references — the production template with
   `ref_images.ref_image_0` → `LoadImage("example.png")` and
   `ref_images.ref_image_1` → `LoadImage("test_reference.png")`, all other
   slots and their loader nodes removed — and submitted it directly to
   `POST /prompt` on the running ComfyUI instance.
   - Result: accepted with `node_errors: {}`, executed to completion
     (`status_str: "success"`), and produced a real output video
     (`minimax_h3_720p_ref2v_124f_00001_.mp4`).
4. **Live differential (image-honoring check):** ran two additional N=1
   submissions, identical in every field except which physical image was
   connected to `ref_images.ref_image_0` (`example.png` vs
   `test_reference.png`).
   - Result: the two runs produced byte-distinct output files
     (SHA-256 `fa79b8ea...` vs `afa60bdc...`), confirming the node genuinely
     consumes and is conditioned by the connected image rather than ignoring
     it.

## Conclusion

The pinned `MiniMaxH3ReferenceToVideo` node accepts the per-slot Autogrow
wiring (`ref_images.ref_image_0` .. `ref_images.ref_image_8`, each a direct
link to a `LoadImage` node) used by
`templates/minimax_h3_720p_ref2v_124f_api.json`,
`packages/contracts/src/render-profile.ts`
(`MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY.referenceSlotFields`), and
the corresponding validation/mutation logic in
`apps/render-worker/src/render-job-executor.ts` and
`packages/application/src/use-cases/assemble-generation-manifest.ts`. No
`ImageBatch` chain is required or accepted for this input.

This closes the empirical uncertainty fenced in ADR-0007 §11.1 for the
`reference_directed` routing mode's multi-reference wiring.
