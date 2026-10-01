import { describe, expect, it, vi } from "vitest";
import {
  ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
  computeAcceptanceCampaignFingerprint
} from "@cco/contracts";
import type { AcceptanceFixtureAssetSourcePort } from "../ports/acceptance-fixture-asset-source-port.js";
import type {
  AcceptanceCampaignLedgerProbePort,
  AcceptanceDatabaseReadinessProbePort,
  AcceptanceEvidenceTemplateProbePort,
  AcceptanceObjectStorageReadinessProbePort,
  AcceptanceProfileIdentityProbePort
} from "../ports/acceptance-preflight-probe-ports.js";
import { EvaluateAcceptancePreflightUseCase } from "./evaluate-acceptance-preflight.js";

function buildHappyDependencies(): {
  profileIdentityProbe: AcceptanceProfileIdentityProbePort;
  evidenceTemplateProbe: AcceptanceEvidenceTemplateProbePort;
  databaseReadinessProbe: AcceptanceDatabaseReadinessProbePort;
  objectStorageReadinessProbe: AcceptanceObjectStorageReadinessProbePort;
  assetSource: AcceptanceFixtureAssetSourcePort;
  campaignLedgerProbe: AcceptanceCampaignLedgerProbePort;
} {
  return {
    profileIdentityProbe: { probe: vi.fn(async () => ({ ok: true, findings: [], errors: [] })) },
    evidenceTemplateProbe: { probe: vi.fn(async () => ({ ok: true, findings: [] })) },
    databaseReadinessProbe: { probe: vi.fn(async () => ({ ok: true })) },
    objectStorageReadinessProbe: { probe: vi.fn(async () => ({ ok: true })) },
    assetSource: {
      loadAssetBytes: vi.fn(async (slot) => ({
        body: Buffer.from("x"),
        mimeType: slot.mimeType,
        sha256: slot.sha256
      }))
    },
    campaignLedgerProbe: {
      probe: vi.fn(async () => ({
        ok: true,
        installed: false,
        sceneCount: 0,
        expectedSceneCount: ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.scenes.length,
        fabricationFree: true
      }))
    }
  };
}

describe("EvaluateAcceptancePreflightUseCase", () => {
  it("reports readyForOperatorHandoff true when every GPU-free probe passes", async () => {
    const dependencies = buildHappyDependencies();
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(true);
    expect(report.coverage.satisfied).toBe(true);
    expect(report.fixtureId).toBe(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN.fixtureId);
    expect(report.fixtureFingerprint).toBe(
      await computeAcceptanceCampaignFingerprint(ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN)
    );
  });

  it("reports readyForOperatorHandoff false when the profile identity probe fails", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      profileIdentityProbe: {
        probe: vi.fn(async () => ({
          ok: false,
          findings: [],
          errors: ["workflow hash mismatch"]
        }))
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(false);
    expect(report.profileIdentity.ok).toBe(false);
  });

  it("reports readyForOperatorHandoff false when the database is unreachable", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      databaseReadinessProbe: {
        probe: vi.fn(async () => ({
          ok: false,
          detail: "connection refused"
        }))
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(false);
    expect(report.database.ok).toBe(false);
  });

  it("reports readyForOperatorHandoff false when object storage is unreachable", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      objectStorageReadinessProbe: {
        probe: vi.fn(async () => ({
          ok: false,
          detail: "head bucket failed"
        }))
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(false);
    expect(report.objectStorage.ok).toBe(false);
  });

  it("reports readyForOperatorHandoff false when evidence templates are not empty sentinels", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      evidenceTemplateProbe: {
        probe: vi.fn(async () => ({
          ok: false,
          findings: [
            {
              templatePath: "docs/evidence/example.md",
              exists: true,
              isEmptySentinel: false,
              issues: ["template appears to contain filled-in evidence"]
            }
          ]
        }))
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(false);
    expect(report.evidenceTemplates.ok).toBe(false);
  });

  it("reports readyForOperatorHandoff false when a required fixture asset's hash drifts", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      assetSource: {
        loadAssetBytes: vi.fn(async () => ({
          body: Buffer.from("drifted"),
          mimeType: "image/jpeg",
          sha256: "0".repeat(64)
        }))
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(false);
    expect(report.fixtureAssets.ok).toBe(false);
    expect(report.fixtureAssets.findings.every((f) => !f.ok)).toBe(true);
  });

  it("reports readyForOperatorHandoff true when a required fixture asset is optional and missing", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      assetSource: {
        loadAssetBytes: vi.fn(async (slot) => {
          if (!slot.required) {
            throw new Error("file not found");
          }
          return { body: Buffer.from("x"), mimeType: slot.mimeType, sha256: slot.sha256 };
        })
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(true);
    expect(report.fixtureAssets.ok).toBe(true);
    expect(report.fixtureAssets.findings.some((f) => !f.ok && !f.required)).toBe(true);
  });

  it("reports readyForOperatorHandoff false when the campaign ledger probe finds duplicated scenes or fabricated rows", async () => {
    const dependencies = {
      ...buildHappyDependencies(),
      campaignLedgerProbe: {
        probe: vi.fn(async () => ({
          ok: false,
          installed: true,
          sceneCount: 18,
          expectedSceneCount: 9,
          fabricationFree: true,
          detail: "Expected exactly 9 installed scenes, found 18."
        }))
      }
    };
    const useCase = new EvaluateAcceptancePreflightUseCase(dependencies);

    const report = await useCase.execute();

    expect(report.readyForOperatorHandoff).toBe(false);
    expect(report.campaignLedger.ok).toBe(false);
  });
});
