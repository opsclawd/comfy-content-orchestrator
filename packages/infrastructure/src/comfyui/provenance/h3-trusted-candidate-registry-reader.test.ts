import { describe, expect, it } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalizeCapabilityMatrixPayload,
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  type H3CandidateExecutionSpecification,
  type H3CandidateProfile,
  type H3CapabilityDecisionRow,
  type H3CapabilityMatrixEnvelope
} from "@cco/contracts";
import {
  H3TrustedCandidateRegistryReader,
  H3CandidateRegistryReaderError
} from "./h3-trusted-candidate-registry-reader.js";

function createTestKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

const sampleEvidenceBytes = Buffer.from("sample-speed-and-quality-evidence-data", "utf8");
const sampleEvidenceDigest = createHash("sha256").update(sampleEvidenceBytes).digest("hex");

function createTestEvidenceResolver() {
  const map = new Map<string, Buffer>([[sampleEvidenceDigest, sampleEvidenceBytes]]);
  return (digest: string) => map.get(digest);
}

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
    frames: 192, // (192 - 5) % 17 === 0
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
    customNodes: [
      {
        name: "comfyui-sageattention",
        revision: "git-commit-abc123",
        sourceHash: "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd"
      }
    ],
    packageVersions: {
      torch: "2.5.1+cu124",
      sageattention: "0.2.1"
    },
    ...overrides
  };
}

function createValidProfile(spec: H3CandidateExecutionSpecification): H3CandidateProfile {
  const digest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(digest, 1);
  return {
    key,
    version: 1,
    specificationDigest: digest,
    specification: spec,
    topology: {
      prompt: { nodeId: "1", classType: "CLIPTextEncode", inputField: "text" },
      seed: { nodeId: "2", classType: "KSampler", inputField: "seed" },
      frameCount: { nodeId: "3", classType: "EmptyLatent", inputField: "frames" },
      firstFrame: { nodeId: "4", classType: "LoadImage", inputField: "image" },
      width: { nodeId: "3", classType: "EmptyLatent", inputField: "width" },
      height: { nodeId: "3", classType: "EmptyLatent", inputField: "height" }
    },
    status: "candidate"
  };
}

function createRef2vProfile(spec: H3CandidateExecutionSpecification): H3CandidateProfile {
  const digest = computeH3CandidateSpecificationDigest(spec);
  const key = computeH3CandidateKey(digest, 1);
  return {
    key,
    version: 1,
    specificationDigest: digest,
    specification: spec,
    topology: {
      prompt: { nodeId: "1", classType: "CLIPTextEncode", inputField: "text" },
      seed: { nodeId: "2", classType: "KSampler", inputField: "seed" },
      frameCount: { nodeId: "3", classType: "EmptyLatent", inputField: "frames" },
      referenceNode: { nodeId: "4", classType: "ReferenceNode", inputField: "ref" },
      referenceImages: [{ nodeId: "5", classType: "LoadImage", inputField: "image" }],
      referenceSlotFields: ["ref_1"],
      width: { nodeId: "3", classType: "EmptyLatent", inputField: "width" },
      height: { nodeId: "3", classType: "EmptyLatent", inputField: "height" }
    },
    status: "candidate"
  };
}

function signEnvelope(
  envelopePayload: Omit<H3CapabilityMatrixEnvelope, "signatureHex">,
  privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]
): H3CapabilityMatrixEnvelope {
  const canonical = canonicalizeCapabilityMatrixPayload(envelopePayload);
  const sig = sign(null, Buffer.from(canonical, "utf8"), privateKey);
  return {
    ...envelopePayload,
    signatureHex: sig.toString("hex")
  };
}

describe("H3TrustedCandidateRegistryReader", () => {
  it("admits compliant candidate profiles with passing #445 decision rows", () => {
    const { publicKey, privateKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: [sampleEvidenceDigest],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    const reader = new H3TrustedCandidateRegistryReader({
      candidateProfiles: [profile],
      decisionEnvelope: envelope,
      trustedPublicKeys: new Map([["op-key-1", publicKey]]),
      evidenceResolver: createTestEvidenceResolver()
    });

    expect(reader.isCandidateProfileKey(profile.key)).toBe(true);
    expect(reader.getCandidateProfile(profile.key)).toBeDefined();
    expect(reader.getCandidateProfile(profile.key)?.specification.frames).toBe(192);
    expect(reader.listCandidateProfiles()).toHaveLength(1);
    expect(Object.isFrozen(reader.getCandidateProfile(profile.key))).toBe(true);
  });

  it("fails closed when envelope signature is invalid or altered", () => {
    const { publicKey, privateKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    // Tamper with envelope matrixId
    const tampered = {
      ...envelope,
      matrixId: "matrix-445-tampered"
    };

    expect(
      () =>
        new H3TrustedCandidateRegistryReader({
          candidateProfiles: [profile],
          decisionEnvelope: tampered,
          trustedPublicKeys: new Map([["op-key-1", publicKey]])
        })
    ).toThrow(H3CandidateRegistryReaderError);
  });

  it("fails closed when envelope is signed by an untrusted key", () => {
    const { privateKey } = createTestKeys();
    const { publicKey: otherPublicKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "untrusted-key",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    expect(
      () =>
        new H3TrustedCandidateRegistryReader({
          candidateProfiles: [profile],
          decisionEnvelope: envelope,
          trustedPublicKeys: new Map([["trusted-key", otherPublicKey]])
        })
    ).toThrow(/Untrusted or unrecognized operator signer key ID/);
  });

  it("denies unoptimized 362f I2V variant (known creative NO-GO)", () => {
    const { publicKey, privateKey } = createTestKeys();
    const noGoSpec = createValidSpec({
      frames: 362,
      attention: {
        backend: "standard",
        customNodeRevision: "none",
        customNodeSourceHash: "none",
        packageVersion: "none",
        sparsitySettings: { enabled: false, method: "none", threshold: 0 }
      }
    });
    const noGoProfile = createValidProfile(noGoSpec);

    // 445 decision row marks it as "fail"
    const decisionRow: H3CapabilityDecisionRow = {
      specification: noGoSpec,
      specificationDigest: noGoProfile.specificationDigest,
      speedVerdict: "fail",
      qualityVerdict: "fail",
      overallVerdict: "fail",
      evidenceDigests: ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z",
      notes: "Known creative NO-GO blackout in #423"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    const reader = new H3TrustedCandidateRegistryReader({
      candidateProfiles: [noGoProfile],
      decisionEnvelope: envelope,
      trustedPublicKeys: new Map([["op-key-1", publicKey]])
    });

    expect(reader.isCandidateProfileKey(noGoProfile.key)).toBe(false);
    expect(reader.getCandidateProfile(noGoProfile.key)).toBeUndefined();
    expect(reader.listCandidateProfiles()).toHaveLength(0);
  });

  it("denies Ref2V when only I2V passes in the matrix (no cross-route inheritance)", () => {
    const { publicKey, privateKey } = createTestKeys();
    const i2vSpec = createValidSpec({ route: "i2v", routingMode: "frame_anchored", frames: 192 });
    const i2vProfile = createValidProfile(i2vSpec);

    const ref2vSpec = createValidSpec({
      route: "ref2v",
      routingMode: "reference_directed",
      frames: 192
    });
    const ref2vProfile = createRef2vProfile(ref2vSpec);

    // Envelope only has I2V passing row
    const i2vRow: H3CapabilityDecisionRow = {
      specification: i2vSpec,
      specificationDigest: i2vProfile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: [sampleEvidenceDigest],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [i2vRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    const reader = new H3TrustedCandidateRegistryReader({
      candidateProfiles: [i2vProfile, ref2vProfile],
      decisionEnvelope: envelope,
      trustedPublicKeys: new Map([["op-key-1", publicKey]]),
      evidenceResolver: createTestEvidenceResolver()
    });

    expect(reader.isCandidateProfileKey(i2vProfile.key)).toBe(true);
    expect(reader.getCandidateProfile(i2vProfile.key)).toBeDefined();

    // Ref2V is NOT admitted because it had no passing row
    expect(reader.isCandidateProfileKey(ref2vProfile.key)).toBe(false);
    expect(reader.getCandidateProfile(ref2vProfile.key)).toBeUndefined();
  });

  it("rejects duplicate rows or duplicate profile keys", () => {
    const { publicKey, privateKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: [sampleEvidenceDigest],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow, decisionRow], // duplicate row
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    expect(
      () =>
        new H3TrustedCandidateRegistryReader({
          candidateProfiles: [profile],
          decisionEnvelope: envelope,
          trustedPublicKeys: new Map([["op-key-1", publicKey]]),
          evidenceResolver: createTestEvidenceResolver()
        })
    ).toThrow(/Duplicate specificationDigest/);
  });

  it("fails closed when evidenceResolver is omitted for passing rows", () => {
    const { publicKey, privateKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: [sampleEvidenceDigest],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    expect(
      () =>
        new H3TrustedCandidateRegistryReader({
          candidateProfiles: [profile],
          decisionEnvelope: envelope,
          trustedPublicKeys: new Map([["op-key-1", publicKey]])
        })
    ).toThrow(/Missing required evidenceResolver/);
  });

  it("fails closed when evidence reference cannot be resolved", () => {
    const { publicKey, privateKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: [sampleEvidenceDigest],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    expect(
      () =>
        new H3TrustedCandidateRegistryReader({
          candidateProfiles: [profile],
          decisionEnvelope: envelope,
          trustedPublicKeys: new Map([["op-key-1", publicKey]]),
          evidenceResolver: () => undefined // cannot resolve
        })
    ).toThrow(/could not be resolved from deployment storage/);
  });

  it("fails closed when resolved evidence digest does not match declared digest (corrupt evidence)", () => {
    const { publicKey, privateKey } = createTestKeys();
    const spec = createValidSpec();
    const profile = createValidProfile(spec);

    const decisionRow: H3CapabilityDecisionRow = {
      specification: spec,
      specificationDigest: profile.specificationDigest,
      speedVerdict: "pass",
      qualityVerdict: "pass",
      overallVerdict: "pass",
      evidenceDigests: [sampleEvidenceDigest],
      operatorIdentity: "operator-445",
      decidedAt: "2026-10-18T10:00:00.000Z"
    };

    const envelope = signEnvelope(
      {
        version: 1,
        matrixId: "matrix-445-v1",
        rows: [decisionRow],
        signedBy: "op-key-1",
        signedAt: "2026-10-18T10:05:00.000Z"
      },
      privateKey
    );

    expect(
      () =>
        new H3TrustedCandidateRegistryReader({
          candidateProfiles: [profile],
          decisionEnvelope: envelope,
          trustedPublicKeys: new Map([["op-key-1", publicKey]]),
          evidenceResolver: () => Buffer.from("corrupted-evidence-bytes") // wrong hash
        })
    ).toThrow(/Evidence digest mismatch/);
  });
});
