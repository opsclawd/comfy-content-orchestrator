import { describe, expect, it } from "vitest";
import {
  H3CapabilityDecisionRowSchema,
  H3CapabilityMatrixEnvelopeSchema,
  H3CandidateAuthorizationPayloadSchema,
  H3CandidateAuthorizationGrantSchema,
  computeCapabilityMatrixDigest,
  canonicalizeCapabilityMatrixPayload,
  computeAuthorizationPayloadDigest,
  canonicalizeAuthorizationPayload,
  type H3CapabilityDecisionRow,
  type H3CandidateAuthorizationPayload
} from "./h3-capability-decision.js";
import {
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  type H3CandidateExecutionSpecification
} from "./h3-candidate-profile.js";

function createValidSpec(
  overrides: Partial<H3CandidateExecutionSpecification> = {}
): H3CandidateExecutionSpecification {
  return {
    version: 1,
    route: "i2v",
    routingMode: "frame_anchored",
    width: 1344,
    height: 768,
    fps: 24,
    frames: 124,
    workflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
    modelHashes: {
      checkpoint: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
      clip: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
      audioVae: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
      videoVae: "52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e",
      turboLora: "none",
      additionalModels: {}
    },
    sampler: "euler",
    scheduler: "simple",
    steps: 20,
    cfg: 1.0,
    denoise: 1.0,
    attention: {
      backend: "sage_attn",
      customNodeRevision: "v1.0.0",
      customNodeSourceHash: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      packageVersion: "0.2.1",
      sparsitySettings: {
        enabled: false,
        method: "none",
        threshold: 0
      }
    },
    runnerSettings: {
      runnerProfile: "dynamicvram-offload-v1",
      offloadPolicy: "dynamicvram",
      requiresModelOffloading: true,
      maxConcurrentGpuJobs: 1,
      minFreeDiskGb: 50
    },
    customNodes: [],
    packageVersions: {
      torch: "2.5.1+cu124"
    },
    ...overrides
  };
}

describe("H3 Capability Decision & Matrix Contracts", () => {
  it("accepts a compliant capability decision row with pass verdicts", () => {
    const spec = createValidSpec();
    const digest = computeH3CandidateSpecificationDigest(spec);

    const row: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: digest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: ["abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    expect(H3CapabilityDecisionRowSchema.safeParse(row).success).toBe(true);
  });

  it("rejects overallVerdict pass when speed or quality is fail/unknown", () => {
    const spec = createValidSpec();
    const digest = computeH3CandidateSpecificationDigest(spec);

    const failSpeed: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: digest,
      speedVerdict: "fail",
      qualityVerdict: "pass",
      overallVerdict: "pass", // Invalid!
      evidenceDigests: ["abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };
    expect(H3CapabilityDecisionRowSchema.safeParse(failSpeed).success).toBe(false);

    const unknownQuality: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: digest,
      speedVerdict: "pass",
      qualityVerdict: "unknown",
      overallVerdict: "pass", // Invalid!
      evidenceDigests: ["abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };
    expect(H3CapabilityDecisionRowSchema.safeParse(unknownQuality).success).toBe(false);
  });

  it("accepts fail and unknown overall verdicts with matching component verdicts", () => {
    const spec = createValidSpec();
    const digest = computeH3CandidateSpecificationDigest(spec);

    const failRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: digest,
      speedVerdict: "pass",
      qualityVerdict: "fail",
      overallVerdict: "fail",
      evidenceDigests: ["abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z",
      notes: "Visual blackout at frame 300"
    };
    expect(H3CapabilityDecisionRowSchema.safeParse(failRow).success).toBe(true);
  });

  it("validates matrix envelope and canonical digest", () => {
    const spec = createValidSpec();
    const digest = computeH3CandidateSpecificationDigest(spec);

    const envelope = {
      version: 1 as const,
      matrixId: "h3-optimization-matrix-2026-10-18",
      rows: [
        {
          specification: spec,
          specificationDigest: digest,
          speedVerdict: "pass" as const,
          qualityVerdict: "pass" as const,
          overallVerdict: "pass" as const,
          evidenceDigests: ["abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"],
          operatorIdentity: "operator-445",
          decidedAt: "2026-10-18T10:00:00.000Z"
        }
      ],
      signedBy: "operator-445-key-1",
      signatureHex: "abcd1234ef5678",
      signedAt: "2026-10-18T10:05:00.000Z"
    };

    expect(H3CapabilityMatrixEnvelopeSchema.safeParse(envelope).success).toBe(true);

    const { signatureHex, ...payload } = envelope;
    expect(signatureHex).toBe("abcd1234ef5678");
    const canonical = canonicalizeCapabilityMatrixPayload(payload);
    const matrixDigest = computeCapabilityMatrixDigest(payload);
    expect(canonical).toContain("h3-optimization-matrix-2026-10-18");
    expect(matrixDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("H3 Candidate Authorization Grant Contracts", () => {
  function createValidPayload(
    overrides: Partial<H3CandidateAuthorizationPayload> = {}
  ): H3CandidateAuthorizationPayload {
    const spec = createValidSpec();
    const specDigest = computeH3CandidateSpecificationDigest(spec);
    const key = computeH3CandidateKey(specDigest, 1);

    return {
      version: 1,
      candidateKey: key,
      specificationDigest: specDigest,
      goldMasterWorkflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
      goldMasterModelHashesDigest:
        "5555555555555555555555555555555555555555555555555555555555555555",
      targetHostname: "render-node-01",
      targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      purpose: "staging",
      scope: "staging",
      issuedAt: "2026-10-18T12:00:00.000Z",
      expiresAt: "2026-10-18T18:00:00.000Z",
      operatorId: "operator-428",
      ...overrides
    };
  }

  it("accepts a compliant staging authorization grant payload", () => {
    const payload = createValidPayload();
    expect(H3CandidateAuthorizationPayloadSchema.safeParse(payload).success).toBe(true);

    const grant = {
      payload,
      signature: "0123456789abcdef",
      signerKeyId: "op-428-staging-key"
    };
    expect(H3CandidateAuthorizationGrantSchema.safeParse(grant).success).toBe(true);
  });

  it("rejects grant with expiresAt before or equal to issuedAt", () => {
    const invalid = createValidPayload({
      issuedAt: "2026-10-18T12:00:00.000Z",
      expiresAt: "2026-10-18T11:59:59.000Z"
    });
    expect(H3CandidateAuthorizationPayloadSchema.safeParse(invalid).success).toBe(false);

    const equal = createValidPayload({
      issuedAt: "2026-10-18T12:00:00.000Z",
      expiresAt: "2026-10-18T12:00:00.000Z"
    });
    expect(H3CandidateAuthorizationPayloadSchema.safeParse(equal).success).toBe(false);
  });

  it("rejects staging scope grant presented for production purpose", () => {
    const invalid = createValidPayload({
      purpose: "production",
      scope: "staging"
    });
    expect(H3CandidateAuthorizationPayloadSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts production grant with purpose production and scope production", () => {
    const valid = createValidPayload({
      purpose: "production",
      scope: "production"
    });
    expect(H3CandidateAuthorizationPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("computes canonical authorization payload digest deterministically", () => {
    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const digest = computeAuthorizationPayloadDigest(payload);

    expect(canonical).toContain("operator-428");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
