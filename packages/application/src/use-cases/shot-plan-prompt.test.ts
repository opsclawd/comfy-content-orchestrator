import { describe, expect, it } from "vitest";
import { ShotPlan, type ShotPlanId, type SceneId } from "@cco/domain";
import { buildShotPlanPrompt, buildShotPlanVariationPrompt } from "./shot-plan-prompt.js";

describe("ShotPlan Prompt Builders", () => {
  const sampleShotPlan = ShotPlan.create({
    id: "01928374-abcd-7000-8000-000000000001" as ShotPlanId,
    sceneId: "01928374-abcd-7000-8000-000000000002" as SceneId,
    specRevision: 1,
    variantOrdinal: 1,
    targetDurationMs: 4000,
    targetFrameCount: 96,
    framing: "medium",
    angle: "eye_level",
    lensIntent: "35mm prime",
    cameraPosition: "eye level tripod",
    cameraMovement: "static",
    movementSpeed: "slow",
    cameraPromptDescription: "Medium shot of character at desk",
    actionSummary: "Character reads a leatherbound book",
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 4000,
        description: "Reading book quietly",
        cameraAction: "holds medium framing",
        subjectAction: "turns page slowly"
      }
    ],
    lightingStyle: "low_key_dramatic",
    environmentDescription: "Dim study room",
    colorPalette: ["#111111", "#ffaa55"]
  });

  describe("buildShotPlanPrompt", () => {
    it("generates baseline planning prompt with schema and scene constraints", () => {
      const prompt = buildShotPlanPrompt({
        scenePrompt: "A hero stands on a rooftop looking at sunset",
        sceneDurationMs: 4000,
        engineProfileId: "ltx-2.5@certified-v1",
        variantCount: 2,
        referenceAssetIds: ["ref-hero-1"]
      });

      expect(prompt.systemPrompt).toContain("You are a specialized cinematography director");
      expect(prompt.systemPrompt).toContain("propose 2 distinct, structured ShotPlan variants");
      expect(prompt.userPrompt).toContain("A hero stands on a rooftop looking at sunset");
      expect(prompt.userPrompt).toContain("Target Duration: 4000 ms");
      expect(prompt.userPrompt).toContain("Bound Reference Assets: ref-hero-1");
    });

    it("formats bound references with canonical tags, roles, and descriptions and adds directives", () => {
      const prompt = buildShotPlanPrompt({
        scenePrompt: "A couple having a drink by the pool house",
        sceneDurationMs: 5000,
        engineProfileId: "ltx-2.5@certified-v1",
        variantCount: 2,
        boundReferences: [
          {
            promptTag: "<Picture 1>",
            role: "subject_identity",
            description: "A smiling couple in casual clothing outdoors."
          },
          {
            promptTag: "<Picture 2>",
            role: "location",
            description: "A modern pool house with glass walls and a stone patio."
          }
        ]
      });

      expect(prompt.userPrompt).toContain(
        "Bound Reference Assets:\n<Picture 1> | subject_identity | A smiling couple in casual clothing outdoors.\n<Picture 2> | location | A modern pool house with glass walls and a stone patio."
      );
      expect(prompt.systemPrompt).toContain("Reference Asset Directives:");
      expect(prompt.systemPrompt).toContain(
        "- For 'subject_identity': The character or subject identity must strictly follow the described appearance and characteristics."
      );
      expect(prompt.systemPrompt).toContain(
        "- For 'location': The scene setting, architecture, and physical environment must strictly match the described location."
      );
    });
  });

  describe("buildShotPlanVariationPrompt", () => {
    it("generates directed variation prompt including source ShotPlan JSON and director guidance", () => {
      const prompt = buildShotPlanVariationPrompt({
        scenePrompt: "A hero stands on a rooftop looking at sunset",
        sceneDurationMs: 4000,
        engineProfileId: "ltx-2.5@certified-v1",
        sourceShotPlan: sampleShotPlan.snapshot(),
        directorGuidance: "Keep composition, make it a tighter 50mm shot with slow dolly in",
        variantCount: 1,
        referenceAssetIds: ["ref-hero-1"]
      });

      // System prompt directives
      expect(prompt.systemPrompt).toContain("Preserve Unaffected Intent");
      expect(prompt.systemPrompt).toContain("Coherent Multi-Field Adjustment");
      expect(prompt.systemPrompt).toContain("Complete Valid Document");
      expect(prompt.systemPrompt).toContain("Temporal Consistency");
      expect(prompt.systemPrompt).toContain("Reference Asset Integrity");

      // User prompt contents
      expect(prompt.userPrompt).toContain(
        'Director Guidance: "Keep composition, make it a tighter 50mm shot with slow dolly in"'
      );
      expect(prompt.userPrompt).toContain("Source ShotPlan (Structured Intent to Refine):");
      expect(prompt.userPrompt).toContain('"lensIntent": "35mm prime"');
      expect(prompt.userPrompt).toContain('"actionSummary": "Character reads a leatherbound book"');
      expect(prompt.userPrompt).toContain("Bound Reference Assets: ref-hero-1");
    });

    it("includes corrective feedback when supplied", () => {
      const prompt = buildShotPlanVariationPrompt({
        scenePrompt: "A hero stands on a rooftop",
        sceneDurationMs: 4000,
        engineProfileId: "ltx-2.5@certified-v1",
        sourceShotPlan: sampleShotPlan.snapshot(),
        directorGuidance: "Dolly in",
        variantCount: 1,
        correctiveFeedback: "Subject referenceAssetId was invalid"
      });

      expect(prompt.userPrompt).toContain(
        "Correction Required: Subject referenceAssetId was invalid"
      );
    });
  });
});
