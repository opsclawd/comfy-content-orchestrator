export interface ObjectLocator {
  readonly bucket: string;
  readonly key: string;
}

export interface PutObjectInput {
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType?: string;
  readonly checksumSha256?: string;
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

export interface ObjectStoragePort {
  putObject(input: PutObjectInput): Promise<ObjectLocator>;
  getObject(locator: ObjectLocator, options?: GetObjectOptions): Promise<StoredObject | undefined>;
  /**
   * Optional: best-effort deletion, used by callers that need to roll back a
   * partially-completed multi-object publish (e.g. deleting an already-
   * uploaded media file when a subsequent manifest write fails). Adapters
   * that don't implement this simply can't be rolled back — callers must
   * treat it as unavailable, not assume it exists.
   */
  deleteObject?(locator: ObjectLocator): Promise<void>;
}
