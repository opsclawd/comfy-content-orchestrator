import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  startPostgres18Container,
  startMinioContainer,
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
  Pool,
  type PoolClient,
  type StartedPostgres18Container,
  type StartedMinioContainer,
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
import { BUCKET_NAMES } from "@cco/shared";
import type { CandidateId, SceneId } from "@cco/domain";
import {
  runMigrations,
  PostgresUnitOfWork,
  PostgresSceneReviewQueries,
  S3ReviewMediaDelivery
} from "@cco/infrastructure";
import type { RenderEnginePort, RenderQueueReceipt } from "@cco/application";
import { createControlApiApp } from "./app.js";

describe("Sprint 1.5 Review Plane End-to-End Contract Closure", () => {
  let postgresContainer: StartedPostgres18Container;
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let reviewMediaDelivery: S3ReviewMediaDelivery;
  let pool: Pool;
  let client: PoolClient;
  const migrationsDirectory = MIGRATIONS_DIRECTORY_URL;

  const authHeaders = {
    authorization: "Bearer token-director-thomas"
  };

  beforeAll(async () => {
    postgresContainer = await startPostgres18Container();
    minioContainer = await startMinioContainer();

    pool = new Pool({
      connectionString: postgresContainer.getConnectionUri(),
      max: 10
    });

    rawS3Client = new S3Client({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    for (const bucket of BUCKET_NAMES) {
      try {
        await rawS3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: unknown) {
        const errorName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (errorName !== "BucketAlreadyExists" && errorName !== "BucketAlreadyOwnedByYou") {
          throw err;
        }
      }
    }

    reviewMediaDelivery = new S3ReviewMediaDelivery({
      signingEndpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
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
    rawS3Client?.destroy();
    if (minioContainer) {
      await minioContainer.stop();
    }
  });

  beforeEach(async () => {
    if (!client) {
      client = await pool.connect();
    }
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await runMigrations(client, { migrationsDirectory });
  });

  it("selecting A then B then A at the same revision returns 200 for all three and writes three events", async () => {
    const clientRecord = await insertClientRecord(client, {
      companyName: "Godzspeed Trinidad & Tobago"
    });
    const campaign = await insertCampaignRecord(client, {
      clientId: clientRecord.client_id,
      title: "Carnival 2026 Commercial"
    });

    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      durationSeconds: 5.0,
      visualDescription: "Midnight Robber delivering a monologue under moonlight.",
      engineAssigned: "ltx_25",
      status: "director_review",
      specRevision: 2
    });

    const candidateRev2Var1 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 1,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var1.webp`,
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222221",
      generationPayload: { seed: 201 }
    });

    const candidateRev2Var2 = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 2,
      variantOrdinal: 2,
      storageBucket: "godzspeed-temp",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/rev2_var2.webp`,
      contentHashSha256: "2222222222222222222222222222222222222222222222222222222222222222",
      generationPayload: { seed: 202 }
    });

    const fakeRenderEngine: RenderEnginePort = {
      queueRender: vi.fn().mockResolvedValue({
        executionId: "mock-receipt-id",
        acceptedAt: new Date().toISOString()
      } as RenderQueueReceipt),
      getRenderResult: vi.fn().mockResolvedValue(undefined),
      unloadModels: vi.fn().mockResolvedValue(undefined)
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
          resolve: () => "Thomas Cumberbatch"
        },
        clock: {
          now: () => new Date().toISOString()
        }
      }
    );

    // Action 1: Select candidateRev2Var1 at rev 2
    const actionId1 = "01950c46-9e90-7d3d-82d2-8f1d3e110001";
    const selectA: ReviewCommand = {
      actionId: actionId1,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "candidate_select",
      payload: { candidateId: candidateRev2Var1.candidate_id as CandidateId },
      directorNotes: "First selection"
    };
    const resA = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: selectA
    });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json() as ReviewCommandResponse;
    expect(bodyA.selectedCandidateId).toBe(candidateRev2Var1.candidate_id);
    expect(bodyA.isIdempotentReplay).toBe(false);

    // Action 2: Select candidateRev2Var2 at rev 2
    const actionId2 = "01950c46-9e90-7d3d-82d2-8f1d3e110002";
    const selectB: ReviewCommand = {
      actionId: actionId2,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "candidate_select",
      payload: { candidateId: candidateRev2Var2.candidate_id as CandidateId },
      directorNotes: "Second selection"
    };
    const resB = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: selectB
    });
    expect(resB.statusCode).toBe(200);
    const bodyB = resB.json() as ReviewCommandResponse;
    expect(bodyB.selectedCandidateId).toBe(candidateRev2Var2.candidate_id);
    expect(bodyB.isIdempotentReplay).toBe(false);

    // Action 3: Re-select candidateRev2Var1 at rev 2 — this is the bug (returns 500 before migration)
    const actionId3 = "01950c46-9e90-7d3d-82d2-8f1d3e110003";
    const selectAAgain: ReviewCommand = {
      actionId: actionId3,
      sceneId: sceneRecord.scene_id,
      expectedSpecRevision: 2,
      action: "candidate_select",
      payload: { candidateId: candidateRev2Var1.candidate_id as CandidateId },
      directorNotes: "Re-selecting first candidate"
    };
    const resAAgain = await app.inject({
      method: "POST",
      url: `/api/scenes/${sceneRecord.scene_id}/review-command`,
      headers: authHeaders,
      payload: selectAAgain
    });
    expect(resAAgain.statusCode).toBe(200);
    const bodyAAgain = resAAgain.json() as ReviewCommandResponse;
    expect(bodyAAgain.selectedCandidateId).toBe(candidateRev2Var1.candidate_id);
    expect(bodyAAgain.isIdempotentReplay).toBe(false);

    // Verify exactly 3 distinct events were written
    const eventCount = await client.query<{ count: string }>(
      "SELECT count(*) FROM review_events WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    expect(parseInt(eventCount.rows[0]!.count, 10)).toBe(3);

    await app.close();
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

    // Seed MinIO with candidate bytes for revision 2 candidates (rev 1 remains unseeded/missing)
    const rev2Var1Payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const rev2Var2Payload = new Uint8Array([9, 10, 11, 12, 13, 14]);
    const rev2Var3Payload = new Uint8Array([15, 16, 17, 18, 19, 20]);

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: "godzspeed-review",
        Key: candidateRev2Var1.storage_object_key,
        Body: rev2Var1Payload,
        ContentType: "image/webp"
      })
    );
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: "godzspeed-review",
        Key: candidateRev2Var2.storage_object_key,
        Body: rev2Var2Payload,
        ContentType: "image/webp"
      })
    );
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: "godzspeed-review",
        Key: candidateRev2Var3.storage_object_key,
        Body: rev2Var3Payload,
        ContentType: "image/webp"
      })
    );

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
        renderEngine: fakeRenderEngine,
        reviewMediaDelivery
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

    // Candidate Rev 2 Var 1 has available: true and working presigned URL
    const cand1Read = rev2Group?.candidates.find(
      (c) => c.candidateId === candidateRev2Var1.candidate_id
    );
    expect(cand1Read).toBeDefined();
    expect(cand1Read?.media.available).toBe(true);
    expect(typeof cand1Read?.media.url).toBe("string");
    expect(cand1Read?.media.url).toContain(minioContainer.getEndpoint());

    // Fetch presigned URL over HTTP without auth headers and verify exact bytes
    const fetchRes = await fetch(cand1Read!.media.url!);
    expect(fetchRes.status).toBe(200);
    const fetchedBytes = new Uint8Array(await fetchRes.arrayBuffer());
    expect(fetchedBytes).toEqual(rev2Var1Payload);

    // Revision 1 candidate (not seeded in MinIO) returns available: false and undefined url
    const rev1Group = detailBody.candidatesByRevision.find((g) => g.specRevision === 1);
    expect(rev1Group).toBeDefined();
    expect(rev1Group?.candidates).toHaveLength(1);
    expect(rev1Group?.candidates[0]?.candidateId).toBe(candidateRev1Var1.candidate_id);
    expect(rev1Group?.candidates[0]?.media.available).toBe(false);
    expect(rev1Group?.candidates[0]?.media.url).toBeUndefined();

    // Wait for signature timestamp to advance to verify dynamic generation without caching
    await new Promise((resolve) => setTimeout(resolve, 1050));

    // Perform second GET /api/scenes/:sceneId/review and verify candidate 1 returns a distinct fresh signed URL (no caching)
    const detailResponse2 = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });
    expect(detailResponse2.statusCode).toBe(200);
    const detailBody2 = detailResponse2.json() as SceneReviewDetailReadModel;
    const cand1SecondRead = detailBody2.candidatesByRevision
      .find((g) => g.specRevision === 2)
      ?.candidates.find((c) => c.candidateId === candidateRev2Var1.candidate_id);
    expect(cand1SecondRead?.media.available).toBe(true);
    expect(cand1SecondRead?.media.url).toBeDefined();
    expect(cand1SecondRead?.media.url).not.toEqual(cand1Read?.media.url);

    // Query PostgreSQL storyboard_candidates and verify zero presigned URL strings stored
    const dbCandidatesCheck = await client.query<{
      storage_bucket: string;
      storage_object_key: string;
      generation_payload: unknown;
    }>(
      "SELECT storage_bucket, storage_object_key, generation_payload FROM storyboard_candidates WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    for (const row of dbCandidatesCheck.rows) {
      const rowString = JSON.stringify(row);
      expect(rowString).not.toContain("X-Amz-Signature");
      expect(rowString).not.toContain("http://");
      expect(rowString).not.toContain("https://");
    }

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

  it("fetches candidate media bytes over HTTP using presigned URL returned by scene review endpoint", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const sceneRecord = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review",
      specRevision: 1
    });

    const binaryPayload = new TextEncoder().encode("candidate-media-bytes-direct-http-fetch");
    const candidate = await insertStoryboardCandidateRecord(client, {
      sceneId: sceneRecord.scene_id,
      sceneSpecRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/direct_http_var1.webp`
    });

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: "godzspeed-review",
        Key: candidate.storage_object_key,
        Body: binaryPayload,
        ContentType: "image/webp"
      })
    );

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp({
      uow,
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as SceneReviewDetailReadModel;
    const candidateRead = body.candidatesByRevision[0]?.candidates[0];
    expect(candidateRead).toBeDefined();
    expect(candidateRead?.media.available).toBe(true);
    expect(typeof candidateRead?.media.url).toBe("string");

    // Native fetch over HTTP without authentication headers
    const fetchRes = await fetch(candidateRead!.media.url!);
    expect(fetchRes.status).toBe(200);
    const fetchedBytes = new Uint8Array(await fetchRes.arrayBuffer());
    expect(fetchedBytes).toEqual(binaryPayload);

    await app.close();
  });

  it("proves missing storage objects degrade to media available false without url", async () => {
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
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/missing_object_var1.webp`
    });

    // Do NOT upload object to MinIO

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp({
      uow,
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as SceneReviewDetailReadModel;
    expect(body.sceneId).toBe(sceneRecord.scene_id);
    expect(body.status).toBe("director_review");
    expect(body.specRevision).toBe(1);

    const candidateRead = body.candidatesByRevision[0]?.candidates[0];
    expect(candidateRead?.candidateId).toBe(candidate.candidate_id);
    expect(candidateRead?.media).toEqual({ available: false });
    expect(candidateRead?.media.url).toBeUndefined();

    await app.close();
  });

  it("verifies no presigned URL is written to database during scene review read", async () => {
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
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/db_no_write_var1.webp`
    });

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: "godzspeed-review",
        Key: candidate.storage_object_key,
        Body: new TextEncoder().encode("db-no-write-bytes"),
        ContentType: "image/webp"
      })
    );

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp({
      uow,
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as SceneReviewDetailReadModel;
    expect(body.candidatesByRevision[0]?.candidates[0]?.media.available).toBe(true);
    const presignedUrl = body.candidatesByRevision[0]?.candidates[0]?.media.url;
    expect(presignedUrl).toBeDefined();

    // Verify storyboard_scenes, storyboard_candidates, and review_events contain no presigned URL
    const sceneRows = await client.query("SELECT * FROM storyboard_scenes WHERE scene_id = $1", [
      sceneRecord.scene_id
    ]);
    const candidateRows = await client.query(
      "SELECT * FROM storyboard_candidates WHERE scene_id = $1",
      [sceneRecord.scene_id]
    );
    const eventRows = await client.query("SELECT * FROM review_events WHERE scene_id = $1", [
      sceneRecord.scene_id
    ]);

    const combinedDbDump = JSON.stringify({
      scenes: sceneRows.rows,
      candidates: candidateRows.rows,
      events: eventRows.rows
    });

    expect(combinedDbDump).not.toContain(presignedUrl);
    expect(combinedDbDump).not.toContain("X-Amz-Signature");
    expect(combinedDbDump).not.toContain("X-Amz-Algorithm");
    expect(combinedDbDump).not.toContain("X-Amz-Credential");

    await app.close();
  });

  it("verifies successive reads generate newly signed non-cached URLs", async () => {
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
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/no_cache_test_var1.webp`
    });

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: "godzspeed-review",
        Key: candidate.storage_object_key,
        Body: new TextEncoder().encode("no-cache-test-bytes"),
        ContentType: "image/webp"
      })
    );

    const uow = new PostgresUnitOfWork(pool);
    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const app = createControlApiApp({
      uow,
      sceneReviewQueries,
      reviewMediaDelivery
    });

    const res1 = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });
    expect(res1.statusCode).toBe(200);
    const body1 = res1.json() as SceneReviewDetailReadModel;
    const url1 = body1.candidatesByRevision[0]?.candidates[0]?.media.url;
    expect(url1).toBeDefined();

    // Wait for signature timestamp to advance to verify dynamic generation without caching
    await new Promise((resolve) => setTimeout(resolve, 1050));

    const res2 = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneRecord.scene_id}/review`,
      headers: authHeaders
    });
    expect(res2.statusCode).toBe(200);
    const body2 = res2.json() as SceneReviewDetailReadModel;
    const url2 = body2.candidatesByRevision[0]?.candidates[0]?.media.url;
    expect(url2).toBeDefined();

    // Verify distinct signed URLs generated on each request
    expect(url1).not.toEqual(url2);

    await app.close();
  });

  it("verifies postgres scene review queries remain completely decoupled from storage delivery port", async () => {
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
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: `candidates/${sceneRecord.scene_id}/decoupled_query_var1.webp`,
      contentHashSha256: "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"
    });

    // Verify PostgresSceneReviewQueries constructor takes ONLY client and length is 1
    expect(PostgresSceneReviewQueries.length).toBe(1);

    const sceneReviewQueries = new PostgresSceneReviewQueries(pool);
    const detail = await sceneReviewQueries.getSceneReviewDetail(sceneRecord.scene_id as SceneId);

    expect(detail).toBeDefined();
    expect(detail?.candidatesByRevision).toHaveLength(1);
    const returnedCandidate = detail?.candidatesByRevision[0]?.candidates[0];
    expect(returnedCandidate).toBeDefined();

    // Returned candidate contains raw storage locator data, without presigned URL or media fields
    expect(returnedCandidate?.storageBucket).toBe("godzspeed-review");
    expect(returnedCandidate?.storageObjectKey).toBe(candidate.storage_object_key);
    expect(returnedCandidate?.contentHash).toBe(candidate.content_hash_sha256);
    expect((returnedCandidate as unknown as Record<string, unknown>).media).toBeUndefined();
    expect((returnedCandidate as unknown as Record<string, unknown>).presignedUrl).toBeUndefined();
  });
});
