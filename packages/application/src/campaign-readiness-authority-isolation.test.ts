import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  compileCampaignPreProductionReadiness,
  CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE,
  type RawReadinessSceneInput
} from "@cco/contracts";
import { verifyApprovedVisualProductionInput, MissingCandidateSelectionError } from "@cco/domain";
import type {
  SceneSnapshot,
  StoryboardCandidate,
  SceneId,
  CampaignId,
  CandidateId
} from "@cco/domain";

const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignName = "Authority Isolation Readiness Test";
const campaignUpdatedAt = "2026-09-27T12:00:00.000Z";

function planningReadyScene(): RawReadinessSceneInput {
  return {
    sceneId: "22222222-2222-4222-8222-222222222221",
    sceneOrder: 1,
    specRevision: 1,
    sceneUpdatedAt: campaignUpdatedAt,
    routingMode: "reference_directed",
    selectedShotPlanId: "33333333-3333-4333-8333-333333333331",
    selectedShotPlanRevision: 1,
    approvedShotPlanId: "33333333-3333-4333-8333-333333333331",
    approvedShotPlanRevision: 1,
    selectedCandidateId: null,
    selectedCandidateRevision: null,
    selectedShotPlanSpecRevision: 1,
    selectedShotPlanStatus: "approved",
    selectedShotPlanPrevisCandidateId: null,
    currentRevisionShotPlanCount: 1,
    supersededShotPlanCount: 0,
    lastPlannedSpecRevision: 1,
    currentRevisionBindingCount: 1,
    currentRevisionBindingRoles: ["style"],
    hasArchivedBinding: false,
    hasCrossClientBinding: false,
    currentRevisionPrevisAvailable: true,
    currentRevisionPrevisCandidateId: "55555555-5555-4555-8555-555555555555"
  };
}

describe("Campaign Pre-Production Readiness Authority Isolation & Non-Production Invariants", () => {
  it("embeds the immutable planning-only notice", () => {
    const model = compileCampaignPreProductionReadiness({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [planningReadyScene()]
    });

    expect(model.planningOnlyNotice).toBe(CAMPAIGN_PRE_PRODUCTION_READINESS_PLANNING_ONLY_NOTICE);
    expect(model.planningOnlyNotice).toContain("NOT A PRODUCTION-INPUT CERTIFICATION");
  });

  it("proves a planning_ready projection confers no production admission", () => {
    const sceneId = "22222222-2222-4222-8222-222222222221" as SceneId;
    const unapprovedScene: SceneSnapshot = {
      id: sceneId,
      campaignId: campaignId as CampaignId,
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "Neo-Tokyo street",
        referenceIds: [],
        engineProfileId: "minimax-h3",
        durationMs: 4000
      }
    };

    const previsCandidate: StoryboardCandidate = {
      id: "55555555-5555-4555-8555-555555555555" as CandidateId,
      sceneId,
      specRevision: 1,
      contentHash: "a".repeat(64),
      variantOrdinal: 1,
      storageBucket: "previs-bucket",
      storageObjectKey: "scenes/scene-1/previs.png",
      generationMetadata: {},
      createdAt: campaignUpdatedAt
    };

    const model = compileCampaignPreProductionReadiness({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [planningReadyScene()]
    });
    expect(model.scenes[0]!.status).toBe("planning_ready");

    // The readiness projection reporting `planning_ready` must not make production
    // admission succeed — verification remains an independent, unaffected authority.
    expect(() =>
      verifyApprovedVisualProductionInput({
        candidate: previsCandidate,
        scene: unapprovedScene
      })
    ).toThrow(MissingCandidateSelectionError);
  });

  it("never serializes production-admission vocabulary in the read model", () => {
    const model = compileCampaignPreProductionReadiness({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [planningReadyScene()]
    });

    const serialized = JSON.stringify(model);
    expect(serialized).not.toContain("ready_to_dispatch");
    expect(serialized).not.toContain("productionInputFingerprint");
  });

  it("proves campaign-readiness.ts cannot import the H3 production resolver or any port", () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const contractsSourcePath = path.resolve(
      currentDir,
      "../../contracts/src/campaign-readiness.ts"
    );
    const source = readFileSync(contractsSourcePath, "utf-8");

    expect(source).not.toContain("shot-plan-compiler");
    expect(source).not.toContain("enqueue-scene-production-render");
    expect(source).not.toMatch(/from ["']\.\.\/ports/);
    expect(source).not.toContain("@cco/application");
    expect(source).not.toContain("@cco/infrastructure");
  });
});
