# Task Context: Task 1

Title: Define Scene domain contracts and typed errors
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

- Create: `packages/domain/src/scene.ts`
- Create: `packages/domain/src/scene.test.ts`
- Modify: `packages/domain/src/index.ts`
- Reference: `docs/CONTEXT.md`
- Reference: `docs/prd.md` §3.6.3 and §4.1-§4.4

**Behavioral invariant introduced:**

- `creates a draft scene at revision one with an immutable configuration snapshot`

- [ ] **Step 1: Write the public-contract test first.**

  Import only from `./index.js`. Assert the canonical status tuple exactly matches PRD order; branded IDs can be supplied to `Scene.create`; initial status is `draft_pending`; initial revision is `1`; approval and failure origin are absent; and mutating the caller's original references array or an exposed snapshot cannot alter a subsequent snapshot. Include compile-time assertions using `// @ts-expect-error` that a `CampaignId` cannot occupy the Scene ID position and that `scene.status` cannot be assigned.

  ```ts
  it("creates a draft scene at revision one with an immutable configuration snapshot", () => {
    const referenceIds = ["asset-a"];
    const scene = Scene.create({
      id: "scene-1" as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A product reveal",
        referenceIds,
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4_000,
      },
    });

    referenceIds.push("asset-b");
    expect(scene.snapshot()).toMatchObject({
      status: "draft_pending",
      specRevision: 1,
      approval: undefined,
      failedFrom: undefined,
      configuration: { referenceIds: ["asset-a"] },
    });
    expect(Object.isFrozen(scene.snapshot())).toBe(true);
    expect(Object.isFrozen(scene.snapshot().configuration.referenceIds)).toBe(true);
  });
  ```

- [ ] **Step 2: Run the focused test and confirm the expected failure.**

  Run: `pnpm exec vitest run packages/domain/src/scene.test.ts -t "creates a draft scene at revision one with an immutable configuration snapshot"`

  Expected: FAIL because `./index.js` does not yet export the Scene contracts or aggregate.

- [ ] **Step 3: Add the canonical value types, immutable contracts, and errors.**

  In `packages/domain/src/scene.ts`, define and export the exact canonical status tuple and derived union; distinct unique-symbol brands for `SceneId` and `CampaignId`; and readonly interfaces for `SceneConfiguration`, `SceneCreateInput`, `SceneApproval`, `SceneApprovalInput`, `SceneSnapshot`, `SceneTransition`, and `SceneTransitionReason`. The reason union must cover each public lifecycle intent (`candidate_generation_started`, `candidates_submitted`, `approved`, `reroll_requested`, `production_queued`, `rendering_started`, `submitted_for_qa`, `qa_accepted`, `qa_rejected`, `failed`, `recovered_to_review`, `cancelled`, `configuration_changed`).

  Add `InvalidTransitionError`, `InvalidMutationError`, and `TerminalStateError`, each extending `Error`, setting a stable `.name`, and exposing readonly state/context fields useful to callers. Do not add imports: this module is pure domain code.

  Add the minimal `Scene` shell with a private constructor, `Scene.create(input)`, readonly `id`, `campaignId`, and `status` getters, and `snapshot()`. Copy and freeze configuration data on ingestion and every snapshot; do not expose internal arrays or a public status setter. Initial `specRevision` is `1`.

  ```ts
  export const SCENE_STATUSES = [
    "draft_pending",
    "generating_candidates",
    "director_review",
    "approved",
    "queued",
    "rendering",
    "qa",
    "completed",
    "failed",
    "cancelled",
  ] as const;

  export type SceneStatus = (typeof SCENE_STATUSES)[number];

  export interface SceneConfiguration {
    readonly prompt: string;
    readonly referenceIds: readonly string[];
    readonly engineProfileId: string;
    readonly durationMs: number;
    readonly loraConfigurationId?: string;
  }

  export interface SceneCreateInput {
    readonly id: SceneId;
    readonly campaignId: CampaignId;
    readonly configuration: SceneConfiguration;
  }
  ```

  Omit absent optional properties instead of assigning `undefined`, because the repository enables `exactOptionalPropertyTypes`.

- [ ] **Step 4: Re-export the module without removing the existing package marker.**

  Append this NodeNext-compatible export to `packages/domain/src/index.ts`:

  ```ts
  export * from "./scene.js";
  ```

- [ ] **Step 5: Verify the focused behavior and changed-file quality gates.**

  Run: `pnpm exec vitest run packages/domain/src/scene.test.ts -t "creates a draft scene at revision one with an immutable configuration snapshot"`

  Expected: PASS.

  Run: `pnpm exec eslint packages/domain/src/scene.ts packages/domain/src/scene.test.ts packages/domain/src/index.ts`

  Expected: exit 0 with no diagnostics.

  Run: `pnpm exec tsc --build packages/domain/tsconfig.json --force`

  Expected: exit 0; declaration generation proves the readonly and branded public surface is type-correct.

  Run: `pnpm exec dependency-cruiser packages/domain/src/scene.ts packages/domain/src/scene.test.ts packages/domain/src/index.ts --config .dependency-cruiser.cjs`

  Expected: no domain boundary errors.

- [ ] **Step 6: Commit the independently usable domain foundation.**

  ```bash
  git add packages/domain/src/scene.ts packages/domain/src/scene.test.ts packages/domain/src/index.ts
  git commit -m "feat(domain): define scene contracts"
  ```

## Repository Targets

### Expected Files
- packages/domain/src/scene.ts
- packages/domain/src/scene.test.ts
- packages/domain/src/index.ts

### Reference Files
- docs/CONTEXT.md
- docs/prd.md

## Validation Commands

```bash
["pnpm","exec","vitest","run","packages/domain/src/scene.test.ts","-t","creates a draft scene at revision one with an immutable configuration snapshot"]
["pnpm","exec","eslint","packages/domain/src/scene.ts","packages/domain/src/scene.test.ts","packages/domain/src/index.ts"]
["pnpm","exec","tsc","--build","packages/domain/tsconfig.json","--force"]
["pnpm","exec","dependency-cruiser","packages/domain/src/scene.ts","packages/domain/src/scene.test.ts","packages/domain/src/index.ts","--config",".dependency-cruiser.cjs"]
```

## Behavioral Invariants

You MUST implement the following behavioral invariants as named tests first (TDD):

- **immutable draft creation**: Creating a Scene yields draft_pending at revision one with no approval or failure origin, and neither retained input aliases nor exposed snapshots can mutate aggregate state. (Test: `creates a draft scene at revision one with an immutable configuration snapshot`)

