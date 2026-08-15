# Task Context: Task 2

Title: Implement the canonical lifecycle and failure recovery
## Workspace & Scope Constraints

## WORKSPACE CONSTRAINTS

Your working directory is a dedicated git worktree with the repository's complete history. Run all commands from it. Do NOT cd to or read paths outside this directory — external-directory access is automatically rejected. git log, git diff, etc. work here directly.

.ai-orchestrator.local.json, if one exists, lives only in the main checkout and is intentionally not copied into your worktree — it is operator-machine-specific and not part of your task. Do not search for it or read it outside this directory. Reason about configuration using only .ai-orchestrator.json in your own working directory; treat it as the effective config for your task.

Working Directory: /home/gary/.openclaw/workspace/comfy-content-orchestrator/.ai-worktrees/issue-2
Repository: opsclawd/comfy-content-orchestrator
Branch: ai/issue-2
Start Commit: 45a1e60db595fa35236f1f612dfa2b026d3099ed

## Task Requirements

**Files:**

- Modify: `packages/domain/src/scene.ts`
- Modify: `packages/domain/src/scene.test.ts`
- Reference: `docs/prd.md` §4.1-§4.2 and §4.4

**Behavioral invariants introduced:**

- `allows every canonical scene transition through its behavior method`
- `rejects representative transitions absent from the canonical matrix`
- `treats completed and cancelled scenes as terminal`
- `records failure origin and permits only approved production failures to retry`
- `returns an immutable QA rejection transition without erasing prior state facts`

- [ ] **Step 1: Add table-driven allowed-transition tests before lifecycle code.**

  Use a fresh Scene factory and a sequence of public method calls to reach each source state. Cover every PRD edge represented by the lifecycle methods introduced in this task, including both entry behaviors to candidate generation and every allowed failure/cancellation edge. The `approved -> director_review` edge is exercised by all five creative-update cases in Task 3, because those update methods do not exist in this independently green task:

  | From | Behavior | To |
  |---|---|---|
  | `draft_pending` | `beginCandidateGeneration()` | `generating_candidates` |
  | `draft_pending` | `cancel()` | `cancelled` |
  | `generating_candidates` | `submitCandidatesForReview()` | `director_review` |
  | `generating_candidates` | `fail()` | `failed` |
  | `generating_candidates` | `cancel()` | `cancelled` |
  | `director_review` | `beginCandidateGeneration()` or `requestReroll()` | `generating_candidates` |
  | `director_review` | `approve(input)` | `approved` |
  | `director_review` | `cancel()` | `cancelled` |
  | `approved` | `queueForProduction()` | `queued` |
  | `approved` | `cancel()` | `cancelled` |
  | `queued` | `startRendering()` | `rendering` |
  | `queued` | `fail()` | `failed` |
  | `queued` | `cancel()` | `cancelled` |
  | `rendering` | `submitForQA()` | `qa` |
  | `rendering` | `fail()` | `failed` |
  | `rendering` | `cancel()` | `cancelled` |
  | `qa` | `acceptQA()` | `completed` |
  | `qa` | `rejectQA()` | `director_review` |
  | `qa` | `fail()` | `failed` |
  | `failed` | `queueForProduction()` when approval is current and failure came from production | `queued` |
  | `failed` | `recoverToReview()` | `director_review` |
  | `failed` | `cancel()` | `cancelled` |

  The single test name is exactly `allows every canonical scene transition through its behavior method`. Each table row asserts both the Scene's new status and the returned transition's `from`, `to`, and `reason`.

- [ ] **Step 2: Add focused guard, recovery, terminal, and QA-result tests.**

  Add the other four named invariant cases. Representative forbidden cases must span creative, queue, render, QA, and failure contexts, such as draft approval, review rendering, approved QA submission, QA cancellation, and generation retry-to-queue. Capture a snapshot before each call and assert deep equality after the typed error.

  For terminal coverage, build one completed and one cancelled Scene, enumerate every lifecycle method via zero-argument closures (supplying fixed approval input where necessary), and assert `TerminalStateError` plus unchanged snapshots.

  For failure provenance, prove `failedFrom` records `generating_candidates`, `queued`, `rendering`, or `qa`; prove only the latter three, which retain a current approval, can retry to queued; and prove `recoverToReview()` clears failure provenance and approval.

  For QA rejection, retain the returned transition, assert it is frozen and reports `qa -> director_review`, assert current approval is cleared, then drive later activity and show the earlier transition object is unchanged.

- [ ] **Step 3: Run the lifecycle cases and confirm they fail for missing methods.**

  Run: `pnpm exec vitest run packages/domain/src/scene.test.ts -t "allows every canonical scene transition|rejects representative transitions|treats completed and cancelled|records failure origin|returns an immutable QA rejection"`

  Expected: FAIL because the lifecycle methods are not implemented.

- [ ] **Step 4: Implement one guarded transition primitive and the public behaviors.**

  Add a private transition helper that checks terminal states first, verifies the current state against the behavior's allowed source set, changes status only after all checks pass, clears `failedFrom` when leaving failure, and returns a frozen transition fact. Keep the transition map private so consumers cannot request arbitrary destinations.

  Implement these exact methods on `Scene`, each returning `SceneTransition`:

  ```ts
  beginCandidateGeneration(): SceneTransition;
  submitCandidatesForReview(): SceneTransition;
  approve(input: SceneApprovalInput): SceneTransition;
  requestReroll(): SceneTransition;
  queueForProduction(): SceneTransition;
  startRendering(): SceneTransition;
  submitForQA(): SceneTransition;
  acceptQA(): SceneTransition;
  rejectQA(): SceneTransition;
  fail(): SceneTransition;
  recoverToReview(): SceneTransition;
  cancel(): SceneTransition;
  ```

  `approve` is valid only in `director_review`; it freezes approval metadata with `revision === specRevision` before entering `approved`. `fail` is valid only from `generating_candidates`, `queued`, `rendering`, or `qa` and records the source in `failedFrom`. `queueForProduction` accepts `approved`, or `failed` only when `failedFrom` is queued/rendering/QA and approval revision still equals `specRevision`. `rejectQA` and `recoverToReview` clear approval because director review requires a new explicit approval. Do not permit QA cancellation because PRD §4.2 does not list that edge.

- [ ] **Step 5: Run scoped lifecycle verification.**

  Run: `pnpm exec vitest run packages/domain/src/scene.test.ts -t "allows every canonical scene transition|rejects representative transitions|treats completed and cancelled|records failure origin|returns an immutable QA rejection"`

  Expected: PASS for all selected lifecycle cases.

  Run: `pnpm exec eslint packages/domain/src/scene.ts packages/domain/src/scene.test.ts`

  Expected: exit 0 with no diagnostics.

  Run: `pnpm exec tsc --build packages/domain/tsconfig.json --force`

  Expected: exit 0; all lifecycle signatures and exhaustive test tables type-check.

- [ ] **Step 6: Commit the authoritative transition state machine.**

  ```bash
  git add packages/domain/src/scene.ts packages/domain/src/scene.test.ts
  git commit -m "feat(domain): enforce scene lifecycle"
  ```

## Repository Targets

### Expected Files
- packages/domain/src/scene.ts
- packages/domain/src/scene.test.ts

### Reference Files
- docs/prd.md

## Validation Commands

```bash
pnpm exec vitest run packages/domain/src/scene.test.ts -t "allows every canonical scene transition|rejects representative transitions|treats completed and cancelled|records failure origin|returns an immutable QA rejection"
["pnpm","exec","eslint","packages/domain/src/scene.ts","packages/domain/src/scene.test.ts"]
["pnpm","exec","tsc","--build","packages/domain/tsconfig.json","--force"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **canonical transition matrix**: Every PRD 4.2 edge is reachable through its named behavior and produces the expected destination and reason. (Test: `allows every canonical scene transition through its behavior method`)
- **forbidden transition atomicity**: A non-terminal transition absent from the canonical matrix throws InvalidTransitionError and leaves the full snapshot unchanged. (Test: `rejects representative transitions absent from the canonical matrix`)
- **terminal lifecycle enforcement**: Every lifecycle behavior invoked in completed or cancelled throws TerminalStateError and leaves state unchanged. (Test: `treats completed and cancelled scenes as terminal`)
- **failure provenance and retry authorization**: Failure records its source; only queued, rendering, or QA failures retaining current approval may retry directly to queued, while generation failure must recover to review or cancel. (Test: `records failure origin and permits only approved production failures to retry`)
- **QA rejection transition evidence**: Rejecting QA clears current approval, enters director_review, and returns a frozen qa-to-director_review fact that later activity cannot alter. (Test: `returns an immutable QA rejection transition without erasing prior state facts`)

