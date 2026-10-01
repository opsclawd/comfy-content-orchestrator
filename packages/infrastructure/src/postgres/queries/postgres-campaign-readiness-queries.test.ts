import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { PostgresCampaignReadinessQueries } from "./postgres-campaign-readiness-queries.js";

describe("PostgresCampaignReadinessQueries Unit Tests", () => {
  const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("returns undefined when campaign is not found or is archived", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Pool;

    const queries = new PostgresCampaignReadinessQueries(mockPool);
    const result = await queries.getCampaignPreProductionReadiness(campaignId);
    expect(result).toBeUndefined();
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it("issues only SELECT statements", async () => {
    const queriesSeen: string[] = [];
    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        queriesSeen.push(sql);
        if (sql.includes("FROM campaigns")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresCampaignReadinessQueries(mockPool);
    await queries.getCampaignPreProductionReadiness(campaignId);

    expect(queriesSeen.length).toBeGreaterThan(0);
    for (const sql of queriesSeen) {
      expect(sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
    }
  });

  it("maps rows into a fully prepared, planning_ready scene projection", async () => {
    const sceneId = "22222222-2222-4222-8222-222222222221";
    const planId = "33333333-3333-4333-8333-333333333331";
    const candidateId = "44444444-4444-4444-8444-444444444444";

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM campaigns")) {
          return Promise.resolve({
            rows: [
              {
                campaign_id: campaignId,
                title: "Test Campaign",
                updated_at: new Date("2026-09-27T12:00:00.000Z")
              }
            ]
          });
        }
        if (sql.includes("production_routing_mode")) {
          return Promise.resolve({
            rows: [
              {
                scene_id: sceneId,
                scene_order: 1,
                spec_revision: 1,
                production_routing_mode: "reference_directed",
                selected_shot_plan_id: planId,
                selected_shot_plan_revision: 1,
                approved_shot_plan_id: planId,
                approved_shot_plan_revision: 1,
                selected_candidate_id: null,
                selected_candidate_revision: null,
                updated_at: new Date("2026-09-27T11:00:00.000Z")
              }
            ]
          });
        }
        if (sql.includes("shot_plans sp")) {
          return Promise.resolve({
            rows: [
              {
                scene_id: sceneId,
                current_revision_count: 2,
                superseded_count: 0,
                last_planned_spec_revision: 1,
                selected_shot_plan_spec_revision: 1,
                selected_shot_plan_status: "approved",
                selected_shot_plan_previs_candidate_id: candidateId,
                previs_available: true
              }
            ]
          });
        }
        if (sql.includes("scene_reference_assets")) {
          return Promise.resolve({
            rows: [
              {
                scene_id: sceneId,
                binding_count: 2,
                roles: ["style", "subject_identity"],
                has_archived: false,
                has_cross_client: false
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const queries = new PostgresCampaignReadinessQueries(mockPool);
    const model = await queries.getCampaignPreProductionReadiness(campaignId);

    expect(model).toBeDefined();
    expect(model!.campaignId).toBe(campaignId);
    expect(model!.scenes).toHaveLength(1);
    const scene = model!.scenes[0]!;
    expect(scene.status).toBe("planning_ready");
    expect(scene.referenceBindings.count).toBe(2);
    expect(scene.shotPlans.hasApprovedCurrentRevision).toBe(true);
    expect(scene.previs.available).toBe(true);
    expect(scene.previs.candidateId).toBe(candidateId);
  });
});
