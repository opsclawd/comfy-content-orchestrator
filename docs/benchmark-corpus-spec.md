# Visual Benchmark Corpus Specification & Evaluation Contract

Date: 2026-09-24  
Status: Authoritative Specification  
Parent: Epic #304 (Issue #305, ADR-0006)  
Consuming Issues: #310 (Model Bake-Off Harness), #311 (Model Integration), #314 (QA Evaluators)

---

## 1. Overview & Purpose

This document defines the fixed visual benchmark corpus, evaluation metrics, and evidence storage schema for evaluating still-image diffusion models in the candidate-generation pipeline.

In the Godzspeed platform, storyboard candidates must achieve high aesthetic quality, verifiable reference conditioning (actors, products, sets), and strict anatomical/structural integrity at production-native geometry (1344x768 landscape) before director review. This corpus provides the objective and comparative testing baseline to select the replacement for FLUX.1 [schnell] without relying on ad-hoc or unrepeatable manual testing.

---

## 2. Benchmark Corpus Matrix (16 Canonical Visual Scenarios)

The benchmark corpus consists of 16 fixed test cases designed to stress-test prompt adherence, multi-reference conditioning, topological sanity, and edge lighting conditions.

| Case ID | Category | Scenario / Focus | Primary Reference Roles | Key Stress Test |
| :--- | :--- | :--- | :--- | :--- |
| `CASE-01` | Portrait | Face close-up, dramatic side lighting | `subject_identity` | Micro-texture, iris detail, skin pores, facial identity retention |
| `CASE-02` | Portrait | Upper body, three-quarter angle | `subject_identity`, `style` | Head-neck-shoulder transition, hair strand dynamics, wardrobe |
| `CASE-03` | Full-Body | Full-body standing in neutral environment | `subject_identity` | Body proportions, foot-ground contact shadows, limb symmetry |
| `CASE-04` | Locomotion | Character walking towards camera | `subject_identity`, `location` | Dynamic gait, natural stride, perspective foreshortening |
| `CASE-05` | Posture | Character seated in armchair / cafe | `subject_identity`, `location` | Joint articulation (knees, hips), object interaction, clothing folds |
| `CASE-06` | Anatomy | Hands interacting with a delicate object | `subject_identity`, `product` | Finger count, knuckle articulation, grip physics, fingernail clarity |
| `CASE-07` | Multi-Subject | Two characters in dialogue | `subject_identity` (x2) | Identity isolation (no facial bleeding or feature mixing) |
| `CASE-08` | Crowd / Group | Three or more characters in shared space | `subject_identity`, `location` | Depth plane separation, distinct body topologies, background coherence |
| `CASE-09` | Angles | Profile, three-quarter, and rear view | `subject_identity` | Cranial structure, hairstyle consistency, ear anatomy from acute angles |
| `CASE-10` | Occlusion | Character partially occluded by foreground foliage / doorframe | `subject_identity`, `composition` | Boundary depth edges, no hallucinated phantom anatomy through obstructions |
| `CASE-11` | Lighting | Hard direct sun vs. soft diffuse window light | `style`, `location` | Sharp cast shadows, specular highlights, absence of blown-out skin |
| `CASE-12` | Low Light | Dimly lit nocturnal interior / twilight street | `style`, `location` | Shadow noise control, contrast retention, no waxy de-noising artifacts |
| `CASE-13` | Diversity | Representation across diverse skin tones and ages | `subject_identity` | Subsurface scattering fidelity, melanin rendering, age-appropriate lines |
| `CASE-14` | High Frequency | Loose flowing hair, knit sweaters, sheer fabric | `style` | Fine edge resolution, no artifact clumps or moiré patterns |
| `CASE-15` | Product | Commercial packaged goods / hero bottle on podium | `product`, `style` | Geometric straight edges, label legibility, material reflectivity |
| `CASE-16` | Environment | Architecture / landscape with zero humans | `location`, `composition` | Vanishing lines, structural geometry, texture tiling, no ghost figures |

---

## 3. Objective Evaluation Schema & Metric Fields

Evaluation is partitioned into two distinct tiers: **Binary Gate Checks** (pass/fail eligibility) and **Comparative Scoring** (qualitative rubric for model selection).

### 3.1 Binary Gate Checks (Eligibility Invariants)

A candidate must pass all four binary checks to be considered structurally sound. A single failure marks the candidate `ineligible`.

```json
{
  "eligibility": {
    "isEligible": true,
    "violations": []
  }
}
```

1. **`geometry_conformance` (PASS / FAIL)**
   - Generated dimensions must be exactly 1344x768 (or the certified target resolution).
   - Violation code: `GEOMETRY_MISMATCH`
2. **`provenance_integrity` (PASS / FAIL)**
   - All assigned `ReferenceAsset` identifiers and SHA-256 hashes must match staged inputs.
   - Violation code: `PROVENANCE_HASH_MISMATCH`
3. **`topological_sanity` (PASS / FAIL)**
   - Anatomy must be physically plausible:
     - Exact finger count (5 per hand) on visible hands.
     - Zero fused, phantom, or floating limbs.
     - Single face per human subject (no dual-jaw or eye-doubling).
   - Violation code: `TOPOLOGICAL_DEFECT`
4. **`reference_relevance` (PASS / FAIL)**
   - Conditioned subjects/products must be unambiguously recognizable as derived from the bound references.
   - Violation code: `REFERENCE_COLLAPSE`

### 3.2 Comparative Scoring (Model Bake-Off Rubric)

For model comparison in #310, each eligible candidate is scored on a standardized 1–5 scale across five axes:

1. **`subject_identity_retention` (1–5):**
   - 1: Identity completely lost; looks like an unrelated person.
   - 3: Recognizable likeness but noticeable facial feature drift or altered facial geometry.
   - 5: Indistinguishable likeness across diverse camera angles and lighting setups.
2. **`product_fidelity` (1–5):**
   - 1: Shape or branding deformed beyond recognition.
   - 3: Shape matches reference, but materials, reflections, or fine labels are distorted.
   - 5: Commercial-grade fidelity; crisp branding, accurate textures, correct industrial design.
3. **`photorealism_microtexture` (1–5):**
   - 1: Plastic skin, airbrushed textures, muddy hair, obvious generative AI sheen.
   - 3: Good overall realism, but fine details (pores, fabric weave) lack organic variation.
   - 5: Indistinguishable from 35mm optical capture; natural skin imperfections, crisp fabric.
4. **`lighting_and_depth_integration` (1–5):**
   - 1: Flat lighting or subjects appear pasted onto the background.
   - 3: Adequate lighting coherence, but contact shadows or specular bounces are weak.
   - 5: Physically plausible light transport, natural subsurface scattering, realistic occlusion.
5. **`prompt_and_composition_adherence` (1–5):**
   - 1: Ignores key prompt instructions, incorrect camera framing.
   - 3: Follows primary subject prompt, but misses background or secondary actions.
   - 5: Strict adherence to prompt staging, camera focal length, and spatial blocking.

---

## 4. Evidence Storage & Fixture Layout Conventions

All benchmark metadata, input fixtures, and evaluation results must adhere to a standardized filesystem structure:

```
fixtures/
└── benchmark-corpus/
    ├── corpus-manifest.json              # Canonical list of all 16 cases and prompts
    └── references/                       # Immutable reference images for benchmark cases
        ├── ref-actor-elena-headshot.png
        ├── ref-actor-elena-profile.png
        ├── ref-product-perfume-bottle.png
        └── ref-location-minimalist-cafe.png

.ai/benchmark-results/                    # Ephemeral evaluation outputs (ignored in git)
└── <model_identifier>/                  # e.g., flux-dev, sd35-large, qwen-omni
    ├── CASE-01/
    │   ├── output.png                    # Raw generated candidate image
    │   ├── generation-manifest.json      # Provenance (seed, prompt, model hashes, timing)
    │   └── evaluation.json               # Automated QA and human scoring report
    ...
    └── summary-report.json               # Aggregated scores across all 16 cases
```

### 4.1 Evaluation Evidence JSON Schema (`evaluation.json`)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "caseId": "CASE-01",
  "modelId": "flux-dev-lora-v1",
  "evaluatedAt": "2026-09-24T12:00:00.000Z",
  "evaluator": "human_curator" | "automated_qa",
  "candidate": {
    "dimensions": { "width": 1344, "height": 768 },
    "sha256": "abcdef...",
    "generationDurationMs": 4210
  },
  "eligibility": {
    "isEligible": true,
    "violations": []
  },
  "scores": {
    "subject_identity_retention": 4.8,
    "product_fidelity": null,
    "photorealism_microtexture": 4.7,
    "lighting_and_depth_integration": 4.5,
    "prompt_and_composition_adherence": 5.0
  },
  "notes": "Excellent iris micro-contrast and hair separation under harsh key light."
}
```

---

## 5. Non-Goals & Invariants

- **Hardware Benchmark Separation:** This specification evaluates visual quality and reference fidelity. Resource consumption (peak VRAM, RAM, inference latency) is governed separately by the RTX 4090 RenderProfile certification process (#312).
- **Prohibition on Synthetic Hardware Evidence:** Per `AGENTS.md`, files in `certification/`, `baseline/`, and `config/render-profiles/` represent physical hardware measurements and must never be synthesized by evaluation scripts.
