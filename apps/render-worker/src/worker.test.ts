import { describe, expect, it } from "vitest";
import {
  StorageAdmissionError,
  type JobMutationResult,
  type ObjectLocator,
  type ObjectStoragePort,
  type PutObjectInput,
  type StoredObject
} from "@cco/application";
import type { StorageOperationClass } from "@cco/contracts";
import {
  createStorageAdmissionPolicy,
  type JobId,
  type LeaseToken,
  type RenderJob,
  type SceneId,
  type StorageAdmissionPolicy
} from "@cco/domain";
import type { CompleteJobOptions, ControlApiClient } from "./control-api-client.js";
import { ControlApiClientError } from "./control-api-client.js";
import { RenderWorker, type StorageAdmissionEnforcer } from "./worker.js";

export class FakeControlApiClient implements ControlApiClient {
  readonly claimCalls: string[] = [];
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
          onComplete?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string,
            payload?: CompleteJobOptions | undefined
          ) => Promise<JobMutationResult> | JobMutationResult;
          onDefer?: (
            jobId: JobId | string,
            leaseToken: LeaseToken | string,
            reason: string
          ) => Promise<JobMutationResult> | JobMutationResult;
        }
      | undefined
  ) {}

  async claim(workerId: string): Promise<RenderJob | undefined> {
    this.claimCalls.push(workerId);
    return this.config?.claimResult;
  }

  async start(jobId: JobId | string, leaseToken: LeaseToken | string): Promise<JobMutationResult> {
    this.startCalls.push({ jobId, leaseToken });
    return this.config?.startResult ?? { outcome: "applied", job: {} as RenderJob };
  }

  async heartbeat(
    jobId: JobId | string,
    leaseToken: LeaseToken | string
  ): Promise<JobMutationResult> {
    this.heartbeatCalls.push({ jobId, leaseToken });
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

describe("Worker test structural fakes", () => {
  it("FakeControlApiClient satisfies ControlApiClient contract including defer", async () => {
    const fakeClient: ControlApiClient = new FakeControlApiClient({
      deferResult: { outcome: "deferred", job: {} as RenderJob }
    });

    const jobId = "job-123" as JobId;
    const leaseToken = "lease-456" as LeaseToken;
    const reason = "Storage admission denied at write time";

    const result = await fakeClient.defer(jobId, leaseToken, reason);
    expect(result).toEqual({ outcome: "deferred", job: {} });

    const clientInstance = fakeClient as FakeControlApiClient;
    expect(clientInstance.deferCalls).toEqual([
      { jobId: "job-123", leaseToken: "lease-456", reason }
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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        mediaObjects,
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        mediaObjects,
        manifestPayload: { duration: 5.0 }
      })
    });

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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        candidatePayload: { variantOrdinal: 0 }
      })
    });

    await worker.processJob(candidateJob);

    expect(callLog).toEqual(["admission:candidate_upload", "complete"]);
    expect(fakeClient.completeCalls).toHaveLength(1);
    expect(fakeClient.completeCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.completeCalls[0]?.leaseToken).toBe(sampleLeaseToken);
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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        manifestPayload: { sceneId: sampleSceneId }
      })
    });

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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        mediaObjects,
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const worker1 = new RenderWorker({
      controlApiClient: fakeClientSuperseded,
      objectStorage: fakeStorage1,
      enforceStorageAdmission: fakeEnforcer1,
      renderJobExecutor: async () => ({
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const worker2 = new RenderWorker({
      controlApiClient: fakeClientNotFound,
      objectStorage: fakeStorage2,
      enforceStorageAdmission: fakeEnforcer2,
      renderJobExecutor: async () => ({
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const fakeClient = new FakeControlApiClient({
      onDefer: () => {
        throw networkError;
      }
    });
    const fakeStorage = new FakeObjectStorage();
    const fakeEnforcer = new FakeStorageAdmissionEnforcer(() => {
      throw admissionError;
    });

    const candidateJob = createSampleJob({ jobKind: "candidate" });

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        candidatePayload: { variantOrdinal: 1 }
      })
    });

    await expect(worker.processJob(candidateJob)).rejects.toThrow(networkError);

    expect(fakeClient.deferCalls).toHaveLength(1);
    // Crucial: fail is NEVER called when defer fails with transport error
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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => ({
        mediaObjects,
        candidatePayload: { variantOrdinal: 1 }
      })
    });

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

    const worker = new RenderWorker({
      controlApiClient: fakeClient,
      objectStorage: fakeStorage,
      enforceStorageAdmission: fakeEnforcer,
      renderJobExecutor: async () => {
        throw renderError;
      }
    });

    await worker.processJob(candidateJob);

    expect(fakeClient.failCalls).toHaveLength(1);
    expect(fakeClient.failCalls[0]?.jobId).toBe(sampleJobId);
    expect(fakeClient.failCalls[0]?.leaseToken).toBe(sampleLeaseToken);
    expect(fakeClient.failCalls[0]?.errorTrace).toContain("CUDA device out of memory");

    expect(fakeClient.deferCalls).toHaveLength(0);
    expect(fakeStorage.puts).toHaveLength(0);
    expect(fakeClient.completeCalls).toHaveLength(0);
  });
});
