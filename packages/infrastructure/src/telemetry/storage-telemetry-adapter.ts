import { statfs } from "node:fs/promises";
import type { StorageTelemetryPort } from "@cco/application";
import type { BucketStorageTelemetry, StorageTelemetrySnapshot } from "@cco/contracts";
import { BUCKET_NAMES } from "@cco/shared";

export type StatFsFn = (path: string) => Promise<{
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}>;

export type BucketUsageProvider = () => Promise<ReadonlyArray<BucketStorageTelemetry>>;

export interface HostFsStorageTelemetryAdapterOptions {
  readonly storagePath?: string | undefined;
  readonly statfsFn?: StatFsFn | undefined;
  readonly bucketUsageProvider?: BucketUsageProvider | undefined;
  readonly clock?: (() => string) | undefined;
}

export class HostFsStorageTelemetryError extends Error {
  override readonly name = "HostFsStorageTelemetryError";

  constructor(
    message: string,
    override readonly cause?: unknown
  ) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}

export class HostFsStorageTelemetryAdapter implements StorageTelemetryPort {
  private readonly storagePath: string;
  private readonly statfsFn: StatFsFn;
  private readonly bucketUsageProvider?: BucketUsageProvider | undefined;
  private readonly clock: () => string;

  constructor(options: HostFsStorageTelemetryAdapterOptions = {}) {
    this.storagePath = options.storagePath ?? "/";
    this.statfsFn = options.statfsFn ?? statfs;
    this.bucketUsageProvider = options.bucketUsageProvider;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async getStorageTelemetry(): Promise<StorageTelemetrySnapshot> {
    let stats;
    try {
      stats = await this.statfsFn(this.storagePath);
    } catch (err: unknown) {
      throw new HostFsStorageTelemetryError(
        `Failed to read storage filesystem stats for ${this.storagePath}: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    const bsize = stats.bsize;
    const totalBytes = stats.blocks * bsize;
    const freeBytes = stats.bavail * bsize;
    const usedBytes = (stats.blocks - stats.bfree) * bsize;

    let buckets: ReadonlyArray<BucketStorageTelemetry>;
    if (this.bucketUsageProvider) {
      try {
        buckets = await this.bucketUsageProvider();
      } catch (err: unknown) {
        throw new HostFsStorageTelemetryError(
          `Failed to read bucket usage: ${err instanceof Error ? err.message : String(err)}`,
          err
        );
      }
    } else {
      buckets = BUCKET_NAMES.map((bucket) => ({
        bucket,
        usedBytes: 0
      }));
    }

    return {
      totalBytes,
      usedBytes,
      freeBytes,
      buckets: [...buckets],
      measuredAt: this.clock()
    };
  }
}
