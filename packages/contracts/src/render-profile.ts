import { z } from "zod";

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

export const RenderProfileSchema = z.object({
  key: z.string().min(1),
  version: z.number().int().positive(),
  engine: z.string().min(1),
  workflowHash: sha256HashSchema,
  modelHashes: z.record(z.string(), sha256HashSchema),
  frames: z.number().int().positive(),
  steps: z.number().int().positive(),
  runnerProfile: z.string().min(1),
  runnerStartupArgs: z.array(z.string()),
  measuredPeakVramMb: z.number().int().positive(),
  measuredTotalDurationMs: z.number().int().positive(),
  measuredSamplingDurationMs: z.number().int().positive().nullable(),
  measuredDiskFootprintGb: z.number().positive().finite(),
  measuredPeakHostRamMb: z.number().int().nonnegative().nullable(),
  measuredPeakProcessRssMb: z.number().int().nonnegative().nullable(),
  measuredSwapUsedMb: z.number().int().nonnegative().nullable(),
  measuredMajorPageFaults: z.number().int().nonnegative().nullable(),
  measuredSwapActivity: z.number().int().nonnegative(),
  measuredHostRamTotalMb: z.number().int().positive(),
  measuredPostUnloadFreeVramMb: z.number().int().nonnegative(),
  minPostUnloadFreeVramMb: z.number().int().nonnegative(),
  minimumHostRamMb: z.number().int().positive(),
  minFreeDiskGb: z.number().positive().finite(),
  maxConcurrentGpuJobs: z.number().int().positive(),
  requiresModelOffloading: z.boolean(),
  certificationArtifactPath: z.string().min(1)
});

export type RenderProfile = z.infer<typeof RenderProfileSchema>;
