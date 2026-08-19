/**
 * Cross-cutting S3/MinIO bucket identifiers (PRD §2.3).
 *
 * Retention rules and lifecycle configurations are handled separately (Issue #62).
 */
export const BUCKET_NAMES = [
  "godzspeed-temp",
  "godzspeed-review",
  "godzspeed-reference",
  "godzspeed-delivery"
] as const;

export type BucketName = (typeof BUCKET_NAMES)[number];

export const BUCKETS = {
  TEMP: "godzspeed-temp",
  REVIEW: "godzspeed-review",
  REFERENCE: "godzspeed-reference",
  DELIVERY: "godzspeed-delivery"
} as const;
