import { randomUUID } from "node:crypto";
import {
  type AcceptanceAssemblyJob,
  type AcceptanceRunScene,
  type AssembleOperatorAcceptanceRunRequest,
  type AssembleOperatorAcceptanceRunResponse,
  type BeginOperatorAcceptanceRunRequest,
  type BeginOperatorAcceptanceRunResponse,
  type OperatorAcceptanceRun,
  CampaignDurationPlanningError,
  OperatorAcceptanceRunNotFoundError,
  OperatorAcceptanceSceneNotFoundError,
  OperatorAcceptanceOrdinalMismatchError,
  OperatorAcceptanceInvalidStatusError,
  OperatorAcceptanceSceneNotAcceptedError
} from "@cco/contracts";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
import type { VideoStemSourceRecord } from "../ports/generation-manifest-repository.js";
import { validateAssemblySpec } from "../ports/assembly-spec.js";

export interface OperatorAcceptanceRunDependencies {
  readonly uow: UnitOfWork;
  readonly stageRenderUseCase?: StageH3CandidateRenderUseCase | undefined;
  readonly stagingAuthSource?: StagingPlanningAuthorizationSource | undefined;
}

export class BeginOperatorAcceptanceRunUseCase {
  constructor(private readonly deps: OperatorAcceptanceRunDependencies) {}

  async execute(
    input: BeginOperatorAcceptanceRunRequest
  ): Promise<BeginOperatorAcceptanceRunResponse> {
    return await this.deps.uow.execute(async (context) => {
      if (!context.campaigns) {
        throw new Error("UnitOfWorkContext.campaigns is not configured");
      }
      if (!context.durationPlans) {
        throw new Error("UnitOfWorkContext.durationPlans is not configured");
      }
      if (!context.scenes?.findByCampaignId) {
        throw new Error("UnitOfWorkContext.scenes is not configured");
      }
      if (!context.operatorAcceptanceRuns) {
        throw new Error("UnitOfWorkContext.operatorAcceptanceRuns is not configured");
      }

      const campaign = await context.campaigns.findById(input.campaignId);
      if (!campaign) {
        throw new Error(`Campaign '${input.campaignId}' not found`);
      }

      const currentPlan = await context.durationPlans.findCurrentPlanByCampaignId(campaign.id);
      if (!currentPlan) {
        throw new CampaignDurationPlanningError(
          "stale_plan",
          `Campaign '${campaign.id}' has no duration plan`
        );
      }

      if (currentPlan.scope !== "staging") {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          `Campaign '${campaign.id}' duration plan is in production scope. Operator acceptance runs require staging scope.`
        );
      }

      const scenes = await context.scenes.findByCampaignId(campaign.id);
      const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      const acceptanceRunId = randomUUID();
      const now = new Date().toISOString();

      const run: OperatorAcceptanceRun = {
        acceptanceRunId,
        campaignId: campaign.id,
        status: "dispatched",
        realm: currentPlan.realm,
        evidenceOrigin:
          currentPlan.realm.kind === "isolated_test" ? "simulated_test" : "live_execution",
        planId: currentPlan.planId,
        expectedTotalDurationMs: currentPlan.totalNominalDurationMs,
        createdBy: input.requestedBy,
        createdAt: now,
        updatedAt: now
      };

      const runScenes: AcceptanceRunScene[] = [];
      const dispatchedJobIds: string[] = [];

      for (let i = 0; i < sortedScenes.length; i++) {
        const scene = sortedScenes[i]!;
        const allocation =
          currentPlan.allocations.find((a) => a.ordinal === scene.sequenceIndex) ??
          currentPlan.allocations[i];

        if (!allocation) {
          throw new CampaignDurationPlanningError(
            "no_feasible_allocation",
            `No duration allocation found for scene ${scene.id} at sequence ${scene.sequenceIndex}`
          );
        }

        const candidateKey = allocation.profileSelection.profileKey;
        if (
          !this.deps.stagingAuthSource ||
          allocation.profileSelection.kind !== "staging_candidate"
        ) {
          throw new CampaignDurationPlanningError(
            "authorization_denied",
            `Operator acceptance runs require staging_candidate profile selection and configured stagingAuthSource`
          );
        }

        const grant = await this.deps.stagingAuthSource.resolveCandidateGrant(
          allocation.profileSelection.authorizationId,
          allocation.profileSelection.targetId,
          allocation.profileSelection.profileKey
        );

        if (!grant) {
          throw new CampaignDurationPlanningError(
            "authorization_denied",
            `No valid candidate authorization grant found for authorizationId '${allocation.profileSelection.authorizationId}' on target '${allocation.profileSelection.targetId}'`
          );
        }

        if (!this.deps.stageRenderUseCase) {
          throw new CampaignDurationPlanningError(
            "capability_unavailable",
            "StageH3CandidateRenderUseCase is required to stage candidate render jobs"
          );
        }

        const renderResult = await this.deps.stageRenderUseCase.executeWithContext(context, {
          sceneId: scene.id,
          candidateProfileKey: candidateKey,
          grant,
          requestId: `stage-${acceptanceRunId}-${scene.id}`,
          ownerKind: "staging_acceptance",
          acceptanceRunId
        });
        const stagingJobId = String(renderResult.job.jobId);
        const attemptId = String(renderResult.attemptId);

        dispatchedJobIds.push(stagingJobId);

        runScenes.push({
          acceptanceRunId,
          sceneId: scene.id,
          allocationId: allocation.allocationId,
          specRevision: scene.specRevision,
          sequenceIndex: scene.sequenceIndex,
          profileKey: candidateKey,
          frames: allocation.frames,
          fps: allocation.fps,
          expectedDurationMs: allocation.nominalDurationMs,
          currentAttemptId: attemptId,
          currentAttemptOrdinal: 1,
          acceptedStagingJobId: stagingJobId,
          acceptedAttemptId: undefined,
          acceptedAttemptOrdinal: undefined
        });
      }

      await context.operatorAcceptanceRuns.createRun(run, runScenes);

      return {
        acceptanceRunId,
        campaignId: campaign.id,
        status: "dispatched",
        sceneCount: sortedScenes.length,
        dispatchedJobIds
      };
    });
  }
}

export class AcceptOperatorAcceptanceSceneUseCase {
  constructor(private readonly deps: { readonly uow: UnitOfWork }) {}

  async execute(input: {
    readonly acceptanceRunId: string;
    readonly sceneId: string;
    readonly actionId: string;
    readonly expectedAttemptOrdinal: number;
    readonly acceptedBy: string;
  }): Promise<{ readonly accepted: boolean }> {
    return await this.deps.uow.execute(async (context) => {
      if (!context.operatorAcceptanceRuns) {
        throw new Error("UnitOfWorkContext.operatorAcceptanceRuns is not configured");
      }

      const run = await context.operatorAcceptanceRuns.findRunById(input.acceptanceRunId);
      if (!run) {
        throw new OperatorAcceptanceRunNotFoundError(input.acceptanceRunId);
      }

      const runScenes = await context.operatorAcceptanceRuns.findRunScenes(input.acceptanceRunId);
      const scene = runScenes.find((s) => s.sceneId === input.sceneId);
      if (!scene) {
        throw new OperatorAcceptanceSceneNotFoundError(input.acceptanceRunId, input.sceneId);
      }

      if (scene.currentAttemptOrdinal !== input.expectedAttemptOrdinal) {
        throw new OperatorAcceptanceOrdinalMismatchError(
          input.expectedAttemptOrdinal,
          scene.currentAttemptOrdinal
        );
      }

      if (!scene.currentAttemptId) {
        throw new CampaignDurationPlanningError(
          "observation_authority_invalid",
          `Scene '${input.sceneId}' has no current attempt to accept`
        );
      }

      const stagingJobId = scene.acceptedStagingJobId;
      if (!stagingJobId) {
        throw new CampaignDurationPlanningError(
          "observation_authority_invalid",
          `Scene '${input.sceneId}' has no staged job to accept`
        );
      }

      if (!context.generationManifests?.findVideoStemSourceByJobId) {
        throw new CampaignDurationPlanningError(
          "observation_authority_invalid",
          "UnitOfWorkContext.generationManifests is not configured"
        );
      }

      const stemSource = await context.generationManifests.findVideoStemSourceByJobId(stagingJobId);
      if (!stemSource) {
        throw new CampaignDurationPlanningError(
          "observation_authority_invalid",
          `No generation manifest or video stem source found for job '${stagingJobId}'`
        );
      }

      if (!stemSource.measuredMedia) {
        throw new CampaignDurationPlanningError(
          "observation_authority_invalid",
          `Video stem source for staging job '${stagingJobId}' is missing required measuredMedia`
        );
      }

      await context.operatorAcceptanceRuns.updateSceneAcceptedAttempt(
        input.acceptanceRunId,
        input.sceneId,
        scene.currentAttemptId,
        stagingJobId,
        scene.currentAttemptOrdinal
      );

      return { accepted: true };
    });
  }
}

export class AssembleOperatorAcceptanceRunUseCase {
  constructor(private readonly deps: { readonly uow: UnitOfWork }) {}

  async execute(
    input: AssembleOperatorAcceptanceRunRequest & { readonly acceptanceRunId: string }
  ): Promise<AssembleOperatorAcceptanceRunResponse> {
    return await this.deps.uow.execute(async (context) => {
      if (!context.operatorAcceptanceRuns) {
        throw new Error("UnitOfWorkContext.operatorAcceptanceRuns is not configured");
      }
      if (!context.acceptanceAssemblyJobs) {
        throw new Error("UnitOfWorkContext.acceptanceAssemblyJobs is not configured");
      }

      const run = await context.operatorAcceptanceRuns.findRunById(input.acceptanceRunId);
      if (!run) {
        throw new OperatorAcceptanceRunNotFoundError(input.acceptanceRunId);
      }

      if (
        (run.status === "assembling" || run.status === "completed") &&
        run.assemblyJobId &&
        run.actionReceiptId === input.actionId
      ) {
        return {
          acceptanceRunId: run.acceptanceRunId,
          status: "assembling",
          assemblyJobId: run.assemblyJobId
        };
      }

      if (run.status !== "dispatched") {
        throw new OperatorAcceptanceInvalidStatusError(run.status);
      }

      const runScenes = await context.operatorAcceptanceRuns.findRunScenes(input.acceptanceRunId);
      if (runScenes.length === 0) {
        throw new CampaignDurationPlanningError(
          "no_feasible_allocation",
          `Acceptance run '${input.acceptanceRunId}' has no scenes`
        );
      }

      for (const scene of runScenes) {
        if (!scene.acceptedAttemptId) {
          throw new OperatorAcceptanceSceneNotAcceptedError(scene.sceneId);
        }
      }

      const sortedScenes = [...runScenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      const expectedTotalDurationMs = sortedScenes.reduce(
        (sum, s) => sum + s.expectedDurationMs,
        0
      );

      const videoStems = [];
      for (let idx = 0; idx < sortedScenes.length; idx++) {
        const s = sortedScenes[idx]!;
        if (!s.acceptedStagingJobId) {
          throw new CampaignDurationPlanningError(
            "observation_authority_invalid",
            `Scene '${s.sceneId}' is missing accepted staging job ID`
          );
        }
        let stemSource: VideoStemSourceRecord | undefined;
        if (context.generationManifests?.findVideoStemSourceByJobId) {
          stemSource = await context.generationManifests.findVideoStemSourceByJobId(
            s.acceptedStagingJobId
          );
        }
        if (!stemSource) {
          throw new CampaignDurationPlanningError(
            "observation_authority_invalid",
            `Generation manifest and video stem source not found for accepted staging job '${s.acceptedStagingJobId}'`
          );
        }
        videoStems.push({
          order: idx,
          sceneId: s.sceneId,
          generationManifestId: stemSource.generationManifestId,
          expectedDurationMs: s.expectedDurationMs,
          media: stemSource.media
        });
      }

      const assemblyJobId = randomUUID();
      const jobInput: Omit<AcceptanceAssemblyJob, "status" | "createdAt" | "updatedAt"> = {
        jobId: assemblyJobId,
        acceptanceRunId: run.acceptanceRunId,
        campaignId: run.campaignId,
        realm: run.realm,
        evidenceOrigin: run.realm.kind === "isolated_test" ? "simulated_test" : "live_execution",
        assemblySpec: {
          campaignId: run.campaignId,
          assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
          expectedTotalDurationMs,
          videoStems,
          subtitleCues: []
        }
      };

      validateAssemblySpec(jobInput.assemblySpec);

      await context.acceptanceAssemblyJobs.enqueue(jobInput);
      await context.operatorAcceptanceRuns.updateRunStatus(
        run.acceptanceRunId,
        "assembling",
        assemblyJobId,
        input.actionId
      );

      return {
        acceptanceRunId: run.acceptanceRunId,
        assemblyJobId,
        status: "assembling"
      };
    });
  }
}
