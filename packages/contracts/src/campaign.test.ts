import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_STATUSES,
  CampaignResponseSchema,
  CampaignStatusSchema,
  CreateCampaignRequestSchema,
  CreateSceneRequestSchema,
  CreativeBriefSchema,
  SceneCreateResponseSchema,
  PlanCampaignBeatSheetRequestSchema,
  CampaignBeatSchema,
  CampaignBeatSheetResponseSchema,
  isCreateSceneBriefRequest,
  isCreateSceneManualRequest
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

  describe("CreativeBriefSchema", () => {
    it("parses valid creative brief with all fields", () => {
      const payload = {
        title: "Carnival Opening",
        description: "Vibrant aerial view of carnival parade at dawn",
        targetPlatform: "tiktok",
        visualStyle: "golden hour cinematic",
        requirements: ["Must show steelpan drums", "Close-up of costume textures"]
      };

      const parsed = CreativeBriefSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("parses valid creative brief with only description", () => {
      const payload = {
        description: "Minimal brief description"
      };

      const parsed = CreativeBriefSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects empty description", () => {
      expect(() =>
        CreativeBriefSchema.parse({
          description: ""
        })
      ).toThrow();
    });

    it("rejects unknown properties (.strict)", () => {
      expect(() =>
        CreativeBriefSchema.parse({
          description: "Valid description",
          campaignId: "should-not-be-in-brief"
        })
      ).toThrow();
    });
  });

  describe("CreateSceneRequestSchema", () => {
    it("parses valid scene configuration (manual branch)", () => {
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
      expect(isCreateSceneManualRequest(parsed)).toBe(true);
      expect(isCreateSceneBriefRequest(parsed)).toBe(false);
    });

    it("parses valid brief request (brief branch)", () => {
      const payload = {
        brief: {
          title: "Carnival Intro",
          description: "High-energy intro with vibrant colors",
          targetPlatform: "instagram_reels",
          visualStyle: "saturated hyper-real",
          requirements: ["Feature steel drums"]
        },
        candidateReferenceAssetIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"],
        maxDurationMs: 6000,
        targetDurationMs: 4500
      };

      const parsed = CreateSceneRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
      expect(isCreateSceneBriefRequest(parsed)).toBe(true);
      expect(isCreateSceneManualRequest(parsed)).toBe(false);
    });

    it("rejects non-positive or non-integer targetDurationMs", () => {
      expect(() =>
        CreateSceneRequestSchema.parse({
          brief: { description: "Test" },
          targetDurationMs: 0
        })
      ).toThrow();

      expect(() =>
        CreateSceneRequestSchema.parse({
          brief: { description: "Test" },
          targetDurationMs: -100
        })
      ).toThrow();

      expect(() =>
        CreateSceneRequestSchema.parse({
          brief: { description: "Test" },
          targetDurationMs: 3500.5
        })
      ).toThrow();
    });

    it("rejects contradictory payload where targetDurationMs > maxDurationMs", () => {
      expect(() =>
        CreateSceneRequestSchema.parse({
          brief: { description: "Test" },
          maxDurationMs: 3000,
          targetDurationMs: 4000
        })
      ).toThrow();
    });

    it("parses minimal brief request without optional fields", () => {
      const payload = {
        brief: {
          description: "A short clip of tropical waves crashing"
        }
      };

      const parsed = CreateSceneRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
      expect(isCreateSceneBriefRequest(parsed)).toBe(true);
      expect(isCreateSceneManualRequest(parsed)).toBe(false);
    });

    it("rejects mixed payload containing both configuration and brief", () => {
      expect(() =>
        CreateSceneRequestSchema.parse({
          configuration: {
            prompt: "Cinematic shot",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 5000
          },
          brief: {
            description: "A brief alongside configuration"
          }
        })
      ).toThrow();
    });

    it("rejects payload with neither configuration nor brief", () => {
      expect(() => CreateSceneRequestSchema.parse({})).toThrow();
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

  describe("PlanCampaignBeatSheetRequestSchema", () => {
    it("parses valid payload with all fields", () => {
      const payload = {
        brief: {
          title: "Summer Beat Plan",
          description: "High energy summer product video"
        },
        targetTotalDurationMs: 10000,
        candidateReferenceAssetIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"]
      };

      const parsed = PlanCampaignBeatSheetRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("parses valid payload without optional candidateReferenceAssetIds", () => {
      const payload = {
        brief: {
          description: "Minimal brief description"
        },
        targetTotalDurationMs: 5000
      };

      const parsed = PlanCampaignBeatSheetRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-positive targetTotalDurationMs", () => {
      expect(() =>
        PlanCampaignBeatSheetRequestSchema.parse({
          brief: { description: "Test" },
          targetTotalDurationMs: 0
        })
      ).toThrow();

      expect(() =>
        PlanCampaignBeatSheetRequestSchema.parse({
          brief: { description: "Test" },
          targetTotalDurationMs: -5000
        })
      ).toThrow();
    });

    it("rejects extra unknown fields (.strict)", () => {
      expect(() =>
        PlanCampaignBeatSheetRequestSchema.parse({
          brief: { description: "Test" },
          targetTotalDurationMs: 5000,
          unexpected: true
        })
      ).toThrow();
    });
  });

  describe("CampaignBeatSchema", () => {
    it("parses valid beat with required fields", () => {
      const payload = {
        ordinal: 1,
        brief: {
          description: "A fast reveal of the vehicle"
        },
        targetDurationMs: 2500
      };
      const parsed = CampaignBeatSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-positive ordinal or targetDurationMs", () => {
      expect(() =>
        CampaignBeatSchema.parse({
          ordinal: 0,
          brief: { description: "Valid brief" },
          targetDurationMs: 2500
        })
      ).toThrow();

      expect(() =>
        CampaignBeatSchema.parse({
          ordinal: 1,
          brief: { description: "Valid brief" },
          targetDurationMs: -100
        })
      ).toThrow();
    });
  });

  describe("CampaignBeatSheetResponseSchema", () => {
    it("parses valid beat sheet response", () => {
      const payload = {
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 5000,
        beats: [
          {
            ordinal: 1,
            brief: { description: "Beat 1" },
            targetDurationMs: 2500
          },
          {
            ordinal: 2,
            brief: { description: "Beat 2" },
            targetDurationMs: 2500
          }
        ]
      };

      const parsed = CampaignBeatSheetResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-UUID campaignId", () => {
      expect(() =>
        CampaignBeatSheetResponseSchema.parse({
          campaignId: "not-a-uuid",
          targetTotalDurationMs: 5000,
          beats: []
        })
      ).toThrow();
    });
  });
});
