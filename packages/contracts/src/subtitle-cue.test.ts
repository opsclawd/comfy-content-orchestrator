import { describe, expect, it } from "vitest";
import {
  EMPTY_SUBTITLE_CUES_CANONICAL,
  EMPTY_SUBTITLE_CUES_SHA256,
  NO_SUBTITLE_CUES_SHA256,
  SubtitleCueSchema,
  canonicalizeSubtitleCues,
  hashSubtitleCues,
  validateSubtitleTimeline
} from "./subtitle-cue.js";

describe("SubtitleCue contract", () => {
  it("accepts valid SubtitleCue", () => {
    const cue = {
      startMs: 0,
      endMs: 2500,
      text: "The dawn breaks over the neon horizon."
    };
    const parsed = SubtitleCueSchema.parse(cue);
    expect(parsed).toEqual(cue);
  });

  it("rejects negative startMs or negative endMs", () => {
    expect(
      SubtitleCueSchema.safeParse({
        startMs: -500,
        endMs: 2000,
        text: "Negative start"
      }).success
    ).toBe(false);

    expect(
      SubtitleCueSchema.safeParse({
        startMs: -1000,
        endMs: -500,
        text: "Negative start and end"
      }).success
    ).toBe(false);
  });

  it("rejects endMs <= startMs (equal or inverted times)", () => {
    expect(
      SubtitleCueSchema.safeParse({
        startMs: 1000,
        endMs: 1000,
        text: "Zero duration"
      }).success
    ).toBe(false);

    expect(
      SubtitleCueSchema.safeParse({
        startMs: 2000,
        endMs: 1000,
        text: "Inverted start and end"
      }).success
    ).toBe(false);
  });

  it("rejects empty text", () => {
    expect(
      SubtitleCueSchema.safeParse({
        startMs: 0,
        endMs: 1000,
        text: ""
      }).success
    ).toBe(false);
  });

  describe("validateSubtitleTimeline", () => {
    const cues = [
      { startMs: 0, endMs: 2000, text: "First cue" },
      { startMs: 2000, endMs: 5000, text: "Second cue" }
    ];

    it("passes when all cues fit within totalDurationMs", () => {
      expect(() => validateSubtitleTimeline(cues, 5000)).not.toThrow();
      expect(() => validateSubtitleTimeline(cues, 10000)).not.toThrow();
    });

    it("throws when totalDurationMs is zero or negative", () => {
      expect(() => validateSubtitleTimeline(cues, 0)).toThrow(/positive number/);
      expect(() => validateSubtitleTimeline(cues, -1000)).toThrow(/positive number/);
    });

    it("throws when any cue endMs overflows totalDurationMs", () => {
      expect(() => validateSubtitleTimeline(cues, 4000)).toThrow(
        /overflows timeline: endMs \(5000\) > totalDurationMs \(4000\)/
      );
    });

    it("throws when any cue has negative startMs or endMs <= startMs", () => {
      const badCues = [{ startMs: 3000, endMs: 2000, text: "Inverted" }];
      expect(() => validateSubtitleTimeline(badCues, 10000)).toThrow(
        /endMs \(2000\) <= startMs \(3000\)/
      );
    });
  });

  describe("canonicalizeSubtitleCues and hashSubtitleCues", () => {
    it("computes deterministic SHA-256 hash for subtitle cues synchronously", () => {
      const cues = [
        { startMs: 0, endMs: 2000, text: "Line 1" },
        { startMs: 2000, endMs: 4000, text: "Line 2" }
      ];

      const canonical = canonicalizeSubtitleCues(cues);
      expect(canonical).toBe(
        JSON.stringify([
          { startMs: 0, endMs: 2000, text: "Line 1" },
          { startMs: 2000, endMs: 4000, text: "Line 2" }
        ])
      );

      const hash1 = hashSubtitleCues(cues);
      const hash2 = hashSubtitleCues(cues);
      expect(hash1).toHaveLength(64);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash1).toBe(hash2);
    });

    it("handles empty / no-cues case with explicit canonical representation and hash", () => {
      expect(canonicalizeSubtitleCues([])).toBe(EMPTY_SUBTITLE_CUES_CANONICAL);
      expect(canonicalizeSubtitleCues()).toBe(EMPTY_SUBTITLE_CUES_CANONICAL);
      expect(EMPTY_SUBTITLE_CUES_CANONICAL).toBe("[]");

      const emptyHash = hashSubtitleCues([]);
      expect(emptyHash).toBe(EMPTY_SUBTITLE_CUES_SHA256);
      expect(emptyHash).toBe(NO_SUBTITLE_CUES_SHA256);
      expect(hashSubtitleCues()).toBe(NO_SUBTITLE_CUES_SHA256);
      expect(emptyHash).toBe("4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945");
    });
  });
});
