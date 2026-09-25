import { describe, it, expect } from "vitest";
import {
  REFERENCE_ROLES,
  ReferenceRoleSchema,
  ReferenceAssetSchema,
  ReferenceAssetResponseSchema,
  ReferenceAssetListResponseSchema,
  ReferenceGroupSchema,
  SceneReferenceBindingSchema,
  SceneConfigurationSchema
} from "./index.js";

describe("ReferenceAsset Contracts & Schemas", () => {
  describe("ReferenceRoleSchema", () => {
    it("accepts all five canonical reference roles", () => {
      for (const role of REFERENCE_ROLES) {
        expect(ReferenceRoleSchema.parse(role)).toBe(role);
      }
    });

    it("rejects invalid role strings", () => {
      expect(() => ReferenceRoleSchema.parse("character")).toThrow();
      expect(() => ReferenceRoleSchema.parse("lighting")).toThrow();
      expect(() => ReferenceRoleSchema.parse("")).toThrow();
      expect(() => ReferenceRoleSchema.parse(123)).toThrow();
    });
  });

  describe("ReferenceAssetSchema", () => {
    const validAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
      storageBucket: "godzspeed-reference",
      storageObjectKey: "refs/018e69e0-8a6a-72cb-b1b7-ec79a1f73802/asset1.png",
      contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      width: 1344,
      height: 768,
      mimeType: "image/png",
      displayName: "Elena Portrait",
      groupId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73803"
    };

    it("parses valid ReferenceAsset with defaults applied", () => {
      const parsed = ReferenceAssetSchema.parse(validAsset);
      expect(parsed.id).toBe(validAsset.id);
      expect(parsed.clientId).toBe(validAsset.clientId);
      expect(parsed.assetType).toBe("image");
      expect(parsed.width).toBe(1344);
      expect(parsed.height).toBe(768);
      expect(parsed.mimeType).toBe("image/png");
      expect(parsed.displayName).toBe("Elena Portrait");
      expect(parsed.groupId).toBe(validAsset.groupId);
    });

    it("parses with nullable/optional archivedAt", () => {
      const activeParsed = ReferenceAssetSchema.parse({
        ...validAsset,
        archivedAt: null
      });
      expect(activeParsed.archivedAt).toBeNull();

      const archivedParsed = ReferenceAssetSchema.parse({
        ...validAsset,
        archivedAt: "2026-09-24T12:00:00.000Z"
      });
      expect(archivedParsed.archivedAt).toBe("2026-09-24T12:00:00.000Z");
    });

    it("parses with valid libraryRole, null libraryRole, or omitted libraryRole", () => {
      const withRole = ReferenceAssetSchema.parse({
        ...validAsset,
        libraryRole: "subject_identity"
      });
      expect(withRole.libraryRole).toBe("subject_identity");

      const withNullRole = ReferenceAssetSchema.parse({
        ...validAsset,
        libraryRole: null
      });
      expect(withNullRole.libraryRole).toBeNull();

      const withoutRole = ReferenceAssetSchema.parse(validAsset);
      expect(withoutRole.libraryRole).toBeUndefined();
    });

    it("rejects invalid libraryRole value", () => {
      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          libraryRole: "invalid_role"
        })
      ).toThrow();
    });

    it("rejects non-hexadecimal or invalid length SHA-256 hash", () => {
      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          contentHashSha256: "too-short"
        })
      ).toThrow();

      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          contentHashSha256: "ZZZZ456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        })
      ).toThrow();
    });

    it("rejects non-positive dimensions", () => {
      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          width: 0
        })
      ).toThrow();

      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          height: -50
        })
      ).toThrow();
    });

    it("rejects non-uuid id or clientId", () => {
      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          id: "not-a-uuid"
        })
      ).toThrow();

      expect(() =>
        ReferenceAssetSchema.parse({
          ...validAsset,
          clientId: "not-a-uuid"
        })
      ).toThrow();
    });
  });

  describe("ReferenceGroupSchema", () => {
    const validGroup = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73803",
      name: "Fall 2026 Campaign Kit",
      description: "Logos, apparel, hero textures",
      createdAt: "2026-09-24T10:00:00.000Z",
      archivedAt: null
    };

    it("parses valid ReferenceGroup", () => {
      const parsed = ReferenceGroupSchema.parse(validGroup);
      expect(parsed.name).toBe("Fall 2026 Campaign Kit");
      expect(parsed.campaignId).toBe(validGroup.campaignId);
      expect(parsed.archivedAt).toBeNull();
    });

    it("rejects empty name", () => {
      expect(() =>
        ReferenceGroupSchema.parse({
          ...validGroup,
          name: ""
        })
      ).toThrow();
    });

    it("allows omitting campaignId or passing null", () => {
      const parsedWithoutCampaign = ReferenceGroupSchema.parse({
        id: validGroup.id,
        clientId: validGroup.clientId,
        name: "Client-wide Kit",
        createdAt: validGroup.createdAt
      });
      expect(parsedWithoutCampaign.campaignId).toBeUndefined();
    });
  });

  describe("SceneReferenceBindingSchema", () => {
    const validBinding = {
      sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      specRevision: 2,
      referenceAssetId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
      role: "subject_identity",
      weight: 0.85,
      hints: {
        cropRegion: { x: 0, y: 0, w: 500, h: 500 }
      }
    };

    it("parses valid SceneReferenceBinding", () => {
      const parsed = SceneReferenceBindingSchema.parse(validBinding);
      expect(parsed.role).toBe("subject_identity");
      expect(parsed.weight).toBe(0.85);
      expect(parsed.specRevision).toBe(2);
      expect(parsed.hints).toBeDefined();
    });

    it("enforces weight boundaries [0.0, 1.0]", () => {
      expect(
        SceneReferenceBindingSchema.parse({
          ...validBinding,
          weight: 0.0
        }).weight
      ).toBe(0.0);

      expect(
        SceneReferenceBindingSchema.parse({
          ...validBinding,
          weight: 1.0
        }).weight
      ).toBe(1.0);

      expect(() =>
        SceneReferenceBindingSchema.parse({
          ...validBinding,
          weight: -0.01
        })
      ).toThrow();

      expect(() =>
        SceneReferenceBindingSchema.parse({
          ...validBinding,
          weight: 1.01
        })
      ).toThrow();
    });

    it("rejects non-positive specRevision", () => {
      expect(() =>
        SceneReferenceBindingSchema.parse({
          ...validBinding,
          specRevision: 0
        })
      ).toThrow();
    });
  });

  describe("SceneConfigurationSchema backward compatibility", () => {
    it("parses SceneConfiguration with referenceBindings included", () => {
      const parsed = SceneConfigurationSchema.parse({
        prompt: "A high-fashion runway close up",
        referenceIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"],
        referenceBindings: [
          {
            sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
            specRevision: 1,
            referenceAssetId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
            role: "product",
            weight: 0.95
          }
        ],
        engineProfileId: "minimax_h3",
        durationMs: 5000
      });

      expect(parsed.referenceIds).toEqual(["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"]);
      expect(parsed.referenceBindings).toHaveLength(1);
      expect(parsed.referenceBindings?.[0]?.role).toBe("product");
    });

    it("parses SceneConfiguration when referenceBindings is omitted", () => {
      const parsed = SceneConfigurationSchema.parse({
        prompt: "A high-fashion runway close up",
        referenceIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"],
        engineProfileId: "minimax_h3",
        durationMs: 5000
      });

      expect(parsed.referenceBindings).toBeUndefined();
    });
  });

  describe("ReferenceAssetResponseSchema and ReferenceAssetListResponseSchema", () => {
    const baseAsset = {
      id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
      storageBucket: "godzspeed-reference",
      storageObjectKey:
        "clients/018e69e0-8a6a-72cb-b1b7-ec79a1f73802/references/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      contentHashSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      width: 1920,
      height: 1080,
      mimeType: "image/png",
      displayName: "Logo Hero",
      archivedAt: null
    };

    it("accepts available preview state with valid previewUrl", () => {
      const parsed = ReferenceAssetResponseSchema.parse({
        ...baseAsset,
        previewUrl: "https://minio.godzspeed.internal/godzspeed-reference/signed-url-123",
        previewAvailability: "available"
      });
      expect(parsed.previewAvailability).toBe("available");
      expect(parsed.previewUrl).toBe(
        "https://minio.godzspeed.internal/godzspeed-reference/signed-url-123"
      );
    });

    it("accepts unavailable preview state with null previewUrl", () => {
      const parsed = ReferenceAssetResponseSchema.parse({
        ...baseAsset,
        previewUrl: null,
        previewAvailability: "unavailable"
      });
      expect(parsed.previewAvailability).toBe("unavailable");
      expect(parsed.previewUrl).toBeNull();
    });

    it("rejects conditional invariant violation: available with null URL", () => {
      expect(() =>
        ReferenceAssetResponseSchema.parse({
          ...baseAsset,
          previewUrl: null,
          previewAvailability: "available"
        })
      ).toThrow();
    });

    it("rejects conditional invariant violation: unavailable with non-null URL", () => {
      expect(() =>
        ReferenceAssetResponseSchema.parse({
          ...baseAsset,
          previewUrl: "https://example.com/image.png",
          previewAvailability: "unavailable"
        })
      ).toThrow();
    });

    it("rejects invalid availability literal", () => {
      expect(() =>
        ReferenceAssetResponseSchema.parse({
          ...baseAsset,
          previewUrl: "https://example.com/image.png",
          previewAvailability: "pending"
        })
      ).toThrow();
    });

    it("parses ReferenceAssetListResponseSchema with multiple items", () => {
      const list = {
        references: [
          {
            ...baseAsset,
            id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
            previewUrl: "https://example.com/1",
            previewAvailability: "available"
          },
          {
            ...baseAsset,
            id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73809",
            previewUrl: null,
            previewAvailability: "unavailable"
          }
        ]
      };
      const parsed = ReferenceAssetListResponseSchema.parse(list);
      expect(parsed.references).toHaveLength(2);
      expect(parsed.references[0]?.previewAvailability).toBe("available");
      expect(parsed.references[1]?.previewAvailability).toBe("unavailable");
    });
  });
});
