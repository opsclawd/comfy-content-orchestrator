import {
  PREVIS_TEXT_ADVISORY_MAX_DETECTIONS,
  PREVIS_TEXT_ADVISORY_MAX_TEXT_LENGTH,
  PREVIS_TEXT_ADVISORY_POLICY_VERSION,
  type PrevisTextAdvisory,
  type PrevisTextDetection
} from "@cco/contracts";
import type {
  PrevisTextDetectionInput,
  PrevisTextDetectionPort,
  PrevisTextDetectionResult
} from "../ports/previs-text-detection-port.js";

export interface PrevisTextAdvisoryPolicy {
  readonly minConfidence: number;
  readonly minAlnumChars: number;
  readonly minAlnumRatio: number;
  readonly maxReportedDetections: number;
  readonly maxTextLength: number;
}

// Provisional, recall-leaning defaults; see docs/storyboard-previs-ocr-advisory.md.
export const DEFAULT_PREVIS_TEXT_ADVISORY_POLICY: PrevisTextAdvisoryPolicy = Object.freeze({
  minConfidence: 0.7,
  minAlnumChars: 3,
  minAlnumRatio: 0.6,
  maxReportedDetections: PREVIS_TEXT_ADVISORY_MAX_DETECTIONS,
  maxTextLength: PREVIS_TEXT_ADVISORY_MAX_TEXT_LENGTH
});

export const DEFAULT_PREVIS_TEXT_ADVISORY_TIMEOUT_MS = 30_000;

export class PrevisTextAdvisoryConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrevisTextAdvisoryConfigError";
  }
}

export function parsePrevisTextAdvisoryPolicy(
  env: Readonly<Record<string, string | undefined>>
): PrevisTextAdvisoryPolicy {
  const minConfidence = parseNumber(
    env.CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE,
    "CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE",
    DEFAULT_PREVIS_TEXT_ADVISORY_POLICY.minConfidence
  );
  if (minConfidence < 0 || minConfidence > 1) {
    throw new PrevisTextAdvisoryConfigError(
      "CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE must be between 0 and 1"
    );
  }
  const minAlnumChars = parseNumber(
    env.CCO_PREVIS_TEXT_ADVISORY_MIN_ALNUM_CHARS,
    "CCO_PREVIS_TEXT_ADVISORY_MIN_ALNUM_CHARS",
    DEFAULT_PREVIS_TEXT_ADVISORY_POLICY.minAlnumChars
  );
  if (!Number.isInteger(minAlnumChars) || minAlnumChars < 1) {
    throw new PrevisTextAdvisoryConfigError(
      "CCO_PREVIS_TEXT_ADVISORY_MIN_ALNUM_CHARS must be a positive integer"
    );
  }
  return Object.freeze({ ...DEFAULT_PREVIS_TEXT_ADVISORY_POLICY, minConfidence, minAlnumChars });
}

function parseNumber(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new PrevisTextAdvisoryConfigError(`${name} must be a finite number, received "${raw}"`);
  }
  return value;
}

function thresholdsOf(policy: PrevisTextAdvisoryPolicy): PrevisTextAdvisory["thresholds"] {
  return {
    minConfidence: policy.minConfidence,
    minAlnumChars: policy.minAlnumChars,
    minAlnumRatio: policy.minAlnumRatio
  };
}

/**
 * Pure OCR-result → advisory mapping. No I/O; deterministic for a given input.
 */
export function evaluatePrevisTextAdvisory(
  result: PrevisTextDetectionResult,
  policy: PrevisTextAdvisoryPolicy,
  checkedAt: Date
): PrevisTextAdvisory {
  const detections: PrevisTextDetection[] = [];
  for (const region of result.regions) {
    const text = region.text.replace(/\s+/g, " ").trim();
    const alnum = (text.match(/[A-Za-z0-9]/g) ?? []).length;
    const nonSpace = text.replace(/\s/g, "").length;
    if (!Number.isFinite(region.confidence) || region.confidence < policy.minConfidence) continue;
    if (alnum < policy.minAlnumChars) continue;
    if (nonSpace === 0 || alnum / nonSpace < policy.minAlnumRatio) continue;
    detections.push({
      text: text.slice(0, policy.maxTextLength),
      confidence: Math.min(1, region.confidence),
      ...(region.bbox ? { bbox: { ...region.bbox } } : {})
    });
  }
  detections.sort((a, b) => b.confidence - a.confidence || a.text.localeCompare(b.text));

  return {
    status: detections.length > 0 ? "flagged" : "clean",
    policyVersion: PREVIS_TEXT_ADVISORY_POLICY_VERSION,
    thresholds: thresholdsOf(policy),
    maxConfidence: detections.length > 0 ? detections[0]!.confidence : null,
    detections: detections.slice(0, policy.maxReportedDetections),
    engine: { ...result.engine },
    checkedAt: checkedAt.toISOString()
  };
}

export function unavailablePrevisTextAdvisory(
  reason: string,
  policy: PrevisTextAdvisoryPolicy,
  checkedAt: Date,
  engine?: { readonly id: string; readonly version: string }
): PrevisTextAdvisory {
  return {
    status: "unavailable",
    policyVersion: PREVIS_TEXT_ADVISORY_POLICY_VERSION,
    thresholds: thresholdsOf(policy),
    maxConfidence: null,
    detections: [],
    engine: engine ? { ...engine } : null,
    checkedAt: checkedAt.toISOString(),
    reason: reason.slice(0, 200)
  };
}

export interface RunPrevisTextAdvisoryOptions {
  readonly policy?: PrevisTextAdvisoryPolicy;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/** Runs the detector and maps the result. Never rejects: failures become `unavailable`. */
export async function runPrevisTextAdvisory(
  detector: PrevisTextDetectionPort,
  input: PrevisTextDetectionInput,
  options: RunPrevisTextAdvisoryOptions = {}
): Promise<PrevisTextAdvisory> {
  const policy = options.policy ?? DEFAULT_PREVIS_TEXT_ADVISORY_POLICY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_PREVIS_TEXT_ADVISORY_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error("timeout"));
      }, timeoutMs);
    });
    const result = await Promise.race([detector.detectText(input), timeout]);
    return evaluatePrevisTextAdvisory(result, policy, now());
  } catch (error) {
    const reason = error instanceof Error && error.message ? error.message : "detector failed";
    return unavailablePrevisTextAdvisory(reason, policy, now());
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut) {
      try {
        await detector.recycleAfterTimeout?.();
      } catch {
        // Recycling is best-effort; the advisory is already non-blocking.
      }
    }
  }
}
