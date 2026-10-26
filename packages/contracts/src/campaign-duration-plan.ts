import { z } from "zod";
import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";
import { ExecutionRealmSchema } from "./execution-realm.js";
import { ExecutionProfileSelectionSchema } from "./execution-profile.js";
import { AssemblyPlanningEnvelopeSchema } from "./assembly-planning-envelope.js";

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a 64-character lowercase hexadecimal hash");

export const FinalEditPolicySchema = z.literal("preserve_generated_timeline");
export type FinalEditPolicy = z.infer<typeof FinalEditPolicySchema>;

export const SceneDurationAllocationSchema = z
  .object({
    allocationId: z.string().uuid(),
    ordinal: z.number().int().positive(),
    requestedDurationMs: z.number().int().positive(),
    nominalDurationMs: z.number().int().positive(),
    exactRationalNominalDurationMs: z.number().positive(),
    profileSelection: ExecutionProfileSelectionSchema,
    engine: z.string().trim().min(1),
    route: z.enum(["i2v", "ref2v"]),
    routingMode: z.enum(["frame_anchored", "reference_directed"]),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    frames: z.number().int().positive(),
    fps: z.number().positive(),
    toleranceMs: z.number().nonnegative(),
    preferredDurationMs: z.number().int().positive()
  })
  .strict();
export type SceneDurationAllocation = z.infer<typeof SceneDurationAllocationSchema>;

export const CampaignDurationPlanSchema = z
  .object({
    planId: z.string().uuid(),
    campaignId: z.string().uuid(),
    revision: z.number().int().positive(),
    predecessorPlanId: z.string().uuid().nullable(),
    realm: ExecutionRealmSchema,
    scope: z.enum(["production", "staging"]),
    requestedTotalDurationMs: z.number().int().positive(),
    sceneCountOverride: z.number().int().positive().optional(),
    selectedProfileKey: z.string().trim().min(1),
    allowedDurationProfileKeys: z.array(z.string().trim().min(1)),
    allocations: z.array(SceneDurationAllocationSchema).min(1),
    envelope: AssemblyPlanningEnvelopeSchema,
    finalEditPolicy: FinalEditPolicySchema.default("preserve_generated_timeline"),
    totalNominalDurationMs: z.number().int().positive(),
    exactRationalTotalDurationMs: z.number().positive(),
    semanticDigest: sha256HashSchema,
    createdAt: z.string().datetime()
  })
  .strict()
  .superRefine((val, ctx) => {
    // 1. Ordinals must be contiguous 1..N
    const ordinals = val.allocations.map((a) => a.ordinal);
    const sorted = [...ordinals].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Allocation ordinals must be unique and contiguous 1..N",
          path: ["allocations"]
        });
        break;
      }
    }

    // 2. Sum of requested durations must equal requestedTotalDurationMs
    const sumRequested = val.allocations.reduce((sum, a) => sum + a.requestedDurationMs, 0);
    if (sumRequested !== val.requestedTotalDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sum of allocation requested durations (${sumRequested}ms) does not equal requestedTotalDurationMs (${val.requestedTotalDurationMs}ms)`,
        path: ["requestedTotalDurationMs"]
      });
    }

    // 3. Sum of nominal durations must equal totalNominalDurationMs
    const sumNominal = val.allocations.reduce((sum, a) => sum + a.nominalDurationMs, 0);
    if (sumNominal !== val.totalNominalDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Sum of allocation nominal durations (${sumNominal}ms) does not equal totalNominalDurationMs (${val.totalNominalDurationMs}ms)`,
        path: ["totalNominalDurationMs"]
      });
    }

    // 4. Semantic digest verification
    const computedDigest = computePlanSemanticDigest(val);
    if (val.semanticDigest !== computedDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `semanticDigest mismatch: declared "${val.semanticDigest}", computed "${computedDigest}"`,
        path: ["semanticDigest"]
      });
    }
  });
export type CampaignDurationPlan = z.infer<typeof CampaignDurationPlanSchema>;

export const SceneDurationBindingSchema = z
  .object({
    bindingId: z.string().uuid(),
    campaignId: z.string().uuid(),
    planId: z.string().uuid(),
    planRevision: z.number().int().positive(),
    allocationId: z.string().uuid(),
    sceneId: z.string().uuid(),
    specRevision: z.number().int().positive(),
    ordinal: z.number().int().positive(),
    bindingDigest: sha256HashSchema,
    createdAt: z.string().datetime()
  })
  .strict();
export type SceneDurationBinding = z.infer<typeof SceneDurationBindingSchema>;

export function computePlanSemanticDigest(
  plan: Pick<
    CampaignDurationPlan,
    | "scope"
    | "requestedTotalDurationMs"
    | "selectedProfileKey"
    | "allowedDurationProfileKeys"
    | "allocations"
    | "finalEditPolicy"
  >
): string {
  const payload = {
    scope: plan.scope,
    requestedTotalDurationMs: plan.requestedTotalDurationMs,
    selectedProfileKey: plan.selectedProfileKey,
    allowedDurationProfileKeys: [...plan.allowedDurationProfileKeys].sort(),
    finalEditPolicy: plan.finalEditPolicy,
    allocations: plan.allocations.map((a) => ({
      ordinal: a.ordinal,
      requestedDurationMs: a.requestedDurationMs,
      nominalDurationMs: a.nominalDurationMs,
      profileKey: a.profileSelection.profileKey,
      frames: a.frames,
      fps: a.fps,
      route: a.route,
      routingMode: a.routingMode,
      width: a.width,
      height: a.height
    }))
  };
  return sha256Hex(canonicalizeJson(payload));
}

export function computePlanBindingDigest(
  bindings: readonly Pick<
    SceneDurationBinding,
    "allocationId" | "sceneId" | "specRevision" | "ordinal"
  >[]
): string {
  const sorted = [...bindings].sort((a, b) => a.ordinal - b.ordinal);
  const payload = sorted.map((b) => ({
    allocationId: b.allocationId,
    sceneId: b.sceneId,
    specRevision: b.specRevision,
    ordinal: b.ordinal
  }));
  return sha256Hex(canonicalizeJson(payload));
}
