import { describe, expect, it } from "vitest";
import {
  CampaignBeatSheetValidationError,
  validateCampaignBeatSheet
} from "./validate-campaign-beat-sheet.js";

describe("validateCampaignBeatSheet", () => {
  const validBeatsCandidate = {
    beats: [
      {
        ordinal: 1,
        brief: {
          title: "Intro Hook",
          description: "Close-up shot of ice splashing into a carbonated drink",
          targetPlatform: "tiktok"
        },
        targetDurationMs: 2500
      },
      {
        ordinal: 2,
        brief: {
          title: "Feature Showcase",
          description: "Wide shot showing athletes enjoying the refreshing drink on a court"
        },
        targetDurationMs: 5000
      },
      {
        ordinal: 3,
        brief: {
          title: "Call to Action",
          description: "Product logo lockup with animated slogan on screen"
        },
        targetDurationMs: 2500
      }
    ]
  };

  it("validates a fully valid beat sheet and sorts beats by ordinal", () => {
    // Pass out of order
    const candidateWithSwappedBeats = {
      beats: [
        validBeatsCandidate.beats[1],
        validBeatsCandidate.beats[0],
        validBeatsCandidate.beats[2]
      ]
    };

    const result = validateCampaignBeatSheet(candidateWithSwappedBeats, {
      totalScenes: 3,
      targetTotalDurationMs: 10000
    });

    expect(result.beats).toHaveLength(3);
    expect(result.beats[0]?.ordinal).toBe(1);
    expect(result.beats[1]?.ordinal).toBe(2);
    expect(result.beats[2]?.ordinal).toBe(3);
    expect(result.beats[0]?.targetDurationMs).toBe(2500);
    expect(result.beats[1]?.targetDurationMs).toBe(5000);
    expect(result.beats[2]?.targetDurationMs).toBe(2500);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.beats)).toBe(true);
    expect(Object.isFrozen(result.beats[0])).toBe(true);
  });

  it("accepts candidate as array of beats directly", () => {
    const result = validateCampaignBeatSheet(validBeatsCandidate.beats, {
      totalScenes: 3,
      targetTotalDurationMs: 10000
    });
    expect(result.beats).toHaveLength(3);
  });

  it("rejects non-object candidates", () => {
    expect(() =>
      validateCampaignBeatSheet("not an object", { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow(CampaignBeatSheetValidationError);

    expect(() =>
      validateCampaignBeatSheet(null, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow(CampaignBeatSheetValidationError);
  });

  it("rejects candidate without beats array", () => {
    expect(() =>
      validateCampaignBeatSheet({}, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("Candidate must contain a 'beats' array");
  });

  it("rejects when beat count does not match totalScenes", () => {
    expect(() =>
      validateCampaignBeatSheet(validBeatsCandidate, {
        totalScenes: 2,
        targetTotalDurationMs: 10000
      })
    ).toThrow("beats array must contain exactly 2 beats, got 3");

    expect(() =>
      validateCampaignBeatSheet(validBeatsCandidate, {
        totalScenes: 4,
        targetTotalDurationMs: 10000
      })
    ).toThrow("beats array must contain exactly 4 beats, got 3");
  });

  it("rejects invalid beat ordinal", () => {
    const invalidOrdinal = {
      beats: [
        { ...validBeatsCandidate.beats[0], ordinal: 0 },
        validBeatsCandidate.beats[1],
        validBeatsCandidate.beats[2]
      ]
    };
    expect(() =>
      validateCampaignBeatSheet(invalidOrdinal, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("ordinal");
  });

  it("rejects duplicate beat ordinals", () => {
    const duplicateOrdinal = {
      beats: [
        validBeatsCandidate.beats[0],
        { ...validBeatsCandidate.beats[1], ordinal: 1 },
        validBeatsCandidate.beats[2]
      ]
    };
    expect(() =>
      validateCampaignBeatSheet(duplicateOrdinal, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("Duplicate beat ordinal 1");
  });

  it("rejects out of range beat ordinals", () => {
    const outOfRange = {
      beats: [
        validBeatsCandidate.beats[0],
        validBeatsCandidate.beats[1],
        { ...validBeatsCandidate.beats[2], ordinal: 4 }
      ]
    };
    expect(() =>
      validateCampaignBeatSheet(outOfRange, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("Beat ordinal 4 is out of range 1..3");
  });

  it("rejects invalid brief in beat", () => {
    const invalidBrief = {
      beats: [
        {
          ...validBeatsCandidate.beats[0],
          brief: { description: "", title: "Empty description" }
        },
        validBeatsCandidate.beats[1],
        validBeatsCandidate.beats[2]
      ]
    };
    expect(() =>
      validateCampaignBeatSheet(invalidBrief, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("brief failed validation");
  });

  it("rejects non-positive targetDurationMs", () => {
    const nonPositive = {
      beats: [
        { ...validBeatsCandidate.beats[0], targetDurationMs: 0 },
        validBeatsCandidate.beats[1],
        validBeatsCandidate.beats[2]
      ]
    };
    expect(() =>
      validateCampaignBeatSheet(nonPositive, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("targetDurationMs must be a positive integer");
  });

  it("rejects non-integer targetDurationMs", () => {
    const nonInteger = {
      beats: [
        { ...validBeatsCandidate.beats[0], targetDurationMs: 2500.5 },
        validBeatsCandidate.beats[1],
        validBeatsCandidate.beats[2]
      ]
    };
    expect(() =>
      validateCampaignBeatSheet(nonInteger, { totalScenes: 3, targetTotalDurationMs: 10000 })
    ).toThrow("targetDurationMs must be a positive integer");
  });

  it("rejects when sum of durations does not match targetTotalDurationMs (zero tolerance)", () => {
    expect(() =>
      validateCampaignBeatSheet(validBeatsCandidate, {
        totalScenes: 3,
        targetTotalDurationMs: 9999
      })
    ).toThrow("sum of beat durations (10000ms) does not match targetTotalDurationMs (9999ms)");

    expect(() =>
      validateCampaignBeatSheet(validBeatsCandidate, {
        totalScenes: 3,
        targetTotalDurationMs: 10001
      })
    ).toThrow("sum of beat durations (10000ms) does not match targetTotalDurationMs (10001ms)");
  });
});
