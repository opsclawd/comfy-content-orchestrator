import { describe, expect, it } from "vitest";
import type { CreativeBrief } from "@cco/contracts";
import type { ReferenceAsset, ReferenceAssetId } from "@cco/domain";
import { buildBeatSheetPlanningPrompt } from "./beat-sheet-prompt.js";
import { maskCampaignIdentifier } from "./planning-prompt.js";

describe("buildBeatSheetPlanningPrompt", () => {
  const campaignId = "campaign-secret-54321";
  const brief: CreativeBrief = {
    title: "10s Product Launch Teaser",
    description: "High-energy commercial launching our new electric scooter",
    targetPlatform: "tiktok",
    visualStyle: "cyberpunk neon street night",
    requirements: ["Must feature rider with helmet", "Show LED wheels in dark"]
  };

  const refAsset1: ReferenceAsset = {
    id: "ref-scooter-hero" as ReferenceAssetId,
    clientId: "client-scooter",
    assetType: "brand_logo",
    storageBucket: "b",
    storageObjectKey: "k1",
    contentHashSha256: "h1"
  };

  it("builds prompt with totalScenes, targetTotalDurationMs, and brief details", () => {
    const prompt = buildBeatSheetPlanningPrompt({
      brief,
      campaignId,
      totalScenes: 4,
      targetTotalDurationMs: 10000,
      resolvedReferenceAssets: [refAsset1],
      maskSensitiveData: false
    });

    expect(prompt.systemPrompt).toContain("beats: array of exactly 4 scene beats");
    expect(prompt.systemPrompt).toContain("ordinal: positive integer from 1 to 4");
    expect(prompt.systemPrompt).toContain("MUST equal exactly 10000 ms");

    expect(prompt.userPrompt).toContain("campaign-secret-54321");
    expect(prompt.userPrompt).toContain("Total Required Scenes: 4");
    expect(prompt.userPrompt).toContain("Target Total Duration: 10000 ms");
    expect(prompt.userPrompt).toContain("10s Product Launch Teaser");
    expect(prompt.userPrompt).toContain(
      "High-energy commercial launching our new electric scooter"
    );
    expect(prompt.userPrompt).toContain("cyberpunk neon street night");
    expect(prompt.userPrompt).toContain("ref-scooter-hero");
  });

  it("masks campaignId when maskSensitiveData is true", () => {
    const prompt = buildBeatSheetPlanningPrompt({
      brief,
      campaignId,
      totalScenes: 3,
      targetTotalDurationMs: 6000,
      resolvedReferenceAssets: [],
      maskSensitiveData: true
    });

    const expectedMasked = maskCampaignIdentifier(campaignId);
    expect(prompt.userPrompt).toContain(expectedMasked);
    expect(prompt.userPrompt).not.toContain(campaignId);
    expect(prompt.systemPrompt).not.toContain(campaignId);
  });

  it("includes corrective feedback when provided", () => {
    const prompt = buildBeatSheetPlanningPrompt({
      brief,
      campaignId,
      totalScenes: 3,
      targetTotalDurationMs: 6000,
      resolvedReferenceAssets: [],
      correctiveFeedback:
        "sum of beat durations (5000ms) does not match targetTotalDurationMs (6000ms)"
    });

    expect(prompt.userPrompt).toContain(
      "IMPORTANT: The previous attempt was rejected for the following reason:"
    );
    expect(prompt.userPrompt).toContain(
      "sum of beat durations (5000ms) does not match targetTotalDurationMs (6000ms)"
    );
  });
});
