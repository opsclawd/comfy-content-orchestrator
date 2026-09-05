export type RetryClass = "transient" | "non_retryable" | "safety_refusal";

/**
 * Provenance-tagged refusal signal. `classifyError` does not itself decide
 * which tier of evidence is trustworthy at which HTTP status — that policy
 * lives in the adapter and is recorded here so a reader can see *why* a given
 * failure was or was not treated as a refusal, not just *that* a boolean was true.
 */
export type RefusalEvidence =
  | { readonly source: "none" }
  | {
      /**
       * An exact match against a narrow, enumerable provider-declared field
       * (e.g. an error `type`/`code` value the provider documents as a
       * refusal discriminator), not a substring scan over free text. Low
       * false-positive risk — safe to compute at any HTTP status, including
       * 429/5xx, because it cannot be triggered by unrelated prose.
       */
      readonly source: "structured_field";
      readonly field: string;
      readonly value: string;
    }
  | {
      /**
       * A substring keyword scan over free-text error prose (message/type/
       * code fields treated as haystacks). Meaningfully higher
       * false-positive risk. The adapter is required to record which status
       * it trusted this tier under; classifyError does not enforce that scope
       * itself — the adapter's call-site discipline plus tests enforce it,
       * making that scope legible in the value itself.
       */
      readonly source: "message_heuristic";
      readonly scopedToHttpStatus: number;
      readonly matchedKeyword: string;
    };

export type ClassifiableFailure =
  | { readonly kind: "network"; readonly message: string }
  | { readonly kind: "local_validation"; readonly reason: string }
  | {
      readonly kind: "http";
      readonly httpStatus: number;
      readonly refusalEvidence: RefusalEvidence;
      readonly message?: string;
    };

export function classifyError(failure: ClassifiableFailure): RetryClass {
  switch (failure.kind) {
    case "network":
      // Transport/timeout/reset/DNS/body-read failures are always transient.
      // No refusal path exists for this variant at all: there is no error body
      // to extract structured or heuristic evidence from.
      return "transient";
    case "local_validation":
      return "non_retryable";
    case "http":
      // A refusal evidence value with source !== "none" always overrides
      // the status-code rule, for EVERY httpStatus.
      if (failure.refusalEvidence.source !== "none") return "safety_refusal";
      if (failure.httpStatus === 429 || failure.httpStatus >= 500) return "transient";
      return "non_retryable";
    default: {
      const exhaustive: never = failure;
      throw new Error(
        `Unreachable: unhandled ClassifiableFailure kind ${JSON.stringify(exhaustive)}`
      );
    }
  }
}

export function isRetryable(retryClass: RetryClass): boolean {
  return retryClass === "transient";
}

const SAFETY_REFUSAL_SIGNALS = [
  "safety",
  "policy",
  "refusal",
  "violat",
  "content_filter",
  "content_policy_violation",
  "harm"
];

/**
 * Tier 2 evidence only (message_heuristic). Tier 1 (structured_field) has
 * no shared helper because it is a single exact-match comparison the
 * adapter performs inline against the one field/value pair its provider
 * documents.
 */
export function isSafetyRefusalSignal(
  ctx: Readonly<{ errorType?: string; errorCode?: string; message?: string }>
): { readonly matched: false } | { readonly matched: true; readonly keyword: string } {
  const haystack = [ctx.errorType, ctx.errorCode, ctx.message]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .join(" ")
    .toLowerCase();
  const keyword = SAFETY_REFUSAL_SIGNALS.find((signal) => haystack.includes(signal));
  return keyword ? { matched: true, keyword } : { matched: false };
}
