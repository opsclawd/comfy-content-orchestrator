import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS,
  AssemblyTimelineDecisionSchema,
  validateExecutedAssemblyInvariants,
  type ExecutedAssemblyInvariantPayload
} from "./assembly-execution-invariants.js";

describe("assembly-execution-invariants", () => {
  const dummyMedia = {
    bucket: "cco-renders",
    key: "scenes/scene-1/render.mp4",
    sha256: "1".repeat(64),
    contentType: "video/mp4"
  };

  const dummyAudioMedia = {
    bucket: "cco-audio",
    key: "audio/sample.mp3",
    sha256: "2".repeat(64),
    contentType: "audio/mpeg"
  };

  const createBasePayload = (): ExecutedAssemblyInvariantPayload => ({
    timeline: {
      totalDurationMs: 10000,
      stemDurationsMs: [5000, 5000]
    },
    inputs: {
      videoStems: [
        {
          sceneId: "scene-1",
          generationManifestId: "gen-man-1",
          order: 0,
          media: dummyMedia,
          actualDurationMs: 5000
        },
        {
          sceneId: "scene-2",
          generationManifestId: "gen-man-2",
          order: 1,
          media: dummyMedia,
          actualDurationMs: 5000
        }
      ],
      voiceover: {
        assetId: "vo-1",
        kind: "voiceover",
        media: dummyAudioMedia,
        source: { kind: "local" },
        startMs: 0,
        actualDurationMs: 10000,
        effectiveStartMs: 0,
        effectiveDurationMs: 10000,
        trimStartMs: 0,
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: 0
      },
      soundbed: {
        assetId: "sb-1",
        kind: "soundbed",
        media: dummyAudioMedia,
        source: { kind: "local" },
        startMs: 0,
        actualDurationMs: 10000,
        effectiveStartMs: 0,
        effectiveDurationMs: 10000,
        trimStartMs: 0,
        loopCount: 0,
        padLeadingMs: 0,
        padTrailingMs: 0,
        gainDb: -14.0,
        duckingDb: -10.0
      }
    },
    output: {
      durationMs: 10000
    },
    subtitleCues: [
      { startMs: 0, endMs: 5000, text: "Scene 1" },
      { startMs: 5000, endMs: 10000, text: "Scene 2" }
    ]
  });

  const runValidation = (
    payload: ExecutedAssemblyInvariantPayload,
    options?: { inputsKey?: "executedInputs" | "inputs" }
  ): z.ZodIssue[] => {
    const issues: z.ZodIssue[] = [];
    const ctx: z.RefinementCtx = {
      addIssue: (issue) => {
        issues.push(issue as z.ZodIssue);
      },
      path: []
    };
    validateExecutedAssemblyInvariants(payload, ctx, options);
    return issues;
  };

  it("passes validation for a fully consistent payload", () => {
    const payload = createBasePayload();
    const issues = runValidation(payload);
    expect(issues).toHaveLength(0);
  });

  describe("AssemblyTimelineDecisionSchema", () => {
    it("accepts valid timeline decision", () => {
      const valid = {
        totalDurationMs: 10000,
        stemDurationsMs: [5000, 5000]
      };
      expect(AssemblyTimelineDecisionSchema.parse(valid)).toEqual(valid);
    });

    it("rejects non-positive totalDurationMs or empty stemDurationsMs", () => {
      expect(
        AssemblyTimelineDecisionSchema.safeParse({
          totalDurationMs: 0,
          stemDurationsMs: [5000]
        }).success
      ).toBe(false);

      expect(
        AssemblyTimelineDecisionSchema.safeParse({
          totalDurationMs: 5000,
          stemDurationsMs: []
        }).success
      ).toBe(false);
    });
  });

  describe("stem count and stem duration equality", () => {
    it("reports issue when stemDurationsMs length does not match videoStems count", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        timeline: {
          totalDurationMs: 15000,
          stemDurationsMs: [5000, 5000, 5000]
        }
      };
      const issues = runValidation(modified, { inputsKey: "executedInputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "timeline.stemDurationsMs length (3) does not match executedInputs.videoStems length (2)"
          )
        )
      ).toBe(true);
    });

    it("reports issue when timeline stem duration does not match stem actualDurationMs", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        timeline: {
          totalDurationMs: 10000,
          stemDurationsMs: [4000, 6000] // Stem 0 has 5000ms actual, stem 1 has 5000ms actual
        }
      };
      const issues = runValidation(modified);
      expect(
        issues.some((i) =>
          i.message.includes(
            "timeline.stemDurationsMs[0] (4000) does not match video stem (order 0) actualDurationMs (5000)"
          )
        )
      ).toBe(true);
      expect(
        issues.some((i) =>
          i.message.includes(
            "timeline.stemDurationsMs[1] (6000) does not match video stem (order 1) actualDurationMs (5000)"
          )
        )
      ).toBe(true);
    });

    it("correctly matches stem durations by stem.order even when stems array is out of physical order", () => {
      const payload = createBasePayload();
      // Stem with order: 1 is first in array (actualDurationMs: 7000), stem with order: 0 is second (actualDurationMs: 3000)
      const outOfOrderPayload: ExecutedAssemblyInvariantPayload = {
        ...payload,
        timeline: {
          totalDurationMs: 10000,
          stemDurationsMs: [3000, 7000] // index 0 matches order 0, index 1 matches order 1
        },
        inputs: {
          ...payload.inputs,
          videoStems: [
            {
              sceneId: "scene-2",
              generationManifestId: "gen-man-2",
              order: 1,
              media: dummyMedia,
              actualDurationMs: 7000
            },
            {
              sceneId: "scene-1",
              generationManifestId: "gen-man-1",
              order: 0,
              media: dummyMedia,
              actualDurationMs: 3000
            }
          ]
        }
      };
      const issues = runValidation(outOfOrderPayload);
      expect(issues).toHaveLength(0);
    });
  });

  describe("Phase 1 total duration composition rule", () => {
    it("reports issue when totalDurationMs does not equal the sum of stemDurationsMs", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        timeline: {
          totalDurationMs: 9999,
          stemDurationsMs: [5000, 5000]
        },
        output: {
          durationMs: 9999
        }
      };
      const issues = runValidation(modified);
      expect(
        issues.some((i) =>
          i.message.includes(
            "timeline.totalDurationMs (9999) must match sum of stemDurationsMs (10000)"
          )
        )
      ).toBe(true);
    });
  });

  describe("output duration tolerance", () => {
    it("accepts output duration exactly at the boundary of tolerance (250ms above/below)", () => {
      const payload = createBasePayload();
      const above = {
        ...payload,
        output: { durationMs: 10000 + ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS }
      };
      expect(runValidation(above)).toHaveLength(0);

      const below = {
        ...payload,
        output: { durationMs: 10000 - ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS }
      };
      expect(runValidation(below)).toHaveLength(0);
    });

    it("rejects output duration that exceeds tolerance by 1ms (251ms)", () => {
      const payload = createBasePayload();
      const tooHigh = {
        ...payload,
        output: { durationMs: 10000 + ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS + 1 }
      };
      const issuesHigh = runValidation(tooHigh);
      expect(
        issuesHigh.some((i) => i.message.includes("exceeding allowed tolerance of 250ms"))
      ).toBe(true);

      const tooLow = {
        ...payload,
        output: { durationMs: 10000 - (ASSEMBLY_OUTPUT_DURATION_TOLERANCE_MS + 1) }
      };
      const issuesLow = runValidation(tooLow);
      expect(
        issuesLow.some((i) => i.message.includes("exceeding allowed tolerance of 250ms"))
      ).toBe(true);
    });
  });

  describe("subtitle cues against executed timeline", () => {
    it("rejects subtitle cue extending beyond executed timeline totalDurationMs", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        subtitleCues: [
          { startMs: 0, endMs: 5000, text: "Scene 1" },
          { startMs: 5000, endMs: 10001, text: "Overflowing cue" }
        ]
      };
      const issues = runValidation(modified);
      expect(
        issues.some((i) =>
          i.message.includes("overflows timeline: endMs (10001) > totalDurationMs (10000)")
        )
      ).toBe(true);
    });
  });

  describe("audio timing provenance against executed timeline", () => {
    it("rejects voiceover when trimStartMs >= actualDurationMs", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          voiceover: {
            ...payload.inputs.voiceover!,
            actualDurationMs: 5000,
            trimStartMs: 5000,
            effectiveDurationMs: 0
          }
        }
      };
      const issues = runValidation(modified, { inputsKey: "executedInputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "voiceover trimStartMs (5000) must be strictly less than actualDurationMs (5000)"
          )
        )
      ).toBe(true);
    });

    it("rejects voiceover when effectiveDurationMs does not match trim/loop/pad formula", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          voiceover: {
            ...payload.inputs.voiceover!,
            actualDurationMs: 10000,
            trimStartMs: 2000,
            loopCount: 0,
            padLeadingMs: 500,
            padTrailingMs: 500,
            effectiveDurationMs: 10000 // expected: 500 + (10000 - 2000) * 1 + 500 = 9000
          }
        }
      };
      const issues = runValidation(modified, { inputsKey: "executedInputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "voiceover effectiveDurationMs (10000) does not match computed audio duration from trim/loop/pad formula"
          )
        )
      ).toBe(true);
    });

    it("rejects soundbed when trimStartMs >= actualDurationMs", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          soundbed: {
            ...payload.inputs.soundbed!,
            actualDurationMs: 8000,
            trimStartMs: 9000,
            effectiveDurationMs: 8000
          }
        }
      };
      const issues = runValidation(modified, { inputsKey: "inputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "soundbed trimStartMs (9000) must be strictly less than actualDurationMs (8000)"
          )
        )
      ).toBe(true);
    });

    it("rejects soundbed when effectiveDurationMs does not match trim/loop/pad formula", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          soundbed: {
            ...payload.inputs.soundbed!,
            actualDurationMs: 6000,
            trimStartMs: 1000,
            loopCount: 1,
            padLeadingMs: 0,
            padTrailingMs: 0,
            effectiveDurationMs: 6000 // expected: 0 + (6000 - 1000) * (1 + 1) + 0 = 10000
          }
        }
      };
      const issues = runValidation(modified, { inputsKey: "inputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "soundbed effectiveDurationMs (6000) does not match computed audio duration from trim/loop/pad formula"
          )
        )
      ).toBe(true);
    });

    it("rejects voiceover overflowing executed timeline totalDurationMs + tolerance", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          voiceover: {
            assetId: "vo-1",
            kind: "voiceover" as const,
            media: dummyAudioMedia,
            source: { kind: "local" as const },
            startMs: 0,
            actualDurationMs: 10000,
            effectiveStartMs: 500,
            effectiveDurationMs: 10000, // 500 + 10000 = 10500 > 10000 + 250
            trimStartMs: 0,
            loopCount: 0,
            padLeadingMs: 0,
            padTrailingMs: 0,
            gainDb: 0
          }
        }
      };
      const issues = runValidation(modified, { inputsKey: "executedInputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "voiceover effective timing overflows executed timeline: effectiveStartMs (500) + effectiveDurationMs (10000) = 10500ms exceeds timeline.totalDurationMs (10000) + tolerance (250ms)"
          )
        )
      ).toBe(true);
    });

    it("rejects soundbed overflowing executed timeline totalDurationMs + tolerance", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          soundbed: {
            assetId: "sb-1",
            kind: "soundbed" as const,
            media: dummyAudioMedia,
            source: { kind: "local" as const },
            startMs: 0,
            actualDurationMs: 10000,
            effectiveStartMs: 1000,
            effectiveDurationMs: 9500, // 1000 + 9500 = 10500 > 10000 + 250
            trimStartMs: 500,
            loopCount: 0,
            padLeadingMs: 0,
            padTrailingMs: 0,
            gainDb: -14.0,
            duckingDb: -10.0
          }
        }
      };
      const issues = runValidation(modified, { inputsKey: "inputs" });
      expect(
        issues.some((i) =>
          i.message.includes(
            "soundbed effective timing overflows executed timeline: effectiveStartMs (1000) + effectiveDurationMs (9500) = 10500ms exceeds timeline.totalDurationMs (10000) + tolerance (250ms)"
          )
        )
      ).toBe(true);
    });

    it("accepts voiceover and soundbed with non-trivial trim/loop/pad within timeline + tolerance bounds", () => {
      const payload = createBasePayload();
      const modified = {
        ...payload,
        inputs: {
          ...payload.inputs,
          voiceover: {
            assetId: "vo-1",
            kind: "voiceover" as const,
            media: dummyAudioMedia,
            source: { kind: "local" as const },
            startMs: 0,
            actualDurationMs: 4000,
            effectiveStartMs: 100,
            effectiveDurationMs: 10100, // padLeadingMs(100) + (4000 - 1000) * (2 + 1) + padTrailingMs(1000) = 100 + 9000 + 1000 = 10100 (100 + 10100 = 10200 <= 10250)
            trimStartMs: 1000,
            loopCount: 2,
            padLeadingMs: 100,
            padTrailingMs: 1000,
            gainDb: 0
          }
        }
      };
      expect(runValidation(modified)).toHaveLength(0);
    });
  });
});
