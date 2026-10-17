# MiniMax-H3 Controlled Long-Shot Continuity Evaluation Report Template

> **Notice**: This document is an unexecuted template prepared under issue **#444**. Physical measurements, rendered video digests, and qualitative evaluations belong strictly to **#445** and must be populated by the human operator following GPU execution on the physical RTX 4090 host.

---

## 1. Study Metadata

- **Study Identifier**: `<study-id>`
- **Study Specification SHA-256**: `<study-digest>`
- **Rubric Specification SHA-256**: `<rubric-digest>`
- **Evaluation Date**: `YYYY-MM-DD`
- **Lead Operator / Reviewer**: `<operator-id>`
- **Physical Render Host**: `rtx4090` (`<gpu-uuid>`)
- **ComfyUI Core Revision**: `55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc` (or `<upgrade-core-revision>`)
- **Base Checkpoint (`ref2va`) SHA-256**: `Comfy-Org/MiniMax-H3@7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1`
- **Candidate Checkpoint (`fl2va`) SHA-256**: `Comfy-Org/MiniMax-H3@7e75982b97cd5a41d2dcfa1904ee88d0686d6fd1`

---

## 2. Factorial Test Design & Cell Execution Matrix

### 2.1 Mandatory Prompt Matrix (16 Cells, Static & Moving Blocks)

| Cell ID | Frame Count | Subject Motion | Arm | Prompt Variant | Output Video SHA-256 | Probe Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cell-moving-124f-base` | 124 | `moving` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-124f-tight` | 124 | `moving` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-192f-base` | 192 | `moving` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-192f-tight` | 192 | `moving` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-243f-base` | 243 | `moving` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-243f-tight` | 243 | `moving` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-362f-base` | 362 | `moving` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-362f-tight` | 362 | `moving` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-124f-base` | 124 | `static` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-124f-tight` | 124 | `static` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-192f-base` | 192 | `static` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-192f-tight` | 192 | `static` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-243f-base` | 243 | `static` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-243f-tight` | 243 | `static` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-362f-base` | 362 | `static` | `baseline` | `original` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-static-362f-tight` | 362 | `static` | `prompt_only` | `tight_01` | `<sha256>` | `[ ] PASS / [ ] FAIL` |

### 2.2 Optional Single-Variable Arms (Representative Block: Moving Scenario at 124f & 243f)

| Cell ID | Frame Count | Arm | Factor Varied | Value / Variant | Output Video SHA-256 | Probe Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `cell-moving-124f-fl2va` | 124 | `checkpoint_only` | `models.diffusion` | `fl2va` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-243f-fl2va` | 243 | `checkpoint_only` | `models.diffusion` | `fl2va` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-124f-step10` | 124 | `reduced_step_only` | `sampling.settings` | 10 steps | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-243f-step10` | 243 | `reduced_step_only` | `sampling.settings` | 10 steps | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-124f-dense` | 124 | `baseline` | Control | `dense` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-124f-solattn` | 124 | `attention_only` | `attention.configuration` | `native-sol-attn` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-243f-dense` | 243 | `baseline` | Control | `dense` | `<sha256>` | `[ ] PASS / [ ] FAIL` |
| `cell-moving-243f-solattn` | 243 | `attention_only` | `attention.configuration` | `native-sol-attn` | `<sha256>` | `[ ] PASS / [ ] FAIL` |

---

## 3. Detailed Visual Review Rubric Assessments

### 3.1 12-Dimension Evaluation Rubric
Rate each dimension as **`pass`**, **`defect`**, **`fail`**, or **`not_assessable`**, citing timestamped intervals:

```
[ ] fullClipExamined: true
[ ] playbackExamined: true
[ ] audioExamined: true
[ ] storyboardSampled: true
```

| Dimension | Assessment (`pass` / `defect` / `fail`) | Timestamp Intervals (sec) | Specific Defect Observations / Notes |
| :--- | :--- | :--- | :--- |
| **1. Identity Fidelity** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **2. Wardrobe Consistency** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **3. Background & Lighting Persistence** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **4. Camera Fidelity** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **5. Subject Anatomy** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **6. Face & Hands** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **7. Unnatural Cuts** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **8. Temporal Flicker** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **9. Reference Fidelity** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **10. Motion Coherence** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **11. Sound / Audio** | `[ ]` | `[  .  -  .  ]` | `<notes>` |
| **12. Overall Ad Usability** | `[ ]` | `[  .  -  .  ]` | `<notes>` |

---

## 4. Defect-Specific Inspections (#423 Grounding)

### 4.1 243f Wardrobe Departure & Yellow Backdrop Departures
- **Inspected**: `[ ] YES / [ ] NO`
- **Observations at ~10.1s**:
  - Did the subject's wardrobe spontaneously change color, style, or silhouette? `[ ] YES / [ ] NO`
  - Did the seamless yellow studio backdrop depart to an unintended setting? `[ ] YES / [ ] NO`
  - Did prompt constraint (`tight_01`) eliminate the wardrobe departure? `[ ] YES / [ ] NO`
  - Did checkpoint substitution (`fl2va`) affect the wardrobe departure? `[ ] YES / [ ] NO`

### 4.2 362f Environment & Lighting Collapse (~3.3s–6.7s Window)
- **Inspected**: `[ ] YES / [ ] NO`
- **Observations in Collapse Window**:
  - Behavior between ~3.3s and 6.7s: `[ ] Collapse to black / [ ] Partial dimming / [ ] Constant lighting`
  - Behavior at ~8.3s: `[ ] Full recovery / [ ] Delayed recovery / [ ] No recovery`
  - Did prompt constraint eliminate the blackout window? `[ ] YES / [ ] NO`
  - Did checkpoint substitution (`fl2va`) eliminate the blackout window? `[ ] YES / [ ] NO`

### 4.3 124f Camera Push Velocity
- **Inspected**: `[ ] YES / [ ] NO`
- **Observations at 124f**:
  - Was the forward camera push velocity smooth and gentle? `[ ] YES / [ ] NO`
  - Did prompt constraint reduce push aggression? `[ ] YES / [ ] NO`

### 4.4 Scene Substitution Gate
- **Scene Substitution Detected**: `[ ] YES / [ ] NO`
- *Rule Check: If YES, overallOutcome and overallAdUsability MUST be marked non-pass regardless of whether subject identity survived.*

---

## 5. Non-Authoritative Diagnostic Proxies (Informational Only)

> Automated proxies do not establish creative acceptance.

| Metric | Source Tool | Timestamp Interval | Measured Value | Threshold | Flagged? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Luminance Collapse** | `ffmpeg-luminance` | 3.3s–6.7s | `<delta-luma>` | `<thresh>` | `[ ] YES / [ ] NO` |
| **Scene Cut Metric** | `ffmpeg-scdet` | Full clip | `<cuts-detected>` | 0 | `[ ] YES / [ ] NO` |
| **Background Mask Drift**| `sam2-segmentation` | Full clip | `<iou-score>` | `<thresh>` | `[ ] YES / [ ] NO` |

---

## 6. Single-Variable Comparison Summaries

### Edge 1: Prompt Effect (Baseline vs Prompt-Only)
- **Controlled Invariant**: Same frame count, seed, geometry, checkpoint (`ref2va`), attention backend, schedule.
- **Single Variable**: `conditioning.positivePrompt` (`original` vs `tight_01`).
- **Observed Impact**: `<detailed-findings>`
- **Hypothesis Status**: `[ ] Supported / [ ] Refuted / [ ] Inconclusive`

### Edge 2: Checkpoint Effect (Baseline vs Checkpoint-Only)
- **Controlled Invariant**: Same frame count, seed, geometry, prompt (`original`), attention backend, schedule.
- **Single Variable**: `models.diffusion` (`ref2va` vs `fl2va`).
- **Observed Impact**: `<detailed-findings>`
- **Hypothesis Status**: `[ ] Supported / [ ] Refuted / [ ] Inconclusive`

---

## 7. Final Operator Decision & Sign-off

- [ ] **GO**: Controlled evidence demonstrates defect elimination without negative regressions across all 12 dimensions.
- [ ] **NO-GO**: Defects persist or unrequested scene substitutions/degradations occur.

**Operator Signature**: `_______________________________`  
**Date**: `YYYY-MM-DD`  
**Durable Sidecar Recorded**: `<run-dir>/continuity_review.json`
