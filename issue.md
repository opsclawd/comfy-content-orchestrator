# S1-06: Add Gold Master FLUX/LTX workflow assets and deterministic hashing tooling

**Sprint:** 1 — Core Runtime, Domain Boundaries & Hardware Certification
**Story ID:** S1-06
**Depends on:** #1, #3, #5
**Spec source:** `docs/prd.md` §3.6.5, §8 Sprint 1, §9.1, §10

---

## Goal

Create the version-controlled Gold Master workflow assets and deterministic hashing/provenance tooling required to certify FLUX.1 [schnell] and the official LTX-2.5 720p workflow against exact model/workflow inputs.

The output of this issue is a reproducible set of API-format ComfyUI workflow templates plus tooling that reports the hashes needed by `RenderProfile` and later `GenerationManifest` records.

## Scope

### Workflow assets

Add certified API-format workflow templates under a stable repository path such as:

```text
templates/
  flux_schnell_draft_api.json
  ltx_25_720p_97f_api.json
```

Requirements:

- FLUX workflow corresponds to the validated 4-step FLUX.1 [schnell] draft path.
- LTX workflow is derived from the **official LTX-2.5 ComfyUI template** used for the measured benchmark.
- LTX baseline parameters are frozen for certification at:
  - 720p;
  - 97 frames;
  - approximately 5 seconds;
  - 8 DiT steps.
- Do not fabricate node IDs, model names, or workflow JSON from memory. Use an actual API-format export/template from the installed/current ComfyUI environment or an official upstream template.

### Hashing/provenance tooling

Add a deterministic command/tool that produces SHA-256 hashes for:

- workflow JSON after canonical serialization;
- diffusion/checkpoint files;
- text encoder files;
- VAE files;
- LoRA files;
- relevant model patches;
- ComfyUI git commit;
- installed custom-node git commits when available.

The tool must produce machine-readable output suitable for populating a `RenderProfile`/future manifest, plus human-readable output for certification logs.

### Canonicalization

Define how workflow JSON is canonicalized before hashing so formatting/key-order changes do not accidentally produce a new workflow identity when semantics are unchanged. If the chosen strategy intentionally hashes raw bytes instead, document that and require exact file immutability.

### Disk preflight

Add a preflight check for the LTX model family that:

- reports current disk footprint;
- verifies at least **100GB free-space reservation** is available for the LTX model/cache/update envelope before certification runs;
- does not download/duplicate models automatically unless explicitly requested.

## Known empirical baseline

The target workstation previously measured:

```text
diffusion_models  ~41 GB
text_encoders     ~15 GB
vae               ~4.5 GB
loras             ~8.3 GB
model_patches     ~3.7 MB
Total             ~68.8 GB
```

These are reference measurements, not values to hard-code as if they were current filesystem truth. The tooling must measure the live files.

## Out of scope

- Full hardware benchmark/certification execution (#7/#8).
- Changing LTX model quantization or workflow topology for optimization.
- Downloading unapproved alternative community workflows.
- Building a generic visual workflow editor.
- GenerationManifest persistence (Sprint 3).

## Automation execution notes

- This issue may run on a host where ComfyUI/models are present. Detect expected local paths via configuration/env rather than hard-coding one developer home directory.
- If the exact official workflow used for the existing benchmark cannot be located/exported, **do not invent a replacement and claim it is certified**. Add the hashing/preflight/tooling, clearly report the blocker in the PR, and leave the Gold Master acceptance item incomplete rather than falsifying provenance.
- Commit workflow JSON only if licensing/upstream terms permit redistribution. If redistribution is not allowed, commit a source descriptor + validated hash/import procedure instead and explain the constraint.

## Acceptance criteria

- [ ] A FLUX [schnell] API-format Gold Master workflow is present or reproducibly imported with a pinned hash.
- [ ] The official LTX-2.5 720p/97-frame/8-step workflow used for certification is present or reproducibly imported with a pinned hash.
- [ ] Workflow provenance/source is documented.
- [ ] SHA-256 tooling deterministically reports workflow/model/encoder/VAE/LoRA/patch identities.
- [ ] ComfyUI commit and custom-node commits can be captured for the runner environment.
- [ ] Machine-readable certification metadata can populate the `RenderProfile` contract from #3.
- [ ] LTX disk preflight measures current model-family footprint instead of assuming ~68.8GB.
- [ ] LTX disk preflight fails clearly when the configured free-space reservation is below 100GB.
- [ ] No benchmark measurement is changed by this issue; it only pins inputs/provenance.
- [ ] Tests cover workflow-hash determinism and model-file hash collection using fixtures/small files rather than real 69GB models in CI.

## Test plan

- Unit-test canonical workflow hashing with equivalent JSON formatting/key order.
- Unit-test file SHA-256 collection and missing-file errors.
- Unit-test disk-space threshold logic.
- On the Trinidad host, run the provenance command against the actual FLUX/LTX model directories and include the resulting metadata artifact in the PR/certification output.

## Definition of done

Merged with green CI; certification workflows have trustworthy provenance; exact workflow/model hashes can be generated reproducibly; hardware benchmark issues can execute against pinned inputs rather than ambiguous GUI state.
