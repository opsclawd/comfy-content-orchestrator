import {
  canonicalizeUtcTimestamp,
  isValidDisplayName,
  isValidIsoUtcTimestamp,
  type IsoTimestampString,
  type SourceObjectAvailability
} from "@cco/shared";
import {
  createClientId,
  createSha256Hex,
  createSourceObjectId,
  type ClientId,
  type Sha256Hex,
  type SourceObjectId
} from "./identifiers.js";
import { ProductValidationError } from "./product-evidence-errors.js";

export interface SourceObject {
  readonly clientId: ClientId;
  readonly sourceObjectId: SourceObjectId;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly originalSha256: Sha256Hex;
  readonly detectedMimeType: string;
  readonly byteLength: number;
  readonly uploadedAt: IsoTimestampString;
  readonly uploaderId: string;
  readonly accessClass: "restricted_original";
  readonly retentionClass: "source_evidence_archive";
  readonly retentionPolicyVersion: string;
  readonly availability: SourceObjectAvailability;
  readonly storageVersionId: string | null;
}

export interface CreateSourceObjectInput {
  readonly clientId: ClientId;
  readonly sourceObjectId?: SourceObjectId | undefined;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly originalSha256: Sha256Hex;
  readonly detectedMimeType: string;
  readonly byteLength: number;
  readonly uploadedAt?: IsoTimestampString | undefined;
  readonly uploaderId: string;
  readonly retentionPolicyVersion: string;
  readonly storageVersionId?: string | null | undefined;
  readonly availability?: SourceObjectAvailability | undefined;
}

function validateSourceObjectInvariants(obj: SourceObject): void {
  const issues: {
    code: "INVALID_TEXT" | "INVALID_TIMESTAMP" | "INVALID_FIELD_COMBINATION";
    path: string[];
    message: string;
  }[] = [];

  if (obj.byteLength <= 0 || !Number.isSafeInteger(obj.byteLength)) {
    issues.push({
      code: "INVALID_FIELD_COMBINATION",
      path: ["byteLength"],
      message: "byteLength must be a positive safe integer."
    });
  }

  if (!obj.storageBucket || obj.storageBucket.trim().length === 0) {
    issues.push({
      code: "INVALID_TEXT",
      path: ["storageBucket"],
      message: "storageBucket cannot be empty."
    });
  }

  const expectedKey = `clients/${obj.clientId}/evidence/originals/${obj.originalSha256}`;
  if (obj.storageObjectKey !== expectedKey) {
    issues.push({
      code: "INVALID_FIELD_COMBINATION",
      path: ["storageObjectKey"],
      message: `storageObjectKey must match the tenant-isolated canonical pattern: "${expectedKey}".`
    });
  }

  if (!obj.detectedMimeType || obj.detectedMimeType.trim().length === 0) {
    issues.push({
      code: "INVALID_TEXT",
      path: ["detectedMimeType"],
      message: "detectedMimeType cannot be empty."
    });
  }

  if (!isValidDisplayName(obj.uploaderId)) {
    issues.push({
      code: "INVALID_TEXT",
      path: ["uploaderId"],
      message: "uploaderId must be 1–255 code points without controls."
    });
  }

  if (!obj.retentionPolicyVersion || obj.retentionPolicyVersion.trim().length === 0) {
    issues.push({
      code: "INVALID_TEXT",
      path: ["retentionPolicyVersion"],
      message: "retentionPolicyVersion cannot be empty."
    });
  }

  if (!isValidIsoUtcTimestamp(obj.uploadedAt)) {
    issues.push({
      code: "INVALID_TIMESTAMP",
      path: ["uploadedAt"],
      message: "uploadedAt must be a valid ISO 8601 UTC timestamp."
    });
  }

  if (issues.length > 0) {
    throw new ProductValidationError(issues);
  }
}

export function createSourceObject(input: CreateSourceObjectInput): SourceObject {
  const clientId = createClientId(input.clientId);
  const sourceObjectId = input.sourceObjectId
    ? createSourceObjectId(input.sourceObjectId)
    : createSourceObjectId(crypto.randomUUID());
  const originalSha256 = createSha256Hex(input.originalSha256);
  const uploadedAt = input.uploadedAt
    ? canonicalizeUtcTimestamp(input.uploadedAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  const sourceObject: SourceObject = {
    clientId,
    sourceObjectId,
    storageBucket: input.storageBucket.trim(),
    storageObjectKey: input.storageObjectKey.trim(),
    originalSha256,
    detectedMimeType: input.detectedMimeType.trim().toLowerCase(),
    byteLength: input.byteLength,
    uploadedAt,
    uploaderId: input.uploaderId.trim(),
    accessClass: "restricted_original",
    retentionClass: "source_evidence_archive",
    retentionPolicyVersion: input.retentionPolicyVersion.trim(),
    availability: input.availability ?? "available",
    storageVersionId: input.storageVersionId ? input.storageVersionId.trim() : null
  };

  validateSourceObjectInvariants(sourceObject);
  return Object.freeze(sourceObject);
}

export function rehydrateSourceObject(raw: SourceObject): SourceObject {
  const sourceObject: SourceObject = {
    clientId: createClientId(raw.clientId),
    sourceObjectId: createSourceObjectId(raw.sourceObjectId),
    storageBucket: String(raw.storageBucket).trim(),
    storageObjectKey: String(raw.storageObjectKey).trim(),
    originalSha256: createSha256Hex(raw.originalSha256),
    detectedMimeType: String(raw.detectedMimeType).trim().toLowerCase(),
    byteLength: Number(raw.byteLength),
    uploadedAt: canonicalizeUtcTimestamp(raw.uploadedAt),
    uploaderId: String(raw.uploaderId).trim(),
    accessClass: "restricted_original",
    retentionClass: "source_evidence_archive",
    retentionPolicyVersion: String(raw.retentionPolicyVersion).trim(),
    availability: raw.availability,
    storageVersionId: raw.storageVersionId ? String(raw.storageVersionId).trim() : null
  };

  validateSourceObjectInvariants(sourceObject);
  return Object.freeze(sourceObject);
}
