import { z } from "zod";
import { canonicalizeJson, sha256Hex } from "./minimax-h3-experiment.js";
import {
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_GRID_BASE,
  MINIMAX_H3_FRAME_GRID_STEP,
  type ProfileInjectionTopology,
  type RenderProfileKey
} from "./render-profile.js";

import { sha256HashSchema } from "./persistent-media.js";

export const H3CandidateRouteSchema = z.enum(["i2v", "ref2v"]);
export type H3CandidateRoute = z.infer<typeof H3CandidateRouteSchema>;

export const H3CandidateRoutingModeSchema = z.enum(["frame_anchored", "reference_directed"]);
export type H3CandidateRoutingMode = z.infer<typeof H3CandidateRoutingModeSchema>;

export const H3CandidateAttentionBackendSchema = z.enum([
  "flash_attn",
  "sage_attn",
  "sdpa",
  "standard",
  "comfy_native"
]);
export type H3CandidateAttentionBackend = z.infer<typeof H3CandidateAttentionBackendSchema>;

export const H3CandidateOffloadPolicySchema = z.enum([
  "dynamicvram",
  "highvram",
  "cpu_offload",
  "none"
]);
export type H3CandidateOffloadPolicy = z.infer<typeof H3CandidateOffloadPolicySchema>;

const RESERVED_MODEL_KEYS = new Set(["checkpoint", "clip", "audioVae", "videoVae", "turboLora"]);

export const H3CandidateModelHashesSchema = z
  .object({
    checkpoint: sha256HashSchema,
    clip: sha256HashSchema,
    audioVae: sha256HashSchema,
    videoVae: sha256HashSchema,
    turboLora: z.union([sha256HashSchema, z.literal("none")]),
    additionalModels: z.record(z.string().trim().min(1), sha256HashSchema).default({})
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.additionalModels) {
      for (const key of Object.keys(val.additionalModels)) {
        if (RESERVED_MODEL_KEYS.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `additionalModels cannot contain reserved model key: "${key}"`,
            path: ["additionalModels", key]
          });
        }
      }
    }
  });
export type H3CandidateModelHashes = z.infer<typeof H3CandidateModelHashesSchema>;

export const H3CandidateCustomNodeSpecSchema = z
  .object({
    name: z.string().trim().min(1),
    revision: z.string().trim().min(1),
    sourceHash: sha256HashSchema
  })
  .strict();
export type H3CandidateCustomNodeSpec = z.infer<typeof H3CandidateCustomNodeSpecSchema>;

export const H3CandidateSparsitySettingsSchema = z.union([
  z
    .object({
      enabled: z.literal(true),
      method: z.string().trim().min(1),
      threshold: z.number().finite().nonnegative()
    })
    .strict(),
  z
    .object({
      enabled: z.literal(false),
      method: z.literal("none"),
      threshold: z.literal(0)
    })
    .strict()
]);
export type H3CandidateSparsitySettings = z.infer<typeof H3CandidateSparsitySettingsSchema>;

export const H3CandidateAttentionSpecSchema = z
  .object({
    backend: H3CandidateAttentionBackendSchema,
    customNodeRevision: z.string().trim().min(1),
    customNodeSourceHash: z.union([sha256HashSchema, z.literal("none")]),
    packageVersion: z.string().trim().min(1),
    sparsitySettings: H3CandidateSparsitySettingsSchema
  })
  .strict()
  .superRefine((val, ctx) => {
    if ((val.customNodeRevision === "none") !== (val.customNodeSourceHash === "none")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'customNodeRevision must be "none" if and only if customNodeSourceHash is "none"',
        path: ["customNodeRevision"]
      });
    }
  });
export type H3CandidateAttentionSpec = z.infer<typeof H3CandidateAttentionSpecSchema>;

export const H3CandidateRunnerSettingsSchema = z
  .object({
    runnerProfile: z.string().trim().min(1),
    offloadPolicy: H3CandidateOffloadPolicySchema,
    requiresModelOffloading: z.boolean(),
    maxConcurrentGpuJobs: z.number().int().positive().safe(),
    minFreeDiskGb: z.number().positive().finite()
  })
  .strict();
export type H3CandidateRunnerSettings = z.infer<typeof H3CandidateRunnerSettingsSchema>;

export const H3CandidateExecutionPolicySchema = z
  .object({
    renderTimeoutMs: z.number().int().positive().safe(),
    minFreeDiskGb: z.number().positive().finite(),
    maxConcurrentGpuJobs: z.number().int().positive().safe(),
    requiresModelOffloading: z.boolean(),
    offloadPolicy: H3CandidateOffloadPolicySchema
  })
  .strict();
export type H3CandidateExecutionPolicy = z.infer<typeof H3CandidateExecutionPolicySchema>;

export const H3CandidateExecutionSpecificationSchema = z
  .object({
    version: z.literal(1),
    route: H3CandidateRouteSchema,
    routingMode: H3CandidateRoutingModeSchema,
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    fps: z.literal(MINIMAX_H3_FPS),
    frames: z.number().int().positive().safe(),
    workflowHash: sha256HashSchema,
    modelHashes: H3CandidateModelHashesSchema,
    sampler: z.string().trim().min(1),
    scheduler: z.string().trim().min(1),
    steps: z.number().int().positive().safe(),
    cfg: z.number().positive().finite(),
    denoise: z.number().positive().finite().max(1),
    attention: H3CandidateAttentionSpecSchema,
    runnerSettings: H3CandidateRunnerSettingsSchema,
    customNodes: z.array(H3CandidateCustomNodeSpecSchema).default([]),
    packageVersions: z.record(z.string().trim().min(1), z.string().trim().min(1)),
    expectedCoreRevision: z.string().trim().min(1).optional(),
    expectedPythonExecutable: z.string().trim().min(1).optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    // Route and mode invariant: i2v must be frame_anchored; ref2v must be reference_directed
    if (val.route === "i2v" && val.routingMode !== "frame_anchored") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'route "i2v" must specify routingMode "frame_anchored"',
        path: ["routingMode"]
      });
    }
    if (val.route === "ref2v" && val.routingMode !== "reference_directed") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'route "ref2v" must specify routingMode "reference_directed"',
        path: ["routingMode"]
      });
    }

    // MiniMax-H3 temporal grid: (frames - 5) % 17 === 0
    if ((val.frames - MINIMAX_H3_FRAME_GRID_BASE) % MINIMAX_H3_FRAME_GRID_STEP !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `frames (${val.frames}) does not satisfy MiniMax-H3 grid: (frames - ${MINIMAX_H3_FRAME_GRID_BASE}) % ${MINIMAX_H3_FRAME_GRID_STEP} === 0`,
        path: ["frames"]
      });
    }

    // Check for duplicate custom nodes
    const nodeNames = new Set<string>();
    for (let i = 0; i < val.customNodes.length; i++) {
      const node = val.customNodes[i];
      if (node && nodeNames.has(node.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate customNode name: "${node.name}"`,
          path: ["customNodes", i, "name"]
        });
      }
      if (node) {
        nodeNames.add(node.name);
      }
    }

    // Package versions must be non-empty
    if (Object.keys(val.packageVersions).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "packageVersions must contain at least one package version",
        path: ["packageVersions"]
      });
    }
  });

export type H3CandidateExecutionSpecification = z.infer<
  typeof H3CandidateExecutionSpecificationSchema
>;

export function canonicalizeH3CandidateSpecification(
  spec: H3CandidateExecutionSpecification
): string {
  return canonicalizeJson(spec);
}

export function computeH3CandidateSpecificationDigest(
  spec: H3CandidateExecutionSpecification
): string {
  return sha256Hex(canonicalizeH3CandidateSpecification(spec));
}

export const H3CandidateProfileKeySchema = z
  .string()
  .regex(
    /^H3_CANDIDATE_[0-9a-f]{32}_V[1-9]\d*$/,
    "Candidate key must match pattern H3_CANDIDATE_<32-hex-digest>_V<version>"
  );
export type H3CandidateProfileKey = z.infer<typeof H3CandidateProfileKeySchema>;

export function computeH3CandidateKey(
  specificationDigest: string,
  version: number = 1
): H3CandidateProfileKey {
  if (!/^[0-9a-f]{64}$/.test(specificationDigest)) {
    throw new Error(`Invalid specificationDigest: ${specificationDigest}`);
  }
  if (!Number.isInteger(version) || version <= 0) {
    throw new Error(`Invalid version: ${version}`);
  }
  return `H3_CANDIDATE_${specificationDigest.slice(0, 32)}_V${version}` as H3CandidateProfileKey;
}

export const H3CandidateMeasurementsSchema = z
  .object({
    measuredPeakVramMb: z.number().int().positive().safe(),
    measuredTotalDurationMs: z.number().int().positive().safe(),
    measuredSamplingDurationMs: z.number().int().positive().safe().nullable(),
    measuredDiskFootprintGb: z.number().positive().finite(),
    sourceEvidenceDigest: sha256HashSchema
  })
  .strict();
export type H3CandidateMeasurements = z.infer<typeof H3CandidateMeasurementsSchema>;

export const NodeInjectionTargetSchema = z
  .object({
    nodeId: z.string().min(1),
    classType: z.string().min(1),
    inputField: z.string().min(1)
  })
  .strict();

export const ProfileInjectionTopologySchema = z
  .object({
    prompt: NodeInjectionTargetSchema,
    negativePrompt: NodeInjectionTargetSchema.optional(),
    seed: NodeInjectionTargetSchema,
    audioPrompt: NodeInjectionTargetSchema.nullable().optional(),
    frameCount: NodeInjectionTargetSchema.optional(),
    referenceImage: NodeInjectionTargetSchema.optional(),
    firstFrame: NodeInjectionTargetSchema.optional(),
    lastFrame: NodeInjectionTargetSchema.optional(),
    width: NodeInjectionTargetSchema.optional(),
    height: NodeInjectionTargetSchema.optional(),
    refImageSize: NodeInjectionTargetSchema.optional(),
    referenceNode: NodeInjectionTargetSchema.optional(),
    referenceImages: z.array(NodeInjectionTargetSchema).optional(),
    referenceSlotFields: z.array(z.string().min(1)).optional()
  })
  .strict();

export const H3CandidateProfileSchema = z
  .object({
    key: H3CandidateProfileKeySchema,
    version: z.literal(1),
    specificationDigest: sha256HashSchema,
    specification: H3CandidateExecutionSpecificationSchema,
    topology: ProfileInjectionTopologySchema,
    measurements: H3CandidateMeasurementsSchema.nullable().optional(),
    status: z.literal("candidate")
  })
  .strict()
  .superRefine((val, ctx) => {
    const expectedDigest = computeH3CandidateSpecificationDigest(val.specification);
    if (val.specificationDigest !== expectedDigest) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `specificationDigest mismatch: declared "${val.specificationDigest}", computed "${expectedDigest}"`,
        path: ["specificationDigest"]
      });
    }

    const expectedKey = computeH3CandidateKey(expectedDigest, val.version);
    if (val.key !== expectedKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `candidate key mismatch: declared "${val.key}", expected "${expectedKey}"`,
        path: ["key"]
      });
    }

    // Common geometry and frame count target constraints
    if (!val.topology.width) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Candidate topology must define "width"',
        path: ["topology", "width"]
      });
    }
    if (!val.topology.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Candidate topology must define "height"',
        path: ["topology", "height"]
      });
    }
    if (!val.topology.frameCount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Candidate topology must define "frameCount"',
        path: ["topology", "frameCount"]
      });
    }

    // Topology route constraints
    if (val.specification.route === "i2v") {
      if (!val.topology.referenceImage && !val.topology.firstFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'i2v candidate topology must define "referenceImage" or "firstFrame"',
          path: ["topology"]
        });
      }
      if (
        val.topology.referenceImages ||
        val.topology.referenceNode ||
        val.topology.referenceSlotFields
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'i2v candidate topology cannot define ref2v fields ("referenceImages", "referenceNode", "referenceSlotFields")',
          path: ["topology"]
        });
      }
    } else if (val.specification.route === "ref2v") {
      if (val.topology.referenceImage || val.topology.firstFrame || val.topology.lastFrame) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'ref2v candidate topology cannot define frame anchor fields ("referenceImage", "firstFrame", "lastFrame")',
          path: ["topology"]
        });
      }
      if (!val.topology.referenceImages || val.topology.referenceImages.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ref2v candidate topology must define non-empty "referenceImages"',
          path: ["topology", "referenceImages"]
        });
      }
      if (!val.topology.referenceNode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ref2v candidate topology must define "referenceNode"',
          path: ["topology", "referenceNode"]
        });
      }
      if (!val.topology.referenceSlotFields || val.topology.referenceSlotFields.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'ref2v candidate topology must define non-empty "referenceSlotFields"',
          path: ["topology", "referenceSlotFields"]
        });
      }

      if (val.topology.referenceImages && val.topology.referenceSlotFields) {
        if (val.topology.referenceImages.length !== val.topology.referenceSlotFields.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `referenceSlotFields length (${val.topology.referenceSlotFields.length}) must match referenceImages length (${val.topology.referenceImages.length})`,
            path: ["topology", "referenceSlotFields"]
          });
        }
        const seenSlots = new Set<string>();
        for (let i = 0; i < val.topology.referenceSlotFields.length; i++) {
          const s = val.topology.referenceSlotFields[i]!;
          if (seenSlots.has(s)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate reference slot field: "${s}"`,
              path: ["topology", "referenceSlotFields", i]
            });
          }
          seenSlots.add(s);
        }
        const seenNodes = new Set<string>();
        for (let i = 0; i < val.topology.referenceImages.length; i++) {
          const target = val.topology.referenceImages[i]!;
          if (seenNodes.has(target.nodeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate reference image nodeId: "${target.nodeId}"`,
              path: ["topology", "referenceImages", i]
            });
          }
          seenNodes.add(target.nodeId);
        }
      }
    }
  });

export type H3CandidateProfile = z.infer<typeof H3CandidateProfileSchema>;

export type ResolvedExecutionSelection =
  | {
      readonly kind: "legacy";
      readonly profileKey: RenderProfileKey;
      readonly engine: string;
      readonly workflowTemplate: string;
      readonly route: "i2v" | "ref2v" | "text_to_video" | "storyboard_previs";
      readonly routingMode?: "frame_anchored" | "reference_directed" | undefined;
      readonly width: number;
      readonly height: number;
      readonly fps: number;
      readonly allowedFrameCounts: readonly number[];
    }
  | {
      readonly kind: "candidate";
      readonly candidateKey: H3CandidateProfileKey;
      readonly version: 1;
      readonly specificationDigest: string;
      readonly specification: H3CandidateExecutionSpecification;
      readonly topology: ProfileInjectionTopology;
      readonly route: "i2v" | "ref2v";
      readonly routingMode: "frame_anchored" | "reference_directed";
      readonly width: number;
      readonly height: number;
      readonly fps: number;
      readonly frames: number;
      readonly allowedFrameCounts: readonly number[];
      readonly executionPolicy?: H3CandidateExecutionPolicy | undefined;
    };

export type CandidateExecutionSelection = Extract<
  ResolvedExecutionSelection,
  { kind: "candidate" }
>;

export function resolveCandidateExecutionPolicy(
  candidate: H3CandidateProfile,
  deploymentTimeoutMs?: number
): H3CandidateExecutionPolicy {
  const measuredMs = candidate.measurements?.measuredTotalDurationMs;
  const timeoutMs =
    deploymentTimeoutMs ?? (measuredMs ? Math.max(300_000, measuredMs * 3) : 900_000);
  const minFreeDiskGb = Math.max(
    candidate.specification.runnerSettings.minFreeDiskGb,
    candidate.measurements?.measuredDiskFootprintGb ?? 0
  );
  return {
    renderTimeoutMs: timeoutMs,
    minFreeDiskGb,
    maxConcurrentGpuJobs: candidate.specification.runnerSettings.maxConcurrentGpuJobs,
    requiresModelOffloading: candidate.specification.runnerSettings.requiresModelOffloading,
    offloadPolicy: candidate.specification.runnerSettings.offloadPolicy
  };
}

export function resolveCandidateExecutionSelection(
  candidate: H3CandidateProfile,
  deploymentTimeoutMs?: number
): CandidateExecutionSelection {
  return {
    kind: "candidate",
    candidateKey: candidate.key,
    version: 1,
    specificationDigest: candidate.specificationDigest,
    specification: candidate.specification,
    topology: candidate.topology,
    route: candidate.specification.route,
    routingMode: candidate.specification.routingMode,
    width: candidate.specification.width,
    height: candidate.specification.height,
    fps: candidate.specification.fps,
    frames: candidate.specification.frames,
    allowedFrameCounts: [candidate.specification.frames],
    executionPolicy: resolveCandidateExecutionPolicy(candidate, deploymentTimeoutMs)
  };
}

export interface H3ProfileFrameCapability {
  readonly profileKey: string;
  readonly route: "i2v" | "ref2v";
  readonly routingMode: "frame_anchored" | "reference_directed";
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly allowedFrameCounts: readonly number[];
  readonly isAllowedFrameCount: (frameCount: number) => boolean;
}

export function isH3CandidateProfile(value: unknown): value is H3CandidateProfile {
  return H3CandidateProfileSchema.safeParse(value).success;
}

export const H3CandidateRenderProfileProvenanceSchema = z
  .object({
    candidateKey: H3CandidateProfileKeySchema,
    version: z.literal(1),
    route: z.enum(["i2v", "ref2v"]),
    routingMode: z.enum(["frame_anchored", "reference_directed"]),
    width: z.number().int().positive().safe(),
    height: z.number().int().positive().safe(),
    fps: z.number().int().positive().safe(),
    frames: z.number().int().positive().safe(),
    steps: z.number().int().positive().safe(),
    workflowHash: sha256HashSchema,
    modelHashes: z
      .record(z.string().trim().min(1), sha256HashSchema)
      .refine((m) => Object.keys(m).length > 0, "modelHashes must be non-empty"),
    optimizerFingerprint: z
      .object({
        attentionBackend: z.string().trim().min(1),
        customNodeRevision: z.string().trim().min(1),
        customNodeSourceHash: z.string().trim().min(1),
        packageVersion: z.string().trim().min(1),
        sparsity: z.unknown(),
        customNodes: z.array(
          z
            .object({
              name: z.string().trim().min(1),
              revision: z.string().trim().min(1),
              sourceHash: sha256HashSchema
            })
            .strict()
        ),
        packageVersions: z.record(z.string().trim().min(1), z.string().trim().min(1))
      })
      .strict(),
    runnerProfile: z.string().trim().min(1),
    measuredDiskFootprintGb: z.number().positive().finite(),
    minFreeDiskGb: z.number().positive().finite()
  })
  .strict();

export type H3CandidateRenderProfileProvenance = z.infer<
  typeof H3CandidateRenderProfileProvenanceSchema
>;

export const H3CandidateProvenanceReportSchema = z
  .object({
    version: z.literal(1),
    candidateKey: H3CandidateProfileKeySchema,
    generatedAt: z.string().datetime(),
    workflow: z
      .object({
        relativePath: z.string().trim().min(1),
        sha256: sha256HashSchema
      })
      .strict(),
    models: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).optional(),
            category: z.string().trim().min(1).optional(),
            relativePath: z.string().trim().min(1),
            sha256: sha256HashSchema,
            bytes: z.number().int().nonnegative().optional()
          })
          .passthrough()
      )
      .min(1),
    renderProfileProvenance: H3CandidateRenderProfileProvenanceSchema,
    observedRuntime: z
      .object({
        hostname: z.string().trim().min(1),
        gpuUuid: z.string().trim().min(1),
        pid: z.number().int().positive().safe(),
        processStartTimeTicks: z.number().int().nonnegative().safe(),
        pythonExecutable: z.string().trim().min(1),
        comfyUiCoreRevision: z.string().trim().min(1),
        commandLineArgs: z.array(z.string()),
        customNodes: z.record(
          z.string(),
          z
            .object({
              revision: z.string().trim().min(1),
              sourceHash: sha256HashSchema
            })
            .strict()
        ),
        packageVersions: z.record(z.string().trim().min(1), z.string().trim().min(1)),
        observedAt: z.string()
      })
      .strict(),
    operatorAuthorization: z
      .object({
        signerKeyId: z.string().trim().min(1),
        payloadDigest: sha256HashSchema,
        scope: z.enum(["staging", "production"])
      })
      .strict()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.renderProfileProvenance.candidateKey !== val.candidateKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Inner renderProfileProvenance.candidateKey "${val.renderProfileProvenance.candidateKey}" does not match report candidateKey "${val.candidateKey}"`,
        path: ["renderProfileProvenance", "candidateKey"]
      });
    }
    if (val.renderProfileProvenance.workflowHash !== val.workflow.sha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Inner renderProfileProvenance.workflowHash "${val.renderProfileProvenance.workflowHash}" does not match workflow.sha256 "${val.workflow.sha256}"`,
        path: ["renderProfileProvenance", "workflowHash"]
      });
    }
  });

export type H3CandidateProvenanceReport = z.infer<typeof H3CandidateProvenanceReportSchema>;

export function computeModelHashesDigest(modelHashes: unknown): string {
  return sha256Hex(canonicalizeJson(modelHashes));
}
