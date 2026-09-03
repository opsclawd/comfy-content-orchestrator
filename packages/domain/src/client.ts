export interface ClientRecord {
  readonly id: string;
  readonly companyName: string;
  readonly brandBibleJson: Record<string, unknown>;
  readonly defaultAspectRatio: string;
  readonly externalProcessingPolicy: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}
