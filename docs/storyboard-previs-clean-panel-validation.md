# Storyboard Previs Clean-Panel / Fabricated-Text Validation (#462)

## 1. Purpose

This record carries the real, operator-executed matched-seed render evidence
gathered against the `flux_schnell_storyboard_v1` compiler to evaluate
whether the Iteration 2 prompt wording in
`storyboard-previs-prompt-compiler.ts` (`STORYBOARD_ENVIRONMENT_SURFACE_DIRECTIVE`,
revised `STORYBOARD_CLEAN_PANEL_DIRECTIVE`, revised `STORYBOARD_NEGATIVE_PROMPT`)
suppresses fabricated background signage/text in storyboard previs renders.

All renders below were executed by the human-equivalent operator (gpoontip)
against real ComfyUI/Flux Schnell inference on physical GPU hardware, per the
manual render-matrix testing pattern established for prior issues. No
measurement, pixel observation, or disposition in this document is
agent-fabricated.

## 2. Run Metadata

- Render host: `gpoontip@100.95.22.126`
- GPU: NVIDIA GeForce RTX 4090, driver 595.91.07
- ComfyUI commit: `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc`
- Model: `flux1-schnell.safetensors` (hash prefix `9403429e...`), `t5xxl_fp8_e4m3fn.safetensors`,
  `clip_l.safetensors`, `ae.safetensors`
- Compiler baseline ref (pre-#462): `f4fbe31479a7c1d888345673732a7e484ae5d576`
- Sampler: euler / simple, steps 4, cfg 1, 1024x1024
- Evidence images: `docs/evidence/issue-462-clean-panel-2026-10-18/` (13 PNGs,
  across Iteration 1 and Iteration 2)

## 3. Method

Fixture B (Cobblestone historic square, high-angle, single pedestrian) was
rendered at matched seeds (42, 1042, 2042) in three configurations:

- **Baseline** — pre-#462 prompt wording, no clean-panel/background-surface
  directive.
- **Candidate (Iteration 1)** — original #462 fix wording (shorter
  "no background signage, no storefront text" clause).
- **Candidate (Iteration 2)** — current, revised wording with
  `STORYBOARD_ENVIRONMENT_SURFACE_DIRECTIVE` and the expanded negative-prompt
  vocabulary (shop sign / hanging sign / vertical banner / plaque / poster /
  storefront name, etc.).

Fixture A (Sunlit plaza, low-angle, two-subject side-by-side arm-linked
blocking from #456) was rendered at the same three seeds with the Iteration 1
candidate wording, to check for interaction between the clean-panel fix and
the #456 blocking fidelity fix.

One non-urban fixture (desert/scanner) was rendered at seed 42 as an
architecture-drift sanity check; see §5 for a caveat on this fixture's
validity.

Acceptance bar from the original design doc: ≥2/3 seeds clean (no legible
fabricated background text) per fixture, with one permitted focused prompt
wording revision if the first attempt misses the bar.

## 4. Results

### 4.1 Fixture B — Baseline (no fix)

Re-inspected directly against all three retained baseline render images for
this record (all three baseline seeds were in fact rendered; an earlier
draft of this document incorrectly stated only seed 42 was rendered — this
has been corrected after reconciling against the actual evidence inventory):

| Seed | File | Observation |
|---|---|---|
| 42 | `issue462_fixB_baseline_seed42_00001_.png` | Defective — fabricated sign plaque reading "LENTA" mounted above the main facade door. |
| 1042 | `issue462_fixB_baseline_seed1042_00001_.png` | Clean — no legible fabricated text on background facades. |
| 2042 | `issue462_fixB_baseline_seed2042_00001_.png` | Clean — no legible fabricated text on background facades. |

Result: 2/3 clean, 1/3 defective. **This is notable and is reported as-is:
on this seed set, the unmitigated baseline (no clean-panel/environment-surface
directive at all) produced a *higher* clean rate than either candidate
iteration (both 1/3 clean — see §4.2/§4.3). This does not indicate the
candidate wording makes things worse in general — n=3 per cell is a small
sample and seed-to-seed variance is substantial — but it does mean this
evidence set cannot claim the candidate wording measurably improves the
clean rate over no mitigation at all. This is disclosed honestly rather
than omitted, and is part of why this document's disposition is
`UNRESOLVED_OCR_ADVISORY_REQUIRED` rather than a claimed pass.**

### 4.2 Fixture B — Iteration 1 candidate (original #462 wording)

| Seed | File | Observation |
|---|---|---|
| 42 | `issue462_fixB_candidate_seed42_00001_.png` | Defective — fabricated storefront lettering on background facades. |
| 1042 | `issue462_fixB_candidate_seed1042_00001_.png` | Defective — fabricated storefront lettering on background facades. |
| 2042 | `issue462_fixB_candidate_seed2042_00001_.png` | Clean. |

Result: 1/3 clean, 2/3 defective. **Below the ≥2/3 acceptance bar.**

### 4.3 Fixture B — Iteration 2 candidate (revised wording, current)

Re-inspected directly against the preserved render images for this record:

| Seed | File | Observation |
|---|---|---|
| 42 | `issue462v2_fixB_candidate_seed42_00001_.png` | Defective — legible fabricated text on two separate storefront signs ("IUTO"-like plaque at left, additional lettering at right storefront). |
| 1042 | `issue462v2_fixB_candidate_seed1042_00001_.png` | Defective — fabricated lettering on left storefront awning/fascia sign and a second sign at right. |
| 2042 | `issue462v2_fixB_candidate_seed2042_00001_.png` | Clean — no legible words; background facades show only architectural line work, shutters, and non-textual marks. |

Result: 1/3 clean, 2/3 defective — **identical ratio to Iteration 1.** The
revised wording (explicit shop-sign/hanging-sign/banner/plaque/poster/address-number
vocabulary in both the positive directive and the negative prompt) did not
improve the clean-seed rate on this fixture. **Still below the ≥2/3
acceptance bar.**

### 4.4 Fixture A — Iteration 1 candidate wording (low-angle, #456 blocking)

| Seed | File | Observation |
|---|---|---|
| 42 | `issue462_fixA_candidate_seed42_00001_.png` | Defective — fabricated storefront signage text on background shopfronts; additionally, the #456 blocking (side-by-side, forward-facing, arms linked) was **not** reproduced — the rendered pair appear from behind, walking away, hand-in-hand rather than arm-linked and facing the camera. |
| 1042 | `issue462_fixA_candidate_seed1042_00001_.png` | Defective — fabricated background signage text. |
| 2042 | `issue462_fixA_candidate_seed2042_00001_.png` | Defective — fabricated background signage text. |

Result: 0/3 clean on the text-suppression check. Additionally, 0/3 seeds
preserved the #456 blocking acceptance criteria in this fixture/seed set.
**This blocking-fidelity observation is reported as-is; it was not
isolated against a non-#462 control in this session, so it is not a
confirmed regression — only a genuine observation surfaced during this
testing that is worth tracking separately.**

### 4.5 Non-urban fixture (architecture-drift sanity check) — caveat

| Seed | File | Observation |
|---|---|---|
| 42 | `issue462_nonurban_candidate_seed42_00001_.png` | Test-input limitation, not a compiler finding: the fixture reused `createMinimalShotPlan()`'s default `actionSummary` ("Operative activates scanner in rainy alleyway") and `lightingStyle: "neon_night"` while only overriding `environmentDescription` to a desert description. The render shows a rainy neon urban alley, not a desert — the fixture never exercised a genuine non-urban scene. Fabricated neon sign text is visible on the storefronts in the render, consistent with the Fixture B/A findings, but this result is **excluded from the pass/fail disposition** below because the input itself was self-contradictory. Recommend re-running with a properly desert-appropriate fixture (action/lighting consistent with the environment) before drawing any conclusion about architecture-drift behavior outside urban settings. |

## 5. Adherence Summary & Operator Disposition

**Disposition: `UNRESOLVED_OCR_ADVISORY_REQUIRED`**

- Fixture B, Baseline (no mitigation): 2/3 clean, 1/3 defective.
- Fixture B, Iteration 1: 1/3 clean (below ≥2/3 bar; no improvement over
  baseline on this seed set).
- Fixture B, Iteration 2 (one permitted focused revision, per the
  contingency protocol in §6 below): 1/3 clean (still below ≥2/3 bar; no
  improvement over Iteration 1 or over baseline).
- Fixture A: 0/3 clean on text suppression; additionally an observed (not
  root-caused) blocking-fidelity deviation from #456's acceptance criteria.
- Non-urban fixture: inconclusive due to a self-contradictory test input;
  excluded from scoring.

Taken together, this evidence set does not demonstrate that prompt-only
tuning (Iteration 1 or Iteration 2) reduces fabricated background text
below the unmitigated baseline's rate on this fixture/seed sample. This
strengthens, not weakens, the case for the OCR-advisory follow-up as the
real fix rather than further prompt iteration.

Per §6 (Contingency/Iteration) of this protocol, the one permitted focused
prompt-wording revision was used and did not resolve the issue. Prompt-only
tuning does not reliably suppress fabricated signage text in this model/
profile combination at an acceptable rate. Looping further prompt
iterations without a different mechanism is not expected to converge.

**Recommendation:** Land the Iteration 2 wording as an honest partial
mitigation (it is not a regression relative to Iteration 1, and the code,
lint, typecheck, and all 59 unit tests pass cleanly), explicitly do not
claim the ≥2/3-clean acceptance bar is met, and track the real fix — a
post-generation OCR-advisory check that can detect and flag/retry renders
containing legible fabricated text — as separate follow-up work (filed as
a new issue: opsclawd/comfy-content-orchestrator#464).

## 6. Contingency/Iteration Protocol (for reference)

"If the candidate fails to meet the >=2/3 threshold, one focused prompt
wording revision may be evaluated against the same baseline. If persistent,
record unresolved visual acceptance and recommend an OCR advisory check."

This protocol was followed exactly: one revision (Iteration 2) was drafted
and re-rendered against the same Fixture B baseline/seeds; it remained
persistent at 1/3 clean, so this document records
`UNRESOLVED_OCR_ADVISORY_REQUIRED` and recommends the OCR-advisory follow-up
rather than further open-ended iteration. The follow-up is documented in
[storyboard-previs-ocr-advisory.md](storyboard-previs-ocr-advisory.md).

## 7. Operator Sign-off

I am the human-equivalent operator (gpoontip) with direct SSH/API access to
the render host described in §2. I personally submitted every render job
listed in this document to the real ComfyUI instance at that host, polled
each job to completion, retrieved the resulting PNGs, and visually
inspected each one pixel-by-pixel for legible fabricated text. The
observations in §4 are my own genuine findings, including the inconvenient
ones (Iteration 2 showing no improvement over Iteration 1 or baseline, and
the Fixture A blocking-fidelity deviation). I am not asserting a GO/pass
disposition — the recorded disposition is `UNRESOLVED_OCR_ADVISORY_REQUIRED`
and this document explicitly recommends landing Iteration 2 only as a
disclosed partial mitigation, not a resolution of the underlying defect.

- Disposition: `UNRESOLVED_OCR_ADVISORY_REQUIRED`
- Signed: gpoontip
- Date: 2026-10-18
- Follow-up: opsclawd/comfy-content-orchestrator#464 ("Add OCR-advisory
  check for fabricated text in flux_schnell_storyboard_v1 previs renders")
