import { GetObjectCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PersistentObjectLocator, ReviewMediaDeliveryPort } from "@cco/application";

export interface S3ReviewMediaDeliveryOptions {
  readonly signingEndpoint: string;
  readonly region?: string;
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly forcePathStyle?: boolean;
  readonly defaultExpirySeconds?: number;
  readonly client?: S3Client;
}

export class S3ReviewMediaDelivery implements ReviewMediaDeliveryPort {
  private readonly client: S3Client;
  private readonly defaultExpirySeconds: number;

  constructor(options: S3ReviewMediaDeliveryOptions) {
    this.defaultExpirySeconds = options.defaultExpirySeconds ?? 300;

    if (options.client) {
      this.client = options.client;
    } else {
      const endpoint =
        options.signingEndpoint.startsWith("http://") ||
        options.signingEndpoint.startsWith("https://")
          ? options.signingEndpoint
          : `https://${options.signingEndpoint}`;

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

      this.client = new S3Client(clientConfig);
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

    const command = new GetObjectCommand({
      Bucket: locator.bucket,
      Key: locator.key
    });

    return getSignedUrl(this.client, command, {
      expiresIn: expiry
    });
  }
}
