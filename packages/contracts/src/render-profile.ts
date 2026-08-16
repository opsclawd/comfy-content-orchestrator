import { z } from "zod";

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

export const RenderProfileKeySchema = z.enum(["LTX_25_720P_5S_V1", "FLUX_SCHNELL_DRAFT_V1"]);
export type RenderProfileKey = z.infer<typeof RenderProfileKeySchema>;

export const RenderProfileSchema = z.object({
  key: RenderProfileKeySchema,
  version: z.literal(1),
  engine: z.string().min(1),
  workflowHash: sha256HashSchema,
  modelHashes: z.record(z.string(), sha256HashSchema),
  frames: z.number().int().positive(),
  steps: z.number().int().positive(),
  runnerProfile: z.string().min(1),
  measuredPeakVramMb: z.number().int().positive(),
  measuredTotalDurationMs: z.number().int().positive(),
  measuredSamplingDurationMs: z.number().int().positive(),
  measuredDiskFootprintGb: z.number().positive().finite(),
  measuredPeakHostRamMb: z.number().int().nonnegative().nullable(),
  measuredPeakProcessRssMb: z.number().int().nonnegative().nullable(),
  measuredSwapUsedMb: z.number().int().nonnegative().nullable(),
  measuredMajorPageFaults: z.number().int().nonnegative().nullable(),
  minFreeDiskGb: z.number().positive().finite(),
  maxConcurrentGpuJobs: z.number().int().positive(),
  requiresModelOffloading: z.boolean()
});

export type RenderProfile = z.infer<typeof RenderProfileSchema>;
