import { randomUUID } from "node:crypto";
import {
  InvalidTransitionError,
  type JobId,
  type RenderJob,
  type SceneId,
  type SceneSnapshot
} from "@cco/domain";
import {
  computeAuthorizationPayloadDigest,
  type H3CandidateAuthorizationGrant,
  type H3ProductionInspectionReadModel
} from "@cco/contracts";
import type { UnitOfWork, UnitOfWorkContext } from "../ports/unit-of-work.js";
import type {
  H3CandidateAuthorizationPort,
  H3CandidateRegistryReader
} from "../ports/h3-candidate-ports.js";
import { deriveProductionSeed } from "./derive-production-seed.js";
import { TransactionalJobEnqueuerUnavailableError } from "./job-queue-errors.js";
import {
  PrepareSceneProductionInputsUseCase,
  type PrepareSceneProductionInputsOptions
} from "./prepare-scene-production-inputs.js";
import { SceneNotFoundError } from "./scene-not-found-error.js";

export class ConflictingStagingOperationError extends Error {
  override readonly name = "ConflictingStagingOperationError";
  constructor(
    readonly requestId: string,
    message?: string
  ) {
    super(
      message ??
        `A staging job with requestId "${requestId}" already exists with different canonical parameters`
    );
  }
}

export class UnsupportedH3CandidateProfileError extends Error {
  override readonly name = "UnsupportedH3CandidateProfileError";
  constructor(
    readonly profileKey: string,
    message?: string
  ) {
    super(
      message ??
        `H3 candidate profile "${profileKey}" is not recognized or not admitted in registry`
    );
  }
}

export class StagingAuthorizationDeniedError extends Error {
  override readonly name = "StagingAuthorizationDeniedError";
  constructor(
    readonly reason: string,
    message?: string
  ) {
    super(message ?? `Staging candidate execution authorization denied: ${reason}`);
  }
}

export class StagingRenderPreparationBlockedError extends Error {
  override readonly name = "StagingRenderPreparationBlockedError";
  constructor(
    readonly sceneId: string,
    readonly blockers: readonly string[],
    message?: string
  ) {
    super(
      message ?? `Staging render preparation blocked for scene "${sceneId}": ${blockers.join("; ")}`
    );
  }
}

export interface StageH3CandidateRenderInput {
  readonly sceneId: string;
  readonly candidateProfileKey: string;
  readonly grant: H3CandidateAuthorizationGrant;
  readonly requestId: string;
  readonly dryRun?: boolean;
  readonly ownerKind?: "staging_acceptance" | "staging_experiment" | undefined;
  readonly acceptanceRunId?: string | undefined;
}

export interface StageH3CandidateRenderResult {
  readonly scene: Readonly<SceneSnapshot>;
  readonly job: RenderJob;
  readonly attemptId: string;
  readonly inspection: H3ProductionInspectionReadModel;
  readonly idempotentReplay?: boolean;
}

export interface StageH3CandidateRenderDependencies {
  readonly uow: UnitOfWork;
  readonly registryReader: H3CandidateRegistryReader;
  readonly authorizationPort: H3CandidateAuthorizationPort;
  readonly prepareInputsOptions?: PrepareSceneProductionInputsOptions | undefined;
}

export class StageH3CandidateRenderUseCase {
  private readonly uow: UnitOfWork;
  private readonly registryReader: H3CandidateRegistryReader;
  private readonly authorizationPort: H3CandidateAuthorizationPort;
  private readonly prepareInputsUseCase: PrepareSceneProductionInputsUseCase;

  constructor(deps: StageH3CandidateRenderDependencies) {
    this.uow = deps.uow;
    this.registryReader = deps.registryReader;
    this.authorizationPort = deps.authorizationPort;
    this.prepareInputsUseCase = new PrepareSceneProductionInputsUseCase(deps.uow, {
      ...deps.prepareInputsOptions,
      registryReader: deps.registryReader
    });
  }

  async execute(input: StageH3CandidateRenderInput): Promise<StageH3CandidateRenderResult> {
    return this.uow.execute((context) => this.executeWithContext(context, input));
  }

  async executeWithContext(
    context: UnitOfWorkContext,
    input: StageH3CandidateRenderInput
  ): Promise<StageH3CandidateRenderResult> {
    if (!input.sceneId || typeof input.sceneId !== "string" || input.sceneId.trim().length === 0) {
      throw new Error("sceneId must be a non-empty string");
    }
    if (
      !input.candidateProfileKey ||
      typeof input.candidateProfileKey !== "string" ||
      input.candidateProfileKey.trim().length === 0
    ) {
      throw new Error("candidateProfileKey must be a non-empty string");
    }
    if (!input.grant || typeof input.grant !== "object") {
      throw new Error("grant is required for staging render");
    }
    if (
      !input.requestId ||
      typeof input.requestId !== "string" ||
      input.requestId.trim().length === 0
    ) {
      throw new Error("requestId must be a non-empty string");
    }

    const grantDigest = computeAuthorizationPayloadDigest(input.grant.payload);

    // 1. Idempotency check on requestId
    if (context.jobs?.findByStagingOperationId) {
      const existingJob = await context.jobs.findByStagingOperationId(input.requestId);
      if (existingJob) {
        const injected = existingJob.injectedPayload as Record<string, unknown>;
        const scene = await context.scenes.findById(input.sceneId as SceneId);
        if (!scene) {
          throw new SceneNotFoundError(input.sceneId);
        }
        const snapshot = scene.snapshot();
        const existingGrant = (injected.authorizationGrant ?? (injected.grant as unknown)) as
          H3CandidateAuthorizationGrant | undefined;
        const existingDigest = existingGrant?.payload
          ? computeAuthorizationPayloadDigest(existingGrant.payload)
          : (injected.grantDigest as string | undefined);
        const matchesCanonical =
          existingJob.sceneId === input.sceneId &&
          injected.candidateProfileKey === input.candidateProfileKey &&
          injected.specRevision === snapshot.specRevision &&
          (existingGrant?.signature === input.grant.signature ||
            injected.grantSignature === input.grant.signature ||
            existingDigest === grantDigest);

        if (matchesCanonical) {
          const prep = await this.prepareInputsUseCase.executeWithContext(context, {
            sceneId: scene.id,
            dryRun: true,
            executionScope: "staging",
            candidateProfileKey: input.candidateProfileKey,
            authorizationGrant: input.grant
          });

          if (
            injected.productionInputFingerprint &&
            injected.productionInputFingerprint !== prep.inspection.productionInputFingerprint
          ) {
            throw new ConflictingStagingOperationError(
              input.requestId,
              `A staging job with requestId "${input.requestId}" exists but creative inputs or references have changed (fingerprint mismatch)`
            );
          }

          return {
            scene: snapshot,
            job: existingJob,
            attemptId: (injected.attemptId as string) ?? existingJob.jobId,
            inspection: prep.inspection,
            idempotentReplay: true
          };
        }
        throw new ConflictingStagingOperationError(input.requestId);
      }
    }

    // 2. Validate scene existence and state
    const scene = await context.scenes.findById(input.sceneId as SceneId);
    if (!scene) {
      throw new SceneNotFoundError(input.sceneId);
    }

    if (scene.status !== "approved" && scene.status !== "failed") {
      throw new InvalidTransitionError(
        scene.id,
        scene.status,
        "stageCandidateRender",
        `Scene must be approved or in failure recovery to admit staging render; current status: ${scene.status}`
      );
    }

    // 2b. Validate scene is not attached to an active ordinary production run
    if (context.campaignProductionRuns) {
      const existingRunScene = await context.campaignProductionRuns.findRunSceneBySceneId(scene.id);
      if (existingRunScene) {
        const run = await context.campaignProductionRuns.findById(existingRunScene.runId);
        if (
          run &&
          (run.status === "dispatched" ||
            run.status === "production_review" ||
            run.status === "assembling")
        ) {
          throw new InvalidTransitionError(
            scene.id,
            scene.status,
            "stageCandidateRender",
            `Scene "${scene.id}" is attached to active ordinary CampaignProductionRun ("${run.id}"); staging cannot attach to an active ordinary production run.`
          );
        }
      }
    }

    // 3. Verify candidate profile exists in trusted reader
    const candidateProfile = this.registryReader.getCandidateProfile(input.candidateProfileKey);
    if (!candidateProfile) {
      throw new UnsupportedH3CandidateProfileError(input.candidateProfileKey);
    }

    // 4. Staging authorization grant check (fail-closed)
    const auth = await this.authorizationPort.verifyCandidateAuthorization({
      grant: input.grant,
      candidateKey: candidateProfile.key,
      specificationDigest: candidateProfile.specificationDigest,
      targetHostname: input.grant.payload.targetHostname,
      targetGpuUuid: input.grant.payload.targetGpuUuid,
      purpose: "staging",
      goldMasterWorkflowHash: candidateProfile.specification.workflowHash,
      goldMasterModelHashesDigest: input.grant.payload.goldMasterModelHashesDigest
    });
    if (!auth.authorized) {
      throw new StagingAuthorizationDeniedError(auth.blocker ?? "Authorization denied");
    }

    // 5. Prepare scene inputs under staging execution scope
    const prep = await this.prepareInputsUseCase.executeWithContext(context, {
      sceneId: scene.id,
      dryRun: input.dryRun ?? false,
      executionScope: "staging",
      candidateProfileKey: input.candidateProfileKey,
      authorizationGrant: input.grant
    });

    if (prep.readiness === "blocked" || prep.blockers.length > 0) {
      throw new StagingRenderPreparationBlockedError(
        scene.id,
        prep.blockers.map((b) => `${b.code}: ${b.message}`)
      );
    }

    const snapshot = scene.snapshot();
    const attemptOrdinal = (snapshot.productionAttemptOrdinal ?? 0) + 1;
    const attemptId = randomUUID();
    const seed = deriveProductionSeed(scene.id, snapshot.specRevision, attemptOrdinal);
    const route = prep.inspection.route;

    const injectedPayload: Record<string, unknown> = {
      prompt: prep.inspection.instruction.compiledText,
      seed,
      shotPlanId: prep.inspection.authority.shotPlanId,
      specRevision: snapshot.specRevision,
      attemptId,
      productionInputFingerprint: prep.inspection.productionInputFingerprint,
      candidateProfileKey: input.candidateProfileKey,
      candidateSpecificationDigest: candidateProfile.specificationDigest,
      requestedDurationMs: prep.inspection.route.requestedDurationMs,
      nominalDurationMs: prep.inspection.route.nominalDurationMs,
      frameCount: prep.frameCount,
      authorizationGrant: input.grant,
      ...(input.ownerKind !== undefined ? { ownerKind: input.ownerKind } : {}),
      ...(input.acceptanceRunId !== undefined ? { acceptanceRunId: input.acceptanceRunId } : {}),
      ...(route.routingMode === "frame_anchored" && prep.inspection.visualInputs.frameAnchor
        ? { approvedCandidateId: prep.inspection.visualInputs.frameAnchor.anchorCandidateId }
        : {})
    };

    if (input.dryRun) {
      const dummyJob: RenderJob = Object.freeze({
        jobId: `dry-run-${attemptId}` as unknown as JobId,
        sceneId: scene.id,
        jobKind: "production",
        status: "queued",
        workflowTemplate: route.workflowTemplate,
        injectedPayload: Object.freeze(injectedPayload),
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        retryCount: 0,
        maxRetries: 3,
        errorTrace: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        executionScope: "staging",
        stagingOperationId: input.requestId
      });
      return {
        scene: snapshot,
        job: dummyJob,
        attemptId,
        inspection: prep.inspection
      };
    }

    if (!context.jobs) {
      throw new TransactionalJobEnqueuerUnavailableError();
    }

    let job: RenderJob;
    try {
      job = await context.jobs.enqueue({
        sceneId: scene.id,
        jobKind: "production",
        workflowTemplate: route.workflowTemplate,
        injectedPayload,
        executionScope: "staging",
        stagingOperationId: input.requestId
      });
    } catch (enqueueErr) {
      if (context.jobs.findByStagingOperationId) {
        const recoveredJob = await context.jobs.findByStagingOperationId(input.requestId);
        if (recoveredJob) {
          const recoveredInjected = recoveredJob.injectedPayload as Record<string, unknown>;
          const existingGrant = (recoveredInjected.authorizationGrant ??
            (recoveredInjected.grant as unknown)) as H3CandidateAuthorizationGrant | undefined;
          const existingDigest = existingGrant?.payload
            ? computeAuthorizationPayloadDigest(existingGrant.payload)
            : (recoveredInjected.grantDigest as string | undefined);
          const matchesCanonical =
            recoveredJob.sceneId === input.sceneId &&
            recoveredInjected.candidateProfileKey === input.candidateProfileKey &&
            recoveredInjected.specRevision === snapshot.specRevision &&
            (existingGrant?.signature === input.grant.signature ||
              recoveredInjected.grantSignature === input.grant.signature ||
              existingDigest === grantDigest);
          if (matchesCanonical) {
            if (
              recoveredInjected.productionInputFingerprint &&
              recoveredInjected.productionInputFingerprint !==
                prep.inspection.productionInputFingerprint
            ) {
              throw new ConflictingStagingOperationError(
                input.requestId,
                `A staging job with requestId "${input.requestId}" exists but creative inputs or references have changed (fingerprint mismatch)`
              );
            }
            return {
              scene: snapshot,
              job: recoveredJob,
              attemptId: (recoveredInjected.attemptId as string) ?? recoveredJob.jobId,
              inspection: prep.inspection,
              idempotentReplay: true
            };
          }
          throw new ConflictingStagingOperationError(input.requestId);
        }
      }
      throw enqueueErr;
    }

    // Record production attempt in ledger
    if (context.campaignProductionRuns) {
      await context.campaignProductionRuns.recordProductionAttempt({
        attemptId,
        sceneId: scene.id,
        runId: undefined,
        ordinal: attemptOrdinal,
        productionJobId: job.jobId,
        specRevision: snapshot.specRevision,
        selectedCandidateId:
          route.routingMode === "frame_anchored"
            ? (prep.inspection.visualInputs.frameAnchor?.anchorCandidateId ?? undefined)
            : undefined,
        selectedCandidateRevision:
          route.routingMode === "frame_anchored" ? snapshot.specRevision : undefined,
        seed,
        createdReason: snapshot.status === "failed" ? "failure_recovery" : "initial_dispatch",
        ownerKind: input.ownerKind ?? "staging_experiment",
        acceptanceRunId: input.acceptanceRunId
      });
    }

    // Transition scene state to queued_for_production
    scene.queueForProduction(job.jobId);
    await context.scenes.save(scene);

    return {
      scene: scene.snapshot(),
      job,
      attemptId,
      inspection: prep.inspection
    };
  }
}
