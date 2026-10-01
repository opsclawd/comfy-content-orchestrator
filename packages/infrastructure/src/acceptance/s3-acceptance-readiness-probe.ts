import { HeadBucketCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import type {
  AcceptanceObjectStorageReadinessProbePort,
  AcceptanceReadinessProbeResult
} from "@cco/application";

export interface S3AcceptanceReadinessProbeOptions {
  readonly bucket: string;
  readonly client?: S3Client | undefined;
  readonly clientConfig?: S3ClientConfig | undefined;
}

/**
 * Read-only S3/MinIO reachability probe (`HeadBucket`). Performs no PutObject,
 * DeleteObject, or any mutation — purely a connectivity/permissions check ahead of
 * handing preparation tooling off to a human operator.
 */
export class S3AcceptanceReadinessProbe implements AcceptanceObjectStorageReadinessProbePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3AcceptanceReadinessProbeOptions) {
    this.bucket = options.bucket;
    this.client = options.client ?? new S3Client(options.clientConfig ?? {});
  }

  async probe(): Promise<AcceptanceReadinessProbeResult> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        detail: err instanceof Error ? err.message : String(err)
      };
    }
  }
}
