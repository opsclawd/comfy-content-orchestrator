import { describe, expect, it } from "vitest";
import type { JobMutationResult } from "@cco/application";
import type { JobId, LeaseToken, RenderJob } from "@cco/domain";
import type { CompleteJobOptions, ControlApiClient } from "./control-api-client.js";

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
    return this.config?.deferResult ?? { outcome: "deferred", job: {} as RenderJob };
  }
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
