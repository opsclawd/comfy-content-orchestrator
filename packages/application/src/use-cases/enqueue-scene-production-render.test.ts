import { describe, expect, it, vi } from "vitest";
import {
  InvalidTransitionError,
  Scene,
  type CampaignId,
  type CandidateId,
  type SceneId
} from "@cco/domain";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import * as contracts from "@cco/contracts";
import {
  EnqueueSceneProductionRenderUseCase,
  LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE,
  LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
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

  it("explicitly legacy caller selects legacy text-to-video workflow when forceLegacyTextProfile is set or enableConditionedProfile is false", async () => {
    for (const options of [{ forceLegacyTextProfile: true }, { enableConditionedProfile: false }]) {
      const scene = createApprovedScene("scene-explicit-legacy", { durationMs: 4042 });
      const queue = new InMemoryJobQueue();
      const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
      const useCase = new EnqueueSceneProductionRenderUseCase(uow, options);

      const result = await useCase.execute({ sceneId: "scene-explicit-legacy" });

      expect(result.scene.status).toBe("queued");
      expect(result.job.jobKind).toBe("production");
      expect(result.job.workflowTemplate).toBe(LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE);
      expect(result.job.sceneId).toBe("scene-explicit-legacy");

      const payload = result.job.injectedPayload as {
        prompt: string;
        seed: number;
        approvedCandidateId: string;
        frameCount: number;
      };
      expect(payload.prompt).toBe("Cinematic sunset over mountain peak");
      expect(payload.frameCount).toBe(97);
      expect(payload.approvedCandidateId).toBe("cand-1");
      expect(Number.isSafeInteger(payload.seed)).toBe(true);
      expect(payload.seed).toBeGreaterThanOrEqual(0);

      expect(uow.savedScenes).toHaveLength(1);
      expect(uow.savedScenes[0]!.status).toBe("queued");
      expect(result.scene.activeProductionJobId).toBe(result.job.jobId);
      expect(queue.jobs).toHaveLength(1);
    }
  });

  it("happy path with enableConditionedProfile: enqueues I2V production job without frameCount and with approved candidate", async () => {
    const scene = createApprovedScene("scene-happy-conditioned", { durationMs: 4042 });
    const queue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(queue);
    const useCase = new EnqueueSceneProductionRenderUseCase(uow, {
      enableConditionedProfile: true
    });

    const result = await useCase.execute({ sceneId: "scene-happy-conditioned" });

    expect(result.scene.status).toBe("queued");
    expect(result.job.jobKind).toBe("production");
    expect(result.job.workflowTemplate).toBe(LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE);
    expect(result.job.sceneId).toBe("scene-happy-conditioned");

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
});
