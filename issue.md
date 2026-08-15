# S1-02: Implement the Scene aggregate lifecycle and approval invariants

**Sprint:** 1 — Core Runtime, Domain Boundaries & Hardware Certification
**Story ID:** S1-02
**Depends on:** #1
**Spec source:** `docs/prd.md` §3.6.3, §4.1-§4.4, §9.3

---

## Goal

Implement the pure-domain `Scene` aggregate and its canonical lifecycle so creative-review and production-state invariants are encoded in behavior rather than raw status mutation.

This issue owns the **domain state machine only**. Persistence, HTTP routes, Review Hub UI, and ComfyUI are out of scope.

## Ubiquitous language

Use the terms from `docs/CONTEXT.md`. The canonical Scene states are:

```text
draft_pending
generating_candidates
director_review
approved
queued
rendering
qa
completed
failed
cancelled
```

Allowed transitions must match PRD §4.2.

## Scope

- Implement branded/opaque IDs as appropriate for `SceneId` and `CampaignId` following the repository's domain conventions.
- Implement `SceneStatus` and the `Scene` aggregate.
- Model the minimum Scene data required to enforce Sprint 1 invariants: current status, SceneSpec revision/identity, assigned engine/profile reference, duration, references/LoRA configuration identity, and current approval metadata/revision.
- Expose behavior methods rather than writable status setters, including the domain-equivalent of:
  - begin candidate generation;
  - submit candidates for director review;
  - approve;
  - request reroll / return to generation;
  - queue for production;
  - start rendering;
  - submit for QA;
  - accept QA / complete;
  - reject QA back to review;
  - fail;
  - retry/recover from failed according to the transition matrix;
  - cancel.
- Implement approval invalidation: changing prompt/SceneSpec, reference set, engine, duration, or LoRA configuration after approval invalidates that approval and moves the Scene back to the appropriate review/regeneration state.
- Add typed domain errors for invalid transitions and invalid mutation attempts.
- Ensure terminal semantics are explicit: `completed` and `cancelled` do not silently transition back into active work.

## Domain constraints

- No I/O.
- No PostgreSQL types or repositories.
- No Zod schemas intended for API transport unless they are pure domain validation primitives; transport contracts belong in `packages/contracts`.
- No ComfyUI workflow/node knowledge.
- No provider/model API code.
- No direct public `status = ...` mutation path.

## Automation execution notes

- Read `docs/CONTEXT.md` and PRD §4 before implementation.
- Keep the aggregate small enough to express invariants; do not turn Campaign, RenderJob, or infrastructure state into Scene internals.
- If a behavior requires a future Sprint concept, expose only the domain seam required now rather than implementing adjacent infrastructure.

## Acceptance criteria

- [ ] Every permitted PRD §4.2 transition has a unit test.
- [ ] Representative forbidden transitions have tests that assert a typed domain failure.
- [ ] State cannot be mutated directly from outside the aggregate.
- [ ] Approval is associated with the current SceneSpec/configuration revision, not just a boolean.
- [ ] Prompt/SceneSpec mutation after approval invalidates approval.
- [ ] Reference mutation after approval invalidates approval.
- [ ] Engine mutation after approval invalidates approval.
- [ ] Duration mutation after approval invalidates approval.
- [ ] LoRA mutation after approval invalidates approval.
- [ ] QA rejection returns the Scene to director review without erasing prior lifecycle history at the domain event/result level.
- [ ] `completed` and `cancelled` are terminal in the domain model.
- [ ] `packages/domain` remains free of infrastructure dependencies and passes the boundary gate from #1.

## Test plan

Create table-driven transition tests covering the full transition matrix plus focused invariant tests for approval invalidation and terminal states.

A useful regression criterion: removing the transition guard or approval-revision guard must cause tests to fail.

## Definition of done

Merged with green CI; the Scene lifecycle is authoritative in the domain package; every allowed transition and key forbidden path is tested; approval invalidation is enforced without infrastructure involvement.
