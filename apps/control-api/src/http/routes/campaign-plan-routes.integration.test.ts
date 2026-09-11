import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  insertStoryboardSceneRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import { runMigrations, PostgresUnitOfWork } from "@cco/infrastructure";
import type { CreativeBrief } from "@cco/contracts";
import type { Scene } from "@cco/domain";
import type {
  PlanningModelClientPort,
  PlanningModelOutcome,
  PlanningModelRequest,
  ReferenceAssetRepository,
  SceneRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import { computeCampaignRequestHash } from "@cco/application";
import { createControlApiApp } from "../app.js";

const cloudEnabledPolicy = {
  allowCloudPlanning: true,
  allowCloudVisualQA: true,
  allowCloudVoice: true,
  allowedProviders: ["Anthropic", "OpenAI"],
  sensitiveDataMasking: false
};

const defaultTestOptions = {
  reviewerIdentityResolver: {
    resolve: () => "Integration Test Director"
  }
};

class IntegrationStubPlanningModelClient implements PlanningModelClientPort {
  beatSheetInvocations = 0;
  sceneConfigInvocations = 0;
  shouldThrow = false;
  shouldReturnMalformedBeatSheet = false;
  emittedBeats: Array<{ ordinal: number; brief: CreativeBrief; targetDurationMs: number }> = [];
  recordedSceneRequests: PlanningModelRequest[] = [];

  constructor(readonly providerName: "Anthropic" | "OpenAI" = "Anthropic") {}

  resetCounts(): void {
    this.beatSheetInvocations = 0;
    this.sceneConfigInvocations = 0;
    this.emittedBeats = [];
    this.recordedSceneRequests = [];
  }

  async complete(request: PlanningModelRequest): Promise<PlanningModelOutcome> {
    if (this.shouldThrow) {
      return {
        kind: "retryable_failure",
        message: "Simulated planning provider outage"
      };
    }

    if (request.userPrompt.includes("Total Required Scenes:")) {
      this.beatSheetInvocations++;
      if (this.shouldReturnMalformedBeatSheet) {
        return { kind: "success", rawText: "malformed beat sheet json" };
      }

      const totalScenesMatch = request.userPrompt.match(/Total Required Scenes:\s*(\d+)/);
      const totalDurationMatch = request.userPrompt.match(/Target Total Duration:\s*(\d+)\s*ms/);
      const totalScenes = totalScenesMatch ? parseInt(totalScenesMatch[1]!, 10) : 3;
      const targetTotalDurationMs = totalDurationMatch
        ? parseInt(totalDurationMatch[1]!, 10)
        : 15000;

      // Generate uneven, non-uniform beat durations for discriminating duration-authority proof.
      let beatDurations: number[];
      if (totalScenes === 3 && targetTotalDurationMs === 15000) {
        beatDurations = [3000, 7000, 5000];
      } else if (totalScenes === 2 && targetTotalDurationMs === 15000) {
        beatDurations = [6000, 9000];
      } else {
        const baseDuration = Math.floor(targetTotalDurationMs / totalScenes);
        const remainder = targetTotalDurationMs - baseDuration * totalScenes;
        const delta = Math.min(Math.floor(baseDuration / 2), 1500);
        beatDurations = Array.from({ length: totalScenes }, (_, i) => {
          if (i === 0) return baseDuration - delta + remainder;
          if (i === 1 && totalScenes > 1) return baseDuration + delta;
          return baseDuration;
        });
      }

      const beats = Array.from({ length: totalScenes }, (_, i) => ({
        ordinal: i + 1,
        brief: {
          title: `Integration Beat ${i + 1}`,
          description: `Visual description for integration beat ${i + 1}`
        },
        targetDurationMs: beatDurations[i]!
      }));
      this.emittedBeats = beats;

      return {
        kind: "success",
        rawText: JSON.stringify({ beats })
      };
    }

    this.sceneConfigInvocations++;
    this.recordedSceneRequests.push(request);
    const durationMatch = request.systemPrompt.match(/must equal exactly (\d+)/);
    if (!durationMatch) {
      throw new Error(
        "IntegrationStubPlanningModelClient: missing authoritative target duration constraint in systemPrompt"
      );
    }
    const durationMs = parseInt(durationMatch[1]!, 10);

    return {
      kind: "success",
      rawText: JSON.stringify({
        prompt: `Integration scene visual prompt ${this.sceneConfigInvocations}`,
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs,
        loraConfigurationId: null
      })
    };
  }
}

describe("POST /api/campaigns/plan End-to-End Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });
  }, 120_000);

  afterAll(async () => {
    if (client) {
      client.release();
    }
    if (pool) {
      await pool.end();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  const mockAssetRepo: ReferenceAssetRepository = {
    listBySceneId: async () => [],
    findByIds: async () => []
  };

  it("1. Success: creates campaign shell, plans beat-sheet and scenes, materializes N scenes and admits candidate jobs in PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const targetTotalDurationMs = 15000;

    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        idempotencyKey,
        clientId: clientRecord.client_id,
        title: "Summer 2026 Launch Campaign",
        targetPlatform: "instagram_reels",
        targetTotalDurationMs,
        brief: {
          title: "Summer 2026 Commercial",
          description: "Vibrant high-energy summer footwear launch"
        }
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.campaignId).toBeDefined();
    expect(body.idempotencyKey).toBe(idempotencyKey);
    expect(body.status).toBe("drafting");
    expect(body.totalScenes).toBe(3);
    expect(body.targetTotalDurationMs).toBe(targetTotalDurationMs);
    expect(body.isIdempotentReplay).toBe(false);
    expect(body.sceneCount).toBe(3);
    expect(body.scenes).toHaveLength(3);

    // Verify raw PostgreSQL campaign row
    const campaignRows = await client.query(
      "SELECT campaign_id, client_id, title, status, total_scenes, idempotency_key, target_total_duration_ms FROM campaigns WHERE campaign_id = $1",
      [body.campaignId]
    );
    expect(campaignRows.rows).toHaveLength(1);
    const campaignRow = campaignRows.rows[0];
    expect(campaignRow?.client_id).toBe(clientRecord.client_id);
    expect(campaignRow?.status).toBe("drafting");
    expect(campaignRow?.total_scenes).toBe(3);
    expect(campaignRow?.idempotency_key).toBe(idempotencyKey);
    expect(campaignRow?.target_total_duration_ms).toBe(targetTotalDurationMs);

    // Verify raw PostgreSQL storyboard_scenes rows
    const sceneRows = await client.query(
      "SELECT scene_id, campaign_id, scene_order, status, duration_seconds FROM storyboard_scenes WHERE campaign_id = $1 ORDER BY scene_order ASC",
      [body.campaignId]
    );
    expect(sceneRows.rows).toHaveLength(3);
    expect(sceneRows.rows.map((r: { scene_order: number }) => r.scene_order)).toEqual([1, 2, 3]);
    expect(
      sceneRows.rows.every((r: { status: string }) => r.status === "generating_candidates")
    ).toBe(true);

    // Assert exact per-ordinal duration equality against uneven beat targets:
    expect(stubPrimary.emittedBeats.map((b) => b.targetDurationMs)).toEqual([3000, 7000, 5000]);
    for (let i = 0; i < 3; i++) {
      const beat = stubPrimary.emittedBeats[i]!;
      const row = sceneRows.rows[i];
      const durationSecondsNum = parseFloat(row.duration_seconds);
      expect(Math.round(durationSecondsNum * 1000)).toBe(beat.targetDurationMs);
    }

    // Verify candidate jobs in render_jobs table (3 candidates per scene = 9 jobs)
    const jobRows = await client.query(
      "SELECT job_id, scene_id, job_kind, status FROM render_jobs WHERE scene_id = ANY($1::uuid[])",
      [sceneRows.rows.map((r: { scene_id: string }) => r.scene_id)]
    );
    expect(jobRows.rows).toHaveLength(9);
    expect(jobRows.rows.every((r: { job_kind: string }) => r.job_kind === "candidate")).toBe(true);
    expect(jobRows.rows.every((r: { status: string }) => r.status === "queued")).toBe(true);
  });

  it("2. Idempotent replay under provider outage: short-circuits before LLM call and succeeds (Finding 1 Witness Scenario)", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const payload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Outage Replay Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs: 15000,
      brief: {
        title: "Commercial Brief",
        description: "Cinematic commercial brief"
      }
    };

    // First POST: completes normally
    const firstRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload
    });
    expect(firstRes.statusCode).toBe(201);
    const firstBody = firstRes.json();
    expect(firstBody.isIdempotentReplay).toBe(false);
    expect(stubPrimary.beatSheetInvocations).toBe(1);
    expect(stubPrimary.sceneConfigInvocations).toBe(3);

    // Simulate provider outage: any call into the provider will fail
    stubPrimary.shouldThrow = true;
    stubPrimary.resetCounts();

    // Second POST: retry with identical payload and idempotencyKey
    const replayRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload
    });

    // Assert replay succeeds without throwing 502/500
    expect(replayRes.statusCode).toBe(201);
    const replayBody = replayRes.json();
    expect(replayBody.isIdempotentReplay).toBe(true);
    expect(replayBody.campaignId).toBe(firstBody.campaignId);
    expect(replayBody.scenes).toHaveLength(firstBody.scenes.length);
    for (let i = 0; i < firstBody.scenes.length; i++) {
      expect(replayBody.scenes[i].sceneId).toBe(firstBody.scenes[i].sceneId);
      expect(replayBody.scenes[i].ordinal).toBe(firstBody.scenes[i].ordinal);
    }

    // Zero new planning invocations
    expect(stubPrimary.beatSheetInvocations).toBe(0);
    expect(stubPrimary.sceneConfigInvocations).toBe(0);

    // Zero new scenes in Postgres
    const sceneCount = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [firstBody.campaignId]
    );
    expect(sceneCount.rows[0]?.count).toBe(3);

    // Zero new jobs in Postgres
    const jobCount = await client.query(
      "SELECT count(*)::int as count FROM render_jobs WHERE scene_id = ANY($1::uuid[])",
      [firstBody.scenes.map((s: { sceneId: string }) => s.sceneId)]
    );
    expect(jobCount.rows[0]?.count).toBe(9);
  });

  it("3. Idempotent retry of drafting shell: re-runs planning when 0 scenes exist", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const payload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Draft Shell Recovery Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs: 15000,
      brief: {
        title: "Commercial Brief",
        description: "Cinematic commercial brief"
      }
    };

    // First POST: planning fails with malformed beat sheet
    stubPrimary.shouldReturnMalformedBeatSheet = true;
    const failRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload
    });
    expect(failRes.statusCode).toBe(502);
    expect(failRes.json().code).toBe("PLANNING_PROVIDER_EXHAUSTED");

    // Confirm campaign shell exists in Postgres with 0 scenes
    const shellRows = await client.query(
      "SELECT campaign_id, status FROM campaigns WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    expect(shellRows.rows).toHaveLength(1);
    const campaignId = shellRows.rows[0]?.campaign_id;
    const initialScenes = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [campaignId]
    );
    expect(initialScenes.rows[0]?.count).toBe(0);

    // Second POST: provider is healthy now
    stubPrimary.shouldReturnMalformedBeatSheet = false;
    stubPrimary.resetCounts();

    const recoverRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload
    });

    expect(recoverRes.statusCode).toBe(201);
    const recoverBody = recoverRes.json();
    expect(recoverBody.campaignId).toBe(campaignId);
    expect(recoverBody.isIdempotentReplay).toBe(false); // Storyboard was newly materialized
    expect(recoverBody.sceneCount).toBe(3);

    // Planning was actually invoked
    expect(stubPrimary.beatSheetInvocations).toBe(1);
    expect(stubPrimary.sceneConfigInvocations).toBe(3);

    // Scenes are now persisted in Postgres
    const finalScenes = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [campaignId]
    );
    expect(finalScenes.rows[0]?.count).toBe(3);
  });

  it("4. Planning failure: leaves drafting shell in PostgreSQL with 0 scenes and 0 jobs", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    stubPrimary.shouldThrow = true;

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        idempotencyKey,
        clientId: clientRecord.client_id,
        title: "Planning Failure Campaign",
        targetPlatform: "instagram_reels",
        targetTotalDurationMs: 15000,
        brief: {
          title: "Failed Commercial",
          description: "Will fail during beat sheet planning"
        }
      }
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("PLANNING_PROVIDER_EXHAUSTED");

    // Shell exists in PostgreSQL as recoverable drafting shell
    const shellRows = await client.query(
      "SELECT campaign_id, status, total_scenes FROM campaigns WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    expect(shellRows.rows).toHaveLength(1);
    expect(shellRows.rows[0]?.status).toBe("drafting");
    expect(shellRows.rows[0]?.total_scenes).toBe(3);

    // 0 scenes in PostgreSQL
    const sceneRows = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [shellRows.rows[0]?.campaign_id]
    );
    expect(sceneRows.rows[0]?.count).toBe(0);

    // 0 render jobs in PostgreSQL
    const jobRows = await client.query("SELECT count(*)::int as count FROM render_jobs");
    expect(jobRows.rows[0]?.count).toBe(0);
  });

  it("5. Persistence failure: mid-loop save failure rolls back PostgreSQL transaction leaving shell intact and 0 scenes/jobs", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    let sceneSaveCount = 0;
    // Fault-inject the transaction-bound scene repository after at least one scene write
    class PostgresUowWithMidLoopSaveFailure implements UnitOfWork {
      constructor(private readonly inner: UnitOfWork) {}
      async execute<TResult>(
        work: (context: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> {
        return this.inner.execute(async (ctx) => {
          const originalScenes = ctx.scenes;
          if (!originalScenes) return work(ctx);
          const faultInjectedScenes: SceneRepository = {
            findById: (id) => originalScenes.findById(id),
            save: async (scene: Scene): Promise<void> => {
              sceneSaveCount++;
              if (sceneSaveCount === 2) {
                // Scene 1 has already been inserted and candidate jobs enqueued on this transaction!
                throw new Error("Simulated database write failure during scene 2 persistence");
              }
              return originalScenes.save(scene);
            },
            ...(originalScenes.findByCampaignId
              ? {
                  findByCampaignId: (campaignId, options) =>
                    originalScenes.findByCampaignId!(campaignId, options)
                }
              : {}),
            ...(originalScenes.findCampaignIdBySceneId
              ? {
                  findCampaignIdBySceneId: (sceneId) =>
                    originalScenes.findCampaignIdBySceneId!(sceneId)
                }
              : {})
          };
          return work({
            ...ctx,
            scenes: faultInjectedScenes
          });
        });
      }
    }

    const uow = new PostgresUowWithMidLoopSaveFailure(new PostgresUnitOfWork(pool));
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        idempotencyKey,
        clientId: clientRecord.client_id,
        title: "Persistence Failure Campaign",
        targetPlatform: "instagram_reels",
        targetTotalDurationMs: 15000,
        brief: {
          title: "Materialize Failure",
          description: "Fails mid-loop when materializing storyboard"
        }
      }
    });

    expect(response.statusCode).toBe(500);
    expect(sceneSaveCount).toBeGreaterThanOrEqual(2);

    // Shell was committed in step 1 transaction
    const shellRows = await client.query(
      "SELECT campaign_id, status FROM campaigns WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    expect(shellRows.rows).toHaveLength(1);
    expect(shellRows.rows[0]?.status).toBe("drafting");

    // 0 scenes committed (step 5 rolled back in PostgreSQL after scene 1 had been written)
    const sceneRows = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [shellRows.rows[0]?.campaign_id]
    );
    expect(sceneRows.rows[0]?.count).toBe(0);

    // 0 render jobs committed (candidate jobs for scene 1 were also rolled back)
    const jobRows = await client.query("SELECT count(*)::int as count FROM render_jobs");
    expect(jobRows.rows[0]?.count).toBe(0);
  });

  it("5b. Pre-write configuration failure: missing transactional job enqueuer returns CONFIGURATION_ERROR with 0 scenes committed", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    // Wrap PostgresUnitOfWork to omit context.jobs, forcing TransactionalJobEnqueuerUnavailableError in step 5
    class PostgresUowWithoutJobs implements UnitOfWork {
      constructor(private readonly inner: UnitOfWork) {}
      async execute<TResult>(
        work: (context: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> {
        return this.inner.execute(async (ctx) => {
          return work({
            ...ctx,
            jobs: undefined
          });
        });
      }
    }

    const uow = new PostgresUowWithoutJobs(new PostgresUnitOfWork(pool));
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        idempotencyKey,
        clientId: clientRecord.client_id,
        title: "Missing Jobs Campaign",
        targetPlatform: "instagram_reels",
        targetTotalDurationMs: 15000,
        brief: {
          title: "Materialize Failure",
          description: "Fails when materializing storyboard"
        }
      }
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("CONFIGURATION_ERROR");

    // Shell was committed in step 1 transaction
    const shellRows = await client.query(
      "SELECT campaign_id, status FROM campaigns WHERE idempotency_key = $1",
      [idempotencyKey]
    );
    expect(shellRows.rows).toHaveLength(1);
    expect(shellRows.rows[0]?.status).toBe("drafting");

    // 0 scenes committed
    const sceneRows = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [shellRows.rows[0]?.campaign_id]
    );
    expect(sceneRows.rows[0]?.count).toBe(0);
  });

  it("6. Defensive branch: partially materialized storyboard throws StoryboardPartiallyMaterializedError (409)", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const campaignId = randomUUID();
    const targetTotalDurationMs = 15000;
    const requestPayload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Corrupted Partial Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs,
      brief: {
        title: "Commercial Brief",
        description: "Cinematic commercial brief"
      }
    };

    const requestHash = await computeCampaignRequestHash(requestPayload);

    // Directly seed PostgreSQL with a campaign shell (total_scenes = 3) and only 1 scene (partial state)
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes, created_at, updated_at, idempotency_key, target_total_duration_ms, request_hash_sha256)
       VALUES ($1, $2, $3, $4, 'drafting', 3, 0, $5, $5, $6, $7, $8)`,
      [
        campaignId,
        clientRecord.client_id,
        "Corrupted Partial Campaign",
        "instagram_reels",
        now,
        idempotencyKey,
        targetTotalDurationMs,
        requestHash
      ]
    );

    await insertStoryboardSceneRecord(client, {
      campaignId,
      sceneOrder: 1,
      durationSeconds: 5,
      status: "generating_candidates"
    });

    // POST with same idempotencyKey:
    // Short-circuit should NOT fire because existing.length (1) !== campaign.totalScenes (3).
    // Planning runs, then MaterializeStoryboardUseCase detects existing.length !== 0 and throws StoryboardPartiallyMaterializedError!
    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: requestPayload
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.code).toBe("STORYBOARD_PARTIALLY_MATERIALIZED");
    expect(body.details?.expectedCount).toBe(3);
    expect(body.details?.actualCount).toBe(1);

    // Database scene count is still 1 (unchanged)
    const scenes = await client.query(
      "SELECT count(*)::int as count FROM storyboard_scenes WHERE campaign_id = $1",
      [campaignId]
    );
    expect(scenes.rows[0]?.count).toBe(1);
  });

  it("7. Fingerprint hardening: changing brief under same idempotencyKey returns 409 IDEMPOTENCY_CONFLICT", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const basePayload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Hardened Fingerprint Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs: 15000,
      brief: {
        title: "Original Brief",
        description: "Initial creative direction for product launch"
      }
    };

    // 1. Initial POST succeeds
    const firstRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: basePayload
    });
    expect(firstRes.statusCode).toBe(201);

    // 2. Replay with altered brief under SAME idempotencyKey
    const conflictRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        ...basePayload,
        brief: {
          title: "Modified Brief",
          description: "Substantially altered creative direction"
        }
      }
    });

    expect(conflictRes.statusCode).toBe(409);
    const conflictBody = conflictRes.json();
    expect(conflictBody.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(conflictBody.details?.idempotencyKey).toBe(idempotencyKey);
  });

  it("8. Fingerprint hardening: changing candidateReferenceAssetIds under same idempotencyKey returns 409 IDEMPOTENCY_CONFLICT", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const basePayload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Asset Fingerprint Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs: 15000,
      brief: {
        description: "Campaign with candidate reference assets"
      },
      candidateReferenceAssetIds: ["asset-1", "asset-2"]
    };

    // 1. Initial POST succeeds
    const firstRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: basePayload
    });
    expect(firstRes.statusCode).toBe(201);

    // 2. Replay with altered assets under SAME idempotencyKey
    const conflictRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        ...basePayload,
        candidateReferenceAssetIds: ["asset-1", "asset-3"]
      }
    });

    expect(conflictRes.statusCode).toBe(409);
    const conflictBody = conflictRes.json();
    expect(conflictBody.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("9. Fingerprint hardening: replaying with canonically equivalent candidateReferenceAssetIds returns 201 with isIdempotentReplay: true", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const initialPayload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Canonical Asset Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs: 15000,
      brief: {
        description: "Campaign with unsorted candidate reference assets"
      },
      candidateReferenceAssetIds: ["asset-b", "asset-a"]
    };

    // 1. Initial POST succeeds
    const firstRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: initialPayload
    });
    expect(firstRes.statusCode).toBe(201);
    const firstBody = firstRes.json();
    expect(firstBody.isIdempotentReplay).toBe(false);

    // 2. Replay with sorted and duplicate assets: canonically equivalent
    const replayRes = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: {
        ...initialPayload,
        candidateReferenceAssetIds: ["asset-a", "asset-b", "asset-a"]
      }
    });

    expect(replayRes.statusCode).toBe(201);
    const replayBody = replayRes.json();
    expect(replayBody.isIdempotentReplay).toBe(true);
    expect(replayBody.campaignId).toBe(firstBody.campaignId);
  });

  it("10. Committed storyboard admission identity witness: drafting shell with N scenes injected externally without completion proof returns 409 STORYBOARD_MATERIALIZATION_CONFLICT", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const campaignId = randomUUID();
    const targetTotalDurationMs = 15000;
    const requestPayload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Externally Materialized Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs,
      brief: {
        title: "Commercial Brief",
        description: "Drafting shell with externally injected scenes"
      }
    };

    const requestHash = await computeCampaignRequestHash(requestPayload);

    // Insert campaign shell with valid requestHashSha256, but NO storyboard_completion_hash_sha256
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO campaigns (campaign_id, client_id, title, target_platform, status, total_scenes, approved_scenes, created_at, updated_at, idempotency_key, target_total_duration_ms, request_hash_sha256)
       VALUES ($1, $2, $3, $4, 'drafting', 3, 0, $5, $5, $6, $7, $8)`,
      [
        campaignId,
        clientRecord.client_id,
        "Externally Materialized Campaign",
        "instagram_reels",
        now,
        idempotencyKey,
        targetTotalDurationMs,
        requestHash
      ]
    );

    // Inject all 3 scenes externally without candidate admission / completion proof
    for (let i = 1; i <= 3; i++) {
      await insertStoryboardSceneRecord(client, {
        campaignId,
        sceneOrder: i,
        durationSeconds: 5,
        status: "draft_pending"
      });
    }

    // Replay /api/campaigns/plan with this idempotencyKey
    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload: requestPayload
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.code).toBe("STORYBOARD_MATERIALIZATION_CONFLICT");
    expect(body.details?.campaignId).toBe(campaignId);
  });

  it("11. Atomic proof commitment: verifies storyboard_completion_hash_sha256 is committed in PostgreSQL and matches full orchestration request hash", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Acme Studios",
      externalProcessingPolicy: cloudEnabledPolicy
    });

    const stubPrimary = new IntegrationStubPlanningModelClient("Anthropic");
    const stubFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: (req) => stubPrimary.complete(req)
    };

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp(
      {
        uow,
        planningModelClients: { primary: stubPrimary, fallback: stubFallback },
        referenceAssetRepository: mockAssetRepo
      },
      defaultTestOptions
    );

    const idempotencyKey = randomUUID();
    const payload = {
      idempotencyKey,
      clientId: clientRecord.client_id,
      title: "Proof Commitment Campaign",
      targetPlatform: "instagram_reels",
      targetTotalDurationMs: 15000,
      brief: {
        title: "Proof Commercial",
        description: "Verifies atomic proof commit in PostgreSQL"
      },
      candidateReferenceAssetIds: ["asset-z", "asset-y"]
    };

    const expectedHash = await computeCampaignRequestHash(payload);

    const response = await app.inject({
      method: "POST",
      url: "/api/campaigns/plan",
      payload
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();

    // Query database directly to inspect storyboard_completion_hash_sha256
    const row = await client.query<{ storyboard_completion_hash_sha256: string | null }>(
      `SELECT storyboard_completion_hash_sha256 FROM campaigns WHERE campaign_id = $1`,
      [body.campaignId]
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0]?.storyboard_completion_hash_sha256).toBe(expectedHash);
  });
});
