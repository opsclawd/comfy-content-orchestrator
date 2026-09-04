import { InvalidTransitionError } from "@cco/domain";
import type { RenderJob, Scene, SceneId, SceneSnapshot } from "@cco/domain";
import type { JobQueuePort } from "../ports/job-queue-port.js";
import type {
  RenderEnginePort,
  RenderQueueReceipt,
  RenderWorkflow
} from "../ports/render-engine-port.js";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import {
  JobDispatchUnavailableError,
  TransactionalJobEnqueuerUnavailableError
} from "./job-queue-errors.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export const CANDIDATE_BATCH_SIZE = 3;
export const CANDIDATE_WORKFLOW_TEMPLATE = "flux-schnell-draft";
export const CANDIDATE_BASE_SEED = 42;

export interface GenerationAdmissionResult {
  readonly scene: Readonly<SceneSnapshot>;
  readonly enqueuedJobs: readonly RenderJob[];
}

export interface ProgressSceneProductionInput {
  readonly sceneId: string;
  readonly renderJobId?: string;
  readonly renderProfileKey?: string;
}

export interface QueueSceneProductionInput extends ProgressSceneProductionInput {
  readonly workflow: RenderWorkflow;
}

export class ProgressSceneProductionUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly renderEngine?: RenderEnginePort,
    private readonly jobQueue?: JobQueuePort
  ) {}

  async beginCandidateGeneration(
    input: ProgressSceneProductionInput
  ): Promise<GenerationAdmissionResult> {
    if (this.jobQueue === undefined) {
      throw new JobDispatchUnavailableError();
    }

    let snapshot: Readonly<SceneSnapshot> | undefined;
    const enqueuedJobs: RenderJob[] = [];

    await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
      }
      if (scene.status !== "draft_pending") {
        throw new InvalidTransitionError(scene.id, scene.status, "beginCandidateGeneration");
      }
      if (context.jobs === undefined) {
        throw new TransactionalJobEnqueuerUnavailableError();
      }
      scene.beginCandidateGeneration();
      await context.scenes.save(scene);
      snapshot = scene.snapshot();

      for (let variantOrdinal = 1; variantOrdinal <= CANDIDATE_BATCH_SIZE; variantOrdinal++) {
        const job = await context.jobs.enqueue({
          sceneId: snapshot.id,
          jobKind: "candidate",
          workflowTemplate: CANDIDATE_WORKFLOW_TEMPLATE,
          injectedPayload: {
            prompt: snapshot.configuration.prompt,
            seed: CANDIDATE_BASE_SEED + variantOrdinal,
            variantOrdinal
          }
        });
        enqueuedJobs.push(job);
      }
    });

    return {
      scene: snapshot!,
      enqueuedJobs
    };
  }

  async submitCandidatesForReview(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) =>
      scene.submitCandidatesForReview()
    );
  }

  async queue(input: QueueSceneProductionInput): Promise<RenderQueueReceipt | undefined> {
    let engineProfileId: string | undefined;

    await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(input.sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(input.sceneId);
      }
      scene.queueForProduction();
      await context.scenes.save(scene);
      engineProfileId = scene.snapshot().configuration.engineProfileId;
    });

    if (this.renderEngine !== undefined) {
      const renderJobId = input.renderJobId ?? input.sceneId;
      const renderProfileKey = input.renderProfileKey ?? engineProfileId ?? "default";
      return await this.renderEngine.queueRender({
        sceneId: input.sceneId,
        renderJobId,
        renderProfileKey,
        workflow: input.workflow
      });
    }

    return undefined;
  }

  async markRenderingStarted(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.startRendering());
  }

  async submitForQA(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.submitForQA());
  }

  async fail(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.fail());
  }

  async recoverToReview(input: ProgressSceneProductionInput): Promise<void> {
    await this.executeProductionTransition(input.sceneId, (scene) => scene.recoverToReview());
  }

  private async executeProductionTransition(
    sceneId: string,
    transition: (scene: Scene) => void
  ): Promise<void> {
    await this.uow.execute(async (context) => {
      const scene = await context.scenes.findById(sceneId as SceneId);
      if (scene === undefined) {
        throw new SceneNotFoundError(sceneId);
      }
      transition(scene);
      await context.scenes.save(scene);
    });
  }
}
