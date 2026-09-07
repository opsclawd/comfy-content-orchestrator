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
