import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { ShotPlan, type SceneId, type ShotPlanId } from "@cco/domain";
import { PostgresShotPlanRepository } from "./postgres-shot-plan-repository.js";

describe("PostgresShotPlanRepository (unit)", () => {
  const planId = "01928374-abcd-7000-8000-000000000001" as ShotPlanId;
  const sceneId = "01928374-abcd-7000-8000-000000000002" as SceneId;

  const validPlan = ShotPlan.create({
    id: planId,
    sceneId,
    specRevision: 1,
    variantOrdinal: 1,
    targetDurationMs: 4000,
    targetFrameCount: 96,
    framing: "wide",
    angle: "eye_level",
    lensIntent: "24mm prime",
    cameraPosition: "tripod",
    cameraMovement: "static",
    movementSpeed: "slow",
    cameraPromptDescription: "Two beats shot",
    actionSummary: "Action summary",
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2000,
        description: "Beat 1",
        cameraAction: "static",
        subjectAction: "stands"
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Beat 2",
        cameraAction: "static",
        subjectAction: "moves"
      }
    ],
    lightingStyle: "high_key_commercial",
    environmentDescription: "Studio set",
    previsAssociations: [
      {
        beatIndex: 1,
        candidateId: "01928374-abcd-7000-8000-000000000091",
        storageBucket: "previs-bucket",
        storageObjectKey: "scenes/scene1/previs1.png",
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        modelProfile: "test-profile",
        generatedAt: "2026-10-11T12:00:00.000Z"
      },
      {
        beatIndex: 2,
        candidateId: "01928374-abcd-7000-8000-000000000092",
        storageBucket: "previs-bucket",
        storageObjectKey: "scenes/scene1/previs2.png",
        contentHashSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856",
        modelProfile: "test-profile",
        generatedAt: "2026-10-11T12:01:00.000Z"
      }
    ]
  });

  it("save executes upserts on shot_plans and shot_plan_previs_associations inside a transaction", async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation((queryInput: unknown) => {
        if (typeof queryInput === "string") {
          executedQueries.push(queryInput);
        } else if (typeof queryInput === "object" && queryInput !== null && "text" in queryInput) {
          executedQueries.push(String((queryInput as { text: unknown }).text));
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as PoolClient;

    const repo = new PostgresShotPlanRepository(mockClient);
    await repo.save(validPlan);

    // Verify BEGIN and COMMIT were called
    expect(executedQueries).toContain("BEGIN");
    expect(executedQueries).toContain("COMMIT");

    // Verify shot_plans insert was executed
    const shotPlanInsert = executedQueries.find((q) => q.includes("INSERT INTO shot_plans"));
    expect(shotPlanInsert).toBeDefined();

    // Verify shot_plan_previs_associations inserts were executed
    const assocInserts = executedQueries.filter((q) =>
      q.includes("INSERT INTO shot_plan_previs_associations")
    );
    expect(assocInserts).toHaveLength(2);
  });

  it("findById loads shot_plans and joins shot_plan_previs_associations", async () => {
    const queryFn = vi.fn().mockImplementation((queryText: string) => {
      if (queryText.includes("FROM shot_plans")) {
        return Promise.resolve({
          rows: [
            {
              shot_plan_id: planId,
              scene_id: sceneId,
              spec_revision: 1,
              variant_ordinal: 1,
              status: "draft",
              routing_mode: "reference_directed",
              target_duration_ms: 4000,
              target_frame_count: 96,
              framing: "wide",
              camera_angle: "eye_level",
              camera_movement: "static",
              lighting_style: "high_key_commercial",
              previs_candidate_id: "01928374-abcd-7000-8000-000000000091",
              structured_plan: JSON.stringify(validPlan.snapshot()),
              created_at: new Date("2026-10-11T12:00:00Z"),
              updated_at: new Date("2026-10-11T12:00:00Z")
            }
          ]
        });
      }
      if (queryText.includes("FROM shot_plan_previs_associations")) {
        return Promise.resolve({
          rows: [
            {
              shot_plan_id: planId,
              beat_index: 1,
              candidate_id: "01928374-abcd-7000-8000-000000000091",
              storage_bucket: "previs-bucket",
              storage_object_key: "scenes/scene1/previs1.png",
              content_hash_sha256:
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              generation_payload: { modelProfile: "test-profile" },
              candidate_created_at: new Date("2026-10-11T12:00:00Z")
            },
            {
              shot_plan_id: planId,
              beat_index: 2,
              candidate_id: "01928374-abcd-7000-8000-000000000092",
              storage_bucket: "previs-bucket",
              storage_object_key: "scenes/scene1/previs2.png",
              content_hash_sha256:
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b856",
              generation_payload: { modelProfile: "test-profile" },
              candidate_created_at: new Date("2026-10-11T12:01:00Z")
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const mockClient = { query: queryFn } as unknown as PoolClient;
    const repo = new PostgresShotPlanRepository(mockClient);

    const found = await repo.findById(planId);
    expect(found).toBeDefined();
    expect(found?.previsAssociations).toHaveLength(2);
    expect(found?.previsAssociations[0]?.beatIndex).toBe(1);
    expect(found?.previsAssociations[1]?.beatIndex).toBe(2);

    // Compatibility accessor returns beat 1 candidate
    expect(found?.previs?.candidateId).toBe("01928374-abcd-7000-8000-000000000091");
    expect(found?.getPrevisForBeat(1)?.candidateId).toBe("01928374-abcd-7000-8000-000000000091");
    expect(found?.getPrevisForBeat(2)?.candidateId).toBe("01928374-abcd-7000-8000-000000000092");
  });

  it("save with externalTransaction and useSavepoint uses SAVEPOINT without BEGIN or COMMIT", async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation((queryInput: unknown) => {
        if (typeof queryInput === "string") {
          executedQueries.push(queryInput);
        } else if (typeof queryInput === "object" && queryInput !== null && "text" in queryInput) {
          executedQueries.push(String((queryInput as { text: unknown }).text));
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as PoolClient;

    const repo = new PostgresShotPlanRepository(mockClient, {
      externalTransaction: true,
      useSavepoint: true
    });
    await repo.save(validPlan);

    // Verify SAVEPOINT and RELEASE were called
    expect(executedQueries).toContain("SAVEPOINT save_shot_plan");
    expect(executedQueries).toContain("RELEASE SAVEPOINT save_shot_plan");

    // Verify BEGIN and COMMIT were NOT called (transaction owned externally by caller/UOW)
    expect(executedQueries).not.toContain("BEGIN");
    expect(executedQueries).not.toContain("COMMIT");
  });

  it("save with externalTransaction and useSavepoint rolls back to savepoint on failure and rethrows", async () => {
    const executedQueries: string[] = [];
    const mockClient = {
      query: vi.fn().mockImplementation((queryInput: unknown) => {
        const sql =
          typeof queryInput === "string"
            ? queryInput
            : typeof queryInput === "object" && queryInput !== null && "text" in queryInput
              ? String((queryInput as { text: unknown }).text)
              : "";
        executedQueries.push(sql);
        if (sql.includes("INSERT INTO shot_plans")) {
          return Promise.reject(new Error("Database connection lost"));
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as PoolClient;

    const repo = new PostgresShotPlanRepository(mockClient, {
      externalTransaction: true,
      useSavepoint: true
    });

    await expect(repo.save(validPlan)).rejects.toThrow("Database connection lost");
    expect(executedQueries).toContain("SAVEPOINT save_shot_plan");
    expect(executedQueries).toContain("ROLLBACK TO SAVEPOINT save_shot_plan");
    expect(executedQueries).not.toContain("COMMIT");
  });

  it("save deletes absent associations when plan is updated with fewer associations", async () => {
    const executedCalls: Array<{ sql: string; values?: unknown[] | undefined }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation((queryInput: unknown, values?: unknown[]) => {
        const sql =
          typeof queryInput === "string"
            ? queryInput
            : typeof queryInput === "object" && queryInput !== null && "text" in queryInput
              ? String((queryInput as { text: unknown }).text)
              : "";
        executedCalls.push({ sql, values });
        return Promise.resolve({ rows: [] });
      })
    } as unknown as PoolClient;

    const repo = new PostgresShotPlanRepository(mockClient);

    // Plan with only beat 1
    const beat1OnlyPlan = ShotPlan.reconstitute({
      ...validPlan.snapshot(),
      previsAssociations: [validPlan.snapshot().previsAssociations![0]!]
    });

    await repo.save(beat1OnlyPlan);

    // Verify deletion of absent beat indices
    const deleteCall = executedCalls.find((c) =>
      c.sql.includes("DELETE FROM shot_plan_previs_associations WHERE shot_plan_id = $1 AND NOT")
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.values).toEqual([planId, [1]]);

    // Verify only beat 1 is upserted
    const insertAssocs = executedCalls.filter((c) =>
      c.sql.includes("INSERT INTO shot_plan_previs_associations")
    );
    expect(insertAssocs).toHaveLength(1);
    expect(insertAssocs[0]?.values?.[1]).toBe(1);
  });

  it("save deletes all associations when plan has no associations", async () => {
    const executedCalls: Array<{ sql: string; values?: unknown[] | undefined }> = [];
    const mockClient = {
      query: vi.fn().mockImplementation((queryInput: unknown, values?: unknown[]) => {
        const sql =
          typeof queryInput === "string"
            ? queryInput
            : typeof queryInput === "object" && queryInput !== null && "text" in queryInput
              ? String((queryInput as { text: unknown }).text)
              : "";
        executedCalls.push({ sql, values });
        return Promise.resolve({ rows: [] });
      })
    } as unknown as PoolClient;

    const repo = new PostgresShotPlanRepository(mockClient);

    const emptyAssocPlan = ShotPlan.reconstitute({
      ...validPlan.snapshot(),
      previsAssociations: []
    });

    await repo.save(emptyAssocPlan);

    // Verify shot_plans insert cleared scalar candidate and structured previs
    const shotPlanInsert = executedCalls.find((c) => c.sql.includes("INSERT INTO shot_plans"));
    expect(shotPlanInsert).toBeDefined();
    expect(shotPlanInsert?.values?.[12]).toBeNull();
    const structuredPlanJson = JSON.parse(shotPlanInsert?.values?.[13] as string);
    expect(structuredPlanJson.previs).toBeNull();
    expect(structuredPlanJson.previsAssociations).toEqual([]);

    const deleteCall = executedCalls.find(
      (c) =>
        c.sql.includes("DELETE FROM shot_plan_previs_associations WHERE shot_plan_id = $1") &&
        !c.sql.includes("AND NOT")
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall?.values).toEqual([planId]);

    const insertAssocs = executedCalls.filter((c) =>
      c.sql.includes("INSERT INTO shot_plan_previs_associations")
    );
    expect(insertAssocs).toHaveLength(0);
  });

  it("findById returns empty previsAssociations and null previs when no associations exist", async () => {
    const queryFn = vi.fn().mockImplementation((queryText: string) => {
      if (queryText.includes("FROM shot_plans")) {
        return Promise.resolve({
          rows: [
            {
              shot_plan_id: planId,
              scene_id: sceneId,
              spec_revision: 1,
              variant_ordinal: 1,
              status: "draft",
              routing_mode: "reference_directed",
              target_duration_ms: 4000,
              target_frame_count: 96,
              framing: "wide",
              camera_angle: "eye_level",
              camera_movement: "static",
              lighting_style: "high_key_commercial",
              previs_candidate_id: null,
              structured_plan: JSON.stringify({
                ...validPlan.snapshot(),
                previs: null,
                previsAssociations: []
              }),
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
          ]
        });
      }
      if (queryText.includes("FROM shot_plan_previs_associations")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const mockClient = { query: queryFn } as unknown as PoolClient;
    const repo = new PostgresShotPlanRepository(mockClient);
    const found = await repo.findById(planId);

    expect(found).toBeDefined();
    expect(found?.previsAssociations).toHaveLength(0);
    expect(found?.previs).toBeNull();
  });
});
