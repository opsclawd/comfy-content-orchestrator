import { describe, expect, it, vi } from "vitest";
import {
  Scene,
  ShotPlan,
  type CampaignId,
  type CampaignRecord,
  type CandidateId,
  type ReferenceAsset,
  type ReferenceAssetId,
  type SceneId,
  type SceneReferenceBinding,
  type ShotPlanId
} from "@cco/domain";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { PrepareSceneProductionInputsUseCase } from "./prepare-scene-production-inputs.js";
import { StaleBibleBindingMismatchError } from "./plan-shot-plans-errors.js";

describe("PrepareSceneProductionInputsUseCase - Campaign Reference Bible Integration", () => {
  const basePngHeader = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    10, 0, 0, 0, 10, 8, 2, 0, 0, 0
  ];
  const brideBytes = Buffer.from([...basePngHeader, 1]);
  const beachBytes = Buffer.from([...basePngHeader, 2]);

  const validHashBride = "1".repeat(64);
  const validHashBeach = "2".repeat(64);

  const campaignId = "campaign-bible-test-1" as CampaignId;
  const validCampaign: CampaignRecord = {
    id: campaignId,
    clientId: "client-bible-1",
    title: "Bible Campaign",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 2,
    approvedScenes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const brideAssetId = "01928374-abcd-7000-8000-0000000000b1" as ReferenceAssetId;
  const beachAssetId = "01928374-abcd-7000-8000-0000000000b2" as ReferenceAssetId;

  const brideAsset: ReferenceAsset = {
    id: brideAssetId,
    clientId: validCampaign.clientId,
    storageBucket: "assets",
    storageObjectKey: "refs/bride.png",
    contentHashSha256: validHashBride,
    mimeType: "image/png",
    assetType: "image",
    width: 10,
    height: 10,
    description: "Original unstandardized bride"
  };

  const beachAsset: ReferenceAsset = {
    id: beachAssetId,
    clientId: validCampaign.clientId,
    storageBucket: "assets",
    storageObjectKey: "refs/beach.png",
    contentHashSha256: validHashBeach,
    mimeType: "image/png",
    assetType: "image",
    width: 10,
    height: 10,
    description: "Original unstandardized beach"
  };

  const authoritativeBrideDescription =
    "Radiant bride in silk ivory gown with delicate lace embroidery and pearl veil";
  const authoritativeBeachDescription =
    "Sun-drenched Mediterranean rocky beach with limestone cliffs and turquoise waves";

  function createTestShotPlan(sceneId: string, planId: string): ShotPlan {
    return ShotPlan.create({
      id: planId as ShotPlanId,
      sceneId: sceneId as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      status: "approved",
      routingMode: "reference_directed",
      targetDurationMs: 5000,
      targetFrameCount: 124,
      framing: "medium",
      angle: "eye_level",
      lensIntent: "50mm prime",
      cameraPosition: "eye level tripod",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Medium eye-level shot",
      actionSummary: "Character at scenic location",
      lightingStyle: "natural_golden_hour",
      environmentDescription: "Scenic setting",
      continuity: {
        incomingContinuityFromSceneId: null,
        persistentSubjectIds: [brideAssetId],
        lightingContinuityNote: null,
        frameAnchorTarget: "none",
        anchorCandidateId: null,
        anchorMediaHashSha256: null
      }
    });
  }

  function createTestScene(id: string, shotPlanId: string): Scene {
    const scene = Scene.create({
      id: id as SceneId,
      campaignId,
      configuration: {
        prompt: "A bride stands on a dramatic beach at sunset",
        referenceIds: [brideAssetId, beachAssetId],
        engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
        durationMs: 5000
      }
    });

    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate("cand-1" as CandidateId, 1, scene.id);
    scene.selectShotPlan(shotPlanId as ShotPlanId, 1, scene.id);
    scene.approveShotPlan({
      approvedBy: "Director Dave",
      approvedAt: new Date().toISOString(),
      routingMode: "reference_directed"
    });

    return scene;
  }

  it("[AC-4] two scenes in one campaign produce production prompts using identical subject and location descriptions from the bible", async () => {
    const scene1Id = "01928374-abcd-7000-8000-000000000001";
    const scene2Id = "01928374-abcd-7000-8000-000000000002";
    const plan1 = createTestShotPlan(scene1Id, "sp-1");
    const plan2 = createTestShotPlan(scene2Id, "sp-2");
    const scene1 = createTestScene(scene1Id, plan1.id);
    const scene2 = createTestScene(scene2Id, plan2.id);

    const binding1A: SceneReferenceBinding = {
      sceneId: scene1.id,
      specRevision: 1,
      referenceAssetId: brideAssetId,
      role: "subject_identity",
      weight: 1
    };
    const binding1B: SceneReferenceBinding = {
      sceneId: scene1.id,
      specRevision: 1,
      referenceAssetId: beachAssetId,
      role: "location",
      weight: 1
    };

    const binding2A: SceneReferenceBinding = {
      sceneId: scene2.id,
      specRevision: 1,
      referenceAssetId: brideAssetId,
      role: "subject_identity",
      weight: 1
    };
    const binding2B: SceneReferenceBinding = {
      sceneId: scene2.id,
      specRevision: 1,
      referenceAssetId: beachAssetId,
      role: "location",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene1, scene2]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(plan1);
    uow.seedShotPlan(plan2);
    uow.seedReferenceAsset(brideAsset);
    uow.seedReferenceAsset(beachAsset);
    uow.seedSceneBinding(binding1A);
    uow.seedSceneBinding(binding1B);
    uow.seedSceneBinding(binding2A);
    uow.seedSceneBinding(binding2B);

    // Seed authoritative campaign bible
    uow.seedCampaignReferenceBible({
      campaignId,
      referenceAssetId: brideAssetId,
      role: "subject_identity",
      description: authoritativeBrideDescription,
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: validHashBride,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });
    uow.seedCampaignReferenceBible({
      campaignId,
      referenceAssetId: beachAssetId,
      role: "location",
      description: authoritativeBeachDescription,
      biblePromptTag: "<Picture 2>",
      sourceContentHashSha256: validHashBeach,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const objectStorage = {
      getObject: vi.fn().mockImplementation(async (location: { bucket: string; key: string }) => {
        if (location.key?.includes("beach")) return { body: beachBytes };
        return { body: brideBytes };
      }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockImplementation(async (bytes: Uint8Array) => {
        if (bytes === beachBytes) return validHashBeach;
        return validHashBride;
      })
    };

    const useCase = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });

    const result1 = await useCase.execute({ sceneId: scene1.id });
    const result2 = await useCase.execute({ sceneId: scene2.id });

    expect(result1.readiness).toBe("ready");
    expect(result2.readiness).toBe("ready");

    const prompt1 = result1.inspection.instruction.compiledText;
    const prompt2 = result2.inspection.instruction.compiledText;

    // Both scene production prompts contain the exact authoritative campaign bible descriptions
    expect(prompt1).toContain(authoritativeBrideDescription);
    expect(prompt1).toContain(authoritativeBeachDescription);
    expect(prompt2).toContain(authoritativeBrideDescription);
    expect(prompt2).toContain(authoritativeBeachDescription);

    // Neither prompt uses the raw unstandardized descriptions
    expect(prompt1).not.toContain(brideAsset.description);
    expect(prompt1).not.toContain(beachAsset.description);
    expect(prompt2).not.toContain(brideAsset.description);
    expect(prompt2).not.toContain(beachAsset.description);
  });

  it("fails closed with StaleBibleBindingMismatchError when active binding is missing from campaign reference bible", async () => {
    const sceneId = "01928374-abcd-7000-8000-000000000001";
    const plan = createTestShotPlan(sceneId, "sp-1");
    const scene = createTestScene(sceneId, plan.id);

    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: brideAssetId,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(plan);
    uow.seedReferenceAsset(brideAsset);
    uow.seedSceneBinding(binding);

    // Note: campaignReferenceBible is left empty (no entries seeded)

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: brideBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHashBride)
    };

    const useCase = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });

    await expect(useCase.execute({ sceneId: scene.id, dryRun: false })).rejects.toThrow(
      StaleBibleBindingMismatchError
    );
  });

  it("fails closed with StaleBibleBindingMismatchError when active binding has conflicting role with campaign reference bible", async () => {
    const sceneId = "01928374-abcd-7000-8000-000000000001";
    const plan = createTestShotPlan(sceneId, "sp-1");
    const scene = createTestScene(sceneId, plan.id);

    // Scene binds as location, but bible has subject_identity
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: brideAssetId,
      role: "location",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(plan);
    uow.seedReferenceAsset(brideAsset);
    uow.seedSceneBinding(binding);

    uow.seedCampaignReferenceBible({
      campaignId,
      referenceAssetId: brideAssetId,
      role: "subject_identity",
      description: authoritativeBrideDescription,
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: validHashBride,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: brideBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHashBride)
    };

    const useCase = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });

    await expect(useCase.execute({ sceneId: scene.id, dryRun: false })).rejects.toThrow(
      StaleBibleBindingMismatchError
    );
  });

  it("records STALE_BIBLE_BINDING_MISMATCH blocker without throwing when dryRun is true", async () => {
    const sceneId = "01928374-abcd-7000-8000-000000000001";
    const plan = createTestShotPlan(sceneId, "sp-1");
    const scene = createTestScene(sceneId, plan.id);

    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: brideAssetId,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(plan);
    uow.seedReferenceAsset(brideAsset);
    uow.seedSceneBinding(binding);

    // Missing from campaign reference bible
    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: brideBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHashBride)
    };

    const useCase = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });

    const result = await useCase.execute({ sceneId: scene.id, dryRun: true });

    expect(result.readiness).toBe("blocked");
    expect(result.blockers.some((b) => b.code === "STALE_BIBLE_BINDING_MISMATCH")).toBe(true);
  });
});
