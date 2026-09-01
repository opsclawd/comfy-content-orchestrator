import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type {
  GetObjectOptions,
  ObjectLocator,
  ObjectStoragePort,
  PutObjectInput,
  StoredObject
} from "@cco/application";

export interface S3ObjectStorageOptions {
  readonly endpoint: string;
  readonly region?: string;
  readonly credentials?: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly forcePathStyle?: boolean;
  readonly client?: S3Client;
}

function computeSha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissingKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  // Check for standard NoSuchKey / NotFound while excluding NoSuchBucket
  if (err.name === "NoSuchBucket" || err.Code === "NoSuchBucket") {
    return false;
  }
  return (
    err.name === "NoSuchKey" ||
    err.name === "NotFound" ||
    err.Code === "NoSuchKey" ||
    err.Code === "NotFound" ||
    err.$metadata?.httpStatusCode === 404
  );
}

async function readBodyWithLimit(
  body: unknown,
  locator: ObjectLocator,
  maxBytes?: number
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }

  if (
    typeof body === "object" &&
    body !== null &&
    Symbol.asyncIterator in body &&
    typeof (body as Record<string | symbol, unknown>)[Symbol.asyncIterator] === "function"
  ) {
    const stream = body as AsyncIterable<Uint8Array | Buffer | ArrayBuffer> & {
      destroy?: (error?: Error) => void;
    };
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      for await (const rawChunk of stream) {
        const chunk =
          rawChunk instanceof Uint8Array
            ? rawChunk
            : new Uint8Array(
                ArrayBuffer.isView(rawChunk) ? rawChunk.buffer : (rawChunk as ArrayBuffer)
              );
        totalBytes += chunk.byteLength;

        if (maxBytes !== undefined && totalBytes > maxBytes) {
          if (typeof stream.destroy === "function") {
            try {
              stream.destroy();
            } catch {
              // ignore destroy errors
            }
          }
          throw new Error(
            `Object ${locator.bucket}/${locator.key} byteLength (${totalBytes}) exceeds maxBytes limit (${maxBytes})`
          );
        }
        chunks.push(chunk);
      }
    } catch (err) {
      if (typeof stream.destroy === "function") {
        try {
          stream.destroy();
        } catch {
          // ignore destroy errors
        }
      }
      throw err;
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  if (
    typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray ===
    "function"
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
      throw new Error(
        `Object ${locator.bucket}/${locator.key} byteLength (${bytes.byteLength}) exceeds maxBytes limit (${maxBytes})`
      );
    }
    return bytes;
  }

  return new Uint8Array();
}

export class S3ObjectStorage implements ObjectStoragePort {
  private readonly client: S3Client;

  constructor(options: S3ObjectStorageOptions) {
    if (options.client) {
      this.client = options.client;
    } else {
      const clientConfig: S3ClientConfig = {
        endpoint: options.endpoint,
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

  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    const metadata: Record<string, string> = {};

    if (input.checksumSha256 !== undefined) {
      const computed = computeSha256Hex(input.body);
      if (computed !== input.checksumSha256) {
        throw new Error(
          `Checksum mismatch on putObject for ${input.bucket}/${input.key}: expected ${input.checksumSha256}, calculated ${computed}`
        );
      }
      metadata["checksum-sha256"] = input.checksumSha256;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      })
    );

    return {
      bucket: input.bucket,
      key: input.key
    };
  }

  async getObject(
    locator: ObjectLocator,
    options?: GetObjectOptions
  ): Promise<StoredObject | undefined> {
    let response;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: locator.bucket,
          Key: locator.key
        })
      );
    } catch (error: unknown) {
      if (isMissingKeyError(error)) {
        return undefined;
      }
      throw error;
    }

    if (
      options?.maxBytes !== undefined &&
      response.ContentLength !== undefined &&
      response.ContentLength > options.maxBytes
    ) {
      if (
        response.Body &&
        typeof (response.Body as { destroy?: () => void }).destroy === "function"
      ) {
        try {
          (response.Body as { destroy: () => void }).destroy();
        } catch {
          // ignore destroy errors
        }
      }
      throw new Error(
        `Object ${locator.bucket}/${locator.key} ContentLength (${response.ContentLength}) exceeds maxBytes limit (${options.maxBytes})`
      );
    }

    const body = await readBodyWithLimit(response.Body, locator, options?.maxBytes);

    const storedChecksum = response.Metadata?.["checksum-sha256"];
    if (storedChecksum !== undefined) {
      const computed = computeSha256Hex(body);
      if (computed !== storedChecksum) {
        throw new Error(
          `Checksum mismatch on getObject for ${locator.bucket}/${locator.key}: stored checksum ${storedChecksum}, calculated ${computed}`
        );
      }
    }

    return {
      bucket: locator.bucket,
      key: locator.key,
      body,
      ...(response.ContentType !== undefined ? { contentType: response.ContentType } : {}),
      ...(storedChecksum !== undefined ? { checksumSha256: storedChecksum } : {})
    };
  }

  async deleteObject(locator: ObjectLocator): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: locator.bucket,
        Key: locator.key
      })
    );
  }
}
