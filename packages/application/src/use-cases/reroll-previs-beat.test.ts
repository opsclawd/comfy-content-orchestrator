import { describe, expect, it, vi } from "vitest";
import {
  compileStoryboardPrevisPrompt,
  STORYBOARD_PREVIS_WORKFLOW_TEMPLATE
} from "../shot-plan-compiler/index.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { deriveStoryboardPrevisRerollSeed, deriveStoryboardPrevisSeed } from "./plan-shot-plans.js";
import {
  InvalidSceneStateForPrevisRerollError,
  PrevisBeatNotFoundError,
  RerollPrevisBeatUseCase,
  StalePrevisCandidateConflictError
} from "./reroll-previs-beat.js";
import { StaleRevisionConflictError } from "./stale-revision-conflict-error.js";
import { ShotPlanNotFoundError } from "./plan-shot-plans-errors.js";

const SCENE_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";

function beat(beatIndex: number) {
  return {
    beatIndex,
    startMs: (beatIndex - 1) * 1000,
    endMs: beatIndex * 1000,
    description: `beat ${beatIndex}`,
    cameraAction: "static",
    subjectAction: "stands"
  };
}

function makeHarness(
  overrides: {
    sceneStatus?: string;
    sceneRevision?: number;
    planRevision?: number;
    currentCandidateId?: string;
    candidateCount?: number;
  } = {}
) {
  const plan = {
    id: PLAN_ID,
    sceneId: SCENE_ID,
    specRevision: overrides.planRevision ?? 1,
    variantOrdinal: 2,
    framing: "medium",
    angle: "eye_level",
    cameraPosition: "street level",
    lensIntent: "35mm",
    actionSummary: "A person walks across a plaza",
    lightingStyle: "overcast_diffused",
    environmentDescription: "a plaza",
    beats: [beat(1), beat(2)],
    previsAssociations: [
      { beatIndex: 2, candidateId: overrides.currentCandidateId ?? CANDIDATE_ID }
    ]
  };
  const scene = {
    id: SCENE_ID,
    status: overrides.sceneStatus ?? "director_review",
    specRevision: overrides.sceneRevision ?? 1
  };
  const enqueue = vi.fn(async () => ({ jobId: "job-1" }));
  const save = vi.fn();
  const candidates = Array.from({ length: overrides.candidateCount ?? 1 }, () => ({
    variantOrdinal: 2,
    beatIndex: 2
  }));
  const context = {
    scenes: { findById: async () => scene, save },
    shotPlans: { findById: async (id: string) => (id === PLAN_ID ? plan : undefined) },
    candidates: { listBySceneAndRevision: async () => candidates },
    jobs: { enqueue }
  } as unknown as UnitOfWorkContext;
  const uow: UnitOfWork = { execute: (work) => work(context) };
  return { plan, scene, enqueue, save, useCase: new RerollPrevisBeatUseCase(uow) };
}

const baseInput = {
  sceneId: SCENE_ID,
  shotPlanId: PLAN_ID,
  beatIndex: 2,
  expectedCandidateId: CANDIDATE_ID
};

describe("deriveStoryboardPrevisRerollSeed", () => {
  it("never equals an original seed and rejects ordinal 0", () => {
    const originals = new Set<number>();
    for (let v = 1; v <= 5; v++) {
      for (let b = 0; b < 100; b++) originals.add(deriveStoryboardPrevisSeed(v, b));
    }
    for (let v = 1; v <= 5; v++) {
      for (let b = 0; b < 100; b++) {
        for (let r = 1; r <= 10; r++) {
          expect(originals.has(deriveStoryboardPrevisRerollSeed(v, b, r))).toBe(false);
        }
      }
    }
    expect(() => deriveStoryboardPrevisRerollSeed(1, 0, 0)).toThrow(RangeError);
  });
});

describe("RerollPrevisBeatUseCase", () => {
  it("enqueues one job with the unchanged prompt and a new seed", async () => {
    const h = makeHarness();
    const result = await h.useCase.execute(baseInput);

    expect(h.enqueue).toHaveBeenCalledTimes(1);
    const call = (h.enqueue.mock.calls[0] as unknown as [Record<string, unknown>])[0] as {
      workflowTemplate: string;
      jobKind: string;
      injectedPayload: Record<string, unknown>;
    };
    const expected = compileStoryboardPrevisPrompt(h.plan as never, h.plan.beats[1] as never);
    expect(call.workflowTemplate).toBe(STORYBOARD_PREVIS_WORKFLOW_TEMPLATE);
    expect(call.jobKind).toBe("candidate");
    expect(call.injectedPayload.prompt).toBe(expected.prompt);
    expect(call.injectedPayload.negativePrompt).toBe(expected.negativePrompt);
    expect(call.injectedPayload.beatIndex).toBe(2);
    expect(call.injectedPayload.seed).toBe(deriveStoryboardPrevisRerollSeed(2, 1, 1));
    expect(call.injectedPayload.seed).not.toBe(deriveStoryboardPrevisSeed(2, 1));
    expect(result).toMatchObject({ jobId: "job-1", beatIndex: 2, seed: call.injectedPayload.seed });
    expect(h.save).not.toHaveBeenCalled();
  });

  it("uses a higher reroll ordinal when earlier candidates exist", async () => {
    const h = makeHarness({ candidateCount: 3 });
    const result = await h.useCase.execute(baseInput);
    expect(result.seed).toBe(deriveStoryboardPrevisRerollSeed(2, 1, 3));
  });

  it("rejects a stale expectedCandidateId", async () => {
    const h = makeHarness({ currentCandidateId: "44444444-4444-4444-8444-444444444444" });
    await expect(h.useCase.execute(baseInput)).rejects.toBeInstanceOf(
      StalePrevisCandidateConflictError
    );
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a non-current plan revision", async () => {
    const h = makeHarness({ planRevision: 1, sceneRevision: 2 });
    await expect(h.useCase.execute(baseInput)).rejects.toBeInstanceOf(StaleRevisionConflictError);
  });

  it("rejects an unknown beat", async () => {
    const h = makeHarness();
    await expect(h.useCase.execute({ ...baseInput, beatIndex: 9 })).rejects.toBeInstanceOf(
      PrevisBeatNotFoundError
    );
  });

  it("rejects an unknown shot plan", async () => {
    const h = makeHarness();
    await expect(
      h.useCase.execute({ ...baseInput, shotPlanId: "55555555-5555-4555-8555-555555555555" })
    ).rejects.toBeInstanceOf(ShotPlanNotFoundError);
  });

  it.each(["completed", "cancelled", "failed"])("rejects a %s scene", async (status) => {
    const h = makeHarness({ sceneStatus: status });
    await expect(h.useCase.execute(baseInput)).rejects.toBeInstanceOf(
      InvalidSceneStateForPrevisRerollError
    );
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
