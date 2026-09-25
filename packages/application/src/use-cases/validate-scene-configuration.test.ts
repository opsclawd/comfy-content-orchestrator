import { describe, it, expect } from "vitest";
import type { ReferenceAsset, ReferenceAssetId, SceneId } from "@cco/domain";
import { ArchivedReferenceBindingError, CrossClientReferenceBindingError } from "@cco/domain";
import {
  validateSceneConfiguration,
  SceneConfigurationValidationError
} from "./validate-scene-configuration.js";

describe("validateSceneConfiguration", () => {
  const asset1Id = "11111111-1111-1111-1111-111111111111" as ReferenceAssetId;
  const asset2Id = "22222222-2222-2222-2222-222222222222" as ReferenceAssetId;

  const validAssetWithoutSceneId: ReferenceAsset = {
    id: asset1Id,
    clientId: "client-1",
    assetType: "brand_logo",
    storageBucket: "b",
    storageObjectKey: "k1",
    contentHashSha256: "h1"
  };

  const validAssetWithSceneId: ReferenceAsset = {
    id: asset2Id,
    sceneId: "scene-123" as SceneId,
    clientId: "client-1",
    assetType: "style_lora",
    storageBucket: "b",
    storageObjectKey: "k2",
    contentHashSha256: "h2"
  };

  const sampleResolvedAssets: readonly ReferenceAsset[] = [
    validAssetWithoutSceneId,
    validAssetWithSceneId
  ];

  const validCandidate = {
    prompt: "A cinematic shot of the product on a table",
    references: [
      {
        referenceId: asset1Id,
        role: "subject_identity" as const
      }
    ],
    engineProfileId: "LTX_25_720P_5S_V1",
    durationMs: 5000,
    loraConfigurationId: "lora-cfg-1"
  };

  it("validates a fully valid candidate configuration with references", () => {
    const result = validateSceneConfiguration(validCandidate, sampleResolvedAssets, 10000);

    expect(result).toEqual({
      prompt: "A cinematic shot of the product on a table",
      referenceIds: [asset1Id],
      referenceBindings: [
        {
          referenceAssetId: asset1Id,
          role: "subject_identity",
          weight: null,
          hints: null
        }
      ],
      engineProfileId: "LTX_25_720P_5S_V1",
      durationMs: 5000,
      loraConfigurationId: "lora-cfg-1"
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.referenceIds)).toBe(true);
    expect(Object.isFrozen(result.referenceBindings)).toBe(true);
  });

  it("validates candidate configuration using LTX_25_720P_5S_I2V_V1 engine profile", () => {
    const result = validateSceneConfiguration(
      {
        ...validCandidate,
        engineProfileId: "LTX_25_720P_5S_I2V_V1"
      },
      sampleResolvedAssets,
      10000
    );

    expect(result.engineProfileId).toBe("LTX_25_720P_5S_I2V_V1");
  });

  it("validates candidate configuration with empty references array", () => {
    const result = validateSceneConfiguration(
      {
        ...validCandidate,
        references: []
      },
      sampleResolvedAssets,
      10000
    );

    expect(result.referenceIds).toEqual([]);
    expect(result.referenceBindings).toBeUndefined();
  });

  it("rejects planner-supplied referenceIds field", () => {
    expect(() =>
      validateSceneConfiguration(
        {
          ...validCandidate,
          referenceIds: [asset1Id]
        },
        sampleResolvedAssets
      )
    ).toThrowError("referenceIds is not permitted in planner response; use references array");
  });

  it("rejects prohibited planner-supplied fields in candidate", () => {
    expect(() =>
      validateSceneConfiguration(
        {
          ...validCandidate,
          sceneId: "scene-fake"
        },
        sampleResolvedAssets
      )
    ).toThrowError("sceneId cannot be supplied by planner");

    expect(() =>
      validateSceneConfiguration(
        {
          ...validCandidate,
          specRevision: 2
        },
        sampleResolvedAssets
      )
    ).toThrowError("specRevision cannot be supplied by planner");
  });

  it("rejects prohibited planner-supplied fields in references items", () => {
    expect(() =>
      validateSceneConfiguration(
        {
          ...validCandidate,
          references: [
            {
              referenceId: asset1Id,
              role: "subject_identity",
              weight: 0.8
            }
          ]
        },
        sampleResolvedAssets
      )
    ).toThrowError(
      "Planner references cannot include sceneId, specRevision, weight, hints, or archivedAt"
    );

    expect(() =>
      validateSceneConfiguration(
        {
          ...validCandidate,
          references: [
            {
              referenceId: asset1Id,
              role: "subject_identity",
              sceneId: "fake-scene"
            }
          ]
        },
        sampleResolvedAssets
      )
    ).toThrowError(
      "Planner references cannot include sceneId, specRevision, weight, hints, or archivedAt"
    );
  });

  it("rejects a reference assignment absent from resolvedReferenceAssets", () => {
    const absentValidUuid = "99999999-9999-9999-9999-999999999999";
    const candidate = {
      ...validCandidate,
      references: [
        {
          referenceId: absentValidUuid,
          role: "subject_identity" as const
        }
      ]
    };

    expect(() => validateSceneConfiguration(candidate, sampleResolvedAssets)).toThrowError(
      SceneConfigurationValidationError
    );
    expect(() => validateSceneConfiguration(candidate, sampleResolvedAssets)).toThrowError(
      `referenceId "${absentValidUuid}" is not present in resolved reference assets`
    );
  });

  it("witness scenario: an engineProfileId of 'not-a-certified-profile' is rejected via RenderProfileKeySchema failure", () => {
    const candidate = {
      ...validCandidate,
      engineProfileId: "not-a-certified-profile"
    };

    expect(() => validateSceneConfiguration(candidate, sampleResolvedAssets)).toThrowError(
      SceneConfigurationValidationError
    );
    expect(() => validateSceneConfiguration(candidate, sampleResolvedAssets)).toThrowError(
      'engineProfileId "not-a-certified-profile" is not a certified profile'
    );
  });

  it("allows same referenceId under distinct roles and derives unique referenceIds projection", () => {
    const candidate = {
      ...validCandidate,
      references: [
        {
          referenceId: asset1Id,
          role: "subject_identity" as const
        },
        {
          referenceId: asset1Id,
          role: "style" as const
        }
      ]
    };

    const result = validateSceneConfiguration(candidate, sampleResolvedAssets);
    expect(result.referenceIds).toEqual([asset1Id]);
    expect(result.referenceBindings).toHaveLength(2);
  });

  it("sorts referenceBindings deterministically by referenceAssetId then role", () => {
    const candidate = {
      ...validCandidate,
      references: [
        {
          referenceId: asset2Id,
          role: "style" as const
        },
        {
          referenceId: asset1Id,
          role: "subject_identity" as const
        },
        {
          referenceId: asset1Id,
          role: "composition" as const
        }
      ]
    };

    const result = validateSceneConfiguration(candidate, sampleResolvedAssets);
    expect(result.referenceBindings).toEqual([
      {
        referenceAssetId: asset1Id,
        role: "composition",
        weight: null,
        hints: null
      },
      {
        referenceAssetId: asset1Id,
        role: "subject_identity",
        weight: null,
        hints: null
      },
      {
        referenceAssetId: asset2Id,
        role: "style",
        weight: null,
        hints: null
      }
    ]);
  });

  it("rejects duplicate (referenceId, role) entries", () => {
    const candidate = {
      ...validCandidate,
      references: [
        {
          referenceId: asset1Id,
          role: "subject_identity" as const
        },
        {
          referenceId: asset1Id,
          role: "subject_identity" as const
        }
      ]
    };

    expect(() => validateSceneConfiguration(candidate, sampleResolvedAssets)).toThrowError(
      /Duplicate reference assignment/
    );
  });

  it("rejects non-object candidates", () => {
    expect(() => validateSceneConfiguration(null, sampleResolvedAssets)).toThrow(
      SceneConfigurationValidationError
    );
    expect(() => validateSceneConfiguration("string", sampleResolvedAssets)).toThrow(
      SceneConfigurationValidationError
    );
    expect(() => validateSceneConfiguration(123, sampleResolvedAssets)).toThrow(
      SceneConfigurationValidationError
    );
    expect(() => validateSceneConfiguration([], sampleResolvedAssets)).toThrow(
      SceneConfigurationValidationError
    );
  });

  it("rejects invalid prompt", () => {
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, prompt: "" }, sampleResolvedAssets)
    ).toThrow();
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, prompt: "   " }, sampleResolvedAssets)
    ).toThrow("prompt must be a non-empty string");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, prompt: 123 }, sampleResolvedAssets)
    ).toThrow();
  });

  it("rejects invalid durationMs", () => {
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: -100 }, sampleResolvedAssets)
    ).toThrow();
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: 0 }, sampleResolvedAssets)
    ).toThrow();
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: 2500.5 }, sampleResolvedAssets)
    ).toThrow();
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: "5000" }, sampleResolvedAssets)
    ).toThrow();
  });

  it("rejects durationMs exceeding maxDurationMs", () => {
    expect(() =>
      validateSceneConfiguration(
        { ...validCandidate, durationMs: 15000 },
        sampleResolvedAssets,
        10000
      )
    ).toThrow("durationMs 15000 exceeds maximum allowed duration of 10000");
  });

  it("allows durationMs equal to or less than maxDurationMs", () => {
    const exact = validateSceneConfiguration(
      { ...validCandidate, durationMs: 10000 },
      sampleResolvedAssets,
      10000
    );
    expect(exact.durationMs).toBe(10000);
  });

  it("rejects durationMs not equal to targetDurationMs", () => {
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: 4000 }, sampleResolvedAssets, {
        targetDurationMs: 5000
      })
    ).toThrow("durationMs 4000 does not match required targetDurationMs 5000");
  });

  it("allows durationMs equal to targetDurationMs", () => {
    const matched = validateSceneConfiguration(
      { ...validCandidate, durationMs: 5000 },
      sampleResolvedAssets,
      { targetDurationMs: 5000 }
    );
    expect(matched.durationMs).toBe(5000);
  });

  it("rejects inconsistent options where targetDurationMs exceeds maxDurationMs", () => {
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: 5000 }, sampleResolvedAssets, {
        maxDurationMs: 4000,
        targetDurationMs: 5000
      })
    ).toThrow("targetDurationMs 5000 cannot exceed maxDurationMs 4000");
  });

  it("allows consistent targetDurationMs and maxDurationMs when candidate matches targetDurationMs", () => {
    const valid = validateSceneConfiguration(
      { ...validCandidate, durationMs: 4000 },
      sampleResolvedAssets,
      { maxDurationMs: 5000, targetDurationMs: 4000 }
    );
    expect(valid.durationMs).toBe(4000);
  });

  it("handles optional loraConfigurationId correctly", () => {
    // null is allowed
    const withNull = validateSceneConfiguration(
      { ...validCandidate, loraConfigurationId: null },
      sampleResolvedAssets
    );
    expect(withNull.loraConfigurationId).toBeNull();

    // undefined / omitted is allowed
    const withoutLora = {
      prompt: validCandidate.prompt,
      references: validCandidate.references,
      engineProfileId: validCandidate.engineProfileId,
      durationMs: validCandidate.durationMs
    };
    const withUndefined = validateSceneConfiguration(withoutLora, sampleResolvedAssets);
    expect(withUndefined.loraConfigurationId).toBeUndefined();

    // empty string or whitespace rejected
    expect(() =>
      validateSceneConfiguration(
        { ...validCandidate, loraConfigurationId: "  " },
        sampleResolvedAssets
      )
    ).toThrow("loraConfigurationId must be a non-empty string when provided");
  });

  it("rejects an archived reference asset with ArchivedReferenceBindingError", () => {
    const archivedAsset: ReferenceAsset = {
      ...validAssetWithoutSceneId,
      archivedAt: "2026-09-24T12:00:00.000Z"
    };

    expect(() => validateSceneConfiguration(validCandidate, [archivedAsset])).toThrow(
      ArchivedReferenceBindingError
    );
  });

  it("rejects a cross-client reference asset with CrossClientReferenceBindingError when campaignClientId is provided", () => {
    expect(() =>
      validateSceneConfiguration(validCandidate, sampleResolvedAssets, {
        campaignClientId: "client-different"
      })
    ).toThrow(CrossClientReferenceBindingError);
  });

  it("accepts a matching-client active reference asset when campaignClientId is provided", () => {
    const result = validateSceneConfiguration(validCandidate, sampleResolvedAssets, {
      campaignClientId: "client-1"
    });
    expect(result.referenceIds).toEqual([asset1Id]);
  });
});
