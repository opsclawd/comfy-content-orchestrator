import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  insertCampaignRecord,
  insertReferenceAssetRecord,
  insertStoryboardSceneRecord,
  insertSceneReferenceAssetRecord,
  insertStoryboardCandidateRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  CampaignReviewSummarySchema,
  SceneReviewDetailReadModelSchema,
  ReviewCommandResponseSchema,
  type CampaignReviewSummary,
  type SceneReviewDetailReadModel,
  type ReviewCommand,
  type ReviewCommandResponse,
  type ReviewErrorResponse
} from "@cco/contracts";
import type { CandidateId } from "@cco/domain";
import { runMigrations, PostgresUnitOfWork, PostgresSceneReviewQueries } from "@cco/infrastructure";
import type { UnitOfWork, UnitOfWorkContext } from "@cco/application";
import { createControlApiApp } from "./app.js";

describe("End-to-End PostgreSQL Integration Tests for Control API HTTP Boundary", () => {
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

  it("GET /api/campaigns/:campaignId/review-summary aggregates PostgreSQL scenes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Caribbean Carnival 2026 Showcase"
    });

    // 2 scenes in director_review
    const s1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });
    const s2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "director_review",
      specRevision: 1
    });

    // 1 scene in approved
    const s3 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      status: "approved",
      specRevision: 1
    });

    // 1 scene in completed
    const s4 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 4,
      status: "completed",
      specRevision: 1
    });

    // 1 scene in draft_pending
    const s5 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 5,
      status: "draft_pending",
      specRevision: 1
    });

    // 1 archived scene (must be excluded from aggregation)
    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 6,
      status: "director_review"
    });
    await client.query(
      "UPDATE storyboard_scenes SET archived_at = CURRENT_TIMESTAMP WHERE scene_id = $1",
      [archivedScene.scene_id]
    );

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp({ uow, sceneReviewQueries });

    const response = await app.inject({
      method: "GET",
      url: `/api/campaigns/${campaign.campaign_id}/review-summary`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = CampaignReviewSummarySchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const summary = body as CampaignReviewSummary;
    expect(summary.campaignId).toBe(campaign.campaign_id);
    expect(summary.campaignName).toBe("Caribbean Carnival 2026 Showcase");
    expect(summary.totalScenes).toBe(5);
    expect(summary.pendingReviewCount).toBe(2);
    expect(summary.approvedCount).toBe(1);
    expect(summary.completedCount).toBe(1);
    expect(summary.scenesByStatus).toEqual({
      director_review: 2,
      approved: 1,
      completed: 1,
      draft_pending: 1
    });
    expect(summary.scenes).toEqual([
      {
        sceneId: s1.scene_id,
        status: "director_review",
        specRevision: 1
      },
      {
        sceneId: s2.scene_id,
        status: "director_review",
        specRevision: 1
      },
      {
        sceneId: s3.scene_id,
        status: "approved",
        specRevision: 1
      },
      {
        sceneId: s4.scene_id,
        status: "completed",
        specRevision: 1
      },
      {
        sceneId: s5.scene_id,
        status: "draft_pending",
        specRevision: 1
      }
    ]);
  });

  it("GET /api/scenes/:sceneId/review returns complete detail from PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const refAsset1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/costume_ref_01.png"
    });
    const refAsset2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/costume_ref_02.png"
    });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.75,
      visualDescription: "Midnight Robber delivering a poetic speech under moonlight.",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 2,
      loraConfigurationId: "lora-carnival-costume-v2"
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: refAsset1.asset_id
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: refAsset2.asset_id
    });

    // Candidates for Revision 1
    const candRev1Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev1_var1.webp`,
      contentHashSha256: "1111111111111111111111111111111111111111111111111111111111111111",
      generationPayload: { seed: 101 }
    });
    const candRev1Var2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev1_var2.webp`,
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222222",
      generationPayload: { seed: 102 }
    });

    // Candidates for Revision 2
    const candRev2Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var1.webp`,
      contentHashSha256: "3333333333333333333333333333333333333333333333333333333333333333",
      generationPayload: { seed: 201 }
    });
    const candRev2Var2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var2.webp`,
      contentHashSha256: "4444444444444444444444444444444444444444444444444444444444444444",
      generationPayload: { seed: 202 }
    });

    // Set selected candidate on scene to candRev2Var2
    await client.query(
      `
      UPDATE storyboard_scenes
      SET
        selected_candidate_id = $1,
        selected_candidate_revision = 2
      WHERE scene_id = $2
      `,
      [candRev2Var2.candidate_id, sceneRecord.scene_id]
    );

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp({ uow, sceneReviewQueries });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = SceneReviewDetailReadModelSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const detail = body as SceneReviewDetailReadModel;
    expect(detail.sceneId).toBe(sceneRecord.scene_id);
    expect(detail.campaignId).toBe(campaign.campaign_id);
    expect(detail.status).toBe("director_review");
    expect(detail.specRevision).toBe(2);
    expect(detail.configuration.prompt).toBe(
      "Midnight Robber delivering a poetic speech under moonlight."
    );
    expect(detail.configuration.durationMs).toBe(5750);
    expect(detail.configuration.engineProfileId).toBe("ltx_25");
    expect(detail.configuration.loraConfigurationId).toBe("lora-carnival-costume-v2");
    expect(detail.configuration.referenceIds).toEqual(
      expect.arrayContaining([refAsset1.asset_id, refAsset2.asset_id])
    );
    expect(detail.selectedCandidateId).toBe(candRev2Var2.candidate_id);
    expect(detail.selectedCandidateRevision).toBe(2);
    expect(detail.allowedActions).toEqual(
      expect.arrayContaining([
        "approve",
        "reroll",
        "candidate_select",
        "prompt_edit",
        "reference_change",
        "engine_change",
        "duration_change",
        "lora_tune",
        "cancel"
      ])
    );

    expect(detail.candidatesByRevision).toHaveLength(2);
    const rev1Group = detail.candidatesByRevision.find((g) => g.specRevision === 1);
    expect(rev1Group).toBeDefined();
    expect(rev1Group?.candidates).toHaveLength(2);
    expect(rev1Group?.candidates[0]?.candidateId).toBe(candRev1Var1.candidate_id);
    expect(rev1Group?.candidates[0]?.variantOrdinal).toBe(1);
    expect(rev1Group?.candidates[0]?.media).toEqual({ available: false });
    expect(rev1Group?.candidates[1]?.candidateId).toBe(candRev1Var2.candidate_id);
    expect(rev1Group?.candidates[1]?.variantOrdinal).toBe(2);
    expect(rev1Group?.candidates[1]?.media).toEqual({ available: false });

    const rev2Group = detail.candidatesByRevision.find((g) => g.specRevision === 2);
    expect(rev2Group).toBeDefined();
    expect(rev2Group?.candidates).toHaveLength(2);
    expect(rev2Group?.candidates[0]?.candidateId).toBe(candRev2Var1.candidate_id);
    expect(rev2Group?.candidates[0]?.variantOrdinal).toBe(1);
    expect(rev2Group?.candidates[0]?.media).toEqual({ available: false });
    expect(rev2Group?.candidates[1]?.candidateId).toBe(candRev2Var2.candidate_id);
    expect(rev2Group?.candidates[1]?.variantOrdinal).toBe(2);
    expect(rev2Group?.candidates[1]?.media).toEqual({ available: false });
  });

  it("candidate_select and approve flow persists updates in PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow });

    const selectActionId = "01950c46-9e90-7d3d-82d2-8f1d3e111111";
    const selectCommand: ReviewCommand = {
      actionId: selectActionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: {
        candidateId: candidate.candidate_id
      },
      directorNotes: "Selected best candidate for scene hero"
    };

    // 1. Send candidate_select
    const selectRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: selectCommand
    });

    expect(selectRes.statusCode).toBe(200);
    const selectBody = selectRes.json() as ReviewCommandResponse;
    expect(selectBody.sceneId).toBe(sceneRecord.scene_id);
    expect(selectBody.selectedCandidateId).toBe(candidate.candidate_id);
    expect(selectBody.status).toBe("director_review");
    expect(selectBody.isIdempotentReplay).toBe(false);

    // Verify PostgreSQL state after candidate_select
    const sceneAfterSelect = await client.query<{
      selected_candidate_id: string;
      selected_candidate_revision: number;
      status: string;
    }>(
      "SELECT selected_candidate_id, selected_candidate_revision, status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneAfterSelect.rows[0]?.selected_candidate_id).toBe(candidate.candidate_id);
    expect(sceneAfterSelect.rows[0]?.selected_candidate_revision).toBe(1);
    expect(sceneAfterSelect.rows[0]?.status).toBe("director_review");

    const eventsAfterSelect = await client.query<{
      event_id: string;
      action: string;
      reviewer_name: string;
      director_notes: string;
    }>(
      "SELECT event_id, action, reviewer_name, director_notes FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(eventsAfterSelect.rows).toHaveLength(1);
    expect(eventsAfterSelect.rows[0]?.event_id).toBe(selectActionId);
    expect(eventsAfterSelect.rows[0]?.action).toBe("candidate_select");
    expect(eventsAfterSelect.rows[0]?.reviewer_name).toBe("Thomas Cumberbatch");
    expect(eventsAfterSelect.rows[0]?.director_notes).toBe(
      "Selected best candidate for scene hero"
    );

    // 2. Send approve
    const approveActionId = "01950c46-9e90-7d3d-82d2-8f1d3e222222";
    const approveCommand: ReviewCommand = {
      actionId: approveActionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "approve",
      payload: {},
      directorNotes: "Approved scene composition for final render"
    };

    const approveRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: approveCommand
    });

    expect(approveRes.statusCode).toBe(200);
    const approveBody = approveRes.json() as ReviewCommandResponse;
    expect(approveBody.sceneId).toBe(sceneRecord.scene_id);
    expect(approveBody.status).toBe("approved");
    expect(approveBody.selectedCandidateId).toBe(candidate.candidate_id);
    expect(approveBody.approval).toBeDefined();
    expect(approveBody.approval?.approvedBy).toBe("Thomas Cumberbatch");
    expect(approveBody.approval?.revision).toBe(1);
    expect(approveBody.isIdempotentReplay).toBe(false);

    // Verify PostgreSQL state after approve
    const sceneAfterApprove = await client.query<{
      status: string;
      approved_by: string;
      approved_revision: number;
      selected_candidate_id: string;
    }>(
      "SELECT status, approved_by, approved_revision, selected_candidate_id FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneAfterApprove.rows[0]?.status).toBe("approved");
    expect(sceneAfterApprove.rows[0]?.approved_by).toBe("Thomas Cumberbatch");
    expect(sceneAfterApprove.rows[0]?.approved_revision).toBe(1);
    expect(sceneAfterApprove.rows[0]?.selected_candidate_id).toBe(candidate.candidate_id);

    const allEvents = await client.query<{
      event_id: string;
      action: string;
      resulting_scene_status: string;
    }>(
      "SELECT event_id, action, resulting_scene_status FROM review_events WHERE scene_id = $1 ORDER BY created_at ASC",
      [sceneRecord.scene_id]
    );
    expect(allEvents.rows).toHaveLength(2);
    expect(allEvents.rows[0]?.action).toBe("candidate_select");
    expect(allEvents.rows[1]?.action).toBe("approve");
    expect(allEvents.rows[1]?.resulting_scene_status).toBe("approved");
  });

  it("stale revision returns 409 and writes zero changes to database", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 2,
      visualDescription: "Original prompt at revision 2"
    });

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow });

    const staleCommand: ReviewCommand = {
      actionId: "01950c46-9e90-7d3d-82d2-8f1d3e333333",
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1, // Stale! Scene is at revision 2
      action: "prompt_edit",
      payload: {
        prompt: "Attempted stale prompt update"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: staleCommand
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as ReviewErrorResponse;
    expect(body.code).toBe("STALE_REVISION_CONFLICT");
    expect(body.message).toContain("expected spec revision 1, but current revision is 2");

    // Verify zero writes to review_events
    const eventCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCount.rows[0]!.count, 10)).toBe(0);

    // Verify storyboard_scenes unmutated
    const sceneCheck = await client.query<{
      visual_description: string;
      spec_revision: number;
      status: string;
    }>(
      "SELECT visual_description, spec_revision, status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneCheck.rows[0]?.visual_description).toBe("Original prompt at revision 2");
    expect(sceneCheck.rows[0]?.spec_revision).toBe(2);
    expect(sceneCheck.rows[0]?.status).toBe("director_review");
  });

  it("identical action retry returns 200 idempotent replay with single review event", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow });

    const actionId = "01950c46-9e90-7d3d-82d2-8f1d3e444444";
    const command: ReviewCommand = {
      actionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: {
        candidateId: candidate.candidate_id as CandidateId
      },
      directorNotes: "Idempotent select test"
    };

    // First attempt: 200, isIdempotentReplay: false
    const firstRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: command
    });
    expect(firstRes.statusCode).toBe(200);
    const firstBody = firstRes.json() as ReviewCommandResponse;
    expect(firstBody.isIdempotentReplay).toBe(false);
    expect(firstBody.selectedCandidateId).toBe(candidate.candidate_id);

    // Second attempt with exact same actionId and payload: 200, isIdempotentReplay: true
    const secondRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: command
    });
    expect(secondRes.statusCode).toBe(200);
    const secondBody = secondRes.json() as ReviewCommandResponse;
    expect(secondBody.isIdempotentReplay).toBe(true);
    expect(secondBody.selectedCandidateId).toBe(candidate.candidate_id);

    // Verify exactly 1 row in review_events in PostgreSQL (no duplicate event records)
    const eventCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCount.rows[0]!.count, 10)).toBe(1);

    const eventRows = await client.query<{ event_id: string; action: string }>(
      "SELECT event_id, action FROM review_events WHERE event_id = $1",
      [actionId]
    );
    expect(eventRows.rows).toHaveLength(1);
    expect(eventRows.rows[0]?.event_id).toBe(actionId);
  });

  it("action ID reuse with altered payload returns 409 and zero writes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const candidate1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    const candidate2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 2
    });

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow });

    const sharedActionId = "01950c46-9e90-7d3d-82d2-8f1d3e555555";

    // 1. First command: select candidate 1
    const firstCommand: ReviewCommand = {
      actionId: sharedActionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: {
        candidateId: candidate1.candidate_id as CandidateId
      }
    };

    const firstRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: firstCommand
    });
    expect(firstRes.statusCode).toBe(200);

    // 2. Second command: reuse sharedActionId but with different payload (candidate 2)
    const conflictingCommand: ReviewCommand = {
      actionId: sharedActionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "candidate_select",
      payload: {
        candidateId: candidate2.candidate_id as CandidateId
      }
    };

    const conflictRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: conflictingCommand
    });

    expect(conflictRes.statusCode).toBe(409);
    const errorBody = conflictRes.json() as ReviewErrorResponse;
    expect(errorBody.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(errorBody.message).toContain("Idempotency conflict for action ID");

    // Verify review_events still has only 1 row (zero new rows written)
    const eventCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCount.rows[0]!.count, 10)).toBe(1);

    // Verify storyboard_scenes selected candidate remains candidate 1
    const sceneCheck = await client.query<{ selected_candidate_id: string }>(
      "SELECT selected_candidate_id FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneCheck.rows[0]?.selected_candidate_id).toBe(candidate1.candidate_id);
  });

  it("reroll command commits generating_candidates and clears candidate in PostgreSQL", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1
    });

    await client.query(
      `
      UPDATE storyboard_scenes
      SET
        selected_candidate_id = $1,
        selected_candidate_revision = 1
      WHERE scene_id = $2
      `,
      [candidate.candidate_id, sceneRecord.scene_id]
    );

    const uow = new PostgresUnitOfWork(pool);
    const app = createControlApiApp({ uow });

    const rerollActionId = "01950c46-9e90-7d3d-82d2-8f1d3e777777";
    const rerollCommand: ReviewCommand = {
      actionId: rerollActionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "reroll",
      payload: {},
      directorNotes: "Rerolling candidates with current parameters"
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: rerollCommand
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parsed = ReviewCommandResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);

    const result = body as ReviewCommandResponse;
    expect(result.sceneId).toBe(sceneRecord.scene_id);
    expect(result.status).toBe("generating_candidates");
    expect(result.selectedCandidateId).toBeUndefined();
    expect(result.isIdempotentReplay).toBe(false);

    // Verify PostgreSQL database state
    const sceneCheck = await client.query<{
      status: string;
      selected_candidate_id: string | null;
      selected_candidate_revision: number | null;
    }>(
      "SELECT status, selected_candidate_id, selected_candidate_revision FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneCheck.rows[0]?.status).toBe("generating_candidates");
    expect(sceneCheck.rows[0]?.selected_candidate_id).toBeNull();
    expect(sceneCheck.rows[0]?.selected_candidate_revision).toBeNull();

    const eventCheck = await client.query<{
      action: string;
      prior_scene_status: string;
      resulting_scene_status: string;
    }>(
      "SELECT action, prior_scene_status, resulting_scene_status FROM review_events WHERE event_id = $1",
      [rerollActionId]
    );
    expect(eventCheck.rows).toHaveLength(1);
    expect(eventCheck.rows[0]?.action).toBe("reroll");
    expect(eventCheck.rows[0]?.prior_scene_status).toBe("director_review");
    expect(eventCheck.rows[0]?.resulting_scene_status).toBe("generating_candidates");
  });

  it("transaction failure triggers clean rollback without partial writes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Initial clean prompt before transaction",
      status: "director_review",
      specRevision: 1
    });

    const realUow = new PostgresUnitOfWork(pool);

    // Create a wrapping UnitOfWork that simulates a transient database or processing error inside the transaction
    const failingUow: UnitOfWork = {
      async execute<TResult>(
        work: (context: UnitOfWorkContext) => Promise<TResult>
      ): Promise<TResult> {
        return realUow.execute(async (context) => {
          // Execute the actual work (which mutates scene in-memory and appends event)
          await work(context);
          // Throw before the transaction can commit
          throw new Error("Simulated database failure before transaction commit");
        });
      }
    };

    const app = createControlApiApp({ uow: failingUow });

    const failedActionId = "01950c46-9e90-7d3d-82d2-8f1d3e888888";
    const command: ReviewCommand = {
      actionId: failedActionId,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1,
      action: "prompt_edit",
      payload: {
        prompt: "Prompt update that should be rolled back"
      }
    };

    const response = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      payload: command
    });

    // Fastify error handler maps unhandled error to 500
    expect(response.statusCode).toBe(500);

    // Verify zero rows in review_events
    const eventCheck = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCheck.rows[0]!.count, 10)).toBe(0);

    // Verify storyboard_scenes was cleanly rolled back and not mutated
    const sceneCheck = await client.query<{
      visual_description: string;
      spec_revision: number;
      status: string;
    }>(
      "SELECT visual_description, spec_revision, status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(sceneCheck.rows[0]?.visual_description).toBe("Initial clean prompt before transaction");
    expect(sceneCheck.rows[0]?.spec_revision).toBe(1);
    expect(sceneCheck.rows[0]?.status).toBe("director_review");
  });
});
