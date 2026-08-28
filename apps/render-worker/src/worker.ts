import {
  StorageAdmissionError,
  type ObjectStoragePort,
  type PutObjectInput
} from "@cco/application";
import type { StorageOperationClass } from "@cco/contracts";
import type { JobKind, RenderJob, StorageAdmissionPolicy } from "@cco/domain";
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

export interface WorkerLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug?(message: string, ...args: unknown[]): void;
}

export interface WorkerDependencies {
  readonly controlApiClient: ControlApiClient;
  readonly objectStorage: ObjectStoragePort;
  readonly enforceStorageAdmission: StorageAdmissionEnforcer;
  readonly renderJobExecutor: RenderJobExecutor;
  readonly logger: WorkerLogger;
  readonly sleep: (ms: number) => Promise<void>;
}

export interface RenderWorkerOptions {
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly allowedJobKinds?: readonly JobKind[] | undefined;
}

export type AttemptPhase = "starting" | "active" | "fenced" | "settling" | "settled";

function validatePositiveInteger(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

class AttemptTracker {
  private currentPhase: AttemptPhase = "starting";

  get phase(): AttemptPhase {
    return this.currentPhase;
  }

  set phase(next: AttemptPhase) {
    this.currentPhase = next;
  }

  isFenced(): boolean {
    return this.currentPhase === "fenced";
  }
}

export class RenderWorker {
  private readonly deps: WorkerDependencies;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly allowedJobKinds?: readonly JobKind[] | undefined;
  private isRunning = false;

  constructor(deps: WorkerDependencies, options: RenderWorkerOptions) {
    if (!deps) {
      throw new Error("WorkerDependencies are required");
    }
    if (!deps.controlApiClient) {
      throw new Error("controlApiClient is required");
    }
    if (!deps.objectStorage) {
      throw new Error("objectStorage is required");
    }
    if (!deps.enforceStorageAdmission) {
      throw new Error("enforceStorageAdmission is required");
    }
    if (typeof deps.renderJobExecutor !== "function") {
      throw new Error("renderJobExecutor must be a function");
    }
    if (
      !deps.logger ||
      typeof deps.logger.warn !== "function" ||
      typeof deps.logger.error !== "function" ||
      typeof deps.logger.info !== "function"
    ) {
      throw new Error("logger with info, warn, error methods is required");
    }
    if (typeof deps.sleep !== "function") {
      throw new Error("sleep must be a function");
    }

    if (!options) {
      throw new Error("RenderWorkerOptions are required");
    }
    if (typeof options.workerId !== "string" || options.workerId.trim() === "") {
      throw new Error("workerId must be a non-empty string");
    }
    this.workerId = options.workerId.trim();

    this.pollIntervalMs = validatePositiveInteger(options.pollIntervalMs, "pollIntervalMs");
    this.heartbeatIntervalMs = validatePositiveInteger(
      options.heartbeatIntervalMs,
      "heartbeatIntervalMs"
    );
    this.leaseDurationMs = validatePositiveInteger(options.leaseDurationMs, "leaseDurationMs");

    if (this.heartbeatIntervalMs >= this.leaseDurationMs) {
      throw new Error("heartbeatIntervalMs must be less than leaseDurationMs");
    }

    this.allowedJobKinds = options.allowedJobKinds;
    this.deps = deps;
  }

  async processJob(job: RenderJob): Promise<void> {
    if (!job.leaseToken) {
      return;
    }
    const leaseToken = job.leaseToken;

    const attempt = new AttemptTracker();

    const startResult = await this.deps.controlApiClient.start(job.jobId, leaseToken);
    if (startResult.outcome === "superseded" || startResult.outcome === "not_found") {
      return;
    }

    attempt.phase = "active";

    let stopHeartbeats = false;
    let inFlightHeartbeat: Promise<void> | undefined;

    const runHeartbeatLoop = async (): Promise<void> => {
      while (!stopHeartbeats && attempt.phase === "active") {
        await this.deps.sleep(this.heartbeatIntervalMs);

        if (stopHeartbeats || attempt.phase !== "active") {
          break;
        }

        const heartbeatPromise = (async () => {
          try {
            const hbResult = await this.deps.controlApiClient.heartbeat(job.jobId, leaseToken);
            if (hbResult.outcome === "superseded" || hbResult.outcome === "not_found") {
              attempt.phase = "fenced";
              stopHeartbeats = true;
              this.deps.logger.warn(
                `Job ${job.jobId} heartbeat returned '${hbResult.outcome}'; attempt is now fenced`
              );
            }
          } catch (err) {
            this.deps.logger.warn(
              `Job ${job.jobId} heartbeat failed with uncertainty: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        })();

        inFlightHeartbeat = heartbeatPromise;
        try {
          await heartbeatPromise;
        } finally {
          if (inFlightHeartbeat === heartbeatPromise) {
            inFlightHeartbeat = undefined;
          }
        }
      }
    };

    void runHeartbeatLoop();

    let renderOutput: WorkerRenderOutput | undefined;
    let renderError: unknown;
    let hasRenderError = false;

    try {
      renderOutput = await this.deps.renderJobExecutor(job);
    } catch (error) {
      hasRenderError = true;
      renderError = error;
    }

    // Render settlement: active|fenced -> settling
    stopHeartbeats = true;

    // Await in-flight heartbeat before publishing / classifying
    if (inFlightHeartbeat) {
      await inFlightHeartbeat;
    }

    if (attempt.isFenced()) {
      attempt.phase = "settled";
      return;
    }

    attempt.phase = "settling";

    if (hasRenderError) {
      attempt.phase = "settled";
      if (renderError instanceof StorageAdmissionError) {
        await this.deps.controlApiClient.defer(job.jobId, leaseToken, renderError.message);
        return;
      }
      const errorTrace =
        renderError instanceof Error
          ? (renderError.stack ?? renderError.message)
          : String(renderError);
      await this.deps.controlApiClient.fail(job.jobId, leaseToken, errorTrace);
      return;
    }

    try {
      await this.persistAndComplete(job, leaseToken, renderOutput!);
      attempt.phase = "settled";
    } catch (error) {
      attempt.phase = "settled";
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
    if (!renderOutput || typeof renderOutput !== "object") {
      throw new Error("Render output must be an object");
    }

    if (job.jobKind === "candidate") {
      if (!renderOutput.candidatePayload || typeof renderOutput.candidatePayload !== "object") {
        throw new Error("Candidate jobs require candidatePayload in render output");
      }
      if (renderOutput.manifestPayload !== undefined) {
        throw new Error("Candidate jobs must not provide manifestPayload");
      }
    } else {
      if (!renderOutput.manifestPayload || typeof renderOutput.manifestPayload !== "object") {
        throw new Error("Production jobs require manifestPayload in render output");
      }
      if (renderOutput.candidatePayload !== undefined) {
        throw new Error("Production jobs must not provide candidatePayload");
      }
    }

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
        ? { candidatePayload: renderOutput.candidatePayload }
        : { manifestPayload: renderOutput.manifestPayload };

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
    const job = await this.deps.controlApiClient.claim(this.workerId, this.allowedJobKinds);
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
          await this.deps.sleep(this.pollIntervalMs);
        }
      } catch {
        if (signal?.aborted) {
          break;
        }
        await this.deps.sleep(this.pollIntervalMs);
      }
    }
  }

  stop(): void {
    this.isRunning = false;
  }
}

export function createRenderWorker(
  deps: WorkerDependencies,
  options: RenderWorkerOptions
): RenderWorker {
  return new RenderWorker(deps, options);
}
