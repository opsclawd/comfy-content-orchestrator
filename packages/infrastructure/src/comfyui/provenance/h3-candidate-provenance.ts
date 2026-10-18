import {
  deepFreeze,
  H3CandidateProvenanceReportSchema,
  type H3CandidateProvenanceReport,
  type H3CandidateRenderProfileProvenance
} from "@cco/contracts";

export {
  H3CandidateProvenanceReportSchema,
  type H3CandidateProvenanceReport,
  type H3CandidateRenderProfileProvenance
};

export interface H3CandidateProvenanceCollection {
  readonly version: 1;
  readonly candidates: readonly H3CandidateProvenanceReport[];
}

export class H3CandidateProvenanceResolutionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "H3CandidateProvenanceResolutionError";
  }
}

/**
 * Resolves exactly one candidate provenance report from a multi-candidate collection or single record.
 * Reuses #210 multi-profile selection semantics.
 */
export function resolveCandidateProvenanceFromCollection(
  collectionOrReport: unknown,
  candidateKey: string
): H3CandidateProvenanceReport {
  if (
    collectionOrReport === null ||
    typeof collectionOrReport !== "object" ||
    Array.isArray(collectionOrReport)
  ) {
    throw new H3CandidateProvenanceResolutionError(
      "Candidate provenance must be a valid JSON object"
    );
  }

  const record = collectionOrReport as Record<string, unknown>;

  if ("candidates" in record) {
    if (!Array.isArray(record.candidates)) {
      throw new H3CandidateProvenanceResolutionError(
        'Candidate provenance "candidates" must be an array of per-candidate records'
      );
    }

    if (record.version !== 1) {
      throw new H3CandidateProvenanceResolutionError(
        `Candidate provenance collection has unsupported version: ${String(record.version)}`
      );
    }

    const matches = record.candidates.filter(
      (entry): entry is H3CandidateProvenanceReport =>
        entry !== null &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        (entry as { candidateKey?: unknown }).candidateKey === candidateKey
    );

    if (matches.length === 0) {
      const availableKeys = record.candidates
        .map((entry) => (entry as { candidateKey?: unknown })?.candidateKey)
        .filter((k): k is string => typeof k === "string");

      throw new H3CandidateProvenanceResolutionError(
        `Candidate provenance collection has no entry for candidateKey "${candidateKey}" (available: ${availableKeys.join(", ") || "none"})`
      );
    }

    if (matches.length > 1) {
      throw new H3CandidateProvenanceResolutionError(
        `Candidate provenance collection has ${matches.length} ambiguous entries for candidateKey "${candidateKey}"; expected exactly one`
      );
    }

    const parseResult = H3CandidateProvenanceReportSchema.safeParse(matches[0]);
    if (!parseResult.success) {
      throw new H3CandidateProvenanceResolutionError(
        `Candidate provenance report validation failed: ${parseResult.error.message}`
      );
    }

    return deepFreeze(parseResult.data) as unknown as H3CandidateProvenanceReport;
  }

  // Single report format
  if ((record as { candidateKey?: unknown }).candidateKey !== candidateKey) {
    throw new H3CandidateProvenanceResolutionError(
      `Candidate provenance candidateKey "${String(record.candidateKey)}" does not match required "${candidateKey}"`
    );
  }

  const parseResult = H3CandidateProvenanceReportSchema.safeParse(record);
  if (!parseResult.success) {
    throw new H3CandidateProvenanceResolutionError(
      `Candidate provenance report validation failed: ${parseResult.error.message}`
    );
  }

  return deepFreeze(parseResult.data) as unknown as H3CandidateProvenanceReport;
}
