import { existsSync, readFileSync, statSync } from "node:fs";
import type { KeyObject } from "node:crypto";
import {
  H3CandidateAuthorizationGrantSchema,
  canonicalizeAuthorizationPayload,
  computeAuthorizationPayloadDigest,
  type H3CandidateAuthorizationGrant,
  type StagingCandidateProfileSelection
} from "@cco/contracts";
import type { StagingPlanningAuthorizationSource } from "@cco/application";
import { verifySignatureWithKey } from "./h3-operator-signature-verifier.js";

export interface StagingAuthorizationBundle {
  readonly candidates?: readonly StagingCandidateProfileSelection[] | undefined;
  readonly grants?: readonly H3CandidateAuthorizationGrant[] | undefined;
}

export class JsonFileStagingAuthorizationSource implements StagingPlanningAuthorizationSource {
  private lastMtimeMs = 0;
  private cachedBundle: StagingAuthorizationBundle | null = null;

  constructor(
    private readonly filePath?: string | undefined,
    private readonly trustedPublicKeys?: ReadonlyMap<string, KeyObject | string> | undefined
  ) {}

  private loadBundle(): StagingAuthorizationBundle {
    if (!this.filePath || !existsSync(this.filePath)) {
      return { candidates: [], grants: [] };
    }

    try {
      const stats = statSync(this.filePath);
      if (this.cachedBundle && stats.mtimeMs === this.lastMtimeMs) {
        return this.cachedBundle;
      }

      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      let bundle: StagingAuthorizationBundle;
      if (Array.isArray(parsed)) {
        bundle = { candidates: parsed, grants: [] };
      } else if (parsed && typeof parsed === "object") {
        bundle = {
          candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
          grants: Array.isArray(parsed.grants) ? parsed.grants : []
        };
      } else {
        throw new Error(
          `Invalid staging authorization bundle format in ${this.filePath}: expected object or array`
        );
      }
      this.cachedBundle = bundle;
      this.lastMtimeMs = stats.mtimeMs;
      return bundle;
    } catch (err: unknown) {
      this.cachedBundle = null;
      this.lastMtimeMs = 0;
      throw err;
    }
  }

  async listAuthorizedCandidates(
    principal?: string
  ): Promise<readonly StagingCandidateProfileSelection[]> {
    const candidates = this.loadBundle().candidates ?? [];
    if (!principal) return candidates;
    return candidates.filter((c: StagingCandidateProfileSelection) => {
      const cExt = c as unknown as Record<string, unknown>;
      if (!cExt.authorizedPrincipals || !Array.isArray(cExt.authorizedPrincipals)) return true;
      return (cExt.authorizedPrincipals as unknown[]).includes(principal);
    });
  }

  async resolveCandidateGrant(
    authorizationId: string,
    targetId: string,
    candidateProfileKey?: string
  ): Promise<H3CandidateAuthorizationGrant | undefined> {
    const bundle = this.loadBundle();
    const grants = bundle.grants ?? [];
    const now = Date.now();

    return grants.find((g) => {
      if (!g || !g.payload) return false;
      const parseResult = H3CandidateAuthorizationGrantSchema.safeParse(g);
      if (!parseResult.success) return false;
      const validGrant = parseResult.data;

      if (candidateProfileKey && validGrant.payload.candidateKey !== candidateProfileKey) {
        return false;
      }

      const grantExt = g as unknown as Record<string, unknown>;
      const payloadExt = g.payload as unknown as Record<string, unknown>;

      const payloadDigest = computeAuthorizationPayloadDigest(validGrant.payload);
      const matchesAuth =
        payloadDigest === authorizationId ||
        payloadExt.authorizationId === authorizationId ||
        grantExt.authorizationId === authorizationId;

      if (!matchesAuth) {
        return false;
      }

      const matchesTarget =
        validGrant.payload.targetHostname === targetId ||
        validGrant.payload.targetGpuUuid === targetId ||
        payloadExt.targetId === targetId;

      if (!matchesTarget) {
        return false;
      }

      // Must be staging purpose and scope
      if (validGrant.payload.purpose !== "staging" || validGrant.payload.scope !== "staging") {
        return false;
      }

      // Check expiry
      if (new Date(validGrant.payload.expiresAt).getTime() <= now) {
        return false;
      }

      // Check issuedAt / not before
      if (new Date(validGrant.payload.issuedAt).getTime() > now + 5000) {
        return false;
      }

      // Cryptographic signature verification against the deployment trust store.
      // Fail closed: without a configured trust store, no grant can ever be resolved.
      if (!this.trustedPublicKeys || this.trustedPublicKeys.size === 0) {
        return false;
      }
      const trustedKey = this.trustedPublicKeys.get(validGrant.signerKeyId);
      if (!trustedKey) {
        return false;
      }
      if (typeof validGrant.signature !== "string" || validGrant.signature.length === 0) {
        return false;
      }
      const canonicalPayload = canonicalizeAuthorizationPayload(validGrant.payload);
      let signatureBuffer: Buffer;
      try {
        signatureBuffer = Buffer.from(validGrant.signature, "hex");
      } catch {
        return false;
      }
      if (
        !verifySignatureWithKey(Buffer.from(canonicalPayload, "utf8"), signatureBuffer, trustedKey)
      ) {
        return false;
      }

      return true;
    });
  }
}
