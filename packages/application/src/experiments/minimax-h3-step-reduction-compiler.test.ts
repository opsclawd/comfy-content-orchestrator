import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applySamplingRecipeToGraph,
  validateSamplingRecipeTopology
} from "./minimax-h3-step-reduction-compiler.js";
import {
  getSamplingRecipe,
  validateRecipeRouteCompatibility
} from "./minimax-h3-step-reduction-catalog.js";
import { computeSamplingRecipeDigest, sha256Hex, type ShotPlanDocument } from "@cco/contracts";
import { deriveExperimentGraph } from "./minimax-h3-experiment-service.js";
import { compileShotPlan } from "../shot-plan-compiler/shot-plan-compiler.js";
import { canonicalizeReferenceBindings } from "../shot-plan-compiler/canonicalize-reference-bindings.js";

interface TestNode {
  class_type?: string;
  inputs: {
    unet_name?: string;
    steps?: number;
    model?: unknown;
    lora_name?: string;
    strength_model?: number;
    shift_video?: number;
    shift_audio?: number;
    backend?: string;
    attention?: string;
    selection?: string;
    [key: string]: unknown;
  };
}

function getNode(graph: Record<string, unknown>, id: string): TestNode {
  const node = graph[id] as TestNode | undefined;
  if (!node) {
    throw new Error(`Node ${id} not found in test graph`);
  }
  return node;
}

const I2V_TEMPLATE_PATH = resolve(
  __dirname,
  "../../../../templates/minimax_h3_720p_i2v_124f_api.json"
);
const REF2V_TEMPLATE_PATH = resolve(
  __dirname,
  "../../../../templates/minimax_h3_720p_ref2v_124f_api.json"
);

function loadTemplate(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

describe("minimax-h3-step-reduction-compiler", () => {
  const i2vBase = loadTemplate(I2V_TEMPLATE_PATH);
  const ref2vBase = loadTemplate(REF2V_TEMPLATE_PATH);

  describe("applySamplingRecipeToGraph and validateSamplingRecipeTopology", () => {
    it("successfully compiles and validates canonical-base-20 for i2v and ref2v", () => {
      const recipeI2v = getSamplingRecipe("canonical-base-20", "i2v");
      const compiledI2v = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe: recipeI2v,
        route: "i2v"
      });
      const valI2v = validateSamplingRecipeTopology(compiledI2v, recipeI2v, "i2v");
      expect(valI2v.valid).toBe(true);
      expect(valI2v.errors).toEqual([]);

      const recipeRef = getSamplingRecipe("canonical-base-20", "ref2v");
      const compiledRef = applySamplingRecipeToGraph({
        baseWorkflow: ref2vBase,
        recipe: recipeRef,
        route: "ref2v"
      });
      const valRef = validateSamplingRecipeTopology(compiledRef, recipeRef, "ref2v");
      expect(valRef.valid).toBe(true);
      expect(valRef.errors).toEqual([]);

      // Check node 6, 9, 16 connections
      expect(getNode(compiledI2v, "6").inputs.unet_name).toBe(
        "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
      );
      expect(getNode(compiledI2v, "9").inputs.steps).toBe(20);
      expect(getNode(compiledI2v, "9").inputs.model).toEqual(["6", 0]);
      expect(getNode(compiledI2v, "16").inputs.model).toEqual(["6", 0]);
      expect(compiledI2v["301"]).toBeUndefined();
    });

    it("successfully compiles and validates fl2va-base-20 for i2v", () => {
      const recipe = getSamplingRecipe("fl2va-base-20");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const val = validateSamplingRecipeTopology(compiled, recipe, "i2v");
      expect(val.valid).toBe(true);
      expect(val.errors).toEqual([]);

      expect(getNode(compiled, "6").inputs.unet_name).toBe(
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
      );
      expect(getNode(compiled, "9").inputs.steps).toBe(20);
      expect(getNode(compiled, "9").inputs.model).toEqual(["6", 0]);
      expect(getNode(compiled, "16").inputs.model).toEqual(["6", 0]);
      expect(compiled["301"]).toBeUndefined();
    });

    it("successfully compiles and validates fl2va-turbo-8 for i2v with LoRA wiring", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const val = validateSamplingRecipeTopology(compiled, recipe, "i2v");
      expect(val.valid).toBe(true);
      expect(val.errors).toEqual([]);

      expect(getNode(compiled, "6").inputs.unet_name).toBe(
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
      );
      expect(getNode(compiled, "9").inputs.steps).toBe(8);

      // Verify LoRA node 301
      const node301 = getNode(compiled, "301");
      expect(node301.class_type).toBe("LoraLoaderModelOnly");
      expect(node301.inputs.model).toEqual(["6", 0]);
      expect(node301.inputs.lora_name).toBe(
        "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
      );
      expect(node301.inputs.strength_model).toBe(1.0);

      // Verify scheduler (9) and guider (16) connect to LoRA node 301
      expect(getNode(compiled, "9").inputs.model).toEqual(["301", 0]);
      expect(getNode(compiled, "16").inputs.model).toEqual(["301", 0]);
      expect(compiled["302"]).toBeUndefined();
      expect(compiled["303"]).toBeUndefined();
    });

    it("successfully compiles and validates ref2va-turbo-4 for ref2v with LoRA wiring", () => {
      const recipe = getSamplingRecipe("ref2va-turbo-4");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: ref2vBase,
        recipe,
        route: "ref2v"
      });
      const val = validateSamplingRecipeTopology(compiled, recipe, "ref2v");
      expect(val.valid).toBe(true);
      expect(val.errors).toEqual([]);

      expect(getNode(compiled, "6").inputs.unet_name).toBe(
        "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
      );
      expect(getNode(compiled, "9").inputs.steps).toBe(4);

      // Verify LoRA node 301
      const node301 = getNode(compiled, "301");
      expect(node301.class_type).toBe("LoraLoaderModelOnly");
      expect(node301.inputs.model).toEqual(["6", 0]);
      expect(node301.inputs.lora_name).toBe(
        "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
      );
      expect(node301.inputs.strength_model).toBe(1.0);

      // Verify scheduler (9) and guider (16) connect to LoRA node 301
      expect(getNode(compiled, "9").inputs.model).toEqual(["301", 0]);
      expect(getNode(compiled, "16").inputs.model).toEqual(["301", 0]);
    });

    it("successfully compiles and validates fasth3-i2v-8 for i2v with SigmaShift and VSA attention", () => {
      const recipe = getSamplingRecipe("fasth3-i2v-8");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const val = validateSamplingRecipeTopology(compiled, recipe, "i2v");
      expect(val.valid).toBe(true);
      expect(val.errors).toEqual([]);

      expect(getNode(compiled, "6").inputs.unet_name).toBe(
        "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
      );
      expect(getNode(compiled, "9").inputs.steps).toBe(8);

      // Node 301: MiniMaxH3SigmaShift
      const node301 = getNode(compiled, "301");
      expect(node301.class_type).toBe("MiniMaxH3SigmaShift");
      expect(node301.inputs.model).toEqual(["6", 0]);
      expect(node301.inputs.shift_video).toBe(10.0);
      expect(node301.inputs.shift_audio).toBe(3.0);

      // Node 302: ModelAttentionBackend
      const node302 = getNode(compiled, "302");
      expect(node302.class_type).toBe("ModelAttentionBackend");
      expect(node302.inputs.model).toEqual(["301", 0]);
      expect(node302.inputs.attention).toBe("comfy kitchen attention");

      // Node 303: BlockSparseAttention
      const node303 = getNode(compiled, "303");
      expect(node303.class_type).toBe("BlockSparseAttention");
      expect(node303.inputs.model).toEqual(["302", 0]);
      expect(node303.inputs.selection).toBe("vsa");
      expect(node303.inputs["selection.keep_percent"]).toBe(10);

      // Scheduler (9) and guider (16) connect to node 303
      expect(getNode(compiled, "9").inputs.model).toEqual(["303", 0]);
      expect(getNode(compiled, "16").inputs.model).toEqual(["303", 0]);
    });
  });

  describe("route fencing enforcement", () => {
    it("rejects fl2va-base-20 on ref2v route", () => {
      const recipe = getSamplingRecipe("fl2va-base-20");
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: ref2vBase,
          recipe,
          route: "ref2v"
        })
      ).toThrow("FL2VA Base 20-step recipe is strictly restricted to I2V route");
    });

    it("rejects fl2va-turbo-8 on ref2v route", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: ref2vBase,
          recipe,
          route: "ref2v"
        })
      ).toThrow("FL2VA Turbo 8-step LoRA is strictly restricted to I2V route");
    });

    it("rejects ref2va-turbo-4 on i2v route", () => {
      const recipe = getSamplingRecipe("ref2va-turbo-4");
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe,
          route: "i2v"
        })
      ).toThrow("Ref2VA Turbo 4-step LoRA is strictly restricted to Ref2V route");
    });

    it("rejects fasth3-i2v-8 on ref2v route", () => {
      const recipe = getSamplingRecipe("fasth3-i2v-8");
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: ref2vBase,
          recipe,
          route: "ref2v"
        })
      ).toThrow(
        "FastH3 8-step is strictly restricted to I2V / frame-anchored route; Ref2V is rejected"
      );
    });
  });

  describe("tampering and structural violation detection", () => {
    it("detects tampered step count in scheduler", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const tampered = JSON.parse(JSON.stringify(compiled));
      tampered["9"].inputs.steps = 20;

      const val = validateSamplingRecipeTopology(tampered, recipe, "i2v");
      expect(val.valid).toBe(false);
      expect(val.errors.some((e) => e.includes("Node 9 steps mismatch: expected 8, got 20"))).toBe(
        true
      );
    });

    it("detects tampered LoRA strength", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const tampered = JSON.parse(JSON.stringify(compiled));
      tampered["301"].inputs.strength_model = 0.5;

      const val = validateSamplingRecipeTopology(tampered, recipe, "i2v");
      expect(val.valid).toBe(false);
      expect(
        val.errors.some((e) => e.includes("Node 301 strength_model mismatch: expected 1, got 0.5"))
      ).toBe(true);
    });

    it("detects bypassed LoRA (scheduler wired directly to UNET instead of LoRA node)", () => {
      const recipe = getSamplingRecipe("ref2va-turbo-4");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: ref2vBase,
        recipe,
        route: "ref2v"
      });
      const tampered = JSON.parse(JSON.stringify(compiled));
      tampered["9"].inputs.model = ["6", 0]; // bypassed node 301

      const val = validateSamplingRecipeTopology(tampered, recipe, "ref2v");
      expect(val.valid).toBe(false);
      expect(
        val.errors.some((e) =>
          e.includes("BasicScheduler (node 9) model input must connect to LoRA loader (node 301)")
        )
      ).toBe(true);
    });

    it("detects tampered FastH3 sigma shift parameters", () => {
      const recipe = getSamplingRecipe("fasth3-i2v-8");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const tampered = JSON.parse(JSON.stringify(compiled));
      tampered["301"].inputs.shift_video = 12.0; // expected 10.0

      const val = validateSamplingRecipeTopology(tampered, recipe, "i2v");
      expect(val.valid).toBe(false);
      expect(
        val.errors.some((e) => e.includes("Node 301 shift_video mismatch: expected 10, got 12"))
      ).toBe(true);
    });

    it("detects tampered checkpoint build", () => {
      const recipe = getSamplingRecipe("fl2va-base-20");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const tampered = JSON.parse(JSON.stringify(compiled));
      tampered["6"].inputs.unet_name = "minimax_h3_ref2va_pruned_int8_convrot.safetensors";

      const val = validateSamplingRecipeTopology(tampered, recipe, "i2v");
      expect(val.valid).toBe(false);
      expect(val.errors.some((e) => e.includes("Node 6 checkpoint mismatch"))).toBe(true);
    });

    it("detects missing required nodes", () => {
      const recipe = getSamplingRecipe("canonical-base-20", "i2v");
      const compiled = applySamplingRecipeToGraph({
        baseWorkflow: i2vBase,
        recipe,
        route: "i2v"
      });
      const tampered = JSON.parse(JSON.stringify(compiled));
      delete tampered["6"];

      const val = validateSamplingRecipeTopology(tampered, recipe, "i2v");
      expect(val.valid).toBe(false);
      expect(val.errors.some((e) => e.includes("Missing UNETLoader node (id: 6)"))).toBe(true);
    });

    it("rejects adversarial rehashed recipe inputs for checkpoint, LoRA, strength, schedule, sigma, and conditioning", () => {
      const genuineTurbo = getSamplingRecipe("fl2va-turbo-8");

      // 1. Adversarial checkpoint tamper (rehashed digest)
      const tamperedCheckpoint = {
        ...genuineTurbo,
        diffusionModel: {
          ...genuineTurbo.diffusionModel,
          filename: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
          sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
        }
      };
      const rehashedCheckpoint = {
        ...tamperedCheckpoint,
        recipeDigest: computeSamplingRecipeDigest(tamperedCheckpoint)
      };
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe: rehashedCheckpoint,
          route: "i2v"
        })
      ).toThrow(/Supplied recipe digest.*does not match authoritative catalog recipe/);
      expect(validateSamplingRecipeTopology(i2vBase, rehashedCheckpoint, "i2v").valid).toBe(false);

      // 2. Adversarial LoRA tamper (rehashed digest)
      const tamperedLora = { ...genuineTurbo, lora: null };
      const rehashedLora = {
        ...tamperedLora,
        recipeDigest: computeSamplingRecipeDigest(tamperedLora)
      };
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe: rehashedLora,
          route: "i2v"
        })
      ).toThrow(/Supplied recipe digest.*does not match authoritative catalog recipe/);
      expect(validateSamplingRecipeTopology(i2vBase, rehashedLora, "i2v").valid).toBe(false);

      // 3. Adversarial LoRA strength tamper (rehashed digest)
      const tamperedStrength = {
        ...genuineTurbo,
        lora: { ...genuineTurbo.lora!, strengthModel: 0.5 }
      };
      const rehashedStrength = {
        ...tamperedStrength,
        recipeDigest: computeSamplingRecipeDigest(tamperedStrength)
      };
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe: rehashedStrength,
          route: "i2v"
        })
      ).toThrow(/Supplied recipe digest.*does not match authoritative catalog recipe/);
      expect(validateSamplingRecipeTopology(i2vBase, rehashedStrength, "i2v").valid).toBe(false);

      // 4. Adversarial schedule/step tamper (rehashed digest)
      const tamperedSteps = { ...genuineTurbo, expectedSteps: 12 };
      const rehashedSteps = {
        ...tamperedSteps,
        recipeDigest: computeSamplingRecipeDigest(tamperedSteps)
      };
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe: rehashedSteps,
          route: "i2v"
        })
      ).toThrow(/Supplied recipe digest.*does not match authoritative catalog recipe/);
      expect(validateSamplingRecipeTopology(i2vBase, rehashedSteps, "i2v").valid).toBe(false);

      // 5. Adversarial sigmaShift tamper (rehashed digest)
      const genuineFastH3 = getSamplingRecipe("fasth3-i2v-8");
      const tamperedSigma = {
        ...genuineFastH3,
        sigmaShift: { enabled: true, videoShift: 20.0, audioShift: 6.0 }
      };
      const rehashedSigma = {
        ...tamperedSigma,
        recipeDigest: computeSamplingRecipeDigest(tamperedSigma)
      };
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe: rehashedSigma,
          route: "i2v"
        })
      ).toThrow(/Supplied recipe digest.*does not match authoritative catalog recipe/);
      expect(validateSamplingRecipeTopology(i2vBase, rehashedSigma, "i2v").valid).toBe(false);

      // 6. Adversarial conditioningMode tamper (rehashed digest)
      const tamperedCond = {
        ...genuineTurbo,
        conditioningMode: "reference_directed" as const
      };
      const rehashedCond = {
        ...tamperedCond,
        recipeDigest: computeSamplingRecipeDigest(tamperedCond)
      };
      expect(() =>
        applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe: rehashedCond,
          route: "i2v"
        })
      ).toThrow(/Supplied recipe digest.*does not match authoritative catalog recipe/);
      expect(validateSamplingRecipeTopology(i2vBase, rehashedCond, "i2v").valid).toBe(false);
    });
  });

  describe("preservation of instructions, conditioning, and geometry invariants", () => {
    it("preserves VAE decode, CLIP loader, conditioning, and sampler selection across all recipes", () => {
      const recipes = [
        getSamplingRecipe("canonical-base-20", "i2v"),
        getSamplingRecipe("fl2va-base-20"),
        getSamplingRecipe("fl2va-turbo-8"),
        getSamplingRecipe("fasth3-i2v-8")
      ];

      for (const recipe of recipes) {
        const compiled = applySamplingRecipeToGraph({
          baseWorkflow: i2vBase,
          recipe,
          route: "i2v"
        });

        // Node 10 (VAEDecode) must be untouched
        expect(compiled["10"]).toEqual(i2vBase["10"]);

        // Node 104 (MiniMaxH3ImageToVideo conditioning) must be untouched
        expect(compiled["104"]).toEqual(i2vBase["104"]);

        // Node 13 (CLIPLoader) must be untouched
        expect(compiled["13"]).toEqual(i2vBase["13"]);

        // Node 17 (KSamplerSelect sampler selection) must be untouched
        expect(compiled["17"]).toEqual(i2vBase["17"]);
      }
    });

    it("compiles approved ShotPlan through same-route recipes verifying instruction text and hash survive", () => {
      const seed = 123456789;
      const frames = 124;
      const width = 1344;
      const height = 768;

      // 1. I2V Route with compiled approved ShotPlan
      const approvedI2vShotPlan: ShotPlanDocument = {
        id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        sceneId: "d3b07384-d113-46fb-a0ff-c96767ad58ff",
        specRevision: 1,
        variantOrdinal: 1,
        status: "approved",
        routingMode: "frame_anchored",
        targetDurationMs: 5167,
        targetFrameCount: 124,
        durationToleranceMs: 355,
        fps: 24,
        framing: "medium_wide",
        angle: "eye_level",
        lensIntent: "35mm prime cinematic",
        cameraPosition: "standing eye height 1.6m",
        cameraMovement: "dolly_in",
        movementSpeed: "slow",
        cameraPromptDescription:
          "A cinematic tracking shot through a neon-lit cyberpunk market in the rain",
        subjects: [
          {
            subjectId: "character_hero",
            role: "subject_identity",
            initialPosition: "screen_center",
            movementTrajectory: "walking forward slowly",
            interactionSummary: "looking around at market stalls",
            referenceAssetId: "asset-hero-1"
          }
        ],
        actionSummary: "Hero walks through rain-soaked neon cyberpunk alley.",
        beats: [
          {
            beatIndex: 1,
            startMs: 0,
            endMs: 5167,
            description: "Walking through market",
            cameraAction: "Tracking shot",
            subjectAction: "Walks forward"
          }
        ],
        lightingStyle: "natural_golden_hour",
        environmentDescription: "Cyberpunk alley in the rain",
        colorPalette: ["#1B263B", "#E0E1DD", "#DDA15E"],
        atmosphere: "Rainy neon atmosphere",
        dialogue: null,
        continuity: {
          incomingContinuityFromSceneId: null,
          persistentSubjectIds: ["character_hero"],
          lightingContinuityNote: "Matches twilight",
          frameAnchorTarget: "none",
          anchorCandidateId: null,
          anchorMediaHashSha256: null
        },
        previs: null,
        machineModel: null,
        createdAt: "2026-09-25T12:00:00.000Z",
        updatedAt: "2026-09-25T12:05:00.000Z"
      };

      const canonicalI2vRefs = canonicalizeReferenceBindings({
        bindings: [{ referenceAssetId: "asset-hero-1", role: "subject_identity" }],
        assetsById: new Map([
          [
            "asset-hero-1",
            {
              id: "asset-hero-1",
              clientId: "client-01",
              storageBucket: "assets",
              storageObjectKey: "frame0.png",
              mimeType: "image/png",
              contentHashSha256: "0000000000000000000000000000000000000000000000000000000000000001"
            }
          ]
        ])
      });

      const compiledI2vInstruction = compileShotPlan({
        shotPlan: approvedI2vShotPlan,
        references: canonicalI2vRefs,
        routingMode: "frame_anchored"
      });

      const i2vDerived = deriveExperimentGraph({
        baseWorkflow: i2vBase,
        route: "i2v",
        runId: "shotplan-test-i2v",
        seed,
        frames,
        width,
        height,
        prompt: compiledI2vInstruction.instructionText,
        references: [
          {
            slotIndex: 0,
            role: "first_frame",
            tag: "<Picture 1>",
            order: 0,
            assetPath: "/assets/frame0.png",
            stagedFilename: "frame0.png",
            sha256: "0000000000000000000000000000000000000000000000000000000000000001",
            width: 1344,
            height: 768,
            mimeType: "image/png"
          }
        ]
      });

      const i2vRecipes = [
        getSamplingRecipe("canonical-base-20", "i2v"),
        getSamplingRecipe("fl2va-base-20"),
        getSamplingRecipe("fl2va-turbo-8"),
        getSamplingRecipe("fasth3-i2v-8")
      ];

      for (const recipe of i2vRecipes) {
        const compiled = applySamplingRecipeToGraph({
          baseWorkflow: i2vDerived,
          recipe,
          route: "i2v"
        });

        const condNode = compiled["104"] as TestNode;
        expect(condNode.inputs.prompt).toBe(compiledI2vInstruction.instructionText);
        expect(sha256Hex(condNode.inputs.prompt as string)).toBe(
          compiledI2vInstruction.instructionHashSha256
        );
        expect(condNode.inputs.length).toBe(frames);
        expect(condNode.inputs.width).toBe(width);
        expect(condNode.inputs.height).toBe(height);
        expect(getNode(compiled, "15").inputs.noise_seed).toBe(seed);
        expect(getNode(compiled, "20").inputs.image).toBe("frame0.png");
      }

      // 2. Ref2V Route with compiled approved ShotPlan
      const approvedRef2vShotPlan: ShotPlanDocument = {
        ...approvedI2vShotPlan,
        routingMode: "reference_directed",
        cameraPromptDescription: "Camera focuses on <Picture 1> subject as scene unfolds"
      };

      const canonicalRef2vRefs = canonicalizeReferenceBindings({
        bindings: [{ referenceAssetId: "asset-hero-1", role: "subject_identity" }],
        assetsById: new Map([
          [
            "asset-hero-1",
            {
              id: "asset-hero-1",
              clientId: "client-01",
              storageBucket: "assets",
              storageObjectKey: "ref0.png",
              mimeType: "image/png",
              contentHashSha256: "0000000000000000000000000000000000000000000000000000000000000002"
            }
          ]
        ])
      });

      const compiledRef2vInstruction = compileShotPlan({
        shotPlan: approvedRef2vShotPlan,
        references: canonicalRef2vRefs,
        routingMode: "reference_directed"
      });

      const ref2vDerived = deriveExperimentGraph({
        baseWorkflow: ref2vBase,
        route: "ref2v",
        runId: "shotplan-test-ref2v",
        seed,
        frames,
        width,
        height,
        prompt: compiledRef2vInstruction.instructionText,
        references: [
          {
            slotIndex: 0,
            role: "reference",
            tag: "<Picture 1>",
            order: 0,
            assetPath: "/assets/ref0.png",
            stagedFilename: "ref0.png",
            sha256: "0000000000000000000000000000000000000000000000000000000000000002",
            width: 1344,
            height: 768,
            mimeType: "image/png"
          }
        ]
      });

      const ref2vRecipes = [
        getSamplingRecipe("canonical-base-20", "ref2v"),
        getSamplingRecipe("ref2va-turbo-4")
      ];

      for (const recipe of ref2vRecipes) {
        const compiled = applySamplingRecipeToGraph({
          baseWorkflow: ref2vDerived,
          recipe,
          route: "ref2v"
        });

        const condNode = compiled["105"] as TestNode;
        expect(condNode.inputs.prompt).toBe(compiledRef2vInstruction.instructionText);
        expect(sha256Hex(condNode.inputs.prompt as string)).toBe(
          compiledRef2vInstruction.instructionHashSha256
        );
        expect(condNode.inputs.length).toBe(frames);
        expect(condNode.inputs.width).toBe(width);
        expect(condNode.inputs.height).toBe(height);
        expect(getNode(compiled, "15").inputs.noise_seed).toBe(seed);
        expect(getNode(compiled, "201").inputs.image).toBe("ref0.png");
      }
    });

    it("rejects incompatible route combinations and rehashed tampered recipes", () => {
      // Incompatible routes
      expect(() => validateRecipeRouteCompatibility("fasth3-i2v-8", "ref2v")).toThrow(
        "FastH3 8-step is strictly restricted to I2V / frame-anchored route; Ref2V is rejected"
      );
      expect(() => validateRecipeRouteCompatibility("ref2va-turbo-4", "i2v")).toThrow(
        "Ref2VA Turbo 4-step LoRA is strictly restricted to Ref2V route"
      );
      expect(() => validateRecipeRouteCompatibility("fl2va-turbo-8", "ref2v")).toThrow(
        "FL2VA Turbo 8-step LoRA is strictly restricted to I2V route"
      );
      expect(() => validateRecipeRouteCompatibility("fl2va-base-20", "ref2v")).toThrow(
        "FL2VA Base 20-step recipe is strictly restricted to I2V route"
      );

      // Rehashed tampered recipe tests: mutate field and recompute digest
      const genuineTurbo = getSamplingRecipe("fl2va-turbo-8");
      const genuineFastH3 = getSamplingRecipe("fasth3-i2v-8");

      // 1. Mutated expectedSteps + rehash
      {
        const tampered = { ...genuineTurbo, expectedSteps: 4 };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 2. Mutated checkpoint + rehash
      {
        const tampered = {
          ...genuineTurbo,
          diffusionModel: {
            ...genuineTurbo.diffusionModel,
            sha256: "0000000000000000000000000000000000000000000000000000000000000001"
          }
        };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 3. Mutated LoRA + rehash
      {
        const tampered = {
          ...genuineTurbo,
          lora: {
            ...genuineTurbo.lora!,
            sha256: "0000000000000000000000000000000000000000000000000000000000000002"
          }
        };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 4. Mutated LoRA strength + rehash
      {
        const tampered = {
          ...genuineTurbo,
          lora: {
            ...genuineTurbo.lora!,
            strengthModel: 0.8
          }
        };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 5. Mutated schedule (scheduler / sampler) + rehash
      {
        const tampered = { ...genuineTurbo, scheduler: "normal" as const };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 6. Mutated sigma (sigmaShift videoShift) + rehash
      {
        const tampered = {
          ...genuineFastH3,
          sigmaShift: {
            ...genuineFastH3.sigmaShift!,
            videoShift: 8.0
          }
        };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 7. Mutated conditioningMode + rehash
      {
        const tampered = {
          ...genuineTurbo,
          conditioningMode: "reference_directed" as const
        };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }

      // 8. Mutated requiredRuntimeRevision + rehash
      {
        const tampered = {
          ...genuineFastH3,
          requiredRuntimeRevision: "0000000000000000000000000000000000000000"
        };
        const rehashed = { ...tampered, recipeDigest: computeSamplingRecipeDigest(tampered) };
        expect(() =>
          applySamplingRecipeToGraph({ baseWorkflow: i2vBase, recipe: rehashed, route: "i2v" })
        ).toThrow(/does not match authoritative catalog recipe/);
        const val = validateSamplingRecipeTopology(i2vBase, rehashed, "i2v");
        expect(val.valid).toBe(false);
        expect(val.errors.some((e) => e.includes("Recipe digest mismatch"))).toBe(true);
      }
    });
  });
});
