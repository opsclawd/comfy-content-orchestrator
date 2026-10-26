import { z } from "zod";

export const AssemblyPlanningEnvelopeSchema = z
  .object({
    deploymentId: z.string().trim().min(1),
    assemblyProfileKey: z.string().trim().min(1),
    policyVersion: z.number().int().positive(),
    revision: z.string().trim().min(1),
    maxStemCount: z.number().int().positive(),
    maxExpectedTotalDurationMs: z.number().int().positive()
  })
  .strict();
export type AssemblyPlanningEnvelope = z.infer<typeof AssemblyPlanningEnvelopeSchema>;

export const DEFAULT_ASSEMBLY_PLANNING_ENVELOPE: AssemblyPlanningEnvelope = Object.freeze({
  deploymentId: "default",
  assemblyProfileKey: "VERTICAL_REEL_1080X1920_V1",
  policyVersion: 1,
  revision: "rev-default-v1",
  maxStemCount: 12,
  maxExpectedTotalDurationMs: 60_000
});
