import { describe, expect, it, vi } from "vitest";
import {
  Scene,
  ShotPlan,
  type CampaignId,
  type CampaignRecord,
  type ReferenceAssetId,
  type SceneId,
  type ShotPlanId
} from "@cco/domain";
import type { ShotPlanPlanningAdmissionPort } from "@cco/application";
import { InMemorySceneUnitOfWork } from "../../../../../packages/application/src/test-support/in-memory-scene-unit-of-work.js";
import { createControlApiApp } from "../app.js";
import type { ShotPlanPlanningCoordinator } from "../../shot-plan-planning-coordinator.js";

describe("Review Command Auto-Planning on Reference Change", () => {
  const seededCampaign: CampaignRecord = {
    id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800" as CampaignId,
    clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
    title: "Auto-Planning Test Campaign",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z"
  };

  const sceneUuid = "018e69e0-8a6a-72cb-b1b7-ec79a1f73803" as SceneId;
  const refAsset1 = "018e69e0-8a6a-72cb-b1b7-ec79a1f73804" as ReferenceAssetId;

  const appOptions = {
    reviewerIdentityResolver: {
      resolve: () => "Test Reviewer"
    }
  };

  it("auto-triggers planning coordinator when binding references to a fresh draft_pending scene", async () => {
    const scene = Scene.create({
      id: sceneUuid,
      campaignId: seededCampaign.id,
      configuration: {
        prompt: "A fresh scene without initial references",
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });

    const uow = new InMemorySceneUnitOfWork([scene], undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAsset1,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "1".repeat(64)
    });

    const mockCoordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };

    const app = createControlApiApp(
      {
        uow,
        planningCoordinator: mockCoordinator as unknown as ShotPlanPlanningCoordinator
      },
      appOptions
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "11111111-1111-4111-8111-111111111111",
        sceneId: sceneUuid,
        expectedSpecRevision: 1,
        action: "reference_change",
        payload: {
          referenceIds: [refAsset1]
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mockCoordinator.prepareAdmission).toHaveBeenCalledTimes(1);
    expect(mockCoordinator.prepareAdmission).toHaveBeenCalledWith({ sceneId: sceneUuid });
  });

  it("does not auto-trigger planning when scene is already in director_review", async () => {
    const scene = Scene.reconstitute({
      id: sceneUuid,
      campaignId: seededCampaign.id,
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "A scene already in review",
        engineProfileId: "ltx_25",
        durationMs: 5000,
        referenceIds: [refAsset1]
      },
      sequenceIndex: 1
    });

    const uow = new InMemorySceneUnitOfWork([scene], undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAsset1,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "1".repeat(64)
    });

    const mockCoordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };

    const app = createControlApiApp(
      {
        uow,
        planningCoordinator: mockCoordinator as unknown as ShotPlanPlanningCoordinator
      },
      appOptions
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "22222222-2222-4222-8222-222222222222",
        sceneId: sceneUuid,
        expectedSpecRevision: 1,
        action: "reference_change",
        payload: {
          referenceIds: [refAsset1]
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mockCoordinator.prepareAdmission).not.toHaveBeenCalled();
  });

  it("does not auto-trigger planning when scene already has shot plans at current revision", async () => {
    const scene = Scene.create({
      id: sceneUuid,
      campaignId: seededCampaign.id,
      configuration: {
        prompt: "A scene with existing shot plan",
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });

    const shotPlan = ShotPlan.reconstitute({
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73809" as ShotPlanId,
      sceneId: sceneUuid,
      specRevision: 2,
      variantOrdinal: 1,
      status: "draft",
      routingMode: "reference_directed",
      targetDurationMs: 5000,
      targetFrameCount: 120,
      durationToleranceMs: 355,
      fps: 24,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "35mm prime",
      cameraPosition: "eye level tripod",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Wide static shot",
      actionSummary: "Hero stands",
      lightingStyle: "neon_night",
      environmentDescription: "Rainy alley",
      colorPalette: ["#ff0055"],
      subjects: [],
      beats: [],
      continuity: {
        incomingContinuityFromSceneId: null,
        persistentSubjectIds: [],
        lightingContinuityNote: null,
        frameAnchorTarget: "none",
        anchorCandidateId: null,
        anchorMediaHashSha256: null
      },
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    });

    const uow = new InMemorySceneUnitOfWork([scene], undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAsset1,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "1".repeat(64)
    });
    await uow.execute(async (ctx) => {
      await ctx.shotPlans!.save(shotPlan);
    });

    const mockCoordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };

    const app = createControlApiApp(
      {
        uow,
        planningCoordinator: mockCoordinator as unknown as ShotPlanPlanningCoordinator
      },
      appOptions
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "33333333-3333-4333-8333-333333333333",
        sceneId: sceneUuid,
        expectedSpecRevision: 1,
        action: "reference_change",
        payload: {
          referenceIds: [refAsset1]
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mockCoordinator.prepareAdmission).not.toHaveBeenCalled();
  });

  it("auto-triggers planning when scene has only historical-revision shot plans", async () => {
    const scene = Scene.reconstitute({
      id: sceneUuid,
      campaignId: seededCampaign.id,
      status: "draft_pending",
      specRevision: 2,
      configuration: {
        prompt: "A scene at revision 2",
        engineProfileId: "ltx_25",
        durationMs: 5000,
        referenceIds: []
      },
      sequenceIndex: 1
    });

    const shotPlanRev1 = ShotPlan.reconstitute({
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73809" as ShotPlanId,
      sceneId: sceneUuid,
      specRevision: 1,
      variantOrdinal: 1,
      status: "draft",
      routingMode: "reference_directed",
      targetDurationMs: 5000,
      targetFrameCount: 120,
      durationToleranceMs: 355,
      fps: 24,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "35mm prime",
      cameraPosition: "eye level tripod",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Wide static shot",
      actionSummary: "Hero stands",
      lightingStyle: "neon_night",
      environmentDescription: "Rainy alley",
      colorPalette: ["#ff0055"],
      subjects: [],
      beats: [],
      continuity: {
        incomingContinuityFromSceneId: null,
        persistentSubjectIds: [],
        lightingContinuityNote: null,
        frameAnchorTarget: "none",
        anchorCandidateId: null,
        anchorMediaHashSha256: null
      },
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    });

    const uow = new InMemorySceneUnitOfWork([scene], undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAsset1,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "1".repeat(64)
    });
    await uow.execute(async (ctx) => {
      await ctx.shotPlans!.save(shotPlanRev1);
    });

    const mockCoordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };

    const app = createControlApiApp(
      {
        uow,
        planningCoordinator: mockCoordinator as unknown as ShotPlanPlanningCoordinator
      },
      appOptions
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneUuid}/review-command`,
      payload: {
        actionId: "44444444-4444-4444-8444-444444444444",
        sceneId: sceneUuid,
        expectedSpecRevision: 2,
        action: "reference_change",
        payload: {
          referenceIds: [refAsset1]
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(mockCoordinator.prepareAdmission).toHaveBeenCalledTimes(1);
    expect(mockCoordinator.prepareAdmission).toHaveBeenCalledWith({ sceneId: sceneUuid });
  });
});
