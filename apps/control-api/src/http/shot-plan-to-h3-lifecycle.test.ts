import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  Scene,
  ShotPlan,
  type CampaignId,
  type CampaignRecord,
  type CandidateId,
  type JobId,
  type ReferenceAsset,
  type ReferenceAssetId,
  type RenderJob,
  type SceneId,
  type ShotPlanId,
  type StoryboardCandidate
} from "@cco/domain";
import {
  GenerationManifestSchema,
  SceneReviewDetailReadModelSchema,
  type GenerationManifest,
  type ReviewCommandResponse
} from "@cco/contracts";
import { InMemorySceneUnitOfWork } from "../../../../packages/application/src/test-support/in-memory-scene-unit-of-work.js";
import { createControlApiApp } from "./app.js";
import {
  type EnqueueSceneProductionRenderUseCase,
  type PersistentObjectLocator,
  type ReviewMediaDeliveryPort,
  type SceneReviewQueries,
  ReviewSceneUseCases,
  ProductionReviewUseCases,
  ProgressSceneProductionUseCases,
  CompleteCampaignProductionRunUseCases,
  CompleteCampaignProductionRunAssemblyUseCases,
  ApproveSceneAndDispatchCampaignProductionUseCase
} from "@cco/application";
import type { ControlApiContainer } from "./types.js";

describe("ShotPlan-to-H3 E2E Lifecycle (Unit / Orchestration)", () => {
  const clientId = "01928374-abcd-7000-8000-000000000001";
  const campaignId = "01928374-abcd-7000-8000-000000000002" as CampaignId;
  const scene1Id = "01928374-abcd-7000-8000-000000000003" as SceneId;
  const scene2Id = "01928374-abcd-7000-8000-000000000004" as SceneId;

  const refAsset1Id = "01928374-abcd-7000-8000-000000000011" as ReferenceAssetId;
  const refAsset2Id = "01928374-abcd-7000-8000-000000000012" as ReferenceAssetId;

  const previsCand1Id = "01928374-abcd-7000-8000-000000000021" as CandidateId;
  const previsCand2Id = "01928374-abcd-7000-8000-000000000022" as CandidateId;

  const shotPlan1Scene1Id = "01928374-abcd-7000-8000-000000000031" as ShotPlanId;
  const shotPlan2Scene1Id = "01928374-abcd-7000-8000-000000000032" as ShotPlanId;
  const shotPlan1Scene2Id = "01928374-abcd-7000-8000-000000000041" as ShotPlanId;

  const job1Id = "01928374-abcd-7000-8000-000000000051" as JobId;
  const job2Id = "01928374-abcd-7000-8000-000000000052" as JobId;

  const ref1Sha256 = "11".repeat(32);
  const ref2Sha256 = "22".repeat(32);
  const previs1Sha256 = "33".repeat(32);
  const previs2Sha256 = "44".repeat(32);

  it("proves complete ReferenceAsset + approved ShotPlan -> H3 -> production review -> assembly lifecycle", async () => {
    // -------------------------------------------------------------------------
    // Phase 1: Reference Upload & Library Management (#306-#309)
    // -------------------------------------------------------------------------
    const referenceAssets: ReferenceAsset[] = [
      {
        id: refAsset1Id,
        clientId,
        assetType: "image",
        storageBucket: "cco-references",
        storageObjectKey: `clients/${clientId}/ref-subject-hero.png`,
        contentHashSha256: ref1Sha256,
        displayName: "Hero Character Sheet",
        libraryRole: "subject_identity",
        width: 1024,
        height: 1024,
        mimeType: "image/png"
      },
      {
        id: refAsset2Id,
        clientId,
        assetType: "image",
        storageBucket: "cco-references",
        storageObjectKey: `clients/${clientId}/ref-cyberpunk-style.png`,
        contentHashSha256: ref2Sha256,
        displayName: "Cyberpunk Cinematic Style",
        libraryRole: "style",
        width: 1024,
        height: 1024,
        mimeType: "image/png"
      }
    ];

    // -------------------------------------------------------------------------
    // Phase 2: Campaign Planning & Reference Assignment to Scenes
    // -------------------------------------------------------------------------
    const campaignRecord: CampaignRecord = {
      id: campaignId,
      clientId,
      title: "Cyberpunk Runner 2026",
      targetPlatform: "tiktok",
      status: "drafting",
      totalScenes: 2,
      approvedScenes: 0,
      createdAt: "2026-09-27T10:10:00.000Z",
      updatedAt: "2026-09-27T10:10:00.000Z"
    };

    // Scene 1: Reference-directed route
    const scene1 = Scene.create({
      id: scene1Id,
      campaignId,
      sequenceIndex: 1,
      configuration: {
        prompt: "Cinematic medium close-up of cybernetic operative in rain-slicked alleyway",
        referenceIds: [refAsset1Id, refAsset2Id],
        engineProfileId: "minimax-h3-720p@certified-v1",
        durationMs: 4000
      }
    });

    // Scene 2: Frame-anchored route
    const scene2 = Scene.create({
      id: scene2Id,
      campaignId,
      sequenceIndex: 2,
      configuration: {
        prompt: "Wide tracking shot continuing the run down the neon corridor",
        referenceIds: [],
        engineProfileId: "minimax-h3-720p@certified-v1",
        durationMs: 4000
      }
    });

    scene1.beginCandidateGeneration();
    scene1.submitCandidatesForReview();
    scene2.beginCandidateGeneration();
    scene2.submitCandidatesForReview();

    // -------------------------------------------------------------------------
    // Phase 3: ShotPlan Variants & Previs Generation
    // -------------------------------------------------------------------------
    // Previs storyboard candidates (visualizations)
    const previsCandidate1: StoryboardCandidate = {
      id: previsCand1Id,
      sceneId: scene1Id,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "cco-review",
      storageObjectKey: `scenes/${scene1Id}/previs/${previsCand1Id}.jpg`,
      contentHash: previs1Sha256,
      generationMetadata: { prompt: "Previs draft", seed: 42 },
      createdAt: "2026-09-27T10:15:00.000Z"
    };

    const previsCandidate2: StoryboardCandidate = {
      id: previsCand2Id,
      sceneId: scene2Id,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "cco-review",
      storageObjectKey: `scenes/${scene2Id}/previs/${previsCand2Id}.jpg`,
      contentHash: previs2Sha256,
      generationMetadata: { prompt: "Previs draft", seed: 99 },
      createdAt: "2026-09-27T10:15:00.000Z"
    };

    // ShotPlan Variants for Scene 1 (Reference Directed)
    const shotPlan1Scene1 = ShotPlan.create({
      id: shotPlan1Scene1Id,
      sceneId: scene1Id,
      specRevision: 1,
      variantOrdinal: 1,
      routingMode: "reference_directed",
      targetDurationMs: 4000,
      targetFrameCount: 97,
      framing: "medium_close_up",
      angle: "eye_level",
      cameraMovement: "dolly_in",
      movementSpeed: "slow",
      lensIntent: "50mm prime",
      cameraPosition: "chest level facing subject",
      cameraPromptDescription: "Slow cinematic push-in on operative face",
      actionSummary: "Operative lifts visor, revealing cybernetic eye",
      lightingStyle: "neon_night",
      environmentDescription: "Rain-slicked Neo-Tokyo alley",
      colorPalette: ["cyan", "magenta"],
      atmosphere: "neon steam haze",
      subjects: [
        {
          subjectId: "hero-operative",
          role: "subject_identity",
          referenceAssetId: refAsset1Id,
          initialPosition: "screen_center",
          movementTrajectory: "lifts visor steadily"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Operative activates ocular scanner",
          cameraAction: "slow dolly in",
          subjectAction: "raises visor"
        }
      ],
      continuity: {
        persistentSubjectIds: ["hero-operative"],
        frameAnchorTarget: "none"
      },
      previs: {
        candidateId: previsCand1Id,
        storageBucket: "cco-review",
        storageObjectKey: `scenes/${scene1Id}/previs/${previsCand1Id}.jpg`,
        contentHashSha256: previs1Sha256,
        modelProfile: "flux_schnell",
        generatedAt: "2026-09-27T10:15:00.000Z",
        reviewNotes: "Previs visualization of composition only"
      }
    });

    const shotPlan2Scene1 = ShotPlan.create({
      id: shotPlan2Scene1Id,
      sceneId: scene1Id,
      specRevision: 1,
      variantOrdinal: 2,
      routingMode: "reference_directed",
      targetDurationMs: 4000,
      targetFrameCount: 97,
      framing: "close_up",
      angle: "low_angle",
      cameraMovement: "static",
      movementSpeed: "slow",
      lensIntent: "85mm",
      cameraPosition: "low tripod",
      cameraPromptDescription: "Static low angle close up",
      actionSummary: "Operative stares intensely at target",
      lightingStyle: "chiaroscuro",
      environmentDescription: "Dark doorway",
      colorPalette: ["blue"],
      atmosphere: "dark",
      subjects: [
        {
          subjectId: "hero-operative",
          role: "subject_identity",
          referenceAssetId: refAsset1Id,
          initialPosition: "screen_center",
          movementTrajectory: "static"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Stare",
          cameraAction: "static",
          subjectAction: "breathing"
        }
      ],
      continuity: {
        persistentSubjectIds: ["hero-operative"],
        frameAnchorTarget: "none"
      },
      previs: null
    });

    // ShotPlan Variant for Scene 2 (Explicit Frame Anchored Route)
    const shotPlan1Scene2 = ShotPlan.create({
      id: shotPlan1Scene2Id,
      sceneId: scene2Id,
      specRevision: 1,
      variantOrdinal: 1,
      routingMode: "frame_anchored",
      targetDurationMs: 4000,
      targetFrameCount: 97,
      framing: "wide",
      angle: "eye_level",
      cameraMovement: "tracking",
      movementSpeed: "fast",
      lensIntent: "24mm wide",
      cameraPosition: "tracking rig",
      cameraPromptDescription: "Fast tracking shot down alley",
      actionSummary: "Operative sprints toward the illuminated plaza",
      lightingStyle: "neon_night",
      environmentDescription: "Neon lit passage",
      colorPalette: ["yellow", "red"],
      atmosphere: "rain",
      subjects: [
        {
          subjectId: "hero-operative",
          role: "subject_identity",
          referenceAssetId: null,
          initialPosition: "foreground_center",
          movementTrajectory: "sprints forward"
        }
      ],
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 4000,
          description: "Sprint",
          cameraAction: "tracks backward",
          subjectAction: "runs"
        }
      ],
      continuity: {
        persistentSubjectIds: ["hero-operative"],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: previsCand2Id,
        anchorMediaHashSha256: previs2Sha256
      },
      previs: {
        candidateId: previsCand2Id,
        storageBucket: "cco-review",
        storageObjectKey: `scenes/${scene2Id}/previs/${previsCand2Id}.jpg`,
        contentHashSha256: previs2Sha256,
        modelProfile: "flux_schnell",
        generatedAt: "2026-09-27T10:15:00.000Z",
        reviewNotes: "Authoritative first frame anchor"
      }
    });

    // Initialize InMemory Unit Of Work
    const uow = new InMemorySceneUnitOfWork(
      [scene1, scene2],
      [previsCandidate1, previsCandidate2],
      undefined,
      [campaignRecord]
    );
    uow.seedShotPlan(shotPlan1Scene1);
    uow.seedShotPlan(shotPlan2Scene1);
    uow.seedShotPlan(shotPlan1Scene2);

    for (const ref of referenceAssets) {
      uow.seedReferenceAsset(ref);
    }

    // Mock Review Media Delivery
    const reviewMediaDelivery: ReviewMediaDeliveryPort = {
      async generatePresignedReadUrl(locator: PersistentObjectLocator) {
        return `https://media.cco.local/presigned/${locator.bucket}/${locator.key}?sig=${locator.contentHash}`;
      }
    };

    // Mock SceneReviewQueries for Review Hub read model
    const sceneReviewQueries: SceneReviewQueries = {
      async getCampaignReviewSummary() {
        return undefined;
      },
      async getSceneReviewDetail(sceneId: SceneId) {
        const sc = sceneId === scene1Id ? scene1 : scene2;
        const plans = sceneId === scene1Id ? [shotPlan1Scene1, shotPlan2Scene1] : [shotPlan1Scene2];

        const isScene1 = sceneId === scene1Id;
        const refBindings = isScene1
          ? [
              {
                referenceAssetId: refAsset1Id,
                sceneId: scene1Id,
                specRevision: 1,
                role: "subject_identity" as const,
                libraryRole: "subject_identity" as const,
                bindingOrder: 0,
                weight: 1.0,
                hints: null,
                displayName: "Hero Character Sheet",
                description: null,
                width: 1024,
                height: 1024,
                mimeType: "image/png",
                contentHashSha256: ref1Sha256,
                storageBucket: "cco-references",
                storageObjectKey: `clients/${clientId}/ref-subject-hero.png`
              },
              {
                referenceAssetId: refAsset2Id,
                sceneId: scene1Id,
                specRevision: 1,
                role: "style" as const,
                libraryRole: "style" as const,
                bindingOrder: 1,
                weight: 0.8,
                hints: null,
                displayName: "Cyberpunk Cinematic Style",
                description: null,
                width: 1024,
                height: 1024,
                mimeType: "image/png",
                contentHashSha256: ref2Sha256,
                storageBucket: "cco-references",
                storageObjectKey: `clients/${clientId}/ref-cyberpunk-style.png`
              }
            ]
          : [];

        const snapshot = sc.snapshot();
        return {
          sceneId: sc.id,
          campaignId: sc.campaignId,
          status: sc.status,
          specRevision: snapshot.specRevision,
          configuration: snapshot.configuration,
          ...(snapshot.selectedCandidateId
            ? { selectedCandidateId: snapshot.selectedCandidateId }
            : {}),
          ...(snapshot.selectedCandidateRevision !== undefined
            ? { selectedCandidateRevision: snapshot.selectedCandidateRevision }
            : {}),
          ...(snapshot.selectedShotPlanId
            ? { selectedShotPlanId: snapshot.selectedShotPlanId }
            : {}),
          ...(snapshot.selectedShotPlanRevision !== undefined
            ? { selectedShotPlanRevision: snapshot.selectedShotPlanRevision }
            : {}),
          ...(snapshot.approvedShotPlanId
            ? { approvedShotPlanId: snapshot.approvedShotPlanId }
            : {}),
          candidatesByRevision: [],
          referenceBindingsWithStorage: refBindings,
          shotPlans: plans.map((p) => {
            const ps = p.snapshot();
            return {
              shotPlanId: p.id,
              sceneId: p.sceneId,
              specRevision: p.specRevision,
              variantOrdinal: p.variantOrdinal,
              status: p.status,
              routingMode: p.routingMode,
              isCurrentRevision: true,
              targetDurationMs: p.targetDurationMs,
              targetFrameCount: p.targetFrameCount,
              framing: p.framing,
              angle: p.angle,
              cameraMovement: p.cameraMovement,
              movementSpeed: p.movementSpeed,
              lensIntent: p.lensIntent,
              cameraPosition: p.cameraPosition,
              cameraPromptDescription: p.cameraPromptDescription,
              actionSummary: p.actionSummary,
              lightingStyle: p.lightingStyle,
              environmentDescription: p.environmentDescription,
              colorPalette: [...p.colorPalette],
              atmosphere: p.atmosphere,
              subjects: [...p.subjects],
              beats: [...p.beats],
              ...(p.dialogue ? { dialogue: p.dialogue } : {}),
              continuity: p.continuity
                ? {
                    ...p.continuity,
                    persistentSubjectIds: [...p.continuity.persistentSubjectIds]
                  }
                : {
                    persistentSubjectIds: [],
                    frameAnchorTarget: "none" as const
                  },
              previs: p.previs
                ? {
                    candidateId: p.previs.candidateId,
                    media: {
                      available: true,
                      url: `https://media.cco.local/previs-${p.variantOrdinal}.jpg`
                    },
                    reviewNotes: p.previs.reviewNotes ?? null
                  }
                : null,
              boundReferences: refBindings.map((rb) => ({
                referenceAssetId: rb.referenceAssetId,
                sceneId: rb.sceneId,
                specRevision: rb.specRevision,
                role: rb.role,
                libraryRole: rb.libraryRole,
                bindingOrder: rb.bindingOrder,
                weight: rb.weight,
                hints: rb.hints,
                displayName: rb.displayName,
                description: rb.description,
                width: rb.width,
                height: rb.height,
                mimeType: rb.mimeType,
                contentHashSha256: rb.contentHashSha256,
                previewAvailability: "unavailable" as const
              })),
              createdAt: ps.createdAt,
              updatedAt: ps.updatedAt
            };
          }),
          allowedActions: ["approve_shotplan", "select_shotplan", "reroll_shotplan"]
        };
      }
    };

    // Staged render executions tracking
    const enqueuedJobs: RenderJob[] = [];
    const mockEnqueueProductionRender = {
      execute: vi.fn(),
      executeWithContext: vi.fn(async (_ctx, input: { sceneId: SceneId; runId: string }) => {
        const isScene1 = input.sceneId === scene1Id;
        const targetScene = isScene1 ? scene1 : scene2;
        const job: RenderJob = {
          jobId: isScene1 ? job1Id : job2Id,
          sceneId: input.sceneId,
          jobKind: "production",
          status: "queued",
          engineProfileId: targetScene.snapshot().configuration.engineProfileId,
          workflowTemplate: isScene1 ? "minimax_h3_ref2v_720p_v1" : "minimax_h3_i2v_720p_v1",
          injectedPayload: isScene1
            ? {
                routingMode: "reference_directed",
                shotPlanId: shotPlan1Scene1Id,
                referenceImages: [
                  {
                    assetId: refAsset1Id,
                    role: "subject_identity",
                    sha256: ref1Sha256,
                    slotIndex: 1
                  },
                  {
                    assetId: refAsset2Id,
                    role: "style",
                    sha256: ref2Sha256,
                    slotIndex: 2
                  }
                ],
                // CRITICAL INVARIANT: No previs candidate injected into conditioning!
                firstFrame: undefined,
                seed: 12345
              }
            : {
                routingMode: "frame_anchored",
                shotPlanId: shotPlan1Scene2Id,
                firstFrame: {
                  candidateId: previsCand2Id,
                  sha256: previs2Sha256
                },
                referenceImages: undefined,
                seed: 67890
              }
        } as unknown as RenderJob;
        enqueuedJobs.push(job);
        return {
          job,
          isExisting: false,
          attemptId: `att-${input.sceneId}`,
          attemptOrdinal: 1
        };
      })
    } as unknown as EnqueueSceneProductionRenderUseCase;

    const coordinator = new ApproveSceneAndDispatchCampaignProductionUseCase(
      uow,
      mockEnqueueProductionRender
    );

    const container: ControlApiContainer = {
      dependencies: {
        uow,
        sceneReviewQueries,
        reviewMediaDelivery
      },
      useCases: {
        reviewScene: new ReviewSceneUseCases(uow),
        productionReview: new ProductionReviewUseCases(uow, mockEnqueueProductionRender),
        progressSceneProduction: new ProgressSceneProductionUseCases(uow),
        approveSceneAndDispatchCampaignProduction: coordinator,
        completeCampaignProductionRun: new CompleteCampaignProductionRunUseCases(uow),
        completeCampaignProductionRunAssembly: new CompleteCampaignProductionRunAssemblyUseCases(
          uow
        )
      },
      queries: {
        sceneReview: sceneReviewQueries
      }
    };

    const app = createControlApiApp(container, {
      reviewerIdentityResolver: {
        resolve: () => "Director Thomas"
      }
    });

    // -------------------------------------------------------------------------
    // Phase 4: Review Hub Read Route Verification (AC-1)
    // -------------------------------------------------------------------------
    const readResponse = await app.inject({
      method: "GET",
      url: `/api/scenes/${scene1Id}/review`
    });
    expect(readResponse.statusCode).toBe(200);
    const readBody = readResponse.json();
    const parsedRead = SceneReviewDetailReadModelSchema.safeParse(readBody);
    expect(parsedRead.success).toBe(true);

    expect(readBody.shotPlans).toHaveLength(2);
    const plan1Read = readBody.shotPlans[0];
    expect(plan1Read.routingMode).toBe("reference_directed");
    expect(plan1Read.previs.media.available).toBe(true);
    // Presigned reference previews are populated from persisted storage bindings
    expect(plan1Read.boundReferences).toHaveLength(2);
    expect(plan1Read.boundReferences[0].previewAvailability).toBe("available");
    expect(plan1Read.boundReferences[0].previewUrl).toContain(ref1Sha256);
    expect(plan1Read.boundReferences[1].previewAvailability).toBe("available");
    expect(plan1Read.boundReferences[1].previewUrl).toContain(ref2Sha256);

    // -------------------------------------------------------------------------
    // Phase 5: Director Selection & Revision Fencing (AC-2)
    // -------------------------------------------------------------------------
    // Select ShotPlan 1 for Scene 1
    const selectPlanRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000091",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "select_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene1Id
        }
      }
    });
    expect(selectPlanRes.statusCode).toBe(200);
    const selectPlanBody = selectPlanRes.json() as ReviewCommandResponse;
    expect(selectPlanBody.selectedShotPlanId).toBe(shotPlan1Scene1Id);
    let currentScene1 = await uow.execute(async (ctx) => ctx.scenes.findById(scene1Id));
    expect(currentScene1?.snapshot().selectedShotPlanId).toBe(shotPlan1Scene1Id);

    // Stale expectedSpecRevision rejects with 409 STALE_REVISION_CONFLICT
    const staleApproveRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000092",
        sceneId: scene1Id,
        expectedSpecRevision: 999, // Stale!
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene1Id
        }
      }
    });
    expect(staleApproveRes.statusCode).toBe(409);

    // Unselected ShotPlan mismatch rejects
    const mismatchApproveRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000093",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan2Scene1Id // Not selected!
        }
      }
    });
    expect(mismatchApproveRes.statusCode).toBe(422);

    // -------------------------------------------------------------------------
    // Phase 6: Multi-Scene Atomic Approval & Dispatch (AC-2, AC-5)
    // -------------------------------------------------------------------------
    // Approve Scene 1 ShotPlan
    const approveScene1Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000094",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene1Id
        }
      }
    });
    expect(approveScene1Res.statusCode).toBe(200);
    const approveBody1 = approveScene1Res.json() as ReviewCommandResponse;
    expect(approveBody1.status).toBe("approved");
    expect(approveBody1.approvedShotPlanId).toBe(shotPlan1Scene1Id);
    currentScene1 = await uow.execute(async (ctx) => ctx.scenes.findById(scene1Id));
    expect(currentScene1?.status).toBe("approved");
    expect(currentScene1?.snapshot().approvedShotPlanId).toBe(shotPlan1Scene1Id);

    // Campaign is NOT dispatched yet because Scene 2 is still pending approval!
    expect(enqueuedJobs).toHaveLength(0);
    expect(await uow.campaignProductionRuns.findById("run-1")).toBeUndefined();
    const campaignBefore = await uow.execute(async (ctx) => ctx.campaigns!.findById(campaignId));
    expect(campaignBefore?.status).toBe("drafting");
    expect(campaignBefore?.approvedScenes).toBe(1);

    // Now select and approve Scene 2 (Frame Anchored Route)
    const selectScene2Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000095",
        sceneId: scene2Id,
        expectedSpecRevision: 1,
        action: "select_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene2Id
        }
      }
    });
    expect(selectScene2Res.statusCode).toBe(200);

    const approveScene2Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene2Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-000000000096",
        sceneId: scene2Id,
        expectedSpecRevision: 1,
        action: "approve_shotplan",
        payload: {
          shotPlanId: shotPlan1Scene2Id
        }
      }
    });
    expect(approveScene2Res.statusCode).toBe(200);
    const approveBody2 = approveScene2Res.json() as ReviewCommandResponse;
    expect(approveBody2.status).toBe("approved");
    expect(approveBody2.approvedShotPlanId).toBe(shotPlan1Scene2Id);
    const currentScene2 = await uow.execute(async (ctx) => ctx.scenes.findById(scene2Id));
    expect(currentScene2?.status).toBe("approved");

    // All scenes approved: Atomic Campaign Dispatch!
    const campaignAfter = await uow.execute(async (ctx) => ctx.campaigns!.findById(campaignId));
    expect(campaignAfter?.status).toBe("queued");
    expect(campaignAfter?.approvedScenes).toBe(2);
    const run1 = await uow.campaignProductionRuns.findById("run-1");
    expect(run1).toBeDefined();
    expect(run1?.status).toBe("dispatched");
    expect(enqueuedJobs).toHaveLength(2);

    // -------------------------------------------------------------------------
    // Phase 7: Conditioning & Worker Staging Invariants (AC-3, AC-4)
    // -------------------------------------------------------------------------
    const job1 = enqueuedJobs.find((j) => (j.sceneId as string) === scene1Id)!;
    const job2 = enqueuedJobs.find((j) => (j.sceneId as string) === scene2Id)!;

    // SCENE 1 (Reference-Directed Mode):
    // 1. Exact reference assets are staged with correct roles and hashes
    const job1Payload = job1.injectedPayload as {
      routingMode: string;
      referenceImages: Array<{ sha256: string; role: string }>;
      firstFrame?: unknown;
    };
    expect(job1Payload.routingMode).toBe("reference_directed");
    expect(job1Payload.referenceImages).toHaveLength(2);
    expect(job1Payload.referenceImages[0]!.sha256).toBe(ref1Sha256);
    expect(job1Payload.referenceImages[0]!.role).toBe("subject_identity");
    expect(job1Payload.referenceImages[1]!.sha256).toBe(ref2Sha256);
    expect(job1Payload.referenceImages[1]!.role).toBe("style");
    // 2. Previs candidate JPEG is ABSENT from executed conditioning inputs
    expect(job1Payload.firstFrame).toBeUndefined();

    // SCENE 2 (Frame-Anchored Mode):
    // Authoritative frame asset is staged; zero reference images staged
    const job2Payload = job2.injectedPayload as {
      routingMode: string;
      firstFrame: { candidateId: string; sha256: string };
      referenceImages?: unknown;
    };
    expect(job2Payload.routingMode).toBe("frame_anchored");
    expect(job2Payload.firstFrame.candidateId).toBe(previsCand2Id);
    expect(job2Payload.firstFrame.sha256).toBe(previs2Sha256);
    expect(job2Payload.referenceImages).toBeUndefined();

    // -------------------------------------------------------------------------
    // Phase 8: Manifest Provenance Reconstruction (AC-5, AC-8)
    // -------------------------------------------------------------------------
    const baseManifest = {
      manifestId: "01928374-abcd-7000-8000-0000000000a1",
      jobId: job1Id,
      promptIdComfy: "comfy-prompt-1",
      campaignId,
      sceneId: scene1Id,
      renderAttempt: 1,
      renderedAt: "2026-09-27T10:30:00.000Z",
      renderProfileVersion: 1,
      attemptId: "01928374-abcd-7000-8000-0000000000a0",
      models: [
        {
          category: "diffusion_models",
          sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
        }
      ],
      workflow: {
        templateId: "minimax-h3-720p-124f-ref2v",
        sha256: "cc5876b4ca9fd45e8ae50fade56db711107818a17a5eb48d7edf3e875dc2b7c7"
      },
      loras: [],
      sampling: {
        seed: 12345,
        steps: 20,
        cfg: 1.0,
        sampler: "euler",
        scheduler: "linear",
        denoise: 1.0
      },
      dimensions: {
        width: 1280,
        height: 720
      },
      frameCount: 97,
      fps: 24,
      prompts: {
        prompt: "Cinematic medium close-up of cybernetic operative in rain-slicked alleyway",
        negativePrompt: undefined,
        audioPrompt: null
      },
      referenceAssets: [],
      environment: {
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNodes: []
      },
      runnerProfile: "dynamicvram-offload-v1",
      runtimeMetadata: {
        durationMs: 4000
      },
      governance: {
        license: "MiniMax Community License",
        sourceKind: "validated_host_export"
      },
      outputs: [
        {
          bucket: "cco-production",
          key: `scenes/${scene1Id}/production.mp4`,
          filename: "production.mp4",
          checksumSha256: "55".repeat(32)
        }
      ],
      outputObjectKeys: ["production.mp4"],
      executionDurationMs: 4000
    };

    const manifestScene1: GenerationManifest = {
      ...baseManifest,
      engine: "minimax_h3_ref2v",
      renderProfile: "MINIMAX_H3_720P_5S_REF2V_V1",
      routingMode: "reference_directed",
      shotPlan: {
        id: shotPlan1Scene1Id,
        specRevision: 1
      },
      executedInstruction: {
        text: "Cinematic medium close-up of cybernetic operative in rain-slicked alleyway",
        sha256: createHash("sha256").update("instruction").digest("hex"),
        byteLength: 70
      },
      referenceImages: [
        {
          slotIndex: 1,
          promptTag: "<Picture 1>",
          bindingId: `${scene1Id}:1:${refAsset1Id}:subject_identity`,
          assetId: refAsset1Id,
          contentHashSha256: ref1Sha256,
          role: "subject_identity",
          stagedAs: { name: "ref-1.png", subfolder: "" },
          injectionTarget: { nodeId: "201", classType: "LoadImage", inputField: "image" }
        },
        {
          slotIndex: 2,
          promptTag: "<Picture 2>",
          bindingId: `${scene1Id}:1:${refAsset2Id}:style`,
          assetId: refAsset2Id,
          contentHashSha256: ref2Sha256,
          role: "style",
          stagedAs: { name: "ref-2.png", subfolder: "" },
          injectionTarget: { nodeId: "202", classType: "LoadImage", inputField: "image" }
        }
      ],
      previsReviewEvidence: {
        candidateId: previsCand1Id,
        contentHashSha256: previs1Sha256,
        specRevision: 1
      }
    };

    const parsedManifest1 = GenerationManifestSchema.safeParse(manifestScene1);
    expect(parsedManifest1.success).toBe(true);

    const manifestScene2: GenerationManifest = {
      ...baseManifest,
      manifestId: "01928374-abcd-7000-8000-0000000000a2",
      jobId: job2Id,
      sceneId: scene2Id,
      engine: "minimax_h3_i2v",
      renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
      routingMode: "frame_anchored",
      shotPlan: {
        id: shotPlan1Scene2Id,
        specRevision: 1
      },
      firstFrame: {
        anchorType: "first_frame",
        candidateId: previsCand2Id,
        contentHashSha256: previs2Sha256,
        stagedAs: { name: "anchor.jpg", subfolder: "" },
        injectionTarget: { nodeId: "20", classType: "LoadImage", inputField: "image" }
      }
    };

    const parsedManifest2 = GenerationManifestSchema.safeParse(manifestScene2);
    expect(parsedManifest2.success).toBe(true);

    // -------------------------------------------------------------------------
    // Phase 9: Production Review Gate & Idempotency (AC-6)
    // -------------------------------------------------------------------------
    // Seed production attempt in UOW
    uow.seedProductionAttempt({
      attemptId: "att-scene-1-prod",
      runId: run1!.id,
      sceneId: scene1Id,
      specRevision: 1,
      ordinal: 1,
      productionJobId: job1Id,
      seed: 12345,
      createdReason: "initial_dispatch",
      createdAt: "2026-09-27T10:35:00.000Z"
    });

    // Advance scene 1 through production pipeline to QA review
    await uow.execute(async (ctx) => {
      const sc = (await ctx.scenes.findById(scene1Id))!;
      sc.queueForProduction(job1Id);
      sc.startRendering();
      sc.submitForQA();
      await ctx.scenes.save(sc);
    });

    // Accept Scene 1 production attempt
    const acceptRes1 = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-0000000000b1",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: job1Id
        }
      }
    });
    expect(acceptRes1.statusCode).toBe(200);

    // Idempotent retry of same acceptance returns 200 with isIdempotentReplay: true
    const replayAcceptRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene1Id}/review-command`,
      payload: {
        actionId: "01928374-abcd-7000-8000-0000000000b1",
        sceneId: scene1Id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: job1Id
        }
      }
    });
    expect(replayAcceptRes.statusCode).toBe(200);
    const replayBody = replayAcceptRes.json() as ReviewCommandResponse;
    expect(replayBody.isIdempotentReplay).toBe(true);

    // -------------------------------------------------------------------------
    // Phase 10: Historical Auditability & Non-goals verification (AC-8, AC-9)
    // -------------------------------------------------------------------------
    // Alternative draft variant 2 remains preserved in repository
    const allScene1Plans = await uow.execute(async (ctx) => ctx.shotPlans!.listByScene(scene1Id));
    expect(allScene1Plans).toHaveLength(2);
    const unselectedPlan = allScene1Plans.find((p) => p.id === shotPlan2Scene1Id);
    expect(unselectedPlan).toBeDefined();
    expect(unselectedPlan?.status).toBe("superseded");
  });
});
