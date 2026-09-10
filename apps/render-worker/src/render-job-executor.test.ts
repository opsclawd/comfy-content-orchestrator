import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { LTX_FPS } from "@cco/contracts";
import {
  ApprovedCandidateMediaHashMismatchError,
  AssembleGenerationManifest,
  type ComfyUiInputStagingPort,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type HashBytesPort,
  LicenseRoutingError,
  type EnforceLicenseRouting,
  type ObjectStoragePort,
  type ProfileRenderIdentity,
  type ReferenceAssetRepository,
  type ResolvedApprovedVisualProductionMedia,
  type SceneRepository,
  type StagedComfyUiInput,
  type StoryboardCandidateRepository
} from "@cco/application";
import {
  Scene,
  type CampaignId,
  type CandidateId,
  type JobId,
  type LeaseToken,
  type RenderJob,
  type SceneId,
  type StoryboardCandidate
} from "@cco/domain";
import type {
  CertificationProfile,
  CertificationProvenanceReport,
  ComfyUiOutput,
  ComfyUiOutputReader
} from "@cco/infrastructure";
import { PreflightError } from "./certification/preflight.js";
import {
  buildDeterministicStagingFilename,
  CandidateOutputCardinalityError,
  createCertifiedRenderJobExecutor,
  MissingApprovedCandidateForConditioningError,
  MissingCertifiedProfileError,
  MissingProfileTopologyError,
  mutateWorkflow,
  ProductionManifestAssemblyError,
  ReferenceImageInjectionInvariantError,
  ReferenceImageIntegrityError,
  ReferenceImageStagingError,
  RenderJobExecutionError,
  RenderJobPayloadValidationError,
  WorkflowHashMismatchError,
  type AssembleProductionManifestInput,
  type ProductionManifestAssembler
} from "./render-job-executor.js";

const DEFAULT_REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
const sampleJobId = "11111111-1111-4111-8111-111111111111" as JobId;
const sampleSceneId = "22222222-2222-4222-8222-222222222222" as SceneId;
const sampleLeaseToken = "33333333-3333-4333-8333-333333333333" as LeaseToken;

const sampleWorkflowHash = "af8528239790f6536ce7f0733f92095501fecfd8e919084a9decdded59e6ecf5";
const sampleLtxWorkflowHash = "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539";

const fakeFluxProfile: CertificationProfile = {
  id: "flux-schnell-draft",
  engine: "flux_schnell",
  workflowPath: "/templates/flux_schnell_draft_api.json",
  workflowRelativePath: "flux_schnell_draft_api.json",
  expectedWorkflowHash: sampleWorkflowHash,
  source: {
    kind: "validated_host_export",
    uri: "https://github.com/comfyanonymous/ComfyUI",
    revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    license: "GPL-3.0"
  },
  baseline: {
    width: 1024,
    height: 1024,
    steps: 4,
    frames: 1
  },
  minFreeDiskGb: 0,
  runnerProfile: "dynamicvram-offload-v1",
  models: [
    { category: "diffusion_models", relativePath: "flux1-schnell.safetensors" },
    { category: "clip", relativePath: "t5xxl_fp8_e4m3fn.safetensors" },
    { category: "clip", relativePath: "clip_l.safetensors" },
    { category: "vae", relativePath: "ae.safetensors" }
  ],
  assertions: [
    { nodeId: "1", classType: "KSampler", input: "steps", equals: 4 },
    { nodeId: "5", classType: "EmptyLatentImage", input: "width", equals: 1024 },
    { nodeId: "5", classType: "EmptyLatentImage", input: "height", equals: 1024 }
  ],
  renderProfileIdentity: {
    key: "FLUX_SCHNELL_DRAFT_V1",
    version: 1
  }
};

const fakeLtxProfile: CertificationProfile = {
  id: "ltx-25-720p-97f",
  engine: "ltx_25",
  workflowPath: "/templates/ltx_25_720p_97f_api.json",
  workflowRelativePath: "ltx_25_720p_97f_api.json",
  expectedWorkflowHash: sampleLtxWorkflowHash,
  source: {
    kind: "validated_host_export",
    uri: "https://github.com/comfyanonymous/ComfyUI",
    revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    license: "GPL-3.0"
  },
  baseline: {
    width: 1280,
    height: 720,
    frames: 97,
    steps: 8,
    approximateDurationSeconds: 5
  },
  minFreeDiskGb: 100,
  runnerProfile: "dynamicvram-offload-v1",
  models: [
    {
      category: "diffusion_models",
      relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
    },
    {
      category: "clip",
      relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
    },
    { category: "vae", relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors" }
  ],
  assertions: [
    { nodeId: "1", classType: "KSampler", input: "steps", equals: 8 },
    { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "width", equals: 1280 },
    { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "height", equals: 720 },
    { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "length", equals: 97 }
  ],
  renderProfileIdentity: {
    key: "LTX_25_720P_5S_V1",
    version: 1
  }
};

const fakeRawFluxWorkflow = JSON.stringify({
  "1": {
    inputs: {
      seed: 42,
      steps: 4,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1,
      model: ["2", 0],
      positive: ["3", 0],
      negative: ["4", 0],
      latent_image: ["5", 0]
    },
    class_type: "KSampler"
  },
  "2": {
    inputs: { unet_name: "flux1-schnell.safetensors" },
    class_type: "UNETLoader"
  },
  "3": {
    inputs: { text: "default prompt", clip: ["7", 0] },
    class_type: "CLIPTextEncode"
  },
  "4": {
    inputs: { text: "default negative", clip: ["7", 0] },
    class_type: "CLIPTextEncode"
  },
  "5": {
    inputs: { width: 1024, height: 1024, batch_size: 1 },
    class_type: "EmptyLatentImage"
  }
});

const fakeFluxLiveProvenance: CertificationProvenanceReport = {
  version: 1,
  profileId: "flux-schnell-draft",
  generatedAt: "2026-08-27T00:00:00.000Z",
  models: [],
  disk: {
    modelFootprintBytes: 0,
    availableBytes: 100_000_000_000,
    requiredFreeBytes: 0,
    modelFootprintGb: 0,
    availableGb: 100,
    minFreeDiskGb: 0,
    passes: true
  },
  git: {
    comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNodes: []
  },
  workflow: {
    relativePath: "flux_schnell_draft_api.json",
    sha256: sampleWorkflowHash,
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }
  },
  renderProfileProvenance: {
    key: "FLUX_SCHNELL_DRAFT_V1",
    version: 1,
    engine: "flux_schnell",
    workflowHash: sampleWorkflowHash,
    frames: 1,
    steps: 4,
    runnerProfile: "dynamicvram-offload-v1",
    measuredDiskFootprintGb: 10,
    minFreeDiskGb: 0,
    modelHashes: {
      "diffusion_models/flux1-schnell.safetensors": "a".repeat(64),
      "clip/t5xxl_fp8_e4m3fn.safetensors": "b".repeat(64),
      "clip/clip_l.safetensors": "c".repeat(64),
      "vae/ae.safetensors": "d".repeat(64)
    }
  }
};

const fakeLtxLiveProvenance: CertificationProvenanceReport = {
  version: 1,
  profileId: "ltx-25-720p-97f",
  generatedAt: "2026-08-27T00:00:00.000Z",
  models: [],
  disk: {
    modelFootprintBytes: 0,
    availableBytes: 100_000_000_000,
    requiredFreeBytes: 0,
    modelFootprintGb: 0,
    availableGb: 100,
    minFreeDiskGb: 100,
    passes: true
  },
  git: {
    comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNodes: []
  },
  workflow: {
    relativePath: "ltx_25_720p_97f_api.json",
    sha256: sampleLtxWorkflowHash,
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }
  },
  renderProfileProvenance: {
    key: "LTX_25_720P_5S_V1",
    version: 1,
    engine: "ltx_25",
    workflowHash: sampleLtxWorkflowHash,
    frames: 97,
    steps: 8,
    runnerProfile: "dynamicvram-offload-v1",
    measuredDiskFootprintGb: 20,
    minFreeDiskGb: 100,
    modelHashes: {
      "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors":
        "e".repeat(64),
      "clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors": "f".repeat(64),
      "vae/ltx-2.5-video-vae-conv-bf16.safetensors": "a".repeat(64)
    }
  }
};

const sampleLtxI2vWorkflowHash = "84f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf540";

const fakeLtxI2vProfile: CertificationProfile = {
  id: "ltx-25-720p-97f-i2v",
  engine: "ltx_25_i2v",
  workflowPath: "/templates/ltx_25_720p_i2v_97f_api.json",
  workflowRelativePath: "ltx_25_720p_i2v_97f_api.json",
  expectedWorkflowHash: sampleLtxI2vWorkflowHash,
  source: {
    kind: "validated_host_export",
    uri: "https://github.com/comfyanonymous/ComfyUI",
    revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    license: "GPL-3.0"
  },
  baseline: {
    width: 1280,
    height: 720,
    frames: 97,
    steps: 8,
    approximateDurationSeconds: 5
  },
  minFreeDiskGb: 100,
  runnerProfile: "dynamicvram-offload-v1",
  models: [
    {
      category: "diffusion_models",
      relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
    },
    {
      category: "clip",
      relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
    },
    { category: "vae", relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors" }
  ],
  assertions: [
    { nodeId: "1", classType: "KSampler", input: "steps", equals: 8 },
    { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "width", equals: 1280 },
    { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "height", equals: 720 },
    { nodeId: "5", classType: "EmptyLTXVLatentVideo", input: "length", equals: 97 }
  ],
  renderProfileIdentity: {
    key: "LTX_25_720P_5S_I2V_V1",
    version: 1
  }
};

const fakeRawLtxI2vWorkflow = JSON.stringify({
  "1": {
    inputs: {
      seed: 42,
      steps: 8,
      cfg: 1,
      sampler_name: "euler",
      scheduler: "simple",
      denoise: 1
    },
    class_type: "KSampler"
  },
  "3": {
    inputs: { text: "positive prompt" },
    class_type: "CLIPTextEncode"
  },
  "4": {
    inputs: { text: "negative prompt" },
    class_type: "CLIPTextEncode"
  },
  "5": {
    inputs: {
      width: 1280,
      height: 720,
      length: 97,
      batch_size: 1
    },
    class_type: "EmptyLTXVLatentVideo"
  },
  "20": {
    inputs: {
      image: "reference_frame.png",
      upload: "image"
    },
    class_type: "LoadImage"
  }
});

const fakeLtxI2vLiveProvenance: CertificationProvenanceReport = {
  version: 1,
  profileId: "ltx-25-720p-97f-i2v",
  generatedAt: "2026-08-27T00:00:00.000Z",
  models: [],
  disk: {
    modelFootprintBytes: 0,
    availableBytes: 100_000_000_000,
    requiredFreeBytes: 0,
    modelFootprintGb: 0,
    availableGb: 100,
    minFreeDiskGb: 100,
    passes: true
  },
  git: {
    comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
    customNodes: []
  },
  workflow: {
    relativePath: "ltx_25_720p_i2v_97f_api.json",
    sha256: sampleLtxI2vWorkflowHash,
    source: {
      kind: "validated_host_export",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      license: "GPL-3.0"
    }
  },
  renderProfileProvenance: {
    key: "LTX_25_720P_5S_I2V_V1",
    version: 1,
    engine: "ltx_25_i2v",
    workflowHash: sampleLtxI2vWorkflowHash,
    frames: 97,
    steps: 8,
    runnerProfile: "dynamicvram-offload-v1",
    measuredDiskFootprintGb: 20,
    minFreeDiskGb: 100,
    modelHashes: {
      "diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors":
        "e".repeat(64),
      "clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors": "f".repeat(64),
      "vae/ltx-2.5-video-vae-conv-bf16.safetensors": "a".repeat(64)
    }
  }
};

function createSampleCandidateJob(overrides?: Partial<RenderJob>): RenderJob {
  return {
    jobId: sampleJobId,
    sceneId: sampleSceneId,
    jobKind: "candidate",
    status: "leased",
    workflowTemplate: "flux-schnell-draft",
    injectedPayload: {
      prompt: "cinematic sunset",
      negativePrompt: "blurry, dark",
      seed: 99999,
      variantOrdinal: 1
    },
    workerId: "worker-1",
    leaseToken: sampleLeaseToken,
    leaseExpiresAt: new Date("2026-08-27T10:00:00.000Z"),
    retryCount: 0,
    maxRetries: 3,
    errorTrace: null,
    createdAt: new Date("2026-08-27T08:00:00.000Z"),
    updatedAt: new Date("2026-08-27T08:00:00.000Z"),
    ...overrides
  };
}

function createSampleProductionJob(overrides?: Partial<RenderJob>): RenderJob {
  return {
    jobId: sampleJobId,
    sceneId: sampleSceneId,
    jobKind: "production",
    status: "leased",
    workflowTemplate: "ltx-25-720p-97f",
    injectedPayload: {
      prompt: "high quality aerial footage",
      negativePrompt: "jittery, artifacts",
      seed: 12345
    },
    workerId: "worker-1",
    leaseToken: sampleLeaseToken,
    leaseExpiresAt: new Date("2026-08-27T10:00:00.000Z"),
    retryCount: 0,
    maxRetries: 3,
    errorTrace: null,
    createdAt: new Date("2026-08-27T08:00:00.000Z"),
    updatedAt: new Date("2026-08-27T08:00:00.000Z"),
    ...overrides
  };
}

class FakeOutputReader implements ComfyUiOutputReader {
  readonly readCalls: string[] = [];
  constructor(
    private readonly outputMap: Map<string, ComfyUiOutput> = new Map([
      ["flux_schnell_00001_.png", { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" }]
    ])
  ) {}

  async readOutput(outputObjectKey: string): Promise<ComfyUiOutput> {
    this.readCalls.push(outputObjectKey);
    const output = this.outputMap.get(outputObjectKey);
    if (!output) {
      throw new Error(`Output not found: ${outputObjectKey}`);
    }
    return output;
  }
}

describe("Certified Render Job Executor", () => {
  it("injects only approved workflow fields and executes the certified profile once", async () => {
    const job = createSampleCandidateJob();
    const executeCalls: ExecuteProfileRenderInput[] = [];

    const mockExecuteProfileRender = vi
      .fn()
      .mockImplementation(
        async (input: ExecuteProfileRenderInput): Promise<ExecuteProfileRenderResult> => {
          executeCalls.push(input);
          return {
            status: "succeeded",
            promptId: "prompt-12345",
            outputObjectKeys: ["flux_schnell_00001_.png"],
            durationMs: 4200,
            profile: input.identity,
            preDispatchGpu: {
              totalVramMb: 24576,
              usedVramMb: 4096,
              freeVramMb: 20480,
              reservedVramMb: 4096,
              measuredAt: new Date().toISOString()
            }
          };
        }
      );

    const outputReader = new FakeOutputReader();

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    const output = await executor(job);

    expect(mockExecuteProfileRender).toHaveBeenCalledTimes(1);
    expect(executeCalls).toHaveLength(1);

    const executedCall = executeCalls[0]!;
    expect(executedCall.renderJobId).toBe(job.jobId);
    expect(executedCall.sceneId).toBe(job.sceneId);

    // Verify injected prompt/negativePrompt/seed
    const mutatedWorkflow = executedCall.workflow as Record<
      string,
      { inputs: Record<string, unknown>; class_type: string }
    >;
    expect(mutatedWorkflow["3"]?.inputs.text).toBe("cinematic sunset");
    expect(mutatedWorkflow["4"]?.inputs.text).toBe("blurry, dark");
    expect(mutatedWorkflow["1"]?.inputs.seed).toBe(99999);
    // Verify steps and other template fields remain unchanged
    expect(mutatedWorkflow["1"]?.inputs.steps).toBe(4);

    // Verify identity construction
    expect(executedCall.identity).toEqual<ProfileRenderIdentity>({
      profileId: "flux-schnell-draft",
      renderProfileKey: "FLUX_SCHNELL_DRAFT_V1",
      renderProfileVersion: 1,
      engine: "flux_schnell",
      workflowSha256: sampleWorkflowHash,
      modelSha256: fakeFluxLiveProvenance.renderProfileProvenance!.modelHashes,
      runnerProfile: "dynamicvram-offload-v1",
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
    });

    // Verify output structure
    expect(output.mediaObjects).toHaveLength(1);
    expect(output.candidatePayload).toBeDefined();
    expect(output.candidatePayload?.variantOrdinal).toBe(1);
  });

  it("rejects unknown injected fields before render dispatch", async () => {
    const mockExecuteProfileRender = vi.fn();
    const outputReader = new FakeOutputReader();

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    // 1. Unknown injected property
    const jobWithUnknown = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid prompt",
        variantOrdinal: 1,
        unapprovedField: "malicious-injection"
      }
    });

    await expect(executor(jobWithUnknown)).rejects.toThrow(RenderJobPayloadValidationError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 2. Invalid type for prompt
    const jobWithInvalidPrompt = createSampleCandidateJob({
      injectedPayload: {
        prompt: 12345 as unknown as string,
        variantOrdinal: 1
      }
    });
    await expect(executor(jobWithInvalidPrompt)).rejects.toThrow(RenderJobPayloadValidationError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 3. Invalid type for seed (float or non-integer)
    const jobWithInvalidSeed = createSampleCandidateJob({
      injectedPayload: {
        seed: 12.34,
        variantOrdinal: 1
      }
    });
    await expect(executor(jobWithInvalidSeed)).rejects.toThrow(RenderJobPayloadValidationError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 4. Variant ordinal in a production job (candidate-only)
    const productionJobWithVariant = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        variantOrdinal: 1
      }
    });
    await expect(executor(productionJobWithVariant)).rejects.toThrow(
      "variantOrdinal is candidate-only and not allowed in production jobs"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 5. audioPrompt in a candidate job (production-only)
    const candidateJobWithAudio = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid",
        variantOrdinal: 1,
        audioPrompt: "music"
      }
    });
    await expect(executor(candidateJobWithAudio)).rejects.toThrow(
      "audioPrompt is production-only and not allowed in candidate jobs"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 6. approvedCandidateId in a candidate job (production-only)
    const candidateJobWithApprovedId = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid",
        variantOrdinal: 1,
        approvedCandidateId: "cand-123"
      }
    });
    await expect(executor(candidateJobWithApprovedId)).rejects.toThrow(
      "approvedCandidateId is production-only and not allowed in candidate jobs"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 6b. frameCount in a candidate job (production-only)
    const candidateJobWithFrameCount = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid",
        variantOrdinal: 1,
        frameCount: 57
      }
    });
    await expect(executor(candidateJobWithFrameCount)).rejects.toThrow(
      "frameCount is production-only and not allowed in candidate jobs"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 6c. Invalid frameCount in production job
    const prodJobWithFloatFrameCount = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        frameCount: 57.5
      }
    });
    await expect(executor(prodJobWithFloatFrameCount)).rejects.toThrow(
      "injectedPayload.frameCount must be a safe integer"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    const prodJobWithInvalidTemporalFrameCount18 = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        frameCount: 18
      }
    });
    await expect(executor(prodJobWithInvalidTemporalFrameCount18)).rejects.toThrow(
      "injectedPayload.frameCount must satisfy (frameCount - 1) % 8 === 0"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    const prodJobWithInvalidTemporalFrameCount100 = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        frameCount: 100
      }
    });
    await expect(executor(prodJobWithInvalidTemporalFrameCount100)).rejects.toThrow(
      "injectedPayload.frameCount must satisfy (frameCount - 1) % 8 === 0"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    const prodJobWithOutOfRangeFrameCount = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        frameCount: 105
      }
    });
    await expect(executor(prodJobWithOutOfRangeFrameCount)).rejects.toThrow(
      "injectedPayload.frameCount must be a safe integer between 97 and 97"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 6d. frameCount against a profile whose topology does not support frameCount (Finding 4)
    const fluxProdJobWithFrameCount = createSampleProductionJob({
      workflowTemplate: "flux-schnell-draft",
      injectedPayload: {
        prompt: "valid",
        frameCount: 97
      }
    });
    const fluxExecutor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader: new FakeOutputReader(),
      productionManifestAssembler: { assembleManifest: async () => ({}) }
    });
    await expect(fluxExecutor(fluxProdJobWithFrameCount)).rejects.toThrow(
      'Profile "flux-schnell-draft" does not support frame-count injection: frameCount is not supported'
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 7. Empty audioPrompt in production job
    const prodJobWithEmptyAudio = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        audioPrompt: "   "
      }
    });
    await expect(executor(prodJobWithEmptyAudio)).rejects.toThrow(
      "injectedPayload.audioPrompt must be a non-empty string"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 8. Empty approvedCandidateId in production job
    const prodJobWithEmptyApprovedId = createSampleProductionJob({
      injectedPayload: {
        prompt: "valid",
        approvedCandidateId: "   "
      }
    });
    await expect(executor(prodJobWithEmptyApprovedId)).rejects.toThrow(
      "injectedPayload.approvedCandidateId must be a non-empty string"
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();
  });

  it("requires one candidate output and a positive variant ordinal", async () => {
    const mockExecuteProfileRender = vi.fn();
    const outputReader = new FakeOutputReader();

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    // 1. Missing variantOrdinal in candidate job
    const jobMissingOrdinal = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid prompt"
      }
    });
    await expect(executor(jobMissingOrdinal)).rejects.toThrow(RenderJobPayloadValidationError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 2. Non-positive variantOrdinal (e.g. 0)
    const jobZeroOrdinal = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid prompt",
        variantOrdinal: 0
      }
    });
    await expect(executor(jobZeroOrdinal)).rejects.toThrow(RenderJobPayloadValidationError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 3. Negative variantOrdinal
    const jobNegativeOrdinal = createSampleCandidateJob({
      injectedPayload: {
        prompt: "valid prompt",
        variantOrdinal: -5
      }
    });
    await expect(executor(jobNegativeOrdinal)).rejects.toThrow(RenderJobPayloadValidationError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 4. Zero outputs from render execution
    mockExecuteProfileRender.mockResolvedValueOnce({
      status: "succeeded",
      promptId: "prompt-1",
      outputObjectKeys: [],
      durationMs: 1000,
      profile: {} as ProfileRenderIdentity,
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      }
    });
    const jobWithValidOrdinal = createSampleCandidateJob({
      injectedPayload: { variantOrdinal: 1 }
    });
    await expect(executor(jobWithValidOrdinal)).rejects.toThrow(CandidateOutputCardinalityError);

    // 5. Multiple outputs from candidate render execution
    mockExecuteProfileRender.mockResolvedValueOnce({
      status: "succeeded",
      promptId: "prompt-2",
      outputObjectKeys: ["out1.png", "out2.png"],
      durationMs: 1000,
      profile: {} as ProfileRenderIdentity,
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      }
    });
    await expect(executor(jobWithValidOrdinal)).rejects.toThrow(CandidateOutputCardinalityError);
  });

  it("hashes exact output bytes into deterministic upload and candidate payloads", async () => {
    const rawBytes = new Uint8Array([72, 101, 108, 108, 111, 32, 67, 111, 109, 102, 121]); // "Hello Comfy"
    const expectedHash = createHash("sha256").update(rawBytes).digest("hex");

    const outputReader = new FakeOutputReader(
      new Map([["out_001.png", { bytes: rawBytes, contentType: "image/png" }]])
    );

    const mockExecuteProfileRender = vi.fn().mockResolvedValue({
      status: "succeeded",
      promptId: "comfy-prompt-999",
      outputObjectKeys: ["out_001.png"],
      durationMs: 2500,
      profile: {
        profileId: "flux-schnell-draft",
        renderProfileKey: "FLUX_SCHNELL_DRAFT_V1",
        renderProfileVersion: 1,
        engine: "flux_schnell",
        workflowSha256: sampleWorkflowHash,
        modelSha256: fakeFluxLiveProvenance.renderProfileProvenance!.modelHashes,
        runnerProfile: "dynamicvram-offload-v1",
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      }
    });

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    const job = createSampleCandidateJob({
      leaseToken: "lease-token-alpha" as LeaseToken
    });

    const result = await executor(job);

    // Verify output was read exactly once
    expect(outputReader.readCalls).toEqual(["out_001.png"]);

    // Verify mediaObjects
    expect(result.mediaObjects).toHaveLength(1);
    const media = result.mediaObjects![0]!;
    expect(media.body).toBe(rawBytes);
    expect(media.checksumSha256).toBe(expectedHash);
    expect(media.contentType).toBe("image/png");
    expect(media.bucket).toBe("godzspeed-review");

    // Object key is deterministic and lease-token independent
    expect(media.key).toContain(job.sceneId);
    expect(media.key).toContain(job.jobId);
    expect(media.key).toContain("out_001.png");
    expect(media.key).toContain(expectedHash.slice(0, 16));
    expect(media.key).not.toContain("lease-token-alpha");

    // Same key with different lease token
    const jobWithDifferentLease = createSampleCandidateJob({
      leaseToken: "lease-token-beta" as LeaseToken
    });
    const result2 = await executor(jobWithDifferentLease);
    expect(result2.mediaObjects![0]!.key).toBe(media.key);

    // Verify candidatePayload matches upload object
    expect(result.candidatePayload).toEqual({
      variantOrdinal: 1,
      storageBucket: media.bucket,
      storageObjectKey: media.key,
      contentHashSha256: expectedHash,
      generationPayload: {
        promptIdComfy: "comfy-prompt-999",
        profile: {
          profileId: "flux-schnell-draft",
          renderProfileKey: "FLUX_SCHNELL_DRAFT_V1",
          renderProfileVersion: 1,
          engine: "flux_schnell",
          workflowSha256: sampleWorkflowHash,
          modelSha256: fakeFluxLiveProvenance.renderProfileProvenance!.modelHashes,
          runnerProfile: "dynamicvram-offload-v1",
          comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
        },
        originalOutputKey: "out_001.png"
      }
    });

    // Verify no raw bytes or lease token in generationPayload
    const genPayloadStr = JSON.stringify(result.candidatePayload?.generationPayload);
    expect(genPayloadStr).not.toContain("lease-token");
    expect(result.candidatePayload?.generationPayload).not.toHaveProperty("bytes");
  });

  it("requires the production manifest assembler result without a partial fallback", async () => {
    const rawBytes = new Uint8Array([5, 6, 7, 8]);
    const outputReader = new FakeOutputReader(
      new Map([["ltx_00001_.webp", { bytes: rawBytes, contentType: "image/webp" }]])
    );

    const mockExecuteProfileRender = vi.fn().mockResolvedValue({
      status: "succeeded",
      promptId: "ltx-prompt-456",
      outputObjectKeys: ["ltx_00001_.webp"],
      durationMs: 8500,
      profile: {
        profileId: "ltx-25-720p-97f",
        renderProfileKey: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        engine: "ltx_25",
        workflowSha256: sampleLtxWorkflowHash,
        modelSha256: fakeLtxLiveProvenance.renderProfileProvenance!.modelHashes,
        runnerProfile: "dynamicvram-offload-v1",
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      }
    });

    const expectedManifest = Object.freeze({
      manifestVersion: 1,
      jobId: sampleJobId,
      sceneId: sampleSceneId,
      engine: "ltx_25",
      renderProfileKey: "LTX_25_720P_5S_V1",
      durationMs: 8500
    });

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn().mockResolvedValue(expectedManifest)
    };

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeLtxProfile,
      readApprovedProvenance: async () => fakeLtxLiveProvenance,
      collectCertificationProvenance: async () => fakeLtxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => fakeLtxProfile.expectedWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader,
      productionManifestAssembler: mockAssembler
    });

    const job = createSampleProductionJob();
    const result = await executor(job);

    expect(mockAssembler.assembleManifest).toHaveBeenCalledTimes(1);
    expect(result.manifestPayload).toEqual(expectedManifest);
    expect(result.mediaObjects).toHaveLength(1);
    expect(result.mediaObjects![0]!.bucket).toBe("godzspeed-delivery");

    // Case 2: Missing assembler in production job must throw, not fallback to {}
    const executorNoAssembler = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeLtxProfile,
      readApprovedProvenance: async () => fakeLtxLiveProvenance,
      collectCertificationProvenance: async () => fakeLtxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => fakeLtxProfile.expectedWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    await expect(executorNoAssembler(job)).rejects.toThrow(ProductionManifestAssemblyError);

    // Case 3: Assembler returning empty object {} must throw
    const emptyAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn().mockResolvedValue({})
    };
    const executorEmptyAssembler = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeLtxProfile,
      readApprovedProvenance: async () => fakeLtxLiveProvenance,
      collectCertificationProvenance: async () => fakeLtxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => fakeLtxProfile.expectedWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader,
      productionManifestAssembler: emptyAssembler
    });

    await expect(executorEmptyAssembler(job)).rejects.toThrow(ProductionManifestAssemblyError);
  });

  it("supports candidate (flux) followed by production (ltx) rendering on the same executor instance with multi-profile collection provenance", async () => {
    const candidateJob = createSampleCandidateJob();
    const productionJob = createSampleProductionJob();

    const executeCalls: ExecuteProfileRenderInput[] = [];
    const mockExecuteProfileRender = vi
      .fn()
      .mockImplementation(
        async (input: ExecuteProfileRenderInput): Promise<ExecuteProfileRenderResult> => {
          executeCalls.push(input);
          const isFlux = input.identity.engine === "flux_schnell";
          return {
            status: "succeeded",
            promptId: isFlux ? "prompt-cand-123" : "prompt-prod-456",
            outputObjectKeys: isFlux ? ["flux_schnell_00001_.png"] : ["output_main.mp4"],
            durationMs: isFlux ? 3200 : 8500,
            profile: input.identity,
            preDispatchGpu: {
              totalVramMb: 24576,
              usedVramMb: 4096,
              freeVramMb: 20480,
              reservedVramMb: 4096,
              measuredAt: new Date().toISOString()
            }
          };
        }
      );

    const outputReader = new FakeOutputReader(
      new Map([
        [
          "flux_schnell_00001_.png",
          { bytes: new Uint8Array([1, 2, 3, 4]), contentType: "image/png" }
        ],
        ["output_main.mp4", { bytes: new Uint8Array([5, 6, 7, 8]), contentType: "video/mp4" }]
      ])
    );

    const expectedManifest = Object.freeze({
      manifestVersion: 1,
      jobId: productionJob.jobId,
      sceneId: productionJob.sceneId,
      engine: "ltx_25",
      renderProfileKey: "LTX_25_720P_5S_V1",
      durationMs: 8500
    });

    const mockAssembler: ProductionManifestAssembler = {
      assembleManifest: vi.fn().mockResolvedValue(expectedManifest)
    };

    const sharedCollectionProvenance = Object.freeze({
      version: 1,
      profiles: Object.freeze([fakeFluxLiveProvenance, fakeLtxLiveProvenance])
    });

    const readApprovedSpy = vi.fn().mockResolvedValue(sharedCollectionProvenance);
    const fakeRawLtxWorkflow = JSON.stringify({
      ...JSON.parse(fakeRawFluxWorkflow),
      _engine: "ltx_25"
    });

    // Note: verifyGoldMasterProvenance is intentionally NOT mocked out;
    // this exercises the real preflight collection resolution end-to-end.
    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async (_manifestPath, profileId) => {
        if (profileId === "flux-schnell-draft") return fakeFluxProfile;
        if (profileId === "ltx-25-720p-97f") return fakeLtxProfile;
        throw new Error(`Unexpected profileId: ${profileId}`);
      },
      readApprovedProvenance: readApprovedSpy,
      collectCertificationProvenance: async ({ profile }) => {
        if (profile.id === "flux-schnell-draft") return fakeFluxLiveProvenance;
        if (profile.id === "ltx-25-720p-97f") return fakeLtxLiveProvenance;
        throw new Error(`Unexpected profile.id: ${profile.id}`);
      },
      readWorkflowFile: async (filePath) => {
        if (filePath === fakeFluxProfile.workflowPath) return fakeRawFluxWorkflow;
        if (filePath === fakeLtxProfile.workflowPath) return fakeRawLtxWorkflow;
        return fakeRawFluxWorkflow;
      },
      hashWorkflow: (raw) => {
        if (raw === fakeRawFluxWorkflow) return sampleWorkflowHash;
        if (raw === fakeRawLtxWorkflow) return sampleLtxWorkflowHash;
        return sampleWorkflowHash;
      },
      executeProfileRender: mockExecuteProfileRender,
      outputReader,
      productionManifestAssembler: mockAssembler
    });

    // 1. Candidate job (flux-schnell-draft) succeeds against collection provenance
    const candidateResult = await executor(candidateJob);
    expect(candidateResult.candidatePayload).toBeDefined();
    expect(candidateResult.candidatePayload?.variantOrdinal).toBe(1);
    expect(candidateResult.mediaObjects).toHaveLength(1);
    expect(candidateResult.mediaObjects![0]!.bucket).toBe("godzspeed-review");

    // 2. Production job (ltx-25-720p-97f) succeeds against the SAME executor instance and SAME collection provenance
    const productionResult = await executor(productionJob);
    expect(mockAssembler.assembleManifest).toHaveBeenCalledTimes(1);
    expect(productionResult.manifestPayload).toEqual(expectedManifest);
    expect(productionResult.mediaObjects).toHaveLength(1);
    expect(productionResult.mediaObjects![0]!.bucket).toBe("godzspeed-delivery");

    // Invariant checks
    expect(readApprovedSpy).toHaveBeenCalledTimes(2);
    expect(mockExecuteProfileRender).toHaveBeenCalledTimes(2);
    expect(executeCalls).toHaveLength(2);
    expect(executeCalls[0]!.identity.profileId).toBe("flux-schnell-draft");
    expect(executeCalls[1]!.identity.profileId).toBe("ltx-25-720p-97f");
  });

  it("handles production job with multiple outputs and function-based manifest assembler", async () => {
    const bytes1 = new Uint8Array([1, 2]);
    const bytes2 = new Uint8Array([3, 4]);

    const outputReader = new FakeOutputReader(
      new Map([
        ["output_main.mp4", { bytes: bytes1, contentType: "video/mp4" }],
        ["output_preview.webp", { bytes: bytes2, contentType: "image/webp" }]
      ])
    );

    const mockExecuteProfileRender = vi.fn().mockResolvedValue({
      status: "succeeded",
      promptId: "ltx-multi-123",
      outputObjectKeys: ["output_main.mp4", "output_preview.webp"],
      durationMs: 9000,
      profile: {
        profileId: "ltx-25-720p-97f",
        renderProfileKey: "LTX_25_720P_5S_V1",
        renderProfileVersion: 1,
        engine: "ltx_25",
        workflowSha256: sampleLtxWorkflowHash,
        modelSha256: fakeLtxLiveProvenance.renderProfileProvenance!.modelHashes,
        runnerProfile: "dynamicvram-offload-v1",
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      }
    });

    const manifestFn = vi.fn().mockImplementation((input: AssembleProductionManifestInput) => ({
      mediaCount: input.mediaObjects.length,
      jobId: input.job.jobId
    }));

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeLtxProfile,
      readApprovedProvenance: async () => fakeLtxLiveProvenance,
      collectCertificationProvenance: async () => fakeLtxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleLtxWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader,
      productionManifestAssembler: manifestFn
    });

    const job = createSampleProductionJob();
    const result = await executor(job);

    expect(outputReader.readCalls).toEqual(["output_main.mp4", "output_preview.webp"]);
    expect(result.mediaObjects).toHaveLength(2);
    expect(result.manifestPayload).toEqual({
      mediaCount: 2,
      jobId: job.jobId
    });
  });

  it("handles assembler object with assemble method", async () => {
    const outputReader = new FakeOutputReader(
      new Map([["out.webp", { bytes: new Uint8Array([1]), contentType: "image/webp" }]])
    );

    const mockExecuteProfileRender = vi.fn().mockResolvedValue({
      status: "succeeded",
      promptId: "ltx-assemble-test",
      outputObjectKeys: ["out.webp"],
      durationMs: 1200,
      profile: {} as ProfileRenderIdentity,
      preDispatchGpu: {
        totalVramMb: 24576,
        usedVramMb: 4096,
        freeVramMb: 20480,
        reservedVramMb: 4096,
        measuredAt: new Date().toISOString()
      }
    });

    const assembleMethodAssembler: ProductionManifestAssembler = {
      assemble: async () => ({ method: "assemble" })
    };

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeLtxProfile,
      readApprovedProvenance: async () => fakeLtxLiveProvenance,
      collectCertificationProvenance: async () => fakeLtxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleLtxWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader,
      productionManifestAssembler: assembleMethodAssembler
    });

    const job = createSampleProductionJob();
    const result = await executor(job);

    expect(result.manifestPayload).toEqual({ method: "assemble" });
  });

  it("supports useCase object with execute method as dependency", async () => {
    const mockUseCase = {
      execute: vi.fn().mockResolvedValue({
        status: "succeeded",
        promptId: "use-case-prompt",
        outputObjectKeys: ["flux_schnell_00001_.png"],
        durationMs: 1200,
        profile: {} as ProfileRenderIdentity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      })
    };

    const outputReader = new FakeOutputReader();

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      useCase: mockUseCase,
      outputReader
    });

    const job = createSampleCandidateJob();
    await executor(job);

    expect(mockUseCase.execute).toHaveBeenCalledTimes(1);
  });

  it("throws RenderJobExecutionError when neither executeProfileRender nor useCase is provided", async () => {
    const outputReader = new FakeOutputReader();

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      outputReader
    });

    await expect(executor(createSampleCandidateJob())).rejects.toThrow(
      "No render execution useCase or executeProfileRender provided"
    );
  });

  it("fails when workflow node assertion fails during mutation", async () => {
    const invalidWorkflowMissingNode3 = JSON.stringify({
      "1": {
        inputs: { seed: 42, steps: 4 },
        class_type: "KSampler"
      },
      "3": {
        inputs: { text: "wrong class" },
        class_type: "WrongNodeType"
      }
    });

    const outputReader = new FakeOutputReader();
    const mockExecuteProfileRender = vi.fn();

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => invalidWorkflowMissingNode3,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    await expect(executor(createSampleCandidateJob())).rejects.toThrow(
      'Expected node "3" to exist with class_type "CLIPTextEncode"'
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();
  });

  it("fails when workflow provenance or hash mismatches", async () => {
    const outputReader = new FakeOutputReader();
    const mockExecuteProfileRender = vi.fn();

    // 1. Provenance verification throws PreflightError
    const executorBadProvenance = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {
        throw new PreflightError("Model hash mismatch in preflight");
      },
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    await expect(executorBadProvenance(createSampleCandidateJob())).rejects.toThrow(PreflightError);
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();

    // 2. Rechecked workflow hash does not match expected hash
    const executorBadWorkflowHash = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeFluxProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => "0".repeat(64), // Mismatched hash
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    await expect(executorBadWorkflowHash(createSampleCandidateJob())).rejects.toThrow(
      WorkflowHashMismatchError
    );
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();
  });

  it("throws MissingCertifiedProfileError when loadCertificationProfile signals no match", async () => {
    const outputReader = new FakeOutputReader();
    const mockExecuteProfileRender = vi.fn();
    const upstreamError = new Error(
      'Profile "missing-workflow" not found in manifest "/tmp/provenance.json". Available profiles: "flux-schnell-draft", "ltx-2.5-delivery".'
    );

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => {
        throw upstreamError;
      },
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: mockExecuteProfileRender,
      outputReader
    });

    const job = createSampleCandidateJob({ workflowTemplate: "missing-workflow" });
    await expect(executor(job)).rejects.toThrow(MissingCertifiedProfileError);
    await expect(executor(job)).rejects.toThrow(
      'no certified profile for workflow_template "missing-workflow"'
    );

    // Verify upstream error is preserved as cause for debugging
    try {
      await executor(job);
    } catch (err) {
      expect(err).toBeInstanceOf(MissingCertifiedProfileError);
      expect((err as MissingCertifiedProfileError).workflowTemplate).toBe("missing-workflow");
      expect((err as Error & { cause?: unknown }).cause).toBe(upstreamError);
    }
    expect(mockExecuteProfileRender).not.toHaveBeenCalled();
  });

  it("uses default manifest path pointing to repo root templates/provenance.json when not provided", async () => {
    let capturedManifestPath = "";
    const mockLoadProfile = vi.fn().mockImplementation(async (manifestPath: string) => {
      capturedManifestPath = manifestPath;
      return fakeFluxProfile;
    });

    const executor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: mockLoadProfile,
      readApprovedProvenance: async () => fakeFluxLiveProvenance,
      collectCertificationProvenance: async () => fakeFluxLiveProvenance,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawFluxWorkflow,
      hashWorkflow: () => sampleWorkflowHash,
      executeProfileRender: vi.fn().mockResolvedValue({
        status: "succeeded",
        promptId: "prompt-12345",
        outputObjectKeys: ["flux_schnell_00001_.png"],
        durationMs: 4200,
        profile: {} as ProfileRenderIdentity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      }),
      outputReader: new FakeOutputReader()
    });

    await executor(createSampleCandidateJob());

    expect(mockLoadProfile).toHaveBeenCalledTimes(1);
    expect(capturedManifestPath).toMatch(/templates\/provenance\.json$/);
    expect(capturedManifestPath).not.toContain("..");
  });

  describe("audioPrompt injection and canonical targeting causal chain", () => {
    it("injects audioPrompt into canonical audio node for audio-capable custom profile", async () => {
      const executeCalls: ExecuteProfileRenderInput[] = [];
      const mockExecuteProfileRender = vi
        .fn()
        .mockImplementation(async (input: ExecuteProfileRenderInput) => {
          executeCalls.push(input);
          return {
            status: "succeeded",
            promptId: "prompt-12345",
            outputObjectKeys: ["output.mp4"],
            durationMs: 4250,
            profile: input.identity,
            preDispatchGpu: {
              totalVramMb: 24576,
              usedVramMb: 4096,
              freeVramMb: 20480,
              reservedVramMb: 4096,
              measuredAt: new Date().toISOString()
            }
          };
        });

      let manifestAssembleInput: AssembleProductionManifestInput | undefined;
      const mockAssembler: ProductionManifestAssembler = {
        assembleManifest: vi
          .fn()
          .mockImplementation(async (input: AssembleProductionManifestInput) => {
            manifestAssembleInput = input;
            return { manifestId: "manifest-123", audioPromptApplied: true };
          })
      };

      const rawWorkflowWithAudio = JSON.stringify({
        "1": { class_type: "KSampler", inputs: { seed: 42, steps: 8 } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: "default prompt" } },
        "4": { class_type: "CLIPTextEncode", inputs: { text: "default negative" } },
        "50": { class_type: "AudioCLIPTextEncode", inputs: { text: "old audio prompt" } }
      });

      const outputReader = new FakeOutputReader(
        new Map([["output.mp4", { bytes: new Uint8Array([1, 2, 3]), contentType: "video/mp4" }]])
      );

      const fakeCustomAudioProfile: CertificationProfile = {
        ...fakeLtxProfile,
        id: "custom-audio-profile",
        engine: "custom_audio",
        renderProfileIdentity: {
          key: "custom_audio_profile_v1" as unknown as "LTX_25_720P_5S_V1",
          version: 1
        }
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeCustomAudioProfile,
        readApprovedProvenance: async () => fakeLtxLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => rawWorkflowWithAudio,
        hashWorkflow: () => sampleLtxWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader,
        productionManifestAssembler: mockAssembler
      });

      const job = createSampleProductionJob({
        workflowTemplate: "custom-audio-profile",
        injectedPayload: {
          prompt: "cinematic drone flight",
          negativePrompt: "low res",
          audioPrompt: "epic cinematic orchestral soundtrack",
          seed: 777,
          approvedCandidateId: "cand-999" as CandidateId
        }
      });

      const result = await executor(job);

      // 1. Verify workflow dispatched to ComfyUI render execution has injected audioPrompt in node 50
      expect(executeCalls).toHaveLength(1);
      const dispatchedWorkflow = executeCalls[0]!.workflow as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(dispatchedWorkflow["50"]?.inputs.text).toBe("epic cinematic orchestral soundtrack");
      expect(dispatchedWorkflow["3"]?.inputs.text).toBe("cinematic drone flight");
      expect(dispatchedWorkflow["4"]?.inputs.text).toBe("low res");
      expect(dispatchedWorkflow["1"]?.inputs.seed).toBe(777);

      // 2. Verify manifest assembler received the exact mutated workflow and approvedCandidateId
      expect(mockAssembler.assembleManifest).toHaveBeenCalledTimes(1);
      expect(manifestAssembleInput).toBeDefined();
      const assemblerWorkflow = manifestAssembleInput!.workflow as Record<
        string,
        { inputs: Record<string, unknown> }
      >;
      expect(assemblerWorkflow["50"]?.inputs.text).toBe("epic cinematic orchestral soundtrack");
      expect(manifestAssembleInput!.approvedCandidateId).toBe("cand-999");
      expect(result.manifestPayload).toEqual({
        manifestId: "manifest-123",
        audioPromptApplied: true
      });
    });

    it("fails loudly when audioPrompt is supplied for video-only LTX profile", async () => {
      const mockExecuteProfileRender = vi.fn();
      const mockAssembler = { assembleManifest: vi.fn() };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxProfile,
        readApprovedProvenance: async () => fakeLtxLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => JSON.stringify({}),
        hashWorkflow: () => sampleLtxWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(),
        productionManifestAssembler: mockAssembler
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f",
        injectedPayload: {
          prompt: "cinematic flight",
          audioPrompt: "ocean waves audio"
        }
      });

      await expect(executor(job)).rejects.toThrow(
        'Profile "ltx-25-720p-97f" does not support audio generation: audioPrompt is not supported'
      );
      expect(mockExecuteProfileRender).not.toHaveBeenCalled();
      expect(mockAssembler.assembleManifest).not.toHaveBeenCalled();
    });

    it("fails when audioPrompt is supplied on a custom profile with no compatible audio node in workflow", async () => {
      const mockExecuteProfileRender = vi.fn();
      const mockAssembler = { assembleManifest: vi.fn() };

      const rawWorkflowWithoutAudio = JSON.stringify({
        "1": { class_type: "KSampler", inputs: { seed: 42, steps: 8 } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: "default prompt" } },
        "4": { class_type: "CLIPTextEncode", inputs: { text: "default negative" } }
      });

      const fakeCustomAudioProfile: CertificationProfile = {
        ...fakeLtxProfile,
        id: "custom-audio-profile",
        engine: "custom_audio",
        renderProfileIdentity: {
          key: "custom_audio_profile_v1" as unknown as "LTX_25_720P_5S_V1",
          version: 1
        }
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeCustomAudioProfile,
        readApprovedProvenance: async () => fakeLtxLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => rawWorkflowWithoutAudio,
        hashWorkflow: () => sampleLtxWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(),
        productionManifestAssembler: mockAssembler
      });

      const job = createSampleProductionJob({
        workflowTemplate: "custom-audio-profile",
        injectedPayload: {
          prompt: "cinematic flight",
          audioPrompt: "ocean waves audio"
        }
      });

      await expect(executor(job)).rejects.toThrow(
        'Expected node "50" to exist with class_type "AudioCLIPTextEncode" and inputs object for audioPrompt injection'
      );
      expect(mockExecuteProfileRender).not.toHaveBeenCalled();
      expect(mockAssembler.assembleManifest).not.toHaveBeenCalled();
    });

    it("fails when audioPrompt is supplied on a non-certified workflow with multiple ambiguous audio nodes in workflow", () => {
      const rawWorkflowWithAmbiguousAudio = JSON.stringify({
        "1": { class_type: "KSampler", inputs: { seed: 42, steps: 8 } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: "default prompt" } },
        "4": { class_type: "CLIPTextEncode", inputs: { text: "default negative" } },
        "50": { class_type: "AudioCLIPTextEncode", inputs: { text: "audio prompt 1" } },
        "51": { class_type: "PromptAudio", inputs: { prompt: "audio prompt 2" } }
      });

      expect(() =>
        mutateWorkflow(rawWorkflowWithAmbiguousAudio, {
          prompt: "cinematic flight",
          audioPrompt: "thunderstorm audio"
        })
      ).toThrow(
        "Multiple ambiguous audio prompt target nodes found in workflow for audioPrompt injection: [50, 51]"
      );
    });

    it("mutates node 5 length for frameCount injection with declarative topology", () => {
      const rawLtx = JSON.stringify({
        "1": { class_type: "KSampler", inputs: { seed: 42 } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: "old" } },
        "4": { class_type: "CLIPTextEncode", inputs: { text: "old neg" } },
        "5": {
          class_type: "EmptyLTXVLatentVideo",
          inputs: { width: 1280, height: 720, length: 97 }
        }
      });

      const mutated = mutateWorkflow(
        rawLtx,
        {
          prompt: "new prompt",
          seed: 12345,
          frameCount: 57
        },
        fakeLtxProfile
      );

      expect((mutated["5"] as { inputs: { length: number } }).inputs.length).toBe(57);
      expect((mutated["3"] as { inputs: { text: string } }).inputs.text).toBe("new prompt");
      expect((mutated["1"] as { inputs: { seed: number } }).inputs.seed).toBe(12345);
    });

    it("throws descriptive error when frameCount node is missing or malformed in workflow", () => {
      const rawWithoutNode5 = JSON.stringify({
        "1": { class_type: "KSampler", inputs: { seed: 42 } },
        "3": { class_type: "CLIPTextEncode", inputs: { text: "old" } }
      });

      expect(() => mutateWorkflow(rawWithoutNode5, { frameCount: 57 }, fakeLtxProfile)).toThrow(
        'Expected node "5" to exist with class_type "EmptyLTXVLatentVideo" and inputs object for frameCount injection'
      );
    });

    it("proves full causal chain request -> finalized execution workflow -> ComfyUI dispatch -> manifest provenance against actual certified LTX template", async () => {
      const executeCalls: ExecuteProfileRenderInput[] = [];
      const mockExecuteProfileRender = vi
        .fn()
        .mockImplementation(async (input: ExecuteProfileRenderInput) => {
          executeCalls.push(input);
          return {
            status: "succeeded",
            promptId: "prompt-ltx-real-123",
            outputObjectKeys: ["renders/job-production-real/output.webp"],
            durationMs: 5120,
            profile: input.identity,
            preDispatchGpu: {
              totalVramMb: 24576,
              usedVramMb: 4096,
              freeVramMb: 20480,
              reservedVramMb: 4096,
              measuredAt: new Date().toISOString()
            }
          };
        });

      // Load actual real certified LTX template from templates/ltx_25_720p_97f_api.json
      const realLtxTemplatePath = resolve(DEFAULT_REPO_ROOT, "templates/ltx_25_720p_97f_api.json");
      const realLtxTemplateJson = await readFile(realLtxTemplatePath, "utf8");

      let manifestAssembleInput: AssembleProductionManifestInput | undefined;
      const mockAssembler: ProductionManifestAssembler = {
        assembleManifest: vi
          .fn()
          .mockImplementation(async (input: AssembleProductionManifestInput) => {
            manifestAssembleInput = input;
            return {
              manifestId: "manifest-production-ltx-real",
              prompts: {
                prompt: (input.workflow as Record<string, { inputs: Record<string, unknown> }>)["3"]
                  ?.inputs.text,
                negativePrompt: (
                  input.workflow as Record<string, { inputs: Record<string, unknown> }>
                )["4"]?.inputs.text,
                audioPrompt: null
              },
              sampling: {
                seed: (input.workflow as Record<string, { inputs: Record<string, unknown> }>)["1"]
                  ?.inputs.seed
              }
            };
          })
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxProfile,
        readApprovedProvenance: async () => fakeLtxLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => realLtxTemplateJson,
        hashWorkflow: () => sampleLtxWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(
          new Map([
            [
              "renders/job-production-real/output.webp",
              { bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp" }
            ]
          ])
        ),
        productionManifestAssembler: mockAssembler
      });

      const productionJob = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f",
        injectedPayload: {
          prompt: "A cinematic aerial drone shot of golden hour landscape",
          negativePrompt: "blurry, low quality, artifacts",
          seed: 987654,
          frameCount: 97,
          approvedCandidateId: "cand-certified-999" as CandidateId
        }
      });

      const result = await executor(productionJob);

      // 1. Assert dispatched workflow mutated the real certified LTX template nodes exactly
      expect(executeCalls).toHaveLength(1);
      const dispatchedWorkflow = executeCalls[0]!.workflow as Record<
        string,
        { class_type: string; inputs: Record<string, unknown> }
      >;
      expect(dispatchedWorkflow["3"]?.class_type).toBe("CLIPTextEncode");
      expect(dispatchedWorkflow["3"]?.inputs.text).toBe(
        "A cinematic aerial drone shot of golden hour landscape"
      );
      expect(dispatchedWorkflow["4"]?.class_type).toBe("CLIPTextEncode");
      expect(dispatchedWorkflow["4"]?.inputs.text).toBe("blurry, low quality, artifacts");
      expect(dispatchedWorkflow["1"]?.class_type).toBe("KSampler");
      expect(dispatchedWorkflow["1"]?.inputs.seed).toBe(987654);
      expect(dispatchedWorkflow["5"]?.class_type).toBe("EmptyLTXVLatentVideo");
      expect(dispatchedWorkflow["5"]?.inputs.length).toBe(97);

      // 2. Assert manifest assembler receives the finalized mutated workflow and approvedCandidateId
      expect(mockAssembler.assembleManifest).toHaveBeenCalledTimes(1);
      expect(manifestAssembleInput).toBeDefined();
      expect(manifestAssembleInput!.approvedCandidateId).toBe("cand-certified-999");
      expect(manifestAssembleInput!.workflow).toBe(executeCalls[0]!.workflow);

      // 3. Assert manifest payload has capability-dependent audioPrompt: null
      expect(result.manifestPayload).toEqual({
        manifestId: "manifest-production-ltx-real",
        prompts: {
          prompt: "A cinematic aerial drone shot of golden hour landscape",
          negativePrompt: "blurry, low quality, artifacts",
          audioPrompt: null
        },
        sampling: {
          seed: 987654
        }
      });
    });

    it("fails closed when certified profile does not define a declarative topology", async () => {
      const fakeUntypedProfile: CertificationProfile = {
        ...fakeLtxProfile,
        id: "unsupported-profile",
        renderProfileIdentity: {
          key: "UNKNOWN_CERTIFIED_PROFILE" as unknown as "LTX_25_720P_5S_V1",
          version: 1
        }
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeUntypedProfile,
        readApprovedProvenance: async () => fakeLtxLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => JSON.stringify({ "1": { class_type: "KSampler" } }),
        hashWorkflow: () => sampleLtxWorkflowHash,
        executeProfileRender: vi.fn(),
        outputReader: new FakeOutputReader(),
        productionManifestAssembler: { assembleManifest: vi.fn() }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "unsupported-profile"
      });

      await expect(executor(job)).rejects.toThrow(MissingProfileTopologyError);
      await expect(executor(job)).rejects.toThrow(
        'Profile "unsupported-profile" (key: "UNKNOWN_CERTIFIED_PROFILE") does not define a declarative ProfileInjectionTopology'
      );
    });

    it("proves end-to-end integration: real certified LTX template -> mutation -> ComfyUI dispatch -> real AssembleGenerationManifest -> 16-field GenerationManifest with audioPrompt: null", async () => {
      const executeCalls: ExecuteProfileRenderInput[] = [];
      const mockExecuteProfileRender = vi
        .fn()
        .mockImplementation(async (input: ExecuteProfileRenderInput) => {
          executeCalls.push(input);
          return {
            status: "succeeded",
            promptId: "prompt-ltx-e2e-123",
            outputObjectKeys: ["renders/job-production-real/output.webp"],
            durationMs: 4800,
            profile: input.identity,
            preDispatchGpu: {
              totalVramMb: 24576,
              usedVramMb: 4096,
              freeVramMb: 20480,
              reservedVramMb: 4096,
              measuredAt: "2026-08-29T10:04:55.000Z"
            }
          };
        });

      const realLtxTemplatePath = resolve(DEFAULT_REPO_ROOT, "templates/ltx_25_720p_97f_api.json");
      const realLtxTemplateJson = await readFile(realLtxTemplatePath, "utf8");

      const fakeCandidateId = "cand-certified-999" as CandidateId;
      const fakeCandidate: StoryboardCandidate = {
        id: fakeCandidateId,
        sceneId: sampleSceneId,
        specRevision: 1,
        variantOrdinal: 1,
        storageBucket: "godzspeed-review",
        storageObjectKey: "candidates/cand-999.webp",
        contentHash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        generationMetadata: {},
        createdAt: "2026-08-29T09:30:00.000Z"
      };

      const fakeScene = Scene.reconstitute({
        id: sampleSceneId,
        campaignId: "camp-123" as CampaignId,
        status: "rendering",
        specRevision: 1,
        configuration: {
          prompt: "A cinematic aerial drone shot of golden hour landscape",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        },
        selectedCandidateId: fakeCandidateId,
        selectedCandidateRevision: 1,
        approval: {
          revision: 1,
          approvedBy: "director-1",
          approvedAt: "2026-08-29T09:35:00.000Z"
        }
      });

      const storyboardCandidateRepository: StoryboardCandidateRepository = {
        findById: async (id) => (id === fakeCandidateId ? fakeCandidate : undefined),
        insert: async () => {},
        listBySceneAndRevision: async () => [fakeCandidate]
      };

      const sceneRepository: SceneRepository = {
        findById: async (id) => (id === sampleSceneId ? fakeScene : undefined),
        save: async () => {}
      };

      const referenceAssetRepository: ReferenceAssetRepository = {
        listBySceneId: async () => [],
        findByIds: async () => []
      };

      const hashBytes: HashBytesPort = {
        hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
      };

      const realAssembler = new AssembleGenerationManifest({
        hashBytes,
        sceneRepository,
        storyboardCandidateRepository,
        referenceAssetRepository
      });

      const outputBytes = new Uint8Array([1, 2, 3, 4, 5]);
      const expectedOutputHash = createHash("sha256").update(outputBytes).digest("hex");

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxProfile,
        readApprovedProvenance: async () => fakeLtxLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => realLtxTemplateJson,
        hashWorkflow: () => sampleLtxWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(
          new Map([
            [
              "renders/job-production-real/output.webp",
              { bytes: outputBytes, contentType: "image/webp" }
            ]
          ])
        ),
        productionManifestAssembler: realAssembler,
        hashBytes: hashBytes
      });

      const productionJob = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f",
        injectedPayload: {
          prompt: "A cinematic aerial drone shot of golden hour landscape",
          negativePrompt: "blurry, low quality, artifacts",
          seed: 987654,
          approvedCandidateId: fakeCandidateId
        }
      });

      const result = await executor(productionJob);

      // Verify the full end-to-end GenerationManifest payload produced by the real assembler
      const manifest = result.manifestPayload as Record<string, unknown>;
      expect(manifest).toBeDefined();
      expect(manifest.manifestId).toBeDefined();
      expect(manifest.renderedAt).toBeDefined();
      expect(manifest.sceneId).toBe(sampleSceneId);
      expect(manifest.jobId).toBe(productionJob.jobId);
      expect(manifest.prompts).toEqual({
        prompt: "A cinematic aerial drone shot of golden hour landscape",
        negativePrompt: "blurry, low quality, artifacts",
        audioPrompt: null
      });
      expect(manifest.sampling).toEqual({
        seed: 987654,
        steps: 8,
        cfg: 1,
        sampler: "euler",
        scheduler: "simple",
        denoise: 1
      });
      expect(manifest.dimensions).toEqual({ width: 1280, height: 720 });
      expect(manifest.frameCount).toBe(97);
      expect(manifest.fps).toBe(LTX_FPS);
      expect(manifest.workflow).toEqual({
        templateId: "ltx-25-720p-97f",
        sha256: sampleLtxWorkflowHash
      });
      expect(manifest.approvedCandidate).toEqual({
        id: fakeCandidateId,
        contentHash: fakeCandidate.contentHash,
        specRevision: 1,
        variantOrdinal: 1
      });
      expect(manifest.outputs).toEqual([
        {
          bucket: "godzspeed-delivery",
          key: `scenes/${sampleSceneId}/jobs/${productionJob.jobId}/${expectedOutputHash.slice(0, 16)}-output.webp`,
          filename: `${expectedOutputHash.slice(0, 16)}-output.webp`,
          checksumSha256: expectedOutputHash,
          contentType: "image/webp"
        }
      ]);
    });
  });

  describe("mutateWorkflow - referenceImage bidirectional invariant", () => {
    it("throws ReferenceImageInjectionInvariantError if profile topology declares referenceImage but injected referenceImage is missing", () => {
      expect(() =>
        mutateWorkflow(fakeRawLtxI2vWorkflow, { prompt: "test prompt" }, fakeLtxI2vProfile)
      ).toThrow(ReferenceImageInjectionInvariantError);
    });

    it("throws ReferenceImageInjectionInvariantError if profile topology declares referenceImage but injected referenceImage is blank/whitespace", () => {
      expect(() =>
        mutateWorkflow(
          fakeRawLtxI2vWorkflow,
          { prompt: "test prompt", referenceImage: "   " },
          fakeLtxI2vProfile
        )
      ).toThrow(ReferenceImageInjectionInvariantError);
    });

    it("throws ReferenceImageInjectionInvariantError if injected referenceImage is provided but profile topology does not declare referenceImage", () => {
      expect(() =>
        mutateWorkflow(
          fakeRawFluxWorkflow,
          { prompt: "test prompt", referenceImage: "some-image.png" },
          fakeFluxProfile
        )
      ).toThrow(ReferenceImageInjectionInvariantError);

      expect(() =>
        mutateWorkflow(
          fakeRawFluxWorkflow,
          { prompt: "test prompt", referenceImage: "some-image.png" },
          fakeLtxProfile
        )
      ).toThrow(ReferenceImageInjectionInvariantError);
    });

    it("throws ReferenceImageInjectionInvariantError if injected referenceImage is provided but profile has no topology", () => {
      expect(() =>
        mutateWorkflow(
          fakeRawFluxWorkflow,
          { prompt: "test prompt", referenceImage: "some-image.png" },
          undefined
        )
      ).toThrow(ReferenceImageInjectionInvariantError);
    });

    it("successfully injects referenceImage into declared node when topology matches", () => {
      const result = mutateWorkflow(
        fakeRawLtxI2vWorkflow,
        { prompt: "test prompt", referenceImage: "staged-conditioning-frame.png" },
        fakeLtxI2vProfile
      );

      const node20 = (result as Record<string, { inputs: Record<string, unknown> }>)["20"];
      expect(node20).toBeDefined();
      expect(node20!.inputs.image).toBe("staged-conditioning-frame.png");
    });

    it("throws RenderJobExecutionError if referenceImage target node class_type does not match topology", () => {
      const badWorkflow = JSON.stringify({
        ...JSON.parse(fakeRawLtxI2vWorkflow),
        "20": { inputs: { image: "old.png" }, class_type: "WrongClass" }
      });

      expect(() =>
        mutateWorkflow(
          badWorkflow,
          { prompt: "test prompt", referenceImage: "staged.png" },
          fakeLtxI2vProfile
        )
      ).toThrow('Expected node "20" to exist with class_type "LoadImage"');
    });
  });

  describe("createCertifiedRenderJobExecutor - I2V conditioned execution", () => {
    const candidateImageBytes = new Uint8Array([10, 20, 30, 40, 50]);
    const candidateImageSha256 = createHash("sha256").update(candidateImageBytes).digest("hex");
    const testCandidateId = "cand-approved-456" as CandidateId;

    const mockResolvedMedia: ResolvedApprovedVisualProductionMedia = {
      input: {
        candidateId: testCandidateId,
        sceneId: sampleSceneId,
        specRevision: 1,
        contentHashSha256: candidateImageSha256
      },
      media: {
        bucket: "godzspeed-review",
        key: `candidates/${testCandidateId}.png`,
        sha256: candidateImageSha256,
        contentType: "image/png"
      }
    };

    it("I2V production job: resolves candidate media, verifies integrity, stages image, injects into node 20, cleans up in finally, and passes conditioningImage to manifest assembler", async () => {
      const mockExecuteProfileRender = vi.fn().mockResolvedValue({
        status: "succeeded",
        promptId: "prompt-i2v-1",
        outputObjectKeys: ["output.webp"],
        durationMs: 4500,
        profile: {} as ProfileRenderIdentity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      });

      const stagedReference: StagedComfyUiInput = {
        name: `cco-${sampleSceneId}-${sampleJobId}-${candidateImageSha256.slice(0, 16)}.png`,
        subfolder: "conditioning"
      };

      const mockResolveApprovedCandidateMedia = {
        execute: vi.fn().mockResolvedValue(mockResolvedMedia)
      };

      const mockObjectStorage: ObjectStoragePort = {
        getObject: vi.fn().mockResolvedValue({
          body: candidateImageBytes,
          contentType: "image/png"
        }),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      };

      const mockStageReferenceImage: ComfyUiInputStagingPort = {
        stage: vi.fn().mockResolvedValue(stagedReference),
        cleanup: vi.fn().mockResolvedValue(undefined)
      };

      let capturedAssembleInput: AssembleProductionManifestInput | undefined;
      const mockAssembler: ProductionManifestAssembler = {
        assembleManifest: vi
          .fn()
          .mockImplementation(async (input: AssembleProductionManifestInput) => {
            capturedAssembleInput = input;
            return {
              manifestId: "man-123",
              ok: true
            };
          })
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(
          new Map([
            ["output.webp", { bytes: new Uint8Array([1, 2, 3]), contentType: "image/webp" }]
          ])
        ),
        resolveApprovedCandidateMedia: mockResolveApprovedCandidateMedia,
        objectStorage: mockObjectStorage,
        stageReferenceImage: mockStageReferenceImage,
        productionManifestAssembler: mockAssembler
      });

      const i2vJob = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "A cinematic I2V prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      const result = await executor(i2vJob);

      // Verify resolution called
      expect(mockResolveApprovedCandidateMedia.execute).toHaveBeenCalledWith({
        sceneId: sampleSceneId,
        approvedCandidateId: testCandidateId
      });

      // Verify objectStorage re-fetched
      expect(mockObjectStorage.getObject).toHaveBeenCalledWith(
        {
          bucket: "godzspeed-review",
          key: `candidates/${testCandidateId}.png`
        },
        { maxBytes: expect.any(Number) }
      );

      // Verify staging called
      expect(mockStageReferenceImage.stage).toHaveBeenCalledWith({
        filename: stagedReference.name,
        bytes: candidateImageBytes,
        contentType: "image/png"
      });

      // Verify injected workflow in executeProfileRender had node 20 populated
      expect(mockExecuteProfileRender).toHaveBeenCalledTimes(1);
      const executedWorkflow = mockExecuteProfileRender.mock.calls[0]![0]
        .workflow as unknown as Record<string, { inputs: Record<string, unknown> }>;
      expect(executedWorkflow["20"]!.inputs.image).toBe(`conditioning/${stagedReference.name}`);

      // Verify cleanup called in finally
      expect(mockStageReferenceImage.cleanup).toHaveBeenCalledWith(stagedReference);

      // Verify conditioningImage carried forward to manifest assembler losslessly
      expect(capturedAssembleInput).toBeDefined();
      expect(capturedAssembleInput!.conditioningImage).toEqual({
        resolved: mockResolvedMedia,
        stagedAs: {
          name: stagedReference.name,
          subfolder: stagedReference.subfolder
        },
        injectionTarget: {
          nodeId: "20",
          classType: "LoadImage",
          inputField: "image"
        }
      });

      expect(result.manifestPayload).toEqual({
        manifestId: "man-123",
        ok: true
      });
    });

    it("I2V production job: fails fast with MissingApprovedCandidateForConditioningError if approvedCandidateId is missing", async () => {
      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        resolveApprovedCandidateMedia: { execute: vi.fn() },
        objectStorage: {
          getObject: vi.fn(),
          putObject: vi.fn(),
          copyObject: vi.fn(),
          deleteObject: vi.fn(),
          headObject: vi.fn()
        },
        stageReferenceImage: { stage: vi.fn() }
      });

      const jobWithoutCandidate = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "No candidate provided",
          seed: 42
        }
      });

      await expect(executor(jobWithoutCandidate)).rejects.toThrow(
        MissingApprovedCandidateForConditioningError
      );
    });

    it("I2V production job: fails with ReferenceImageIntegrityError if candidate object is missing from storage", async () => {
      const mockObjectStorage: ObjectStoragePort = {
        getObject: vi.fn().mockResolvedValue(undefined),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        resolveApprovedCandidateMedia: { execute: vi.fn().mockResolvedValue(mockResolvedMedia) },
        objectStorage: mockObjectStorage,
        stageReferenceImage: { stage: vi.fn() }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      await expect(executor(job)).rejects.toThrow(ReferenceImageIntegrityError);
    });

    it("I2V production job: fails with ReferenceImageIntegrityError if storage bytes sha256 mismatch", async () => {
      const corruptBytes = new Uint8Array([99, 99, 99]);
      const mockObjectStorage: ObjectStoragePort = {
        getObject: vi.fn().mockResolvedValue({
          body: corruptBytes,
          contentType: "image/png"
        }),
        putObject: vi.fn(),
        copyObject: vi.fn(),
        deleteObject: vi.fn(),
        headObject: vi.fn()
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        resolveApprovedCandidateMedia: { execute: vi.fn().mockResolvedValue(mockResolvedMedia) },
        objectStorage: mockObjectStorage,
        stageReferenceImage: { stage: vi.fn() }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      await expect(executor(job)).rejects.toThrow(ReferenceImageIntegrityError);
    });

    it("I2V production job: propagates resolveApprovedCandidateMedia errors unchanged", async () => {
      const hashMismatchError = new ApprovedCandidateMediaHashMismatchError(
        testCandidateId,
        candidateImageSha256,
        "bad-hash"
      );

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        resolveApprovedCandidateMedia: {
          execute: vi.fn().mockRejectedValue(hashMismatchError)
        },
        objectStorage: {
          getObject: vi.fn(),
          putObject: vi.fn(),
          copyObject: vi.fn(),
          deleteObject: vi.fn(),
          headObject: vi.fn()
        },
        stageReferenceImage: { stage: vi.fn() }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      await expect(executor(job)).rejects.toThrow(hashMismatchError);
    });

    it("I2V production job: fails with ReferenceImageStagingError if staging rejects, halting before render (no text-only fallback)", async () => {
      const mockExecuteProfileRender = vi.fn();
      const stagingError = new Error("Connection refused to ComfyUI");

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        resolveApprovedCandidateMedia: { execute: vi.fn().mockResolvedValue(mockResolvedMedia) },
        objectStorage: {
          getObject: vi
            .fn()
            .mockResolvedValue({ body: candidateImageBytes, contentType: "image/png" }),
          putObject: vi.fn(),
          copyObject: vi.fn(),
          deleteObject: vi.fn(),
          headObject: vi.fn()
        },
        stageReferenceImage: {
          stage: vi.fn().mockRejectedValue(stagingError)
        }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      await expect(executor(job)).rejects.toThrow(ReferenceImageStagingError);
      expect(mockExecuteProfileRender).not.toHaveBeenCalled();
    });

    it("I2V production job: cleanup failure in finally is swallowed and does not fail the job", async () => {
      const mockExecuteProfileRender = vi.fn().mockResolvedValue({
        status: "succeeded",
        promptId: "prompt-i2v-1",
        outputObjectKeys: ["output.webp"],
        durationMs: 4500,
        profile: {} as ProfileRenderIdentity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      });

      const expectedStagedName = buildDeterministicStagingFilename(
        sampleSceneId,
        sampleJobId,
        candidateImageSha256,
        "image/png"
      );
      const stagedReference: StagedComfyUiInput = {
        name: expectedStagedName,
        subfolder: ""
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(
          new Map([["output.webp", { bytes: new Uint8Array([1]), contentType: "image/webp" }]])
        ),
        resolveApprovedCandidateMedia: { execute: vi.fn().mockResolvedValue(mockResolvedMedia) },
        objectStorage: {
          getObject: vi
            .fn()
            .mockResolvedValue({ body: candidateImageBytes, contentType: "image/png" }),
          putObject: vi.fn(),
          copyObject: vi.fn(),
          deleteObject: vi.fn(),
          headObject: vi.fn()
        },
        stageReferenceImage: {
          stage: vi.fn().mockResolvedValue(stagedReference),
          cleanup: vi.fn().mockRejectedValue(new Error("Disk permission denied on unlink"))
        },
        productionManifestAssembler: { assembleManifest: async () => ({ manifestId: "ok" }) }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      const result = await executor(job);
      expect(result.manifestPayload).toEqual({ manifestId: "ok" });
    });

    it("I2V production job: mutation failure after staging triggers cleanup and preserves original error", async () => {
      const expectedStagedName = buildDeterministicStagingFilename(
        sampleSceneId,
        sampleJobId,
        candidateImageSha256,
        "image/png"
      );
      const stagedReference: StagedComfyUiInput = {
        name: expectedStagedName,
        subfolder: "conditioning"
      };
      const mockCleanup = vi.fn().mockResolvedValue(undefined);
      const mockExecuteProfileRender = vi.fn();

      // Workflow with wrong node class for node 20
      const malformedWorkflow = JSON.stringify({
        ...JSON.parse(fakeRawLtxI2vWorkflow),
        "20": {
          inputs: { image: "reference_frame.png", upload: "image" },
          class_type: "WrongClass"
        }
      });
      const malformedWorkflowHash = createHash("sha256").update(malformedWorkflow).digest("hex");

      const malformedProvenance = {
        ...fakeLtxI2vLiveProvenance,
        workflow: {
          ...fakeLtxI2vLiveProvenance.workflow,
          sha256: malformedWorkflowHash
        }
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => ({
          ...fakeLtxI2vProfile,
          expectedWorkflowHash: malformedWorkflowHash
        }),
        readApprovedProvenance: async () => malformedProvenance,
        collectCertificationProvenance: async () => malformedProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => malformedWorkflow,
        hashWorkflow: () => malformedWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(new Map()),
        resolveApprovedCandidateMedia: { execute: vi.fn().mockResolvedValue(mockResolvedMedia) },
        objectStorage: {
          getObject: vi
            .fn()
            .mockResolvedValue({ body: candidateImageBytes, contentType: "image/png" }),
          putObject: vi.fn(),
          copyObject: vi.fn(),
          deleteObject: vi.fn(),
          headObject: vi.fn()
        },
        stageReferenceImage: {
          stage: vi.fn().mockResolvedValue(stagedReference),
          cleanup: mockCleanup
        },
        productionManifestAssembler: { assembleManifest: async () => ({ manifestId: "ok" }) }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      await expect(executor(job)).rejects.toThrow(RenderJobExecutionError);
      expect(mockCleanup).toHaveBeenCalledWith(stagedReference);
      expect(mockExecuteProfileRender).not.toHaveBeenCalled();
    });

    it("I2V production job: pre-flight license rejection halts before resolver, storage, staging, or render", async () => {
      const mockResolve = vi.fn();
      const mockGetObject = vi.fn();
      const mockStage = vi.fn();
      const mockExecuteProfileRender = vi.fn();

      const mockEnforceLicenseRouting = {
        enforce: vi.fn().mockImplementation(() => {
          throw new LicenseRoutingError("Profile license not approved", {
            registryRevision: "rev-1",
            evaluatedComponents: [],
            deniedReasons: ["Component LTX_25_720P_5S_I2V_V1 is not approved for production use"]
          });
        })
      };

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeLtxI2vProfile,
        readApprovedProvenance: async () => fakeLtxI2vLiveProvenance,
        collectCertificationProvenance: async () => fakeLtxI2vLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawLtxI2vWorkflow,
        hashWorkflow: () => sampleLtxI2vWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        enforceLicenseRouting: mockEnforceLicenseRouting as unknown as EnforceLicenseRouting,
        resolveApprovedCandidateMedia: { execute: mockResolve },
        objectStorage: {
          getObject: mockGetObject,
          putObject: vi.fn(),
          copyObject: vi.fn(),
          deleteObject: vi.fn(),
          headObject: vi.fn()
        },
        stageReferenceImage: {
          stage: mockStage,
          cleanup: vi.fn()
        },
        outputReader: new FakeOutputReader(new Map()),
        productionManifestAssembler: { assembleManifest: async () => ({ manifestId: "ok" }) }
      });

      const job = createSampleProductionJob({
        workflowTemplate: "ltx-25-720p-97f-i2v",
        injectedPayload: {
          prompt: "Valid prompt",
          seed: 42,
          approvedCandidateId: testCandidateId
        }
      });

      await expect(executor(job)).rejects.toThrow(LicenseRoutingError);
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockGetObject).not.toHaveBeenCalled();
      expect(mockStage).not.toHaveBeenCalled();
      expect(mockExecuteProfileRender).not.toHaveBeenCalled();
    });

    it("existing profiles and candidate jobs execute unchanged without calling candidate resolution or staging", async () => {
      const mockResolve = vi.fn();
      const mockStage = vi.fn();
      const mockExecuteProfileRender = vi.fn().mockResolvedValue({
        status: "succeeded",
        promptId: "prompt-flux-1",
        outputObjectKeys: ["output.png"],
        durationMs: 2000,
        profile: {} as ProfileRenderIdentity,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      });

      const executor = createCertifiedRenderJobExecutor({
        loadCertificationProfile: async () => fakeFluxProfile,
        readApprovedProvenance: async () => fakeFluxLiveProvenance,
        collectCertificationProvenance: async () => fakeFluxLiveProvenance,
        verifyGoldMasterProvenance: () => {},
        readWorkflowFile: async () => fakeRawFluxWorkflow,
        hashWorkflow: () => sampleWorkflowHash,
        executeProfileRender: mockExecuteProfileRender,
        outputReader: new FakeOutputReader(
          new Map([["output.png", { bytes: new Uint8Array([1]), contentType: "image/png" }]])
        ),
        resolveApprovedCandidateMedia: { execute: mockResolve },
        stageReferenceImage: { stage: mockStage }
      });

      const candidateJob = createSampleCandidateJob();
      const result = await executor(candidateJob);

      expect(result.candidatePayload).toBeDefined();
      expect(mockResolve).not.toHaveBeenCalled();
      expect(mockStage).not.toHaveBeenCalled();
    });
  });
});
