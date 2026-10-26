import { describe, expect, it, vi } from "vitest";
import {
  InvalidTransitionError,
  Scene,
  ShotPlan,
  type CampaignId,
  type CandidateId,
  type SceneId,
  type ShotPlanId,
  type StoryboardCandidate
} from "@cco/domain";
import {
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  computeModelHashesDigest,
  type H3CandidateAuthorizationGrant,
  type H3CandidateExecutionSpecification,
  type H3CandidateProfile
} from "@cco/contracts";
import type {
  H3CandidateAuthorizationPort,
  H3CandidateRegistryReader
} from "../ports/h3-candidate-ports.js";
import { InMemoryJobQueue } from "../test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../test-support/in-memory-scene-unit-of-work.js";
import {
  ConflictingStagingOperationError,
  StageH3CandidateRenderUseCase,
  StagingAuthorizationDeniedError,
  UnsupportedH3CandidateProfileError
} from "./stage-h3-candidate-render.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

function createValidSpec(
  overrides: Partial<H3CandidateExecutionSpecification> = {}
): H3CandidateExecutionSpecification {
  return {
    version: 1,
    route: "i2v",
    routingMode: "frame_anchored",
    width: 1344,
    height: 768,
    fps: 24,
    frames: 192,
    workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
    modelHashes: {
      checkpoint: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      clip: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
      audioVae: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
      videoVae: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
      turboLora: "none",
      additionalModels: {}
    },
    sampler: "euler",
    scheduler: "simple",
    steps: 20,
    cfg: 1.0,
    denoise: 1.0,
    attention: {
      backend: "sage_attn",
      customNodeRevision: "v1.0.0",
      customNodeSourceHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      packageVersion: "0.2.1",
      sparsitySettings: {
        enabled: false,
        method: "none",
        threshold: 0
      }
    },
    runnerSettings: {
      runnerProfile: "dynamicvram-offload-v1",
      offloadPolicy: "dynamicvram",
      requiresModelOffloading: true,
      maxConcurrentGpuJobs: 1,
      minFreeDiskGb: 50
    },
    customNodes: [
      {
        name: "comfyui-sageattention",
        revision: "git-commit-abc123",
        sourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      }
    ],
    packageVersions: {
      torch: "2.5.1+cu124",
      sageattention: "0.2.1"
    },
    ...overrides
  };
}

function createValidProfile(spec: H3CandidateExecutionSpecification): H3CandidateProfile {
  const digest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(digest, 1);
  return {
    key,
    version: 1,
    specificationDigest: digest,
    specification: spec,
    topology: {
      prompt: { nodeId: "1", classType: "CLIPTextEncode", inputField: "text" },
      seed: { nodeId: "2", classType: "KSampler", inputField: "seed" },
      frameCount: { nodeId: "3", classType: "EmptyLatent", inputField: "frames" },
      firstFrame: { nodeId: "4", classType: "LoadImage", inputField: "image" },
      width: { nodeId: "3", classType: "EmptyLatent", inputField: "width" },
      height: { nodeId: "3", classType: "EmptyLatent", inputField: "height" }
    },
    status: "candidate"
  };
}

describe("StageH3CandidateRenderUseCase", () => {
  const eligibleProfile192 = createValidProfile(createValidSpec({ frames: 192 }));

  const mockRegistryReader: H3CandidateRegistryReader = {
    getCandidateProfile(key: string | undefined) {
      if (key === eligibleProfile192.key) {
        return eligibleProfile192;
      }
      return undefined;
    },
    listCandidateProfiles() {
      return [eligibleProfile192];
    },
    isCandidateProfileKey(key: string | undefined) {
      return key === eligibleProfile192.key;
    }
  };

  const createApprovedScene = (sceneId = "scene-1", durationMs = 8000): Scene => {
    const scene = Scene.create({
      id: sceneId as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "A neon cyborg runs through rainy neo-Tokyo",
        referenceIds: [],
        engineProfileId: "minimax_h3_i2v",
        durationMs
      }
    });
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate("cand-1" as CandidateId, 1, scene.id);
    scene.selectShotPlan("plan-1" as ShotPlanId, 1, scene.id);
    scene.approveShotPlan({
      routingMode: "frame_anchored",
      approvedBy: "Operator",
      approvedAt: "2026-10-23T12:00:00.000Z"
    });
    return scene;
  };

  const createApprovedShotPlan = (sceneId = "scene-1"): ShotPlan => {
    return ShotPlan.create({
      id: "plan-1" as ShotPlanId,
      sceneId: sceneId as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      routingMode: "frame_anchored",
      targetDurationMs: 8000,
      targetFrameCount: 192,
      framing: "medium",
      angle: "eye_level",
      lensIntent: "50mm prime",
      cameraPosition: "eye level tripod",
      cameraMovement: "static",
      movementSpeed: "slow",
      cameraPromptDescription: "Medium eye-level shot",
      actionSummary: "Character running",
      lightingStyle: "neon_night",
      environmentDescription: "Rainy neo-Tokyo",
      status: "approved",
      continuity: {
        incomingContinuityFromSceneId: null,
        persistentSubjectIds: [],
        lightingContinuityNote: null,
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "cand-1" as CandidateId,
        anchorMediaHashSha256: "a".repeat(64)
      }
    });
  };

  const createAnchorCandidate = (sceneId = "scene-1"): StoryboardCandidate => {
    return {
      id: "cand-1" as CandidateId,
      candidateId: "cand-1" as CandidateId,
      sceneId: sceneId as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      beatIndex: 1,
      status: "selected",
      storageBucket: "cco-test",
      storageObjectKey: "candidates/cand-1.png",
      contentHash: "a".repeat(64),
      contentHashSha256: "a".repeat(64),
      createdAt: new Date(),
      updatedAt: new Date()
    } as unknown as StoryboardCandidate;
  };

  const createValidGrant = (
    overrides: Partial<H3CandidateAuthorizationGrant["payload"]> = {}
  ): H3CandidateAuthorizationGrant => ({
    payload: {
      version: 1,
      candidateKey: eligibleProfile192.key,
      specificationDigest: eligibleProfile192.specificationDigest,
      goldMasterWorkflowHash: eligibleProfile192.specification.workflowHash,
      goldMasterModelHashesDigest: computeModelHashesDigest({
        checkpoint: eligibleProfile192.specification.modelHashes.checkpoint,
        clip: eligibleProfile192.specification.modelHashes.clip,
        audioVae: eligibleProfile192.specification.modelHashes.audioVae,
        videoVae: eligibleProfile192.specification.modelHashes.videoVae
      }),
      targetHostname: "staging-host",
      targetGpuUuid: "GPU-1234",
      purpose: "staging",
      scope: "staging",
      issuedAt: "2026-10-23T10:00:00.000Z",
      expiresAt: "2026-10-24T10:00:00.000Z",
      operatorId: "operator-test",
      ...overrides
    },
    signature: "abcd1234",
    signerKeyId: "op-key-1"
  });

  const mockAuthPort: H3CandidateAuthorizationPort = {
    verifyCandidateAuthorization: vi.fn(async () => ({
      authorized: true,
      scope: "staging" as const
    }))
  };

  it("stages an approved scene with an eligible 192f candidate profile", async () => {
    const scene = createApprovedScene("scene-1", 8000);
    const plan = createApprovedShotPlan("scene-1");
    const candidate = createAnchorCandidate("scene-1");

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate])
      .withJobs(jobQueue)
      .seedShotPlan(plan);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant();
    const result = await useCase.execute({
      sceneId: "scene-1",
      candidateProfileKey: eligibleProfile192.key,
      grant,
      requestId: "staging-req-1"
    });

    expect(result.job).toBeDefined();
    expect(result.job.executionScope).toBe("staging");
    expect(result.job.stagingOperationId).toBe("staging-req-1");
    expect(result.job.jobKind).toBe("production");
    expect(result.job.workflowTemplate).toBe(
      "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e"
    );

    const payload = result.job.injectedPayload as Record<string, unknown>;
    expect(payload.candidateProfileKey).toBe(eligibleProfile192.key);
    expect(payload.candidateSpecificationDigest).toBe(eligibleProfile192.specificationDigest);
    expect(payload.frameCount).toBe(192);
    // Invariant [F-45a78a61]: injectedPayload must NOT duplicate executionScope
    expect(payload.executionScope).toBeUndefined();
    expect(payload.productionInputFingerprint).toBeDefined();
    expect((payload.authorizationGrant as H3CandidateAuthorizationGrant).signature).toBe(
      grant.signature
    );

    // Verify job in queue
    const enqueued = jobQueue.enqueuedJobs[0];
    expect(enqueued).toBeDefined();
    expect(enqueued!.executionScope).toBe("staging");
    expect(enqueued!.stagingOperationId).toBe("staging-req-1");

    // Verify scene state transition and attempt recording
    expect(result.scene.status).toBe("queued");
    expect(result.scene.activeProductionJobId).toBe(result.job.jobId);
    expect(result.attemptId).toBeDefined();
  });

  it("handles idempotent replay when called with identical requestId and parameters", async () => {
    const scene = createApprovedScene("scene-1", 8000);
    const plan = createApprovedShotPlan("scene-1");
    const candidate = createAnchorCandidate("scene-1");

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate])
      .withJobs(jobQueue)
      .seedShotPlan(plan);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant();
    const result1 = await useCase.execute({
      sceneId: "scene-1",
      candidateProfileKey: eligibleProfile192.key,
      grant,
      requestId: "staging-req-idempotent"
    });

    const result2 = await useCase.execute({
      sceneId: "scene-1",
      candidateProfileKey: eligibleProfile192.key,
      grant,
      requestId: "staging-req-idempotent"
    });

    expect(result2.idempotentReplay).toBe(true);
    expect(result2.job.jobId).toBe(result1.job.jobId);
    expect(jobQueue.jobs.length).toBe(1);
  });

  it("throws ConflictingStagingOperationError when requestId is reused with different profileKey", async () => {
    const scene = createApprovedScene("scene-1", 8000);
    const plan = createApprovedShotPlan("scene-1");
    const candidate = createAnchorCandidate("scene-1");

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate])
      .withJobs(jobQueue)
      .seedShotPlan(plan);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant();
    await useCase.execute({
      sceneId: "scene-1",
      candidateProfileKey: eligibleProfile192.key,
      grant,
      requestId: "staging-req-conflict"
    });

    await expect(
      useCase.execute({
        sceneId: "scene-1",
        candidateProfileKey: "H3_CANDIDATE_00000000000000000000000000000000_V1",
        grant,
        requestId: "staging-req-conflict"
      })
    ).rejects.toThrow(ConflictingStagingOperationError);
  });

  it("rejects unknown or unaccepted candidate profile with UnsupportedH3CandidateProfileError", async () => {
    const scene = createApprovedScene("scene-1", 8000);
    const plan = createApprovedShotPlan("scene-1");
    const candidate = createAnchorCandidate("scene-1");

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate])
      .withJobs(jobQueue)
      .seedShotPlan(plan);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant({
      candidateKey:
        "H3_CANDIDATE_11111111111111111111111111111111_V1" as H3CandidateAuthorizationGrant["payload"]["candidateKey"]
    });
    // 362f unoptimized NO-GO profile
    await expect(
      useCase.execute({
        sceneId: "scene-1",
        candidateProfileKey: "H3_CANDIDATE_11111111111111111111111111111111_V1",
        grant,
        requestId: "staging-req-unsupported"
      })
    ).rejects.toThrow(UnsupportedH3CandidateProfileError);
  });

  it("rejects staging when authorizationPort denies staging grant", async () => {
    const scene = createApprovedScene("scene-1", 8000);
    const plan = createApprovedShotPlan("scene-1");
    const candidate = createAnchorCandidate("scene-1");

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate])
      .withJobs(jobQueue)
      .seedShotPlans([plan]);

    const rejectingAuthPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn(async () => ({
        authorized: false,
        blocker: "Operator staging grant expired"
      }))
    };

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: rejectingAuthPort
    });

    const grant = createValidGrant();
    await expect(
      useCase.execute({
        sceneId: "scene-1",
        candidateProfileKey: eligibleProfile192.key,
        grant,
        requestId: "staging-req-denied"
      })
    ).rejects.toThrow(StagingAuthorizationDeniedError);
  });

  it("rejects staging when scene is attached to an active ordinary production run", async () => {
    const scene = createApprovedScene("scene-1", 8000);
    const plan = createApprovedShotPlan("scene-1");
    const candidate = createAnchorCandidate("scene-1");

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene], [candidate])
      .withJobs(jobQueue)
      .seedShotPlan(plan);

    // Attach scene to active dispatched run using InMemorySceneUnitOfWork seeders
    uow.seedCampaignProductionRun({
      id: "run-fake",
      campaignId: "campaign-1" as CampaignId,
      fingerprint: "fp-1",
      status: "dispatched",
      expectedTotalDurationMs: 8000,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    uow.seedCampaignProductionRunScenes("run-fake", [
      {
        runId: "run-fake",
        sceneId: scene.id,
        specRevision: 1,
        sequenceIndex: 1,
        expectedDurationMs: 8000
      }
    ]);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant();
    await expect(
      useCase.execute({
        sceneId: "scene-1",
        candidateProfileKey: eligibleProfile192.key,
        grant,
        requestId: "staging-req-active-run"
      })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejects staging for non-approved scene", async () => {
    const scene = Scene.create({
      id: "scene-draft" as SceneId,
      campaignId: "campaign-1" as CampaignId,
      configuration: {
        prompt: "Draft scene",
        referenceIds: [],
        engineProfileId: "minimax_h3_i2v",
        durationMs: 8000
      }
    });

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([scene]).withJobs(jobQueue);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant();
    await expect(
      useCase.execute({
        sceneId: "scene-draft",
        candidateProfileKey: eligibleProfile192.key,
        grant,
        requestId: "staging-req-draft"
      })
    ).rejects.toThrow(InvalidTransitionError);
  });

  it("rejects staging for nonexistent scene", async () => {
    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork([]).withJobs(jobQueue);

    const useCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader: mockRegistryReader,
      authorizationPort: mockAuthPort
    });

    const grant = createValidGrant();
    await expect(
      useCase.execute({
        sceneId: "scene-missing",
        candidateProfileKey: eligibleProfile192.key,
        grant,
        requestId: "staging-req-missing"
      })
    ).rejects.toThrow(SceneNotFoundError);
  });
});
