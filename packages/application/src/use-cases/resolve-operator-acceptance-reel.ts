import { createHash } from "node:crypto";
import {
  type AcceptanceRunReelReadModel,
  type AcceptanceRunReelStemLineageEntry,
  AssemblyManifestSchema,
  OperatorAcceptanceRunNotFoundError,
  CampaignDurationPlanningError
} from "@cco/contracts";
import { BUCKETS } from "@cco/shared";
import type { UnitOfWork } from "../ports/unit-of-work.js";
import type { ObjectStoragePort } from "../ports/object-storage-port.js";
import type { ReviewMediaDeliveryPort } from "../ports/review-media-delivery-port.js";

export interface ResolveOperatorAcceptanceReelDependencies {
  readonly uow: UnitOfWork;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly mediaDelivery?: ReviewMediaDeliveryPort | undefined;
}

export interface ResolveOperatorAcceptanceReelParams {
  readonly acceptanceRunId: string;
  readonly reviewerName: string;
  readonly clientId?: string | undefined;
}

export class ResolveOperatorAcceptanceReelUseCase {
  constructor(private readonly deps: ResolveOperatorAcceptanceReelDependencies) {}

  async execute(params: ResolveOperatorAcceptanceReelParams): Promise<AcceptanceRunReelReadModel> {
    return await this.deps.uow.execute(async (context) => {
      if (!context.operatorAcceptanceRuns) {
        throw new Error("UnitOfWorkContext.operatorAcceptanceRuns is not configured");
      }

      const run = await context.operatorAcceptanceRuns.findRunById(params.acceptanceRunId);
      if (!run) {
        throw new OperatorAcceptanceRunNotFoundError(params.acceptanceRunId);
      }

      if (
        !params.reviewerName ||
        params.reviewerName.trim().length === 0 ||
        params.reviewerName.trim().toLowerCase() === "anonymous"
      ) {
        throw new CampaignDurationPlanningError(
          "authorization_denied",
          "Reviewer identity is required and must be authorized"
        );
      }

      if (context.campaigns) {
        const campaign = await context.campaigns.findById(run.campaignId);
        if (campaign && params.clientId && campaign.clientId !== params.clientId) {
          throw new CampaignDurationPlanningError(
            "authorization_denied",
            `Client '${params.clientId}' is not authorized to access campaign '${run.campaignId}'`
          );
        }
      }

      const base = {
        acceptanceRunId: run.acceptanceRunId,
        campaignId: run.campaignId,
        realm: run.realm,
        evidenceOrigin: run.evidenceOrigin,
        updatedAt: run.updatedAt
      };

      if (run.status === "dispatched" || run.status === "acceptance_review") {
        return {
          status: "pending",
          ...base,
          message: "Acceptance run dispatched, awaiting scene reviews"
        };
      }

      if (run.status === "cancelled") {
        return {
          status: "unavailable",
          ...base,
          reason: "Acceptance run was cancelled"
        };
      }

      if (run.status === "failed") {
        return {
          status: "failed",
          ...base,
          ...(run.assemblyJobId ? { assemblyJobId: run.assemblyJobId } : {}),
          failureReason: "Acceptance run failed"
        };
      }

      if (run.status === "assembling") {
        if (!run.assemblyJobId) {
          return {
            status: "unavailable",
            ...base,
            reason: "Acceptance run is assembling but missing assemblyJobId"
          };
        }
        if (context.acceptanceAssemblyJobs?.findById) {
          const job = await context.acceptanceAssemblyJobs.findById(run.assemblyJobId);
          if (job && job.status === "failed") {
            return {
              status: "failed",
              ...base,
              assemblyJobId: run.assemblyJobId,
              failureReason: job.failureReason ?? "Acceptance assembly job failed"
            };
          }
        }
        return {
          status: "assembling",
          ...base,
          assemblyJobId: run.assemblyJobId,
          message: "Reel assembly is currently in progress"
        };
      }

      if (run.status === "completed") {
        if (!run.assemblyJobId) {
          return {
            status: "unavailable",
            ...base,
            reason: "Completed acceptance run missing assemblyJobId"
          };
        }

        const manifestRecord = context.acceptanceAssemblyManifests
          ? await context.acceptanceAssemblyManifests.findByRunId(run.acceptanceRunId)
          : undefined;

        if (!manifestRecord) {
          return {
            status: "unavailable",
            ...base,
            reason: "Acceptance assembly manifest not found in repository"
          };
        }

        if (manifestRecord.jobId !== run.assemblyJobId) {
          return {
            status: "unavailable",
            ...base,
            reason: `Contradictory state: manifest jobId "${manifestRecord.jobId}" does not match run assemblyJobId "${run.assemblyJobId}"`
          };
        }

        if (context.acceptanceAssemblyJobs?.findById) {
          const job = await context.acceptanceAssemblyJobs.findById(run.assemblyJobId);
          if (!job || job.status !== "completed") {
            return {
              status: "unavailable",
              ...base,
              reason:
                "Contradictory state: acceptance run completed but assembly job is not completed"
            };
          }
          if (job.outputManifestId && job.outputManifestId !== manifestRecord.manifestId) {
            return {
              status: "unavailable",
              ...base,
              reason: `Contradictory state: assembly job outputManifestId "${job.outputManifestId}" does not match manifestId "${manifestRecord.manifestId}"`
            };
          }
        }

        if (!this.deps.objectStorage || !this.deps.mediaDelivery) {
          return {
            status: "unavailable",
            ...base,
            reason:
              "Object storage or media delivery service is not configured for completed reel resolution"
          };
        }

        const manifestBucket = manifestRecord.manifestStorageBucket ?? manifestRecord.storageBucket;
        const manifestKey =
          manifestRecord.manifestStorageKey ??
          `acceptance-runs/${run.acceptanceRunId}/manifest.json`;
        const expectedManifestSha256 = manifestRecord.manifestStorageSha256;

        if (!manifestBucket || !manifestKey || !expectedManifestSha256) {
          return {
            status: "unavailable",
            ...base,
            reason:
              "Acceptance assembly manifest record missing manifest storage location or checksum"
          };
        }

        if (
          manifestBucket !== BUCKETS.CANDIDATES ||
          !manifestKey.startsWith(`acceptance-runs/${run.acceptanceRunId}/`)
        ) {
          return {
            status: "unavailable",
            ...base,
            reason: `Manifest artifact storage path "${manifestBucket}/${manifestKey}" violates acceptance namespace isolation`
          };
        }

        let storedManifestObj;
        try {
          storedManifestObj = await this.deps.objectStorage.getObject({
            bucket: manifestBucket,
            key: manifestKey
          });
        } catch (err) {
          return {
            status: "unavailable",
            ...base,
            reason: `Failed to access stored manifest artifact in storage: ${(err as Error).message}`
          };
        }

        if (!storedManifestObj || !storedManifestObj.body) {
          return {
            status: "unavailable",
            ...base,
            reason: "Stored manifest artifact missing or empty in storage"
          };
        }

        const computedManifestSha256 = createHash("sha256")
          .update(storedManifestObj.body)
          .digest("hex");
        if (computedManifestSha256 !== expectedManifestSha256) {
          return {
            status: "unavailable",
            ...base,
            reason: `Stored manifest artifact checksum mismatch (expected ${expectedManifestSha256}, got ${computedManifestSha256})`
          };
        }

        let parsedStoredJson: unknown;
        try {
          parsedStoredJson = JSON.parse(new TextDecoder().decode(storedManifestObj.body));
        } catch (err) {
          return {
            status: "unavailable",
            ...base,
            reason: `Failed to parse stored manifest JSON: ${(err as Error).message}`
          };
        }

        const manifestParse = AssemblyManifestSchema.safeParse(parsedStoredJson);
        if (!manifestParse.success) {
          return {
            status: "unavailable",
            ...base,
            reason: `Stored manifest artifact is not a valid typed AssemblyManifest: ${manifestParse.error.message}`
          };
        }
        const manifest = manifestParse.data;

        const bucket = manifestRecord.storageBucket;
        const key = manifestRecord.storageKey;
        const expectedSha256 = manifestRecord.storageSha256;

        if (!bucket || !key || !expectedSha256) {
          return {
            status: "unavailable",
            ...base,
            reason: "Acceptance assembly manifest missing storage location or checksum"
          };
        }

        // Strict namespace check: bucket MUST be BUCKETS.CANDIDATES and key MUST start with acceptance-runs/${run.acceptanceRunId}/
        if (
          bucket !== BUCKETS.CANDIDATES ||
          !key.startsWith(`acceptance-runs/${run.acceptanceRunId}/`)
        ) {
          return {
            status: "unavailable",
            ...base,
            reason: `Reel media artifact storage path "${bucket}/${key}" violates acceptance namespace isolation`
          };
        }

        // Fetch media object and verify actual bytes SHA-256
        let mediaObj;
        try {
          mediaObj = await this.deps.objectStorage.getObject({ bucket, key });
        } catch (err) {
          return {
            status: "unavailable",
            ...base,
            reason: `Failed to access reel media artifact in storage: ${(err as Error).message}`
          };
        }

        if (!mediaObj || !mediaObj.body) {
          return {
            status: "unavailable",
            ...base,
            reason: "Reel media artifact missing or empty in storage"
          };
        }

        const computedSha256 = createHash("sha256").update(mediaObj.body).digest("hex");
        if (computedSha256 !== expectedSha256) {
          return {
            status: "unavailable",
            ...base,
            reason: `Reel media artifact checksum mismatch (expected ${expectedSha256}, got ${computedSha256})`
          };
        }

        // Generate presigned playback URL
        let url: string | undefined;
        try {
          url = await this.deps.mediaDelivery.generatePresignedReadUrl(
            {
              bucket,
              key,
              contentHash: expectedSha256
            },
            300
          );
        } catch {
          url = undefined;
        }

        if (!url) {
          return {
            status: "unavailable",
            ...base,
            reason: "Failed to generate presigned playback URL for acceptance reel"
          };
        }

        if (
          !manifest.streams?.video?.frameRate ||
          !manifest.streams?.video?.width ||
          !manifest.streams?.video?.height
        ) {
          return {
            status: "unavailable",
            ...base,
            reason:
              "Acceptance assembly manifest is missing observed video stream facts (frameRate, width, or height)"
          };
        }

        const fps = manifest.streams.video.frameRate;
        const resolution = {
          width: manifest.streams.video.width,
          height: manifest.streams.video.height
        };
        const measuredDurationMs =
          manifest.output?.durationMs ??
          manifest.streams.video.durationMs ??
          manifest.timeline?.totalDurationMs;
        if (!measuredDurationMs) {
          return {
            status: "unavailable",
            ...base,
            reason: "Acceptance assembly manifest is missing observed duration"
          };
        }
        const frameCount = Math.max(1, Math.round((measuredDurationMs / 1000) * fps));

        let stemLineage: AcceptanceRunReelStemLineageEntry[] | undefined;
        if (manifest.inputs?.videoStems) {
          const runScenes = await context.operatorAcceptanceRuns.findRunScenes(run.acceptanceRunId);
          const entries: AcceptanceRunReelStemLineageEntry[] = [];
          for (const stem of manifest.inputs.videoStems) {
            const scene = runScenes.find((s) => s.sceneId === stem.sceneId);
            if (!scene || !scene.acceptedAttemptId) {
              return {
                status: "unavailable",
                ...base,
                reason: `Lineage verification failed: scene '${stem.sceneId}' has no accepted attempt ID`
              };
            }
            entries.push({
              sceneId: stem.sceneId,
              attemptId: scene.acceptedAttemptId,
              storageKey: stem.media.key,
              sha256: stem.media.sha256
            });
          }
          stemLineage = entries;
        }

        return {
          status: "completed",
          ...base,
          assemblyJobId: run.assemblyJobId ?? manifestRecord.jobId,
          manifestId: manifestRecord.manifestId,
          manifest,
          storageBucket: bucket,
          storageKey: key,
          storageSha256: expectedSha256,
          manifestStorageBucket: manifestBucket,
          manifestStorageKey: manifestKey,
          manifestStorageSha256: expectedManifestSha256,
          bytes: mediaObj.body.length,
          url,
          durationMs: measuredDurationMs,
          frameCount,
          fps,
          resolution,
          ...(stemLineage ? { stemLineage } : {}),
          completedAt: manifestRecord.createdAt
        };
      }

      return {
        status: "unavailable",
        ...base,
        reason: `Unknown acceptance run status: ${run.status}`
      };
    });
  }
}
