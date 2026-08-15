# Gold Master Workflow and Provenance Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source-verifiable FLUX.1 [schnell] and LTX-2.5 API-format Gold Master workflows plus deterministic, low-memory tooling that reports workflow/model hashes, ComfyUI/custom-node Git revisions, and the LTX disk reservation evidence needed to populate a `RenderProfile`.

**Architecture:** Keep provenance code inside `packages/infrastructure/src/comfyui/provenance/`. A checked-in certification manifest identifies each workflow, its upstream/host-export source, exact model files, baseline node assertions, and pinned canonical workflow hash; the collector uses that manifest rather than guessing model filenames from arbitrary workflow strings. The CLI is a thin adapter around pure/testable hashing, preflight, Git, manifest, and collection modules, writing progress only to `stderr` and one JSON report to `stdout`.

**Tech Stack:** Node.js 24 ESM (`node:crypto`, streaming `node:fs`, `node:fs/promises.statfs`, `node:child_process.execFile`), TypeScript 5.7, Vitest 2, pnpm workspaces, Prettier, and ESLint.

---

**Planning assumptions**

- `issue-comments.md` exists but is empty, so it adds no requirements beyond `issue.md` and `design.md`.
- The implementation machine can obtain the two exact API-format exports used by the validated FLUX and LTX runs. This planning worktree does not contain those exports, so Task 7 is deliberately source-gated and forbids reconstructing node IDs, model names, or hashes from memory.
- The initial LTX profile remains `LTX_25_720P_5S_V1`; no `RenderProfileSchema` fields or signatures change in this issue. The report emits a `renderProfileProvenance` subset that later certification measurements can merge with the existing timing/memory fields.
- Disk quantities use decimal gigabytes (`1 GB = 1_000_000_000 bytes`) because the requirement is stated as a 100 GB operational reservation. The JSON report retains raw byte counts as the authoritative values.
- Model files are explicitly listed in the certification manifest and resolved below `<comfyui-dir>/models/<category>/...`. This avoids accidentally hashing unrelated model families while supporting `checkpoints`, `diffusion_models`, `text_encoders`, `vae`, `loras`, and `model_patches`.
- Hashing is intentionally sequential. Parallel reads would compete for disk bandwidth and make progress/error attribution harder on approximately 69 GB of inputs.

**Non-goals**

- Do not execute ComfyUI workflows, trigger hardware benchmarks, or alter the measured 46-second/24,028 MB baseline.
- Do not download, duplicate, optimize, quantize, or substitute model files or workflow topology.
- Do not add GenerationManifest persistence, database migrations, application/domain ports, retry policy, a web UI, or a generic workflow editor.
- Do not broaden the existing `RenderProfile` schema to carry Git metadata; Git provenance belongs in the certification report until a separate contract change is designed.
- Do not recursively hash arbitrary files under the whole ComfyUI tree or include volatile caches.

**Affected files (repository-relative full paths)**

- Create `packages/infrastructure/src/comfyui/provenance/hasher.ts` — canonical JSON, streamed file hashing, safe model-path resolution, and deterministic model hash collection.
- Create `packages/infrastructure/src/comfyui/provenance/hasher.test.ts` — canonicalization, streaming file hashes, path safety, ordering, and missing-file coverage.
- Create `packages/infrastructure/src/comfyui/provenance/preflight.ts` — model footprint measurement and 100 GB filesystem reservation enforcement.
- Create `packages/infrastructure/src/comfyui/provenance/preflight.test.ts` — footprint and free-space threshold tests using small temporary files and injected filesystem statistics.
- Create `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` — shell-free ComfyUI/custom-node revision collection.
- Create `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts` — temporary Git repository and non-Git custom-node coverage.
- Create `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts` — strict parsing and path resolution for checked-in certification profiles.
- Create `packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts` — valid/invalid manifest coverage.
- Create `packages/infrastructure/src/comfyui/provenance/collector.ts` — orchestration and machine-readable certification report construction.
- Create `packages/infrastructure/src/comfyui/provenance/collector.test.ts` — ordering, pinned-hash enforcement, report mapping, and fail-fast tests with injected dependencies.
- Create `packages/infrastructure/src/comfyui/provenance/cli.ts` — argument parsing, progress/error presentation, and JSON-only stdout entrypoint.
- Create `packages/infrastructure/src/comfyui/provenance/cli.test.ts` — CLI argument, stdout/stderr, exit-code, and help behavior.
- Modify `packages/infrastructure/package.json` — add the `provenance` script; no new dependency is required because `tsx` already exists in this package.
- Create `packages/infrastructure/src/comfyui/provenance/workflow-assets.test.ts` — verify checked-in workflows, pinned hashes, source metadata, and baseline node assertions.
- Create `templates/flux_schnell_draft_api.json` — exact validated 4-step FLUX.1 [schnell] API export.
- Create `templates/ltx_25_720p_97f_api.json` — exact official/validated LTX-2.5 720p, 97-frame, 8-step API export.
- Create `templates/provenance.json` — versioned profile descriptors, exact model paths, source revisions/licenses, baseline node assertions, and pinned canonical hashes.
- Create `templates/README.md` — provenance, redistribution basis, export/import procedure, and certification limitations.

**Cross-task behavioral invariants**

- Formatting and object-key order never change a workflow identity; array order and values do.
- No implementation path reads an entire model file into memory.
- Every model output key is derived from its exact category and repository-manifest relative path, and output ordering is stable.
- The LTX preflight fails at any available-space value below 100,000,000,000 bytes and passes at exactly that value.
- A report is never emitted when a workflow hash differs from the checked-in pinned hash, a required model is absent, the ComfyUI base revision cannot be resolved, or the disk reservation fails.
- Non-Git custom-node directories are reported explicitly without preventing certification; inability to resolve the ComfyUI base repository is fatal.
- Successful CLI stdout contains exactly one JSON document and no progress text; all human-readable progress and errors go to stderr.

## Task 1: Add deterministic workflow and streamed model hashing

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/hasher.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/hasher.ts`
- Reference only: `packages/contracts/src/render-profile.ts`

**Exported API shape:**

```ts
export type ModelCategory =
  | "checkpoints"
  | "diffusion_models"
  | "text_encoders"
  | "vae"
  | "loras"
  | "model_patches";

export interface ModelFileSpec {
  readonly category: ModelCategory;
  readonly relativePath: string;
}

export interface ModelFileHash extends ModelFileSpec {
  readonly key: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type ModelHashProgress = Readonly<{
  status: "started" | "completed";
  key: string;
}>;

export function canonicalizeWorkflow(jsonString: string): string;
export function hashWorkflow(jsonString: string): string;
export function resolveModelFilePath(comfyUiDir: string, spec: ModelFileSpec): string;
export async function hashFileStream(filePath: string): Promise<string>;
export async function hashModelFiles(
  comfyUiDir: string,
  specs: readonly ModelFileSpec[],
  onProgress?: (event: ModelHashProgress) => void
): Promise<readonly ModelFileHash[]>;
```

Use `JSON.parse`, a recursive object-key sorter, and compact `JSON.stringify` for canonicalization. Preserve array order. Implement `hashFileStream` with `createReadStream(...).pipe(createHash("sha256"))` or `for await` chunks; never use `readFile` in that function. Resolve model paths under `<comfyuiDir>/models/<category>` and reject empty, absolute, or `..`-escaping relative paths before any I/O. Produce lowercase SHA-256 hex, byte sizes from `stat`, keys in the form `models/<category>/<relativePath>`, and lexicographically sorted immutable results.

**Behavioral invariants and named tests:**

- `canonical workflow hashing ignores object key order and whitespace` — differently formatted nested objects with the same arrays/values produce the same canonical text and hash.
- `canonical workflow hashing preserves array semantics` — reversing a connection array produces a different hash.
- `streamed file hashing matches the known SHA-256 without reading the whole file` — a multi-chunk temporary file yields the known digest through the stream implementation.
- `model hashing returns stable keys and sorted results` — reversed input specs still return the same lexicographic order and progress events surround each file sequentially.
- `model hashing reports a missing required file with its manifest key` — missing files reject with the stable `models/<category>/<relativePath>` identity.
- `model path resolution rejects absolute and parent traversal paths` — unsafe manifest paths fail before filesystem access.
- `model hashing rejects a file that changes while it is read` — size or modification-time drift between the pre-hash and post-hash `stat` calls aborts collection rather than certifying mixed bytes.

- [ ] **Step 1: Write the failing tests.** Create temporary directories with `mkdtemp`, write only small fixture files, and assert the seven named cases above. Include nested workflow objects and an array-valued link so the tests distinguish object ordering from semantic array ordering. In the mutation case, change the fixture from the `started` callback after the initial `stat` so the race check is deterministic.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/hasher.test.ts`

Expected: FAIL because `hasher.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimal hashing module.** Use `Object.keys(value).sort()` recursively only for non-array JSON objects. `stat` each model immediately before and after streaming; reject when size or modification time changed. Convert stream errors and `stat` errors into messages that identify the logical model key but do not swallow the original `cause`. Freeze returned arrays/records to prevent accidental mutation during report assembly.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/hasher.test.ts`

Expected: PASS with all seven named behaviors.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/hasher.ts packages/infrastructure/src/comfyui/provenance/hasher.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/hasher.ts packages/infrastructure/src/comfyui/provenance/hasher.test.ts`

Expected: PASS with both files formatted.

- [ ] **Step 5: Commit the hashing unit.**

```bash
git add packages/infrastructure/src/comfyui/provenance/hasher.ts packages/infrastructure/src/comfyui/provenance/hasher.test.ts
git commit -m "feat(infrastructure): add deterministic provenance hashing"
```

## Task 2: Add LTX model footprint and disk reservation preflight

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/preflight.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/preflight.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/hasher.ts`

**Exported API shape:**

```ts
export const BYTES_PER_GB = 1_000_000_000;
export const LTX_MIN_FREE_DISK_GB = 100;

export interface DiskPreflightResult {
  readonly modelFootprintBytes: number;
  readonly availableBytes: number;
  readonly requiredFreeBytes: number;
  readonly modelFootprintGb: number;
  readonly availableGb: number;
  readonly minFreeDiskGb: number;
  readonly passes: boolean;
}

export class DiskPreflightError extends Error {
  readonly result: DiskPreflightResult;
}

export function evaluateFreeSpaceReservation(
  modelFootprintBytes: number,
  availableBytes: number,
  minFreeDiskGb: number
): DiskPreflightResult;

export async function measureModelFootprint(
  comfyUiDir: string,
  specs: readonly ModelFileSpec[]
): Promise<number>;

export async function runDiskPreflight(
  comfyUiDir: string,
  specs: readonly ModelFileSpec[],
  minFreeDiskGb?: number,
  dependencies?: Readonly<{ statfs: typeof statfs }>
): Promise<DiskPreflightResult>;
```

Measure only the manifest-listed model files, using `stat` and rejecting non-regular files. Query the filesystem containing `comfyUiDir` with `statfs`, calculate available bytes from `bavail * bsize`, and retain integer byte values. `runDiskPreflight` defaults to 100 GB, returns the result at or above the boundary, and throws `DiskPreflightError` containing the same result below it so the CLI can print measured and required values.

**Behavioral invariants and named tests:**

- `preflight sums the live sizes of all manifest-listed model categories` — small files across diffusion, encoder, VAE, LoRA, and patch paths sum exactly, with no hard-coded 68.8 GB assumption.
- `preflight passes when available space equals the 100 GB reservation` — equality is accepted.
- `preflight fails clearly one byte below the 100 GB reservation` — the typed error exposes footprint, available bytes, and required bytes.
- `preflight uses filesystem available blocks rather than total blocks` — the calculation uses `bavail`, not `blocks` or `bfree`.
- `preflight rejects a directory where a model file is required` — only regular files contribute to footprint.

- [ ] **Step 1: Write the failing preflight tests.** Inject a fake `statfs` result so CI never depends on host disk capacity; use temporary model files to verify live size aggregation and the exact threshold boundary.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/preflight.test.ts`

Expected: FAIL because `preflight.ts` does not exist.

- [ ] **Step 3: Implement preflight and its typed failure.** Validate all numeric inputs as finite, non-negative safe integers where appropriate. Do not round before comparing bytes; derive display gigabytes only after the pass/fail decision.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/preflight.test.ts`

Expected: PASS with all five named behaviors.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/preflight.ts packages/infrastructure/src/comfyui/provenance/preflight.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/preflight.ts packages/infrastructure/src/comfyui/provenance/preflight.test.ts`

Expected: PASS with both files formatted.

- [ ] **Step 5: Commit the preflight unit.**

```bash
git add packages/infrastructure/src/comfyui/provenance/preflight.ts packages/infrastructure/src/comfyui/provenance/preflight.test.ts
git commit -m "feat(infrastructure): enforce provenance disk preflight"
```

## Task 3: Capture ComfyUI and custom-node Git provenance

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/git-tracker.ts`

**Exported API shape:**

```ts
export interface CustomNodeGitRevision {
  readonly name: string;
  readonly commit: string | null;
  readonly status: "tracked" | "not_git" | "unavailable";
}

export interface GitProvenance {
  readonly comfyUiCommit: string;
  readonly customNodes: readonly CustomNodeGitRevision[];
}

export async function readGitCommit(repositoryDir: string): Promise<string>;
export async function collectGitProvenance(comfyUiDir: string): Promise<GitProvenance>;
```

Run Git with promisified `execFile("git", ["-C", repositoryDir, "rev-parse", "--verify", "HEAD"])`; never construct a shell command. Accept lowercase 40- or 64-character hexadecimal object IDs and normalize trimmed output to lowercase. The ComfyUI base repository is mandatory. Enumerate immediate directories in `custom_nodes`, sort by directory name, report repositories as `tracked`, and report non-Git/unreadable entries explicitly instead of silently omitting them. A missing `custom_nodes` directory yields an empty array.

**Behavioral invariants and named tests:**

- `git provenance captures the exact ComfyUI HEAD` — a temporary repository commit is returned unchanged.
- `git provenance sorts custom nodes and marks non-Git directories` — input directory enumeration order cannot change report order, and a plain directory is `not_git` with `commit: null`.
- `git provenance tolerates a missing custom_nodes directory` — the valid base commit is returned with an empty list.
- `git provenance fails when the ComfyUI base is not a Git repository` — certification cannot proceed without the runtime revision.
- `git commit lookup treats metacharacters in paths as data` — a repository path containing spaces/shell punctuation succeeds through `execFile` arguments.

- [ ] **Step 1: Write the failing Git tests.** Initialize temporary repositories with local per-command author configuration, create one commit in each tracked fixture, and keep all fixtures below the OS temp directory.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`

Expected: FAIL because `git-tracker.ts` does not exist.

- [ ] **Step 3: Implement strict base and tolerant custom-node collection.** Classify Git's “not a repository” result as `not_git`; reserve `unavailable` for other custom-node lookup failures. Include a stable, actionable base-repository error without dumping arbitrary command output.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`

Expected: PASS with all five named behaviors.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/git-tracker.ts packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/git-tracker.ts packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`

Expected: PASS with both files formatted.

- [ ] **Step 5: Commit the Git provenance unit.**

```bash
git add packages/infrastructure/src/comfyui/provenance/git-tracker.ts packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
git commit -m "feat(infrastructure): capture ComfyUI git provenance"
```

## Task 4: Parse and validate certification profile manifests

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/hasher.ts`

**Manifest and exported API shape:**

```ts
export interface WorkflowNodeAssertion {
  readonly nodeId: string;
  readonly classType: string;
  readonly input: string;
  readonly equals: string | number | boolean;
}

export interface CertificationProfile {
  readonly id: string;
  readonly engine: string;
  readonly workflowPath: string;
  readonly workflowRelativePath: string;
  readonly expectedWorkflowHash: string;
  readonly source: Readonly<{
    kind: "official_upstream" | "validated_host_export";
    uri: string;
    revision: string;
    license: string;
  }>;
  readonly baseline: Readonly<{
    width?: number;
    height?: number;
    frames?: number;
    steps: number;
    approximateDurationSeconds?: number;
  }>;
  readonly minFreeDiskGb: number;
  readonly runnerProfile: string;
  readonly models: readonly ModelFileSpec[];
  readonly assertions: readonly WorkflowNodeAssertion[];
  readonly renderProfileIdentity: Readonly<{
    key: "LTX_25_720P_5S_V1";
    version: 1;
  }> | null;
}

export async function loadCertificationProfile(
  manifestPath: string,
  profileId: string
): Promise<CertificationProfile>;
```

The on-disk `templates/provenance.json` has `{ "version": 1, "profiles": [...] }`. Parse unknown JSON with explicit runtime guards rather than unchecked casts. Require non-empty source URI/revision/license, lowercase SHA-256, unique profile IDs, at least one model, unique `category/relativePath` identities, positive baseline values, non-negative free disk GB, and at least one exact node assertion. Resolve `workflowPath` relative to the manifest directory and reject paths escaping that directory. For `renderProfileIdentity`, accept only the existing LTX literal or `null`; do not modify the contracts package.

**Behavioral invariants and named tests:**

- `manifest loading returns the selected profile with a contained workflow path` — a valid fixture resolves relative to its own manifest directory.
- `manifest loading rejects duplicate profile and model identities` — ambiguous report keys are impossible.
- `manifest loading rejects malformed hashes and incomplete source provenance` — no unpinned or unattributed profile can run.
- `manifest loading rejects workflow paths outside the manifest directory` — `..` and absolute escapes fail before collection.
- `manifest loading rejects unknown model categories and invalid LTX identity literals` — descriptors cannot silently widen the supported surface.
- `manifest loading reports an unknown profile id with available ids` — operator selection failures are actionable.

- [ ] **Step 1: Write the failing manifest tests.** Build JSON fixtures in temporary directories and assert the exact six behaviors, including a valid `validated_host_export` source and a null FLUX render-profile identity.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts`

Expected: FAIL because `profile-manifest.ts` does not exist.

- [ ] **Step 3: Implement runtime parsing and containment checks.** Return deeply frozen arrays/objects. Keep validation messages keyed to the profile and property path so malformed operator metadata is easy to correct.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts`

Expected: PASS with all six named behaviors.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/profile-manifest.ts packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/profile-manifest.ts packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts`

Expected: PASS with both files formatted.

- [ ] **Step 5: Commit the manifest parser.**

```bash
git add packages/infrastructure/src/comfyui/provenance/profile-manifest.ts packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts
git commit -m "feat(infrastructure): validate certification profiles"
```

## Task 5: Assemble deterministic certification provenance reports

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/collector.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/collector.ts`
- Reference only: `packages/contracts/src/render-profile.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/hasher.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/preflight.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/git-tracker.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`

**Exported API shape:**

```ts
export type RenderProfileProvenance = Pick<
  RenderProfile,
  | "key"
  | "version"
  | "engine"
  | "workflowHash"
  | "modelHashes"
  | "frames"
  | "steps"
  | "runnerProfile"
  | "measuredDiskFootprintGb"
  | "minFreeDiskGb"
>;

export type ProvenanceProgress = Readonly<{
  phase: "preflight" | "git" | "workflow_hash" | "model_hash";
  status: "started" | "completed";
  detail?: string;
}>;

export interface CertificationProvenanceReport {
  readonly version: 1;
  readonly profileId: string;
  readonly generatedAt: string;
  readonly workflow: Readonly<{
    relativePath: string;
    sha256: string;
    source: CertificationProfile["source"];
  }>;
  readonly models: readonly ModelFileHash[];
  readonly git: GitProvenance;
  readonly disk: DiskPreflightResult;
  readonly renderProfileProvenance: RenderProfileProvenance | null;
}

export interface ProvenanceCollectorDependencies {
  readonly runDiskPreflight?: typeof runDiskPreflight;
  readonly collectGitProvenance?: typeof collectGitProvenance;
  readonly readWorkflowFile?: (filePath: string) => Promise<string>;
  readonly hashWorkflow?: typeof hashWorkflow;
  readonly hashModelFiles?: typeof hashModelFiles;
}

export async function collectCertificationProvenance(
  input: Readonly<{
    comfyUiDir: string;
    profile: CertificationProfile;
    now?: () => Date;
    onProgress?: (event: ProvenanceProgress) => void;
  }>,
  dependencies?: ProvenanceCollectorDependencies
): Promise<CertificationProvenanceReport>;
```

Run the preflight first, then Git provenance, then canonical workflow hashing, then sequential model hashing. Compare the actual workflow hash to `expectedWorkflowHash` before reading model contents. Map model hashes to `RenderProfile.modelHashes` using each stable `models/<category>/<relativePath>` key. For the LTX identity, populate the exact existing contract fields shown above; require baseline `frames: 97`, `steps: 8`, runner `dynamicvram-offload-v1`, and the measured live footprint. For FLUX, return `renderProfileProvenance: null` while retaining its full workflow/model provenance in the generic report. Inject dependencies in tests only; production defaults call the real modules.

**Behavioral invariants and named tests:**

- `collector runs preflight before hashing any large file` — the event/dependency call order starts with disk validation and stops immediately if it fails.
- `collector rejects workflow hash drift before model hashing` — an altered workflow never produces a report and does not invoke the model hasher.
- `collector emits stable model keys and LTX RenderProfile provenance fields` — the report contains the exact pinned hash, measured footprint, 97 frames, 8 steps, 100 GB minimum, and existing profile identity.
- `collector preserves ComfyUI and non-Git custom-node evidence` — Git statuses are copied without filtering.
- `collector emits null RenderProfile provenance for FLUX without losing hashes` — the current LTX-only contract is not falsified or widened.
- `collector reports progress in deterministic phase order` — start/completion pairs are ordered and a model detail identifies each file.

- [ ] **Step 1: Write the failing collector tests.** Use injected fakes for preflight, Git, workflow read/hash, and model hashing. Assert exact call order and report equality; do not create 69 GB fixtures.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/collector.test.ts`

Expected: FAIL because `collector.ts` does not exist.

- [ ] **Step 3: Implement report assembly and fail-fast gates.** Normalize `generatedAt` with `toISOString()`, preserve byte counts, and freeze the completed report. Do not catch and downgrade preflight, pinned-hash, missing-model, or base-Git failures.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/collector.test.ts`

Expected: PASS with all six named behaviors.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/collector.ts packages/infrastructure/src/comfyui/provenance/collector.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/collector.ts packages/infrastructure/src/comfyui/provenance/collector.test.ts`

Expected: PASS with both files formatted.

- [ ] **Step 5: Commit the collector.**

```bash
git add packages/infrastructure/src/comfyui/provenance/collector.ts packages/infrastructure/src/comfyui/provenance/collector.test.ts
git commit -m "feat(infrastructure): collect certification provenance"
```

## Task 6: Add the provenance CLI and package command

**Files:**

- Create: `packages/infrastructure/src/comfyui/provenance/cli.test.ts`
- Create: `packages/infrastructure/src/comfyui/provenance/cli.ts`
- Modify: `packages/infrastructure/package.json` (`scripts` only)
- Reference only: `packages/infrastructure/src/comfyui/provenance/profile-manifest.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`

**CLI contract:**

```text
pnpm --filter @cco/infrastructure provenance -- \
  --comfyui-dir "$COMFYUI_DIR" \
  --profile ltx-25-720p-97f \
  --manifest ../../templates/provenance.json
```

`--comfyui-dir` and `--profile` are required. `--manifest` is optional and defaults, via an `import.meta.url`-relative URL, to the repository's `templates/provenance.json`; the explicit form above documents execution from the infrastructure package script's working directory. `--help` prints usage to stdout and performs no filesystem/Git work. Unknown, duplicate, or value-less flags are errors.

**Exported API shape:**

```ts
export interface ProvenanceCliOptions {
  readonly comfyUiDir: string;
  readonly profileId: string;
  readonly manifestPath: string;
}

export interface ProvenanceCliDependencies {
  readonly loadCertificationProfile?: typeof loadCertificationProfile;
  readonly collectCertificationProvenance?: typeof collectCertificationProvenance;
}

export function parseCliArgs(argv: readonly string[]):
  | Readonly<{ kind: "help" }>
  | Readonly<{ kind: "run"; options: ProvenanceCliOptions }>;

export async function runCli(
  argv: readonly string[],
  io?: Readonly<{ stdout: (line: string) => void; stderr: (line: string) => void }>,
  dependencies?: ProvenanceCliDependencies
): Promise<number>;
```

The module entrypoint assigns the returned status to `process.exitCode`; it must not call `process.exit`. Progress callbacks become concise stderr lines. On success, call stdout once with `JSON.stringify(report)` and return 0. On any validation or collection failure, write one actionable stderr error, emit no stdout report, and return 1. Add `"provenance": "tsx src/comfyui/provenance/cli.ts"` under infrastructure scripts.

**Behavioral invariants and named tests:**

- `CLI requires comfyui-dir and profile and rejects unknown flags` — invalid invocation returns 1 without loading a manifest.
- `CLI help has no provenance side effects` — usage is printed and injected loaders/collectors are untouched.
- `CLI writes progress only to stderr and one JSON report to stdout` — successful machine output remains pipe-safe.
- `CLI returns failure without partial JSON when preflight or collection fails` — stderr includes the stable error message and stdout remains empty.
- `CLI forwards the selected profile and configured ComfyUI path` — no developer home path is hard-coded.
- `infrastructure provenance script exposes the TypeScript entrypoint` — package metadata points to the exact source file.

- [ ] **Step 1: Write the failing CLI tests.** Inject manifest/collector functions and stdout/stderr sinks. Include one successful report and one `DiskPreflightError` case.
- [ ] **Step 2: Verify the focused test fails.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/cli.test.ts`

Expected: FAIL because the CLI and package script do not exist.

- [ ] **Step 3: Implement parsing, output routing, entrypoint detection, and the package script.** Detect direct ESM execution with `process.argv[1]` plus `pathToFileURL`; importing the module from tests must not run it.
- [ ] **Step 4: Verify task acceptance.**

Run: `pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/cli.test.ts`

Expected: PASS with all six named behaviors.

Run: `pnpm --filter @cco/infrastructure provenance -- --help`

Expected: PASS, displaying the three supported flags without touching ComfyUI.

Run: `pnpm exec eslint packages/infrastructure/src/comfyui/provenance/cli.ts packages/infrastructure/src/comfyui/provenance/cli.test.ts`

Expected: PASS with no lint errors.

Run: `pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/cli.ts packages/infrastructure/src/comfyui/provenance/cli.test.ts packages/infrastructure/package.json`

Expected: PASS with all three files formatted.

- [ ] **Step 5: Commit the CLI.**

```bash
git add packages/infrastructure/src/comfyui/provenance/cli.ts packages/infrastructure/src/comfyui/provenance/cli.test.ts packages/infrastructure/package.json
git commit -m "feat(infrastructure): add provenance certification CLI"
```

## Task 7: Add source-gated Gold Master workflows and provenance records

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
