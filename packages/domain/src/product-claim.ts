/**
 * Pure domain entities, value objects, factory functions, rehydrators,
 * and state transitions for verified batch product claims (ADR 0009).
 *
 * Layer direction: imports only from @cco/shared and internal domain modules.
 */

import {
  canonicalizeUtcTimestamp,
  CLAIM_POLICY_VERSION,
  compareDecimalStrings,
  hasControlOrInvisibleChars,
  isSupportedAnalyticalTuple,
  isValidPositiveInt,
  normalizeDecimalString,
  type CanonicalClaimKind,
  type CertificatePanelMeasurementItem,
  type ClaimDateKind,
  type ClaimDecisionKind,
  type ClaimDurationUnit,
  type ClaimInvalidationCause,
  type ClaimParameters,
  type ClaimProofCategory,
  type ClaimState,
  type ClaimSupportRole,
  type ClaimTimingKind,
  type DateOnlyString,
  type IsoTimestampString,
  type LoggedProcessTimingDuration,
  type LoggedProcessTimingRange
} from "@cco/shared";
import {
  createClaimDecisionEventId,
  createClaimId,
  createClaimLinkId,
  type BatchId,
  type ClaimDecisionEventId,
  type ClaimId,
  type ClaimLinkId,
  type ClientId,
  type CoaMeasurementId,
  type CoaReportId,
  type DerivativeId,
  type EvidenceId,
  type Sha256Hex,
  type SkuId,
  type SourceObjectId,
  type VerificationEventId
} from "./identifiers.js";
import {
  AccessDeniedError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";

export { CLAIM_POLICY_VERSION };

// ============================================================================
// Entity Interfaces
// ============================================================================

export interface ProductClaim {
  readonly claimId: ClaimId;
  readonly clientId: ClientId;
  readonly skuId: SkuId;
  readonly batchId: BatchId;
  readonly currentRevision: number;
  readonly state: ClaimState;
  readonly version: number;
  readonly invalidationCause: ClaimInvalidationCause | null;
  readonly invalidationSourceRef: string | null;
  readonly createdAt: IsoTimestampString;
  readonly updatedAt: IsoTimestampString;
  readonly archivedAt: IsoTimestampString | null;
}

export interface ProductClaimRevision {
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly revision: number;
  readonly batchId: BatchId;
  readonly canonicalKind: CanonicalClaimKind;
  readonly proofCategory: ClaimProofCategory;
  readonly parameters: ClaimParameters;
  readonly displayWording: string | null;
  readonly policyVersion: string;
  readonly assertedBy: string;
  readonly assertedAt: IsoTimestampString;
  readonly supersedesRevision: number | null;
}

export interface ClaimSourceFactAttestation {
  readonly factKind: string;
  readonly factValue: string;
  readonly fieldLocator: string;
  readonly attribution: string;
  readonly actorId: string;
  readonly occurredAt: IsoTimestampString;
  readonly verificationEventId?: VerificationEventId | null | undefined;
}

export interface ClaimEvidenceLink {
  readonly linkId: ClaimLinkId;
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly claimRevision: number;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly sourceObjectId: SourceObjectId;
  readonly sourceSha256: Sha256Hex;
  readonly supportRole: ClaimSupportRole;
  readonly reportId?: CoaReportId | null | undefined;
  readonly reportRevision?: number | null | undefined;
  readonly measurementId?: CoaMeasurementId | null | undefined;
  readonly pinnedFactsRevision?: number | null | undefined;
  readonly attestation?: ClaimSourceFactAttestation | null | undefined;
  readonly derivativeAssetId?: DerivativeId | string | null | undefined;
}

export interface ClaimDecisionEvent {
  readonly eventId: ClaimDecisionEventId;
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly claimRevision: number;
  readonly decision: ClaimDecisionKind;
  readonly actorId: string;
  readonly occurredAt: IsoTimestampString;
  readonly reason: string;
  readonly policyVersion: string;
  readonly dependencyFingerprint?: string | null | undefined;
  readonly invalidationCause?: ClaimInvalidationCause | null | undefined;
  readonly sourceEventId?: string | null | undefined;
}

// ============================================================================
// Factory Inputs & Functions
// ============================================================================

export interface CreateProductClaimInput {
  readonly claimId?: ClaimId | undefined;
  readonly clientId: ClientId;
  readonly skuId: SkuId;
  readonly batchId: BatchId;
  readonly now?: IsoTimestampString | undefined;
}

export function createProductClaim(input: CreateProductClaimInput): ProductClaim {
  const claimId = input.claimId ?? createClaimId(crypto.randomUUID());
  const now = input.now
    ? canonicalizeUtcTimestamp(input.now)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    claimId,
    clientId: input.clientId,
    skuId: input.skuId,
    batchId: input.batchId,
    currentRevision: 1,
    state: "draft",
    version: 1,
    invalidationCause: null,
    invalidationSourceRef: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null
  });
}

export interface CreateProductClaimRevisionInput {
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly revision: number;
  readonly batchId: BatchId;
  readonly canonicalKind: CanonicalClaimKind;
  readonly proofCategory: ClaimProofCategory;
  readonly parameters: ClaimParameters | unknown;
  readonly displayWording?: string | null | undefined;
  readonly policyVersion?: string | undefined;
  readonly assertedBy: string;
  readonly assertedAt?: IsoTimestampString | undefined;
  readonly supersedesRevision?: number | null | undefined;
}

export function createProductClaimRevision(
  input: CreateProductClaimRevisionInput
): ProductClaimRevision {
  if (!isValidPositiveInt(input.revision)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_REVISION",
          path: ["revision"],
          message: "revision must be a positive integer."
        }
      ],
      "Invalid revision."
    );
  }

  if (input.revision === 1) {
    if (input.supersedesRevision !== null && input.supersedesRevision !== undefined) {
      throw new NonMonotonicRevisionError(
        "First claim revision (rev 1) cannot supersede another revision."
      );
    }
  } else {
    if (input.supersedesRevision === null || input.supersedesRevision === undefined) {
      throw new NonMonotonicRevisionError(
        "Subsequent claim revisions (rev > 1) must specify supersedesRevision."
      );
    }
    if (input.supersedesRevision !== input.revision - 1) {
      throw new NonMonotonicRevisionError(
        `Non-monotonic revision: revision ${input.revision} must supersede ${input.revision - 1}, but got ${input.supersedesRevision}.`
      );
    }
  }

  if (
    !input.assertedBy ||
    hasControlOrInvisibleChars(input.assertedBy) ||
    input.assertedBy.trim().length === 0
  ) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_TEXT",
          path: ["assertedBy"],
          message: "assertedBy must be a non-empty string without controls."
        }
      ],
      "assertedBy is invalid."
    );
  }

  const policyVersion = input.policyVersion ?? CLAIM_POLICY_VERSION;
  if (
    !policyVersion ||
    hasControlOrInvisibleChars(policyVersion) ||
    policyVersion.trim().length === 0
  ) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_TEXT",
          path: ["policyVersion"],
          message: "policyVersion must be a non-empty string without controls."
        }
      ],
      "policyVersion is invalid."
    );
  }

  let displayWording: string | null = null;
  if (input.displayWording !== null && input.displayWording !== undefined) {
    const trimmed = input.displayWording.trim();
    if (trimmed.length > 0) {
      if (hasControlOrInvisibleChars(input.displayWording)) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_TEXT",
              path: ["displayWording"],
              message: "displayWording contains illegal control characters."
            }
          ],
          "displayWording is invalid."
        );
      }
      displayWording = trimmed;
    }
  }

  const normalizedParams = normalizeClaimParameters(input.parameters);

  // Validate parameters correspondence to canonicalKind
  validateClaimParameters(input.canonicalKind, input.proofCategory, normalizedParams);

  const assertedAt = input.assertedAt
    ? canonicalizeUtcTimestamp(input.assertedAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    clientId: input.clientId,
    claimId: input.claimId,
    revision: input.revision,
    batchId: input.batchId,
    canonicalKind: input.canonicalKind,
    proofCategory: input.proofCategory,
    parameters: normalizedParams,
    displayWording,
    policyVersion,
    assertedBy: input.assertedBy.trim(),
    assertedAt,
    supersedesRevision: input.supersedesRevision ?? null
  });
}

export function normalizeClaimParameters(raw: unknown): ClaimParameters {
  if (raw === null || typeof raw !== "object" || !("kind" in raw)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["parameters"],
          message: "Parameters must be an object with a kind property."
        }
      ],
      "Invalid claim parameters."
    );
  }
  const p = raw as Record<string, unknown>;
  switch (p.kind) {
    case "factual_lot_identifier": {
      return {
        kind: "factual_lot_identifier",
        lotIdentifier: String(p.lotIdentifier ?? "")
      };
    }
    case "packaged_or_harvest_date": {
      return {
        kind: "packaged_or_harvest_date",
        dateKind: p.dateKind as ClaimDateKind,
        dateValue: String(p.dateValue ?? "") as DateOnlyString,
        reportedPrecision: p.reportedPrecision as "date" | "minute" | "second" | "millisecond"
      };
    }
    case "certificate_panel_measurement": {
      const rawMeasurements = Array.isArray(p.measurements) ? p.measurements : [];
      const measurements: CertificatePanelMeasurementItem[] = rawMeasurements.map(
        (rawItem: unknown) => {
          const m = rawItem as Record<string, unknown>;
          return {
            analyte: String(m?.analyte ?? ""),
            exactDecimalValue: normalizeDecimalString(m?.exactDecimalValue, "exactDecimalValue"),
            unit: String(m?.unit ?? ""),
            quantityKind: String(m?.quantityKind ?? ""),
            basis: String(m?.basis ?? ""),
            context: String(m?.context ?? ""),
            requiredScope: m?.requiredScope as "sample_only" | "attributed_lot"
          };
        }
      );
      return {
        kind: "certificate_panel_measurement",
        ...(typeof p.panelName === "string" ? { panelName: p.panelName } : {}),
        measurements: Object.freeze(measurements)
      };
    }
    case "cultivation_processing_lineage": {
      const rawFacts = Array.isArray(p.claimedFacts) ? p.claimedFacts : [];
      return {
        kind: "cultivation_processing_lineage",
        operationCode: String(p.operationCode ?? ""),
        originKind: p.originKind as "own_production" | "partner_origin",
        ...(typeof p.attributedParty === "string" ? { attributedParty: p.attributedParty } : {}),
        claimedFacts: Object.freeze(rawFacts.map((f: unknown) => String(f ?? "")))
      };
    }
    case "logged_process_timing": {
      let duration: LoggedProcessTimingDuration | undefined;
      if (p.duration && typeof p.duration === "object") {
        const d = p.duration as Record<string, unknown>;
        duration = {
          value: normalizeDecimalString(d.value, "duration.value"),
          unit: d.unit as ClaimDurationUnit
        };
      }
      let timestampRange: LoggedProcessTimingRange | undefined;
      if (p.timestampRange && typeof p.timestampRange === "object") {
        const tr = p.timestampRange as Record<string, unknown>;
        timestampRange = {
          start: canonicalizeUtcTimestamp(String(tr.start ?? "")),
          end: canonicalizeUtcTimestamp(String(tr.end ?? ""))
        };
      }
      return {
        kind: "logged_process_timing",
        operationName: String(p.operationName ?? ""),
        timingKind: p.timingKind as ClaimTimingKind,
        ...(duration ? { duration } : {}),
        ...(timestampRange ? { timestampRange } : {})
      };
    }
    case "unsupported_manual": {
      return {
        kind: "unsupported_manual",
        proposedText: String(p.proposedText ?? ""),
        categoryOrReason: String(p.categoryOrReason ?? "")
      };
    }
    default: {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["parameters", "kind"],
            message: `Unknown parameter kind "${String(p.kind)}".`
          }
        ],
        "Unknown parameter kind."
      );
    }
  }
}

function validateClaimParameters(
  canonicalKind: CanonicalClaimKind,
  proofCategory: ClaimProofCategory,
  params: ClaimParameters
): void {
  if (params.kind !== canonicalKind) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["parameters", "kind"],
          message: `Parameter kind "${params.kind}" does not match declared canonicalKind "${canonicalKind}".`
        }
      ],
      "Parameter kind mismatch."
    );
  }

  if (canonicalKind === "unsupported_manual") {
    if (proofCategory !== "human_attested_unverified") {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["proofCategory"],
            message: "unsupported_manual claims must use proofCategory 'human_attested_unverified'."
          }
        ],
        "Invalid proofCategory for unsupported_manual claim."
      );
    }
  } else {
    if (proofCategory === "human_attested_unverified") {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["proofCategory"],
            message: `Claims of kind '${canonicalKind}' require verified source evidence and cannot use proofCategory 'human_attested_unverified'.`
          }
        ],
        "Invalid proofCategory for structured claim."
      );
    }
  }

  switch (params.kind) {
    case "factual_lot_identifier": {
      if (
        !params.lotIdentifier ||
        params.lotIdentifier.trim().length === 0 ||
        hasControlOrInvisibleChars(params.lotIdentifier)
      ) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_TEXT",
              path: ["parameters", "lotIdentifier"],
              message: "lotIdentifier must be a non-empty string."
            }
          ],
          "Invalid lotIdentifier."
        );
      }
      break;
    }
    case "packaged_or_harvest_date": {
      if (params.dateKind !== "packaged_on" && params.dateKind !== "harvested_on") {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["parameters", "dateKind"],
              message: "dateKind must be 'packaged_on' or 'harvested_on'."
            }
          ],
          "Invalid dateKind."
        );
      }
      if (!params.dateValue || !/^\d{4}-\d{2}-\d{2}$/.test(params.dateValue)) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_DATE",
              path: ["parameters", "dateValue"],
              message: "dateValue must be a valid YYYY-MM-DD date."
            }
          ],
          "Invalid dateValue."
        );
      }
      break;
    }
    case "certificate_panel_measurement": {
      if (proofCategory !== "coa_measurement_backed") {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["proofCategory"],
              message:
                "certificate_panel_measurement claims must use proofCategory 'coa_measurement_backed'."
            }
          ],
          "Invalid proofCategory for certificate measurements."
        );
      }
      if (!params.measurements || params.measurements.length === 0) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["parameters", "measurements"],
              message: "measurements list must not be empty."
            }
          ],
          "Empty measurements list."
        );
      }
      for (let i = 0; i < params.measurements.length; i++) {
        const m = params.measurements[i]!;
        if (!m.analyte || m.analyte.trim().length === 0) {
          throw new ProductValidationError(
            [
              {
                code: "INVALID_TEXT",
                path: ["parameters", "measurements", i, "analyte"],
                message: "analyte must not be empty."
              }
            ],
            "Empty analyte."
          );
        }
        if (!m.exactDecimalValue || !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(m.exactDecimalValue)) {
          throw new ProductValidationError(
            [
              {
                code: "INVALID_TEXT",
                path: ["parameters", "measurements", i, "exactDecimalValue"],
                message: "exactDecimalValue must be a valid decimal string."
              }
            ],
            "Invalid decimal value."
          );
        }
        if (compareDecimalStrings(m.exactDecimalValue, "0") < 0) {
          throw new ProductValidationError(
            [
              {
                code: "INVALID_TEXT",
                path: ["parameters", "measurements", i, "exactDecimalValue"],
                message: "Negative measurement values cannot support positive claims."
              }
            ],
            "Negative decimal value."
          );
        }
        if (!isSupportedAnalyticalTuple(m.unit, m.quantityKind)) {
          throw new ProductValidationError(
            [
              {
                code: "INVALID_FIELD_COMBINATION",
                path: ["parameters", "measurements", i, "unit"],
                message: "Unsupported analytical unit and quantityKind combination."
              }
            ],
            "Unsupported analytical tuple."
          );
        }
      }
      break;
    }
    case "cultivation_processing_lineage": {
      if (!params.operationCode || params.operationCode.trim().length === 0) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_TEXT",
              path: ["parameters", "operationCode"],
              message: "operationCode must not be empty."
            }
          ],
          "Empty operationCode."
        );
      }
      if (!params.claimedFacts || params.claimedFacts.length === 0) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["parameters", "claimedFacts"],
              message: "claimedFacts must contain at least one claim."
            }
          ],
          "Empty claimed facts."
        );
      }
      break;
    }
    case "logged_process_timing": {
      if (!params.operationName || params.operationName.trim().length === 0) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_TEXT",
              path: ["parameters", "operationName"],
              message: "operationName must not be empty."
            }
          ],
          "Empty operationName."
        );
      }
      if (params.timingKind === "duration") {
        if (
          !params.duration ||
          !params.duration.value ||
          !/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(params.duration.value)
        ) {
          throw new ProductValidationError(
            [
              {
                code: "INVALID_TEXT",
                path: ["parameters", "duration"],
                message: "duration value must be a valid decimal string."
              }
            ],
            "Invalid duration."
          );
        }
      } else if (params.timingKind === "timestamp_range") {
        if (!params.timestampRange || !params.timestampRange.start || !params.timestampRange.end) {
          throw new ProductValidationError(
            [
              {
                code: "INVALID_TIMESTAMP",
                path: ["parameters", "timestampRange"],
                message: "timestampRange must include start and end."
              }
            ],
            "Invalid timestampRange."
          );
        }
      }
      break;
    }
    case "unsupported_manual": {
      if (!params.proposedText || params.proposedText.trim().length === 0) {
        throw new ProductValidationError(
          [
            {
              code: "INVALID_TEXT",
              path: ["parameters", "proposedText"],
              message: "proposedText must not be empty."
            }
          ],
          "Empty proposed text."
        );
      }
      break;
    }
  }
}

export interface CreateClaimEvidenceLinkInput {
  readonly linkId?: ClaimLinkId | undefined;
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly claimRevision: number;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly sourceObjectId: SourceObjectId;
  readonly sourceSha256: Sha256Hex;
  readonly supportRole: ClaimSupportRole;
  readonly reportId?: CoaReportId | null | undefined;
  readonly reportRevision?: number | null | undefined;
  readonly measurementId?: CoaMeasurementId | null | undefined;
  readonly pinnedFactsRevision?: number | null | undefined;
  readonly attestation?: ClaimSourceFactAttestation | null | undefined;
  readonly derivativeAssetId?: DerivativeId | string | null | undefined;
}

export function createClaimEvidenceLink(input: CreateClaimEvidenceLinkInput): ClaimEvidenceLink {
  const linkId = input.linkId ?? createClaimLinkId(crypto.randomUUID());

  if (!isValidPositiveInt(input.claimRevision)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_REVISION",
          path: ["claimRevision"],
          message: "claimRevision must be a positive integer."
        }
      ],
      "Invalid claimRevision."
    );
  }
  if (!isValidPositiveInt(input.evidenceRevision)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_REVISION",
          path: ["evidenceRevision"],
          message: "evidenceRevision must be a positive integer."
        }
      ],
      "Invalid evidenceRevision."
    );
  }

  // All-or-none measurement tuple check
  const hasMeasurementId = Boolean(input.measurementId);
  const hasReportId = Boolean(input.reportId);
  const hasReportRevision = input.reportRevision !== null && input.reportRevision !== undefined;

  if (hasMeasurementId || hasReportId || hasReportRevision) {
    if (!hasMeasurementId || !hasReportId || !hasReportRevision) {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["measurementId", "reportId", "reportRevision"],
            message:
              "reportId, reportRevision, and measurementId must either all be present or all be absent."
          }
        ],
        "Incomplete measurement tuple."
      );
    }
  }

  if (hasMeasurementId) {
    if (input.supportRole !== "primary_measurement") {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["supportRole"],
            message:
              "Evidence links with measurementId must declare supportRole 'primary_measurement'."
          }
        ],
        "Support role mismatch for measurement link."
      );
    }
  } else {
    if (input.supportRole === "primary_measurement") {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["supportRole"],
            message:
              "Evidence links with supportRole 'primary_measurement' must provide a measurementId."
          }
        ],
        "Missing measurementId for primary_measurement."
      );
    }
  }

  if (input.pinnedFactsRevision !== null && input.pinnedFactsRevision !== undefined) {
    if (!isValidPositiveInt(input.pinnedFactsRevision)) {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_REVISION",
            path: ["pinnedFactsRevision"],
            message: "pinnedFactsRevision must be a positive integer."
          }
        ],
        "Invalid pinnedFactsRevision."
      );
    }
  }

  let attestation: ClaimSourceFactAttestation | null = null;
  if (input.attestation) {
    if (
      !input.attestation.factKind ||
      !input.attestation.factValue ||
      !input.attestation.fieldLocator ||
      !input.attestation.actorId
    ) {
      throw new ProductValidationError(
        [
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["attestation"],
            message: "Attestation must include factKind, factValue, fieldLocator, and actorId."
          }
        ],
        "Incomplete attestation."
      );
    }
    const occurredAt = canonicalizeUtcTimestamp(input.attestation.occurredAt);
    attestation = Object.freeze({
      factKind: input.attestation.factKind.trim(),
      factValue: input.attestation.factValue.trim(),
      fieldLocator: input.attestation.fieldLocator.trim(),
      attribution: input.attestation.attribution.trim(),
      actorId: input.attestation.actorId.trim(),
      occurredAt,
      verificationEventId: input.attestation.verificationEventId ?? null
    });
  }

  return Object.freeze({
    linkId,
    clientId: input.clientId,
    claimId: input.claimId,
    claimRevision: input.claimRevision,
    batchId: input.batchId,
    evidenceId: input.evidenceId,
    evidenceRevision: input.evidenceRevision,
    sourceObjectId: input.sourceObjectId,
    sourceSha256: input.sourceSha256,
    supportRole: input.supportRole,
    reportId: input.reportId ?? null,
    reportRevision: input.reportRevision ?? null,
    measurementId: input.measurementId ?? null,
    pinnedFactsRevision: input.pinnedFactsRevision ?? null,
    attestation,
    derivativeAssetId: input.derivativeAssetId ?? null
  });
}

export interface CreateClaimDecisionEventInput {
  readonly eventId?: ClaimDecisionEventId | undefined;
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly claimRevision: number;
  readonly decision: ClaimDecisionKind;
  readonly actorId: string;
  readonly occurredAt?: IsoTimestampString | undefined;
  readonly reason: string;
  readonly policyVersion?: string | undefined;
  readonly dependencyFingerprint?: string | null | undefined;
  readonly invalidationCause?: ClaimInvalidationCause | null | undefined;
  readonly sourceEventId?: string | null | undefined;
}

export function createClaimDecisionEvent(input: CreateClaimDecisionEventInput): ClaimDecisionEvent {
  const eventId = input.eventId ?? createClaimDecisionEventId(crypto.randomUUID());

  if (!isValidPositiveInt(input.claimRevision)) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_REVISION",
          path: ["claimRevision"],
          message: "claimRevision must be a positive integer."
        }
      ],
      "Invalid claimRevision."
    );
  }

  if (
    !input.actorId ||
    hasControlOrInvisibleChars(input.actorId) ||
    input.actorId.trim().length === 0
  ) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_TEXT",
          path: ["actorId"],
          message: "actorId must be a non-empty string without controls."
        }
      ],
      "Invalid actorId."
    );
  }

  if (
    !input.reason ||
    hasControlOrInvisibleChars(input.reason) ||
    input.reason.trim().length === 0
  ) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_TEXT",
          path: ["reason"],
          message: "reason must be a non-empty string without controls."
        }
      ],
      "Invalid reason."
    );
  }

  const policyVersion = input.policyVersion ?? CLAIM_POLICY_VERSION;
  const occurredAt = input.occurredAt
    ? canonicalizeUtcTimestamp(input.occurredAt)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  return Object.freeze({
    eventId,
    clientId: input.clientId,
    claimId: input.claimId,
    claimRevision: input.claimRevision,
    decision: input.decision,
    actorId: input.actorId.trim(),
    occurredAt,
    reason: input.reason.trim(),
    policyVersion,
    dependencyFingerprint: input.dependencyFingerprint ?? null,
    invalidationCause: input.invalidationCause ?? null,
    sourceEventId: input.sourceEventId ?? null
  });
}

// ============================================================================
// Rehydration Functions
// ============================================================================

export function rehydrateProductClaim(row: {
  readonly claimId: ClaimId;
  readonly clientId: ClientId;
  readonly skuId: SkuId;
  readonly batchId: BatchId;
  readonly currentRevision: number;
  readonly state: ClaimState;
  readonly version: number;
  readonly invalidationCause: ClaimInvalidationCause | null;
  readonly invalidationSourceRef: string | null;
  readonly createdAt: IsoTimestampString;
  readonly updatedAt: IsoTimestampString;
  readonly archivedAt: IsoTimestampString | null;
}): ProductClaim {
  return Object.freeze({
    claimId: row.claimId,
    clientId: row.clientId,
    skuId: row.skuId,
    batchId: row.batchId,
    currentRevision: row.currentRevision,
    state: row.state,
    version: row.version,
    invalidationCause: row.invalidationCause,
    invalidationSourceRef: row.invalidationSourceRef,
    createdAt: canonicalizeUtcTimestamp(row.createdAt),
    updatedAt: canonicalizeUtcTimestamp(row.updatedAt),
    archivedAt: row.archivedAt ? canonicalizeUtcTimestamp(row.archivedAt) : null
  });
}

export function rehydrateProductClaimRevision(row: {
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly revision: number;
  readonly batchId: BatchId;
  readonly canonicalKind: CanonicalClaimKind;
  readonly proofCategory: ClaimProofCategory;
  readonly parameters: ClaimParameters | unknown;
  readonly displayWording: string | null;
  readonly policyVersion: string;
  readonly assertedBy: string;
  readonly assertedAt: IsoTimestampString;
  readonly supersedesRevision: number | null;
}): ProductClaimRevision {
  const normalizedParams = normalizeClaimParameters(row.parameters);
  return Object.freeze({
    clientId: row.clientId,
    claimId: row.claimId,
    revision: row.revision,
    batchId: row.batchId,
    canonicalKind: row.canonicalKind,
    proofCategory: row.proofCategory,
    parameters: normalizedParams,
    displayWording: row.displayWording,
    policyVersion: row.policyVersion,
    assertedBy: row.assertedBy,
    assertedAt: canonicalizeUtcTimestamp(row.assertedAt),
    supersedesRevision: row.supersedesRevision
  });
}

export function rehydrateClaimEvidenceLink(row: {
  readonly linkId: ClaimLinkId;
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly claimRevision: number;
  readonly batchId: BatchId;
  readonly evidenceId: EvidenceId;
  readonly evidenceRevision: number;
  readonly sourceObjectId: SourceObjectId;
  readonly sourceSha256: Sha256Hex;
  readonly supportRole: ClaimSupportRole;
  readonly reportId?: CoaReportId | null | undefined;
  readonly reportRevision?: number | null | undefined;
  readonly measurementId?: CoaMeasurementId | null | undefined;
  readonly pinnedFactsRevision?: number | null | undefined;
  readonly attestation?: ClaimSourceFactAttestation | null | undefined;
  readonly derivativeAssetId?: DerivativeId | string | null | undefined;
}): ClaimEvidenceLink {
  return Object.freeze({
    linkId: row.linkId,
    clientId: row.clientId,
    claimId: row.claimId,
    claimRevision: row.claimRevision,
    batchId: row.batchId,
    evidenceId: row.evidenceId,
    evidenceRevision: row.evidenceRevision,
    sourceObjectId: row.sourceObjectId,
    sourceSha256: row.sourceSha256,
    supportRole: row.supportRole,
    reportId: row.reportId ?? null,
    reportRevision: row.reportRevision ?? null,
    measurementId: row.measurementId ?? null,
    pinnedFactsRevision: row.pinnedFactsRevision ?? null,
    attestation: row.attestation ?? null,
    derivativeAssetId: row.derivativeAssetId ?? null
  });
}

export function rehydrateClaimDecisionEvent(row: {
  readonly eventId: ClaimDecisionEventId;
  readonly clientId: ClientId;
  readonly claimId: ClaimId;
  readonly claimRevision: number;
  readonly decision: ClaimDecisionKind;
  readonly actorId: string;
  readonly occurredAt: IsoTimestampString;
  readonly reason: string;
  readonly policyVersion: string;
  readonly dependencyFingerprint?: string | null | undefined;
  readonly invalidationCause?: ClaimInvalidationCause | null | undefined;
  readonly sourceEventId?: string | null | undefined;
}): ClaimDecisionEvent {
  return Object.freeze({
    eventId: row.eventId,
    clientId: row.clientId,
    claimId: row.claimId,
    claimRevision: row.claimRevision,
    decision: row.decision,
    actorId: row.actorId,
    occurredAt: canonicalizeUtcTimestamp(row.occurredAt),
    reason: row.reason,
    policyVersion: row.policyVersion,
    dependencyFingerprint: row.dependencyFingerprint ?? null,
    invalidationCause: row.invalidationCause ?? null,
    sourceEventId: row.sourceEventId ?? null
  });
}

// ============================================================================
// State Transitions
// ============================================================================

export interface TransitionResult {
  readonly claim: ProductClaim;
  readonly decisionEvent: ClaimDecisionEvent;
}

export function linkEvidenceToClaim(
  claim: ProductClaim,
  expectedVersion: number,
  revision: number,
  links: readonly ClaimEvidenceLink[],
  actorId: string,
  reason: string,
  timestamp?: IsoTimestampString
): TransitionResult {
  if (claim.version !== expectedVersion) {
    throw new StaleRevisionConflictError("ProductClaim", expectedVersion, claim.version);
  }
  if (claim.currentRevision !== revision) {
    throw new NonMonotonicRevisionError(
      `Cannot link evidence to revision ${revision}: claim currentRevision is ${claim.currentRevision}.`
    );
  }
  if (claim.state !== "draft") {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["state"],
          message: `Cannot link evidence to claim in state "${claim.state}". Must be "draft".`
        }
      ],
      "Claim is not in draft state."
    );
  }
  if (links.length === 0) {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["links"],
          message: "Cannot seal empty evidence link set."
        }
      ],
      "Empty link set."
    );
  }

  const now = timestamp
    ? canonicalizeUtcTimestamp(timestamp)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  const decisionEvent = createClaimDecisionEvent({
    clientId: claim.clientId,
    claimId: claim.claimId,
    claimRevision: revision,
    decision: "link_evidence",
    actorId,
    reason,
    occurredAt: now
  });

  const updatedClaim = Object.freeze({
    ...claim,
    state: "evidence_linked" as const,
    version: claim.version + 1,
    updatedAt: now
  });

  return { claim: updatedClaim, decisionEvent };
}

export function reviewClaim(
  claim: ProductClaim,
  expectedVersion: number,
  revision: number,
  decision: "approve" | "reject",
  actorId: string,
  reason: string,
  authorId: string,
  attesterIds: readonly string[] = [],
  dependencyFingerprint?: string | null,
  timestamp?: IsoTimestampString
): TransitionResult {
  if (claim.version !== expectedVersion) {
    throw new StaleRevisionConflictError("ProductClaim", expectedVersion, claim.version);
  }
  if (claim.currentRevision !== revision) {
    throw new NonMonotonicRevisionError(
      `Cannot review revision ${revision}: claim currentRevision is ${claim.currentRevision}.`
    );
  }
  if (claim.state !== "evidence_linked") {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["state"],
          message: `Cannot review claim in state "${claim.state}". State must be "evidence_linked".`
        }
      ],
      "Claim is not in evidence_linked state."
    );
  }

  // Separation of duties check
  if (decision === "approve") {
    const normalizedActor = actorId.trim().toLowerCase();
    if (normalizedActor === authorId.trim().toLowerCase()) {
      throw new AccessDeniedError("Self-approval forbidden: reviewer cannot be the claim author.");
    }
    for (const attester of attesterIds) {
      if (normalizedActor === attester.trim().toLowerCase()) {
        throw new AccessDeniedError(
          "Self-approval forbidden: reviewer cannot be a source fact attester."
        );
      }
    }
  }

  const now = timestamp
    ? canonicalizeUtcTimestamp(timestamp)
    : canonicalizeUtcTimestamp(new Date().toISOString());
  const nextState: ClaimState = decision === "approve" ? "reviewer_approved" : "rejected";

  const decisionEvent = createClaimDecisionEvent({
    clientId: claim.clientId,
    claimId: claim.claimId,
    claimRevision: revision,
    decision,
    actorId,
    reason,
    dependencyFingerprint,
    occurredAt: now
  });

  const updatedClaim = Object.freeze({
    ...claim,
    state: nextState,
    version: claim.version + 1,
    updatedAt: now
  });

  return { claim: updatedClaim, decisionEvent };
}

export function invalidateClaim(
  claim: ProductClaim,
  cause: ClaimInvalidationCause,
  reason: string,
  sourceRef?: string | null,
  actorId = "system:cascade-invalidator",
  timestamp?: IsoTimestampString
): TransitionResult {
  if (claim.state !== "evidence_linked" && claim.state !== "reviewer_approved") {
    throw new ProductValidationError(
      [
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["state"],
          message: `Cannot invalidate claim in state "${claim.state}". Only active states "evidence_linked" and "reviewer_approved" can be invalidated.`
        }
      ],
      "Claim is not in an active invalidatable state."
    );
  }

  const now = timestamp
    ? canonicalizeUtcTimestamp(timestamp)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  const decisionEvent = createClaimDecisionEvent({
    clientId: claim.clientId,
    claimId: claim.claimId,
    claimRevision: claim.currentRevision,
    decision: "invalidate",
    actorId,
    reason,
    invalidationCause: cause,
    sourceEventId: sourceRef ?? undefined,
    occurredAt: now
  });

  const updatedClaim = Object.freeze({
    ...claim,
    state: "invalidated" as const,
    version: claim.version + 1,
    invalidationCause: cause,
    invalidationSourceRef: sourceRef ?? null,
    updatedAt: now
  });

  return { claim: updatedClaim, decisionEvent };
}

export function appendClaimRevisionToHead(
  claim: ProductClaim,
  expectedVersion: number,
  revisionInput: Omit<
    CreateProductClaimRevisionInput,
    "clientId" | "claimId" | "batchId" | "revision" | "supersedesRevision"
  >,
  timestamp?: IsoTimestampString
): { readonly claim: ProductClaim; readonly revision: ProductClaimRevision } {
  if (claim.version !== expectedVersion) {
    throw new StaleRevisionConflictError("ProductClaim", expectedVersion, claim.version);
  }

  const nextRevisionNumber = claim.currentRevision + 1;
  const newRevision = createProductClaimRevision({
    ...revisionInput,
    clientId: claim.clientId,
    claimId: claim.claimId,
    batchId: claim.batchId,
    revision: nextRevisionNumber,
    supersedesRevision: claim.currentRevision
  });

  const now = timestamp
    ? canonicalizeUtcTimestamp(timestamp)
    : canonicalizeUtcTimestamp(new Date().toISOString());

  const updatedClaim = Object.freeze({
    ...claim,
    currentRevision: nextRevisionNumber,
    state: "draft" as const,
    version: claim.version + 1,
    invalidationCause: null,
    invalidationSourceRef: null,
    updatedAt: now
  });

  return { claim: updatedClaim, revision: newRevision };
}
