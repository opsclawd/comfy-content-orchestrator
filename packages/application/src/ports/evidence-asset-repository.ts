import type {
  BatchEvidencePurpose,
  ConsentStatus,
  EvidenceAcquisitionMethod,
  EvidenceRegistrationIntent,
  EvidenceSourceClass,
  LegalRightsStatus,
  ReportedCapturePrecision,
  VerificationFactScope,
  VerificationKind,
  VerificationOutcome
} from "@cco/shared";
import type {
  ActionId,
  BatchEvidenceLink,
  BatchId,
  ClientId,
  EvidenceAsset,
  EvidenceDerivative,
  EvidenceEligibilityResult,
  EvidenceId,
  EvidenceRevision,
  EvidenceVerificationEvent,
  Sha256Hex,
  SourceObject,
  SourceObjectId,
  VerificationEventId
} from "@cco/domain";
import type { CommandEnvelope } from "./product-evidence-repository.js";

export interface RegisterEvidenceCommandPayload {
  readonly batchId: BatchId;
  readonly purpose: BatchEvidencePurpose;
  readonly sourceClass: EvidenceSourceClass;
  readonly acquisitionMethod: EvidenceAcquisitionMethod;
  readonly assertionText: string;
  readonly reportedCaptureDate: string | null;
  readonly reportedCaptureTimestamp: string | null;
  readonly reportedCapturePrecision: ReportedCapturePrecision | null;
  readonly captureContext: string | null;
  readonly rightsStatus: LegalRightsStatus;
  readonly consentStatus: ConsentStatus;
  readonly rightsAttribution: string | null;
  readonly rightsDocumentLocator: string | null;
  readonly registrationIntent: EvidenceRegistrationIntent;
  readonly sourceObjectId?: SourceObjectId | undefined;
  readonly reusedSourceObjectId?: SourceObjectId | undefined;
  readonly originalSha256: Sha256Hex;
  readonly detectedMimeType: string;
  readonly byteLength: number;
  readonly storageBucket: string;
  readonly storageObjectKey: string;
  readonly retentionPolicyVersion: string;
  readonly expectedEvidenceVersion?: number | undefined;
  readonly targetEvidenceId?: EvidenceId | undefined;
  readonly derivative?:
    | {
        readonly referenceAssetId: string;
        readonly derivativeSha256: Sha256Hex;
        readonly transformDescription: string;
        readonly transformToolVersion?: string | null | undefined;
      }
    | undefined;
}

export interface RegisterEvidenceResult {
  readonly evidenceAsset: EvidenceAsset;
  readonly evidenceRevision: EvidenceRevision;
  readonly sourceObject: SourceObject;
  readonly batchEvidenceLink: BatchEvidenceLink;
  readonly derivative: EvidenceDerivative | null;
  readonly isNewSourceObject?: boolean;
}

export interface LinkEvidenceDerivativeCommandPayload {
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly referenceAssetId: string;
  readonly derivativeSha256: Sha256Hex;
  readonly transformDescription: string;
  readonly transformToolVersion?: string | null | undefined;
}

export interface AppendVerificationEventCommandPayload {
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly outcome: VerificationOutcome;
  readonly verificationKind: VerificationKind;
  readonly factScope: VerificationFactScope;
  readonly method: string;
  readonly reason: string;
  readonly verifiedPartyReference?: string | null | undefined;
  readonly withdrawalEventId?: VerificationEventId | null | undefined;
}

export interface EvidenceAssetRepositoryPort {
  // Mutating Commands
  registerEvidence(
    cmd: CommandEnvelope<RegisterEvidenceCommandPayload>
  ): Promise<RegisterEvidenceResult>;
  linkDerivative(
    cmd: CommandEnvelope<LinkEvidenceDerivativeCommandPayload>
  ): Promise<EvidenceDerivative>;
  appendVerificationEvent(
    cmd: CommandEnvelope<AppendVerificationEventCommandPayload>
  ): Promise<EvidenceVerificationEvent>;
  quarantineSourceObject(
    clientId: ClientId,
    sourceObjectId: SourceObjectId,
    reason: string
  ): Promise<void>;

  // Quota & Ingest Reservations
  createIngestReservation(
    clientId: ClientId,
    sha256: Sha256Hex,
    byteLength: number,
    ttlSeconds: number
  ): Promise<string>;
  completeIngestReservation(
    reservationId: string,
    status: "committed" | "released" | "abandoned"
  ): Promise<void>;
  getClientStorageUsage(clientId: ClientId): Promise<{
    readonly totalStoredBytes: number;
    readonly activeReservedBytes: number;
    readonly concurrentInflightCount: number;
  }>;
  getCommandReceipt(
    clientId: ClientId,
    actionId: ActionId
  ): Promise<{
    readonly commandName: string;
    readonly payloadSha256: string;
    readonly actorId: string;
    readonly responseBody: unknown;
  } | null>;

  // Queries
  getSourceObjectById(
    clientId: ClientId,
    sourceObjectId: SourceObjectId
  ): Promise<SourceObject | null>;
  getSourceObjectByHash(
    clientId: ClientId,
    originalSha256: Sha256Hex
  ): Promise<SourceObject | null>;
  getEvidenceById(clientId: ClientId, evidenceId: EvidenceId): Promise<EvidenceAsset | null>;
  getEvidenceHistory(
    clientId: ClientId,
    evidenceId: EvidenceId
  ): Promise<readonly EvidenceRevision[]>;
  getEvidenceRevision(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceRevision | null>;
  listBatchEvidence(clientId: ClientId, batchId: BatchId): Promise<readonly BatchEvidenceLink[]>;
  getBatchEvidenceLink(
    clientId: ClientId,
    batchId: BatchId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<BatchEvidenceLink | null>;
  getDerivative(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceDerivative | null>;
  listVerificationEvents(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<readonly EvidenceVerificationEvent[]>;
  getEvidenceEligibility(
    clientId: ClientId,
    evidenceId: EvidenceId,
    revision: number
  ): Promise<EvidenceEligibilityResult>;
}
