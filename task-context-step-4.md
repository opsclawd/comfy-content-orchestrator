# Task Context: Task 4

Title: Parse and validate certification profile manifests
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

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts
- packages/infrastructure/src/comfyui/provenance/profile-manifest.ts

### Reference Files
- packages/infrastructure/src/comfyui/provenance/hasher.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/profile-manifest.ts","packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/profile-manifest.ts","packages/infrastructure/src/comfyui/provenance/profile-manifest.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **contained workflow resolution**: A selected workflow path resolves within its certification manifest directory. (Test: `manifest loading returns the selected profile with a contained workflow path`)
- **unique identities**: Profile IDs and category-relative model identities cannot be duplicated. (Test: `manifest loading rejects duplicate profile and model identities`)
- **pinned attributed profile**: Malformed hashes or missing source URI, revision, or license prevent profile loading. (Test: `manifest loading rejects malformed hashes and incomplete source provenance`)
- **manifest path containment**: Absolute and parent-traversal workflow paths cannot escape the manifest directory. (Test: `manifest loading rejects workflow paths outside the manifest directory`)
- **closed categories and identity**: Unknown model categories and unrecognized RenderProfile identities are rejected. (Test: `manifest loading rejects unknown model categories and invalid LTX identity literals`)
- **actionable profile selection**: Unknown requested IDs fail with the available profile IDs. (Test: `manifest loading reports an unknown profile id with available ids`)

