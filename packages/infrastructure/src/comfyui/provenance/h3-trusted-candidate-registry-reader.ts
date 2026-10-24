import { createHash, type KeyObject } from "node:crypto";
import {
  canonicalizeCapabilityMatrixPayload,
  computeH3CandidateKey,
  computeH3CandidateSpecificationDigest,
  deepFreeze,
  H3CandidateProfileSchema,
  H3CapabilityMatrixEnvelopeSchema,
  type H3CandidateProfile,
  type H3CapabilityDecisionRow,
  type H3CapabilityMatrixEnvelope
} from "@cco/contracts";
import type { H3CandidateRegistryReader } from "@cco/application";
import { verifySignatureWithKey } from "./h3-operator-signature-verifier.js";

export class H3CandidateRegistryReaderError extends Error {
  override readonly name = "H3CandidateRegistryReaderError";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export type H3EvidenceResolver = (digest: string) => Uint8Array | Buffer | string | undefined;

export interface H3TrustedCandidateRegistryReaderOptions {
  readonly candidateProfiles: readonly H3CandidateProfile[];
  readonly decisionEnvelope: H3CapabilityMatrixEnvelope;
  readonly trustedPublicKeys: ReadonlyMap<string, KeyObject | string>;
  readonly evidenceResolver?: H3EvidenceResolver | undefined;
  readonly now?: () => Date;
}

/**
 * Read-only infrastructure reader loading operator-supplied candidate profiles plus a signed #445 decision envelope.
 * Validates canonical digests and detached signatures against deployment-owned trusted public keys.
 * Exposes only exact rows whose speed, quality, and overall verdicts pass with verifiable evidence digests.
 */
export class H3TrustedCandidateRegistryReader implements H3CandidateRegistryReader {
  private readonly catalog: ReadonlyMap<string, Readonly<H3CandidateProfile>>;

  constructor(options: H3TrustedCandidateRegistryReaderOptions) {
    const { candidateProfiles, decisionEnvelope, trustedPublicKeys } = options;

    // 1. Validate decision envelope schema
    const envelopeParsed = H3CapabilityMatrixEnvelopeSchema.safeParse(decisionEnvelope);
    if (!envelopeParsed.success) {
      throw new H3CandidateRegistryReaderError(
        `Invalid capability matrix envelope schema: ${envelopeParsed.error.message}`
      );
    }
    const validatedEnvelope = envelopeParsed.data;

    if (validatedEnvelope.version !== 1) {
      throw new H3CandidateRegistryReaderError(
        `Unsupported capability matrix envelope version: ${String(validatedEnvelope.version)}`
      );
    }

    // 2. Validate signer key against trusted public keys
    const trustedKey = trustedPublicKeys.get(validatedEnvelope.signedBy);
    if (!trustedKey) {
      throw new H3CandidateRegistryReaderError(
        `Untrusted or unrecognized operator signer key ID: "${validatedEnvelope.signedBy}"`
      );
    }

    // 3. Cryptographically verify envelope signature
    const payload = {
      version: validatedEnvelope.version,
      matrixId: validatedEnvelope.matrixId,
      rows: validatedEnvelope.rows,
      signedBy: validatedEnvelope.signedBy,
      signedAt: validatedEnvelope.signedAt
    };
    const canonicalPayload = canonicalizeCapabilityMatrixPayload(payload);
    const signatureBuffer = Buffer.from(validatedEnvelope.signatureHex, "hex");
    const isSignatureValid = verifySignatureWithKey(
      Buffer.from(canonicalPayload, "utf8"),
      signatureBuffer,
      trustedKey
    );

    if (!isSignatureValid) {
      throw new H3CandidateRegistryReaderError(
        `Cryptographic signature verification failed for capability matrix "${validatedEnvelope.matrixId}"`
      );
    }

    // 4. Index passing decision rows by specificationDigest
    const passingDecisionRows = new Map<string, H3CapabilityDecisionRow>();
    const seenDigestsInMatrix = new Set<string>();

    for (const row of validatedEnvelope.rows) {
      const computedDigest = computeH3CandidateSpecificationDigest(row.specification);
      if (row.specificationDigest !== computedDigest) {
        throw new H3CandidateRegistryReaderError(
          `Matrix row specificationDigest mismatch: declared "${row.specificationDigest}", computed "${computedDigest}"`
        );
      }

      if (seenDigestsInMatrix.has(row.specificationDigest)) {
        throw new H3CandidateRegistryReaderError(
          `Duplicate specificationDigest in capability matrix: "${row.specificationDigest}"`
        );
      }
      seenDigestsInMatrix.add(row.specificationDigest);

      if (
        row.speedVerdict === "pass" &&
        row.qualityVerdict === "pass" &&
        row.overallVerdict === "pass"
      ) {
        if (!row.evidenceDigests || row.evidenceDigests.length === 0) {
          throw new H3CandidateRegistryReaderError(
            `Passing matrix row for digest "${row.specificationDigest}" lacks evidenceDigests`
          );
        }
        if (!options.evidenceResolver) {
          throw new H3CandidateRegistryReaderError(
            `Missing required evidenceResolver: cannot resolve backing evidence for digest "${row.specificationDigest}"`
          );
        }
        for (const evidenceDigest of row.evidenceDigests) {
          const rawEvidence = options.evidenceResolver(evidenceDigest);
          if (rawEvidence === undefined || rawEvidence === null) {
            throw new H3CandidateRegistryReaderError(
              `Evidence reference "${evidenceDigest}" could not be resolved from deployment storage`
            );
          }
          const evidenceBytes =
            typeof rawEvidence === "string"
              ? Buffer.from(rawEvidence, "utf8")
              : Buffer.from(rawEvidence);
          const computedHash = createHash("sha256").update(evidenceBytes).digest("hex");
          if (computedHash.toLowerCase() !== evidenceDigest.toLowerCase()) {
            throw new H3CandidateRegistryReaderError(
              `Evidence digest mismatch for reference "${evidenceDigest}": resolved bytes hash "${computedHash}" does not match declared digest`
            );
          }
        }
        passingDecisionRows.set(row.specificationDigest, row);
      }
    }

    // 5. Admit candidate profiles matching passing decision rows
    const admittedMap = new Map<string, Readonly<H3CandidateProfile>>();
    const seenCandidateKeys = new Set<string>();

    for (const profile of candidateProfiles) {
      const profileParsed = H3CandidateProfileSchema.safeParse(profile);
      if (!profileParsed.success) {
        throw new H3CandidateRegistryReaderError(
          `Invalid candidate profile schema: ${profileParsed.error.message}`
        );
      }
      const validProfile = profileParsed.data;

      const computedDigest = computeH3CandidateSpecificationDigest(validProfile.specification);
      if (validProfile.specificationDigest !== computedDigest) {
        throw new H3CandidateRegistryReaderError(
          `Candidate profile specificationDigest mismatch for "${validProfile.key}": declared "${validProfile.specificationDigest}", computed "${computedDigest}"`
        );
      }

      const expectedKey = computeH3CandidateKey(computedDigest, validProfile.version);
      if (validProfile.key !== expectedKey) {
        throw new H3CandidateRegistryReaderError(
          `Candidate profile key mismatch: declared "${validProfile.key}", computed "${expectedKey}"`
        );
      }

      if (seenCandidateKeys.has(validProfile.key)) {
        throw new H3CandidateRegistryReaderError(
          `Duplicate candidate profile key in input list: "${validProfile.key}"`
        );
      }
      seenCandidateKeys.add(validProfile.key);

      // Check if this profile has a passing row in the decision matrix
      const passingRow = passingDecisionRows.get(validProfile.specificationDigest);
      if (!passingRow) {
        // Not passing or absent from matrix -> fail-closed: do not admit
        continue;
      }

      // Admitted! Deep freeze before storing
      const frozen = deepFreeze(validProfile) as unknown as Readonly<H3CandidateProfile>;
      admittedMap.set(validProfile.key, frozen);
    }

    this.catalog = admittedMap;
  }

  getCandidateProfile(key: string | undefined): Readonly<H3CandidateProfile> | undefined {
    if (!key) return undefined;
    return this.catalog.get(key);
  }

  listCandidateProfiles(): readonly Readonly<H3CandidateProfile>[] {
    return Object.freeze(Array.from(this.catalog.values()));
  }

  isCandidateProfileKey(key: string | undefined): boolean {
    if (!key) return false;
    return this.catalog.has(key);
  }
}
