import { describe, expect, it } from "vitest";
import {
  archiveEvidenceAsset,
  createBatchEvidenceLink,
  createEvidenceAsset,
  createEvidenceDerivative,
  createEvidenceRevision,
  createEvidenceVerificationEvent,
  evaluateEvidenceEligibility,
  supersedeEvidence,
  validateCaptureTimestampConsistency
} from "./evidence-asset.js";
import {
  createBatchId,
  createClientId,
  createEvidenceId,
  createSha256Hex,
  createSourceObjectId
} from "./identifiers.js";
import {
  AccessDeniedError,
  NonMonotonicRevisionError,
  ProductValidationError,
  StaleRevisionConflictError
} from "./product-evidence-errors.js";
import { createSourceObject } from "./source-object.js";

describe("SourceObject Domain Invariants", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const sha = createSha256Hex("a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0");
  const validKey = `clients/${clientId}/evidence/originals/${sha}`;

  it("creates a valid frozen SourceObject", () => {
    const obj = createSourceObject({
      clientId,
      storageBucket: "godzspeed-evidence",
      storageObjectKey: validKey,
      originalSha256: sha,
      detectedMimeType: "image/jpeg",
      byteLength: 1024,
      uploaderId: "photographer_bob",
      retentionPolicyVersion: "v1-legal-hold"
    });

    expect(obj.clientId).toBe(clientId);
    expect(obj.originalSha256).toBe(sha);
    expect(obj.accessClass).toBe("restricted_original");
    expect(obj.retentionClass).toBe("source_evidence_archive");
    expect(obj.availability).toBe("available");
    expect(Object.isFrozen(obj)).toBe(true);
  });

  it("rejects non-canonical storageObjectKey", () => {
    expect(() =>
      createSourceObject({
        clientId,
        storageBucket: "godzspeed-evidence",
        storageObjectKey: "arbitrary/path/file.jpg",
        originalSha256: sha,
        detectedMimeType: "image/jpeg",
        byteLength: 1024,
        uploaderId: "photographer_bob",
        retentionPolicyVersion: "v1-legal-hold"
      })
    ).toThrow(ProductValidationError);
  });

  it("rejects non-positive byteLength", () => {
    expect(() =>
      createSourceObject({
        clientId,
        storageBucket: "godzspeed-evidence",
        storageObjectKey: validKey,
        originalSha256: sha,
        detectedMimeType: "image/jpeg",
        byteLength: 0,
        uploaderId: "photographer_bob",
        retentionPolicyVersion: "v1-legal-hold"
      })
    ).toThrow(ProductValidationError);
  });
});

describe("EvidenceAsset and EvidenceRevision Invariants", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const evidenceId = createEvidenceId("018f0000-0006-7000-8000-000000000001");
  const sourceObjectId = createSourceObjectId("018f0000-0003-7000-8000-000000000001");

  it("creates evidence asset with revision 1 and version 1", () => {
    const asset = createEvidenceAsset({ clientId, evidenceId });
    expect(asset.currentRevision).toBe(1);
    expect(asset.version).toBe(1);
    expect(asset.archivedAt).toBeNull();
  });

  it("supersedes evidence asset under expectedVersion check", () => {
    const asset = createEvidenceAsset({ clientId, evidenceId });
    const { previous, current } = supersedeEvidence(asset, 1);
    expect(previous.version).toBe(1);
    expect(current.version).toBe(2);
    expect(current.currentRevision).toBe(2);

    expect(() => supersedeEvidence(current, 1)).toThrow(StaleRevisionConflictError);
  });

  it("archives evidence asset and blocks further supersession", () => {
    const asset = createEvidenceAsset({ clientId, evidenceId });
    const { current: archived } = archiveEvidenceAsset(asset, 1);
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.version).toBe(2);

    expect(() => supersedeEvidence(archived, 2)).toThrow(AccessDeniedError);
    expect(() => archiveEvidenceAsset(archived, 2)).toThrow(AccessDeniedError);
  });

  it("creates revision 1 with supersedesRevision = null", () => {
    const rev1 = createEvidenceRevision({
      clientId,
      evidenceId,
      revision: 1,
      sourceObjectId,
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      submittedBy: "alice",
      assertionText: "Photo of packaging label"
    });

    expect(rev1.revision).toBe(1);
    expect(rev1.supersedesRevision).toBeNull();
  });

  it("rejects revision 1 with non-null predecessor", () => {
    expect(() =>
      createEvidenceRevision({
        clientId,
        evidenceId,
        revision: 1,
        sourceObjectId,
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        submittedBy: "alice",
        assertionText: "Photo of packaging label",
        supersedesRevision: 1
      })
    ).toThrow(NonMonotonicRevisionError);
  });

  it("enforces monotonic predecessor on revision > 1", () => {
    const rev2 = createEvidenceRevision({
      clientId,
      evidenceId,
      revision: 2,
      sourceObjectId,
      sourceClass: "photo",
      acquisitionMethod: "direct_upload",
      submittedBy: "alice",
      assertionText: "Updated photo of packaging label",
      supersedesRevision: 1
    });
    expect(rev2.revision).toBe(2);
    expect(rev2.supersedesRevision).toBe(1);

    expect(() =>
      createEvidenceRevision({
        clientId,
        evidenceId,
        revision: 2,
        sourceObjectId,
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        submittedBy: "alice",
        assertionText: "Forked revision",
        supersedesRevision: null
      })
    ).toThrow(NonMonotonicRevisionError);

    expect(() =>
      createEvidenceRevision({
        clientId,
        evidenceId,
        revision: 3,
        sourceObjectId,
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        submittedBy: "alice",
        assertionText: "Skipped revision",
        supersedesRevision: 1 // Must be 2
      })
    ).toThrow(NonMonotonicRevisionError);
  });

  it("validates capture timestamp and date consistency (ADR 0009 additive refinement)", () => {
    // Matching date and timestamp
    const res = validateCaptureTimestampConsistency(
      "2026-03-24",
      "2026-03-24T14:30:00.000Z",
      "second"
    );
    expect(res.reportedCaptureDate).toBe("2026-03-24");
    expect(res.reportedCaptureTimestamp).toBe("2026-03-24T14:30:00.000Z");
    expect(res.reportedCapturePrecision).toBe("second");

    // Mismatched date and timestamp throws
    expect(() =>
      validateCaptureTimestampConsistency("2026-03-24", "2026-03-25T14:30:00.000Z")
    ).toThrow(ProductValidationError);

    // Only timestamp derives date
    const fromTime = validateCaptureTimestampConsistency(null, "2026-03-24T10:00:00.000Z");
    expect(fromTime.reportedCaptureDate).toBe("2026-03-24");

    // Neither provided
    const empty = validateCaptureTimestampConsistency(null, null);
    expect(empty.reportedCaptureDate).toBeNull();
    expect(empty.reportedCaptureTimestamp).toBeNull();
  });
});

describe("BatchEvidenceLink and Derivative Lineage", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const batchId = createBatchId("018f0000-0002-7000-8000-000000000001");
  const evidenceId = createEvidenceId("018f0000-0006-7000-8000-000000000001");

  it("creates a valid batch evidence link", () => {
    const link = createBatchEvidenceLink({
      clientId,
      batchId,
      evidenceId,
      evidenceRevision: 1,
      purpose: "macro_hero_photo",
      assertedBy: "ops_lead"
    });

    expect(link.purpose).toBe("macro_hero_photo");
    expect(link.evidenceRevision).toBe(1);
  });

  it("creates evidence derivative referencing existing reference asset", () => {
    const refId = "018f0000-0004-7000-8000-000000000001";
    const derivSha = createSha256Hex(
      "f0e1d2c3b4a596877890123456789abcdef0123456789abcdef0123456789abc"
    );

    const deriv = createEvidenceDerivative({
      clientId,
      evidenceId,
      evidenceRevision: 1,
      referenceAssetId: refId,
      derivativeSha256: derivSha,
      transformDescription: "Lanczos 1344x768 WebP",
      transformToolVersion: "sharp-0.34.5",
      createdBy: "creative_tech"
    });

    expect(deriv.referenceAssetId).toBe(refId);
    expect(deriv.derivativeSha256).toBe(derivSha);
  });
});

describe("Evidence Eligibility Projection & Verification Events", () => {
  const clientId = createClientId("018f0000-0000-7000-8000-000000000001");
  const evidenceId = createEvidenceId("018f0000-0006-7000-8000-000000000001");
  const sha = createSha256Hex("a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0");
  const validKey = `clients/${clientId}/evidence/originals/${sha}`;

  const source = createSourceObject({
    clientId,
    storageBucket: "godzspeed-evidence",
    storageObjectKey: validKey,
    originalSha256: sha,
    detectedMimeType: "image/jpeg",
    byteLength: 1024,
    uploaderId: "photographer_bob",
    retentionPolicyVersion: "v1-legal-hold"
  });

  const asset = createEvidenceAsset({ clientId, evidenceId });

  it("is eligible when source is available and no events", () => {
    const res = evaluateEvidenceEligibility(asset, source, []);
    expect(res.isEligible).toBe(true);
    expect(res.reason).toBe("eligible");
  });

  it("is ineligible when source is quarantined or archived", () => {
    const quarantinedSource = { ...source, availability: "quarantined" as const };
    const resQ = evaluateEvidenceEligibility(asset, quarantinedSource, []);
    expect(resQ.isEligible).toBe(false);
    expect(resQ.reason).toBe("source_quarantined");

    const archivedSource = { ...source, availability: "archived" as const };
    const resA = evaluateEvidenceEligibility(asset, archivedSource, []);
    expect(resA.isEligible).toBe(false);
    expect(resA.reason).toBe("source_archived");
  });

  it("is ineligible when an active dispute event exists", () => {
    const disputeEvent = createEvidenceVerificationEvent({
      clientId,
      evidenceId,
      evidenceRevision: 1,
      outcome: "disputed",
      verificationKind: "independent_third_party_corroboration",
      factScope: "full_document_authenticity",
      actorId: "auditor_jane",
      method: "lab_audit",
      reason: "Chain of custody discrepancy reported"
    });

    const res = evaluateEvidenceEligibility(asset, source, [disputeEvent]);
    expect(res.isEligible).toBe(false);
    expect(res.reason).toBe("source_disputed");
    expect(res.activeDisputeEvent?.eventId).toBe(disputeEvent.eventId);
  });

  it("restores eligibility when a dispute event is subsequently withdrawn", () => {
    const disputeEvent = createEvidenceVerificationEvent({
      clientId,
      evidenceId,
      evidenceRevision: 1,
      outcome: "disputed",
      verificationKind: "independent_third_party_corroboration",
      factScope: "full_document_authenticity",
      actorId: "auditor_jane",
      method: "lab_audit",
      reason: "Chain of custody discrepancy reported"
    });

    const withdrawalEvent = createEvidenceVerificationEvent({
      clientId,
      evidenceId,
      evidenceRevision: 1,
      outcome: "withdrawn",
      verificationKind: "human_internal_review",
      factScope: "full_document_authenticity",
      actorId: "compliance_lead",
      method: "audit_resolution",
      reason: "Discrepancy resolved with supplemental transport manifest",
      withdrawalEventId: disputeEvent.eventId
    });

    const res = evaluateEvidenceEligibility(asset, source, [disputeEvent, withdrawalEvent]);
    expect(res.isEligible).toBe(true);
    expect(res.reason).toBe("eligible");
  });
});
