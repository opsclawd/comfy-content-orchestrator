import { describe, expect, it } from "vitest";
import {
  JOB_KINDS,
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  isJobTransitionPermitted,
  isTerminalJobStatus,
  type JobId,
  type JobStatus,
  type LeaseToken,
  type RenderJob
} from "./index.js";
import type { SceneId } from "./scene.js";

const permittedTransitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ["leased", "cancelled"],
  leased: ["rendering", "queued", "failed", "cancelled"],
  rendering: ["queued", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: []
};

describe("RenderJob domain contract", () => {
  it("exports canonical job kinds and statuses in database order", () => {
    expect(JOB_KINDS).toEqual(["candidate", "production"]);
    expect(JOB_STATUSES).toEqual([
      "queued",
      "leased",
      "rendering",
      "completed",
      "failed",
      "cancelled"
    ]);
    expect(TERMINAL_JOB_STATUSES).toEqual(["completed", "failed", "cancelled"]);
  });

  it("classifies exactly completed failed and cancelled as terminal", () => {
    for (const status of JOB_STATUSES) {
      expect(isTerminalJobStatus(status)).toBe(TERMINAL_JOB_STATUSES.includes(status as never));
    }
  });

  it("permits exactly the canonical render job transition matrix", () => {
    for (const from of JOB_STATUSES) {
      for (const to of JOB_STATUSES) {
        expect(isJobTransitionPermitted(from, to), `${from} -> ${to}`).toBe(
          permittedTransitions[from].includes(to)
        );
      }
    }
  });

  it("forbids every transition out of terminal statuses", () => {
    for (const from of TERMINAL_JOB_STATUSES) {
      for (const to of JOB_STATUSES) expect(isJobTransitionPermitted(from, to)).toBe(false);
    }
  });

  it("satisfies the RenderJob contract with queued/leased shapes for nullable fields", () => {
    const queuedJob: RenderJob = {
      jobId: "job-1" as JobId,
      sceneId: "scene-1" as SceneId,
      jobKind: "candidate",
      status: "queued",
      workflowTemplate: "template.json",
      injectedPayload: { prompt: "a scene" },
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

    const leasedJob: RenderJob = {
      ...queuedJob,
      jobKind: "production",
      status: "leased",
      workerId: "worker-1",
      leaseToken: "lease-1" as LeaseToken,
      leaseExpiresAt: new Date("2026-08-26T00:05:00Z")
    };
    expect(leasedJob.workerId).toBe("worker-1");
    expect(leasedJob.leaseToken).toBe("lease-1");
    expect(leasedJob.leaseExpiresAt).toBeInstanceOf(Date);
    expect(leasedJob.createdAt).toBeInstanceOf(Date);
    expect(leasedJob.updatedAt).toBeInstanceOf(Date);
  });
});
