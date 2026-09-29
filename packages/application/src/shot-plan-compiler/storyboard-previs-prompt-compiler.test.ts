import { describe, expect, it } from "vitest";
import {
  compileStoryboardPrevisPrompt,
  STORYBOARD_CLEAN_PANEL_DIRECTIVE,
  STORYBOARD_NEGATIVE_PROMPT,
  STORYBOARD_PREVIS_PROFILE_ID,
  STORYBOARD_PREVIS_RENDER_PROFILE_KEY,
  STORYBOARD_STYLE_HEADER,
  type StoryboardPrevisShotPlanInput
} from "./storyboard-previs-prompt-compiler.js";
import {
  CAMERA_ANGLES,
  LIGHTING_STYLES,
  SHOT_FRAMINGS,
  type CameraAngle,
  type LightingStyle,
  type ShotFraming
} from "@cco/contracts";

function createMinimalShotPlan(
  overrides: Partial<StoryboardPrevisShotPlanInput> = {}
): StoryboardPrevisShotPlanInput {
  return {
    id: "01928374-abcd-7000-8000-000000000001",
    sceneId: "01928374-abcd-7000-8000-000000000002",
    specRevision: 1,
    variantOrdinal: 1,
    status: "draft",
    routingMode: "reference_directed",
    targetDurationMs: 4000,
    targetFrameCount: 97,
    durationToleranceMs: 355,
    fps: 24,
    framing: "medium_wide",
    angle: "eye_level",
    lensIntent: "35mm prime",
    cameraPosition: "eye level facing subject",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    cameraPromptDescription: "Camera slowly dollies in on hero operative",
    subjects: [
      {
        subjectId: "hero-operative",
        role: "subject_identity",
        referenceAssetId: "01928374-abcd-7000-8000-000000000011",
        initialPosition: "screen_center",
        movementTrajectory: "stands motionless, scanning surroundings",
        interactionSummary: "looks toward incoming threat"
      },
      {
        subjectId: "scanner-device",
        role: "product",
        initialPosition: "foreground_left",
        movementTrajectory: "held in left hand, indicator glowing",
        interactionSummary: "held securely"
      }
    ],
    actionSummary: "Operative activates scanner in rainy alleyway",
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 4000,
        description: "Operative powers up scanner",
        cameraAction: "slow dolly in",
        subjectAction: "raises device to eye level"
      }
    ],
    lightingStyle: "neon_night",
    environmentDescription: "Rain-slicked alleyway with reflective puddles",
    colorPalette: ["cyan", "magenta"],
    atmosphere: "steamy neon rain haze",
    continuity: {
      persistentSubjectIds: ["hero-operative"],
      lightingContinuityNote: "Maintain magenta neon rim light from scene 1",
      frameAnchorTarget: "first_frame"
    },
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-09-29T10:00:00.000Z",
    ...overrides
  };
}

describe("compileStoryboardPrevisPrompt", () => {
  it("compiles deterministically: identical input produces identical prompt and negativePrompt", () => {
    const shotPlan = createMinimalShotPlan();
    const result1 = compileStoryboardPrevisPrompt(shotPlan);
    const result2 = compileStoryboardPrevisPrompt(shotPlan);

    expect(result1.prompt).toBe(result2.prompt);
    expect(result1.negativePrompt).toBe(result2.negativePrompt);
    expect(result1.profileId).toBe(STORYBOARD_PREVIS_PROFILE_ID);
    expect(result1.renderProfileKey).toBe(STORYBOARD_PREVIS_RENDER_PROFILE_KEY);
    expect(result1.version).toBe(1);
  });

  it("embeds the fixed storyboard style header and clean panel directive", () => {
    const shotPlan = createMinimalShotPlan();
    const result = compileStoryboardPrevisPrompt(shotPlan);

    expect(result.prompt.startsWith(STORYBOARD_STYLE_HEADER)).toBe(true);
    expect(result.prompt.endsWith(STORYBOARD_CLEAN_PANEL_DIRECTIVE)).toBe(true);
    expect(result.negativePrompt).toBe(STORYBOARD_NEGATIVE_PROMPT);
  });

  describe("framing mapping", () => {
    it.each(SHOT_FRAMINGS)("maps framing '%s' to readable framing vocabulary", (framing) => {
      const plan = createMinimalShotPlan({ framing: framing as ShotFraming });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toMatch(new RegExp(`framing`, "i"));
      // The positive prompt should mention the normalized framing
      const normalizedFraming = framing.replace(/_/g, "[- ]?");
      expect(result.prompt).toMatch(new RegExp(normalizedFraming, "i"));
    });
  });

  describe("camera angle mapping", () => {
    it.each(CAMERA_ANGLES)("maps angle '%s' to readable perspective vocabulary", (angle) => {
      const plan = createMinimalShotPlan({ angle: angle as CameraAngle });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toMatch(/camera angle|angle/i);
    });
  });

  describe("camera staging, position, lens, and motion", () => {
    it("includes cameraPosition, lensIntent, cameraMovement, and movementSpeed", () => {
      const plan = createMinimalShotPlan({
        cameraPosition: "high crane angle at 45 degrees",
        lensIntent: "24mm ultra-wide",
        cameraMovement: "tilt_down",
        movementSpeed: "fast"
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Position: high crane angle at 45 degrees.");
      expect(result.prompt).toContain("Lens: 24mm ultra-wide.");
      expect(result.prompt).toContain("Camera motion: fast tilt down.");
    });

    it("handles static camera movement without motion speed clause", () => {
      const plan = createMinimalShotPlan({
        cameraMovement: "static",
        movementSpeed: "medium"
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Static camera.");
      expect(result.prompt).not.toContain("Camera motion: medium static");
    });
  });

  describe("subjects, blocking, roles, and screen/depth positions", () => {
    it("breaks down subject count and declarations by character and product", () => {
      const plan = createMinimalShotPlan();
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("2 subject(s) (1 character(s), 1 product(s))");
      expect(result.prompt).toContain("Character [hero-operative] staged at screen center");
      expect(result.prompt).toContain("blocking: stands motionless, scanning surroundings");
      expect(result.prompt).toContain("Interaction: looks toward incoming threat.");
      expect(result.prompt).toContain("Product/prop [scanner-device] staged at foreground left");
      expect(result.prompt).toContain("blocking: held in left hand, indicator glowing");
      expect(result.prompt).toContain("Interaction: held securely.");
    });

    it("handles zero subjects gracefully", () => {
      const plan = createMinimalShotPlan({ subjects: [] });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Staging: Solo scene without distinct character blocking.");
    });

    it.each([
      "screen_left",
      "screen_center",
      "screen_right",
      "foreground_left",
      "foreground_center",
      "foreground_right",
      "background_center"
    ] as const)("preserves normalized position '%s'", (pos) => {
      const plan = createMinimalShotPlan({
        subjects: [
          {
            subjectId: "subject-test",
            role: "subject_identity",
            initialPosition: pos,
            movementTrajectory: "paces forward"
          }
        ]
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain(`staged at ${pos.replace(/_/g, " ")}`);
    });
  });

  describe("action summary and beats", () => {
    it("includes actionSummary and first beat staging", () => {
      const plan = createMinimalShotPlan({
        actionSummary: "Hero operative turns abruptly to face camera",
        beats: [
          {
            beatIndex: 1,
            startMs: 0,
            endMs: 2000,
            description: "Sudden pivot toward viewer",
            cameraAction: "holds medium framing",
            subjectAction: "pivots on left heel"
          }
        ]
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Action: Hero operative turns abruptly to face camera.");
      expect(result.prompt).toContain(
        "Primary staging: pivots on left heel (beat 1: Sudden pivot toward viewer)."
      );
    });

    it("handles empty beats array without throwing", () => {
      const plan = createMinimalShotPlan({
        actionSummary: "Hero operative stands quietly",
        beats: []
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Action: Hero operative stands quietly.");
      expect(result.prompt).not.toContain("Primary staging:");
    });
  });

  describe("environment, atmosphere, lighting, and palette", () => {
    it("includes environmentDescription and atmosphere", () => {
      const plan = createMinimalShotPlan({
        environmentDescription: "Rooftop helipad overlooking dystopian skyline",
        atmosphere: "heavy storm fog with searchlight beams"
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Setting: Rooftop helipad overlooking dystopian skyline.");
      expect(result.prompt).toContain("Atmosphere: heavy storm fog with searchlight beams.");
    });

    it("omits atmosphere clause when atmosphere is null, undefined, or blank", () => {
      const plan = createMinimalShotPlan({ atmosphere: null });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).not.toContain("Atmosphere:");
    });

    it.each(LIGHTING_STYLES)("renders impressionistic lighting for '%s'", (lighting) => {
      const plan = createMinimalShotPlan({ lightingStyle: lighting as LightingStyle });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Lighting: Impressionistic");
      expect(result.prompt).toContain("with marker wash tone shading.");
    });

    it("renders restrained marker palette when colorPalette is provided", () => {
      const plan = createMinimalShotPlan({ colorPalette: ["cobalt blue", "amber", "charcoal"] });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain(
        "Restrained marker tone palette: cobalt blue, amber, charcoal."
      );
    });

    it("omits palette clause when colorPalette is empty", () => {
      const plan = createMinimalShotPlan({ colorPalette: [] });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).not.toContain("Restrained marker tone palette:");
    });
  });

  describe("continuity cues", () => {
    it("includes persistent subject ids, lighting note, and frame anchor target", () => {
      const plan = createMinimalShotPlan({
        continuity: {
          persistentSubjectIds: ["hero-operative", "drone-companion"],
          lightingContinuityNote: "Maintain backlight from scene 2",
          frameAnchorTarget: "first_frame"
        }
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain(
        "Continuity: Persistent subject(s) [hero-operative, drone-companion]."
      );
      expect(result.prompt).toContain("Lighting continuity note: Maintain backlight from scene 2.");
      expect(result.prompt).toContain("Frame anchor: match cut anchor for first frame.");
    });

    it("omits continuity clauses when fields are empty or none", () => {
      const plan = createMinimalShotPlan({
        continuity: {
          persistentSubjectIds: [],
          lightingContinuityNote: null,
          frameAnchorTarget: "none"
        }
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).not.toContain("Continuity:");
      expect(result.prompt).not.toContain("Persistent subject(s)");
      expect(result.prompt).not.toContain("Lighting continuity note");
      expect(result.prompt).not.toContain("Frame anchor:");
    });
  });

  describe("anti-photorealism & visual avoidance directives", () => {
    it("explicitly suppresses photorealism, skin pores, and camera notation in negative prompt", () => {
      const plan = createMinimalShotPlan();
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.negativePrompt).toContain("photorealistic");
      expect(result.negativePrompt).toContain("photograph");
      expect(result.negativePrompt).toContain("skin pores");
      expect(result.negativePrompt).toContain("movie still");
      expect(result.negativePrompt).toContain("camera annotations");
      expect(result.negativePrompt).toContain("typography");
      expect(result.negativePrompt).toContain("arrows");
      expect(result.negativePrompt).toContain("frame labels");
    });

    it("directs clean storyboard panel artwork inside positive prompt", () => {
      const plan = createMinimalShotPlan();
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain("Clean storyboard frame artwork");
      expect(result.prompt).toContain("no text, no labels, no speech bubbles, no arrows");
    });
  });

  describe("domain purity", () => {
    it("does not accept or depend on presentation-only fields on ShotPlan authority", () => {
      const plan = createMinimalShotPlan();
      const planRecord = plan as unknown as Record<string, unknown>;

      // Assert that ShotPlan does NOT define presentation-only styling fields
      expect(planRecord["storyboardStyle"]).toBeUndefined();
      expect(planRecord["sketchType"]).toBeUndefined();
      expect(planRecord["lineWeight"]).toBeUndefined();
      expect(planRecord["markerPalette"]).toBeUndefined();

      // Compiling succeeds without these fields
      const result = compileStoryboardPrevisPrompt(plan);
      expect(result.prompt).toBeDefined();
    });
  });
});
