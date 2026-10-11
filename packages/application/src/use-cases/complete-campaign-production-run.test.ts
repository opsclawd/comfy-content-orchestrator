import { describe, expect, it, vi } from "vitest";
import type {
  CampaignId,
  CampaignProductionRunRecord,
  CampaignProductionRunSceneRecord,
  CampaignRecord,
  SceneId
} from "@cco/domain";
import type {
  CampaignProductionRunRepository,
  CampaignRepository,
  DeliveryAssemblyJobQueuePort,
  GenerationManifestRepository,
  UnitOfWork
} from "../index.js";
import { CompleteCampaignProductionRunUseCases } from "./complete-campaign-production-run.js";

function createMockRuns(
  overrides: Partial<CampaignProductionRunRepository>
): CampaignProductionRunRepository {
  return {
    createIfAbsent: vi.fn(),
    insertRunScenes: vi.fn(),
    findById: vi.fn(),
    findByIdForUpdate: vi.fn(),
    findByAssemblyJobId: vi.fn(),
    findRunScenes: vi.fn(async () => []),
    findRunSceneBySceneId: vi.fn(),
    findRunSceneByProductionJobId: vi.fn(),
    recordProductionAttempt: vi.fn(),
    findAttemptByProductionJobId: vi.fn(),
    updateCurrentAttempt: vi.fn(),
    recordAcceptedAttempt: vi.fn(),
    countIncompleteRunScenes: vi.fn(async () => 0),
    claimForProductionReview: vi.fn(),
    claimForAssembly: vi.fn(),
    setAssemblyJobId: vi.fn(),
    claimCompletion: vi.fn(),
    claimFailure: vi.fn(),
    ...overrides
  };
}

describe("CompleteCampaignProductionRunUseCases", () => {
  describe("onProductionJobStarted", () => {
    it("transitions campaign status from queued to rendering when first production job starts", async () => {
      const campaign: CampaignRecord = {
        id: "camp-1" as CampaignId,
        clientId: "client-1",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "queued",
        totalScenes: 2,
        approvedScenes: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const run: CampaignProductionRunRecord = {
        id: "run-1",
        campaignId: "camp-1" as CampaignId,
        fingerprint: "fp-1",
        status: "dispatched",
        expectedTotalDurationMs: 8000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: "job-1"
      };

      let currentCampaign = campaign;
      const savedCampaigns: CampaignRecord[] = [];
      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(async () => currentCampaign),
        findByIdForUpdate: vi.fn(async () => currentCampaign),
        save: vi.fn(async (c) => {
          savedCampaigns.push(c);
          currentCampaign = c;
        }),
        transitionStatusIf: vi.fn(async (_id, _from, to) => {
          currentCampaign = { ...currentCampaign, status: to };
          savedCampaigns.push(currentCampaign);
          return true;
        })
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(async () => run)
      });

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({ campaigns: mockCampaigns, campaignProductionRuns: mockRuns })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobStarted("job-1");

      expect(savedCampaigns).toHaveLength(1);
      expect(savedCampaigns[0]?.status).toBe("rendering");
    });
  });

  describe("onProductionJobCompleted", () => {
    it("atomically claims production review and advances campaign to qa without auto-assembly", async () => {
      const campaign: CampaignRecord = {
        id: "camp-1" as CampaignId,
        clientId: "client-1",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "rendering",
        totalScenes: 2,
        approvedScenes: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const run: CampaignProductionRunRecord = {
        id: "run-1",
        campaignId: "camp-1" as CampaignId,
        fingerprint: "fp-1",
        status: "dispatched",
        expectedTotalDurationMs: 8000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: "job-2"
      };

      const reviewRun: CampaignProductionRunRecord = {
        ...run,
        status: "production_review"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(async () => run),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(async () => reviewRun)
      });

      const savedCampaigns: CampaignRecord[] = [];
      let currentCampaign: CampaignRecord = campaign;
      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(async () => currentCampaign),
        findByIdForUpdate: vi.fn(async () => currentCampaign),
        save: vi.fn(async (c) => {
          currentCampaign = c;
          savedCampaigns.push(c);
        }),
        transitionStatusIf: vi.fn(async (_id, _from, to) => {
          currentCampaign = { ...currentCampaign, status: to };
          savedCampaigns.push(currentCampaign);
          return true;
        })
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async (_jobId) => ({
          generationManifestId: "manifest-2",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-2.mp4",
            sha256: "b".repeat(64),
            contentType: "video/mp4"
          },
          renderAttempt: 1
        }))
      };

      const mockAssemblyQueue: DeliveryAssemblyJobQueuePort = {
        enqueue: vi.fn(),
        claim: vi.fn(),
        start: vi.fn(),
        heartbeat: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        defer: vi.fn(),
        getJob: vi.fn()
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            assemblyJobs: mockAssemblyQueue,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("job-2");

      expect(mockRuns.claimForProductionReview).toHaveBeenCalledWith("run-1");
      expect(mockRuns.claimForAssembly).not.toHaveBeenCalled();
      expect(mockAssemblyQueue.enqueue).not.toHaveBeenCalled();

      // Campaign advanced to qa
      expect(savedCampaigns).toHaveLength(1);
      expect(savedCampaigns[0]?.status).toBe("qa");
    });

    it("does not transition run or campaign when sibling jobs are still incomplete", async () => {
      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: "job-1"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 1) // 1 sibling remaining
      });

      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(),
        findByIdForUpdate: vi.fn(),
        save: vi.fn(),
        transitionStatusIf: vi.fn()
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async () => ({
          generationManifestId: "manifest-1",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-1.mp4",
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          },
          renderAttempt: 1
        }))
      };

      const mockAssemblyQueue: DeliveryAssemblyJobQueuePort = {
        enqueue: vi.fn(),
        claim: vi.fn(),
        start: vi.fn(),
        heartbeat: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        defer: vi.fn(),
        getJob: vi.fn()
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            assemblyJobs: mockAssemblyQueue,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("job-1");

      expect(mockRuns.claimForProductionReview).not.toHaveBeenCalled();
      expect(mockCampaigns.transitionStatusIf).not.toHaveBeenCalled();
      expect(mockAssemblyQueue.enqueue).not.toHaveBeenCalled();
    });

    it("handles concurrent completion race idempotently when claimForProductionReview returns undefined", async () => {
      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: "job-2"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(async () => undefined) // lost race
      });

      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(),
        findByIdForUpdate: vi.fn(),
        save: vi.fn(),
        transitionStatusIf: vi.fn()
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async () => ({
          generationManifestId: "manifest-2",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-2.mp4",
            sha256: "b".repeat(64),
            contentType: "video/mp4"
          },
          renderAttempt: 1
        }))
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("job-2");

      expect(mockRuns.claimForProductionReview).toHaveBeenCalledWith("run-1");
      expect(mockCampaigns.transitionStatusIf).not.toHaveBeenCalled();
    });

    it("does not throw and does not claim production review when manifest resolution fails", async () => {
      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: "job-1"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0)
      });

      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(),
        findByIdForUpdate: vi.fn(),
        save: vi.fn(),
        transitionStatusIf: vi.fn()
      };

      // Throws manifest resolution error
      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async () => {
          throw new Error("Manifest corrupt or outputs missing");
        })
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      // Handler must not throw
      await expect(useCases.onProductionJobCompleted("job-1")).resolves.toBeUndefined();

      expect(mockRuns.claimForProductionReview).not.toHaveBeenCalled();
      expect(mockCampaigns.transitionStatusIf).not.toHaveBeenCalled();
    });

    it("returns early when job has no manifest returned", async () => {
      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: "job-1"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0)
      });

      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(),
        findByIdForUpdate: vi.fn(),
        save: vi.fn(),
        transitionStatusIf: vi.fn()
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async () => undefined)
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("job-1");

      expect(mockRuns.claimForProductionReview).not.toHaveBeenCalled();
      expect(mockCampaigns.transitionStatusIf).not.toHaveBeenCalled();
    });

    it("returns early when jobId does not match any run scene", async () => {
      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => undefined)
      });

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaignProductionRuns: mockRuns
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("unknown-job");

      expect(mockRuns.countIncompleteRunScenes).not.toHaveBeenCalled();
    });

    it("recovers a failed run and advances campaign from failed to qa when retried job completes with all siblings complete", async () => {
      const campaign: CampaignRecord = {
        id: "camp-1" as CampaignId,
        clientId: "client-1",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "failed",
        totalScenes: 2,
        approvedScenes: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const failedRun: CampaignProductionRunRecord = {
        id: "run-1",
        campaignId: "camp-1" as CampaignId,
        fingerprint: "fp-1",
        status: "failed",
        expectedTotalDurationMs: 8000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: "job-2-retry"
      };

      const reviewRun: CampaignProductionRunRecord = {
        ...failedRun,
        status: "production_review"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(async () => failedRun),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(async () => reviewRun)
      });

      const savedCampaigns: CampaignRecord[] = [];
      let currentCampaign: CampaignRecord = campaign;
      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(async () => currentCampaign),
        findByIdForUpdate: vi.fn(async () => currentCampaign),
        save: vi.fn(async (c) => {
          currentCampaign = c;
          savedCampaigns.push(c);
        }),
        transitionStatusIf: vi.fn(async (_id, from, to) => {
          const fromArr = Array.isArray(from) ? from : [from];
          if (!fromArr.includes(currentCampaign.status)) {
            return false;
          }
          currentCampaign = { ...currentCampaign, status: to };
          savedCampaigns.push(currentCampaign);
          return true;
        })
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async (_jobId) => ({
          generationManifestId: "manifest-2",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-2.mp4",
            sha256: "b".repeat(64),
            contentType: "video/mp4"
          },
          renderAttempt: 2
        }))
      };

      const mockAssemblyQueue: DeliveryAssemblyJobQueuePort = {
        enqueue: vi.fn(),
        claim: vi.fn(),
        start: vi.fn(),
        heartbeat: vi.fn(),
        complete: vi.fn(),
        fail: vi.fn(),
        defer: vi.fn(),
        getJob: vi.fn()
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            assemblyJobs: mockAssemblyQueue,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("job-2-retry");

      expect(mockRuns.claimForProductionReview).toHaveBeenCalledWith("run-1");
      expect(mockCampaigns.transitionStatusIf).toHaveBeenCalledWith(
        "camp-1",
        ["rendering", "queued", "failed"],
        "qa"
      );
      expect(currentCampaign.status).toBe("qa");
      expect(mockAssemblyQueue.enqueue).not.toHaveBeenCalled();
    });

    it("does not advance campaign to qa when claimForProductionReview returns undefined on a failed run", async () => {
      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: "job-2"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(async () => undefined)
      });

      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(),
        findByIdForUpdate: vi.fn(),
        save: vi.fn(),
        transitionStatusIf: vi.fn()
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async () => ({
          generationManifestId: "manifest-2",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-2.mp4",
            sha256: "b".repeat(64),
            contentType: "video/mp4"
          },
          renderAttempt: 2
        }))
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobCompleted("job-2");

      expect(mockRuns.claimForProductionReview).toHaveBeenCalledWith("run-1");
      expect(mockCampaigns.transitionStatusIf).not.toHaveBeenCalled();
    });

    it("handles full lifecycle: job fails -> run/campaign flip to failed -> job retried and succeeds -> run/campaign flip to production_review/qa", async () => {
      let currentCampaign: CampaignRecord = {
        id: "camp-1" as CampaignId,
        clientId: "client-1",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "rendering",
        totalScenes: 2,
        approvedScenes: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let currentRun: CampaignProductionRunRecord = {
        id: "run-1",
        campaignId: "camp-1" as CampaignId,
        fingerprint: "fp-1",
        status: "dispatched",
        expectedTotalDurationMs: 8000,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const scene1: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: "job-1"
      };

      const scene2: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: "job-2"
      };

      let incompleteCount = 1;

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async (jobId) => {
          if (jobId === "job-1") return scene1;
          if (jobId === "job-2" || jobId === "job-2-retry")
            return { ...scene2, productionJobId: jobId };
          return undefined;
        }),
        findById: vi.fn(async () => currentRun),
        countIncompleteRunScenes: vi.fn(async () => incompleteCount),
        claimFailure: vi.fn(async (runId) => {
          if (
            runId === currentRun.id &&
            ["dispatched", "production_review", "assembling"].includes(currentRun.status)
          ) {
            currentRun = { ...currentRun, status: "failed" };
            return currentRun;
          }
          return undefined;
        }),
        claimForProductionReview: vi.fn(async (runId) => {
          if (
            runId === currentRun.id &&
            ["dispatched", "failed"].includes(currentRun.status) &&
            incompleteCount === 0
          ) {
            currentRun = { ...currentRun, status: "production_review" };
            return currentRun;
          }
          return undefined;
        })
      });

      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(async () => currentCampaign),
        findByIdForUpdate: vi.fn(async () => currentCampaign),
        save: vi.fn(async (c) => {
          currentCampaign = c;
        }),
        transitionStatusIf: vi.fn(async (_id, from, to) => {
          const fromArr = Array.isArray(from) ? from : [from];
          if (!fromArr.includes(currentCampaign.status)) {
            return false;
          }
          currentCampaign = { ...currentCampaign, status: to };
          return true;
        })
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async (jobId) => ({
          generationManifestId: `manifest-${jobId}`,
          media: {
            bucket: "test-bucket",
            key: `renders/${jobId}.mp4`,
            sha256: "c".repeat(64),
            contentType: "video/mp4"
          },
          renderAttempt: 1
        }))
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({
            campaigns: mockCampaigns,
            campaignProductionRuns: mockRuns,
            generationManifests: mockManifestRepo
          })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);

      // 1. Job 2 fails
      await useCases.onProductionJobFailed("job-2");
      expect(currentRun.status).toBe("failed");
      expect(currentCampaign.status).toBe("failed");

      // 2. Retry of job-2 completes, but incomplete scenes remain (incompleteCount = 1)
      incompleteCount = 1;
      await useCases.onProductionJobCompleted("job-2-retry");
      expect(currentRun.status).toBe("failed");
      expect(currentCampaign.status).toBe("failed");

      // 3. Retry of job-2 completes, and all scenes in run are now complete (incompleteCount = 0)
      incompleteCount = 0;
      await useCases.onProductionJobCompleted("job-2-retry");
      expect(currentRun.status).toBe("production_review");
      expect(currentCampaign.status).toBe("qa");
    });
  });

  describe("onProductionJobFailed", () => {
    it("marks run failed and advances campaign to failed", async () => {
      const campaign: CampaignRecord = {
        id: "camp-1" as CampaignId,
        clientId: "client-1",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "rendering",
        totalScenes: 1,
        approvedScenes: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-1" as SceneId,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 4000,
        productionJobId: "job-1"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        claimFailure: vi.fn(async () => ({
          id: "run-1",
          campaignId: "camp-1" as CampaignId,
          fingerprint: "fp",
          status: "failed" as const,
          expectedTotalDurationMs: 4000,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }))
      });

      const savedCampaigns: CampaignRecord[] = [];
      let currentCampaign: CampaignRecord = campaign;
      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(async () => currentCampaign),
        findByIdForUpdate: vi.fn(async () => currentCampaign),
        save: vi.fn(async (c) => {
          currentCampaign = c;
          savedCampaigns.push(c);
        }),
        transitionStatusIf: vi.fn(async (_id, _from, to) => {
          currentCampaign = { ...currentCampaign, status: to };
          savedCampaigns.push(currentCampaign);
          return true;
        })
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({ campaigns: mockCampaigns, campaignProductionRuns: mockRuns })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobFailed("job-1");

      expect(mockRuns.claimFailure).toHaveBeenCalledWith("run-1");
      expect(savedCampaigns).toHaveLength(1);
      expect(savedCampaigns[0]?.status).toBe("failed");
    });

    it("transitions campaign from qa to failed when run in production_review fails", async () => {
      const campaign: CampaignRecord = {
        id: "camp-1" as CampaignId,
        clientId: "client-1",
        title: "Test Campaign",
        targetPlatform: "tiktok",
        status: "qa",
        totalScenes: 2,
        approvedScenes: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const runScene: CampaignProductionRunSceneRecord = {
        runId: "run-1",
        sceneId: "scene-2" as SceneId,
        specRevision: 1,
        sequenceIndex: 2,
        expectedDurationMs: 4000,
        productionJobId: "job-2"
      };

      const mockRuns = createMockRuns({
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        claimFailure: vi.fn(async () => ({
          id: "run-1",
          campaignId: "camp-1" as CampaignId,
          fingerprint: "fp",
          status: "failed" as const,
          expectedTotalDurationMs: 8000,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }))
      });

      const savedCampaigns: CampaignRecord[] = [];
      let currentCampaign: CampaignRecord = campaign;
      const mockCampaigns: CampaignRepository<CampaignRecord> = {
        findById: vi.fn(async () => currentCampaign),
        findByIdForUpdate: vi.fn(async () => currentCampaign),
        save: vi.fn(async (c) => {
          currentCampaign = c;
          savedCampaigns.push(c);
        }),
        transitionStatusIf: vi.fn(async (_id, from, to) => {
          const fromArr = Array.isArray(from) ? from : [from];
          if (!fromArr.includes(currentCampaign.status)) {
            return false;
          }
          currentCampaign = { ...currentCampaign, status: to };
          savedCampaigns.push(currentCampaign);
          return true;
        })
      };

      const mockUow: UnitOfWork = {
        execute: vi.fn(async (work) =>
          work({ campaigns: mockCampaigns, campaignProductionRuns: mockRuns })
        )
      };

      const useCases = new CompleteCampaignProductionRunUseCases(mockUow);
      await useCases.onProductionJobFailed("job-2");

      expect(mockRuns.claimFailure).toHaveBeenCalledWith("run-1");
      expect(mockCampaigns.transitionStatusIf).toHaveBeenCalledWith(
        "camp-1",
        ["queued", "rendering", "drafting", "qa"],
        "failed"
      );
      expect(savedCampaigns).toHaveLength(1);
      expect(savedCampaigns[0]?.status).toBe("failed");
    });
  });
});
