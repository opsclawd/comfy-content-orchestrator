import { describe, expect, it } from "vitest";
import { ExecutedVideoStemRefSchema, VideoStemRefSchema } from "./video-stem.js";

describe("VideoStemRef contracts", () => {
  const validStem = {
    sceneId: "scene-123",
    generationManifestId: "gen-man-456",
    order: 0,
    media: {
      bucket: "cco-renders",
      key: "scenes/scene-123/render.mp4",
      sha256: "b".repeat(64),
      contentType: "video/mp4"
    },
    expectedDurationMs: 5000
  };

  const validExecutedStem = {
    sceneId: "scene-123",
    generationManifestId: "gen-man-456",
    order: 0,
    media: {
      bucket: "cco-renders",
      key: "scenes/scene-123/render.mp4",
      sha256: "b".repeat(64),
      contentType: "video/mp4"
    },
    actualDurationMs: 5000
  };

  it("accepts valid VideoStemRef", () => {
    const parsed = VideoStemRefSchema.parse(validStem);
    expect(parsed).toEqual(validStem);
  });

  it("accepts valid ExecutedVideoStemRef", () => {
    const parsed = ExecutedVideoStemRefSchema.parse(validExecutedStem);
    expect(parsed).toEqual(validExecutedStem);
  });

  it("rejects negative or fractional order", () => {
    expect(VideoStemRefSchema.safeParse({ ...validStem, order: -1 }).success).toBe(false);
    expect(VideoStemRefSchema.safeParse({ ...validStem, order: 1.5 }).success).toBe(false);
    expect(ExecutedVideoStemRefSchema.safeParse({ ...validExecutedStem, order: -1 }).success).toBe(
      false
    );
  });

  it("rejects non-positive or fractional duration", () => {
    expect(VideoStemRefSchema.safeParse({ ...validStem, expectedDurationMs: 0 }).success).toBe(
      false
    );
    expect(VideoStemRefSchema.safeParse({ ...validStem, expectedDurationMs: -500 }).success).toBe(
      false
    );
    expect(VideoStemRefSchema.safeParse({ ...validStem, expectedDurationMs: 5000.5 }).success).toBe(
      false
    );
    expect(
      ExecutedVideoStemRefSchema.safeParse({ ...validExecutedStem, actualDurationMs: 0 }).success
    ).toBe(false);
  });

  it("rejects empty sceneId or generationManifestId", () => {
    expect(VideoStemRefSchema.safeParse({ ...validStem, sceneId: "" }).success).toBe(false);
    expect(VideoStemRefSchema.safeParse({ ...validStem, generationManifestId: "" }).success).toBe(
      false
    );
  });

  it("rejects invalid embedded media ref", () => {
    expect(
      VideoStemRefSchema.safeParse({
        ...validStem,
        media: {
          bucket: "cco-renders",
          key: "scenes/scene-123/render.mp4",
          sha256: "invalid-hash",
          contentType: "video/mp4"
        }
      }).success
    ).toBe(false);
  });
});
