import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CampaignId, SceneId } from "@cco/domain";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertReferenceAssetRecord,
  insertStoryboardSceneRecord,
  insertSceneReferenceAssetRecord,
  insertStoryboardCandidateRecord
} from "../test-support/records.js";
import { PostgresSceneReviewQueries } from "./postgres-scene-review-queries.js";

describe("PostgreSQL SceneReviewQueries Read Adapter Integration", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri()
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

  it("projects complete SceneReviewDetail DTO with revision-grouped candidates and allowed actions", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    const refAsset1 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref-shot-1.png"
    });
    const refAsset2 = await insertReferenceAssetRecord(client, {
      clientId: clientRecord.client_id,
      storageObjectKey: "assets/ref-shot-2.png"
    });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 6.25,
      visualDescription: "Sunset over the Savannah with moving shadows.",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 2,
      loraConfigurationId: "lora-carnival-style-v2"
    });

    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: refAsset1.asset_id
    });
    await insertSceneReferenceAssetRecord(client, {
      sceneId: sceneRecord.scene_id,
      assetId: refAsset2.asset_id
    });

    // Candidates for Revision 1 (inserted out of variant order: var2 then var1)
    const candRev1Var2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev1_var2.webp`,
      contentHashSha256: "1111111111111111111111111111111111111111111111111111111111111111",
      generationPayload: { seed: 102 }
    });

    const candRev1Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev1_var1.webp`,
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222222",
      generationPayload: { seed: 101 }
    });

    // Candidates for Revision 2 (inserted out of variant order: var3, var1, var2)
    const candRev2Var3 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 3,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var3.webp`,
      contentHashSha256: "3333333333333333333333333333333333333333333333333333333333333333",
      generationPayload: { seed: 203 }
    });

    const candRev2Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var1.webp`,
      contentHashSha256: "4444444444444444444444444444444444444444444444444444444444444444",
      generationPayload: { seed: 201 }
    });

    const candRev2Var2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var2.webp`,
      contentHashSha256: "5555555555555555555555555555555555555555555555555555555555555555",
      generationPayload: { seed: 202 }
    });

    // Update scene to have selected candidate from revision 2
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

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const detail = await queryAdapter.getSceneReviewDetail(sceneRecord.scene_id as SceneId);

    expect(detail).toBeDefined();
    expect(detail?.sceneId).toBe(sceneRecord.scene_id);
    expect(detail?.campaignId).toBe(campaign.campaign_id);
    expect(detail?.status).toBe("director_review");
    expect(detail?.specRevision).toBe(2);

    // Configuration projection
    expect(detail?.configuration).toEqual({
      prompt: "Sunset over the Savannah with moving shadows.",
      referenceIds: expect.arrayContaining([refAsset1.asset_id, refAsset2.asset_id]),
      engineProfileId: "ltx_25",
      durationMs: 6250,
      loraConfigurationId: "lora-carnival-style-v2"
    });
    expect(detail?.configuration.referenceIds).toHaveLength(2);

    // Selected candidate projection
    expect(detail?.selectedCandidateId).toBe(candRev2Var2.candidate_id);
    expect(detail?.selectedCandidateRevision).toBe(2);
    expect(detail?.approval).toBeUndefined();

    // Candidates grouped by specRevision and ordered by variantOrdinal ASC
    expect(detail?.candidatesByRevision).toHaveLength(2);

    const groupRev1 = detail?.candidatesByRevision.find((g) => g.specRevision === 1);
    expect(groupRev1).toBeDefined();
    expect(groupRev1?.candidates).toHaveLength(2);
    expect(groupRev1?.candidates[0]?.id).toBe(candRev1Var1.candidate_id);
    expect(groupRev1?.candidates[0]?.variantOrdinal).toBe(1);
    expect(groupRev1?.candidates[0]?.storageBucket).toBe("godzspeed-temp");
    expect(groupRev1?.candidates[0]?.storageObjectKey).toBe(
      `candidates/${sceneRecord.scene_id}/rev1_var1.webp`
    );
    expect(groupRev1?.candidates[1]?.id).toBe(candRev1Var2.candidate_id);
    expect(groupRev1?.candidates[1]?.variantOrdinal).toBe(2);
    expect(groupRev1?.candidates[1]?.storageBucket).toBe("godzspeed-temp");
    expect(groupRev1?.candidates[1]?.storageObjectKey).toBe(
      `candidates/${sceneRecord.scene_id}/rev1_var2.webp`
    );

    const groupRev2 = detail?.candidatesByRevision.find((g) => g.specRevision === 2);
    expect(groupRev2).toBeDefined();
    expect(groupRev2?.candidates).toHaveLength(3);
    expect(groupRev2?.candidates[0]?.id).toBe(candRev2Var1.candidate_id);
    expect(groupRev2?.candidates[0]?.variantOrdinal).toBe(1);
    expect(groupRev2?.candidates[0]?.storageBucket).toBe("godzspeed-temp");
    expect(groupRev2?.candidates[0]?.storageObjectKey).toBe(
      `candidates/${sceneRecord.scene_id}/rev2_var1.webp`
    );
    expect(groupRev2?.candidates[1]?.id).toBe(candRev2Var2.candidate_id);
    expect(groupRev2?.candidates[1]?.variantOrdinal).toBe(2);
    expect(groupRev2?.candidates[1]?.storageBucket).toBe("godzspeed-temp");
    expect(groupRev2?.candidates[1]?.storageObjectKey).toBe(
      `candidates/${sceneRecord.scene_id}/rev2_var2.webp`
    );
    expect(groupRev2?.candidates[2]?.id).toBe(candRev2Var3.candidate_id);
    expect(groupRev2?.candidates[2]?.variantOrdinal).toBe(3);
    expect(groupRev2?.candidates[2]?.storageBucket).toBe("godzspeed-temp");
    expect(groupRev2?.candidates[2]?.storageObjectKey).toBe(
      `candidates/${sceneRecord.scene_id}/rev2_var3.webp`
    );

    // Allowed actions for director_review
    expect(detail?.allowedActions).toEqual(
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
  });

  it("returns undefined when sceneId is not found", async () => {
    const queryAdapter = new PostgresSceneReviewQueries(client);
    const result = await queryAdapter.getSceneReviewDetail(
      "01950c46-9e90-7d3d-82d2-8f1d3c999999" as SceneId
    );
    expect(result).toBeUndefined();
  });

  it("projects correct allowedActions and approval metadata across various scene statuses", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });

    // 1. draft_pending scene with no candidates
    const draftScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.0,
      visualDescription: "Draft visual prompt",
      engineAssigned: "flux_schnell",
      status: "draft_pending",
      specRevision: 1
    });

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const draftDetail = await queryAdapter.getSceneReviewDetail(draftScene.scene_id as SceneId);

    expect(draftDetail).toBeDefined();
    expect(draftDetail?.status).toBe("draft_pending");
    expect(draftDetail?.candidatesByRevision).toEqual([]);
    expect(draftDetail?.approval).toBeUndefined();
    expect(draftDetail?.selectedCandidateId).toBeUndefined();
    expect(draftDetail?.selectedCandidateRevision).toBeUndefined();
    expect(draftDetail?.allowedActions).toEqual(
      expect.arrayContaining([
        "prompt_edit",
        "reference_change",
        "engine_change",
        "duration_change",
        "lora_tune",
        "cancel"
      ])
    );
    expect(draftDetail?.allowedActions).not.toContain("approve");
    expect(draftDetail?.allowedActions).not.toContain("reroll");
    expect(draftDetail?.allowedActions).not.toContain("candidate_select");

    // 2. approved scene with approval metadata
    const approvedAtIso = "2026-08-16T18:00:00.000Z";
    const approvedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      durationSeconds: 5.0,
      visualDescription: "Approved visual prompt",
      engineAssigned: "ltx_25",
      status: "approved",
      specRevision: 1,
      approvedBy: "Thomas Cumberbatch",
      approvedAt: approvedAtIso,
      approvedRevision: 1
    });

    const approvedDetail = await queryAdapter.getSceneReviewDetail(
      approvedScene.scene_id as SceneId
    );
    expect(approvedDetail).toBeDefined();
    expect(approvedDetail?.status).toBe("approved");
    expect(approvedDetail?.approval).toEqual({
      revision: 1,
      approvedBy: "Thomas Cumberbatch",
      approvedAt: new Date(approvedAtIso).toISOString()
    });
    expect(approvedDetail?.allowedActions).toEqual(
      expect.arrayContaining([
        "prompt_edit",
        "reference_change",
        "engine_change",
        "duration_change",
        "lora_tune",
        "cancel"
      ])
    );
    expect(approvedDetail?.allowedActions).not.toContain("approve");

    // 3. QA scene
    const qaScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      durationSeconds: 5.0,
      visualDescription: "QA scene prompt",
      engineAssigned: "ltx_25",
      status: "qa",
      specRevision: 1
    });

    const qaDetail = await queryAdapter.getSceneReviewDetail(qaScene.scene_id as SceneId);
    expect(qaDetail).toBeDefined();
    expect(qaDetail?.status).toBe("qa");
    expect(qaDetail?.allowedActions).toEqual(expect.arrayContaining(["approve", "reject"]));
    expect(qaDetail?.allowedActions).not.toContain("reroll");

    let sceneOrder = 4;
    // 4. generating_candidates, queued, rendering, failed scenes
    for (const st of ["generating_candidates", "queued", "rendering", "failed"] as const) {
      const scene = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: sceneOrder++,
        durationSeconds: 5.0,
        visualDescription: `${st} prompt`,
        engineAssigned: "ltx_25",
        status: st,
        specRevision: 1
      });

      const detail = await queryAdapter.getSceneReviewDetail(scene.scene_id as SceneId);
      expect(detail?.status).toBe(st);
      expect(detail?.allowedActions).toEqual(["cancel"]);
    }

    // 5. completed and cancelled scenes (terminal)
    for (const st of ["completed", "cancelled"] as const) {
      const scene = await insertStoryboardSceneRecord(client, {
        campaignId: campaign.campaign_id,
        sceneOrder: sceneOrder++,
        durationSeconds: 5.0,
        visualDescription: `${st} prompt`,
        engineAssigned: "ltx_25",
        status: st,
        specRevision: 1
      });

      const detail = await queryAdapter.getSceneReviewDetail(scene.scene_id as SceneId);
      expect(detail?.status).toBe(st);
      expect(detail?.allowedActions).toEqual([]);
    }
  });

  it("works with pg.Pool instance as well as pg.PoolClient", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 4.5,
      visualDescription: "Pool test scene",
      engineAssigned: "ltx_25",
      status: "draft_pending",
      specRevision: 1
    });

    const poolAdapter = new PostgresSceneReviewQueries(pool);
    const detail = await poolAdapter.getSceneReviewDetail(sceneRecord.scene_id as SceneId);

    expect(detail).toBeDefined();
    expect(detail?.sceneId).toBe(sceneRecord.scene_id);
    expect(detail?.configuration.prompt).toBe("Pool test scene");
    expect(detail?.configuration.durationMs).toBe(4500);
  });

  it("returns undefined when campaignId does not exist", async () => {
    const queryAdapter = new PostgresSceneReviewQueries(client);
    const result = await queryAdapter.getCampaignReviewSummary(
      "01950c46-9e90-7d3d-82d2-8f1d3c999999" as CampaignId
    );
    expect(result).toBeUndefined();
  });

  it("campaign summary scenes preserve storyboard order and expose status and current revision", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Ordered Scenes Campaign"
    });

    // Insert out of order: order 2 first, then order 1
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "approved",
      specRevision: 3
    });

    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 2
    });

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const summary = await queryAdapter.getCampaignReviewSummary(campaign.campaign_id as CampaignId);

    expect(summary).toBeDefined();
    expect(summary?.scenes).toEqual([
      {
        sceneId: scene1.scene_id,
        status: "director_review",
        specRevision: 2
      },
      {
        sceneId: scene2.scene_id,
        status: "approved",
        specRevision: 3
      }
    ]);
  });

  it("campaign summary excludes archived scenes from rows and aggregate counts", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Archived Scenes Campaign"
    });

    const activeScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "director_review",
      specRevision: 1
    });
    await client.query(
      `UPDATE storyboard_scenes SET archived_at = CURRENT_TIMESTAMP WHERE scene_id = $1`,
      [archivedScene.scene_id]
    );

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const summary = await queryAdapter.getCampaignReviewSummary(campaign.campaign_id as CampaignId);

    expect(summary).toBeDefined();
    expect(summary?.totalScenes).toBe(1);
    expect(summary?.pendingReviewCount).toBe(1);
    expect(summary?.scenesByStatus).toEqual({
      director_review: 1
    });
    expect(summary?.scenes).toEqual([
      {
        sceneId: activeScene.scene_id,
        status: "director_review",
        specRevision: 1
      }
    ]);
  });

  it("campaign summary returns an empty scenes array for an empty campaign", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Empty Campaign"
    });

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const summary = await queryAdapter.getCampaignReviewSummary(campaign.campaign_id as CampaignId);

    expect(summary).toBeDefined();
    expect(summary?.campaignId).toBe(campaign.campaign_id);
    expect(summary?.campaignName).toBe("Empty Campaign");
    expect(summary?.totalScenes).toBe(0);
    expect(summary?.scenesByStatus).toEqual({});
    expect(summary?.pendingReviewCount).toBe(0);
    expect(summary?.approvedCount).toBe(0);
    expect(summary?.completedCount).toBe(0);
    expect(summary?.scenes).toEqual([]);
    expect(summary?.updatedAt).toBeDefined();
  });

  it("returns accurate CampaignReviewSummary with status counts for a campaign with multiple scenes in various states", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Summer Carnival Spectacular"
    });

    // Insert scenes across various statuses
    // 2 director_review scenes
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review"
    });
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      status: "director_review"
    });

    // 1 approved scene
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 3,
      status: "approved"
    });

    // 2 completed scenes
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 4,
      status: "completed"
    });
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 5,
      status: "completed"
    });

    // 1 draft_pending scene
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 6,
      status: "draft_pending"
    });

    // 1 rendering scene
    await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 7,
      status: "rendering"
    });

    // 1 archived scene (should be excluded)
    const archivedScene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 8,
      status: "director_review"
    });
    await client.query(
      `UPDATE storyboard_scenes SET archived_at = CURRENT_TIMESTAMP WHERE scene_id = $1`,
      [archivedScene.scene_id]
    );

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const summary = await queryAdapter.getCampaignReviewSummary(campaign.campaign_id as CampaignId);

    expect(summary).toBeDefined();
    expect(summary?.campaignId).toBe(campaign.campaign_id);
    expect(summary?.campaignName).toBe("Summer Carnival Spectacular");
    expect(summary?.totalScenes).toBe(7);
    expect(summary?.pendingReviewCount).toBe(2);
    expect(summary?.approvedCount).toBe(1);
    expect(summary?.completedCount).toBe(2);
    expect(summary?.scenesByStatus).toEqual({
      director_review: 2,
      approved: 1,
      completed: 2,
      draft_pending: 1,
      rendering: 1
    });
    expect(summary?.scenes).toHaveLength(7);
    expect(summary?.updatedAt).toBeDefined();
    expect(new Date(summary!.updatedAt).toISOString()).toBe(summary!.updatedAt);
  });

  it("returns zero counts for a newly created campaign with no scenes", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Empty Campaign"
    });

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const summary = await queryAdapter.getCampaignReviewSummary(campaign.campaign_id as CampaignId);

    expect(summary).toBeDefined();
    expect(summary?.campaignId).toBe(campaign.campaign_id);
    expect(summary?.campaignName).toBe("Empty Campaign");
    expect(summary?.totalScenes).toBe(0);
    expect(summary?.scenesByStatus).toEqual({});
    expect(summary?.pendingReviewCount).toBe(0);
    expect(summary?.approvedCount).toBe(0);
    expect(summary?.completedCount).toBe(0);
    expect(summary?.scenes).toEqual([]);
    expect(summary?.updatedAt).toBeDefined();
  });

  it("returns undefined when campaign is archived", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Archived Campaign"
    });
    await client.query(
      `UPDATE campaigns SET archived_at = CURRENT_TIMESTAMP WHERE campaign_id = $1`,
      [campaign.campaign_id]
    );

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const result = await queryAdapter.getCampaignReviewSummary(campaign.campaign_id as CampaignId);
    expect(result).toBeUndefined();
  });

  it("maps database storage_bucket and storage_object_key columns directly to StoryboardCandidate domain fields", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const candidateRecord = await insertStoryboardCandidateRecord(client, {
      sceneId: scene.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "custom-candidate-bucket",
      storageObjectKey: "custom/path/candidate-shot-01.webp",
      contentHashSha256: "6666666666666666666666666666666666666666666666666666666666666666",
      generationPayload: { prompt: "test prompt" }
    });

    const queryAdapter = new PostgresSceneReviewQueries(client);
    const detail = await queryAdapter.getSceneReviewDetail(scene.scene_id as SceneId);

    expect(detail).toBeDefined();
    const candidateGroup = detail?.candidatesByRevision.find((g) => g.specRevision === 1);
    expect(candidateGroup).toBeDefined();
    expect(candidateGroup?.candidates).toHaveLength(1);

    const candidate = candidateGroup?.candidates[0];
    expect(candidate).toBeDefined();
    expect(candidate?.id).toBe(candidateRecord.candidate_id);
    expect(candidate?.storageBucket).toBe("custom-candidate-bucket");
    expect(candidate?.storageObjectKey).toBe("custom/path/candidate-shot-01.webp");
    expect((candidate as unknown as Record<string, unknown>).locator).toBeUndefined();
  });
});
