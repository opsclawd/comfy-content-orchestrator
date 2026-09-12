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

      let currentCampaign: CampaignRecord = campaign;
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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(async () => run),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(async () => run),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(async () => reviewRun),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 1), // 1 sibling remaining
        claimForProductionReview: vi.fn(),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(async () => undefined), // lost race
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        findById: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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
      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => undefined),
        findById: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn(),
        claimFailure: vi.fn()
      };

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

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScene),
        claimFailure: vi.fn(async () => ({
          id: "run-1",
          campaignId: "camp-1" as CampaignId,
          fingerprint: "fp",
          status: "failed" as const,
          expectedTotalDurationMs: 4000,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })),
        findById: vi.fn(),
        createIfAbsent: vi.fn(),
        insertRunScenes: vi.fn(),
        findByAssemblyJobId: vi.fn(),
        findRunScenes: vi.fn(async () => []),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForProductionReview: vi.fn(),
        claimForAssembly: vi.fn(),
        setAssemblyJobId: vi.fn(),
        claimCompletion: vi.fn()
      };

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
  });
});
