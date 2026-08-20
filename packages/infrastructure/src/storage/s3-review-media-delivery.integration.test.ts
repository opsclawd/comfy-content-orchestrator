import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { BUCKETS, BUCKET_NAMES } from "@cco/shared";
import { S3ReviewMediaDelivery } from "./s3-review-media-delivery.js";
import { startMinioContainer, type StartedMinioContainer } from "./test-support/minio.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("S3ReviewMediaDelivery integration with real MinIO", () => {
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;
  let delivery: S3ReviewMediaDelivery;

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

    delivery = new S3ReviewMediaDelivery({
      signingEndpoint: minioContainer.getEndpoint(),
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

  it("fetches exact stored object bytes over HTTP using presigned URL without credentials", async () => {
    const payload = new TextEncoder().encode("review media artifact video binary payload 12345");
    const checksum = sha256Hex(payload);
    const key = "candidates/scene-001/candidate-01.mp4";

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: key,
        Body: payload,
        ContentType: "video/mp4"
      })
    );

    const presignedUrl = await delivery.generatePresignedReadUrl({
      bucket: BUCKETS.REVIEW,
      key,
      contentHash: checksum
    });

    expect(presignedUrl).toContain(minioContainer.getEndpoint());

    const response = await fetch(presignedUrl);
    expect(response.status).toBe(200);
    const arrayBuffer = await response.arrayBuffer();
    const fetchedBytes = new Uint8Array(arrayBuffer);
    expect(fetchedBytes).toEqual(payload);
  });

  it("succeeds before expiry and returns 403 Forbidden after expiry", async () => {
    const payload = new TextEncoder().encode("expiring media bytes test");
    const checksum = sha256Hex(payload);
    const key = "candidates/scene-001/short-lived-candidate.mp4";

    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: key,
        Body: payload,
        ContentType: "video/mp4"
      })
    );

    const shortExpirySeconds = 2;
    const presignedUrl = await delivery.generatePresignedReadUrl(
      {
        bucket: BUCKETS.REVIEW,
        key,
        contentHash: checksum
      },
      shortExpirySeconds
    );

    // Immediate fetch: must succeed with 200 OK and exact bytes
    const immediateResponse = await fetch(presignedUrl);
    expect(immediateResponse.status).toBe(200);
    const immediateBytes = new Uint8Array(await immediateResponse.arrayBuffer());
    expect(immediateBytes).toEqual(payload);

    // Wait past expiry duration (3.5 seconds)
    await sleep(3500);

    // Expired fetch: must fail with 403 Forbidden
    const expiredResponse = await fetch(presignedUrl);
    expect(expiredResponse.status).toBe(403);
  });

  it("signs presigned URLs with injected tailnet hostname independently from storage endpoint", async () => {
    const tailnetEndpoint = "https://storage-01.godzspeed-internal.ts.net";
    const tailnetDelivery = new S3ReviewMediaDelivery({
      signingEndpoint: tailnetEndpoint,
      credentials: {
        accessKeyId: minioContainer.getAccessKey(),
        secretAccessKey: minioContainer.getSecretKey()
      },
      forcePathStyle: true
    });

    const presignedUrl = await tailnetDelivery.generatePresignedReadUrl({
      bucket: BUCKETS.REVIEW,
      key: "candidates/scene-002/variant-01.mp4",
      contentHash: "dummy-hash"
    });

    const parsed = new URL(presignedUrl);
    expect(parsed.hostname).toBe("storage-01.godzspeed-internal.ts.net");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.pathname).toBe(`/${BUCKETS.REVIEW}/candidates/scene-002/variant-01.mp4`);
  });
});
