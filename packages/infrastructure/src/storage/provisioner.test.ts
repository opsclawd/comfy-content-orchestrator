import { describe, expect, it, vi } from "vitest";
import {
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  type S3Client
} from "@aws-sdk/client-s3";
import {
  provisionBucket,
  provisionStorageBuckets,
  evaluateLifecycleEligibility,
  readBucketLifecycleConfiguration
} from "./provisioner.js";
import { BUCKETS } from "@cco/shared";

describe("Storage Provisioner unit tests", () => {
  const createMockS3Client = (sendFn = vi.fn().mockResolvedValue({})) =>
    ({ send: sendFn }) as unknown as S3Client;

  it("creates missing bucket and applies 14-day lifecycle for temp bucket", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const client = createMockS3Client(sendFn);

    const result = await provisionBucket(client, BUCKETS.TEMP);

    expect(result.bucket).toBe(BUCKETS.TEMP);
    expect(result.bucketStatus).toBe("created");
    expect(result.lifecycleStatus).toBe("applied");
    expect(result.expirationDays).toBe(14);
    expect(result.ruleId).toBe("godzspeed-temp-retention-14d");

    expect(sendFn).toHaveBeenCalledTimes(2);
    const createCmd = sendFn.mock.calls[0]?.[0];
    expect(createCmd).toBeInstanceOf(CreateBucketCommand);
    expect((createCmd as CreateBucketCommand).input.Bucket).toBe(BUCKETS.TEMP);

    const lifecycleCmd = sendFn.mock.calls[1]?.[0];
    expect(lifecycleCmd).toBeInstanceOf(PutBucketLifecycleConfigurationCommand);
    const lifecycleInput = (lifecycleCmd as PutBucketLifecycleConfigurationCommand).input;
    expect(lifecycleInput.Bucket).toBe(BUCKETS.TEMP);
    expect(lifecycleInput.LifecycleConfiguration?.Rules?.[0]?.Expiration?.Days).toBe(14);
    expect(lifecycleInput.LifecycleConfiguration?.Rules?.[0]?.Status).toBe("Enabled");
  });

  it("creates missing bucket and applies 60-day lifecycle for review bucket", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const client = createMockS3Client(sendFn);

    const result = await provisionBucket(client, BUCKETS.REVIEW);

    expect(result.bucket).toBe(BUCKETS.REVIEW);
    expect(result.bucketStatus).toBe("created");
    expect(result.lifecycleStatus).toBe("applied");
    expect(result.expirationDays).toBe(60);
    expect(result.ruleId).toBe("godzspeed-review-retention-60d");

    expect(sendFn).toHaveBeenCalledTimes(2);
    const lifecycleCmd = sendFn.mock.calls[1]?.[0];
    expect(lifecycleCmd).toBeInstanceOf(PutBucketLifecycleConfigurationCommand);
    expect(
      (lifecycleCmd as PutBucketLifecycleConfigurationCommand).input.LifecycleConfiguration
        ?.Rules?.[0]?.Expiration?.Days
    ).toBe(60);
  });

  it("creates bucket but skips lifecycle configuration for reference and delivery buckets", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const client = createMockS3Client(sendFn);

    const refResult = await provisionBucket(client, BUCKETS.REFERENCE);
    expect(refResult.bucketStatus).toBe("created");
    expect(refResult.lifecycleStatus).toBe("skipped");
    expect(sendFn).toHaveBeenCalledTimes(1); // Only CreateBucketCommand, no PutBucketLifecycle

    sendFn.mockClear();

    const delResult = await provisionBucket(client, BUCKETS.DELIVERY);
    expect(delResult.bucketStatus).toBe("created");
    expect(delResult.lifecycleStatus).toBe("skipped");
    expect(sendFn).toHaveBeenCalledTimes(1); // Only CreateBucketCommand, no PutBucketLifecycle
  });

  it("handles BucketAlreadyOwnedByYou or BucketAlreadyExists gracefully as idempotent no-op", async () => {
    const alreadyOwnedError = new Error("BucketAlreadyOwnedByYou");
    alreadyOwnedError.name = "BucketAlreadyOwnedByYou";

    const sendFn = vi.fn().mockImplementation((command) => {
      if (command instanceof CreateBucketCommand) {
        return Promise.reject(alreadyOwnedError);
      }
      return Promise.resolve({});
    });
    const client = createMockS3Client(sendFn);

    const result = await provisionBucket(client, BUCKETS.TEMP);
    expect(result.bucketStatus).toBe("already_exists");
    expect(result.lifecycleStatus).toBe("applied");

    const alreadyExistsError = new Error("BucketAlreadyExists");
    alreadyExistsError.name = "BucketAlreadyExists";

    const sendFnExists = vi.fn().mockImplementation((command) => {
      if (command instanceof CreateBucketCommand) {
        return Promise.reject(alreadyExistsError);
      }
      return Promise.resolve({});
    });
    const clientExists = createMockS3Client(sendFnExists);

    const resultExists = await provisionBucket(clientExists, BUCKETS.TEMP);
    expect(resultExists.bucketStatus).toBe("already_exists");
    expect(resultExists.lifecycleStatus).toBe("applied");
  });

  it("re-throws unexpected S3 client errors during bucket creation", async () => {
    const networkError = new Error("Network timeout");
    networkError.name = "TimeoutError";

    const sendFn = vi.fn().mockRejectedValue(networkError);
    const client = createMockS3Client(sendFn);

    await expect(provisionBucket(client, BUCKETS.TEMP)).rejects.toThrow("Network timeout");
  });

  it("provisions all four buckets in provisionStorageBuckets and returns summary", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const client = createMockS3Client(sendFn);

    const summary = await provisionStorageBuckets({ client });

    expect(summary.results).toHaveLength(4);
    expect(summary.createdCount).toBe(4);
    expect(summary.alreadyExistsCount).toBe(0);
    expect(summary.lifecycleAppliedCount).toBe(2); // temp and review
    expect(summary.lifecycleSkippedCount).toBe(2); // reference and delivery
  });

  it("provisions custom bucket subset when options.buckets is specified", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const client = createMockS3Client(sendFn);

    const customBuckets = [BUCKETS.TEMP, BUCKETS.REFERENCE];
    const summary = await provisionStorageBuckets({ client, buckets: customBuckets });

    expect(summary.results).toHaveLength(2);
    expect(summary.createdCount).toBe(2);
    expect(summary.alreadyExistsCount).toBe(0);
    expect(summary.lifecycleAppliedCount).toBe(1);
    expect(summary.lifecycleSkippedCount).toBe(1);
  });

  it("logs provisioning events when logger is provided", async () => {
    const sendFn = vi.fn().mockResolvedValue({});
    const client = createMockS3Client(sendFn);
    const logs: string[] = [];
    const logger = (msg: string) => {
      logs.push(msg);
    };

    await provisionStorageBuckets({ client, logger });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.includes("[provision] Bucket created"))).toBe(true);
  });

  it("evaluates object lifecycle deletion eligibility accurately across all bucket classes", () => {
    // godzspeed-temp (14 days)
    expect(
      evaluateLifecycleEligibility({ bucket: BUCKETS.TEMP, objectAgeDays: 15 })
        .isEligibleForDeletion
    ).toBe(true);
    expect(
      evaluateLifecycleEligibility({ bucket: BUCKETS.TEMP, objectAgeDays: 14 })
        .isEligibleForDeletion
    ).toBe(true);
    expect(
      evaluateLifecycleEligibility({ bucket: BUCKETS.TEMP, objectAgeDays: 13 })
        .isEligibleForDeletion
    ).toBe(false);

    // godzspeed-review (60 days)
    expect(
      evaluateLifecycleEligibility({ bucket: BUCKETS.REVIEW, objectAgeDays: 61 })
        .isEligibleForDeletion
    ).toBe(true);
    expect(
      evaluateLifecycleEligibility({ bucket: BUCKETS.REVIEW, objectAgeDays: 60 })
        .isEligibleForDeletion
    ).toBe(true);
    expect(
      evaluateLifecycleEligibility({ bucket: BUCKETS.REVIEW, objectAgeDays: 59 })
        .isEligibleForDeletion
    ).toBe(false);

    // godzspeed-reference (no automated expiry)
    const refEval = evaluateLifecycleEligibility({ bucket: BUCKETS.REFERENCE, objectAgeDays: 365 });
    expect(refEval.isEligibleForDeletion).toBe(false);
    expect(refEval.reason).toContain("retained while client is active");

    // godzspeed-delivery (no naive upload expiry)
    const delEval = evaluateLifecycleEligibility({ bucket: BUCKETS.DELIVERY, objectAgeDays: 365 });
    expect(delEval.isEligibleForDeletion).toBe(false);
    expect(delEval.reason).toContain("campaign completion");
  });

  it("returns lifecycle configuration when GetBucketLifecycleConfigurationCommand succeeds", async () => {
    const mockRules = [
      {
        ID: "godzspeed-temp-retention-14d",
        Status: "Enabled" as const,
        Expiration: { Days: 14 }
      }
    ];
    const sendFn = vi.fn().mockImplementation((command) => {
      if (command instanceof GetBucketLifecycleConfigurationCommand) {
        expect(command.input.Bucket).toBe(BUCKETS.TEMP);
        return Promise.resolve({ Rules: mockRules });
      }
      return Promise.resolve({});
    });
    const client = createMockS3Client(sendFn);

    const config = await readBucketLifecycleConfiguration(client, BUCKETS.TEMP);
    expect(config).toEqual({ Rules: mockRules });
    expect(sendFn).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when reading lifecycle configuration on bucket with NoSuchLifecycleConfiguration", async () => {
    const noConfigError = new Error("NoSuchLifecycleConfiguration");
    noConfigError.name = "NoSuchLifecycleConfiguration";

    const sendFn = vi.fn().mockRejectedValue(noConfigError);
    const client = createMockS3Client(sendFn);

    const config = await readBucketLifecycleConfiguration(client, BUCKETS.REFERENCE);
    expect(config).toBeUndefined();
  });

  it("re-throws NoSuchBucket or other S3 errors when reading lifecycle configuration", async () => {
    const noBucketError = new Error("The specified bucket does not exist");
    noBucketError.name = "NoSuchBucket";

    const sendFn = vi.fn().mockRejectedValue(noBucketError);
    const client = createMockS3Client(sendFn);

    await expect(readBucketLifecycleConfiguration(client, BUCKETS.REFERENCE)).rejects.toThrow(
      "The specified bucket does not exist"
    );
  });
});
