import type { JobKind, RenderJob } from "@cco/domain";

export interface ClaimJobInput {
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly allowedJobKinds?: readonly JobKind[];
}

export interface JobAdmissionGate {
  canAdmit(jobKind: JobKind): Promise<boolean>;
}

export interface JobQueuePort {
  claim(input: ClaimJobInput): Promise<RenderJob | undefined>;
}
