import type {
  CandidateCompletionPayload,
  ClaimJobInput,
  EnqueueJobInput,
  JobMutationResult,
  JobQueuePort
} from "../ports/job-queue-port.js";
import type { JobId, LeaseToken, RenderJob } from "@cco/domain";

export class InMemoryJobQueue implements JobQueuePort {
  private readonly _jobs: RenderJob[] = [];
  private _nextJobId = 1;

  get jobs(): readonly RenderJob[] {
    return this._jobs;
  }

  get enqueuedJobs(): readonly RenderJob[] {
    return this._jobs.filter((j) => j.status === "queued");
  }

  createJob(input: EnqueueJobInput): RenderJob {
    const jobId = `018e69e0-8a6a-72cb-b1b7-${String(this._nextJobId++).padStart(12, "0")}` as JobId;
    const now = new Date();
    return Object.freeze({
      jobId,
      sceneId: input.sceneId,
      jobKind: input.jobKind,
      status: "queued",
      workflowTemplate: input.workflowTemplate,
      injectedPayload: Object.freeze({ ...input.injectedPayload }),
      workerId: null,
      leaseToken: null,
      leaseExpiresAt: null,
      retryCount: 0,
      maxRetries: input.maxRetries ?? 3,
      errorTrace: null,
      createdAt: now,
      updatedAt: now
    });
  }

  commitJob(job: RenderJob): void {
    this._jobs.push(job);
  }

  async enqueue(input: EnqueueJobInput): Promise<RenderJob> {
    const job = this.createJob(input);
    this.commitJob(job);
    return job;
  }

  async claim(_input: ClaimJobInput): Promise<RenderJob | undefined> {
    return undefined;
  }

  async start(_jobId: JobId, _leaseToken: LeaseToken): Promise<JobMutationResult> {
    return { outcome: "not_found" };
  }

  async heartbeat(
    _jobId: JobId,
    _leaseToken: LeaseToken,
    _leaseDurationMs: number
  ): Promise<JobMutationResult> {
    return { outcome: "not_found" };
  }

  async complete(
    _jobId: JobId,
    _leaseToken: LeaseToken,
    _manifestPayload?: Readonly<Record<string, unknown>>,
    _candidatePayload?: CandidateCompletionPayload
  ): Promise<JobMutationResult> {
    return { outcome: "not_found" };
  }

  async fail(
    _jobId: JobId,
    _leaseToken: LeaseToken,
    _errorTrace: string
  ): Promise<JobMutationResult> {
    return { outcome: "not_found" };
  }

  async defer(_jobId: JobId, _leaseToken: LeaseToken, _reason: string): Promise<JobMutationResult> {
    return { outcome: "not_found" };
  }
}
