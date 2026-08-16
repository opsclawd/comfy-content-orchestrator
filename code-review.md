# Integration Code Review

## Finding 1: Incompatible Abstraction - Single-file Custom Nodes Omitted
**Severity:** High
**File Path:** `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` (lines 88-93) and `packages/infrastructure/src/comfyui/provenance/git-tracker.test.ts` (line 134)

**Evidence:**
In `git-tracker.ts`, the `entries.filter` restricts processing strictly to directories and symlinks (`entry.isDirectory() || entry.isSymbolicLink()`). Additionally, the PR explicitly introduces a test asserting that `websocket_image_save.py` is ignored because it considers it a "non-node" entry.

**Failure Mode:**
ComfyUI's module loader natively supports single-file custom nodes (e.g., `websocket_image_save.py` is a well-known community node). By modeling custom nodes strictly as packages (directories with `__init__.py`), this abstraction is incompatible with the render host. When `CertificationProvenanceReport` is generated, it will silently omit these required single-file nodes. Any downstream environment relying on this provenance report to reproduce the render profile will fail to execute the workflow due to missing nodes, completely breaking the composition-root and environment state.

**Required Fix:**
Modify the `entries.filter` to include valid Python files (`entry.isFile() && entry.name.endsWith('.py')`). Adjust the loop to track these single-file nodes with a `not_git` status, bypassing the `hasPythonPackageEntryPoint` check. Update the tests to assert that valid `.py` single-file nodes are successfully tracked in the provenance.

## Finding 2: Inconsistent Validation - Non-Node Git Repositories Tracked
**Severity:** Medium
**File Path:** `packages/infrastructure/src/comfyui/provenance/git-tracker.ts` (lines 114-116)

**Evidence:**
The newly added `hasPythonPackageEntryPoint` validation is exclusively called inside the `catch` block for `errText.includes("not a git repository")`.

**Failure Mode:**
If the render host places a valid Git repository inside `custom_nodes/` that is *not* a Python package (e.g., a `.git` managed `backup` repo, a cloned tools directory, or a sub-repository lacking an `__init__.py`), `readGitCommit(nodePath)` will succeed. The execution will entirely bypass the `hasPythonPackageEntryPoint` check, improperly tracking the non-node directory as a valid `"tracked"` custom node in the provenance report. Similarly, corrupted git repos will bypass the check and be added as `"unavailable"`. This creates false dependencies and pollutes the certification profile.

**Required Fix:**
Move the `hasPythonPackageEntryPoint` validation out of the `catch` block so it evaluates all directories (whether they are valid Git repos, non-Git, or unavailable). Before pushing any directory as a node to `customNodes`, verify it is a valid Python package.
