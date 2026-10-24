import { verify as cryptoVerify, type KeyObject } from "node:crypto";
import {
  canonicalizeAuthorizationPayload,
  H3CandidateAuthorizationGrantSchema
} from "@cco/contracts";
import type {
  H3CandidateAuthorizationPort,
  H3CandidateAuthorizationVerificationRequest,
  H3CandidateAuthorizationVerificationResult
} from "@cco/application";

export interface H3OperatorSignatureVerifierOptions {
  readonly trustedPublicKeys: ReadonlyMap<string, KeyObject | string>;
  readonly now?: () => Date;
}

export function verifySignatureWithKey(
  data: Buffer,
  signature: Buffer,
  key: KeyObject | string
): boolean {
  // First try with null algorithm (standard for Ed25519 / Ed448)
  try {
    if (cryptoVerify(null, data, key, signature)) {
      return true;
    }
  } catch {
    // Expected to throw if algorithm is not null-compatible; try SHA-256
  }

  // Fallback with SHA-256 (for RSA / ECDSA)
  try {
    return cryptoVerify("SHA256", data, key, signature);
  } catch {
    return false;
  }
}

/**
 * Infrastructure adapter verifying operator authorization grants using cryptographic detached signatures.
 *
 * GOVERNANCE INVARIANT:
 * Verifies only against deployment-owned trusted operator keys.
 * Caller-supplied keys or signatures are never trusted as authority.
 */
export class H3OperatorSignatureVerifier implements H3CandidateAuthorizationPort {
  private readonly trustedPublicKeys: ReadonlyMap<string, KeyObject | string>;
  private readonly now: () => Date;

  constructor(options: H3OperatorSignatureVerifierOptions) {
    this.trustedPublicKeys = options.trustedPublicKeys;
    this.now = options.now ?? (() => new Date());
  }

  async verifyCandidateAuthorization(
    request: H3CandidateAuthorizationVerificationRequest
  ): Promise<H3CandidateAuthorizationVerificationResult> {
    const { grant } = request;

    // 1. Validate that the grant conforms strictly to the Zod grant schema
    const parseResult = H3CandidateAuthorizationGrantSchema.safeParse(grant);
    if (!parseResult.success) {
      return {
        authorized: false,
        blocker: `Invalid authorization grant schema: ${parseResult.error.message}`
      };
    }
    const validatedGrant = parseResult.data;

    // 2. Explicit version 1 enforcement
    if (validatedGrant.payload.version !== 1) {
      return {
        authorized: false,
        blocker: `Unsupported grant payload version: ${String(validatedGrant.payload.version)}`
      };
    }

    // 3. Verify that the signerKeyId is in the trusted operator key store
    const trustedKey = this.trustedPublicKeys.get(validatedGrant.signerKeyId);
    if (!trustedKey) {
      return {
        authorized: false,
        blocker: `Untrusted or unrecognized operator signer key ID: "${validatedGrant.signerKeyId}"`
      };
    }

    const payload = validatedGrant.payload;

    // 4. Candidate key and specification digest binding
    if (payload.candidateKey !== request.candidateKey) {
      return {
        authorized: false,
        blocker: `Grant candidateKey mismatch: grant specifies "${payload.candidateKey}", request requires "${request.candidateKey}"`
      };
    }

    if (payload.specificationDigest !== request.specificationDigest) {
      return {
        authorized: false,
        blocker: `Grant specificationDigest mismatch: grant specifies "${payload.specificationDigest}", request requires "${request.specificationDigest}"`
      };
    }

    // 5. Gold master hashes binding
    if (payload.goldMasterWorkflowHash !== request.goldMasterWorkflowHash) {
      return {
        authorized: false,
        blocker: `Grant goldMasterWorkflowHash mismatch: grant specifies "${payload.goldMasterWorkflowHash}", request requires "${request.goldMasterWorkflowHash}"`
      };
    }

    if (payload.goldMasterModelHashesDigest !== request.goldMasterModelHashesDigest) {
      return {
        authorized: false,
        blocker: `Grant goldMasterModelHashesDigest mismatch: grant specifies "${payload.goldMasterModelHashesDigest}", request requires "${request.goldMasterModelHashesDigest}"`
      };
    }

    // 6. Target host and GPU binding
    if (payload.targetHostname !== request.targetHostname) {
      return {
        authorized: false,
        blocker: `Grant targetHostname mismatch: grant specifies "${payload.targetHostname}", request requires "${request.targetHostname}"`
      };
    }

    if (payload.targetGpuUuid !== request.targetGpuUuid) {
      return {
        authorized: false,
        blocker: `Grant targetGpuUuid mismatch: grant specifies "${payload.targetGpuUuid}", request requires "${request.targetGpuUuid}"`
      };
    }

    // 7. Purpose and scope check
    if (payload.purpose !== request.purpose) {
      return {
        authorized: false,
        blocker: `Grant purpose mismatch: grant specifies "${payload.purpose}", request requires "${request.purpose}"`
      };
    }

    if (request.purpose === "production" && payload.scope !== "production") {
      return {
        authorized: false,
        blocker: 'A staging-scope grant cannot be used for "production" purpose'
      };
    }

    // 8. Validity window check
    const nowMs = this.now().getTime();
    const issuedMs = Date.parse(payload.issuedAt);
    const expiresMs = Date.parse(payload.expiresAt);

    if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs)) {
      return {
        authorized: false,
        blocker: "Invalid date format in authorization grant payload"
      };
    }

    if (nowMs < issuedMs) {
      return {
        authorized: false,
        blocker: `Grant is not yet valid (issued at ${payload.issuedAt}, current time ${this.now().toISOString()})`
      };
    }

    if (nowMs >= expiresMs) {
      return {
        authorized: false,
        blocker: `Grant has expired (expired at ${payload.expiresAt}, current time ${this.now().toISOString()})`
      };
    }

    // 9. Detached cryptographic signature verification
    const canonicalPayload = canonicalizeAuthorizationPayload(payload);
    const dataBuffer = Buffer.from(canonicalPayload, "utf8");
    let signatureBuffer: Buffer;
    try {
      signatureBuffer = Buffer.from(grant.signature, "hex");
    } catch {
      return {
        authorized: false,
        blocker: "Grant signature is not valid hexadecimal"
      };
    }

    const isValid = verifySignatureWithKey(dataBuffer, signatureBuffer, trustedKey);
    if (!isValid) {
      return {
        authorized: false,
        blocker: "Cryptographic detached signature verification failed against trusted operator key"
      };
    }

    return {
      authorized: true,
      scope: payload.scope
    };
  }
}
