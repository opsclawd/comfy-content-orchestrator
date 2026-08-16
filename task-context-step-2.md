# Task Context: Task 2

Title: Implement hybrid custom-node candidate filtering
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-18
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-18
Start Commit: 1575ef1855d7a5670237ce20d85f9fd3f05782ec

## Task Requirements

**Files:**

- Modify: `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` (candidate construction around the current `dirNames` pipeline and the `not a git repository` branch of the collection loop)
- Reference only: `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts`
- Reference only: `packages/infrastructure/src/comfyui/provenance/collector.ts`
- Reference only: `packages/infrastructure/src/index.ts`

**Behavioral invariants implemented against Task 1's tests:**

- Candidate entries beginning with `.` or `__` never enter the classification loop.
- Visible Git repositories are `tracked` on success and `unavailable` when Git metadata exists but the commit cannot be resolved.
- A visible candidate rejected specifically as “not a Git repository” becomes `not_git` only when its `__init__.py` resolves to a regular file; otherwise it is skipped.
- Skipping candidates does not disturb the lexical ordering of included nodes.

- [ ] **Step 1: Add the private copied-node signal helper**

Place this non-exported helper after `readGitCommit` and before `collectGitProvenance`; the existing `stat` and `join` imports are sufficient:

```ts
async function hasPythonPackageEntryPoint(nodePath: string): Promise<boolean> {
  try {
    const entryPoint = await stat(join(nodePath, "__init__.py"));
    return entryPoint.isFile();
  } catch {
    return false;
  }
}
```

The helper deliberately treats a missing, broken, inaccessible, or non-file `__init__.py` as no positive copied-node signal. It does not alter exported API signatures.

- [ ] **Step 2: Exclude hidden and dunder-prefixed candidates before classification**

Extend only the existing candidate filter so both directories and symlinks retain current eligibility, but excluded names never reach Git inspection:

```ts
const dirNames = entries
  .filter(
    (entry) =>
      (entry.isDirectory() || entry.isSymbolicLink()) &&
      !entry.name.startsWith(".") &&
      !entry.name.startsWith("__")
  )
  .map((entry) => entry.name)
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
```

- [ ] **Step 3: Gate only the existing `not_git` branch on the copied-node signal**

Inside the `errText.includes("not a git repository")` branch, check the package entry point before pushing the existing frozen `not_git` record:

```ts
if (errText.includes("not a git repository")) {
  if (!(await hasPythonPackageEntryPoint(nodePath))) {
    continue;
  }

  customNodes.push(
    Object.freeze({
      name,
      commit: null,
      status: "not_git"
    })
  );
} else {
  customNodes.push(
    Object.freeze({
      name,
      commit: null,
      status: "unavailable"
    })
  );
}
```

Do not move the fallback check ahead of `readGitCommit`: Git repositories without `__init__.py` must remain tracked, and Git failures other than the explicit not-a-repository result must remain `unavailable`.

- [ ] **Step 4: Run the source-focused behavioral verification**

Run the direct behavioral contract for this source file:

```bash
pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
```

Expected: PASS with eight tests. In particular, both Task 1 regressions now pass, the copied package remains `not_git`, both Git clones retain exact commits and sort order, and the empty Git repository remains `unavailable`.

- [ ] **Step 5: Check the changed source file's static quality**

Run:

```bash
pnpm exec eslint packages/infrastructure/src/comfyui/provenance/git-tracker.ts
pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/git-tracker.ts
```

Expected: both commands exit successfully. The automatic post-step `pnpm -r typecheck` gate must also pass with no public signature changes.

- [ ] **Step 6: Commit the implementation independently**

```bash
git add packages/infrastructure/src/comfyui/provenance/git-tracker.ts
git commit -m "fix(infrastructure): filter non-node provenance entries"
```

## Validation commands

These commands are already acceptance criteria inside the two implementation tasks and are repeated here only as the exact handoff checklist, not as a standalone task:

```bash
pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
pnpm exec eslint packages/infrastructure/src/comfyui/provenance/git-tracker.ts packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/git-tracker.ts packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
```

Final expected result: eight focused tests pass; ESLint and Prettier pass for the two affected files. The orchestrator separately enforces workspace-wide `pnpm -r typecheck` after each implementation step and the configured final `pnpm format` validation after implementation tasks finish.

## Risk areas

- Requiring a regular `__init__.py` intentionally drops copy-installed directories that rely on non-standard loading without a Python package entry point. This is the selected precision trade-off in `design.md`.
- Catching all `stat` failures in the private copied-node helper treats inaccessible or broken candidates as absent rather than inventing provenance for them.
- The existing error-message distinction around `readGitCommit` is behaviorally important: only its explicit “not a Git repository” error may use the copied-node fallback. Other Git failures are the recovery path and must remain `unavailable`.
- Name filtering applies to symlink names as well as directory names. Visible symlinks retain the current behavior because `stat` follows their target; hidden or dunder-prefixed symlinks are excluded.
- Adding broader validation of Python package contents, changing error types, or refactoring exports would expand blast radius without helping this issue.

## Stop conditions

- Abort if repository evidence shows ComfyUI intentionally loads a supported, copy-installed directory custom node without a regular `__init__.py`; the core positive-signal assumption would need a revised design.
- Abort if satisfying the acceptance criteria requires tracking individual `.py` files; that is explicitly out of scope and needs a separate provenance format decision.
- Abort if preserving `unavailable` for present-but-broken Git repositories requires changing an exported signature or artifact schema; return for design review instead of broadening this fix.
- Abort if the focused baseline tests fail before Task 1 changes for reasons unrelated to this issue; diagnose the baseline rather than masking unrelated failures in these commits.
- Abort if implementation requires modifications outside the two affected files; update the plan and manifest blast radius before proceeding.

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/git-tracker.ts

### Reference Files
- packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
- packages/infrastructure/src/comfyui/provenance/collector.ts
- packages/infrastructure/src/index.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/git-tracker.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/git-tracker.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **actual host non-node entries are ignored**: The collector skips the __pycache__ directory and ignores loose files, yielding no custom nodes for the exact reported host listing. (Test: `ignores the render host's non-node custom_nodes entries`)
- **excluded names never enter classification**: Candidate names beginning with . or __ are removed before Git or copied-package inspection regardless of their contents. (Test: `ignores hidden, dunder-prefixed, and package-less directories`)
- **not-git candidates require a Python package entry point**: After readGitCommit identifies a visible candidate as not a Git repository, the collector emits not_git only when __init__.py resolves to a regular file and skips it otherwise. (Test: `ignores hidden, dunder-prefixed, and package-less directories`)
- **valid Git and copied nodes remain sorted**: A Git repository is tracked without requiring __init__.py, a copied package is not_git, and all included entries remain lexically sorted. (Test: `git provenance sorts Git and copy-installed custom nodes`)
- **unresolvable Git repositories remain unavailable**: When Git metadata exists but its commit cannot be resolved, the candidate stays in the inventory as unavailable and does not enter the copied-node fallback. (Test: `classifies corrupted or unresolvable custom-node repository as unavailable`)

