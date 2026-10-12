import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { SceneId } from "@cco/domain";
import {
  deriveAllowedActions,
  parsePositiveInteger,
  PostgresSceneReviewQueries
} from "./postgres-scene-review-queries.js";

describe("parsePositiveInteger Unit Tests", () => {
  it("accepts positive integer numbers", () => {
    expect(parsePositiveInteger(1)).toBe(1);
    expect(parsePositiveInteger(42)).toBe(42);
    expect(parsePositiveInteger(1000)).toBe(1000);
  });

  it("accepts valid positive integer decimal strings", () => {
    expect(parsePositiveInteger("1")).toBe(1);
    expect(parsePositiveInteger("42")).toBe(42);
  });

  it("rejects non-positive, non-integer, or non-finite numbers", () => {
    expect(parsePositiveInteger(0)).toBeNull();
    expect(parsePositiveInteger(-1)).toBeNull();
    expect(parsePositiveInteger(1.5)).toBeNull();
    expect(parsePositiveInteger(NaN)).toBeNull();
    expect(parsePositiveInteger(Infinity)).toBeNull();
    expect(parsePositiveInteger(-Infinity)).toBeNull();
  });

  it("rejects malformed numeric strings", () => {
    expect(parsePositiveInteger("0")).toBeNull();
    expect(parsePositiveInteger("-1")).toBeNull();
    expect(parsePositiveInteger("01")).toBeNull();
    expect(parsePositiveInteger("1.0")).toBeNull();
    expect(parsePositiveInteger(" 1 ")).toBeNull();
    expect(parsePositiveInteger("1e2")).toBeNull();
    expect(parsePositiveInteger("abc")).toBeNull();
    expect(parsePositiveInteger("")).toBeNull();
  });

  it("rejects booleans, arrays, objects, and other non-number/non-string types without throwing", () => {
    expect(parsePositiveInteger(true)).toBeNull();
    expect(parsePositiveInteger(false)).toBeNull();
    expect(parsePositiveInteger([1])).toBeNull();
    expect(parsePositiveInteger([])).toBeNull();
    expect(parsePositiveInteger({})).toBeNull();
    expect(parsePositiveInteger({ valueOf: 0, toString: 0 })).toBeNull();
    expect(parsePositiveInteger(null)).toBeNull();
    expect(parsePositiveInteger(undefined)).toBeNull();
    expect(parsePositiveInteger(Symbol("1"))).toBeNull();
  });
});

describe("deriveAllowedActions Unit Tests", () => {
  it("failed status with isProductionRecoverable=true offers production_rerender and cancel", () => {
    // Calling with boolean parameter
    const actionsBool = deriveAllowedActions("failed", false, true);
    expect(actionsBool).toEqual(["production_rerender", "cancel"]);
    expect(actionsBool).toContain("production_rerender");
    expect(actionsBool).toContain("cancel");

    // Calling with options object
    const actionsOpt = deriveAllowedActions("failed", { isProductionRecoverable: true });
    expect(actionsOpt).toEqual(["production_rerender", "cancel"]);

    // With hasShotPlans true and isProductionRecoverable true
    const actionsBoth = deriveAllowedActions("failed", true, true);
    expect(actionsBoth).toEqual(["production_rerender", "cancel"]);
  });

  it("failed status with isProductionRecoverable=false offers only cancel", () => {
    // Calling with boolean parameter false
    const actionsBool = deriveAllowedActions("failed", false, false);
    expect(actionsBool).toEqual(["cancel"]);

    // Calling with default (omitted isProductionRecoverable)
    const actionsDefault = deriveAllowedActions("failed", false);
    expect(actionsDefault).toEqual(["cancel"]);

    // Calling with options object false
    const actionsOpt = deriveAllowedActions("failed", { isProductionRecoverable: false });
    expect(actionsOpt).toEqual(["cancel"]);

    // Calling with hasShotPlans true but isProductionRecoverable false
    const actionsBoth = deriveAllowedActions("failed", true, false);
    expect(actionsBoth).toEqual(["cancel"]);
  });

  it("terminal states completed and cancelled offer no actions", () => {
    expect(deriveAllowedActions("completed", false)).toEqual([]);
    expect(deriveAllowedActions("completed", true, true)).toEqual([]);
    expect(deriveAllowedActions("cancelled", false)).toEqual([]);
    expect(deriveAllowedActions("cancelled", true, true)).toEqual([]);
  });

  it("qa status offers production_accept, production_rerender, and reject", () => {
    const actions = deriveAllowedActions("qa", false);
    expect(actions).toEqual(["production_accept", "production_rerender", "reject"]);
  });

  it("queued and rendering offer only cancel", () => {
    expect(deriveAllowedActions("queued", false)).toEqual(["cancel"]);
    expect(deriveAllowedActions("rendering", false)).toEqual(["cancel"]);
  });

  it("director_review adapts to presence of shot plans", () => {
    const withPlans = deriveAllowedActions("director_review", true);
    expect(withPlans).toContain("reroll_shotplan");
    expect(withPlans).not.toContain("reroll");

    const withoutPlans = deriveAllowedActions("director_review", false);
    expect(withoutPlans).toContain("reroll");
  });
});

describe("PostgresSceneReviewQueries Unit Tests", () => {
  const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000001" as SceneId;

  it("returns undefined when scene is not found", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Pool;

    const queries = new PostgresSceneReviewQueries(mockPool);
    const result = await queries.getSceneReviewDetail(sceneId);
    expect(result).toBeUndefined();
  });

  it("derives production_rerender for failed scene when recoverable from production run", async () => {
    const mockSceneRow = {
      scene_id: sceneId,
      campaign_id: "01950c46-9e90-7d3d-82d2-8f1d3c000010",
      client_id: "01950c46-9e90-7d3d-82d2-8f1d3c000020",
      duration_seconds: 5.0,
      visual_description: "A failed production scene",
      engine_assigned: "minimax_h3",
      status: "failed",
      spec_revision: 1,
      selected_candidate_id: null,
      selected_candidate_revision: null,
      selected_shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
      selected_shot_plan_revision: 1,
      approved_shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
      lora_configuration_id: null,
      approved_by: "Supervisor Sam",
      approved_at: new Date("2026-09-01T12:00:00.000Z"),
      approved_revision: 1,
      failure_reason: "Render timeout on node 4",
      failed_from: "rendering",
      active_production_job_id: "01950c46-9e90-7d3d-82d2-8f1d3c000040",
      has_production_run: true,
      reference_asset_ids: []
    };

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM storyboard_scenes")) {
          return Promise.resolve({ rows: [mockSceneRow] });
        }
        if (sql.includes("FROM storyboard_candidates")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("FROM shot_plans")) {
          return Promise.resolve({
            rows: [
              {
                shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
                scene_id: sceneId,
                spec_revision: 1,
                variant_ordinal: 1,
                status: "approved",
                routing_mode: "reference_directed",
                target_duration_ms: 5000,
                target_frame_count: 124,
                framing: "medium",
                camera_angle: "eye_level",
                camera_movement: "static",
                lighting_style: "natural",
                previs_candidate_id: null,
                structured_plan: {},
                created_at: new Date(),
                updated_at: new Date()
              }
            ]
          });
        }
        if (sql.includes("FROM scene_reference_assets")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresSceneReviewQueries(mockPool);
    const detail = await queries.getSceneReviewDetail(sceneId);

    expect(detail).toBeDefined();
    expect(detail?.status).toBe("failed");
    expect(detail?.allowedActions).toEqual(["production_rerender", "cancel"]);
  });

  it("derives cancel-only for failed scene when approved ShotPlan is missing", async () => {
    const mockSceneRow = {
      scene_id: sceneId,
      campaign_id: "01950c46-9e90-7d3d-82d2-8f1d3c000010",
      client_id: "01950c46-9e90-7d3d-82d2-8f1d3c000020",
      duration_seconds: 5.0,
      visual_description: "A failed production scene without approved shot plan",
      engine_assigned: "minimax_h3",
      status: "failed",
      spec_revision: 1,
      selected_candidate_id: null,
      selected_candidate_revision: null,
      selected_shot_plan_id: null,
      selected_shot_plan_revision: null,
      approved_shot_plan_id: null,
      approved_shot_plan_revision: null,
      lora_configuration_id: null,
      approved_by: "Supervisor Sam",
      approved_at: new Date("2026-09-01T12:00:00.000Z"),
      approved_revision: 1,
      failure_reason: "Render timeout on node 4",
      failed_from: "rendering",
      active_production_job_id: "01950c46-9e90-7d3d-82d2-8f1d3c000040",
      has_production_run: true,
      reference_asset_ids: []
    };

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM storyboard_scenes")) {
          return Promise.resolve({ rows: [mockSceneRow] });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresSceneReviewQueries(mockPool);
    const detail = await queries.getSceneReviewDetail(sceneId);

    expect(detail).toBeDefined();
    expect(detail?.status).toBe("failed");
    expect(detail?.allowedActions).toEqual(["cancel"]);
  });

  it("derives cancel-only for failed scene when ShotPlan is not approved (draft)", async () => {
    const mockSceneRow = {
      scene_id: sceneId,
      campaign_id: "01950c46-9e90-7d3d-82d2-8f1d3c000010",
      client_id: "01950c46-9e90-7d3d-82d2-8f1d3c000020",
      duration_seconds: 5.0,
      visual_description: "A failed production scene with draft shot plan",
      engine_assigned: "minimax_h3",
      status: "failed",
      spec_revision: 1,
      selected_candidate_id: null,
      selected_candidate_revision: null,
      selected_shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
      selected_shot_plan_revision: 1,
      approved_shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
      approved_shot_plan_revision: 1,
      lora_configuration_id: null,
      approved_by: "Supervisor Sam",
      approved_at: new Date("2026-09-01T12:00:00.000Z"),
      approved_revision: 1,
      failure_reason: "Render timeout on node 4",
      failed_from: "rendering",
      active_production_job_id: "01950c46-9e90-7d3d-82d2-8f1d3c000040",
      has_production_run: true,
      reference_asset_ids: []
    };

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM storyboard_scenes")) {
          return Promise.resolve({ rows: [mockSceneRow] });
        }
        if (sql.includes("FROM shot_plans")) {
          return Promise.resolve({
            rows: [
              {
                shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
                scene_id: sceneId,
                spec_revision: 1,
                variant_ordinal: 1,
                status: "draft", // not approved
                routing_mode: "reference_directed",
                target_duration_ms: 5000,
                target_frame_count: 124,
                framing: "medium",
                camera_angle: "eye_level",
                camera_movement: "static",
                lighting_style: "natural",
                previs_candidate_id: null,
                structured_plan: {},
                created_at: new Date(),
                updated_at: new Date()
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresSceneReviewQueries(mockPool);
    const detail = await queries.getSceneReviewDetail(sceneId);

    expect(detail).toBeDefined();
    expect(detail?.status).toBe("failed");
    expect(detail?.allowedActions).toEqual(["cancel"]);
  });

  it("derives cancel-only for failed scene when approved ShotPlan revision is stale", async () => {
    const mockSceneRow = {
      scene_id: sceneId,
      campaign_id: "01950c46-9e90-7d3d-82d2-8f1d3c000010",
      client_id: "01950c46-9e90-7d3d-82d2-8f1d3c000020",
      duration_seconds: 5.0,
      visual_description: "A failed production scene with stale shot plan",
      engine_assigned: "minimax_h3",
      status: "failed",
      spec_revision: 2, // Scene is at revision 2
      selected_candidate_id: null,
      selected_candidate_revision: null,
      selected_shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
      selected_shot_plan_revision: 1,
      approved_shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
      approved_shot_plan_revision: 1, // Stale pointer
      lora_configuration_id: null,
      approved_by: "Supervisor Sam",
      approved_at: new Date("2026-09-01T12:00:00.000Z"),
      approved_revision: 2,
      failure_reason: "Render timeout on node 4",
      failed_from: "rendering",
      active_production_job_id: "01950c46-9e90-7d3d-82d2-8f1d3c000040",
      has_production_run: true,
      reference_asset_ids: []
    };

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM storyboard_scenes")) {
          return Promise.resolve({ rows: [mockSceneRow] });
        }
        if (sql.includes("FROM shot_plans")) {
          return Promise.resolve({
            rows: [
              {
                shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
                scene_id: sceneId,
                spec_revision: 1, // Stale ShotPlan revision
                variant_ordinal: 1,
                status: "approved",
                routing_mode: "reference_directed",
                target_duration_ms: 5000,
                target_frame_count: 124,
                framing: "medium",
                camera_angle: "eye_level",
                camera_movement: "static",
                lighting_style: "natural",
                previs_candidate_id: null,
                structured_plan: {},
                created_at: new Date(),
                updated_at: new Date()
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresSceneReviewQueries(mockPool);
    const detail = await queries.getSceneReviewDetail(sceneId);

    expect(detail).toBeDefined();
    expect(detail?.status).toBe("failed");
    expect(detail?.allowedActions).toEqual(["cancel"]);
  });

  it("derives cancel-only for failed scene when not production-recoverable", async () => {
    const mockSceneRow = {
      scene_id: sceneId,
      campaign_id: "01950c46-9e90-7d3d-82d2-8f1d3c000010",
      duration_seconds: 5.0,
      visual_description: "Failed candidate generation",
      engine_assigned: "minimax_h3",
      status: "failed",
      spec_revision: 1,
      selected_candidate_id: null,
      selected_candidate_revision: null,
      selected_shot_plan_id: null,
      selected_shot_plan_revision: null,
      approved_shot_plan_id: null,
      lora_configuration_id: null,
      approved_by: null,
      approved_at: null,
      approved_revision: null,
      failure_reason: "Planning model rate limit",
      failed_from: "generating_candidates", // not recoverable
      active_production_job_id: null,
      has_production_run: false,
      reference_asset_ids: []
    };

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM storyboard_scenes")) {
          return Promise.resolve({ rows: [mockSceneRow] });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresSceneReviewQueries(mockPool);
    const detail = await queries.getSceneReviewDetail(sceneId);

    expect(detail).toBeDefined();
    expect(detail?.status).toBe("failed");
    expect(detail?.allowedActions).toEqual(["cancel"]);
  });

  describe("ShotPlan beatFrames projection", () => {
    const directorReviewSceneRow = {
      scene_id: sceneId,
      campaign_id: "01950c46-9e90-7d3d-82d2-8f1d3c000010",
      client_id: "01950c46-9e90-7d3d-82d2-8f1d3c000020",
      duration_seconds: 4.0,
      visual_description: "A three-beat scene",
      engine_assigned: "minimax_h3",
      status: "director_review",
      spec_revision: 1,
      selected_candidate_id: null,
      selected_candidate_revision: null,
      selected_shot_plan_id: null,
      selected_shot_plan_revision: null,
      approved_shot_plan_id: null,
      lora_configuration_id: null,
      approved_by: null,
      approved_at: null,
      approved_revision: null,
      reference_asset_ids: []
    };

    const threeBeatPlanRow = {
      shot_plan_id: "01950c46-9e90-7d3d-82d2-8f1d3c000030",
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
      lighting_style: "natural_golden_hour",
      previs_candidate_id: null,
      structured_plan: {
        beats: [
          { beatIndex: 3, startMs: 2500, endMs: 4000, description: "Beat 3 action" },
          { beatIndex: 1, startMs: 0, endMs: 1000, description: "Beat 1 action" },
          { beatIndex: 2, startMs: 1000, endMs: 2500, description: "Beat 2 action" }
        ]
      },
      created_at: new Date(),
      updated_at: new Date(),
      storage_bucket: null,
      storage_object_key: null,
      content_hash_sha256: null
    };

    it("projects 3-beat plan with one ready, one pending (rendering), and one failed job in numeric order", async () => {
      const candidateIdBeat1 = "01950c46-9e90-7d3d-82d2-8f1d3c000050";

      const associations = [
        {
          shot_plan_id: threeBeatPlanRow.shot_plan_id,
          beat_index: 1,
          candidate_id: candidateIdBeat1,
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: candidateIdBeat1,
          candidate_beat_index: 1,
          storage_bucket: "godzspeed-temp",
          storage_object_key: `candidates/${sceneId}/rev1_var1_beat1.webp`,
          content_hash_sha256: "a".repeat(64)
        }
      ];

      const jobs = [
        {
          job_id: "job-003",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 3
          },
          created_at: new Date("2026-09-01T10:02:00.000Z")
        },
        {
          job_id: "job-002",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "rendering",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 2
          },
          created_at: new Date("2026-09-01T10:01:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM shot_plan_previs_associations")) {
            return Promise.resolve({ rows: associations });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      expect(detail).toBeDefined();
      const plan = detail?.shotPlans?.[0];
      expect(plan).toBeDefined();
      expect(plan?.beatFrames).toHaveLength(3);

      // Order must be numeric beat 1, beat 2, beat 3 despite source array order (3, 1, 2)
      expect(plan?.beatFrames?.[0]).toEqual({
        beatIndex: 1,
        status: "ready",
        candidateId: candidateIdBeat1,
        media: { available: true }
      });

      expect(plan?.beatFrames?.[1]).toEqual({
        beatIndex: 2,
        status: "pending",
        media: { available: false }
      });

      expect(plan?.beatFrames?.[2]).toEqual({
        beatIndex: 3,
        status: "failed",
        media: { available: false }
      });

      // Actions must still permit select_shotplan and approve_shotplan
      expect(detail?.allowedActions).toContain("select_shotplan");
      expect(detail?.allowedActions).toContain("approve_shotplan");
    });

    it("projects 3 completed associations all ready in numeric order", async () => {
      const associations = [
        {
          shot_plan_id: threeBeatPlanRow.shot_plan_id,
          beat_index: 3,
          candidate_id: "01950c46-9e90-7d3d-82d2-8f1d3c000053",
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: "01950c46-9e90-7d3d-82d2-8f1d3c000053",
          candidate_beat_index: 3,
          storage_bucket: "bucket",
          storage_object_key: "key3.webp",
          content_hash_sha256: "c".repeat(64)
        },
        {
          shot_plan_id: threeBeatPlanRow.shot_plan_id,
          beat_index: 1,
          candidate_id: "01950c46-9e90-7d3d-82d2-8f1d3c000051",
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: "01950c46-9e90-7d3d-82d2-8f1d3c000051",
          candidate_beat_index: 1,
          storage_bucket: "bucket",
          storage_object_key: "key1.webp",
          content_hash_sha256: "a".repeat(64)
        },
        {
          shot_plan_id: threeBeatPlanRow.shot_plan_id,
          beat_index: 2,
          candidate_id: "01950c46-9e90-7d3d-82d2-8f1d3c000052",
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: "01950c46-9e90-7d3d-82d2-8f1d3c000052",
          candidate_beat_index: 2,
          storage_bucket: "bucket",
          storage_object_key: "key2.webp",
          content_hash_sha256: "b".repeat(64)
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM shot_plan_previs_associations")) {
            return Promise.resolve({ rows: associations });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const plan = detail?.shotPlans?.[0];
      expect(plan?.beatFrames).toHaveLength(3);
      expect(plan?.beatFrames?.map((f) => f.beatIndex)).toEqual([1, 2, 3]);
      expect(plan?.beatFrames?.map((f) => f.status)).toEqual(["ready", "ready", "ready"]);
      expect(plan?.beatFrames?.[0]?.candidateId).toBe("01950c46-9e90-7d3d-82d2-8f1d3c000051");
      expect(plan?.beatFrames?.[1]?.candidateId).toBe("01950c46-9e90-7d3d-82d2-8f1d3c000052");
      expect(plan?.beatFrames?.[2]?.candidateId).toBe("01950c46-9e90-7d3d-82d2-8f1d3c000053");
    });

    it("projects pending for beats lacking associations and jobs", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const plan = detail?.shotPlans?.[0];
      expect(plan?.beatFrames).toHaveLength(3);
      for (const frame of plan?.beatFrames ?? []) {
        expect(frame.status).toBe("pending");
        expect(frame.media.available).toBe(false);
      }
    });

    it("projects pending when a newer queued retry supersedes an older failure", async () => {
      const jobs = [
        {
          job_id: "job-retry-002",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "queued",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 1
          },
          created_at: new Date("2026-09-01T12:00:00.000Z")
        },
        {
          job_id: "job-failed-001",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 1
          },
          created_at: new Date("2026-09-01T11:00:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const beat1 = detail?.shotPlans?.[0]?.beatFrames?.find((f) => f.beatIndex === 1);
      expect(beat1?.status).toBe("pending");
    });

    it("projects unavailable when latest job is cancelled or completed without association", async () => {
      const jobs = [
        {
          job_id: "job-001",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "cancelled",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 1
          },
          created_at: new Date("2026-09-01T11:00:00.000Z")
        },
        {
          job_id: "job-002",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "completed", // completed but no association recorded
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 2
          },
          created_at: new Date("2026-09-01T11:00:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const beat1 = detail?.shotPlans?.[0]?.beatFrames?.find((f) => f.beatIndex === 1);
      expect(beat1?.status).toBe("unavailable");

      const beat2 = detail?.shotPlans?.[0]?.beatFrames?.find((f) => f.beatIndex === 2);
      expect(beat2?.status).toBe("unavailable");
    });

    it("isolates associations and jobs across plans, revisions, and scenes", async () => {
      const otherPlanId = "01950c46-9e90-7d3d-82d2-8f1d3c000099";

      const associations = [
        // Association for another plan
        {
          shot_plan_id: otherPlanId,
          beat_index: 1,
          candidate_id: "cand-other-plan",
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: "cand-other-plan",
          candidate_beat_index: 1,
          storage_bucket: "bucket",
          storage_object_key: "key.webp",
          content_hash_sha256: "a".repeat(64)
        },
        // Association for an undeclared beat (beat 99)
        {
          shot_plan_id: threeBeatPlanRow.shot_plan_id,
          beat_index: 99,
          candidate_id: "cand-undeclared",
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: "cand-undeclared",
          candidate_beat_index: 99,
          storage_bucket: "bucket",
          storage_object_key: "key.webp",
          content_hash_sha256: "a".repeat(64)
        },
        // Association where candidate_beat_index does not match beat_index
        {
          shot_plan_id: threeBeatPlanRow.shot_plan_id,
          beat_index: 1,
          candidate_id: "cand-mismatched-beat",
          scene_id: sceneId,
          spec_revision: 1,
          matched_candidate_id: "cand-mismatched-beat",
          candidate_beat_index: 2, // mismatch!
          storage_bucket: "bucket",
          storage_object_key: "key.webp",
          content_hash_sha256: "a".repeat(64)
        }
      ];

      const jobs = [
        // Job for revision 2 (plan is revision 1)
        {
          job_id: "job-rev2",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 2, // stale revision!
            beatIndex: 1
          },
          created_at: new Date("2026-09-01T12:00:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM shot_plan_previs_associations")) {
            return Promise.resolve({ rows: associations });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const plan = detail?.shotPlans?.[0];
      // Exactly 3 frames for the 3 declared beats; undeclared beat 99 is ignored
      expect(plan?.beatFrames).toHaveLength(3);
      expect(plan?.beatFrames?.map((f) => f.beatIndex)).toEqual([1, 2, 3]);

      // Beat 1 should be pending because the candidate beat index mismatched and the job belonged to rev 2
      expect(plan?.beatFrames?.[0]?.status).toBe("pending");
    });

    it("projects empty beatFrames when shot plan has no declared beats", async () => {
      const planWithoutBeats = {
        ...threeBeatPlanRow,
        structured_plan: {
          beats: []
        }
      };

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [planWithoutBeats] });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const plan = detail?.shotPlans?.[0];
      expect(plan?.beatFrames).toEqual([]);
    });

    it("ignores newer malformed jobs with boolean, array, and object identities so valid queued job retains pending status", async () => {
      const jobs = [
        // Newer malformed job 1: specRevision is boolean true, beatIndex is array [1]
        {
          job_id: "job-malformed-001",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: true,
            beatIndex: [1]
          },
          created_at: new Date("2026-09-01T12:00:00.000Z")
        },
        // Newer malformed job 2: specRevision & beatIndex are objects that throw on Number conversion
        {
          job_id: "job-malformed-002",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: { valueOf: 0, toString: 0 },
            beatIndex: { valueOf: 0, toString: 0 }
          },
          created_at: new Date("2026-09-01T11:59:00.000Z")
        },
        // Newer malformed job 3: injected_payload is an array
        {
          job_id: "job-malformed-003",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: [{ shotPlanId: threeBeatPlanRow.shot_plan_id }],
          created_at: new Date("2026-09-01T11:58:00.000Z")
        },
        // Newer malformed job 4: injected_payload is unparseable JSON string
        {
          job_id: "job-malformed-004",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: "INVALID_JSON{",
          created_at: new Date("2026-09-01T11:57:00.000Z")
        },
        // Newer malformed job 5: non-integer / negative indices
        {
          job_id: "job-malformed-005",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 0,
            beatIndex: -1
          },
          created_at: new Date("2026-09-01T11:56:00.000Z")
        },
        // Genuine older queued job for Beat 1
        {
          job_id: "job-genuine-queued",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "queued",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 1
          },
          created_at: new Date("2026-09-01T11:00:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      expect(detail).toBeDefined();
      const plan = detail?.shotPlans?.[0];
      const beat1 = plan?.beatFrames?.find((f) => f.beatIndex === 1);
      // Valid queued job status wins over newer malformed failed jobs
      expect(beat1?.status).toBe("pending");
    });

    it("ignores newer malformed jobs with boolean, array, and object identities so valid failed job retains failed status", async () => {
      const jobs = [
        // Newer malformed queued job trying to mask a real failure
        {
          job_id: "job-malformed-queued",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "queued",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: true,
            beatIndex: [1]
          },
          created_at: new Date("2026-09-01T12:00:00.000Z")
        },
        // Genuine older failed job
        {
          job_id: "job-genuine-failed",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: 1,
            beatIndex: 1
          },
          created_at: new Date("2026-09-01T11:00:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const beat1 = detail?.shotPlans?.[0]?.beatFrames?.find((f) => f.beatIndex === 1);
      // Genuine failed job wins
      expect(beat1?.status).toBe("failed");
    });

    it("supports valid historical decimal string representations of positive integers in job payloads", async () => {
      const jobs = [
        {
          job_id: "job-string-identity",
          scene_id: sceneId,
          job_kind: "candidate",
          status: "failed",
          injected_payload: {
            shotPlanId: threeBeatPlanRow.shot_plan_id,
            specRevision: "1",
            beatIndex: "1"
          },
          created_at: new Date("2026-09-01T11:00:00.000Z")
        }
      ];

      const mockPool = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes("FROM storyboard_scenes")) {
            return Promise.resolve({ rows: [directorReviewSceneRow] });
          }
          if (sql.includes("FROM shot_plans")) {
            return Promise.resolve({ rows: [threeBeatPlanRow] });
          }
          if (sql.includes("FROM render_jobs")) {
            return Promise.resolve({ rows: jobs });
          }
          return Promise.resolve({ rows: [] });
        })
      } as unknown as Pool;

      const queries = new PostgresSceneReviewQueries(mockPool);
      const detail = await queries.getSceneReviewDetail(sceneId);

      const beat1 = detail?.shotPlans?.[0]?.beatFrames?.find((f) => f.beatIndex === 1);
      expect(beat1?.status).toBe("failed");
    });
  });
});
