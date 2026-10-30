import { describe, expect, it } from "vitest";
import {
  type FastH3OmniCampaignExportManifest,
  createFastVideoSm89Capability
} from "@cco/contracts";
import { mapCampaignReferencesToFastH3OmniBindings } from "./fasth3-omni-reference-mapper.js";

describe("FastH3-Omni Reference Mapper", () => {
  const capability = createFastVideoSm89Capability();

  const createTestManifest = (
    refCount: number,
    overrides?: Partial<FastH3OmniCampaignExportManifest>
  ): FastH3OmniCampaignExportManifest => {
    const roles = [
      "subject_identity" as const,
      "wardrobe" as const,
      "product" as const,
      "location" as const,
      "style" as const
    ];

    const orderedReferences = Array.from({ length: refCount }, (_, i) => ({
      assetId: `00000000-0000-0000-0000-00000000000${i + 1}`,
      contentHashSha256: `${(i + 1).toString().repeat(64)}`.slice(0, 64),
      mimeType: "image/png" as const,
      width: 1024,
      height: 1024,
      semanticPurposes: [roles[i % roles.length]!],
      localPath: `/var/data/ref_${i + 1}.png`
    }));

    return {
      campaignId: "11111111-1111-1111-1111-111111111111",
      sceneId: "22222222-2222-2222-2222-222222222222",
      specRevision: 1,
      referenceSetId: "33333333-3333-3333-3333-333333333333",
      exportDigest: "a".repeat(64),
      createdAt: "2026-10-29T10:00:00Z",
      orderedReferences,
      ...overrides
    };
  };

  it("maps 3 distinct campaign references in strictly preserved order", () => {
    const manifest = createTestManifest(3);
    const prompt =
      "A cinematic shot of <Picture 1> wearing <Picture 2> holding <Picture 3> in an urban setting";

    const bindingManifest = mapCampaignReferencesToFastH3OmniBindings({
      manifest,
      prompt,
      capability
    });

    expect(bindingManifest.orderedBindings).toHaveLength(3);
    expect(bindingManifest.orderedBindings[0]).toMatchObject({
      slotIndex: 0,
      boundOrder: 0,
      tag: "<Picture 1>",
      assetId: "00000000-0000-0000-0000-000000000001",
      semanticPurposes: ["subject_identity"]
    });
    expect(bindingManifest.orderedBindings[1]).toMatchObject({
      slotIndex: 1,
      boundOrder: 1,
      tag: "<Picture 2>",
      assetId: "00000000-0000-0000-0000-000000000002",
      semanticPurposes: ["wardrobe"]
    });
    expect(bindingManifest.orderedBindings[2]).toMatchObject({
      slotIndex: 2,
      boundOrder: 2,
      tag: "<Picture 3>",
      assetId: "00000000-0000-0000-0000-000000000003",
      semanticPurposes: ["product"]
    });
    expect(bindingManifest.renderedPrompt).toBe(prompt);
    expect(bindingManifest.bindingDigest).toBeDefined();
  });

  it("maps 1 reference image successfully", () => {
    const manifest = createTestManifest(1);
    const prompt = "A portrait of <Picture 1>";

    const bindingManifest = mapCampaignReferencesToFastH3OmniBindings({
      manifest,
      prompt,
      capability
    });

    expect(bindingManifest.orderedBindings).toHaveLength(1);
    expect(bindingManifest.orderedBindings[0]?.tag).toBe("<Picture 1>");
  });

  it("maps 9 references successfully when capability supports 9", () => {
    const manifest = createTestManifest(9);
    const tags = Array.from({ length: 9 }, (_, i) => `<Picture ${i + 1}>`).join(" ");
    const prompt = `Montage of ${tags}`;

    const bindingManifest = mapCampaignReferencesToFastH3OmniBindings({
      manifest,
      prompt,
      capability
    });

    expect(bindingManifest.orderedBindings).toHaveLength(9);
    expect(bindingManifest.orderedBindings[8]?.tag).toBe("<Picture 9>");
  });

  it("rejects reference count exceeding capability limit", () => {
    const reducedCap = {
      ...capability,
      maxReferenceImages: 3
    };
    const manifest = createTestManifest(4);
    const prompt = "Shot with <Picture 1> <Picture 2> <Picture 3> <Picture 4>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability: reducedCap
      })
    ).toThrow(/exceeds capability maximum 3/);
  });

  it("rejects duplicate asset IDs in distinct slots", () => {
    const manifest = createTestManifest(2);
    manifest.orderedReferences[1]!.assetId = manifest.orderedReferences[0]!.assetId;
    const prompt = "Pair <Picture 1> and <Picture 2>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/Duplicate reference asset ID/);
  });

  it("rejects duplicate content hashes in distinct slots", () => {
    const manifest = createTestManifest(2);
    manifest.orderedReferences[1]!.contentHashSha256 =
      manifest.orderedReferences[0]!.contentHashSha256;
    const prompt = "Pair <Picture 1> and <Picture 2>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/Duplicate reference content hash/);
  });

  it("rejects prompt lacking <Picture N> tags entirely", () => {
    const manifest = createTestManifest(2);
    const prompt = "A woman in a red dress walking down the street";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/lacks required <Picture N> binding tags/);
  });

  it("rejects out-of-range <Picture N> tags", () => {
    const manifest = createTestManifest(2);
    const prompt = "Shot of <Picture 1> and <Picture 3>"; // Picture 3 is out of range for 2 refs

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/out-of-range tag <Picture 3>/);
  });

  it("rejects tag gaps in prompt", () => {
    const manifest = createTestManifest(3);
    // Prompt references 1 and 3, but skips 2
    const prompt = "Shot of <Picture 1> and <Picture 3>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/tag gap or missing reference: <Picture 2>/);
  });

  it("rejects remote URLs in localPath (privacy fence)", () => {
    const manifest = createTestManifest(1);
    manifest.orderedReferences[0]!.localPath = "https://example.com/asset.png";
    const prompt = "Portrait of <Picture 1>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/Remote URL.*is forbidden/);
  });

  it("rejects keyframes when capability.supportsKeyframes is false", () => {
    const manifest = createTestManifest(1, {
      optionalFirstFrame: {
        assetId: "99999999-9999-9999-9999-999999999999",
        contentHashSha256: "9".repeat(64),
        mimeType: "image/png",
        width: 1024,
        height: 1024,
        semanticPurposes: ["subject_identity"]
      }
    });
    const prompt = "Portrait of <Picture 1>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/Keyframes.*are not supported/);
  });

  it("rejects audio references when capability.supportsAudio is false", () => {
    const manifest = createTestManifest(1, {
      optionalAudioReferences: [
        {
          assetId: "88888888-8888-8888-8888-888888888888",
          contentHashSha256: "8".repeat(64),
          mimeType: "audio/wav",
          role: "voice"
        }
      ]
    });
    const prompt = "Portrait of <Picture 1>";

    expect(() =>
      mapCampaignReferencesToFastH3OmniBindings({
        manifest,
        prompt,
        capability
      })
    ).toThrow(/Audio references are not supported/);
  });
});
