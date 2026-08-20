import { describe, expect, it } from "vitest";
import { S3ReviewMediaDelivery } from "./s3-review-media-delivery.js";
import type { PersistentObjectLocator } from "@cco/application";
import { BUCKETS } from "@cco/shared";

describe("S3ReviewMediaDelivery unit tests", () => {
  const sampleLocator: PersistentObjectLocator = {
    bucket: BUCKETS.REVIEW,
    key: "scenes/scene-001/candidate-01.mp4",
    contentHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  };

  it("applies default expiry of 300 seconds when expiresInSeconds is undefined", async () => {
    const delivery = new S3ReviewMediaDelivery({
      signingEndpoint: "https://storage-01.godzspeed-internal.ts.net",
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
