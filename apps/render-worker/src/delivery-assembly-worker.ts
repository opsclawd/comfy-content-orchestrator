import { LicenseRoutingError, type DeliveryAssemblyJobMutationResult } from "@cco/application";
import type { AssemblyExecutionResult, AssemblyManifest, AssemblySpec } from "@cco/contracts";
import type { DeliveryAssemblyJob, JobId, LeaseToken } from "@cco/domain";
import {
  ControlApiClientError,
  type DeliveryAssemblyControlApiClient
} from "./control-api-client.js";
import { isNonTransientStatusCode, type WorkerLogger } from "./worker.js";

export interface DeliveryAssemblyJobExecutorResult {
  readonly manifest: AssemblyManifest;
  readonly executionResult: AssemblyExecutionResult;
}

export type DeliveryAssemblyJobExecutor = (
  job: DeliveryAssemblyJob<AssemblySpec>
) => Promise<DeliveryAssemblyJobExecutorResult>;

export interface DeliveryAssemblyWorkerDependencies {
  readonly controlApiClient: DeliveryAssemblyControlApiClient;
  readonly assembleDeliveryReel: DeliveryAssemblyJobExecutor;
  readonly logger: WorkerLogger;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface DeliveryAssemblyWorkerOptions {
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
  readonly leaseDurationMs: number;
  /**
   * Maximum wall-clock time completeWithRetry/failWithRetry will keep
   * retrying a single settlement attempt, independent of shutdown state.
   *
   * The per-loop lease-expiry check (AttemptTracker.isFenced()) does NOT
   * bound this on its own: a concurrently running heartbeat loop keeps
   * calling updateLeaseExpiry() on successful heartbeats, so a persistent
   * outage limited to the completion/fail endpoint specifically (while
   * heartbeat keeps succeeding) would never trip lease expiry and would
   * retry forever outside of shutdown. This is a separate, wall-clock
   * deadline captured once when settlement starts, so it bounds retries
   * regardless of what heartbeats are doing concurrently.
   *
   * Defaults to 5x leaseDurationMs if not provided.
   */
  readonly maxSettlementMs?: number | undefined;
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
  private leaseExpiresAtMs: number;

  constructor(initialLeaseExpiresAtMs: number) {
    this.leaseExpiresAtMs = initialLeaseExpiresAtMs;
  }

  get phase(): AttemptPhase {
    return this.currentPhase;
  }

  set phase(next: AttemptPhase) {
    this.currentPhase = next;
  }

  updateLeaseExpiry(leaseExpiresAtMs: number): void {
    this.leaseExpiresAtMs = leaseExpiresAtMs;
  }

  getLeaseExpiry(): number {
    return this.leaseExpiresAtMs;
  }

  isLeaseExpired(nowMs: number = Date.now()): boolean {
    return nowMs >= this.leaseExpiresAtMs;
  }

  isFenced(nowMs: number = Date.now()): boolean {
    if (this.currentPhase === "fenced") {
      return true;
    }
    if (this.currentPhase !== "settled" && this.isLeaseExpired(nowMs)) {
      this.currentPhase = "fenced";
      return true;
    }
    return false;
  }
}

export class DeliveryAssemblyWorker {
  private readonly deps: DeliveryAssemblyWorkerDependencies;
  private readonly workerId: string;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly maxSettlementMs: number;

  private isRunning = false;
  private isShutdownRequested = false;
  private shutdownAbortController = new AbortController();
  private activeJobPromise: Promise<void> | undefined;
  private wakeIdleWait: (() => void) | undefined;

  constructor(deps: DeliveryAssemblyWorkerDependencies, options: DeliveryAssemblyWorkerOptions) {
    if (!deps) {
      throw new Error("DeliveryAssemblyWorkerDependencies are required");
    }
    if (!deps.controlApiClient) {
      throw new Error("controlApiClient is required");
    }
    if (typeof deps.assembleDeliveryReel !== "function") {
      throw new Error("assembleDeliveryReel must be a function");
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
      throw new Error("DeliveryAssemblyWorkerOptions are required");
    }
    if (typeof options.workerId !== "string" || options.workerId.trim().length === 0) {
      throw new Error("workerId must be a non-empty string");
    }
    this.workerId = options.workerId.trim();
    this.pollIntervalMs = validatePositiveInteger(options.pollIntervalMs, "pollIntervalMs");
    this.heartbeatIntervalMs = validatePositiveInteger(
      options.heartbeatIntervalMs,
      "heartbeatIntervalMs"
    );
    this.leaseDurationMs = validatePositiveInteger(options.leaseDurationMs, "leaseDurationMs");
    this.maxSettlementMs =
      options.maxSettlementMs !== undefined
        ? validatePositiveInteger(options.maxSettlementMs, "maxSettlementMs")
        : this.leaseDurationMs * 5;

    if (this.heartbeatIntervalMs >= this.leaseDurationMs) {
      throw new Error("heartbeatIntervalMs must be less than leaseDurationMs");
    }

    this.deps = deps;
  }

  requestShutdown(): void {
    this.isShutdownRequested = true;
    this.isRunning = false;
    if (!this.shutdownAbortController.signal.aborted) {
      this.shutdownAbortController.abort();
    }
    if (this.wakeIdleWait) {
      this.wakeIdleWait();
    }
  }

  async stop(): Promise<void> {
    this.requestShutdown();
    if (this.activeJobPromise) {
      try {
        await this.activeJobPromise;
      } catch {
        // Handled inside jobPromise
      }
    }
  }

  private async sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
    if (
      this.isShutdownRequested ||
      this.shutdownAbortController.signal.aborted ||
      signal?.aborted
    ) {
      return;
    }

    const abortController = new AbortController();
    const onShutdown = () => abortController.abort();
    const onSignal = () => abortController.abort();

    this.shutdownAbortController.signal.addEventListener("abort", onShutdown, { once: true });
    if (signal) {
      signal.addEventListener("abort", onSignal, { once: true });
    }

    const onWake = () => abortController.abort();
    this.wakeIdleWait = onWake;

    try {
      await this.deps.sleep(ms, abortController.signal);
    } finally {
      if (this.wakeIdleWait === onWake) {
        this.wakeIdleWait = undefined;
      }
      this.shutdownAbortController.signal.removeEventListener("abort", onShutdown);
      if (signal) {
        signal.removeEventListener("abort", onSignal);
      }
    }
  }

  private async startWithRetry(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    signal?: AbortSignal
  ): Promise<DeliveryAssemblyJobMutationResult> {
    while (true) {
      try {
        const result = await this.deps.controlApiClient.start(jobId, leaseToken);
        return result;
      } catch (err) {
        if (err instanceof ControlApiClientError) {
          if (err.statusCode === 409) {
            return { outcome: "superseded" };
          }
          if (err.statusCode === 404) {
            return { outcome: "not_found" };
          }
          if (isNonTransientStatusCode(err.statusCode)) {
            throw err;
          }
        }
        if (this.isShutdownRequested || signal?.aborted) {
          throw new Error(`Job ${jobId} start aborted due to worker shutdown`);
        }
        this.deps.logger.warn(
          `Job ${jobId} start failed with uncertainty: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        await this.sleepWithAbort(this.pollIntervalMs, signal);
        if (this.isShutdownRequested || signal?.aborted) {
          throw new Error(`Job ${jobId} start aborted due to worker shutdown`);
        }
      }
    }
  }

  private async completeWithRetry(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    attempt: AttemptTracker,
    signal?: AbortSignal
  ): Promise<DeliveryAssemblyJobMutationResult> {
    let shutdownRetryCount = 0;
    const maxShutdownRetries = 3;
    // Wall-clock deadline captured once, independent of AttemptTracker's
    // lease expiry (which a concurrent heartbeat loop keeps pushing out on
    // success). Bounds retries even when only the complete endpoint is
    // persistently failing while heartbeat stays healthy.
    const settlementDeadlineMs = Date.now() + this.maxSettlementMs;

    while (true) {
      if (attempt.isFenced()) {
        return { outcome: "superseded" };
      }

      if (Date.now() >= settlementDeadlineMs) {
        this.deps.logger.warn(
          `Job ${jobId} complete retry exceeded max settlement duration (${this.maxSettlementMs}ms); draining`
        );
        return { outcome: "superseded" };
      }

      try {
        const result = await this.deps.controlApiClient.complete(jobId, leaseToken);
        if (result.outcome === "applied" || result.outcome === "already_applied") {
          return result;
        }
        if (result.outcome === "superseded" || result.outcome === "not_found") {
          attempt.phase = "fenced";
          return result;
        }
      } catch (err) {
        if (err instanceof ControlApiClientError) {
          if (err.statusCode === 409) {
            attempt.phase = "fenced";
            return { outcome: "superseded" };
          }
          if (err.statusCode === 404) {
            attempt.phase = "fenced";
            return { outcome: "not_found" };
          }
          if (isNonTransientStatusCode(err.statusCode)) {
            throw err;
          }
        }
        this.deps.logger.warn(
          `Job ${jobId} complete failed with uncertainty: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // State reconciliation: verify whether complete already took effect or lease was lost
      try {
        const currentJob = await this.deps.controlApiClient.getJob(jobId);
        if (currentJob) {
          if (currentJob.status === "completed") {
            return { outcome: "already_applied", job: currentJob };
          }
          if (
            currentJob.leaseToken !== leaseToken ||
            (currentJob.status !== "rendering" && currentJob.status !== "leased")
          ) {
            attempt.phase = "fenced";
            return { outcome: "superseded" };
          }
          if (currentJob.leaseExpiresAt) {
            const expiryMs = new Date(currentJob.leaseExpiresAt).getTime();
            if (Date.now() >= expiryMs) {
              attempt.phase = "fenced";
              return { outcome: "superseded" };
            }
          }
        }
      } catch {
        // Reconciliation probe failed; proceed with uncertainty loop
      }

      if (attempt.isFenced()) {
        return { outcome: "superseded" };
      }

      if (this.isShutdownRequested || signal?.aborted) {
        shutdownRetryCount++;
        if (shutdownRetryCount >= maxShutdownRetries) {
          this.deps.logger.warn(
            `Job ${jobId} complete retry bounded limit reached during shutdown; draining`
          );
          return { outcome: "superseded" };
        }
      }

      await this.sleepWithAbort(this.pollIntervalMs, signal);
    }
  }

  private async failWithRetry(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string,
    attempt: AttemptTracker,
    signal?: AbortSignal
  ): Promise<DeliveryAssemblyJobMutationResult> {
    let shutdownRetryCount = 0;
    const maxShutdownRetries = 3;
    // See completeWithRetry: wall-clock deadline independent of a
    // concurrent heartbeat loop's lease-expiry renewal.
    const settlementDeadlineMs = Date.now() + this.maxSettlementMs;

    while (true) {
      if (attempt.isFenced()) {
        return { outcome: "superseded" };
      }

      if (Date.now() >= settlementDeadlineMs) {
        this.deps.logger.warn(
          `Job ${jobId} fail retry exceeded max settlement duration (${this.maxSettlementMs}ms); draining`
        );
        return { outcome: "superseded" };
      }

      try {
        const result = await this.deps.controlApiClient.fail(jobId, leaseToken, errorTrace);
        if (result.outcome === "applied" || result.outcome === "already_applied") {
          return result;
        }
        if (result.outcome === "superseded" || result.outcome === "not_found") {
          attempt.phase = "fenced";
          return result;
        }
      } catch (err) {
        if (err instanceof ControlApiClientError) {
          if (err.statusCode === 409) {
            attempt.phase = "fenced";
            return { outcome: "superseded" };
          }
          if (err.statusCode === 404) {
            attempt.phase = "fenced";
            return { outcome: "not_found" };
          }
          if (isNonTransientStatusCode(err.statusCode)) {
            throw err;
          }
        }
        this.deps.logger.warn(
          `Job ${jobId} fail failed with uncertainty: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      // State reconciliation: verify whether fail already took effect or lease was lost
      try {
        const currentJob = await this.deps.controlApiClient.getJob(jobId);
        if (currentJob) {
          if (currentJob.status === "failed" || currentJob.status === "queued") {
            return { outcome: "already_applied", job: currentJob };
          }
          if (
            currentJob.leaseToken !== leaseToken ||
            (currentJob.status !== "rendering" && currentJob.status !== "leased")
          ) {
            attempt.phase = "fenced";
            return { outcome: "superseded" };
          }
          if (currentJob.leaseExpiresAt) {
            const expiryMs = new Date(currentJob.leaseExpiresAt).getTime();
            if (Date.now() >= expiryMs) {
              attempt.phase = "fenced";
              return { outcome: "superseded" };
            }
          }
        }
      } catch {
        // Reconciliation probe failed; proceed with uncertainty loop
      }

      if (attempt.isFenced()) {
        return { outcome: "superseded" };
      }

      if (this.isShutdownRequested || signal?.aborted) {
        shutdownRetryCount++;
        if (shutdownRetryCount >= maxShutdownRetries) {
          this.deps.logger.warn(
            `Job ${jobId} fail retry bounded limit reached during shutdown; draining`
          );
          return { outcome: "superseded" };
        }
      }

      await this.sleepWithAbort(this.pollIntervalMs, signal);
    }
  }

  async processJob(
    job: DeliveryAssemblyJob<AssemblySpec>,
    signal?: AbortSignal
  ): Promise<"completed" | "failed" | "abandoned" | void> {
    if (!job.leaseToken) {
      this.deps.logger.error(`Claimed job ${job.jobId} without lease token; skipping`);
      return "abandoned";
    }
    const leaseToken = job.leaseToken;
    const initialLeaseExpiry = job.leaseExpiresAt
      ? new Date(job.leaseExpiresAt).getTime()
      : Date.now() + this.leaseDurationMs;
    const attempt = new AttemptTracker(initialLeaseExpiry);

    const startResult = await this.startWithRetry(job.jobId, leaseToken, signal);
    if (startResult.outcome === "superseded" || startResult.outcome === "not_found") {
      return "abandoned";
    }

    attempt.updateLeaseExpiry(Date.now() + this.leaseDurationMs);
    attempt.phase = "active";

    const heartbeatAbortController = new AbortController();
    let stopHeartbeats = false;
    let inFlightHeartbeat: Promise<void> | undefined;

    const runHeartbeatLoop = async (): Promise<void> => {
      while (
        !stopHeartbeats &&
        (attempt.phase === "active" || attempt.phase === "settling") &&
        !heartbeatAbortController.signal.aborted
      ) {
        try {
          await this.deps.sleep(this.heartbeatIntervalMs, heartbeatAbortController.signal);
        } catch {
          break;
        }

        if (
          stopHeartbeats ||
          (attempt.phase !== "active" && attempt.phase !== "settling") ||
          heartbeatAbortController.signal.aborted
        ) {
          break;
        }

        const heartbeatPromise = (async () => {
          try {
            const hbResult = await this.deps.controlApiClient.heartbeat(job.jobId, leaseToken);
            if (hbResult.outcome === "superseded" || hbResult.outcome === "not_found") {
              attempt.phase = "fenced";
              stopHeartbeats = true;
              heartbeatAbortController.abort();
              this.deps.logger.warn(
                `Job ${job.jobId} heartbeat returned '${hbResult.outcome}'; attempt is now fenced`
              );
            } else if (hbResult.outcome === "applied" || hbResult.outcome === "already_applied") {
              const updatedExpiry = hbResult.job?.leaseExpiresAt
                ? new Date(hbResult.job.leaseExpiresAt).getTime()
                : Date.now() + this.leaseDurationMs;
              attempt.updateLeaseExpiry(updatedExpiry);
            }
          } catch (err) {
            if (
              err instanceof ControlApiClientError &&
              (err.statusCode === 409 || err.statusCode === 404)
            ) {
              attempt.phase = "fenced";
              stopHeartbeats = true;
              heartbeatAbortController.abort();
              this.deps.logger.warn(
                `Job ${job.jobId} heartbeat returned '${err.statusCode}'; attempt is now fenced`
              );
            } else {
              this.deps.logger.warn(
                `Job ${job.jobId} heartbeat failed with uncertainty: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
              if (attempt.isLeaseExpired()) {
                attempt.phase = "fenced";
                stopHeartbeats = true;
                heartbeatAbortController.abort();
                this.deps.logger.warn(
                  `Job ${job.jobId} lease expired during heartbeat failure; attempt is now fenced`
                );
              }
            }
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

    void runHeartbeatLoop().catch((err: unknown) => {
      this.deps.logger.error(
        `Heartbeat loop failed: ${err instanceof Error ? err.message : String(err)}`
      );
    });

    let assemblyResult: DeliveryAssemblyJobExecutorResult | undefined;
    let assemblyError: unknown;
    let hasAssemblyError = false;

    try {
      assemblyResult = await this.deps.assembleDeliveryReel(job);
    } catch (error) {
      hasAssemblyError = true;
      assemblyError = error;
    }

    if (inFlightHeartbeat) {
      await inFlightHeartbeat;
    }

    if (attempt.isFenced()) {
      stopHeartbeats = true;
      heartbeatAbortController.abort();
      attempt.phase = "settled";
      return "abandoned";
    }

    attempt.phase = "settling";

    if (hasAssemblyError) {
      let errorTrace: string;
      if (assemblyError instanceof LicenseRoutingError) {
        errorTrace = JSON.stringify({
          error: "LicenseRoutingError",
          decisionId: assemblyError.decisionId,
          registryRevision: assemblyError.registryRevision,
          deniedReasons: assemblyError.deniedReasons,
          evaluatedComponents: assemblyError.evaluatedComponents
        }).slice(0, 2000);
      } else if (assemblyError instanceof Error) {
        errorTrace = (assemblyError.stack ?? assemblyError.message).slice(0, 4000);
      } else {
        errorTrace = String(assemblyError).slice(0, 4000);
      }

      this.deps.logger.error(`Delivery assembly job ${job.jobId} failed execution: ${errorTrace}`);

      try {
        const failResult = await this.failWithRetry(
          job.jobId,
          leaseToken,
          errorTrace,
          attempt,
          signal
        );
        if (
          failResult.outcome === "superseded" ||
          failResult.outcome === "not_found" ||
          attempt.isFenced()
        ) {
          return "abandoned";
        }
        return "failed";
      } finally {
        stopHeartbeats = true;
        heartbeatAbortController.abort();
        if (inFlightHeartbeat) {
          await inFlightHeartbeat;
        }
        attempt.phase = "settled";
      }
    }

    try {
      const completeResult = await this.completeWithRetry(job.jobId, leaseToken, attempt, signal);
      if (
        completeResult.outcome === "superseded" ||
        completeResult.outcome === "not_found" ||
        attempt.isFenced()
      ) {
        return "abandoned";
      }
      this.deps.logger.info(
        `Delivery assembly job ${job.jobId} successfully completed (manifest: ${assemblyResult!.manifest.assemblyId}, output: ${assemblyResult!.executionResult.output.media.key})`
      );
      return "completed";
    } catch (error) {
      const errorTrace = error instanceof Error ? (error.stack ?? error.message) : String(error);
      this.deps.logger.error(
        `Failed to complete delivery assembly job ${job.jobId}: ${errorTrace}`
      );
      return "failed";
    } finally {
      stopHeartbeats = true;
      heartbeatAbortController.abort();
      if (inFlightHeartbeat) {
        await inFlightHeartbeat;
      }
      attempt.phase = "settled";
    }
  }

  async runOnce(signal?: AbortSignal): Promise<boolean> {
    const job = await this.deps.controlApiClient.claim(this.workerId);
    if (!job) {
      return false;
    }
    await this.processJob(job, signal);
    return true;
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.isRunning = true;
    this.isShutdownRequested = false;
    this.shutdownAbortController = new AbortController();

    const onSignalAbort = () => {
      this.requestShutdown();
    };

    if (signal) {
      signal.addEventListener("abort", onSignalAbort, { once: true });
    }

    this.deps.logger.info(
      `Delivery assembly worker "${this.workerId}" started polling loop (poll=${this.pollIntervalMs}ms, heartbeat=${this.heartbeatIntervalMs}ms, lease=${this.leaseDurationMs}ms)`
    );

    try {
      while (this.isRunning && !this.isShutdownRequested && !signal?.aborted) {
        let claimedJob: DeliveryAssemblyJob<AssemblySpec> | undefined;
        let claimFailedGeneric = false;

        try {
          claimedJob = await this.deps.controlApiClient.claim(this.workerId);
        } catch (err) {
          claimFailedGeneric = true;
          this.deps.logger.warn(
            `Claim failed with error: ${err instanceof Error ? err.message : String(err)}`
          );
        }

        if (claimFailedGeneric) {
          await this.sleepWithAbort(this.pollIntervalMs, signal);
          continue;
        }

        if (!claimedJob) {
          await this.sleepWithAbort(this.pollIntervalMs, signal);
          continue;
        }

        const jobPromise = (async () => {
          try {
            await this.processJob(claimedJob!, signal);
          } catch (err) {
            this.deps.logger.error(
              `Job processing error for ${claimedJob!.jobId}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        })();

        this.activeJobPromise = jobPromise;
        try {
          await jobPromise;
        } finally {
          this.activeJobPromise = undefined;
        }
      }
    } finally {
      if (signal) {
        signal.removeEventListener("abort", onSignalAbort);
      }
      if (this.activeJobPromise) {
        try {
          await this.activeJobPromise;
        } catch {
          // Handled inside jobPromise
        }
      }
      this.isRunning = false;
      this.deps.logger.info(`Delivery assembly worker "${this.workerId}" stopped polling loop`);
    }
  }
}
