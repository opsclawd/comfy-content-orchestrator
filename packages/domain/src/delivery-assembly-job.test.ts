import { describe, expect, it } from "vitest";
import type { DeliveryAssemblyJob } from "./delivery-assembly-job.js";
import type { CampaignId } from "./scene.js";
import type { JobId, LeaseToken } from "./render-job.js";

describe("DeliveryAssemblyJob domain contract", () => {
  it("satisfies the DeliveryAssemblyJob contract with queued and leased shapes", () => {
    const queuedJob: DeliveryAssemblyJob = {
      jobId: "job-1" as JobId,
      campaignId: "campaign-1" as CampaignId,
      assemblySpec: { title: "Campaign Reel" },
      status: "queued",
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryCount: 0,
      maxRetries: 3,
      errorTrace: null,
      createdAt: new Date("2026-08-26T00:00:00Z"),
      updatedAt: new Date("2026-08-26T00:00:00Z")
    };
    expect(queuedJob.workerId).toBeNull();
    expect(queuedJob.leaseToken).toBeNull();
    expect(queuedJob.leaseExpiresAt).toBeNull();
    expect(queuedJob.errorTrace).toBeNull();

    const leasedJob: DeliveryAssemblyJob = {
      ...queuedJob,
      status: "leased",
      workerId: "assembler-1",
      leaseToken: "lease-1" as LeaseToken,
      leaseExpiresAt: new Date("2026-08-26T00:05:00Z")
    };
    expect(leasedJob.workerId).toBe("assembler-1");
    expect(leasedJob.leaseToken).toBe("lease-1");
    expect(leasedJob.leaseExpiresAt).toBeInstanceOf(Date);
    expect(leasedJob.createdAt).toBeInstanceOf(Date);
    expect(leasedJob.updatedAt).toBeInstanceOf(Date);
  });
});
