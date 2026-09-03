import { describe, expect, it } from "vitest";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CreateCampaignUseCase } from "./create-campaign.js";

describe("CreateCampaignUseCase", () => {
  it("creates a campaign with explicit fields and persists it", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignUseCase(uow);

    const result = await useCase.execute({
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      title: "Holiday Spectacular 2026",
      targetPlatform: "tiktok",
      totalScenes: 5
    });

    expect(result.id).toBeDefined();
    expect(result.clientId).toBe("018e69e0-8a6a-72cb-b1b7-ec79a1f73801");
    expect(result.title).toBe("Holiday Spectacular 2026");
    expect(result.targetPlatform).toBe("tiktok");
    expect(result.status).toBe("drafting");
    expect(result.totalScenes).toBe(5);
    expect(result.approvedScenes).toBe(0);
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBe(result.createdAt);

    expect(uow.savedCampaigns).toHaveLength(1);
    expect(uow.savedCampaigns[0]).toEqual(result);
  });

  it("applies default targetPlatform ('instagram_reels') and totalScenes (1) when omitted", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new CreateCampaignUseCase(uow);

    const result = await useCase.execute({
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      title: "Minimal Campaign"
    });

    expect(result.targetPlatform).toBe("instagram_reels");
    expect(result.totalScenes).toBe(1);
    expect(result.status).toBe("drafting");
    expect(result.approvedScenes).toBe(0);
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

    const useCase = new CreateCampaignUseCase(fakeUowWithoutCampaigns);

    await expect(
      useCase.execute({
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        title: "Will Fail"
      })
    ).rejects.toThrow(
      "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
    );
  });
});
