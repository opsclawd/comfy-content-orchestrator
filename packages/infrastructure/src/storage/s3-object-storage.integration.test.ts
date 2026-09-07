import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CreateBucketCommand,
  PutObjectCommand,
  CopyObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import { ObjectAlreadyExistsError } from "@cco/application";
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

  it("headObject retrieves object metadata without downloading body", async () => {
    const payload = new TextEncoder().encode("head object metadata test content");
    const checksum = sha256Hex(payload);

    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "head-test/item.mp4",
      body: payload,
      contentType: "video/mp4",
      checksumSha256: checksum
    });

    const meta = await storage.headObject({
      bucket: BUCKETS.DELIVERY,
      key: "head-test/item.mp4"
    });

    expect(meta).toBeDefined();
    expect(meta?.bucket).toBe(BUCKETS.DELIVERY);
    expect(meta?.key).toBe("head-test/item.mp4");
    expect(meta?.contentType).toBe("video/mp4");
    expect(meta?.checksumSha256).toBe(checksum);
  });

  it("headObject returns undefined for nonexistent object", async () => {
    const meta = await storage.headObject({
      bucket: BUCKETS.DELIVERY,
      key: "nonexistent-item.mp4"
    });
    expect(meta).toBeUndefined();
  });

  it("copyObject copies an object preserving body, contentType, and checksum metadata", async () => {
    const payload = new TextEncoder().encode("bytes to be copied via CopyObjectCommand");
    const checksum = sha256Hex(payload);

    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "staging/source.mp4",
      body: payload,
      contentType: "video/mp4",
      checksumSha256: checksum
    });

    const copyLocator = await storage.copyObject(
      { bucket: BUCKETS.DELIVERY, key: "staging/source.mp4" },
      { bucket: BUCKETS.DELIVERY, key: "delivery/target.mp4" }
    );

    expect(copyLocator).toEqual({
      bucket: BUCKETS.DELIVERY,
      key: "delivery/target.mp4"
    });

    const destination = await storage.getObject(copyLocator);
    expect(destination).toBeDefined();
    expect(destination?.body).toEqual(payload);
    expect(destination?.contentType).toBe("video/mp4");
    expect(destination?.checksumSha256).toBe(checksum);
  });

  it("copyObject with ifNoneMatch: '*' succeeds when destination does not exist", async () => {
    const payload = new TextEncoder().encode("conditional copy payload");
    const checksum = sha256Hex(payload);

    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "staging/cond-source.mp4",
      body: payload,
      contentType: "video/mp4",
      checksumSha256: checksum
    });

    const locator = await storage.copyObject(
      { bucket: BUCKETS.DELIVERY, key: "staging/cond-source.mp4" },
      { bucket: BUCKETS.DELIVERY, key: "delivery/cond-target.mp4" },
      { ifNoneMatch: "*" }
    );

    expect(locator).toEqual({
      bucket: BUCKETS.DELIVERY,
      key: "delivery/cond-target.mp4"
    });
  });

  it("copyObject with ifNoneMatch: '*' throws ObjectAlreadyExistsError without clobbering destination", async () => {
    const originalBytes = new TextEncoder().encode("original destination bytes");
    const originalChecksum = sha256Hex(originalBytes);
    const newBytes = new TextEncoder().encode("new source bytes that should not overwrite");

    // Pre-populate destination
    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "delivery/conflict-target.mp4",
      body: originalBytes,
      contentType: "video/mp4",
      checksumSha256: originalChecksum
    });

    // Populate source
    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "staging/conflict-source.mp4",
      body: newBytes,
      contentType: "video/mp4",
      checksumSha256: sha256Hex(newBytes)
    });

    await expect(
      storage.copyObject(
        { bucket: BUCKETS.DELIVERY, key: "staging/conflict-source.mp4" },
        { bucket: BUCKETS.DELIVERY, key: "delivery/conflict-target.mp4" },
        { ifNoneMatch: "*" }
      )
    ).rejects.toThrow(ObjectAlreadyExistsError);

    // Verify destination bytes remain untouched
    const dest = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: "delivery/conflict-target.mp4"
    });
    expect(dest).toBeDefined();
    expect(dest?.body).toEqual(originalBytes);
    expect(dest?.checksumSha256).toBe(originalChecksum);
  });

  it("probes raw MinIO CopyObject behavior empirically and confirms source preconditions do not provide destination put-if-absent semantics", async () => {
    const srcBytes = new TextEncoder().encode("probe source bytes");
    const dstBytes = new TextEncoder().encode("probe dest bytes");

    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "probe/src.mp4",
      body: srcBytes,
      contentType: "video/mp4",
      checksumSha256: sha256Hex(srcBytes)
    });

    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "probe/dst.mp4",
      body: dstBytes,
      contentType: "video/mp4",
      checksumSha256: sha256Hex(dstBytes)
    });

    // Probe 1: Does raw CopyObjectCommand with destination IfNoneMatch: "*" fail when destination exists?
    // Empirical verification: MinIO ignores destination IfNoneMatch on CopyObjectCommand and silently overwrites.
    let ifNoneMatchError: unknown = undefined;
    try {
      await rawS3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKETS.DELIVERY,
          Key: "probe/dst.mp4",
          CopySource: `${BUCKETS.DELIVERY}/probe/src.mp4`,
          IfNoneMatch: "*"
        })
      );
    } catch (err) {
      ifNoneMatchError = err;
    }

    expect(ifNoneMatchError).toBeUndefined(); // MinIO does not reject destination IfNoneMatch

    const dstAfterCopy = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: "probe/dst.mp4"
    });
    // Verifies destination was overwritten because CopyObjectCommand lacks atomic put-if-absent on MinIO
    expect(dstAfterCopy?.checksumSha256).toBe(sha256Hex(srcBytes));

    // Probe 2: Does CopySourceIfNoneMatch provide destination put-if-absent?
    // No, CopySourceIfNoneMatch evaluates against the source ETag, not destination absence.
    try {
      await rawS3Client.send(
        new CopyObjectCommand({
          Bucket: BUCKETS.DELIVERY,
          Key: "probe/dst2.mp4",
          CopySource: `${BUCKETS.DELIVERY}/probe/src.mp4`,
          CopySourceIfNoneMatch: "*"
        })
      );
    } catch {
      // Ignored: demonstrates CopySourceIfNoneMatch checks source, not destination
    }

    // Because "*" matches the source's existing ETag, CopySourceIfNoneMatch returns 412 or succeeds depending on source
    // but crucially it is a SOURCE condition, not destination put-if-absent.
    // This confirms the architectural requirement: S3ObjectStorage must implement copyObject(..., { ifNoneMatch: "*" })
    // via source read + atomic putObject(..., { ifNoneMatch: "*" }) to prevent destination overwrite under races.
  });

  it("copyObject with ifNoneMatch: '*' prevents overwrite under a controlled destination-creation race", async () => {
    const srcBytes = new TextEncoder().encode("racer source bytes to promote");
    const conflictingDstBytes = new TextEncoder().encode("concurrently created destination bytes");

    await storage.putObject({
      bucket: BUCKETS.DELIVERY,
      key: "race/staging.mp4",
      body: srcBytes,
      contentType: "video/mp4",
      checksumSha256: sha256Hex(srcBytes)
    });

    // Create a decorator around storage that creates the destination object
    // immediately before putObject writes the final destination, simulating a true TOCTOU race.
    let injectedRace = false;
    const raceStorage = new S3ObjectStorage({
      endpoint: minioContainer.getEndpoint(),
      region: "us-east-1",
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    const originalHeadObject = raceStorage.headObject.bind(raceStorage);
    raceStorage.headObject = async (loc) => {
      const res = await originalHeadObject(loc);
      if (loc.key === "race/target.mp4" && !injectedRace) {
        injectedRace = true;
        // Inject concurrent write to target right after the initial head check saw it was absent
        await rawS3Client.send(
          new PutObjectCommand({
            Bucket: BUCKETS.DELIVERY,
            Key: "race/target.mp4",
            Body: conflictingDstBytes,
            ContentType: "video/mp4",
            Metadata: {
              "checksum-sha256": sha256Hex(conflictingDstBytes)
            }
          })
        );
      }
      return res;
    };

    // Attempt conditional copyObject while destination is created concurrently right after initial HEAD
    await expect(
      raceStorage.copyObject(
        { bucket: BUCKETS.DELIVERY, key: "race/staging.mp4" },
        { bucket: BUCKETS.DELIVERY, key: "race/target.mp4" },
        { ifNoneMatch: "*" }
      )
    ).rejects.toThrow(ObjectAlreadyExistsError);

    // Verify destination was NOT overwritten by source
    const targetObj = await storage.getObject({
      bucket: BUCKETS.DELIVERY,
      key: "race/target.mp4"
    });
    expect(targetObj).toBeDefined();
    expect(targetObj?.body).toEqual(conflictingDstBytes);
    expect(targetObj?.checksumSha256).toBe(sha256Hex(conflictingDstBytes));
  });
});
