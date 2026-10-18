import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalizeAuthorizationPayload,
  type H3CandidateAuthorizationPayload,
  type H3CandidateAuthorizationGrant
} from "@cco/contracts";
import { H3OperatorSignatureVerifier } from "./h3-operator-signature-verifier.js";

function createTestKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey, privateKey };
}

function createRsaTestKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048
  });
  return { publicKey, privateKey };
}

function createValidPayload(
  overrides: Partial<H3CandidateAuthorizationPayload> = {}
): H3CandidateAuthorizationPayload {
  return {
    version: 1,
    candidateKey: "H3_CANDIDATE_1234567890abcdef1234567890abcdef_V1",
    specificationDigest: "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    goldMasterWorkflowHash: "4d1aafd575ceecb6146b1b96d5c5b13f759fea5eb47f28aabfd92965765c142e",
    goldMasterModelHashesDigest: "5555555555555555555555555555555555555555555555555555555555555555",
    targetHostname: "render-node-01",
    targetGpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
    purpose: "staging",
    scope: "staging",
    issuedAt: "2026-10-18T10:00:00.000Z",
    expiresAt: "2026-10-18T20:00:00.000Z",
    operatorId: "operator-428",
    ...overrides
  };
}

describe("H3OperatorSignatureVerifier", () => {
  const fixedNow = new Date("2026-10-18T12:00:00.000Z");

  it("verifies compliant Ed25519 grant against trusted operator key", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["op-428-key-1", publicKey]]);

    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "op-428-key-1"
    };

    const result = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });

    expect(result.authorized).toBe(true);
    expect(result.scope).toBe("staging");
  });

  it("verifies compliant RSA grant with SHA-256 fallback", async () => {
    const { publicKey, privateKey } = createRsaTestKeys();
    const trustedKeys = new Map([["op-rsa-key", publicKey]]);

    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign("SHA256", Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "op-rsa-key"
    };

    const result = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });

    expect(result.authorized).toBe(true);
    expect(result.scope).toBe("staging");
  });

  it("fails closed when signerKeyId is not in trusted keys", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["legitimate-key", publicKey]]);

    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "untrusted-attacker-key" // Not in trustedKeys!
    };

    const result = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });

    expect(result.authorized).toBe(false);
    expect(result.blocker).toMatch(/untrusted or unrecognized/i);
  });

  it("fails closed when candidateKey or specificationDigest mismatches request", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["op-key", publicKey]]);
    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "op-key"
    };

    const resultKeyMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: "H3_CANDIDATE_different_key_V1",
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(resultKeyMismatch.authorized).toBe(false);
    expect(resultKeyMismatch.blocker).toMatch(/candidateKey mismatch/i);

    const resultDigestMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: "0000000000000000000000000000000000000000000000000000000000000000",
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(resultDigestMismatch.authorized).toBe(false);
    expect(resultDigestMismatch.blocker).toMatch(/specificationDigest mismatch/i);
  });

  it("fails closed when goldMasterWorkflowHash or goldMasterModelHashesDigest mismatches request", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["op-key", publicKey]]);
    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "op-key"
    };

    const wfMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: "1111111111111111111111111111111111111111111111111111111111111111",
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(wfMismatch.authorized).toBe(false);
    expect(wfMismatch.blocker).toMatch(/goldMasterWorkflowHash mismatch/i);

    const modelDigestMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest:
        "2222222222222222222222222222222222222222222222222222222222222222",
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(modelDigestMismatch.authorized).toBe(false);
    expect(modelDigestMismatch.blocker).toMatch(/goldMasterModelHashesDigest mismatch/i);
  });

  it("fails closed when grant purpose mismatches request purpose", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["op-key", publicKey]]);
    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload({ purpose: "staging", scope: "staging" });
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "op-key"
    };

    const purposeMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "production"
    });
    expect(purposeMismatch.authorized).toBe(false);
    expect(purposeMismatch.blocker).toMatch(/purpose mismatch/i);
  });

  it("fails closed when grant fails schema validation or has unsupported version", async () => {
    const { publicKey } = createTestKeys();
    const trustedKeys = new Map([["op-key", publicKey]]);
    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const invalidGrant = {
      payload: { ...payload, unknownField: "unexpected" },
      signature: "0123456789abcdef",
      signerKeyId: "op-key"
    } as unknown as H3CandidateAuthorizationGrant;

    const invalidResult = await verifier.verifyCandidateAuthorization({
      grant: invalidGrant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(invalidResult.authorized).toBe(false);
    expect(invalidResult.blocker).toMatch(/Invalid authorization grant schema/i);

    const version2Payload = {
      ...payload,
      version: 2
    } as unknown as H3CandidateAuthorizationPayload;
    const version2Grant = {
      payload: version2Payload,
      signature: "0123456789abcdef",
      signerKeyId: "op-key"
    } as unknown as H3CandidateAuthorizationGrant;

    const version2Result = await verifier.verifyCandidateAuthorization({
      grant: version2Grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(version2Result.authorized).toBe(false);
    expect(version2Result.blocker).toMatch(/Invalid authorization grant schema/i);
  });

  it("fails closed when target hostname or GPU UUID mismatches request", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["op-key", publicKey]]);
    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    const signature = sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("hex");

    const grant: H3CandidateAuthorizationGrant = {
      payload,
      signature,
      signerKeyId: "op-key"
    };

    const hostMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: "other-node",
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });
    expect(hostMismatch.authorized).toBe(false);
    expect(hostMismatch.blocker).toMatch(/targetHostname mismatch/i);

    const gpuMismatch = await verifier.verifyCandidateAuthorization({
      grant,
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: "GPU-different-uuid",
      purpose: "staging"
    });
    expect(gpuMismatch.authorized).toBe(false);
    expect(gpuMismatch.blocker).toMatch(/targetGpuUuid mismatch/i);
  });

  it("fails closed when grant is expired or not yet valid", async () => {
    const { publicKey, privateKey } = createTestKeys();
    const trustedKeys = new Map([["op-key", publicKey]]);

    // Expired grant
    const expiredPayload = createValidPayload({
      issuedAt: "2026-10-18T08:00:00.000Z",
      expiresAt: "2026-10-18T10:00:00.000Z"
    });
    const expiredSig = sign(
      null,
      Buffer.from(canonicalizeAuthorizationPayload(expiredPayload), "utf8"),
      privateKey
    ).toString("hex");

    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow // 12:00:00 (after expiresAt)
    });

    const expiredResult = await verifier.verifyCandidateAuthorization({
      grant: { payload: expiredPayload, signature: expiredSig, signerKeyId: "op-key" },
      candidateKey: expiredPayload.candidateKey,
      specificationDigest: expiredPayload.specificationDigest,
      goldMasterWorkflowHash: expiredPayload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: expiredPayload.goldMasterModelHashesDigest,
      targetHostname: expiredPayload.targetHostname,
      targetGpuUuid: expiredPayload.targetGpuUuid,
      purpose: "staging"
    });
    expect(expiredResult.authorized).toBe(false);
    expect(expiredResult.blocker).toMatch(/expired/i);

    // Future grant (not yet valid)
    const futurePayload = createValidPayload({
      issuedAt: "2026-10-18T14:00:00.000Z",
      expiresAt: "2026-10-18T20:00:00.000Z"
    });
    const futureSig = sign(
      null,
      Buffer.from(canonicalizeAuthorizationPayload(futurePayload), "utf8"),
      privateKey
    ).toString("hex");

    const futureResult = await verifier.verifyCandidateAuthorization({
      grant: { payload: futurePayload, signature: futureSig, signerKeyId: "op-key" },
      candidateKey: futurePayload.candidateKey,
      specificationDigest: futurePayload.specificationDigest,
      goldMasterWorkflowHash: futurePayload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: futurePayload.goldMasterModelHashesDigest,
      targetHostname: futurePayload.targetHostname,
      targetGpuUuid: futurePayload.targetGpuUuid,
      purpose: "staging"
    });
    expect(futureResult.authorized).toBe(false);
    expect(futureResult.blocker).toMatch(/not yet valid/i);
  });

  it("fails closed when cryptographic signature is invalid or forged", async () => {
    const { publicKey } = createTestKeys();
    const untrustedPair = createTestKeys(); // Key pair NOT trusted by verifier
    const trustedKeys = new Map([["op-key", publicKey]]);

    const verifier = new H3OperatorSignatureVerifier({
      trustedPublicKeys: trustedKeys,
      now: () => fixedNow
    });

    const payload = createValidPayload();
    const canonical = canonicalizeAuthorizationPayload(payload);
    // Signed with untrusted private key!
    const forgedSignature = sign(
      null,
      Buffer.from(canonical, "utf8"),
      untrustedPair.privateKey
    ).toString("hex");

    const result = await verifier.verifyCandidateAuthorization({
      grant: { payload, signature: forgedSignature, signerKeyId: "op-key" },
      candidateKey: payload.candidateKey,
      specificationDigest: payload.specificationDigest,
      goldMasterWorkflowHash: payload.goldMasterWorkflowHash,
      goldMasterModelHashesDigest: payload.goldMasterModelHashesDigest,
      targetHostname: payload.targetHostname,
      targetGpuUuid: payload.targetGpuUuid,
      purpose: "staging"
    });

    expect(result.authorized).toBe(false);
    expect(result.blocker).toMatch(/signature verification failed/i);
  });
});
