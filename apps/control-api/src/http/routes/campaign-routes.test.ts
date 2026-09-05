import { describe, expect, it } from "vitest";
import {
  ClientNotFoundError,
  type CampaignRepository,
  type ClientRepository,
  type PlanningModelClientPort,
  type ReferenceAssetRepository,
  type SceneRepository,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import type { CampaignId, CampaignRecord, ClientRecord, Scene, SceneId } from "@cco/domain";
import { createControlApiApp } from "../app.js";

const validClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
const validCampaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73800";

class FakeCampaignUnitOfWork implements UnitOfWork {
  private readonly _campaigns = new Map<string, CampaignRecord>();
  private readonly _scenes = new Map<SceneId, Scene>();
  private readonly _clients = new Map<string, ClientRecord>();

  constructor(
    seededCampaigns: CampaignRecord[] = [],
    private readonly onSaveCampaign?: (campaign: CampaignRecord) => Promise<void> | void,
    seededClients: ClientRecord[] = []
  ) {
    for (const c of seededCampaigns) {
      this._campaigns.set(c.id, c);
    }
    for (const cl of seededClients) {
      this._clients.set(cl.id, cl);
    }
    if (!this._clients.has(validClientId)) {
      this._clients.set(validClientId, {
        id: validClientId,
        companyName: "Acme Corp",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: false,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: [],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      });
    }
  }

  get savedCampaigns(): readonly CampaignRecord[] {
    return Array.from(this._campaigns.values());
  }

  get savedScenes(): readonly Scene[] {
    return Array.from(this._scenes.values());
  }

  get savedClients(): readonly ClientRecord[] {
    return Array.from(this._clients.values());
  }

  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({
      scenes: {
        findById: async (id: SceneId) => this._scenes.get(id),
        save: async (scene: Scene) => {
          this._scenes.set(scene.id, scene);
        }
      } as SceneRepository,
      reviewEvents: {
        findById: async () => undefined,
        append: async () => {}
      },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      },
      campaigns: {
        findById: async (id: string) => this._campaigns.get(id),
        save: async (campaign: CampaignRecord) => {
          if (this.onSaveCampaign) {
            await this.onSaveCampaign(campaign);
          }
          this._campaigns.set(campaign.id, campaign);
        }
      } as CampaignRepository<CampaignRecord>,
      clients: {
        findById: async (id: string) => this._clients.get(id),
        save: async (client: ClientRecord) => {
          this._clients.set(client.id, client);
        }
      } as ClientRepository<ClientRecord>
    });
  }
}

describe("Campaign and Scene Creation HTTP Routes", () => {
  const seededCampaign: CampaignRecord = {
    id: validCampaignId as CampaignId,
    clientId: validClientId,
    title: "Seeded Campaign",
    targetPlatform: "instagram_reels",
    status: "drafting",
    totalScenes: 1,
    approvedScenes: 0,
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z"
  };

  describe("POST /api/campaigns", () => {
    it("creates a campaign with explicit fields and returns 201", async () => {
      const uow = new FakeCampaignUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/campaigns",
        payload: {
          clientId: validClientId,
          title: "Summer Collection",
          targetPlatform: "tiktok",
          totalScenes: 4
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.campaignId).toBeDefined();
      expect(body.clientId).toBe(validClientId);
      expect(body.title).toBe("Summer Collection");
      expect(body.targetPlatform).toBe("tiktok");
      expect(body.status).toBe("drafting");
      expect(body.totalScenes).toBe(4);
      expect(body.approvedScenes).toBe(0);
      expect(body.createdAt).toBeDefined();

      expect(uow.savedCampaigns).toHaveLength(1);
    });

    it("creates a campaign with default values applied when targetPlatform and totalScenes are omitted", async () => {
      const uow = new FakeCampaignUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/campaigns",
        payload: {
          clientId: validClientId,
          title: "Minimal Campaign"
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.targetPlatform).toBe("instagram_reels");
      expect(body.totalScenes).toBe(1);
      expect(body.status).toBe("drafting");
      expect(body.approvedScenes).toBe(0);
    });

    it("returns 400 VALIDATION_FAILURE when required fields are missing or invalid", async () => {
      const uow = new FakeCampaignUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/campaigns",
        payload: {
          clientId: "not-a-uuid",
          title: ""
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 404 NOT_FOUND when clientId does not exist (ClientNotFoundError)", async () => {
      const uow = new FakeCampaignUnitOfWork([], (c) => {
        throw new ClientNotFoundError(c.clientId);
      });
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/campaigns",
        payload: {
          clientId: validClientId,
          title: "Orphan Campaign"
        }
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe("NOT_FOUND");
      expect(body.message).toContain(`Client '${validClientId}' was not found.`);
    });
  });

  describe("POST /api/campaigns/:campaignId/scenes", () => {
    it("creates a scene under an existing campaign and returns 201 with status draft_pending", async () => {
      const uow = new FakeCampaignUnitOfWork([seededCampaign]);
      const app = createControlApiApp({ uow });

      const configuration = {
        prompt: "Wide shot of dancers in traditional festival garments",
        referenceIds: ["018e69e0-8a6a-72cb-b1b7-ec79a1f73802"],
        engineProfileId: "ltx_25",
        durationMs: 5000,
        loraConfigurationId: "festival-v1"
      };

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: { configuration }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.sceneId).toBeDefined();
      expect(body.campaignId).toBe(validCampaignId);
      expect(body.status).toBe("draft_pending");
      expect(body.specRevision).toBe(1);
      expect(body.configuration).toEqual(configuration);

      expect(uow.savedScenes).toHaveLength(1);
    });

    it("preserves an explicitly null loraConfigurationId", async () => {
      const uow = new FakeCampaignUnitOfWork([seededCampaign]);
      const app = createControlApiApp({ uow });
      const configuration = {
        prompt: "A null LoRA configuration is authored explicitly",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000,
        loraConfigurationId: null
      };

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: { configuration }
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().configuration).toEqual(configuration);
      expect(uow.savedScenes[0]?.snapshot().configuration).toEqual(configuration);
    });

    it("returns 404 NOT_FOUND when campaign does not exist", async () => {
      const uow = new FakeCampaignUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          configuration: {
            prompt: "Scene prompt",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 5000
          }
        }
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe("NOT_FOUND");
      expect(body.message).toContain(`Campaign '${validCampaignId}' was not found.`);
    });

    it("returns 400 VALIDATION_FAILURE when scene configuration is invalid", async () => {
      const uow = new FakeCampaignUnitOfWork([seededCampaign]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          configuration: {
            prompt: "Scene prompt",
            referenceIds: [],
            engineProfileId: "",
            durationMs: 0
          }
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 when campaignId route param is not a valid UUID", async () => {
      const uow = new FakeCampaignUnitOfWork([seededCampaign]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/not-a-uuid/scenes`,
        payload: {
          configuration: {
            prompt: "Scene prompt",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 5000
          }
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 SCENE_CREATION_MODE_MISMATCH when client has allowCloudPlanning: true but manual body is submitted", async () => {
      const cloudClient: ClientRecord = {
        id: validClientId,
        companyName: "Cloud Corp",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: ["Anthropic", "OpenAI"],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      };

      const uow = new FakeCampaignUnitOfWork([seededCampaign], undefined, [cloudClient]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          configuration: {
            prompt: "Manual prompt",
            referenceIds: [],
            engineProfileId: "ltx_25",
            durationMs: 5000
          }
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("SCENE_CREATION_MODE_MISMATCH");
    });

    it("creates a scene with planned configuration and returns 201 when client has allowCloudPlanning: true and brief body is submitted", async () => {
      const cloudClient: ClientRecord = {
        id: validClientId,
        companyName: "Cloud Corp",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: ["Anthropic", "OpenAI"],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      };

      const plannedConfig = {
        prompt: "AI generated cinematic sunrise over carnival stage",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 5000,
        loraConfigurationId: null
      };

      const uow = new FakeCampaignUnitOfWork([seededCampaign], undefined, [cloudClient]);
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(plannedConfig)
        })
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(plannedConfig)
        })
      };
      const mockAssetRepo: ReferenceAssetRepository = {
        listBySceneId: async () => [],
        findByIds: async () => []
      };

      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          brief: {
            title: "Sunrise Reveal",
            description: "Opening shot of dawn breaking over carnival dancers",
            targetPlatform: "tiktok"
          }
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.sceneId).toBeDefined();
      expect(body.campaignId).toBe(validCampaignId);
      expect(body.status).toBe("draft_pending");
      expect(body.configuration).toEqual(plannedConfig);
      expect(uow.savedScenes).toHaveLength(1);
    });

    it("returns 500 CONFIGURATION_ERROR when client has allowCloudPlanning: true but no planning provider configured", async () => {
      const cloudClient: ClientRecord = {
        id: validClientId,
        companyName: "Cloud Corp",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: ["Anthropic", "OpenAI"],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      };

      const uow = new FakeCampaignUnitOfWork([seededCampaign], undefined, [cloudClient]);
      // Container created without planningModelClients/referenceAssetRepository
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          brief: {
            description: "A brief with no planning provider wired"
          }
        }
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.code).toBe("CONFIGURATION_ERROR");
    });

    it("returns 400 SCENE_CREATION_MODE_MISMATCH when client has allowCloudPlanning: false but brief body is submitted", async () => {
      // Default seededClient in FakeCampaignUnitOfWork has allowCloudPlanning: false
      const uow = new FakeCampaignUnitOfWork([seededCampaign]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          brief: {
            description: "A brief submitted to a client requiring manual configuration"
          }
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("SCENE_CREATION_MODE_MISMATCH");
    });

    it("creates a scene preserving targetDurationMs from approved beat brief", async () => {
      const cloudClient: ClientRecord = {
        id: validClientId,
        companyName: "Cloud Corp",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: ["Anthropic", "OpenAI"],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      };

      const plannedConfigWithTarget = {
        prompt: "AI generated cinematic hero shot of electric scooter",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 3500,
        loraConfigurationId: null
      };

      const uow = new FakeCampaignUnitOfWork([seededCampaign], undefined, [cloudClient]);
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(plannedConfigWithTarget)
        })
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(plannedConfigWithTarget)
        })
      };
      const mockAssetRepo: ReferenceAssetRepository = {
        listBySceneId: async () => [],
        findByIds: async () => []
      };

      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          brief: {
            title: "Beat 1 Scene",
            description: "Opening shot of dawn breaking"
          },
          targetDurationMs: 3500
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.configuration.durationMs).toBe(3500);
      expect(uow.savedScenes[0]?.snapshot().configuration.durationMs).toBe(3500);
    });

    it("returns 400 VALIDATION_FAILURE when targetDurationMs > maxDurationMs without calling provider or repository", async () => {
      let providerCalls = 0;
      let repositoryCalls = 0;
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async () => {
          providerCalls++;
          return { kind: "success", rawText: "{}" };
        }
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => {
          providerCalls++;
          return { kind: "success", rawText: "{}" };
        }
      };
      const mockAssetRepo: ReferenceAssetRepository = {
        listBySceneId: async () => [],
        findByIds: async () => {
          repositoryCalls++;
          return [];
        }
      };

      const clientWithCloud: ClientRecord = {
        id: validClientId,
        companyName: "Cloud Corp",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {
          allowCloudPlanning: true,
          allowCloudVisualQA: true,
          allowCloudVoice: true,
          allowedProviders: ["Anthropic", "OpenAI"],
          sensitiveDataMasking: true
        },
        createdAt: "2026-09-03T12:00:00.000Z",
        updatedAt: "2026-09-03T12:00:00.000Z"
      };

      const app = createControlApiApp({
        uow: new FakeCampaignUnitOfWork([seededCampaign], undefined, [clientWithCloud]),
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/scenes`,
        payload: {
          brief: {
            title: "Contradictory Scene",
            description: "Duration test"
          },
          maxDurationMs: 3000,
          targetDurationMs: 4000
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(providerCalls).toBe(0);
      expect(repositoryCalls).toBe(0);
    });
  });

  describe("POST /api/campaigns/:campaignId/beat-sheet", () => {
    const cloudClient: ClientRecord = {
      id: validClientId,
      companyName: "Cloud Corp",
      brandBibleJson: {},
      defaultAspectRatio: "9:16",
      externalProcessingPolicy: {
        allowCloudPlanning: true,
        allowCloudVisualQA: true,
        allowCloudVoice: true,
        allowedProviders: ["Anthropic", "OpenAI"],
        sensitiveDataMasking: true
      },
      createdAt: "2026-09-03T12:00:00.000Z",
      updatedAt: "2026-09-03T12:00:00.000Z"
    };

    const campaignWith3Scenes: CampaignRecord = {
      ...seededCampaign,
      totalScenes: 3
    };

    const validBeatSheetModelOutput = {
      beats: [
        {
          ordinal: 1,
          brief: {
            title: "Hook",
            description: "Close-up of wheels lighting up"
          },
          targetDurationMs: 2500
        },
        {
          ordinal: 2,
          brief: {
            title: "Action",
            description: "Rider navigating city traffic at night"
          },
          targetDurationMs: 5000
        },
        {
          ordinal: 3,
          brief: {
            title: "Call to Action",
            description: "Product lockup and preorder URL"
          },
          targetDurationMs: 2500
        }
      ]
    };

    it("proposes beat sheet with exactly campaign.totalScenes beats and 200 without creating scenes or mutating campaign", async () => {
      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes], undefined, [cloudClient]);
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(validBeatSheetModelOutput)
        })
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(validBeatSheetModelOutput)
        })
      };
      const mockAssetRepo: ReferenceAssetRepository = {
        listBySceneId: async () => [],
        findByIds: async () => []
      };

      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: {
            title: "10s Product Teaser",
            description: "High-energy commercial launching our new scooter",
            targetPlatform: "tiktok"
          },
          targetTotalDurationMs: 10000
        }
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.campaignId).toBe(validCampaignId);
      expect(body.targetTotalDurationMs).toBe(10000);
      expect(body.beats).toHaveLength(3);
      expect(body.beats[0]?.ordinal).toBe(1);
      expect(body.beats[0]?.targetDurationMs).toBe(2500);
      expect(body.beats[1]?.ordinal).toBe(2);
      expect(body.beats[1]?.targetDurationMs).toBe(5000);
      expect(body.beats[2]?.ordinal).toBe(3);
      expect(body.beats[2]?.targetDurationMs).toBe(2500);

      // Invariant: no scenes created, no campaign mutations
      expect(uow.savedScenes).toHaveLength(0);
      expect(uow.savedCampaigns).toEqual([campaignWith3Scenes]);
    });

    it("returns 403 CLOUD_PLANNING_NOT_AUTHORIZED when client has allowCloudPlanning: false", async () => {
      // Default seededClient in FakeCampaignUnitOfWork has allowCloudPlanning: false
      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes]);
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(validBeatSheetModelOutput)
        })
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => ({
          kind: "success",
          rawText: JSON.stringify(validBeatSheetModelOutput)
        })
      };
      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: { listBySceneId: async () => [], findByIds: async () => [] }
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: {
            description: "High-energy teaser"
          },
          targetTotalDurationMs: 10000
        }
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe("CLOUD_PLANNING_NOT_AUTHORIZED");
    });

    it("returns 404 NOT_FOUND when campaign does not exist", async () => {
      const uow = new FakeCampaignUnitOfWork([], undefined, [cloudClient]);
      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: {
            providerName: "Anthropic",
            complete: async () => ({ kind: "success", rawText: "{}" })
          },
          fallback: {
            providerName: "OpenAI",
            complete: async () => ({ kind: "success", rawText: "{}" })
          }
        },
        referenceAssetRepository: { listBySceneId: async () => [], findByIds: async () => [] }
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: { description: "Teaser" },
          targetTotalDurationMs: 10000
        }
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().code).toBe("NOT_FOUND");
    });

    it("returns 400 VALIDATION_FAILURE when targetTotalDurationMs is non-positive or brief is empty", async () => {
      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes], undefined, [cloudClient]);
      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: {
            providerName: "Anthropic",
            complete: async () => ({ kind: "success", rawText: "{}" })
          },
          fallback: {
            providerName: "OpenAI",
            complete: async () => ({ kind: "success", rawText: "{}" })
          }
        },
        referenceAssetRepository: { listBySceneId: async () => [], findByIds: async () => [] }
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: { description: "" },
          targetTotalDurationMs: 0
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 VALIDATION_FAILURE when targetTotalDurationMs < campaign.totalScenes without provider or repository calls", async () => {
      let providerCalls = 0;
      let repositoryCalls = 0;
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async () => {
          providerCalls++;
          return { kind: "success", rawText: "{}" };
        }
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => {
          providerCalls++;
          return { kind: "success", rawText: "{}" };
        }
      };
      const mockAssetRepo: ReferenceAssetRepository = {
        listBySceneId: async () => [],
        findByIds: async () => {
          repositoryCalls++;
          return [];
        }
      };

      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes], undefined, [cloudClient]);
      const app = createControlApiApp({
        uow,
        planningModelClients: {
          primary: mockPrimary,
          fallback: mockFallback
        },
        referenceAssetRepository: mockAssetRepo
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: { description: "Valid brief" },
          targetTotalDurationMs: 2
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
      expect(providerCalls).toBe(0);
      expect(repositoryCalls).toBe(0);
    });

    it("returns 400 when campaignId is not a valid UUID", async () => {
      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes], undefined, [cloudClient]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/invalid-uuid/beat-sheet`,
        payload: {
          brief: { description: "Valid brief" },
          targetTotalDurationMs: 10000
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 500 CONFIGURATION_ERROR when no planning provider is configured on container", async () => {
      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes], undefined, [cloudClient]);
      const app = createControlApiApp({ uow }); // No planningModelClients provided

      const response = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: { description: "Valid brief" },
          targetTotalDurationMs: 10000
        }
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().code).toBe("CONFIGURATION_ERROR");
    });

    it("executes end-to-end flow: proposes beat sheet then creates approved scenes with targetDurationMs preserved", async () => {
      const uow = new FakeCampaignUnitOfWork([campaignWith3Scenes], undefined, [cloudClient]);
      let callCount = 0;
      const mockPrimary: PlanningModelClientPort = {
        providerName: "Anthropic",
        complete: async (req) => {
          callCount++;
          // First call is for beat sheet
          if (callCount === 1) {
            return {
              kind: "success",
              rawText: JSON.stringify(validBeatSheetModelOutput)
            };
          }
          // Subsequent calls are for scene creation: match target duration from userPrompt
          let durationMs = 2500;
          if (req.userPrompt.includes("city traffic")) {
            durationMs = 5000;
          }
          return {
            kind: "success",
            rawText: JSON.stringify({
              prompt: "Planned scene prompt",
              referenceIds: [],
              engineProfileId: "LTX_25_720P_5S_V1",
              durationMs,
              loraConfigurationId: null
            })
          };
        }
      };
      const mockFallback: PlanningModelClientPort = {
        providerName: "OpenAI",
        complete: async () => ({ kind: "retryable_failure", message: "unused" })
      };
      const app = createControlApiApp({
        uow,
        planningModelClients: { primary: mockPrimary, fallback: mockFallback },
        referenceAssetRepository: { listBySceneId: async () => [], findByIds: async () => [] }
      });

      // 1. Propose beat sheet
      const beatSheetRes = await app.inject({
        method: "POST",
        url: `/api/campaigns/${validCampaignId}/beat-sheet`,
        payload: {
          brief: { description: "High-energy commercial" },
          targetTotalDurationMs: 10000
        }
      });
      expect(beatSheetRes.statusCode).toBe(200);
      const beatSheet = beatSheetRes.json();
      expect(beatSheet.beats).toHaveLength(3);

      // 2. Create scenes one by one using approved beats and their targetDurationMs
      for (const beat of beatSheet.beats) {
        const sceneRes = await app.inject({
          method: "POST",
          url: `/api/campaigns/${validCampaignId}/scenes`,
          payload: {
            brief: beat.brief,
            targetDurationMs: beat.targetDurationMs
          }
        });
        expect(sceneRes.statusCode).toBe(201);
        const scene = sceneRes.json();
        expect(scene.configuration.durationMs).toBe(beat.targetDurationMs);
      }

      // Assert exactly 3 scenes were created with exact planned durations
      expect(uow.savedScenes).toHaveLength(3);
      expect(uow.savedScenes[0]?.snapshot().configuration.durationMs).toBe(2500);
      expect(uow.savedScenes[1]?.snapshot().configuration.durationMs).toBe(5000);
      expect(uow.savedScenes[2]?.snapshot().configuration.durationMs).toBe(2500);
    });
  });
});
