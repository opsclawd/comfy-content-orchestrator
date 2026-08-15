# Task Context: Task 5

Title: Assemble deterministic certification provenance reports
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

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/collector.test.ts
- packages/infrastructure/src/comfyui/provenance/collector.ts

### Reference Files
- packages/contracts/src/render-profile.ts
- packages/infrastructure/src/comfyui/provenance/hasher.ts
- packages/infrastructure/src/comfyui/provenance/preflight.ts
- packages/infrastructure/src/comfyui/provenance/git-tracker.ts
- packages/infrastructure/src/comfyui/provenance/profile-manifest.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/collector.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/collector.ts","packages/infrastructure/src/comfyui/provenance/collector.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/collector.ts","packages/infrastructure/src/comfyui/provenance/collector.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **preflight precedes large reads**: Disk validation runs before workflow/model hashing and a failure stops all later calls. (Test: `collector runs preflight before hashing any large file`)
- **workflow drift fails before models**: A canonical hash mismatch aborts before any model file is hashed. (Test: `collector rejects workflow hash drift before model hashing`)
- **LTX contract mapping**: Stable model keys and the existing LTX identity, baseline, footprint, and reservation populate RenderProfile provenance fields. (Test: `collector emits stable model keys and LTX RenderProfile provenance fields`)
- **Git evidence preserved**: Tracked and non-Git custom-node results remain visible in the report. (Test: `collector preserves ComfyUI and non-Git custom-node evidence`)
- **FLUX does not impersonate LTX**: FLUX retains generic hashes but has null LTX-only RenderProfile provenance. (Test: `collector emits null RenderProfile provenance for FLUX without losing hashes`)
- **deterministic phase progress**: Phase start/completion events and per-model detail follow the declared sequential order. (Test: `collector reports progress in deterministic phase order`)

