import { describe, expect, it, vi } from "vitest";
import type { ReviewMediaDeliveryPort } from "@cco/application";
import type { Pool } from "pg";
import { PostgresCampaignAnimaticQueries } from "./postgres-campaign-animatic-queries.js";

describe("PostgresCampaignAnimaticQueries Unit Tests", () => {
  const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("returns undefined when campaign is not found or is archived", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] })
    } as unknown as Pool;

    const queries = new PostgresCampaignAnimaticQueries(mockPool);
    const result = await queries.getCampaignAnimatic(campaignId);
    expect(result).toBeUndefined();
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it("queries campaign, scenes, and shot plans, resolving valid segments and gaps", async () => {
    const plan1Id = "11111111-1111-4111-8111-111111111111";
    const scene1Id = "22222222-2222-4222-8222-222222222221";
    const scene2Id = "22222222-2222-4222-8222-222222222222";

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (sql.includes("FROM campaigns")) {
          return Promise.resolve({
            rows: [
              {
                campaign_id: campaignId,
                title: "Test Campaign",
                status: "planning",
                updated_at: new Date("2026-09-27T12:00:00.000Z")
              }
            ]
          });
        }
        if (sql.includes("FROM storyboard_scenes")) {
          return Promise.resolve({
            rows: [
              {
                scene_id: scene1Id,
                scene_order: 1,
                spec_revision: 1,
                duration_seconds: 4,
                visual_description: "Scene 1 description",
                status: "director_review",
                selected_shot_plan_id: plan1Id,
                selected_shot_plan_revision: 1,
                approved_shot_plan_id: null
              },
              {
                scene_id: scene2Id,
                scene_order: 2,
                spec_revision: 1,
                duration_seconds: 3.5,
                visual_description: "Scene 2 description",
                status: "director_review",
                selected_shot_plan_id: null, // gap!
                selected_shot_plan_revision: null,
                approved_shot_plan_id: null
              }
            ]
          });
        }
        if (sql.includes("FROM shot_plans sp")) {
          return Promise.resolve({
            rows: [
              {
                shot_plan_id: plan1Id,
                scene_id: scene1Id,
                spec_revision: 1,
                variant_ordinal: 1,
                status: "draft",
                routing_mode: "reference_directed",
                target_duration_ms: 4000,
                target_frame_count: 96,
                framing: "wide",
                camera_angle: "eye_level",
                camera_movement: "pan_left",
                lighting_style: "neon_night",
                previs_candidate_id: "cand-1",
                structured_plan: {
                  movementSpeed: "medium",
                  actionSummary: "Character walks left",
                  beats: [],
                  subjects: []
                },
                created_at: new Date("2026-09-27T12:00:00.000Z"),
                updated_at: new Date("2026-09-27T12:00:00.000Z"),
                storage_bucket: "previs-bucket",
                storage_object_key: "previs/p1.png",
                content_hash_sha256: "hash123"
              }
            ]
          });
        }
        return Promise.resolve({ rows: [] });
      })
    } as unknown as Pool;

    const mockMediaDelivery: ReviewMediaDeliveryPort = {
      generatePresignedReadUrl: vi
        .fn()
        .mockResolvedValue("https://storage.example.com/previs/p1.png")
    };

    const queries = new PostgresCampaignAnimaticQueries(mockPool, mockMediaDelivery);
    const animatic = await queries.getCampaignAnimatic(campaignId);

    expect(animatic).toBeDefined();
    expect(animatic?.campaignId).toBe(campaignId);
    expect(animatic?.campaignName).toBe("Test Campaign");
    expect(animatic?.totalScenes).toBe(2);
    expect(animatic?.gapCount).toBe(1);
    expect(animatic?.draftShotCount).toBe(1);
    expect(animatic?.approvedShotCount).toBe(0);

    // Segment 1 has plan with signed previs url
    const seg1 = animatic!.segments[0]!;
    expect(seg1.hasPlan).toBe(true);
    if (seg1.hasPlan) {
      expect(seg1.shotPlanId).toBe(plan1Id);
      expect(seg1.previsMedia.url).toBe("https://storage.example.com/previs/p1.png");
      expect(seg1.previsMedia.available).toBe(true);
      expect(seg1.startMs).toBe(0);
      expect(seg1.endMs).toBe(4000);
    }

    // Segment 2 is an explicit gap preserving scene duration (3500ms)
    const seg2 = animatic!.segments[1]!;
    expect(seg2.hasPlan).toBe(false);
    if (!seg2.hasPlan) {
      expect(seg2.gapReason).toBe("NO_SELECTION");
      expect(seg2.startMs).toBe(4000);
      expect(seg2.endMs).toBe(7500);
      expect(seg2.targetDurationMs).toBe(3500);
    }

    expect(animatic?.totalDurationMs).toBe(7500);
    expect(animatic?.includedShotPlanDurationMs).toBe(4000);
  });
});
