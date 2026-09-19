import {
  InvalidTransitionError,
  type CampaignProductionRunRecord,
  type RenderJob,
  type Scene,
  type SceneId,
  type SceneSnapshot
} from "@cco/domain";
import { getProfileInjectionTopology } from "@cco/contracts";
import type { EnqueueJobInput } from "../ports/job-queue-port.js";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
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

export const LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f";
export const LTX_TEXT_PRODUCTION_RENDER_PROFILE_KEY = "LTX_25_720P_5S_V1";
export const LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f-i2v";
export const LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY = "LTX_25_720P_5S_I2V_V1";

export const MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE = "minimax-h3-720p-124f-i2v";
export const MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY = "MINIMAX_H3_720P_5S_I2V_V1";

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
  "minimax_h3",
  "minimax-h3"
]);

export interface EnqueueSceneProductionRenderOptions {
  /**
   * Reserved for future production execution options. Reviewed production
   * unconditionally dispatches the certified conditioned profile (LTX_25_720P_5S_I2V_V1)
   * with zero silent fallback to text-only generation.
   */
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

export class EnqueueSceneProductionRenderUseCase {
  constructor(
    private readonly uow: UnitOfWork,
    _options?: EnqueueSceneProductionRenderOptions
  ) {}

  #buildProductionEnqueueInput(
    scene: Scene,
    attemptOrdinal: number,
    actionName: string = "queueForProduction"
  ): { readonly enqueueInput: EnqueueJobInput; readonly seed: number } {
    const snapshot = scene.snapshot();
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

    const isMiniMax = isMiniMaxEngineOrProfile(snapshot.configuration.engineProfileId);

    const durationResult = isMiniMax
      ? mapDurationMsToMiniMaxH3FrameCount(snapshot.configuration.durationMs)
      : mapDurationMsToLtxFrameCount(snapshot.configuration.durationMs);

    if (!durationResult.ok) {
      throw new UnsupportedProductionDurationError(
        snapshot.configuration.durationMs,
        durationResult.reason
      );
    }

    const workflowTemplate = isMiniMax
      ? MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE
      : LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE;
    const renderProfileKey = isMiniMax
      ? MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY
      : LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY;

    const topology = getProfileInjectionTopology(renderProfileKey);
    if (!topology) {
      throw new ConditionedProductionProfileUnavailableError(scene.id, renderProfileKey);
    }

    const seed = deriveProductionSeed(scene.id, snapshot.specRevision, attemptOrdinal);

    const injectedPayload: Record<string, unknown> = {
      prompt: snapshot.configuration.prompt,
      seed,
      approvedCandidateId: snapshot.selectedCandidateId
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
      seed
    };
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
    const { enqueueInput, seed } = this.#buildProductionEnqueueInput(
      scene,
      attemptOrdinal,
      "queueForProduction"
    );

    if (context.jobs === undefined) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    const job = await context.jobs.enqueue(enqueueInput);

    const createdReason = snapshot.status === "failed" ? "failure_recovery" : "initial_dispatch";

    let attemptId = `attempt-${job.jobId}`;
    if (context.campaignProductionRuns !== undefined) {
      const attempt = await context.campaignProductionRuns.recordProductionAttempt({
        sceneId: scene.id,
        runId: input.runId,
        ordinal: attemptOrdinal,
        productionJobId: job.jobId,
        specRevision: snapshot.specRevision,
        selectedCandidateId: snapshot.selectedCandidateId,
        selectedCandidateRevision: snapshot.selectedCandidateRevision,
        seed,
        createdReason
      });
      attemptId = attempt.attemptId;

      if (input.runId !== undefined) {
        const existingRunScene = await context.campaignProductionRuns.findRunSceneBySceneId(
          scene.id
        );
        if (existingRunScene !== undefined) {
          await context.campaignProductionRuns.updateCurrentAttempt(input.runId, scene.id, {
            attemptId: attempt.attemptId,
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
      attemptId,
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
    const { enqueueInput, seed } = this.#buildProductionEnqueueInput(
      scene,
      attemptOrdinal,
      "requestProductionRerender"
    );

    const job = await context.jobs.enqueue(enqueueInput);

    let attemptId = `attempt-${job.jobId}`;
    if (context.campaignProductionRuns !== undefined) {
      const attempt = await context.campaignProductionRuns.recordProductionAttempt({
        sceneId: scene.id,
        runId: run.id,
        ordinal: attemptOrdinal,
        productionJobId: job.jobId,
        specRevision: snapshot.specRevision,
        selectedCandidateId: snapshot.selectedCandidateId,
        selectedCandidateRevision: snapshot.selectedCandidateRevision,
        seed,
        createdReason: "production_rerender"
      });
      attemptId = attempt.attemptId;

      await context.campaignProductionRuns.updateCurrentAttempt(run.id, scene.id, {
        attemptId,
        attemptOrdinal,
        productionJobId: job.jobId
      });
    }

    return { job, attemptId, attemptOrdinal };
  }
}
