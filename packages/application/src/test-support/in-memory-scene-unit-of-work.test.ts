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

  it("publishes no staged scene saves or review events when the unit of work callback throws", async () => {
    const scene = createTestScene();
    const event = createTestReviewEvent();
    const uow = new InMemorySceneUnitOfWork([scene]);

    await expect(
      uow.execute(async (context) => {
        await context.scenes.save(scene);
        await context.reviewEvents.append(event);

        expect(uow.savedScenes).toHaveLength(0);
        expect(uow.reviewEvents).toHaveLength(0);

        throw new Error("Simulated unit-of-work failure");
      })
    ).rejects.toThrow("Simulated unit-of-work failure");

    expect(uow.savedScenes).toHaveLength(0);
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

  it("inserts candidates, filters by scene and revision sorted by variantOrdinal ascending, and rolls back on failure", async () => {
    const createTestCandidate = (
      id: string,
      sceneId: string,
      revision: number,
      variantOrdinal: number
    ): StoryboardCandidate => ({
      id: id as CandidateId,
      sceneId: sceneId as SceneId,
      specRevision: revision,
      variantOrdinal,
      locator: `candidates/${sceneId}/${id}.webp`,
      contentHash: `hash-${id}`,
      generationMetadata: {},
      createdAt: "2026-08-15T00:00:00.000Z"
    });

    const c1Rev1Var2 = createTestCandidate("c-1", "scene-1", 1, 2);
    const c2Rev1Var1 = createTestCandidate("c-2", "scene-1", 1, 1);
    const c3Rev2Var1 = createTestCandidate("c-3", "scene-1", 2, 1);
    const c4Scene2Var1 = createTestCandidate("c-4", "scene-2", 1, 1);

    const uow = new InMemorySceneUnitOfWork(
      [],
      [c1Rev1Var2, c2Rev1Var1, c3Rev2Var1, c4Scene2Var1]
    );

    // Initial listing sorted by variantOrdinal
    await uow.execute(async (context) => {
      const scene1Rev1 = await context.candidates.listBySceneAndRevision("scene-1" as SceneId, 1);
      expect(scene1Rev1).toHaveLength(2);
      expect(scene1Rev1[0]?.id).toBe("c-2");
      expect(scene1Rev1[1]?.id).toBe("c-1");

      const scene1Rev2 = await context.candidates.listBySceneAndRevision("scene-1" as SceneId, 2);
      expect(scene1Rev2).toHaveLength(1);
      expect(scene1Rev2[0]?.id).toBe("c-3");

      const scene2Rev1 = await context.candidates.listBySceneAndRevision("scene-2" as SceneId, 1);
      expect(scene2Rev1).toHaveLength(1);
      expect(scene2Rev1[0]?.id).toBe("c-4");
    });

    // Insertion during execute is staged and committed
    const c5Rev1Var3 = createTestCandidate("c-5", "scene-1", 1, 3);
    await uow.execute(async (context) => {
      await context.candidates.insert(c5Rev1Var3);
      const foundInScope = await context.candidates.findById("c-5" as CandidateId);
      expect(foundInScope).toEqual(c5Rev1Var3);

      const inFlightList = await context.candidates.listBySceneAndRevision("scene-1" as SceneId, 1);
      expect(inFlightList).toHaveLength(3);
      expect(inFlightList.map((c) => c.id)).toEqual(["c-2", "c-1", "c-5"]);
    });

    // Subsequent execute finds newly committed candidate
    await uow.execute(async (context) => {
      const foundAfterCommit = await context.candidates.findById("c-5" as CandidateId);
      expect(foundAfterCommit).toEqual(c5Rev1Var3);

      const listAfterCommit = await context.candidates.listBySceneAndRevision(
        "scene-1" as SceneId,
        1
      );
      expect(listAfterCommit).toHaveLength(3);
      expect(listAfterCommit.map((c) => c.id)).toEqual(["c-2", "c-1", "c-5"]);
    });

    // Rollback test for candidate insert
    const c6Rev1Var4 = createTestCandidate("c-6", "scene-1", 1, 4);
    await expect(
      uow.execute(async (context) => {
        await context.candidates.insert(c6Rev1Var4);
        throw new Error("Candidate rollback error");
      })
    ).rejects.toThrow("Candidate rollback error");

    await uow.execute(async (context) => {
      const rolledBack = await context.candidates.findById("c-6" as CandidateId);
      expect(rolledBack).toBeUndefined();
      const listAfterRollback = await context.candidates.listBySceneAndRevision(
        "scene-1" as SceneId,
        1
      );
      expect(listAfterRollback).toHaveLength(3);
    });
  });

  it("finds review events by ID from staged events in-flight and from committed events in subsequent runs", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const event1 = createTestReviewEvent("scene-1");
    const event2: ReviewEvent = {
      ...createTestReviewEvent("scene-2"),
      eventId: "event-2"
    };

    await uow.execute(async (context) => {
      expect(await context.reviewEvents.findById("event-1")).toBeUndefined();
      await context.reviewEvents.append(event1);

      // Staged event is findable within the same unit of work
      const stagedFound = await context.reviewEvents.findById("event-1");
      expect(stagedFound).toEqual(event1);
    });

    // After commit, event1 is findable in a new unit of work
    await uow.execute(async (context) => {
      const committedFound = await context.reviewEvents.findById("event-1");
      expect(committedFound).toEqual(event1);

      await context.reviewEvents.append(event2);
      expect(await context.reviewEvents.findById("event-2")).toEqual(event2);
      expect(await context.reviewEvents.findById("event-1")).toEqual(event1);
      expect(await context.reviewEvents.findById("non-existent")).toBeUndefined();
    });
  });
});
