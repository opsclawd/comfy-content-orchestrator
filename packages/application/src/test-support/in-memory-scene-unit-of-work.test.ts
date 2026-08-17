import { describe, expect, it } from "vitest";
import {
  Scene,
  type CampaignId,
  type CandidateId,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import type { ReviewEvent } from "@cco/contracts";
import { InMemorySceneUnitOfWork } from "./in-memory-scene-unit-of-work.js";

describe("InMemorySceneUnitOfWork", () => {
  const createTestScene = (id: string = "scene-1"): Scene => {
    return Scene.create({
      id: id as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A cinematic shot of a mountain sunrise",
        referenceIds: ["ref-1"],
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });
  };

  const createTestReviewEvent = (sceneId: string = "scene-1"): ReviewEvent => {
    return {
      eventId: "event-1",
      sceneId,
      reviewerName: "Director Alice",
      action: "approve",
      directorNotes: "Looks great",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "approved",
      occurredAt: "2026-08-15T00:00:00.000Z"
    };
  };

  const createTestCandidate = (
    id: string = "candidate-1",
    sceneId: string = "scene-1",
    specRevision: number = 1
  ): StoryboardCandidate => {
    return {
      id: id as CandidateId,
      sceneId: sceneId as SceneId,
      specRevision,
      variantOrdinal: 1,
      locator: `candidates/${sceneId}/${id}.webp`,
      contentHash: "hash-cand-1",
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    };
  };

  it("commits one staged scene save and review event when the unit of work succeeds", async () => {
    const scene = createTestScene();
    const event = createTestReviewEvent();
    const uow = new InMemorySceneUnitOfWork([scene]);

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);

    const result = await uow.execute(async (context) => {
      const found = await context.scenes.findById(scene.id);
      expect(found).toBe(scene);

      await context.scenes.save(scene);
      await context.reviewEvents.append(event);

      // In-flight assertion: committed collections remain empty while callback is executing
      expect(uow.savedScenes).toHaveLength(0);
      expect(uow.reviewEvents).toHaveLength(0);

      return "success-result";
    });

    expect(result).toBe("success-result");
    expect(uow.savedScenes).toEqual([scene]);
    expect(uow.reviewEvents).toEqual([event]);
  });

  it("commits staged candidates on success and queries via findBySceneRevision", async () => {
    const candidate = createTestCandidate("cand-1", "scene-1", 1);
    const uow = new InMemorySceneUnitOfWork([], [candidate]);

    expect(uow.savedCandidates).toHaveLength(0);

    await uow.execute(async (context) => {
      const found = await context.candidates.findById("cand-1" as CandidateId);
      expect(found).toEqual(candidate);

      const byRev = await context.candidates.findBySceneRevision("scene-1", 1);
      expect(byRev).toEqual([candidate]);

      const newCand = createTestCandidate("cand-2", "scene-1", 1);
      await context.candidates.save(newCand);
    });

    expect(uow.savedCandidates).toHaveLength(1);
    expect(uow.savedCandidates[0]!.id).toBe("cand-2");
  });

  it("publishes no staged scene saves or review events when the unit of work callback throws", async () => {
    const scene = createTestScene();
    const event = createTestReviewEvent();
    const candidate = createTestCandidate();
    const uow = new InMemorySceneUnitOfWork([scene]);

    await expect(
      uow.execute(async (context) => {
        await context.scenes.save(scene);
        await context.reviewEvents.append(event);
        await context.candidates.save(candidate);

        expect(uow.savedScenes).toHaveLength(0);
        expect(uow.savedCandidates).toHaveLength(0);
        expect(uow.reviewEvents).toHaveLength(0);

        throw new Error("Simulated unit-of-work failure");
      })
    ).rejects.toThrow("Simulated unit-of-work failure");

    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.savedCandidates).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("returns undefined without recording a save when a scene is absent", async () => {
    const uow = new InMemorySceneUnitOfWork();

    const result = await uow.execute(async (context) => {
      const absentScene = await context.scenes.findById("missing-scene" as SceneId);
      expect(absentScene).toBeUndefined();
      return absentScene;
    });

    expect(result).toBeUndefined();
    expect(uow.savedScenes).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });
});
