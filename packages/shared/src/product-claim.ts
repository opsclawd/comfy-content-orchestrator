/**
 * Pure lexical constants, normalizers, and validators for product claims,
 * evidence links, decision events, and fail-closed block reasons.
 *
 * Sink layer: zero dependencies on domain, contracts, or Node I/O.
 */

import type { DateOnlyString, IsoTimestampString } from "./product-identity.js";
import type { DecimalString } from "./coa-measurement.js";

export const CLAIM_POLICY_VERSION = "claim_policy_v1";

export const CLAIM_STATES = [
  "draft",
  "evidence_linked",
  "reviewer_approved",
  "rejected",
  "invalidated"
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_DECISION_KINDS = ["link_evidence", "approve", "reject", "invalidate"] as const;
export type ClaimDecisionKind = (typeof CLAIM_DECISION_KINDS)[number];

export const CLAIM_INVALIDATION_CAUSES = [
  "source_superseded",
  "source_disputed",
  "source_archived",
  "source_quarantined",
  "integrity_failure",
  "batch_facts_changed"
] as const;
export type ClaimInvalidationCause = (typeof CLAIM_INVALIDATION_CAUSES)[number];

export const CLAIM_PROOF_CATEGORIES = [
  "coa_measurement_backed",
  "production_record_backed",
  "visual_evidence_backed",
  "human_attested_unverified"
] as const;
export type ClaimProofCategory = (typeof CLAIM_PROOF_CATEGORIES)[number];

export const CLAIM_SUPPORT_ROLES = [
  "primary_measurement",
  "corroborating_record",
  "visual_reference"
] as const;
export type ClaimSupportRole = (typeof CLAIM_SUPPORT_ROLES)[number];

export const CLAIM_PROVENANCE_CATEGORIES = [
  "lab_reported",
  "operator_attested_sop",
  "partner_process_record",
  "source_photo",
  "manual_unverified"
] as const;
export type ClaimProvenanceCategory = (typeof CLAIM_PROVENANCE_CATEGORIES)[number];

export const CANONICAL_CLAIM_KINDS = [
  "factual_lot_identifier",
  "packaged_or_harvest_date",
  "certificate_panel_measurement",
  "cultivation_processing_lineage",
  "logged_process_timing",
  "unsupported_manual"
] as const;
export type CanonicalClaimKind = (typeof CANONICAL_CLAIM_KINDS)[number];

export const CLAIM_DATE_KINDS = ["packaged_on", "harvested_on"] as const;
export type ClaimDateKind = (typeof CLAIM_DATE_KINDS)[number];

export const CLAIM_TIMING_KINDS = ["duration", "timestamp_range"] as const;
export type ClaimTimingKind = (typeof CLAIM_TIMING_KINDS)[number];

export const CLAIM_DURATION_UNITS = ["seconds", "minutes", "hours", "days"] as const;
export type ClaimDurationUnit = (typeof CLAIM_DURATION_UNITS)[number];

export const CLAIM_BLOCK_REASON_CODES = [
  "TENANT_MISMATCH",
  "BATCH_MISMATCH",
  "SKU_MISMATCH",
  "PARENT_ARCHIVED",
  "SOURCE_NOT_FOUND",
  "SOURCE_DIGEST_MISMATCH",
  "SOURCE_ARCHIVED",
  "SOURCE_QUARANTINED",
  "SOURCE_SUPERSEDED",
  "SOURCE_DISPUTED",
  "VERIFICATION_WITHDRAWN",
  "VERIFICATION_MISSING",
  "SCOPE_INSUFFICIENT",
  "REPORT_DRAFT_INCOMPLETE",
  "REPORT_NOT_APPROVED",
  "REPORT_REJECTED",
  "MEASUREMENT_NOT_FOUND",
  "MEASUREMENT_MISMATCH",
  "FACTS_SUPERSEDED",
  "SOURCE_FACT_MISMATCH",
  "UNSUPPORTED_CLAIM_FAMILY",
  "UNSUPPORTED_PROMOTIONAL_COPY",
  "CLAIM_REVIEW_MISSING",
  "CLAIM_REVIEW_REJECTED",
  "CLAIM_INVALIDATED",
  "SELF_APPROVAL_FORBIDDEN",
  "EVIDENCE_LINKS_MISSING"
] as const;
export type ClaimBlockReasonCode = (typeof CLAIM_BLOCK_REASON_CODES)[number];

export interface ClaimBlockReason {
  readonly code: ClaimBlockReasonCode;
  readonly dependencyId?: string | undefined;
  readonly message: string;
}

// ----------------------------------------------------------------------------
// Structured Parameters for Canonical Claim Kinds
// ----------------------------------------------------------------------------

export interface FactualLotIdentifierParameters {
  readonly kind: "factual_lot_identifier";
  readonly lotIdentifier: string;
}

export interface PackagedOrHarvestDateParameters {
  readonly kind: "packaged_or_harvest_date";
  readonly dateKind: ClaimDateKind;
  readonly dateValue: DateOnlyString;
  readonly reportedPrecision: "date" | "minute" | "second" | "millisecond";
}

export interface CertificatePanelMeasurementItem {
  readonly analyte: string;
  readonly exactDecimalValue: DecimalString;
  readonly unit: string;
  readonly quantityKind: string;
  readonly basis: string;
  readonly context: string;
  readonly requiredScope: "sample_only" | "attributed_lot";
}

export interface CertificatePanelMeasurementParameters {
  readonly kind: "certificate_panel_measurement";
  readonly panelName?: string | undefined;
  readonly measurements: readonly CertificatePanelMeasurementItem[];
}

export interface CultivationProcessingLineageParameters {
  readonly kind: "cultivation_processing_lineage";
  readonly operationCode: string;
  readonly originKind: "own_production" | "partner_origin";
  readonly attributedParty?: string | undefined;
  readonly claimedFacts: readonly string[];
}

export interface LoggedProcessTimingDuration {
  readonly value: DecimalString;
  readonly unit: ClaimDurationUnit;
}

export interface LoggedProcessTimingRange {
  readonly start: IsoTimestampString;
  readonly end: IsoTimestampString;
}

export interface LoggedProcessTimingParameters {
  readonly kind: "logged_process_timing";
  readonly operationName: string;
  readonly timingKind: ClaimTimingKind;
  readonly duration?: LoggedProcessTimingDuration | undefined;
  readonly timestampRange?: LoggedProcessTimingRange | undefined;
}

export interface UnsupportedManualParameters {
  readonly kind: "unsupported_manual";
  readonly proposedText: string;
  readonly categoryOrReason: string;
}

export type ClaimParameters =
  | FactualLotIdentifierParameters
  | PackagedOrHarvestDateParameters
  | CertificatePanelMeasurementParameters
  | CultivationProcessingLineageParameters
  | LoggedProcessTimingParameters
  | UnsupportedManualParameters;
