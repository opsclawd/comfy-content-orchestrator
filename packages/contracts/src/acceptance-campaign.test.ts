import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_CAMPAIGN_ASSET_SLOTS,
  ACCEPTANCE_CAMPAIGN_SCENES,
  ACCEPTANCE_CAMPAIGN_SOURCE_ROOT,
  ACCEPTANCE_COVERAGE_REQUIREMENTS,
  ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
  AcceptanceCampaignFixtureSchema,
  computeAcceptanceCampaignFingerprint,
  verifyAcceptanceCoverage,
  type AcceptanceCampaignFixture
} from "./acceptance-campaign.js";

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");

describe("acceptance-campaign fixture", () => {
  it("parses as a valid AcceptanceCampaignFixture", () => {
    expect(() =>
      AcceptanceCampaignFixtureSchema.parse(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN)
    ).not.toThrow();
  });

  it("declares exactly 9 representative scenes with unique sequential sequenceIndex", () => {
    expect(ACCEPTANCE_CAMPAIGN_SCENES).toHaveLength(9);
    const indices = ACCEPTANCE_CAMPAIGN_SCENES.map((s) => s.sequenceIndex);
    expect(indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const caseIds = new Set(ACCEPTANCE_CAMPAIGN_SCENES.map((s) => s.caseId));
    expect(caseIds.size).toBe(9);
  });

  it("declares 6 required asset slots and 1 optional asset slot", () => {
    const required = ACCEPTANCE_CAMPAIGN_ASSET_SLOTS.filter((s) => s.required);
    const optional = ACCEPTANCE_CAMPAIGN_ASSET_SLOTS.filter((s) => !s.required);
    expect(required).toHaveLength(6);
    expect(optional).toHaveLength(1);
  });

  it("exercises exactly one frame_anchored scene and the rest reference_directed", () => {
    const frameAnchored = ACCEPTANCE_CAMPAIGN_SCENES.filter(
      (s) => s.routingMode === "frame_anchored"
    );
    const referenceDirected = ACCEPTANCE_CAMPAIGN_SCENES.filter(
      (s) => s.routingMode === "reference_directed"
    );
    expect(frameAnchored).toHaveLength(1);
    expect(referenceDirected).toHaveLength(8);
  });

  it("satisfies coverage for every declared requirement with zero asset slot errors", () => {
    const result = verifyAcceptanceCoverage(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN);
    expect(result.satisfied).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.assetSlotErrors).toEqual([]);
    expect(result.covered).toHaveLength(ACCEPTANCE_COVERAGE_REQUIREMENTS.length);
  });

  it("flags a missing requirement when a scene's coverage is dropped", () => {
    const mutated: AcceptanceCampaignFixture = {
      ...ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
      scenes: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.map((scene, i) =>
        i === 0 ? { ...scene, coverageRequirementIds: ["R01"] } : scene
      )
    };
    const result = verifyAcceptanceCoverage(mutated);
    expect(result.satisfied).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("flags an asset slot reference error for an unknown slot name", () => {
    const mutated: AcceptanceCampaignFixture = {
      ...ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
      scenes: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.map((scene, i) =>
        i === 0
          ? {
              ...scene,
              referenceSlots: [
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                { slotName: "doesNotExist" as any, role: "subject_identity" as const }
              ]
            }
          : scene
      )
    };
    const result = verifyAcceptanceCoverage(mutated);
    expect(result.satisfied).toBe(false);
    expect(result.assetSlotErrors.length).toBeGreaterThan(0);
  });

  it("every asset slot's sha256 matches the real, read-only certification fixture file on disk", () => {
    for (const assetSlot of ACCEPTANCE_CAMPAIGN_ASSET_SLOTS) {
      expect(assetSlot.sourcePath.startsWith(ACCEPTANCE_CAMPAIGN_SOURCE_ROOT)).toBe(true);
      const absolutePath = resolve(REPO_ROOT, assetSlot.sourcePath);
      const bytes = readFileSync(absolutePath);
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      expect(actualHash).toBe(assetSlot.sha256);
    }
  });

  it("computes a deterministic fingerprint that is stable across repeated calls", async () => {
    const first = await computeAcceptanceCampaignFingerprint(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN);
    const second = await computeAcceptanceCampaignFingerprint(
      ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the fingerprint when any scene field changes", async () => {
    const baseline = await computeAcceptanceCampaignFingerprint(
      ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN
    );
    const mutated: AcceptanceCampaignFixture = {
      ...ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
      scenes: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.map((scene, i) =>
        i === 0 ? { ...scene, prompt: `${scene.prompt} (mutated)` } : scene
      )
    };
    const mutatedFingerprint = await computeAcceptanceCampaignFingerprint(mutated);
    expect(mutatedFingerprint).not.toBe(baseline);
  });

  it("is not affected by key ordering (isolation from object insertion order)", async () => {
    const reordered: AcceptanceCampaignFixture = JSON.parse(
      JSON.stringify(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN)
    );
    const fingerprintA = await computeAcceptanceCampaignFingerprint(
      ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN
    );
    const fingerprintB = await computeAcceptanceCampaignFingerprint(reordered);
    expect(fingerprintA).toBe(fingerprintB);
  });
});
