import type { EvidenceSourceClass } from "@cco/shared";

export interface InspectedOriginalMetadata {
  readonly detectedMimeType: string;
  readonly byteLength: number;
  readonly sourceClass: EvidenceSourceClass;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface OriginalsInspectionPort {
  inspectAndValidate(
    body: Buffer | Uint8Array,
    declaredMimeType: string,
    sourceClass: EvidenceSourceClass
  ): Promise<InspectedOriginalMetadata>;
}
