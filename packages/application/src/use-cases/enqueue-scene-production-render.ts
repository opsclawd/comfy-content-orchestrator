import {
  InvalidTransitionError,
  type RenderJob,
  type SceneId,
  type SceneSnapshot
} from "@cco/domain";
import { getProfileInjectionTopology } from "@cco/contracts";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { deriveProductionSeed } from "./derive-production-seed.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import {
  mapDurationMsToLtxFrameCount,
  UnsupportedProductionDurationError
} from "./map-production-duration.js";
import {
  ConditionedProductionProfileUnavailableError,
  UnrepresentableProductionConfigurationError
} from "./production-configuration-errors.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export const LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f";
export const LTX_TEXT_PRODUCTION_RENDER_PROFILE_KEY = "LTX_25_720P_5S_V1";
export const LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f-i2v";
export const LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY = "LTX_25_720P_5S_I2V_V1";

export const PRODUCTION_WORKFLOW_TEMPLATE = LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE;
export const PRODUCTION_RENDER_PROFILE_KEY = LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY;
export const LTX_PRODUCTION_WORKFLOW_TEMPLATE = PRODUCTION_WORKFLOW_TEMPLATE;
export const SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID = "LTX_25_720P_5S_V1";

export const ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS: ReadonlySet<string> = new Set([
  "LTX_25_720P_5S_V1",
  "ltx_25",
  "LTX_25_720P_5S_I2V_V1",
  "ltx_25_i2v"
]);

export interface EnqueueSceneProductionRenderOptions {
  /**
   * Explicit deployment configuration controlling activation of the conditioned
   * (I2V) production profile. When not enabled (default), normal production dispatch
   * preserves the certified text-to-video workflow so production does not fail closed
   * against the checked-in component license registry before operator approval.
   */
  readonly enableConditionedProfile?: boolean | undefined;
}

export interface EnqueueSceneProductionRenderInput {
  readonly sceneId: string;
}

export interface EnqueueSceneProductionRenderResult {
  readonly scene: Readonly<SceneSnapshot>;
  readonly job: RenderJob;
}

export class EnqueueSceneProductionRenderUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly options?: EnqueueSceneProductionRenderOptions
  ) {}

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
    if (
      snapshot.selectedCandidateId === undefined ||
      snapshot.selectedCandidateRevision !== snapshot.specRevision
    ) {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        "queueForProduction",
        `Production requires a valid candidate selection from revision ${snapshot.specRevision}.`
      );
    }

    const unrepresentable: string[] = [];
    if (!ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS.has(snapshot.configuration.engineProfileId)) {
      unrepresentable.push("engineProfileId");
    }
    if (snapshot.configuration.referenceIds.length > 0) {
      unrepresentable.push("referenceIds");
    }
    if (
      snapshot.configuration.loraConfigurationId !== undefined &&
      snapshot.configuration.loraConfigurationId !== null
    ) {
      unrepresentable.push("loraConfigurationId");
    }
    if (unrepresentable.length > 0) {
      throw new UnrepresentableProductionConfigurationError(scene.id, unrepresentable);
    }

    const durationResult = mapDurationMsToLtxFrameCount(snapshot.configuration.durationMs);
    if (!durationResult.ok) {
      throw new UnsupportedProductionDurationError(
        snapshot.configuration.durationMs,
        durationResult.reason
      );
    }

    const isI2vEngine =
      snapshot.configuration.engineProfileId === "LTX_25_720P_5S_I2V_V1" ||
      snapshot.configuration.engineProfileId === "ltx_25_i2v";

    const isDeploymentEnabled =
      this.options?.enableConditionedProfile ??
      (process.env.ENABLE_I2V_PRODUCTION === "true" ||
        process.env.CCO_ENABLE_I2V_PRODUCTION === "true");

    const useConditionedProfile = isI2vEngine || isDeploymentEnabled;

    const workflowTemplate = useConditionedProfile
      ? LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE
      : LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE;
    const renderProfileKey = useConditionedProfile
      ? LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY
      : LTX_TEXT_PRODUCTION_RENDER_PROFILE_KEY;

    const topology = getProfileInjectionTopology(renderProfileKey);
    if (!topology) {
      throw new ConditionedProductionProfileUnavailableError(scene.id, renderProfileKey);
    }

    const seed = deriveProductionSeed(scene.id, snapshot.specRevision);

    if (context.jobs === undefined) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    const injectedPayload: Record<string, unknown> = {
      prompt: snapshot.configuration.prompt,
      seed,
      approvedCandidateId: snapshot.selectedCandidateId
    };
    if (topology.frameCount) {
      injectedPayload.frameCount = durationResult.frameCount;
    }

    const job = await context.jobs.enqueue({
      sceneId: scene.id,
      jobKind: "production",
      workflowTemplate,
      injectedPayload
    });

    scene.queueForProduction(job.jobId);
    await context.scenes.save(scene);

    return {
      scene: scene.snapshot(),
      job
    };
  }
}
