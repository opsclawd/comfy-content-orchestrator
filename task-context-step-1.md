# Task Context: Task 1

Title: Add deterministic workflow and streamed model hashing
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

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/hasher.test.ts
- packages/infrastructure/src/comfyui/provenance/hasher.ts

### Reference Files
- packages/contracts/src/render-profile.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/hasher.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/hasher.ts","packages/infrastructure/src/comfyui/provenance/hasher.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/hasher.ts","packages/infrastructure/src/comfyui/provenance/hasher.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **canonical object equivalence**: Whitespace and object-key ordering do not affect canonical workflow identity. (Test: `canonical workflow hashing ignores object key order and whitespace`)
- **array semantics preserved**: Changing array order changes workflow identity. (Test: `canonical workflow hashing preserves array semantics`)
- **streaming file hash**: File hashes are calculated from stream chunks and equal the known SHA-256 digest. (Test: `streamed file hashing matches the known SHA-256 without reading the whole file`)
- **stable model hash ordering**: Reordered input specs produce identical sorted model results and sequential start/completion events. (Test: `model hashing returns stable keys and sorted results`)
- **missing model failure**: A missing required model rejects with its stable manifest-derived identity. (Test: `model hashing reports a missing required file with its manifest key`)
- **model root containment**: Absolute and parent-traversal model paths are rejected before filesystem access. (Test: `model path resolution rejects absolute and parent traversal paths`)
- **model mutation detection**: Size or modification-time drift during a streamed hash aborts collection instead of certifying mixed bytes. (Test: `model hashing rejects a file that changes while it is read`)

