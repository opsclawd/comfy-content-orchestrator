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
  type ShotPlanId,
  type StoryboardCandidate,
  type ShotFraming
} from "@cco/domain";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import {
  EnqueueSceneProductionRenderUseCase,
  MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE
} from "./enqueue-scene-production-render.js";
import { PrepareSceneProductionInputsUseCase } from "./prepare-scene-production-inputs.js";
import { ApproveSceneAndDispatchCampaignProductionUseCase } from "./dispatch-campaign-production.js";
import { ProductionInputFingerprintMismatchError } from "./production-input-fingerprint-mismatch-error.js";

describe("Production Input Inspector & Equivalence Tests", () => {
  const validPngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    10, 0, 0, 0, 10, 8, 2, 0, 0, 0
  ]);
  const validHash1 = "1111111111111111111111111111111111111111111111111111111111111111";
  const validHash2 = "2222222222222222222222222222222222222222222222222222222222222222";

  const validCampaign: CampaignRecord = {
    id: "campaign-eq-1" as CampaignId,
    clientId: "client-eq-1",
    title: "Equivalence Campaign",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const createShotPlan = (
    sceneId: string,
    overrides?: {
      id?: string;
      routingMode?: "reference_directed" | "frame_anchored";
      specRevision?: number;
      status?: "draft" | "approved" | "superseded" | "rejected";
      anchorCandidateId?: string | null;
      anchorMediaHashSha256?: string | null;
      framing?: ShotFraming;
    }
  ): ShotPlan => {
    return ShotPlan.create({
      id: (overrides?.id ?? "sp-eq-1") as ShotPlanId,
      sceneId: sceneId as SceneId,
      specRevision: overrides?.specRevision ?? 1,
      variantOrdinal: 1,
      status: overrides?.status ?? "approved",
      routingMode: overrides?.routingMode ?? "reference_directed",
      targetDurationMs: 5000,
      targetFrameCount: 124,
      framing: overrides?.framing ?? "medium",
      angle: "eye_level",
      lensIntent: "50mm",
      cameraPosition: "tripod front",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Static camera",
      actionSummary: "A character stands in front of a cafe",
      lightingStyle: "natural_golden_hour",
      environmentDescription: "Outdoor cafe",
      continuity: {
        incomingContinuityFromSceneId: null,
        persistentSubjectIds: [],
        lightingContinuityNote: null,
        frameAnchorTarget: overrides?.routingMode === "frame_anchored" ? "first_frame" : "none",
        anchorCandidateId:
          overrides?.anchorCandidateId ??
          (overrides?.routingMode === "frame_anchored" ? "cand-anchor-1" : null),
        anchorMediaHashSha256:
          overrides?.anchorMediaHashSha256 ??
          (overrides?.routingMode === "frame_anchored" ? validHash1 : null)
      }
    });
  };

  const createScene = (
    id: string,
    shotPlan: ShotPlan,
    overrides?: {
      status?: "director_review" | "approved";
      candidateId?: string;
      engineProfileId?: string;
    }
  ): Scene => {
    const scene = Scene.create({
      id: id as SceneId,
      campaignId: validCampaign.id,
      configuration: {
        prompt: "A character stands in front of a cafe",
        referenceIds: [],
        engineProfileId: overrides?.engineProfileId ?? "MINIMAX_H3_720P_5S_REF2V_V1",
        durationMs: 5000
      }
    });

    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate((overrides?.candidateId ?? "cand-previs-1") as CandidateId, 1, scene.id);
    scene.selectShotPlan(shotPlan.id, shotPlan.specRevision, scene.id);

    if (overrides?.status === "approved") {
      scene.approveShotPlan({
        approvedBy: "Director Dave",
        approvedAt: new Date().toISOString(),
        routingMode: shotPlan.routingMode
      });
    }

    return scene;
  };

  it("proves inspector output matches real dispatch conditioning for reference_directed mode", async () => {
    const shotPlan = createShotPlan("scene-eq-ref", { routingMode: "reference_directed" });
    const scene = createScene("scene-eq-ref", shotPlan, { status: "approved" });

    const refAsset: ReferenceAsset = {
      id: "ref-1" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: validHash1,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const inspector = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });
    const inspectionResult = await inspector.execute({ sceneId: scene.id, dryRun: true });

    expect(inspectionResult.readiness).toBe("ready");
    expect(inspectionResult.blockers).toHaveLength(0);
    expect(inspectionResult.inspection.productionInputFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });
    const enqueueResult = await enqueueUseCase.execute({ sceneId: scene.id });

    // Equivalence assertions: inspector read model MUST match the job payload
    expect(enqueueResult.job.workflowTemplate).toBe(
      inspectionResult.inspection.route.workflowTemplate
    );
    expect(enqueueResult.job.injectedPayload.productionInputFingerprint).toBe(
      inspectionResult.inspection.productionInputFingerprint
    );
    expect(enqueueResult.job.injectedPayload.frameCount).toBe(
      inspectionResult.inspection.route.targetFrameCount
    );
    expect(enqueueResult.job.injectedPayload.shotPlanId).toBe(
      inspectionResult.inspection.authority.shotPlanId
    );
    expect(enqueueResult.job.injectedPayload.specRevision).toBe(
      inspectionResult.inspection.authority.specRevision
    );

    // Previs candidate pixels MUST NOT be authoritative
    expect("approvedCandidateId" in enqueueResult.job.injectedPayload).toBe(false);
  });

  it("proves inspector output matches real dispatch conditioning for frame_anchored mode", async () => {
    const shotPlan = createShotPlan("scene-eq-frame", {
      routingMode: "frame_anchored",
      anchorCandidateId: "cand-anchor-1",
      anchorMediaHashSha256: validHash1
    });
    const scene = createScene("scene-eq-frame", shotPlan, {
      status: "approved",
      candidateId: "cand-anchor-1",
      engineProfileId: "MINIMAX_H3_720P_5S_I2V_V1"
    });

    const candidate: StoryboardCandidate = {
      id: "cand-anchor-1" as CandidateId,
      sceneId: scene.id,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "assets",
      storageObjectKey: "candidates/cand-anchor-1.png",
      contentHash: validHash1,
      generationMetadata: {},
      createdAt: new Date().toISOString()
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const inspector = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });
    const inspectionResult = await inspector.execute({ sceneId: scene.id, dryRun: true });

    expect(inspectionResult.readiness).toBe("ready");
    expect(inspectionResult.inspection.route.routingMode).toBe("frame_anchored");
    expect(inspectionResult.inspection.visualInputs.frameAnchor?.anchorCandidateId).toBe(
      "cand-anchor-1"
    );
    expect(inspectionResult.inspection.visualInputs.frameAnchor?.anchorMediaHashSha256).toBe(
      validHash1
    );

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });
    const enqueueResult = await enqueueUseCase.execute({ sceneId: scene.id });

    expect(enqueueResult.job.workflowTemplate).toBe(MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE);
    expect(enqueueResult.job.injectedPayload.approvedCandidateId).toBe("cand-anchor-1");
    expect(enqueueResult.job.injectedPayload.frameCount).toBe(124);
    expect(enqueueResult.job.injectedPayload.prompt).toBe(
      inspectionResult.inspection.instruction.compiledText
    );
  });

  it("proves previs candidate still changes do NOT alter reference_directed fingerprint", async () => {
    const shotPlan = createShotPlan("scene-previs-inv", {
      routingMode: "reference_directed",
      status: "draft"
    });
    const scene = createScene("scene-previs-inv", shotPlan, {
      status: "director_review",
      candidateId: "cand-1"
    });

    const refAsset: ReferenceAsset = {
      id: "ref-1" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: validHash1,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const cand1: StoryboardCandidate = {
      id: "cand-1" as CandidateId,
      sceneId: scene.id,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "assets",
      storageObjectKey: "candidates/cand-1.png",
      contentHash: "hash-cand-1",
      generationMetadata: {},
      createdAt: new Date().toISOString()
    };
    const cand2: StoryboardCandidate = {
      id: "cand-2" as CandidateId,
      sceneId: scene.id,
      specRevision: 1,
      variantOrdinal: 2,
      storageBucket: "assets",
      storageObjectKey: "candidates/cand-2.png",
      contentHash: "hash-cand-2-totally-different",
      generationMetadata: {},
      createdAt: new Date().toISOString()
    };

    const uow = new InMemorySceneUnitOfWork([scene], [cand1, cand2]);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const inspector = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });

    // Inspection with cand-1 selected
    const inspection1 = await inspector.execute({ sceneId: scene.id, dryRun: true });
    const fp1 = inspection1.inspection.productionInputFingerprint;

    // Director selects cand-2 instead
    scene.selectCandidate(cand2.id, 1, scene.id);

    // Inspection with cand-2 selected
    const inspection2 = await inspector.execute({ sceneId: scene.id, dryRun: true });
    const fp2 = inspection2.inspection.productionInputFingerprint;

    // Invariant: Previs candidate stills are non-authoritative review evidence and NEVER alter reference_directed fingerprint
    expect(fp1).toBe(fp2);
  });

  it("proves reference asset updates DO alter reference_directed fingerprint", async () => {
    const shotPlan = createShotPlan("scene-ref-drift", {
      routingMode: "reference_directed",
      status: "draft"
    });
    const scene = createScene("scene-ref-drift", shotPlan, { status: "director_review" });

    const refAsset1: ReferenceAsset = {
      id: "ref-1" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: validHash1,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding1: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset1.id,
      role: "subject_identity",
      weight: 1
    };

    const uow1 = new InMemorySceneUnitOfWork([scene]);
    uow1.seedCampaign(validCampaign);
    uow1.seedShotPlan(shotPlan);
    uow1.seedReferenceAsset(refAsset1);
    uow1.seedSceneBinding(binding1);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes1 = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const inspector1 = new PrepareSceneProductionInputsUseCase(uow1, {
      objectStorage,
      hashBytes: hashBytes1
    });
    const inspection1 = await inspector1.execute({ sceneId: scene.id, dryRun: true });
    const fp1 = inspection1.inspection.productionInputFingerprint;

    // Now construct state with a different reference asset content hash
    const refAsset2: ReferenceAsset = {
      id: "ref-2" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-2.png",
      contentHashSha256: validHash2,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding2: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset2.id,
      role: "subject_identity",
      weight: 1
    };
    const scene2 = Scene.reconstitute(scene.snapshot());
    const uow2 = new InMemorySceneUnitOfWork([scene2]);
    uow2.seedCampaign(validCampaign);
    uow2.seedShotPlan(shotPlan);
    uow2.seedReferenceAsset(refAsset2);
    uow2.seedSceneBinding(binding2);

    const hashBytes2 = {
      hashBytes: vi.fn().mockResolvedValue(validHash2)
    };

    const inspector2 = new PrepareSceneProductionInputsUseCase(uow2, {
      objectStorage,
      hashBytes: hashBytes2
    });
    const inspection2 = await inspector2.execute({ sceneId: scene2.id, dryRun: true });
    const fp2 = inspection2.inspection.productionInputFingerprint;

    // Reference asset modification MUST alter the fingerprint
    expect(fp1).not.toBe(fp2);
  });

  it("proves dryRun inspection is completely side-effect-free", async () => {
    const shotPlan = createShotPlan("scene-side-effect", {
      routingMode: "reference_directed",
      status: "draft"
    });
    const scene = createScene("scene-side-effect", shotPlan, { status: "director_review" });

    const refAsset: ReferenceAsset = {
      id: "ref-1" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: validHash1,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const inspector = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });
    const result = await inspector.execute({ sceneId: scene.id, dryRun: true });

    expect(result.readiness).toBe("awaiting_approval"); // draft shotplan and unapproved scene
    expect(result.inspection.authority.shotPlanStatus).toBe("draft");

    // Invariants:
    expect(scene.status).toBe("director_review");
    expect(shotPlan.status).toBe("draft");
    expect(uow.reviewEvents).toHaveLength(0);
    expect(queue.jobs).toHaveLength(0);
    expect(objectStorage.putObject).not.toHaveBeenCalled();
    expect(objectStorage.deleteObject).not.toHaveBeenCalled();
  });

  it("proves dispatch-campaign-production rejects when expectedProductionInputFingerprint diverges", async () => {
    const shotPlan = createShotPlan("scene-drift-guard", {
      routingMode: "reference_directed",
      status: "draft"
    });
    const scene = createScene("scene-drift-guard", shotPlan, { status: "director_review" });

    const refAsset: ReferenceAsset = {
      id: "ref-1" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: validHash1,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });
    const coordinator = new ApproveSceneAndDispatchCampaignProductionUseCase(uow, enqueueUseCase);

    const staleFingerprint = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    await expect(
      coordinator.execute({
        action: "approve_shotplan",
        sceneId: scene.id,
        shotPlanId: shotPlan.id,
        eventId: "evt-drift-1",
        reviewerName: "Director Dave",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        expectedProductionInputFingerprint: staleFingerprint
      })
    ).rejects.toThrow(ProductionInputFingerprintMismatchError);

    // Fail-closed invariant: scene and shotplan were NOT approved
    expect(scene.status).toBe("director_review");
    expect(shotPlan.status).toBe("draft");
    expect(queue.jobs).toHaveLength(0);
    expect(uow.reviewEvents).toHaveLength(0);
  });

  it("proves dispatch-campaign-production succeeds when expectedProductionInputFingerprint matches", async () => {
    const shotPlan = createShotPlan("scene-drift-match", {
      routingMode: "reference_directed",
      status: "draft"
    });
    const scene = createScene("scene-drift-match", shotPlan, { status: "director_review" });

    const refAsset: ReferenceAsset = {
      id: "ref-1" as ReferenceAssetId,
      clientId: validCampaign.clientId,
      storageBucket: "assets",
      storageObjectKey: "refs/ref-1.png",
      contentHashSha256: validHash1,
      mimeType: "image/png",
      assetType: "image",
      width: 10,
      height: 10
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash1)
    };

    const inspector = new PrepareSceneProductionInputsUseCase(uow, { objectStorage, hashBytes });
    const preview = await inspector.execute({ sceneId: scene.id, dryRun: true });
    const validFingerprint = preview.inspection.productionInputFingerprint;

    const enqueueUseCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });
    const coordinator = new ApproveSceneAndDispatchCampaignProductionUseCase(uow, enqueueUseCase);

    const result = await coordinator.execute({
      action: "approve_shotplan",
      sceneId: scene.id,
      shotPlanId: shotPlan.id,
      eventId: "evt-match-1",
      reviewerName: "Director Dave",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 1,
      expectedProductionInputFingerprint: validFingerprint
    });

    expect(result.scene.status).toBe("queued");
    expect(result.scene.approvedShotPlanId).toBe(shotPlan.id);
    expect(shotPlan.status).toBe("approved");
    expect(queue.jobs).toHaveLength(1);
  });
});
