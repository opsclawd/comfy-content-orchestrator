# Task Context: Task 7

Title: Add source-gated Gold Master workflows and provenance records
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-6
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-6
Start Commit: 6bab63e0967fb48d900dbf1fc191acb5bca5e477

## Task Requirements

**Files:**

- Create: `templates/flux_schnell_draft_api.json`
- Create: `templates/ltx_25_720p_97f_api.json`
- Create: `templates/provenance.json`
- Create: `templates/README.md`
- Create: `packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/hasher.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`

This task starts with a provenance gate, not authoring. Obtain the exact API export from the installed/current ComfyUI environment used for the validated FLUX run and the official LTX-2.5 benchmark. Confirm redistribution terms before copying JSON. Preserve the exports' node IDs, class types, model filenames, link arrays, and values exactly; canonicalization removes only insignificant object-key/whitespace differences for identity.

Populate `templates/provenance.json` with exactly two IDs, `flux-schnell-draft` and `ltx-25-720p-97f`. Record the source kind, stable URI, upstream or host-export revision, license basis, relative workflow filename, canonical hash, runner profile, exact model file specs, and exact API node assertions discovered from the real export. The LTX baseline must describe 1280x720 (or the validated portrait orientation with the dimensions swapped), 97 frames, approximately 5 seconds, 8 steps, `minFreeDiskGb: 100`, `runnerProfile: "dynamicvram-offload-v1"`, and `renderProfileIdentity: { "key": "LTX_25_720P_5S_V1", "version": 1 }`. The FLUX baseline must assert exactly 4 sampling steps and use `renderProfileIdentity: null`.

`templates/README.md` must state:

- the exact source/export procedure and source revision for each workflow;
- whether the files are redistributed official templates or API exports from the validated host;
- the license/redistribution basis;
- the canonical SHA-256 values and why raw formatting changes do not alter them;
- the exact relative ComfyUI model paths represented by the manifest;
- that the LTX empirical performance values are unchanged and this issue certifies inputs only;
- how to run both profile commands and redirect stdout to a certification artifact while retaining stderr logs.

**Behavioral invariants and named tests:**

- `Gold Master workflows are API-format object maps with pinned canonical hashes` — neither file is a GUI-format top-level `nodes` array, and each actual hash equals its manifest hash.
- `FLUX Gold Master pins the validated four-step sampler node` — the recorded node ID/class/input assertion resolves to 4.
- `LTX Gold Master pins 720p 97-frame eight-step baseline nodes` — recorded exact node assertions resolve to the validated dimensions, 97 frames, and 8 steps.
- `Gold Master profiles identify every referenced certification model file` — model specs are non-empty, unique, and use only supported categories.
- `Gold Master provenance contains immutable source and license evidence` — source URI, revision, license, and README explanation are non-empty and contain no placeholder values.
- `LTX Gold Master enforces the 100 GB DynamicVRAM profile` — manifest identity, minimum disk, and runner profile match the existing contract/PRD.

- [ ] **Step 1: Pass the source and license gate.** Inspect the real exports and licensing terms. If either exact workflow cannot be obtained, if its connection to the measured run cannot be demonstrated, or if redistribution is not allowed, stop under the conditions below; do not create guessed JSON or claim the acceptance item is complete.
- [ ] **Step 2: Write the failing asset verification test.** Using the node IDs and inputs learned from the verified exports in Step 1, load both intended assets through `loadCertificationProfile`, recompute hashes with `hashWorkflow`, resolve every declared assertion against `workflow[nodeId].class_type` and `workflow[nodeId].inputs[input]`, and assert the six named cases. Keep this new test focused; it does not execute ComfyUI.
- [ ] **Step 3: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`

Expected: FAIL because the workflow assets and certification manifest have not been added.

- [ ] **Step 4: Add the exact API exports and provenance documentation.** Copy only the verified API-format objects, then record real node IDs/model filenames/source revisions and canonical hashes in the manifest and README. Do not use example hashes, invented filenames, or a community workflow as an official LTX substitute.
- [ ] **Step 5: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`

Expected: PASS with both exact workflow hashes and all frozen baseline assertions.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check templates/flux_schnell_draft_api.json templates/ltx_25_720p_97f_api.json templates/provenance.json packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts`

Expected: PASS for the JSON and test files. `templates/README.md` is intentionally excluded by the repository's Markdown formatting policy.

- [ ] **Step 6: Exercise each real profile on the certification host.** These commands are operator acceptance checks and must run only where the configured ComfyUI/model files exist:

```bash
pnpm --filter @cco/infrastructure provenance -- --comfyui-dir "$COMFYUI_DIR" --profile flux-schnell-draft --manifest ../../templates/provenance.json > flux-provenance.json
pnpm --filter @cco/infrastructure provenance -- --comfyui-dir "$COMFYUI_DIR" --profile ltx-25-720p-97f --manifest ../../templates/provenance.json > ltx-provenance.json
```

Expected: each command exits 0; stderr shows progress; each redirected file contains one JSON report. The LTX report shows at least 100 GB available and a live model footprint rather than the reference 68.8 GB constant. The generated reports are certification outputs, not files committed by this task.

- [ ] **Step 7: Commit the certified assets and their proof.**

```bash
git add templates/flux_schnell_draft_api.json templates/ltx_25_720p_97f_api.json templates/provenance.json templates/README.md packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts
git commit -m "feat: pin Gold Master ComfyUI workflows"
```

**Tests added or updated**

- Six focused new Vitest files cover hashing, preflight, Git tracking, manifest parsing, report collection, and CLI behavior.
- One asset-level Vitest file proves the checked-in API exports match their pinned hashes and exact baseline node assertions.
- All filesystem tests use temporary small files; no real model weights are read in normal CI.
- No existing oversized test file is modified. In particular, the 768-line render adapter test and 520-line database test remain untouched, so no test-update splitting is needed.

**Risk areas**

- The two real workflow exports and their redistribution terms are not present in this planning worktree. Provenance is more important than nominal asset completion; Task 7 must remain incomplete rather than introduce a plausible-looking substitute.
- Canonical JSON deliberately ignores object-key order but not array order. A broader canonicalization algorithm would risk treating graph connection changes as equivalent.
- Files can change between `stat` and streaming hash. The report records the size observed during collection; the implementation should stat again after hashing and fail if size or modification time changed, preventing a mixed identity from being certified.
- Large-file hashing is I/O-bound. Sequential streaming and per-file stderr progress avoid OOM and reduce perceived hangs, but the host run may still take substantial time.
- `statfs` units and free-block fields are easy to misuse. Tests pin `bavail * bsize` and the exact decimal-GB boundary.
- Custom-node installations are not always Git repositories. Explicit `not_git`/`unavailable` statuses preserve evidence without inventing commits.
- ComfyUI can support Git SHA-1 today and SHA-256 repositories in the future; accepting 40 or 64 lowercase hex prevents an unnecessary format lock-in.
- Absolute host paths must not appear in stable hash keys or committed descriptors. Only CLI input and internal resolved paths may be absolute at runtime.

**Stop conditions**

- Abort Task 7 if either exact API-format export cannot be tied to the validated run or official upstream source. Do not reconstruct it from screenshots, prose, memory, or unrelated community examples.
- Abort Task 7 if the license/terms do not permit committing the workflow JSON. Revise the task boundary and manifest to a source descriptor plus verified import procedure in a new plan; do not silently substitute that scope because the expected files and acceptance proof would change.
- Abort certification if the actual canonical hash differs from `templates/provenance.json`, even when the JSON looks visually similar.
- Abort certification if a required model file is absent, not a regular file, changes while being hashed, or escapes the configured ComfyUI model root.
- Abort certification if the ComfyUI base commit cannot be resolved or the LTX filesystem has less than 100,000,000,000 bytes available.
- Abort implementation and re-plan if satisfying the issue requires changing the exported `RenderProfile` contract, adding an application/domain port, downloading models, or introducing benchmark execution; each is outside this plan and may affect additional adapters or architecture boundaries.

**Plan-level validation summary**

Each task includes file-scoped Vitest, ESLint, and Prettier acceptance commands; the implementation orchestrator's workspace-wide typecheck remains its automatic post-step gate. There is intentionally no standalone validation task. Task 7 additionally contains the only host-dependent checks, scoped to the two named certification profiles and explicitly excluded from normal CI.

## Repository Targets

### Expected Files
- templates/flux_schnell_draft_api.json
- templates/ltx_25_720p_97f_api.json
- templates/provenance.json
- templates/README.md
- packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts

### Reference Files
- packages/infrastructure/src/comfyui/provenance/hasher.ts
- packages/infrastructure/src/comfyui/provenance/profile-manifest.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts"]
["pnpm","exec","prettier","--check","templates/flux_schnell_draft_api.json","templates/ltx_25_720p_97f_api.json","templates/provenance.json","packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **API-format pinned assets**: Both workflows are API object maps and recompute to their manifest canonical hashes. (Test: `Gold Master workflows are API-format object maps with pinned canonical hashes`)
- **FLUX four-step baseline**: The exact validated FLUX sampler assertion resolves to four steps. (Test: `FLUX Gold Master pins the validated four-step sampler node`)
- **LTX frozen baseline**: Exact LTX API node assertions resolve to 720p, 97 frames, and eight steps. (Test: `LTX Gold Master pins 720p 97-frame eight-step baseline nodes`)
- **complete model identities**: Each certification model has a unique supported category and exact relative path. (Test: `Gold Master profiles identify every referenced certification model file`)
- **immutable source evidence**: Every profile records a real source URI, revision, license basis, and matching documentation without placeholders. (Test: `Gold Master provenance contains immutable source and license evidence`)
- **LTX operating envelope**: The LTX profile retains its 100 GB minimum, DynamicVRAM runner, and existing RenderProfile identity. (Test: `LTX Gold Master enforces the 100 GB DynamicVRAM profile`)

