export interface PersistentObjectLocator {
  readonly bucket: string;
  readonly key: string;
  readonly contentHash: string;
}

export interface ReviewMediaDeliveryPort {
  generatePresignedReadUrl(
    locator: PersistentObjectLocator,
    expiresInSeconds?: number
  ): Promise<string>;
}
