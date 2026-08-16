# Custom-node provenance scanner reports __pycache__ as a custom node

## Observed

The first live certification artifact (`ltx-cert-run-001`) records this as the runner's complete custom-node inventory:

```json
"customNodes": [
  { "name": "__pycache__", "commit": null, "status": "not_git" }
]
```

`__pycache__` is a Python bytecode cache directory, not a custom node. The actual contents of `custom_nodes` on the render host are:

```
example_node.py.example
__pycache__
websocket_image_save.py
```

The host has **no** custom nodes installed. The correct inventory is empty; the artifact instead names a cache directory.

## Cause

`packages/infrastructure/src/comfyui/provenance/git-tracker.ts:77-79` enumerates every directory entry and treats each as a candidate node:

```ts
const dirNames = entries
  .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
  .map((entry) => entry.name)
```

Nothing excludes cache or dotfile directories, and nothing requires a directory to look like a node before it is recorded.

## Why it is worth fixing

This is the identity block of a certification artifact. It is the record of what code was loaded into the runner when the measurements were taken, and it will be compared across runs to explain behavioural differences.

An entry that is not a node makes that record wrong in two directions: it asserts a component that does not exist, and — because `__pycache__` is created and removed by ordinary Python execution — it can make two otherwise identical runs appear to have different runner composition. A future diff of certification identity would flag a change that never happened.

## Scope

1. Exclude directories that cannot be custom nodes. `__pycache__` at minimum; consider any name beginning with `.` or `__`.
2. Decide what qualifies as a node rather than filtering by name alone. A directory containing `__init__.py`, or one that is a git repository, is a stronger signal than the absence of a denylisted name.
3. Keep recording legitimate non-git nodes. `status: "not_git"` is meaningful for a node installed by copying rather than cloning, and must not be lost while filtering caches.

## Acceptance criteria

- [ ] A `custom_nodes` directory containing only `__pycache__`, `example_node.py.example` and `websocket_image_save.py` yields an empty `customNodes` array.
- [ ] A real custom node installed as a git clone is still reported with its commit.
- [ ] A real custom node installed without git is still reported with `status: "not_git"`.
- [ ] A regression test uses the host's actual directory listing above.

## Traps

- **DO NOT** filter to git repositories only. That would silently drop copy-installed nodes, which are exactly the ones whose provenance is hardest to establish and most important to record.
- **DO NOT** treat this as cosmetic. It is part of the identity a certification attests to; a wrong entry undermines cross-run comparison, which is the artifact's purpose.
- Related: #17 (telemetry rejects every sample), found in the same run. Evidence at `certification/ltx-25/ltx-cert-run-001/` on the render host.
