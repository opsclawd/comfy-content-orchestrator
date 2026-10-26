import { createHash, randomUUID } from "node:crypto";
import { BUCKETS } from "@cco/shared";
import type {
  AcceptanceAssemblyJob,
  AcceptanceAssemblyManifest,
  AssemblyExecutionResult,
  AssemblyManifest,
  AssemblySpec
} from "@cco/contracts";
import {
  validateAcceptanceStemSource,
  type ObjectStoragePort,
  type UnitOfWork,
  type VideoStemSourceRecord
} from "@cco/application";
import type { AcceptanceAssemblyControlApiClient } from "./control-api-client.js";
import type { WorkerLogger } from "./worker.js";

export interface AcceptanceAssemblyJobExecutorResult {
  readonly manifest: AssemblyManifest;
  readonly executionResult: AssemblyExecutionResult;
}

export type AcceptanceAssemblyJobExecutor = (params: {
  readonly spec: AssemblySpec;
  readonly targetBucket?: string | undefined;
  readonly acceptanceRunId?: string | undefined;
  readonly outputKey?: string | undefined;
}) => Promise<AcceptanceAssemblyJobExecutorResult>;

export interface AcceptanceDeliveryAssemblyWorkerDependencies {
  readonly uow?: UnitOfWork | undefined;
  readonly controlApiClient?: AcceptanceAssemblyControlApiClient | undefined;
  readonly assembleDeliveryReel: AcceptanceAssemblyJobExecutor;
  readonly objectStorage?: ObjectStoragePort | undefined;
  readonly logger?: WorkerLogger | undefined;
}

export interface AcceptanceDeliveryAssemblyWorkerOptions {
  readonly workerId: string;
  readonly lockTimeoutMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export class AcceptanceDeliveryAssemblyWorker {
  private readonly uow?: UnitOfWork | undefined;
  private readonly controlApiClient?: AcceptanceAssemblyControlApiClient | undefined;
  private readonly assembleDeliveryReel: AcceptanceAssemblyJobExecutor;
  private readonly objectStorage?: ObjectStoragePort | undefined;
  private readonly logger?: WorkerLogger | undefined;
  private readonly workerId: string;
  private readonly lockTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private running = false;
  private pollTimeout?: ReturnType<typeof setTimeout> | undefined;

  constructor(
    deps: AcceptanceDeliveryAssemblyWorkerDependencies,
    options: AcceptanceDeliveryAssemblyWorkerOptions
  ) {
    this.uow = deps.uow;
    this.controlApiClient = deps.controlApiClient;
    this.assembleDeliveryReel = deps.assembleDeliveryReel;
    this.objectStorage = deps.objectStorage;
    this.logger = deps.logger;
    this.workerId = options.workerId;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger?.info(`[AcceptanceDeliveryAssemblyWorker] Worker ${this.workerId} started`);
    while (this.running) {
      try {
        const manifest = await this.processNextJob();
        if (!manifest && this.running) {
          await new Promise((r) => {
            this.pollTimeout = setTimeout(r, this.pollIntervalMs);
          });
        }
      } catch (err) {
        if (!this.running) break;
        this.logger?.error(
          `[AcceptanceDeliveryAssemblyWorker] Error in poll loop: ${(err as Error).message}`
        );
        await new Promise((r) => {
          this.pollTimeout = setTimeout(r, this.pollIntervalMs);
        });
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = undefined;
    }
    this.logger?.info(`[AcceptanceDeliveryAssemblyWorker] Worker ${this.workerId} stopped`);
  }

  async processNextJob(): Promise<AcceptanceAssemblyManifest | undefined> {
    let job: AcceptanceAssemblyJob | undefined;
    if (this.controlApiClient) {
      job = await this.controlApiClient.claim(this.workerId, this.lockTimeoutMs);
    } else if (this.uow) {
      job = await this.uow.execute(async (ctx) => {
        if (!ctx.acceptanceAssemblyJobs) {
          throw new Error("UnitOfWorkContext.acceptanceAssemblyJobs is not configured");
        }
        return await ctx.acceptanceAssemblyJobs.claim(this.workerId, this.lockTimeoutMs);
      });
    } else {
      throw new Error("Neither controlApiClient nor uow is configured");
    }

    if (!job) {
      return undefined;
    }

    return await this.executeJob(job);
  }

  async executeJob(job: AcceptanceAssemblyJob): Promise<AcceptanceAssemblyManifest> {
    this.logger?.info(
      `[AcceptanceDeliveryAssemblyWorker] Starting job ${job.jobId} for run ${job.acceptanceRunId}`
    );

    const { run, scenes, stemSources } = this.uow
      ? await this.uow.execute(async (ctx) => {
          if (!ctx.operatorAcceptanceRuns) {
            throw new Error("UnitOfWorkContext.operatorAcceptanceRuns is not configured");
          }
          const r = await ctx.operatorAcceptanceRuns.findRunById(job.acceptanceRunId);
          if (!r) {
            throw new Error(`Acceptance run ${job.acceptanceRunId} not found`);
          }
          const scs = await ctx.operatorAcceptanceRuns.findRunScenes(job.acceptanceRunId);
          const sources: VideoStemSourceRecord[] = [];
          for (const scene of scs) {
            if (!scene.acceptedStagingJobId) {
              throw new Error(`Scene ${scene.sceneId} is missing accepted staging job ID`);
            }
            if (!ctx.generationManifests?.findVideoStemSourceByJobId) {
              throw new Error("UnitOfWorkContext.generationManifests is not configured");
            }
            const stemSource = await ctx.generationManifests.findVideoStemSourceByJobId(
              scene.acceptedStagingJobId
            );
            if (!stemSource) {
              throw new Error(
                `Generation manifest and stem source not found for staging job ${scene.acceptedStagingJobId}`
              );
            }
            validateAcceptanceStemSource(scene, stemSource, {
              realm: r.realm,
              evidenceOrigin: r.evidenceOrigin
            });
            sources.push(stemSource);
          }
          return { run: r, scenes: scs, stemSources: sources };
        })
      : {
          run: {
            acceptanceRunId: job.acceptanceRunId,
            campaignId: job.campaignId,
            planId: randomUUID(),
            realm: job.realm,
            evidenceOrigin: job.evidenceOrigin,
            status: "assembling" as const,
            expectedTotalDurationMs: 10000,
            createdBy: "system",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          },
          scenes: [],
          stemSources: []
        };

    // Guard against drift between queued job.assemblySpec and verified current stem sources
    if (scenes.length > 0) {
      if (job.assemblySpec.videoStems.length !== scenes.length) {
        throw new Error(
          `Assembly spec videoStems count (${job.assemblySpec.videoStems.length}) does not match scenes count (${scenes.length})`
        );
      }
      for (let i = 0; i < scenes.length; i++) {
        const queuedStem = job.assemblySpec.videoStems[i]!;
        const expectedScene = scenes[i]!;
        const stemSource = stemSources[i]!;
        if (queuedStem.sceneId !== expectedScene.sceneId) {
          throw new Error(
            `Queued stem sceneId '${queuedStem.sceneId}' does not match scene sceneId '${expectedScene.sceneId}'`
          );
        }
        if (
          queuedStem.media.sha256 !== stemSource.media.sha256 ||
          queuedStem.media.key !== stemSource.media.key
        ) {
          throw new Error(
            `Queued stem media '${queuedStem.media.key}' does not match validated stem source media '${stemSource.media.key}'`
          );
        }
      }
    }

    if (this.controlApiClient && job.leaseToken) {
      await this.controlApiClient.start(job.jobId, job.leaseToken);
    } else if (this.uow) {
      await this.uow.execute(async (ctx) => {
        if (ctx.acceptanceAssemblyJobs?.start && job.leaseToken) {
          await ctx.acceptanceAssemblyJobs.start(job.jobId, job.leaseToken);
        }
      });
    }

    let isFenced = false;
    const heartbeatIntervalMs = Math.max(1000, Math.floor(this.lockTimeoutMs / 3));
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    if (job.leaseToken) {
      heartbeatTimer = setInterval(() => {
        if (this.controlApiClient && job.leaseToken) {
          this.controlApiClient
            .heartbeat(job.jobId, job.leaseToken, this.lockTimeoutMs)
            .catch((err) => {
              isFenced = true;
              this.logger?.warn(
                `[AcceptanceDeliveryAssemblyWorker] Heartbeat failed for job ${job.jobId}: ${(err as Error).message}`
              );
            });
        } else if (this.uow) {
          void this.uow
            .execute(async (ctx) => {
              if (ctx.acceptanceAssemblyJobs?.heartbeat && job.leaseToken) {
                await ctx.acceptanceAssemblyJobs.heartbeat(
                  job.jobId,
                  job.leaseToken,
                  this.lockTimeoutMs
                );
              }
            })
            .catch((err) => {
              isFenced = true;
              this.logger?.warn(
                `[AcceptanceDeliveryAssemblyWorker] Heartbeat failed for job ${job.jobId}: ${(err as Error).message}`
              );
            });
        }
      }, heartbeatIntervalMs);
    }

    try {
      if (isFenced) {
        throw new Error(`Job ${job.jobId} lease expired or fenced before assembly execution`);
      }

      const outputKey = `acceptance-runs/${job.acceptanceRunId}/reel.mp4`;
      const { manifest, executionResult } = await this.assembleDeliveryReel({
        spec: job.assemblySpec,
        targetBucket: BUCKETS.CANDIDATES,
        acceptanceRunId: job.acceptanceRunId,
        outputKey
      });

      if (executionResult.output.media.bucket !== BUCKETS.CANDIDATES) {
        throw new Error(
          `Acceptance assembly output bucket "${executionResult.output.media.bucket}" must be "${BUCKETS.CANDIDATES}"`
        );
      }
      if (executionResult.output.media.key !== outputKey) {
        throw new Error(
          `Acceptance assembly output key "${executionResult.output.media.key}" does not match expected "${outputKey}"`
        );
      }

      if (isFenced) {
        throw new Error(`Job ${job.jobId} lease expired or fenced during assembly execution`);
      }

      // Deterministic manifest ID bound to (job.jobId, executionResult.output.media.sha256)
      const rawSeed = `acceptance-manifest:${job.jobId}:${executionResult.output.media.sha256}`;
      const hash = createHash("sha256").update(rawSeed).digest("hex");
      const manifestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;

      const acceptedAttemptIds =
        scenes.length > 0
          ? scenes.map((s) => s.acceptedAttemptId).filter((id): id is string => Boolean(id))
          : job.assemblySpec.videoStems.map((s) => s.sceneId);

      const manifestStorageBucket = BUCKETS.CANDIDATES;
      const manifestStorageKey = `acceptance-runs/${job.acceptanceRunId}/manifest.json`;
      const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
      const manifestStorageSha256 = createHash("sha256").update(manifestBytes).digest("hex");

      if (this.objectStorage) {
        await this.objectStorage.putObject({
          bucket: manifestStorageBucket,
          key: manifestStorageKey,
          body: manifestBytes,
          contentType: "application/json"
        });
      }

      const acceptanceManifest: AcceptanceAssemblyManifest = {
        manifestId,
        jobId: job.jobId,
        acceptanceRunId: job.acceptanceRunId,
        campaignId: job.campaignId,
        realm: job.realm,
        evidenceOrigin: job.evidenceOrigin,
        planId: run.planId,
        acceptedAttemptIds,
        manifest,
        storageBucket: executionResult.output.media.bucket,
        storageKey: executionResult.output.media.key,
        storageSha256: executionResult.output.media.sha256,
        manifestStorageBucket,
        manifestStorageKey,
        manifestStorageSha256,
        createdAt: new Date().toISOString()
      };

      if (this.controlApiClient && job.leaseToken) {
        await this.controlApiClient.complete(
          job.jobId,
          job.leaseToken,
          manifestId,
          acceptanceManifest
        );
      } else if (this.uow) {
        await this.uow.execute(async (ctx) => {
          if (!ctx.acceptanceAssemblyManifests) {
            throw new Error("UnitOfWorkContext.acceptanceAssemblyManifests is not configured");
          }
          if (!ctx.acceptanceAssemblyJobs) {
            throw new Error("UnitOfWorkContext.acceptanceAssemblyJobs is not configured");
          }
          if (!ctx.operatorAcceptanceRuns) {
            throw new Error("UnitOfWorkContext.operatorAcceptanceRuns is not configured");
          }

          await ctx.acceptanceAssemblyManifests.saveManifest(acceptanceManifest);
          await ctx.acceptanceAssemblyJobs.complete(job.jobId, manifestId, job.leaseToken);
          await ctx.operatorAcceptanceRuns.updateRunStatus(
            job.acceptanceRunId,
            "completed",
            job.jobId
          );
        });
      }

      this.logger?.info(
        `[AcceptanceDeliveryAssemblyWorker] Completed job ${job.jobId}, saved manifest ${manifestId}`
      );
      return acceptanceManifest;
    } catch (err) {
      const errorMsg = (err as Error).message ?? "Unknown error during acceptance reel assembly";
      const leaseLost =
        isFenced ||
        errorMsg.includes("lease") ||
        errorMsg.includes("expired") ||
        errorMsg.includes("mismatch") ||
        errorMsg.includes("stolen");

      this.logger?.error(`[AcceptanceDeliveryAssemblyWorker] Failed job ${job.jobId}: ${errorMsg}`);

      if (leaseLost) {
        this.logger?.warn(
          `[AcceptanceDeliveryAssemblyWorker] Job ${job.jobId} lease expired or lost (${errorMsg}); skipping failure status update`
        );
      } else {
        if (this.controlApiClient && job.leaseToken) {
          try {
            await this.controlApiClient.fail(
              job.jobId,
              job.leaseToken,
              job.acceptanceRunId,
              errorMsg
            );
          } catch (failErr) {
            this.logger?.warn(
              `[AcceptanceDeliveryAssemblyWorker] Could not mark job ${job.jobId} as failed via control-api: ${(failErr as Error).message}`
            );
          }
        } else if (this.uow) {
          await this.uow.execute(async (ctx) => {
            if (ctx.acceptanceAssemblyJobs && job.leaseToken) {
              await ctx.acceptanceAssemblyJobs.fail(job.jobId, errorMsg, job.leaseToken);
            }
            if (ctx.operatorAcceptanceRuns) {
              await ctx.operatorAcceptanceRuns.updateRunStatus(
                job.acceptanceRunId,
                "failed",
                job.jobId
              );
            }
          });
        }
      }

      throw err;
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
  }
}
