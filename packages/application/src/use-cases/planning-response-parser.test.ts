import { describe, it, expect } from "vitest";
import { parsePlanningResponse } from "./planning-response-parser.js";

describe("parsePlanningResponse", () => {
  it("parses plain JSON successfully", () => {
    const json = JSON.stringify({
      prompt: "A neon city in the rain",
      referenceIds: [],
      engineProfileId: "LTX_25_720P_5S_V1",
      durationMs: 5000
    });

    const result = parsePlanningResponse(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        prompt: "A neon city in the rain",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 5000
      });
    }
  });

  it("parses ```json fenced JSON with trailing ```", () => {
    const raw =
      '```json\n{"prompt":"fenced test","referenceIds":[],"engineProfileId":"LTX_25_720P_5S_V1","durationMs":5000}\n```';
    const result = parsePlanningResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        prompt: "fenced test",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 5000
      });
    }
  });

  it("parses ```json fenced JSON without trailing ``` (truncated fence)", () => {
    const raw =
      '```json\n{"prompt":"truncated fence","referenceIds":[],"engineProfileId":"LTX_25_720P_5S_V1","durationMs":5000}';
    const result = parsePlanningResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        prompt: "truncated fence",
        referenceIds: [],
        engineProfileId: "LTX_25_720P_5S_V1",
        durationMs: 5000
      });
    }
  });

  it("parses ``` fenced JSON without language identifier", () => {
    const raw = '```\n{"prompt":"generic fence","referenceIds":[]}\n```';
    const result = parsePlanningResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        prompt: "generic fence",
        referenceIds: []
      });
    }
  });

  it("returns ok: false for malformed JSON without throwing", () => {
    const raw = "```json\n{ invalid json content \n```";
    const result = parsePlanningResponse(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("Failed to parse JSON");
    }
  });

  it("returns ok: false for empty string", () => {
    const result = parsePlanningResponse("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("Response text is empty");
    }
  });

  it("returns ok: false for whitespace-only string", () => {
    const result = parsePlanningResponse("    \n\t  ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("Response text is empty");
    }
  });
});
