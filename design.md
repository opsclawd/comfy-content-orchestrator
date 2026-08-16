# Design Document: Fixing Custom Node Provenance Scanner

## The Problem and Why It Matters

The `collectGitProvenance` function scans the ComfyUI `custom_nodes` directory to record the exact versions of all installed custom nodes. Currently, it enumerates every directory and symbolic link, treating each as a candidate node. This naive discovery mechanism results in standard Python runtime directories (like `__pycache__`) being incorrectly identified and reported as custom nodes.

This issue compromises the integrity of certification artifacts. The `customNodes` array forms the "identity block" of a run. When a directory like `__pycache__`—which is dynamically created and removed by the Python runtime—is included, it asserts the presence of a component that does not exist. More critically, it creates false discrepancies between two identical runs, rendering cross-run comparisons unreliable and undermining the core purpose of the certification artifact.

## Key Design Decisions and Trade-offs

1. **Discovery Strategy: Filtering vs. Validation**
   - *Option A: Strict Denylist (Name-based only).* We could simply exclude directories named `__pycache__` or those starting with `.` or `__`. This is fast and simple but remains brittle; an arbitrary non-node directory (e.g., `backup/`) would still be incorrectly recorded as a `not_git` custom node.
   - *Option B: Pure Validation (Content-based).* We could require every directory to contain an `__init__.py` file. However, this might exclude git-tracked nodes that follow unconventional structures or are temporarily broken, missing the fact that they were intentionally cloned into the directory by the user.
   - *Selected Approach: Hybrid Strategy.* We will combine name-based exclusion with a content-based positive signal. We exclude obvious non-node directories (`__pycache__`, dotfiles) by name. For the remaining directories, we require a positive signal of being a custom node: it must either be a Git repository OR contain an `__init__.py` file. This maximizes precision without silently dropping legitimate but unconventional git-installed nodes.

2. **Handling `not_git` Nodes**
   - The issue emphasizes the importance of retaining copy-installed (non-git) nodes. By explicitly checking for `__init__.py` when a directory lacks a `.git` folder, we confidently establish that the directory is intended as a Python package (which ComfyUI requires to load it as a node extension) before recording it as `not_git`.

## Proposed Approach with Rationale

The fix will be implemented in `packages/infrastructure/src/comfyui/provenance/git-tracker.ts`:

1. **Initial Name Filtering**: When reading the `custom_nodes` directory, filter out directories (and symlinks) whose names begin with `.` or `__`. This securely eliminates `__pycache__` and any hidden directories.
2. **Signal Validation**: For each remaining candidate directory:
   - Attempt to resolve it as a Git repository (`readGitCommit`). If successful (or if it fails due to repository corruption/unavailability), it is recorded as `tracked` or `unavailable`. The presence of `.git` is a sufficient signal of user intent.
   - If the directory is *not* a Git repository, check for the existence of an `__init__.py` file inside it using `stat()`.
   - If `__init__.py` exists, record the node with `status: "not_git"`.
   - If `__init__.py` does not exist, discard the candidate. It is not a valid ComfyUI custom node package.
3. **Regression Testing**: Update `git-tracker.test.ts` with a test case that replicates the reported host environment. The test will create a `custom_nodes` directory containing a `__pycache__` directory, a `.hidden` directory, an arbitrary plain directory, `example_node.py.example`, and `websocket_image_save.py`. The test will assert that the `customNodes` array remains empty. Additional tests will ensure that valid git clones and valid `not_git` directories (containing `__init__.py`) are correctly captured.

## Assumptions Made

- Directories starting with `.` or `__` (including `__pycache__`) are never legitimate custom nodes.
- A legitimate custom node directory that is *not* a Git repository will always contain an `__init__.py` file. This is standard for Python packages and is required by ComfyUI's dynamic module importer for directory-based extensions.
- The presence of a `.git` folder inside a candidate directory is a sufficient signal that it should be tracked as a custom node, regardless of its Python content.
- Single-file custom nodes (like `websocket_image_save.py`) dropped directly into the `custom_nodes` root are not currently tracked by the provenance scanner (which targets directories), and adding support for tracking individual file hashes is out of scope for this specific fix.

## Scope

- **In Scope:**
  - Modifying `collectGitProvenance` to exclude directories starting with `.` or `__`.
  - Modifying `collectGitProvenance` to require an `__init__.py` file for non-git directories.
  - Adding specific regression tests in `git-tracker.test.ts` to cover the new exclusion and inclusion rules based on the issue description.
- **Out of Scope:**
  - Tracking individual Python files placed directly in `custom_nodes` as distinct provenance entries.
  - Fixing unrelated issues mentioned in the ticket (e.g., #17 telemetry rejection).
  - Validating the internal correctness or structure of git-tracked nodes beyond the existence of their `.git` metadata.

## Risks or Concerns

- **Copy-installed Nodes Without `__init__.py`**: If there is a rare, non-standard custom node in the ecosystem that relies on being a directory without an `__init__.py` (e.g., heavily relying on `sys.path` manipulation instead of package importing), this stricter filtering would silently drop it. Given Python's module resolution and ComfyUI's design, this risk is extremely low, but it is the primary trade-off of requiring a positive content signal.
