import {
  ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
  computeAcceptanceCampaignFingerprint,
  verifyAcceptanceCoverage,
  type AcceptanceCampaignFixture,
  type AcceptanceCoverageResult
} from "@cco/contracts";
import type { AcceptanceFixtureAssetSourcePort } from "../ports/acceptance-fixture-asset-source-port.js";
import type {
  AcceptanceCampaignLedgerProbePort,
  AcceptanceCampaignLedgerProbeResult,
  AcceptanceDatabaseReadinessProbePort,
  AcceptanceEvidenceTemplateProbeResult,
  AcceptanceObjectStorageReadinessProbePort,
  AcceptanceProfileIdentityProbeResult
} from "../ports/acceptance-preflight-probe-ports.js";
import type {
  AcceptanceEvidenceTemplateProbePort,
  AcceptanceProfileIdentityProbePort
} from "../ports/acceptance-preflight-probe-ports.js";

export interface EvaluateAcceptancePreflightInput {
  readonly campaign?: AcceptanceCampaignFixture | undefined;
}

export interface EvaluateAcceptancePreflightDependencies {
  readonly profileIdentityProbe: AcceptanceProfileIdentityProbePort;
  readonly evidenceTemplateProbe: AcceptanceEvidenceTemplateProbePort;
  readonly databaseReadinessProbe: AcceptanceDatabaseReadinessProbePort;
  readonly objectStorageReadinessProbe: AcceptanceObjectStorageReadinessProbePort;
  /** Read-only source used to verify every pinned fixture asset's live bytes and hash. */
  readonly assetSource: AcceptanceFixtureAssetSourcePort;
  readonly campaignLedgerProbe: AcceptanceCampaignLedgerProbePort;
}

export interface AcceptanceFixtureAssetFinding {
  readonly slotName: string;
  readonly sourcePath: string;
  readonly required: boolean;
  readonly ok: boolean;
  readonly detail?: string | undefined;
}

export interface AcceptanceFixtureAssetsProbeResult {
  readonly ok: boolean;
  readonly findings: readonly AcceptanceFixtureAssetFinding[];
}

export interface AcceptancePreflightReport {
  readonly fixtureId: string;
  readonly fixtureFingerprint: string;
  readonly coverage: AcceptanceCoverageResult;
  readonly profileIdentity: AcceptanceProfileIdentityProbeResult;
  readonly evidenceTemplates: AcceptanceEvidenceTemplateProbeResult;
  readonly database: { readonly ok: boolean; readonly detail?: string | undefined };
  readonly objectStorage: { readonly ok: boolean; readonly detail?: string | undefined };
  readonly fixtureAssets: AcceptanceFixtureAssetsProbeResult;
  readonly campaignLedger: AcceptanceCampaignLedgerProbeResult;
  /**
   * True only when every GPU-free check above passed. This NEVER implies the physical
   * RTX 4090 acceptance campaign itself has been run, nor that any certification
   * evidence exists — it only means preparation tooling is internally consistent and
   * reachable infrastructure is up.
   */
  readonly readyForOperatorHandoff: boolean;
}

/**
 * Evaluates whether the acceptance-campaign fixture and its surrounding preparation
 * tooling are internally consistent and ready to hand off to a human operator with GPU
 * access. Every check performed here is GPU-free and read-only: coverage verification is
 * pure in-memory computation, profile-identity verification reads static JSON/workflow
 * files, evidence-template verification reads static markdown files, and database/object
 * storage checks are read-only reachability probes (SELECT 1 / HeadBucket).
 *
 * This use case creates nothing. It never touches a ShotPlan, StoryboardCandidate,
 * ProductionAttempt, or GenerationManifest repository, and it never acquires diffusion
 * hardware or talks to the generation engine's HTTP API.
 */
export class EvaluateAcceptancePreflightUseCase {
  constructor(private readonly dependencies: EvaluateAcceptancePreflightDependencies) {}

  async execute(input: EvaluateAcceptancePreflightInput = {}): Promise<AcceptancePreflightReport> {
    const campaign = input.campaign ?? ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN;

    const coverage = verifyAcceptanceCoverage(campaign);
    const fixtureFingerprint = await computeAcceptanceCampaignFingerprint(campaign);

    const [
      profileIdentity,
      evidenceTemplates,
      database,
      objectStorage,
      fixtureAssets,
      campaignLedger
    ] = await Promise.all([
      this.dependencies.profileIdentityProbe.probe(),
      this.dependencies.evidenceTemplateProbe.probe(),
      this.dependencies.databaseReadinessProbe.probe(),
      this.dependencies.objectStorageReadinessProbe.probe(),
      this.probeFixtureAssets(campaign),
      this.dependencies.campaignLedgerProbe.probe()
    ]);

    const readyForOperatorHandoff =
      coverage.satisfied &&
      profileIdentity.ok &&
      evidenceTemplates.ok &&
      database.ok &&
      objectStorage.ok &&
      fixtureAssets.ok &&
      campaignLedger.ok;

    return {
      fixtureId: campaign.fixtureId,
      fixtureFingerprint,
      coverage,
      profileIdentity,
      evidenceTemplates,
      database,
      objectStorage,
      fixtureAssets,
      campaignLedger,
      readyForOperatorHandoff
    };
  }

  private async probeFixtureAssets(
    campaign: AcceptanceCampaignFixture
  ): Promise<AcceptanceFixtureAssetsProbeResult> {
    const findings: AcceptanceFixtureAssetFinding[] = [];

    for (const slot of campaign.assetSlots) {
      try {
        const bytes = await this.dependencies.assetSource.loadAssetBytes(slot);
        const matches = bytes.sha256 === slot.sha256;
        findings.push({
          slotName: slot.name,
          sourcePath: slot.sourcePath,
          required: slot.required,
          ok: matches,
          detail: matches
            ? undefined
            : `Expected sha256 ${slot.sha256}, found ${bytes.sha256} at ${slot.sourcePath}`
        });
      } catch (err) {
        findings.push({
          slotName: slot.name,
          sourcePath: slot.sourcePath,
          required: slot.required,
          ok: false,
          detail: err instanceof Error ? err.message : String(err)
        });
      }
    }

    const ok = findings.filter((f) => f.required).every((f) => f.ok);
    return { ok, findings };
  }
}
