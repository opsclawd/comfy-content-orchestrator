import {
  ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN,
  verifyAcceptanceCoverage,
  type AcceptanceAssetSlot,
  type AcceptanceAssetSlotName,
  type AcceptanceCampaignFixture,
  type ReferenceAssetResponse
} from "@cco/contracts";
import type { CampaignId, CampaignShellRecord, Scene } from "@cco/domain";
import type { AcceptanceFixtureAssetSourcePort } from "../ports/acceptance-fixture-asset-source-port.js";
import type { UnitOfWork } from "../ports/index.js";
import type { CreateCampaignShellUseCase } from "./create-campaign-shell.js";
import type { CreateSceneUseCase } from "./create-scene.js";
import type { UploadReferenceAssetUseCase } from "./upload-reference-asset.js";

export class AcceptanceFixtureIntegrityError extends Error {
  override readonly name = "AcceptanceFixtureIntegrityError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export interface InstallAcceptanceCampaignFixtureInput {
  readonly clientId: string;
  readonly idempotencyKey: string;
  /** Defaults to ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN; override only in tests. */
  readonly campaign?: AcceptanceCampaignFixture | undefined;
}

export interface InstallAcceptanceCampaignFixtureDependencies {
  readonly uow: UnitOfWork;
  readonly createCampaignShellUseCase: CreateCampaignShellUseCase;
  readonly createSceneUseCase: CreateSceneUseCase;
  readonly uploadReferenceAssetUseCase: UploadReferenceAssetUseCase;
  readonly assetSource: AcceptanceFixtureAssetSourcePort;
}

export interface InstallAcceptanceCampaignFixtureResult {
  readonly campaign: CampaignShellRecord;
  readonly isIdempotentReplay: boolean;
  readonly scenes: readonly Scene[];
  readonly referenceAssetsBySlot: ReadonlyMap<AcceptanceAssetSlotName, ReferenceAssetResponse>;
  readonly fixtureId: string;
}

/**
 * Orchestrates installation of the deterministic H3 acceptance-campaign fixture by
 * composing EXISTING, already-reviewed application use cases
 * (CreateCampaignShellUseCase, CreateSceneUseCase, UploadReferenceAssetUseCase).
 *
 * This use case deliberately never touches a ShotPlan, StoryboardCandidate,
 * ProductionAttempt, or GenerationManifest repository — it only creates a campaign
 * shell, scenes, and reference-asset library rows, exactly as a human operator would via
 * the existing control-api endpoints. Frame-anchor asset slots are intentionally NOT
 * uploaded as reference-role library assets (there is no reference role that fits a pure
 * anchor frame) and are never used to anchor a ShotPlan here — anchoring is strictly a
 * ShotPlan-compiler concern, out of scope for issue #373 by design.
 */
export class InstallAcceptanceCampaignFixtureUseCase {
  constructor(private readonly dependencies: InstallAcceptanceCampaignFixtureDependencies) {}

  async execute(
    input: InstallAcceptanceCampaignFixtureInput
  ): Promise<InstallAcceptanceCampaignFixtureResult> {
    const campaign = input.campaign ?? ACCEPTANCE_H3_REPRESENTATIVE_CAMPAIGN;

    const coverage = verifyAcceptanceCoverage(campaign);
    if (!coverage.satisfied) {
      throw new AcceptanceFixtureIntegrityError(
        `Acceptance campaign fixture "${campaign.fixtureId}" failed coverage verification: ` +
          `missing=[${coverage.missing.join(", ")}] assetSlotErrors=[${coverage.assetSlotErrors.join("; ")}]`
      );
    }

    const referenceRoleSlots = campaign.assetSlots.filter((s) => s.kind === "reference_role");

    const referenceAssetsBySlot = new Map<AcceptanceAssetSlotName, ReferenceAssetResponse>();
    for (const assetSlot of referenceRoleSlots) {
      const asset = await this.installAssetSlot(assetSlot, input.clientId);
      referenceAssetsBySlot.set(assetSlot.name, asset);
    }

    const { campaign: campaignRecord, isIdempotentReplay } =
      await this.dependencies.createCampaignShellUseCase.execute({
        clientId: input.clientId,
        idempotencyKey: input.idempotencyKey,
        title: campaign.title,
        targetTotalDurationMs: campaign.scenes.reduce((sum, s) => sum + s.durationMs, 0),
        sceneCountOverride: campaign.scenes.length
      });

    const existingScenesBySequenceIndex = await this.loadExistingScenesBySequenceIndex(
      campaignRecord.id
    );

    const scenes: Scene[] = [];
    for (const sceneDefinition of campaign.scenes) {
      const existingScene = existingScenesBySequenceIndex.get(sceneDefinition.sequenceIndex);
      if (existingScene !== undefined) {
        // Converge rather than duplicate: a scene already occupies this fixture case's fixed
        // ordinal position, so this install (replaying the same idempotency key) must not
        // create a second one.
        scenes.push(existingScene);
        continue;
      }

      const referenceBindings = sceneDefinition.referenceSlots
        .filter((ref) => referenceAssetsBySlot.has(ref.slotName))
        .map((ref) => {
          const asset = referenceAssetsBySlot.get(ref.slotName)!;
          return {
            referenceAssetId: asset.id,
            role: ref.role
          };
        });

      const scene = await this.dependencies.createSceneUseCase.execute({
        campaignId: campaignRecord.id,
        configuration: {
          prompt: sceneDefinition.prompt,
          engineProfileId: sceneDefinition.engineProfileId,
          durationMs: sceneDefinition.durationMs,
          referenceIds: referenceBindings.map((b) => b.referenceAssetId),
          referenceBindings
        }
      });
      scenes.push(scene);
    }

    return {
      campaign: campaignRecord,
      isIdempotentReplay,
      scenes,
      referenceAssetsBySlot,
      fixtureId: campaign.fixtureId
    };
  }

  /**
   * Scenes carry no `caseId` of their own, so the fixture's fixed `sequenceIndex` (1-9, the
   * fixture's ordinal position) is the stable per-case identity used to detect "this case's
   * scene already exists" on a replayed install, instead of unconditionally creating 9 more
   * scenes on every call.
   */
  private async loadExistingScenesBySequenceIndex(
    campaignId: CampaignId
  ): Promise<ReadonlyMap<number, Scene>> {
    const existingScenes = await this.dependencies.uow.execute(async (context) => {
      if (typeof context.scenes.findByCampaignId !== "function") {
        return [];
      }
      return context.scenes.findByCampaignId(campaignId, { includeArchived: true });
    });

    const bySequenceIndex = new Map<number, Scene>();
    for (const scene of existingScenes) {
      bySequenceIndex.set(scene.sequenceIndex, scene);
    }
    return bySequenceIndex;
  }

  private async installAssetSlot(
    assetSlot: AcceptanceAssetSlot,
    clientId: string
  ): Promise<ReferenceAssetResponse> {
    const bytes = await this.dependencies.assetSource.loadAssetBytes(assetSlot);

    if (bytes.sha256 !== assetSlot.sha256) {
      throw new AcceptanceFixtureIntegrityError(
        `Asset slot "${assetSlot.name}" content hash mismatch: expected ${assetSlot.sha256}, ` +
          `got ${bytes.sha256}. Refusing to install drifted fixture bytes from "${assetSlot.sourcePath}".`
      );
    }

    if (assetSlot.role === undefined) {
      throw new AcceptanceFixtureIntegrityError(
        `Asset slot "${assetSlot.name}" has kind "reference_role" but declares no role.`
      );
    }

    return this.dependencies.uploadReferenceAssetUseCase.execute({
      clientId,
      body: bytes.body,
      declaredMimeType: bytes.mimeType,
      libraryRole: assetSlot.role,
      displayName: `acceptance-fixture-${assetSlot.name}`
    });
  }
}
