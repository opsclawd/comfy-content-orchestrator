import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AssembleGenerationManifest,
  IncompleteManifestError,
  StorageAdmissionError,
  type HashBytesPort,
  type JobMutationResult,
  type ObjectLocator,
  type ObjectStoragePort,
  type PutObjectInput,
  type StoredObject
} from "@cco/application";
import type { StorageOperationClass } from "@cco/contracts";
import {
  createStorageAdmissionPolicy,
  Scene,
  type CampaignId,
  type CandidateId,
  type JobId,
  type JobKind,
  type LeaseToken,
  type RenderJob,
  type SceneId,
  type StorageAdmissionPolicy,
  type StoryboardCandidate
} from "@cco/domain";
import type { CompleteJobOptions, ControlApiClient } from "./control-api-client.js";
import { ControlApiClientError } from "./control-api-client.js";
import type {
  CertificationProfile,
  CertificationProvenanceReport,
  ComfyUiOutputReader
} from "@cco/infrastructure";
import {
  createCertifiedRenderJobExecutor,
  MissingCertifiedProfileError
} from "./render-job-executor.js";
import {
  RenderWorker,
  type RenderJobExecutor,
  type RenderWorkerOptions,
  type StorageAdmissionEnforcer,
  type WorkerDependencies,
  type WorkerLogger,
  type WorkerRenderOutput
} from "./worker.js";

export class FakeControlApiClient implements ControlApiClient {
  readonly claimCalls: Array<{
    workerId: string;
    allowedJobKinds?: readonly JobKind[] | undefined;
  }> = [];
  readonly startCalls: Array<{ jobId: JobId | string; leaseToken: LeaseToken | string }> = [];
  readonly heartbeatCalls: Array<{ jobId: JobId | string; leaseToken: LeaseToken | string }> = [];
  readonly completeCalls: Array<{
    jobId: JobId | string;
    leaseToken: LeaseToken | string;
    payload: CompleteJobOptions | undefined;
  }> = [];
  readonly failCalls: Array<{
    jobId: JobId | string;
    leaseToken: LeaseToken | string;
    errorTrace: string;
  }> = [];
  readonly deferCalls: Array<{
    jobId: JobId | string;
    leaseToken: LeaseToken | string;
    reason: string;
  }> = [];

  constructor(
    private readonly config?:
      | {
          claimResult?: RenderJob | undefined;
          startResult?: JobMutationResult | undefined;
          heartbeatResult?: JobMutationResult | undefined;
          completeResult?: JobMutationResult | undefined;
          failResult?: JobMutationResult | undefined;
          deferResult?: JobMutationResult | undefined;
          onClaim?: (
            workerId: string,
            allowedJobKinds?: readonly JobKind[] | undefined
          ) => Promise<RenderJob | undefined> | RenderJob | undefined;
          onStart?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string
          ) => Promise<JobMutationResult> | JobMutationResult;
          onHeartbeat?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string
          ) => Promise<JobMutationResult> | JobMutationResult;
          onComplete?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string,
            payload?: CompleteJobOptions | undefined
          ) => Promise<JobMutationResult> | JobMutationResult;
          onFail?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string,
            errorTrace: string
          ) => Promise<JobMutationResult> | JobMutationResult;
          onDefer?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string,
            reason: string
          ) => Promise<JobMutationResult> | JobMutationResult;
        }
      | undefined
  ) {}

  async claim(
    workerId: string,
    allowedJobKinds?: readonly JobKind[]
  ): Promise<RenderJob | undefined> {
    this.claimCalls.push({ workerId, allowedJobKinds });
    if (this.config?.onClaim) {
      return this.config.onClaim(workerId, allowedJobKinds);
    }
    return this.config?.claimResult;
  }

  async start(jobId: JobId | string, leaseToken: LeaseToken | string): Promise<JobMutationResult> {
    this.startCalls.push({ jobId, leaseToken });
    if (this.config?.onStart) {
      return this.config.onStart(jobId, leaseToken);
    }
    return this.config?.startResult ?? { outcome: "applied", job: {} as RenderJob };
  }

  async heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<JobMutationResult> {
    this.heartbeatCalls.push({ jobId, leaseToken });
    if (this.config?.onHeartbeat) {
      return this.config.onHeartbeat(jobId, leaseToken);
    }
    return this.config?.heartbeatResult ?? { outcome: "applied", job: {} as RenderJob };
  }

  async complete(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    payload?: CompleteJobOptions | undefined
  ): Promise<JobMutationResult> {
    this.completeCalls.push({ jobId, leaseToken, payload });
    if (this.config?.onComplete) {
      return this.config.onComplete(jobId, leaseToken, payload);
    }
    return this.config?.completeResult ?? { outcome: "applied", job: {} as RenderJob };
  }

  async fail(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    errorTrace: string
  ): Promise<JobMutationResult> {
    this.failCalls.push({ jobId, leaseToken, errorTrace });
    if (this.config?.onFail) {
      return this.config.onFail(jobId, leaseToken, errorTrace);
    }
    return this.config?.failResult ?? { outcome: "applied", job: {} as RenderJob };
  }

  async defer(
    jobId: JobId | string,
    leaseToken: LeaseToken | string,
    reason: string
  ): Promise<JobMutationResult> {
    this.deferCalls.push({ jobId, leaseToken, reason });
    if (this.config?.onDefer) {
      return this.config.onDefer(jobId, leaseToken, reason);
    }
    return this.config?.deferResult ?? { outcome: "deferred", job: {} as RenderJob };
  }
}

export class FakeObjectStorage implements ObjectStoragePort {
  readonly puts: PutObjectInput[] = [];
  readonly stored = new Map<string, StoredObject>();

  constructor(private readonly onPut?: (input: PutObjectInput) => void) {}

  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    this.puts.push(input);
    this.stored.set(`${input.bucket}/${input.key}`, { ...input });
    this.onPut?.(input);
    return { bucket: input.bucket, key: input.key };
  }

  async getObject(locator: ObjectLocator): Promise<StoredObject | undefined> {
    return this.stored.get(`${locator.bucket}/${locator.key}`);
  }
}

export class FakeStorageAdmissionEnforcer implements StorageAdmissionEnforcer {
  readonly calls: StorageOperationClass[] = [];

  constructor(
    private readonly handler?: (
      operation: StorageOperationClass
    ) => Promise<StorageAdmissionPolicy> | StorageAdmissionPolicy
  ) {}

  async execute(operation: StorageOperationClass): Promise<StorageAdmissionPolicy> {
    this.calls.push(operation);
    if (this.handler) {
      return this.handler(operation);
    }
    return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
  }
}

export class FakeLogger implements WorkerLogger {
  readonly infoLogs: string[] = [];
  readonly warnLogs: string[] = [];
  readonly errorLogs: string[] = [];

  info(msg: string, ..._args: unknown[]): void {
    this.infoLogs.push(msg);
  }
  warn(msg: string, ..._args: unknown[]): void {
    this.warnLogs.push(msg);
  }
  error(msg: string, ..._args: unknown[]): void {
    this.errorLogs.push(msg);
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

export function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class FakeScheduler {
  readonly sleepCalls: number[] = [];
  private pendingSleeps: Array<{
    ms: number;
    resolve: () => void;
    signal?: AbortSignal | undefined;
  }> = [];

  sleep = (ms: number, signal?: AbortSignal): Promise<void> => {
    this.sleepCalls.push(ms);
    return new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const entry = { ms, resolve, signal };
      this.pendingSleeps.push(entry);
      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            const index = this.pendingSleeps.indexOf(entry);
            if (index !== -1) {
              this.pendingSleeps.splice(index, 1);
            }
            resolve();
          },
          { once: true }
        );
      }
    });
  };

  async advanceNext(turns = 10): Promise<boolean> {
    const next = this.pendingSleeps.shift();
    if (next) {
      next.resolve();
      for (let i = 0; i < turns; i++) {
        await Promise.resolve();
      }
      return true;
    }
    return false;
  }

  get pendingCount(): number {
    return this.pendingSleeps.length;
  }
}

export async function flushPromises(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

const sampleJobId = "11111111-1111-4111-8111-111111111111" as JobId;
const sampleSceneId = "33333333-3333-4333-8333-333333333333" as SceneId;
const sampleLeaseToken = "22222222-2222-4222-8222-222222222222" as LeaseToken;

function createSampleJob(overrides?: Partial<RenderJob>): RenderJob {
  return {
    jobId: sampleJobId,
    sceneId: sampleSceneId,
    jobKind: "candidate",
    status: "leased",
    workflowTemplate: "candidate-preview",
    injectedPayload: { prompt: "test prompt" },
    workerId: "worker-1",
    leaseToken: sampleLeaseToken,
    leaseExpiresAt: new Date("2026-08-27T10:00:00.000Z"),
    retryCount: 0,
    maxRetries: 3,
    errorTrace: null,
    createdAt: new Date("2026-08-27T08:00:00.000Z"),
    updatedAt: new Date("2026-08-27T08:00:00.000Z"),
    ...overrides
  };
}

function createTestWorker(
  depsOverrides?: Partial<WorkerDependencies>,
  optionsOverrides?: Partial<RenderWorkerOptions>
) {
  const fakeClient = new FakeControlApiClient();
  const fakeStorage = new FakeObjectStorage();
  const fakeEnforcer = new FakeStorageAdmissionEnforcer();
  const scheduler = new FakeScheduler();
  const logger = new FakeLogger();
  const defaultExecutor: RenderJobExecutor = async (job) => ({
    mediaObjects: [],
    ...(job.jobKind === "candidate"
      ? { candidatePayload: { variantOrdinal: 1 } }
      : { manifestPayload: { sceneId: job.sceneId } })
  });

  const deps: WorkerDependencies = {
    controlApiClient: fakeClient,
    objectStorage: fakeStorage,
    enforceStorageAdmission: fakeEnforcer,
    renderJobExecutor: defaultExecutor,
    logger,
    sleep: scheduler.sleep,
    ...depsOverrides
  };

  const options: RenderWorkerOptions = {
    workerId: "test-worker",
    pollIntervalMs: 1000,
    heartbeatIntervalMs: 10000,
    leaseDurationMs: 30000,
    ...optionsOverrides
  };

  const worker = new RenderWorker(deps, options);
  return { worker, deps, options, fakeClient, fakeStorage, fakeEnforcer, scheduler, logger };
}

describe("Worker test structural fakes", () => {
  it("FakeControlApiClient satisfies ControlApiClient contract including claim filtering and defer", async () => {
    const fakeClient: ControlApiClient = new FakeControlApiClient({
      claimResult: createSampleJob(),
      deferResult: { outcome: "deferred", job: {} as RenderJob }
    });

    const claimed = await fakeClient.claim("worker-test", ["candidate"]);
    expect(claimed).toEqual(createSampleJob());

    const jobId = "job-123" as JobId;
    const leaseToken = "lease-456" as LeaseToken;
    const reason = "Storage admission denied at write time";

    const result = await fakeClient.defer(jobId, leaseToken, reason);
    expect(result).toEqual({ outcome: "deferred", job: {} });

    const clientInstance = fakeClient as FakeControlApiClient;
    expect(clientInstance.claimCalls).toEqual([
      { workerId: "worker-test", allowedJobKinds: ["candidate"] }
    ]);
    expect(clientInstance.deferCalls).toEqual([
      { jobId: "job-123", leaseToken: "lease-456", reason }
    ]);
  });
});

describe("RenderWorker construction and option validation", () => {
  it("rejects missing or invalid dependencies", () => {
    const validDeps: WorkerDependencies = {
      controlApiClient: new FakeControlApiClient(),
      objectStorage: new FakeObjectStorage(),
      enforceStorageAdmission: new FakeStorageAdmissionEnforcer(),
      renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
      logger: new FakeLogger(),
      sleep: async () => {}
    };
    const validOptions: RenderWorkerOptions = {
      workerId: "test-worker",
      pollIntervalMs: 1000,
      heartbeatIntervalMs: 10000,
      leaseDurationMs: 30000
    };

    expect(() => new RenderWorker(null as unknown as WorkerDependencies, validOptions)).toThrow(
      "WorkerDependencies are required"
    );
    expect(
      () =>
        new RenderWorker(
          { ...validDeps, controlApiClient: null as unknown as ControlApiClient },
          validOptions
        )
    ).toThrow("controlApiClient is required");
    expect(
      () =>
        new RenderWorker(
          { ...validDeps, objectStorage: null as unknown as ObjectStoragePort },
          validOptions
        )
    ).toThrow("objectStorage is required");
    expect(
      () =>
        new RenderWorker(
          { ...validDeps, enforceStorageAdmission: null as unknown as StorageAdmissionEnforcer },
          validOptions
        )
    ).toThrow("enforceStorageAdmission is required");
    expect(
      () =>
        new RenderWorker(
          { ...validDeps, renderJobExecutor: null as unknown as RenderJobExecutor },
          validOptions
        )
    ).toThrow("renderJobExecutor must be a function");
    expect(
      () =>
        new RenderWorker({ ...validDeps, logger: null as unknown as WorkerLogger }, validOptions)
    ).toThrow("logger with info, warn, error methods is required");
    expect(
      () =>
        new RenderWorker(
          { ...validDeps, sleep: null as unknown as (ms: number) => Promise<void> },
          validOptions
        )
    ).toThrow("sleep must be a function");
  });

  it("rejects invalid options and timing constraints", () => {
    const validDeps: WorkerDependencies = {
      controlApiClient: new FakeControlApiClient(),
      objectStorage: new FakeObjectStorage(),
      enforceStorageAdmission: new FakeStorageAdmissionEnforcer(),
      renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
      logger: new FakeLogger(),
      sleep: async () => {}
    };

    expect(() => new RenderWorker(validDeps, null as unknown as RenderWorkerOptions)).toThrow(
      "RenderWorkerOptions are required"
    );

    expect(
      () =>
        new RenderWorker(validDeps, {
          workerId: "",
          pollIntervalMs: 1000,
          heartbeatIntervalMs: 10000,
          leaseDurationMs: 30000
        })
    ).toThrow("workerId must be a non-empty string");

    expect(
      () =>
        new RenderWorker(validDeps, {
          workerId: "w1",
          pollIntervalMs: 0,
          heartbeatIntervalMs: 10000,
          leaseDurationMs: 30000
        })
    ).toThrow("pollIntervalMs must be a positive safe integer");

    expect(
      () =>
        new RenderWorker(validDeps, {
          workerId: "w1",
          pollIntervalMs: 1000,
          heartbeatIntervalMs: -10,
          leaseDurationMs: 30000
        })
    ).toThrow("heartbeatIntervalMs must be a positive safe integer");

    expect(
      () =>
        new RenderWorker(validDeps, {
          workerId: "w1",
          pollIntervalMs: 1000,
          heartbeatIntervalMs: 10000,
          leaseDurationMs: 0
        })
    ).toThrow("leaseDurationMs must be a positive safe integer");

    expect(
      () =>
        new RenderWorker(validDeps, {
          workerId: "w1",
          pollIntervalMs: 1000,
          heartbeatIntervalMs: 30000,
          leaseDurationMs: 30000
        })
    ).toThrow("heartbeatIntervalMs must be less than leaseDurationMs");

    expect(
      () =>
        new RenderWorker(validDeps, {
          workerId: "w1",
          pollIntervalMs: 1000,
          heartbeatIntervalMs: 40000,
          leaseDurationMs: 30000
        })
    ).toThrow("heartbeatIntervalMs must be less than leaseDurationMs");
  });
});

describe("Behavioral Invariants: Attempt State Machine and Heartbeat Fencing", () => {
  it("abandons before render when start is superseded or missing", async () => {
    // 1. Missing lease token
    const { worker: worker1, fakeClient: client1 } = createTestWorker();
    const jobWithoutLease = createSampleJob({ leaseToken: null });
    await worker1.processJob(jobWithoutLease);

    expect(client1.startCalls).toHaveLength(0);
    expect(client1.heartbeatCalls).toHaveLength(0);
    expect(client1.completeCalls).toHaveLength(0);
    expect(client1.failCalls).toHaveLength(0);
    expect(client1.deferCalls).toHaveLength(0);

    // 2. Start outcome superseded
    const clientSuperseded = new FakeControlApiClient({
      startResult: { outcome: "superseded" }
    });
    const executorSpy2 = vi.fn();
    const { worker: worker2 } = createTestWorker({
      controlApiClient: clientSuperseded,
      renderJobExecutor: executorSpy2
    });

    await worker2.processJob(createSampleJob());

    expect(clientSuperseded.startCalls).toHaveLength(1);
    expect(executorSpy2).not.toHaveBeenCalled();
    expect(clientSuperseded.heartbeatCalls).toHaveLength(0);
    expect(clientSuperseded.completeCalls).toHaveLength(0);
    expect(clientSuperseded.failCalls).toHaveLength(0);
    expect(clientSuperseded.deferCalls).toHaveLength(0);

    // 3. Start outcome not_found
    const clientNotFound = new FakeControlApiClient({
      startResult: { outcome: "not_found" }
    });
    const executorSpy3 = vi.fn();
    const { worker: worker3 } = createTestWorker({
      controlApiClient: clientNotFound,
      renderJobExecutor: executorSpy3
    });

    await worker3.processJob(createSampleJob());

    expect(clientNotFound.startCalls).toHaveLength(1);
    expect(executorSpy3).not.toHaveBeenCalled();
    expect(clientNotFound.heartbeatCalls).toHaveLength(0);
    expect(clientNotFound.completeCalls).toHaveLength(0);
    expect(clientNotFound.failCalls).toHaveLength(0);
    expect(clientNotFound.deferCalls).toHaveLength(0);
  });

  it("heartbeats sequentially while the render remains active", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient();

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const sampleJob = createSampleJob();
    const jobPromise = worker.processJob(sampleJob);

    // Microtask flush to allow start and heartbeat loop initialization
    await flushPromises();
    expect(fakeClient.startCalls).toHaveLength(1);

    // Heartbeat loop should be sleeping for first interval (10000ms)
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([10000]);

    // Tick 1: trigger first heartbeat
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(1);
    expect(fakeClient.heartbeatCalls[0]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken
    });

    // Heartbeat 1 settled -> Heartbeat loop begins next sleep interval
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([10000, 10000]);

    // Tick 2: trigger second heartbeat
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(2);
    expect(fakeClient.heartbeatCalls[1]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken
    });

    // Sleep 3 is now pending
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([10000, 10000, 10000]);

    // Render settles successfully
    renderDeferred.resolve({
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "test.png",
        contentHashSha256: "a".repeat(64)
      }
    });

    await jobPromise;

    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.failCalls).toHaveLength(0);
    expect(fakeClient.heartbeatCalls).toHaveLength(2);
  });

  it("fences on heartbeat superseded and abandons successful output after lease cleanup", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient({
      heartbeatResult: { outcome: "superseded" }
    });
    const fakeStorage = new FakeObjectStorage();
    const logger = new FakeLogger();

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      sleep: scheduler.sleep,
      logger,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const sampleJob = createSampleJob();
    const jobPromise = worker.processJob(sampleJob);

    await flushPromises();
    expect(fakeClient.startCalls).toHaveLength(1);

    // Advance sleep to trigger heartbeat
    expect(scheduler.pendingCount).toBe(1);
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(1);
    expect(logger.warnLogs.length).toBeGreaterThan(0);
    expect(logger.warnLogs[0]).toContain("superseded");

    // Render completes successfully
    renderDeferred.resolve({
      mediaObjects: [{ bucket: "candidates", key: "output.png", body: new Uint8Array([1, 2, 3]) }],
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "output.png",
        contentHashSha256: "a".repeat(64)
      }
    });

    await jobPromise;

    // Fenced: no uploads, no complete, no fail, no defer
    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(0);
    expect(fakeClient.deferCalls).toHaveLength(0);
  });

  it("fences on heartbeat not found and does not report a local render failure", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient({
      heartbeatResult: { outcome: "not_found" }
    });
    const fakeStorage = new FakeObjectStorage();
    const logger = new FakeLogger();

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      sleep: scheduler.sleep,
      logger,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const sampleJob = createSampleJob();
    const jobPromise = worker.processJob(sampleJob);

    await flushPromises();
    expect(fakeClient.startCalls).toHaveLength(1);

    // Advance sleep to trigger heartbeat
    expect(scheduler.pendingCount).toBe(1);
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(1);
    expect(logger.warnLogs.length).toBeGreaterThan(0);
    expect(logger.warnLogs[0]).toContain("not_found");

    // Render fails with an error
    renderDeferred.reject(new Error("CUDA out of memory error"));

    await jobPromise;

    // Fenced: does NOT report local failure
    expect(fakeClient.failCalls).toHaveLength(0);
    expect(fakeClient.deferCalls).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeStorage.puts).toHaveLength(0);
  });

  it("waits for the in-flight heartbeat before uploading and completing", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const heartbeatDeferred = createDeferred<JobMutationResult>();
    const scheduler = new FakeScheduler();
    const callOrder: string[] = [];

    const fakeStorage = new FakeObjectStorage((input) => {
      callOrder.push(`putObject:${input.key}`);
    });

    const fakeClient = new FakeControlApiClient({
      onHeartbeat: () => {
        callOrder.push("heartbeat_started");
        return heartbeatDeferred.promise;
      },
      onComplete: () => {
        callOrder.push("complete_started");
        return { outcome: "applied", job: {} as RenderJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      sleep: scheduler.sleep,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const sampleJob = createSampleJob();
    const jobPromise = worker.processJob(sampleJob);

    await flushPromises();
    expect(scheduler.pendingCount).toBe(1);

    // Start in-flight heartbeat
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(1);
    expect(callOrder).toEqual(["heartbeat_started"]);

    // Render completes while heartbeat is still in-flight
    renderDeferred.resolve({
      mediaObjects: [{ bucket: "candidates", key: "preview.png", body: new Uint8Array([1, 2]) }],
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "preview.png",
        contentHashSha256: "b".repeat(64)
      }
    });

    await flushPromises();

    // Verify upload and complete have NOT happened while heartbeat is in flight
    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);

    // Resolve in-flight heartbeat
    heartbeatDeferred.resolve({ outcome: "applied", job: {} as RenderJob });

    await jobPromise;

    // Verify upload and complete happened after in-flight heartbeat resolved
    expect(callOrder).toEqual(["heartbeat_started", "putObject:preview.png", "complete_started"]);
    expect(fakeStorage.puts).toHaveLength(1);
    expect(fakeClient.completeCalls).toHaveLength(1);
  });

  it("retries heartbeat uncertainty without failing the durable job", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const scheduler = new FakeScheduler();
    const logger = new FakeLogger();

    let heartbeatAttempts = 0;
    const fakeClient = new FakeControlApiClient({
      onHeartbeat: () => {
        heartbeatAttempts++;
        if (heartbeatAttempts === 1) {
          throw new ControlApiClientError("502 Bad Gateway from upstream proxy", 502);
        }
        return { outcome: "applied", job: {} as RenderJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      logger,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const sampleJob = createSampleJob();
    const jobPromise = worker.processJob(sampleJob);

    await flushPromises();
    expect(scheduler.pendingCount).toBe(1);

    // Trigger Heartbeat 1 (throws uncertainty)
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(1);
    expect(logger.warnLogs.length).toBe(1);
    expect(logger.warnLogs[0]).toContain("heartbeat failed with uncertainty");
    expect(fakeClient.failCalls).toHaveLength(0);

    // Next heartbeat is scheduled
    expect(scheduler.pendingCount).toBe(1);

    // Trigger Heartbeat 2 (succeeds)
    await scheduler.advanceNext();

    expect(fakeClient.heartbeatCalls).toHaveLength(2);
    expect(fakeClient.failCalls).toHaveLength(0);

    // Render settles
    renderDeferred.resolve({
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "final.png",
        contentHashSha256: "c".repeat(64)
      }
    });

    await jobPromise;

    expect(fakeClient.failCalls).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(1);
  });

  it("handles a rejected heartbeat sleep without an unhandled rejection", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const logger = new FakeLogger();
    let sleepCalls = 0;

    const { worker } = createTestWorker({
      logger,
      renderJobExecutor: async () => renderDeferred.promise,
      sleep: async () => {
        sleepCalls++;
        throw new Error("heartbeat sleep aborted");
      }
    });

    const processPromise = worker.processJob(createSampleJob());
    await flushPromises();

    expect(sleepCalls).toBe(1);
    expect(logger.errorLogs).toContain("Heartbeat loop failed: heartbeat sleep aborted");

    renderDeferred.resolve({
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "output.png",
        contentHashSha256: "a".repeat(64)
      }
    });

    await expect(processPromise).resolves.toBe("completed");
  });
});

describe("RenderWorker strict payload branch requirements", () => {
  it("rejects candidate job missing candidatePayload before any write", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const candidateJob = createSampleJob({ jobKind: "candidate" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          mediaObjects: [{ bucket: "candidates", key: "img.png", body: new Uint8Array([1]) }]
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeEnforcer.calls).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      "Candidate jobs require candidatePayload"
    );
  });

  it("rejects candidate job containing manifestPayload before any write", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const candidateJob = createSampleJob({ jobKind: "candidate" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          candidatePayload: { variantOrdinal: 1 },
          manifestPayload: { duration: 5 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeEnforcer.calls).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      "Candidate jobs must not provide manifestPayload"
    );
  });

  it("rejects production job missing manifestPayload before any write", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const productionJob = createSampleJob({ jobKind: "production" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          mediaObjects: [{ bucket: "delivery", key: "vid.mp4", body: new Uint8Array([1]) }]
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(productionJob);

    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeEnforcer.calls).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      "Production jobs require manifestPayload"
    );
  });

  it("rejects production job containing candidatePayload before any write", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const productionJob = createSampleJob({ jobKind: "production" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          manifestPayload: { duration: 5 },
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(productionJob);

    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeEnforcer.calls).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      "Production jobs must not provide candidatePayload"
    );
  });
});

describe("RenderWorker claim delegation", () => {
  it("passes configured allowedJobKinds to claim", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "worker-kinds",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000,
        allowedJobKinds: ["candidate"]
      }
    );

    const processed = await worker.runOnce();
    expect(processed).toBe(false);
    expect(fakeClient.claimCalls).toEqual([
      { workerId: "worker-kinds", allowedJobKinds: ["candidate"] }
    ]);
  });

  it("passes undefined allowedJobKinds to claim when omitted", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({ candidatePayload: { variantOrdinal: 1 } }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "worker-default",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    const processed = await worker.runOnce();
    expect(processed).toBe(false);
    expect(fakeClient.claimCalls).toEqual([
      { workerId: "worker-default", allowedJobKinds: undefined }
    ]);
  });
});

describe("RenderWorker write-side admission gating and deferral", () => {
  it("candidate media admission immediately precedes each object write", async () => {
    const callLog: string[] = [];

    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage((input) => {
      callLog.push(`putObject:${input.key}`);
    });
    const fakeEnforcer = new FakeStorageAdmissionEnforcer((op) => {
      callLog.push(`admission:${op}`);
      return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
    });

    const candidateJob = createSampleJob({ jobKind: "candidate" });
    const mediaObjects: PutObjectInput[] = [
      { bucket: "candidates", key: "img1.png", body: new Uint8Array([1, 2]) },
      { bucket: "candidates", key: "img2.png", body: new Uint8Array([3, 4]) }
    ];

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          mediaObjects,
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(callLog).toEqual([
      "admission:candidate_upload",
      "putObject:img1.png",
      "admission:candidate_upload",
      "putObject:img2.png",
      "admission:candidate_upload"
    ]);
    expect(fakeStorage.puts).toHaveLength(2);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.completeCalls[0]?.payload?.candidatePayload).toEqual({ variantOrdinal: 1 });
  });

  it("delivery media admission immediately precedes each object write", async () => {
    const callLog: string[] = [];

    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage((input) => {
      callLog.push(`putObject:${input.key}`);
    });
    const fakeEnforcer = new FakeStorageAdmissionEnforcer((op) => {
      callLog.push(`admission:${op}`);
      return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
    });

    const productionJob = createSampleJob({ jobKind: "production" });
    const mediaObjects: PutObjectInput[] = [
      { bucket: "delivery", key: "video.mp4", body: new Uint8Array([10, 20]) },
      { bucket: "delivery", key: "poster.png", body: new Uint8Array([30, 40]) }
    ];

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          mediaObjects,
          manifestPayload: { duration: 5.0 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(productionJob);

    expect(callLog).toEqual([
      "admission:delivery_write",
      "putObject:video.mp4",
      "admission:delivery_write",
      "putObject:poster.png",
      "admission:delivery_write"
    ]);
    expect(fakeStorage.puts).toHaveLength(2);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.completeCalls[0]?.payload?.manifestPayload).toEqual({ duration: 5.0 });
  });

  it("candidate completion admission immediately precedes complete", async () => {
    const callLog: string[] = [];

    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        callLog.push("complete");
        return { outcome: "applied", job: {} as RenderJob };
      }
    });
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer((op) => {
      callLog.push(`admission:${op}`);
      return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
    });

    const candidateJob = createSampleJob({ jobKind: "candidate" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          candidatePayload: {
            variantOrdinal: 1,
            storageBucket: "candidates",
            storageObjectKey: "preview.png",
            contentHashSha256: "a".repeat(64)
          }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(callLog).toEqual(["admission:candidate_upload", "complete"]);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.completeCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.completeCalls[0]?.leaseToken).toBe(sampleLeaseToken);
    expect(fakeClient.completeCalls[0]?.payload).toEqual({
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "preview.png",
        contentHashSha256: "a".repeat(64)
      }
    });
  });

  it("production completion admission immediately precedes complete", async () => {
    const callLog: string[] = [];

    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        callLog.push("complete");
        return { outcome: "applied", job: {} as RenderJob };
      }
    });
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer((op) => {
      callLog.push(`admission:${op}`);
      return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
    });

    const productionJob = createSampleJob({ jobKind: "production" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          manifestPayload: { sceneId: sampleSceneId }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(productionJob);

    expect(callLog).toEqual(["admission:delivery_write", "complete"]);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.completeCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.completeCalls[0]?.leaseToken).toBe(sampleLeaseToken);
  });

  it("direct admission refusal defers without writing or failing", async () => {
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.86,
      totalBytes: 1_000_000_000,
      freeBytes: 140_000_000
    });

    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const candidateJob = createSampleJob({ jobKind: "candidate" });
    const mediaObjects: PutObjectInput[] = [
      { bucket: "candidates", key: "img.png", body: new Uint8Array([1]) }
    ];

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          mediaObjects,
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(0);
    expect(fakeClient.deferCalls).toEqual([
      {
        jobId: sampleJobId,
        leaseToken: sampleLeaseToken,
        reason: admissionError.message
      }
    ]);
  });

  it("api admission refusal defers without failing", async () => {
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "critical",
      usedRatio: 0.95,
      totalBytes: 1_000_000_000,
      freeBytes: 50_000_000
    });

    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        throw admissionError;
      }
    });
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const candidateJob = createSampleJob({ jobKind: "candidate" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.failCalls).toHaveLength(0);
    expect(fakeClient.deferCalls).toEqual([
      {
        jobId: sampleJobId,
        leaseToken: sampleLeaseToken,
        reason: admissionError.message
      }
    ]);
  });

  it("already-applied defer resumes polling", async () => {
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.88,
      totalBytes: 1_000_000_000,
      freeBytes: 120_000_000
    });

    const fakeClient = new FakeControlApiClient({
      deferResult: { outcome: "already_applied", job: {} as RenderJob }
    });
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const candidateJob = createSampleJob({ jobKind: "candidate" });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await expect(worker.processJob(candidateJob)).resolves.not.toThrow();

    expect(fakeClient.deferCalls).toHaveLength(1);
    expect(fakeClient.failCalls).toHaveLength(0);
  });

  it("superseded or missing defer abandons local output", async () => {
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.88,
      totalBytes: 1_000_000_000,
      freeBytes: 120_000_000
    });

    // 1. Superseded outcome
    const fakeClientSuperseded = new FakeControlApiClient({
      deferResult: { outcome: "superseded" }
    });
    const fakeStorage1 = new FakeObjectStorage();
    const fakeEnforcer1 = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const worker1 = new RenderWorker(
      {
        controlApiClient: fakeClientSuperseded,
        objectStorage: fakeStorage1,
        enforceStorageAdmission: fakeEnforcer1,
        renderJobExecutor: async () => ({
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await expect(worker1.processJob(createSampleJob())).resolves.not.toThrow();
    expect(fakeClientSuperseded.deferCalls).toHaveLength(1);
    expect(fakeClientSuperseded.failCalls).toHaveLength(0);

    // 2. Not found outcome
    const fakeClientNotFound = new FakeControlApiClient({
      deferResult: { outcome: "not_found" }
    });
    const fakeStorage2 = new FakeObjectStorage();
    const fakeEnforcer2 = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const worker2 = new RenderWorker(
      {
        controlApiClient: fakeClientNotFound,
        objectStorage: fakeStorage2,
        enforceStorageAdmission: fakeEnforcer2,
        renderJobExecutor: async () => ({
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await expect(worker2.processJob(createSampleJob())).resolves.not.toThrow();
    expect(fakeClientNotFound.deferCalls).toHaveLength(1);
    expect(fakeClientNotFound.failCalls).toHaveLength(0);
  });

  it("defer transport failure uses transient request policy", async () => {
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.88,
      totalBytes: 1_000_000_000,
      freeBytes: 120_000_000
    });

    const networkError = new ControlApiClientError("Connection refused to Control API", 500);

    const candidateJob = createSampleJob({ jobKind: "candidate" });
    let deferAttempts = 0;

    const fakeClient = new FakeControlApiClient({
      onDefer: () => {
        deferAttempts++;
        if (deferAttempts === 1) {
          throw networkError;
        }
        return { outcome: "deferred", job: candidateJob };
      }
    });
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await expect(worker.processJob(candidateJob)).resolves.not.toThrow();

    expect(fakeClient.deferCalls).toHaveLength(2);
    expect(fakeClient.failCalls).toHaveLength(0);
  });

  it("later refusal does not claim rollback of an earlier object", async () => {
    let callCount = 0;
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.86,
      totalBytes: 1_000_000_000,
      freeBytes: 140_000_000
    });

    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer(() => {
      callCount++;
      if (callCount === 1) {
        return createStorageAdmissionPolicy(500_000_000, 1_000_000_000);
      }
      throw admissionError;
    });

    const candidateJob = createSampleJob({ jobKind: "candidate" });
    const mediaObjects: PutObjectInput[] = [
      { bucket: "candidates", key: "object-1.png", body: new Uint8Array([1, 2]) },
      { bucket: "candidates", key: "object-2.png", body: new Uint8Array([3, 4]) }
    ];

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => ({
          mediaObjects,
          candidatePayload: { variantOrdinal: 1 }
        }),
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    // First object was written
    expect(fakeStorage.puts).toHaveLength(1);
    expect(fakeStorage.puts[0]?.key).toBe("object-1.png");
    expect(fakeStorage.stored.get("candidates/object-1.png")).toBeDefined();

    // Second write and complete were NOT performed
    expect(fakeStorage.stored.get("candidates/object-2.png")).toBeUndefined();
    expect(fakeClient.completeCalls).toHaveLength(0);

    // Defer was invoked, fail was not
    expect(fakeClient.deferCalls).toEqual([
      {
        jobId: sampleJobId,
        leaseToken: sampleLeaseToken,
        reason: admissionError.message
      }
    ]);
    expect(fakeClient.failCalls).toHaveLength(0);
  });

  it("non-admission render failures still use fail", async () => {
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const candidateJob = createSampleJob({ jobKind: "candidate" });
    const renderError = new Error("CUDA device out of memory");

    const worker = new RenderWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => {
          throw renderError;
        },
        logger: new FakeLogger(),
        sleep: async () => {}
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    await worker.processJob(candidateJob);

    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.failCalls[0]?.leaseToken).toBe(sampleLeaseToken);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain("CUDA device out of memory");

    expect(fakeClient.deferCalls).toHaveLength(0);
    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
  });

  it("fails the job with a typed missing-profile error when no certified profile exists", async () => {
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const candidateJob = createSampleJob({
      jobKind: "candidate",
      workflowTemplate: "flux-schnell-draft"
    });
    const upstreamProfileError = new Error(
      'Profile "flux-schnell-draft" not found in manifest "/tmp/provenance.json". Available profiles: "ltx-2.5-delivery".'
    );
    const missingProfileError = new MissingCertifiedProfileError(candidateJob.workflowTemplate, {
      cause: upstreamProfileError
    });

    const { worker } = createTestWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => {
          throw missingProfileError;
        },
        sleep: scheduler.sleep
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    // 1. Drive the start() loop: claim returns the job, then no more work
    let claimCalls = 0;
    (fakeClient as unknown as { claim: () => Promise<RenderJob | undefined> }).claim = async () => {
      claimCalls += 1;
      if (claimCalls === 1) {
        return candidateJob;
      }
      return undefined;
    };

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);
    await flushPromises();

    // Step 1: claim returned the job → processJob invoked → renderJobExecutor threw
    // MissingCertifiedProfileError → worker routes to /fail
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.failCalls[0]?.leaseToken).toBe(sampleLeaseToken);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      `no certified profile for workflow_template "${candidateJob.workflowTemplate}"`
    );

    // /fail should NOT be classified as an admission refusal — it must use /fail, not /defer
    expect(fakeClient.deferCalls).toHaveLength(0);
    // No candidate bytes or manifest written when the profile never loaded
    expect(fakeStorage.puts).toHaveLength(0);
    // No completion attempted
    expect(fakeClient.completeCalls).toHaveLength(0);

    // Step 2: After /fail resolves, the loop should re-poll. We assert re-poll by
    // advancing the scheduler through pollIntervalMs and seeing another claim attempt.
    await scheduler.advanceNext();
    await flushPromises();
    expect(claimCalls).toBeGreaterThanOrEqual(2);

    // Clean shutdown
    abortController.abort();
    await scheduler.advanceNext();
    await startPromise;
  });

  it("fails the job with /fail and consumes retry when IncompleteManifestError is thrown by the executor", async () => {
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const productionJob = createSampleJob({
      jobKind: "production",
      workflowTemplate: "ltx-25-720p-97f"
    });

    const incompleteManifestError = new IncompleteManifestError("campaignId");

    const { worker } = createTestWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor: async () => {
          throw incompleteManifestError;
        },
        sleep: scheduler.sleep
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    let claimCalls = 0;
    (fakeClient as unknown as { claim: () => Promise<RenderJob | undefined> }).claim = async () => {
      claimCalls += 1;
      if (claimCalls === 1) {
        return productionJob;
      }
      return undefined;
    };

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);
    await flushPromises();

    // Executor threw IncompleteManifestError -> worker calls /fail
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.failCalls[0]?.leaseToken).toBe(sampleLeaseToken);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      'Cannot assemble manifest: required field "campaignId" is unavailable'
    );

    // /fail used, not /defer
    expect(fakeClient.deferCalls).toHaveLength(0);
    // No storage puts
    expect(fakeStorage.puts).toHaveLength(0);
    // No complete call
    expect(fakeClient.completeCalls).toHaveLength(0);

    // Re-polls after failure
    await scheduler.advanceNext();
    await flushPromises();
    expect(claimCalls).toBeGreaterThanOrEqual(2);

    // Clean shutdown
    abortController.abort();
    await scheduler.advanceNext();
    await startPromise;
  });

  it("flows approvedCandidateId on a production job through validateInjectedPayload, productionManifestAssembler, AssembleGenerationManifest, and StoryboardCandidateRepository into complete manifestPayload", async () => {
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient();
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer();

    const fakeSceneId = "scene-uuid-approved-123" as SceneId;
    const fakeCandidateId = "cand-uuid-approved-999" as CandidateId;

    const fakeCandidate: StoryboardCandidate = {
      id: fakeCandidateId,
      sceneId: fakeSceneId,
      specRevision: 1,
      variantOrdinal: 1,
      storageBucket: "godzspeed-review",
      storageObjectKey: "candidates/cand-999.webp",
      contentHash: "candidate-content-hash-hex-999",
      generationMetadata: {},
      createdAt: "2026-08-29T09:30:00.000Z"
    };

    const fakeScene = Scene.reconstitute({
      id: fakeSceneId,
      campaignId: "campaign-1" as CampaignId,
      status: "rendering",
      specRevision: 1,
      configuration: {
        prompt: "A beautiful cinematic sunrise",
        referenceIds: [],
        engineProfileId: "ltx_25",
        durationMs: 5000
      },
      selectedCandidateId: fakeCandidateId,
      selectedCandidateRevision: 1,
      approval: {
        revision: 1,
        approvedBy: "director-1",
        approvedAt: "2026-08-29T09:35:00.000Z"
      }
    });

    const candidateRepository = {
      findById: async (id: CandidateId) => (id === fakeCandidateId ? fakeCandidate : undefined),
      insert: async () => {},
      listBySceneAndRevision: async () => [fakeCandidate]
    };

    const sceneRepository = {
      findById: async (id: SceneId) => (id === fakeSceneId ? fakeScene : undefined),
      save: async () => {}
    };

    const referenceAssetRepository = {
      listBySceneId: async () => []
    };

    const hashBytes: HashBytesPort = {
      hashBytes: async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
    };

    const manifestAssembler = new AssembleGenerationManifest({
      hashBytes,
      sceneRepository,
      storyboardCandidateRepository: candidateRepository,
      referenceAssetRepository
    });

    const productionJob = createSampleJob({
      sceneId: fakeSceneId,
      jobKind: "production",
      workflowTemplate: "ltx-25-720p-97f",
      injectedPayload: {
        prompt: "A beautiful cinematic sunrise",
        approvedCandidateId: fakeCandidateId
      }
    });

    const sampleHash = "sample-ltx-workflow-hash";
    const fakeProfile = {
      id: "ltx-25-720p-97f",
      engine: "ltx_25",
      expectedWorkflowHash: sampleHash,
      workflowPath: "/templates/ltx_25_720p_97f_api.json",
      workflowRelativePath: "ltx_25_720p_97f_api.json",
      runnerProfile: "dynamicvram-offload-v1",
      minFreeDiskGb: 0,
      source: {
        kind: "validated_host_export",
        license: "GPL-3.0",
        uri: "https://github.com/comfyanonymous/ComfyUI",
        revision: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc"
      },
      baseline: {
        frames: 97,
        frameCount: 97,
        width: 1280,
        height: 720,
        fps: 24,
        approximateDurationSeconds: 4,
        steps: 8,
        peakVramMb: 20000,
        renderDurationMs: 5000
      },
      renderProfileIdentity: {
        key: "LTX_25_720P_97F_V1",
        version: 1
      },
      models: [{ category: "diffusion_models", relativePath: "ltx-video-2b-v0.9.1.safetensors" }]
    };

    const fakeProvenance = {
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceKind: "live_inspected",
      environment: {
        platform: "linux",
        nodeVersion: "v20.0.0",
        gpuCount: 1,
        gpuName: "NVIDIA RTX 4090"
      },
      workflow: {
        sha256: sampleHash,
        fileSizeBytes: 1024
      },
      renderProfileProvenance: {
        profileId: "ltx-25-720p-97f",
        renderProfileIdentity: {
          key: "LTX_25_720P_97F_V1",
          version: 1
        }
      },
      git: {
        comfyUiCommit: "55b6a9b11dffecdd65a3ccd5eb6a1b3a178c96dc",
        customNodes: []
      },
      models: [
        {
          category: "diffusion_models",
          relativePath: "ltx-video-2b-v0.9.1.safetensors",
          sha256: "model-sha256-hex",
          fileSizeBytes: 1024
        }
      ]
    };

    const fakeRawWorkflow = JSON.stringify({
      "1": {
        class_type: "KSampler",
        inputs: {
          seed: 42,
          steps: 8,
          cfg: 1,
          sampler_name: "euler",
          scheduler: "simple",
          denoise: 1
        }
      },
      "3": {
        class_type: "CLIPTextEncode",
        inputs: { text: "placeholder prompt" }
      },
      "4": {
        class_type: "CLIPTextEncode",
        inputs: { text: "placeholder negative" }
      }
    });

    const fakeOutputReader = {
      readOutput: async () => ({
        filename: "output.mp4",
        subfolder: "",
        type: "output",
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "video/mp4"
      })
    };

    const renderJobExecutor = createCertifiedRenderJobExecutor({
      loadCertificationProfile: async () => fakeProfile as unknown as CertificationProfile,
      readApprovedProvenance: async () =>
        fakeProvenance as unknown as CertificationProvenanceReport,
      collectCertificationProvenance: async () =>
        fakeProvenance as unknown as CertificationProvenanceReport,
      verifyGoldMasterProvenance: () => {},
      readWorkflowFile: async () => fakeRawWorkflow,
      hashWorkflow: () => sampleHash,
      executeProfileRender: vi.fn().mockResolvedValue({
        status: "succeeded",
        promptId: "prompt-12345",
        outputObjectKeys: ["renders/output.mp4"],
        durationMs: 4250,
        profile: fakeProfile,
        preDispatchGpu: {
          totalVramMb: 24576,
          usedVramMb: 4096,
          freeVramMb: 20480,
          reservedVramMb: 4096,
          measuredAt: new Date().toISOString()
        }
      }),
      outputReader: fakeOutputReader as unknown as ComfyUiOutputReader,
      hashBytes,
      productionManifestAssembler: async (input) => {
        const res = await manifestAssembler.assemble(input);
        return res.manifestPayload;
      }
    });

    const { worker } = createTestWorker(
      {
        controlApiClient: fakeClient,
        objectStorage: fakeStorage,
        enforceStorageAdmission: fakeEnforcer,
        renderJobExecutor,
        sleep: scheduler.sleep
      },
      {
        workerId: "test-worker",
        pollIntervalMs: 1000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    let claimCalls = 0;
    (fakeClient as unknown as { claim: () => Promise<RenderJob | undefined> }).claim = async () => {
      claimCalls += 1;
      if (claimCalls === 1) {
        return productionJob;
      }
      return undefined;
    };

    const processed = await worker.runOnce();
    expect(processed).toBe(true);

    expect(fakeClient.completeCalls).toHaveLength(1);
    const completePayload = fakeClient.completeCalls[0]?.payload?.manifestPayload as
      | {
          approvedCandidate?: {
            id?: string;
            contentHash?: string;
            specRevision?: number;
            variantOrdinal?: number;
          };
        }
      | undefined;
    expect(completePayload).toBeDefined();
    expect(completePayload?.approvedCandidate).toEqual({
      id: fakeCandidateId,
      contentHash: "candidate-content-hash-hex-999",
      specRevision: 1,
      variantOrdinal: 1
    });
  });
});

describe("Behavioral Invariants: Mutation Retry, Polling Backoff, and Graceful Shutdown", () => {
  it("backs off idle telemetry and generic claim outcomes without spinning", async () => {
    const scheduler = new FakeScheduler();
    const logger = new FakeLogger();
    let claimStep = 0;

    const fakeClient = new FakeControlApiClient({
      onClaim: () => {
        claimStep++;
        if (claimStep === 1) {
          // 1. 204 No Content
          return undefined;
        }
        if (claimStep === 2) {
          // 2. 503 Telemetry Unavailable
          throw new ControlApiClientError("Telemetry service down", 503);
        }
        if (claimStep === 3) {
          // 3. Generic 500 / network failure
          throw new ControlApiClientError("Internal Server Error", 500);
        }
        return undefined;
      }
    });

    const { worker } = createTestWorker(
      {
        controlApiClient: fakeClient,
        sleep: scheduler.sleep,
        logger
      },
      {
        pollIntervalMs: 1000,
        telemetryBackoffMs: 8000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);

    await flushPromises();

    // Step 1: Claim 1 returned undefined (204) -> sleep(pollIntervalMs = 1000)
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([1000]);

    // Advance tick 1
    await scheduler.advanceNext();
    await flushPromises();

    // Step 2: Claim 2 threw 503 -> logged warning -> sleep(telemetryBackoffMs = 8000)
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([1000, 8000]);
    expect(
      logger.warnLogs.some((log) => log.includes("503") || log.toLowerCase().includes("telemetry"))
    ).toBe(true);

    // Advance tick 2
    await scheduler.advanceNext();
    await flushPromises();

    // Step 3: Claim 3 threw 500 -> logged warning -> sleep(pollIntervalMs = 1000)
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([1000, 8000, 1000]);

    // Stop worker
    abortController.abort();
    await scheduler.advanceNext();
    await startPromise;
  });

  it("retries start uncertainty with the same lease before render", async () => {
    const scheduler = new FakeScheduler();
    const logger = new FakeLogger();
    const sampleJob = createSampleJob();
    let startAttempts = 0;
    const renderExecutorSpy = vi.fn().mockResolvedValue({
      candidatePayload: { variantOrdinal: 1 }
    });

    const fakeClient = new FakeControlApiClient({
      onStart: () => {
        startAttempts++;
        if (startAttempts === 1) {
          throw new ControlApiClientError("504 Gateway Timeout on start", 504);
        }
        return { outcome: "applied", job: sampleJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      logger,
      renderJobExecutor: renderExecutorSpy
    });

    const processPromise = worker.processJob(sampleJob);
    await flushPromises();

    // Start 1 threw 504 -> retries with sleep(pollIntervalMs)
    expect(fakeClient.startCalls).toHaveLength(1);
    expect(renderExecutorSpy).not.toHaveBeenCalled();
    expect(scheduler.pendingCount).toBe(1);

    // Advance retry sleep
    await scheduler.advanceNext();
    await flushPromises();

    // Start 2 succeeded -> render executor called
    expect(fakeClient.startCalls).toHaveLength(2);
    expect(fakeClient.startCalls[0]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken
    });
    expect(fakeClient.startCalls[1]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken
    });
    expect(renderExecutorSpy).toHaveBeenCalledTimes(1);

    // Advance heartbeat sleep if pending to let processJob settle
    while (scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
    }

    await processPromise;
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.failCalls).toHaveLength(0);
  });

  it("retries uncertain completion with the identical payload and never fails it", async () => {
    const scheduler = new FakeScheduler();
    const logger = new FakeLogger();
    const sampleJob = createSampleJob();
    let completeAttempts = 0;

    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        completeAttempts++;
        if (completeAttempts < 3) {
          throw new ControlApiClientError("502 Bad Gateway during completion", 502);
        }
        return { outcome: "already_applied", job: sampleJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      logger,
      renderJobExecutor: async () => ({
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "candidates",
          storageObjectKey: "test.png",
          contentHashSha256: "a".repeat(64)
        }
      })
    });

    const processPromise = worker.processJob(sampleJob);
    await flushPromises();

    // Complete attempt 1 threw 502 -> pending sleeps (heartbeat 10000ms + complete retry 1000ms)
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.failCalls).toHaveLength(0);
    expect(scheduler.pendingCount).toBeGreaterThanOrEqual(1);

    // Advance to trigger retry 1
    while (fakeClient.completeCalls.length === 1 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }

    // Complete attempt 2 threw 502
    expect(fakeClient.completeCalls).toHaveLength(2);
    expect(fakeClient.failCalls).toHaveLength(0);

    // Advance to trigger retry 2
    while (fakeClient.completeCalls.length === 2 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }

    // Complete attempt 3 succeeded
    expect(fakeClient.completeCalls).toHaveLength(3);
    expect(fakeClient.failCalls).toHaveLength(0);

    // All complete calls had identical token and payload
    const expectedPayload = {
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "test.png",
        contentHashSha256: "a".repeat(64)
      }
    };
    expect(fakeClient.completeCalls[0]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken,
      payload: expectedPayload
    });
    expect(fakeClient.completeCalls[1]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken,
      payload: expectedPayload
    });
    expect(fakeClient.completeCalls[2]).toEqual({
      jobId: sampleJob.jobId,
      leaseToken: sampleJob.leaseToken,
      payload: expectedPayload
    });

    await processPromise;
  });

  it("fails a deterministic completion validation error", async () => {
    const sampleJob = createSampleJob();
    const validationError = new ControlApiClientError(
      "Control API returned HTTP 400: invalid candidatePayload",
      400,
      { responseDetail: "candidatePayload.variantOrdinal must be >= 0" }
    );

    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        throw validationError;
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      renderJobExecutor: async () => ({
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "candidates",
          storageObjectKey: "test.png",
          contentHashSha256: "a".repeat(64)
        }
      })
    });

    await worker.processJob(sampleJob);

    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.deferCalls).toHaveLength(0);
    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.jobId).toBe(sampleJob.jobId);
    expect(fakeClient.failCalls[0]?.leaseToken).toBe(sampleJob.leaseToken);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain(
      "candidatePayload.variantOrdinal must be >= 0"
    );
  });

  it("defers typed admission refusal and applies admission backoff", async () => {
    const scheduler = new FakeScheduler();
    const sampleJob = createSampleJob();
    let claimCount = 0;

    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "critical",
      usedRatio: 0.95,
      totalBytes: 1_000_000_000,
      freeBytes: 50_000_000
    });

    const fakeClient = new FakeControlApiClient({
      onClaim: () => {
        claimCount++;
        if (claimCount === 1) {
          return sampleJob;
        }
        return undefined;
      }
    });

    const fakeEnforcer = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const { worker } = createTestWorker(
      {
        controlApiClient: fakeClient,
        enforceStorageAdmission: fakeEnforcer,
        sleep: scheduler.sleep
      },
      {
        pollIntervalMs: 1000,
        admissionBackoffMs: 12000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);

    await flushPromises();

    // Job was claimed, admission refused -> defer was called
    expect(fakeClient.claimCalls).toHaveLength(1);
    expect(fakeClient.deferCalls).toHaveLength(1);
    expect(fakeClient.deferCalls[0]?.jobId).toBe(sampleJob.jobId);
    expect(fakeClient.deferCalls[0]?.leaseToken).toBe(sampleJob.leaseToken);
    expect(fakeClient.deferCalls[0]?.reason).toBe(admissionError.message);
    expect(fakeClient.failCalls).toHaveLength(0);

    // Defer completed -> worker should sleep admissionBackoffMs (12000ms) before next claim
    expect(scheduler.sleepCalls).toContain(12000);

    // Advance pending sleeps (heartbeat sleep and admission backoff sleep)
    while (fakeClient.claimCalls.length === 1 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }

    // Next claim was performed after admissionBackoffMs
    expect(fakeClient.claimCalls).toHaveLength(2);

    // Stop worker
    abortController.abort();
    await scheduler.advanceNext();
    await startPromise;
  });

  it("retries uncertain fail and defer mutations until a conclusive outcome", async () => {
    // Part A: Fail mutation uncertainty retry
    const schedulerA = new FakeScheduler();
    const loggerA = new FakeLogger();
    const sampleJobA = createSampleJob();
    let failAttempts = 0;
    const fakeClientA = new FakeControlApiClient({
      onFail: () => {
        failAttempts++;
        if (failAttempts === 1) {
          throw new ControlApiClientError("503 Service Unavailable on fail", 503);
        }
        return { outcome: "applied", job: sampleJobA };
      }
    });

    const { worker: workerA } = createTestWorker({
      controlApiClient: fakeClientA,
      sleep: schedulerA.sleep,
      logger: loggerA,
      renderJobExecutor: async () => {
        throw new Error("Render pipeline crashed");
      }
    });

    const processA = workerA.processJob(sampleJobA);
    await flushPromises();

    expect(fakeClientA.failCalls).toHaveLength(1);

    while (fakeClientA.failCalls.length === 1 && schedulerA.pendingCount > 0) {
      await schedulerA.advanceNext();
      await flushPromises();
    }

    expect(fakeClientA.failCalls).toHaveLength(2);
    expect(fakeClientA.failCalls[0]).toEqual(fakeClientA.failCalls[1]);
    await processA;

    // Part B: Defer mutation uncertainty retry
    const schedulerB = new FakeScheduler();
    const loggerB = new FakeLogger();
    const sampleJobB = createSampleJob();
    let deferAttempts = 0;
    const fakeClientB = new FakeControlApiClient({
      onDefer: () => {
        deferAttempts++;
        if (deferAttempts === 1) {
          throw new ControlApiClientError("500 Internal Server Error on defer", 500);
        }
        return { outcome: "deferred", job: sampleJobB };
      }
    });

    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.86,
      totalBytes: 1_000_000_000,
      freeBytes: 140_000_000
    });

    const { worker: workerB } = createTestWorker({
      controlApiClient: fakeClientB,
      enforceStorageAdmission: new FakeStorageAdmissionEnforcer(() => {
        throw admissionError;
      }),
      sleep: schedulerB.sleep,
      logger: loggerB
    });

    const processB = workerB.processJob(sampleJobB);
    await flushPromises();

    expect(fakeClientB.deferCalls).toHaveLength(1);

    while (fakeClientB.deferCalls.length === 1 && schedulerB.pendingCount > 0) {
      await schedulerB.advanceNext();
      await flushPromises();
    }

    expect(fakeClientB.deferCalls).toHaveLength(2);
    expect(fakeClientB.deferCalls[0]).toEqual(fakeClientB.deferCalls[1]);
    await processB;
  });

  it("shutdown wakes idle backoff and prevents another claim", async () => {
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient({
      claimResult: undefined // 204
    });

    const { worker } = createTestWorker(
      {
        controlApiClient: fakeClient,
        sleep: scheduler.sleep
      },
      {
        pollIntervalMs: 5000,
        heartbeatIntervalMs: 10000,
        leaseDurationMs: 30000
      }
    );

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);

    await flushPromises();

    // Claim was issued once and returned undefined -> worker is sleeping 5000ms
    expect(fakeClient.claimCalls).toHaveLength(1);
    expect(scheduler.pendingCount).toBe(1);
    expect(scheduler.sleepCalls).toEqual([5000]);

    // Signal abort while sleeping in idle backoff
    abortController.abort();
    await flushPromises();

    // The start promise should resolve immediately without advancing fake scheduler or calling claim again
    await startPromise;

    expect(fakeClient.claimCalls).toHaveLength(1);
  });

  it("shutdown drains the active attempt and its final mutation", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const scheduler = new FakeScheduler();
    const fakeStorage = new FakeObjectStorage();
    const sampleJob = createSampleJob();
    let claimCount = 0;

    const fakeClient = new FakeControlApiClient({
      onClaim: () => {
        claimCount++;
        if (claimCount === 1) {
          return sampleJob;
        }
        return undefined;
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      sleep: scheduler.sleep,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);

    await flushPromises();

    expect(fakeClient.claimCalls).toHaveLength(1);
    expect(fakeClient.startCalls).toHaveLength(1);

    // Trigger heartbeat while render is in flight
    expect(scheduler.pendingCount).toBe(1);
    await scheduler.advanceNext();
    expect(fakeClient.heartbeatCalls).toHaveLength(1);

    // Request shutdown (SIGINT/SIGTERM) while render attempt is active
    abortController.abort();

    // Active attempt must NOT be abandoned: resolve render output with media object
    renderDeferred.resolve({
      mediaObjects: [{ bucket: "candidates", key: "final.png", body: new Uint8Array([1, 2, 3]) }],
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "final.png",
        contentHashSha256: "d".repeat(64)
      }
    });

    await startPromise;

    // Verify storage write and completion happened cleanly
    expect(fakeStorage.puts).toHaveLength(1);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.completeCalls[0]?.jobId).toBe(sampleJob.jobId);
    expect(fakeClient.failCalls).toHaveLength(0);

    // Verify no subsequent claim was made
    expect(fakeClient.claimCalls).toHaveLength(1);
  });

  it("aborts start mutation immediately on non-transient HTTP errors (400, 401, 403)", async () => {
    const fakeClient = new FakeControlApiClient({
      onStart: () => {
        throw new ControlApiClientError("Unauthorized", 401);
      }
    });
    const scheduler = new FakeScheduler();
    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep
    });

    const sampleJob = createSampleJob();
    await expect(worker.processJob(sampleJob)).rejects.toThrow("Unauthorized");
    expect(fakeClient.startCalls).toHaveLength(1);
    expect(scheduler.sleepCalls).toHaveLength(0);
  });

  it("aborts complete mutation immediately on non-transient HTTP errors (401, 403)", async () => {
    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        throw new ControlApiClientError("Forbidden", 403);
      }
    });
    const scheduler = new FakeScheduler();
    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep
    });

    const sampleJob = createSampleJob();
    await worker.processJob(sampleJob);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.failCalls).toHaveLength(1);
  });

  it("aborts fail and defer mutations immediately on non-transient HTTP errors (400, 401, 403)", async () => {
    // 1. Fail non-transient error
    const fakeClientFail = new FakeControlApiClient({
      onFail: () => {
        throw new ControlApiClientError("Bad Request", 400);
      }
    });
    const scheduler1 = new FakeScheduler();
    const { worker: worker1 } = createTestWorker({
      controlApiClient: fakeClientFail,
      sleep: scheduler1.sleep,
      renderJobExecutor: async () => {
        throw new Error("Render error");
      }
    });

    await expect(worker1.processJob(createSampleJob())).rejects.toThrow("Bad Request");
    expect(fakeClientFail.failCalls).toHaveLength(1);
    expect(scheduler1.sleepCalls.filter((ms) => ms === 1000)).toHaveLength(0);

    // 2. Defer non-transient error
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.86,
      totalBytes: 1_000_000_000,
      freeBytes: 140_000_000
    });
    const fakeClientDefer = new FakeControlApiClient({
      onDefer: () => {
        throw new ControlApiClientError("Unauthorized", 401);
      }
    });
    const scheduler2 = new FakeScheduler();
    const { worker: worker2 } = createTestWorker({
      controlApiClient: fakeClientDefer,
      enforceStorageAdmission: new FakeStorageAdmissionEnforcer(() => {
        throw admissionError;
      }),
      sleep: scheduler2.sleep
    });

    await expect(worker2.processJob(createSampleJob())).rejects.toThrow("Unauthorized");
    expect(fakeClientDefer.deferCalls).toHaveLength(1);
    expect(scheduler2.sleepCalls.filter((ms) => ms === 1000)).toHaveLength(0);
  });

  it("retries fail and defer on 200 JSON parse errors without swallowing the failure", async () => {
    // 1. Fail retry on 200 JSON parse error
    let failAttempts = 0;
    const fakeClientFail = new FakeControlApiClient({
      onFail: () => {
        failAttempts++;
        if (failAttempts === 1) {
          throw new ControlApiClientError("Failed to parse response JSON from Control API", 200);
        }
        return { outcome: "applied", job: {} as RenderJob };
      }
    });
    const scheduler1 = new FakeScheduler();
    const { worker: worker1 } = createTestWorker({
      controlApiClient: fakeClientFail,
      sleep: scheduler1.sleep,
      renderJobExecutor: async () => {
        throw new Error("Render error");
      }
    });

    const jobPromise1 = worker1.processJob(createSampleJob());
    await flushPromises();

    expect(fakeClientFail.failCalls).toHaveLength(1);
    expect(scheduler1.pendingCount).toBe(1);

    await scheduler1.advanceNext();
    await flushPromises();

    expect(fakeClientFail.failCalls).toHaveLength(2);
    await jobPromise1;

    // 2. Defer retry on 200 JSON parse error
    let deferAttempts = 0;
    const fakeClientDefer = new FakeControlApiClient({
      onDefer: () => {
        deferAttempts++;
        if (deferAttempts === 1) {
          throw new ControlApiClientError("Failed to parse response JSON from Control API", 200);
        }
        return { outcome: "deferred", job: {} as RenderJob };
      }
    });
    const scheduler2 = new FakeScheduler();
    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.86,
      totalBytes: 1_000_000_000,
      freeBytes: 140_000_000
    });
    const { worker: worker2 } = createTestWorker({
      controlApiClient: fakeClientDefer,
      enforceStorageAdmission: new FakeStorageAdmissionEnforcer(() => {
        throw admissionError;
      }),
      sleep: scheduler2.sleep
    });

    const jobPromise2 = worker2.processJob(createSampleJob());
    await flushPromises();

    expect(fakeClientDefer.deferCalls).toHaveLength(1);
    expect(scheduler2.pendingCount).toBe(1);

    await scheduler2.advanceNext();
    await flushPromises();

    expect(fakeClientDefer.deferCalls).toHaveLength(2);
    await jobPromise2;
  });

  it("aborts mutation retries promptly during graceful shutdown if API is unreachable", async () => {
    const fakeClient = new FakeControlApiClient({
      onStart: () => {
        throw new ControlApiClientError("Connection refused", 500);
      }
    });
    const scheduler = new FakeScheduler();
    const sampleJob = createSampleJob();

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep
    });

    const abortController = new AbortController();
    const processPromise = worker.processJob(sampleJob, abortController.signal);
    await flushPromises();

    expect(fakeClient.startCalls).toHaveLength(1);
    expect(scheduler.pendingCount).toBe(1);

    // Request shutdown while waiting to retry start
    abortController.abort();
    await flushPromises();

    // The promise should reject/settle promptly due to shutdown abortion
    await expect(processPromise).rejects.toThrow("worker shutdown");
  });

  it("heartbeat loop continues during graceful shutdown while render remains active", async () => {
    const renderDeferred = createDeferred<WorkerRenderOutput>();
    const scheduler = new FakeScheduler();
    const fakeClient = new FakeControlApiClient();
    const sampleJob = createSampleJob();

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      renderJobExecutor: async () => renderDeferred.promise
    });

    const abortController = new AbortController();
    const processPromise = worker.processJob(sampleJob, abortController.signal);
    await flushPromises();

    expect(fakeClient.startCalls).toHaveLength(1);
    expect(scheduler.pendingCount).toBe(1);

    // Heartbeat 1 before shutdown
    await scheduler.advanceNext();
    expect(fakeClient.heartbeatCalls).toHaveLength(1);

    // Request shutdown while render is still in progress
    abortController.abort();
    await flushPromises();

    // Heartbeat loop must still be sleeping for next interval (10000ms), not terminated
    expect(scheduler.pendingCount).toBe(1);

    // Heartbeat 2 occurs during shutdown
    await scheduler.advanceNext();
    expect(fakeClient.heartbeatCalls).toHaveLength(2);

    // Heartbeat 3 occurs during shutdown
    expect(scheduler.pendingCount).toBe(1);
    await scheduler.advanceNext();
    expect(fakeClient.heartbeatCalls).toHaveLength(3);

    // Render settles
    renderDeferred.resolve({
      candidatePayload: {
        variantOrdinal: 1,
        storageBucket: "candidates",
        storageObjectKey: "final.png",
        contentHashSha256: "e".repeat(64)
      }
    });

    await processPromise;

    expect(fakeClient.completeCalls).toHaveLength(1);
  });

  it("settlement complete retries persist through shutdown on transient errors", async () => {
    const scheduler = new FakeScheduler();
    const sampleJob = createSampleJob();
    let completeAttempts = 0;

    const fakeClient = new FakeControlApiClient({
      onComplete: () => {
        completeAttempts++;
        if (completeAttempts < 3) {
          throw new ControlApiClientError("503 Service Unavailable during complete", 503);
        }
        return { outcome: "applied", job: sampleJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      renderJobExecutor: async () => ({
        candidatePayload: {
          variantOrdinal: 1,
          storageBucket: "candidates",
          storageObjectKey: "output.png",
          contentHashSha256: "f".repeat(64)
        }
      })
    });

    const abortController = new AbortController();
    fakeClient.claim = vi.fn().mockResolvedValue(sampleJob);
    const startPromise = worker.start(abortController.signal);

    await flushPromises();
    expect(fakeClient.completeCalls).toHaveLength(1);

    // Shutdown requested while complete is retrying
    abortController.abort();
    await flushPromises();

    // Complete retry 1 should be scheduled with normal pollIntervalMs
    expect(scheduler.pendingCount).toBeGreaterThanOrEqual(1);
    while (fakeClient.completeCalls.length === 1 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }
    expect(fakeClient.completeCalls).toHaveLength(2);

    // Complete retry 2
    while (fakeClient.completeCalls.length === 2 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }
    expect(fakeClient.completeCalls).toHaveLength(3);

    // Worker start resolves cleanly
    await startPromise;
    expect(fakeClient.completeCalls).toHaveLength(3);
    expect(fakeClient.failCalls).toHaveLength(0);
  });

  it("settlement fail retries persist through shutdown on transient errors", async () => {
    const scheduler = new FakeScheduler();
    const sampleJob = createSampleJob();
    let failAttempts = 0;

    const fakeClient = new FakeControlApiClient({
      onFail: () => {
        failAttempts++;
        if (failAttempts < 3) {
          throw new ControlApiClientError("500 Internal Server Error during fail", 500);
        }
        return { outcome: "applied", job: sampleJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      renderJobExecutor: async () => {
        throw new Error("Render pipeline fatal crash");
      }
    });

    const abortController = new AbortController();
    fakeClient.claim = vi.fn().mockResolvedValue(sampleJob);
    const startPromise = worker.start(abortController.signal);

    await flushPromises();
    expect(fakeClient.failCalls).toHaveLength(1);

    // Shutdown requested during fail retry
    abortController.abort();
    await flushPromises();

    while (fakeClient.failCalls.length === 1 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }
    expect(fakeClient.failCalls).toHaveLength(2);

    while (fakeClient.failCalls.length === 2 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }
    expect(fakeClient.failCalls).toHaveLength(3);

    await startPromise;
    expect(fakeClient.failCalls).toHaveLength(3);
  });

  it("settlement defer retries persist through shutdown on transient errors", async () => {
    const scheduler = new FakeScheduler();
    const sampleJob = createSampleJob();
    let deferAttempts = 0;

    const admissionError = new StorageAdmissionError({
      operationClass: "candidate_upload",
      watermarkState: "degraded",
      usedRatio: 0.86,
      totalBytes: 1_000_000_000,
      freeBytes: 140_000_000
    });

    const fakeClient = new FakeControlApiClient({
      onDefer: () => {
        deferAttempts++;
        if (deferAttempts < 3) {
          throw new ControlApiClientError("502 Bad Gateway during defer", 502);
        }
        return { outcome: "deferred", job: sampleJob };
      }
    });

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      enforceStorageAdmission: new FakeStorageAdmissionEnforcer(() => {
        throw admissionError;
      }),
      sleep: scheduler.sleep
    });

    const abortController = new AbortController();
    fakeClient.claim = vi.fn().mockResolvedValue(sampleJob);
    const startPromise = worker.start(abortController.signal);

    await flushPromises();
    expect(fakeClient.deferCalls).toHaveLength(1);

    // Shutdown requested during defer retry
    abortController.abort();
    await flushPromises();

    while (fakeClient.deferCalls.length === 1 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }
    expect(fakeClient.deferCalls).toHaveLength(2);

    while (fakeClient.deferCalls.length === 2 && scheduler.pendingCount > 0) {
      await scheduler.advanceNext();
      await flushPromises();
    }
    expect(fakeClient.deferCalls).toHaveLength(3);

    await startPromise;
    expect(fakeClient.deferCalls).toHaveLength(3);
  });

  it("worker.start cleanly exits without unhandled rejection if processJob start aborts on shutdown", async () => {
    const fakeClient = new FakeControlApiClient({
      onStart: () => {
        throw new ControlApiClientError("Connection refused", 500);
      }
    });
    const scheduler = new FakeScheduler();
    const logger = new FakeLogger();
    const sampleJob = createSampleJob();

    fakeClient.claim = vi.fn().mockResolvedValue(sampleJob);

    const { worker } = createTestWorker({
      controlApiClient: fakeClient,
      sleep: scheduler.sleep,
      logger
    });

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);
    await flushPromises();

    expect(fakeClient.startCalls).toHaveLength(1);
    expect(scheduler.pendingCount).toBe(1);

    // Request shutdown while waiting to retry start
    abortController.abort();
    await flushPromises();

    // start() should resolve cleanly without throwing
    await expect(startPromise).resolves.toBeUndefined();
    expect(logger.errorLogs.length).toBeGreaterThan(0);
    expect(logger.errorLogs[0]).toContain("Job processing error");
  });
});
