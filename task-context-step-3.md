# Task Context: Task 3

Title: Enforce revision-bound approval and creative mutation rules
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
- Reference: `docs/prd.md` §4.3-§4.4

**Behavioral invariants introduced:**

- `binds approval metadata to the current scene revision`
- `invalidates approval for every creative mutation`
- `keeps editable non-approved scenes in place while advancing revision`
- `rejects creative mutation during generation and production`
- `rejects every creative mutation in terminal states`

- [ ] **Step 1: Write approval-revision and parameterized mutation tests first.**

  In `binds approval metadata to the current scene revision`, reach director review, approve with a fixed actor and ISO-8601 timestamp string, and assert frozen metadata containing the current revision. Also assert approval from draft throws `InvalidTransitionError` without changing the snapshot.

  In `invalidates approval for every creative mutation`, use a table of method closures for prompt, references, engine, duration, and LoRA. Start each row from a newly approved Scene and assert exactly one revision increment, approval removal, `approved -> director_review`, updated configuration, and `configuration_changed` transition fact.

  ```ts
  const mutations = [
    ["prompt", (scene: Scene) => scene.updatePrompt("A revised reveal")],
    ["references", (scene: Scene) => scene.updateReferences(["asset-b"])],
    ["engine", (scene: Scene) => scene.updateEngine("wan@certified-v2")],
    ["duration", (scene: Scene) => scene.updateDuration(6_000)],
    ["LoRA", (scene: Scene) => scene.updateLora("brand-style-v2")],
  ] as const;
  ```

  Include a second LoRA assertion that `updateLora()` with no argument removes an existing optional identity while still advancing revision.

- [ ] **Step 2: Write editable, busy-state, and terminal mutation tests.**

  Parameterize all five mutation methods across both editable non-approved states and assert the status stays in place while revision advances. Parameterize them across generating-candidates, queued, rendering, QA, and failed and assert `InvalidMutationError` plus a byte-for-byte-equivalent snapshot. Parameterize them across completed and cancelled and assert `TerminalStateError` plus an unchanged snapshot.

- [ ] **Step 3: Run the mutation cases and confirm the expected failure.**

  Run: `pnpm exec vitest run packages/domain/src/scene.test.ts -t "binds approval metadata|invalidates approval|keeps editable non-approved|rejects creative mutation|rejects every creative mutation"`

  Expected: FAIL because the five update methods and invalidation guard are not implemented.

- [ ] **Step 4: Implement one shared creative-update path and five explicit methods.**

  Add a private update helper that checks terminal state first, permits only draft/review/approved, constructs and freezes the replacement configuration, increments `specRevision` exactly once, and returns a frozen `configuration_changed` transition. For approved input state it clears approval and changes status to director review; otherwise the transition has identical `from` and `to` values. The helper must perform all validation before changing any field so thrown operations are atomic.

  Implement these exact public signatures:

  ```ts
  updatePrompt(prompt: string): SceneTransition;
  updateReferences(referenceIds: readonly string[]): SceneTransition;
  updateEngine(engineProfileId: string): SceneTransition;
  updateDuration(durationMs: number): SceneTransition;
  updateLora(loraConfigurationId?: string): SceneTransition;
  ```

  Every method replaces only its named configuration component. Copy the references input. When removing LoRA, construct a new configuration that omits `loraConfigurationId` rather than storing `undefined`.

- [ ] **Step 5: Verify all Scene tests and the files changed by this task.**

  Run: `pnpm exec vitest run packages/domain/src/scene.test.ts`

  Expected: PASS; the full transition matrix, mutation invalidation, recovery, immutability, and terminal tests are green.

  Run: `pnpm exec eslint packages/domain/src/scene.ts packages/domain/src/scene.test.ts`

  Expected: exit 0 with no diagnostics.

  Run: `pnpm exec tsc --build packages/domain/tsconfig.json --force`

  Expected: exit 0; the final aggregate public API and tests type-check.

  Run: `pnpm exec prettier --check packages/domain/src/scene.ts packages/domain/src/scene.test.ts`

  Expected: both changed files use repository formatting.

  Run: `pnpm exec dependency-cruiser packages/domain/src/scene.ts packages/domain/src/scene.test.ts --config .dependency-cruiser.cjs`

  Expected: no domain imports violate the clean-architecture boundary.

- [ ] **Step 6: Commit approval and mutation invariants.**

  ```bash
  git add packages/domain/src/scene.ts packages/domain/src/scene.test.ts
  git commit -m "feat(domain): invalidate scene approval on edits"
  ```

## Tests to add or update

- Add `packages/domain/src/scene.test.ts`; retain `packages/domain/src/index.test.ts` unchanged as the existing package-load smoke test.
- Use one table-driven allowed-transition case to cover all PRD §4.2 edges rather than one repetitive test block per edge.
- Add focused atomicity assertions for forbidden transitions and mutations: snapshot before the operation, assert the exact typed error, then compare the full snapshot afterward.
- Add compile-time `@ts-expect-error` checks for branded-ID separation and non-writable status.
- Use fixed approval timestamps and deterministic strings; do not call the system clock or generate random IDs.
- Exercise all five creative mutation methods across approved, editable, busy, and terminal state categories.
- Ensure mutation-kill criteria are meaningful: removing either the transition guard or the approval-revision invalidation must fail named tests.

## Validation commands

Task-local commands are listed in each task and intentionally target only that task's changed files. After all implementation tasks, the orchestrator's dedicated validation phase may run its configured repository validation (`pnpm format`) and automatic workspace-wide typecheck; those commands are not represented as a standalone implementation task.

## Risk areas

- **Ambiguous failed retry semantics:** The raw matrix permits `failed -> queued`, while approval semantics permit production only after approval. Retaining `failedFrom` and requiring current approval prevents a pre-approval generation failure from bypassing director approval.
- **QA history wording:** A pure aggregate cannot durably preserve render or review-event history. Returning an immutable transition fact preserves the information needed by a future application service without pulling audit storage into this issue.
- **Mutable alias leakage:** TypeScript `readonly` is compile-time only. Configuration inputs, reference arrays, approval objects, snapshots, and transition results must be copied/frozen at runtime.
- **Optional-property typing:** `exactOptionalPropertyTypes` rejects explicit `undefined` for omitted fields; snapshot/configuration construction must conditionally spread optional values.
- **Transition guard atomicity:** Validation must happen before changing status, approval, revision, configuration, or failure origin.
- **Duplicate ways to begin generation:** Both `beginCandidateGeneration()` and `requestReroll()` reach generating candidates from director review. Tests should preserve their distinct reason values while enforcing the same legal edge.
- **PRD matrix details:** QA cannot cancel, and `fail()` is not legal from draft, review, approved, failed, or terminal states even though prose loosely says non-terminal production states.

## Stop conditions

Abort the implementation task and report the conflict instead of improvising if any of these occurs:

- Dependency issue #1's domain package, strict TypeScript configuration, Vitest setup, or boundary configuration is absent or materially different when implementation begins.
- A current repository contract already defines `Scene`, `SceneStatus`, `SceneId`, or `CampaignId` incompatibly, making this additive API a duplicate rather than the domain owner.
- Updated issue discussion or PRD text changes the canonical §4.2 matrix, specifies a different approved-mutation destination, or requires no-op updates not to advance revision.
- Acceptance requires durable ReviewEvent history inside this issue rather than the planned immutable transition-result seam; that expands scope into application ports and persistence and needs a revised plan with port and all adapter changes kept together.
- Implementing Scene requires importing contracts, infrastructure, database, provider, filesystem, or clock dependencies into `packages/domain`.
- The repository's automatic `pnpm -r typecheck` gate fails because of unrelated pre-existing changes outside the task's declared files; preserve those changes and report the blocker rather than editing unrelated packages.

## Repository Targets

### Expected Files
- packages/domain/src/scene.ts
- packages/domain/src/scene.test.ts

### Reference Files
- docs/prd.md

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/domain/src/scene.test.ts"]
["pnpm","exec","eslint","packages/domain/src/scene.ts","packages/domain/src/scene.test.ts"]
["pnpm","exec","tsc","--build","packages/domain/tsconfig.json","--force"]
["pnpm","exec","prettier","--check","packages/domain/src/scene.ts","packages/domain/src/scene.test.ts"]
["pnpm","exec","dependency-cruiser","packages/domain/src/scene.ts","packages/domain/src/scene.test.ts","--config",".dependency-cruiser.cjs"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **revision-bound approval**: Approval is accepted only in director_review and freezes the exact current revision with the caller-supplied actor and timestamp. (Test: `binds approval metadata to the current scene revision`)
- **approved creative mutation invalidation**: Each prompt, references, engine, duration, or LoRA update advances revision once, clears approval, applies only its named replacement, and moves approved to director_review. (Test: `invalidates approval for every creative mutation`)
- **editable-state revision progression**: Creative updates in draft_pending or director_review advance revision while leaving lifecycle state unchanged. (Test: `keeps editable non-approved scenes in place while advancing revision`)
- **busy-state mutation rejection**: Creative updates during generation, queueing, rendering, QA, or failure throw InvalidMutationError before changing any state. (Test: `rejects creative mutation during generation and production`)
- **terminal mutation rejection**: Every creative update in completed or cancelled throws TerminalStateError and leaves configuration, revision, approval, failure origin, and status unchanged. (Test: `rejects every creative mutation in terminal states`)

