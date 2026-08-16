import { z } from "zod";

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

const gitCommitHashSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
    "Must be a valid Git commit hash (40 or 64 lowercase hex characters)"
  );

/**
 * Raw GPU memory snapshot sample.
 *
 * Denominator and Headroom Semantics:
 * - `totalVramMb`: Nameplate total physical VRAM reported by driver (e.g. 24,564 MB).
 * - `usedVramMb`: VRAM currently occupied by active processes / allocations.
 * - `freeVramMb`: VRAM currently free and available for allocation.
 * - `reservedVramMb`: Driver/VBIOS-reserved VRAM (`totalVramMb - (usedVramMb + freeVramMb)`).
 * - Allocatable pool (`usedVramMb + freeVramMb` = `totalVramMb - reservedVramMb`):
 *   This allocatable pool is the true denominator for headroom and utilisation calculations,
 *   representing the maximum memory actually available to workloads.
 */
export const CertificationGpuSampleSchema = z.object({
  totalVramMb: z.number().int().nonnegative(),
  usedVramMb: z.number().int().nonnegative(),
  freeVramMb: z.number().int().nonnegative(),
  reservedVramMb: z.number().int().nonnegative()
});
export type CertificationGpuSample = z.infer<typeof CertificationGpuSampleSchema>;

export const CertificationHostSampleSchema = z.object({
  hostRamTotalMb: z.number().int().nonnegative(),
  hostRamAvailableMb: z.number().int().nonnegative(),
  hostRamUsedMb: z.number().int().nonnegative(),
  swapTotalMb: z.number().int().nonnegative(),
  swapUsedMb: z.number().int().nonnegative(),
  systemSwapInPages: z.number().int().nonnegative(),
  systemSwapOutPages: z.number().int().nonnegative(),
  systemMajorPageFaults: z.number().int().nonnegative(),
  systemMinorPageFaults: z.number().int().nonnegative(),
  processPid: z.number().int().positive(),
  processStartTimeTicks: z.number().int().nonnegative(),
  processRssMb: z.number().int().nonnegative(),
  processMajorPageFaults: z.number().int().nonnegative(),
  processMinorPageFaults: z.number().int().nonnegative()
});
export type CertificationHostSample = z.infer<typeof CertificationHostSampleSchema>;

export const CertificationTelemetrySampleSchema = z.object({
  measuredAt: z.string().datetime(),
  phase: z.enum(["pre_dispatch", "sampling", "post_unload"]),
  gpu: CertificationGpuSampleSchema,
  host: CertificationHostSampleSchema
});
export type CertificationTelemetrySample = z.infer<typeof CertificationTelemetrySampleSchema>;

export const CertificationEnvironmentSchema = z.object({
  nodeVersion: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  osRelease: z.string().min(1),
  osVersion: z.string().min(1),
  cpuModel: z.string().min(1),
  cpuCount: z.number().int().positive(),
  gpuName: z.string().min(1),
  gpuUuid: z.string().min(1),
  gpuDriverVersion: z.string().min(1),
  gpuTotalMemoryMb: z.number().int().positive(),
  cudaVersion: z.string().min(1).nullable(),
  comfyUiPid: z.number().int().positive(),
  comfyUiArgs: z.array(z.string())
});
export type CertificationEnvironment = z.infer<typeof CertificationEnvironmentSchema>;

export const CertificationGateChecksSchema = z.object({
  renderSuccess: z.boolean(),
  noOom: z.boolean(),
  durationWithinLimit: z.boolean(),
  telemetryComplete: z.boolean(),
  postUnloadHeadroomObserved: z.boolean()
});
export type CertificationGateChecks = z.infer<typeof CertificationGateChecksSchema>;

export const CertificationGateSchema = z.object({
  passed: z.boolean(),
  maxDurationMs: z.number().int().positive(),
  checks: CertificationGateChecksSchema
});
export type CertificationGate = z.infer<typeof CertificationGateSchema>;

export const CertificationFailureSchema = z.object({
  phase: z.string().min(1),
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).optional()
});
export type CertificationFailure = z.infer<typeof CertificationFailureSchema>;

export const CustomNodeIdentitySchema = z.object({
  name: z.string().min(1),
  commit: gitCommitHashSchema.nullable(),
  status: z.enum(["tracked", "not_git", "unavailable"])
});
export type CustomNodeIdentity = z.infer<typeof CustomNodeIdentitySchema>;

export const CertificationWorkloadIdentitySchema = z.object({
  profileId: z.literal("ltx-25-720p-97f"),
  renderProfileKey: z.literal("LTX_25_720P_5S_V1"),
  renderProfileVersion: z.literal(1),
  engine: z.literal("ltx_25"),
  width: z.literal(1280),
  height: z.literal(720),
  frames: z.literal(97),
  steps: z.literal(8),
  workflowSha256: sha256HashSchema,
  modelSha256: z.record(z.string().min(1), sha256HashSchema),
  comfyUiCommit: gitCommitHashSchema,
  customNodes: z.array(CustomNodeIdentitySchema)
});
export type CertificationWorkloadIdentity = z.infer<typeof CertificationWorkloadIdentitySchema>;

export const CertificationRenderExecutionSchema = z.object({
  executionId: z.string().min(1).nullable(),
  status: z.enum(["succeeded", "failed", "not_started"]),
  outputObjectKeys: z.array(z.string()),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  totalDurationMs: z.number().int().nonnegative().nullable()
});
export type CertificationRenderExecution = z.infer<typeof CertificationRenderExecutionSchema>;

export const CertificationSamplingErrorSchema = z.object({
  measuredAt: z.string().datetime(),
  message: z.string().min(1)
});
export type CertificationSamplingError = z.infer<typeof CertificationSamplingErrorSchema>;

/**
 * Aggregated telemetry data across the certification run.
 *
 * Denominator and Headroom Semantics:
 * - `peakVramMb`: Maximum `usedVramMb` observed across all samples.
 * - `reservedVramMb`: Driver/VBIOS-reserved VRAM (`totalVramMb - (usedVramMb + freeVramMb)`).
 * - Allocatable denominator (`totalVramMb - reservedVramMb`): Peak utilisation is evaluated
 *   against the allocatable pool (`peakVramMb / (totalVramMb - reservedVramMb)`), explicitly
 *   distinguishing it from the nameplate total VRAM.
 * - `postUnloadUsedVramMb` / `postUnloadFreeVramMb`: Post-unload settle memory values relative
 *   to the allocatable pool.
 */
export const CertificationTelemetryDataSchema = z.object({
  sampleIntervalMs: z.literal(200),
  samples: z.array(CertificationTelemetrySampleSchema),
  samplingErrors: z.array(CertificationSamplingErrorSchema),
  peakVramMb: z.number().int().nonnegative().nullable(),
  reservedVramMb: z.number().int().nonnegative().nullable(),
  peakHostRamUsedMb: z.number().int().nonnegative().nullable(),
  peakProcessRssMb: z.number().int().nonnegative().nullable(),
  swapUsedDeltaMb: z.number().int().nonnegative().nullable(),
  systemSwapInPageDelta: z.number().int().nonnegative().nullable(),
  systemSwapOutPageDelta: z.number().int().nonnegative().nullable(),
  systemMajorPageFaultDelta: z.number().int().nonnegative().nullable(),
  systemMinorPageFaultDelta: z.number().int().nonnegative().nullable(),
  processMajorPageFaultDelta: z.number().int().nonnegative().nullable(),
  processMinorPageFaultDelta: z.number().int().nonnegative().nullable(),
  postUnloadUsedVramMb: z.number().int().nonnegative().nullable(),
  postUnloadFreeVramMb: z.number().int().nonnegative().nullable()
});
export type CertificationTelemetryData = z.infer<typeof CertificationTelemetryDataSchema>;

export const LtxCertificationArtifactBaseSchema = z.object({
  version: z.literal(1),
  runId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Must be a valid lowercase path-safe run ID"),
  generatedAt: z.string().datetime(),
  status: z.enum(["passed", "failed"]),
  runnerMode: z.enum(["dynamicvram", "highvram"]),
  identity: CertificationWorkloadIdentitySchema,
  environment: CertificationEnvironmentSchema,
  render: CertificationRenderExecutionSchema,
  telemetry: CertificationTelemetryDataSchema,
  gate: CertificationGateSchema,
  failure: CertificationFailureSchema.nullable()
});

export const LtxCertificationArtifactSchema = LtxCertificationArtifactBaseSchema.superRefine(
  (val, ctx) => {
    if (val.status === "passed") {
      if (val.failure !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have failure: null",
          path: ["failure"]
        });
      }

      if (val.render.status !== "succeeded") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have render.status: 'succeeded'",
          path: ["render", "status"]
        });
      }

      if (val.render.executionId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have a non-null render.executionId",
          path: ["render", "executionId"]
        });
      }

      if (val.render.startedAt === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have a non-null render.startedAt",
          path: ["render", "startedAt"]
        });
      }

      if (val.render.completedAt === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have a non-null render.completedAt",
          path: ["render", "completedAt"]
        });
      }

      if (val.render.totalDurationMs === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have a non-null render.totalDurationMs",
          path: ["render", "totalDurationMs"]
        });
      }

      if (!val.gate.passed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.passed: true",
          path: ["gate", "passed"]
        });
      }

      if (!val.gate.checks.renderSuccess) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.checks.renderSuccess: true",
          path: ["gate", "checks", "renderSuccess"]
        });
      }

      if (!val.gate.checks.noOom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.checks.noOom: true",
          path: ["gate", "checks", "noOom"]
        });
      }

      if (!val.gate.checks.durationWithinLimit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.checks.durationWithinLimit: true",
          path: ["gate", "checks", "durationWithinLimit"]
        });
      }

      if (!val.gate.checks.telemetryComplete) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.checks.telemetryComplete: true",
          path: ["gate", "checks", "telemetryComplete"]
        });
      }

      if (!val.gate.checks.postUnloadHeadroomObserved) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.checks.postUnloadHeadroomObserved: true",
          path: ["gate", "checks", "postUnloadHeadroomObserved"]
        });
      }

      if (val.telemetry.samples.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must contain telemetry samples",
          path: ["telemetry", "samples"]
        });
      }

      const hasPostUnload = val.telemetry.samples.some((s) => s.phase === "post_unload");
      if (!hasPostUnload) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must contain at least one post_unload telemetry sample",
          path: ["telemetry", "samples"]
        });
      }

      if (val.telemetry.samplingErrors.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have no sampling errors",
          path: ["telemetry", "samplingErrors"]
        });
      }

      const requiredTelemetryFields = [
        "peakVramMb",
        "reservedVramMb",
        "peakHostRamUsedMb",
        "peakProcessRssMb",
        "swapUsedDeltaMb",
        "systemSwapInPageDelta",
        "systemSwapOutPageDelta",
        "systemMajorPageFaultDelta",
        "systemMinorPageFaultDelta",
        "processMajorPageFaultDelta",
        "processMinorPageFaultDelta",
        "postUnloadUsedVramMb",
        "postUnloadFreeVramMb"
      ] as const;

      for (const field of requiredTelemetryFields) {
        if (val.telemetry[field] === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact must have non-null telemetry.${field}`,
            path: ["telemetry", field]
          });
        }
      }
    } else {
      if (val.failure === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Failed artifact must carry a structured failure object",
          path: ["failure"]
        });
      }

      if (val.gate.passed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Failed artifact must have gate.passed: false",
          path: ["gate", "passed"]
        });
      }
    }
  }
);

export type LtxCertificationArtifact = z.infer<typeof LtxCertificationArtifactBaseSchema>;
