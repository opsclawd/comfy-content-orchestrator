export interface ObjectLocator {
  readonly bucket: string;
  readonly key: string;
}

export class ObjectAlreadyExistsError extends Error {
  override readonly name = "ObjectAlreadyExistsError";
  readonly bucket: string;
  readonly key: string;

  constructor(bucket: string, key: string, options?: ErrorOptions) {
    super(`Object already exists: ${bucket}/${key}`, options);
    this.bucket = bucket;
    this.key = key;
  }
}

/**
 * Thrown by a getObject() adapter when it has *proven* the persisted bytes
 * are corrupt or malformed on read -- an oversized object (exceeds the
 * caller's maxBytes) or a stored checksum that doesn't match the bytes
 * actually read. This is distinct from every other getObject() failure
 * (network transport errors, timeouts, auth failures, cancellation): those
 * say nothing about the integrity of the persisted bytes and MUST NOT be
 * treated as proof of corruption by a caller re-verifying a SourceObject --
 * doing so would durably quarantine a healthy source over a transient
 * failure (quarantine is a one-way transition; see
 * migrations/027_evidence_authority.sql).
 */
export class StorageIntegrityViolationError extends Error {
  override readonly name = "StorageIntegrityViolationError";
  readonly bucket: string;
  readonly key: string;

  constructor(message: string, bucket: string, key: string, options?: ErrorOptions) {
    super(message, options);
    this.bucket = bucket;
    this.key = key;
  }
}

export interface PutObjectInput {
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType?: string;
  readonly checksumSha256?: string;
  readonly ifNoneMatch?: "*" | undefined;
}

export interface StoredObject {
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType?: string;
  readonly checksumSha256?: string;
}

export interface GetObjectOptions {
  readonly maxBytes?: number | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface CopyObjectOptions {
  readonly ifNoneMatch?: "*" | undefined;
}

export interface HeadObjectResult {
  readonly bucket: string;
  readonly key: string;
  readonly checksumSha256?: string | undefined;
  readonly contentType?: string | undefined;
}

export interface ObjectStoragePort {
  putObject(input: PutObjectInput): Promise<ObjectLocator>;
  getObject(locator: ObjectLocator, options?: GetObjectOptions): Promise<StoredObject | undefined>;
  copyObject(
    from: ObjectLocator,
    to: ObjectLocator,
    options?: CopyObjectOptions
  ): Promise<ObjectLocator>;
  headObject?(locator: ObjectLocator): Promise<HeadObjectResult | undefined>;
  /**
   * Optional best-effort deletion for cleanup of staging or other transient
   * objects. It is not part of the delivery correctness boundary.
   */
  deleteObject?(locator: ObjectLocator): Promise<void>;
}
