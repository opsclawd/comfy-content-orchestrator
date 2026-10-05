import { describe, expect, it } from "vitest";
import {
  computeProductionInputFingerprint,
  H3ProductionInspectionReadModelSchema,
  type ComputeProductionInputFingerprintInput,
  type H3ProductionInspectionReadModel
} from "./production-inspection.js";

describe("production-inspection contracts", () => {
  const baseFingerprintInput: ComputeProductionInputFingerprintInput = {
    sceneId: "11111111-1111-4111-8111-111111111111",
    specRevision: 2,
    shotPlanId: "22222222-2222-4222-8222-222222222222",
    routingMode: "reference_directed",
    renderProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
    workflowTemplate: "minimax-h3-720p-124f-ref2v",
    targetDurationMs: 5167,
    targetFrameCount: 124,
    fps: 24,
    width: 1344,
    height: 768,
    compiledInstructionText: "[Scene Context]: Elena on the beach\n\n[Camera]: WIDE\n\n<Picture 1>",
    compiledInstructionSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    references: [
      {
        slotIndex: 1,
        referenceAssetId: "33333333-3333-4333-8333-333333333333",
        role: "subject_identity",
        contentHashSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    ]
  };

  const validReadModel: H3ProductionInspectionReadModel = {
    authority: {
      sceneId: "11111111-1111-4111-8111-111111111111",
      specRevision: 2,
      shotPlanId: "22222222-2222-4222-8222-222222222222",
      variantOrdinal: 1,
      shotPlanStatus: "approved",
      isCurrentRevision: true
    },
    route: {
      routingMode: "reference_directed",
      renderProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
      workflowTemplate: "minimax-h3-720p-124f-ref2v",
      targetDurationMs: 5167,
      targetFrameCount: 124,
      fps: 24,
      width: 1344,
      height: 768
    },
    visualInputs: {
      references: [
        {
          slotIndex: 1,
          promptTag: "<Picture 1>",
          referenceAssetId: "33333333-3333-4333-8333-333333333333",
          displayName: "Elena Beach Stroll",
          role: "subject_identity",
          contentHashSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          previewUrl: "https://minio.local/preview.png",
          previewAvailability: "available"
        }
      ],
      frameAnchor: null
    },
    instruction: {
      compiledText: "[Scene Context]: Elena on the beach\n\n[Camera]: WIDE\n\n<Picture 1>",
      compiledSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      cameraIntentSummary: {
        framing: "wide",
        angle: "eye_level",
        cameraMovement: "tracking",
        movementSpeed: "medium",
        lensIntent: "35mm prime",
        cameraPosition: "eye level, tripod",
        cameraPromptDescription: "Tracking Elena as she walks"
      }
    },
    admission: {
      readiness: "ready",
      blockers: []
    },
    runtimeContext: {
      durationCeilingSeconds: 60
    },
    productionInputFingerprint: computeProductionInputFingerprint(baseFingerprintInput)
  };

  it("validates a compliant H3ProductionInspectionReadModel schema", () => {
    const parsed = H3ProductionInspectionReadModelSchema.parse(validReadModel);
    expect(parsed.admission.readiness).toBe("ready");
    expect(parsed.route.routingMode).toBe("reference_directed");
    expect(parsed.visualInputs.references).toHaveLength(1);
    expect(parsed.visualInputs.references[0]?.promptTag).toBe("<Picture 1>");
  });

  it("computes identical deterministic fingerprint regardless of property declaration order", () => {
    const hash1 = computeProductionInputFingerprint(baseFingerprintInput);
    // Reverse key order in object
    const reordered: ComputeProductionInputFingerprintInput = {
      workflowTemplate: baseFingerprintInput.workflowTemplate,
      targetFrameCount: baseFingerprintInput.targetFrameCount,
      targetDurationMs: baseFingerprintInput.targetDurationMs,
      specRevision: baseFingerprintInput.specRevision,
      shotPlanId: baseFingerprintInput.shotPlanId,
      sceneId: baseFingerprintInput.sceneId,
      routingMode: baseFingerprintInput.routingMode,
      renderProfileKey: baseFingerprintInput.renderProfileKey,
      references: baseFingerprintInput.references,
      height: baseFingerprintInput.height,
      width: baseFingerprintInput.width,
      fps: baseFingerprintInput.fps,
      compiledInstructionText: baseFingerprintInput.compiledInstructionText,
      compiledInstructionSha256: baseFingerprintInput.compiledInstructionSha256
    };
    const hash2 = computeProductionInputFingerprint(reordered);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes fingerprint when specRevision changes", () => {
    const hashOriginal = computeProductionInputFingerprint(baseFingerprintInput);
    const hashModified = computeProductionInputFingerprint({
      ...baseFingerprintInput,
      specRevision: 3
    });
    expect(hashModified).not.toBe(hashOriginal);
  });

  it("changes fingerprint when shotPlanId changes", () => {
    const hashOriginal = computeProductionInputFingerprint(baseFingerprintInput);
    const hashModified = computeProductionInputFingerprint({
      ...baseFingerprintInput,
      shotPlanId: "99999999-9999-4999-8999-999999999999"
    });
    expect(hashModified).not.toBe(hashOriginal);
  });

  it("changes fingerprint when compiled instruction changes", () => {
    const hashOriginal = computeProductionInputFingerprint(baseFingerprintInput);
    const hashModified = computeProductionInputFingerprint({
      ...baseFingerprintInput,
      compiledInstructionText: "Different text",
      compiledInstructionSha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    });
    expect(hashModified).not.toBe(hashOriginal);
  });

  it("changes fingerprint when reference asset or role changes", () => {
    const hashOriginal = computeProductionInputFingerprint(baseFingerprintInput);
    const hashModified = computeProductionInputFingerprint({
      ...baseFingerprintInput,
      references: [
        {
          slotIndex: 1,
          referenceAssetId: "44444444-4444-4444-8444-444444444444",
          role: "product",
          contentHashSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        }
      ]
    });
    expect(hashModified).not.toBe(hashOriginal);
  });

  it("changes fingerprint when reference slot order changes", () => {
    const twoRefsInput: ComputeProductionInputFingerprintInput = {
      ...baseFingerprintInput,
      references: [
        {
          slotIndex: 1,
          referenceAssetId: "33333333-3333-4333-8333-333333333333",
          role: "subject_identity",
          contentHashSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        {
          slotIndex: 2,
          referenceAssetId: "44444444-4444-4444-8444-444444444444",
          role: "product",
          contentHashSha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        }
      ]
    };
    const swappedSlotsInput: ComputeProductionInputFingerprintInput = {
      ...baseFingerprintInput,
      references: [
        {
          slotIndex: 2,
          referenceAssetId: "33333333-3333-4333-8333-333333333333",
          role: "subject_identity",
          contentHashSha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        },
        {
          slotIndex: 1,
          referenceAssetId: "44444444-4444-4444-8444-444444444444",
          role: "product",
          contentHashSha256: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
        }
      ]
    };
    const hashOriginal = computeProductionInputFingerprint(twoRefsInput);
    const hashSwapped = computeProductionInputFingerprint(swappedSlotsInput);
    expect(hashSwapped).not.toBe(hashOriginal);
  });

  it("computes distinct fingerprints for frame_anchored mode with anchor frame vs reference_directed", () => {
    const frameAnchoredInput: ComputeProductionInputFingerprintInput = {
      ...baseFingerprintInput,
      routingMode: "frame_anchored",
      renderProfileKey: "MINIMAX_H3_720P_5S_I2V_V1",
      workflowTemplate: "minimax-h3-720p-124f-i2v",
      references: [],
      frameAnchor: {
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "55555555-5555-4555-8555-555555555555",
        anchorMediaHashSha256: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      }
    };
    const hashRef = computeProductionInputFingerprint(baseFingerprintInput);
    const hashAnchor = computeProductionInputFingerprint(frameAnchoredInput);
    expect(hashAnchor).not.toBe(hashRef);
  });
});
