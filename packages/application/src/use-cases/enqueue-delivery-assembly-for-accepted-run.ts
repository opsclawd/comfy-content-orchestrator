import {
  AcceptedAttemptIdentityMismatchError,
  AcceptedAttemptOrdinalMismatchError,
  AcceptedAttemptRecordMissingError,
  AcceptedAttemptRevisionMismatchError,
  AcceptedAttemptSceneOrRunMismatchError,
  AssemblyDurationMismatchError,
  MissingAcceptedProductionManifestError,
  toVideoStemOrder,
  type CampaignProductionRunRecord
} from "@cco/domain";
import {
  CampaignDurationPlanningError,
  DEFAULT_ASSEMBLY_PLANNING_ENVELOPE,
  type AssemblyPlanningEnvelope,
  type OwnerKind
} from "@cco/contracts";
import {
  DeployedLiveRealmContext,
  type RealmAdmissionContext
} from "../ports/realm-admission-context.js";
import {
  validateAssemblySpec,
  type AssemblySpec,
  type UnitOfWorkContext,
  type VideoStemSourceRecord
} from "../ports/index.js";

export class StagingRenderIneligibleForAssemblyError extends Error {
  override readonly name = "StagingRenderIneligibleForAssemblyError";
  readonly runId: string;
  readonly sceneId: string;
  readonly jobId: string;

  constructor(runId: string, sceneId: string, jobId: string, message?: string) {
    super(
      message ??
        `Video stem source for scene '${sceneId}' in run '${runId}' (job '${jobId}') has execution scope 'staging' and cannot be included in production delivery assembly.`
    );
    this.runId = runId;
    this.sceneId = sceneId;
    this.jobId = jobId;
  }
}

export interface EnqueueDeliveryAssemblyOptions {
  readonly realmAdmissionContext?: RealmAdmissionContext | undefined;
  readonly envelope?: AssemblyPlanningEnvelope | undefined;
}

export async function attemptEnqueueAssemblyForAcceptedRun(
  context: UnitOfWorkContext,
  run: CampaignProductionRunRecord,
  options?: EnqueueDeliveryAssemblyOptions
): Promise<{ readonly enqueued: boolean; readonly assemblyJobId?: string }> {
  if (run.status !== "dispatched" && run.status !== "production_review") {
    return { enqueued: false };
  }

  const runsRepo = context.campaignProductionRuns;

  if (runsRepo === undefined) {
    throw new Error("UnitOfWorkContext is missing required campaign production repositories");
  }

  const runScenes = await runsRepo.findRunScenes(run.id);

  if (runScenes.length === 0) {
    return { enqueued: false };
  }

  const envelope = options?.envelope ?? DEFAULT_ASSEMBLY_PLANNING_ENVELOPE;
  if (runScenes.length > envelope.maxStemCount) {
    throw new CampaignDurationPlanningError(
      "assembly_envelope_exceeded",
      `Run scene count ${runScenes.length} exceeds assembly planning envelope maximum ${envelope.maxStemCount}`
    );
  }
  if (run.expectedTotalDurationMs > envelope.maxExpectedTotalDurationMs) {
    throw new CampaignDurationPlanningError(
      "assembly_envelope_exceeded",
      `Run expected duration ${run.expectedTotalDurationMs}ms exceeds assembly planning envelope maximum ${envelope.maxExpectedTotalDurationMs}ms`
    );
  }

  const isFullyAccepted = runScenes.every(
    (scene) =>
      scene.acceptedAttemptId !== undefined &&
      scene.acceptedProductionJobId !== undefined &&
      scene.acceptedAttemptOrdinal !== undefined
  );

  if (!isFullyAccepted) {
    return { enqueued: false };
  }

  const assemblyJobs = context.assemblyJobs;
  const manifestRepo = context.generationManifests;

  if (assemblyJobs === undefined || manifestRepo === undefined) {
    throw new Error("UnitOfWorkContext is missing required campaign production repositories");
  }

  const resolvedStems: Array<{
    readonly sceneId: string;
    readonly generationManifestId: string;
    readonly media: VideoStemSourceRecord["media"];
    readonly expectedDurationMs: number;
    readonly measuredDurationMs?: number | undefined;
  }> = [];

  for (const scene of runScenes) {
    const acceptedJobId = scene.acceptedProductionJobId!;
    const attempt = await runsRepo.findAttemptByProductionJobId(acceptedJobId);

    if (attempt === undefined) {
      throw new AcceptedAttemptRecordMissingError(run.id, scene.sceneId, acceptedJobId);
    }

    if (attempt.attemptId !== scene.acceptedAttemptId) {
      throw new AcceptedAttemptIdentityMismatchError(
        run.id,
        scene.sceneId,
        scene.acceptedAttemptId!,
        attempt.attemptId
      );
    }

    if (attempt.sceneId !== scene.sceneId || attempt.runId !== run.id) {
      throw new AcceptedAttemptSceneOrRunMismatchError(run.id, scene.sceneId, attempt);
    }

    if (attempt.specRevision !== scene.specRevision) {
      throw new AcceptedAttemptRevisionMismatchError(
        run.id,
        scene.sceneId,
        scene.specRevision,
        attempt.specRevision
      );
    }

    if (attempt.ordinal !== scene.acceptedAttemptOrdinal) {
      throw new AcceptedAttemptOrdinalMismatchError(
        run.id,
        scene.sceneId,
        scene.acceptedAttemptOrdinal!,
        attempt.ordinal
      );
    }

    if (typeof manifestRepo.findVideoStemSourceByJobId !== "function") {
      throw new Error("UnitOfWorkContext is missing required campaign production repositories");
    }

    const stemSource = await manifestRepo.findVideoStemSourceByJobId(acceptedJobId);
    if (stemSource === undefined) {
      throw new MissingAcceptedProductionManifestError(run.id, scene.sceneId, acceptedJobId);
    }

    const effectiveOwnerKind = (stemSource.ownerKind ??
      attempt.ownerKind ??
      "production_run") as OwnerKind;
    if (
      effectiveOwnerKind === "staging_acceptance" ||
      effectiveOwnerKind === "standalone_staging" ||
      stemSource.executionScope === "staging"
    ) {
      throw new StagingRenderIneligibleForAssemblyError(run.id, scene.sceneId, acceptedJobId);
    }

    if (stemSource.realm === undefined || stemSource.evidenceOrigin === undefined) {
      throw new CampaignDurationPlanningError(
        "observation_authority_invalid",
        `Video stem source for scene '${scene.sceneId}' in run '${run.id}' is missing required realm or evidence origin`
      );
    }

    const admissionContext =
      options?.realmAdmissionContext ?? new DeployedLiveRealmContext("default");

    admissionContext.validateAdmission({
      scope: "production",
      ownerKind: effectiveOwnerKind,
      origin: stemSource.evidenceOrigin,
      realm: stemSource.realm
    });

    if (stemSource.measuredMedia) {
      if (
        !Number.isFinite(stemSource.measuredMedia.durationMs) ||
        stemSource.measuredMedia.durationMs <= 0
      ) {
        throw new AssemblyDurationMismatchError(
          run.id,
          scene.expectedDurationMs,
          0,
          `Video stem source for scene '${scene.sceneId}' in run '${run.id}' has invalid measured duration`
        );
      }
      if (Math.abs(stemSource.measuredMedia.durationMs - scene.expectedDurationMs) > 355) {
        throw new AssemblyDurationMismatchError(
          run.id,
          scene.expectedDurationMs,
          Math.round(stemSource.measuredMedia.durationMs),
          `Video stem measured duration ${stemSource.measuredMedia.durationMs}ms diverges from scene expected duration ${scene.expectedDurationMs}ms beyond tolerance`
        );
      }
    }

    resolvedStems.push({
      sceneId: scene.sceneId,
      generationManifestId: stemSource.generationManifestId,
      media: stemSource.media,
      expectedDurationMs: scene.expectedDurationMs,
      ...(stemSource.measuredMedia
        ? { measuredDurationMs: stemSource.measuredMedia.durationMs }
        : {})
    });
  }

  const measuredCount = resolvedStems.filter((s) => s.measuredDurationMs !== undefined).length;
  if (measuredCount > 0) {
    const aggregateMeasuredMs = resolvedStems.reduce(
      (acc, s) => acc + (s.measuredDurationMs ?? s.expectedDurationMs),
      0
    );
    if (Math.abs(aggregateMeasuredMs - run.expectedTotalDurationMs) > 355) {
      throw new AssemblyDurationMismatchError(
        run.id,
        run.expectedTotalDurationMs,
        Math.round(aggregateMeasuredMs),
        `Aggregate measured stem duration ${aggregateMeasuredMs}ms diverges from run expected total duration ${run.expectedTotalDurationMs}ms beyond tolerance`
      );
    }
  }

  const orderMapping = toVideoStemOrder(runScenes);
  const videoStems = resolvedStems
    .map((stem) => {
      const order = orderMapping.get(stem.sceneId);
      if (order === undefined) {
        throw new Error(`Order mapping missing for scene '${stem.sceneId}'.`);
      }
      return {
        order,
        sceneId: stem.sceneId,
        generationManifestId: stem.generationManifestId,
        expectedDurationMs: stem.expectedDurationMs,
        media: stem.media
      };
    })
    .sort((a, b) => a.order - b.order);

  const computedSumMs = runScenes.reduce((acc, s) => acc + s.expectedDurationMs, 0);
  if (computedSumMs !== run.expectedTotalDurationMs) {
    throw new AssemblyDurationMismatchError(run.id, run.expectedTotalDurationMs, computedSumMs);
  }

  const spec: AssemblySpec = {
    campaignId: run.campaignId,
    assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
    expectedTotalDurationMs: run.expectedTotalDurationMs,
    videoStems,
    subtitleCues: []
  };

  validateAssemblySpec(spec);

  const claimed = await runsRepo.claimForAssembly(run.id);
  if (claimed === undefined) {
    return { enqueued: false };
  }

  const job = await assemblyJobs.enqueue({
    campaignId: run.campaignId,
    assemblySpec: spec
  });

  await runsRepo.setAssemblyJobId(run.id, job.jobId);

  return { enqueued: true, assemblyJobId: job.jobId };
}
