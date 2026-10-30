# Storyboard previs OCR advisory (#464)

## Purpose

Prompt-only tuning could not reliably suppress fabricated background lettering in
`flux_schnell_storyboard_v1` previs stills (see
[storyboard-previs-clean-panel-validation.md](storyboard-previs-clean-panel-validation.md),
disposition `UNRESOLVED_OCR_ADVISORY_REQUIRED`, issue #462). The render-worker now runs an
OCR pass on each previs still right after render and records an **advisory** on the candidate.

The advisory is **non-gating**. It never fails or defers a job, changes scene state, or disables
approval. Promoting it to a gate requires a separate explicit decision.

## Where it runs

`apps/render-worker/src/render-job-executor.ts`, candidate branch, after output bytes are read and
outside the GPU lease. It runs only when `jobKind === "candidate"`, the resolved profile id is
`STORYBOARD_PREVIS_PROFILE_ID`, and a detector is wired. Production, `flux-schnell-draft`, H3 and
LTX paths never call it.

- Port: `PrevisTextDetectionPort` (`packages/application/src/ports/`)
- Pure mapping: `evaluatePrevisTextAdvisory` (`packages/application/src/previs/`)
- Engine adapter: `TesseractPrevisTextDetector` (`packages/infrastructure/src/ocr/`), `tesseract.js`
  with pinned local English data, sparse-text page segmentation, no runtime downloads.

Detector errors or the timeout produce `status: "unavailable"` with a short `reason`.

## Policy `previs_text_advisory_v1`

A region is a detection when all hold: `confidence >= 0.70`, at least 3 alphanumeric characters,
and alphanumeric / non-space characters `>= 0.6` (rejects linework misread as `|/\-_`). Output is
`flagged` when any detection survives, else `clean`. Up to 5 detections are kept (highest
confidence first), text truncated to 64 chars. Thresholds and the policy version are stored on every
advisory.

## Configuration (render-worker env)

| Variable | Default |
|---|---|
| `CCO_PREVIS_TEXT_ADVISORY_ENABLED` | `true` (`false` disables; no `textAdvisory` is written) |
| `CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE` | `0.70` |
| `CCO_PREVIS_TEXT_ADVISORY_MIN_ALNUM_CHARS` | `3` |
| `CCO_PREVIS_TEXT_ADVISORY_TIMEOUT_MS` | `30000` |

Each processed still logs a `previs_text_advisory` JSON line (jobId, sceneId, shotPlanId,
beatIndex, status, maxConfidence, detections, durationMs).

## Storage and surfacing

Stored in `storyboard_candidates.generation_payload.textAdvisory` (no migration). The scene review
read model exposes it as `textAdvisory` on `beatFrames[]` and `previs`; malformed values read as
absent. The Review Hub shows a "Possible fabricated text" badge with the top detections for
flagged stills, and a muted note when the check was unavailable.

## Re-rolling

The flagged badge carries a **Re-roll still** button. It calls
`POST /api/scenes/:sceneId/shot-plans/:shotPlanId/beats/:beatIndex/previs-reroll` with
`{ "expectedCandidateId": "<uuid>" }` (the candidate currently shown for that beat) and returns
`202 { jobId, sceneId, shotPlanId, beatIndex, seed }`.

- `RerollPrevisBeatUseCase` enqueues one `flux_schnell_storyboard_v1` candidate job using the
  **unchanged** previs prompt compiler. It does not transition the scene or modify the shot plan.
- The seed is `deriveStoryboardPrevisRerollSeed(variantOrdinal, beatPosition, rerollOrdinal)` =
  original seed + `rerollOrdinal * 100000`, with `rerollOrdinal >= 1` (the number of candidates
  already rendered for that beat). A re-roll therefore never reuses the seed that produced the
  flagged still, and stays deterministic.
- `expectedCandidateId` gives optimistic concurrency: if the beat has already moved to another
  candidate the route returns `409`; an unknown beat/plan/scene returns `404`; a plan on a stale
  spec revision or a terminal scene returns `409`.
- The re-rolled still is OCR-checked like any other and replaces the beat on completion.

## Calibration (open)

The defaults are provisional and recall-leaning. They have **not** been calibrated against real
renders. An operator should OCR the labelled PNGs in
`docs/evidence/issue-462-clean-panel-2026-10-18/` with the detector and record measured results
here. No numbers are recorded until actually measured. If Tesseract recall is poor on marker-wash
linework, swap the engine behind `PrevisTextDetectionPort` (e.g. PaddleOCR via `onnxruntime-node`).
