# MiniMax-H3 Controlled Long-Shot Continuity and Conditioning Experiments

## 1. Executive Summary & Purpose

This specification and experimental harness prepares a controlled study to isolate prompt, checkpoint, attention optimization, and sampling schedule effects on MiniMax-H3 video generation continuity across extended durations (**124f**, **192f**, **243f**, and **362f**).

Under parent issue **#421**, prerequisite audit **#441**, and preparation issue **#444**, this framework establishes:
1. Controlled, hash-pinned prompt/conditioning matrices for **I2V** (`frame_anchored`) and **Ref2V** (`reference_directed`).
2. Single-variable factorial test design strictly preventing confounding between prompt, checkpoint, attention, and step-schedule changes.
3. Offline cell preparation and comparison admission logic in `@cco/application` and `@cco/contracts`.
4. A deterministic storyboard plan with reproducible sample points (capturing critical defect observation windows at **3.3s**, **6.7s**, and **8.3s**) and side-by-side review manifests.
5. A manual, timestamped 12-dimension visual review rubric and evidence schema, explicitly enforcing defect inspections for the **243f** wardrobe departure and **362f** environmental blackout, while strictly rejecting scene substitutions even if identity survives.
6. A non-authoritative diagnostic proxy schema for metric collection without creative acceptance claims.

> [!IMPORTANT]
> **Execution Scope**: Autonomous planning, harness implementation, analysis logic, and offline tests only. Does **not** execute physical GPU rendering, create real footage, or authorize a qualitative pass. Physical hardware execution and human quality evaluation belong strictly to **#445**.

---

## 2. Background & Observed Defects (#423)

In the operator long-shot exploration reported in issue #423, multiple continuity failures were observed:
- **124f (~5.2s)**: Camera push was noticeably stronger and more abrupt than requested in the prompt.
- **243f (~10.1s)**: Subject wardrobe changed unexpectedly during playback and the seamless yellow studio backdrop temporarily departed to an unintended environment.
- **362f (~15.1s)**: Severe environmental collapse: between approximately **3.3s and 6.7s**, the entire background and lighting collapsed into near-total blackness, recovering only around **8.3s**. The operator issued a `no_go` verdict despite technical `ffprobe` format validity.
- **192f (~8.0s)**: Completely missing successful run.
- **Ref2V**: Absent from previous long-shot exploration.

### Grounding & Hypothesis Discipline
The root cause of these defects is **unknown**.
- A tighter, continuity-constrained prompt is an experimental **hypothesis**, not an established fact. Tighter prompts must never be assumed to fix an underlying model architecture or conditioning limitation.
- Checkpoint mismatch (e.g. legacy `ref2va` checkpoint under I2V vs task-matched `fl2va` checkpoint) is an experimental **hypothesis**.
- Neither "prompt looseness" nor "wrong checkpoint" may be asserted as the cause without controlled, measured physical evidence produced on real hardware.

---

## 3. Minimal Factorial Experimental Design

To ensure scientific isolation, the study employs a strict factorial design:

```
[Baseline Control] (Original prompt, ref2va checkpoint, default dense attention, 20 steps)
       │
       ├─► [Arm 1: Prompt-Only] (Continuity-constrained prompt, ALL other parameters locked)
       ├─► [Arm 2: Checkpoint-Only] (FL2VA checkpoint, ALL other parameters locked; I2V only)
       ├─► [Arm 3: Attention-Only] (Optimized attention, e.g. native-sol-attn, ALL other parameters locked)
       └─► [Arm 4: Reduced-Step-Only] (10 steps vs 20 steps, ALL other parameters locked)
             │
             ▼ (Prerequisite: Human evaluation results recorded for Arms 1-4)
       [Arm 5: Combined Multi-Factor] (E.g. Constrained prompt + 10 steps + FL2VA)
```

### Invariants & Non-Confounding Rules
1. **Single-Variable Factor Changes**: Arms 1 through 4 must differ from baseline by exactly one declared factor path (`conditioning.positivePrompt`, `models.diffusion`, `attention.configuration`, or `sampling.settings`).
2. **Never Conflate Prompt and Checkpoint**: Prompt variants and checkpoint variants must never be modified in the same run during initial evaluation.
3. **Safety Baseline vs Comparison Partner**:
   - For all runs exceeding 124 frames (192f, 243f, 362f), a safety link to the 124f baseline (`safetyBaseline124fCellId`) is recorded to enable hardware preflight and VRAM safety verification.
   - However, 124f runs are **strictly prohibited** from serving as evaluation comparison partners for longer duration runs. Every comparison edge must compare cells with identical frame counts (`frames === 124`, `frames === 192`, `frames === 243`, or `frames === 362`).
4. **Combined Variant Guard**: Combined multi-factor variants (`arm === "combined"`) cannot be prepared or executed until independent human reviews for each individual factor arm are evaluated and durably recorded.
5. **Static vs Moving Subject Matrix**: For the I2V study, two scenarios are planned: a moving subject scenario (`scenarioRole: "historical_baseline"`) representing the dynamic dance in #423, and a static subject counterpart (`scenarioRole: "motion_variant"`). Across the 4 candidate frame counts [124, 192, 243, 362] and 2 arms [baseline, prompt_only], this forms a 16-cell balanced matrix yielding 8 intra-scenario same-frame comparison edges.
6. **Resolved Assets vs Pending Operator Intent**: Physical reference media files are hash-pinned and size-verified on disk. Scenarios with historical prompts or seeds not committed to git remain marked as `pending_source` with `originalPrompt: null` until the operator retrieves them from previous execution logs under #445.

---

## 4. Route & Conditioning Specifications

### 4.1 Route Invariants

| Parameter | I2V (`i2v`) | Ref2V (`ref2v`) |
| :--- | :--- | :--- |
| **Conditioning Mode** | `frame_anchored` | `reference_directed` |
| **ComfyUI Node** | `MiniMaxH3ImageToVideo` | `MiniMaxH3ReferenceToVideo` |
| **Reference Roles** | Exactly 1 reference: `first_frame` (Slot 0) | 1 to 9 references: `subject_identity`, `product`, `location`, `style`, etc. |
| **First Frame Role** | Required | **Strictly Prohibited** (Cannot substitute start frame into Ref2V) |
| **Checkpoint Compatibility** | `ref2va` or `fl2va` | `ref2va` only (`fl2va` is strictly incompatible with Ref2V) |
| **Geometry** | 1344x768 @ 24 fps | 1344x768 @ 24 fps |
| **Base Workflow Profile** | `MINIMAX_H3_720P_5S_I2V_V1` | `MINIMAX_H3_720P_5S_REF2V_V1` |

### 4.2 Sourced Reference Assets
All assets are hash-pinned and size-verified from canonical test assets:
- **I2V Start Frame**: `test-assets/trinidad_subject_16x9.jpg` (SHA-256: `776145851c2bd2dba5a29fd0f45e222f5b09ee016b2371ed013582e1d41f6eb8`), center-cropped from 1024x819 to 1024x585 (16:9).
- **Ref2V Campaign References**:
  - Slot 0 (`subject_identity`, `<Picture 1>`): `test-assets/trinidad_subject.jpg` (SHA-256: `9a1e9bc51b93b80a6169c69bbcb6630788e2fb6dd2244ace4b6c2c9fd5bd2589`, 1024x819). Dark dreadlocks, dark skin.
  - Slot 1 (`product`, `<Picture 2>`): `test-assets/trinidad_product.jpg` (SHA-256: `f4dbb845aa086287da85b07d239b14dccf7b40aedb68367ec885c0913c1c79ab`, 1024x679). Angostura bitters bottles.
  - Slot 2 (`location`, `<Picture 3>`): `test-assets/trinidad_location.jpg` (SHA-256: `39a494e9cbf204f3b8d45a8f18c5e8e05f8f652fc6fe7e24746519ba2110b7ee`, 1024x576). Port of Spain waterfront architecture.
  - Slot 3 (`style`, `<Picture 4>`): `test-assets/trinidad_style.jpg` (SHA-256: `182b70c25d93acbe62ebf59489114587456104ab1bd8ac3051ce0cdd95f1da5d`, 1024x768). Steel-pan musical performance artistic style.

---

## 5. Storyboard & Side-by-Side Review Architecture

### 5.1 Observation Beats
For all cells, the storyboard generator pins deterministic sampling points across the duration, specifically sampling critical defect observation beats:
- `targetTimeSec: 0.0s`: First frame anchor adherence.
- `targetTimeSec: 3.3s`: Start of the #423 environmental collapse window (`362f_collapse_window`).
- `targetTimeSec: 6.7s`: Deepest phase of the blackout window (`362f_collapse_window`).
- `targetTimeSec: 8.3s`: Lighting and background recovery point (`362f_recovery`).
- `targetTimeSec: duration - 1 frame`: Final frame continuity.
- Regular 2.0s cadence samples across the clip duration.
- For shorter clips (124f = 5.17s, 192f = 8.0s), samples outside clip duration are marked with `inRange: false` so review tooling never prompts for out-of-range frames.

### 5.2 Side-by-Side Review Pairing
The review manifest organizes cells into direct same-frame pairs:
```json
{
  "pairId": "pair-cmp-scenario-i2v-yellow-backdrop-243f-prompt-tight_wardrobe_background",
  "frames": 243,
  "arm": "prompt_only",
  "baselinePanelId": "panel-cell-scenario-i2v-yellow-backdrop-243f-base",
  "candidatePanelId": "panel-cell-scenario-i2v-yellow-backdrop-243f-tight_wardrobe_background",
  "declaredFactorPaths": ["conditioning.positivePrompt"]
}
```

---

## 6. Manual Human Review Rubric (12 Dimensions)

Visual quality evaluation must be performed by human operators across 12 standardized dimensions:

| Dimension | Description | Acceptance Criteria |
| :--- | :--- | :--- |
| **`identity`** | Facial structure, hair (dreadlocks), skin tone, and persona consistency. | Subject identity remains identifiable and consistent throughout. |
| **`wardrobe`** | Clothing silhouette, color, texture, and continuity. | No spontaneous costume shifts or unrequested wardrobe mutations. |
| **`backgroundLightingPersistence`** | Stability of environment geometry, backdrop, and illumination. | Zero dropouts to black; backdrop color and architecture persist. |
| **`cameraFidelity`** | Adherence to requested camera movement (e.g. gentle forward push). | No unrequested fast pans, excessive velocity, or abrupt departures. |
| **`subjectAnatomy`** | Skeletal coherence, limb counts, and physical plausibility. | No missing/duplicated limbs or impossible joint rotations. |
| **`faceAndHands`** | Detail, morphing, and micro-movements of fingers and facial features. | No melting fingers, extra digits, or severe facial warping. |
| **`unnaturalCuts`** | Scene stability across time. | Single-take continuity; zero unrequested jump cuts or edits. |
| **`temporalFlicker`** | Frame-to-frame high-frequency luminance or color flutter. | Smooth temporal transition without strobe or high-frequency flicker. |
| **`referenceFidelity`** | Correspondence to provided reference assets (<Picture 1>-<Picture 4>). | Faithfully reflects cast, product, location, and style references. |
| **`motionCoherence`** | Subject action and physics realism. | Natural momentum, walking cadence, and interaction physics. |
| **`sound`** | Audio track fidelity, synchronization, and absence of artifacts. | Clean audio playback without digital distortion or dropouts. |
| **`overallAdUsability`** | Commercial utility for high-end advertising campaign. | Meets production commercial standards for client delivery. |

### Critical Failure Rules
1. **Scene Substitution Rejection**: If `sceneSubstitution.detected` is `true`, `overallOutcome` cannot be `"pass"` and `overallAdUsability` cannot be `"pass"`, even if the subject's identity survives.
2. **Review Coverage**: An overall `"pass"` requires `fullClipExamined: true` and `playbackExamined: true`.
3. **Mandatory Defect Inspections**:
   - `frames === 243`: Requires `wardrobe243fDepartureInspected: true`.
   - `frames === 362`: Requires `environment362fBlackoutInspected: true`.
   - `frames === 124`: Requires `camera124fPushInspected: true`.

---

## 7. Non-Authoritative Diagnostic Proxies

Automated metric extraction (e.g. scene cut detection, frame luminance delta, foreground mask IoU) may be computed by instrumentation tooling:
- **Informational Only**: Diagnostic proxies are strictly non-authoritative signals for exploratory triage.
- **Verdict Prohibition**: Diagnostic proxies must never claim creative acceptance or override human review findings.
- **Source Binding**: Any proxy report must record `sourceOutputSha256`, `metricName`, `frameIndices`, and exact timestamps.

---

## 8. CLI Usage Guide

The experiment harness provides CLI subcommands via `render-worker`:

### 8.1 Study Planning
Generate and validate a full study plan specification:
```bash
node apps/render-worker/dist/cli/experiment-minimax-h3.js plan-study \
  --study experiments/minimax-h3-continuity/i2v-yellow-backdrop-study.json \
  --output .ai-runs/planned-study.json
```

### 8.2 Cell Preparation
Prepare an executable v2 experiment descriptor for an individual study cell:
```bash
# Prepare a single targeted cell (--cell is strictly required; whole-study batch preparation is rejected)
node apps/render-worker/dist/cli/experiment-minimax-h3.js prepare-study \
  --study experiments/minimax-h3-continuity/ref2v-campaign-study.json \
  --cell cell-scenario-ref2v-campaign-waterfront-moving-124f-base \
  --target-host rtx4090 \
  --gpu-uuid GPU-bba55331-50e5-b152-4469-63d421d0a519 \
  --comfyui-dir /opt/ComfyUI \
  --python /opt/ComfyUI/.venv/bin/python3 \
  --output-root .ai-runs/minimax-h3-experiments
```

**Preparation Rules & Prerequisites**:
- **Anchored Selection**: Cell preparation requires `--cell <cellId>`. Batch or whole-study preparation is rejected to prevent accidental bulk execution.
- **Fail-Closed on Pending Evidence**: Shipped study specifications (`i2v-yellow-backdrop-study.json` and `ref2v-campaign-study.json`) are checked in with `status: "pending_source"` because historical prompt text, random seeds, or operator reference evidence remain pending under #445. Any scenario or cell with `status: "pending_source"` fails closed immediately with an informative error, rejecting descriptor generation until real evidence is populated and status updated to `"resolved"`.
- **Immutable Asset Pin Verification**: When preparing a resolved cell, all bound source assets (e.g. from `test-assets/`) are independently re-hashed on disk. Byte sizes, dimensions (width/height), MIME types, and SHA-256 digests must match the study manifest pins exactly before staging. Staged manifests preserve complete asset pin metadata (`sha256`, `sizeBytes`, `width`, `height`, `sourceAssetPath`).
- **Combined Arm Gate (`--prerequisite-reviews`)**: Multi-factor combined cells (`arm: "combined"`) cannot be prepared without completed and passing independent single-variable human evaluations for all prerequisite cells (baseline, prompt variant, and step reduction). Supply `--prerequisite-reviews <path/to/reviews.json>` pointing to the verified human review sidecars for all required prerequisite cells.

### 8.3 Review Planning & Storyboards
Generate aligned storyboard panels and review manifest, optionally binding observed runs:
```bash
# Generate storyboard plan and side-by-side review manifest
node apps/render-worker/dist/cli/experiment-minimax-h3.js review-plan \
  --study experiments/minimax-h3-continuity/ref2v-campaign-study.json \
  --runs .ai-runs/minimax-h3-experiments \
  --output .ai-runs/review-plan.json
```
When `--runs` is supplied, `review-plan` discovers executed run directories, verifies on-disk output hashes against probed facts, and populates observed runtime and attention parameters while marking corrupted or unreadable outputs as unavailable.

### 8.4 Sidecar Validation & Import
Validate human review sidecars against descriptor, output SHA, and defect rules:
```bash
# Validate review sidecar
node apps/render-worker/dist/cli/experiment-minimax-h3.js validate-sidecar \
  --file .ai-runs/review-sidecar.json \
  --run-dir .ai-runs/minimax-h3-experiments/study-run-001

# Import review into run directory (updates result.visualReview idempotently)
node apps/render-worker/dist/cli/experiment-minimax-h3.js import-sidecar \
  --run-dir .ai-runs/minimax-h3-experiments/study-run-001 \
  --sidecar .ai-runs/review-sidecar.json
```

---

## 9. Operator Handoff to Issue #445

When physical hardware becomes available under **#445**:
1. **Retrieve Missing Evidence**: Query historical run logs for the exact original prompt text and random seed used in the #423 operator study; update `i2v-yellow-backdrop-study.json` status to `"resolved"`.
2. **Execute Controlled Render Runs**: Run the prepared cells sequentially on the RTX 4090 render host, capturing complete telemetry, timing spans, and conformant output videos.
3. **Conduct Human Evaluation**: Complete visual reviews using the 12-dimension rubric and import the sidecars into each run directory.
4. **Complete Final Report**: Fill out the blank report template at `docs/minimax-h3-continuity-report-template.md` with verified physical measurements and operator sign-offs.
