<!-- plan-review-required -->
# Custom-Node Provenance Scanner Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure `collectGitProvenance` reports only credible ComfyUI custom-node directories, excluding Python caches, hidden directories, loose files, and package-less directories while preserving Git-installed, copy-installed, and unavailable-repository provenance.

**Architecture:** Keep the existing sorted, one-pass scan in `git-tracker.ts`, but narrow candidate discovery by name before repository inspection. Git remains the strongest positive signal; only candidates that are not Git repositories fall back to a private `__init__.py` file check, while candidates with present-but-unreadable Git metadata continue to produce `status: "unavailable"`.

**Tech Stack:** TypeScript, Node.js `fs/promises` and `child_process`, Vitest, ESLint, Prettier, pnpm workspaces.

---

## Goal

Correct the certification identity block so the render host listing `example_node.py.example`, `__pycache__`, and `websocket_image_save.py` produces an empty `customNodes` array without losing legitimate Git clones or copied Python-package nodes.

## Non-goals

- Do not track or hash single-file custom nodes such as `websocket_image_save.py`.
- Do not change `CustomNodeGitRevision`, `GitProvenance`, `readGitCommit`, or `collectGitProvenance` exported signatures.
- Do not filter to Git repositories only; copied nodes with a regular `__init__.py` must remain visible as `not_git`.
- Do not validate a Git-installed node's Python layout beyond its Git metadata.
- Do not address telemetry issue #17 or alter certification artifact schemas and consumers.
- Do not refactor the broader provenance collector or infrastructure barrel exports.

## Affected files

- `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts` — update the copied-node fixture and add regression cases for the host listing and invalid directory candidates.
- `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` — apply name filtering and the non-Git `__init__.py` positive-signal check inside custom-node collection.

Read-only blast-radius references:

- `packages/infrastructure/src/comfyui/provenance/collector.ts` — consumes the unchanged `GitProvenance` result.
- `packages/infrastructure/src/index.ts` — re-exports the unchanged public declarations.

## Behavioral invariants

1. **Actual host non-node entries are ignored:** given a valid ComfyUI Git repository whose `custom_nodes` directory contains only the directory `__pycache__` and the files `example_node.py.example` and `websocket_image_save.py`, collection returns the ComfyUI commit and `customNodes: []`. Named test: `ignores the render host's non-node custom_nodes entries`.
2. **Excluded names win over positive node signals:** a candidate whose entry name starts with `.` or `__` is excluded even when it otherwise looks like a Git repository or copied Python package. Named test: `ignores hidden, dunder-prefixed, and package-less directories`.
3. **Package-less directories are ignored:** a visible non-Git directory without a regular `__init__.py` is not emitted as `not_git`. Named test: `ignores hidden, dunder-prefixed, and package-less directories`.
4. **Git and copied nodes remain distinguishable and sorted:** a visible Git repository is emitted as `tracked` with its commit without requiring `__init__.py`; a visible non-Git directory with a regular `__init__.py` is emitted as `not_git`; included entries remain lexically sorted. Named test: `git provenance sorts Git and copy-installed custom nodes`.
5. **Git recovery classification is preserved:** a candidate with Git metadata whose commit cannot be resolved remains in the inventory as `unavailable`, rather than falling back to `not_git` or being discarded. Existing named test: `classifies corrupted or unresolvable custom-node repository as unavailable`.

## Tests to add or update

- Add a regression test using exactly the reported host entries: the `__pycache__` directory plus the two loose files. It must fail against the current implementation because `__pycache__` is emitted as `not_git`.
- Add a filtering-precedence test containing a hidden Git repository, a dunder-prefixed copied package, and a visible package-less directory. It must fail against the current implementation and prove both the name and content filters.
- Update the existing mixed-node test so its copied node contains a regular `__init__.py`, rename the test to describe Git and copy-installed behavior, and preserve assertions for exact commits, statuses, and lexical ordering.
- Keep the existing unavailable-repository test unchanged as coverage for the Git error-recovery path.

## Task 1: Land the custom-node filtering regression proof

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

## Task 2: Implement hybrid custom-node candidate filtering

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
