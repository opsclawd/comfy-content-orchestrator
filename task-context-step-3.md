# Task Context: Task 3

Title: Capture ComfyUI and custom-node Git provenance
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

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
- packages/infrastructure/src/comfyui/provenance/git-tracker.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/git-tracker.ts","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/git-tracker.ts","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **base HEAD captured**: A valid ComfyUI repository returns its exact verified HEAD object ID. (Test: `git provenance captures the exact ComfyUI HEAD`)
- **custom node ordering and classification**: Immediate custom-node directories are sorted and non-Git directories remain explicit evidence. (Test: `git provenance sorts custom nodes and marks non-Git directories`)
- **missing custom nodes tolerated**: A missing custom_nodes directory produces an empty list when the base repository is valid. (Test: `git provenance tolerates a missing custom_nodes directory`)
- **base repository required**: Collection fails when the configured ComfyUI directory has no resolvable Git HEAD. (Test: `git provenance fails when the ComfyUI base is not a Git repository`)
- **shell-free path handling**: Repository paths containing spaces or shell punctuation are passed as execFile arguments. (Test: `git commit lookup treats metacharacters in paths as data`)

