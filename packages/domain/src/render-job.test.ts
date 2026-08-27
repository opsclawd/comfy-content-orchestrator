import { describe, expect, it } from "vitest";
import {
  JOB_KINDS,
  JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  isJobTransitionPermitted,
  isTerminalJobStatus,
  type JobStatus
} from "./index.js";

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
});
