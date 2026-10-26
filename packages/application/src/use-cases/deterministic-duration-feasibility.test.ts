import { describe, expect, it } from "vitest";
import type {
  DeployedRealm,
  ExecutionProfileSelection,
  H3ProfileFrameCapability,
  StagingCandidateProfileKey
} from "@cco/contracts";
import { planFeasibleCampaignDuration } from "./deterministic-duration-feasibility.js";

describe("deterministic-duration-feasibility", () => {
  const deployedRealm: DeployedRealm = { kind: "deployed", deploymentId: "test-deployment" };

  const legacyH3I2vSelection: ExecutionProfileSelection = {
    kind: "legacy_production",
    profileKey: "MINIMAX_H3_720P_5S_I2V_V1",
    version: 1
  };

  const legacyH3Ref2vSelection: ExecutionProfileSelection = {
    kind: "legacy_production",
    profileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
    version: 1
  };

  const candidate10sCapability: H3ProfileFrameCapability = {
    profileKey: "H3_CANDIDATE_10S_REF2V_V1",
    route: "ref2v",
    routingMode: "reference_directed",
    width: 1344,
    height: 768,
    fps: 24,
    allowedFrameCounts: [243],
    isAllowedFrameCount: (f: number) => f === 243
  };

  const candidate10sSelection: ExecutionProfileSelection = {
    kind: "staging_candidate",
    profileKey: "H3_CANDIDATE_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_V1" as StagingCandidateProfileKey,
    specificationDigest: "a".repeat(64),
    targetId: "target-gpu-1",
    authorizationId: "auth-1"
  };

  const candidate10sCapabilityMap = new Map<string, H3ProfileFrameCapability>([
    [
      candidate10sSelection.profileKey,
      {
        ...candidate10sCapability,
        profileKey: candidate10sSelection.profileKey
      }
    ]
  ]);

  it("legacy 15s H3 allocates three 5000ms / 124f scenes, with 15,501ms summed nominal vs 15,500ms exact rational", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 15_000,
      selectedProfileSelection: legacyH3I2vSelection,
      realm: deployedRealm,
      scope: "production"
    });

    expect(plan.allocations).toHaveLength(3);
    expect(plan.requestedTotalDurationMs).toBe(15_000);
    expect(plan.totalNominalDurationMs).toBe(15_501); // 5167 * 3 = 15,501
    expect(plan.exactRationalTotalDurationMs).toBeCloseTo(15_500, 3); // 124/24*1000 * 3 = 15,500

    for (const alloc of plan.allocations) {
      expect(alloc.requestedDurationMs).toBe(5_000);
      expect(alloc.nominalDurationMs).toBe(5_167);
      expect(alloc.frames).toBe(124);
      expect(alloc.fps).toBe(24);
      expect(alloc.route).toBe("i2v");
    }
  });

  it("legacy 30s H3 allocates six 5000ms / 124f scenes, with 31,002ms summed nominal vs 31,000ms exact rational", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 30_000,
      selectedProfileSelection: legacyH3I2vSelection,
      realm: deployedRealm,
      scope: "production"
    });

    expect(plan.allocations).toHaveLength(6);
    expect(plan.requestedTotalDurationMs).toBe(30_000);
    expect(plan.totalNominalDurationMs).toBe(31_002); // 5167 * 6 = 31,002
    expect(plan.exactRationalTotalDurationMs).toBeCloseTo(31_000, 3);
  });

  it("legacy 55s H3 allocates eleven 5000ms scenes, total nominal 56,837ms <= 60,000ms envelope", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 55_000,
      selectedProfileSelection: legacyH3I2vSelection,
      realm: deployedRealm,
      scope: "production"
    });

    expect(plan.allocations).toHaveLength(11);
    expect(plan.totalNominalDurationMs).toBe(56_837); // 11 * 5167 = 56837
    expect(plan.exactRationalTotalDurationMs).toBeCloseTo(56_833.333, 2);
  });

  it("legacy 60s H3 fails with assembly_envelope_exceeded (12 * 5167 = 62,004ms > 60,000ms)", () => {
    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 60_000,
        selectedProfileSelection: legacyH3I2vSelection,
        realm: deployedRealm,
        scope: "production"
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "assembly_envelope_exceeded"
      })
    );
  });

  it("legacy 300s H3 fails with assembly_envelope_exceeded (60 * 5167 = 310,020ms > 60,000ms)", () => {
    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 300_000,
        selectedProfileSelection: legacyH3I2vSelection,
        realm: deployedRealm,
        scope: "production"
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "assembly_envelope_exceeded"
      })
    );
  });

  it("with eligible 243f Ref2V candidate in staging: maps 10,000ms to 243 frames, nominal 10,125ms", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 10_000,
      selectedProfileSelection: candidate10sSelection,
      realm: {
        kind: "isolated_test",
        testRealmId: "r1",
        isolationDescriptorDigest: "0".repeat(64)
      },
      scope: "staging",
      capabilities: candidate10sCapabilityMap
    });

    expect(plan.allocations).toHaveLength(1);
    expect(plan.allocations[0]!.requestedDurationMs).toBe(10_000);
    expect(plan.allocations[0]!.nominalDurationMs).toBe(10_125);
    expect(plan.allocations[0]!.frames).toBe(243);
    expect(plan.allocations[0]!.fps).toBe(24);
  });

  it("with explicit 5s+10s Ref2V allowed in staging: 15s plans as two scenes (10,000ms + 5,000ms) with longer-first order", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 15_000,
      selectedProfileSelection: candidate10sSelection,
      allowedProfileSelections: [candidate10sSelection, legacyH3Ref2vSelection],
      realm: {
        kind: "isolated_test",
        testRealmId: "r1",
        isolationDescriptorDigest: "0".repeat(64)
      },
      scope: "staging",
      capabilities: candidate10sCapabilityMap
    });

    expect(plan.allocations).toHaveLength(2);
    // Canonical longer-first order
    expect(plan.allocations[0]!.requestedDurationMs).toBe(10_000);
    expect(plan.allocations[0]!.frames).toBe(243);
    expect(plan.allocations[1]!.requestedDurationMs).toBe(5_000);
    expect(plan.allocations[1]!.frames).toBe(124);
    expect(plan.totalNominalDurationMs).toBe(10_125 + 5_167);
  });

  it("with explicit 5s+10s Ref2V allowed: 30s plans as three 10,000ms scenes", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 30_000,
      selectedProfileSelection: candidate10sSelection,
      allowedProfileSelections: [candidate10sSelection, legacyH3Ref2vSelection],
      realm: {
        kind: "isolated_test",
        testRealmId: "r1",
        isolationDescriptorDigest: "0".repeat(64)
      },
      scope: "staging",
      capabilities: candidate10sCapabilityMap
    });

    expect(plan.allocations).toHaveLength(3);
    for (const alloc of plan.allocations) {
      expect(alloc.requestedDurationMs).toBe(10_000);
      expect(alloc.frames).toBe(243);
    }
  });

  it("with 10s-ONLY Ref2V allowed: 15s target cannot be satisfied and throws no_feasible_allocation", () => {
    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 15_000,
        selectedProfileSelection: candidate10sSelection,
        realm: {
          kind: "isolated_test",
          testRealmId: "r1",
          isolationDescriptorDigest: "0".repeat(64)
        },
        scope: "staging",
        capabilities: candidate10sCapabilityMap
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "no_feasible_allocation"
      })
    );
  });

  it("candidate 362 frames (nominal ~15,083ms) exceeds 15,000ms scene ceiling and throws scene_ceiling", () => {
    const candidate362Cap: H3ProfileFrameCapability = {
      profileKey: "H3_CANDIDATE_362_V1",
      route: "ref2v",
      routingMode: "reference_directed",
      width: 1344,
      height: 768,
      fps: 24,
      allowedFrameCounts: [362],
      isAllowedFrameCount: (f: number) => f === 362
    };

    const sel: ExecutionProfileSelection = {
      kind: "staging_candidate",
      profileKey: "H3_CANDIDATE_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_V1" as StagingCandidateProfileKey,
      specificationDigest: "b".repeat(64),
      targetId: "target-1",
      authorizationId: "auth-2"
    };

    const map = new Map<string, H3ProfileFrameCapability>([
      [sel.profileKey, { ...candidate362Cap, profileKey: sel.profileKey }]
    ]);

    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 15_000,
        selectedProfileSelection: sel,
        realm: {
          kind: "isolated_test",
          testRealmId: "r1",
          isolationDescriptorDigest: "0".repeat(64)
        },
        scope: "staging",
        capabilities: map
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "scene_ceiling"
      })
    );
  });

  it("candidate with off-grid frame count throws no_feasible_allocation", () => {
    const offGridCap: H3ProfileFrameCapability = {
      profileKey: "H3_CANDIDATE_OFFGRID_V1",
      route: "ref2v",
      routingMode: "reference_directed",
      width: 1344,
      height: 768,
      fps: 24,
      allowedFrameCounts: [120], // 120 is off H3 grid (120 - 5) % 17 !== 0
      isAllowedFrameCount: (f: number) => f === 120
    };

    const sel: ExecutionProfileSelection = {
      kind: "staging_candidate",
      profileKey: "H3_CANDIDATE_cccccccccccccccccccccccccccccccc_V1" as StagingCandidateProfileKey,
      specificationDigest: "c".repeat(64),
      targetId: "target-1",
      authorizationId: "auth-3"
    };

    const map = new Map<string, H3ProfileFrameCapability>([
      [sel.profileKey, { ...offGridCap, profileKey: sel.profileKey }]
    ]);

    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 15_000,
        selectedProfileSelection: sel,
        realm: {
          kind: "isolated_test",
          testRealmId: "r1",
          isolationDescriptorDigest: "0".repeat(64)
        },
        scope: "staging",
        capabilities: map
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "no_feasible_allocation"
      })
    );
  });

  it("mixing i2v and ref2v profiles throws profile_route_mismatch", () => {
    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 15_000,
        selectedProfileSelection: legacyH3I2vSelection,
        allowedProfileSelections: [legacyH3I2vSelection, legacyH3Ref2vSelection],
        realm: deployedRealm,
        scope: "production"
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "profile_route_mismatch"
      })
    );
  });

  it("attempting staging candidate in production scope throws authorization_denied", () => {
    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 10_000,
        selectedProfileSelection: candidate10sSelection,
        realm: deployedRealm,
        scope: "production",
        capabilities: candidate10sCapabilityMap
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "authorization_denied"
      })
    );
  });

  it("legacy 59s H3 where 12 scenes exceeds envelope fails with assembly_envelope_exceeded without blocking event loop", () => {
    expect(() =>
      planFeasibleCampaignDuration({
        campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
        targetTotalDurationMs: 59_000,
        selectedProfileSelection: legacyH3I2vSelection,
        realm: deployedRealm,
        scope: "production"
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CampaignDurationPlanningError",
        reason: "assembly_envelope_exceeded"
      })
    );
  });

  it("downward-interior mixed-profile allocation: 14,900ms with 5s+10s Ref2V and explicit scene count 2 succeeds", () => {
    const plan = planFeasibleCampaignDuration({
      campaignId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73800",
      targetTotalDurationMs: 14_900,
      sceneCountOverride: 2,
      selectedProfileSelection: candidate10sSelection,
      allowedProfileSelections: [candidate10sSelection, legacyH3Ref2vSelection],
      realm: {
        kind: "isolated_test",
        testRealmId: "r1",
        isolationDescriptorDigest: "0".repeat(64)
      },
      scope: "staging",
      capabilities: candidate10sCapabilityMap
    });

    expect(plan.allocations).toHaveLength(2);
    expect(plan.allocations.reduce((sum, a) => sum + a.requestedDurationMs, 0)).toBe(14_900);
    expect(plan.allocations[0]!.frames).toBe(243);
    expect(plan.allocations[1]!.frames).toBe(124);
  });
});
