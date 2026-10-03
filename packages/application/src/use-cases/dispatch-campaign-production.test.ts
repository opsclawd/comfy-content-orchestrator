import { describe, expect, it, vi } from "vitest";
import {
  InvalidMutationError,
  Scene,
  ShotPlan,
  type CampaignId,
  type CampaignProductionRunRecord,
  type CampaignProductionRunSceneRecord,
  type CampaignRecord,
  type CandidateId,
  type JobId,
  type RenderJob,
  type SceneId,
  type ShotPlanId,
  type StoryboardCandidate
} from "@cco/domain";

import type {
  CampaignProductionRunRepository,
  CampaignRepository,
  EnqueueSceneProductionRenderUseCase,
  ReviewEventStore,
  SceneRepository,
  ShotPlanRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "../index.js";
import { CampaignNotFoundError } from "./campaign-not-found-error.js";
import { ApproveSceneAndDispatchCampaignProductionUseCase } from "./dispatch-campaign-production.js";
import { ReviewSceneUseCases } from "./review-scene.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

function createMockScene(
  id: string,
  campaignId: string,
  sequenceIndex: number,
  status: "draft_pending" | "director_review" | "approved" = "director_review"
): Scene {
  return Scene.reconstitute({
    id: id as SceneId,
    campaignId: campaignId as CampaignId,
    status,
    specRevision: 1,
    sequenceIndex,
    configuration: {
      prompt: `Prompt for ${id}`,
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 4000
    },
    selectedCandidateId: "cand-1" as CandidateId,
    selectedCandidateRevision: 1
  });
}

function createMockCampaign(id: string, totalScenes: number = 3): CampaignRecord {
  return {
    id: id as CampaignId,
    clientId: "client-1",
    title: "Test Campaign",
    targetPlatform: "tiktok",
    status: "drafting",
    totalScenes,
    approvedScenes: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createMockCampaignProductionRuns(
  overrides?: Partial<CampaignProductionRunRepository>
): CampaignProductionRunRepository {
  return {
    createIfAbsent: vi.fn(),
    insertRunScenes: vi.fn(),
    findById: vi.fn(),
    findByIdForUpdate: vi.fn(),
    findByAssemblyJobId: vi.fn(),
    findRunScenes: vi.fn(),
    findRunSceneBySceneId: vi.fn(),
    findRunSceneByProductionJobId: vi.fn(),
    recordProductionAttempt: vi.fn(),
    findAttemptByProductionJobId: vi.fn(),
    updateCurrentAttempt: vi.fn(),
    recordAcceptedAttempt: vi.fn(),
    countIncompleteRunScenes: vi.fn(),
    claimForProductionReview: vi.fn(),
    claimForAssembly: vi.fn(),
    setAssemblyJobId: vi.fn(),
    claimCompletion: vi.fn(),
    claimFailure: vi.fn(),
    ...overrides
  };
}

describe("ApproveSceneAndDispatchCampaignProductionUseCase", () => {
  it("enforces strict lock order: lock-free campaign discovery -> campaign lock -> scenes lock", async () => {
    const campaignId = "camp-1" as CampaignId;
    const scene1 = createMockScene("scene-1", campaignId, 1, "approved");
    const scene2 = createMockScene("scene-2", campaignId, 2, "approved");
    const scene3 = createMockScene("scene-3", campaignId, 3, "director_review");
    const campaign = createMockCampaign(campaignId, 3);

    const callOrder: string[] = [];

    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(),
      save: vi.fn(async () => {}),
      findCampaignIdBySceneId: vi.fn(async (sceneId: SceneId) => {
        callOrder.push(`findCampaignIdBySceneId:${sceneId}`);
        return campaignId;
      }),
      findByCampaignId: vi.fn(
        async (cId: CampaignId, options?: { readonly forUpdate?: boolean }) => {
          callOrder.push(`findByCampaignId:${cId}:forUpdate=${options?.forUpdate}`);
          return [scene1, scene2, scene3];
        }
      )
    };

    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(),
      findByIdForUpdate: vi.fn(async (cId: string) => {
        callOrder.push(`findByIdForUpdate:${cId}`);
        return campaign;
      }),
      save: vi.fn(async () => {
        callOrder.push("campaigns.save");
      }),
      transitionStatusIf: vi.fn(async () => {
        callOrder.push("campaigns.transitionStatusIf");
        return true;
      })
    };

    const mockRunsRepo: CampaignProductionRunRepository = createMockCampaignProductionRuns({
      createIfAbsent: vi.fn(async (input) => {
        callOrder.push("runs.createIfAbsent");
        const run: CampaignProductionRunRecord = {
          id: "run-1",
          campaignId: input.campaignId as CampaignId,
          fingerprint: input.fingerprint,
          status: "dispatched",
          expectedTotalDurationMs: input.expectedTotalDurationMs,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        return { run, created: true };
      }),
      insertRunScenes: vi.fn(async () => {
        callOrder.push("runs.insertRunScenes");
      })
    });

    const mockReviewEvents: ReviewEventStore = {
      findById: vi.fn(async () => undefined),
      append: vi.fn(async () => {})
    };

    const mockCandidates: StoryboardCandidateRepository = {
      findById: vi.fn(),
      insert: vi.fn(),
      listBySceneAndRevision: vi.fn(async () => [
        {
          id: "cand-1" as CandidateId,
          sceneId: "scene-3" as SceneId,
          specRevision: 1,
          variantOrdinal: 1,
          storageBucket: "b",
          storageObjectKey: "k",
          contentHashSha256: "hash"
        } as unknown as StoryboardCandidate
      ])
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) => {
        const ctx: UnitOfWorkContext = {
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: mockRunsRepo,
          reviewEvents: mockReviewEvents,
          candidates: mockCandidates
        };
        return work(ctx);
      })
    };

    const mockEnqueueProductionRender = {
      execute: vi.fn(),
      executeWithContext: vi.fn(async (_ctx, input) => {
        callOrder.push(`enqueueSceneProductionRender:${input.sceneId}`);
        return {
          job: {
            jobId: `job-${input.sceneId}`,
            sceneId: input.sceneId,
            jobKind: "production",
            status: "queued"
          } as unknown as RenderJob,
          isExisting: false
        };
      })
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      mockEnqueueProductionRender
    );

    const result = await useCase.execute({
      sceneId: "scene-3",
      eventId: "evt-1",
      reviewerName: "Director",
      occurredAt: new Date().toISOString()
    });

    expect(result.scene.status).toBe("approved");

    // Verify exact lock order
    expect(callOrder[0]).toBe("findCampaignIdBySceneId:scene-3");
    expect(callOrder[1]).toBe("findByIdForUpdate:camp-1");
    expect(callOrder[2]).toBe("findByCampaignId:camp-1:forUpdate=true");

    // Verify all 3 scenes were dispatched
    expect(callOrder).toContain("runs.createIfAbsent");
    expect(callOrder).toContain("enqueueSceneProductionRender:scene-1");
    expect(callOrder).toContain("enqueueSceneProductionRender:scene-2");
    expect(callOrder).toContain("enqueueSceneProductionRender:scene-3");
    expect(callOrder).toContain("runs.insertRunScenes");
    expect(callOrder).toContain("campaigns.transitionStatusIf");
  });

  it("fails fast with SceneNotFoundError if scene has no owning campaign", async () => {
    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(),
      save: vi.fn(),
      findCampaignIdBySceneId: vi.fn(async () => undefined),
      findByCampaignId: vi.fn()
    };
    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(),
      findByIdForUpdate: vi.fn(),
      save: vi.fn(),
      transitionStatusIf: vi.fn(async () => true)
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: createMockCampaignProductionRuns()
        })
      )
    };

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      {} as unknown as EnqueueSceneProductionRenderUseCase
    );

    await expect(
      useCase.execute({
        sceneId: "nonexistent",
        eventId: "evt-1",
        reviewerName: "Director",
        occurredAt: new Date().toISOString()
      })
    ).rejects.toThrow(SceneNotFoundError);
  });

  it("fails fast with CampaignNotFoundError if campaign row is not found", async () => {
    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(),
      save: vi.fn(),
      findCampaignIdBySceneId: vi.fn(async () => "camp-unknown" as CampaignId),
      findByCampaignId: vi.fn()
    };
    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(),
      findByIdForUpdate: vi.fn(async () => undefined),
      save: vi.fn(),
      transitionStatusIf: vi.fn(async () => true)
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: createMockCampaignProductionRuns()
        })
      )
    };

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      {} as unknown as EnqueueSceneProductionRenderUseCase
    );

    await expect(
      useCase.execute({
        sceneId: "scene-1",
        eventId: "evt-1",
        reviewerName: "Director",
        occurredAt: new Date().toISOString()
      })
    ).rejects.toThrow(CampaignNotFoundError);
  });

  it("evaluates live readiness from live scene state and does NOT dispatch if scenes are incomplete", async () => {
    const campaignId = "camp-1" as CampaignId;
    const scene1 = createMockScene("scene-1", campaignId, 1, "approved");
    const scene2 = createMockScene("scene-2", campaignId, 2, "director_review");
    const scene3 = createMockScene("scene-3", campaignId, 3, "director_review");
    const campaign = createMockCampaign(campaignId, 3);

    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(),
      save: vi.fn(async () => {}),
      findCampaignIdBySceneId: vi.fn(async () => campaignId),
      findByCampaignId: vi.fn(async () => [scene1, scene2, scene3])
    };

    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(),
      findByIdForUpdate: vi.fn(async () => campaign),
      save: vi.fn(async () => {}),
      transitionStatusIf: vi.fn(async () => true)
    };

    const mockRunsRepo: CampaignProductionRunRepository = createMockCampaignProductionRuns({
      findRunScenes: vi.fn(async () => []),
      countIncompleteRunScenes: vi.fn(async () => 0)
    });

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: mockRunsRepo,
          reviewEvents: { findById: vi.fn(async () => undefined), append: vi.fn(async () => {}) },
          candidates: {
            findById: vi.fn(),
            insert: vi.fn(),
            listBySceneAndRevision: vi.fn(async () => [
              {
                id: "cand-1" as CandidateId,
                sceneId: "scene-2" as SceneId,
                specRevision: 1,
                variantOrdinal: 1,
                storageBucket: "b",
                storageObjectKey: "k",
                contentHashSha256: "hash"
              } as unknown as StoryboardCandidate
            ])
          }
        })
      )
    };

    const mockEnqueueProductionRender = {
      executeWithContext: vi.fn()
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      mockEnqueueProductionRender
    );

    // Approving scene-2 means scene-1 and scene-2 are approved, but scene-3 is still in director_review
    const result = await useCase.execute({
      sceneId: "scene-2",
      eventId: "evt-1",
      reviewerName: "Director",
      occurredAt: new Date().toISOString()
    });

    expect(result.scene.status).toBe("approved");
    // Should NOT have created production run
    expect(mockRunsRepo.createIfAbsent).not.toHaveBeenCalled();
    // Should NOT have enqueued production render
    expect(mockEnqueueProductionRender.executeWithContext).not.toHaveBeenCalled();
    // Campaign status remains drafting, approvedScenes count updated to 2
    expect(mockCampaignsRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "drafting",
        approvedScenes: 2
      })
    );
  });

  it("proves all campaign scenes dispatched to queued reject configuration edits with InvalidMutationError and zero state change [AC-4]", async () => {
    const campaignId = "camp-immut-1" as CampaignId;
    const scene1 = createMockScene("scene-1", campaignId, 1, "approved");
    const scene2 = createMockScene("scene-2", campaignId, 2, "approved");
    const scene3 = createMockScene("scene-3", campaignId, 3, "director_review");
    let currentCampaign: CampaignRecord = createMockCampaign(campaignId, 3);

    const scenesMap = new Map<string, Scene>([
      ["scene-1", scene1],
      ["scene-2", scene2],
      ["scene-3", scene3]
    ]);

    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(async (sId: SceneId) => scenesMap.get(sId)),
      save: vi.fn(async (scene: Scene) => {
        scenesMap.set(scene.id, scene);
      }),
      findCampaignIdBySceneId: vi.fn(async () => campaignId),
      findByCampaignId: vi.fn(async () => Array.from(scenesMap.values()))
    };

    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(async () => currentCampaign),
      findByIdForUpdate: vi.fn(async () => currentCampaign),
      save: vi.fn(async (c: CampaignRecord) => {
        currentCampaign = c;
      }),
      transitionStatusIf: vi.fn(async (_id, _from, to, patch) => {
        currentCampaign = {
          ...currentCampaign,
          status: to,
          ...(patch?.approvedScenes !== undefined ? { approvedScenes: patch.approvedScenes } : {})
        };
        return true;
      })
    };

    const mockRunsRepo: CampaignProductionRunRepository = createMockCampaignProductionRuns({
      createIfAbsent: vi.fn(async (input) => {
        const run: CampaignProductionRunRecord = {
          id: "run-immut-1",
          campaignId: input.campaignId as CampaignId,
          fingerprint: input.fingerprint,
          status: "dispatched",
          expectedTotalDurationMs: input.expectedTotalDurationMs,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        return { run, created: true };
      }),
      insertRunScenes: vi.fn(async () => {}),
      findRunScenes: vi.fn(async () => []),
      countIncompleteRunScenes: vi.fn(async () => 0)
    });

    const mockCandidates: StoryboardCandidateRepository = {
      findById: vi.fn(
        async (candId: CandidateId) =>
          ({
            id: candId,
            sceneId: "scene-3" as SceneId,
            specRevision: 1,
            variantOrdinal: 1,
            storageBucket: "b",
            storageObjectKey: "k",
            contentHashSha256: "hash"
          }) as unknown as StoryboardCandidate
      ),
      insert: vi.fn(),
      listBySceneAndRevision: vi.fn(async () => [
        {
          id: "cand-1" as CandidateId,
          sceneId: "scene-3" as SceneId,
          specRevision: 1,
          variantOrdinal: 1,
          storageBucket: "b",
          storageObjectKey: "k",
          contentHashSha256: "hash"
        } as unknown as StoryboardCandidate
      ])
    };

    const mockReviewEvents: ReviewEventStore = {
      findById: vi.fn(async () => undefined),
      append: vi.fn(async () => {})
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: mockRunsRepo,
          reviewEvents: mockReviewEvents,
          candidates: mockCandidates
        })
      )
    };

    // Use mock EnqueueSceneProductionRender that advances each scene to queued
    const mockEnqueueProductionRender = {
      execute: vi.fn(),
      executeWithContext: vi.fn(async (ctx, input) => {
        const scene = scenesMap.get(input.sceneId)!;
        scene.queueForProduction(`job-${input.sceneId}`);
        await ctx.scenes.save(scene);
        return {
          job: {
            jobId: `job-${input.sceneId}`,
            sceneId: input.sceneId,
            jobKind: "production",
            status: "queued"
          } as unknown as RenderJob,
          isExisting: false
        };
      })
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const dispatchUseCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      mockEnqueueProductionRender
    );

    // Approve the final scene (scene-3), triggering full campaign dispatch
    await dispatchUseCase.execute({
      sceneId: "scene-3",
      eventId: "evt-dispatch",
      reviewerName: "Director",
      occurredAt: new Date().toISOString()
    });

    expect(currentCampaign.status).toBe("queued");

    const reviewUseCases = new ReviewSceneUseCases(mockUow);

    // Check all scenes in the campaign
    const allDispatchedScenes = Array.from(scenesMap.values());
    expect(allDispatchedScenes.length).toBe(3);

    for (const scene of allDispatchedScenes) {
      // Every scene must be in queued status
      expect(scene.status).toBe("queued");
      const beforeSnapshot = JSON.parse(JSON.stringify(scene.snapshot()));

      // 1. Direct domain method calls must throw InvalidMutationError
      expect(() => scene.updatePrompt("Illegal Prompt")).toThrow(InvalidMutationError);
      expect(() => scene.updateDuration(8000)).toThrow(InvalidMutationError);
      expect(() => scene.updateEngine("ltx_25")).toThrow(InvalidMutationError);
      expect(() => scene.updateReferences(["ref-new"])).toThrow(InvalidMutationError);
      expect(() => scene.updateLora("lora-new")).toThrow(InvalidMutationError);

      // Verify domain state has zero changes
      expect(scene.snapshot()).toEqual(beforeSnapshot);

      // 2. Application use case calls must also reject with InvalidMutationError
      await expect(
        reviewUseCases.updatePrompt({
          sceneId: scene.id,
          eventId: `evt-edit-prompt-${scene.id}`,
          reviewerName: "Director",
          occurredAt: new Date().toISOString(),
          prompt: "Illegal UseCase Prompt"
        })
      ).rejects.toThrow(InvalidMutationError);

      await expect(
        reviewUseCases.updateDuration({
          sceneId: scene.id,
          eventId: `evt-edit-duration-${scene.id}`,
          reviewerName: "Director",
          occurredAt: new Date().toISOString(),
          durationMs: 8000
        })
      ).rejects.toThrow(InvalidMutationError);

      await expect(
        reviewUseCases.updateEngine({
          sceneId: scene.id,
          eventId: `evt-edit-engine-${scene.id}`,
          reviewerName: "Director",
          occurredAt: new Date().toISOString(),
          engineProfileId: "ltx_25"
        })
      ).rejects.toThrow(InvalidMutationError);

      await expect(
        reviewUseCases.updateReferences({
          sceneId: scene.id,
          eventId: `evt-edit-refs-${scene.id}`,
          reviewerName: "Director",
          occurredAt: new Date().toISOString(),
          referenceIds: ["ref-new"]
        })
      ).rejects.toThrow(InvalidMutationError);

      await expect(
        reviewUseCases.updateLora({
          sceneId: scene.id,
          eventId: `evt-edit-lora-${scene.id}`,
          reviewerName: "Director",
          occurredAt: new Date().toISOString(),
          loraConfigurationId: "lora-new"
        })
      ).rejects.toThrow(InvalidMutationError);

      // Verify repo snapshot remains completely identical (zero state change)
      const persistedScene = await mockScenesRepo.findById(scene.id);
      expect(persistedScene!.snapshot()).toEqual(beforeSnapshot);
    }
  });

  it("proves readiness is derived from live scene state: editing approved scene reverts readiness without counter reconciliation", async () => {
    const campaignId = "camp-live-readiness" as CampaignId;
    const scene1 = createMockScene("scene-1", campaignId, 1, "approved");
    const scene2 = createMockScene("scene-2", campaignId, 2, "director_review");
    const scene3 = createMockScene("scene-3", campaignId, 3, "director_review");
    let currentCampaign: CampaignRecord = createMockCampaign(campaignId, 3);

    const scenesMap = new Map<string, Scene>([
      ["scene-1", scene1],
      ["scene-2", scene2],
      ["scene-3", scene3]
    ]);

    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(async (sId: SceneId) => scenesMap.get(sId)),
      save: vi.fn(async (scene: Scene) => {
        scenesMap.set(scene.id, scene);
      }),
      findCampaignIdBySceneId: vi.fn(async () => campaignId),
      findByCampaignId: vi.fn(async () => Array.from(scenesMap.values()))
    };

    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(async () => currentCampaign),
      findByIdForUpdate: vi.fn(async () => currentCampaign),
      save: vi.fn(async (c: CampaignRecord) => {
        currentCampaign = c;
      }),
      transitionStatusIf: vi.fn(async (_id, _from, to, patch) => {
        currentCampaign = {
          ...currentCampaign,
          status: to,
          ...(patch?.approvedScenes !== undefined ? { approvedScenes: patch.approvedScenes } : {})
        };
        return true;
      })
    };

    const createdRuns: CampaignProductionRunRecord[] = [];
    const mockRunsRepo: CampaignProductionRunRepository = createMockCampaignProductionRuns({
      createIfAbsent: vi.fn(async (input) => {
        const run: CampaignProductionRunRecord = {
          id: `run-${createdRuns.length + 1}`,
          campaignId: input.campaignId as CampaignId,
          fingerprint: input.fingerprint,
          status: "dispatched",
          expectedTotalDurationMs: input.expectedTotalDurationMs,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        createdRuns.push(run);
        return { run, created: true };
      }),
      insertRunScenes: vi.fn(async () => {}),
      findRunScenes: vi.fn(async () => []),
      countIncompleteRunScenes: vi.fn(async () => 0)
    });

    const mockCandidates: StoryboardCandidateRepository = {
      findById: vi.fn(
        async (candId: CandidateId) =>
          ({
            id: candId,
            sceneId: "scene-2" as SceneId,
            specRevision: 1,
            variantOrdinal: 1,
            storageBucket: "b",
            storageObjectKey: "k",
            contentHashSha256: "hash"
          }) as unknown as StoryboardCandidate
      ),
      insert: vi.fn(),
      listBySceneAndRevision: vi.fn(async () => [
        {
          id: "cand-1" as CandidateId,
          sceneId: "scene-2" as SceneId,
          specRevision: 1,
          variantOrdinal: 1,
          storageBucket: "b",
          storageObjectKey: "k",
          contentHashSha256: "hash"
        } as unknown as StoryboardCandidate
      ])
    };

    const mockReviewEvents: ReviewEventStore = {
      findById: vi.fn(async () => undefined),
      append: vi.fn(async () => {})
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) =>
        work({
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: mockRunsRepo,
          reviewEvents: mockReviewEvents,
          candidates: mockCandidates
        })
      )
    };

    const enqueuedJobs: string[] = [];
    const mockEnqueueProductionRender = {
      execute: vi.fn(),
      executeWithContext: vi.fn(async (ctx, input) => {
        enqueuedJobs.push(input.sceneId);
        const scene = scenesMap.get(input.sceneId)!;
        scene.queueForProduction(`job-${input.sceneId}`);
        await ctx.scenes.save(scene);
        return {
          job: {
            jobId: `job-${input.sceneId}`,
            sceneId: input.sceneId,
            jobKind: "production",
            status: "queued"
          } as unknown as RenderJob,
          isExisting: false
        };
      })
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      mockEnqueueProductionRender
    );

    // Step 1: Approve scene-2 (now scene-1 and scene-2 are approved, scene-3 is still in review)
    await useCase.execute({
      sceneId: "scene-2",
      eventId: "evt-approve-2",
      reviewerName: "Director",
      occurredAt: new Date().toISOString()
    });

    expect(scene2.status).toBe("approved");
    expect(createdRuns.length).toBe(0);
    expect(currentCampaign.status).toBe("drafting");
    expect(currentCampaign.approvedScenes).toBe(2);

    // Step 2: Edit scene-1's configuration. This automatically reverts scene-1 to director_review
    // and bumps specRevision to 2. No counter reconciliation is performed.
    scene1.updatePrompt("Revised prompt for scene 1");
    expect(scene1.status).toBe("director_review");
    expect(scene1.snapshot().specRevision).toBe(2);

    // Step 3: Now approve scene-3.
    // If readiness were based on a stored counter or increment, it might think 3 scenes are approved.
    // But live readiness re-evaluates all scenes: scene-1 is director_review, so ready is FALSE!
    await useCase.execute({
      sceneId: "scene-3",
      eventId: "evt-approve-3",
      reviewerName: "Director",
      occurredAt: new Date().toISOString()
    });

    expect(scene3.status).toBe("approved");
    expect(createdRuns.length).toBe(0);
    expect(enqueuedJobs.length).toBe(0);
    expect(currentCampaign.status).toBe("drafting");
    // Live count of approved scenes is 2 (scene-2 and scene-3)
    expect(currentCampaign.approvedScenes).toBe(2);

    // Step 4: Re-approve scene-1 at revision 2.
    // Select candidate at revision 2 first
    scene1.selectCandidate("cand-1-rev2" as CandidateId, 2, scene1.id);
    // Now all 3 scenes are live-approved!
    await useCase.execute({
      sceneId: "scene-1",
      eventId: "evt-reapprove-1",
      reviewerName: "Director",
      occurredAt: new Date().toISOString()
    });

    expect(scene1.status).toBe("queued");
    expect(scene2.status).toBe("queued");
    expect(scene3.status).toBe("queued");
    expect(createdRuns.length).toBe(1);
    expect(enqueuedJobs).toEqual(["scene-1", "scene-2", "scene-3"]);
    expect(currentCampaign.status).toBe("queued");
    expect(currentCampaign.approvedScenes).toBe(3);
  });

  it("atomically approves ShotPlan and dispatches campaign production when all scenes are approved", async () => {
    const campaignId = "camp-shotplan-1" as CampaignId;
    const scene1 = createMockScene("scene-sp-1", campaignId, 1, "approved");
    const scene2 = createMockScene("scene-sp-2", campaignId, 2, "director_review");
    const shotPlanId = "01928374-abcd-7000-8000-000000000099" as ShotPlanId;
    const shotPlan = ShotPlan.create({
      id: shotPlanId,
      sceneId: scene2.id,
      specRevision: 1,
      variantOrdinal: 1,
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "28mm",
      cameraPosition: "tripod",
      cameraMovement: "static",
      movementSpeed: "medium",
      cameraPromptDescription: "previs",
      actionSummary: "action",
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Full action",
          cameraAction: "holds",
          subjectAction: "moves"
        }
      ],
      lightingStyle: "softbox_studio",
      environmentDescription: "studio",
      routingMode: "reference_directed",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none"
      }
    });
    scene2.selectShotPlan(shotPlanId, 1, scene2.id);

    let currentCampaign = {
      ...createMockCampaign(campaignId, 2),
      approvedScenes: 1
    };

    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(async (id: SceneId) => (id === scene2.id ? scene2 : scene1)),
      save: vi.fn(async () => {}),
      findCampaignIdBySceneId: vi.fn(async () => campaignId),
      findByCampaignId: vi.fn(async () => [scene1, scene2])
    };

    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(async () => currentCampaign),
      findByIdForUpdate: vi.fn(async () => currentCampaign),
      save: vi.fn(async (c) => {
        currentCampaign = c;
      }),
      transitionStatusIf: vi.fn(async (_id, _from, to, meta) => {
        currentCampaign = {
          ...currentCampaign,
          status: to,
          ...(meta?.approvedScenes !== undefined ? { approvedScenes: meta.approvedScenes } : {})
        };
        return true;
      })
    };

    let createdRun = false;
    const mockRunsRepo: CampaignProductionRunRepository = createMockCampaignProductionRuns({
      createIfAbsent: vi.fn(async (input) => {
        createdRun = true;
        const run: CampaignProductionRunRecord = {
          id: "run-sp-1",
          campaignId: input.campaignId as CampaignId,
          fingerprint: input.fingerprint,
          status: "dispatched",
          expectedTotalDurationMs: input.expectedTotalDurationMs,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        return { run, created: true };
      }),
      insertRunScenes: vi.fn(async () => {})
    });

    const mockReviewEvents: ReviewEventStore = {
      findById: vi.fn(async () => undefined),
      append: vi.fn(async () => {})
    };

    const mockShotPlansRepo: ShotPlanRepository = {
      findById: vi.fn(async (id: ShotPlanId) => (id === shotPlanId ? shotPlan : undefined)),
      save: vi.fn(async () => {}),
      saveMany: vi.fn(async () => {}),
      listBySceneAndRevision: vi.fn(async () => [shotPlan]),
      listByScene: vi.fn(async () => [shotPlan]),
      listByIdempotencyKey: vi.fn(async () => [])
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (work) => {
        const ctx: UnitOfWorkContext = {
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: mockRunsRepo,
          reviewEvents: mockReviewEvents,
          candidates: {
            findById: vi.fn(),
            insert: vi.fn(),
            listBySceneAndRevision: vi.fn(async () => [])
          },
          shotPlans: mockShotPlansRepo
        };
        return work(ctx);
      })
    };

    const enqueuedScenes: string[] = [];
    const mockEnqueueProductionRender = {
      execute: vi.fn(),
      executeWithContext: vi.fn(async (_ctx, input) => {
        enqueuedScenes.push(input.sceneId);
        return {
          job: {
            jobId: `job-${input.sceneId}` as JobId,
            sceneId: input.sceneId,
            jobKind: "production",
            status: "queued"
          } as unknown as RenderJob,
          isExisting: false
        };
      })
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      mockEnqueueProductionRender
    );

    const result = await useCase.execute({
      action: "approve_shotplan",
      shotPlanId,
      sceneId: scene2.id,
      eventId: "evt-approve-sp",
      reviewerName: "Director",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 1
    });

    expect(result.scene.status).toBe("approved");
    expect(result.scene.approvedShotPlanId).toBe(shotPlanId);
    expect(shotPlan.status).toBe("approved");
    expect(createdRun).toBe(true);
    expect(enqueuedScenes).toEqual([scene1.id, scene2.id]);
    expect(currentCampaign.status).toBe("queued");
    expect(currentCampaign.approvedScenes).toBe(2);
  });

  it("enqueues single scene for production render when re-approving a scene belonging to an existing campaign run", async () => {
    const campaignId = "camp-reapprove-1" as CampaignId;
    const scene1 = createMockScene("scene-re-1" as SceneId, campaignId, 1);
    const scene2 = createMockScene("scene-re-2" as SceneId, campaignId, 2);

    // Scene 1 is in QA from the prior run
    scene1.approve({ approvedBy: "Director", approvedAt: new Date().toISOString() });
    scene1.queueForProduction("job-1");
    scene1.startRendering();
    scene1.submitForQA();

    // Scene 2 was rejected, edited to rev 2, and in director_review
    scene2.approve({ approvedBy: "Director", approvedAt: new Date().toISOString() });
    scene2.queueForProduction("job-2");
    scene2.startRendering();
    scene2.submitForQA();
    scene2.rejectQA();
    scene2.updatePrompt("Revised prompt for scene 2");
    expect(scene2.status).toBe("director_review");
    expect(scene2.snapshot().specRevision).toBe(2);

    const shotPlanId = "sp-re-2" as ShotPlanId;
    const shotPlan = ShotPlan.create({
      id: shotPlanId,
      sceneId: scene2.id,
      specRevision: 2,
      variantOrdinal: 1,
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "28mm",
      cameraPosition: "tripod",
      cameraMovement: "static",
      movementSpeed: "medium",
      cameraPromptDescription: "previs",
      actionSummary: "action",
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Full action",
          cameraAction: "holds",
          subjectAction: "moves"
        }
      ],
      lightingStyle: "softbox_studio",
      environmentDescription: "studio",
      routingMode: "reference_directed",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none"
      }
    });
    scene2.selectShotPlan(shotPlanId, 2, scene2.id);

    let currentCampaign = {
      ...createMockCampaign(campaignId, 2),
      status: "qa" as const,
      approvedScenes: 1
    };

    const mockScenesRepo: SceneRepository = {
      findById: vi.fn(async (id: SceneId) => (id === scene2.id ? scene2 : scene1)),
      save: vi.fn(async () => {}),
      findCampaignIdBySceneId: vi.fn(async () => campaignId),
      findByCampaignId: vi.fn(async () => [scene1, scene2])
    };

    const mockCampaignsRepo: CampaignRepository<CampaignRecord> = {
      findById: vi.fn(async () => currentCampaign),
      findByIdForUpdate: vi.fn(async () => currentCampaign),
      save: vi.fn(async (c) => {
        currentCampaign = c;
      }),
      transitionStatusIf: vi.fn(async () => true)
    };

    const existingRunSceneRecord: CampaignProductionRunSceneRecord = {
      runId: "run-existing-1",
      sceneId: scene2.id,
      specRevision: 1,
      sequenceIndex: 2,
      expectedDurationMs: 4000,
      productionJobId: "job-2",
      currentAttemptId: "attempt-1",
      currentAttemptOrdinal: 1
    };

    const mockRunsRepo: CampaignProductionRunRepository = createMockCampaignProductionRuns({
      findRunSceneBySceneId: vi.fn(async (sId: string) =>
        sId === scene2.id ? existingRunSceneRecord : undefined
      )
    });

    const mockReviewEvents: ReviewEventStore = {
      findById: vi.fn(async () => undefined),
      append: vi.fn(async () => {})
    };

    const mockShotPlansRepo: ShotPlanRepository = {
      findById: vi.fn(async () => shotPlan),
      listBySceneAndRevision: vi.fn(async () => [shotPlan]),
      listByScene: vi.fn(async () => [shotPlan]),
      listByIdempotencyKey: vi.fn(async () => []),
      save: vi.fn(async () => {}),
      saveMany: vi.fn(async () => {})
    };

    const mockUow: UnitOfWork = {
      execute: vi.fn(async (fn) =>
        fn({
          scenes: mockScenesRepo,
          campaigns: mockCampaignsRepo,
          campaignProductionRuns: mockRunsRepo,
          reviewEvents: mockReviewEvents,
          shotPlans: mockShotPlansRepo
        } as unknown as UnitOfWorkContext)
      )
    };

    const enqueuedRenders: Array<{ sceneId: string; runId?: string }> = [];
    const mockEnqueueProductionRender = {
      executeWithContext: vi.fn(async (_ctx, input) => {
        enqueuedRenders.push(input);
        scene2.queueForProduction("job-re-new");
        return {
          job: {
            jobId: "job-re-new" as JobId,
            sceneId: input.sceneId,
            jobKind: "production",
            status: "queued"
          } as unknown as RenderJob,
          attemptId: "attempt-2",
          attemptOrdinal: 2
        };
      })
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const useCase = new ApproveSceneAndDispatchCampaignProductionUseCase(
      mockUow,
      mockEnqueueProductionRender
    );

    const result = await useCase.execute({
      action: "approve_shotplan",
      shotPlanId,
      sceneId: scene2.id,
      eventId: "evt-reapprove-sp",
      reviewerName: "Director",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 2
    });

    expect(result.scene.status).toBe("queued");
    expect(result.scene.approvedShotPlanId).toBe(shotPlanId);
    expect(shotPlan.status).toBe("approved");
    expect(enqueuedRenders).toEqual([{ sceneId: scene2.id, runId: "run-existing-1" }]);
  });
});
