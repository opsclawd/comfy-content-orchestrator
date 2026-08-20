import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  GetBucketLifecycleConfigurationCommand
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { BUCKETS } from "@cco/shared";
import {
  provisionStorageBuckets,
  readBucketLifecycleConfiguration,
  evaluateLifecycleEligibility
} from "./provisioner.js";
import { startMinioContainer, type StartedMinioContainer } from "./test-support/minio.js";

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("Storage Provisioning integration with real MinIO", () => {
  let minioContainer: StartedMinioContainer;
  let rawS3Client: S3Client;

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
  }, 120_000);

  afterAll(async () => {
    rawS3Client?.destroy();
    if (minioContainer) {
      await minioContainer.stop();
    }
  });

  it("provisions all four buckets and is idempotent on repeat execution", async () => {
    // 1. Initial provisioning on clean MinIO container
    const initialSummary = await provisionStorageBuckets({
      client: rawS3Client
    });

    expect(initialSummary.results).toHaveLength(4);
    expect(initialSummary.createdCount).toBe(4);
    expect(initialSummary.alreadyExistsCount).toBe(0);
    expect(initialSummary.lifecycleAppliedCount).toBe(2); // temp (14d) and review (60d)
    expect(initialSummary.lifecycleSkippedCount).toBe(2); // reference and delivery

    // 2. Second provisioning run against already provisioned buckets
    const repeatSummary = await provisionStorageBuckets({
      client: rawS3Client
    });

    expect(repeatSummary.results).toHaveLength(4);
    expect(repeatSummary.createdCount).toBe(0);
    expect(repeatSummary.alreadyExistsCount).toBe(4);
    expect(repeatSummary.lifecycleAppliedCount).toBe(2);
    expect(repeatSummary.lifecycleSkippedCount).toBe(2);
  });

  it("reads back live lifecycle configurations and asserts matching rules from the bucket", async () => {
    // Ensure prerequisite buckets are provisioned for test isolation
    await provisionStorageBuckets({ client: rawS3Client });

    // 1. Assert godzspeed-temp has 14-day expiry rule live on bucket
    const tempConfig = await readBucketLifecycleConfiguration(rawS3Client, BUCKETS.TEMP);
    expect(tempConfig).toBeDefined();
    expect(tempConfig?.Rules).toBeDefined();
    expect(tempConfig?.Rules?.length).toBeGreaterThanOrEqual(1);

    const tempRule = tempConfig?.Rules?.find((r) => r.ID === "godzspeed-temp-retention-14d");
    expect(tempRule).toBeDefined();
    expect(tempRule?.Status).toBe("Enabled");
    expect(tempRule?.Expiration?.Days).toBe(14);

    // Also assert directly using GetBucketLifecycleConfigurationCommand
    const rawTempRes = await rawS3Client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKETS.TEMP })
    );
    expect(rawTempRes.Rules?.[0]?.Expiration?.Days).toBe(14);
    expect(rawTempRes.Rules?.[0]?.Status).toBe("Enabled");

    // 2. Assert godzspeed-review has 60-day expiry rule live on bucket
    const reviewConfig = await readBucketLifecycleConfiguration(rawS3Client, BUCKETS.REVIEW);
    expect(reviewConfig).toBeDefined();
    expect(reviewConfig?.Rules).toBeDefined();

    const reviewRule = reviewConfig?.Rules?.find((r) => r.ID === "godzspeed-review-retention-60d");
    expect(reviewRule).toBeDefined();
    expect(reviewRule?.Status).toBe("Enabled");
    expect(reviewRule?.Expiration?.Days).toBe(60);

    const rawReviewRes = await rawS3Client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKETS.REVIEW })
    );
    expect(rawReviewRes.Rules?.[0]?.Expiration?.Days).toBe(60);
    expect(rawReviewRes.Rules?.[0]?.Status).toBe("Enabled");

    // 3. Assert godzspeed-reference has NO automated expiry rule (deliberate assertion)
    const refConfig = await readBucketLifecycleConfiguration(rawS3Client, BUCKETS.REFERENCE);
    expect(refConfig).toBeUndefined();

    // 4. Assert godzspeed-delivery has NO automated upload-age expiry rule (deliberate assertion)
    const deliveryConfig = await readBucketLifecycleConfiguration(rawS3Client, BUCKETS.DELIVERY);
    expect(deliveryConfig).toBeUndefined();
  });

  it("proves provisioning is non-destructive when buckets contain objects", async () => {
    // Ensure prerequisite buckets are provisioned before placing test payload
    await provisionStorageBuckets({ client: rawS3Client });

    const payload = new TextEncoder().encode("active review candidate stream data");
    const testKey = "safety-test/candidate-01.mp4";

    // 1. Put object in review bucket
    await rawS3Client.send(
      new PutObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: testKey,
        Body: payload,
        ContentType: "video/mp4"
      })
    );

    // 2. Re-run provisioning
    const summary = await provisionStorageBuckets({ client: rawS3Client });
    expect(summary.alreadyExistsCount).toBe(4);

    // 3. Read back object and verify byte integrity
    const getRes = await rawS3Client.send(
      new GetObjectCommand({
        Bucket: BUCKETS.REVIEW,
        Key: testKey
      })
    );
    const retrievedBytes = getRes.Body
      ? await getRes.Body.transformToByteArray()
      : new Uint8Array();
    expect(sha256Hex(retrievedBytes)).toBe(sha256Hex(payload));
  });

  it("satisfies Storage Lifecycle Gate (PRD §9.4) by demonstrating deletion eligibility", () => {
    // Temp bucket objects (14 days)
    const freshTemp = evaluateLifecycleEligibility({ bucket: BUCKETS.TEMP, objectAgeDays: 5 });
    expect(freshTemp.isEligibleForDeletion).toBe(false);

    const expiredTemp = evaluateLifecycleEligibility({ bucket: BUCKETS.TEMP, objectAgeDays: 14 });
    expect(expiredTemp.isEligibleForDeletion).toBe(true);

    // Review bucket objects (60 days)
    const freshReview = evaluateLifecycleEligibility({ bucket: BUCKETS.REVIEW, objectAgeDays: 45 });
    expect(freshReview.isEligibleForDeletion).toBe(false);

    const expiredReview = evaluateLifecycleEligibility({
      bucket: BUCKETS.REVIEW,
      objectAgeDays: 60
    });
    expect(expiredReview.isEligibleForDeletion).toBe(true);

    // Reference bucket (no automated expiry)
    const referenceObject = evaluateLifecycleEligibility({
      bucket: BUCKETS.REFERENCE,
      objectAgeDays: 200
    });
    expect(referenceObject.isEligibleForDeletion).toBe(false);

    // Delivery bucket (no naive upload expiry)
    const deliveryObject = evaluateLifecycleEligibility({
      bucket: BUCKETS.DELIVERY,
      objectAgeDays: 200
    });
    expect(deliveryObject.isEligibleForDeletion).toBe(false);
  });
});
