import { describe, it, expect } from "vitest";
import { MINIMAX_H3_SAMPLING_RECIPE_NAMES, type MinimaxH3SamplingRecipeName } from "@cco/contracts";
import {
  getSamplingRecipe,
  listSamplingRecipes,
  validateRecipeRouteCompatibility
} from "./minimax-h3-step-reduction-catalog.js";

describe("minimax-h3-step-reduction-catalog", () => {
  it("defines all 5 declared sampling recipes", () => {
    const list = listSamplingRecipes();
    expect(list).toHaveLength(5);
    const names = list.map((r) => r.name);
    for (const name of MINIMAX_H3_SAMPLING_RECIPE_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("computes valid recipe digests for each catalog entry", () => {
    for (const recipe of listSamplingRecipes()) {
      expect(recipe.recipeDigest).toBeDefined();
      expect(recipe.recipeDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  describe("recipe specifics", () => {
    it("canonical-base-20 has 20 steps, ref2va checkpoint, no LoRA, compatible with i2v and ref2v", () => {
      const recipeRef = getSamplingRecipe("canonical-base-20", "ref2v");
      expect(recipeRef.expectedSteps).toBe(20);
      expect(recipeRef.diffusionModel.filename).toBe(
        "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
      );
      expect(recipeRef.lora).toBeNull();
      expect(recipeRef.sigmaShift).toBeNull();
      expect(recipeRef.compatibleRoute).toBe("ref2v");
      expect(recipeRef.conditioningMode).toBe("reference_directed");

      const recipeI2v = getSamplingRecipe("canonical-base-20", "i2v");
      expect(recipeI2v.compatibleRoute).toBe("i2v");
      expect(recipeI2v.conditioningMode).toBe("frame_anchored");

      expect(() => validateRecipeRouteCompatibility("canonical-base-20", "i2v")).not.toThrow();
      expect(() => validateRecipeRouteCompatibility("canonical-base-20", "ref2v")).not.toThrow();
    });

    it("fl2va-base-20 has 20 steps, fl2va checkpoint, no LoRA, compatible only with i2v", () => {
      const recipe = getSamplingRecipe("fl2va-base-20");
      expect(recipe.expectedSteps).toBe(20);
      expect(recipe.diffusionModel.filename).toBe(
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
      );
      expect(recipe.lora).toBeNull();
      expect(recipe.compatibleRoute).toBe("i2v");
      expect(recipe.conditioningMode).toBe("frame_anchored");

      expect(() => validateRecipeRouteCompatibility("fl2va-base-20", "i2v")).not.toThrow();
      expect(() => validateRecipeRouteCompatibility("fl2va-base-20", "ref2v")).toThrow(
        "FL2VA Base 20-step recipe is strictly restricted to I2V route"
      );
    });

    it("fl2va-turbo-8 has 8 steps, fl2va checkpoint, turbo LoRA, compatible only with i2v", () => {
      const recipe = getSamplingRecipe("fl2va-turbo-8");
      expect(recipe.expectedSteps).toBe(8);
      expect(recipe.diffusionModel.filename).toBe(
        "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
      );
      expect(recipe.lora).toBeDefined();
      expect(recipe.lora?.filename).toBe(
        "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
      );
      expect(recipe.lora?.strengthModel).toBe(1.0);
      expect(recipe.compatibleRoute).toBe("i2v");
      expect(recipe.conditioningMode).toBe("frame_anchored");

      expect(() => validateRecipeRouteCompatibility("fl2va-turbo-8", "i2v")).not.toThrow();
      expect(() => validateRecipeRouteCompatibility("fl2va-turbo-8", "ref2v")).toThrow(
        "FL2VA Turbo 8-step LoRA is strictly restricted to I2V route"
      );
    });

    it("ref2va-turbo-4 has 4 steps, ref2va checkpoint, turbo LoRA, compatible only with ref2v", () => {
      const recipe = getSamplingRecipe("ref2va-turbo-4");
      expect(recipe.expectedSteps).toBe(4);
      expect(recipe.diffusionModel.filename).toBe(
        "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
      );
      expect(recipe.lora).toBeDefined();
      expect(recipe.lora?.filename).toBe(
        "minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"
      );
      expect(recipe.lora?.strengthModel).toBe(1.0);
      expect(recipe.compatibleRoute).toBe("ref2v");
      expect(recipe.conditioningMode).toBe("reference_directed");

      expect(() => validateRecipeRouteCompatibility("ref2va-turbo-4", "ref2v")).not.toThrow();
      expect(() => validateRecipeRouteCompatibility("ref2va-turbo-4", "i2v")).toThrow(
        "Ref2VA Turbo 4-step LoRA is strictly restricted to Ref2V route"
      );
    });

    it("fasth3-i2v-8 has 8 steps, distilled checkpoint, sigma shift, attention backend, strictly i2v only", () => {
      const recipe = getSamplingRecipe("fasth3-i2v-8");
      expect(recipe.expectedSteps).toBe(8);
      expect(recipe.diffusionModel.filename).toBe(
        "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"
      );
      expect(recipe.lora).toBeNull();
      expect(recipe.sigmaShift).toBeDefined();
      expect(recipe.sigmaShift?.enabled).toBe(true);
      expect(recipe.sigmaShift?.videoShift).toBe(10.0);
      expect(recipe.sigmaShift?.audioShift).toBe(3.0);
      expect(recipe.attentionTopology).toBeDefined();
      expect(recipe.attentionTopology?.backend).toBe("comfy kitchen attention");
      expect(recipe.compatibleRoute).toBe("i2v");
      expect(recipe.conditioningMode).toBe("frame_anchored");
      expect(recipe.requiredRuntimeRevision).toBe("ee71d5c4993f29086b27fde1629a945ae48425bf");

      expect(() => validateRecipeRouteCompatibility("fasth3-i2v-8", "i2v")).not.toThrow();
      expect(() => validateRecipeRouteCompatibility("fasth3-i2v-8", "ref2v")).toThrow(
        "FastH3 8-step is strictly restricted to I2V / frame-anchored route; Ref2V is rejected"
      );
    });
  });

  it("throws error for unknown recipe name", () => {
    expect(() =>
      getSamplingRecipe("non-existent-recipe" as unknown as MinimaxH3SamplingRecipeName)
    ).toThrow("Unknown sampling recipe: non-existent-recipe");
  });
});
