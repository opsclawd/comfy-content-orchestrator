import { describe, expect, it, vi } from "vitest";
import {
  Scene,
  type CampaignId,
  type CampaignRecord,
  type SceneConfiguration,
  type SceneId
} from "@cco/domain";
import type {
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork
} from "../ports/index.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { InvalidSceneOrdinalSequenceError } from "./invalid-scene-ordinal-sequence-error.js";
import {
  MaterializeStoryboardUseCase,
  type OrderedSceneConfiguration
} from "./materialize-storyboard.js";
import { SceneConfigurationCountMismatchError } from "./scene-configuration-count-mismatch-error.js";
import { StoryboardPartiallyMaterializedError } from "./storyboard-partially-materialized-error.js";
import { StoryboardMaterializationConflictError } from "./storyboard-materialization-conflict-error.js";

describe("MaterializeStoryboardUseCase", () => {
  const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800" as CampaignId;

  const createSeededCampaign = (totalScenes: number = 3): CampaignRecord => ({
    id: campaignId,
    clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
    title: "Materialization Test Campaign",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes,
    approvedScenes: 0,
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
    idempotencyKey: "test-idempotency-key",
    targetTotalDurationMs: 15000
  });

  const createSceneConfigs = (count: number = 3): OrderedSceneConfiguration[] => {
    return Array.from({ length: count }, (_, i) => ({
      ordinal: i + 1,
      configuration: {
        prompt: `Scene prompt ${i + 1}`,
        referenceIds: [`ref-asset-${i + 1}`],
        engineProfileId: "ltx_25",
        durationMs: i === 0 ? 5001 : 4000 + i * 1000,
        loraConfigurationId: i === 0 ? "lora-a" : null
      } satisfies SceneConfiguration
    }));
  };

  it("happy path: persists exactly N scenes, assigns ordinals explicitly, preserves durationMs, and leaves scenes in draft_pending", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    const configs = createSceneConfigs(3);
    const result = await useCase.execute({
      campaignId,
      scenes: configs
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scenes).toHaveLength(3);

    // Assert scenes in result
    for (let i = 0; i < 3; i++) {
      const sceneSnap = result.scenes[i]!;
      expect(sceneSnap.sequenceIndex).toBe(i + 1);
      // Freshly materialized scenes are created in draft_pending status;
      // if an autoPlanCoordinator is configured and references are bound,
      // first-pass shot planning is triggered post-commit outside the transaction.
      expect(sceneSnap.status).toBe("draft_pending");
      expect(sceneSnap.specRevision).toBe(1);
      expect(sceneSnap.configuration.durationMs).toBe(configs[i]!.configuration.durationMs);
      expect(sceneSnap.configuration.prompt).toBe(configs[i]!.configuration.prompt);
      expect(sceneSnap.configuration.referenceIds).toEqual(configs[i]!.configuration.referenceIds);
      expect(sceneSnap.configuration.loraConfigurationId).toBe(
        configs[i]!.configuration.loraConfigurationId
      );
    }
    expect(result.scenes[0]!.configuration.durationMs).toBe(5001);

    // Assert saved scenes in UoW: each scene was saved exactly once during materialization
    const distinctSavedSceneIds = new Set(uow.savedScenes.map((s) => s.id));
    expect(distinctSavedSceneIds.size).toBe(3);
    expect(uow.savedScenes).toHaveLength(3);

    const persistedScenes = await uow.execute((context) =>
      context.scenes.findByCampaignId!(campaignId)
    );
    expect(persistedScenes).toHaveLength(3);
    expect(persistedScenes.every((s) => s.status === "draft_pending")).toBe(true);

    // No candidate jobs are enqueued by materialization anymore.
    expect(uow.enqueuedJobs).toHaveLength(0);
  });

  it("assigns sequenceIndex strictly from configuration ordinal independent of input array ordering", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    const configs = createSceneConfigs(3);
    // Shuffle: ordinal 3 first, then 1, then 2
    const shuffledConfigs = [configs[2]!, configs[0]!, configs[1]!];

    const result = await useCase.execute({
      campaignId,
      scenes: shuffledConfigs
    });

    expect(result.scenes).toHaveLength(3);
    expect(result.scenes[0]!.sequenceIndex).toBe(1);
    expect(result.scenes[0]!.configuration.prompt).toBe("Scene prompt 1");
    expect(result.scenes[1]!.sequenceIndex).toBe(2);
    expect(result.scenes[1]!.configuration.prompt).toBe("Scene prompt 2");
    expect(result.scenes[2]!.sequenceIndex).toBe(3);
    expect(result.scenes[2]!.configuration.prompt).toBe("Scene prompt 3");
  });

  it("idempotency: replaying same operation returns existing scenes with isIdempotentReplay=true and zero additional writes", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    const configs = createSceneConfigs(3);
    const firstResult = await useCase.execute({
      campaignId,
      scenes: configs
    });

    expect(firstResult.isIdempotentReplay).toBe(false);
    const savedScenesCountAfterFirst = uow.savedScenes.length;

    // Second call with same campaignId
    const secondResult = await useCase.execute({
      campaignId,
      scenes: configs
    });

    expect(secondResult.isIdempotentReplay).toBe(true);
    expect(secondResult.scenes).toHaveLength(3);
    expect(secondResult.scenes.map((s) => s.id)).toEqual(firstResult.scenes.map((s) => s.id));
    expect(secondResult.scenes.map((s) => s.sequenceIndex)).toEqual([1, 2, 3]);

    // No new writes committed
    expect(uow.savedScenes.length).toBe(savedScenesCountAfterFirst);
  });

  it("records completion proof atomically on campaign and verifies proof on replay", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    const configs = createSceneConfigs(3);
    const completionHash = "a".repeat(64);

    const firstResult = await useCase.execute({
      campaignId,
      scenes: configs,
      completionHashSha256: completionHash
    });

    expect(firstResult.isIdempotentReplay).toBe(false);

    // Verify campaign record has completion hash recorded
    const updatedCampaign = await uow.execute((context) => context.campaigns!.findById(campaignId));
    expect(updatedCampaign?.storyboardCompletionHashSha256).toBe(completionHash);

    // Replay with identical completion hash succeeds
    const replayResult = await useCase.execute({
      campaignId,
      scenes: configs,
      completionHashSha256: completionHash
    });
    expect(replayResult.isIdempotentReplay).toBe(true);

    // Replay with different completion hash throws StoryboardMaterializationConflictError
    await expect(
      useCase.execute({
        campaignId,
        scenes: configs,
        completionHashSha256: "b".repeat(64)
      })
    ).rejects.toThrow(StoryboardMaterializationConflictError);
  });

  it("throws SceneConfigurationCountMismatchError when input length does not match campaign.totalScenes", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    // Provide 2 configs instead of 3
    const configs = createSceneConfigs(2);

    await expect(
      useCase.execute({
        campaignId,
        scenes: configs
      })
    ).rejects.toThrow(SceneConfigurationCountMismatchError);

    expect(uow.savedScenes).toHaveLength(0);
  });

  it("throws InvalidSceneOrdinalSequenceError when ordinals contain duplicates or gaps", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    const baseConfig = createSceneConfigs(1)[0]!.configuration;

    // Duplicate ordinals: [1, 1, 3]
    await expect(
      useCase.execute({
        campaignId,
        scenes: [
          { ordinal: 1, configuration: baseConfig },
          { ordinal: 1, configuration: baseConfig },
          { ordinal: 3, configuration: baseConfig }
        ]
      })
    ).rejects.toThrow(InvalidSceneOrdinalSequenceError);

    // Gap in ordinals: [1, 2, 4]
    await expect(
      useCase.execute({
        campaignId,
        scenes: [
          { ordinal: 1, configuration: baseConfig },
          { ordinal: 2, configuration: baseConfig },
          { ordinal: 4, configuration: baseConfig }
        ]
      })
    ).rejects.toThrow(InvalidSceneOrdinalSequenceError);

    // 0-based ordinals: [0, 1, 2]
    await expect(
      useCase.execute({
        campaignId,
        scenes: [
          { ordinal: 0, configuration: baseConfig },
          { ordinal: 1, configuration: baseConfig },
          { ordinal: 2, configuration: baseConfig }
        ]
      })
    ).rejects.toThrow(InvalidSceneOrdinalSequenceError);

    expect(uow.savedScenes).toHaveLength(0);
  });

  it("throws StoryboardPartiallyMaterializedError when partial scenes already exist", async () => {
    const campaign = createSeededCampaign(3);
    const preExistingScene = Scene.create({
      id: "pre-existing-scene-1" as SceneId,
      campaignId,
      configuration: {
        prompt: "Pre-existing",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    // Seed 1 scene when totalScenes is 3
    const uow = new InMemorySceneUnitOfWork([preExistingScene], undefined, undefined, [campaign]);
    const useCase = new MaterializeStoryboardUseCase(uow);

    const configs = createSceneConfigs(3);

    await expect(
      useCase.execute({
        campaignId,
        scenes: configs
      })
    ).rejects.toThrow(StoryboardPartiallyMaterializedError);

    // No new scenes saved
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("throws CampaignNotFoundError when target campaign does not exist", async () => {
    const uow = new InMemorySceneUnitOfWork();
    const useCase = new MaterializeStoryboardUseCase(uow);

    const configs = createSceneConfigs(3);

    await expect(
      useCase.execute({
        campaignId: "non-existent-campaign" as CampaignId,
        scenes: configs
      })
    ).rejects.toThrow(CampaignNotFoundError);
  });

  it("throws Error when context.campaigns is undefined", async () => {
    const fakeUow: UnitOfWork = {
      execute: async (work) => {
        return work({
          scenes: {} as unknown as SceneRepository,
          campaigns: undefined,
          candidates: {} as unknown as StoryboardCandidateRepository,
          reviewEvents: {} as unknown as ReviewEventStore
        });
      }
    };
    const useCase = new MaterializeStoryboardUseCase(fakeUow);

    await expect(
      useCase.execute({
        campaignId,
        scenes: createSceneConfigs(3)
      })
    ).rejects.toThrow(
      "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
    );
  });

  it("auto-triggers planning for each materialized scene with bound references when autoPlanCoordinator is provided", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const coordinator = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };
    const useCase = new MaterializeStoryboardUseCase(uow, coordinator);

    const configs = createSceneConfigs(3);
    const result = await useCase.execute({
      campaignId,
      scenes: configs
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scenes).toHaveLength(3);
    expect(coordinator.prepareAdmission).toHaveBeenCalledTimes(3);
    for (const scene of result.scenes) {
      expect(coordinator.prepareAdmission).toHaveBeenCalledWith({ sceneId: scene.id });
    }
  });

  it("does not auto-trigger planning on idempotent replay", async () => {
    const campaign = createSeededCampaign(3);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const coordinator = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };
    const useCase = new MaterializeStoryboardUseCase(uow, coordinator);

    const configs = createSceneConfigs(3);
    const firstResult = await useCase.execute({
      campaignId,
      scenes: configs
    });
    expect(firstResult.isIdempotentReplay).toBe(false);
    expect(coordinator.prepareAdmission).toHaveBeenCalledTimes(3);

    coordinator.prepareAdmission.mockClear();

    const secondResult = await useCase.execute({
      campaignId,
      scenes: configs
    });
    expect(secondResult.isIdempotentReplay).toBe(true);
    expect(coordinator.prepareAdmission).not.toHaveBeenCalled();
  });

  it("logs warning when coordinator is not configured on materialized scenes with bound references", async () => {
    const campaign = createSeededCampaign(2);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const logger = { warn: vi.fn() };
    const useCase = new MaterializeStoryboardUseCase(uow, undefined, logger);

    const configs = createSceneConfigs(2);
    const result = await useCase.execute({
      campaignId,
      scenes: configs
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scenes).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("planning coordinator is not configured")
    );
  });

  it("logs warning and preserves materialized scenes when post-commit auto-planning encounters error", async () => {
    const campaign = createSeededCampaign(2);
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [campaign]);
    const coordinator = {
      prepareAdmission: vi.fn().mockRejectedValue(new Error("Coordinator failed"))
    };
    const logger = { warn: vi.fn() };
    const useCase = new MaterializeStoryboardUseCase(uow, coordinator, logger);

    const configs = createSceneConfigs(2);
    const result = await useCase.execute({
      campaignId,
      scenes: configs
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scenes).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("First-pass shot-plan auto-trigger failed")
    );
  });
});
