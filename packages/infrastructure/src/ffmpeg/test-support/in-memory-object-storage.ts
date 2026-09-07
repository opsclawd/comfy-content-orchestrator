import {
  type CopyObjectOptions,
  type GetObjectOptions,
  type HeadObjectResult,
  type ObjectLocator,
  type ObjectStoragePort,
  ObjectAlreadyExistsError,
  type PutObjectInput,
  type StoredObject
} from "@cco/application";

export class InMemoryObjectStorage implements ObjectStoragePort {
  private readonly storage = new Map<string, StoredObject>();

  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    const locatorKey = `${input.bucket}/${input.key}`;
    if (input.ifNoneMatch === "*" && this.storage.has(locatorKey)) {
      throw new ObjectAlreadyExistsError(input.bucket, input.key);
    }
    const stored: StoredObject = {
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
      ...(input.checksumSha256 !== undefined ? { checksumSha256: input.checksumSha256 } : {})
    };
    this.storage.set(locatorKey, stored);
    return { bucket: input.bucket, key: input.key };
  }

  async getObject(
    locator: ObjectLocator,
    options?: GetObjectOptions
  ): Promise<StoredObject | undefined> {
    const locatorKey = `${locator.bucket}/${locator.key}`;
    const stored = this.storage.get(locatorKey);
    if (!stored) return undefined;
    if (options?.maxBytes !== undefined && stored.body.byteLength > options.maxBytes) {
      throw new Error(
        `Object ${locator.bucket}/${locator.key} byteLength (${stored.body.byteLength}) exceeds maxBytes limit (${options.maxBytes})`
      );
    }
    return stored;
  }

  async headObject(locator: ObjectLocator): Promise<HeadObjectResult | undefined> {
    const stored = this.storage.get(`${locator.bucket}/${locator.key}`);
    if (!stored) return undefined;
    return {
      bucket: stored.bucket,
      key: stored.key,
      ...(stored.checksumSha256 !== undefined ? { checksumSha256: stored.checksumSha256 } : {}),
      ...(stored.contentType !== undefined ? { contentType: stored.contentType } : {})
    };
  }

  async copyObject(
    from: ObjectLocator,
    to: ObjectLocator,
    options?: CopyObjectOptions
  ): Promise<ObjectLocator> {
    const toKey = `${to.bucket}/${to.key}`;
    if (options?.ifNoneMatch === "*" && this.storage.has(toKey)) {
      throw new ObjectAlreadyExistsError(to.bucket, to.key);
    }
    const fromKey = `${from.bucket}/${from.key}`;
    const source = this.storage.get(fromKey);
    if (!source) {
      throw new Error(`Source object not found: ${fromKey}`);
    }
    const copied: StoredObject = {
      bucket: to.bucket,
      key: to.key,
      body: new Uint8Array(source.body),
      ...(source.contentType !== undefined ? { contentType: source.contentType } : {}),
      ...(source.checksumSha256 !== undefined ? { checksumSha256: source.checksumSha256 } : {})
    };
    this.storage.set(toKey, copied);
    return { bucket: to.bucket, key: to.key };
  }

  async deleteObject(locator: ObjectLocator): Promise<void> {
    this.storage.delete(`${locator.bucket}/${locator.key}`);
  }

  hasObject(locator: ObjectLocator): boolean {
    return this.storage.has(`${locator.bucket}/${locator.key}`);
  }

  getAllKeys(): string[] {
    return Array.from(this.storage.keys());
  }

  clear(): void {
    this.storage.clear();
  }
}
