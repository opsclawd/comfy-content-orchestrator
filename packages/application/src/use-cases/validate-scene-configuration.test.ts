import { describe, it, expect } from "vitest";
import type { ReferenceAsset, ReferenceAssetId, SceneId } from "@cco/domain";
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
    referenceIds: [asset1Id],
    engineProfileId: "LTX_25_720P_5S_V1",
    durationMs: 5000,
    loraConfigurationId: "lora-cfg-1"
  };

  it("validates a fully valid candidate configuration", () => {
    const result = validateSceneConfiguration(validCandidate, sampleResolvedAssets, 10000);

    expect(result).toEqual({
      prompt: "A cinematic shot of the product on a table",
      referenceIds: [asset1Id],
      engineProfileId: "LTX_25_720P_5S_V1",
      durationMs: 5000,
      loraConfigurationId: "lora-cfg-1"
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.referenceIds)).toBe(true);
  });

  it("witness scenario: a referenceIds entry that is a syntactically valid UUID but absent from resolvedReferenceAssets is rejected", () => {
    const absentValidUuid = "99999999-9999-9999-9999-999999999999";
    const candidate = {
      ...validCandidate,
      referenceIds: [absentValidUuid]
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

  it("witness scenario: a resolvedReferenceAssets entry with no sceneId is still matched correctly by .id", () => {
    // validAssetWithoutSceneId has no sceneId key defined
    expect("sceneId" in validAssetWithoutSceneId).toBe(false);

    const candidate = {
      ...validCandidate,
      referenceIds: [validAssetWithoutSceneId.id]
    };

    const result = validateSceneConfiguration(candidate, [validAssetWithoutSceneId]);
    expect(result.referenceIds).toEqual([validAssetWithoutSceneId.id]);
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
    ).toThrow("prompt must be a non-empty string");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, prompt: "   " }, sampleResolvedAssets)
    ).toThrow("prompt must be a non-empty string");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, prompt: 123 }, sampleResolvedAssets)
    ).toThrow("prompt must be a non-empty string");
  });

  it("rejects invalid referenceIds structure", () => {
    expect(() =>
      validateSceneConfiguration(
        { ...validCandidate, referenceIds: "not-array" },
        sampleResolvedAssets
      )
    ).toThrow("referenceIds must be an array of strings");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, referenceIds: [123] }, sampleResolvedAssets)
    ).toThrow("All referenceIds entries must be strings");
  });

  it("rejects invalid durationMs", () => {
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: -100 }, sampleResolvedAssets)
    ).toThrow("durationMs must be a positive integer");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: 0 }, sampleResolvedAssets)
    ).toThrow("durationMs must be a positive integer");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: 2500.5 }, sampleResolvedAssets)
    ).toThrow("durationMs must be a positive integer");
    expect(() =>
      validateSceneConfiguration({ ...validCandidate, durationMs: "5000" }, sampleResolvedAssets)
    ).toThrow("durationMs must be a positive integer");
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
      referenceIds: validCandidate.referenceIds,
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

    // non-string rejected
    expect(() =>
      validateSceneConfiguration(
        { ...validCandidate, loraConfigurationId: 999 },
        sampleResolvedAssets
      )
    ).toThrow("loraConfigurationId must be a non-empty string when provided");
  });
});
