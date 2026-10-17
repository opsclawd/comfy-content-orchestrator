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

  const INDEPENDENT_STORYBOARD_NEGATIVE_PROMPT =
    "photorealistic, photograph, 3d render, CGI, octane render, movie still, film frame, hyperrealistic, glossy skin, detailed skin pores, realistic human eyes, DSLR photo, camera annotations, on-screen text, typography, subtitles, speech bubble, arrows, frame labels, watermark, logo";

  it("embeds the fixed storyboard style header, clean panel directive, and leads with camera clause", () => {
    const shotPlan = createMinimalShotPlan();
    const result = compileStoryboardPrevisPrompt(shotPlan);

    // Angle keyword + camera clause lead the prompt
    expect(result.prompt.startsWith("EYE LEVEL. Camera:")).toBe(true);

    // Blocking precedes style, style appears intact
    const cameraIndex = result.prompt.indexOf("Camera:");
    const stagingIndex = result.prompt.indexOf("Staging:");
    const styleIndex = result.prompt.indexOf(STORYBOARD_STYLE_HEADER);
    const cleanPanelIndex = result.prompt.indexOf(STORYBOARD_CLEAN_PANEL_DIRECTIVE);

    expect(result.prompt.indexOf("EYE LEVEL.")).toBe(0);
    expect(stagingIndex).toBeGreaterThan(cameraIndex);
    expect(styleIndex).toBeGreaterThan(stagingIndex);
    expect(cleanPanelIndex).toBeGreaterThan(styleIndex);

    // Section boundaries are present (newlines)
    expect(result.prompt).toContain("\n\n");

    // Clean panel directive ends the prompt
    expect(result.prompt.endsWith(STORYBOARD_CLEAN_PANEL_DIRECTIVE)).toBe(true);

    // Compare negative prompt against independent literal
    expect(result.negativePrompt).toBe(INDEPENDENT_STORYBOARD_NEGATIVE_PROMPT);
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
    const EXPECTED_ANGLE_DESCRIPTIONS: Readonly<Record<CameraAngle, string>> = {
      eye_level: "Eye-level shot; camera at subject eye height, level horizontal viewpoint.",
      low_angle:
        "LOW ANGLE SHOT, shot from below. Camera placed near ground level, tilted sharply upward at the subjects. Subjects loom tall and dominant above the lens, exaggerated upward foreshortening, converging vertical lines, open sky or ceiling visible behind their heads, viewer looking up from a crouched vantage point.",
      high_angle:
        "HIGH ANGLE SHOT, shot from above. Pronounced high-angle shot; camera above the subjects looking downward at an oblique angle, elevated overhead vantage point, ground and subjects' heads/shoulders prominent, downward foreshortening.",
      bird_eye:
        "Bird's-eye overhead shot; camera directly above, looking vertically downward, top-down layout.",
      worm_eye:
        "Extreme worm's-eye shot; camera at ground level looking steeply upward, exaggerated upward foreshortening.",
      dutch_angle:
        "Dutch-angle shot; visibly tilted camera and diagonal horizon, canted composition.",
      over_the_shoulder:
        "Over-the-shoulder shot; camera behind a subject, foreground shoulder framing the subject or action beyond."
    };

    const EXPECTED_ANGLE_KEYWORDS: Readonly<Record<CameraAngle, string>> = {
      eye_level: "EYE LEVEL",
      low_angle: "LOW ANGLE",
      high_angle: "HIGH ANGLE",
      bird_eye: "BIRD'S EYE",
      worm_eye: "WORM'S EYE",
      dutch_angle: "DUTCH ANGLE",
      over_the_shoulder: "OVER THE SHOULDER"
    };

    it.each(CAMERA_ANGLES)(
      "maps angle '%s' to concrete physical viewpoint wording in leading camera section",
      (angle) => {
        const plan = createMinimalShotPlan({ angle: angle as CameraAngle });
        const result = compileStoryboardPrevisPrompt(plan);
        const expectedPhrase = EXPECTED_ANGLE_DESCRIPTIONS[angle];
        const expectedKeyword = EXPECTED_ANGLE_KEYWORDS[angle];

        expect(result.prompt.startsWith(`${expectedKeyword}. Camera: ${expectedPhrase}`)).toBe(
          true
        );
      }
    );

    it("falls back gracefully for unknown camera angles with readable viewpoint text", () => {
      const plan = createMinimalShotPlan({
        angle: "dutch_tilt_overhead" as unknown as CameraAngle
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(
        result.prompt.startsWith(
          "DUTCH TILT OVERHEAD. Camera: dutch tilt overhead camera angle; camera positioned for dutch tilt overhead viewpoint."
        )
      ).toBe(true);
    });

    it("keeps high_angle distinct from bird_eye and low_angle distinct from worm_eye", () => {
      expect(EXPECTED_ANGLE_DESCRIPTIONS.high_angle).toContain("oblique angle");
      expect(EXPECTED_ANGLE_DESCRIPTIONS.bird_eye).toContain("top-down layout");
      expect(EXPECTED_ANGLE_DESCRIPTIONS.high_angle).not.toEqual(
        EXPECTED_ANGLE_DESCRIPTIONS.bird_eye
      );

      expect(EXPECTED_ANGLE_DESCRIPTIONS.low_angle).toContain("shot from below");
      expect(EXPECTED_ANGLE_DESCRIPTIONS.worm_eye).toContain("ground level");
      expect(EXPECTED_ANGLE_DESCRIPTIONS.low_angle).not.toEqual(
        EXPECTED_ANGLE_DESCRIPTIONS.worm_eye
      );
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

    it("handles arc camera movement with single-panel spatial depth cue", () => {
      const plan = createMinimalShotPlan({
        cameraMovement: "arc",
        movementSpeed: "slow"
      });
      const result = compileStoryboardPrevisPrompt(plan);

      expect(result.prompt).toContain(
        "Camera motion: slow arc; single moment along a curved camera path around the subjects, with spatial depth and foreground-background separation while preserving stated camera position and subject orientations."
      );
    });

    it("handles omitted or null movement by defaulting to static camera", () => {
      const planNull = createMinimalShotPlan({ cameraMovement: null });
      const resultNull = compileStoryboardPrevisPrompt(planNull);
      expect(resultNull.prompt).toContain("Static camera.");

      const planUndefined = createMinimalShotPlan({ cameraMovement: undefined });
      const resultUndefined = compileStoryboardPrevisPrompt(planUndefined);
      expect(resultUndefined.prompt).toContain("Static camera.");
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

      expect(result.negativePrompt).toBe(INDEPENDENT_STORYBOARD_NEGATIVE_PROMPT);
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

  describe("per-beat compilation", () => {
    it("compiles for a specific beat with beat action, description, timing, and camera action", () => {
      const plan = createMinimalShotPlan({
        actionSummary: "Plan-wide summary that should be replaced",
        beats: [
          {
            beatIndex: 1,
            startMs: 0,
            endMs: 2000,
            description: "Beat 1 description",
            cameraAction: "slow zoom",
            subjectAction: "turns around"
          },
          {
            beatIndex: 2,
            startMs: 2000,
            endMs: 4000,
            description: "Operative leaps over barrier",
            cameraAction: "rapid whip pan right",
            subjectAction: "vaults concrete barricade"
          }
        ]
      });

      const selectedBeat = plan.beats![1]!;
      const result = compileStoryboardPrevisPrompt(plan, selectedBeat);

      // Verify camera clause leads and clean panel directive ends
      expect(result.prompt.startsWith("EYE LEVEL. Camera:")).toBe(true);
      expect(result.prompt.endsWith(STORYBOARD_CLEAN_PANEL_DIRECTIVE)).toBe(true);
      expect(result.negativePrompt).toBe(INDEPENDENT_STORYBOARD_NEGATIVE_PROMPT);
      expect(result.profileId).toBe(STORYBOARD_PREVIS_PROFILE_ID);
      expect(result.renderProfileKey).toBe(STORYBOARD_PREVIS_RENDER_PROFILE_KEY);
      expect(result.version).toBe(1);

      // Verify shared sections remain intact
      expect(result.prompt).toContain(
        "EYE LEVEL. Camera: Eye-level shot; camera at subject eye height, level horizontal viewpoint. Framing: medium wide shot framing."
      );
      expect(result.prompt).toContain("Beat camera: rapid whip pan right.");
      expect(result.prompt).toContain("Character [hero-operative] staged at screen center");
      expect(result.prompt).toContain("Setting: Rain-slicked alleyway with reflective puddles.");
      expect(result.prompt).toContain("Lighting: Impressionistic neon night lighting");
      expect(result.prompt).toContain("Continuity: Persistent subject(s) [hero-operative].");

      // Verify beat-specific action, timing, description are emitted (without duplicating cameraAction)
      expect(result.prompt).toContain(
        "Action: Beat 2 [2000ms-4000ms]: vaults concrete barricade (Operative leaps over barrier)."
      );
      expect(result.prompt).not.toMatch(/Action:[^.]*Camera:/);

      // Verify plan-wide action summary and first beat are NOT in the action section
      expect(result.prompt).not.toContain("Plan-wide summary that should be replaced");
      expect(result.prompt).not.toContain("Primary staging: turns around");
      expect(result.prompt).not.toContain("Beat 1 description");
    });

    it("handles beat without cameraAction gracefully", () => {
      const plan = createMinimalShotPlan();
      const beat = {
        beatIndex: 1,
        startMs: 0,
        endMs: 2500,
        description: "Operative pauses",
        subjectAction: "stands still"
      };

      const result = compileStoryboardPrevisPrompt(plan, beat);

      expect(result.prompt).toContain(
        "Action: Beat 1 [0ms-2500ms]: stands still (Operative pauses)."
      );
      expect(result.prompt).not.toMatch(/Action:[^.]*Camera:/);
    });

    it("handles beat with optional fields omitted", () => {
      const plan = createMinimalShotPlan();
      const beat = {
        description: "Simple action note",
        subjectAction: "steps forward"
      };

      const result = compileStoryboardPrevisPrompt(plan, beat);

      expect(result.prompt).toContain("Action: Beat: steps forward (Simple action note).");
      expect(result.prompt.startsWith("EYE LEVEL. Camera:")).toBe(true);
      expect(result.negativePrompt).toBe(INDEPENDENT_STORYBOARD_NEGATIVE_PROMPT);
    });

    it("regression: retains identical one-argument behavior when beat parameter is omitted", () => {
      const plan = createMinimalShotPlan();
      const resultNoArg = compileStoryboardPrevisPrompt(plan);
      const resultUndefinedArg = compileStoryboardPrevisPrompt(plan, undefined);

      expect(resultNoArg.prompt).toBe(resultUndefinedArg.prompt);
      expect(resultNoArg.negativePrompt).toBe(resultUndefinedArg.negativePrompt);
      expect(resultNoArg.prompt).toContain(
        "Action: Operative activates scanner in rainy alleyway."
      );
      expect(resultNoArg.prompt).toContain(
        "Primary staging: raises device to eye level (beat 1: Operative powers up scanner)."
      );
    });
  });

  describe("low-angle and slow-arc blocking fidelity regression (#456)", () => {
    it("reliably conveys low angle, slow arc movement, and side-by-side forward-facing blocking", () => {
      const plan = createMinimalShotPlan({
        angle: "low_angle",
        cameraPosition: "low angle ground view looking up at subjects",
        cameraMovement: "arc",
        movementSpeed: "slow",
        subjects: [
          {
            subjectId: "couple-left",
            role: "subject_identity",
            initialPosition: "screen_left",
            movementTrajectory: "standing side-by-side facing forward",
            interactionSummary: "arms linked with couple-right"
          },
          {
            subjectId: "couple-right",
            role: "subject_identity",
            initialPosition: "screen_right",
            movementTrajectory: "standing side-by-side facing forward",
            interactionSummary: "arms linked with couple-left"
          }
        ],
        beats: [
          {
            beatIndex: 1,
            startMs: 0,
            endMs: 3000,
            description: "Couple gazes ahead together",
            cameraAction: "slow arc around couple",
            subjectAction: "stand side-by-side with arms linked facing forward"
          }
        ]
      });

      const selectedBeat = plan.beats![0]!;
      const result = compileStoryboardPrevisPrompt(plan, selectedBeat);

      // Camera angle leading with exact meaningful viewpoint text
      const expectedLowAngleText =
        "LOW ANGLE SHOT, shot from below. Camera placed near ground level, tilted sharply upward at the subjects. Subjects loom tall and dominant above the lens, exaggerated upward foreshortening, converging vertical lines, open sky or ceiling visible behind their heads, viewer looking up from a crouched vantage point.";
      expect(result.prompt.startsWith(`LOW ANGLE. Camera: ${expectedLowAngleText}`)).toBe(true);

      // Camera position
      expect(result.prompt).toContain("Position: low angle ground view looking up at subjects.");

      // Arc movement cue and speed
      expect(result.prompt).toContain(
        "Camera motion: slow arc; single moment along a curved camera path around the subjects, with spatial depth and foreground-background separation while preserving stated camera position and subject orientations."
      );
      expect(result.prompt).toContain("Beat camera: slow arc around couple.");

      // Both subject declarations survive
      expect(result.prompt).toContain("Character [couple-left] staged at screen left");
      expect(result.prompt).toContain("Character [couple-right] staged at screen right");

      // Blocking and orientation text survive
      expect(result.prompt).toContain("blocking: standing side-by-side facing forward");
      expect(result.prompt).toContain("Interaction: arms linked with couple-right");
      expect(result.prompt).toContain("Interaction: arms linked with couple-left");
      expect(result.prompt).toContain(
        "Staging: 2 subject(s) (2 character(s), 0 product(s)); subject positions and facing directions follow the supplied blocking."
      );

      // Blocking emphasis clause reinforces side-by-side, forward-facing, and linked-arm staging
      expect(result.prompt).toContain(
        "Blocking emphasis: the 2 subjects are staged standing directly side-by-side in a straight horizontal line, both facing forward toward the camera, not turned toward each other, with arms visibly linked together."
      );

      // Beat action survives (without duplicating cameraAction in the action clause)
      expect(result.prompt).toContain(
        "Action: Beat 1 [0ms-3000ms]: stand side-by-side with arms linked facing forward (Couple gazes ahead together)."
      );
      expect(result.prompt).not.toMatch(/Action:[^.]*Camera:/);

      // Storyboard style header is preserved and follows blocking/action
      expect(result.prompt).toContain(STORYBOARD_STYLE_HEADER);
      const cameraIdx = result.prompt.indexOf("Camera:");
      const stagingIdx = result.prompt.indexOf("Staging:");
      const actionIdx = result.prompt.indexOf("Action:");
      const styleIdx = result.prompt.indexOf(STORYBOARD_STYLE_HEADER);
      const cleanPanelIdx = result.prompt.indexOf(STORYBOARD_CLEAN_PANEL_DIRECTIVE);

      expect(result.prompt.indexOf("LOW ANGLE.")).toBe(0);
      expect(stagingIdx).toBeGreaterThan(cameraIdx);
      expect(actionIdx).toBeGreaterThan(stagingIdx);
      expect(styleIdx).toBeGreaterThan(actionIdx);
      expect(cleanPanelIdx).toBeGreaterThan(styleIdx);

      // Clean panel directive ends the prompt
      expect(result.prompt.endsWith(STORYBOARD_CLEAN_PANEL_DIRECTIVE)).toBe(true);
    });
  });
});
