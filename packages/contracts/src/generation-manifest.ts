import { z } from "zod";
import { sha256HashSchema } from "./persistent-media.js";
import { ReferenceRoleSchema } from "./reference-asset.js";
import { ShotPlanRoutingModeSchema } from "./shot-plan.js";

export const ManifestStagedAsSchema = z.object({
  name: z.string().min(1, "Staged name must not be empty"),
  subfolder: z.string()
});
export type ManifestStagedAs = z.infer<typeof ManifestStagedAsSchema>;

export const ManifestNodeInjectionTargetSchema = z.object({
  nodeId: z.string().min(1, "nodeId must not be empty"),
  classType: z.string().min(1, "classType must not be empty"),
  inputField: z.string().min(1, "inputField must not be empty")
});
export type ManifestNodeInjectionTarget = z.infer<typeof ManifestNodeInjectionTargetSchema>;

export const ManifestReferenceImageEntrySchema = z.object({
  slotIndex: z.number().int().min(1).max(9),
  promptTag: z.string().regex(/^<Picture [1-9]>$/),
  assetId: z.string().uuid("assetId must be a valid UUID"),
  contentHashSha256: sha256HashSchema,
  role: ReferenceRoleSchema,
  stagedAs: ManifestStagedAsSchema,
  injectionTarget: ManifestNodeInjectionTargetSchema
});
export type ManifestReferenceImageEntry = z.infer<typeof ManifestReferenceImageEntrySchema>;

export const ManifestFrameAnchorEntrySchema = z.object({
  anchorType: z.enum(["first_frame", "last_frame"]),
  candidateId: z.string().uuid().optional(),
  contentHashSha256: sha256HashSchema,
  stagedAs: ManifestStagedAsSchema,
  injectionTarget: ManifestNodeInjectionTargetSchema
});
export type ManifestFrameAnchorEntry = z.infer<typeof ManifestFrameAnchorEntrySchema>;

export const ManifestPrevisReviewEvidenceSchema = z.object({
  candidateId: z.string().uuid("candidateId must be a valid UUID"),
  contentHashSha256: sha256HashSchema,
  specRevision: z.number().int().positive("specRevision must be a positive integer"),
  variantOrdinal: z.number().int().positive().optional(),
  storageBucket: z.string().min(1).optional(),
  storageObjectKey: z.string().min(1).optional()
});
export type ManifestPrevisReviewEvidence = z.infer<typeof ManifestPrevisReviewEvidenceSchema>;

export const ManifestExecutedInstructionSchema = z.object({
  text: z.string().min(1, "Instruction text must not be empty"),
  sha256: sha256HashSchema,
  byteLength: z.number().int().positive("byteLength must be a positive integer")
});
export type ManifestExecutedInstruction = z.infer<typeof ManifestExecutedInstructionSchema>;

export const ManifestShotPlanReferenceSchema = z.object({
  id: z.string().uuid("ShotPlan id must be a valid UUID"),
  specRevision: z.number().int().positive("specRevision must be a positive integer"),
  variantOrdinal: z.number().int().positive().optional()
});
export type ManifestShotPlanReference = z.infer<typeof ManifestShotPlanReferenceSchema>;

export const ManifestModelEntrySchema = z.object({
  key: z.string().optional(),
  category: z.string().min(1),
  sha256: sha256HashSchema,
  bytes: z.number().int().nonnegative().optional()
});
export type ManifestModelEntry = z.infer<typeof ManifestModelEntrySchema>;

export const ManifestWorkflowIdentitySchema = z.object({
  templateId: z.string().min(1),
  sha256: sha256HashSchema,
  submittedWorkflowHash: sha256HashSchema.optional()
});
export type ManifestWorkflowIdentity = z.infer<typeof ManifestWorkflowIdentitySchema>;

export const ManifestSamplingParamsSchema = z.object({
  seed: z.number().int().nonnegative(),
  steps: z.number().int().positive(),
  cfg: z.number().nonnegative(),
  sampler: z.string().min(1),
  scheduler: z.string().min(1),
  denoise: z.number().nonnegative()
});
export type ManifestSamplingParams = z.infer<typeof ManifestSamplingParamsSchema>;

export const ManifestDimensionsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive()
});
export type ManifestDimensions = z.infer<typeof ManifestDimensionsSchema>;

export const ManifestPromptsSchema = z.object({
  prompt: z.string().min(1),
  negativePrompt: z.string().optional(),
  audioPrompt: z.string().nullable().optional()
});
export type ManifestPrompts = z.infer<typeof ManifestPromptsSchema>;

export const ManifestOutputEntrySchema = z.object({
  bucket: z.string().min(1),
  key: z.string().min(1),
  filename: z.string().min(1),
  checksumSha256: sha256HashSchema,
  contentType: z.string().optional()
});
export type ManifestOutputEntry = z.infer<typeof ManifestOutputEntrySchema>;

export const ManifestEnvironmentSchema = z.object({
  comfyUiCommit: z.string().min(1),
  customNodes: z.array(z.unknown()).default([])
});
export type ManifestEnvironment = z.infer<typeof ManifestEnvironmentSchema>;

export const ManifestGovernanceSchema = z.object({
  license: z.string().min(1),
  sourceKind: z.string().min(1),
  sourceUri: z.string().optional(),
  sourceRevision: z.string().optional()
});
export type ManifestGovernance = z.infer<typeof ManifestGovernanceSchema>;

export const GenerationManifestSchema = z
  .object({
    manifestId: z.string().min(1),
    jobId: z.string().min(1),
    promptIdComfy: z.string().min(1),
    campaignId: z.string().uuid(),
    sceneId: z.string().uuid(),
    renderAttempt: z.number().int().positive(),
    renderedAt: z.string().datetime(),
    engine: z.string().min(1),
    renderProfile: z.string().min(1),
    renderProfileVersion: z.number().int().positive().nullable(),

    // Route identity and execution
    routingMode: ShotPlanRoutingModeSchema.optional(),
    shotPlan: ManifestShotPlanReferenceSchema.optional(),
    executedInstruction: ManifestExecutedInstructionSchema.optional(),
    referenceImages: z.array(ManifestReferenceImageEntrySchema).optional(),
    firstFrame: ManifestFrameAnchorEntrySchema.optional(),
    lastFrame: ManifestFrameAnchorEntrySchema.optional(),
    previsReviewEvidence: ManifestPrevisReviewEvidenceSchema.optional(),

    models: z.array(ManifestModelEntrySchema),
    workflow: ManifestWorkflowIdentitySchema,
    loras: z.array(z.unknown()).default([]),
    sampling: ManifestSamplingParamsSchema,
    dimensions: ManifestDimensionsSchema,
    frameCount: z.number().int().positive(),
    fps: z.number().positive(),
    prompts: ManifestPromptsSchema,
    referenceAssets: z.array(z.unknown()).default([]),
    approvedCandidate: z.unknown().optional(),
    executionConditioning: z.unknown().optional(),
    environment: ManifestEnvironmentSchema,
    runnerProfile: z.string().min(1),
    runtimeMetadata: z.record(z.string(), z.unknown()),
    governance: ManifestGovernanceSchema,
    outputs: z.array(ManifestOutputEntrySchema),
    outputObjectKeys: z.array(z.string()),
    executionDurationMs: z.number().nonnegative()
  })
  .superRefine((data, ctx) => {
    if (
      (data.renderProfile === "MINIMAX_H3_720P_5S_REF2V_V1" ||
        data.engine === "minimax_h3_ref2v") &&
      data.routingMode !== "reference_directed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Profile "MINIMAX_H3_720P_5S_REF2V_V1" / engine "minimax_h3_ref2v" requires routingMode "reference_directed", got "${data.routingMode}"`,
        path: ["routingMode"]
      });
    }

    if (data.routingMode === "reference_directed") {
      // 1. Profile / Engine must match reference-directed H3
      if (
        data.renderProfile !== "MINIMAX_H3_720P_5S_REF2V_V1" ||
        data.engine !== "minimax_h3_ref2v"
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `routingMode "reference_directed" requires profile "MINIMAX_H3_720P_5S_REF2V_V1" (engine "minimax_h3_ref2v"), got profile "${data.renderProfile}" / engine "${data.engine}"`,
          path: ["renderProfile"]
        });
      }

      // 2. ShotPlan must be declared
      if (!data.shotPlan) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'routingMode "reference_directed" requires a valid shotPlan object',
          path: ["shotPlan"]
        });
      }

      // 3. Executed instruction must be present
      if (!data.executedInstruction) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'routingMode "reference_directed" requires executedInstruction',
          path: ["executedInstruction"]
        });
      }

      // 4. Reference images array must be present (can be empty for N=0 prompt-only)
      if (!data.referenceImages || !Array.isArray(data.referenceImages)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'routingMode "reference_directed" requires a referenceImages array',
          path: ["referenceImages"]
        });
      } else {
        if (data.referenceImages.length > 9) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `referenceImages cannot exceed 9 entries (got ${data.referenceImages.length})`,
            path: ["referenceImages"]
          });
        }

        // Verify slot ordering and tag bijection
        const seenSlots = new Set<number>();
        const seenTags = new Set<string>();
        for (let i = 0; i < data.referenceImages.length; i++) {
          const entry = data.referenceImages[i]!;
          const expectedSlot = i + 1;
          if (entry.slotIndex !== expectedSlot) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `referenceImages[${i}].slotIndex must equal ${expectedSlot}, got ${entry.slotIndex}`,
              path: ["referenceImages", i, "slotIndex"]
            });
          }
          if (entry.promptTag !== `<Picture ${expectedSlot}>`) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `referenceImages[${i}].promptTag must equal "<Picture ${expectedSlot}>", got "${entry.promptTag}"`,
              path: ["referenceImages", i, "promptTag"]
            });
          }
          if (seenSlots.has(entry.slotIndex)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate slotIndex ${entry.slotIndex} in referenceImages`,
              path: ["referenceImages", i, "slotIndex"]
            });
          }
          seenSlots.add(entry.slotIndex);
          seenTags.add(entry.promptTag);
        }
      }

      // 5. False Conditioning Invariant: previs candidate stills must NEVER appear in executionConditioning
      if (data.executionConditioning !== undefined && data.executionConditioning !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'False Conditioning Invariant violated: candidate-based executionConditioning must not appear in "reference_directed" mode',
          path: ["executionConditioning"]
        });
      }

      // 6. Frame anchors must be absent
      if (data.firstFrame !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'firstFrame is not permitted in "reference_directed" mode',
          path: ["firstFrame"]
        });
      }
      if (data.lastFrame !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'lastFrame is not permitted in "reference_directed" mode',
          path: ["lastFrame"]
        });
      }
    } else if (data.routingMode === "frame_anchored") {
      // 1. Profile / Engine must match an explicit frame-anchored I2V profile
      const isAllowedI2v =
        (data.renderProfile === "MINIMAX_H3_720P_5S_I2V_V1" && data.engine === "minimax_h3_i2v") ||
        (data.renderProfile === "LTX_25_720P_5S_I2V_V1" && data.engine === "ltx_25_i2v");
      if (!isAllowedI2v) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `routingMode "frame_anchored" requires an I2V profile and matching engine, got profile "${data.renderProfile}" / engine "${data.engine}"`,
          path: ["renderProfile"]
        });
      }

      // 2. First frame must be present
      if (!data.firstFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'routingMode "frame_anchored" requires firstFrame',
          path: ["firstFrame"]
        });
      }

      // 3. Reference images must be absent
      if (data.referenceImages !== undefined && data.referenceImages.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'referenceImages are not permitted in "frame_anchored" mode',
          path: ["referenceImages"]
        });
      }
    }
  });

export type GenerationManifest = z.infer<typeof GenerationManifestSchema>;
