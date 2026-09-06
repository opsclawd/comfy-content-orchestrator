import {
  InvalidTransitionError,
  type RenderJob,
  type SceneId,
  type SceneSnapshot
} from "@cco/domain";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import { deriveProductionSeed } from "./derive-production-seed.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import {
  mapDurationMsToLtxFrameCount,
  UnsupportedProductionDurationError
} from "./map-production-duration.js";
import { UnrepresentableProductionConfigurationError } from "./production-configuration-errors.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export const LTX_PRODUCTION_WORKFLOW_TEMPLATE = "ltx-25-720p-97f";
export const SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID = "LTX_25_720P_5S_V1";

export interface EnqueueSceneProductionRenderInput {
  readonly sceneId: string;
}

export interface EnqueueSceneProductionRenderResult {
  readonly scene: Readonly<SceneSnapshot>;
  readonly job: RenderJob;
}

export class EnqueueSceneProductionRenderUseCase {
  constructor(private readonly uow: UnitOfWork) {}

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
    if (
      snapshot.configuration.engineProfileId !== SUPPORTED_PRODUCTION_ENGINE_PROFILE_ID &&
      snapshot.configuration.engineProfileId !== "ltx_25"
    ) {
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

    const seed = deriveProductionSeed(scene.id, snapshot.specRevision);

    if (context.jobs === undefined) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    const job = await context.jobs.enqueue({
      sceneId: scene.id,
      jobKind: "production",
      workflowTemplate: LTX_PRODUCTION_WORKFLOW_TEMPLATE,
      injectedPayload: {
        prompt: snapshot.configuration.prompt,
        seed,
        frameCount: durationResult.frameCount,
        approvedCandidateId: snapshot.selectedCandidateId
      }
    });

    scene.queueForProduction(job.jobId);
    await context.scenes.save(scene);

    return {
      scene: scene.snapshot(),
      job
    };
  }
}
