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
  isCreateSceneManualRequest,
  CreateCampaignShellRequestSchema,
  CreateCampaignShellResponseSchema,
  PlanCampaignStoryboardRequestSchema,
  PlanCampaignStoryboardResponseSchema,
  PlanCampaignStoryboardErrorResponseSchema,
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  MIN_SCENE_DURATION_MS,
  MAX_SCENE_DURATION_MS
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

  describe("CreateCampaignShellRequestSchema", () => {
    it("exports expected bound constants", () => {
      expect(MIN_TARGET_DURATION_MS).toBe(5_000);
      expect(MAX_TARGET_DURATION_MS).toBe(300_000);
      expect(MIN_SCENE_COUNT).toBe(1);
      expect(MAX_SCENE_COUNT).toBe(60);
      expect(MIN_SCENE_DURATION_MS).toBe(1_000);
      expect(MAX_SCENE_DURATION_MS).toBe(15_000);
    });

    const validBase = {
      idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      title: "Summer 2026 Collection",
      targetTotalDurationMs: 15000
    };

    it("parses valid request without sceneCountOverride", () => {
      const parsed = CreateCampaignShellRequestSchema.parse(validBase);
      expect(parsed).toEqual(validBase);
    });

    it("parses valid request with sceneCountOverride and targetPlatform", () => {
      const payload = {
        ...validBase,
        targetPlatform: "tiktok",
        sceneCountOverride: 3
      };
      const parsed = CreateCampaignShellRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-UUID idempotencyKey", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          idempotencyKey: "not-a-uuid"
        })
      ).toThrow();
    });

    it("rejects non-UUID clientId", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          clientId: "not-a-uuid"
        })
      ).toThrow();
    });

    it("rejects empty title", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          title: ""
        })
      ).toThrow();
    });

    it("rejects duration below MIN_TARGET_DURATION_MS", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: MIN_TARGET_DURATION_MS - 1
        })
      ).toThrow();
    });

    it("rejects duration above MAX_TARGET_DURATION_MS", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: MAX_TARGET_DURATION_MS + 1
        })
      ).toThrow();
    });

    it("rejects non-integer duration", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: 15000.5
        })
      ).toThrow();
    });

    it("rejects sceneCountOverride below MIN_SCENE_COUNT", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          sceneCountOverride: MIN_SCENE_COUNT - 1
        })
      ).toThrow();
    });

    it("rejects sceneCountOverride above MAX_SCENE_COUNT", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          sceneCountOverride: MAX_SCENE_COUNT + 1
        })
      ).toThrow();
    });

    it("rejects non-integer sceneCountOverride", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          sceneCountOverride: 3.5
        })
      ).toThrow();
    });

    it("rejects combination where implied per-scene duration is below MIN_SCENE_DURATION_MS (reviewer witness: 5000ms, 60 scenes)", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: 5000,
          sceneCountOverride: 60
        })
      ).toThrow(
        /targetTotalDurationMs and sceneCountOverride imply an unsupported per-scene duration/
      );
    });

    it("rejects combination where implied per-scene duration is above MAX_SCENE_DURATION_MS (300000ms, 1 scene)", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: 300000,
          sceneCountOverride: 1
        })
      ).toThrow(
        /targetTotalDurationMs and sceneCountOverride imply an unsupported per-scene duration/
      );
    });

    it("accepts valid combinations at per-scene duration boundaries", () => {
      // 5000ms / 5 scenes = 1000ms (MIN_SCENE_DURATION_MS)
      expect(
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: 5000,
          sceneCountOverride: 5
        })
      ).toBeDefined();

      // 15000ms / 1 scene = 15000ms (MAX_SCENE_DURATION_MS)
      expect(
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: 15000,
          sceneCountOverride: 1
        })
      ).toBeDefined();
    });

    it("rejects unknown properties (.strict)", () => {
      expect(() =>
        CreateCampaignShellRequestSchema.parse({
          ...validBase,
          unknownField: true
        })
      ).toThrow();
    });
  });

  describe("CreateCampaignShellResponseSchema", () => {
    const validResponse = {
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      status: "drafting",
      totalScenes: 3,
      targetTotalDurationMs: 15000,
      isIdempotentReplay: false,
      createdAt: "2026-09-10T12:00:00.000Z"
    };

    it("parses valid response payload", () => {
      const parsed = CreateCampaignShellResponseSchema.parse(validResponse);
      expect(parsed).toEqual(validResponse);
    });

    it("parses valid response payload with optional archivedAt", () => {
      const archivedTime = "2026-09-10T13:00:00.000Z";
      const parsed = CreateCampaignShellResponseSchema.parse({
        ...validResponse,
        archivedAt: archivedTime
      });
      expect(parsed).toEqual({
        ...validResponse,
        archivedAt: archivedTime
      });
    });

    it("rejects non-UUID campaignId or idempotencyKey", () => {
      expect(() =>
        CreateCampaignShellResponseSchema.parse({
          ...validResponse,
          campaignId: "bad-id"
        })
      ).toThrow();

      expect(() =>
        CreateCampaignShellResponseSchema.parse({
          ...validResponse,
          idempotencyKey: "bad-id"
        })
      ).toThrow();
    });

    it("rejects non-positive totalScenes or targetTotalDurationMs", () => {
      expect(() =>
        CreateCampaignShellResponseSchema.parse({
          ...validResponse,
          totalScenes: 0
        })
      ).toThrow();

      expect(() =>
        CreateCampaignShellResponseSchema.parse({
          ...validResponse,
          targetTotalDurationMs: 0
        })
      ).toThrow();
    });
  });

  describe("PlanCampaignStoryboardRequestSchema", () => {
    const validBase = {
      idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
      title: "Spring Collection 2026",
      targetPlatform: "tiktok",
      targetTotalDurationMs: 15000,
      brief: {
        title: "Spring Teaser",
        description: "Fresh pastel style cinematic showcase"
      }
    };

    it("parses valid request without optional fields", () => {
      const parsed = PlanCampaignStoryboardRequestSchema.parse(validBase);
      expect(parsed).toEqual(validBase);
    });

    it("parses valid request with candidateReferenceAssetIds and sceneCountOverride", () => {
      const payload = {
        ...validBase,
        sceneCountOverride: 3,
        candidateReferenceAssetIds: ["ref-1", "ref-2"]
      };
      const parsed = PlanCampaignStoryboardRequestSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("rejects non-UUID idempotencyKey or clientId", () => {
      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          idempotencyKey: "invalid"
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          clientId: "invalid"
        })
      ).toThrow();
    });

    it("rejects invalid targetTotalDurationMs below MIN_TARGET_DURATION_MS or above MAX_TARGET_DURATION_MS", () => {
      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: MIN_TARGET_DURATION_MS - 1
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: MAX_TARGET_DURATION_MS + 1
        })
      ).toThrow();
    });

    it("rejects invalid sceneCountOverride below MIN_SCENE_COUNT or above MAX_SCENE_COUNT", () => {
      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          sceneCountOverride: MIN_SCENE_COUNT - 1
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          sceneCountOverride: MAX_SCENE_COUNT + 1
        })
      ).toThrow();
    });

    it("rejects incompatible targetTotalDurationMs and sceneCountOverride combination", () => {
      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          targetTotalDurationMs: 5000,
          sceneCountOverride: 10
        })
      ).toThrow(
        /targetTotalDurationMs and sceneCountOverride imply an unsupported per-scene duration/
      );
    });

    it("rejects unknown properties (.strict)", () => {
      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          unknownField: "disallowed"
        })
      ).toThrow();
    });

    it("rejects missing or invalid brief", () => {
      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          brief: undefined
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardRequestSchema.parse({
          ...validBase,
          brief: { title: "Missing description" }
        })
      ).toThrow();
    });
  });

  describe("PlanCampaignStoryboardResponseSchema", () => {
    const validResponse = {
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      idempotencyKey: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
      status: "drafting",
      totalScenes: 3,
      targetTotalDurationMs: 15000,
      isIdempotentReplay: false,
      sceneCount: 3,
      scenes: [
        {
          sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73811",
          ordinal: 1,
          status: "generating_candidates"
        },
        {
          sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73812",
          ordinal: 2,
          status: "generating_candidates"
        },
        {
          sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73813",
          ordinal: 3,
          status: "generating_candidates"
        }
      ],
      createdAt: "2026-09-10T12:00:00.000Z"
    };

    it("parses valid response payload", () => {
      const parsed = PlanCampaignStoryboardResponseSchema.parse(validResponse);
      expect(parsed).toEqual(validResponse);
    });

    it("rejects non-UUID campaignId or idempotencyKey", () => {
      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          campaignId: "invalid-uuid"
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          idempotencyKey: "invalid-uuid"
        })
      ).toThrow();
    });

    it("rejects invalid status", () => {
      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          status: "non_existent_status"
        })
      ).toThrow();
    });

    it("rejects non-positive totalScenes or negative sceneCount", () => {
      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          totalScenes: 0
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          sceneCount: -1
        })
      ).toThrow();
    });

    it("rejects invalid scene items in scenes array", () => {
      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          scenes: [
            {
              sceneId: "bad-id",
              ordinal: 1,
              status: "generating_candidates"
            }
          ]
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardResponseSchema.parse({
          ...validResponse,
          scenes: [
            {
              sceneId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73811",
              ordinal: 0,
              status: "generating_candidates"
            }
          ]
        })
      ).toThrow();
    });
  });

  describe("PlanCampaignStoryboardErrorResponseSchema", () => {
    it("parses valid error response with code, message, and details", () => {
      const payload = {
        code: "STORYBOARD_MATERIALIZATION_CONFLICT",
        message: "A conflict occurred during storyboard materialization",
        details: {
          campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
          reason: "Scene count mismatch"
        }
      };

      const parsed = PlanCampaignStoryboardErrorResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
    });

    it("parses valid error response with only message (fallback branch)", () => {
      const payload = {
        message: "Internal Server Error"
      };

      const parsed = PlanCampaignStoryboardErrorResponseSchema.parse(payload);
      expect(parsed).toEqual(payload);
      expect(parsed.code).toBeUndefined();
    });

    it("rejects payload missing message", () => {
      expect(() =>
        PlanCampaignStoryboardErrorResponseSchema.parse({
          code: "VALIDATION_FAILURE"
        })
      ).toThrow();
    });

    it("rejects non-string code or message", () => {
      expect(() =>
        PlanCampaignStoryboardErrorResponseSchema.parse({
          code: 123,
          message: "Valid message"
        })
      ).toThrow();

      expect(() =>
        PlanCampaignStoryboardErrorResponseSchema.parse({
          message: 456
        })
      ).toThrow();
    });
  });
});
