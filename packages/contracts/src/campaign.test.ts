import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATUSES,
  CampaignResponseSchema,
  CampaignStatusSchema,
  CreateCampaignRequestSchema,
  CreateSceneRequestSchema,
  SceneCreateResponseSchema
} from "./campaign.js";

describe("Campaign and Scene Creation Contracts", () => {
  describe("CampaignStatusSchema", () => {
    it("accepts all baseline campaign status enum values", () => {
      for (const status of CAMPAIGN_STATUSES) {
        expect(CampaignStatusSchema.parse(status)).toBe(status);
      }
    });

    it("rejects unknown status", () => {
      expect(() => CampaignStatusSchema.parse("archived")).toThrow();
    });
  });

  describe("CreateCampaignRequestSchema", () => {
    it("parses valid payload with all fields", () => {
      const parsed = CreateCampaignRequestSchema.parse({
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        title: "Summer 2026 Collection",
        targetPlatform: "tiktok",
        totalScenes: 3
      });

      expect(parsed).toEqual({
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        title: "Summer 2026 Collection",
        targetPlatform: "tiktok",
        totalScenes: 3
      });
    });

    it("parses valid payload with only required fields", () => {
      const parsed = CreateCampaignRequestSchema.parse({
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        title: "Summer 2026 Collection"
      });

      expect(parsed).toEqual({
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        title: "Summer 2026 Collection"
      });
    });

    it("rejects invalid clientId (non-UUID)", () => {
      expect(() =>
        CreateCampaignRequestSchema.parse({
          clientId: "invalid-uuid",
          title: "Summer 2026 Collection"
        })
      ).toThrow();
    });

    it("rejects empty title", () => {
      expect(() =>
        CreateCampaignRequestSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          title: ""
        })
      ).toThrow();
    });

    it("rejects empty targetPlatform", () => {
      expect(() =>
        CreateCampaignRequestSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          title: "Valid Title",
          targetPlatform: ""
        })
      ).toThrow();
    });

    it("rejects non-positive totalScenes", () => {
      expect(() =>
        CreateCampaignRequestSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          title: "Valid Title",
          totalScenes: 0
        })
      ).toThrow();

      expect(() =>
        CreateCampaignRequestSchema.parse({
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          title: "Valid Title",
          totalScenes: -2
        })
      ).toThrow();
    });
  });

  describe("CampaignResponseSchema", () => {
    it("parses valid campaign response", () => {
      const payload = {
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        title: "Summer 2026 Collection",
        targetPlatform: "instagram_reels",
        status: "drafting",
        totalScenes: 1,
        approvedScenes: 0,
        createdAt: "2026-09-03T12:00:00.000Z"
      };

      const parsed = CampaignResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects invalid status in campaign response", () => {
      expect(() =>
        CampaignResponseSchema.parse({
          campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          title: "Summer 2026 Collection",
          targetPlatform: "instagram_reels",
          status: "unknown_status",
          totalScenes: 1,
          approvedScenes: 0,
          createdAt: "2026-09-03T12:00:00.000Z"
        })
      ).toThrow();
    });

    it("rejects negative approvedScenes", () => {
      expect(() =>
        CampaignResponseSchema.parse({
          campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          title: "Summer 2026 Collection",
          targetPlatform: "instagram_reels",
          status: "drafting",
          totalScenes: 1,
          approvedScenes: -1,
          createdAt: "2026-09-03T12:00:00.000Z"
        })
      ).toThrow();
    });
  });

  describe("CreateSceneRequestSchema", () => {
    it("parses valid scene configuration", () => {
      const payload = {
        configuration: {
          prompt: "Cinematic shot of carnival dancer in golden plumage",
          referenceIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"],
          engineProfileId: "ltx_25",
          durationMs: 5000,
          loraConfigurationId: "lora-carnival-v1"
        }
      };

      const parsed = CreateSceneRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-positive durationMs", () => {
      expect(() =>
        CreateSceneRequestSchema.parse({
          configuration: {
            prompt: "Cinematic shot",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 0
          }
        })
      ).toThrow();

      expect(() =>
        CreateSceneRequestSchema.parse({
          configuration: {
            prompt: "Cinematic shot",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: -5000
          }
        })
      ).toThrow();
    });

    it("rejects empty engineProfileId", () => {
      expect(() =>
        CreateSceneRequestSchema.parse({
          configuration: {
            prompt: "Cinematic shot",
            referenceIds: [],
            engineProfileId: "",
            durationMs: 5000
          }
        })
      ).toThrow();
    });
  });

  describe("SceneCreateResponseSchema", () => {
    it("parses valid scene create response", () => {
      const payload = {
        sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73810",
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        status: "draft_pending",
        specRevision: 1,
        configuration: {
          prompt: "Cinematic shot of carnival dancer",
          referenceIds: [],
          engineProfileId: "ltx_25",
          durationMs: 5000,
          loraConfigurationId: null
        }
      };

      const parsed = SceneCreateResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects invalid scene status", () => {
      expect(() =>
        SceneCreateResponseSchema.parse({
          sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73810",
          campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
          status: "invalid_scene_status",
          specRevision: 1,
          configuration: {
            prompt: "Cinematic shot",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 5000
          }
        })
      ).toThrow();
    });
  });
});
