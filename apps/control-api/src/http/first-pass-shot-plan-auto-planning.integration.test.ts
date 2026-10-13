import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertReferenceAssetRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresJobQueue,
  PostgresDeliveryAssemblyJobQueue
} from "@cco/infrastructure";
import {
  STORYBOARD_PREVIS_WORKFLOW_TEMPLATE,
  type PlanningModelClientPort
} from "@cco/application";
import { createControlApiApp } from "./app.js";
import { createControlApiContainer } from "./types.js";

const defaultTestOptions = {
  reviewerIdentityResolver: {
    resolve: () => "Director Alice"
  }
};

const defaultDispatchConfig = {
  leaseDurationMs: 300_000,
  heartbeatIntervalMs: 30_000
};

const fakeStorageTelemetry = {
  getStorageTelemetry: async () => ({
    totalBytes: 1_000_000_000,
    usedBytes: 100_000_000,
    freeBytes: 900_000_000,
    buckets: [],
    measuredAt: "2026-09-01T00:00:00.000Z"
  })
};

const sampleShotPlanProposals = [
  {
    framing: "wide",
    angle: "eye_level",
    cameraMovement: "static",
    movementSpeed: "slow",
    lensIntent: "35mm prime",
    cameraPosition: "tripod",
    cameraPromptDescription: "Wide static shot of volcanic caldera",
    actionSummary: "Dramatic landscape with smoke rising",
    lightingStyle: "softbox_studio",
    environmentDescription: "Volcanic landscape",
    colorPalette: ["#111111", "#ff4400"],
    subjects: [],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 4000,
        description: "Smoke rises steadily",
        cameraAction: "holds",
        subjectAction: "none"
      }
    ]
  },
  {
    framing: "medium",
    angle: "low_angle",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    lensIntent: "50mm prime",
    cameraPosition: "eye level",
    cameraPromptDescription: "Medium push in on smoking ridge",
    actionSummary: "Push in closer on volcanic rock formations",
    lightingStyle: "softbox_studio",
    environmentDescription: "Volcanic landscape",
    colorPalette: ["#111111", "#ff4400"],
    subjects: [],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 4000,
        description: "Camera pushes forward slowly",
        cameraAction: "slow push",
        subjectAction: "none"
      }
    ]
  }
];

describe("First-Pass Shot-Plan and Previs Auto-Planning Integration (#405)", () => {
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

  function createTestFixture(llmProposals = sampleShotPlanProposals) {
    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const deliveryAssemblyJobQueue = new PostgresDeliveryAssemblyJobQueue(pool);

    const mockPrimaryComplete = vi.fn().mockResolvedValue({
      kind: "success",
      rawText: JSON.stringify(llmProposals)
    });

    const mockPrimary: PlanningModelClientPort = {
      providerName: "Anthropic",
      complete: mockPrimaryComplete
    };

    const mockFallback: PlanningModelClientPort = {
      providerName: "OpenAI",
      complete: vi.fn().mockResolvedValue({
        kind: "retryable_failure",
        message: "Primary succeeded"
      })
    };

    const container = createControlApiContainer({
      uow,
      jobQueue,
      deliveryAssemblyJobQueue,
      storageTelemetry: fakeStorageTelemetry,
      planningModelClients: {
        primary: mockPrimary,
        fallback: mockFallback
      }
    });

    const app = createControlApiApp(container, {
      ...defaultTestOptions,
      jobDispatch: defaultDispatchConfig
    });

    return { app, container, mockPrimary, mockPrimaryComplete, uow, jobQueue };
  }

  it("binding references to a fresh draft_pending scene auto-enqueues shot plans and previs without manual generate trigger, and production render jobs remain gated", async () => {
    const { app, container, mockPrimaryComplete } = createTestFixture();

    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 1,
      status: "drafting"
    });

    const refAsset = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      assetType: "image",
      mimeType: "image/png",
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/volcano.png",
      contentHashSha256: "a".repeat(64),
      description: "Dramatic volcano reference landscape"
    });

    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "draft_pending"
    });

    // Verify initial clean state: no shot plans, no jobs
    const initialShotPlans = await client.query("SELECT * FROM shot_plans WHERE scene_id = $1", [
      scene.scene_id
    ]);
    expect(initialShotPlans.rows).toHaveLength(0);

    const initialJobs = await client.query("SELECT * FROM render_jobs WHERE scene_id = $1", [
      scene.scene_id
    ]);
    expect(initialJobs.rows).toHaveLength(0);

    // Bind references to the scene via review command
    const bindResponse = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000101",
        sceneId: scene.scene_id,
        expectedSpecRevision: 1,
        action: "reference_change",
        payload: {
          referenceIds: [refAsset.asset_id]
        }
      }
    });

    expect(bindResponse.statusCode).toBe(200);

    // Wait for asynchronous auto-planning to complete
    await container.planningCoordinator?.waitForAllInFlight();

    // Verify shot plans were automatically generated and saved without calling POST /api/scenes/:sceneId/shot-plans
    expect(mockPrimaryComplete).toHaveBeenCalledTimes(1);

    const postAutoPlans = await client.query(
      "SELECT shot_plan_id, spec_revision, status, variant_ordinal FROM shot_plans WHERE scene_id = $1 ORDER BY variant_ordinal ASC",
      [scene.scene_id]
    );
    expect(postAutoPlans.rows.length).toBeGreaterThanOrEqual(1);

    // Verify previs candidate jobs were enqueued with storyboard_previs template
    const postAutoJobs = await client.query(
      "SELECT job_id, workflow_template, job_kind, status FROM render_jobs WHERE scene_id = $1",
      [scene.scene_id]
    );
    expect(postAutoJobs.rows.length).toBeGreaterThanOrEqual(1);
    expect(
      postAutoJobs.rows.every((j) => j.workflow_template === STORYBOARD_PREVIS_WORKFLOW_TEMPLATE)
    ).toBe(true);

    // Verify critical production safety: ZERO production video jobs exist
    expect(postAutoJobs.rows.some((j) => j.workflow_template === "minimax_h3")).toBe(false);
    expect(postAutoJobs.rows.some((j) => j.job_kind === "video_generation")).toBe(false);

    // Verify scene status is NOT approved, NOT queued, NOT rendering
    const sceneRowAfterAuto = await client.query(
      "SELECT status, spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [scene.scene_id]
    );
    const sceneStatus = sceneRowAfterAuto.rows[0]?.status;
    expect(sceneStatus).not.toBe("approved");
    expect(sceneStatus).not.toBe("queued");
    expect(sceneStatus).not.toBe("rendering");

    // Verify no production runs exist
    const productionRuns = await client.query(
      "SELECT * FROM campaign_production_runs WHERE campaign_id = $1",
      [campaign.campaign_id]
    );
    expect(productionRuns.rows).toHaveLength(0);

    // Verify explicit manual reroll / shot-plan generation route still works
    mockPrimaryComplete.mockClear();
    const manualGenerateRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene.scene_id}/shot-plans`,
      payload: {
        reroll: true,
        variantCount: 2
      }
    });
    expect([200, 202]).toContain(manualGenerateRes.statusCode);
    await container.planningCoordinator?.waitForAllInFlight();
    expect(mockPrimaryComplete).toHaveBeenCalled();

    // Verify that subsequent reference changes on an already planned/reviewed scene do NOT auto-trigger
    mockPrimaryComplete.mockClear();

    // Advance scene to director_review as happens once candidate generation completes
    await container.useCases.progressSceneProduction.submitCandidatesForReview({
      sceneId: scene.scene_id
    });

    const secondRefAsset = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      assetType: "image",
      mimeType: "image/png",
      storageBucket: "ref-bucket",
      storageObjectKey: "assets/volcano2.png",
      contentHashSha256: "b".repeat(64),
      description: "Dramatic volcano ridge close up"
    });

    const currentScene = (
      await client.query("SELECT spec_revision FROM storyboard_scenes WHERE scene_id = $1", [
        scene.scene_id
      ])
    ).rows[0]!;

    const secondBindResponse = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000102",
        sceneId: scene.scene_id,
        expectedSpecRevision: currentScene.spec_revision,
        action: "reference_change",
        payload: {
          referenceIds: [secondRefAsset.asset_id]
        }
      }
    });

    expect(secondBindResponse.statusCode).toBe(200);
    await container.planningCoordinator?.waitForAllInFlight();
    // Subsequent reference change must NOT auto-plan because existing shot plans exist
    expect(mockPrimaryComplete).not.toHaveBeenCalled();
  });
});
