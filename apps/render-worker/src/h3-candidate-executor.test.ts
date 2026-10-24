import { describe, expect, it, vi } from "vitest";
import {
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY,
  MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY,
  type GenerationManifest,
  type H3CandidateExecutionSpecification,
  type H3CandidateProfile,
  type H3CandidateAuthorizationGrant,
  type ManifestMeasuredMedia
} from "@cco/contracts";
import type {
  ExecuteProfileRenderInput,
  ExecuteProfileRenderResult,
  H3CandidateAuthorizationPort,
  H3CandidateEligibilityService,
  H3CandidateRegistryReader,
  ObjectStoragePort,
  CampaignRepository,
  ProfileRenderIdentity,
  ReferenceAssetRepository,
  ResolvedApprovedVisualProductionMedia,
  SceneRepository,
  ShotPlanRepository
} from "@cco/application";
import type {
  CampaignId,
  CampaignRecord,
  JobId,
  LeaseToken,
  ReferenceAsset,
  RenderJob,
  Scene,
  SceneId,
  ShotPlan,
  ShotPlanId
} from "@cco/domain";
import { hashWorkflow, type H3CandidateProvenanceReport } from "@cco/infrastructure";
import {
  type ComfyUiOutputReader,
  type ProductionManifestAssembler,
  CandidateProfileProductionDisabledError,
  createCertifiedRenderJobExecutor,
  ProductionManifestAssemblyError,
  ReferenceImageIntegrityError
} from "./render-job-executor.js";

function buildSampleWorkflow(options: {
  route: "i2v" | "ref2v";
  frames: number;
  steps?: number;
  scheduler?: string;
  sampler?: string;
  denoise?: number;
  turboLora?: { name: string } | null;
  attentionBackend?: string | undefined;
}): string {
  const isRef2v = options.route === "ref2v";
  const workflow: Record<string, unknown> = {
    "4": {
      // Repository H3 API graphs use the native UNETLoader topology for the
      // diffusion checkpoint; keep the positive candidate fixture aligned.
      class_type: "UNETLoader",
      inputs: { unet_name: "minimax_h3.safetensors", weight_dtype: "default" }
    },
    "9": {
      class_type: "BasicScheduler",
      inputs: {
        steps: options.steps ?? 20,
        scheduler: options.scheduler ?? "simple",
        denoise: options.denoise ?? 1
      }
    },
    "15": {
      class_type: "RandomNoise",
      inputs: { noise_seed: 42 }
    },
    "17": {
      class_type: "KSamplerSelect",
      inputs: { sampler_name: options.sampler ?? "res_multistep" }
    }
  };

  if (isRef2v) {
    const refInputs: Record<string, unknown> = {
      prompt: "original prompt",
      length: options.frames,
      width: 1344,
      height: 768,
      ref_image_size: "match",
      clip: ["4", 1],
      vae: ["4", 2],
      audio_vae: ["4", 3]
    };
    for (let slot = 0; slot < 9; slot++) {
      refInputs[`ref_images.ref_image_${slot}`] = [String(201 + slot), 0];
    }
    workflow["105"] = {
      class_type: "MiniMaxH3ReferenceToVideo",
      inputs: refInputs
    };
    for (let slot = 1; slot <= 9; slot++) {
      const nodeId = String(200 + slot);
      workflow[nodeId] = {
        class_type: "LoadImage",
        inputs: { image: `ref_${slot}.png` }
      };
    }
  } else {
    workflow["104"] = {
      class_type: "MiniMaxH3ImageToVideo",
      inputs: {
        prompt: "original prompt",
        length: options.frames,
        width: 1344,
        height: 768
      }
    };
    workflow["20"] = {
      class_type: "LoadImage",
      inputs: { image: "reference_frame.png" }
    };
  }

  if (options.turboLora) {
    workflow["50"] = {
      class_type: "LoraLoaderModelOnly",
      inputs: {
        lora_name: options.turboLora.name,
        strength_model: 1.0
      }
    };
  }

  if (options.attentionBackend) {
    workflow["60"] = {
      class_type: "AttentionBackendSelector",
      inputs: {
        attention_backend: options.attentionBackend
      }
    };
  }

  return JSON.stringify(workflow, null, 2);
}

function createCandidateFixture(
  options: {
    frames?: number;
    route?: "i2v" | "ref2v";
    steps?: number;
    scheduler?: string;
    sampler?: string;
    denoise?: number;
    attentionBackend?: "flash_attn" | "sage_attn" | "sdpa" | "standard" | "comfy_native";
    turboLora?: string;
    workflowTemplateOverride?: string;
  } = {}
): {
  candidate: H3CandidateProfile;
  rawWorkflow: string;
  workflowHash: string;
  provenanceReport: H3CandidateProvenanceReport;
} {
  const frames = options.frames ?? 192;
  const route = options.route ?? "i2v";
  const steps = options.steps ?? 20;
  const scheduler = options.scheduler ?? "simple";
  const sampler = options.sampler ?? "res_multistep";
  const denoise = options.denoise ?? 1;
  const attentionBackend = options.attentionBackend ?? "flash_attn";

  const rawWorkflow =
    options.workflowTemplateOverride ??
    buildSampleWorkflow({
      route,
      frames,
      steps,
      scheduler,
      sampler,
      denoise,
      turboLora:
        options.turboLora !== undefined
          ? options.turboLora === "none"
            ? null
            : { name: options.turboLora }
          : { name: "turbo_lora.safetensors" },
      attentionBackend: attentionBackend !== "standard" ? attentionBackend : undefined
    });

  const workflowHash = hashWorkflow(rawWorkflow);

  const spec: H3CandidateExecutionSpecification = {
    version: 1,
    route,
    routingMode: route === "i2v" ? "frame_anchored" : "reference_directed",
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
      turboLora: options.turboLora === "none" ? "none" : "e".repeat(64),
      additionalModels: {}
    },
    sampler,
    scheduler,
    steps,
    cfg: 1.0,
    denoise,
    attention: {
      backend: attentionBackend,
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
  const topology =
    route === "i2v"
      ? MINIMAX_H3_720P_5S_I2V_V1_INJECTION_TOPOLOGY
      : MINIMAX_H3_720P_5S_REF2V_V1_INJECTION_TOPOLOGY;

  const candidate: H3CandidateProfile = {
    key,
    version: 1,
    specificationDigest,
    specification: spec,
    topology: topology as unknown as H3CandidateProfile["topology"],
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

describe("H3 Candidate Render Execution (#425)", () => {
  const sampleSceneId = "22222222-2222-4222-8222-222222222222" as SceneId;
  const sampleJobId = "11111111-1111-4111-8111-111111111111" as JobId;
  const sampleLeaseToken = "33333333-3333-4333-8333-333333333333" as LeaseToken;

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

  const sampleShotPlanId = "shotplan-test-1" as ShotPlanId;
  const mockDefaultShotPlan = {
    snapshot: () => ({
      id: sampleShotPlanId,
      sceneId: sampleSceneId,
      status: "approved",
      specRevision: 1,
      routingMode: "frame_anchored",
      continuity: {
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "cand-1",
        anchorMediaHashSha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a"
      }
    })
  };
  const mockDefaultScene = {
    snapshot: () => ({
      id: sampleSceneId,
      campaignId: "campaign-1" as CampaignId,
      status: "approved",
      specRevision: 1,
      approvedShotPlanId: sampleShotPlanId,
      approvedShotPlanRevision: 1
    })
  };
  const defaultShotPlanRepo: ShotPlanRepository = {
    findById: vi.fn(async () => mockDefaultShotPlan as unknown as ShotPlan)
  } as unknown as ShotPlanRepository;
  const defaultSceneRepo: SceneRepository = {
    findById: vi.fn(async () => mockDefaultScene as unknown as Scene)
  } as unknown as SceneRepository;

  const createStagingJob = (
    candidateKey: string,
    specificationDigest: string,
    frameCount: number,
    overrides: Partial<RenderJob> = {}
  ): RenderJob => {
    const rawPayload: Record<string, unknown> = {
      prompt: "Cinematic shot of neon streets",
      seed: 42,
      frameCount,
      shotPlanId: sampleShotPlanId,
      specRevision: 1,
      attemptId: "att-1",
      candidateProfileKey: candidateKey,
      candidateSpecificationDigest: specificationDigest,
      authorizationGrant: sampleGrant(candidateKey, specificationDigest),
      ...((overrides.injectedPayload as Record<string, unknown> | undefined) ?? {})
    };
    if (!overrides.injectedPayload || !("approvedCandidateId" in overrides.injectedPayload)) {
      rawPayload.approvedCandidateId = "cand-1";
    } else if (
      overrides.injectedPayload.approvedCandidateId === undefined ||
      overrides.injectedPayload.approvedCandidateId === null
    ) {
      delete rawPayload.approvedCandidateId;
    }

    const job: RenderJob = {
      jobId: sampleJobId,
      sceneId: sampleSceneId,
      jobKind: "production",
      status: "rendering",
      workflowTemplate: candidateKey,
      workerId: "worker-1",
      leaseToken: sampleLeaseToken,
      leaseExpiresAt: new Date(Date.now() + 60000),
      executionScope: "staging",
      stagingOperationId: "staging-req-1",
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
      injectedPayload: rawPayload
    };
    return job;
  };

  const createMockStorage = () => ({
    getObject: vi.fn(async () => ({
      body: new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
        5, 0x40, 0, 0, 3, 0, 8, 2, 0, 0, 0
      ]),
      contentLength: 29,
      contentType: "image/png"
    })),
    putObject: vi.fn(async () => {})
  });

  const createMockStager = () => ({
    stage: vi.fn(async (input: { filename: string; bytes: Uint8Array; contentType?: string }) => ({
      name: input.filename,
      subfolder: "inputs",
      type: "input" as const
    })),
    cleanup: vi.fn(async () => {})
  });

  const createMockProber = (
    frameCount: number,
    width = 1344,
    height = 768,
    fps = 24
  ): ManifestMeasuredMedia => ({
    outputKey: "output.mp4",
    checksumSha256: "9".repeat(64),
    container: "ffprobe",
    dimensions: { width, height },
    frameCount,
    fps,
    durationMs: Math.round((frameCount / fps) * 1000),
    formatDurationMs: Math.round((frameCount / fps) * 1000),
    video: { codecName: "h264", pixelFormat: "yuv420p" },
    measurement: "source_bytes"
  });

  const createMockExecuteProfileRender = (outputKeys: string[] = ["render_out.mp4"]) =>
    vi.fn(async () => ({
      status: "succeeded" as const,
      renderJobId: sampleJobId,
      sceneId: sampleSceneId,
      outputObjectKeys: outputKeys,
      promptId: "prompt-1",
      profile: "test" as unknown as ProfileRenderIdentity,
      durationMs: 4200,
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096
      }
    })) as unknown as (input: ExecuteProfileRenderInput) => Promise<ExecuteProfileRenderResult>;

  // Matches the targetGpuUuid/gpuUuid bound into the authorization grant and provenance
  // fixtures throughout this file - render-job-executor.ts now fails closed rather than
  // defaulting to a placeholder GPU identity, so every executor construction below must
  // declare the physical GPU it is (fictitiously, for this test) executing on.
  const DEFAULT_TARGET_GPU_UUID = "GPU-12345678-1234-1234-1234-123456789abc";

  const defaultAuthPort: H3CandidateAuthorizationPort = {
    verifyCandidateAuthorization: vi.fn(async () => ({
      authorized: true,
      scope: "staging" as const
    }))
  };
  const defaultEligibilityService = {
    evaluateEligibility: vi.fn(async () => ({ eligible: true }))
  } as unknown as H3CandidateEligibilityService;

  it("successfully executes 192f (8s) candidate profile render in operator staging", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn((key: string | undefined) =>
        key === candidate.key ? candidate : undefined
      ),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn((key: string | undefined) => key === candidate.key)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const mockOutputReader = {
      readOutput: vi.fn(async () => ({
        bytes: new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        contentType: "video/mp4"
      }))
    };

    const executeProfileRender = createMockExecuteProfileRender(["render_out.mp4"]);

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn(async (input) => ({
        manifestPayload: {
          renderProfile: candidate.key,
          renderProfileVersion: 1,
          engine: "minimax_h3_i2v",
          executionScope: "staging",
          configuredMedia: input.configuredMedia,
          measuredMedia: input.measuredMedia
        }
      }))
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      executeProfileRender,
      outputReader: mockOutputReader as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => createMockProber(192)),
      productionManifestAssembler: mockAssembler
    });

    const result = await executor(job);

    expect(result.mediaObjects).toHaveLength(1);
    expect(result.manifestPayload).toBeDefined();
    const manifest = result.manifestPayload as unknown as GenerationManifest;
    expect(manifest.renderProfile).toBe(candidate.key);
    expect(manifest.executionScope).toBe("staging");
    expect(manifest.configuredMedia?.frameCount).toBe(192);
    expect(manifest.measuredMedia?.frameCount).toBe(192);
  });

  it("successfully executes 243f (10s) candidate profile render in operator staging", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 243,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 243);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn((key: string | undefined) =>
        key === candidate.key ? candidate : undefined
      ),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn((key: string | undefined) => key === candidate.key)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      executeProfileRender: createMockExecuteProfileRender(["out.mp4"]),
      outputReader: {
        readOutput: vi.fn(async () => ({
          bytes: new Uint8Array([0, 0, 0, 20]),
          contentType: "video/mp4"
        }))
      } as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => createMockProber(243)),
      productionManifestAssembler: {
        assembleManifest: vi.fn(async (input) => ({
          manifestPayload: {
            renderProfile: candidate.key,
            configuredMedia: input.configuredMedia,
            measuredMedia: input.measuredMedia
          }
        }))
      }
    });

    const result = await executor(job);
    const manifest = result.manifestPayload as unknown as GenerationManifest;
    expect(manifest.measuredMedia?.frameCount).toBe(243);
  });

  it("fails closed before GPU work when candidate profile is dispatched on ordinary production queue", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192, {
      executionScope: "production" // Ordinary production queue
    });

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const executeProfileRender = vi.fn();
    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      executeProfileRender
    });

    await expect(executor(job)).rejects.toThrow(CandidateProfileProductionDisabledError);
    expect(executeProfileRender).not.toHaveBeenCalled();
  });

  it("fails closed when unadmitted candidate variant (#423 362f unoptimized I2V NO-GO) is selected", async () => {
    // 362f unoptimized NO-GO profile is NOT returned by registry reader
    const unadmittedKey = "H3_CANDIDATE_33060cba7df6874ebf4ff7fa762b3542_V1";
    const job = createStagingJob(unadmittedKey, "a".repeat(64), 362);

    const emptyReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => undefined), // unadmitted / rejected
      listCandidateProfiles: vi.fn(() => []),
      isCandidateProfileKey: vi.fn(() => false)
    };

    const executeProfileRender = vi.fn();
    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: emptyReader,
      executeProfileRender
    });

    await expect(executor(job)).rejects.toThrow(/not admitted in trusted candidate registry/i);
    expect(executeProfileRender).not.toHaveBeenCalled();
  });

  it("fails closed: Ref2V cannot inherit I2V candidate eligibility", async () => {
    // Candidate profile is I2V
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192, {
      injectedPayload: {
        prompt: "Ref2V attempting to use I2V candidate",
        seed: 42,
        frameCount: 192,
        shotPlanId: "shotplan-ref2v",
        specRevision: 1,
        candidateProfileKey: candidate.key,
        candidateSpecificationDigest: candidate.specificationDigest,
        authorizationGrant: sampleGrant(candidate.key, candidate.specificationDigest)
      }
    });

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    // ShotPlan has routingMode: reference_directed
    const mockShotPlan = {
      snapshot: () => ({
        id: "shotplan-ref2v",
        sceneId: sampleSceneId,
        status: "approved",
        specRevision: 1,
        routingMode: "reference_directed"
      })
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: {
        findById: vi.fn(async () => mockShotPlan as unknown as ShotPlan)
      } as unknown as ShotPlanRepository,
      sceneRepository: {
        findById: vi.fn(async () => ({
          snapshot: () => ({
            id: sampleSceneId,
            campaignId: "campaign-1" as CampaignId,
            status: "approved",
            specRevision: 1,
            approvedShotPlanId: "shotplan-anchored",
            approvedShotPlanRevision: 1
          })
        }))
      } as unknown as SceneRepository
    });

    await expect(executor(job)).rejects.toThrow(/does not match candidate profile route "i2v"/i);
  });

  it("fails closed: detects wrong Turbo LoRA routing (Ref2VA LoRA wired in I2V workflow)", async () => {
    // Workflow contains Ref2VA LoRA but candidate is I2V
    const tamperedWorkflow = buildSampleWorkflow({
      route: "i2v",
      frames: 192,
      turboLora: { name: "minimax_h3_ref2va_turbo_4step.safetensors" }
    });

    const { candidate, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v",
      workflowTemplateOverride: tamperedWorkflow
    });

    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => tamperedWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager()
    });

    await expect(executor(job)).rejects.toThrow(
      /Ref2VA Turbo LoRA is strictly restricted to Ref2V route/i
    );
  });

  it("fails closed: detects silent dense-attention fallback", async () => {
    // Workflow configured with standard/dense attention while candidate requires flash_attn
    const tamperedWorkflow = buildSampleWorkflow({
      route: "i2v",
      frames: 192,
      attentionBackend: "dense"
    });

    const { candidate, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v",
      attentionBackend: "flash_attn",
      workflowTemplateOverride: tamperedWorkflow
    });

    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => tamperedWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager()
    });

    await expect(executor(job)).rejects.toThrow(/Detected silent dense-attention fallback/i);
  });

  it("fails closed: post-render probed output frame count mismatch rejects rather than silently stretching", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      executeProfileRender: createMockExecuteProfileRender(["render_out.mp4"]),
      outputReader: {
        readOutput: vi.fn(async () => ({
          bytes: new Uint8Array([0, 0, 0, 20]),
          contentType: "video/mp4"
        }))
      } as unknown as ComfyUiOutputReader,
      // Output truncated to 124 frames instead of 192!
      formatAwareProber: vi.fn(() => createMockProber(124))
    });

    await expect(executor(job)).rejects.toThrow(ProductionManifestAssemblyError);
    await expect(executor(job)).rejects.toThrow(
      /Probed output frame count 124 does not match candidate specification frames 192/i
    );
  });

  it("fails closed when specification digest is tampered", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const tamperedDigest = "0".repeat(64);
    const job = createStagingJob(candidate.key, tamperedDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow)
    });

    await expect(executor(job)).rejects.toThrow(/Candidate specification digest mismatch/i);
  });

  it("fails closed when injected frame count does not match candidate specification", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    // Injected 243 frames for a 192f profile
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 243);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow)
    });

    await expect(executor(job)).rejects.toThrow(
      /injected frameCount \(243\) must match candidate profile frames \(192\)|injectedPayload\.frameCount must be a safe integer between 192 and 192/i
    );
  });

  it("fails closed when authorizationGrant is missing", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);
    delete (job.injectedPayload as Record<string, unknown>).authorizationGrant;

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow)
    });

    await expect(executor(job)).rejects.toThrow(
      /requires a signed operator authorization grant before execution/i
    );
  });

  it("fails closed when authorizationPort denies authorization", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockAuthPort: H3CandidateAuthorizationPort = {
      verifyCandidateAuthorization: vi.fn(async () => ({
        authorized: false,
        blocker: "OPERATOR_KEY_REVOKED"
      }))
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: mockAuthPort
    });

    await expect(executor(job)).rejects.toThrow(
      /Candidate authorization denied: OPERATOR_KEY_REVOKED/i
    );
  });

  it("fails closed when candidateProvenanceReport workflow relative path contains directory traversal", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const maliciousReport: H3CandidateProvenanceReport = {
      ...provenanceReport,
      workflow: {
        relativePath: "../../../etc/passwd",
        sha256: provenanceReport.workflow.sha256
      }
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => maliciousReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow)
    });

    await expect(executor(job)).rejects.toThrow(
      /(?:contains directory traversal|escapes directory) or is absolute/i
    );
  });

  it("fails closed when frame_anchored shotPlan has continuity anchor mismatch", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192, {
      injectedPayload: {
        prompt: "Shot with anchor mismatch",
        seed: 42,
        approvedCandidateId: "cand-1",
        frameCount: 192,
        shotPlanId: "shotplan-anchored",
        specRevision: 1,
        candidateProfileKey: candidate.key,
        candidateSpecificationDigest: candidate.specificationDigest,
        authorizationGrant: sampleGrant(candidate.key, candidate.specificationDigest)
      }
    });

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockShotPlan = {
      snapshot: () => ({
        id: "shotplan-anchored",
        sceneId: sampleSceneId,
        status: "approved",
        specRevision: 1,
        routingMode: "frame_anchored",
        continuity: {
          frameAnchorTarget: "first_frame",
          anchorCandidateId: "different-cand-999"
        }
      })
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: {
        findById: vi.fn(async () => mockShotPlan as unknown as ShotPlan)
      } as unknown as ShotPlanRepository,
      sceneRepository: {
        findById: vi.fn(async () => ({
          snapshot: () => ({
            id: sampleSceneId,
            campaignId: "campaign-1" as CampaignId,
            status: "approved",
            specRevision: 1,
            approvedShotPlanId: "shotplan-anchored",
            approvedShotPlanRevision: 1
          })
        }))
      } as unknown as SceneRepository
    });

    await expect(executor(job)).rejects.toThrow(
      /anchorCandidateId "different-cand-999" does not match injected approvedCandidateId "cand-1"/i
    );
  });

  it("fails closed and aggregates errors when staged reference image cleanup fails", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const mockOutputReader = {
      readOutput: vi.fn(async () => ({
        bytes: new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        contentType: "video/mp4"
      }))
    };

    const executeProfileRender = createMockExecuteProfileRender(["render_out.mp4"]);

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn(async (input) => ({
        manifestPayload: {
          renderProfile: candidate.key,
          renderProfileVersion: 1,
          engine: "minimax_h3_i2v",
          executionScope: "staging",
          configuredMedia: input.configuredMedia,
          measuredMedia: input.measuredMedia
        }
      }))
    };

    const failingStager = {
      stage: vi.fn(
        async (input: { filename: string; bytes: Uint8Array; contentType?: string }) => ({
          name: input.filename,
          subfolder: "inputs",
          type: "input" as const
        })
      ),
      cleanup: vi.fn(async () => {
        throw new Error("Disk unmount error during cleanup");
      })
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: failingStager,
      executeProfileRender,
      outputReader: mockOutputReader as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => createMockProber(192)),
      productionManifestAssembler: mockAssembler
    });

    await expect(executor(job)).rejects.toThrow(AggregateError);
  });

  it("fails closed when post-render media is not constant frame rate (CFR)", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const mockOutputReader = {
      readOutput: vi.fn(async () => ({
        bytes: new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        contentType: "video/mp4"
      }))
    };

    const executeProfileRender = createMockExecuteProfileRender(["render_out.mp4"]);

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn(async (input) => ({
        manifestPayload: {
          renderProfile: candidate.key,
          renderProfileVersion: 1,
          engine: "minimax_h3_i2v",
          executionScope: "staging",
          configuredMedia: input.configuredMedia,
          measuredMedia: input.measuredMedia
        }
      }))
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      executeProfileRender,
      outputReader: mockOutputReader as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => ({
        ...createMockProber(192),
        fps: null
      })),
      productionManifestAssembler: mockAssembler
    });

    await expect(executor(job)).rejects.toThrow(
      /Probed output fps null does not match candidate specification fps 24/i
    );
  });

  it("fails closed when post-render media duration diverges from nominal duration beyond tolerance", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const mockOutputReader = {
      readOutput: vi.fn(async () => ({
        bytes: new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        contentType: "video/mp4"
      }))
    };

    const executeProfileRender = createMockExecuteProfileRender(["render_out.mp4"]);

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn(async (input) => ({
        manifestPayload: {
          renderProfile: candidate.key,
          renderProfileVersion: 1,
          engine: "minimax_h3_i2v",
          executionScope: "staging",
          configuredMedia: input.configuredMedia,
          measuredMedia: input.measuredMedia
        }
      }))
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      executeProfileRender,
      outputReader: mockOutputReader as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => ({
        ...createMockProber(192),
        durationMs: 8500,
        formatDurationMs: 8500
      })),
      productionManifestAssembler: mockAssembler
    });

    await expect(executor(job)).rejects.toThrow(
      /Probed output duration 8500ms diverges from nominal duration 8000ms beyond tolerance/i
    );
  });

  it("fails closed when container format duration diverges from stream duration beyond tolerance", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockCandidateMedia = {
      media: {
        bucket: "review-bucket",
        key: "cand-1.png",
        sha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
        contentType: "image/png",
        byteLength: 29
      }
    };

    const mockOutputReader = {
      readOutput: vi.fn(async () => ({
        bytes: new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        contentType: "video/mp4"
      }))
    };

    const executeProfileRender = createMockExecuteProfileRender(["render_out.mp4"]);

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn(async (input) => ({
        manifestPayload: {
          renderProfile: candidate.key,
          renderProfileVersion: 1,
          engine: "minimax_h3_i2v",
          executionScope: "staging",
          configuredMedia: input.configuredMedia,
          measuredMedia: input.measuredMedia
        }
      }))
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: defaultShotPlanRepo,
      sceneRepository: defaultSceneRepo,
      resolveApprovedCandidateMedia: {
        execute: vi.fn(
          async () => mockCandidateMedia as unknown as ResolvedApprovedVisualProductionMedia
        )
      },
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      executeProfileRender,
      outputReader: mockOutputReader as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => ({
        ...createMockProber(192),
        durationMs: 8000,
        formatDurationMs: 8300
      })),
      productionManifestAssembler: mockAssembler
    });

    await expect(executor(job)).rejects.toThrow(
      /Probed container format duration 8300ms diverges from stream duration 8000ms beyond tolerance/i
    );
  });

  it("fails closed when candidate I2V job lacks required shotPlanId", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "i2v"
    });
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192);
    delete (job.injectedPayload as Record<string, unknown>).shotPlanId;

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService
    });

    await expect(executor(job)).rejects.toThrow(
      /injectedPayload\.shotPlanId is required for candidate frame-anchored execution/i
    );
  });

  it("successfully executes 192f candidate Ref2V profile render in operator staging", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "ref2v",
      turboLora: "minimax_h3_ref2va_turbo_4step.safetensors"
    });
    const refShotPlanId = "shotplan-ref2v-test" as ShotPlanId;
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192, {
      injectedPayload: {
        shotPlanId: refShotPlanId,
        specRevision: 1,
        approvedCandidateId: undefined
      }
    });

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockShotPlan = {
      snapshot: () => ({
        id: refShotPlanId,
        sceneId: sampleSceneId,
        status: "approved",
        specRevision: 1,
        routingMode: "reference_directed",
        targetDurationMs: 8000,
        beats: [],
        subjects: [],
        actionSummary: "Walking down a rainy street",
        framing: "wide",
        angle: "eye_level",
        lensIntent: "cinematic",
        cameraPosition: "front",
        cameraMovement: "tracking",
        movementSpeed: "normal",
        cameraPromptDescription: "smooth tracking shot",
        lightingStyle: "cinematic",
        environmentDescription: "neon street",
        continuity: { persistentSubjectIds: [] },
        references: [{ slotIndex: 1, referenceAssetId: "asset-1", role: "character" }]
      })
    };
    const mockScene = {
      snapshot: () => ({
        id: sampleSceneId,
        campaignId: "campaign-1" as CampaignId,
        status: "approved",
        specRevision: 1,
        approvedShotPlanId: refShotPlanId,
        approvedShotPlanRevision: 1,
        configuration: { prompt: "Rainy cyberpunk street" }
      })
    };
    const mockCampaign = {
      id: "campaign-1" as CampaignId,
      clientId: "client-1"
    };

    const mockRefAsset: ReferenceAsset = {
      id: "asset-1",
      clientId: "client-1",
      sceneId: sampleSceneId,
      storageBucket: "review-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
      mimeType: "image/png",
      width: 1344,
      height: 768
    } as unknown as ReferenceAsset;

    const mockBinding = {
      id: "binding-1",
      sceneId: sampleSceneId,
      specRevision: 1,
      referenceAssetId: "asset-1",
      slotIndex: 1,
      promptTag: "char_a",
      role: "character"
    };

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn(async (input) => ({
        manifestPayload: {
          renderProfile: candidate.key,
          renderProfileVersion: 1,
          engine: "minimax_h3_ref2v",
          executionScope: "staging",
          configuredMedia: input.configuredMedia,
          measuredMedia: input.measuredMedia
        }
      }))
    };

    const executeProfileRender = createMockExecuteProfileRender(["ref2v_out.mp4"]);
    const mockOutputReader = {
      readOutput: vi.fn(async () => ({
        bytes: new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]),
        contentType: "video/mp4"
      }))
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: {
        findById: vi.fn(async () => mockShotPlan as unknown as ShotPlan)
      } as unknown as ShotPlanRepository,
      sceneRepository: {
        findById: vi.fn(async () => mockScene as unknown as Scene)
      } as unknown as SceneRepository,
      campaignRepository: {
        findById: vi.fn(async () => mockCampaign)
      } as unknown as CampaignRepository<CampaignRecord>,
      referenceAssetRepository: {
        listBySceneId: vi.fn(async () => [mockRefAsset]),
        listBindingsBySceneId: vi.fn(async () => [mockBinding])
      } as unknown as ReferenceAssetRepository,
      objectStorage: createMockStorage() as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      imageValidator: {
        inspectAndValidate: vi.fn(async () => ({
          detectedMimeType: "image/png" as const,
          width: 1344,
          height: 768,
          byteLength: 8
        }))
      },
      executeProfileRender,
      outputReader: mockOutputReader as unknown as ComfyUiOutputReader,
      formatAwareProber: vi.fn(() => createMockProber(192)),
      productionManifestAssembler: mockAssembler
    });

    const result = await executor(job);
    expect(result.mediaObjects).toHaveLength(1);
    expect(result.manifestPayload).toBeDefined();
    const manifest = result.manifestPayload as unknown as GenerationManifest;
    expect(manifest.renderProfile).toBe(candidate.key);
    expect(manifest.executionScope).toBe("staging");
  });

  it("fails closed: Ref2V candidate execution rejects when reference asset clientId mismatches campaign", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "ref2v",
      turboLora: "minimax_h3_ref2va_turbo_4step.safetensors"
    });
    const refShotPlanId = "shotplan-ref2v-test" as ShotPlanId;
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192, {
      injectedPayload: {
        shotPlanId: refShotPlanId,
        specRevision: 1,
        approvedCandidateId: undefined
      }
    });

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockShotPlan = {
      snapshot: () => ({
        id: refShotPlanId,
        sceneId: sampleSceneId,
        status: "approved",
        specRevision: 1,
        routingMode: "reference_directed",
        targetDurationMs: 8000,
        beats: [],
        subjects: [],
        actionSummary: "Walking down a rainy street",
        framing: "wide",
        angle: "eye_level",
        lensIntent: "cinematic",
        cameraPosition: "front",
        cameraMovement: "tracking",
        movementSpeed: "normal",
        cameraPromptDescription: "smooth tracking shot",
        lightingStyle: "cinematic",
        environmentDescription: "neon street",
        continuity: { persistentSubjectIds: [] },
        references: [{ slotIndex: 1, referenceAssetId: "asset-1", role: "character" }]
      })
    };
    const mockScene = {
      snapshot: () => ({
        id: sampleSceneId,
        campaignId: "campaign-1" as CampaignId,
        status: "approved",
        specRevision: 1,
        approvedShotPlanId: refShotPlanId,
        approvedShotPlanRevision: 1,
        configuration: { prompt: "Rainy cyberpunk street" }
      })
    };
    const mockCampaign = {
      id: "campaign-1" as CampaignId,
      clientId: "client-1"
    };

    const mismatchedAsset: ReferenceAsset = {
      id: "asset-1",
      clientId: "wrong-client-2",
      sceneId: sampleSceneId,
      storageBucket: "review-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
      mimeType: "image/png",
      width: 1344,
      height: 768
    } as unknown as ReferenceAsset;

    const mockBinding = {
      id: "binding-1",
      sceneId: sampleSceneId,
      specRevision: 1,
      referenceAssetId: "asset-1",
      slotIndex: 1,
      promptTag: "char_a",
      role: "character"
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: {
        findById: vi.fn(async () => mockShotPlan as unknown as ShotPlan)
      } as unknown as ShotPlanRepository,
      sceneRepository: {
        findById: vi.fn(async () => mockScene as unknown as Scene)
      } as unknown as SceneRepository,
      campaignRepository: {
        findById: vi.fn(async () => mockCampaign)
      } as unknown as CampaignRepository<CampaignRecord>,
      referenceAssetRepository: {
        listBySceneId: vi.fn(async () => [mismatchedAsset]),
        listBindingsBySceneId: vi.fn(async () => [mockBinding])
      } as unknown as ReferenceAssetRepository
    });

    await expect(executor(job)).rejects.toThrow(
      /belongs to client "wrong-client-2", expected "client-1"/i
    );
  });

  it("fails closed: Ref2V candidate execution rejects when reference image buffer is too small (< 8 bytes)", async () => {
    const { candidate, rawWorkflow, provenanceReport } = createCandidateFixture({
      frames: 192,
      route: "ref2v",
      turboLora: "minimax_h3_ref2va_turbo_4step.safetensors"
    });
    const refShotPlanId = "shotplan-ref2v-test" as ShotPlanId;
    const job = createStagingJob(candidate.key, candidate.specificationDigest, 192, {
      injectedPayload: {
        shotPlanId: refShotPlanId,
        specRevision: 1,
        approvedCandidateId: undefined
      }
    });

    const mockRegistryReader: H3CandidateRegistryReader = {
      getCandidateProfile: vi.fn(() => candidate),
      listCandidateProfiles: vi.fn(() => [candidate]),
      isCandidateProfileKey: vi.fn(() => true)
    };

    const mockShotPlan = {
      snapshot: () => ({
        id: refShotPlanId,
        sceneId: sampleSceneId,
        status: "approved",
        specRevision: 1,
        routingMode: "reference_directed",
        targetDurationMs: 8000,
        beats: [],
        subjects: [],
        actionSummary: "Walking down a rainy street",
        framing: "wide",
        angle: "eye_level",
        lensIntent: "cinematic",
        cameraPosition: "front",
        cameraMovement: "tracking",
        movementSpeed: "normal",
        cameraPromptDescription: "smooth tracking shot",
        lightingStyle: "cinematic",
        environmentDescription: "neon street",
        continuity: { persistentSubjectIds: [] },
        references: [{ slotIndex: 1, referenceAssetId: "asset-1", role: "character" }]
      })
    };
    const mockScene = {
      snapshot: () => ({
        id: sampleSceneId,
        campaignId: "campaign-1" as CampaignId,
        status: "approved",
        specRevision: 1,
        approvedShotPlanId: refShotPlanId,
        approvedShotPlanRevision: 1,
        configuration: { prompt: "Rainy cyberpunk street" }
      })
    };
    const mockCampaign = {
      id: "campaign-1" as CampaignId,
      clientId: "client-1"
    };

    const mockAsset: ReferenceAsset = {
      id: "asset-1",
      clientId: "client-1",
      sceneId: sampleSceneId,
      storageBucket: "review-bucket",
      storageObjectKey: "assets/ref1.png",
      contentHashSha256: "8edf5e831cfe5a2f7f44038fdda1ca671bf7af52efe4af30035668c47e83186a",
      mimeType: "image/png",
      width: 1344,
      height: 768
    } as unknown as ReferenceAsset;

    const mockBinding = {
      id: "binding-1",
      sceneId: sampleSceneId,
      specRevision: 1,
      referenceAssetId: "asset-1",
      slotIndex: 1,
      promptTag: "char_a",
      role: "character"
    };

    const tinyStorage = {
      getObject: vi.fn(async () => ({
        body: new Uint8Array([1, 2, 3]),
        contentLength: 3,
        contentType: "image/png"
      })),
      putObject: vi.fn(async () => {})
    };

    const executor = createCertifiedRenderJobExecutor({
      targetGpuUuid: DEFAULT_TARGET_GPU_UUID,
      registryReader: mockRegistryReader,
      readApprovedProvenance: vi.fn(async () => provenanceReport),
      readWorkflowFile: vi.fn(async () => rawWorkflow),
      authorizationPort: defaultAuthPort,
      eligibilityService: defaultEligibilityService,
      shotPlanRepository: {
        findById: vi.fn(async () => mockShotPlan as unknown as ShotPlan)
      } as unknown as ShotPlanRepository,
      sceneRepository: {
        findById: vi.fn(async () => mockScene as unknown as Scene)
      } as unknown as SceneRepository,
      campaignRepository: {
        findById: vi.fn(async () => mockCampaign)
      } as unknown as CampaignRepository<CampaignRecord>,
      referenceAssetRepository: {
        listBySceneId: vi.fn(async () => [mockAsset]),
        listBindingsBySceneId: vi.fn(async () => [mockBinding])
      } as unknown as ReferenceAssetRepository,
      objectStorage: tinyStorage as unknown as ObjectStoragePort,
      stageReferenceImage: createMockStager(),
      imageValidator: {
        inspectAndValidate: vi.fn(async () => ({
          detectedMimeType: "image/png" as const,
          width: 1344,
          height: 768,
          byteLength: 8
        }))
      }
    });

    await expect(executor(job)).rejects.toThrow(ReferenceImageIntegrityError);
    await expect(executor(job)).rejects.toThrow(/buffer is too small to be a valid image/i);
  });
});
