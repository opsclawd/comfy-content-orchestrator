import { createHash, randomUUID } from "node:crypto";
import {
  type AcceptanceAssemblyJob,
  type AcceptanceRunScene,
  type AssembleOperatorAcceptanceRunRequest,
  type AssembleOperatorAcceptanceRunResponse,
  type BeginOperatorAcceptanceRunRequest,
  type BeginOperatorAcceptanceRunResponse,
  type OperatorAcceptanceRun,
  canonicalizeJson,
  CampaignDurationPlanningError,
  OperatorAcceptanceRunNotFoundError,
  OperatorAcceptanceSceneNotFoundError,
  OperatorAcceptanceOrdinalMismatchError,
  OperatorAcceptanceInvalidStatusError,
  OperatorAcceptanceSceneNotAcceptedError,
  OperatorAcceptanceIdempotencyConflictError
} from "@cco/contracts";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import type { StageH3CandidateRenderUseCase } from "./stage-h3-candidate-render.js";
import type { StagingPlanningAuthorizationSource } from "../ports/staging-planning-authorization-ports.js";
import type { VideoStemSourceRecord } from "../ports/generation-manifest-repository.js";
import { validateAssemblySpec } from "../ports/assembly-spec.js";

export function computeAcceptanceActionRequestHash(action: string, payload: unknown): string {
  return createHash("sha256").update(canonicalizeJson({ action, payload })).digest("hex");
}

export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function validateAcceptanceStemSource(
  scene: AcceptanceRunScene,
  stemSource: VideoStemSourceRecord,
  expectedRunContext?: {
    realm?: unknown;
    evidenceOrigin?: unknown;
  }
): void {
  if (!stemSource.renderProfile || stemSource.renderProfile !== scene.profileKey) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem renderProfile '${stemSource.renderProfile}' does not match scene profileKey '${scene.profileKey}'`
    );
  }

  if (stemSource.frames === undefined || stemSource.frames !== scene.frames) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem frame count ${stemSource.frames} does not match scene frames ${scene.frames}`
    );
  }

  if (stemSource.fps === undefined || Math.abs(stemSource.fps - scene.fps) > 0.01) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem fps ${stemSource.fps} does not match scene fps ${scene.fps}`
    );
  }

  if (!stemSource.sceneId || stemSource.sceneId !== scene.sceneId) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem sceneId '${stemSource.sceneId}' does not match expected sceneId '${scene.sceneId}'`
    );
  }

  if (
    !scene.candidateSpecificationDigest ||
    !stemSource.candidateSpecificationDigest ||
    stemSource.candidateSpecificationDigest !== scene.candidateSpecificationDigest
  ) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem candidateSpecificationDigest '${stemSource.candidateSpecificationDigest}' does not match expected '${scene.candidateSpecificationDigest}'`
    );
  }

  if (stemSource.specRevision === undefined || stemSource.specRevision !== scene.specRevision) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem specRevision ${stemSource.specRevision} does not match scene specRevision ${scene.specRevision}`
    );
  }

  if (stemSource.executionScope !== "staging") {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem executionScope '${stemSource.executionScope}' must be 'staging'`
    );
  }

  if (stemSource.ownerKind !== "staging_acceptance") {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem ownerKind '${stemSource.ownerKind}' must be 'staging_acceptance'`
    );
  }

  if (!stemSource.acceptanceRunId || stemSource.acceptanceRunId !== scene.acceptanceRunId) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem acceptanceRunId '${stemSource.acceptanceRunId}' does not match scene acceptanceRunId '${scene.acceptanceRunId}'`
    );
  }

  if (expectedRunContext?.realm) {
    if (
      !stemSource.realm ||
      canonicalizeJson(stemSource.realm) !== canonicalizeJson(expectedRunContext.realm)
    ) {
      throw new CampaignDurationPlanningError(
        "observation_authority_invalid",
        `Video stem realm does not match acceptance run realm`
      );
    }
  } else if (!stemSource.realm) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem source is missing required realm`
    );
  }

  if (expectedRunContext?.evidenceOrigin) {
    if (
      !stemSource.evidenceOrigin ||
      stemSource.evidenceOrigin !== expectedRunContext.evidenceOrigin
    ) {
      throw new CampaignDurationPlanningError(
        "observation_authority_invalid",
        `Video stem evidenceOrigin '${stemSource.evidenceOrigin}' does not match acceptance run evidenceOrigin '${expectedRunContext.evidenceOrigin}'`
      );
    }
  } else if (!stemSource.evidenceOrigin) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem source is missing required evidenceOrigin`
    );
  }

  if (!stemSource.measuredMedia) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem source is missing required measuredMedia`
    );
  }

  if (stemSource.measuredMedia.frameCount !== scene.frames) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem measuredMedia frameCount ${stemSource.measuredMedia.frameCount} does not match scene frames ${scene.frames}`
    );
  }

  if (
    stemSource.measuredMedia.fps === undefined ||
    stemSource.measuredMedia.fps === null ||
    Math.abs(stemSource.measuredMedia.fps - scene.fps) > 0.01
  ) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem measuredMedia fps ${stemSource.measuredMedia.fps} does not match scene fps ${scene.fps}`
    );
  }

  if (!stemSource.measuredMedia.dimensions) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      "Video stem measuredMedia is missing required dimensions"
    );
  }

  if (
    stemSource.measuredMedia.dimensions.width !== 1344 ||
    stemSource.measuredMedia.dimensions.height !== 768
  ) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem measuredMedia dimensions ${stemSource.measuredMedia.dimensions.width}x${stemSource.measuredMedia.dimensions.height} do not match configured 1344x768`
    );
  }

  if (Math.abs(stemSource.measuredMedia.durationMs - scene.expectedDurationMs) > 355) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem measuredMedia duration ${stemSource.measuredMedia.durationMs}ms exceeds tolerance of expected duration ${scene.expectedDurationMs}ms`
    );
  }

  if (!stemSource.media.sha256 || stemSource.media.sha256.length !== 64) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem media sha256 is invalid or empty`
    );
  }

  if (
    !stemSource.outputChecksumsSha256 ||
    stemSource.outputChecksumsSha256.length === 0 ||
    !stemSource.outputChecksumsSha256.includes(stemSource.media.sha256)
  ) {
    throw new CampaignDurationPlanningError(
      "observation_authority_invalid",
      `Video stem media sha256 '${stemSource.media.sha256}' is not present in outputChecksumsSha256`
    );
  }
}

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

      const campaign = context.campaigns.findByIdForUpdate
        ? await context.campaigns.findByIdForUpdate(input.campaignId)
        : await context.campaigns.findById(input.campaignId);
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

      const requestHash = computeAcceptanceActionRequestHash("begin", {
        campaignId: input.campaignId,
        actionId: input.actionId,
        requestedBy: input.requestedBy,
        planId: currentPlan.planId,
        planRevision: currentPlan.revision,
        realm: currentPlan.realm,
        allocations: currentPlan.allocations.map((a) => ({
          allocationId: a.allocationId,
          profileKey: a.profileSelection.profileKey,
          specificationDigest:
            a.profileSelection.kind === "staging_candidate"
              ? a.profileSelection.specificationDigest
              : undefined,
          frames: a.frames,
          fps: a.fps,
          nominalDurationMs: a.nominalDurationMs
        }))
      });

      if (context.operatorAcceptanceRuns.findActionReceipt) {
        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
          "begin",
          input.campaignId,
          input.actionId
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
          }
          return existingReceipt.response as unknown as BeginOperatorAcceptanceRunResponse;
        }
      }

      const scenes = await context.scenes.findByCampaignId(campaign.id);
      const sortedScenes = [...scenes].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

      const acceptanceRunSeed = `acceptance-run:${campaign.id}:${currentPlan.planId}:${input.actionId}`;
      const acceptanceRunId = deterministicUuid(acceptanceRunSeed);
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

        // render_jobs.staging_operation_id is VARCHAR(128); raw concatenation of
        // 3 UUIDs plus an arbitrary-length actionId can exceed that (e.g. a
        // 16-char actionId already overflows it). Hash the identifying
        // components into a fixed-length digest instead — this preserves the
        // idempotency property (same inputs always produce the same
        // requestId) without risking a DB-level truncation/insert failure.
        const requestId = `stage-${createHash("sha256")
          .update(`${campaign.id}:${currentPlan.planId}:${scene.id}:${input.actionId}`)
          .digest("hex")}`;
        const renderResult = await this.deps.stageRenderUseCase.executeWithContext(context, {
          sceneId: scene.id,
          candidateProfileKey: candidateKey,
          grant,
          requestId,
          ownerKind: "staging_acceptance",
          acceptanceRunId,
          realm: run.realm,
          evidenceOrigin: run.evidenceOrigin
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
          acceptedAttemptOrdinal: undefined,
          candidateSpecificationDigest:
            allocation.profileSelection.kind === "staging_candidate"
              ? allocation.profileSelection.specificationDigest
              : undefined,
          planId: currentPlan.planId
        });
      }

      try {
        await context.operatorAcceptanceRuns.createRun(run, runScenes);
      } catch (createErr) {
        if (context.operatorAcceptanceRuns.findActionReceipt) {
          const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
            "begin",
            input.campaignId,
            input.actionId
          );
          if (existingReceipt) {
            if (existingReceipt.requestHash !== requestHash) {
              throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
            }
            return existingReceipt.response as unknown as BeginOperatorAcceptanceRunResponse;
          }
        }
        throw createErr;
      }

      const response: BeginOperatorAcceptanceRunResponse = {
        acceptanceRunId,
        campaignId: campaign.id,
        status: "dispatched",
        sceneCount: sortedScenes.length,
        dispatchedJobIds
      };

      if (context.operatorAcceptanceRuns.saveActionReceipt) {
        await context.operatorAcceptanceRuns.saveActionReceipt({
          actionId: input.actionId,
          scope: "begin",
          runOrCampaignId: input.campaignId,
          realm: currentPlan.realm,
          requestHash,
          response: response as unknown as Record<string, unknown>,
          createdAt: now
        });
      }

      return response;
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

      const requestHash = computeAcceptanceActionRequestHash("accept_scene", {
        acceptanceRunId: input.acceptanceRunId,
        sceneId: input.sceneId,
        actionId: input.actionId,
        expectedAttemptOrdinal: input.expectedAttemptOrdinal,
        acceptedBy: input.acceptedBy
      });

      const actionKey = `${input.acceptanceRunId}:${input.sceneId}:${input.actionId}`;
      if (context.operatorAcceptanceRuns.findActionReceipt) {
        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
          "accept_scene",
          input.acceptanceRunId,
          actionKey
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
          }
          return existingReceipt.response as unknown as { readonly accepted: boolean };
        }
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

      validateAcceptanceStemSource(scene, stemSource, {
        realm: run.realm,
        evidenceOrigin: run.evidenceOrigin
      });

      await context.operatorAcceptanceRuns.updateSceneAcceptedAttempt(
        input.acceptanceRunId,
        input.sceneId,
        scene.currentAttemptId,
        stagingJobId,
        scene.currentAttemptOrdinal
      );

      const response = { accepted: true };

      if (context.operatorAcceptanceRuns.saveActionReceipt) {
        await context.operatorAcceptanceRuns.saveActionReceipt({
          actionId: actionKey,
          scope: "accept_scene",
          runOrCampaignId: input.acceptanceRunId,
          realm: run.realm,
          requestHash,
          response: response as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString()
        });
      }

      return response;
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

      const requestHash = computeAcceptanceActionRequestHash("assemble", {
        acceptanceRunId: input.acceptanceRunId,
        actionId: input.actionId,
        requestedBy: input.requestedBy
      });

      if (context.operatorAcceptanceRuns.findActionReceipt) {
        const existingReceipt = await context.operatorAcceptanceRuns.findActionReceipt(
          "assemble",
          input.acceptanceRunId,
          input.actionId
        );
        if (existingReceipt) {
          if (existingReceipt.requestHash !== requestHash) {
            throw new OperatorAcceptanceIdempotencyConflictError(input.actionId);
          }
          return existingReceipt.response as unknown as AssembleOperatorAcceptanceRunResponse;
        }
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
        validateAcceptanceStemSource(s, stemSource, {
          realm: run.realm,
          evidenceOrigin: run.evidenceOrigin
        });
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

      const response: AssembleOperatorAcceptanceRunResponse = {
        acceptanceRunId: run.acceptanceRunId,
        assemblyJobId,
        status: "assembling"
      };

      if (context.operatorAcceptanceRuns.saveActionReceipt) {
        await context.operatorAcceptanceRuns.saveActionReceipt({
          actionId: input.actionId,
          scope: "assemble",
          runOrCampaignId: run.acceptanceRunId,
          realm: run.realm,
          requestHash,
          response: response as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString()
        });
      }

      return response;
    });
  }
}
