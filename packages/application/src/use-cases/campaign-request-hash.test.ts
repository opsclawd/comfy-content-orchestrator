import { describe, expect, it } from "vitest";
import {
  canonicalizeCampaignRequest,
  computeCampaignRequestHash,
  type CampaignRequestHashInput
} from "./campaign-request-hash.js";

describe("campaign-request-hash", () => {
  const baseInput = {
    clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
    title: "Summer 2026 Collection",
    targetPlatform: "tiktok",
    targetTotalDurationMs: 15000,
    sceneCountOverride: undefined
  };

  it("produces deterministic canonical string and hash across repeated calls", async () => {
    const canonical1 = canonicalizeCampaignRequest(baseInput);
    const canonical2 = canonicalizeCampaignRequest({ ...baseInput });
    expect(canonical1).toBe(canonical2);

    const hash1 = await computeCampaignRequestHash(baseInput);
    const hash2 = await computeCampaignRequestHash({ ...baseInput });
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("canonical string is independent of object key insertion order", async () => {
    const inputReordered = {
      targetTotalDurationMs: 15000,
      title: "Summer 2026 Collection",
      sceneCountOverride: undefined,
      targetPlatform: "tiktok",
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801"
    };

    expect(canonicalizeCampaignRequest(baseInput)).toBe(
      canonicalizeCampaignRequest(inputReordered)
    );

    const hash1 = await computeCampaignRequestHash(baseInput);
    const hash2 = await computeCampaignRequestHash(inputReordered);
    expect(hash1).toBe(hash2);
  });

  it("produces different hash when sceneCountOverride is defined vs undefined (Finding 2 / Auto-mode)", async () => {
    const autoMode = { ...baseInput, sceneCountOverride: undefined };
    const manualMode = { ...baseInput, sceneCountOverride: 3 };

    const hashAuto = await computeCampaignRequestHash(autoMode);
    const hashManual = await computeCampaignRequestHash(manualMode);

    expect(hashAuto).not.toBe(hashManual);
  });

  it("witness scenario: lost-response retry in Auto mode preserves identical hash without totalScenes substitution", async () => {
    // Initial attempt in Auto mode (sceneCountOverride: undefined)
    const initialRequest = {
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      title: "Auto Mode Campaign",
      targetTotalDurationMs: 15000,
      sceneCountOverride: undefined
    };
    const initialHash = await computeCampaignRequestHash(initialRequest);

    // Client retries with identical declared fields
    const retryRequest = {
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      title: "Auto Mode Campaign",
      targetTotalDurationMs: 15000,
      sceneCountOverride: undefined
    };
    const retryHash = await computeCampaignRequestHash(retryRequest);

    expect(retryHash).toBe(initialHash);

    // If configured totalScenes (3) had been substituted in place of sceneCountOverride,
    // the hash would have differed, causing a false 409 conflict:
    const flawedSubstitutedRequest = {
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      title: "Auto Mode Campaign",
      targetTotalDurationMs: 15000,
      sceneCountOverride: 3 // flawed substitution of totalScenes
    };
    const flawedHash = await computeCampaignRequestHash(flawedSubstitutedRequest);
    expect(flawedHash).not.toBe(initialHash);
  });

  it("is sensitive to changes in clientId", async () => {
    const hash1 = await computeCampaignRequestHash(baseInput);
    const hash2 = await computeCampaignRequestHash({
      ...baseInput,
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73899"
    });
    expect(hash1).not.toBe(hash2);
  });

  it("is sensitive to changes in title", async () => {
    const hash1 = await computeCampaignRequestHash(baseInput);
    const hash2 = await computeCampaignRequestHash({
      ...baseInput,
      title: "Different Title"
    });
    expect(hash1).not.toBe(hash2);
  });

  it("is sensitive to changes in targetPlatform", async () => {
    const hash1 = await computeCampaignRequestHash(baseInput);
    const hash2 = await computeCampaignRequestHash({
      ...baseInput,
      targetPlatform: "youtube_shorts"
    });
    expect(hash1).not.toBe(hash2);
  });

  it("is sensitive to changes in targetTotalDurationMs", async () => {
    const hash1 = await computeCampaignRequestHash(baseInput);
    const hash2 = await computeCampaignRequestHash({
      ...baseInput,
      targetTotalDurationMs: 20000
    });
    expect(hash1).not.toBe(hash2);
  });

  it("is sensitive to changes in creative brief", async () => {
    const briefA = {
      description: "Fast-paced summer apparel promo",
      visualStyle: "high contrast neon",
      requirements: ["show logo at start", "end with CTA"]
    };
    const briefB = {
      description: "Calm and minimalist autumn apparel promo",
      visualStyle: "earth tones",
      requirements: ["soft transitions"]
    };

    const hashA = await computeCampaignRequestHash({ ...baseInput, brief: briefA });
    const hashB = await computeCampaignRequestHash({ ...baseInput, brief: briefB });
    const hashNone = await computeCampaignRequestHash(baseInput);

    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toBe(hashNone);
  });

  it("brief hashing is independent of key insertion order within brief object", async () => {
    const brief1 = {
      description: "Promo",
      visualStyle: "cinematic",
      title: "Title A"
    };
    const brief2 = {
      title: "Title A",
      visualStyle: "cinematic",
      description: "Promo"
    };

    const hash1 = await computeCampaignRequestHash({ ...baseInput, brief: brief1 });
    const hash2 = await computeCampaignRequestHash({ ...baseInput, brief: brief2 });

    expect(hash1).toBe(hash2);
  });

  it("is sensitive to changes in candidateReferenceAssetIds", async () => {
    const hash1 = await computeCampaignRequestHash({
      ...baseInput,
      candidateReferenceAssetIds: ["asset-1", "asset-2"]
    });
    const hash2 = await computeCampaignRequestHash({
      ...baseInput,
      candidateReferenceAssetIds: ["asset-1", "asset-3"]
    });
    expect(hash1).not.toBe(hash2);
  });

  it("canonicalizes candidateReferenceAssetIds via sorting and deduplication", async () => {
    const hashUnsorted = await computeCampaignRequestHash({
      ...baseInput,
      candidateReferenceAssetIds: ["asset-3", "asset-1", "asset-2", "asset-1"]
    });
    const hashSortedDeduped = await computeCampaignRequestHash({
      ...baseInput,
      candidateReferenceAssetIds: ["asset-1", "asset-2", "asset-3"]
    });

    expect(hashUnsorted).toBe(hashSortedDeduped);
  });

  it("treats empty candidateReferenceAssetIds as absent/equivalent to undefined", async () => {
    const hashUndefined = await computeCampaignRequestHash({
      ...baseInput,
      candidateReferenceAssetIds: undefined
    });
    const hashEmpty = await computeCampaignRequestHash({
      ...baseInput,
      candidateReferenceAssetIds: []
    });

    expect(hashEmpty).toBe(hashUndefined);
  });

  it("matches the pinned client-side canonical JSON representation (cross-package sync with campaign-creation-state)", () => {
    const fixture: CampaignRequestHashInput = {
      clientId: "11111111-1111-4111-8111-111111111111",
      title: "Summer 2026 Collection",
      targetPlatform: "tiktok",
      targetTotalDurationMs: 15000,
      sceneCountOverride: 3,
      brief: {
        description: "High energy summer apparel advertisement",
        visualStyle: "cinematic warm golden hour"
      },
      candidateReferenceAssetIds: ["asset-b", "asset-a", "asset-b"]
    };

    const canonical = canonicalizeCampaignRequest(fixture);
    expect(canonical).toBe(
      '{"brief":{"description":"High energy summer apparel advertisement","visualStyle":"cinematic warm golden hour"},"candidateReferenceAssetIds":["asset-a","asset-b"],"clientId":"11111111-1111-4111-8111-111111111111","sceneCountOverride":3,"targetPlatform":"tiktok","targetTotalDurationMs":15000,"title":"Summer 2026 Collection"}'
    );
  });
});
