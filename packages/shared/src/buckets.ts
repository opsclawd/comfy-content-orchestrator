/**
 * Cross-cutting S3/MinIO bucket identifiers and lifecycle policies (PRD §2.3).
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

export interface BucketRetentionPolicy {
  readonly bucket: BucketName;
  readonly defaultRetentionDays?: number;
  readonly description: string;
  readonly isAutomatedExpiry: boolean;
}

export interface BucketLifecycleRuleDefinition {
  readonly ruleId: string;
  readonly expirationDays: number;
  readonly status: "Enabled" | "Disabled";
  readonly prefix?: string;
}

export const BUCKET_RETENTION_POLICIES: Readonly<Record<BucketName, BucketRetentionPolicy>> =
  Object.freeze({
    "godzspeed-temp": {
      bucket: "godzspeed-temp",
      defaultRetentionDays: 14,
      description: "rejected candidates, transient intermediates, temporary render stems",
      isAutomatedExpiry: true
    },
    "godzspeed-review": {
      bucket: "godzspeed-review",
      defaultRetentionDays: 60,
      description: "storyboard candidates, WebP keyframes, proxy MP4s, review audio",
      isAutomatedExpiry: true
    },
    "godzspeed-reference": {
      bucket: "godzspeed-reference",
      description:
        "active client logos, reference previews, compact brand assets (retained while client is active)",
      isAutomatedExpiry: false
    },
    "godzspeed-delivery": {
      bucket: "godzspeed-delivery",
      description:
        "approved delivery copies awaiting client handoff (retained 90 days after campaign completion)",
      isAutomatedExpiry: false
    }
  });

export const BUCKET_LIFECYCLE_DEFINITIONS: Readonly<
  Record<BucketName, BucketLifecycleRuleDefinition | undefined>
> = Object.freeze({
  "godzspeed-temp": {
    ruleId: "godzspeed-temp-retention-14d",
    expirationDays: 14,
    status: "Enabled",
    prefix: ""
  },
  "godzspeed-review": {
    ruleId: "godzspeed-review-retention-60d",
    expirationDays: 60,
    status: "Enabled",
    prefix: ""
  },
  "godzspeed-reference": undefined,
  "godzspeed-delivery": undefined
});
