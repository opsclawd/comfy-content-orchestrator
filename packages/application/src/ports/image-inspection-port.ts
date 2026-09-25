export type SupportedReferenceMimeType = "image/png" | "image/jpeg" | "image/webp";

export const SUPPORTED_REFERENCE_MIME_TYPES: readonly SupportedReferenceMimeType[] = [
  "image/png",
  "image/jpeg",
  "image/webp"
] as const;

export interface ImageInspectionLimits {
  readonly maxByteSize?: number | undefined;
  readonly maxWidth?: number | undefined;
  readonly maxHeight?: number | undefined;
  readonly maxPixels?: number | undefined;
}

export interface ValidatedImageMetadata {
  readonly detectedMimeType: SupportedReferenceMimeType;
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

export interface ImageInspectionPort {
  inspectAndValidate(
    buffer: Buffer | Uint8Array,
    declaredMimeType: string,
    limits?: ImageInspectionLimits
  ): Promise<ValidatedImageMetadata>;
}
