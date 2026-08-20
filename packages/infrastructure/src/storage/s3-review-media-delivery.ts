import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PersistentObjectLocator, ReviewMediaDeliveryPort } from "@cco/application";

export interface S3ReviewMediaDeliveryOptions {
  readonly signingEndpoint: string;
  readonly storageEndpoint?: string;
  readonly region?: string;
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly forcePathStyle?: boolean;
  readonly defaultExpirySeconds?: number;
  readonly client?: S3Client;
  readonly storageClient?: S3Client;
}

export class S3ReviewMediaDelivery implements ReviewMediaDeliveryPort {
  private readonly signingClient: S3Client;
  private readonly storageClient: S3Client;
  private readonly defaultExpirySeconds: number;

  constructor(options: S3ReviewMediaDeliveryOptions) {
    this.defaultExpirySeconds = options.defaultExpirySeconds ?? 300;

    const buildClient = (rawEndpoint: string): S3Client => {
      const endpoint =
        rawEndpoint.startsWith("http://") || rawEndpoint.startsWith("https://")
          ? rawEndpoint
          : `https://${rawEndpoint}`;

      const clientConfig: S3ClientConfig = {
        endpoint,
        region: options.region ?? "us-east-1",
        forcePathStyle: options.forcePathStyle ?? true
      };

      if (options.credentials) {
        clientConfig.credentials = {
          accessKeyId: options.credentials.accessKeyId,
          secretAccessKey: options.credentials.secretAccessKey
        };
      }

      return new S3Client(clientConfig);
    };

    if (options.client) {
      this.signingClient = options.client;
      this.storageClient = options.storageClient ?? options.client;
    } else {
      this.signingClient = buildClient(options.signingEndpoint);
      if (options.storageClient) {
        this.storageClient = options.storageClient;
      } else if (options.storageEndpoint && options.storageEndpoint !== options.signingEndpoint) {
        this.storageClient = buildClient(options.storageEndpoint);
      } else {
        this.storageClient = this.signingClient;
      }
    }
  }

  async generatePresignedReadUrl(
    locator: PersistentObjectLocator,
    expiresInSeconds?: number
  ): Promise<string> {
    const expiry = expiresInSeconds ?? this.defaultExpirySeconds;

    if (typeof expiry !== "number" || !Number.isFinite(expiry) || expiry <= 0) {
      throw new Error(`expiresInSeconds must be a positive integer, received: ${expiry}`);
    }

    if (expiry > 900) {
      throw new Error(
        `expiresInSeconds exceeds maximum ceiling of 900 seconds, received: ${expiry}`
      );
    }

    // 1. Verify object existence in S3/MinIO before generating presigned URL
    await this.storageClient.send(
      new HeadObjectCommand({
        Bucket: locator.bucket,
        Key: locator.key
      })
    );

    // 2. Generate presigned URL
    const command = new GetObjectCommand({
      Bucket: locator.bucket,
      Key: locator.key
    });

    return getSignedUrl(this.signingClient, command, {
      expiresIn: expiry
    });
  }
}
