// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { CampaignPreProductionReadinessPanel } from "./campaign-pre-production-readiness-panel.js";
import type {
  CampaignPreProductionReadinessReadModel,
  CampaignReadinessSceneProjection
} from "@cco/contracts";
import { CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE } from "@cco/contracts";

afterEach(() => {
  cleanup();
});

function readyScene(
  overrides?: Partial<CampaignReadinessSceneProjection>
): CampaignReadinessSceneProjection {
  return {
    sceneId: "22222222-2222-4222-8222-222222222221",
    sceneOrder: 1,
    specRevision: 1,
    status: "planning_ready",
    routingMode: "reference_directed",
    referenceBindings: {
      count: 1,
      roles: ["style"],
      allCurrent: true,
      hasArchived: false,
      hasCrossClient: false,
      withinLimit: true
    },
    shotPlans: {
      currentRevisionCount: 1,
      supersededCount: 0,
      selectedShotPlanId: "33333333-3333-4333-8333-333333333331",
      selectedIsCurrentRevision: true,
      approvedShotPlanId: "33333333-3333-4333-8333-333333333331",
      hasApprovedCurrentRevision: true
    },
    previs: { available: true, candidateId: null },
    animatic: { included: true, gapReason: null, gapMessage: null },
    shotPlanAnimaticAvailable: true,
    staleness: {
      isStaleAfterRevisionChange: false,
      currentSpecRevision: 1,
      lastPlannedSpecRevision: 1,
      supersededShotPlanCount: 0
    },
    blockers: [],
    advisories: [],
    ...overrides
  };
}

function createReadiness(
  scenes: CampaignReadinessSceneProjection[]
): CampaignPreProductionReadinessReadModel {
  const planningReadyCount = scenes.filter((s) => s.status === "planning_ready").length;
  const needsAttentionCount = scenes.filter((s) => s.status === "needs_attention").length;
  const blockedForPlanningCount = scenes.filter((s) => s.status === "blocked_for_planning").length;
  return {
    campaignId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    campaignName: "Neo-Tokyo Launch",
    campaignStatus: "planning_ready",
    readinessStatus: "planning_ready",
    readSnapshotId: "cpr-abcdef1234567890abcdef1234567890",
    aggregates: {
      totalScenes: scenes.length,
      planningReadyCount,
      needsAttentionCount,
      blockedForPlanningCount,
      currentReferenceSceneCount: scenes.length,
      scenesWithCurrentShotPlansCount: scenes.length,
      scenesWithSelectionCount: scenes.length,
      approvedSceneCount: planningReadyCount,
      scenesWithPrevisCount: scenes.length,
      scenesInCampaignAnimaticCount: scenes.length,
      staleSceneCount: scenes.filter((s) => s.staleness.isStaleAfterRevisionChange).length
    },
    scenes,
    planningOnlyNotice: CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE,
    computedAt: "2026-09-27T12:00:00.000Z"
  };
}

describe("CampaignPreProductionReadinessPanel", () => {
  it("renders nothing when readiness is undefined", () => {
    const { container } = render(<CampaignPreProductionReadinessPanel readiness={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the empty state for a campaign with zero scenes", () => {
    render(<CampaignPreProductionReadinessPanel readiness={createReadiness([])} />);
    expect(screen.getByTestId("readiness-empty-state")).not.toBeNull();
  });

  it("renders the headline count and ready rollup", () => {
    const readiness = createReadiness([readyScene()]);
    render(<CampaignPreProductionReadinessPanel readiness={readiness} />);
    expect(screen.getByTestId("readiness-headline").textContent).toContain(
      "1 / 1 scenes planning-ready"
    );
    expect(screen.getByTestId("readiness-ready-rollup").textContent).toContain("Scenes 01");
  });

  it("renders needs-attention blockers with working drill-down links", () => {
    const scene = readyScene({
      status: "needs_attention",
      sceneOrder: 3,
      blockers: [
        {
          code: "NO_SHOT_PLAN_SELECTED",
          severity: "attention",
          message: "Scene 03 has no current-revision ShotPlan selected",
          remediationHint: "Select a ShotPlan",
          drillDown: { sceneId: "scene-03", sceneOrder: 3, section: "shot-plans" }
        }
      ]
    });
    render(<CampaignPreProductionReadinessPanel readiness={createReadiness([scene])} />);

    const row = screen.getByTestId("readiness-attention-row");
    expect(row).not.toBeNull();
    const link = screen.getByRole("link", { name: /no current-revision shotplan selected/i });
    expect(link.getAttribute("href")).toBe("/scenes/scene-03#shot-plans");
  });

  it("marks stale scenes distinctly", () => {
    const scene = readyScene({
      status: "needs_attention",
      staleness: {
        isStaleAfterRevisionChange: true,
        currentSpecRevision: 2,
        lastPlannedSpecRevision: 1,
        supersededShotPlanCount: 1
      },
      blockers: [
        {
          code: "SHOT_PLAN_SELECTION_STALE",
          severity: "attention",
          message: "References changed — regenerate/select ShotPlan",
          remediationHint: "Select a ShotPlan for the current revision",
          drillDown: { sceneId: "scene-01", sceneOrder: 1, section: "shot-plans" }
        }
      ]
    });
    render(<CampaignPreProductionReadinessPanel readiness={createReadiness([scene])} />);

    const row = screen.getByTestId("readiness-attention-row");
    expect(row.getAttribute("data-stale")).toBe("true");
    expect(screen.getByTestId("readiness-stale-badge")).not.toBeNull();
  });

  it("renders advisories as non-blocking", () => {
    const scene = readyScene({
      advisories: [
        {
          code: "NO_PREVIS_AVAILABLE",
          message: "Scene 01 has no previs available (advisory only)",
          drillDown: { sceneId: "scene-01", sceneOrder: 1, section: "previs" }
        }
      ]
    });
    render(<CampaignPreProductionReadinessPanel readiness={createReadiness([scene])} />);

    expect(screen.getByTestId("readiness-advisories")).not.toBeNull();
    expect(screen.queryByTestId("readiness-blocked-group")).toBeNull();
  });

  it("groups blocked-for-planning scenes separately from needs-attention", () => {
    const blockedScene = readyScene({
      sceneId: "scene-blocked",
      status: "blocked_for_planning",
      blockers: [
        {
          code: "MISSING_REFERENCE_BINDINGS",
          severity: "blocked",
          message: "Scene 01 has no reference bindings",
          remediationHint: "Bind reference assets",
          drillDown: { sceneId: "scene-blocked", sceneOrder: 1, section: "references" }
        }
      ]
    });
    render(<CampaignPreProductionReadinessPanel readiness={createReadiness([blockedScene])} />);
    expect(screen.getByTestId("readiness-blocked-group")).not.toBeNull();
    expect(screen.queryByTestId("readiness-attention-group")).toBeNull();
  });
});
