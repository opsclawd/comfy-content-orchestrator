# Task Context: Task 9

Title: Publish JSON and Markdown artifacts atomically
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-7
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-7
Start Commit: 27bbf2d699970a5f188cd3e8acf284c622494c3a

## Task Requirements

**Files:**

- Create: `apps/render-worker/src/certification/artifact-writer.ts`
- Create: `apps/render-worker/src/certification/artifact-writer.test.ts`
- Reference only: `packages/contracts/src/ltx-certification.ts`
- Reference only: `packages/application/src/certification/certification-metrics.ts`

**Behavioral invariants — write these named tests first:**

- `same-result-two-formats` — `result.json` is the parsed artifact and `summary.md` is rendered from that exact in-memory object. Test case: `writes JSON and Markdown from the same validated artifact`.
- `run-id-cannot-escape-root` — only a conservative `[a-z0-9][a-z0-9._-]*` run ID is accepted; separators, traversal, control characters, and empty IDs are rejected. Test case: `rejects unsafe certification run IDs`.
- `existing-result-is-immutable` — if the final run directory exists, publication aborts without changing it. Test case: `refuses to overwrite an existing certification run`.
- `partial-publication-is-hidden` — files are written and synced in a sibling temporary directory, then the directory is renamed to the final path; on error only that owned temporary directory is removed. Test case: `does not expose a partial final artifact directory on write failure`.

**Steps:**

- [ ] Write tests under a Vitest-owned temporary directory using real filesystem calls and injected failing write/rename functions for the partial-publication case.
- [ ] Implement `writeCertificationArtifacts({ outputRoot, artifact })` with Zod parsing before writes, two-space/stable JSON plus trailing newline, generated Markdown plus trailing newline, `mkdir` collision checks, and an atomic same-filesystem directory rename.
- [ ] Return repository-relative result/summary paths for CLI output. Never delete or overwrite an existing final run directory.
- [ ] Run the scoped checks, then commit.

**Acceptance/verification:**

- `pnpm exec vitest run apps/render-worker/src/certification/artifact-writer.test.ts` — expected: same-source, unsafe-ID, collision, and atomic-failure tests pass.
- `pnpm exec eslint apps/render-worker/src/certification/artifact-writer.ts apps/render-worker/src/certification/artifact-writer.test.ts` — expected: no errors.
- `pnpm exec prettier --check apps/render-worker/src/certification/artifact-writer.ts apps/render-worker/src/certification/artifact-writer.test.ts` — expected: both files conform.

**Commit:** `feat(render-worker): publish certification evidence atomically`

## Repository Targets

### Expected Files
- apps/render-worker/src/certification/artifact-writer.ts
- apps/render-worker/src/certification/artifact-writer.test.ts

### Reference Files
- packages/contracts/src/ltx-certification.ts
- packages/application/src/certification/certification-metrics.ts

## Validation Commands

```bash
["pnpm","exec","vitest","run","apps/render-worker/src/certification/artifact-writer.test.ts"]
["pnpm","exec","eslint","apps/render-worker/src/certification/artifact-writer.ts","apps/render-worker/src/certification/artifact-writer.test.ts"]
["pnpm","exec","prettier","--check","apps/render-worker/src/certification/artifact-writer.ts","apps/render-worker/src/certification/artifact-writer.test.ts"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **same-result-two-formats**: JSON and Markdown are generated from one validated in-memory artifact. (Test: `writes JSON and Markdown from the same validated artifact`)
- **run-id-cannot-escape-root**: Unsafe, empty, or traversal-capable run IDs are rejected. (Test: `rejects unsafe certification run IDs`)
- **existing-result-is-immutable**: An existing final run directory is never changed or overwritten. (Test: `refuses to overwrite an existing certification run`)
- **partial-publication-is-hidden**: Failures leave no partial final directory and remove only the writer-owned temporary directory. (Test: `does not expose a partial final artifact directory on write failure`)

