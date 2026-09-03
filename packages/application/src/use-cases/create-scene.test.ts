import { describe, expect, it } from "vitest";
import type { CampaignId, CampaignRecord } from "@cco/domain";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { CreateSceneUseCase } from "./create-scene.js";

describe("CreateSceneUseCase", () => {
  const seededCampaign: CampaignRecord = {
    id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800" as CampaignId,
    clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
    title: "Seeded Campaign",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z"
  };

  it("creates a scene under an existing campaign and lands in draft_pending with specRevision 1", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    const useCase = new CreateSceneUseCase(uow);

    const configuration = {
      prompt: "Dramatic wide angle shot of volcanic caldera",
      referenceIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"],
      engineProfileId: "ltx_25",
      durationMs: 5000,
      loraConfigurationId: "caldera-lora-v1"
    };

    const scene = await useCase.execute({
      campaignId: seededCampaign.id,
      configuration
    });

    expect(scene.id).toBeDefined();
    expect(scene.campaignId).toBe(seededCampaign.id);
    expect(scene.status).toBe("draft_pending");

    const snapshot = scene.snapshot();
    expect(snapshot.specRevision).toBe(1);
    expect(snapshot.configuration.prompt).toBe(configuration.prompt);
    expect(snapshot.configuration.engineProfileId).toBe(configuration.engineProfileId);
    expect(snapshot.configuration.durationMs).toBe(5000);
    expect(snapshot.configuration.loraConfigurationId).toBe("caldera-lora-v1");

    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.savedScenes[0]?.id).toBe(scene.id);
  });

  it("throws CampaignNotFoundError when campaign does not exist", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateSceneUseCase(uow);

    await expect(
      useCase.execute({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899",
        configuration: {
          prompt: "Caldera",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      })
    ).rejects.toThrow(CampaignNotFoundError);
  });

  it("throws clear error when context.campaigns is undefined", async () => {
    const fakeUowWithoutCampaigns: UnitOfWork = {
      execute: async (work) => {
        return work({
          scenes: {} as unknown as SceneRepository,
          reviewEvents: {} as unknown as ReviewEventStore,
          candidates: {} as unknown as StoryboardCandidateRepository,
          campaigns: undefined
        });
      }
    };

    const useCase = new CreateSceneUseCase(fakeUowWithoutCampaigns);

    await expect(
      useCase.execute({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        configuration: {
          prompt: "Caldera",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        }
      })
    ).rejects.toThrow(
      "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
    );
  });
});
