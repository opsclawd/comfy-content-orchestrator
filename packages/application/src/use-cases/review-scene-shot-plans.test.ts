import { describe, expect, it, vi } from "vitest";
import {
  InvalidShotPlanError,
  InvalidTransitionError,
  Scene,
  ShotPlan,
  type CampaignId,
  type CandidateId,
  type JobId,
  type RenderJob,
  type SceneId,
  type ShotPlanId,
  type StoryboardCandidate
} from "@cco/domain";
import type { EnqueueJobInput, TransactionalJobEnqueuer } from "../ports/job-queue-port.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import { ReviewSceneUseCases } from "./review-scene.js";
import {
  PlanningProviderNotConfiguredError,
  ShotPlanNotFoundError,
  StaleRevisionConflictError
} from "./index.js";
import { PlanShotPlansUseCase } from "./plan-shot-plans.js";
import type { PlanningModelClientPort } from "../ports/planning-model-client-port.js";

describe("ReviewSceneUseCases - ShotPlan review and selection", () => {
  const sceneId = "01928374-abcd-7000-8000-000000000001" as SceneId;
  const campaignId = "01928374-abcd-7000-8000-000000000002" as CampaignId;
  const shotPlanId1 = "01928374-abcd-7000-8000-000000000011" as ShotPlanId;
  const shotPlanId2 = "01928374-abcd-7000-8000-000000000012" as ShotPlanId;

  function createReviewScene() {
    const scene = Scene.create({
      id: sceneId,
      campaignId,
      configuration: {
        prompt: "A bustling futuristic transit hub",
        referenceIds: [],
        engineProfileId: "ltx-2.5@certified-v1",
        durationMs: 4000
      }
    });
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    return scene;
  }

  function createShotPlan(id: ShotPlanId, variantOrdinal: number, specRevision = 1) {
    return ShotPlan.create({
      id,
      sceneId,
      specRevision,
      variantOrdinal,
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "28mm wide",
      cameraPosition: "tripod eye-level",
      cameraMovement: "static",
      movementSpeed: "medium",
      cameraPromptDescription: `Variant ${variantOrdinal} previs prompt`,
      actionSummary: `Variant ${variantOrdinal} action summary`,
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
      lightingStyle: "high_key_commercial",
      environmentDescription: "Transit hub",
      colorPalette: ["#ffffff"],
      subjects: [],
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none"
      }
    });
  }

  it("selects a ShotPlan variant and persists ReviewEvent", async () => {
    const scene = createReviewScene();
    const plan1 = createShotPlan(shotPlanId1, 1);
    const plan2 = createShotPlan(shotPlanId2, 2);

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan1);
    uow.seedShotPlan(plan2);

    const reviewUseCases = new ReviewSceneUseCases(uow);

    const result = await reviewUseCases.selectShotPlan({
      sceneId,
      eventId: "event-select-1",
      reviewerName: "director-bob",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 1,
      shotPlanId: shotPlanId1
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scene.selectedShotPlanId).toBe(shotPlanId1);
    expect(result.scene.selectedShotPlanRevision).toBe(1);

    expect(uow.reviewEvents).toHaveLength(1);
    expect(uow.reviewEvents[0]?.action).toBe("select_shotplan");
    expect(uow.reviewEvents[0]?.mutationPayload).toEqual({
      shotPlanId: shotPlanId1,
      shotPlanRevision: 1
    });
  });

  it("fails with ShotPlanNotFoundError when shotPlanId does not exist", async () => {
    const scene = createReviewScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await expect(
      reviewUseCases.selectShotPlan({
        sceneId,
        eventId: "event-select-fail",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        shotPlanId: "01928374-abcd-7000-8000-000000000999" as ShotPlanId
      })
    ).rejects.toThrow(ShotPlanNotFoundError);
  });

  it("fails with StaleRevisionConflictError when expectedSpecRevision is mismatched", async () => {
    const scene = createReviewScene();
    const plan = createShotPlan(shotPlanId1, 1);
    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await expect(
      reviewUseCases.selectShotPlan({
        sceneId,
        eventId: "event-select-stale",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 2, // scene is at revision 1
        shotPlanId: shotPlanId1
      })
    ).rejects.toThrow(StaleRevisionConflictError);
  });

  it("approves a ShotPlan, marks other draft plans superseded, and records event", async () => {
    const scene = createReviewScene();
    const plan1 = createShotPlan(shotPlanId1, 1);
    const plan2 = createShotPlan(shotPlanId2, 2);

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan1);
    uow.seedShotPlan(plan2);

    const reviewUseCases = new ReviewSceneUseCases(uow);

    await reviewUseCases.selectShotPlan({
      sceneId,
      eventId: "event-select-1",
      reviewerName: "director-bob",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 1,
      shotPlanId: shotPlanId1
    });

    const result = await reviewUseCases.approveShotPlan({
      sceneId,
      eventId: "event-approve-1",
      reviewerName: "director-bob",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 1,
      shotPlanId: shotPlanId1
    });

    expect(result.isIdempotentReplay).toBe(false);
    expect(result.scene.status).toBe("approved");
    expect(result.scene.approvedShotPlanId).toBe(shotPlanId1);
    expect(result.scene.approvedShotPlanRevision).toBe(1);

    // Selected plan should be approved, other should be superseded
    const savedPlans = uow.savedShotPlans;
    const approvedPlan = savedPlans.find((p) => p.id === shotPlanId1);
    const supersededPlan = savedPlans.find((p) => p.id === shotPlanId2);

    expect(approvedPlan?.status).toBe("approved");
    expect(supersededPlan?.status).toBe("superseded");

    expect(uow.reviewEvents).toHaveLength(2);
    expect(uow.reviewEvents[0]?.action).toBe("select_shotplan");
    expect(uow.reviewEvents[1]?.action).toBe("approve_shotplan");
  });

  it("fails to approve a ShotPlan if no ShotPlan is currently selected", async () => {
    const scene = createReviewScene();
    const plan1 = createShotPlan(shotPlanId1, 1);
    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan1);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await expect(
      reviewUseCases.approveShotPlan({
        sceneId,
        eventId: "event-approve-fail-unselected",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: shotPlanId1
      })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("fails to approve a ShotPlan if requested ShotPlan does not match currently selected ShotPlan", async () => {
    const scene = createReviewScene();
    const plan1 = createShotPlan(shotPlanId1, 1);
    const plan2 = createShotPlan(shotPlanId2, 2);
    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan1);
    uow.seedShotPlan(plan2);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await reviewUseCases.selectShotPlan({
      sceneId,
      eventId: "event-select-1",
      reviewerName: "director-bob",
      occurredAt: new Date().toISOString(),
      expectedSpecRevision: 1,
      shotPlanId: shotPlanId1
    });

    await expect(
      reviewUseCases.approveShotPlan({
        sceneId,
        eventId: "event-approve-mismatch",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: shotPlanId2
      })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("fails to select or approve a ShotPlan belonging to a different scene", async () => {
    const scene = createReviewScene();
    const otherSceneId = "01928374-abcd-7000-8000-000000000099" as SceneId;
    const foreignPlan = ShotPlan.create({
      id: "01928374-abcd-7000-8000-000000000091" as ShotPlanId,
      sceneId: otherSceneId,
      specRevision: 1,
      variantOrdinal: 1,
      targetDurationMs: 4000,
      targetFrameCount: 96,
      framing: "wide",
      angle: "eye_level",
      lensIntent: "35mm",
      cameraPosition: "front",
      cameraMovement: "static",
      movementSpeed: "medium",
      cameraPromptDescription: "desc",
      actionSummary: "foreign action",
      beats: [],
      lightingStyle: "high_key_commercial",
      environmentDescription: "env",
      colorPalette: []
    });

    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(foreignPlan);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await expect(
      reviewUseCases.selectShotPlan({
        sceneId,
        eventId: "event-select-foreign",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: foreignPlan.id
      })
    ).rejects.toThrow(InvalidShotPlanError);

    await expect(
      reviewUseCases.approveShotPlan({
        sceneId,
        eventId: "event-approve-foreign",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: foreignPlan.id
      })
    ).rejects.toThrow(InvalidShotPlanError);
  });

  it("fails to select or approve a ShotPlan with stale revision", async () => {
    const scene = createReviewScene();
    const stalePlan = createShotPlan(shotPlanId1, 1, 99);
    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(stalePlan);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await expect(
      reviewUseCases.selectShotPlan({
        sceneId,
        eventId: "event-select-stale",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: stalePlan.id
      })
    ).rejects.toThrow(InvalidShotPlanError);

    await expect(
      reviewUseCases.approveShotPlan({
        sceneId,
        eventId: "event-approve-stale",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: stalePlan.id
      })
    ).rejects.toThrow(InvalidShotPlanError);
  });

  it("fails to select or approve a non-draft ShotPlan", async () => {
    const scene = createReviewScene();
    const plan = createShotPlan(shotPlanId1, 1);
    plan.supersede();
    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    await expect(
      reviewUseCases.selectShotPlan({
        sceneId,
        eventId: "event-select-superseded",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: plan.id
      })
    ).rejects.toThrow(InvalidShotPlanError);

    await expect(
      reviewUseCases.approveShotPlan({
        sceneId,
        eventId: "event-approve-superseded",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString(),
        expectedSpecRevision: 1,
        shotPlanId: plan.id
      })
    ).rejects.toThrow(InvalidShotPlanError);
  });

  it("handles reroll_shotplan by delegating to PlanShotPlansUseCase, superseding prior plans, and enqueuing jobs with shotPlanId", async () => {
    const scene = createReviewScene();
    const plan1 = createShotPlan(shotPlanId1, 1);
    const uow = new InMemorySceneUnitOfWork([scene]);
    uow.seedShotPlan(plan1);

    const enqueuedJobs: EnqueueJobInput[] = [];
    const mockJobs: TransactionalJobEnqueuer = {
      enqueue: vi.fn(async (input: EnqueueJobInput): Promise<RenderJob> => {
        enqueuedJobs.push(input);
        return {
          jobId: `job-${enqueuedJobs.length}` as JobId,
          sceneId: input.sceneId,
          jobKind: input.jobKind,
          status: "queued",
          workflowTemplate: input.workflowTemplate,
          injectedPayload: input.injectedPayload,
          workerId: null,
          leaseToken: null,
          leaseExpiresAt: null,
          retryCount: 0,
          maxRetries: 3,
          errorTrace: null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }),
      areAllJobsTerminal: vi.fn(async () => false)
    };
    uow.withJobs(mockJobs);

    const mockPrimary: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: vi.fn(async () => ({
        kind: "success" as const,
        rawText: JSON.stringify([
          {
            framing: "wide",
            angle: "eye_level",
            cameraMovement: "tracking",
            movementSpeed: "slow",
            lensIntent: "35mm",
            cameraPosition: "center",
            cameraPromptDescription: "Reroll variant 1",
            actionSummary: "Action 1",
            lightingStyle: "high_key_commercial",
            environmentDescription: "Transit",
            colorPalette: [],
            subjects: [],
            beats: []
          },
          {
            framing: "medium",
            angle: "low_angle",
            cameraMovement: "static",
            movementSpeed: "medium",
            lensIntent: "50mm",
            cameraPosition: "low",
            cameraPromptDescription: "Reroll variant 2",
            actionSummary: "Action 2",
            lightingStyle: "high_key_commercial",
            environmentDescription: "Transit",
            colorPalette: [],
            subjects: [],
            beats: []
          },
          {
            framing: "close_up",
            angle: "high_angle",
            cameraMovement: "pan",
            movementSpeed: "fast",
            lensIntent: "85mm",
            cameraPosition: "high",
            cameraPromptDescription: "Reroll variant 3",
            actionSummary: "Action 3",
            lightingStyle: "high_key_commercial",
            environmentDescription: "Transit",
            colorPalette: [],
            subjects: [],
            beats: []
          }
        ])
      }))
    };
    const mockFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: vi.fn(async () => ({ kind: "retryable_failure" as const, message: "unused" }))
    };

    const planShotPlans = new PlanShotPlansUseCase({
      uow,
      primaryClient: mockPrimary,
      fallbackClient: mockFallback
    });

    const reviewUseCases = new ReviewSceneUseCases(uow, planShotPlans);

    const result = await reviewUseCases.rerollShotPlan({
      sceneId,
      eventId: "event-reroll-1",
      reviewerName: "director-bob",
      occurredAt: new Date().toISOString()
    });

    expect(result.scene.status).toBe("generating_candidates");
    expect(result.scene.selectedShotPlanId).toBeUndefined();

    // Prior plan should be superseded
    const originalPlan = uow.savedShotPlans.find((p) => p.id === shotPlanId1);
    expect(originalPlan?.status).toBe("superseded");

    // 3 new plans should be generated with non-colliding ordinals (2, 3, 4)
    const newPlans = uow.savedShotPlans.filter((p) => p.id !== shotPlanId1);
    expect(newPlans).toHaveLength(3);
    expect(newPlans.map((p) => p.variantOrdinal)).toEqual([2, 3, 4]);

    // 3 previs candidate jobs should be enqueued with corresponding shotPlanId and variantOrdinal
    expect(enqueuedJobs).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const job = enqueuedJobs[i]!;
      const plan = newPlans[i]!;
      expect(job.injectedPayload).toHaveProperty("shotPlanId", plan.id);
      expect(job.injectedPayload).toHaveProperty("variantOrdinal", plan.variantOrdinal);
    }

    expect(uow.reviewEvents).toHaveLength(1);
    expect(uow.reviewEvents[0]?.action).toBe("reroll_shotplan");
  });

  it("fails reroll_shotplan with PlanningProviderNotConfiguredError when planShotPlans is not configured", async () => {
    const scene = createReviewScene();
    const uow = new InMemorySceneUnitOfWork([scene]);
    const reviewUseCases = new ReviewSceneUseCases(uow); // No planShotPlans

    await expect(
      reviewUseCases.rerollShotPlan({
        sceneId,
        eventId: "event-reroll-unconfigured",
        reviewerName: "director-bob",
        occurredAt: new Date().toISOString()
      })
    ).rejects.toThrow(PlanningProviderNotConfiguredError);
  });

  it("preserves historical candidate flow without interfering with ShotPlans", async () => {
    const scene = createReviewScene();
    const candidateId = "01928374-abcd-7000-8000-000000000055" as CandidateId;
    const historicalCandidate: StoryboardCandidate = {
      id: candidateId,
      sceneId,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "b",
      storageObjectKey: "k",
      contentHash: "h",
      generationMetadata: {},
      createdAt: new Date().toISOString()
    };

    const uow = new InMemorySceneUnitOfWork([scene], [historicalCandidate]);
    const reviewUseCases = new ReviewSceneUseCases(uow);

    // Legacy candidate selection
    const result = await reviewUseCases.selectCandidate({
      sceneId,
      eventId: "event-legacy-select",
      reviewerName: "legacy-reviewer",
      occurredAt: new Date().toISOString(),
      candidateId
    });

    expect(result.scene.selectedCandidateId).toBe(candidateId);
    expect(result.scene.selectedShotPlanId).toBeUndefined();
    expect(uow.reviewEvents[0]?.action).toBe("candidate_select");
  });
});
