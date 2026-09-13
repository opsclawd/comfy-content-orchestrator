import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertStoryboardCandidateRecord,
  insertRenderJobRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresJobQueue,
  PostgresDeliveryAssemblyJobQueue,
  PostgresCampaignProductionRunRepository
} from "@cco/infrastructure";
import type { CandidateId } from "@cco/domain";
import type { ReviewCommandResponse, ReviewErrorResponse } from "@cco/contracts";
import { createControlApiApp } from "./app.js";

const defaultTestOptions = {
  reviewerIdentityResolver: {
    resolve: () => "Supervisor Sam"
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

describe("Production Review Commands Integration (#263)", () => {
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

  function createTestApp() {
    const uow = new PostgresUnitOfWork(pool);
    const jobQueue = new PostgresJobQueue(pool);
    const deliveryAssemblyJobQueue = new PostgresDeliveryAssemblyJobQueue(pool);
    return createControlApiApp(
      {
        uow,
        jobQueue,
        deliveryAssemblyJobQueue,
        storageTelemetry: fakeStorageTelemetry
      },
      {
        ...defaultTestOptions,
        jobDispatch: defaultDispatchConfig
      }
    );
  }

  async function setupDispatchedCampaignInQA(
    app: ReturnType<typeof createTestApp>,
    sceneCount = 1
  ) {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: sceneCount,
      status: "drafting"
    });

    const scenes = [];
    for (let i = 1; i <= sceneCount; i++) {
      const candidateId = `01950c46-9e90-7d3d-82d2-8f1d3c00000${i}` as CandidateId;
      const scene = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: i,
        durationSeconds: 4.0,
        status: "director_review"
      });

      await insertStoryboardCandidateRecord(client, {
        candidateId,
        sceneId: scene.scene_id,
        sceneSpecRevision: 1,
        variantOrdinal: 1
      });

      await client.query(
        "UPDATE storyboard_scenes SET selected_candidate_id = $1, selected_candidate_revision = 1 WHERE scene_id = $2",
        [candidateId, scene.scene_id]
      );

      scenes.push({ scene, candidateId });
    }

    // Approve all scenes to trigger campaign production dispatch
    for (let i = 0; i < sceneCount; i++) {
      const approveRes = await app.inject({
        method: "POST",
        url: `/api/scenes/${scenes[i]!.scene.scene_id}/review-command`,
        payload: {
          actionId: `01950c46-9e90-7d3d-82d2-8f1d3c00001${i + 1}`,
          sceneId: scenes[i]!.scene.scene_id,
          expectedSpecRevision: 1,
          action: "approve",
          payload: {}
        }
      });
      expect(approveRes.statusCode).toBe(200);
    }

    // Move scene(s) into QA with active production job preserved
    const readyScenes = [];
    for (let i = 0; i < sceneCount; i++) {
      const sId = scenes[i]!.scene.scene_id;
      const sceneRes = await client.query<{ active_production_job_id: string }>(
        "SELECT active_production_job_id FROM storyboard_scenes WHERE scene_id = $1",
        [sId]
      );
      const activeJobId = sceneRes.rows[0]?.active_production_job_id;
      expect(activeJobId).toBeDefined();

      await client.query("UPDATE storyboard_scenes SET status = 'qa' WHERE scene_id = $1", [sId]);
      readyScenes.push({ sceneId: sId, activeJobId: activeJobId! });
    }

    return { campaign, scenes: readyScenes };
  }

  it("happy-path accept: persists production_accept in PostgreSQL review_events and marks scene accepted", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 1);
    const { sceneId, activeJobId } = scenes[0]!;

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000021",
        sceneId,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: activeJobId
        },
        directorNotes: "Looks fantastic!"
      }
    });

    expect(response.statusCode).toBe(200);

    // Witness scenario: Verify review_events persistence in PostgreSQL with review_action_enum
    const auditRes = await client.query<{
      action: string;
      director_notes: string;
      mutation_payload: Record<string, unknown>;
    }>(
      "SELECT action, director_notes, mutation_payload FROM review_events WHERE scene_id = $1 ORDER BY created_at DESC LIMIT 1",
      [sceneId]
    );
    expect(auditRes.rows).toHaveLength(1);
    expect(auditRes.rows[0]?.action).toBe("production_accept");
    expect(auditRes.rows[0]?.director_notes).toBe("Looks fantastic!");
    expect(auditRes.rows[0]?.mutation_payload.productionJobId).toBe(activeJobId);

    const body = response.json<ReviewCommandResponse>();
    expect(body.status).toBe("completed");
    expect(body.acceptedAttemptOrdinal).toBe(1);
    expect(body.acceptedProductionAttemptId).toBeDefined();
    expect(body.activeProductionJobId).toBe(activeJobId);
    expect(body.isIdempotentReplay).toBe(false);

    // Verify storyboard_scenes in PostgreSQL
    const sceneDb = await client.query(
      "SELECT status, accepted_production_attempt_id FROM storyboard_scenes WHERE scene_id = $1",
      [sceneId]
    );
    expect(sceneDb.rows[0]?.status).toBe("completed");
    expect(sceneDb.rows[0]?.accepted_production_attempt_id).toBe(body.acceptedProductionAttemptId);

    // Verify campaign_production_run_scenes in PostgreSQL
    const runSceneDb = await client.query(
      "SELECT accepted_attempt_id, accepted_production_job_id, accepted_attempt_ordinal FROM campaign_production_run_scenes WHERE scene_id = $1",
      [sceneId]
    );
    expect(runSceneDb.rows[0]?.accepted_attempt_id).toBe(body.acceptedProductionAttemptId);
    expect(runSceneDb.rows[0]?.accepted_production_job_id).toBe(activeJobId);
    expect(runSceneDb.rows[0]?.accepted_attempt_ordinal).toBe(1);

    await app.close();
  });

  it("happy-path re-render: enqueues new job, persists review event, creates new attempt, and preserves lineage", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 1);
    const { sceneId, activeJobId: initialJobId } = scenes[0]!;

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000022",
        sceneId,
        expectedSpecRevision: 1,
        action: "production_rerender",
        payload: {
          expectedProductionJobId: initialJobId
        },
        directorNotes: "Needs warmer color grading"
      }
    });

    expect(response.statusCode).toBe(200);

    // Witness scenario: Verify review_events persistence in PostgreSQL with review_action_enum
    const auditRes = await client.query<{
      action: string;
      director_notes: string;
      mutation_payload: Record<string, unknown>;
    }>(
      "SELECT action, director_notes, mutation_payload FROM review_events WHERE scene_id = $1 ORDER BY created_at DESC LIMIT 1",
      [sceneId]
    );
    expect(auditRes.rows).toHaveLength(1);
    expect(auditRes.rows[0]?.action).toBe("production_rerender");
    expect(auditRes.rows[0]?.director_notes).toBe("Needs warmer color grading");

    const body = response.json<ReviewCommandResponse>();
    expect(body.status).toBe("queued");
    expect(body.productionAttemptOrdinal).toBe(2);
    expect(body.activeProductionJobId).toBeDefined();
    expect(body.activeProductionJobId).not.toBe(initialJobId);
    expect(body.isIdempotentReplay).toBe(false);

    // Verify durable attempt lineage in production_attempts
    const attemptsRes = await client.query<{
      attempt_id: string;
      ordinal: number;
      created_reason: string;
      seed: string;
      production_job_id: string;
    }>(
      "SELECT attempt_id, ordinal, created_reason, seed, production_job_id FROM production_attempts WHERE scene_id = $1 ORDER BY ordinal ASC",
      [sceneId]
    );
    expect(attemptsRes.rows).toHaveLength(2);

    const [attempt1, attempt2] = attemptsRes.rows;
    expect(attempt1?.ordinal).toBe(1);
    expect(attempt1?.created_reason).toBe("initial_dispatch");
    expect(attempt1?.production_job_id).toBe(initialJobId);

    expect(attempt2?.ordinal).toBe(2);
    expect(attempt2?.created_reason).toBe("production_rerender");
    expect(attempt2?.production_job_id).toBe(body.activeProductionJobId);

    // Distinct seeds between creative attempts
    expect(attempt1?.seed).not.toBe(attempt2?.seed);

    // Verify campaign_production_run_scenes updated to current attempt
    const runSceneRes = await client.query(
      "SELECT current_attempt_id, current_attempt_ordinal, production_job_id FROM campaign_production_run_scenes WHERE scene_id = $1",
      [sceneId]
    );
    expect(runSceneRes.rows[0]?.current_attempt_id).toBe(attempt2?.attempt_id);
    expect(runSceneRes.rows[0]?.current_attempt_ordinal).toBe(2);
    expect(runSceneRes.rows[0]?.production_job_id).toBe(body.activeProductionJobId);

    // Verify worker callback compatibility: repository resolves new production job
    const runRepo = new PostgresCampaignProductionRunRepository(pool);
    const resolvedRunScene = await runRepo.findRunSceneByProductionJobId(
      body.activeProductionJobId!
    );
    expect(resolvedRunScene).toBeDefined();
    expect(resolvedRunScene?.sceneId).toBe(sceneId);

    await app.close();
  });

  it("stale attempt conflict: rejects with 409 STALE_PRODUCTION_ATTEMPT_CONFLICT when expectedProductionJobId is obsolete", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 1);
    const { sceneId } = scenes[0]!;

    const staleJobId = "01950c46-9e90-7d3d-82d2-8f1d3c000999";

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000031",
        sceneId,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: staleJobId
        }
      }
    });
    expect(acceptResponse.statusCode).toBe(409);
    const acceptBody = acceptResponse.json<ReviewErrorResponse>();
    expect(acceptBody.code).toBe("STALE_PRODUCTION_ATTEMPT_CONFLICT");

    const rerenderResponse = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000032",
        sceneId,
        expectedSpecRevision: 1,
        action: "production_rerender",
        payload: {
          expectedProductionJobId: staleJobId
        }
      }
    });
    expect(rerenderResponse.statusCode).toBe(409);
    const rerenderBody = rerenderResponse.json<ReviewErrorResponse>();
    expect(rerenderBody.code).toBe("STALE_PRODUCTION_ATTEMPT_CONFLICT");

    await app.close();
  });

  it("scene not in run: rejects with 422 SCENE_NOT_IN_PRODUCTION_RUN when scene has no associated campaign production run", async () => {
    const app = createTestApp();
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      totalScenes: 1,
      status: "drafting"
    });

    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      status: "qa"
    });

    const job = await insertRenderJobRecord(client, {
      sceneId: scene.scene_id,
      jobKind: "production",
      status: "completed"
    });

    await client.query(
      "UPDATE storyboard_scenes SET active_production_job_id = $1 WHERE scene_id = $2",
      [job.job_id, scene.scene_id]
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${scene.scene_id}/review-command`,
      payload: {
        actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000041",
        sceneId: scene.scene_id,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: job.job_id
        }
      }
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<ReviewErrorResponse>();
    expect(body.code).toBe("SCENE_NOT_IN_PRODUCTION_RUN");

    await app.close();
  });

  it("idempotent replay: repeated requests return 200 with isIdempotentReplay without duplicating side effects", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 1);
    const { sceneId, activeJobId } = scenes[0]!;

    const actionId = "01950c46-9e90-7d3d-82d2-8f1d3c000051";

    const first = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId,
        sceneId,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: activeJobId
        }
      }
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<ReviewCommandResponse>().isIdempotentReplay).toBe(false);

    const second = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId,
        sceneId,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: activeJobId
        }
      }
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<ReviewCommandResponse>();
    expect(secondBody.isIdempotentReplay).toBe(true);
    expect(secondBody.status).toBe("completed");
    expect(secondBody.acceptedAttemptOrdinal).toBe(1);

    // Exactly 1 review_events row persisted
    const eventsRes = await client.query("SELECT * FROM review_events WHERE event_id = $1", [
      actionId
    ]);
    expect(eventsRes.rows).toHaveLength(1);

    await app.close();
  });

  it("conflicting replay: reusing actionId with materially different command input returns 409 IDEMPOTENCY_CONFLICT", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 1);
    const { sceneId, activeJobId } = scenes[0]!;

    const actionId = "01950c46-9e90-7d3d-82d2-8f1d3c000061";

    const first = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId,
        sceneId,
        expectedSpecRevision: 1,
        action: "production_accept",
        payload: {
          expectedProductionJobId: activeJobId
        }
      }
    });
    expect(first.statusCode).toBe(200);

    // Replay same actionId with a different expectedSpecRevision
    const conflicting = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneId}/review-command`,
      payload: {
        actionId,
        sceneId,
        expectedSpecRevision: 99,
        action: "production_accept",
        payload: {
          expectedProductionJobId: activeJobId
        }
      }
    });
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json<ReviewErrorResponse>().code).toBe("IDEMPOTENCY_CONFLICT");

    await app.close();
  });

  it("concurrency: racing accept and rerender requests on the same attempt serialize deterministically so at most one wins", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 1);
    const { sceneId, activeJobId } = scenes[0]!;

    const [acceptRes, rerenderRes] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/scenes/${sceneId}/review-command`,
        payload: {
          actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000071",
          sceneId,
          expectedSpecRevision: 1,
          action: "production_accept",
          payload: {
            expectedProductionJobId: activeJobId
          }
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/scenes/${sceneId}/review-command`,
        payload: {
          actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000072",
          sceneId,
          expectedSpecRevision: 1,
          action: "production_rerender",
          payload: {
            expectedProductionJobId: activeJobId
          }
        }
      })
    ]);

    const statuses = [acceptRes.statusCode, rerenderRes.statusCode];
    // Exactly one operation must succeed (200) and the other must fail with conflict/invalid transition (409 or 422)
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.some((s) => s === 409 || s === 422)).toBe(true);

    // Exactly one review event exists for the winning mutation
    const eventsRes = await client.query(
      "SELECT action FROM review_events WHERE scene_id = $1 AND action IN ('production_accept', 'production_rerender')",
      [sceneId]
    );
    expect(eventsRes.rows).toHaveLength(1);

    await app.close();
  });

  it("concurrency: racing accept requests for different scenes in the same run both succeed without deadlock", async () => {
    const app = createTestApp();
    const { scenes } = await setupDispatchedCampaignInQA(app, 2);
    const scene1 = scenes[0]!;
    const scene2 = scenes[1]!;

    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/scenes/${scene1.sceneId}/review-command`,
        payload: {
          actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000081",
          sceneId: scene1.sceneId,
          expectedSpecRevision: 1,
          action: "production_accept",
          payload: {
            expectedProductionJobId: scene1.activeJobId
          }
        }
      }),
      app.inject({
        method: "POST",
        url: `/api/scenes/${scene2.sceneId}/review-command`,
        payload: {
          actionId: "01950c46-9e90-7d3d-82d2-8f1d3c000082",
          sceneId: scene2.sceneId,
          expectedSpecRevision: 1,
          action: "production_accept",
          payload: {
            expectedProductionJobId: scene2.activeJobId
          }
        }
      })
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    expect(res1.json<ReviewCommandResponse>().status).toBe("completed");
    expect(res2.json<ReviewCommandResponse>().status).toBe("completed");

    // Both scenes are completed in PostgreSQL
    const scenesDb = await client.query<{ status: string }>(
      "SELECT status FROM storyboard_scenes WHERE scene_id IN ($1, $2)",
      [scene1.sceneId, scene2.sceneId]
    );
    expect(scenesDb.rows).toHaveLength(2);
    expect(scenesDb.rows.every((r) => r.status === "completed")).toBe(true);

    await app.close();
  });
});
