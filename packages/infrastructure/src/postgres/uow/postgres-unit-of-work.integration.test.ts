import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId, CampaignRecord, CandidateId, SceneId } from "@cco/domain";
import type { ReviewEvent } from "@cco/contracts";
import { ProgressSceneProductionUseCases, ReviewSceneUseCases } from "@cco/application";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertStoryboardCandidateRecord
} from "../test-support/records.js";
import { PostgresJobQueue } from "../repositories/postgres-job-queue.js";
import { PostgresUnitOfWork } from "./postgres-unit-of-work.js";

describe("PostgreSQL UnitOfWork Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

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

  it("commits Scene mutation and ReviewEvent append atomically", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial prompt",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 1
    });

    const uow = new PostgresUnitOfWork(pool);

    const eventId = "01950c46-9e90-7d3d-82d2-8f1d3e000001";
    const reviewEvent: ReviewEvent = {
      eventId,
      sceneId: sceneRecord.scene_id,
      reviewerName: "Director Thomas",
      action: "prompt_edit",
      directorNotes: "Enhance lighting",
      mutationPayload: { prompt: "Updated prompt for scene" },
      priorSceneStatus: "director_review",
      resultingSceneStatus: "director_review",
      expectedSpecRevision: 1,
      resultingSpecRevision: 2,
      occurredAt: "2026-08-16T15:00:00.000Z"
    };

    await uow.execute(async (context) => {
      const scene = await context.scenes.findById(sceneRecord.scene_id as SceneId);
      expect(scene).toBeDefined();

      scene!.updatePrompt("Updated prompt for scene");
      await context.reviewEvents.append(reviewEvent);
      await context.scenes.save(scene!);
    });

    // Verify Scene mutation committed
    const sceneResult = await client.query(
      "SELECT visual_description, status, spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneResult.rows).toHaveLength(1);
    expect(sceneResult.rows[0]?.visual_description).toBe("Updated prompt for scene");
    expect(sceneResult.rows[0]?.status).toBe("director_review");
    expect(sceneResult.rows[0]?.spec_revision).toBe(2);

    // Verify ReviewEvent committed
    const eventResult = await client.query(
      "SELECT event_id, action, reviewer_name, prior_scene_status, resulting_scene_status FROM review_events WHERE event_id = $1",
      [eventId]
    );
    expect(eventResult.rows).toHaveLength(1);
    expect(eventResult.rows[0]?.event_id).toBe(eventId);
    expect(eventResult.rows[0]?.action).toBe("prompt_edit");
    expect(eventResult.rows[0]?.reviewer_name).toBe("Director Thomas");
  });

  it("rolls back event and scene changes if error occurs after event append", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial prompt",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 1
    });

    const uow = new PostgresUnitOfWork(pool);

    const eventId = "01950c46-9e90-7d3d-82d2-8f1d3e000002";
    const reviewEvent: ReviewEvent = {
      eventId,
      sceneId: sceneRecord.scene_id,
      reviewerName: "Director Thomas",
      action: "prompt_edit",
      mutationPayload: { prompt: "Uncommitted prompt" },
      priorSceneStatus: "director_review",
      resultingSceneStatus: "director_review",
      occurredAt: "2026-08-16T15:00:00.000Z"
    };

    const attempt = uow.execute(async (context) => {
      const scene = await context.scenes.findById(sceneRecord.scene_id as SceneId);
      expect(scene).toBeDefined();

      scene!.updatePrompt("Uncommitted prompt");
      await context.reviewEvents.append(reviewEvent);

      throw new Error("Simulated failure after event append");
    });

    await expect(attempt).rejects.toThrow("Simulated failure after event append");

    // Verify Scene was not mutated
    const sceneResult = await client.query(
      "SELECT visual_description, status, spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneResult.rows[0]?.visual_description).toBe("Initial prompt");
    expect(sceneResult.rows[0]?.status).toBe("director_review");
    expect(sceneResult.rows[0]?.spec_revision).toBe(1);

    // Verify ReviewEvent was not persisted
    const eventResult = await client.query(
      "SELECT event_id FROM review_events WHERE event_id = $1",
      [eventId]
    );
    expect(eventResult.rows).toHaveLength(0);
  });

  it("rolls back entire transaction if error occurs after scene save", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial prompt",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 1
    });

    const uow = new PostgresUnitOfWork(pool);

    const eventId = "01950c46-9e90-7d3d-82d2-8f1d3e000003";
    const reviewEvent: ReviewEvent = {
      eventId,
      sceneId: sceneRecord.scene_id,
      reviewerName: "Director Thomas",
      action: "prompt_edit",
      mutationPayload: { prompt: "Uncommitted prompt after save" },
      priorSceneStatus: "director_review",
      resultingSceneStatus: "director_review",
      occurredAt: "2026-08-16T15:00:00.000Z"
    };

    const attempt = uow.execute(async (context) => {
      const scene = await context.scenes.findById(sceneRecord.scene_id as SceneId);
      expect(scene).toBeDefined();

      scene!.updatePrompt("Uncommitted prompt after save");
      await context.reviewEvents.append(reviewEvent);
      await context.scenes.save(scene!);

      throw new Error("Simulated failure after scene save");
    });

    await expect(attempt).rejects.toThrow("Simulated failure after scene save");

    // Verify Scene was rolled back
    const sceneResult = await client.query(
      "SELECT visual_description, status, spec_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneResult.rows[0]?.visual_description).toBe("Initial prompt");
    expect(sceneResult.rows[0]?.status).toBe("director_review");
    expect(sceneResult.rows[0]?.spec_revision).toBe(1);

    // Verify ReviewEvent was rolled back
    const eventResult = await client.query(
      "SELECT event_id FROM review_events WHERE event_id = $1",
      [eventId]
    );
    expect(eventResult.rows).toHaveLength(0);
  });

  it("prevents lost updates under competing concurrent scene review transactions", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Original prompt",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 1
    });

    const uow = new PostgresUnitOfWork(pool);
    const useCases = new ReviewSceneUseCases(uow);

    const eventId1 = "01950c46-9e90-7d3d-82d2-8f1d3e000010";
    const eventId2 = "01950c46-9e90-7d3d-82d2-8f1d3e000020";

    // Launch two concurrent review operations targeting the exact same scene
    const op1 = useCases.updatePrompt({
      sceneId: sceneRecord.scene_id,
      eventId: eventId1,
      reviewerName: "Reviewer 1",
      prompt: "Concurrent prompt update",
      occurredAt: "2026-08-16T15:01:00.000Z"
    });

    const op2 = useCases.updateDuration({
      sceneId: sceneRecord.scene_id,
      eventId: eventId2,
      reviewerName: "Reviewer 2",
      durationMs: 7500,
      occurredAt: "2026-08-16T15:01:01.000Z"
    });

    await Promise.all([op1, op2]);

    // Verify both operations succeeded and serialized through row locking without lost updates
    const finalSceneResult = await client.query(
      "SELECT visual_description, duration_seconds, spec_revision, status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(finalSceneResult.rows).toHaveLength(1);
    const finalRow = finalSceneResult.rows[0];

    // Both prompt update and duration update must be present in the final row
    expect(finalRow?.visual_description).toBe("Concurrent prompt update");
    expect(parseFloat(finalRow?.duration_seconds)).toBe(7.5);
    // Revision should have incremented twice: 1 -> 2 -> 3
    expect(finalRow?.spec_revision).toBe(3);
    expect(finalRow?.status).toBe("director_review");

    // Verify both review events were recorded in order
    const eventsResult = await client.query(
      "SELECT event_id, action FROM review_events WHERE scene_id = $1 ORDER BY created_at ASC",
      [sceneRecord.scene_id]
    );
    expect(eventsResult.rows).toHaveLength(2);
    const actions = eventsResult.rows.map((r: { action: string }) => r.action);
    expect(actions).toContain("prompt_edit");
    expect(actions).toContain("duration_change");
  });

  it("executes ReviewSceneUseCases successfully against PostgreSQL UnitOfWork", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Director review scene",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 1
    });

    const candidateRecord = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const uow = new PostgresUnitOfWork(pool);
    const useCases = new ReviewSceneUseCases(uow);

    // 1. Select candidate
    const selectEventId = "01950c46-9e90-7d3d-82d2-8f1d3e000031";
    await useCases.selectCandidate({
      sceneId: sceneRecord.scene_id,
      candidateId: candidateRecord.candidate_id as CandidateId,
      candidateRevision: 1,
      eventId: selectEventId,
      reviewerName: "Director Alice",
      directorNotes: "Selected candidate 1 for hero shot",
      occurredAt: "2026-08-16T15:10:00.000Z"
    });

    let sceneCheck = await client.query(
      "SELECT selected_candidate_id, selected_candidate_revision, status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneCheck.rows[0]?.selected_candidate_id).toBe(candidateRecord.candidate_id);
    expect(sceneCheck.rows[0]?.selected_candidate_revision).toBe(1);

    // 2. Approve scene
    const approveEventId = "01950c46-9e90-7d3d-82d2-8f1d3e000032";
    await useCases.approve({
      sceneId: sceneRecord.scene_id,
      eventId: approveEventId,
      reviewerName: "Director Alice",
      directorNotes: "Looks great, approved for production",
      occurredAt: "2026-08-16T15:15:00.000Z"
    });

    sceneCheck = await client.query(
      "SELECT status, approved_by, approved_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneCheck.rows[0]?.status).toBe("approved");
    expect(sceneCheck.rows[0]?.approved_by).toBe("Director Alice");
    expect(sceneCheck.rows[0]?.approved_revision).toBe(1);

    // Verify review events recorded
    const events = await client.query(
      "SELECT event_id, action, reviewer_name FROM review_events WHERE scene_id = $1 ORDER BY created_at ASC",
      [sceneRecord.scene_id]
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0]?.action).toBe("candidate_select");
    expect(events.rows[1]?.action).toBe("approve");
  });

  it("provides functional context.campaigns within unit of work transaction", async () => {
    const clientRecord = await insertClientRecord(client);
    const uow = new PostgresUnitOfWork(pool);

    const campaignId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73804" as CampaignId;
    const campaign: CampaignRecord = {
      id: campaignId,
      clientId: clientRecord.client_id,
      title: "UoW Campaign Test",
      targetPlatform: "instagram_reels",
      status: "drafting",
      totalScenes: 2,
      approvedScenes: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await uow.execute(async (context) => {
      expect(context.campaigns).toBeDefined();
      await context.campaigns!.save(campaign);
      const found = await context.campaigns!.findById(campaignId);
      expect(found).toBeDefined();
      expect(found?.title).toBe("UoW Campaign Test");
    });

    const check = await client.query("SELECT title FROM campaigns WHERE campaign_id = $1", [
      campaignId
    ]);
    expect(check.rows[0]?.title).toBe("UoW Campaign Test");
  });

  it("commits scene candidate generation transition and render_jobs atomically, and rolls back both on failure", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Draft scene for candidate generation",
      engineAssigned: "ltx_25",
      status: "draft_pending",
      specRevision: 1
    });

    const uow = new PostgresUnitOfWork(pool);

    // 1. Failure case: simulate failure during second job enqueue inside uow.execute
    const failureAttempt = uow.execute(async (context) => {
      expect(context.jobs).toBeDefined();
      const scene = await context.scenes.findById(sceneRecord.scene_id as SceneId);
      expect(scene).toBeDefined();

      scene!.beginCandidateGeneration();
      await context.scenes.save(scene!);

      // Job 1 succeeds
      await context.jobs!.enqueue({
        sceneId: sceneRecord.scene_id as SceneId,
        jobKind: "candidate",
        workflowTemplate: "flux-schnell-draft",
        injectedPayload: { seed: 43 }
      });

      // Simulated failure on job 2
      throw new Error("Simulated failure on job 2 enqueue");
    });

    await expect(failureAttempt).rejects.toThrow("Simulated failure on job 2 enqueue");

    // Verify scene status is still draft_pending in DB
    const rolledBackScene = await client.query(
      "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(rolledBackScene.rows[0]?.status).toBe("draft_pending");

    // Verify zero render_jobs rows exist in DB for this scene
    const rolledBackJobs = await client.query(
      "SELECT job_id FROM render_jobs WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(rolledBackJobs.rows).toHaveLength(0);

    // 2. Success case: execute atomically to completion
    await uow.execute(async (context) => {
      const scene = await context.scenes.findById(sceneRecord.scene_id as SceneId);
      expect(scene).toBeDefined();

      scene!.beginCandidateGeneration();
      await context.scenes.save(scene!);

      for (let i = 1; i <= 3; i++) {
        await context.jobs!.enqueue({
          sceneId: sceneRecord.scene_id as SceneId,
          jobKind: "candidate",
          workflowTemplate: "flux-schnell-draft",
          injectedPayload: { seed: 42 + i, variantOrdinal: i }
        });
      }
    });

    // Verify scene status committed to generating_candidates
    const committedScene = await client.query(
      "SELECT status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(committedScene.rows[0]?.status).toBe("generating_candidates");

    // Verify exactly 3 render_jobs rows exist in DB
    const committedJobs = await client.query(
      "SELECT job_id, status, workflow_template FROM render_jobs WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(committedJobs.rows).toHaveLength(3);
    expect(committedJobs.rows.every((r) => r.status === "queued")).toBe(true);
    expect(committedJobs.rows.every((r) => r.workflow_template === "flux-schnell-draft")).toBe(
      true
    );
  });

  it("ProgressSceneProductionUseCases.beginCandidateGeneration commits scene transition and 3 jobs atomically against real PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Draft scene for candidate generation via use case",
      engineAssigned: "ltx_25",
      status: "draft_pending",
      specRevision: 1
    });

    const uow = new PostgresUnitOfWork(pool);
    const queue = new PostgresJobQueue(pool);
    const useCases = new ProgressSceneProductionUseCases(uow, undefined, queue);

    const result = await useCases.beginCandidateGeneration({ sceneId: sceneRecord.scene_id });
    expect(result.scene.status).toBe("generating_candidates");
    expect(result.enqueuedJobs).toHaveLength(3);

    const dbScene = await client.query("SELECT status FROM storyboard_scenes WHERE scene_id = $1", [
      sceneRecord.scene_id
    ]);
    expect(dbScene.rows[0]?.status).toBe("generating_candidates");

    const dbJobs = await client.query("SELECT job_id FROM render_jobs WHERE scene_id = $1", [
      sceneRecord.scene_id
    ]);
    expect(dbJobs.rows).toHaveLength(3);
  });
});
