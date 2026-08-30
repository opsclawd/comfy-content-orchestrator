import { z } from "zod";

export const ASSEMBLY_LAYOUT_MODES = ["fit_blurred_fill", "direct_fit"] as const;
export const AssemblyLayoutModeSchema = z.enum(ASSEMBLY_LAYOUT_MODES);
export type AssemblyLayoutMode = (typeof ASSEMBLY_LAYOUT_MODES)[number];

export const ASSEMBLY_PROFILE_KEYS = ["VERTICAL_REEL_1080X1920_V1"] as const;
export const AssemblyProfileKeySchema = z.enum(ASSEMBLY_PROFILE_KEYS);
export type AssemblyProfileKey = (typeof ASSEMBLY_PROFILE_KEYS)[number];

export const VerticalReel1080x1920V1IdentitySchema = z.object({
  key: z.literal("VERTICAL_REEL_1080X1920_V1"),
  version: z.literal(1)
});
export type VerticalReel1080x1920V1Identity = {
  readonly key: "VERTICAL_REEL_1080X1920_V1";
  readonly version: 1;
};

export const AssemblyProfileIdentitySchema = VerticalReel1080x1920V1IdentitySchema;
export type AssemblyProfileIdentity = VerticalReel1080x1920V1Identity;

export const VerticalReel1080x1920V1ProfileSchema = z.object({
  key: z.literal("VERTICAL_REEL_1080X1920_V1"),
  version: z.literal(1),
  container: z.literal("mp4"),
  width: z.literal(1080),
  height: z.literal(1920),
  frameRate: z.literal(30),
  videoCodecFamily: z.literal("h264"),
  pixelFormatFamily: z.literal("yuv420p"),
  audioCodecFamily: z.literal("aac"),
  audioChannels: z.literal(2),
  audioSampleRateHz: z.literal(48000),
  layoutMode: z.literal("fit_blurred_fill")
});
export type VerticalReel1080x1920V1Profile = {
  readonly key: "VERTICAL_REEL_1080X1920_V1";
  readonly version: 1;
  readonly container: "mp4";
  readonly width: 1080;
  readonly height: 1920;
  readonly frameRate: 30;
  readonly videoCodecFamily: "h264";
  readonly pixelFormatFamily: "yuv420p";
  readonly audioCodecFamily: "aac";
  readonly audioChannels: 2;
  readonly audioSampleRateHz: 48000;
  readonly layoutMode: "fit_blurred_fill";
};

export const AssemblyProfileSchema = z.discriminatedUnion("key", [
  VerticalReel1080x1920V1ProfileSchema
]);
export type AssemblyProfile = VerticalReel1080x1920V1Profile;

export const VERTICAL_REEL_1080X1920_V1_PROFILE: VerticalReel1080x1920V1Profile = Object.freeze({
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
