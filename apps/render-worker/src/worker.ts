import {
  StorageAdmissionError,
  type ObjectStoragePort,
  type PutObjectInput
} from "@cco/application";
import type { StorageOperationClass } from "@cco/contracts";
import type { RenderJob, StorageAdmissionPolicy } from "@cco/domain";
import type { CompleteJobOptions, ControlApiClient } from "./control-api-client.js";

export interface StorageAdmissionEnforcer {
  execute(operation: StorageOperationClass): Promise<StorageAdmissionPolicy>;
}

export interface WorkerRenderOutput {
  readonly mediaObjects?: readonly PutObjectInput[] | undefined;
  readonly candidatePayload?: Readonly<Record<string, unknown>> | undefined;
  readonly manifestPayload?: Readonly<Record<string, unknown>> | undefined;
}

export type RenderJobExecutor = (job: RenderJob) => Promise<WorkerRenderOutput>;

export interface WorkerDependencies {
  readonly controlApiClient: ControlApiClient;
  readonly objectStorage: ObjectStoragePort;
  readonly enforceStorageAdmission: StorageAdmissionEnforcer;
  readonly renderJobExecutor?: RenderJobExecutor | undefined;
}

export interface RenderWorkerOptions {
  readonly workerId?: string | undefined;
  readonly pollIntervalMs?: number | undefined;
}

export class RenderWorker {
  private readonly deps: WorkerDependencies;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private isRunning = false;

  constructor(deps: WorkerDependencies, options?: RenderWorkerOptions | undefined) {
    this.deps = deps;
    this.workerId = options?.workerId ?? "render-worker-default";
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
  }

  async processJob(job: RenderJob): Promise<void> {
    if (!job.leaseToken) {
      return;
    }
    const leaseToken = job.leaseToken;

    const startResult = await this.deps.controlApiClient.start(job.jobId, leaseToken);
    if (startResult.outcome === "superseded" || startResult.outcome === "not_found") {
      return;
    }

    let renderOutput: WorkerRenderOutput;
    try {
      if (this.deps.renderJobExecutor) {
        renderOutput = await this.deps.renderJobExecutor(job);
      } else {
        renderOutput = {};
      }
    } catch (error) {
      if (error instanceof StorageAdmissionError) {
        await this.deps.controlApiClient.defer(job.jobId, leaseToken, error.message);
        return;
      }
      const errorTrace = error instanceof Error ? (error.stack ?? error.message) : String(error);
      await this.deps.controlApiClient.fail(job.jobId, leaseToken, errorTrace);
      return;
    }

    try {
      await this.persistAndComplete(job, leaseToken, renderOutput);
    } catch (error) {
      if (error instanceof StorageAdmissionError) {
        await this.deps.controlApiClient.defer(job.jobId, leaseToken, error.message);
        return;
      }
      const errorTrace = error instanceof Error ? (error.stack ?? error.message) : String(error);
      await this.deps.controlApiClient.fail(job.jobId, leaseToken, errorTrace);
      return;
    }
  }

  private async persistAndComplete(
    job: RenderJob,
    leaseToken: string,
    renderOutput: WorkerRenderOutput
  ): Promise<void> {
    const mediaObjects = renderOutput.mediaObjects ?? [];
    const mediaOperation: StorageOperationClass =
      job.jobKind === "candidate" ? "candidate_upload" : "delivery_write";

    for (const mediaObject of mediaObjects) {
      await this.deps.enforceStorageAdmission.execute(mediaOperation);
      await this.deps.objectStorage.putObject(mediaObject);
    }

    const completionOperation: StorageOperationClass =
      job.jobKind === "candidate" ? "candidate_upload" : "delivery_write";

    await this.deps.enforceStorageAdmission.execute(completionOperation);

    const completePayload: CompleteJobOptions =
      job.jobKind === "candidate"
        ? { candidatePayload: renderOutput.candidatePayload ?? { variantOrdinal: 0 } }
        : { manifestPayload: renderOutput.manifestPayload ?? {} };

    const completeResult = await this.deps.controlApiClient.complete(
      job.jobId,
      leaseToken,
      completePayload
    );

    if (completeResult.outcome === "superseded" || completeResult.outcome === "not_found") {
      return;
    }
  }

  async runOnce(): Promise<boolean> {
    const job = await this.deps.controlApiClient.claim(this.workerId);
    if (!job) {
      return false;
    }
    await this.processJob(job);
    return true;
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.isRunning = true;
    while (this.isRunning && !signal?.aborted) {
      try {
        const processed = await this.runOnce();
        if (!processed && this.isRunning && !signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      } catch {
        if (signal?.aborted) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
    }
  }

  stop(): void {
    this.isRunning = false;
  }
}

export function createRenderWorker(
  deps: WorkerDependencies,
  options?: RenderWorkerOptions | undefined
): RenderWorker {
  return new RenderWorker(deps, options);
}
