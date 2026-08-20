import { describe, expect, it } from "vitest";
import { BUCKETS, BUCKET_NAMES, type BucketName } from "./index.js";

describe("bucket class constants", () => {
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
});
