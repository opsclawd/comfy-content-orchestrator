import { describe, expect, it, vi } from "vitest";
import type { CreativeBrief } from "@cco/contracts";
import {
  Scene,
  type CampaignId,
  type CampaignRecord,
  type ClientRecord,
  type ReferenceAssetId,
  type SceneConfiguration
} from "@cco/domain";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ClientNotFoundError } from "./client-not-found-error.js";
import { CreateSceneUseCase } from "./create-scene.js";
import type { PlanSceneConfigurationUseCase } from "./plan-scene-configuration.js";
import {
  PlanningNotAuthorizedError,
  PlanningProviderExhaustedError,
  PlanningSafetyRefusalError
} from "./plan-scene-configuration-errors.js";
import {
  PlanningProviderNotConfiguredError,
  SceneCreationModeMismatchError
} from "./scene-creation-errors.js";
import { SubmitSceneCreationUseCase } from "./submit-scene-creation.js";

describe("SubmitSceneCreationUseCase", () => {
  const validClientId = "client-001";
  const validCampaignId = "campaign-001";

  const cloudEnabledPolicy = {
    allowCloudPlanning: true,
    allowedProviders: ["Anthropic", "OpenAI"],
    sensitiveDataMasking: true
  };

  const cloudDisabledPolicy = {
    allowCloudPlanning: false,
    allowedProviders: [],
    sensitiveDataMasking: true
  };

  const sampleManualConfig: SceneConfiguration = {
    prompt: "Manual prompt: dancers in colorful carnival costume",
    referenceIds: [],
    engineProfileId: "LTX_25_720P_5S_V1",
    durationMs: 5000,
    loraConfigurationId: "test-lora"
  };

  const samplePlannedConfig: SceneConfiguration = {
    prompt: "AI planned prompt: beach sunset with golden flare",
    referenceIds: ["ref-1" as ReferenceAssetId],
    engineProfileId: "LTX_25_720P_5S_V1",
    durationMs: 4000,
    loraConfigurationId: null
  };

  const sampleBrief: CreativeBrief = {
    title: "Beach Sunset",
    description: "Vibrant beach sunset commercial scene",
    targetPlatform: "tiktok"
  };

  function createSeededUow(
    policy: Record<string, unknown> = cloudEnabledPolicy,
    campaignId = validCampaignId,
    clientId = validClientId
  ): InMemorySceneUnitOfWork {
    const campaign: CampaignRecord = {
      id: campaignId as CampaignId,
      clientId,
      title: "Test Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };

    const client: ClientRecord = {
      id: clientId,
      companyName: "Acme Corp",
      brandBibleJson: {},
      defaultAspectRatio: "9:16",
      externalProcessingPolicy: policy,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };

    return new InMemorySceneUnitOfWork([], [], [], [campaign], [client]);
  }

  it("cloud-enabled + brief delegates to planning use case then creates scene", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const planExecuteSpy = vi.fn().mockResolvedValue(samplePlannedConfig);
    const fakePlanSceneUseCase = {
      execute: planExecuteSpy
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    const scene = await useCase.execute({
      campaignId: validCampaignId,
      kind: "brief",
      brief: sampleBrief,
      candidateReferenceAssetIds: ["ref-1" as ReferenceAssetId],
      maxDurationMs: 5000
    });

    expect(planExecuteSpy).toHaveBeenCalledTimes(1);
    expect(planExecuteSpy).toHaveBeenCalledWith({
      brief: sampleBrief,
      campaignId: validCampaignId,
      clientId: validClientId,
      candidateReferenceAssetIds: ["ref-1"],
      externalProcessingPolicy: cloudEnabledPolicy,
      maxDurationMs: 5000
    });

    expect(scene).toBeInstanceOf(Scene);
    const snapshot = scene.snapshot();
    expect(snapshot.campaignId).toBe(validCampaignId);
    expect(snapshot.status).toBe("draft_pending");
    expect(snapshot.configuration).toEqual(samplePlannedConfig);
    expect(uow.savedScenes).toHaveLength(1);
  });

  it("forwards targetDurationMs to planSceneConfiguration.execute", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const planExecuteSpy = vi.fn().mockResolvedValue(samplePlannedConfig);
    const fakePlanSceneUseCase = {
      execute: planExecuteSpy
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    await useCase.execute({
      campaignId: validCampaignId,
      kind: "brief",
      brief: sampleBrief,
      targetDurationMs: 4000
    });

    expect(planExecuteSpy).toHaveBeenCalledTimes(1);
    expect(planExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        targetDurationMs: 4000
      })
    );
  });

  it("cloud-enabled + manual body throws SceneCreationModeMismatchError without planning or scene creation", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const createSceneSpy = vi.spyOn(createScene, "execute");
    const planExecuteSpy = vi.fn();
    const fakePlanSceneUseCase = {
      execute: planExecuteSpy
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "manual",
        configuration: sampleManualConfig
      })
    ).rejects.toThrow(SceneCreationModeMismatchError);

    expect(planExecuteSpy).not.toHaveBeenCalled();
    expect(createSceneSpy).not.toHaveBeenCalled();
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("cloud-disabled + brief throws SceneCreationModeMismatchError without planning or scene creation", async () => {
    const uow = createSeededUow(cloudDisabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const createSceneSpy = vi.spyOn(createScene, "execute");
    const planExecuteSpy = vi.fn();
    const fakePlanSceneUseCase = {
      execute: planExecuteSpy
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(SceneCreationModeMismatchError);

    expect(planExecuteSpy).not.toHaveBeenCalled();
    expect(createSceneSpy).not.toHaveBeenCalled();
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("cloud-disabled + manual configuration delegates straight to createScene without calling planning", async () => {
    const uow = createSeededUow(cloudDisabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const planExecuteSpy = vi.fn();
    const fakePlanSceneUseCase = {
      execute: planExecuteSpy
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    const scene = await useCase.execute({
      campaignId: validCampaignId,
      kind: "manual",
      configuration: sampleManualConfig
    });

    expect(planExecuteSpy).not.toHaveBeenCalled();
    expect(scene).toBeInstanceOf(Scene);
    const snapshot = scene.snapshot();
    expect(snapshot.configuration).toEqual(sampleManualConfig);
    expect(uow.savedScenes).toHaveLength(1);
  });

  it("cloud-enabled but planSceneConfiguration is undefined throws PlanningProviderNotConfiguredError", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene
      // planSceneConfiguration omitted
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(PlanningProviderNotConfiguredError);

    expect(uow.savedScenes).toHaveLength(0);
  });

  it("throws CampaignNotFoundError when campaign does not exist", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene
    });

    await expect(
      useCase.execute({
        campaignId: "nonexistent-campaign",
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(CampaignNotFoundError);
  });

  it("throws ClientNotFoundError when client does not exist", async () => {
    // Seed campaign pointing to a client that is NOT in the clients map
    const campaign: CampaignRecord = {
      id: "orphan-campaign" as CampaignId,
      clientId: "missing-client-id",
      title: "Orphan Campaign",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };
    const uow = new InMemorySceneUnitOfWork([], [], [], [campaign], []);
    const createScene = new CreateSceneUseCase(uow);

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene
    });

    await expect(
      useCase.execute({
        campaignId: "orphan-campaign",
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(ClientNotFoundError);
  });

  it("throws error when UnitOfWorkContext.campaigns is undefined (not a raw TypeError)", async () => {
    const brokenUow: UnitOfWork = {
      execute: async <TResult>(
        work: (ctx: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> => {
        return work({} as unknown as UnitOfWorkContext); // campaigns and clients undefined
      }
    };

    const createScene = new CreateSceneUseCase(brokenUow);
    const useCase = new SubmitSceneCreationUseCase({
      uow: brokenUow,
      createScene
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(
      "UnitOfWorkContext.campaigns is not configured for this UnitOfWork implementation."
    );
  });

  it("throws error when UnitOfWorkContext.clients is undefined (not a raw TypeError)", async () => {
    const brokenUow: UnitOfWork = {
      execute: async <TResult>(
        work: (ctx: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> => {
        return work({
          campaigns: {
            findById: async () => ({
              id: validCampaignId as CampaignId,
              clientId: validClientId,
              title: "Test",
              targetPlatform: "tiktok",
              status: "drafting",
              totalScenes: 1,
              approvedScenes: 0,
              createdAt: "2026-09-03T12:00:00.000Z",
              updatedAt: "2026-09-03T12:00:00.000Z"
            }),
            save: async () => {}
          }
          // clients: undefined
        } as unknown as UnitOfWorkContext);
      }
    };

    const createScene = new CreateSceneUseCase(brokenUow);
    const useCase = new SubmitSceneCreationUseCase({
      uow: brokenUow,
      createScene
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(
      "UnitOfWorkContext.clients is not configured for this UnitOfWork implementation."
    );
  });

  it("propagates PlanningProviderExhaustedError and creates no scene", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const createSceneSpy = vi.spyOn(createScene, "execute");
    const fakePlanSceneUseCase = {
      execute: vi.fn().mockRejectedValue(
        new PlanningProviderExhaustedError("Exhausted", [
          { provider: "Anthropic", failureReason: "Failed 1" },
          { provider: "OpenAI", failureReason: "Failed 2" }
        ])
      )
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(PlanningProviderExhaustedError);

    expect(createSceneSpy).not.toHaveBeenCalled();
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("propagates PlanningSafetyRefusalError and creates no scene", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const createSceneSpy = vi.spyOn(createScene, "execute");
    const fakePlanSceneUseCase = {
      execute: vi
        .fn()
        .mockRejectedValue(
          new PlanningSafetyRefusalError("Safety refusal", { provider: "Anthropic" })
        )
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(PlanningSafetyRefusalError);

    expect(createSceneSpy).not.toHaveBeenCalled();
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("propagates PlanningNotAuthorizedError and creates no scene", async () => {
    const uow = createSeededUow(cloudEnabledPolicy);
    const createScene = new CreateSceneUseCase(uow);
    const createSceneSpy = vi.spyOn(createScene, "execute");
    const fakePlanSceneUseCase = {
      execute: vi.fn().mockRejectedValue(new PlanningNotAuthorizedError("Not authorized"))
    } as unknown as PlanSceneConfigurationUseCase;

    const useCase = new SubmitSceneCreationUseCase({
      uow,
      createScene,
      planSceneConfiguration: fakePlanSceneUseCase
    });

    await expect(
      useCase.execute({
        campaignId: validCampaignId,
        kind: "brief",
        brief: sampleBrief
      })
    ).rejects.toThrow(PlanningNotAuthorizedError);

    expect(createSceneSpy).not.toHaveBeenCalled();
    expect(uow.savedScenes).toHaveLength(0);
  });
});
