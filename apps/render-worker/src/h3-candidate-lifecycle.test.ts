import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY,
  type H3CandidateAuthorizationGrant,
  type H3CandidateExecutionSpecification,
  type H3CandidateProfile,
  type ManifestConfiguredMedia,
  type ManifestMeasuredMedia
} from "@cco/contracts";
import {
  AssembleGenerationManifest,
  StageH3CandidateRenderUseCase,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type H3CandidateAuthorizationPort,
  type H3CandidateEligibilityService,
  type H3CandidateRegistryReader,
  type ObjectStoragePort,
  type ProfileRenderIdentity,
  type ResolvedApprovedVisualProductionMedia,
  type SceneRepository,
  type ShotPlanRepository
} from "@cco/application";
import {
  Scene,
  ShotPlan,
  type CampaignId,
  type CandidateId,
  type RenderJob,
  type SceneId,
  type ShotPlanId,
  type StoryboardCandidate
} from "@cco/domain";
import { hashWorkflow, type H3CandidateProvenanceReport } from "@cco/infrastructure";
import { InMemoryJobQueue } from "../../../packages/application/src/test-support/in-memory-job-queue.js";
import { InMemorySceneUnitOfWork } from "../../../packages/application/src/test-support/in-memory-scene-unit-of-work.js";
import {
  CandidateProfileProductionDisabledError,
  createCertifiedRenderJobExecutor,
  type ComfyUiOutputReader
} from "./render-job-executor.js";

// Fixture graph is wired with real node-output references (["<id>", <slot>]) rather than
// disconnected literal nodes, so this stands in for an actually-executable H3 workflow rather
// than a set of nodes that merely share a class_type vocabulary.
function buildSampleWorkflow(frames: number): string {
  const workflow = {
    "4": {
      class_type: "UNETLoader",
      inputs: { unet_name: "minimax_h3.safetensors", weight_dtype: "default" }
    },
    "50": {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["4", 0], lora_name: "turbo_lora.safetensors", strength_model: 1.0 }
    },
    "9": {
      class_type: "BasicScheduler",
      inputs: { model: ["50", 0], steps: 20, scheduler: "simple", denoise: 1 }
    },
    "15": {
      class_type: "RandomNoise",
      inputs: { noise_seed: 42 }
    },
    "17": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: "res_multistep" }
    },
    "20": {
      class_type: "LoadImage",
      inputs: { image: "reference_frame.png" }
    },
    "60": {
      class_type: "AttentionBackendSelector",
      inputs: { model: ["50", 0], attention_backend: "flash_attn" }
    },
    "104": {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        // Consumes the attention-selected model (node 60), not the raw LoRA output directly,
        // so the attention backend node is actually wired into the executed graph rather than
        // sitting disconnected beside it.
        model: ["60", 0],
        sigmas: ["9", 0],
        noise: ["15", 0],
        sampler: ["17", 0],
        image: ["20", 0],
        prompt: "original prompt",
        length: frames,
        width: 1344,
        height: 768
      }
    }
  };
  return JSON.stringify(workflow, null, 2);
}

// Operator-declared physical GPU this fixture worker is pretending to execute on. Real
// executions require this to be a live-observed, nvidia-smi-verified UUID (ADR 0008 section
// 6); here it only needs to be a consistent, non-empty value the authorization/eligibility
// fakes below can assert was actually threaded through, since render-job-executor.ts now
// fails closed rather than defaulting to a placeholder GPU identity.
// Must match the GPU UUID the fixture's authorization grant is bound to below (see
// `gpuUuid`/`targetGpuUuid` on the grant fixture) - a real grant only authorizes execution on
// the specific physical GPU it names, so the executing worker's configured target must agree.
const FIXTURE_TARGET_GPU_UUID = "GPU-12345678-1234-1234-1234-123456789abc";

function createCandidateFixture(frames = 192) {
  const rawWorkflow = buildSampleWorkflow(frames);
  const workflowHash = hashWorkflow(rawWorkflow);

  const spec: H3CandidateExecutionSpecification = {
    version: 1,
    route: "i2v",
    routingMode: "frame_anchored",
    width: 1344,
    height: 768,
    fps: 24,
    frames,
    workflowHash,
    modelHashes: {
      checkpoint: "a".repeat(64),
      clip: "b".repeat(64),
      audioVae: "c".repeat(64),
      videoVae: "d".repeat(64),
      turboLora: "e".repeat(64),
      additionalModels: {}
    },
    sampler: "res_multistep",
    scheduler: "simple",
    steps: 20,
    cfg: 1.0,
    denoise: 1.0,
    attention: {
      backend: "flash_attn",
      customNodeRevision: "rev-1",
      customNodeSourceHash: "f".repeat(64),
      packageVersion: "1.0.0",
      sparsitySettings: { enabled: false, method: "none", threshold: 0 }
    },
    runnerSettings: {
      runnerProfile: "dynamicvram-offload-v1",
      offloadPolicy: "dynamicvram",
      requiresModelOffloading: true,
      maxConcurrentGpuJobs: 1,
      minFreeDiskGb: 100
    },
    customNodes: [],
    packageVersions: { torch: "2.5.0" }
  };

  const specificationDigest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(specificationDigest, 1);

  const candidate: H3CandidateProfile = {
    key,
    version: 1,
    specificationDigest,
    specification: spec,
    topology:
      MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY as unknown as H3CandidateProfile["topology"],
    measurements: null,
    status: "candidate"
  };

  const provenanceReport: H3CandidateProvenanceReport = {
    version: 1,
    candidateKey: key,
    generatedAt: "2026-10-23T12:00:00.000Z",
    workflow: {
      relativePath: `workflows/${key}.json`,
      sha256: workflowHash
    },
    models: [
      {
        relativePath: "models/checkpoint.safetensors",
        sha256: spec.modelHashes.checkpoint
      }
    ],
    renderProfileProvenance: {
      candidateKey: key,
      version: 1,
      route: spec.route,
      routingMode: spec.routingMode,
      width: spec.width,
      height: spec.height,
      fps: spec.fps,
      frames: spec.frames,
      steps: spec.steps,
      workflowHash,
      modelHashes: {
        checkpoint: spec.modelHashes.checkpoint,
        clip: spec.modelHashes.clip,
        audioVae: spec.modelHashes.audioVae,
        videoVae: spec.modelHashes.videoVae,
        turboLora: spec.modelHashes.turboLora
      },
      optimizerFingerprint: {
        attentionBackend: spec.attention.backend,
        customNodeRevision: spec.attention.customNodeRevision,
        customNodeSourceHash: spec.attention.customNodeSourceHash,
        packageVersion: spec.attention.packageVersion,
        sparsity: spec.attention.sparsitySettings,
        customNodes: [],
        packageVersions: spec.packageVersions
      },
      runnerProfile: spec.runnerSettings.runnerProfile,
      measuredDiskFootprintGb: 50,
      minFreeDiskGb: spec.runnerSettings.minFreeDiskGb
    },
    observedRuntime: {
      hostname: "rtx-4090-node",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      pid: 12345,
      processStartTimeTicks: 100,
      pythonExecutable: "/usr/bin/python3",
      comfyUiCoreRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      commandLineArgs: ["--listen"],
      customNodes: {},
      packageVersions: spec.packageVersions,
      observedAt: "2026-10-23T12:00:00.000Z"
    },
    operatorAuthorization: {
      signerKeyId: "key-1",
      payloadDigest: "9".repeat(64),
      scope: "staging"
    }
  };

  return { candidate, rawWorkflow, workflowHash, provenanceReport };
}

describe("H3 Candidate End-to-End Staging Lifecycle (#425)", () => {
  const sampleSceneId = "22222222-2222-4222-8222-222222222222" as SceneId;
  const sampleCandidateId = "33333333-3333-4333-8333-333333333333" as CandidateId;
  const sampleShotPlanId = "44444444-4444-4444-8444-444444444444" as ShotPlanId;

  const sampleGrant = (
    candidateKey: string,
    specificationDigest: string = "a".repeat(64),
    workflowHash: string = "b".repeat(64)
  ): H3CandidateAuthorizationGrant => ({
    payload: {
      version: 1,
      candidateKey,
      specificationDigest,
      goldMasterWorkflowHash: workflowHash,
      goldMasterModelHashesDigest: "c".repeat(64),
      targetHostname: "rtx-4090-node",
      targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      purpose: "staging",
      scope: "staging",
      issuedAt: "2026-10-23T12:00:00.000Z",
      expiresAt: "2026-10-24T12:00:00.000Z",
      operatorId: "operator-1"
    },
    signerKeyId: "key-1",
    signature: "abcdef0123456789"
  });

  it("completes full staging lifecycle: admission -> queue isolation -> execution -> manifest assembly -> idempotent replay", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture(192);
    const grant = sampleGrant(
      candidate.key,
      candidate.specificationDigest,
      candidate.specification.workflowHash
    );

    // 1. Setup in-memory domain state: Approved Scene with Approved ShotPlan (frame_anchored)
    const scene = Scene.create({
      id: sampleSceneId,
      campaignId: "11111111-1111-4111-8111-111111111111" as CampaignId,
      configuration: {
        prompt: "Cinematic shot of neon streets",
        referenceIds: [],
        engineProfileId: "minimax_h3_i2v",
        durationMs: 8000
      }
    });
    scene.beginCandidateGeneration();
    scene.submitCandidatesForReview();
    scene.selectCandidate(sampleCandidateId, 1, scene.id);
    scene.selectShotPlan(sampleShotPlanId, 1, scene.id);
    scene.approveShotPlan({
      routingMode: "frame_anchored",
      approvedBy: "Operator",
      approvedAt: "2026-10-23T12:00:00.000Z"
    });

    const shotPlan = ShotPlan.create({
      id: sampleShotPlanId,
      sceneId: sampleSceneId,
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
        anchorCandidateId: sampleCandidateId,
        anchorMediaHashSha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a"
      }
    });

    const candidateMedia = {
      id: sampleCandidateId,
      candidateId: sampleCandidateId,
      sceneId: sampleSceneId,
      specRevision: 1,
      variantOrdinal: 1,
      beatIndex: 1,
      status: "selected",
      storageBucket: "review-bucket",
      storageObjectKey: "candidates/cand-1.png",
      contentHash: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
      contentHashSha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const jobQueue = new InMemoryJobQueue();
    const uow = new InMemorySceneUnitOfWork(
      [scene],
      [candidateMedia as unknown as StoryboardCandidate]
    )
      .withJobs(jobQueue)
      .seedShotPlan(shotPlan);

    const registryReader: H3CandidateRegistryReader = {
      getCandidateProfile: (k) => (k === candidate.key ? candidate : undefined),
      listCandidateProfiles: () => [candidate],
      isCandidateProfileKey: (k) => k === candidate.key
    };

    const authorizationPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn(async (request) => {
        // Assert the executor actually threads the configured target GPU through to the
        // authorization check, rather than letting the request's GPU identity go unchecked.
        expect(request.targetGpuUuid).toBe(FIXTURE_TARGET_GPU_UUID);
        return { authorized: true, scope: "staging" as const };
      })
    };

    // 2. Stage candidate render via StageH3CandidateRenderUseCase
    const stageUseCase = new StageH3CandidateRenderUseCase({
      uow,
      registryReader,
      authorizationPort
    });

    const requestId = "staging-req-e2e-1";
    const stageResult = await stageUseCase.execute({
      sceneId: sampleSceneId,
      candidateProfileKey: candidate.key,
      grant,
      requestId
    });

    // Invariant: Staged job carries durable executionScope: "staging"
    expect(stageResult.job.executionScope).toBe("staging");
    expect(stageResult.job.status).toBe("queued");
    expect(stageResult.job.injectedPayload.candidateProfileKey).toBe(candidate.key);
    expect(stageResult.job.injectedPayload.frameCount).toBe(192);
    expect(stageResult.job.injectedPayload.requestedDurationMs).toBe(8000);
    expect(stageResult.job.injectedPayload.nominalDurationMs).toBe(8000);
    expect(stageResult.job.injectedPayload.candidateSpecificationDigest).toBe(
      candidate.specificationDigest
    );

    // Invariant: Scene status advances to "queued" and production attempt recorded
    const updatedScene = await uow.execute((ctx) => ctx.scenes.findById(sampleSceneId));
    expect(updatedScene?.status).toBe("queued");
    expect(updatedScene?.snapshot().productionAttemptOrdinal).toBe(1);

    // 3. Queue isolation test: Disallowing candidate execution under ordinary production queue
    const ordinaryProductionJob: RenderJob = {
      ...stageResult.job,
      executionScope: "production"
    };

    const executeProfileRender = vi.fn(async () => ({
      status: "succeeded" as const,
      renderJobId: stageResult.job.jobId,
      sceneId: sampleSceneId,
      outputObjectKeys: ["render_out.mp4"],
      promptId: "prompt-e2e-1",
      profile: "test" as unknown as ProfileRenderIdentity,
      durationMs: 4200,
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096
      }
    })) as unknown as (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult>;

    const realAssembler = new AssembleGenerationManifest({
      hashBytes: {
        hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
      },
      sceneRepository: {
        findById: async (id) => (id === sampleSceneId ? scene : undefined),
        save: async () => {}
      },
      storyboardCandidateRepository: {
        findById: async (id) =>
          id === sampleCandidateId ? (candidateMedia as unknown as StoryboardCandidate) : undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => [candidateMedia as unknown as StoryboardCandidate]
      },
      referenceAssetRepository: {
        listBySceneId: async () => [],
        findByIds: async () => []
      }
    });

    const outputVideoBytes = new Uint8Array([
      0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d
    ]);

    const executor = createCertifiedRenderJobExecutor({
      registryReader,
      productionManifestAssembler: realAssembler,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () =>
            ({
              media: {
                bucket: "review-bucket",
                key: "cand-1.png",
                sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
                contentType: "image/png",
                byteLength: 29
              },
              inputMedia: {
                firstFrame: {
                  bucket: "review-bucket",
                  key: "cand-1.png",
                  sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
                  contentType: "image/png",
                  byteLength: 29
                }
              }
            }) as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: {
        getObject: vi.fn(async () => ({
          body: new Uint8Array([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0,
            0, 5, 0x40, 0, 0, 3, 0, 8, 2, 0, 0, 0
          ]),
          contentLength: 29,
          contentType: "image/png"
        })),
        putObject: vi.fn(async () => {})
      } as unknown as ObjectStoragePort,
      stageReferenceImage: {
        stage: vi.fn(async (input) => ({
          name: input.filename,
          subfolder: "inputs",
          type: "input" as const
        })),
        cleanup: vi.fn(async () => {})
      },
      executeProfileRender,
      outputReader: {
        readOutput: vi.fn(async () => ({
          bytes: outputVideoBytes,
          contentType: "video/mp4"
        }))
      } as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn((options): ManifestMeasuredMedia => ({
        outputKey: options.outputKey,
        checksumSha256: options.checksumSha256,
        container: "ffprobe",
        dimensions: { width: 1344, height: 768 },
        frameCount: 192,
        fps: 24,
        durationMs: 8000,
        formatDurationMs: 8000,
        video: { codecName: "h264", pixelFormat: "yuv420p" },
        measurement: "source_bytes"
      })),
      authorizationPort,
      sceneRepository: {
        findById: async (id: SceneId) => (id === sampleSceneId ? scene : undefined)
      } as unknown as SceneRepository,
      targetGpuUuid: FIXTURE_TARGET_GPU_UUID,
      // Stubbed at the H3CandidateEligibilityService boundary: the live nvidia-smi/process/
      // revision observation it performs is exercised by h3-live-runtime-observer's own tests
      // and evaluate-h3-candidate-eligibility's own unit tests, not by this scene/queue
      // lifecycle test. We still assert the target GPU identity was threaded through correctly
      // so this fake can't silently mask a regression like the earlier GPU-00000000 default.
      eligibilityService: {
        evaluateEligibility: vi.fn(async (request) => {
          expect(request.target.gpuUuid).toBe(FIXTURE_TARGET_GPU_UUID);
          return { eligible: true };
        })
      } as unknown as H3CandidateEligibilityService,
      shotPlanRepository: {
        findById: vi.fn(async () => shotPlan)
      } as unknown as ShotPlanRepository
    });

    // Invariant: Fails closed when candidate job is dispatched on ordinary production queue
    await expect(executor(ordinaryProductionJob)).rejects.toThrow(
      CandidateProfileProductionDisabledError
    );

    // 4. Staging worker execution on the valid staging job
    const workerOutput = await executor(stageResult.job);
    expect(workerOutput.manifestPayload).toBeDefined();

    interface LifecycleTestManifest {
      readonly jobId: string;
      readonly renderProfile: string;
      readonly renderProfileVersion: number;
      readonly executionScope: string;
      readonly candidateSpecificationDigest: string;
      readonly requestedDurationMs: number;
      readonly nominalDurationMs: number;
      readonly configuredMedia: ManifestConfiguredMedia;
      readonly measuredMedia: ManifestMeasuredMedia;
    }

    const manifest = workerOutput.manifestPayload as unknown as LifecycleTestManifest;
    expect(manifest.jobId).toBe(stageResult.job.jobId);
    expect(manifest.renderProfile).toBe(candidate.key);
    expect(manifest.renderProfileVersion).toBe(1);
    expect(manifest.executionScope).toBe("staging");
    expect(manifest.candidateSpecificationDigest).toBe(candidate.specificationDigest);
    expect(manifest.requestedDurationMs).toBe(8000);
    expect(manifest.nominalDurationMs).toBe(8000);
    expect(manifest.configuredMedia.frameCount).toBe(192);
    expect(manifest.configuredMedia.fps).toBe(24);
    expect(manifest.measuredMedia.frameCount).toBe(192);
    expect(manifest.measuredMedia.fps).toBe(24);
    expect(manifest.measuredMedia.durationMs).toBe(8000);

    // 5. Idempotent replay: Resubmitting with identical requestId returns idempotentReplay: true
    const replayResult = await stageUseCase.execute({
      sceneId: sampleSceneId,
      candidateProfileKey: candidate.key,
      grant,
      requestId
    });

    expect(replayResult.idempotentReplay).toBe(true);
    expect(replayResult.job.jobId).toBe(stageResult.job.jobId);
  });
});
