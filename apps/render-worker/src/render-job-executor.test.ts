import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  AssembleGenerationManifest,
  type ExecuteProfileRenderInput,
  type ExecuteProfileRenderResult,
  type HashBytesPort,
  type ProfileRenderIdentity,
  type ReferenceAssetRepository,
  type SceneRepository,
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
  CandidateOutputCardinalityError,
  createCertifiedRenderJobExecutor,
  MissingCertifiedProfileError,
  MissingProfileTopologyError,
  mutateWorkflow,
  ProductionManifestAssemblyError,
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
      expect(manifest.fps).toBe(97 / 5);
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
});
