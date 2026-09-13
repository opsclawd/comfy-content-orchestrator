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
  validateAssemblySpec,
  type AssemblySpec,
  type UnitOfWorkContext,
  type VideoStemSourceRecord
} from "../ports/index.js";

export async function attemptEnqueueAssemblyForAcceptedRun(
  context: UnitOfWorkContext,
  run: CampaignProductionRunRecord
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

    resolvedStems.push({
      sceneId: scene.sceneId,
      generationManifestId: stemSource.generationManifestId,
      media: stemSource.media,
      expectedDurationMs: scene.expectedDurationMs
    });
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
