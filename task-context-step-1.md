# Task Context: Task 1

Title: Land the custom-node filtering regression proof
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

- Modify: `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts` (the custom-node classification tests in the `ComfyUI and Custom-Node Git Tracker` describe block)
- Reference only: `packages/infrastructure/src/comfyui/provenance/git-tracker.ts`

**Behavioral invariants covered first:**

- `ignores the render host's non-node custom_nodes entries` covers the exact production listing and loose-file exclusion.
- `ignores hidden, dunder-prefixed, and package-less directories` covers name-filter precedence and the missing-`__init__.py` fallback.
- `git provenance sorts Git and copy-installed custom nodes` covers retained Git and copied-node behavior plus output ordering.

- [ ] **Step 1: Make the existing non-Git fixture a credible copied node**

Rename `git provenance sorts custom nodes and marks non-Git directories` to `git provenance sorts Git and copy-installed custom nodes`. Replace the plain-directory setup with a copied-node package fixture while leaving its expected `not_git` entry intact:

```ts
const copiedNodeDir = join(customNodesDir, "plain-dir");
await fsPromises.mkdir(copiedNodeDir);
await fsPromises.writeFile(join(copiedNodeDir, "__init__.py"), "");
```

This assertion must continue expecting the two Git nodes followed by `plain-dir`, proving that Git nodes need no Python-package marker and copied nodes do.

- [ ] **Step 2: Add the exact host-listing regression test**

Add this test in the same describe block:

```ts
it("ignores the render host's non-node custom_nodes entries", async () => {
  const comfyUiDir = join(tempDir, "comfyui");
  const comfyCommit = await initGitRepo(comfyUiDir);
  const customNodesDir = join(comfyUiDir, "custom_nodes");

  await fsPromises.mkdir(join(customNodesDir, "__pycache__"), { recursive: true });
  await fsPromises.writeFile(join(customNodesDir, "example_node.py.example"), "");
  await fsPromises.writeFile(join(customNodesDir, "websocket_image_save.py"), "");

  const provenance = await collectGitProvenance(comfyUiDir);

  expect(provenance).toEqual({
    comfyUiCommit: comfyCommit,
    customNodes: []
  });
});
```

- [ ] **Step 3: Add the name- and content-filter regression test**

Create positive-looking excluded entries so the test proves filtering happens by name, plus a visible directory with no node signal:

```ts
it("ignores hidden, dunder-prefixed, and package-less directories", async () => {
  const comfyUiDir = join(tempDir, "comfyui");
  await initGitRepo(comfyUiDir);
  const customNodesDir = join(comfyUiDir, "custom_nodes");

  await initGitRepo(join(customNodesDir, ".hidden-node"));
  const dunderNodeDir = join(customNodesDir, "__dunder_node");
  await fsPromises.mkdir(dunderNodeDir, { recursive: true });
  await fsPromises.writeFile(join(dunderNodeDir, "__init__.py"), "");
  await fsPromises.mkdir(join(customNodesDir, "backup"));

  const provenance = await collectGitProvenance(comfyUiDir);

  expect(provenance.customNodes).toEqual([]);
});
```

- [ ] **Step 4: Run the focused regression proof and confirm the intended failure**

Run:

```bash
pnpm exec vitest run packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
```

Expected: FAIL only in the two new filtering tests. The host test should show `__pycache__` as an unexpected `not_git` entry; the filter-precedence test should show `.hidden-node`, `__dunder_node`, and `backup` as unexpected entries. The renamed mixed-node test and all pre-existing tests should pass.

- [ ] **Step 5: Check the changed test file's static quality**

Run:

```bash
pnpm exec eslint packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
pnpm exec prettier --check packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
```

Expected: both commands exit successfully. The orchestration gate also runs `pnpm -r typecheck`; it must pass even though the newly committed behavioral tests intentionally fail until Task 2.

- [ ] **Step 6: Commit the failing regression proof separately**

```bash
git add packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts
git commit -m "test(infrastructure): reproduce custom-node provenance false positives"
```

The source scanner must not be included in this commit.

## Repository Targets

### Expected Files
- packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts

### Reference Files
- packages/infrastructure/src/comfyui/provenance/git-tracker.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
["pnpm","exec","eslint","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
["pnpm","exec","prettier","--check","packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **actual host non-node entries are ignored**: Given the reported host listing of __pycache__, example_node.py.example, and websocket_image_save.py, collection returns the ComfyUI commit with an empty customNodes array. (Test: `ignores the render host's non-node custom_nodes entries`)
- **excluded names override positive signals**: Directory or symlink candidates whose names begin with . or __ are excluded even if they otherwise look like a Git repository or copied Python package. (Test: `ignores hidden, dunder-prefixed, and package-less directories`)
- **package-less directories are ignored**: A visible non-Git directory without a regular __init__.py file is omitted instead of being reported as not_git. (Test: `ignores hidden, dunder-prefixed, and package-less directories`)
- **valid Git and copied nodes remain sorted**: Git repositories remain tracked with exact commits, copied directories with a regular __init__.py remain not_git, and included entries retain lexical ordering. (Test: `git provenance sorts Git and copy-installed custom nodes`)

