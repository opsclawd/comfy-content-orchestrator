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

export interface ObjectStoragePort {
  putObject(input: PutObjectInput): Promise<ObjectLocator>;
  getObject(locator: ObjectLocator): Promise<StoredObject | undefined>;
}
