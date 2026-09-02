import { describe, expect, it, vi } from "vitest";
import { LicenseRoutingError } from "@cco/application";
import type { AssemblyExecutionResult, AssemblyManifest, AssemblySpec } from "@cco/contracts";
import type { CampaignId, DeliveryAssemblyJob, JobId, LeaseToken } from "@cco/domain";
import {
  ControlApiClientError,
  type DeliveryAssemblyControlApiClient
} from "./control-api-client.js";
import {
  DeliveryAssemblyWorker,
  type DeliveryAssemblyJobExecutorResult
} from "./delivery-assembly-worker.js";
import type { WorkerLogger } from "./worker.js";

const sampleJobId = "11111111-1111-4111-8111-111111111111" as JobId;
const sampleCampaignId = "22222222-2222-4222-8222-222222222222" as CampaignId;
const sampleLeaseToken = "33333333-3333-4333-8333-333333333333" as LeaseToken;

const sampleAssemblySpec: AssemblySpec = {
  campaignId: sampleCampaignId,
  assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
  expectedTotalDurationMs: 5000,
  videoStems: [
    {
      order: 0,
      sceneId: "44444444-4444-4444-8444-444444444444",
      generationManifestId: "55555555-5555-4555-8555-555555555555",
      expectedDurationMs: 5000,
      media: {
        bucket: "godzspeed-delivery",
        key: `campaigns/${sampleCampaignId}/scenes/scene-1/output.mp4`,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        contentType: "video/mp4"
      }
    }
  ]
} as unknown as AssemblySpec;

const sampleLeasedJob: DeliveryAssemblyJob<AssemblySpec> = {
  jobId: sampleJobId,
  campaignId: sampleCampaignId,
  assemblySpec: sampleAssemblySpec,
  status: "leased",
  workerId: "assembler-1",
  leaseToken: sampleLeaseToken,
  leaseExpiresAt: new Date(Date.now() + 60_000),
  retryCount: 0,
  maxRetries: 3,
  errorTrace: null,
  createdAt: new Date("2026-08-27T08:00:00.000Z"),
  updatedAt: new Date("2026-08-27T08:00:00.000Z")
};

const sampleExecutionResult: DeliveryAssemblyJobExecutorResult = {
  manifest: {
    assemblyId: "manifest-1",
    campaignId: sampleCampaignId,
    createdAt: new Date().toISOString()
  } as unknown as AssemblyManifest,
  executionResult: {
    output: {
      media: {
        bucket: "godzspeed-delivery",
        key: `campaigns/${sampleCampaignId}/deliverables/delivery-reel.mp4`,
        sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        contentType: "video/mp4"
      },
      durationMs: 5000,
      width: 1080,
      height: 1920
    }
  } as unknown as AssemblyExecutionResult
};

const noopLogger: WorkerLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
};

const testSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, Math.min(ms, 10));
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

describe("DeliveryAssemblyWorker", () => {
  it("rejects configuration when heartbeatIntervalMs >= leaseDurationMs", () => {
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn(),
      start: vi.fn(),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    expect(
      () =>
        new DeliveryAssemblyWorker(
          {
            controlApiClient: client,
            assembleDeliveryReel: vi.fn(),
            logger: noopLogger,
            sleep: testSleep
          },
          {
            workerId: "assembler-1",
            pollIntervalMs: 1000,
            heartbeatIntervalMs: 5000,
            leaseDurationMs: 5000
          }
        )
    ).toThrow("heartbeatIntervalMs must be less than leaseDurationMs");
  });

  it("claims, starts, executes, and completes a delivery assembly job", async () => {
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);

    expect(client.claim).toHaveBeenCalledWith("assembler-1");
    expect(client.start).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken);
    expect(executor).toHaveBeenCalledWith(sampleLeasedJob);
    expect(client.complete).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("retries completion on transient failure without failing the job or re-running execution", async () => {
    let completeAttempts = 0;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockImplementation(async () => {
        completeAttempts++;
        if (completeAttempts < 3) {
          throw new ControlApiClientError("Transient network failure", 500);
        }
        return { outcome: "applied", job: sampleLeasedJob };
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(completeAttempts).toBe(3);
    expect(client.complete).toHaveBeenCalledTimes(3);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("serializes bounded structured denial trace with decisionId on LicenseRoutingError", async () => {
    let recordedErrorTrace = "";
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn(),
      fail: vi.fn().mockImplementation(async (_jobId, _token, errorTrace) => {
        recordedErrorTrace = errorTrace;
        return { outcome: "applied", job: sampleLeasedJob };
      }),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const licenseError = new LicenseRoutingError("License routing denied: component restricted", {
      decisionId: "gov-dec-12345-abcde",
      registryRevision: "2026-08-29.1",
      evaluatedComponents: [
        {
          componentId: "ffmpeg",
          componentType: "runtime",
          versionOrRevision: "n8.0.1",
          status: "restricted",
          licenseSource: "registry"
        }
      ],
      deniedReasons: ['Component "ffmpeg" has policy status "restricted"']
    });

    const executor = vi.fn().mockRejectedValue(licenseError);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);

    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken, expect.any(String));
    expect(recordedErrorTrace).toContain("LicenseRoutingError");
    expect(recordedErrorTrace).toContain("gov-dec-12345-abcde");
    expect(recordedErrorTrace).toContain("restricted");
  });

  it("fails the job when execution throws a generic error", async () => {
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const executor = vi.fn().mockRejectedValue(new Error("FFmpeg encode crashed"));

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);

    expect(client.start).toHaveBeenCalled();
    expect(executor).toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).toHaveBeenCalledWith(
      sampleJobId,
      sampleLeaseToken,
      expect.stringContaining("FFmpeg encode crashed")
    );
  });

  it("aborts execution if start returns superseded", async () => {
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "superseded" }),
      heartbeat: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);

    expect(client.start).toHaveBeenCalled();
    expect(executor).not.toHaveBeenCalled();
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("drains active job when stop() is called during execution", async () => {
    let jobCompleted = false;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockImplementation(async () => {
        jobCompleted = true;
        return { outcome: "applied", job: sampleLeasedJob };
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn()
    };

    let finishExecution: () => void;
    const executionPromise = new Promise<DeliveryAssemblyJobExecutorResult>((resolve) => {
      finishExecution = () => resolve(sampleExecutionResult);
    });

    const executor = vi.fn().mockImplementation(() => executionPromise);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const startPromise = worker.start();

    // Wait until executor is running
    while (executor.mock.calls.length === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Call stop while execution is active
    let stopResolved = false;
    const stopPromise = worker.stop().then(() => {
      stopResolved = true;
    });

    // Verify stop has not resolved yet because job is still active
    await new Promise((r) => setTimeout(r, 20));
    expect(stopResolved).toBe(false);
    expect(jobCompleted).toBe(false);

    // Now resolve execution
    finishExecution!();

    await stopPromise;
    await startPromise;

    expect(stopResolved).toBe(true);
    expect(jobCompleted).toBe(true);
    expect(client.complete).toHaveBeenCalledWith(sampleJobId, sampleLeaseToken);
  });

  it("continues renewing lease via heartbeats during settlement uncertainty", async () => {
    let completeAttempts = 0;
    let heartbeatCount = 0;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockImplementation(async () => {
        heartbeatCount++;
        return { outcome: "applied", job: sampleLeasedJob };
      }),
      complete: vi.fn().mockImplementation(async () => {
        completeAttempts++;
        if (completeAttempts < 4) {
          throw new ControlApiClientError("503 Service Unavailable", 503);
        }
        return { outcome: "applied", job: sampleLeasedJob };
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn().mockResolvedValue(sampleLeasedJob)
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 10,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(completeAttempts).toBe(4);
    expect(heartbeatCount).toBeGreaterThanOrEqual(1);
    expect(client.complete).toHaveBeenCalledTimes(4);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("reconciles state when complete was applied remotely but threw transport error", async () => {
    let completeAttempts = 0;
    const completedJob: DeliveryAssemblyJob<AssemblySpec> = {
      ...sampleLeasedJob,
      status: "completed"
    };

    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockImplementation(async () => {
        completeAttempts++;
        throw new ControlApiClientError("Connection reset by peer", 500);
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn().mockImplementation(async () => {
        if (completeAttempts >= 1) {
          return completedJob;
        }
        return sampleLeasedJob;
      })
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(client.getJob).toHaveBeenCalledWith(sampleJobId);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("fences attempt and abandons when Control API outage outlasts the lease", async () => {
    const expiredJob: DeliveryAssemblyJob<AssemblySpec> = {
      ...sampleLeasedJob,
      leaseExpiresAt: new Date(Date.now() - 1000)
    };

    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(expiredJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: expiredJob }),
      heartbeat: vi.fn().mockImplementation(async () => {
        throw new ControlApiClientError("Control API unreachable", 500);
      }),
      complete: vi.fn().mockImplementation(async () => {
        throw new ControlApiClientError("Control API unreachable", 500);
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn().mockImplementation(async () => {
        throw new ControlApiClientError("Control API unreachable", 500);
      })
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    // Complete was attempted, but because lease expired, attempt was fenced and abandoned
    expect(client.complete).toHaveBeenCalled();
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("settlement complete retries are bounded and drain cleanly during shutdown", async () => {
    let completeCalls = 0;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockImplementation(async () => {
        completeCalls++;
        throw new ControlApiClientError("Control API persistent 503", 503);
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn().mockRejectedValue(new ControlApiClientError("503", 503))
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);

    // Wait until complete is being retried
    while (completeCalls === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Trigger shutdown while complete is retrying
    abortController.abort();

    // The worker should drain promptly within bounded retries without hanging
    await expect(startPromise).resolves.toBeUndefined();
    expect(completeCalls).toBeGreaterThanOrEqual(1);
    expect(completeCalls).toBeLessThanOrEqual(5);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("bounds completion retries by a wall-clock settlement deadline during a persistent completion-only outage, with no shutdown and a healthy heartbeat", async () => {
    // Regression test for a completion-endpoint-specific outage: heartbeat
    // keeps succeeding (so AttemptTracker's lease-expiry fencing never
    // trips — updateLeaseExpiry() keeps pushing the deadline out), complete
    // and the reconciliation probe (getJob) both fail persistently, and no
    // shutdown is ever requested. Before maxSettlementMs existed, nothing
    // bounded this loop and it retried forever. Without the fix this test
    // would hang until the suite's own timeout.
    let completeCalls = 0;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn().mockImplementation(async () => {
        completeCalls++;
        throw new ControlApiClientError("Control API persistent 503 on complete only", 503);
      }),
      fail: vi.fn(),
      defer: vi.fn(),
      getJob: vi.fn().mockRejectedValue(new ControlApiClientError("503", 503))
    };

    const executor = vi.fn().mockResolvedValue(sampleExecutionResult);

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        // Deliberately far longer than maxSettlementMs, so lease-expiry
        // fencing alone could never explain the loop terminating.
        leaseDurationMs: 100_000,
        maxSettlementMs: 20
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(completeCalls).toBeGreaterThan(0);
    expect(client.fail).not.toHaveBeenCalled();
  });

  it("retries fail mutation on transient error and reconciles state", async () => {
    let failCalls = 0;
    const failedJob: DeliveryAssemblyJob<AssemblySpec> = {
      ...sampleLeasedJob,
      status: "failed"
    };

    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn(),
      fail: vi.fn().mockImplementation(async () => {
        failCalls++;
        if (failCalls < 3) {
          throw new ControlApiClientError("500 Internal Error", 500);
        }
        return { outcome: "applied", job: failedJob };
      }),
      defer: vi.fn(),
      getJob: vi.fn().mockResolvedValue(sampleLeasedJob)
    };

    const executor = vi.fn().mockRejectedValue(new Error("FFmpeg binary missing"));

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(failCalls).toBe(3);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("bounds fail retries by a wall-clock settlement deadline during a persistent fail-only outage, with no shutdown and a healthy heartbeat", async () => {
    // Mirror of the completeWithRetry regression test above, for
    // failWithRetry: a fail-endpoint-specific persistent outage with a
    // healthy heartbeat (never fenced via lease expiry) and no shutdown
    // must still terminate via maxSettlementMs.
    let failCalls = 0;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn(),
      fail: vi.fn().mockImplementation(async () => {
        failCalls++;
        throw new ControlApiClientError("Control API persistent 503 on fail only", 503);
      }),
      defer: vi.fn(),
      getJob: vi.fn().mockRejectedValue(new ControlApiClientError("503", 503))
    };

    const executor = vi.fn().mockRejectedValue(new Error("FFmpeg binary missing"));

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 100_000,
        maxSettlementMs: 20
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(failCalls).toBeGreaterThan(0);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("fences attempt and abandons when fail retry discovers lease expired during reconciliation", async () => {
    let failCalls = 0;
    const expiredJob: DeliveryAssemblyJob<AssemblySpec> = {
      ...sampleLeasedJob,
      leaseExpiresAt: new Date(Date.now() - 5000)
    };

    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn(),
      fail: vi.fn().mockImplementation(async () => {
        failCalls++;
        throw new ControlApiClientError("500 Internal Error", 500);
      }),
      defer: vi.fn(),
      getJob: vi.fn().mockResolvedValue(expiredJob)
    };

    const executor = vi.fn().mockRejectedValue(new Error("FFmpeg crash"));

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const ran = await worker.runOnce();
    expect(ran).toBe(true);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(failCalls).toBe(1);
    expect(client.getJob).toHaveBeenCalledWith(sampleJobId);
  });

  it("settlement fail retries are bounded and drain cleanly during shutdown", async () => {
    let failCalls = 0;
    const client: DeliveryAssemblyControlApiClient = {
      enqueue: vi.fn(),
      claim: vi.fn().mockResolvedValue(sampleLeasedJob),
      start: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      heartbeat: vi.fn().mockResolvedValue({ outcome: "applied", job: sampleLeasedJob }),
      complete: vi.fn(),
      fail: vi.fn().mockImplementation(async () => {
        failCalls++;
        throw new ControlApiClientError("Control API persistent 503", 503);
      }),
      defer: vi.fn(),
      getJob: vi.fn().mockRejectedValue(new ControlApiClientError("503", 503))
    };

    const executor = vi.fn().mockRejectedValue(new Error("FFmpeg error"));

    const worker = new DeliveryAssemblyWorker(
      {
        controlApiClient: client,
        assembleDeliveryReel: executor,
        logger: noopLogger,
        sleep: testSleep
      },
      {
        workerId: "assembler-1",
        pollIntervalMs: 5,
        heartbeatIntervalMs: 50,
        leaseDurationMs: 1000
      }
    );

    const abortController = new AbortController();
    const startPromise = worker.start(abortController.signal);

    // Wait until fail is being retried
    while (failCalls === 0) {
      await new Promise((r) => setTimeout(r, 5));
    }

    // Trigger shutdown while fail is retrying
    abortController.abort();

    // The worker should drain promptly within bounded retries without hanging
    await expect(startPromise).resolves.toBeUndefined();
    expect(failCalls).toBeGreaterThanOrEqual(1);
    expect(failCalls).toBeLessThanOrEqual(5);
  });
});
