import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { Pool, type PoolClient } from "pg";
import type { CandidateId, SceneId, StoryboardCandidate } from "@cco/domain";
import type { ReviewEvent } from "@cco/contracts";
import { runMigrations } from "../migration-runner.js";
import {
  startPostgres18Container,
  type StartedPostgres18Container
} from "../test-support/postgres-18.js";
import {
  insertClientRecord,
  insertCampaignRecord,
  insertStoryboardSceneRecord
} from "../test-support/records.js";
import { PostgresStoryboardCandidateRepository } from "./postgres-storyboard-candidate-repository.js";
import { PostgresReviewEventStore } from "./postgres-review-event-store.js";

describe("PostgreSQL StoryboardCandidateRepository and ReviewEventStore Adapters Integration", () => {
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

  it("inserts candidates and lists them ordered by variant ordinal with no update/delete APIs", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene1 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      specRevision: 1
    });
    const scene2 = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 2,
      specRevision: 1
    });

    const candidateRepo = new PostgresStoryboardCandidateRepository(client);

    // Assert repository API surface has no update, delete, or save methods
    expect((candidateRepo as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((candidateRepo as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((candidateRepo as unknown as Record<string, unknown>).save).toBeUndefined();

    // Prepare candidate fixtures across different revisions and variants
    const candidate1: StoryboardCandidate = {
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000001" as CandidateId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 2,
      locator: "godzspeed-temp/candidates/scene-1/rev1_var2.webp",
      contentHash: "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      generationMetadata: { seed: 1002, steps: 8, sampler: "dpmpp_2m" },
      createdAt: "2026-08-16T10:00:00.000Z"
    };

    const candidate2: StoryboardCandidate = {
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000002" as CandidateId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "godzspeed-temp/candidates/scene-1/rev1_var1.webp",
      contentHash: "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2",
      generationMetadata: { seed: 1001, steps: 8, sampler: "dpmpp_2m" },
      createdAt: "2026-08-16T10:01:00.000Z"
    };

    const candidate3: StoryboardCandidate = {
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000003" as CandidateId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 3,
      locator: "godzspeed-temp/candidates/scene-1/rev1_var3.webp",
      contentHash: "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3",
      generationMetadata: { seed: 1003, steps: 8, sampler: "dpmpp_2m" },
      createdAt: "2026-08-16T10:02:00.000Z"
    };

    const candidate4Rev2: StoryboardCandidate = {
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000004" as CandidateId,
      sceneId: scene1.scene_id as SceneId,
      specRevision: 2,
      variantOrdinal: 1,
      locator: "godzspeed-temp/candidates/scene-1/rev2_var1.webp",
      contentHash: "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4",
      generationMetadata: { seed: 2001, steps: 8 },
      createdAt: "2026-08-16T11:00:00.000Z"
    };

    const candidate5Scene2: StoryboardCandidate = {
      id: "01950c46-9e90-7d3d-82d2-8f1d3c000005" as CandidateId,
      sceneId: scene2.scene_id as SceneId,
      specRevision: 1,
      variantOrdinal: 1,
      locator: "godzspeed-temp/candidates/scene-2/rev1_var1.webp",
      contentHash: "e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5",
      generationMetadata: { seed: 3001 },
      createdAt: "2026-08-16T12:00:00.000Z"
    };

    // Insert out of variant order: var2, var1, var3
    await candidateRepo.insert(candidate1);
    await candidateRepo.insert(candidate2);
    await candidateRepo.insert(candidate3);
    await candidateRepo.insert(candidate4Rev2);
    await candidateRepo.insert(candidate5Scene2);

    // Verify findById reconstitutes exact candidate
    const fetchedCandidate1 = await candidateRepo.findById(candidate1.id);
    expect(fetchedCandidate1).toBeDefined();
    expect(fetchedCandidate1).toEqual(candidate1);

    const fetchedCandidate2 = await candidateRepo.findById(candidate2.id);
    expect(fetchedCandidate2).toBeDefined();
    expect(fetchedCandidate2).toEqual(candidate2);

    // Verify findById for absent candidate returns undefined
    const absent = await candidateRepo.findById(
      "01950c46-9e90-7d3d-82d2-8f1d3c999999" as CandidateId
    );
    expect(absent).toBeUndefined();

    // Verify listBySceneAndRevision returns candidates ordered deterministically by variantOrdinal ASC
    const scene1Rev1Candidates = await candidateRepo.listBySceneAndRevision(
      scene1.scene_id as SceneId,
      1
    );
    expect(scene1Rev1Candidates).toHaveLength(3);
    expect(scene1Rev1Candidates[0]).toEqual(candidate2); // variant 1
    expect(scene1Rev1Candidates[1]).toEqual(candidate1); // variant 2
    expect(scene1Rev1Candidates[2]).toEqual(candidate3); // variant 3

    // Verify filtering by different revision
    const scene1Rev2Candidates = await candidateRepo.listBySceneAndRevision(
      scene1.scene_id as SceneId,
      2
    );
    expect(scene1Rev2Candidates).toHaveLength(1);
    expect(scene1Rev2Candidates[0]).toEqual(candidate4Rev2);

    // Verify filtering by different scene
    const scene2Rev1Candidates = await candidateRepo.listBySceneAndRevision(
      scene2.scene_id as SceneId,
      1
    );
    expect(scene2Rev1Candidates).toHaveLength(1);
    expect(scene2Rev1Candidates[0]).toEqual(candidate5Scene2);

    // Verify empty list for scene with no matching revision
    const scene1Rev99 = await candidateRepo.listBySceneAndRevision(scene1.scene_id as SceneId, 99);
    expect(scene1Rev99).toEqual([]);

    // Verify database-level immutability trigger prevents UPDATE or DELETE
    await expect(
      client.query(
        "UPDATE storyboard_candidates SET content_hash_sha256 = 'mutated' WHERE candidate_id = $1",
        [candidate1.id]
      )
    ).rejects.toThrow(/append-only\/immutable/);

    await expect(
      client.query("DELETE FROM storyboard_candidates WHERE candidate_id = $1", [candidate1.id])
    ).rejects.toThrow(/append-only\/immutable/);
  });

  it("appends review events with request hash and revision metadata and supports lookup by eventId", async () => {
    const clientRecord = await insertClientRecord(client);
    const campaign = await insertCampaignRecord(client, { clientId: clientRecord.client_id });
    const scene = await insertStoryboardSceneRecord(client, {
      campaignId: campaign.campaign_id,
      sceneOrder: 1,
      status: "director_review"
    });

    const eventStore = new PostgresReviewEventStore(client);

    // Assert event store API surface has no update, delete, or save methods
    expect((eventStore as unknown as Record<string, unknown>).update).toBeUndefined();
    expect((eventStore as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((eventStore as unknown as Record<string, unknown>).save).toBeUndefined();

    const requestHash = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";

    const eventWithMetadata: ReviewEvent = {
      eventId: "01950c46-9e90-7d3d-82d2-8f1d3e000001",
      sceneId: scene.scene_id,
      reviewerName: "Thomas Cumberbatch",
      action: "candidate_select",
      directorNotes: "Selected vibrant variant for hero cut",
      mutationPayload: {
        selectedCandidateId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
        selectedCandidateRevision: 1
      },
      priorSceneStatus: "director_review",
      resultingSceneStatus: "approved",
      expectedSpecRevision: 1,
      resultingSpecRevision: 1,
      requestHashSha256: requestHash,
      occurredAt: "2026-08-16T14:30:00.000Z"
    };

    // Append review event
    await eventStore.append(eventWithMetadata);

    // Retrieve by eventId
    const foundEvent = await eventStore.findById(eventWithMetadata.eventId);
    expect(foundEvent).toBeDefined();
    expect(foundEvent).toEqual(eventWithMetadata);

    // Verify lookup of non-existent eventId returns undefined
    const notFound = await eventStore.findById("01950c46-9e90-7d3d-82d2-8f1d3e999999");
    expect(notFound).toBeUndefined();

    // Verify round-trip of event with optional fields omitted
    const minimalEvent: ReviewEvent = {
      eventId: "01950c46-9e90-7d3d-82d2-8f1d3e000002",
      sceneId: scene.scene_id,
      reviewerName: "Director Alice",
      action: "approve",
      mutationPayload: {},
      priorSceneStatus: "director_review",
      resultingSceneStatus: "approved",
      occurredAt: "2026-08-16T15:00:00.000Z"
    };

    await eventStore.append(minimalEvent);
    const foundMinimal = await eventStore.findById(minimalEvent.eventId);
    expect(foundMinimal).toBeDefined();
    expect(foundMinimal).toEqual(minimalEvent);
    expect(foundMinimal?.directorNotes).toBeUndefined();
    expect(foundMinimal?.expectedSpecRevision).toBeUndefined();
    expect(foundMinimal?.resultingSpecRevision).toBeUndefined();
    expect(foundMinimal?.requestHashSha256).toBeUndefined();

    // Verify primary key uniqueness: appending duplicate eventId throws
    const duplicateIdEvent: ReviewEvent = {
      ...eventWithMetadata,
      reviewerName: "Director Bob"
    };
    await expect(eventStore.append(duplicateIdEvent)).rejects.toThrow();

    // Verify re-selection: appending duplicate (sceneId, action, requestHashSha256) with distinct eventId succeeds
    const duplicateContentEvent: ReviewEvent = {
      ...eventWithMetadata,
      eventId: "01950c46-9e90-7d3d-82d2-8f1d3e000003"
    };
    await eventStore.append(duplicateContentEvent);
    const foundDup = await eventStore.findById(duplicateContentEvent.eventId);
    expect(foundDup).toBeDefined();
    expect(foundDup?.eventId).toBe(duplicateContentEvent.eventId);

    // Verify database-level append-only trigger prevents UPDATE or DELETE
    await expect(
      client.query("UPDATE review_events SET reviewer_name = 'Mutated' WHERE event_id = $1", [
        eventWithMetadata.eventId
      ])
    ).rejects.toThrow(/append-only\/immutable/);

    await expect(
      client.query("DELETE FROM review_events WHERE event_id = $1", [eventWithMetadata.eventId])
    ).rejects.toThrow(/append-only\/immutable/);
  });
});
