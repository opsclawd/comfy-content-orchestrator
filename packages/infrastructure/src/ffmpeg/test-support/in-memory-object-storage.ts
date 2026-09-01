import type {
  GetObjectOptions,
  ObjectLocator,
  ObjectStoragePort,
  PutObjectInput,
  StoredObject
} from "@cco/application";

export class InMemoryObjectStorage implements ObjectStoragePort {
  private readonly storage = new Map<string, StoredObject>();

  async putObject(input: PutObjectInput): Promise<ObjectLocator> {
    const locatorKey = `${input.bucket}/${input.key}`;
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

  async deleteObject(locator: ObjectLocator): Promise<void> {
    this.storage.delete(`${locator.bucket}/${locator.key}`);
  }

  hasObject(locator: ObjectLocator): boolean {
    return this.storage.has(`${locator.bucket}/${locator.key}`);
  }

  clear(): void {
    this.storage.clear();
  }
}
