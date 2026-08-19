import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  startPostgres18Container,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord,
  insertStoryboardCandidateRecord,
  MIGRATIONS_DIRECTORY_URL
} from "@cco/infrastructure/testing";
import {
  SceneReviewDetailReadModelSchema,
  ReviewCommandResponseSchema,
  type SceneReviewDetailReadModel,
  type ReviewCommand,
  type ReviewCommandResponse,
  type ReviewErrorResponse
} from "@cco/contracts";
import type { CandidateId } from "@cco/domain";
import { runMigrations, PostgresUnitOfWork, PostgresSceneReviewQueries } from "@cco/infrastructure";
import type { RenderEnginePort, RenderQueueReceipt } from "@cco/application";
import { createControlApiApp } from "./app.js";

describe("Sprint 1.5 Review Plane End-to-End Contract Closure", () => {
  let postgresContainer: StartedPostgres18Container;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

  const authHeaders = {
    authorization: "Bearer token-director-thomas"
  };

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

  it("proves the complete 11-step Review Plane vertical slice end-to-end against PostgreSQL 18", async () => {
    // -------------------------------------------------------------------------
    // Setup & Seed Data
    // -------------------------------------------------------------------------
    const clientRecord = await insertClientRecord(client, {
      companyName: "Godzspeed Trinidad & Tobago"
    });
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Carnival 2026 Commercial"
    });

    // Scene in director_review with specRevision = 2
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Midnight Robber delivering a monologue under moonlight.",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 2
    });

    // 1 Historical candidate from revision 1
    const candidateRev1Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev1_var1.webp`,
      contentHashSha256: "1111111111111111111111111111111111111111111111111111111111111111",
      generationPayload: { seed: 101 }
    });

    // 3 Current candidates for revision 2
    const candidateRev2Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var1.webp`,
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222222",
      generationPayload: { seed: 201 }
    });
    const candidateRev2Var2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 2,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var2.webp`,
      contentHashSha256: "3333333333333333333333333333333333333333333333333333333333333333",
      generationPayload: { seed: 202 }
    });
    const candidateRev2Var3 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 3,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var3.webp`,
      contentHashSha256: "4444444444444444444444444444444444444444444444444444444444444444",
      generationPayload: { seed: 203 }
    });

    // Setup composition root with spy/fake RenderEnginePort and authenticated ReviewerIdentityResolver
    const queueRenderSpy = vi.fn().mockResolvedValue({
      executionId: "exec-mock-001",
      acceptedAt: new Date().toISOString()
    } as RenderQueueReceipt);
    const getRenderResultSpy = vi.fn().mockResolvedValue(undefined);
    const unloadModelsSpy = vi.fn().mockResolvedValue(undefined);

    const fakeRenderEngine: RenderEnginePort = {
      queueRender: queueRenderSpy,
      getRenderResult: getRenderResultSpy,
      unloadModels: unloadModelsSpy
    };

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp(
      {
        uow,
        sceneReviewQueries,
        renderEngine: fakeRenderEngine
      },
      {
        reviewerIdentityResolver: {
          resolve: (request) => {
            const auth = request.headers.authorization;
            if (auth === "Bearer token-director-thomas") {
              return "Thomas Cumberbatch";
            }
            return "Anonymous Reviewer";
          }
        }
      }
    );

    // -------------------------------------------------------------------------
    // Step 1: Read Scene review detail and verify three current candidates
    // -------------------------------------------------------------------------
    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json() as SceneReviewDetailReadModel;
    const detailParsed = SceneReviewDetailReadModelSchema.safeParse(detailBody);
    expect(detailParsed.success).toBe(true);

    expect(detailBody.sceneId).toBe(sceneRecord.scene_id);
    expect(detailBody.status).toBe("director_review");
    expect(detailBody.specRevision).toBe(2);

    const rev2Group = detailBody.candidatesByRevision.find((g) => g.specRevision === 2);
    expect(rev2Group).toBeDefined();
    expect(rev2Group?.candidates).toHaveLength(3);
    expect(rev2Group?.candidates.map((c) => c.candidateId)).toEqual(
      expect.arrayContaining([
        candidateRev2Var1.candidate_id,
        candidateRev2Var2.candidate_id,
        candidateRev2Var3.candidate_id
      ])
    );

    const rev1Group = detailBody.candidatesByRevision.find((g) => g.specRevision === 1);
    expect(rev1Group).toBeDefined();
    expect(rev1Group?.candidates).toHaveLength(1);
    expect(rev1Group?.candidates[0]?.candidateId).toBe(candidateRev1Var1.candidate_id);

    // -------------------------------------------------------------------------
    // Step 2: Select a current-revision candidate
    // -------------------------------------------------------------------------
    const actionId1 = "01950c46-9e90-7d3d-82d2-8f1d3e100001";
    const selectCommand: ReviewCommand = {
      actionId: actionId1,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "candidate_select",
      payload: {
        candidateId: candidateRev2Var1.candidate_id as CandidateId
      },
      directorNotes: "Selecting candidate 1 for revision 2"
    };

    const selectRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: selectCommand
    });
    expect(selectRes.statusCode).toBe(200);
    const selectBody = selectRes.json() as ReviewCommandResponse;
    const selectParsed = ReviewCommandResponseSchema.safeParse(selectBody);
    expect(selectParsed.success).toBe(true);
    expect(selectBody.selectedCandidateId).toBe(candidateRev2Var1.candidate_id);
    expect(selectBody.isIdempotentReplay).toBe(false);

    // Verify DB state
    const dbSceneAfterSelect = await client.query<{
      selected_candidate_id: string;
      selected_candidate_revision: number;
      status: string;
    }>(
      "SELECT selected_candidate_id, selected_candidate_revision, status FROM storyboard_scenes WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(dbSceneAfterSelect.rows[0]?.selected_candidate_id).toBe(candidateRev2Var1.candidate_id);
    expect(dbSceneAfterSelect.rows[0]?.selected_candidate_revision).toBe(2);
    expect(dbSceneAfterSelect.rows[0]?.status).toBe("director_review");

    // -------------------------------------------------------------------------
    // Step 3: Retry exact same action ID -> verify idempotent replay/no duplicate event
    // -------------------------------------------------------------------------
    const retryRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: selectCommand
    });
    expect(retryRes.statusCode).toBe(200);
    const retryBody = retryRes.json() as ReviewCommandResponse;
    expect(retryBody.isIdempotentReplay).toBe(true);
    expect(retryBody.selectedCandidateId).toBe(candidateRev2Var1.candidate_id);

    const eventCountAfterRetry = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCountAfterRetry.rows[0]!.count, 10)).toBe(1);

    // -------------------------------------------------------------------------
    // Step 4: Reuse action ID with different material content -> verify conflict
    // -------------------------------------------------------------------------
    const conflictingCommand: ReviewCommand = {
      actionId: actionId1,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "candidate_select",
      payload: {
        candidateId: candidateRev2Var2.candidate_id as CandidateId
      },
      directorNotes: "Different payload reusing action ID"
    };

    const conflictRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: conflictingCommand
    });
    expect(conflictRes.statusCode).toBe(409);
    const conflictBody = conflictRes.json() as ReviewErrorResponse;
    expect(conflictBody.code).toBe("IDEMPOTENCY_CONFLICT");

    const eventCountAfterConflict = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCountAfterConflict.rows[0]!.count, 10)).toBe(1);

    // -------------------------------------------------------------------------
    // Step 5: Attempt a stale-revision command -> verify zero writes
    // -------------------------------------------------------------------------
    const actionIdStale = "01950c46-9e90-7d3d-82d2-8f1d3e100002";
    const staleCommand: ReviewCommand = {
      actionId: actionIdStale,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 1, // Stale! Scene is at revision 2
      action: "prompt_edit",
      payload: {
        prompt: "Stale revision update attempt"
      }
    };

    const staleRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: staleCommand
    });
    expect(staleRes.statusCode).toBe(409);
    const staleBody = staleRes.json() as ReviewErrorResponse;
    expect(staleBody.code).toBe("STALE_REVISION_CONFLICT");

    const eventCountAfterStale = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCountAfterStale.rows[0]!.count, 10)).toBe(1);

    // -------------------------------------------------------------------------
    // Step 6: Approve the selected current-revision candidate
    // -------------------------------------------------------------------------
    const actionIdApprove = "01950c46-9e90-7d3d-82d2-8f1d3e100003";
    const approveCommand: ReviewCommand = {
      actionId: actionIdApprove,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "approve",
      payload: {},
      directorNotes: "Approved scene composition for revision 2"
    };

    const approveRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: approveCommand
    });
    expect(approveRes.statusCode).toBe(200);
    const approveBody = approveRes.json() as ReviewCommandResponse;
    expect(approveBody.status).toBe("approved");
    expect(approveBody.selectedCandidateId).toBe(candidateRev2Var1.candidate_id);
    expect(approveBody.approval).toBeDefined();
    expect(approveBody.approval?.approvedBy).toBe("Thomas Cumberbatch");
    expect(approveBody.approval?.revision).toBe(2);

    const dbSceneAfterApprove = await client.query<{
      status: string;
      approved_by: string;
      approved_revision: number;
    }>("SELECT status, approved_by, approved_revision FROM storyboard_scenes WHERE scene_id = $1", [
      sceneRecord.scene_id
    ]);
    expect(dbSceneAfterApprove.rows[0]?.status).toBe("approved");
    expect(dbSceneAfterApprove.rows[0]?.approved_by).toBe("Thomas Cumberbatch");
    expect(dbSceneAfterApprove.rows[0]?.approved_revision).toBe(2);

    // -------------------------------------------------------------------------
    // Step 7: Mutate a SceneSpec field -> verify approval + candidate selection invalidated, revision increments
    // -------------------------------------------------------------------------
    const actionIdMutate = "01950c46-9e90-7d3d-82d2-8f1d3e100004";
    const mutateCommand: ReviewCommand = {
      actionId: actionIdMutate,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "prompt_edit",
      payload: {
        prompt: "Updated prompt: Midnight Robber performing under dramatic lightning."
      },
      directorNotes: "Updating visual prompt to increase dramatic tension"
    };

    const mutateRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: mutateCommand
    });
    expect(mutateRes.statusCode).toBe(200);
    const mutateBody = mutateRes.json() as ReviewCommandResponse;
    expect(mutateBody.status).toBe("director_review");
    expect(mutateBody.specRevision).toBe(3);
    expect(mutateBody.selectedCandidateId).toBeUndefined();
    expect(mutateBody.approval).toBeUndefined();

    const dbSceneAfterMutate = await client.query<{
      status: string;
      spec_revision: number;
      selected_candidate_id: string | null;
      selected_candidate_revision: number | null;
      approved_by: string | null;
      approved_revision: number | null;
      visual_description: string;
    }>(
      `SELECT status, spec_revision, selected_candidate_id, selected_candidate_revision,
              approved_by, approved_revision, visual_description
       FROM storyboard_scenes WHERE scene_id = $1`,
      [sceneRecord.scene_id]
    );
    expect(dbSceneAfterMutate.rows[0]?.status).toBe("director_review");
    expect(dbSceneAfterMutate.rows[0]?.spec_revision).toBe(3);
    expect(dbSceneAfterMutate.rows[0]?.selected_candidate_id).toBeNull();
    expect(dbSceneAfterMutate.rows[0]?.selected_candidate_revision).toBeNull();
    expect(dbSceneAfterMutate.rows[0]?.approved_by).toBeNull();
    expect(dbSceneAfterMutate.rows[0]?.approved_revision).toBeNull();
    expect(dbSceneAfterMutate.rows[0]?.visual_description).toBe(
      "Updated prompt: Midnight Robber performing under dramatic lightning."
    );

    // -------------------------------------------------------------------------
    // Step 8: Verify historical/stale candidate cannot be selected for new revision
    // -------------------------------------------------------------------------
    const actionIdStaleCandidate = "01950c46-9e90-7d3d-82d2-8f1d3e100005";
    const staleCandidateCommand: ReviewCommand = {
      actionId: actionIdStaleCandidate,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 3,
      action: "candidate_select",
      payload: {
        candidateId: candidateRev2Var1.candidate_id as CandidateId // Revision 2 candidate on revision 3 scene!
      }
    };

    const staleCandidateRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: staleCandidateCommand
    });
    expect(staleCandidateRes.statusCode).toBe(422);
    const staleCandidateBody = staleCandidateRes.json() as ReviewErrorResponse;
    expect(staleCandidateBody.code).toBe("INVALID_DOMAIN_TRANSITION");
    expect(staleCandidateBody.message).toContain(
      "Candidate revision does not match current scene revision"
    );

    // -------------------------------------------------------------------------
    // Step 9: Establish current-revision selection again through valid flow
    // -------------------------------------------------------------------------
    const candidateRev3Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 3,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev3_var1.webp`,
      contentHashSha256: "5555555555555555555555555555555555555555555555555555555555555555",
      generationPayload: { seed: 301 }
    });

    const actionIdSelectRev3 = "01950c46-9e90-7d3d-82d2-8f1d3e100006";
    const selectRev3Command: ReviewCommand = {
      actionId: actionIdSelectRev3,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 3,
      action: "candidate_select",
      payload: {
        candidateId: candidateRev3Var1.candidate_id as CandidateId
      },
      directorNotes: "Selecting new candidate 1 for revision 3"
    };

    const selectRev3Res = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: selectRev3Command
    });
    expect(selectRev3Res.statusCode).toBe(200);
    const selectRev3Body = selectRev3Res.json() as ReviewCommandResponse;
    expect(selectRev3Body.selectedCandidateId).toBe(candidateRev3Var1.candidate_id);

    // -------------------------------------------------------------------------
    // Step 10: Request reroll -> verify generating_candidates, selection clears, zero render engine calls
    // -------------------------------------------------------------------------
    const actionIdReroll = "01950c46-9e90-7d3d-82d2-8f1d3e100007";
    const rerollCommand: ReviewCommand = {
      actionId: actionIdReroll,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 3,
      action: "reroll",
      payload: {},
      directorNotes: "Rerolling revision 3 candidates"
    };

    const rerollRes = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: rerollCommand
    });
    expect(rerollRes.statusCode).toBe(200);
    const rerollBody = rerollRes.json() as ReviewCommandResponse;
    expect(rerollBody.status).toBe("generating_candidates");
    expect(rerollBody.selectedCandidateId).toBeUndefined();

    // Verify spy on RenderEnginePort was called exactly ZERO times
    expect(queueRenderSpy).toHaveBeenCalledTimes(0);
    expect(getRenderResultSpy).toHaveBeenCalledTimes(0);
    expect(unloadModelsSpy).toHaveBeenCalledTimes(0);

    const dbSceneAfterReroll = await client.query<{
      status: string;
      selected_candidate_id: string | null;
    }>("SELECT status, selected_candidate_id FROM storyboard_scenes WHERE scene_id = $1", [
      sceneRecord.scene_id
    ]);
    expect(dbSceneAfterReroll.rows[0]?.status).toBe("generating_candidates");
    expect(dbSceneAfterReroll.rows[0]?.selected_candidate_id).toBeNull();

    // -------------------------------------------------------------------------
    // Step 11: Verify ReviewEvent history represents successful actions once with server metadata
    // -------------------------------------------------------------------------
    const reviewEventsResult = await client.query<{
      event_id: string;
      action: string;
      reviewer_name: string;
      director_notes: string | null;
      prior_scene_status: string | null;
      resulting_scene_status: string | null;
      expected_spec_revision: number | null;
      created_at: Date;
    }>(
      "SELECT event_id, action, reviewer_name, director_notes, prior_scene_status, resulting_scene_status, expected_spec_revision, created_at FROM review_events WHERE scene_id = $1 ORDER BY created_at ASC",
      [sceneRecord.scene_id]
    );

    // Exactly 5 successful actions committed:
    // 1. candidate_select (actionId1)
    // 2. approve (actionIdApprove)
    // 3. prompt_edit (actionIdMutate)
    // 4. candidate_select (actionIdSelectRev3)
    // 5. reroll (actionIdReroll)
    expect(reviewEventsResult.rows).toHaveLength(5);

    const expectedEvents = [
      {
        id: actionId1,
        action: "candidate_select",
        priorStatus: "director_review",
        resultingStatus: "director_review",
        expectedRevision: 2
      },
      {
        id: actionIdApprove,
        action: "approve",
        priorStatus: "director_review",
        resultingStatus: "approved",
        expectedRevision: 2
      },
      {
        id: actionIdMutate,
        action: "prompt_edit",
        priorStatus: "approved",
        resultingStatus: "director_review",
        expectedRevision: 2
      },
      {
        id: actionIdSelectRev3,
        action: "candidate_select",
        priorStatus: "director_review",
        resultingStatus: "director_review",
        expectedRevision: 3
      },
      {
        id: actionIdReroll,
        action: "reroll",
        priorStatus: "director_review",
        resultingStatus: "generating_candidates",
        expectedRevision: 3
      }
    ];

    for (let i = 0; i < expectedEvents.length; i++) {
      const row = reviewEventsResult.rows[i]!;
      const expected = expectedEvents[i]!;
      expect(row.event_id).toBe(expected.id);
      expect(row.action).toBe(expected.action);
      expect(row.reviewer_name).toBe("Thomas Cumberbatch");
      expect(row.prior_scene_status).toBe(expected.priorStatus);
      expect(row.resulting_scene_status).toBe(expected.resultingStatus);
      expect(row.expected_spec_revision).toBe(expected.expectedRevision);
      expect(row.created_at).toBeInstanceOf(Date);
    }
  });
});
