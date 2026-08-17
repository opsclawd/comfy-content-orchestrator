import { z } from "zod";

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

export const RenderProfileKeySchema = z.enum(["LTX_25_720P_5S_V1", "FLUX_SCHNELL_DRAFT_V1"]);
export type RenderProfileKey = z.infer<typeof RenderProfileKeySchema>;

export const LtxRenderProfileSchema = z.object({
  key: z.literal("LTX_25_720P_5S_V1"),
  version: z.literal(1),
  engine: z.literal("ltx_25"),
  workflowHash: sha256HashSchema,
  modelHashes: z.record(z.string(), sha256HashSchema),
  frames: z.literal(97),
  steps: z.literal(8),
  runnerProfile: z.string().min(1),
  measuredPeakVramMb: z.number().int().positive(),
  measuredTotalDurationMs: z.number().int().positive(),
  measuredSamplingDurationMs: z.number().int().positive().nullable(),
  measuredDiskFootprintGb: z.number().positive().finite(),
  measuredPeakHostRamMb: z.number().int().nonnegative().nullable(),
  measuredPeakProcessRssMb: z.number().int().nonnegative().nullable(),
  measuredSwapUsedMb: z.number().int().nonnegative().nullable(),
  measuredMajorPageFaults: z.number().int().nonnegative().nullable(),
  minFreeDiskGb: z.number().positive().finite(),
  maxConcurrentGpuJobs: z.number().int().positive(),
  requiresModelOffloading: z.boolean()
});
export type LtxRenderProfile = z.infer<typeof LtxRenderProfileSchema>;

export const FluxSchnellRenderProfileSchema = z.object({
  key: z.literal("FLUX_SCHNELL_DRAFT_V1"),
  version: z.literal(1),
  engine: z.literal("flux_schnell"),
  workflowHash: sha256HashSchema,
  modelHashes: z.record(z.string(), sha256HashSchema),
  frames: z.literal(1),
  steps: z.literal(4),
  runnerProfile: z.string().min(1),
  measuredPeakVramMb: z.number().int().positive(),
  measuredTotalDurationMs: z.number().int().positive(),
  measuredSamplingDurationMs: z.number().int().positive().nullable(),
  measuredDiskFootprintGb: z.number().positive().finite(),
  measuredPeakHostRamMb: z.number().int().nonnegative().nullable(),
  measuredPeakProcessRssMb: z.number().int().nonnegative().nullable(),
  measuredSwapUsedMb: z.number().int().nonnegative().nullable(),
  measuredMajorPageFaults: z.number().int().nonnegative().nullable(),
  minFreeDiskGb: z.number().nonnegative().finite(),
  maxConcurrentGpuJobs: z.number().int().positive(),
  requiresModelOffloading: z.boolean()
});
export type FluxSchnellRenderProfile = z.infer<typeof FluxSchnellRenderProfileSchema>;

export const RenderProfileSchema = z.discriminatedUnion("key", [
  LtxRenderProfileSchema,
  FluxSchnellRenderProfileSchema
]);
export type RenderProfile = z.infer<typeof RenderProfileSchema>;

export const LTX_25_720P_5S_V1_PROFILE: LtxRenderProfile = Object.freeze({
  key: "LTX_25_720P_5S_V1",
  version: 1,
  engine: "ltx_25",
  workflowHash: "94f397eee3ad8b0cee000036119e524e8c7a012b88d79d00b74172df9d9bf539",
  modelHashes: Object.freeze({
    "models/clip/gemma4-12b-with-proj-ltx-2.5-comfy-int8-convrot.safetensors":
      "09a89e084de1a149c3de60cfe9dfd3e5161967eb09eea39e806fcdeffdd568de",
    "models/diffusion_models/ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors":
      "c4279eeff115cbeaca494bd2183e7d768c38fe85a184dc6afbb7159157c44334",
    "models/vae/ltx-2.5-video-vae-conv-bf16.safetensors":
      "685b06ee3d9b2039647698fc4ea33175112462fc374e2777312c907897dfce8d"
  }),
  frames: 97,
  steps: 8,
  runnerProfile: "dynamicvram-offload-v1",
  measuredPeakVramMb: 24038,
  measuredTotalDurationMs: 45632,
  measuredSamplingDurationMs: null,
  measuredDiskFootprintGb: 38.329275932,
  measuredPeakHostRamMb: 29384,
  measuredPeakProcessRssMb: 27043,
  measuredSwapUsedMb: 89,
  measuredMajorPageFaults: 1009,
  minFreeDiskGb: 100,
  maxConcurrentGpuJobs: 1,
  requiresModelOffloading: true
});
