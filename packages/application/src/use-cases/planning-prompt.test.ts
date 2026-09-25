import { describe, it, expect } from "vitest";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import {
  buildPlanningPrompt,
  maskCampaignIdentifier,
  type CreativeBrief
} from "./planning-prompt.js";

describe("planning-prompt", () => {
  const campaignId = "campaign-secret-12345";
  const brief: CreativeBrief = {
    title: "Summer Splash Launch",
    description: "High energy commercial intro with vibrant summer vibes",
    targetPlatform: "tiktok",
    visualStyle: "cinematic warm sun flare",
    requirements: ["Must feature cold beverage can", "Fast motion cut at end"]
  };

  const refAsset1: ReferenceAsset = {
    id: "ref-can-logo-001" as ReferenceAssetId,
    clientId: "client-a",
    assetType: "brand_logo",
    storageBucket: "b",
    storageObjectKey: "k",
    contentHashSha256: "h"
  };

  const refAsset2: ReferenceAsset = {
    id: "ref-bottle-art-002" as ReferenceAssetId,
    clientId: "client-a",
    assetType: "style_reference",
    storageBucket: "b",
    storageObjectKey: "k2",
    contentHashSha256: "h2"
  };

  it("includes resolved reference asset IDs and certified profile IDs in prompt text", () => {
    const prompt = buildPlanningPrompt({
      brief,
      campaignId,
      resolvedReferenceAssets: [refAsset1, refAsset2],
      maskSensitiveData: false
    });

    expect(prompt.userPrompt).toContain("ref-can-logo-001");
    expect(prompt.userPrompt).toContain("ref-bottle-art-002");
    expect(prompt.systemPrompt).toContain("ref-can-logo-001");
    expect(prompt.systemPrompt).toContain("ref-bottle-art-002");

    expect(prompt.userPrompt).toContain("LTX_25_720P_5S_V1");
    expect(prompt.userPrompt).toContain("FLUX_SCHNELL_DRAFT_V1");
    expect(prompt.systemPrompt).toContain("LTX_25_720P_5S_V1");
    expect(prompt.systemPrompt).toContain("FLUX_SCHNELL_DRAFT_V1");

    expect(prompt.userPrompt).toContain("campaign-secret-12345");
  });

  it("masks campaignId when maskSensitiveData is true and excludes the raw ID", () => {
    const prompt = buildPlanningPrompt({
      brief,
      campaignId,
      resolvedReferenceAssets: [refAsset1],
      maskSensitiveData: true
    });

    const expectedMasked = maskCampaignIdentifier("campaign-secret-12345");
    expect(prompt.userPrompt).toContain(expectedMasked);
    expect(prompt.userPrompt).not.toContain("campaign-secret-12345");
    expect(prompt.systemPrompt).not.toContain("campaign-secret-12345");
  });

  it("includes corrective feedback when provided", () => {
    const prompt = buildPlanningPrompt({
      brief,
      campaignId,
      resolvedReferenceAssets: [refAsset1],
      correctiveFeedback: "engineProfileId 'invalid' is not certified"
    });

    expect(prompt.userPrompt).toContain(
      "IMPORTANT: The previous attempt was rejected for the following reason:"
    );
    expect(prompt.userPrompt).toContain("engineProfileId 'invalid' is not certified");
  });

  it("includes exact duration requirement when targetDurationMs is specified", () => {
    const prompt = buildPlanningPrompt({
      brief,
      campaignId,
      resolvedReferenceAssets: [refAsset1],
      targetDurationMs: 3500
    });

    expect(prompt.systemPrompt).toContain(
      "durationMs: positive integer in milliseconds (must equal exactly 3500)."
    );
  });

  it("formats reference asset metadata with displayName, libraryRole, and description without leaking binary/storage paths/hashes", () => {
    const assetWithMeta: ReferenceAsset = {
      id: "ref-can-logo-001" as ReferenceAssetId,
      clientId: "client-a",
      assetType: "brand_logo",
      storageBucket: "secret-bucket-name",
      storageObjectKey: "secrets/path/to/key.png",
      contentHashSha256: "secret-hash-1234567890abcdef",
      displayName: "Sparkling Water Can",
      libraryRole: "product",
      description: "Aluminum can with red logo"
    };

    const prompt = buildPlanningPrompt({
      brief,
      campaignId,
      resolvedReferenceAssets: [assetWithMeta]
    });

    // Contains typed metadata
    expect(prompt.userPrompt).toContain("displayName: Sparkling Water Can");
    expect(prompt.userPrompt).toContain("libraryRole: product");
    expect(prompt.userPrompt).toContain("description: Aluminum can with red logo");

    // Strictly excludes internal storage paths, buckets, hashes, and binary data
    expect(prompt.userPrompt).not.toContain("secret-bucket-name");
    expect(prompt.userPrompt).not.toContain("secrets/path/to/key.png");
    expect(prompt.userPrompt).not.toContain("secret-hash-1234567890abcdef");
    expect(prompt.systemPrompt).not.toContain("secret-bucket-name");
    expect(prompt.systemPrompt).not.toContain("secrets/path/to/key.png");
    expect(prompt.systemPrompt).not.toContain("secret-hash-1234567890abcdef");

    // System prompt requires `references` array with role and does not instruct planner to supply `referenceIds`
    expect(prompt.systemPrompt).toContain(
      "references: array of objects assigning reference assets"
    );
    expect(prompt.systemPrompt).toContain("role: string, must be one of the reference roles");
    expect(prompt.systemPrompt).not.toContain("- referenceIds:");
  });

  it("renders 'unspecified' for missing displayName, libraryRole, and description", () => {
    const assetWithoutMeta: ReferenceAsset = {
      id: "ref-bare-001" as ReferenceAssetId,
      clientId: "client-a",
      assetType: "style_reference",
      storageBucket: "b",
      storageObjectKey: "k",
      contentHashSha256: "h"
    };

    const prompt = buildPlanningPrompt({
      brief,
      campaignId,
      resolvedReferenceAssets: [assetWithoutMeta]
    });

    expect(prompt.userPrompt).toContain("displayName: unspecified");
    expect(prompt.userPrompt).toContain("libraryRole: unspecified");
    expect(prompt.userPrompt).toContain("description: unspecified");
  });
});
