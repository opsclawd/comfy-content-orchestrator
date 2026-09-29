import { describe, expect, it } from "vitest";
import type { ShotFraming } from "@cco/contracts";
import {
  formatSceneStatus,
  formatReviewAction,
  formatDurationMs,
  formatDurationSeconds,
  formatDateTime,
  formatShotFraming,
  formatCameraAngle,
  formatCameraMovement,
  formatMovementSpeed,
  formatBlockingPosition,
  formatLightingStyle,
  formatSceneSlug
} from "./format-review-value.js";

describe("format-review-value", () => {
  it("formats shot framing appropriately", () => {
    expect(formatShotFraming("medium_close_up")).toBe("Medium Close-up");
    expect(formatShotFraming("extreme_wide")).toBe("Extreme Wide");
    expect(formatShotFraming("full_shot")).toBe("Full Shot");
    expect(formatShotFraming("custom_framing" as unknown as ShotFraming)).toBe("Custom Framing");
  });

  it("formats camera angles", () => {
    expect(formatCameraAngle("eye_level")).toBe("Eye Level");
    expect(formatCameraAngle("low_angle")).toBe("Low Angle");
    expect(formatCameraAngle("bird_eye")).toBe("Bird's Eye");
    expect(formatCameraAngle("worm_eye")).toBe("Worm's Eye");
    expect(formatCameraAngle("over_the_shoulder")).toBe("Over The Shoulder");
  });

  it("formats camera movements", () => {
    expect(formatCameraMovement("dolly_in")).toBe("Dolly In");
    expect(formatCameraMovement("whip_pan")).toBe("Whip Pan");
    expect(formatCameraMovement("static")).toBe("Static");
    expect(formatCameraMovement("pedestal_down")).toBe("Pedestal Down");
  });

  it("formats movement speeds", () => {
    expect(formatMovementSpeed("slow")).toBe("Slow");
    expect(formatMovementSpeed("medium")).toBe("Medium");
    expect(formatMovementSpeed("fast")).toBe("Fast");
    expect(formatMovementSpeed("variable")).toBe("Variable");
  });

  it("formats blocking positions", () => {
    expect(formatBlockingPosition("screen_left")).toBe("screen left");
    expect(formatBlockingPosition("screen_center")).toBe("screen center");
    expect(formatBlockingPosition("foreground_right")).toBe("foreground right");
    expect(formatBlockingPosition("background_center")).toBe("background center");
  });

  it("formats lighting styles", () => {
    expect(formatLightingStyle("neon_night")).toBe("Neon Night");
    expect(formatLightingStyle("natural_golden_hour")).toBe("Natural Golden Hour");
    expect(formatLightingStyle("chiaroscuro")).toBe("Chiaroscuro");
  });

  it("formats scene slugs for slate headings", () => {
    expect(formatSceneSlug("scene-04")).toBe("04");
    expect(formatSceneSlug("SCENE_02")).toBe("02");
    expect(formatSceneSlug("22222222-2222-4222-8222-222222222222")).toBe("22222222");
    expect(formatSceneSlug(undefined)).toBe("01");
  });

  it("formats durations in seconds and milliseconds", () => {
    expect(formatDurationMs(4000)).toBe("4000 ms (4.00s)");
    expect(formatDurationSeconds(5170)).toBe("5.17 sec");
  });

  it("formats scene status and review actions", () => {
    expect(formatSceneStatus("director_review")).toBe("Director Review");
    expect(formatReviewAction("select_shotplan")).toBe("Select Shot Plan");
    expect(formatReviewAction("approve_shotplan")).toBe("Approve Shot Plan");
  });

  it("formats ISO datetime string", () => {
    const formatted = formatDateTime("2026-09-29T12:00:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("UTC");
  });
});
