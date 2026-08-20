import {
  CreateBucketCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  type S3Client,
  type BucketLifecycleConfiguration
} from "@aws-sdk/client-s3";
import {
  BUCKET_NAMES,
  BUCKET_LIFECYCLE_DEFINITIONS,
  BUCKET_RETENTION_POLICIES,
  type BucketName
} from "@cco/shared";

export interface StorageProvisioningOptions {
  readonly client: S3Client;
  readonly buckets?: readonly BucketName[];
  readonly logger?: (message: string) => void;
}

export interface BucketProvisionResult {
  readonly bucket: BucketName;
  readonly bucketStatus: "created" | "already_exists";
  readonly lifecycleStatus: "applied" | "skipped";
  readonly ruleId?: string;
  readonly expirationDays?: number;
}

export interface StorageProvisioningSummary {
  readonly results: readonly BucketProvisionResult[];
  readonly createdCount: number;
  readonly alreadyExistsCount: number;
  readonly lifecycleAppliedCount: number;
  readonly lifecycleSkippedCount: number;
}

export interface LifecycleEligibilityResult {
  readonly bucket: BucketName;
  readonly isEligibleForDeletion: boolean;
  readonly objectAgeDays: number;
  readonly thresholdDays?: number | undefined;
  readonly reason: string;
}

function isBucketAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    err.name === "BucketAlreadyExists" ||
    err.name === "BucketAlreadyOwnedByYou" ||
    err.Code === "BucketAlreadyExists" ||
    err.Code === "BucketAlreadyOwnedByYou" ||
    err.$metadata?.httpStatusCode === 409
  );
}

function isNoSuchLifecycleError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as { name?: string; Code?: string; message?: string };
  if (err.name === "NoSuchBucket" || err.Code === "NoSuchBucket") {
    return false;
  }
  return (
    err.name === "NoSuchLifecycleConfiguration" ||
    err.Code === "NoSuchLifecycleConfiguration" ||
    err.name === "NoSuchLifecycleConfigurationError" ||
    err.message?.includes("NoSuchLifecycleConfiguration") === true
  );
}

export async function provisionBucket(
  client: S3Client,
  bucket: BucketName,
  logger?: (message: string) => void
): Promise<BucketProvisionResult> {
  let bucketStatus: "created" | "already_exists" = "created";

  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    logger?.(`[provision] Bucket created: ${bucket}`);
  } catch (error) {
    if (isBucketAlreadyExistsError(error)) {
      bucketStatus = "already_exists";
      logger?.(`[provision] Bucket already exists: ${bucket}`);
    } else {
      throw error;
    }
  }

  const lifecycleDef = BUCKET_LIFECYCLE_DEFINITIONS[bucket];
  if (lifecycleDef) {
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: bucket,
        LifecycleConfiguration: {
          Rules: [
            {
              ID: lifecycleDef.ruleId,
              Status: lifecycleDef.status,
              Filter: { Prefix: lifecycleDef.prefix ?? "" },
              Expiration: { Days: lifecycleDef.expirationDays }
            }
          ]
        }
      })
    );
    logger?.(
      `[provision] Applied lifecycle rule "${lifecycleDef.ruleId}" (${lifecycleDef.expirationDays}d expiry) on ${bucket}`
    );

    return {
      bucket,
      bucketStatus,
      lifecycleStatus: "applied",
      ruleId: lifecycleDef.ruleId,
      expirationDays: lifecycleDef.expirationDays
    };
  }

  logger?.(`[provision] Skipped lifecycle rule on ${bucket} (retained per business policy)`);
  return {
    bucket,
    bucketStatus,
    lifecycleStatus: "skipped"
  };
}

export async function provisionStorageBuckets(
  options: StorageProvisioningOptions
): Promise<StorageProvisioningSummary> {
  const bucketsToProvision = options.buckets ?? BUCKET_NAMES;
  const results: BucketProvisionResult[] = [];

  for (const bucket of bucketsToProvision) {
    const result = await provisionBucket(options.client, bucket, options.logger);
    results.push(result);
  }

  const createdCount = results.filter((r) => r.bucketStatus === "created").length;
  const alreadyExistsCount = results.filter((r) => r.bucketStatus === "already_exists").length;
  const lifecycleAppliedCount = results.filter((r) => r.lifecycleStatus === "applied").length;
  const lifecycleSkippedCount = results.filter((r) => r.lifecycleStatus === "skipped").length;

  return {
    results: Object.freeze(results),
    createdCount,
    alreadyExistsCount,
    lifecycleAppliedCount,
    lifecycleSkippedCount
  };
}

export async function readBucketLifecycleConfiguration(
  client: S3Client,
  bucket: BucketName
): Promise<BucketLifecycleConfiguration | undefined> {
  try {
    const response = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: bucket })
    );
    return {
      Rules: response.Rules
    };
  } catch (error) {
    if (isNoSuchLifecycleError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function evaluateLifecycleEligibility(params: {
  readonly bucket: BucketName;
  readonly objectAgeDays: number;
}): LifecycleEligibilityResult {
  const { bucket, objectAgeDays } = params;
  const policy = BUCKET_RETENTION_POLICIES[bucket];

  if (!policy.isAutomatedExpiry || policy.defaultRetentionDays === undefined) {
    return {
      bucket,
      isEligibleForDeletion: false,
      objectAgeDays,
      thresholdDays: undefined,
      reason: `No automated upload-age lifecycle rule configured for ${bucket}: ${policy.description}`
    };
  }

  const isEligible = objectAgeDays >= policy.defaultRetentionDays;
  return {
    bucket,
    isEligibleForDeletion: isEligible,
    objectAgeDays,
    thresholdDays: policy.defaultRetentionDays,
    reason: isEligible
      ? `Object age (${objectAgeDays}d) satisfies retention threshold (>= ${policy.defaultRetentionDays}d)`
      : `Object age (${objectAgeDays}d) is below retention threshold (${policy.defaultRetentionDays}d)`
  };
}
