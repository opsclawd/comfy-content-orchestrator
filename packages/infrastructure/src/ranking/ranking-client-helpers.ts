import type { RankingModelOutcome } from "@cco/application";
import { classifyError, isSafetyRefusalSignal, type RefusalEvidence } from "@cco/shared";

export function executeWithSignal<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  timeoutMessage: string
): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error(timeoutMessage));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason ?? new Error(timeoutMessage));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (res) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(res);
      },
      (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
  });
}

export function mapNetworkFailureToOutcome(message: string): RankingModelOutcome {
  const retryClass = classifyError({ kind: "network", message });
  switch (retryClass) {
    case "transient":
      return { kind: "retryable_failure", message };
    case "non_retryable":
    case "safety_refusal":
      throw new Error(`Unreachable RetryClass for network failure: ${retryClass}`);
  }
}

const KNOWN_REFUSAL_DISCRIMINATORS: ReadonlyArray<{
  readonly field: "type" | "code";
  readonly value: string;
}> = [
  { field: "type", value: "refusal" },
  { field: "code", value: "content_policy_violation" }
];

export function detectStructuredRefusalDiscriminator(
  errorType: string,
  errorCode: string
): RefusalEvidence {
  for (const candidate of KNOWN_REFUSAL_DISCRIMINATORS) {
    const actual = candidate.field === "type" ? errorType : errorCode;
    if (actual === candidate.value) {
      return { source: "structured_field", field: `error.${candidate.field}`, value: actual };
    }
  }
  return { source: "none" };
}

export function extractErrorFields(parsedBody: unknown): { errorType: string; errorCode: string } {
  if (parsedBody && typeof parsedBody === "object") {
    const b = parsedBody as Record<string, unknown>;
    const errorObj = (b.error && typeof b.error === "object" ? b.error : {}) as Record<
      string,
      unknown
    >;
    const errorType =
      typeof errorObj.type === "string" ? errorObj.type : typeof b.type === "string" ? b.type : "";
    const errorCode =
      typeof errorObj.code === "string" ? errorObj.code : typeof b.code === "string" ? b.code : "";
    return { errorType, errorCode };
  }
  return { errorType: "", errorCode: "" };
}

export function extractErrorMessage(parsedBody: unknown, bodyText: string, status: number): string {
  if (parsedBody && typeof parsedBody === "object") {
    const b = parsedBody as Record<string, unknown>;
    if (b.error && typeof b.error === "object") {
      const err = b.error as Record<string, unknown>;
      if (typeof err.message === "string") return err.message;
    }
    if (typeof b.message === "string") return b.message;
  }
  return bodyText || `HTTP ${status}`;
}

export function classifyHttpErrorOutcome(
  status: number,
  parsedBody: unknown,
  bodyText: string
): RankingModelOutcome {
  const message = extractErrorMessage(parsedBody, bodyText, status);
  const { errorType, errorCode } = extractErrorFields(parsedBody);
  let refusalEvidence = detectStructuredRefusalDiscriminator(errorType, errorCode);
  if (refusalEvidence.source === "none" && status === 403) {
    const heuristic = isSafetyRefusalSignal({ errorType, errorCode, message });
    if (heuristic.matched) {
      refusalEvidence = {
        source: "message_heuristic",
        scopedToHttpStatus: 403,
        matchedKeyword: heuristic.keyword
      };
    }
  }
  const retryClass = classifyError({
    kind: "http",
    httpStatus: status,
    refusalEvidence,
    message
  });
  switch (retryClass) {
    case "safety_refusal":
      return { kind: "safety_refusal", httpStatus: status, message };
    case "transient":
      return { kind: "retryable_failure", httpStatus: status, message };
    case "non_retryable":
      return { kind: "permanent_failure", httpStatus: status, message };
    default: {
      const exhaustive: never = retryClass;
      throw new Error(`Unreachable RetryClass: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function parseAndValidateRanking(
  rawText: string,
  requestedImages: readonly { readonly ordinal: number }[],
  status: number
): RankingModelOutcome {
  let text = rawText.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*\n?/i, "");
    text = text.replace(/\n?```\s*$/i, "");
    text = text.trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      kind: "permanent_failure",
      httpStatus: status,
      message: `Failed to parse ranking JSON: ${err instanceof Error ? err.message : String(err)}`
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      kind: "permanent_failure",
      httpStatus: status,
      message: "Ranking response is not a JSON array"
    };
  }

  const expectedOrdinals = requestedImages.map((img) => img.ordinal);
  if (parsed.length !== expectedOrdinals.length) {
    return {
      kind: "permanent_failure",
      httpStatus: status,
      message: `Ranking response length (${parsed.length}) does not match candidate count (${expectedOrdinals.length})`
    };
  }

  const expectedSet = new Set(expectedOrdinals);
  const seen = new Set<number>();
  const rankedOrdinals: number[] = [];

  for (const item of parsed) {
    if (typeof item !== "number" || !Number.isInteger(item)) {
      return {
        kind: "permanent_failure",
        httpStatus: status,
        message: `Ranking item '${item}' is not an integer ordinal`
      };
    }
    if (!expectedSet.has(item)) {
      return {
        kind: "permanent_failure",
        httpStatus: status,
        message: `Ranking item '${item}' is not in expected candidate ordinals`
      };
    }
    if (seen.has(item)) {
      return {
        kind: "permanent_failure",
        httpStatus: status,
        message: `Duplicate ordinal '${item}' in ranking response`
      };
    }
    seen.add(item);
    rankedOrdinals.push(item);
  }

  return {
    kind: "success",
    rankedOrdinals
  };
}
