<!-- plan-review-required -->
# Scene Aggregate Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a pure-domain `Scene` aggregate whose public behaviors enforce the canonical PRD lifecycle, revision-bound approval, creative-mutation invalidation, failure recovery, and terminal-state rules.

**Architecture:** Add one focused domain module containing Scene value types, errors, and the aggregate, then re-export it from the domain package entry point. The aggregate owns all mutable state, exposes immutable snapshots and transition facts, and accepts caller-provided approval metadata so it performs no I/O or clock access. Table-driven Vitest coverage is the executable transition contract.

**Tech Stack:** TypeScript 5.7 in strict NodeNext mode, Vitest 2, ESLint 9, pnpm workspaces, dependency-cruiser.

---

## Goal

Make `packages/domain` authoritative for Scene lifecycle and approval validity. Consumers must be able to create a draft Scene, drive every transition permitted by PRD §4.2 through named behavior methods, inspect immutable state, and receive typed failures for all disallowed state changes.

## Non-goals

- Persistence, repositories, database enums, transactions, or migrations.
- HTTP/API schemas, Zod transport contracts, controllers, or Review Hub UI.
- Review-event persistence or a full in-memory event history. Methods return immutable transition facts as the domain seam that a later application service can record.
- Campaign, RenderJob, RenderLease, GenerationManifest, or provider implementation.
- ComfyUI workflow/node knowledge, engine execution, or object-storage behavior.
- General-purpose validation of identifiers, prompt syntax, engine profiles, durations, references, or LoRA payloads beyond what lifecycle invariants require.
- Changes to an application port or interface; therefore no adapter update is required by this plan.

## Assumptions and domain decisions

- `SceneId` and `CampaignId` are compile-time branded strings. Parsing and validation remain boundary concerns.
- `Scene.create` always creates `draft_pending` at revision `1`; persistence rehydration is deferred with persistence itself.
- The minimal creative configuration is prompt text, ordered reference identities, engine/profile identity, duration in milliseconds, and an optional LoRA configuration identity. Inputs and exposed snapshots are defensively copied so callers cannot mutate aggregate state through an array reference.
- Each explicit creative update is a new revision, even if the supplied primitive value equals the current value. This preserves the design's monotonic command/revision semantics and avoids domain-level deep identity rules that are not specified.
- Creative updates are accepted only in `draft_pending`, `director_review`, and `approved`. Updates in generation or production states throw `InvalidMutationError`; updates in `completed` or `cancelled` throw `TerminalStateError`.
- An update while `approved` clears approval and returns the Scene to `director_review`. If regeneration is desired, the caller then invokes `requestReroll`; this keeps mutation invalidation separate from the explicit generation transition.
- Approval metadata consists of the current spec revision plus caller-supplied `approvedBy` and immutable ISO-8601 `approvedAt` text. Moving through queued/rendering/QA retains that approval while the revision is unchanged. Returning to review clears it.
- `failed` retains the state from which failure occurred. A generating-candidates failure has no production approval and cannot retry directly to `queued`; queued/rendering/QA failures retain a current approval and may retry to `queued`. All failures may recover to review or be cancelled.
- Lifecycle methods return a frozen `SceneTransition` containing scene identity, source state, destination state, current revision, and a reason. In particular, `rejectQA()` returns evidence of `qa -> director_review`; durable ReviewEvent storage remains an application-layer responsibility.

## Affected files

- `packages/domain/src/scene.ts` — new Scene value types, immutable public contracts, typed errors, transition map, and aggregate behavior.
- `packages/domain/src/scene.test.ts` — new table-driven lifecycle, failure recovery, approval, mutation, immutability, and terminal-state tests.
- `packages/domain/src/index.ts` — re-export the Scene domain API while retaining the existing skeleton export for compatibility.

## Behavioral invariants

The named cases below are written before their corresponding implementation and are repeated in each task's acceptance criteria and in `task-manifest.json`.

1. `creates a draft scene at revision one with an immutable configuration snapshot`: creation fixes the initial state and external mutation of inputs or snapshots cannot alter aggregate state.
2. `allows every canonical scene transition through its behavior method`: every edge in PRD §4.2 is reachable only through the named behavior that represents its trigger.
3. `rejects representative transitions absent from the canonical matrix`: a non-terminal invalid edge throws `InvalidTransitionError` and changes no state.
4. `treats completed and cancelled scenes as terminal`: every lifecycle entry point on either terminal state throws `TerminalStateError` and changes no state.
5. `records failure origin and permits only approved production failures to retry`: `fail()` records its source; queued/rendering/QA failures can return to queued while generating-candidates failures cannot bypass review and approval.
6. `returns an immutable QA rejection transition without erasing prior state facts`: QA rejection returns `qa -> director_review` with the current revision, clears current approval, and leaves the returned fact unchanged by later activity.
7. `binds approval metadata to the current scene revision`: approval is possible only in director review and records the exact revision, actor, and supplied timestamp.
8. `invalidates approval for every creative mutation`: prompt, references, engine, duration, and LoRA updates each increment revision, clear approval, and move an approved Scene to director review.
9. `keeps editable non-approved scenes in place while advancing revision`: mutations in draft or director review advance revision without an implicit lifecycle transition.
10. `rejects creative mutation during generation and production`: mutations in generating-candidates, queued, rendering, QA, or failed throw `InvalidMutationError` without changing configuration, revision, approval, or status.
11. `rejects every creative mutation in terminal states`: mutations in completed or cancelled throw `TerminalStateError` without changing state.

## Task 1: Define Scene domain contracts and typed errors

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

## Task 2: Implement the canonical lifecycle and failure recovery

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

## Task 3: Enforce revision-bound approval and creative mutation rules

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
