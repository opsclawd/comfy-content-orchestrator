import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import { S3ObjectStorage } from "./s3-object-storage.js";
import { startMinioContainer, type StartedMinioContainer } from "./test-support/minio.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("S3ObjectStorage integration with real MinIO", () => {
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let storage: S3ObjectStorage;

  beforeAll(async () => {
    minioContainer = await startMinioContainer();
    rawS3Client = new S3Client({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    // Provision test buckets defined in shared constants
    for (const bucket of BUCKET_NAMES) {
      try {
        await rawS3Client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err: unknown) {
        const errorName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name: unknown }).name)
            : "";
        if (errorName !== "BucketAlreadyExists" && errorName !== "BucketAlreadyOwnedByYou") {
          throw err;
        }
      }
    }

    storage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });
  }, 120_000);

  afterAll(async () => {
    rawS3Client?.destroy();
    if (minioContainer) {
      await minioContainer.stop();
    }
  });

  it("stores and retrieves object with identical bytes, content type, and checksum metadata", async () => {
    const payload = new TextEncoder().encode("hello world render candidate 42");
    const checksum = sha256Hex(payload);

    const locator = await storage.putObject({
      bucket: BUCKETS.REVIEW,
      key: "scenes/scene-001/candidate-01.mp4",
      body: payload,
      contentType: "video/mp4",
      checksumSha256: checksum
    });

    expect(locator).toEqual({
      bucket: BUCKETS.REVIEW,
      key: "scenes/scene-001/candidate-01.mp4"
    });

    const retrieved = await storage.getObject(locator);
    expect(retrieved).toBeDefined();
    expect(retrieved?.bucket).toBe(BUCKETS.REVIEW);
    expect(retrieved?.key).toBe("scenes/scene-001/candidate-01.mp4");
    expect(retrieved?.body).toEqual(payload);
    expect(retrieved?.contentType).toBe("video/mp4");
    expect(retrieved?.checksumSha256).toBe(checksum);
  });

  it("returns undefined when key does not exist", async () => {
    const missing = await storage.getObject({
      bucket: BUCKETS.TEMP,
      key: "nonexistent/file.bin"
    });

    expect(missing).toBeUndefined();
  });

  it("throws when checksumSha256 provided to putObject does not match body SHA-256", async () => {
    const payload = new Uint8Array([10, 20, 30, 40]);
    const badChecksum = "0000000000000000000000000000000000000000000000000000000000000000";

    await expect(
      storage.putObject({
        bucket: BUCKETS.TEMP,
        key: "corrupt/put-test.bin",
        body: payload,
        checksumSha256: badChecksum
      })
    ).rejects.toThrow(/Checksum mismatch on putObject/);
  });

  it("throws when retrieved object bytes do not match stored checksum metadata", async () => {
    const key = "corrupt/get-test.bin";
    const corruptedPayload = new Uint8Array([99, 88, 77]);
    const fakeChecksum = "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

    // Direct write using raw SDK to simulate byte corruption under valid metadata
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.TEMP,
        Key: key,
        Body: corruptedPayload,
        Metadata: {
          "checksum-sha256": fakeChecksum
        }
      })
    );

    await expect(
      storage.getObject({
        bucket: BUCKETS.TEMP,
        key
      })
    ).rejects.toThrow(/Checksum mismatch on getObject/);
  });

  it("throws on transport or authentication failure", async () => {
    const badCredsStorage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: "invalid_key",
        secretAccessKey: "invalid_secret"
      },
      forcePathStyle: true
    });

    await expect(
      badCredsStorage.putObject({
        bucket: BUCKETS.TEMP,
        key: "auth-test.bin",
        body: new Uint8Array([1, 2, 3])
      })
    ).rejects.toThrow();

    const badEndpointStorage = new S3ObjectStorage({
      endpoint: "http://127.0.0.1:59999",
      region: "us-east-1",
      credentials: {
        accessKeyId: "minioadmin",
        secretAccessKey: "minioadmin"
      },
      forcePathStyle: true
    });

    await expect(
      badEndpointStorage.getObject({
        bucket: BUCKETS.TEMP,
        key: "unreachable.bin"
      })
    ).rejects.toThrow();
  });

  it("operates independently with constructor-injected endpoints", async () => {
    const storageA = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    const storageB = new S3ObjectStorage({
      endpoint: "http://127.0.0.1:59998",
      credentials: {
        accessKeyId: "test",
        secretAccessKey: "test"
      },
      forcePathStyle: true
    });

    // storageA connects and returns undefined for missing key
    const resA = await storageA.getObject({
      bucket: BUCKETS.DELIVERY,
      key: "independent-test.bin"
    });
    expect(resA).toBeUndefined();

    // storageB fails connecting to invalid endpoint
    await expect(
      storageB.getObject({
        bucket: BUCKETS.DELIVERY,
        key: "independent-test.bin"
      })
    ).rejects.toThrow();
  });
});
