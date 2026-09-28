import { randomUUID } from "node:crypto";
import {
  InvalidTransitionError,
  type CampaignProductionRunRecord,
  type CandidateId,
  type RenderJob,
  type Scene,
  type SceneId,
  type SceneSnapshot,
  type SceneStatus,
  type ShotPlanId
} from "@cco/domain";
import { getProfileInjectionTopology, type ShotPlanRoutingMode } from "@cco/contracts";
import type { EnqueueJobInput } from "../ports/job-queue-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { HashBytesPort } from "../ports/hash-bytes.js";
import type { ImageInspectionPort } from "../ports/image-inspection-port.js";
import { deriveProductionSeed } from "./derive-production-seed.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import {
  isMiniMaxEngineOrProfile,
  mapDurationMsToLtxFrameCount,
  mapDurationMsToMiniMaxH3FrameCount,
  UnsupportedProductionDurationError
} from "./map-production-duration.js";
import {
  ConditionedProductionProfileUnavailableError,
  UnrepresentableProductionConfigurationError
} from "./production-configuration-errors.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";
import {
  canonicalizeReferenceBindings,
  ReferenceCanonicalizationError,
  type CanonicalReferenceEntry
} from "../shot-plan-compiler/canonicalize-reference-bindings.js";
import { parseImageByteHeader } from "../shot-plan-compiler/image-header-parser.js";
import { MAX_CANDIDATE_IMAGE_BYTES } from "./resolve-approved-candidate-media.js";

export const LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f";
export const LTX_TEXT_PRODUCTION_RENDER_PROFILE_KEY = "LTX_25_720P_5S_V1";
export const LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f-i2v";
export const LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY = "LTX_25_720P_5S_I2V_V1";

export const MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE = "minimax-h3-720p-124f-i2v";
export const MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY = "MINIMAX_H3_720P_5S_I2V_V1";
export const MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE = "minimax-h3-720p-124f-ref2v";
export const MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY = "MINIMAX_H3_720P_5S_REF2V_V1";

export const PRODUCTION_WORKFLOW_TEMPLATE = LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE;
export const PRODUCTION_RENDER_PROFILE_KEY = LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY;
export const LTX_PRODUCTION_WORKFLOW_TEMPLATE = PRODUCTION_WORKFLOW_TEMPLATE;
export const SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID = "LTX_25_720P_5S_V1";

export const ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS: ReadonlySet<string> = new Set([
  "LTX_25_720P_5S_V1",
  "ltx_25",
  "LTX_25_720P_5S_I2V_V1",
  "ltx_25_i2v",
  "MINIMAX_H3_720P_5S_I2V_V1",
  "minimax_h3_720p_5s_i2v_v1",
  "minimax-h3-720p-124f-i2v",
  "minimax-h3-720p-5s-i2v-v1",
  "minimax_h3_i2v",
  "MINIMAX_H3_720P_5S_REF2V_V1",
  "minimax_h3_720p_5s_ref2v_v1",
  "minimax-h3-720p-124f-ref2v",
  "minimax-h3-720p-5s-ref2v-v1",
  "minimax_h3_ref2v",
  "minimax_h3",
  "minimax-h3",
  "minimax-h3-720p@certified-v1"
]);

export interface EnqueueSceneProductionRenderOptions {
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly hashBytes?: HashBytesPort | undefined;
  readonly imageValidator?: ImageInspectionPort | undefined;
  readonly [key: string]: unknown;
}

export interface EnqueueSceneProductionRenderInput {
  readonly sceneId: string;
  readonly runId?: string;
}

export interface EnqueueSceneProductionRenderResult {
  readonly scene: Readonly<SceneSnapshot>;
  readonly job: RenderJob;
  readonly attemptId: string;
  readonly attemptOrdinal: number;
}

function validateImageByteHeader(
  bytes: Uint8Array,
  declaredMime: string,
  expectedWidth: number | undefined,
  expectedHeight: number | undefined,
  assetId: string,
  sceneId: SceneId,
  sceneStatus: SceneStatus,
  actionName: string
): void {
  if (bytes.length < 8) {
    throw new InvalidTransitionError(
      sceneId,
      sceneStatus,
      actionName,
      `Reference asset "${assetId}" buffer is too small to be a valid image.`
    );
  }

  const parsed = parseImageByteHeader(bytes);
  if (!parsed) {
    throw new InvalidTransitionError(
      sceneId,
      sceneStatus,
      actionName,
      `Reference asset "${assetId}" contains invalid or unrecognized image byte format.`
    );
  }

  if (declaredMime !== parsed.mimeType) {
    throw new InvalidTransitionError(
      sceneId,
      sceneStatus,
      actionName,
      `Reference asset "${assetId}" MIME type mismatch: declared "${declaredMime}", detected "${parsed.mimeType}".`
    );
  }

  if (parsed.width <= 0 || parsed.height <= 0) {
    throw new InvalidTransitionError(
      sceneId,
      sceneStatus,
      actionName,
      `Reference asset "${assetId}" must have positive dimensions.`
    );
  }

  if (expectedWidth !== undefined && parsed.width !== expectedWidth) {
    throw new InvalidTransitionError(
      sceneId,
      sceneStatus,
      actionName,
      `Reference asset "${assetId}" width mismatch: expected ${expectedWidth}, got ${parsed.width}.`
    );
  }

  if (expectedHeight !== undefined && parsed.height !== expectedHeight) {
    throw new InvalidTransitionError(
      sceneId,
      sceneStatus,
      actionName,
      `Reference asset "${assetId}" height mismatch: expected ${expectedHeight}, got ${parsed.height}.`
    );
  }
}

export class EnqueueSceneProductionRenderUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly options?: EnqueueSceneProductionRenderOptions
  ) {}

  async #buildProductionEnqueueInput(
    context: UnitOfWorkContext,
    scene: Scene,
    attemptOrdinal: number,
    attemptId: string,
    actionName: string = "queueForProduction"
  ): Promise<{
    readonly enqueueInput: EnqueueJobInput;
    readonly seed: number;
    readonly selectedCandidateId?: string | undefined;
    readonly selectedCandidateRevision?: number | undefined;
  }> {
    const snapshot = scene.snapshot();
    const isMiniMax = isMiniMaxEngineOrProfile(snapshot.configuration.engineProfileId);

    const unrepresentable: string[] = [];
    if (!ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS.has(snapshot.configuration.engineProfileId)) {
      unrepresentable.push("engineProfileId");
    }
    if (!isMiniMax && snapshot.configuration.referenceIds.length > 0) {
      unrepresentable.push("referenceIds");
    }
    if (
      snapshot.configuration.loraConfigurationId !== undefined &&
      snapshot.configuration.loraConfigurationId !== null
    ) {
      unrepresentable.push("loraConfigurationId");
    }
    const rawScene = snapshot as unknown as Record<string, unknown>;
    const rawConfig = snapshot.configuration as unknown as Record<string, unknown> | undefined;
    if (
      isMiniMax &&
      (rawScene.trim !== undefined ||
        rawScene.loop !== undefined ||
        rawConfig?.trim !== undefined ||
        rawConfig?.loop !== undefined)
    ) {
      unrepresentable.push("trim_or_loop");
    }
    if (unrepresentable.length > 0) {
      throw new UnrepresentableProductionConfigurationError(scene.id, unrepresentable);
    }

    const durationResult = isMiniMax
      ? mapDurationMsToMiniMaxH3FrameCount(snapshot.configuration.durationMs)
      : mapDurationMsToLtxFrameCount(snapshot.configuration.durationMs);

    if (!durationResult.ok) {
      throw new UnsupportedProductionDurationError(
        snapshot.configuration.durationMs,
        durationResult.reason
      );
    }

    const seed = deriveProductionSeed(scene.id, snapshot.specRevision, attemptOrdinal);

    if (!isMiniMax) {
      if (
        snapshot.selectedCandidateId === undefined ||
        snapshot.selectedCandidateRevision !== snapshot.specRevision
      ) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Production requires a valid candidate selection from revision ${snapshot.specRevision}.`
        );
      }

      const workflowTemplate = LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE;
      const renderProfileKey = LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY;

      const topology = getProfileInjectionTopology(renderProfileKey);
      if (!topology) {
        throw new ConditionedProductionProfileUnavailableError(scene.id, renderProfileKey);
      }

      const injectedPayload: Record<string, unknown> = {
        prompt: snapshot.configuration.prompt,
        seed,
        approvedCandidateId: snapshot.selectedCandidateId,
        attemptId
      };
      if (topology.frameCount) {
        injectedPayload.frameCount = durationResult.frameCount;
      }

      return {
        enqueueInput: {
          sceneId: scene.id,
          jobKind: "production",
          workflowTemplate,
          injectedPayload
        },
        seed,
        selectedCandidateId: snapshot.selectedCandidateId,
        selectedCandidateRevision: snapshot.selectedCandidateRevision
      };
    }

    // MiniMax-H3 production admission
    if (snapshot.approval === undefined || snapshot.approval.revision !== snapshot.specRevision) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `Production requires an approved SceneSpec at current revision ${snapshot.specRevision}.`
      );
    }

    if (!snapshot.approvedShotPlanId) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `Production requires an approved current-revision ShotPlan for scene "${scene.id}".`
      );
    }
    if (
      snapshot.approvedShotPlanRevision === undefined ||
      snapshot.approvedShotPlanRevision !== snapshot.specRevision
    ) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `Scene approvedShotPlanRevision (${snapshot.approvedShotPlanRevision}) does not match current specRevision (${snapshot.specRevision}).`
      );
    }

    if (!context.shotPlans) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `shotPlans repository is required in UnitOfWorkContext for MiniMax production admission.`
      );
    }
    const shotPlan = await context.shotPlans.findById(snapshot.approvedShotPlanId as ShotPlanId);
    if (!shotPlan) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `Approved ShotPlan "${snapshot.approvedShotPlanId}" not found for scene "${scene.id}".`
      );
    }
    const shotPlanSnapshot = shotPlan.snapshot();
    if (shotPlanSnapshot.status !== "approved") {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `ShotPlan "${shotPlanSnapshot.id}" must be approved, got status "${shotPlanSnapshot.status}".`
      );
    }
    if (shotPlanSnapshot.sceneId !== scene.id) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `ShotPlan "${shotPlanSnapshot.id}" belongs to scene "${shotPlanSnapshot.sceneId}", not "${scene.id}".`
      );
    }
    if (shotPlanSnapshot.specRevision !== snapshot.specRevision) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `ShotPlan specRevision (${shotPlanSnapshot.specRevision}) does not match scene specRevision (${snapshot.specRevision}).`
      );
    }

    const routingMode: ShotPlanRoutingMode = shotPlanSnapshot.routingMode ?? "reference_directed";
    if (snapshot.productionRoutingMode && snapshot.productionRoutingMode !== routingMode) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        actionName,
        `Scene productionRoutingMode (${snapshot.productionRoutingMode}) does not match ShotPlan routingMode (${routingMode}).`
      );
    }

    if (routingMode === "reference_directed") {
      const workflowTemplate = MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE;
      const renderProfileKey = MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY;

      const topology = getProfileInjectionTopology(renderProfileKey);
      if (!topology) {
        throw new ConditionedProductionProfileUnavailableError(scene.id, renderProfileKey);
      }

      if (!context.referenceAssets || !context.referenceAssets.listBindingsBySceneId) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `referenceAssets repository with listBindingsBySceneId is required in UnitOfWorkContext for reference-directed production.`
        );
      }

      if (!this.options?.objectStorage) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `objectStorage dependency is mandatory for reference-directed H3 admission.`
        );
      }
      if (!this.options?.hashBytes) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `hashBytes dependency is mandatory for reference-directed H3 admission.`
        );
      }

      const rawBindings = await context.referenceAssets.listBindingsBySceneId(scene.id as SceneId);
      for (const binding of rawBindings) {
        if (binding.sceneId && binding.sceneId !== scene.id) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference binding for asset "${binding.referenceAssetId}" belongs to scene "${binding.sceneId}", which does not match scene "${scene.id}".`
          );
        }
        if (binding.specRevision !== undefined && binding.specRevision !== snapshot.specRevision) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference binding for asset "${binding.referenceAssetId}" has specRevision ${binding.specRevision}, which does not match scene specRevision ${snapshot.specRevision}.`
          );
        }
      }

      const rawAssets = await context.referenceAssets.listBySceneId(scene.id as SceneId);
      const assetsById = new Map(rawAssets.map((a) => [a.id, a]));

      if (!context.campaigns) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `campaigns repository is required in UnitOfWorkContext for reference-directed H3 admission.`
        );
      }
      const campaign = await context.campaigns.findById(scene.campaignId);
      if (!campaign || !campaign.clientId) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Campaign "${scene.campaignId}" not found or lacks clientId for scene "${scene.id}".`
        );
      }
      const expectedClientId = campaign.clientId;

      let canonicalRefs: readonly CanonicalReferenceEntry[];
      try {
        canonicalRefs = canonicalizeReferenceBindings({
          bindings: rawBindings,
          assetsById,
          expectedClientId,
          expectedSceneId: scene.id
        });
      } catch (err) {
        if (err instanceof ReferenceCanonicalizationError) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference canonicalization failed: ${err.message}`
          );
        }
        throw err;
      }

      for (const ref of canonicalRefs) {
        if (ref.asset.clientId !== expectedClientId) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference asset "${ref.referenceAssetId}" client "${ref.asset.clientId}" does not match scene campaign client "${expectedClientId}".`
          );
        }

        const refAssetSceneId = (ref.asset as { sceneId?: string }).sceneId;
        if (refAssetSceneId && refAssetSceneId !== scene.id) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference asset "${ref.referenceAssetId}" belongs to scene "${refAssetSceneId}", which does not match scene "${scene.id}".`
          );
        }

        const stored = await this.options.objectStorage.getObject(
          { bucket: ref.asset.storageBucket, key: ref.asset.storageObjectKey },
          { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
        );
        if (!stored || !stored.body || stored.body.byteLength === 0) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference asset "${ref.referenceAssetId}" object "${ref.asset.storageObjectKey}" is missing or empty in storage.`
          );
        }

        const actualSha256 = await this.options.hashBytes.hashBytes(stored.body);
        if (actualSha256 !== ref.asset.contentHashSha256) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Reference asset "${ref.referenceAssetId}" content hash mismatch: expected "${ref.asset.contentHashSha256}", got "${actualSha256}".`
          );
        }

        const declaredMime = ref.asset.mimeType ?? "image/png";
        if (this.options?.imageValidator) {
          try {
            const inspected = await this.options.imageValidator.inspectAndValidate(
              stored.body,
              declaredMime
            );
            if (ref.asset.width !== undefined && inspected.width !== ref.asset.width) {
              throw new InvalidTransitionError(
                scene.id,
                scene.status,
                actionName,
                `Reference asset "${ref.referenceAssetId}" width mismatch: expected ${ref.asset.width}, got ${inspected.width}.`
              );
            }
            if (ref.asset.height !== undefined && inspected.height !== ref.asset.height) {
              throw new InvalidTransitionError(
                scene.id,
                scene.status,
                actionName,
                `Reference asset "${ref.referenceAssetId}" height mismatch: expected ${ref.asset.height}, got ${inspected.height}.`
              );
            }
          } catch (err) {
            if (err instanceof InvalidTransitionError) throw err;
            throw new InvalidTransitionError(
              scene.id,
              scene.status,
              actionName,
              `Reference asset "${ref.referenceAssetId}" media validation failed: ${(err as Error).message}`
            );
          }
        } else {
          validateImageByteHeader(
            stored.body,
            declaredMime,
            ref.asset.width,
            ref.asset.height,
            ref.referenceAssetId,
            scene.id,
            scene.status,
            actionName
          );
        }
      }

      const injectedPayload: Record<string, unknown> = {
        prompt: snapshot.configuration.prompt,
        seed,
        shotPlanId: shotPlanSnapshot.id,
        specRevision: snapshot.specRevision,
        attemptId
      };
      if (topology.frameCount) {
        injectedPayload.frameCount = durationResult.frameCount;
      }

      return {
        enqueueInput: {
          sceneId: scene.id,
          jobKind: "production",
          workflowTemplate,
          injectedPayload
        },
        seed,
        selectedCandidateId: undefined,
        selectedCandidateRevision: undefined
      };
    }

    if (routingMode === "frame_anchored") {
      if (
        !shotPlanSnapshot.continuity ||
        shotPlanSnapshot.continuity.frameAnchorTarget === "none"
      ) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `ShotPlan "${shotPlanSnapshot.id}" must specify a non-"none" frameAnchorTarget for frame-anchored execution.`
        );
      }

      if (shotPlanSnapshot.continuity.frameAnchorTarget !== "first_frame") {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `ShotPlan "${shotPlanSnapshot.id}" specifies frameAnchorTarget "${shotPlanSnapshot.continuity.frameAnchorTarget}". Only "first_frame" is currently supported by certified profile.`
        );
      }

      const anchorCandidateId = shotPlanSnapshot.continuity.anchorCandidateId;
      if (!anchorCandidateId) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Frame-anchored execution requires an authoritative frame candidate identified in ShotPlan continuity (anchorCandidateId).`
        );
      }

      const anchorMediaHash = shotPlanSnapshot.continuity.anchorMediaHashSha256;
      if (!anchorMediaHash) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Frame-anchored execution requires an authoritative frame media hash identified in ShotPlan continuity (anchorMediaHashSha256).`
        );
      }

      if (snapshot.selectedCandidateId && anchorCandidateId !== snapshot.selectedCandidateId) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `ShotPlan anchorCandidateId "${anchorCandidateId}" does not match scene selectedCandidateId "${snapshot.selectedCandidateId}".`
        );
      }

      const candidate = await context.candidates.findById(anchorCandidateId as CandidateId);
      if (!candidate) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Authoritative frame candidate "${anchorCandidateId}" not found in candidate repository.`
        );
      }
      if (candidate.sceneId !== scene.id) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Authoritative frame candidate "${anchorCandidateId}" belongs to scene "${candidate.sceneId}", not "${scene.id}".`
        );
      }
      if (candidate.specRevision !== snapshot.specRevision) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Authoritative frame candidate "${anchorCandidateId}" revision (${candidate.specRevision}) does not match scene specRevision (${snapshot.specRevision}).`
        );
      }
      if (candidate.contentHash !== anchorMediaHash) {
        throw new InvalidTransitionError(
          scene.id,
          scene.status,
          actionName,
          `Authoritative frame candidate "${anchorCandidateId}" content hash "${candidate.contentHash}" does not match ShotPlan continuity anchorMediaHashSha256 "${anchorMediaHash}".`
        );
      }

      if (this.options?.objectStorage && this.options?.hashBytes) {
        const stored = await this.options.objectStorage.getObject(
          { bucket: candidate.storageBucket, key: candidate.storageObjectKey },
          { maxBytes: MAX_CANDIDATE_IMAGE_BYTES }
        );
        if (!stored || !stored.body || stored.body.byteLength === 0) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Authoritative frame candidate "${anchorCandidateId}" object "${candidate.storageObjectKey}" is missing or empty in storage.`
          );
        }
        const actualSha256 = await this.options.hashBytes.hashBytes(stored.body);
        if (actualSha256 !== candidate.contentHash) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            actionName,
            `Authoritative frame candidate "${anchorCandidateId}" content hash mismatch: expected "${candidate.contentHash}", got "${actualSha256}".`
          );
        }
      }

      const workflowTemplate = MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE;
      const renderProfileKey = MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY;

      const topology = getProfileInjectionTopology(renderProfileKey);
      if (!topology) {
        throw new ConditionedProductionProfileUnavailableError(scene.id, renderProfileKey);
      }

      const injectedPayload: Record<string, unknown> = {
        prompt: snapshot.configuration.prompt,
        seed,
        approvedCandidateId: anchorCandidateId,
        shotPlanId: shotPlanSnapshot.id,
        specRevision: snapshot.specRevision,
        attemptId
      };
      if (topology.frameCount) {
        injectedPayload.frameCount = durationResult.frameCount;
      }

      return {
        enqueueInput: {
          sceneId: scene.id,
          jobKind: "production",
          workflowTemplate,
          injectedPayload
        },
        seed,
        selectedCandidateId: anchorCandidateId,
        selectedCandidateRevision: candidate.specRevision
      };
    }

    throw new InvalidTransitionError(
      scene.id,
      scene.status,
      actionName,
      `Unsupported ShotPlan routing mode: "${routingMode}".`
    );
  }

  async execute(
    input: EnqueueSceneProductionRenderInput
  ): Promise<EnqueueSceneProductionRenderResult> {
    return this.uow.execute((context) => this.executeWithContext(context, input));
  }

  async executeWithContext(
    context: UnitOfWorkContext,
    input: EnqueueSceneProductionRenderInput
  ): Promise<EnqueueSceneProductionRenderResult> {
    const scene = await context.scenes.findById(input.sceneId as SceneId);
    if (scene === undefined) {
      throw new SceneNotFoundError(input.sceneId);
    }

    if (scene.status !== "approved" && scene.status !== "failed") {
      throw new InvalidTransitionError(scene.id, scene.status, "queueForProduction");
    }

    const snapshot = scene.snapshot();
    const attemptOrdinal = (snapshot.productionAttemptOrdinal ?? 0) + 1;
    const attemptId = randomUUID();
    const { enqueueInput, seed, selectedCandidateId, selectedCandidateRevision } =
      await this.#buildProductionEnqueueInput(
        context,
        scene,
        attemptOrdinal,
        attemptId,
        "queueForProduction"
      );

    if (context.jobs === undefined) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    const job = await context.jobs.enqueue(enqueueInput);

    const createdReason = snapshot.status === "failed" ? "failure_recovery" : "initial_dispatch";

    let recordedAttemptId: string = attemptId;
    if (context.campaignProductionRuns !== undefined) {
      const attempt = await context.campaignProductionRuns.recordProductionAttempt({
        attemptId,
        sceneId: scene.id,
        runId: input.runId,
        ordinal: attemptOrdinal,
        productionJobId: job.jobId,
        specRevision: snapshot.specRevision,
        selectedCandidateId,
        selectedCandidateRevision,
        seed,
        createdReason
      });
      recordedAttemptId = attempt.attemptId;

      if (input.runId !== undefined) {
        const existingRunScene = await context.campaignProductionRuns.findRunSceneBySceneId(
          scene.id
        );
        if (existingRunScene !== undefined) {
          await context.campaignProductionRuns.updateCurrentAttempt(input.runId, scene.id, {
            attemptId: recordedAttemptId,
            attemptOrdinal,
            productionJobId: job.jobId
          });
        }
      }
    }

    scene.queueForProduction(job.jobId);
    await context.scenes.save(scene);

    return {
      scene: scene.snapshot(),
      job,
      attemptId: recordedAttemptId,
      attemptOrdinal
    };
  }

  async executeRerenderWithContext(
    context: UnitOfWorkContext,
    scene: Scene,
    run: CampaignProductionRunRecord
  ): Promise<{
    readonly job: RenderJob;
    readonly attemptId: string;
    readonly attemptOrdinal: number;
  }> {
    if (context.jobs === undefined) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    const snapshot = scene.snapshot();
    const attemptOrdinal = (snapshot.productionAttemptOrdinal ?? 0) + 1;
    const attemptId = randomUUID();
    const { enqueueInput, seed, selectedCandidateId, selectedCandidateRevision } =
      await this.#buildProductionEnqueueInput(
        context,
        scene,
        attemptOrdinal,
        attemptId,
        "requestProductionRerender"
      );

    const job = await context.jobs.enqueue(enqueueInput);

    let recordedAttemptId: string = attemptId;
    if (context.campaignProductionRuns !== undefined) {
      const attempt = await context.campaignProductionRuns.recordProductionAttempt({
        attemptId,
        sceneId: scene.id,
        runId: run.id,
        ordinal: attemptOrdinal,
        productionJobId: job.jobId,
        specRevision: snapshot.specRevision,
        selectedCandidateId,
        selectedCandidateRevision,
        seed,
        createdReason: "production_rerender"
      });
      recordedAttemptId = attempt.attemptId;

      await context.campaignProductionRuns.updateCurrentAttempt(run.id, scene.id, {
        attemptId: recordedAttemptId,
        attemptOrdinal,
        productionJobId: job.jobId
      });
    }

    return { job, attemptId: recordedAttemptId, attemptOrdinal };
  }
}
