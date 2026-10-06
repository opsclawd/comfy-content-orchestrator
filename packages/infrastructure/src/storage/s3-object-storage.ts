import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import {
  type CopyObjectOptions,
  type GetObjectOptions,
  type HeadObjectResult,
  type ObjectLocator,
  type ObjectStoragePort,
  ObjectAlreadyExistsError,
  type PutObjectInput,
  type StoredObject
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
  maxBytes?: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (signal?.aborted) {
    throw signal.reason ?? new Error("Aborted");
  }

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

    let onAbort: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          onAbort = () => {
            if (typeof stream.destroy === "function") {
              try {
                stream.destroy(signal.reason ?? new Error("Aborted"));
              } catch {
                // ignore destroy errors
              }
            }
            reject(signal.reason ?? new Error("Aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        })
      : undefined;

    const iterator = stream[Symbol.asyncIterator]();
    try {
      while (true) {
        if (signal?.aborted) {
          throw signal.reason ?? new Error("Aborted");
        }
        const nextPromise = iterator.next();
        const iterResult = abortPromise
          ? await Promise.race([nextPromise, abortPromise])
          : await nextPromise;
        if (iterResult.done) {
          break;
        }
        const rawChunk = iterResult.value;
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
          stream.destroy(err instanceof Error ? err : undefined);
        } catch {
          // ignore destroy errors
        }
      }
      if (signal?.aborted) {
        throw signal.reason ?? (err instanceof Error ? err : new Error("Aborted"));
      }
      throw err;
    } finally {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
      if (typeof iterator.return === "function") {
        try {
          await iterator.return();
        } catch {
          // ignore
        }
      }
    }

    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted");
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
    const streamBody = body as {
      transformToByteArray: () => Promise<Uint8Array>;
      destroy?: (error?: Error) => void;
    };

    if (signal?.aborted) {
      if (typeof streamBody.destroy === "function") {
        try {
          streamBody.destroy(signal.reason ?? new Error("Aborted"));
        } catch {
          // ignore destroy errors
        }
      }
      throw signal.reason ?? new Error("Aborted");
    }

    let onAbort: (() => void) | undefined;
    const abortPromise = signal
      ? new Promise<never>((_, reject) => {
          onAbort = () => {
            if (typeof streamBody.destroy === "function") {
              try {
                streamBody.destroy(signal.reason ?? new Error("Aborted"));
              } catch {
                // ignore destroy errors
              }
            }
            reject(signal.reason ?? new Error("Aborted"));
          };
          signal.addEventListener("abort", onAbort, { once: true });
        })
      : undefined;

    let bytes: Uint8Array;
    try {
      bytes = abortPromise
        ? await Promise.race([streamBody.transformToByteArray(), abortPromise])
        : await streamBody.transformToByteArray();
    } catch (err) {
      if (typeof streamBody.destroy === "function") {
        try {
          streamBody.destroy(err instanceof Error ? err : undefined);
        } catch {
          // ignore destroy errors
        }
      }
      if (signal?.aborted) {
        throw signal.reason ?? (err instanceof Error ? err : new Error("Aborted"));
      }
      throw err;
    } finally {
      if (signal && onAbort) {
        signal.removeEventListener("abort", onAbort);
      }
    }

    if (signal?.aborted) {
      throw signal.reason ?? new Error("Aborted");
    }

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

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          IfNoneMatch: input.ifNoneMatch
        })
      );
    } catch (err: unknown) {
      const errorObj = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        errorObj?.name === "PreconditionFailed" ||
        errorObj?.$metadata?.httpStatusCode === 412 ||
        errorObj?.name === "ConditionalRequestConflict" ||
        errorObj?.$metadata?.httpStatusCode === 409
      ) {
        throw new ObjectAlreadyExistsError(input.bucket, input.key, { cause: err as Error });
      }
      throw err;
    }

    return {
      bucket: input.bucket,
      key: input.key
    };
  }

  async getObject(
    locator: ObjectLocator,
    options?: GetObjectOptions
  ): Promise<StoredObject | undefined> {
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new Error("Aborted");
    }

    let response;
    try {
      response = await this.client.send(
        new GetObjectCommand({
          Bucket: locator.bucket,
          Key: locator.key
        }),
        options?.signal ? { abortSignal: options.signal } : undefined
      );
    } catch (error: unknown) {
      if (options?.signal?.aborted) {
        throw options.signal.reason ?? error;
      }
      if (isMissingKeyError(error)) {
        return undefined;
      }
      throw error;
    }

    if (options?.signal?.aborted) {
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
      throw options.signal.reason ?? new Error("Aborted");
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

    const body = await readBodyWithLimit(
      response.Body,
      locator,
      options?.maxBytes,
      options?.signal
    );

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

  async headObject(locator: ObjectLocator): Promise<HeadObjectResult | undefined> {
    let response;
    try {
      response = await this.client.send(
        new HeadObjectCommand({
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

    const storedChecksum = response.Metadata?.["checksum-sha256"];
    return {
      bucket: locator.bucket,
      key: locator.key,
      ...(storedChecksum !== undefined ? { checksumSha256: storedChecksum } : {}),
      ...(response.ContentType !== undefined ? { contentType: response.ContentType } : {})
    };
  }

  async copyObject(
    from: ObjectLocator,
    to: ObjectLocator,
    options?: CopyObjectOptions
  ): Promise<ObjectLocator> {
    if (options?.ifNoneMatch === "*") {
      const existing = await this.headObject(to);
      if (existing) {
        throw new ObjectAlreadyExistsError(to.bucket, to.key);
      }

      // MinIO and S3 do not provide atomic destination put-if-absent on CopyObjectCommand.
      // To prevent TOCTOU race and ensure atomicity, read source and write via putObject with ifNoneMatch: "*".
      const source = await this.getObject(from);
      if (!source) {
        throw new Error(`Source object not found: ${from.bucket}/${from.key}`);
      }

      const destinationCheck = await this.headObject(to);
      if (destinationCheck) {
        throw new ObjectAlreadyExistsError(to.bucket, to.key);
      }

      return this.putObject({
        bucket: to.bucket,
        key: to.key,
        body: source.body,
        ifNoneMatch: "*",
        ...(source.contentType !== undefined ? { contentType: source.contentType } : {}),
        ...(source.checksumSha256 !== undefined ? { checksumSha256: source.checksumSha256 } : {})
      });
    }

    const copySource = `${from.bucket}/${encodeURI(from.key)}`;

    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: to.bucket,
          Key: to.key,
          CopySource: copySource
        })
      );
    } catch (err: unknown) {
      const errorObj = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        errorObj?.name === "PreconditionFailed" ||
        errorObj?.$metadata?.httpStatusCode === 412 ||
        errorObj?.name === "ConditionalRequestConflict" ||
        errorObj?.$metadata?.httpStatusCode === 409
      ) {
        throw new ObjectAlreadyExistsError(to.bucket, to.key, { cause: err as Error });
      }
      throw err;
    }

    return {
      bucket: to.bucket,
      key: to.key
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
