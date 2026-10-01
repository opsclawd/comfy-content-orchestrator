import { describe, expect, it } from "vitest";
import {
  compileCampaignAnimaticReadModel,
  type RawAnimaticSceneInput
} from "./campaign-animatic.js";
import {
  compileCampaignPreProductionReadiness,
  type RawReadinessSceneInput
} from "./campaign-readiness.js";

const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignName = "Consistency Test Commercial";
const campaignUpdatedAt = "2026-09-27T12:00:00.000Z";

describe("campaign animatic / readiness gap classification consistency", () => {
  it("agrees on which scenes are gaps and why, across both compilers", () => {
    const animaticScenes: RawAnimaticSceneInput[] = [
      {
        sceneId: "22222222-2222-4222-8222-222222222201",
        sceneOrder: 1,
        specRevision: 1,
        durationSeconds: 4,
        selectedShotPlanId: null,
        selectedShotPlanRevision: null,
        approvedShotPlanId: null
      },
      {
        sceneId: "22222222-2222-4222-8222-222222222202",
        sceneOrder: 2,
        specRevision: 2,
        durationSeconds: 4,
        selectedShotPlanId: "33333333-3333-4333-8333-333333333301",
        selectedShotPlanRevision: 1,
        approvedShotPlanId: null
      },
      {
        sceneId: "22222222-2222-4222-8222-222222222203",
        sceneOrder: 3,
        specRevision: 1,
        durationSeconds: 4,
        selectedShotPlanId: "33333333-3333-4333-8333-333333333302",
        selectedShotPlanRevision: 1,
        approvedShotPlanId: "33333333-3333-4333-8333-333333333302",
        selectedShotPlan: {
          specRevision: 1
        } as never
      }
    ];

    const animaticModel = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: animaticScenes,
      compiledAt: campaignUpdatedAt
    });

    const readinessScenes: RawReadinessSceneInput[] = animaticScenes.map((s) => ({
      sceneId: s.sceneId,
      sceneOrder: s.sceneOrder,
      specRevision: s.specRevision,
      sceneUpdatedAt: campaignUpdatedAt,
      routingMode: "reference_directed",
      selectedShotPlanId: s.selectedShotPlanId,
      selectedShotPlanRevision: s.selectedShotPlanRevision,
      approvedShotPlanId: s.approvedShotPlanId,
      approvedShotPlanRevision: s.approvedShotPlanId ? s.specRevision : null,
      selectedCandidateId: null,
      selectedCandidateRevision: null,
      selectedShotPlanSpecRevision: s.selectedShotPlan ? s.specRevision : null,
      selectedShotPlanStatus: null,
      selectedShotPlanPrevisCandidateId: null,
      currentRevisionShotPlanCount: s.selectedShotPlanId ? 1 : 0,
      supersededShotPlanCount: 0,
      lastPlannedSpecRevision: s.selectedShotPlanId ? s.specRevision : null,
      currentRevisionBindingCount: 1,
      currentRevisionBindingRoles: ["style"],
      hasArchivedBinding: false,
      hasCrossClientBinding: false,
      currentRevisionPrevisAvailable: true,
      currentRevisionPrevisCandidateId: null
    }));

    const readinessModel = compileCampaignPreProductionReadiness({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: readinessScenes,
      computedAt: campaignUpdatedAt
    });

    const animaticGapSceneIds = new Set(
      animaticModel.segments.filter((s) => !s.hasPlan).map((s) => s.sceneId)
    );
    const readinessGapSceneIds = new Set(
      readinessModel.scenes.filter((s) => !s.animatic.included).map((s) => s.sceneId)
    );

    expect(readinessGapSceneIds).toEqual(animaticGapSceneIds);

    for (const segment of animaticModel.segments) {
      if (!segment.hasPlan) {
        const projection = readinessModel.scenes.find((s) => s.sceneId === segment.sceneId)!;
        expect(projection.animatic.gapReason).toBe(segment.gapReason);
        expect(projection.animatic.gapMessage).toBe(segment.gapMessage);
      }
    }
  });
});
