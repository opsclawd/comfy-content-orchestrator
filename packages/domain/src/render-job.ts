import type { SceneId } from "./scene.js";

declare const JobIdBrand: unique symbol;
export type JobId = string & { readonly [JobIdBrand]: true };

declare const LeaseTokenBrand: unique symbol;
export type LeaseToken = string & { readonly [LeaseTokenBrand]: true };

export const JOB_KINDS = ["candidate", "production"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = [
  "queued",
  "leased",
  "rendering",
  "completed",
  "failed",
  "cancelled"
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_JOB_STATUSES = ["completed", "failed", "cancelled"] as const;
export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

export interface RenderJob {
  readonly id: JobId;
  readonly sceneId: SceneId;
  readonly kind: JobKind;
  readonly status: JobStatus;
  readonly workflowTemplate: string;
  readonly injectedPayload: Record<string, unknown>;
  readonly workerId?: string;
  readonly leaseToken?: LeaseToken;
  readonly leaseExpiresAt?: string;
  readonly retryCount: number;
  readonly maxRetries: number;
  readonly errorTrace?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const PERMITTED_TRANSITIONS: Readonly<Record<JobStatus, ReadonlySet<JobStatus>>> = {
  queued: new Set(["leased", "cancelled"]),
  leased: new Set(["rendering", "queued", "failed", "cancelled"]),
  rendering: new Set(["queued", "completed", "failed", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set()
};

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status);
}

export function isJobTransitionPermitted(from: JobStatus, to: JobStatus): boolean {
  return PERMITTED_TRANSITIONS[from].has(to);
}
