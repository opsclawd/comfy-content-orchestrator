import { describe, expect, it } from "vitest";
import {
  BUCKETS,
  BUCKET_NAMES,
  BUCKET_RETENTION_POLICIES,
  BUCKET_LIFECYCLE_DEFINITIONS,
  type BucketName
} from "./index.js";

describe("bucket class constants and retention policies", () => {
  it("defines the four PRD bucket class constants", () => {
    expect(BUCKET_NAMES).toEqual([
      "godzspeed-temp",
      "godzspeed-review",
      "godzspeed-reference",
      "godzspeed-delivery"
    ]);

    expect(BUCKETS.TEMP).toBe("godzspeed-temp");
    expect(BUCKETS.REVIEW).toBe("godzspeed-review");
    expect(BUCKETS.REFERENCE).toBe("godzspeed-reference");
    expect(BUCKETS.DELIVERY).toBe("godzspeed-delivery");
  });

  it("type checks bucket names against union", () => {
    const validBucket: BucketName = BUCKETS.TEMP;
    expect(BUCKET_NAMES.includes(validBucket)).toBe(true);
  });

  it("defines 14-day automated expiry for godzspeed-temp", () => {
    const tempPolicy = BUCKET_RETENTION_POLICIES["godzspeed-temp"];
    expect(tempPolicy).toBeDefined();
    expect(tempPolicy.bucket).toBe("godzspeed-temp");
    expect(tempPolicy.defaultRetentionDays).toBe(14);
    expect(tempPolicy.isAutomatedExpiry).toBe(true);

    const tempLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-temp"];
    expect(tempLifecycle).toBeDefined();
    expect(tempLifecycle?.expirationDays).toBe(14);
    expect(tempLifecycle?.status).toBe("Enabled");
    expect(tempLifecycle?.ruleId).toBe("godzspeed-temp-retention-14d");
  });

  it("defines 60-day automated expiry for godzspeed-review", () => {
    const reviewPolicy = BUCKET_RETENTION_POLICIES["godzspeed-review"];
    expect(reviewPolicy).toBeDefined();
    expect(reviewPolicy.bucket).toBe("godzspeed-review");
    expect(reviewPolicy.defaultRetentionDays).toBe(60);
    expect(reviewPolicy.isAutomatedExpiry).toBe(true);

    const reviewLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-review"];
    expect(reviewLifecycle).toBeDefined();
    expect(reviewLifecycle?.expirationDays).toBe(60);
    expect(reviewLifecycle?.status).toBe("Enabled");
    expect(reviewLifecycle?.ruleId).toBe("godzspeed-review-retention-60d");
  });

  it("defines no automated expiry for godzspeed-reference", () => {
    const refPolicy = BUCKET_RETENTION_POLICIES["godzspeed-reference"];
    expect(refPolicy).toBeDefined();
    expect(refPolicy.bucket).toBe("godzspeed-reference");
    expect(refPolicy.defaultRetentionDays).toBeUndefined();
    expect(refPolicy.isAutomatedExpiry).toBe(false);

    const refLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-reference"];
    expect(refLifecycle).toBeUndefined();
  });

  it("defines no automated expiry for godzspeed-delivery", () => {
    const deliveryPolicy = BUCKET_RETENTION_POLICIES["godzspeed-delivery"];
    expect(deliveryPolicy).toBeDefined();
    expect(deliveryPolicy.bucket).toBe("godzspeed-delivery");
    expect(deliveryPolicy.defaultRetentionDays).toBeUndefined();
    expect(deliveryPolicy.isAutomatedExpiry).toBe(false);

    const deliveryLifecycle = BUCKET_LIFECYCLE_DEFINITIONS["godzspeed-delivery"];
    expect(deliveryLifecycle).toBeUndefined();
  });
});
