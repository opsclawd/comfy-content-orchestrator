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
import type { ShotPlanPlanningAdmissionPort } from "../ports/shot-plan-planning-admission-port.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { triggerFirstPassShotPlanningIfEligible } from "./auto-plan-first-pass.js";

describe("triggerFirstPassShotPlanningIfEligible", () => {
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

  const refAssetId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73802" as ReferenceAssetId;

  it("triggers coordinator admission for fresh draft_pending scene with bound references and no shot plans", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAssetId,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/hero.png",
      contentHashSha256: "a".repeat(64)
    });

    const scene = Scene.create({
      id: "scene-1" as SceneId,
      campaignId: seededCampaign.id,
      configuration: {
        prompt: "A cinematic hero shot",
        engineProfileId: "ltx_25",
        durationMs: 5000,
        referenceBindings: [{ referenceAssetId: refAssetId, role: "subject_identity", weight: 0.8 }]
      }
    });
    await uow.execute(async (ctx) => {
      await ctx.scenes.save(scene);
    });

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: scene.id,
      uow,
      coordinator
    });

    expect(result.triggered).toBe(true);
    expect(coordinator.prepareAdmission).toHaveBeenCalledTimes(1);
    expect(coordinator.prepareAdmission).toHaveBeenCalledWith({ sceneId: scene.id });
  });

  it("does not trigger when scene has no reference bindings", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    const scene = Scene.create({
      id: "scene-no-refs" as SceneId,
      campaignId: seededCampaign.id,
      configuration: {
        prompt: "A scene with no references",
        engineProfileId: "ltx_25",
        durationMs: 5000
      }
    });
    await uow.execute(async (ctx) => {
      await ctx.scenes.save(scene);
    });

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn()
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: scene.id,
      uow,
      coordinator
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("no_active_reference_bindings");
    expect(coordinator.prepareAdmission).not.toHaveBeenCalled();
  });

  it("does not trigger when scene status is not draft_pending", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAssetId,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/hero.png",
      contentHashSha256: "a".repeat(64)
    });

    const scene = Scene.reconstitute({
      id: "scene-in-review" as SceneId,
      campaignId: seededCampaign.id,
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "A scene in review",
        referenceBindings: [
          {
            sceneId: "scene-in-review" as SceneId,
            specRevision: 1,
            referenceAssetId: refAssetId,
            role: "subject_identity",
            weight: 0.8,
            hints: null
          }
        ],
        referenceIds: [refAssetId],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      sequenceIndex: 1
    });

    await uow.execute(async (ctx) => {
      await ctx.scenes.save(scene);
    });

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn()
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: scene.id,
      uow,
      coordinator
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("not_draft_pending");
    expect(coordinator.prepareAdmission).not.toHaveBeenCalled();
  });

  it("does not trigger when scene already has shot plans at current revision", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAssetId,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/hero.png",
      contentHashSha256: "a".repeat(64)
    });

    const scene = Scene.create({
      id: "scene-with-plans" as SceneId,
      campaignId: seededCampaign.id,
      configuration: {
        prompt: "A scene with existing plans",
        engineProfileId: "ltx_25",
        durationMs: 5000,
        referenceBindings: [{ referenceAssetId: refAssetId, role: "subject_identity", weight: 0.8 }]
      }
    });

    const plan = ShotPlan.reconstitute({
      id: "plan-1" as ShotPlanId,
      sceneId: scene.id,
      specRevision: scene.snapshot().specRevision,
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

    await uow.execute(async (ctx) => {
      await ctx.scenes.save(scene);
      await ctx.shotPlans!.save(plan);
    });

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn()
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: scene.id,
      uow,
      coordinator
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("has_existing_shot_plans");
    expect(coordinator.prepareAdmission).not.toHaveBeenCalled();
  });

  it("does not throw when coordinator fails, returns false", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAssetId,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/hero.png",
      contentHashSha256: "a".repeat(64)
    });

    const scene = Scene.create({
      id: "scene-err" as SceneId,
      campaignId: seededCampaign.id,
      configuration: {
        prompt: "A scene causing coordinator error",
        engineProfileId: "ltx_25",
        durationMs: 5000,
        referenceBindings: [{ referenceAssetId: refAssetId, role: "subject_identity", weight: 0.8 }]
      }
    });
    await uow.execute(async (ctx) => {
      await ctx.scenes.save(scene);
    });

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockRejectedValue(new Error("Coordinator failure"))
    };

    const logger = {
      warn: vi.fn()
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: scene.id,
      uow,
      coordinator,
      logger
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("admission_error");
    expect(coordinator.prepareAdmission).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("First-pass shot-plan auto-trigger failed")
    );
  });

  it("triggers coordinator admission when scene has plans only at older revisions but none at current revision", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    uow.seedReferenceAsset({
      id: refAssetId,
      clientId: seededCampaign.clientId,
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/hero.png",
      contentHashSha256: "a".repeat(64)
    });

    const scene = Scene.reconstitute({
      id: "scene-rev-2" as SceneId,
      campaignId: seededCampaign.id,
      status: "draft_pending",
      specRevision: 2,
      configuration: {
        prompt: "A scene at revision 2",
        engineProfileId: "ltx_25",
        durationMs: 5000,
        referenceBindings: [
          {
            sceneId: "scene-rev-2" as SceneId,
            specRevision: 2,
            referenceAssetId: refAssetId,
            role: "subject_identity",
            weight: 0.8,
            hints: null
          }
        ],
        referenceIds: [refAssetId]
      },
      sequenceIndex: 1
    });

    // Seed an older ShotPlan belonging to specRevision 1
    const olderPlan = ShotPlan.reconstitute({
      id: "plan-rev-1" as ShotPlanId,
      sceneId: scene.id,
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
      cameraPromptDescription: "Wide static shot from rev 1",
      actionSummary: "Historical action",
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

    await uow.execute(async (ctx) => {
      await ctx.scenes.save(scene);
      await ctx.shotPlans!.save(olderPlan);
    });

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn().mockResolvedValue({ kind: "admitted" })
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: scene.id,
      uow,
      coordinator
    });

    expect(result.triggered).toBe(true);
    expect(coordinator.prepareAdmission).toHaveBeenCalledTimes(1);
    expect(coordinator.prepareAdmission).toHaveBeenCalledWith({ sceneId: scene.id });
  });

  it("does not throw when eligibility read rejects, returns non-triggered result and logs warning", async () => {
    const rejectingUow: UnitOfWork = {
      execute: vi
        .fn()
        .mockRejectedValue(new Error("Database connection lost during eligibility read"))
    };

    const coordinator: ShotPlanPlanningAdmissionPort = {
      prepareAdmission: vi.fn()
    };

    const logger = {
      warn: vi.fn()
    };

    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: "scene-eligibility-fail",
      uow: rejectingUow,
      coordinator,
      logger
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("eligibility_error");
    expect(coordinator.prepareAdmission).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("First-pass shot-plan eligibility check failed")
    );
  });

  it("returns false if coordinator is not provided", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: "scene-1",
      uow,
      coordinator: undefined
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("coordinator_not_configured");
  });

  it("logs warning when coordinator is not provided and logger is supplied", async () => {
    const uow = new InMemorySceneUnitOfWork(undefined, undefined, undefined, [seededCampaign]);
    const logger = { warn: vi.fn() };
    const result = await triggerFirstPassShotPlanningIfEligible({
      sceneId: "scene-1",
      uow,
      coordinator: undefined,
      logger
    });
    expect(result.triggered).toBe(false);
    expect(result.reason).toBe("coordinator_not_configured");
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("planning coordinator is not configured")
    );
  });
});
