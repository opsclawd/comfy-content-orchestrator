import { describe, expect, it } from "vitest";
import {
  ASSEMBLY_LAYOUT_MODES,
  AssemblyLayoutModeSchema,
  AssemblyProfileIdentitySchema,
  AssemblyProfileSchema,
  VERTICAL_REEL_1080X1920_V1_PROFILE,
  VerticalReel1080x1920V1ProfileSchema
} from "./assembly-profile.js";

describe("AssemblyProfile contract", () => {
  it("freezes VERTICAL_REEL_1080X1920_V1_PROFILE with exact Phase 1 parameters", () => {
    expect(VERTICAL_REEL_1080X1920_V1_PROFILE).toEqual({
      key: "VERTICAL_REEL_1080X1920_V1",
      version: 1,
      container: "mp4",
      width: 1080,
      height: 1920,
      frameRate: 30,
      videoCodecFamily: "h264",
      pixelFormatFamily: "yuv420p",
      audioCodecFamily: "aac",
      audioChannels: 2,
      audioSampleRateHz: 48000,
      layoutMode: "fit_blurred_fill"
    });

    expect(Object.isFrozen(VERTICAL_REEL_1080X1920_V1_PROFILE)).toBe(true);
  });

  it("validates the frozen profile against VerticalReel1080x1920V1ProfileSchema and AssemblyProfileSchema", () => {
    expect(VerticalReel1080x1920V1ProfileSchema.parse(VERTICAL_REEL_1080X1920_V1_PROFILE)).toEqual(
      VERTICAL_REEL_1080X1920_V1_PROFILE
    );

    expect(AssemblyProfileSchema.parse(VERTICAL_REEL_1080X1920_V1_PROFILE)).toEqual(
      VERTICAL_REEL_1080X1920_V1_PROFILE
    );
  });

  it("validates AssemblyProfileIdentitySchema accepting version 1 and rejecting version 2", () => {
    const validIdentity = {
      key: "VERTICAL_REEL_1080X1920_V1" as const,
      version: 1 as const
    };
    expect(AssemblyProfileIdentitySchema.parse(validIdentity)).toEqual(validIdentity);

    expect(
      AssemblyProfileIdentitySchema.safeParse({
        key: "VERTICAL_REEL_1080X1920_V1",
        version: 2
      }).success
    ).toBe(false);

    expect(
      AssemblyProfileIdentitySchema.safeParse({
        key: "NONEXISTENT_KEY",
        version: 1
      }).success
    ).toBe(false);
  });

  it("rejects unknown profile key", () => {
    expect(
      AssemblyProfileSchema.safeParse({
        ...VERTICAL_REEL_1080X1920_V1_PROFILE,
        key: "UNKNOWN_KEY"
      }).success
    ).toBe(false);
  });

  it("rejects invalid dimensions or frame rate", () => {
    expect(
      AssemblyProfileSchema.safeParse({
        ...VERTICAL_REEL_1080X1920_V1_PROFILE,
        width: 720
      }).success
    ).toBe(false);

    expect(
      AssemblyProfileSchema.safeParse({
        ...VERTICAL_REEL_1080X1920_V1_PROFILE,
        frameRate: 60
      }).success
    ).toBe(false);
  });

  it("supports recognized layout modes: fit_blurred_fill and direct_fit", () => {
    expect(ASSEMBLY_LAYOUT_MODES).toContain("fit_blurred_fill");
    expect(ASSEMBLY_LAYOUT_MODES).toContain("direct_fit");

    expect(AssemblyLayoutModeSchema.parse("fit_blurred_fill")).toBe("fit_blurred_fill");
    expect(AssemblyLayoutModeSchema.parse("direct_fit")).toBe("direct_fit");
    expect(AssemblyLayoutModeSchema.safeParse("crop").success).toBe(false);
  });
});
