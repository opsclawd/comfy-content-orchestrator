import { describe, expect, it, vi } from "vitest";
import {
  InvalidTransitionError,
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
  type StoryboardCandidate
} from "@cco/domain";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import type { UnitOfWorkContext } from "../ports/unit-of-work.js";
import * as contracts from "@cco/contracts";
import {
  EnqueueSceneProductionRenderUseCase,
  LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE,
  PRODUCTION_WORKFLOW_TEMPLATE,
  SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID
} from "./enqueue-scene-production-render.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import { UnsupportedProductionDurationError } from "./map-production-duration.js";
import {
  ConditionedProductionProfileUnavailableError,
  UnrepresentableProductionConfigurationError
} from "./production-configuration-errors.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

describe("EnqueueSceneProductionRenderUseCase", () => {
  const createApprovedScene = (
    id: string = "scene-1",
    overrides?: {
      prompt?: string;
      referenceIds?: string[];
      engineProfileId?: string;
      durationMs?: number;
      loraConfigurationId?: string | null;
      specRevision?: number;
      selectedCandidateRevision?: number;
      candidateId?: string;
    }
  ): Scene => {
    const candidateId = (overrides?.candidateId ?? "cand-1") as CandidateId;
    const initialRev = overrides?.specRevision ?? 1;
    const candidateRev = overrides?.selectedCandidateRevision ?? initialRev;

    const scene = Scene.create({
      id: id as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: overrides?.prompt ?? "Cinematic sunset over mountain peak",
        referenceIds: overrides?.referenceIds ?? [],
        engineProfileId: overrides?.engineProfileId ?? SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID,
        durationMs: overrides?.durationMs ?? 4042,
        ...(overrides?.loraConfigurationId !== undefined
          ? { loraConfigurationId: overrides.loraConfigurationId }
          : {})
      }
    });

    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate(candidateId, candidateRev, scene.id);
    scene.approve({
      approvedBy: "Director Dave",
      approvedAt: "2026-08-30T12:00:00.000Z"
    });

    return scene;
  };

  it("happy path via execute(): default deployment enqueues conditioned I2V workflow for reviewed production", async () => {
    const scene = createApprovedScene("scene-happy-default", { durationMs: 4042 });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const result = await useCase.execute({ sceneId: "scene-happy-default" });

    expect(result.scene.status).toBe("queued");
    expect(result.job.jobKind).toBe("production");
    expect(result.job.workflowTemplate).toBe(LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE);
    expect(result.job.sceneId).toBe("scene-happy-default");

    const payload = result.job.injectedPayload as {
      prompt: string;
      seed: number;
      approvedCandidateId: string;
    };
    expect(payload.prompt).toBe("Cinematic sunset over mountain peak");
    expect("frameCount" in result.job.injectedPayload).toBe(false);
    expect(payload.approvedCandidateId).toBe("cand-1");
    expect(Number.isSafeInteger(payload.seed)).toBe(true);
    expect(payload.seed).toBeGreaterThanOrEqual(0);

    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.savedScenes[0]!.status).toBe("queued");
    expect(result.scene.activeProductionJobId).toBe(result.job.jobId);
    expect(queue.jobs).toHaveLength(1);
  });

  it("happy path: reviewed scene configured with legacy engine profile still unconditionally dispatches conditioned I2V workflow", async () => {
    for (const engineProfileId of [SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID, "ltx_25"]) {
      const scene = createApprovedScene(`scene-legacy-${engineProfileId}`, {
        engineProfileId,
        durationMs: 4042
      });
      const queue = new InMemoryJobQueue();
      const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
      const useCase = new EnqueueSceneProductionRenderUseCase(uow);

      const result = await useCase.execute({ sceneId: `scene-legacy-${engineProfileId}` });

      expect(result.scene.status).toBe("queued");
      expect(result.job.jobKind).toBe("production");
      expect(result.job.workflowTemplate).toBe(LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE);
      expect(result.job.sceneId).toBe(`scene-legacy-${engineProfileId}`);

      const payload = result.job.injectedPayload as {
        prompt: string;
        seed: number;
        approvedCandidateId: string;
      };
      expect(payload.prompt).toBe("Cinematic sunset over mountain peak");
      expect("frameCount" in result.job.injectedPayload).toBe(false);
      expect(payload.approvedCandidateId).toBe("cand-1");
      expect(Number.isSafeInteger(payload.seed)).toBe(true);
      expect(payload.seed).toBeGreaterThanOrEqual(0);

      expect(uow.savedScenes).toHaveLength(1);
      expect(uow.savedScenes[0]!.status).toBe("queued");
      expect(result.scene.activeProductionJobId).toBe(result.job.jobId);
      expect(queue.jobs).toHaveLength(1);
    }
  });

  it("happy path via executeWithContext(): operates inside caller-opened transaction without opening a second one", async () => {
    const sceneA = createApprovedScene("scene-batch-A", { durationMs: 4042 });
    const sceneB = createApprovedScene("scene-batch-B", { durationMs: 4042 });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([sceneA, sceneB]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const executeSpy = vi.spyOn(uow, "execute");

    // Simulating how #197 will fan out across approved scenes inside its single transaction
    const batchResult = await uow.execute(async (context) => {
      const resA = await useCase.executeWithContext(context, { sceneId: "scene-batch-A" });
      const resB = await useCase.executeWithContext(context, { sceneId: "scene-batch-B" });
      return [resA, resB];
    });

    // CRITICAL (Finding 1): uow.execute was called EXACTLY ONCE by the caller.
    // executeWithContext never called uow.execute internally.
    expect(executeSpy).toHaveBeenCalledTimes(1);

    expect(batchResult[0]!.scene.status).toBe("queued");
    expect(batchResult[1]!.scene.status).toBe("queued");
    expect(uow.savedScenes).toHaveLength(2);
    expect(queue.jobs).toHaveLength(2);
  });

  it("fails with SceneNotFoundError when scene does not exist", async () => {
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork().withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-non-existent" })).rejects.toThrow(
      SceneNotFoundError
    );
    expect(queue.jobs).toHaveLength(0);
  });

  it("rejects with InvalidTransitionError when scene status is not approved (e.g. director_review)", async () => {
    const scene = Scene.create({
      id: "scene-review-1" as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "Reviewing",
        referenceIds: [],
        engineProfileId: SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID,
        durationMs: 4042
      }
    });
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-review-1" })).rejects.toThrow(
      InvalidTransitionError
    );
    expect(queue.jobs).toHaveLength(0);
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("rejects when candidate revision does not match current scene revision", async () => {
    const scene = createApprovedScene("scene-rev-mismatch");
    // Snapshot-based reconstitution to simulate candidate revision mismatch defensively
    const snapshot = scene.snapshot();
    const mismatchedScene = Scene.reconstitute({
      ...snapshot,
      selectedCandidateRevision: 99
    });

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([mismatchedScene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-rev-mismatch" })).rejects.toThrow(
      InvalidTransitionError
    );
    expect(queue.jobs).toHaveLength(0);
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("fails closed with UnrepresentableProductionConfigurationError when engineProfileId is not in accepted list (e.g. FLUX_SCHNELL_DRAFT_V1)", async () => {
    const scene = createApprovedScene("scene-flux", {
      engineProfileId: "FLUX_SCHNELL_DRAFT_V1"
    });

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const error = await useCase.execute({ sceneId: "scene-flux" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnrepresentableProductionConfigurationError);
    expect((error as UnrepresentableProductionConfigurationError).unrepresentableFields).toContain(
      "engineProfileId"
    );
    expect(queue.jobs).toHaveLength(0);
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("fails closed with UnrepresentableProductionConfigurationError when engineProfileId is an arbitrary unknown profile", async () => {
    const scene = createApprovedScene("scene-unknown-profile", {
      engineProfileId: "SOME_OTHER_PROFILE"
    });

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const error = await useCase
      .execute({ sceneId: "scene-unknown-profile" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnrepresentableProductionConfigurationError);
    expect((error as UnrepresentableProductionConfigurationError).unrepresentableFields).toEqual([
      "engineProfileId"
    ]);
    expect(queue.jobs).toHaveLength(0);
  });

  it("accepts a scene configured with LTX_25_720P_5S_I2V_V1 or ltx_25_i2v as representable and enqueues production", async () => {
    for (const engineProfileId of ["LTX_25_720P_5S_I2V_V1", "ltx_25_i2v"]) {
      const scene = createApprovedScene(`scene-${engineProfileId}`, {
        engineProfileId,
        durationMs: 4042
      });
      const queue = new InMemoryJobQueue();
      const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
      const useCase = new EnqueueSceneProductionRenderUseCase(uow);

      const result = await useCase.execute({ sceneId: `scene-${engineProfileId}` });

      expect(result.scene.status).toBe("queued");
      expect(result.job.jobKind).toBe("production");
      expect(result.job.workflowTemplate).toBe(PRODUCTION_WORKFLOW_TEMPLATE);
      expect("frameCount" in result.job.injectedPayload).toBe(false);
      expect(result.job.injectedPayload.approvedCandidateId).toBe("cand-1");
    }
  });

  it("fails closed with UnrepresentableProductionConfigurationError when referenceIds or lora are present", async () => {
    const sceneWithRefs = createApprovedScene("scene-refs", {
      referenceIds: ["ref-image-1"]
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([sceneWithRefs]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-refs" })).rejects.toThrow(
      UnrepresentableProductionConfigurationError
    );
    expect(queue.jobs).toHaveLength(0);

    const sceneWithLora = createApprovedScene("scene-lora", {
      loraConfigurationId: "lora-lighting-1"
    });
    const uowLora = new InMemorySceneUnitOfWork([sceneWithLora]).withJobs(queue);
    const useCaseLora = new EnqueueSceneProductionRenderUseCase(uowLora);

    await expect(useCaseLora.execute({ sceneId: "scene-lora" })).rejects.toThrow(
      UnrepresentableProductionConfigurationError
    );
    expect(queue.jobs).toHaveLength(0);
  });

  it("fails with UnsupportedProductionDurationError when durationMs is out of supported range", async () => {
    const sceneOutOfRange = createApprovedScene("scene-out-of-range", {
      durationMs: 300 // ~300ms maps below 17 frames
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([sceneOutOfRange]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const err = await useCase.execute({ sceneId: "scene-out-of-range" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnsupportedProductionDurationError);
    expect((err as UnsupportedProductionDurationError).reason).toBe("out_of_range");
    expect(queue.jobs).toHaveLength(0);
  });

  it("fails with TransactionalJobEnqueuerUnavailableError when context.jobs is missing", async () => {
    const scene = createApprovedScene("scene-no-jobs");
    // uow without withJobs()
    const uow = new InMemorySceneUnitOfWork([scene]);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-no-jobs" })).rejects.toThrow(
      TransactionalJobEnqueuerUnavailableError
    );
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("rolls back transaction atomically if context.jobs.enqueue throws mid-transaction", async () => {
    const scene = createApprovedScene("scene-fail-enqueue");
    const failingQueue = {
      enqueue: vi.fn().mockRejectedValue(new Error("Database connection lost")),
      areAllJobsTerminal: vi.fn().mockResolvedValue(false)
    };
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(failingQueue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-fail-enqueue" })).rejects.toThrow(
      "Database connection lost"
    );

    // Staging ensures uncommitted changes are rolled back
    expect(uow.savedScenes).toHaveLength(0);
  });

  it("supports recoverable-failure re-enqueue when scene failed from rendering with intact approval", async () => {
    const scene = createApprovedScene("scene-recoverable-1");
    scene.queueForProduction();
    scene.startRendering();
    scene.fail(); // failed from rendering

    expect(scene.status).toBe("failed");
    expect(scene.snapshot().failedFrom).toBe("rendering");

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const result = await useCase.execute({ sceneId: "scene-recoverable-1" });

    expect(result.scene.status).toBe("queued");
    expect(result.job.jobKind).toBe("production");
    expect(uow.savedScenes).toHaveLength(1);
    expect(uow.savedScenes[0]!.status).toBe("queued");
  });

  it("idempotency under double-call of executeWithContext: second call throws InvalidTransitionError and enqueues only one job", async () => {
    const scene = createApprovedScene("scene-idempotent-1");
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await uow.execute(async (context) => {
      // First call succeeds
      const first = await useCase.executeWithContext(context, { sceneId: "scene-idempotent-1" });
      expect(first.scene.status).toBe("queued");

      // Second call finds the scene already 'queued' and throws InvalidTransitionError
      await expect(
        useCase.executeWithContext(context, { sceneId: "scene-idempotent-1" })
      ).rejects.toThrow(InvalidTransitionError);
    });

    expect(queue.jobs).toHaveLength(1);
  });

  it("fails closed with ConditionedProductionProfileUnavailableError if injection topology is undefined", async () => {
    const scene = createApprovedScene("scene-topology-missing");
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const spy = vi.spyOn(contracts, "getProfileInjectionTopology").mockReturnValue(undefined);
    try {
      await expect(useCase.execute({ sceneId: "scene-topology-missing" })).rejects.toThrow(
        ConditionedProductionProfileUnavailableError
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("records production attempt and tracks ordinal when campaign production runs are present", async () => {
    const scene = createApprovedScene("scene-attempt-track");
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaignProductionRun({
      id: "run-1",
      campaignId: "campaign-1" as CampaignId,
      fingerprint: "fp-1",
      status: "dispatched",
      expectedTotalDurationMs: 4042,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    uow.seedCampaignProductionRunScenes("run-1", [
      {
        runId: "run-1",
        sceneId: "scene-attempt-track" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4042,
        productionJobId: "job-initial"
      }
    ]);

    const useCase = new EnqueueSceneProductionRenderUseCase(uow);
    const result = await useCase.execute({ sceneId: "scene-attempt-track", runId: "run-1" });

    expect(result.attemptOrdinal).toBe(1);
    expect(result.attemptId).toBeDefined();
    expect(result.scene.productionAttemptOrdinal).toBe(1);
    expect(result.scene.activeProductionJobId).toBe(result.job.jobId);

    // Verify attempt recorded in run repository
    const runScene = await uow.campaignProductionRuns.findRunSceneBySceneId("scene-attempt-track");
    expect(runScene?.currentAttemptId).toBe(result.attemptId);
    expect(runScene?.currentAttemptOrdinal).toBe(1);
  });

  it("supports executeRerenderWithContext: enqueues job with production_rerender reason and updates current attempt", async () => {
    const scene = createApprovedScene("scene-rerender-test");
    scene.queueForProduction("job-1");
    scene.startRendering();
    scene.submitForQA();

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const runRecord = {
      id: "run-1",
      campaignId: "campaign-1" as CampaignId,
      fingerprint: "fp-1",
      status: "dispatched" as const,
      expectedTotalDurationMs: 4042,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    uow.seedCampaignProductionRun(runRecord);
    uow.seedCampaignProductionRunScenes("run-1", [
      {
        runId: "run-1",
        sceneId: "scene-rerender-test" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4042,
        productionJobId: "job-1",
        currentAttemptId: "attempt-1",
        currentAttemptOrdinal: 1
      }
    ]);

    const useCase = new EnqueueSceneProductionRenderUseCase(uow);
    const rerenderResult = await uow.execute(async (context) => {
      return await useCase.executeRerenderWithContext(context, scene, runRecord);
    });

    expect(rerenderResult.attemptOrdinal).toBe(2);
    expect(rerenderResult.job.jobKind).toBe("production");
    expect(rerenderResult.job.workflowTemplate).toBe(LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE);

    const attempt = await uow.campaignProductionRuns.findAttemptByProductionJobId(
      rerenderResult.job.jobId
    );
    expect(attempt).toBeDefined();
    expect(attempt?.createdReason).toBe("production_rerender");
    expect(attempt?.ordinal).toBe(2);

    const updatedRunScene =
      await uow.campaignProductionRuns.findRunSceneBySceneId("scene-rerender-test");
    expect(updatedRunScene?.currentAttemptId).toBe(rerenderResult.attemptId);
    expect(updatedRunScene?.currentAttemptOrdinal).toBe(2);
    expect(updatedRunScene?.productionJobId).toBe(rerenderResult.job.jobId);
  });

  const createApprovedShotPlan = (
    sceneId: string,
    overrides?: {
      id?: string;
      routingMode?: "reference_directed" | "frame_anchored";
      specRevision?: number;
      targetDurationMs?: number;
      targetFrameCount?: number;
      frameAnchorTarget?: "none" | "first_frame" | "last_frame" | "both";
      anchorCandidateId?: string | null;
      anchorMediaHashSha256?: string | null;
      status?: "draft" | "approved" | "superseded" | "rejected";
    }
  ): ShotPlan => {
    return ShotPlan.create({
      id: (overrides?.id ?? "shotplan-1") as ShotPlanId,
      sceneId: sceneId as SceneId,
      specRevision: overrides?.specRevision ?? 1,
      variantOrdinal: 1,
      status: overrides?.status ?? "approved",
      routingMode: overrides?.routingMode ?? "reference_directed",
      targetDurationMs: overrides?.targetDurationMs ?? 5000,
      targetFrameCount: overrides?.targetFrameCount ?? 124,
      framing: "medium",
      angle: "eye_level",
      lensIntent: "50mm",
      cameraPosition: "tripod front",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Static camera",
      actionSummary: "A subject walks forward",
      lightingStyle: "natural_golden_hour",
      environmentDescription: "Outdoor park",
      continuity: {
        incomingContinuityFromSceneId: null,
        persistentSubjectIds: [],
        lightingContinuityNote: null,
        frameAnchorTarget:
          overrides?.frameAnchorTarget ??
          (overrides?.routingMode === "frame_anchored" ? "first_frame" : "none"),
        anchorCandidateId:
          overrides?.anchorCandidateId ??
          (overrides?.routingMode === "frame_anchored" ? "cand-1" : null),
        anchorMediaHashSha256:
          overrides?.anchorMediaHashSha256 ??
          (overrides?.routingMode === "frame_anchored" ? "hash-cand-1" : null)
      }
    });
  };

  const createApprovedSceneWithShotPlan = (
    id: string,
    shotPlan: ShotPlan,
    overrides?: {
      engineProfileId?: string;
      durationMs?: number;
      candidateId?: string;
      specRevision?: number;
      trim?: { startMs: number; endMs: number };
    }
  ): Scene => {
    const candidateId = (overrides?.candidateId ?? "cand-1") as CandidateId;
    const initialRev = overrides?.specRevision ?? 1;

    const scene = Scene.create({
      id: id as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "Cinematic sunset over mountain peak",
        referenceIds: [],
        engineProfileId: overrides?.engineProfileId ?? "MINIMAX_H3_720P_5S_REF2V_V1",
        durationMs: overrides?.durationMs ?? 5000,
        ...(overrides?.trim !== undefined ? { trim: overrides.trim } : {})
      }
    });

    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate(candidateId, initialRev, scene.id);
    scene.selectShotPlan(shotPlan.id, shotPlan.specRevision, scene.id);
    scene.approveShotPlan({
      approvedBy: "Director Dave",
      approvedAt: "2026-08-30T12:00:00.000Z",
      routingMode: shotPlan.routingMode
    });

    return scene;
  };

  it("accepts 5000ms scene duration without UnsupportedProductionDurationError for MiniMax-H3", async () => {
    const shotPlan = createApprovedShotPlan("scene-minimax-5s", {
      routingMode: "frame_anchored",
      anchorCandidateId: "cand-1"
    });
    const scene = createApprovedSceneWithShotPlan("scene-minimax-5s", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_I2V_V1",
      durationMs: 5000
    });
    const candidate: StoryboardCandidate = {
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
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]).withJobs(queue);
    uow.seedShotPlan(shotPlan);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    const result = await useCase.execute({ sceneId: "scene-minimax-5s" });

    expect(result.job.jobKind).toBe("production");
    expect(result.job.workflowTemplate).toBe(MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE);
    expect(result.job.injectedPayload.frameCount).toBe(124);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.workflowTemplate).toBe(MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE);
  });

  const validPngBytes = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
    10, 0, 0, 0, 10, 8, 2, 0, 0, 0
  ]);
  const validHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const validCampaign: CampaignRecord = {
    id: "campaign-1" as CampaignId,
    clientId: "client-1",
    title: "Campaign 1",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  it("reference-directed H3 production dispatches Ref2V template without candidate pixels as authority", async () => {
    const shotPlan = createApprovedShotPlan("scene-ref2v-happy", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-ref2v-happy", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
      durationMs: 5000
    });

    const refAsset: ReferenceAsset = {
      id: "ref-asset-1" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/asset-1.png",
      contentHashSha256: validHash,
      mimeType: "image/png",
      assetType: "image"
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
    uow.seedCampaignReferenceBible({
      campaignId: validCampaign.id,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(refAsset.contentHashSha256)
    };

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });
    const result = await useCase.execute({ sceneId: "scene-ref2v-happy" });

    expect(result.scene.status).toBe("queued");
    expect(result.job.workflowTemplate).toBe(MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE);
    expect(result.job.injectedPayload.shotPlanId).toBe(shotPlan.id);
    expect(result.job.injectedPayload.specRevision).toBe(1);
    expect(result.job.injectedPayload.frameCount).toBe(124);
    // Crucial: approvedCandidateId is NOT in injectedPayload for reference-directed
    expect("approvedCandidateId" in result.job.injectedPayload).toBe(false);
  });

  it("reference-directed H3 validates storage bytes and hash when objectStorage option is provided", async () => {
    const shotPlan = createApprovedShotPlan("scene-storage-verify", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-storage-verify", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });

    const testBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      10, 0, 0, 0, 10, 8, 2, 0, 0, 0
    ]);
    const testHash = "a430932bb8fe7cc2dbe9dd42a006db23a542b8764fe0602ff85709ee068dc44f";

    const refAsset: ReferenceAsset = {
      id: "ref-asset-hash" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/verified.png",
      contentHashSha256: testHash,
      mimeType: "image/png",
      assetType: "image"
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "product",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: testBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(testHash)
    };

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });

    const result = await useCase.execute({ sceneId: "scene-storage-verify" });
    expect(result.job.workflowTemplate).toBe(MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE);
    expect(objectStorage.getObject).toHaveBeenCalledWith(
      { bucket: "assets", key: "refs/verified.png" },
      { maxBytes: 10 * 1024 * 1024 }
    );
    expect(hashBytes.hashBytes).toHaveBeenCalledWith(testBytes);
  });

  it("fails closed when reference asset bytes are missing or empty in storage", async () => {
    const shotPlan = createApprovedShotPlan("scene-storage-empty", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-storage-empty", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });

    const refAsset: ReferenceAsset = {
      id: "ref-asset-empty" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/empty.png",
      contentHashSha256: "somehash",
      mimeType: "image/png",
      assetType: "image"
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "location",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: Buffer.alloc(0) }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, { objectStorage });
    await expect(useCase.execute({ sceneId: "scene-storage-empty" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when reference asset hash in storage does not match metadata", async () => {
    const shotPlan = createApprovedShotPlan("scene-storage-mismatch", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-storage-mismatch", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });

    const refAsset: ReferenceAsset = {
      id: "ref-asset-badhash" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/bad.png",
      contentHashSha256: "expected-hash",
      mimeType: "image/png",
      assetType: "image"
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "style",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(validCampaign);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: Buffer.from("actual bytes") }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue("different-actual-hash")
    };

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });
    await expect(useCase.execute({ sceneId: "scene-storage-mismatch" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when MiniMax scene has no approved ShotPlan", async () => {
    const scene = createApprovedScene("scene-no-shotplan", {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
      durationMs: 5000
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-no-shotplan" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when ShotPlan specRevision does not match current scene specRevision", async () => {
    const shotPlan = createApprovedShotPlan("scene-stale-shotplan", {
      specRevision: 1
    });
    const baseScene = createApprovedSceneWithShotPlan("scene-stale-shotplan", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const scene = Scene.reconstitute({
      ...baseScene.snapshot(),
      specRevision: 2,
      approval: {
        revision: 2,
        approvedBy: "Director Dave",
        approvedAt: "2026-08-30T12:00:00.000Z"
      },
      approvedShotPlanRevision: 1
    });

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedShotPlan(shotPlan);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-stale-shotplan" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when ShotPlan is not approved (draft status)", async () => {
    const shotPlan = createApprovedShotPlan("scene-draft-shotplan", {
      status: "draft"
    });
    const scene = createApprovedSceneWithShotPlan("scene-draft-shotplan", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedShotPlan(shotPlan);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-draft-shotplan" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when reference binding has specRevision mismatch with current scene", async () => {
    const shotPlan = createApprovedShotPlan("scene-binding-stale", {
      specRevision: 1
    });
    const scene = createApprovedSceneWithShotPlan("scene-binding-stale", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1",
      specRevision: 1
    });

    const refAsset: ReferenceAsset = {
      id: "ref-asset-stale" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/stale.png",
      contentHashSha256: "somehash",
      mimeType: "image/png",
      assetType: "image"
    };
    // Binding has specRevision 2, but scene is at revision 1
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 2,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);

    const useCase = new EnqueueSceneProductionRenderUseCase(uow);
    await expect(useCase.execute({ sceneId: "scene-binding-stale" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when frame-anchored ShotPlan has frameAnchorTarget 'none'", async () => {
    const shotPlan = createApprovedShotPlan("scene-anchor-none", {
      routingMode: "frame_anchored",
      frameAnchorTarget: "none",
      anchorCandidateId: "cand-1"
    });
    const scene = createApprovedSceneWithShotPlan("scene-anchor-none", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_I2V_V1"
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedShotPlan(shotPlan);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(useCase.execute({ sceneId: "scene-anchor-none" })).rejects.toThrow(
      InvalidTransitionError
    );
  });

  it("fails closed when MiniMax scene specifies unsupported trim or loop intent", async () => {
    const shotPlan = createApprovedShotPlan("scene-minimax-trim", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-minimax-trim", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedShotPlan(shotPlan);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow);

    await expect(
      uow.execute(async (context) => {
        const loadedScene = await context.scenes.findById(scene.id);
        vi.spyOn(loadedScene!, "snapshot").mockReturnValue({
          ...loadedScene!.snapshot(),
          trim: { startMs: 100, endMs: 4000 }
        } as unknown as ReturnType<Scene["snapshot"]>);
        return useCase.executeWithContext(context, { sceneId: scene.id });
      })
    ).rejects.toThrow(UnrepresentableProductionConfigurationError);
  });

  it("fails closed when objectStorage is missing for reference-directed mode", async () => {
    const shotPlan = createApprovedShotPlan("scene-no-storage", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-no-storage", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedShotPlan(shotPlan);

    const useCase = new EnqueueSceneProductionRenderUseCase(uow);
    await expect(useCase.execute({ sceneId: "scene-no-storage" })).rejects.toThrow(
      /objectStorage dependency is mandatory/
    );
  });

  it("fails closed when reference asset client tenant does not match campaign client", async () => {
    const shotPlan = createApprovedShotPlan("scene-tenant-mismatch", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-tenant-mismatch", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });

    const refAsset: ReferenceAsset = {
      id: "ref-asset-other" as ReferenceAssetId,
      clientId: "other-client",
      storageBucket: "assets",
      storageObjectKey: "refs/other.png",
      contentHashSha256: validHash,
      mimeType: "image/png",
      assetType: "image"
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };

    const campaign: CampaignRecord = {
      id: "campaign-1" as CampaignId,
      clientId: "client-1",
      title: "Campaign 1",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 1,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], undefined, undefined, [campaign]).withJobs(
      queue
    );
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);
    uow.seedCampaignReferenceBible({
      campaignId: campaign.id,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(validHash)
    };

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });

    await expect(useCase.execute({ sceneId: "scene-tenant-mismatch" })).rejects.toThrow(
      /Reference canonicalization failed.*other-client/
    );
  });

  it("fails closed when reference asset image header format is invalid", async () => {
    const shotPlan = createApprovedShotPlan("scene-bad-header", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-bad-header", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });

    const corruptBytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    const corruptHash = "corrupt-hash";

    const refAsset: ReferenceAsset = {
      id: "ref-asset-corrupt" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/corrupt.png",
      contentHashSha256: corruptHash,
      mimeType: "image/png",
      assetType: "image"
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
    uow.seedCampaignReferenceBible({
      campaignId: validCampaign.id,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const objectStorage = {
      getObject: vi.fn().mockResolvedValue({ body: corruptBytes }),
      putObject: vi.fn(),
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      headObject: vi.fn()
    };
    const hashBytes = {
      hashBytes: vi.fn().mockResolvedValue(corruptHash)
    };

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage,
      hashBytes
    });

    await expect(useCase.execute({ sceneId: "scene-bad-header" })).rejects.toThrow(
      /invalid or unrecognized image byte format/
    );
  });

  it("fails closed when frame-anchored ShotPlan anchorMediaHashSha256 does not match candidate contentHash", async () => {
    const shotPlan = createApprovedShotPlan("scene-anchor-hash-mismatch", {
      routingMode: "frame_anchored",
      anchorCandidateId: "cand-1",
      anchorMediaHashSha256: "declared-hash"
    });
    const scene = createApprovedSceneWithShotPlan("scene-anchor-hash-mismatch", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_I2V_V1"
    });
    const candidate: StoryboardCandidate = {
      id: "cand-1" as CandidateId,
      sceneId: scene.id,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "assets",
      storageObjectKey: "candidates/cand-1.png",
      contentHash: "different-candidate-hash",
      generationMetadata: {},
      createdAt: new Date().toISOString()
    };

    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate]).withJobs(queue);
    uow.seedShotPlan(shotPlan);

    const useCase = new EnqueueSceneProductionRenderUseCase(uow);
    await expect(useCase.execute({ sceneId: "scene-anchor-hash-mismatch" })).rejects.toThrow(
      /content hash "different-candidate-hash" does not match/
    );
  });

  it("fails closed when context.campaigns is missing for reference-directed mode", async () => {
    const shotPlan = createApprovedShotPlan("scene-no-campaigns-repo", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-no-campaigns-repo", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const refAsset: ReferenceAsset = {
      id: "ref-asset-1" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/asset-1.png",
      contentHashSha256: validHash,
      mimeType: "image/png",
      assetType: "image"
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
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);
    uow.seedCampaignReferenceBible({
      campaignId: scene.campaignId,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage: {
        getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      },
      hashBytes: { hashBytes: vi.fn().mockResolvedValue(validHash) }
    });

    await expect(
      uow.execute(async (context) => {
        const contextWithoutCampaigns: UnitOfWorkContext = { ...context, campaigns: undefined };
        return useCase.executeWithContext(contextWithoutCampaigns, {
          sceneId: "scene-no-campaigns-repo"
        });
      })
    ).rejects.toThrow(/campaigns repository is required in UnitOfWorkContext/);
  });

  it("fails closed when campaign lacks clientId in context.campaigns", async () => {
    const shotPlan = createApprovedShotPlan("scene-no-client-id", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-no-client-id", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const refAsset: ReferenceAsset = {
      id: "ref-asset-1" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/asset-1.png",
      contentHashSha256: validHash,
      mimeType: "image/png",
      assetType: "image"
    };
    const binding: SceneReferenceBinding = {
      sceneId: scene.id,
      specRevision: 1,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      weight: 1
    };
    const campaignWithoutClientId: CampaignRecord = {
      ...validCampaign,
      clientId: ""
    };
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    uow.seedCampaign(campaignWithoutClientId);
    uow.seedShotPlan(shotPlan);
    uow.seedReferenceAsset(refAsset);
    uow.seedSceneBinding(binding);
    uow.seedCampaignReferenceBible({
      campaignId: campaignWithoutClientId.id,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage: {
        getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      },
      hashBytes: { hashBytes: vi.fn().mockResolvedValue(validHash) }
    });

    await expect(useCase.execute({ sceneId: "scene-no-client-id" })).rejects.toThrow(
      /not found or lacks clientId/
    );
  });

  it("fails closed when reference asset image header format does not match declared MIME", async () => {
    const shotPlan = createApprovedShotPlan("scene-mime-mismatch", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-mime-mismatch", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const refAsset: ReferenceAsset = {
      id: "ref-asset-1" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/asset-1.jpg",
      contentHashSha256: validHash,
      mimeType: "image/jpeg",
      assetType: "image"
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
    uow.seedCampaignReferenceBible({
      campaignId: validCampaign.id,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage: {
        getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      },
      hashBytes: { hashBytes: vi.fn().mockResolvedValue(validHash) }
    });

    await expect(useCase.execute({ sceneId: "scene-mime-mismatch" })).rejects.toThrow(
      /MIME type mismatch: declared "image\/jpeg", detected "image\/png"/
    );
  });

  it("fails closed when reference asset image dimensions do not match metadata width/height", async () => {
    const shotPlan = createApprovedShotPlan("scene-dim-mismatch", {
      routingMode: "reference_directed"
    });
    const scene = createApprovedSceneWithShotPlan("scene-dim-mismatch", shotPlan, {
      engineProfileId: "MINIMAX_H3_720P_5S_REF2V_V1"
    });
    const refAsset: ReferenceAsset = {
      id: "ref-asset-1" as ReferenceAssetId,
      clientId: "client-1",
      storageBucket: "assets",
      storageObjectKey: "refs/asset-1.png",
      contentHashSha256: validHash,
      mimeType: "image/png",
      assetType: "image",
      width: 500,
      height: 500
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
    uow.seedCampaignReferenceBible({
      campaignId: validCampaign.id,
      referenceAssetId: refAsset.id,
      role: "subject_identity",
      description: "Default subject description",
      biblePromptTag: "<Picture 1>",
      sourceContentHashSha256: refAsset.contentHashSha256,
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    });

    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      objectStorage: {
        getObject: vi.fn().mockResolvedValue({ body: validPngBytes }),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      },
      hashBytes: { hashBytes: vi.fn().mockResolvedValue(validHash) }
    });

    await expect(useCase.execute({ sceneId: "scene-dim-mismatch" })).rejects.toThrow(
      /width mismatch: expected 500, got 10/
    );
  });
});
