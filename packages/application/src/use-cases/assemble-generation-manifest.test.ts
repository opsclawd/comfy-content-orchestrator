import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssembleGenerationManifest,
  IncompleteManifestError,
  type AssembleGenerationManifestDeps,
  type AssembleManifestInput,
  type ManifestSourceProfile,
  type ManifestSourceProvenance
} from "./assemble-generation-manifest.js";
import type {
  CampaignId,
  CandidateId,
  JobId,
  ReferenceAsset,
  ReferenceAssetId,
  RenderJob,
  SceneId,
  StoryboardCandidate
} from "@cco/domain";
import { Scene } from "@cco/domain";
import type {
  HashBytesPort,
  PutObjectInput,
  ReferenceAssetRepository,
  RenderWorkflow,
  SceneRepository,
  StoryboardCandidateRepository
} from "../ports/index.js";
import type { ExecuteProfileRenderResult } from "./execute-profile-render.js";

describe("AssembleGenerationManifest use case", () => {
  const fakeSceneId = "scene-123" as SceneId;
  const fakeCampaignId = "camp-456" as CampaignId;
  const fakeJobId = "job-789" as JobId;

  const fakeCandidate: StoryboardCandidate = {
    id: "cand-202" as CandidateId,
    sceneId: fakeSceneId,
    specRevision: 1,
    variantOrdinal: 1,
    storageBucket: "godzspeed-review",
    storageObjectKey: "candidates/cand-202.webp",
    contentHash: "6666666666666666666666666666666666666666666666666666666666666666",
    generationMetadata: {},
    createdAt: "2026-08-29T09:30:00.000Z"
  };

  const fakeScene = Scene.reconstitute({
    id: fakeSceneId,
    campaignId: fakeCampaignId,
    status: "rendering",
    specRevision: 1,
    configuration: {
      prompt: "A beautiful cinematic sunrise",
      referenceIds: [],
      engineProfileId: "ltx_25",
      durationMs: 5000
    },
    selectedCandidateId: fakeCandidate.id,
    selectedCandidateRevision: 1,
    approval: {
      revision: 1,
      approvedBy: "director-1",
      approvedAt: "2026-08-29T09:35:00.000Z"
    }
  });

  const fakeJob: RenderJob = {
    jobId: fakeJobId,
    sceneId: fakeSceneId,
    jobKind: "production",
    status: "rendering",
    workflowTemplate: "ltx-25-720p-97f",
    injectedPayload: {
      prompt: "A beautiful cinematic sunrise",
      negativePrompt: "low quality, blurry",
      audioPrompt: "ambient birds chirping at dawn",
      seed: 42
    },
    workerId: "worker-node-1",
    leaseToken: null,
    leaseExpiresAt: null,
    retryCount: 0,
    maxRetries: 3,
    errorTrace: null,
    createdAt: new Date("2026-08-29T10:00:00Z"),
    updatedAt: new Date("2026-08-29T10:00:00Z")
  };

  const fakeProfile: ManifestSourceProfile = {
    id: "ltx-25-720p-97f",
    engine: "ltx_25",
    runnerProfile: "dynamicvram-offload-v1",
    source: {
      kind: "validated_host_export",
      license: "GPL-3.0",
      uri: "https://github.com/comfyanonymous/ComfyUI",
      revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
    },
    baseline: {
      width: 1280,
      height: 720,
      frames: 97,
      steps: 8,
      approximateDurationSeconds: 5
    },
    models: [
      {
        category: "diffusion_models",
        relativePath: "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors"
      },
      {
        category: "clip",
        relativePath: "gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors"
      },
      {
        category: "vae",
        relativePath: "ltx-2.5-video-vae-conv-bf16.safetensors"
      }
    ]
  };

  const fakeProvenance: ManifestSourceProvenance = {
    generatedAt: "2026-08-29T10:05:00.000Z",
    workflow: {
      sha256: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539"
    },
    models: [
      {
        key: "diffusion_models/ltx-2.5.safetensors",
        category: "diffusion_models",
        sha256: "1111111111111111111111111111111111111111111111111111111111111111",
        bytes: 20000000000
      },
      {
        key: "clip/gemma4.safetensors",
        category: "clip",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        bytes: 10000000000
      },
      {
        key: "vae/ltx-vae.safetensors",
        category: "vae",
        sha256: "3333333333333333333333333333333333333333333333333333333333333333",
        bytes: 500000000
      }
    ],
    git: {
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: [
        {
          name: "ComfyUI-LTXTricks",
          commit: "abcdef1234567890abcdef1234567890abcdef12",
          status: "tracked"
        }
      ]
    }
  };

  const fakeWorkflow: RenderWorkflow = {
    "1": {
      class_type: "KSampler",
      inputs: {
        seed: 42,
        steps: 8,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1
      }
    },
    "3": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "A beautiful cinematic sunrise"
      }
    },
    "4": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "low quality, blurry"
      }
    },
    "10": {
      class_type: "LoraLoader",
      inputs: {
        lora_name: "cinematic-lighting-v1.safetensors",
        strength_model: 0.8,
        strength_clip: 0.7
      }
    }
  };

  const fakeRenderResult: ExecuteProfileRenderResult = {
    status: "succeeded",
    promptId: "prompt-12345",
    outputObjectKeys: ["renders/job-789/output.mp4"],
    durationMs: 4250,
    profile: {
      profileId: "ltx-25-720p-97f",
      renderProfileKey: "LTX_25_720P_5S_V1",
      renderProfileVersion: 1,
      engine: "ltx_25",
      workflowSha256: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
      modelSha256: {},
      runnerProfile: "dynamicvram-offload-v1",
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
    },
    preDispatchGpu: {
      totalVramMb: 24576,
      usedVramMb: 4096,
      freeVramMb: 20480,
      reservedVramMb: 4096,
      measuredAt: "2026-08-29T10:04:55.000Z"
    }
  };

  const fakeMediaObjects: PutObjectInput[] = [
    {
      bucket: "godzspeed-delivery",
      key: "scenes/scene-123/jobs/job-789/output.mp4",
      body: new Uint8Array([1, 2, 3, 4]),
      checksumSha256: "4444444444444444444444444444444444444444444444444444444444444444",
      contentType: "video/mp4"
    }
  ];

  const fakeReferenceAssets: ReferenceAsset[] = [
    {
      id: "ref-101" as ReferenceAssetId,
      sceneId: fakeSceneId,
      assetType: "brand_logo",
      storageBucket: "godzspeed-reference",
      storageObjectKey: "refs/logo.png",
      contentHashSha256: "5555555555555555555555555555555555555555555555555555555555555555"
    }
  ];

  function createTestDeps(
    overrides?: Partial<AssembleGenerationManifestDeps>
  ): AssembleGenerationManifestDeps {
    const hashBytes: HashBytesPort = overrides?.hashBytes ?? {
      hashBytes: async (bytes) => `hash-${bytes.length}`
    };
    const sceneRepository: SceneRepository = overrides?.sceneRepository ?? {
      findById: async (id) => (id === fakeSceneId ? fakeScene : undefined),
      save: async () => {}
    };
    const referenceAssetRepository: ReferenceAssetRepository =
      overrides?.referenceAssetRepository ?? {
        listBySceneId: async (id) => (id === fakeSceneId ? fakeReferenceAssets : [])
      };
    const storyboardCandidateRepository: StoryboardCandidateRepository =
      overrides?.storyboardCandidateRepository ?? {
        findById: async (id) => (id === fakeCandidate.id ? fakeCandidate : undefined),
        insert: async () => {},
        listBySceneAndRevision: async () => [fakeCandidate]
      };

    return {
      hashBytes,
      sceneRepository,
      referenceAssetRepository,
      storyboardCandidateRepository
    };
  }

  function createDefaultInput(overrides?: Partial<AssembleManifestInput>): AssembleManifestInput {
    return {
      job: fakeJob,
      profile: fakeProfile,
      renderResult: fakeRenderResult,
      provenance: fakeProvenance,
      workflow: fakeWorkflow,
      mediaObjects: fakeMediaObjects,
      ...overrides
    };
  }

  it("assembles a complete GenerationManifest with all 16 minimum §5.5 fields", async () => {
    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);

    const input = createDefaultInput({
      approvedCandidateId: fakeCandidate.id
    });

    const result = await assembler.assemble(input);
    const { manifestPayload } = result;

    expect(manifestPayload).toBeDefined();

    // 1. Identity fields
    expect(manifestPayload.manifestId).toBe(fakeJobId);
    expect(manifestPayload.jobId).toBe(fakeJobId);
    expect(manifestPayload.promptIdComfy).toBe("prompt-12345");
    expect(manifestPayload.campaignId).toBe(fakeCampaignId);
    expect(manifestPayload.sceneId).toBe(fakeSceneId);

    // 2. Render attempt & timestamp
    expect(manifestPayload.renderAttempt).toBe(1);
    expect(manifestPayload.renderedAt).toBe("2026-08-29T10:05:00.000Z");

    // 3. Engine & profile identity
    expect(manifestPayload.engine).toBe("ltx_25");
    expect(manifestPayload.renderProfile).toBe("ltx-25-720p-97f");

    // 4. Model SHA-256 hashes
    expect(manifestPayload.models).toEqual([
      {
        key: "diffusion_models/ltx-2.5.safetensors",
        category: "diffusion_models",
        sha256: "1111111111111111111111111111111111111111111111111111111111111111",
        bytes: 20000000000
      },
      {
        key: "clip/gemma4.safetensors",
        category: "clip",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        bytes: 10000000000
      },
      {
        key: "vae/ltx-vae.safetensors",
        category: "vae",
        sha256: "3333333333333333333333333333333333333333333333333333333333333333",
        bytes: 500000000
      }
    ]);

    // 5. Workflow template identity / hash
    expect(manifestPayload.workflow).toEqual({
      templateId: "ltx-25-720p-97f",
      sha256: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539"
    });

    // 6. LoRA identities/strengths
    expect(manifestPayload.loras).toEqual([
      {
        name: "cinematic-lighting-v1.safetensors",
        strengthModel: 0.8,
        strengthClip: 0.7
      }
    ]);

    // 7. Sampling parameters
    expect(manifestPayload.sampling).toEqual({
      seed: 42,
      steps: 8,
      cfg: 1,
      sampler: "euler",
      scheduler: "simple",
      denoise: 1
    });

    // 8. Dimensions, frame count, FPS
    expect(manifestPayload.dimensions).toEqual({ width: 1280, height: 720 });
    expect(manifestPayload.frameCount).toBe(97);
    expect(manifestPayload.fps).toBe(97 / 5);

    // 9. Prompts & audio prompt (audioPrompt is explicitly null for video-only LTX profile)
    expect(manifestPayload.prompts).toEqual({
      prompt: "A beautiful cinematic sunrise",
      negativePrompt: "low quality, blurry",
      audioPrompt: null
    });

    // 10. Persistent ReferenceAsset identities
    expect(manifestPayload.referenceAssets).toEqual([
      {
        id: "ref-101",
        assetType: "brand_logo",
        storageBucket: "godzspeed-reference",
        storageObjectKey: "refs/logo.png",
        contentHashSha256: "5555555555555555555555555555555555555555555555555555555555555555"
      }
    ]);

    // 11. Approved StoryboardCandidate identity/hash
    expect(manifestPayload.approvedCandidate).toEqual({
      id: fakeCandidate.id,
      contentHash: fakeCandidate.contentHash,
      specRevision: 1,
      variantOrdinal: 1
    });

    // 12. ComfyUI commit / custom-node environment
    expect(manifestPayload.environment).toEqual({
      comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
      customNodes: [
        {
          name: "ComfyUI-LTXTricks",
          commit: "abcdef1234567890abcdef1234567890abcdef12",
          status: "tracked"
        }
      ]
    });

    // 13. Runner profile & runtime metadata
    expect(manifestPayload.runnerProfile).toBe("dynamicvram-offload-v1");
    expect(manifestPayload.runtimeMetadata).toEqual({
      promptId: "prompt-12345",
      durationMs: 4250,
      preDispatchGpu: fakeRenderResult.preDispatchGpu
    });

    // 14. Governance / license / policy identity
    expect(manifestPayload.governance).toEqual({
      license: "GPL-3.0",
      sourceKind: "validated_host_export",
      sourceUri: "https://github.com/comfyanonymous/ComfyUI",
      sourceRevision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
    });

    // 15. Outputs & execution duration
    expect(manifestPayload.outputs).toEqual([
      {
        bucket: "godzspeed-delivery",
        key: "scenes/scene-123/jobs/job-789/output.mp4",
        filename: "output.mp4",
        checksumSha256: "4444444444444444444444444444444444444444444444444444444444444444",
        contentType: "video/mp4"
      }
    ]);
    expect(manifestPayload.outputObjectKeys).toEqual(["renders/job-789/output.mp4"]);
    expect(manifestPayload.executionDurationMs).toBe(4250);
  });

  it("produces deterministic SHA-256 and identical output for identical stable inputs", async () => {
    const nodeHashBytes: HashBytesPort = {
      hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
    };
    const deps = createTestDeps({ hashBytes: nodeHashBytes });
    const assembler = new AssembleGenerationManifest(deps);

    const knownBytes = new Uint8Array([1, 2, 3, 4]);
    const expectedSha256 = "9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a";

    const mediaWithoutChecksum: PutObjectInput[] = [
      {
        bucket: "godzspeed-delivery",
        key: "scenes/scene-123/jobs/job-789/output.mp4",
        body: knownBytes
      }
    ];

    const input = createDefaultInput({
      approvedCandidateId: fakeCandidate.id,
      mediaObjects: mediaWithoutChecksum
    });

    const result1 = await assembler.assemble(input);
    const result2 = await assembler.assemble(input);

    const output1 = result1.manifestPayload.outputs as Array<{ checksumSha256: string }>;
    const output2 = result2.manifestPayload.outputs as Array<{ checksumSha256: string }>;

    expect(output1[0]?.checksumSha256).toBe(expectedSha256);
    expect(output2[0]?.checksumSha256).toBe(expectedSha256);
    expect(output1[0]?.checksumSha256).toHaveLength(64);

    expect(JSON.stringify(result1.manifestPayload)).toEqual(
      JSON.stringify(result2.manifestPayload)
    );
  });

  it("omits approvedCandidate field when approvedCandidateId is not provided", async () => {
    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);
    const input = createDefaultInput(); // no approvedCandidateId

    const result = await assembler.assemble(input);
    expect("approvedCandidate" in result.manifestPayload).toBe(false);
  });

  it("falls back to profile models with category 'loras' when workflow has no LoRA nodes", async () => {
    const profileWithLora: ManifestSourceProfile = {
      ...fakeProfile,
      models: [
        ...fakeProfile.models!,
        { category: "loras", relativePath: "film-grain-v2.safetensors" }
      ]
    };
    const workflowWithoutLoras: RenderWorkflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1
        }
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "Positive prompt" }
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "Negative prompt" }
      }
    };
    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);
    const input = createDefaultInput({
      profile: profileWithLora,
      workflow: workflowWithoutLoras
    });

    const result = await assembler.assemble(input);
    expect(result.manifestPayload.loras).toEqual([{ name: "film-grain-v2.safetensors" }]);
  });

  it("extracts loras from workflow CR Load LoRA nodes when present", async () => {
    const workflowWithCrLora: RenderWorkflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1
        }
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "Positive prompt" }
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "Negative prompt" }
      },
      "10": {
        class_type: "CR Load LoRA",
        inputs: {
          lora_name: "cr-vintage-film.safetensors",
          strength_model: 0.6,
          strength_clip: 0.5
        }
      }
    };
    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);
    const input = createDefaultInput({ workflow: workflowWithCrLora });

    const result = await assembler.assemble(input);
    expect(result.manifestPayload.loras).toEqual([
      {
        name: "cr-vintage-film.safetensors",
        strengthModel: 0.6,
        strengthClip: 0.5
      }
    ]);
  });

  it("extracts positive and negative prompts by node order when node 3/4 are not present", async () => {
    const customWorkflow: RenderWorkflow = {
      "100": {
        class_type: "KSampler",
        inputs: {
          seed: 99,
          steps: 20,
          cfg: 7.5,
          sampler_name: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1
        }
      },
      "201": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "Positive prompt from first node"
        }
      },
      "202": {
        class_type: "CLIPTextEncode",
        inputs: {
          text: "Negative prompt from second node"
        }
      }
    };

    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);
    const input = createDefaultInput({
      profile: {
        ...fakeProfile,
        id: "custom-video-profile",
        engine: "custom_video",
        renderProfileIdentity: null
      },
      workflow: customWorkflow
    });

    const result = await assembler.assemble(input);
    expect(result.manifestPayload.prompts).toEqual({
      prompt: "Positive prompt from first node",
      negativePrompt: "Negative prompt from second node",
      audioPrompt: null
    });
  });

  it("extracts audioPrompt from workflow audio node when present for custom/audio-capable profile", async () => {
    const workflowWithAudio: RenderWorkflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1
        }
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "Positive prompt text" }
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "Negative prompt text" }
      },
      "50": {
        class_type: "AudioCLIPTextEncode",
        inputs: { text: "Gentle ocean waves audio" }
      }
    };
    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);
    const input = createDefaultInput({
      profile: {
        ...fakeProfile,
        id: "custom-audio-profile",
        engine: "custom_audio",
        renderProfileIdentity: null
      },
      workflow: workflowWithAudio
    });

    const result = await assembler.assemble(input);
    expect(result.manifestPayload.prompts).toEqual({
      prompt: "Positive prompt text",
      negativePrompt: "Negative prompt text",
      audioPrompt: "Gentle ocean waves audio"
    });
  });

  it("throws when workflow has ambiguous multiple audio prompt nodes", async () => {
    const ambiguousAudioWorkflow: RenderWorkflow = {
      "1": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1
        }
      },
      "3": { class_type: "CLIPTextEncode", inputs: { text: "Positive prompt text" } },
      "50": { class_type: "AudioCLIPTextEncode", inputs: { text: "Ocean waves" } },
      "51": { class_type: "PromptAudio", inputs: { prompt: "Thunderstorm" } }
    };
    const deps = createTestDeps();
    const assembler = new AssembleGenerationManifest(deps);
    const input = createDefaultInput({
      profile: {
        ...fakeProfile,
        id: "custom-profile",
        engine: "custom_engine",
        renderProfileIdentity: null
      },
      workflow: ambiguousAudioWorkflow
    });

    await expect(assembler.assemble(input)).rejects.toThrow(IncompleteManifestError);
    await expect(assembler.assemble(input)).rejects.toThrow(/ambiguous audio prompt target nodes/);
  });

  it("uses hashBytesPort to hash media object body when checksumSha256 is not pre-computed", async () => {
    let hashCalls = 0;
    const deps = createTestDeps({
      hashBytes: {
        hashBytes: async (bytes) => {
          hashCalls++;
          return `computed-hash-${bytes.length}`;
        }
      }
    });

    const assembler = new AssembleGenerationManifest(deps);
    const mediaWithoutHash: PutObjectInput[] = [
      {
        bucket: "godzspeed-delivery",
        key: "scenes/scene-123/jobs/job-789/rendered.mp4",
        body: new Uint8Array([9, 8, 7])
      }
    ];

    const input = createDefaultInput({ mediaObjects: mediaWithoutHash });
    const result = await assembler.assemble(input);

    expect(hashCalls).toBe(1);
    expect(result.manifestPayload.outputs).toEqual([
      {
        bucket: "godzspeed-delivery",
        key: "scenes/scene-123/jobs/job-789/rendered.mp4",
        filename: "rendered.mp4",
        checksumSha256: "computed-hash-3"
      }
    ]);
  });

  describe("IncompleteManifestError regression tests for missing required fields", () => {
    it("throws when scene cannot be found (missing campaignId)", async () => {
      const deps = createTestDeps({
        sceneRepository: {
          findById: async () => undefined,
          save: async () => {}
        }
      });
      const assembler = new AssembleGenerationManifest(deps);
      await expect(assembler.assemble(createDefaultInput())).rejects.toThrow(
        new IncompleteManifestError("campaignId")
      );
    });

    it("throws when provenance.generatedAt is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        provenance: { ...fakeProvenance, generatedAt: "" }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("renderedAt")
      );
    });

    it("throws when profile.engine is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: { ...fakeProfile, engine: "" }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("engine")
      );
    });

    it("throws when profile.id is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: { ...fakeProfile, id: "" }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("renderProfile")
      );
    });

    it("throws when provenance.workflow.sha256 is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        provenance: {
          ...fakeProvenance,
          workflow: { sha256: "" }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("workflow.sha256")
      );
    });

    it("throws when sampling parameters are missing and workflow is omitted", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const jobWithoutSeed: RenderJob = {
        ...fakeJob,
        injectedPayload: {}
      };
      const input = createDefaultInput({
        job: jobWithoutSeed,
        workflow: undefined
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("sampling")
      );
    });

    it("throws when baseline width is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: {
          ...fakeProfile,
          baseline: {
            height: 720,
            frames: 97,
            steps: 8,
            approximateDurationSeconds: 5
          }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("dimensions.width")
      );
    });

    it("throws when baseline height is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: {
          ...fakeProfile,
          baseline: {
            width: 1280,
            frames: 97,
            steps: 8,
            approximateDurationSeconds: 5
          }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("dimensions.height")
      );
    });

    it("throws when baseline frames is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: {
          ...fakeProfile,
          baseline: {
            width: 1280,
            height: 720,
            steps: 8,
            approximateDurationSeconds: 5
          }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("frameCount")
      );
    });

    it("throws when approximateDurationSeconds is missing for FPS calculation", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: {
          ...fakeProfile,
          baseline: {
            width: 1280,
            height: 720,
            frames: 97,
            steps: 8
          }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(new IncompleteManifestError("fps"));
    });

    it("throws when prompt cannot be sourced", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const workflowWithoutPrompts: RenderWorkflow = {
        "1": {
          class_type: "KSampler",
          inputs: {
            seed: 42,
            steps: 8,
            cfg: 1,
            sampler_name: "euler",
            scheduler: "simple",
            denoise: 1
          }
        }
      };
      const jobWithoutPrompt: RenderJob = {
        ...fakeJob,
        injectedPayload: {}
      };
      const input = createDefaultInput({
        job: jobWithoutPrompt,
        workflow: workflowWithoutPrompts
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("prompts")
      );
    });

    it("throws when ambiguous audioPrompt nodes exist in workflow", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const ambiguousWorkflow: RenderWorkflow = {
        ...fakeWorkflow,
        "50": {
          class_type: "AudioCLIPTextEncode",
          inputs: { text: "Audio 1" }
        },
        "51": {
          class_type: "AudioCLIPTextEncode",
          inputs: { text: "Audio 2" }
        }
      };
      const input = createDefaultInput({
        profile: {
          ...fakeProfile,
          id: "custom-profile",
          engine: "custom_engine",
          renderProfileIdentity: null
        },
        workflow: ambiguousWorkflow
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        /ambiguous audio prompt target nodes in workflow/
      );
    });

    it("throws when approvedCandidateId is specified but not found in repository", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        approvedCandidateId: "nonexistent-candidate" as CandidateId
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("approvedCandidate")
      );
    });

    it("throws when candidate belongs to a different scene (cross-scene candidate)", async () => {
      const crossSceneCandidate: StoryboardCandidate = {
        ...fakeCandidate,
        sceneId: "different-scene-456" as SceneId
      };
      const deps = createTestDeps({
        storyboardCandidateRepository: {
          findById: async () => crossSceneCandidate,
          insert: async () => {},
          listBySceneAndRevision: async () => [crossSceneCandidate]
        }
      });
      const assembler = new AssembleGenerationManifest(deps);
      const input = createDefaultInput({
        approvedCandidateId: crossSceneCandidate.id
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("approvedCandidate")
      );
    });

    it("throws when candidate spec revision does not match current scene revision (stale revision)", async () => {
      const staleCandidate: StoryboardCandidate = {
        ...fakeCandidate,
        specRevision: 2
      };
      const deps = createTestDeps({
        storyboardCandidateRepository: {
          findById: async () => staleCandidate,
          insert: async () => {},
          listBySceneAndRevision: async () => [staleCandidate]
        }
      });
      const assembler = new AssembleGenerationManifest(deps);
      const input = createDefaultInput({
        approvedCandidateId: staleCandidate.id
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("approvedCandidate")
      );
    });

    it("throws when candidate is not the selected candidate on the scene (unselected candidate)", async () => {
      const unselectedCandidate: StoryboardCandidate = {
        ...fakeCandidate,
        id: "cand-different-unselected" as CandidateId
      };
      const deps = createTestDeps({
        storyboardCandidateRepository: {
          findById: async () => unselectedCandidate,
          insert: async () => {},
          listBySceneAndRevision: async () => [unselectedCandidate]
        }
      });
      const assembler = new AssembleGenerationManifest(deps);
      const input = createDefaultInput({
        approvedCandidateId: unselectedCandidate.id
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("approvedCandidate")
      );
    });

    it("throws when scene has not been approved for candidate revision", async () => {
      const unapprovedScene = Scene.reconstitute({
        id: fakeSceneId,
        campaignId: fakeCampaignId,
        status: "director_review",
        specRevision: 1,
        configuration: {
          prompt: "A beautiful cinematic sunrise",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000
        },
        selectedCandidateId: fakeCandidate.id,
        selectedCandidateRevision: 1
      });
      const deps = createTestDeps({
        sceneRepository: {
          findById: async () => unapprovedScene,
          save: async () => {}
        }
      });
      const assembler = new AssembleGenerationManifest(deps);
      const input = createDefaultInput({
        approvedCandidateId: fakeCandidate.id
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("approvedCandidate")
      );
    });

    it("throws when comfyUiCommit is missing in provenance", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        provenance: {
          ...fakeProvenance,
          git: { comfyUiCommit: "", customNodes: [] }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("comfyUiCommit")
      );
    });

    it("throws when runnerProfile is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: { ...fakeProfile, runnerProfile: "" }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("runnerProfile")
      );
    });

    it("throws when governance license is missing", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        profile: {
          ...fakeProfile,
          source: { ...fakeProfile.source, license: "" }
        }
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("governance.license")
      );
    });

    it("throws when mediaObjects is empty", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const input = createDefaultInput({
        mediaObjects: []
      });
      await expect(assembler.assemble(input)).rejects.toThrow(
        new IncompleteManifestError("outputs")
      );
    });

    it("throws when renderResult promptId is missing or empty", async () => {
      const assembler = new AssembleGenerationManifest(createTestDeps());
      const inputEmpty = createDefaultInput({
        renderResult: {
          ...fakeRenderResult,
          promptId: ""
        }
      });
      await expect(assembler.assemble(inputEmpty)).rejects.toThrow(
        new IncompleteManifestError("promptIdComfy")
      );

      const inputWhitespace = createDefaultInput({
        renderResult: {
          ...fakeRenderResult,
          promptId: "   "
        }
      });
      await expect(assembler.assemble(inputWhitespace)).rejects.toThrow(
        new IncompleteManifestError("promptIdComfy")
      );
    });
  });
});
