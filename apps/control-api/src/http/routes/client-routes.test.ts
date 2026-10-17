import { describe, expect, it } from "vitest";
import type {
  CampaignRepository,
  ClientRepository,
  ReviewEventStore,
  SceneRepository,
  StoryboardCandidateRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import type { CampaignRecord, ClientRecord, Scene, SceneId } from "@cco/domain";
import { createControlApiApp } from "../app.js";

class FakeClientUnitOfWork implements UnitOfWork {
  private readonly _clients = new Map<string, ClientRecord>();
  private readonly _campaigns = new Map<string, CampaignRecord>();
  private readonly _scenes = new Map<SceneId, Scene>();

  constructor(
    seededClients: ClientRecord[] = [],
    private readonly onSaveClient?: (client: ClientRecord) => Promise<void> | void
  ) {
    for (const c of seededClients) {
      this._clients.set(c.id, c);
    }
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
      } as ReviewEventStore,
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      } as StoryboardCandidateRepository,
      campaigns: {
        findById: async (id: string) => this._campaigns.get(id),
        save: async (campaign: CampaignRecord) => {
          this._campaigns.set(campaign.id, campaign);
        }
      } as CampaignRepository<CampaignRecord>,
      clients: {
        findById: async (id: string) => this._clients.get(id),
        save: async (client: ClientRecord) => {
          if (this.onSaveClient) {
            await this.onSaveClient(client);
          }
          this._clients.set(client.id, client);
        },
        listActive: async () => {
          return Array.from(this._clients.values())
            .map((c) => ({ clientId: c.id, companyName: c.companyName }))
            .sort((a, b) => {
              const comp = a.companyName.localeCompare(b.companyName);
              if (comp !== 0) return comp;
              return a.clientId.localeCompare(b.clientId);
            });
        }
      } as ClientRepository<ClientRecord>
    });
  }
}

describe("Client Creation HTTP Routes", () => {
  describe("POST /api/clients", () => {
    it("creates a client with explicit fields and returns 201", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const brandBibleJson = { palette: ["#FF5722", "#212121"], tone: "vibrant" };
      const externalProcessingPolicy = {
        allowCloudPlanning: false,
        allowCloudVisualQA: false,
        allowCloudVoice: true,
        allowedProviders: ["ElevenLabs"],
        sensitiveDataMasking: true
      };

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          companyName: "Acme Caribbean Productions",
          brandBibleJson,
          defaultAspectRatio: "16:9",
          externalProcessingPolicy
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.clientId).toBeDefined();
      expect(body.companyName).toBe("Acme Caribbean Productions");
      expect(body.brandBibleJson).toEqual(brandBibleJson);
      expect(body.defaultAspectRatio).toBe("16:9");
      expect(body.externalProcessingPolicy).toEqual(externalProcessingPolicy);
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();

      expect(uow.savedClients).toHaveLength(1);
      expect(uow.savedClients[0]?.id).toBe(body.clientId);
    });

    it("creates a client with default values applied when optional fields are omitted", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          companyName: "Minimal Client Inc"
        }
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.clientId).toBeDefined();
      expect(body.companyName).toBe("Minimal Client Inc");
      expect(body.brandBibleJson).toEqual({});
      expect(body.defaultAspectRatio).toBe("9:16");
      expect(body.externalProcessingPolicy).toEqual({
        allowCloudPlanning: true,
        allowCloudVisualQA: true,
        allowCloudVoice: true,
        allowedProviders: ["Anthropic", "OpenAI", "Google", "ElevenLabs"],
        sensitiveDataMasking: true
      });
      expect(body.createdAt).toBeDefined();
      expect(body.updatedAt).toBeDefined();
    });

    it("returns 400 VALIDATION_FAILURE when companyName is missing", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          brandBibleJson: {}
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 VALIDATION_FAILURE when companyName is empty string", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          companyName: ""
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 VALIDATION_FAILURE when companyName exceeds 255 characters", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          companyName: "x".repeat(256)
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 VALIDATION_FAILURE when defaultAspectRatio is empty string", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          companyName: "Valid Name",
          defaultAspectRatio: ""
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 VALIDATION_FAILURE when defaultAspectRatio exceeds 16 characters", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "POST",
        url: "/api/clients",
        payload: {
          companyName: "Valid Name",
          defaultAspectRatio: "x".repeat(17)
        }
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe("VALIDATION_FAILURE");
    });
  });

  describe("GET /api/clients", () => {
    it("returns empty array with 200 and Cache-Control: no-store when no clients exist", async () => {
      const uow = new FakeClientUnitOfWork();
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "GET",
        url: "/api/clients"
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.json()).toEqual([]);
    });

    it("returns populated list with exactly clientId and companyName, omitting internal fields", async () => {
      const client1: ClientRecord = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Acme Studios",
        brandBibleJson: { palette: ["#ff0000"] },
        defaultAspectRatio: "16:9",
        externalProcessingPolicy: { allowCloudVoice: false },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      };
      const client2: ClientRecord = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
        companyName: "Beta Productions",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {},
        createdAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z"
      };

      const uow = new FakeClientUnitOfWork([client2, client1]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "GET",
        url: "/api/clients"
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      const body = response.json();
      expect(body).toEqual([
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme Studios"
        },
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
          companyName: "Beta Productions"
        }
      ]);
      // Verify no leaked fields
      expect(body[0]).not.toHaveProperty("brandBibleJson");
      expect(body[0]).not.toHaveProperty("externalProcessingPolicy");
      expect(body[0]).not.toHaveProperty("defaultAspectRatio");
      expect(body[0]).not.toHaveProperty("createdAt");
      expect(body[0]).not.toHaveProperty("updatedAt");
    });

    it("orders clients deterministically by companyName ASC then clientId ASC and preserves duplicate names", async () => {
      const clientB = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73803",
        companyName: "Zenith",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {},
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      };
      const clientA2 = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
        companyName: "Acme",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {},
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      };
      const clientA1 = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Acme",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {},
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      };

      const uow = new FakeClientUnitOfWork([clientB, clientA2, clientA1]);
      const app = createControlApiApp({ uow });

      const response = await app.inject({
        method: "GET",
        url: "/api/clients"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
          companyName: "Acme"
        },
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
          companyName: "Acme"
        },
        {
          clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73803",
          companyName: "Zenith"
        }
      ]);
    });

    it("succeeds without any director authentication headers or client session mapping", async () => {
      const client: ClientRecord = {
        id: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Public Client",
        brandBibleJson: {},
        defaultAspectRatio: "9:16",
        externalProcessingPolicy: {},
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z"
      };
      const uow = new FakeClientUnitOfWork([client]);
      const app = createControlApiApp({ uow });

      // Request without Authorization, session tokens, or Tailscale headers
      const response = await app.inject({
        method: "GET",
        url: "/api/clients"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveLength(1);
    });
  });
});
