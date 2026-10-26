import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  canonicalizeAuthorizationPayload,
  computeH3CandidateKey,
  computeAuthorizationPayloadDigest,
  type H3CandidateAuthorizationGrant,
  type H3CandidateAuthorizationPayload,
  type StagingCandidateProfileSelection
} from "@cco/contracts";
import { JsonFileStagingAuthorizationSource } from "./json-file-staging-authorization-source.js";

const { publicKey: trustedOperatorPublicKey, privateKey: trustedOperatorPrivateKey } =
  generateKeyPairSync("ed25519");
const trustedPublicKeys = new Map<string, KeyObject>([["key-001", trustedOperatorPublicKey]]);

function signPayload(payload: H3CandidateAuthorizationPayload): string {
  const canonical = canonicalizeAuthorizationPayload(payload);
  return cryptoSign(null, Buffer.from(canonical, "utf8"), trustedOperatorPrivateKey).toString(
    "hex"
  );
}

describe("JsonFileStagingAuthorizationSource", () => {
  let tempDir: string;
  let bundlePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "staging-auth-test-"));
    bundlePath = join(tempDir, "staging-authorizations.json");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const validSpecDigest = "a".repeat(64);
  const candidateKey = computeH3CandidateKey(validSpecDigest, 1);
  const targetHost = "render-worker-01";
  const targetGpu = "GPU-1234-5678";

  function createValidPayload(
    overrides: Partial<H3CandidateAuthorizationPayload> = {}
  ): H3CandidateAuthorizationPayload {
    const now = Date.now();
    return {
      version: 1,
      candidateKey,
      specificationDigest: validSpecDigest,
      goldMasterWorkflowHash: "b".repeat(64),
      goldMasterModelHashesDigest: "c".repeat(64),
      targetHostname: targetHost,
      targetGpuUuid: targetGpu,
      purpose: "staging",
      scope: "staging",
      issuedAt: new Date(now - 10_000).toISOString(),
      expiresAt: new Date(now + 3600_000).toISOString(),
      operatorId: "operator-1",
      ...overrides
    };
  }

  function createValidGrant(
    overrides: Partial<H3CandidateAuthorizationGrant> = {},
    payloadOverrides: Partial<H3CandidateAuthorizationPayload> = {}
  ): H3CandidateAuthorizationGrant {
    const payload = createValidPayload(payloadOverrides);
    return {
      payload,
      signature: signPayload(payload),
      signerKeyId: "key-001",
      ...overrides
    };
  }

  it("returns empty list when file path is undefined or does not exist", async () => {
    const sourceNoPath = new JsonFileStagingAuthorizationSource(undefined);
    expect(await sourceNoPath.listAuthorizedCandidates()).toEqual([]);
    expect(await sourceNoPath.resolveCandidateGrant("auth-1", "target-1")).toBeUndefined();

    const sourceMissingFile = new JsonFileStagingAuthorizationSource(join(tempDir, "missing.json"));
    expect(await sourceMissingFile.listAuthorizedCandidates()).toEqual([]);
    expect(await sourceMissingFile.resolveCandidateGrant("auth-1", "target-1")).toBeUndefined();
  });

  describe("listAuthorizedCandidates", () => {
    it("returns all candidates when no principal is specified", async () => {
      const candidates: StagingCandidateProfileSelection[] = [
        {
          kind: "staging_candidate",
          profileKey: candidateKey,
          specificationDigest: validSpecDigest,
          targetId: targetHost,
          authorizationId: "auth-1"
        }
      ];
      writeFileSync(bundlePath, JSON.stringify({ candidates }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath);
      const result = await source.listAuthorizedCandidates();
      expect(result).toHaveLength(1);
      expect(result[0]!.profileKey).toBe(candidateKey);
    });

    it("supports raw array format in bundle for candidates", async () => {
      const candidates: StagingCandidateProfileSelection[] = [
        {
          kind: "staging_candidate",
          profileKey: candidateKey,
          specificationDigest: validSpecDigest,
          targetId: targetHost,
          authorizationId: "auth-1"
        }
      ];
      writeFileSync(bundlePath, JSON.stringify(candidates), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath);
      const result = await source.listAuthorizedCandidates();
      expect(result).toHaveLength(1);
    });

    it("filters candidates by principal when authorizedPrincipals is defined", async () => {
      const candidates = [
        {
          kind: "staging_candidate",
          profileKey: candidateKey,
          specificationDigest: validSpecDigest,
          targetId: targetHost,
          authorizationId: "auth-1",
          authorizedPrincipals: ["alice", "bob"]
        },
        {
          kind: "staging_candidate",
          profileKey: candidateKey,
          specificationDigest: validSpecDigest,
          targetId: targetHost,
          authorizationId: "auth-2",
          authorizedPrincipals: ["charlie"]
        },
        {
          kind: "staging_candidate",
          profileKey: candidateKey,
          specificationDigest: validSpecDigest,
          targetId: targetHost,
          authorizationId: "auth-3"
          // unrestricted (no authorizedPrincipals)
        }
      ];
      writeFileSync(bundlePath, JSON.stringify({ candidates }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath);

      const aliceCandidates = await source.listAuthorizedCandidates("alice");
      expect(aliceCandidates.map((c) => c.authorizationId)).toEqual(["auth-1", "auth-3"]);

      const charlieCandidates = await source.listAuthorizedCandidates("charlie");
      expect(charlieCandidates.map((c) => c.authorizationId)).toEqual(["auth-2", "auth-3"]);

      const unknownCandidates = await source.listAuthorizedCandidates("dave");
      expect(unknownCandidates.map((c) => c.authorizationId)).toEqual(["auth-3"]);
    });
  });

  describe("resolveCandidateGrant", () => {
    it("resolves grant matching computed authorization payload digest and targetHostname", async () => {
      const grant = createValidGrant();
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeDefined();
      expect(resolved!.signerKeyId).toBe("key-001");
    });

    it("resolves grant matching targetGpuUuid", async () => {
      const grant = createValidGrant();
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetGpu, candidateKey);
      expect(resolved).toBeDefined();
    });

    it("rejects when candidateProfileKey does not match", async () => {
      const grant = createValidGrant();
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(
        authId,
        targetHost,
        "H3_CANDIDATE_0000000000000000000000000000000000000000000000000000000000000000_V1"
      );
      expect(resolved).toBeUndefined();
    });

    it("rejects when authorizationId does not match", async () => {
      const grant = createValidGrant();

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(
        "wrong-auth-id",
        targetHost,
        candidateKey
      );
      expect(resolved).toBeUndefined();
    });

    it("rejects when targetId does not match either targetHostname or targetGpuUuid", async () => {
      const grant = createValidGrant();
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, "unrelated-target", candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects when purpose is not staging", async () => {
      const grant = createValidGrant(
        {},
        { purpose: "production" as unknown as "staging", scope: "production" }
      );
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects when grant is expired", async () => {
      const now = Date.now();
      const grant = createValidGrant(
        {},
        {
          issuedAt: new Date(now - 100_000).toISOString(),
          expiresAt: new Date(now - 1000).toISOString()
        }
      );
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects when grant issuedAt is in the future beyond 5 seconds", async () => {
      const now = Date.now();
      const grant = createValidGrant(
        {},
        {
          issuedAt: new Date(now + 60_000).toISOString(),
          expiresAt: new Date(now + 3600_000).toISOString()
        }
      );
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects dummy or weak signatures", async () => {
      const grantWeak = createValidGrant({ signature: "deadbeef0123456789" });
      const authWeak = computeAuthorizationPayloadDigest(grantWeak.payload);

      const grantZeros = createValidGrant({
        signature: "0000000011112222333344445555666677778888"
      });
      const authZeros = computeAuthorizationPayloadDigest(grantZeros.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grantWeak, grantZeros] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      expect(
        await source.resolveCandidateGrant(authWeak, targetHost, candidateKey)
      ).toBeUndefined();
      expect(
        await source.resolveCandidateGrant(authZeros, targetHost, candidateKey)
      ).toBeUndefined();
    });

    it("fails closed when no trusted public key store is configured (issue #426)", async () => {
      const grant = createValidGrant();
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects a grant signed by a key not in the trust store (issue #426)", async () => {
      const grant = createValidGrant({ signerKeyId: "untrusted-key" });
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects a structurally valid signature that does not verify against the trusted key (issue #426)", async () => {
      // A syntactically valid 64-byte hex signature that was never produced by the trusted
      // operator's private key must still be rejected by real cryptographic verification.
      const grant = createValidGrant({ signature: "ab".repeat(64) });
      const authId = computeAuthorizationPayloadDigest(grant.payload);

      writeFileSync(bundlePath, JSON.stringify({ grants: [grant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });

    it("rejects a genuinely signed grant whose payload was tampered after signing (issue #426)", async () => {
      const grant = createValidGrant();
      const authId = computeAuthorizationPayloadDigest(grant.payload);
      const tamperedGrant: H3CandidateAuthorizationGrant = {
        ...grant,
        payload: { ...grant.payload, targetHostname: "a-different-host" }
      };

      writeFileSync(bundlePath, JSON.stringify({ grants: [tamperedGrant] }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath, trustedPublicKeys);
      const resolved = await source.resolveCandidateGrant(authId, targetHost, candidateKey);
      expect(resolved).toBeUndefined();
    });
  });

  describe("caching and error handling", () => {
    it("caches parsed bundle and reloads when file mtime changes", async () => {
      const candidates1: StagingCandidateProfileSelection[] = [
        {
          kind: "staging_candidate",
          profileKey: candidateKey,
          specificationDigest: validSpecDigest,
          targetId: targetHost,
          authorizationId: "auth-1"
        }
      ];
      writeFileSync(bundlePath, JSON.stringify({ candidates: candidates1 }), "utf-8");

      const source = new JsonFileStagingAuthorizationSource(bundlePath);
      const first = await source.listAuthorizedCandidates();
      expect(first).toHaveLength(1);

      // Write new content and touch mtime
      writeFileSync(bundlePath, JSON.stringify({ candidates: [] }), "utf-8");
      const futureTime = Date.now() / 1000 + 10;
      utimesSync(bundlePath, futureTime, futureTime);

      const second = await source.listAuthorizedCandidates();
      expect(second).toHaveLength(0);
    });

    it("fails closed on corrupted json file", async () => {
      writeFileSync(bundlePath, "not valid json {", "utf-8");
      const source = new JsonFileStagingAuthorizationSource(bundlePath);

      await expect(source.listAuthorizedCandidates()).rejects.toThrow();
    });
  });
});
