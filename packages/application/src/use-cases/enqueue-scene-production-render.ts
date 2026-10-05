import { randomUUID } from "node:crypto";
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
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { HashBytesPort } from "../ports/hash-bytes.js";
import type { ImageInspectionPort } from "../ports/image-inspection-port.js";
import { deriveProductionSeed } from "./derive-production-seed.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import { PrepareSceneProductionInputsUseCase } from "./prepare-scene-production-inputs.js";
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
  LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE,
  LTX_TEXT_PRODUCTION_RENDER_PROFILE_KEY,
  LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY,
  MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY,
  MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
  PRODUCTION_WORKFLOW_TEMPLATE,
  PRODUCTION_RENDER_PROFILE_KEY,
  LTX_PRODUCTION_WORKFLOW_TEMPLATE,
  SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID,
  ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS
} from "./production-profile-constants.js";

export {
  LTX_TEXT_PRODUCTION_WORKFLOW_TEMPLATE,
  LTX_TEXT_PRODUCTION_RENDER_PROFILE_KEY,
  LTX_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  LTX_I2V_PRODUCTION_RENDER_PROFILE_KEY,
  MINIMAX_H3_I2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_I2V_PRODUCTION_RENDER_PROFILE_KEY,
  MINIMAX_H3_REF2V_PRODUCTION_WORKFLOW_TEMPLATE,
  MINIMAX_H3_REF2V_PRODUCTION_RENDER_PROFILE_KEY,
  PRODUCTION_WORKFLOW_TEMPLATE,
  PRODUCTION_RENDER_PROFILE_KEY,
  LTX_PRODUCTION_WORKFLOW_TEMPLATE,
  SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID,
  ACCEPTED_PRODUCTION_ENGINE_PROFILE_IDS
};

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

export class EnqueueSceneProductionRenderUseCase {
  public readonly prepareInputsUseCase: PrepareSceneProductionInputsUseCase;

  constructor(
    private readonly uow: UnitOfWork,
    options?: EnqueueSceneProductionRenderOptions
  ) {
    this.prepareInputsUseCase = new PrepareSceneProductionInputsUseCase(uow, options);
  }

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

    // MiniMax-H3 production admission & conditioning preparation
    const prep = await this.prepareInputsUseCase.executeWithContext(context, {
      sceneId: scene.id,
      dryRun: false
    });

    const route = prep.inspection.route;
    const topology = getProfileInjectionTopology(route.renderProfileKey);
    if (!topology) {
      throw new ConditionedProductionProfileUnavailableError(scene.id, route.renderProfileKey);
    }

    const injectedPayload: Record<string, unknown> = {
      prompt: snapshot.configuration.prompt,
      seed,
      shotPlanId: prep.inspection.authority.shotPlanId,
      specRevision: snapshot.specRevision,
      attemptId,
      productionInputFingerprint: prep.inspection.productionInputFingerprint,
      ...(route.routingMode === "frame_anchored" && prep.inspection.visualInputs.frameAnchor
        ? { approvedCandidateId: prep.inspection.visualInputs.frameAnchor.anchorCandidateId }
        : {})
    };
    if (topology.frameCount) {
      injectedPayload.frameCount = prep.frameCount;
    }

    return {
      enqueueInput: {
        sceneId: scene.id,
        jobKind: "production",
        workflowTemplate: route.workflowTemplate,
        injectedPayload
      },
      seed,
      selectedCandidateId:
        route.routingMode === "frame_anchored"
          ? (prep.inspection.visualInputs.frameAnchor?.anchorCandidateId ?? undefined)
          : undefined,
      selectedCandidateRevision:
        route.routingMode === "frame_anchored" ? snapshot.specRevision : undefined
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
