import { describe, expect, it, vi } from "vitest";
import type { PersistentMediaRef } from "@cco/contracts";
import type {
  CampaignId,
  CampaignProductionRunRecord,
  CampaignProductionRunSceneRecord,
  CampaignRecord,
  DeliveryAssemblyJob,
  SceneId
} from "@cco/domain";
import type {
  AssemblySpec,
  CampaignProductionRunRepository,
  CampaignRepository,
  DeliveryAssemblyJobQueuePort,
  EnqueueDeliveryAssemblyJobInput,
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
    it("atomically claims assembly, synthesizes AssemblySpec, and advances campaign to qa", async () => {
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

      const runScenes: CampaignProductionRunSceneRecord[] = [
        {
          runId: "run-1",
          sceneId: "scene-2" as SceneId,
          specRevision: 1,
          sequenceIndex: 2,
          expectedDurationMs: 4000,
          productionJobId: "job-2"
        },
        {
          runId: "run-1",
          sceneId: "scene-1" as SceneId,
          specRevision: 1,
          sequenceIndex: 1,
          expectedDurationMs: 4000,
          productionJobId: "job-1"
        }
      ];

      const assemblingRun: CampaignProductionRunRecord = {
        ...run,
        status: "assembling"
      };

      const mockRuns: CampaignProductionRunRepository = {
        findRunSceneByProductionJobId: vi.fn(async () => runScenes[0]),
        findById: vi.fn(async () => run),
        findRunScenes: vi.fn(async () => runScenes),
        countIncompleteRunScenes: vi.fn(async () => 0),
        claimForAssembly: vi.fn(async () => assemblingRun),
        setAssemblyJobId: vi.fn(async () => {}),
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

      const stemSources: Record<
        string,
        { readonly generationManifestId: string; readonly media: PersistentMediaRef }
      > = {
        "job-1": {
          generationManifestId: "manifest-1",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-1.mp4",
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          }
        },
        "job-2": {
          generationManifestId: "manifest-2",
          media: {
            bucket: "test-bucket",
            key: "renders/scene-2.mp4",
            sha256: "b".repeat(64),
            contentType: "video/mp4"
          }
        }
      };

      const mockManifestRepo: GenerationManifestRepository = {
        getComponentIdentityById: vi.fn(),
        findVideoStemSourceByJobId: vi.fn(async (jobId) => stemSources[jobId])
      };

      const enqueuedAssemblyJobs: EnqueueDeliveryAssemblyJobInput[] = [];
      const mockAssemblyQueue: DeliveryAssemblyJobQueuePort = {
        enqueue: vi.fn(async (input) => {
          enqueuedAssemblyJobs.push(input);
          return { jobId: "assembly-job-123" } as unknown as DeliveryAssemblyJob<AssemblySpec>;
        }),
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

      expect(mockRuns.claimForAssembly).toHaveBeenCalledWith("run-1");
      expect(enqueuedAssemblyJobs).toHaveLength(1);

      const enqueuedInput = enqueuedAssemblyJobs[0]!;
      expect(enqueuedInput.campaignId).toBe("camp-1");
      expect(enqueuedInput.assemblySpec.expectedTotalDurationMs).toBe(8000);
      // Video stems must be ordered by 0-based wire index: sequenceIndex 1 -> 0, sequenceIndex 2 -> 1
      expect(enqueuedInput.assemblySpec.videoStems).toHaveLength(2);
      expect(enqueuedInput.assemblySpec.videoStems[0]!.order).toBe(0);
      expect(enqueuedInput.assemblySpec.videoStems[0]!.sceneId).toBe("scene-1");
      expect(enqueuedInput.assemblySpec.videoStems[0]!.media.sha256).toBe("a".repeat(64));
      expect(enqueuedInput.assemblySpec.videoStems[0]!.media.contentType).toBe("video/mp4");

      expect(enqueuedInput.assemblySpec.videoStems[1]!.order).toBe(1);
      expect(enqueuedInput.assemblySpec.videoStems[1]!.sceneId).toBe("scene-2");
      expect(enqueuedInput.assemblySpec.videoStems[1]!.media.sha256).toBe("b".repeat(64));

      // Campaign advanced to qa
      expect(savedCampaigns).toHaveLength(1);
      expect(savedCampaigns[0]?.status).toBe("qa");
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
