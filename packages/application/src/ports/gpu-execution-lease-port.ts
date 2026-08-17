export interface GpuLeaseHolder {
  readonly version: 1;
  readonly pid: number;
  readonly startedAt: string;
  readonly hostname: string;
  readonly leaseId: string;
}

export interface RenderLease {
  readonly holder: GpuLeaseHolder;
  release(): Promise<void>;
}

export interface GpuExecutionLeasePort {
  acquireLease(): Promise<RenderLease>;
}

export class GpuLeaseUnavailableError extends Error {
  override readonly name = "GpuLeaseUnavailableError";
  constructor(
    message: string,
    readonly holder?: GpuLeaseHolder,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

export class GpuLeaseOwnershipLostError extends Error {
  override readonly name = "GpuLeaseOwnershipLostError";
}
