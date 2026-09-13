import { ReviewEventSchema } from "@cco/contracts";
import {
  AlreadyAcceptedProductionAttemptError,
  InvalidTransitionError,
  type CampaignProductionRunRecord,
  type CampaignProductionRunSceneRecord,
  type Scene
} from "@cco/domain";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import type { EnqueueSceneProductionRenderUseCase } from "./enqueue-scene-production-render.js";
import {
  prepareReviewExecution,
  type ReviewAuditInput,
  type ReviewExecutionResult
} from "./review-scene.js";
import { SceneNotInProductionRunError } from "./scene-not-in-production-run-error.js";
import { StaleProductionAttemptConflictError } from "./stale-production-attempt-conflict-error.js";

export interface ProductionReviewInput extends ReviewAuditInput {
  readonly expectedSpecRevision: number;
  readonly expectedProductionJobId: string;
}

export type ProductionAcceptInput = ProductionReviewInput;
export type ProductionRerenderInput = ProductionReviewInput;

export class ProductionReviewUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly enqueueSceneProductionRender: EnqueueSceneProductionRenderUseCase
  ) {}

  async acceptProduction(input: ProductionAcceptInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        let acceptedAttemptOrdinal: number | undefined;
        if (
          prepared.scene.snapshot().acceptedProductionAttemptId !== undefined &&
          context.campaignProductionRuns !== undefined
        ) {
          const attempt = await context.campaignProductionRuns.findAttemptByProductionJobId(
            input.expectedProductionJobId
          );
          acceptedAttemptOrdinal = attempt?.ordinal;
        }
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot(),
          ...(acceptedAttemptOrdinal !== undefined ? { acceptedAttemptOrdinal } : {})
        };
      }

      const scene = prepared.scene;
      if (scene.snapshot().acceptedProductionAttemptId !== undefined) {
        throw new AlreadyAcceptedProductionAttemptError(scene.id);
      }
      if (scene.status !== "qa") {
        throw new InvalidTransitionError(scene.id, scene.status, "acceptProductionAttempt");
      }

      const { run } = await this.resolveAndLockRun(context, scene, input.expectedProductionJobId);

      const runsRepo = context.campaignProductionRuns;
      if (runsRepo === undefined) {
        throw new SceneNotInProductionRunError(scene.id);
      }

      const attempt = await runsRepo.findAttemptByProductionJobId(input.expectedProductionJobId);
      if (attempt === undefined) {
        throw new Error(
          `Production attempt record not found for active job '${input.expectedProductionJobId}' on scene '${scene.id}'.`
        );
      }

      const recordResult = await runsRepo.recordAcceptedAttempt(run.id, scene.id, {
        attemptId: attempt.attemptId,
        attemptOrdinal: attempt.ordinal,
        productionJobId: input.expectedProductionJobId
      });
      if (!recordResult.accepted) {
        throw new AlreadyAcceptedProductionAttemptError(scene.id);
      }

      const priorSceneStatus = scene.status;
      const transition = scene.acceptProductionAttempt(attempt.attemptId);

      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action: "production_accept",
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: {
          acceptedAttemptId: attempt.attemptId,
          acceptedAttemptOrdinal: attempt.ordinal,
          productionJobId: input.expectedProductionJobId
        },
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        expectedSpecRevision: input.expectedSpecRevision,
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });

      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot(),
        acceptedAttemptOrdinal: attempt.ordinal
      };
    });
  }

  async requestProductionRerender(input: ProductionRerenderInput): Promise<ReviewExecutionResult> {
    return await this.uow.execute(async (context) => {
      const prepared = await prepareReviewExecution(context, input);
      if (prepared.isIdempotentReplay) {
        return {
          isIdempotentReplay: true,
          scene: prepared.scene.snapshot()
        };
      }

      const scene = prepared.scene;
      if (scene.status !== "qa") {
        throw new InvalidTransitionError(scene.id, scene.status, "requestProductionRerender");
      }

      const { run } = await this.resolveAndLockRun(context, scene, input.expectedProductionJobId);

      const rerenderResult = await this.enqueueSceneProductionRender.executeRerenderWithContext(
        context,
        scene,
        run
      );

      const priorSceneStatus = scene.status;
      const transition = scene.requestProductionRerender(rerenderResult.job.jobId);

      const event = ReviewEventSchema.parse({
        eventId: input.eventId,
        sceneId: input.sceneId,
        reviewerName: input.reviewerName,
        action: "production_rerender",
        ...(input.directorNotes !== undefined ? { directorNotes: input.directorNotes } : {}),
        mutationPayload: {
          productionJobId: rerenderResult.job.jobId,
          attemptId: rerenderResult.attemptId,
          attemptOrdinal: rerenderResult.attemptOrdinal,
          previousProductionJobId: input.expectedProductionJobId
        },
        priorSceneStatus,
        resultingSceneStatus: transition.to,
        expectedSpecRevision: input.expectedSpecRevision,
        ...(input.resultingSpecRevision !== undefined
          ? { resultingSpecRevision: input.resultingSpecRevision }
          : {}),
        ...(input.requestHashSha256 !== undefined
          ? { requestHashSha256: input.requestHashSha256 }
          : {}),
        occurredAt: input.occurredAt
      });

      await context.reviewEvents.append(event);
      await context.scenes.save(scene);

      return {
        isIdempotentReplay: false,
        scene: scene.snapshot()
      };
    });
  }

  private async resolveAndLockRun(
    context: UnitOfWorkContext,
    scene: Scene,
    expectedProductionJobId: string
  ): Promise<{
    readonly run: CampaignProductionRunRecord;
    readonly runScene: CampaignProductionRunSceneRecord;
  }> {
    const runsRepo = context.campaignProductionRuns;
    if (runsRepo === undefined) {
      throw new SceneNotInProductionRunError(scene.id);
    }

    const snapshot = scene.snapshot();
    const currentJobId = snapshot.activeProductionJobId;
    if (currentJobId === undefined) {
      throw new Error(`Scene '${scene.id}' in qa has no active production job id.`);
    }

    const runScene = await runsRepo.findRunSceneByProductionJobId(currentJobId);
    if (runScene === undefined) {
      throw new SceneNotInProductionRunError(scene.id);
    }

    if (runScene.sceneId !== scene.id) {
      throw new Error(
        `Run scene '${runScene.sceneId}' does not match expected scene '${scene.id}'.`
      );
    }

    const run = await runsRepo.findByIdForUpdate(runScene.runId);
    if (run === undefined) {
      throw new Error(
        `Campaign production run '${runScene.runId}' not found for scene '${scene.id}'.`
      );
    }

    if (currentJobId !== expectedProductionJobId) {
      throw new StaleProductionAttemptConflictError(
        scene.id,
        expectedProductionJobId,
        currentJobId
      );
    }

    return { run, runScene };
  }
}
