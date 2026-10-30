import { PrevisTextAdvisorySchema } from "@cco/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrevisTextDetectionResult } from "../ports/previs-text-detection-port.js";
import {
  DEFAULT_PREVIS_TEXT_ADVISORY_POLICY as POLICY,
  evaluatePrevisTextAdvisory,
  parsePrevisTextAdvisoryPolicy,
  runPrevisTextAdvisory
} from "./previs-text-advisory.js";

const AT = new Date("2026-10-30T00:00:00.000Z");
const ENGINE = { id: "fixture-engine", version: "0.0.0" };
// Synthetic, hand-authored OCR outputs — not measured data.
const result = (regions: Array<[string, number]>): PrevisTextDetectionResult => ({
  engine: ENGINE,
  regions: regions.map(([text, confidence]) => ({ text, confidence }))
});

describe("evaluatePrevisTextAdvisory", () => {
  it("is clean for no regions", () => {
    const a = evaluatePrevisTextAdvisory(result([]), POLICY, AT);
    expect(a.status).toBe("clean");
    expect(a.maxConfidence).toBeNull();
    expect(PrevisTextAdvisorySchema.parse(a)).toEqual(a);
  });

  it("flags at exactly the threshold and not just below", () => {
    expect(evaluatePrevisTextAdvisory(result([["LENTA", 0.7]]), POLICY, AT).status).toBe("flagged");
    expect(evaluatePrevisTextAdvisory(result([["LENTA", 0.69]]), POLICY, AT).status).toBe("clean");
  });

  it("ignores short tokens and linework noise", () => {
    const a = evaluatePrevisTextAdvisory(
      result([
        ["AB", 0.99],
        ["|/\\-_", 0.95],
        ["ll|", 0.9],
        ["a|/\\-", 0.9]
      ]),
      POLICY,
      AT
    );
    expect(a.status).toBe("clean");
  });

  it("sorts, reports max confidence and drops noise in mixed input", () => {
    const a = evaluatePrevisTextAdvisory(
      result([
        ["IUTO", 0.71],
        ["|||", 0.95],
        ["LENTA", 0.82]
      ]),
      POLICY,
      AT
    );
    expect(a.status).toBe("flagged");
    expect(a.detections.map((d) => d.text)).toEqual(["LENTA", "IUTO"]);
    expect(a.maxConfidence).toBe(0.82);
  });

  it("caps detections, truncates and normalises whitespace", () => {
    const many = Array.from({ length: 8 }, (_, i): [string, number] => [`WORD${i}`, 0.8 + i / 100]);
    expect(evaluatePrevisTextAdvisory(result(many), POLICY, AT).detections).toHaveLength(5);
    const long = evaluatePrevisTextAdvisory(result([["A".repeat(200), 0.9]]), POLICY, AT);
    expect(long.detections[0]!.text).toHaveLength(64);
    const ws = evaluatePrevisTextAdvisory(result([["  HOTEL \n  BAR  ", 0.9]]), POLICY, AT);
    expect(ws.detections[0]!.text).toBe("HOTEL BAR");
  });

  it("honours policy overrides, echoes thresholds and is deterministic", () => {
    const strict = { ...POLICY, minConfidence: 0.9 };
    const r = result([["LENTA", 0.82]]);
    const a = evaluatePrevisTextAdvisory(r, strict, AT);
    expect(a.status).toBe("clean");
    expect(a.thresholds.minConfidence).toBe(0.9);
    expect(a.policyVersion).toBe("previs_text_advisory_v1");
    expect(evaluatePrevisTextAdvisory(r, POLICY, AT)).toEqual(
      evaluatePrevisTextAdvisory(r, POLICY, AT)
    );
  });
});

describe("runPrevisTextAdvisory", () => {
  afterEach(() => vi.useRealTimers());
  const input = { bytes: new Uint8Array([1]) };

  it("delegates to the mapper on success", async () => {
    const a = await runPrevisTextAdvisory(
      { detectText: async () => result([["LENTA", 0.9]]) },
      input,
      { now: () => AT }
    );
    expect(a.status).toBe("flagged");
  });

  it("returns unavailable when the detector throws", async () => {
    const a = await runPrevisTextAdvisory(
      {
        detectText: async () => {
          throw new Error("wasm init failed");
        }
      },
      input,
      { now: () => AT }
    );
    expect(a.status).toBe("unavailable");
    expect(a.reason).toBe("wasm init failed");
  });

  it("returns unavailable on timeout", async () => {
    vi.useFakeTimers();
    const p = runPrevisTextAdvisory({ detectText: () => new Promise(() => {}) }, input, {
      timeoutMs: 1000,
      now: () => AT
    });
    await vi.advanceTimersByTimeAsync(1000);
    const a = await p;
    expect(a.status).toBe("unavailable");
    expect(a.reason).toBe("timeout");
  });

  it("asks the detector to recycle itself after a timeout only", async () => {
    vi.useFakeTimers();
    const recycleAfterTimeout = vi.fn(async () => undefined);
    const p = runPrevisTextAdvisory(
      { detectText: () => new Promise(() => {}), recycleAfterTimeout },
      input,
      { timeoutMs: 1000, now: () => AT }
    );
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(recycleAfterTimeout).toHaveBeenCalledTimes(1);

    const recycleOnError = vi.fn(async () => undefined);
    await runPrevisTextAdvisory(
      {
        detectText: async () => {
          throw new Error("boom");
        },
        recycleAfterTimeout: recycleOnError
      },
      input,
      { now: () => AT }
    );
    expect(recycleOnError).not.toHaveBeenCalled();
  });
});

describe("parsePrevisTextAdvisoryPolicy", () => {
  it("uses defaults and parses overrides", () => {
    expect(parsePrevisTextAdvisoryPolicy({})).toEqual(POLICY);
    const p = parsePrevisTextAdvisoryPolicy({
      CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE: "0.5",
      CCO_PREVIS_TEXT_ADVISORY_MIN_ALNUM_CHARS: "4"
    });
    expect(p.minConfidence).toBe(0.5);
    expect(p.minAlnumChars).toBe(4);
  });

  it("rejects invalid values", () => {
    expect(() =>
      parsePrevisTextAdvisoryPolicy({ CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE: "x" })
    ).toThrow();
    expect(() =>
      parsePrevisTextAdvisoryPolicy({ CCO_PREVIS_TEXT_ADVISORY_MIN_CONFIDENCE: "2" })
    ).toThrow();
    expect(() =>
      parsePrevisTextAdvisoryPolicy({ CCO_PREVIS_TEXT_ADVISORY_MIN_ALNUM_CHARS: "1.5" })
    ).toThrow();
  });
});
