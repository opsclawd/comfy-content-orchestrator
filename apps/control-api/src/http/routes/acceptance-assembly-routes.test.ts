import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { BUCKETS } from "@cco/shared";
import type {
  AcceptanceAssemblyJobQueuePort,
  AcceptanceAssemblyManifestRepository,
  OperatorAcceptanceRunRepository,
  UnitOfWork,
  UnitOfWorkContext
} from "@cco/application";
import type {
  AcceptanceAssemblyJob,
  AcceptanceAssemblyManifest,
  AssemblyManifest
} from "@cco/contracts";
import { createControlApiApp } from "../app.js";

class FakeUnitOfWork implements UnitOfWork {
  private jobs: Map<string, AcceptanceAssemblyJob> = new Map();
  private manifests: Map<string, AcceptanceAssemblyManifest> = new Map();
  public runStatuses: Map<string, string> = new Map();

  constructor(initialJobs?: AcceptanceAssemblyJob[]) {
    if (initialJobs) {
      for (const j of initialJobs) {
        this.jobs.set(j.jobId, j);
      }
    }
  }

  async execute<T>(work: (ctx: UnitOfWorkContext) => Promise<T>): Promise<T> {
    const jobQueue: AcceptanceAssemblyJobQueuePort = {
      enqueue: async (job) => {
        const fullJob: AcceptanceAssemblyJob = {
          ...job,
          status: "queued",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        this.jobs.set(fullJob.jobId, fullJob);
        return fullJob;
      },
      claim: async (workerId, _leaseDurationMs) => {
        for (const job of this.jobs.values()) {
          if (job.status === "queued") {
            const claimed: AcceptanceAssemblyJob = {
              ...job,
              status: "leased",
              workerId,
              leaseToken: "test-lease-token"
            };
            this.jobs.set(claimed.jobId, claimed);
            return claimed;
          }
        }
        return undefined;
      },
      start: async (jobId, leaseToken) => {
        const job = this.jobs.get(jobId);
        if (!job || job.leaseToken !== leaseToken) {
          throw new Error("Invalid lease or job");
        }
        this.jobs.set(jobId, { ...job, status: "rendering" });
      },
      heartbeat: async (jobId, leaseToken, _leaseDurationMs) => {
        const job = this.jobs.get(jobId);
        if (!job || job.leaseToken !== leaseToken) {
          throw new Error("Invalid lease or job");
        }
      },
      complete: async (jobId, outputManifestId, leaseToken) => {
        const job = this.jobs.get(jobId);
        if (!job || (leaseToken && job.leaseToken !== leaseToken)) {
          throw new Error("Invalid lease or job");
        }
        this.jobs.set(jobId, { ...job, status: "completed", outputManifestId });
      },
      fail: async (jobId, error, leaseToken) => {
        const job = this.jobs.get(jobId);
        if (!job || (leaseToken && job.leaseToken !== leaseToken)) {
          throw new Error("Invalid lease or job");
        }
        this.jobs.set(jobId, { ...job, status: "failed", failureReason: error });
      },
      findById: async (jobId) => this.jobs.get(jobId)
    };

    const manifestRepo: AcceptanceAssemblyManifestRepository = {
      saveManifest: async (manifest) => {
        this.manifests.set(manifest.manifestId, manifest);
      },
      findByJobId: async (jobId) => {
        return Array.from(this.manifests.values()).find((m) => m.acceptanceRunId === jobId);
      },
      findByRunId: async (runId) => {
        return Array.from(this.manifests.values()).find((m) => m.acceptanceRunId === runId);
      }
    };

    const acceptanceRunRepo: OperatorAcceptanceRunRepository = {
      createRun: async () => {},
      findRunById: async () => undefined,
      findRunByCampaignId: async () => undefined,
      findRunScenes: async () => [],
      findRunSceneBySceneId: async () => undefined,
      updateRunStatus: async (runId, status) => {
        this.runStatuses.set(runId, status);
      },
      updateSceneAcceptedAttempt: async () => {},
      updateSceneCurrentAttempt: async () => {},
      saveActionReceipt: async () => {},
      findActionReceipt: async () => undefined
    };

    return work({
      acceptanceAssemblyJobs: jobQueue,
      acceptanceAssemblyManifests: manifestRepo,
      operatorAcceptanceRuns: acceptanceRunRepo
    } as unknown as UnitOfWorkContext);
  }
}

describe("AcceptanceAssemblyRoutes", () => {
  const dummySha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const dummyRealm = {
    kind: "isolated_test" as const,
    testRealmId: "test",
    isolationDescriptorDigest: "0".repeat(64)
  };

  const sampleJob: AcceptanceAssemblyJob = {
    jobId: randomUUID(),
    acceptanceRunId: randomUUID(),
    campaignId: randomUUID(),
    status: "queued",
    realm: dummyRealm,
    evidenceOrigin: "simulated_test",
    assemblySpec: {
      campaignId: randomUUID(),
      assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
      expectedTotalDurationMs: 5000,
      videoStems: [],
      subtitleCues: []
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const dummyManifest: AssemblyManifest = {
    assemblyId: "test-assembly-1",
    createdAt: new Date().toISOString(),
    campaignId: sampleJob.campaignId,
    assemblyProfile: { key: "VERTICAL_REEL_1080X1920_V1", version: 1 },
    generationManifestIds: ["gen-1"],
    inputs: {
      videoStems: [
        {
          sceneId: randomUUID(),
          generationManifestId: "gen-1",
          order: 0,
          media: {
            bucket: "godzspeed-review",
            key: "scene-1.mp4",
            sha256: "a".repeat(64),
            contentType: "video/mp4"
          },
          actualDurationMs: 5000
        }
      ]
    },
    timeline: { totalDurationMs: 5000, stemDurationsMs: [5000] },
    subtitleCuesSha256: "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    layout: { mode: "fit_blurred_fill" },
    ffmpeg: { executable: "ffmpeg", version: "7.0.2", buildInfo: "ffmpeg-build-7.0.2" },
    commandFingerprint: "0".repeat(64),
    encoding: {
      video: { codec: "libx264", pixelFormat: "yuv420p", crf: 23, preset: "veryfast" }
    },
    streams: {
      video: {
        codecName: "h264",
        pixelFormat: "yuv420p",
        width: 1080,
        height: 1920,
        frameRate: 30,
        durationMs: 5000
      }
    },
    output: {
      media: {
        bucket: BUCKETS.CANDIDATES,
        key: `acceptance-runs/${sampleJob.acceptanceRunId}/reel.mp4`,
        sha256: dummySha256,
        contentType: "video/mp4"
      },
      durationMs: 5000,
      width: 1080,
      height: 1920
    },
    measuredFrameRate: 30,
    executionDurationMs: 1200,
    governanceDecisionId: "gov-1"
  };

  const sampleManifest: AcceptanceAssemblyManifest = {
    manifestId: randomUUID(),
    jobId: sampleJob.jobId,
    acceptanceRunId: sampleJob.acceptanceRunId,
    campaignId: sampleJob.campaignId,
    realm: dummyRealm,
    evidenceOrigin: "simulated_test",
    planId: randomUUID(),
    acceptedAttemptIds: [randomUUID()],
    manifest: dummyManifest,
    storageBucket: BUCKETS.CANDIDATES,
    storageKey: `acceptance-runs/${sampleJob.acceptanceRunId}/reel.mp4`,
    storageSha256: dummySha256,
    manifestStorageBucket: BUCKETS.CANDIDATES,
    manifestStorageKey: `acceptance-runs/${sampleJob.acceptanceRunId}/manifest.json`,
    manifestStorageSha256: dummySha256,
    createdAt: new Date().toISOString()
  };

  it("POST /api/acceptance-assembly-jobs/claim fails if workerId missing", async () => {
    const app = createControlApiApp({ uow: new FakeUnitOfWork([sampleJob]) });
    const res = await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: {}
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/acceptance-assembly-jobs/claim returns 204 when no job", async () => {
    const app = createControlApiApp({ uow: new FakeUnitOfWork([]) });
    const res = await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: { workerId: "worker-1" }
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /api/acceptance-assembly-jobs/claim claims pending job", async () => {
    const app = createControlApiApp({ uow: new FakeUnitOfWork([sampleJob]) });
    const res = await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: { workerId: "worker-1" }
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.jobId).toBe(sampleJob.jobId);
    expect(body.leaseToken).toBe("test-lease-token");
  });

  it("POST /api/acceptance-assembly-jobs/:jobId/start transitions job", async () => {
    const app = createControlApiApp({ uow: new FakeUnitOfWork([sampleJob]) });
    await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: { workerId: "worker-1" }
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/start`,
      payload: { leaseToken: "test-lease-token" }
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /api/acceptance-assembly-jobs/:jobId/heartbeat refreshes lease", async () => {
    const app = createControlApiApp({ uow: new FakeUnitOfWork([sampleJob]) });
    await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: { workerId: "worker-1" }
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/heartbeat`,
      payload: { leaseToken: "test-lease-token" }
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /api/acceptance-assembly-jobs/:jobId/complete stores manifest and updates status", async () => {
    const fakeUow = new FakeUnitOfWork([sampleJob]);
    const app = createControlApiApp({ uow: fakeUow });
    await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: { workerId: "worker-1" }
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/complete`,
      payload: {
        leaseToken: "test-lease-token",
        outputManifestId: sampleManifest.manifestId,
        acceptanceManifest: sampleManifest
      }
    });
    expect(res.statusCode).toBe(200);
    expect(fakeUow.runStatuses.get(sampleJob.acceptanceRunId)).toBe("completed");
  });

  it("POST /api/acceptance-assembly-jobs/:jobId/fail records failure", async () => {
    const app = createControlApiApp({ uow: new FakeUnitOfWork([sampleJob]) });
    await app.inject({
      method: "POST",
      url: "/api/acceptance-assembly-jobs/claim",
      payload: { workerId: "worker-1" }
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/fail`,
      payload: {
        leaseToken: "test-lease-token",
        acceptanceRunId: sampleJob.acceptanceRunId,
        error: "Assembly failed in ffmpeg"
      }
    });
    expect(res.statusCode).toBe(200);
  });

  describe("Worker Staging Authorization", () => {
    const jobDispatchConfig = {
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 10_000,
      resolveWorkerStagingToken: (workerId: string) =>
        workerId === "auth-worker" ? "secret-staging-token-123" : undefined
    };

    it("enforces staging token on claim, start, heartbeat, complete, and fail", async () => {
      const fakeUow = new FakeUnitOfWork([sampleJob]);
      const app = createControlApiApp({ uow: fakeUow }, { jobDispatch: jobDispatchConfig });

      // 1. Claim without header -> 401
      const claimUnauthorized = await app.inject({
        method: "POST",
        url: "/api/acceptance-assembly-jobs/claim",
        payload: { workerId: "auth-worker" }
      });
      expect(claimUnauthorized.statusCode).toBe(401);

      // Claim with valid header -> 200
      const claimAuthorized = await app.inject({
        method: "POST",
        url: "/api/acceptance-assembly-jobs/claim",
        headers: { "x-worker-staging-token": "secret-staging-token-123" },
        payload: { workerId: "auth-worker" }
      });
      expect(claimAuthorized.statusCode).toBe(200);

      // 2. Start without header -> 401
      const startUnauthorized = await app.inject({
        method: "POST",
        url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/start`,
        payload: { leaseToken: "test-lease-token" }
      });
      expect(startUnauthorized.statusCode).toBe(401);

      // Start with valid header -> 200
      const startAuthorized = await app.inject({
        method: "POST",
        url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/start`,
        headers: { "x-worker-staging-token": "secret-staging-token-123" },
        payload: { leaseToken: "test-lease-token" }
      });
      expect(startAuthorized.statusCode).toBe(200);

      // 3. Heartbeat without header -> 401
      const hbUnauthorized = await app.inject({
        method: "POST",
        url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/heartbeat`,
        payload: { leaseToken: "test-lease-token" }
      });
      expect(hbUnauthorized.statusCode).toBe(401);

      // 4. Complete without header -> 401
      const completeUnauthorized = await app.inject({
        method: "POST",
        url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/complete`,
        payload: {
          leaseToken: "test-lease-token",
          outputManifestId: sampleManifest.manifestId,
          acceptanceManifest: sampleManifest
        }
      });
      expect(completeUnauthorized.statusCode).toBe(401);

      // Complete with valid header -> 200
      const completeAuthorized = await app.inject({
        method: "POST",
        url: `/api/acceptance-assembly-jobs/${sampleJob.jobId}/complete`,
        headers: { "x-worker-staging-token": "secret-staging-token-123" },
        payload: {
          leaseToken: "test-lease-token",
          outputManifestId: sampleManifest.manifestId,
          acceptanceManifest: sampleManifest
        }
      });
      expect(completeAuthorized.statusCode).toBe(200);
    });
  });
});
