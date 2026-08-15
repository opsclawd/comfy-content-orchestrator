# Task Context: Task 2

Title: Add LTX model footprint and disk reservation preflight
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

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/preflight.test.ts
- packages/infrastructure/src/comfyui/provenance/preflight.ts

### Reference Files
- packages/infrastructure/src/comfyui/provenance/hasher.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/preflight.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/preflight.ts","packages/infrastructure/src/comfyui/provenance/preflight.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/preflight.ts","packages/infrastructure/src/comfyui/provenance/preflight.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **live footprint aggregation**: The footprint equals the current sum of every explicitly listed regular model file. (Test: `preflight sums the live sizes of all manifest-listed model categories`)
- **reservation equality passes**: Exactly 100,000,000,000 available bytes satisfies the 100 GB reservation. (Test: `preflight passes when available space equals the 100 GB reservation`)
- **below reservation fails**: One byte below the required reservation throws with measured and required byte values. (Test: `preflight fails clearly one byte below the 100 GB reservation`)
- **available blocks are authoritative**: Free space is calculated from filesystem blocks available to the process. (Test: `preflight uses filesystem available blocks rather than total blocks`)
- **regular model files only**: A directory or other non-regular entry cannot contribute to model footprint. (Test: `preflight rejects a directory where a model file is required`)

