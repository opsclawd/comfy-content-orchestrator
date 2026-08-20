import { describe, expect, it, vi } from "vitest";
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { S3ReviewMediaDelivery } from "./s3-review-media-delivery.js";
import type { PersistentObjectLocator } from "@cco/application";
import { BUCKETS } from "@cco/shared";

describe("S3ReviewMediaDelivery unit tests", () => {
  const sampleLocator: PersistentObjectLocator = {
    bucket: BUCKETS.REVIEW,
    key: "scenes/scene-001/candidate-01.mp4",
    contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  };

  const createMockStorageClient = (sendFn = vi.fn().mockResolvedValue({})) =>
    ({ send: sendFn }) as unknown as S3Client;

  it("sends HeadObjectCommand to storage endpoint before signing GetObjectCommand", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const mockStorageClient = createMockStorageClient(sendFn);

    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      storageClient: mockStorageClient,
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    const url = await delivery.generatePresignedReadUrl(sampleLocator);
    expect(sendFn).toHaveBeenCalledTimes(1);
    const commandArg = sendFn.mock.calls[0]?.[0];
    expect(commandArg).toBeInstanceOf(HeadObjectCommand);
    expect((commandArg as HeadObjectCommand).input).toEqual({
      Bucket: sampleLocator.bucket,
      Key: sampleLocator.key
    });
    expect(url).toContain("storage-01.godzspeed-internal.ts.net");
  });

  it("throws error when target object is absent in storage backend", async () => {
    const notFoundError = new Error("NotFound");
    notFoundError.name = "NotFound";
    const sendFn = vi.fn().mockRejectedValue(notFoundError);
    const mockStorageClient = createMockStorageClient(sendFn);

    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      storageClient: mockStorageClient,
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    await expect(delivery.generatePresignedReadUrl(sampleLocator)).rejects.toThrow("NotFound");
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it("applies default expiry of 300 seconds when expiresInSeconds is undefined", async () => {
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      storageClient: createMockStorageClient(),
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    const url = await delivery.generatePresignedReadUrl(sampleLocator);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("300");
  });

  it("honours custom expiresInSeconds within the 900s ceiling", async () => {
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      storageClient: createMockStorageClient(),
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    const url = await delivery.generatePresignedReadUrl(sampleLocator, 60);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("throws error when expiresInSeconds exceeds 900s ceiling", async () => {
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      storageClient: createMockStorageClient(),
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    await expect(delivery.generatePresignedReadUrl(sampleLocator, 901)).rejects.toThrow(
      /expiresInSeconds exceeds maximum ceiling of 900 seconds/
    );
  });

  it("throws error when expiresInSeconds is zero or negative", async () => {
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
      storageClient: createMockStorageClient(),
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    await expect(delivery.generatePresignedReadUrl(sampleLocator, 0)).rejects.toThrow(
      /expiresInSeconds must be a positive integer/
    );
    await expect(delivery.generatePresignedReadUrl(sampleLocator, -10)).rejects.toThrow(
      /expiresInSeconds must be a positive integer/
    );
  });

  it("generates presigned URL using configured public signing endpoint", async () => {
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "storage-01.godzspeed-internal.ts.net",
      storageClient: createMockStorageClient(),
      credentials: {
        accessKeyId: "test-key",
        secretAccessKey: "test-secret"
      }
    });

    const url = await delivery.generatePresignedReadUrl(sampleLocator);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("storage-01.godzspeed-internal.ts.net");
    expect(parsed.pathname).toBe(`/${BUCKETS.REVIEW}/scenes/scene-001/candidate-01.mp4`);
  });
});
