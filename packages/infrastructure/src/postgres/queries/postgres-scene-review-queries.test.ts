import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { SceneId } from "@cco/domain";
import {
  deriveAllowedActions,
  PostgresSceneReviewQueries
} from "./postgres-scene-review-queries.js";

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
});
