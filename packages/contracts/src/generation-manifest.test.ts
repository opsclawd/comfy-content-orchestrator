import { describe, expect, it } from "vitest";
import { GenerationManifestSchema, type GenerationManifest } from "./generation-manifest.js";

describe("GenerationManifestSchema", () => {
  const baseManifestFixture = {
    manifestId: "00000000-0000-4000-8000-000000000001",
    jobId: "00000000-0000-4000-8000-000000000002",
    promptIdComfy: "comfy-prompt-123",
    campaignId: "00000000-0000-4000-8000-000000000003",
    sceneId: "00000000-0000-4000-8000-000000000004",
    renderAttempt: 1,
    renderedAt: "2026-09-26T00:00:00.000Z",
    engine: "minimax_h3_ref2v",
    renderProfile: "MINIMAX_H3_720P_5S_REF2V_V1",
    renderProfileVersion: 1,
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
      seed: 42,
      steps: 20,
      cfg: 1.0,
      sampler: "euler",
      scheduler: "linear",
      denoise: 1.0
    },
    dimensions: {
      width: 1344,
      height: 768
    },
    frameCount: 124,
    fps: 24,
    prompts: {
      prompt: "A cinematic reference directed render",
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
      promptId: "comfy-prompt-123",
      durationMs: 45000
    },
    governance: {
      license: "MiniMax Community License",
      sourceKind: "validated_host_export"
    },
    outputs: [
      {
        bucket: "delivery",
        key: "scenes/scene-1/output.mp4",
        filename: "output.mp4",
        checksumSha256: "1111111111111111111111111111111111111111111111111111111111111111"
      }
    ],
    outputObjectKeys: ["output.mp4"],
    executionDurationMs: 45000
  };

  it("validates a reference_directed manifest with valid ShotPlan and referenceImages", () => {
    const validManifest: GenerationManifest = {
      ...baseManifestFixture,
      routingMode: "reference_directed",
      shotPlan: {
        id: "11111111-1111-4111-8111-111111111111",
        specRevision: 2
      },
      executedInstruction: {
        text: "Compiled shot instruction with <Picture 1>",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 42
      },
      referenceImages: [
        {
          slotIndex: 1,
          promptTag: "<Picture 1>",
          assetId: "33333333-3333-4333-8333-333333333333",
          contentHashSha256: "4444444444444444444444444444444444444444444444444444444444444444",
          role: "subject_identity",
          stagedAs: { name: "ref-1.png", subfolder: "" },
          injectionTarget: { nodeId: "201", classType: "LoadImage", inputField: "image" }
        }
      ],
      previsReviewEvidence: {
        candidateId: "55555555-5555-4555-8555-555555555555",
        contentHashSha256: "6666666666666666666666666666666666666666666666666666666666666666",
        specRevision: 2
      }
    };

    const parsed = GenerationManifestSchema.safeParse(validManifest);
    expect(parsed.success).toBe(true);
  });

  it("validates a prompt-only (0 references) reference_directed manifest", () => {
    const promptOnlyManifest: GenerationManifest = {
      ...baseManifestFixture,
      routingMode: "reference_directed",
      shotPlan: {
        id: "11111111-1111-4111-8111-111111111111",
        specRevision: 1
      },
      executedInstruction: {
        text: "Compiled shot instruction with 0 pictures",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 40
      },
      referenceImages: []
    };

    const parsed = GenerationManifestSchema.safeParse(promptOnlyManifest);
    expect(parsed.success).toBe(true);
  });

  it("fails closed on False Conditioning Invariant when candidate executionConditioning is present on reference_directed", () => {
    const invalidManifest = {
      ...baseManifestFixture,
      routingMode: "reference_directed",
      shotPlan: {
        id: "11111111-1111-4111-8111-111111111111",
        specRevision: 1
      },
      executedInstruction: {
        text: "Instruction",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 11
      },
      referenceImages: [],
      executionConditioning: {
        candidateId: "55555555-5555-4555-8555-555555555555",
        contentHashSha256: "6666666666666666666666666666666666666666666666666666666666666666"
      }
    };

    const parsed = GenerationManifestSchema.safeParse(invalidManifest);
    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.some((i) => i.message.includes("False Conditioning Invariant"))
    ).toBe(true);
  });

  it("fails closed if routingMode reference_directed has profile mismatch", () => {
    const invalidManifest = {
      ...baseManifestFixture,
      renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
      engine: "minimax_h3_i2v",
      routingMode: "reference_directed",
      shotPlan: {
        id: "11111111-1111-4111-8111-111111111111",
        specRevision: 1
      },
      executedInstruction: {
        text: "Instruction",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 11
      },
      referenceImages: []
    };

    const parsed = GenerationManifestSchema.safeParse(invalidManifest);
    expect(parsed.success).toBe(false);
    expect(
      parsed.error?.issues.some((i) =>
        i.message.includes('routingMode "reference_directed" requires profile')
      )
    ).toBe(true);
  });

  it("fails closed if referenceImages cardinality exceeds 9", () => {
    const invalidRefImages = Array.from({ length: 10 }, (_, i) => ({
      slotIndex: i + 1,
      promptTag: `<Picture ${i + 1}>`,
      assetId: "33333333-3333-4333-8333-333333333333",
      contentHashSha256: "4444444444444444444444444444444444444444444444444444444444444444",
      role: "subject_identity",
      stagedAs: { name: `ref-${i + 1}.png`, subfolder: "" },
      injectionTarget: { nodeId: `${201 + i}`, classType: "LoadImage", inputField: "image" }
    }));

    const invalidManifest = {
      ...baseManifestFixture,
      routingMode: "reference_directed",
      shotPlan: {
        id: "11111111-1111-4111-8111-111111111111",
        specRevision: 1
      },
      executedInstruction: {
        text: "Instruction",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 11
      },
      referenceImages: invalidRefImages
    };

    const parsed = GenerationManifestSchema.safeParse(invalidManifest);
    expect(parsed.success).toBe(false);
  });

  it("validates a frame_anchored manifest and rejects referenceImages", () => {
    const validFrameAnchored = {
      ...baseManifestFixture,
      engine: "minimax_h3_i2v",
      renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
      routingMode: "frame_anchored" as const,
      firstFrame: {
        anchorType: "first_frame" as const,
        candidateId: "55555555-5555-4555-8555-555555555555",
        contentHashSha256: "6666666666666666666666666666666666666666666666666666666666666666",
        stagedAs: { name: "anchor.png", subfolder: "" },
        injectionTarget: { nodeId: "20", classType: "LoadImage", inputField: "image" }
      }
    };

    expect(GenerationManifestSchema.safeParse(validFrameAnchored).success).toBe(true);

    const invalidFrameAnchoredWithRefs = {
      ...validFrameAnchored,
      referenceImages: [
        {
          slotIndex: 1,
          promptTag: "<Picture 1>",
          assetId: "33333333-3333-4333-8333-333333333333",
          contentHashSha256: "4444444444444444444444444444444444444444444444444444444444444444",
          role: "subject_identity",
          stagedAs: { name: "ref-1.png", subfolder: "" },
          injectionTarget: { nodeId: "201", classType: "LoadImage", inputField: "image" }
        }
      ]
    };
    expect(GenerationManifestSchema.safeParse(invalidFrameAnchoredWithRefs).success).toBe(false);
  });

  it("fails closed on one-sided profile/engine mismatch for reference_directed", () => {
    // Correct profile, wrong engine
    const mismatchEngine = {
      ...baseManifestFixture,
      renderProfile: "MINIMAX_H3_720P_5S_REF2V_V1",
      engine: "minimax_h3_i2v",
      routingMode: "reference_directed",
      shotPlan: { id: "11111111-1111-4111-8111-111111111111", specRevision: 1 },
      executedInstruction: {
        text: "Instruction",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 11
      },
      referenceImages: []
    };
    expect(GenerationManifestSchema.safeParse(mismatchEngine).success).toBe(false);

    // Wrong profile, correct engine
    const mismatchProfile = {
      ...baseManifestFixture,
      renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
      engine: "minimax_h3_ref2v",
      routingMode: "reference_directed",
      shotPlan: { id: "11111111-1111-4111-8111-111111111111", specRevision: 1 },
      executedInstruction: {
        text: "Instruction",
        sha256: "2222222222222222222222222222222222222222222222222222222222222222",
        byteLength: 11
      },
      referenceImages: []
    };
    expect(GenerationManifestSchema.safeParse(mismatchProfile).success).toBe(false);
  });

  it("fails closed on one-sided profile/engine mismatch for frame_anchored", () => {
    const validFrameAnchoredBase = {
      ...baseManifestFixture,
      routingMode: "frame_anchored" as const,
      firstFrame: {
        anchorType: "first_frame" as const,
        candidateId: "55555555-5555-4555-8555-555555555555",
        contentHashSha256: "6666666666666666666666666666666666666666666666666666666666666666",
        stagedAs: { name: "anchor.png", subfolder: "" },
        injectionTarget: { nodeId: "20", classType: "LoadImage", inputField: "image" }
      }
    };

    // Correct I2V profile, wrong engine
    const mismatchEngine = {
      ...validFrameAnchoredBase,
      renderProfile: "MINIMAX_H3_720P_5S_I2V_V1",
      engine: "minimax_h3_ref2v"
    };
    expect(GenerationManifestSchema.safeParse(mismatchEngine).success).toBe(false);

    // Wrong profile (REF2V), matching I2V engine
    const mismatchProfile = {
      ...validFrameAnchoredBase,
      renderProfile: "MINIMAX_H3_720P_5S_REF2V_V1",
      engine: "minimax_h3_i2v"
    };
    expect(GenerationManifestSchema.safeParse(mismatchProfile).success).toBe(false);
  });
});
