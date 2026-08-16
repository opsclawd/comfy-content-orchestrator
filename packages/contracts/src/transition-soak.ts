import { z } from "zod";
import {
  CertificationEnvironmentSchema,
  CertificationFailureSchema,
  CertificationRenderExecutionSchema,
  CertificationTelemetryDataSchema,
  CustomNodeIdentitySchema
} from "./ltx-certification.js";

export {
  type CertificationEnvironment,
  type CertificationFailure,
  type CertificationRenderExecution,
  type CertificationTelemetryData,
  type CustomNodeIdentity
} from "./ltx-certification.js";

const sha256HashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase 64-character hexadecimal SHA-256 hash");

const gitCommitHashSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/,
    "Must be a valid Git commit hash (40 or 64 lowercase hex characters)"
  );

export const TransitionFamilySchema = z.enum(["flux", "ltx"]);
export type TransitionFamily = z.infer<typeof TransitionFamilySchema>;

export const TransitionSoakThresholdsSchema = z.object({
  minPostUnloadFreeVramMb: z.number().int().nonnegative(),
  minHostAvailableMb: z.number().int().nonnegative(),
  maxVramGrowthMb: z.number().int().nonnegative(),
  maxHostGrowthMb: z.number().int().nonnegative(),
  maxLatencyDegradationPercent: z.number().nonnegative().finite(),
  cleanupTimeoutMs: z.number().int().positive(),
  cleanupPollIntervalMs: z.number().int().positive()
});
export type TransitionSoakThresholds = z.infer<typeof TransitionSoakThresholdsSchema>;

export const TransitionFamilyBaselineSchema = z.object({
  profileId: z.string().min(1),
  baselineDurationMs: z.number().int().positive(),
  peakVramMb: z.number().int().positive(),
  peakHostRamUsedMb: z.number().int().positive(),
  peakProcessRssMb: z.number().int().positive(),
  postUnloadFreeVramMb: z.number().int().positive()
});
export type TransitionFamilyBaseline = z.infer<typeof TransitionFamilyBaselineSchema>;

export const TransitionWorkloadIdentitySchema = z.object({
  profileId: z.string().min(1),
  engine: z.string().min(1),
  renderProfileKey: z.string().min(1).nullable(),
  renderProfileVersion: z.number().int().positive().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  frames: z.number().int().positive(),
  steps: z.number().int().positive(),
  workflowSha256: sha256HashSchema,
  modelSha256: z.record(z.string().min(1), sha256HashSchema),
  comfyUiCommit: gitCommitHashSchema,
  customNodes: z.array(CustomNodeIdentitySchema),
  measuredDiskFootprintGb: z.number().positive().finite(),
  minFreeDiskGb: z.number().nonnegative().finite()
});
export type TransitionWorkloadIdentity = z.infer<typeof TransitionWorkloadIdentitySchema>;

export const TransitionSoakCleanupSchema = z.object({
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  postUnloadFreeVramMb: z.number().int().nonnegative().nullable(),
  passed: z.boolean()
});
export type TransitionSoakCleanup = z.infer<typeof TransitionSoakCleanupSchema>;

export const TransitionSoakIterationSchema = z.object({
  renderIndex: z.number().int().nonnegative(),
  transitionIndex: z.number().int().positive().nullable(),
  fromFamily: TransitionFamilySchema.nullable(),
  family: TransitionFamilySchema,
  render: CertificationRenderExecutionSchema,
  telemetry: CertificationTelemetryDataSchema,
  cleanup: TransitionSoakCleanupSchema,
  oomDetected: z.boolean(),
  comfyUiRestarted: z.boolean(),
  failure: CertificationFailureSchema.nullable()
});
export type TransitionSoakIteration = z.infer<typeof TransitionSoakIterationSchema>;

export const TransitionSoakAggregatesSchema = z.object({
  peakVramMb: z.number().int().nonnegative().nullable(),
  peakHostRamUsedMb: z.number().int().nonnegative().nullable(),
  peakProcessRssMb: z.number().int().nonnegative().nullable(),
  swapUsedDeltaMb: z.number().int().nullable(),
  systemSwapInPageDelta: z.number().int().nullable(),
  systemSwapOutPageDelta: z.number().int().nullable(),
  systemMajorPageFaultDelta: z.number().int().nullable(),
  systemMinorPageFaultDelta: z.number().int().nullable(),
  processMajorPageFaultDelta: z.number().int().nullable(),
  processMinorPageFaultDelta: z.number().int().nullable(),
  renderFailureCount: z.number().int().nonnegative(),
  cleanupFailureCount: z.number().int().nonnegative(),
  samplingErrorCount: z.number().int().nonnegative(),
  oomCount: z.number().int().nonnegative(),
  unexpectedRestartCount: z.number().int().nonnegative(),
  sameFamilyPeakVramGrowthMb: z.object({
    flux: z.number().int().nullable(),
    ltx: z.number().int().nullable()
  }),
  sameFamilyPeakHostRamGrowthMb: z.object({
    flux: z.number().int().nullable(),
    ltx: z.number().int().nullable()
  }),
  sameFamilyPeakProcessRssGrowthMb: z.object({
    flux: z.number().int().nullable(),
    ltx: z.number().int().nullable()
  }),
  postUnloadUsedVramGrowthMb: z.number().int().nullable(),
  postUnloadHostRamGrowthMb: z.number().int().nullable(),
  postUnloadProcessRssGrowthMb: z.number().int().nullable(),
  latencyDegradationPercent: z.object({
    flux: z.number().finite().nullable(),
    ltx: z.number().finite().nullable()
  })
});
export type TransitionSoakAggregates = z.infer<typeof TransitionSoakAggregatesSchema>;

export const TransitionSoakGateChecksSchema = z.object({
  completedRequiredTransitions: z.boolean(),
  allRendersSuccessful: z.boolean(),
  allCleanupsSuccessful: z.boolean(),
  noOom: z.boolean(),
  noUnexpectedRestarts: z.boolean(),
  noSamplingErrors: z.boolean(),
  noSwapActivity: z.boolean(),
  postUnloadVramHeadroomMet: z.boolean(),
  hostMemoryHeadroomMet: z.boolean(),
  vramGrowthWithinTolerance: z.boolean(),
  hostGrowthWithinTolerance: z.boolean(),
  latencyWithinTolerance: z.boolean()
});
export type TransitionSoakGateChecks = z.infer<typeof TransitionSoakGateChecksSchema>;

export const TransitionSoakGateSchema = z.object({
  passed: z.boolean(),
  checks: TransitionSoakGateChecksSchema
});
export type TransitionSoakGate = z.infer<typeof TransitionSoakGateSchema>;

export const TransitionSoakArtifactBaseSchema = z.object({
  version: z.literal(1),
  runId: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "Must be a valid lowercase path-safe run ID"),
  generatedAt: z.string().datetime(),
  status: z.enum(["passed", "failed"]),
  runnerProfile: z.string().min(1),
  requestedTransitionCount: z.number().int().min(10),
  completedTransitionCount: z.number().int().nonnegative(),
  thresholds: TransitionSoakThresholdsSchema,
  baselines: z.object({
    flux: TransitionFamilyBaselineSchema,
    ltx: TransitionFamilyBaselineSchema
  }),
  identities: z.object({
    flux: TransitionWorkloadIdentitySchema,
    ltx: TransitionWorkloadIdentitySchema
  }),
  environment: CertificationEnvironmentSchema,
  iterations: z.array(TransitionSoakIterationSchema),
  aggregates: TransitionSoakAggregatesSchema,
  gate: TransitionSoakGateSchema,
  hostRamDecision: z.enum(["support_32gb", "require_64gb"]),
  selectedRunnerProfile: z.string().min(1).nullable(),
  failure: CertificationFailureSchema.nullable()
});

export const TransitionSoakArtifactSchema = TransitionSoakArtifactBaseSchema.superRefine(
  (val, ctx) => {
    // 1. Strict Alternation and Indexing Verification
    for (let i = 0; i < val.iterations.length; i++) {
      const iteration = val.iterations[i];
      if (!iteration) {
        continue;
      }
      if (iteration.renderIndex !== i) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Iteration at index ${i} must have renderIndex: ${i}`,
          path: ["iterations", i, "renderIndex"]
        });
      }

      if (i === 0) {
        if (iteration.transitionIndex !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Initial iteration must have transitionIndex: null",
            path: ["iterations", 0, "transitionIndex"]
          });
        }
        if (iteration.fromFamily !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Initial iteration must have fromFamily: null",
            path: ["iterations", 0, "fromFamily"]
          });
        }
        if (iteration.family !== "flux") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Initial iteration must have family: 'flux'",
            path: ["iterations", 0, "family"]
          });
        }
      } else {
        if (iteration.transitionIndex !== i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Transition iteration at index ${i} must have transitionIndex: ${i}`,
            path: ["iterations", i, "transitionIndex"]
          });
        }
        const expectedFromFamily = i % 2 === 1 ? "flux" : "ltx";
        const expectedFamily = i % 2 === 1 ? "ltx" : "flux";
        if (iteration.fromFamily !== expectedFromFamily) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Iteration at index ${i} must have fromFamily: '${expectedFromFamily}'`,
            path: ["iterations", i, "fromFamily"]
          });
        }
        if (iteration.family !== expectedFamily) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Iteration at index ${i} must have family: '${expectedFamily}'`,
            path: ["iterations", i, "family"]
          });
        }
      }
    }

    // 2. Passed Artifact Invariants
    if (val.status === "passed") {
      if (val.failure !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have failure: null",
          path: ["failure"]
        });
      }

      if (val.selectedRunnerProfile !== val.runnerProfile) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Passed artifact must have selectedRunnerProfile matching runnerProfile ('${val.runnerProfile}')`,
          path: ["selectedRunnerProfile"]
        });
      }

      if (val.completedTransitionCount !== val.requestedTransitionCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Passed artifact must have completedTransitionCount (${val.completedTransitionCount}) equal to requestedTransitionCount (${val.requestedTransitionCount})`,
          path: ["completedTransitionCount"]
        });
      }

      const expectedIterationCount = val.requestedTransitionCount + 1;
      if (val.iterations.length !== expectedIterationCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Passed artifact must contain exactly ${expectedIterationCount} iterations (${val.requestedTransitionCount} transitions + 1 initial render)`,
          path: ["iterations"]
        });
      }

      if (!val.gate.passed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have gate.passed: true",
          path: ["gate", "passed"]
        });
      }

      const gateCheckKeys = [
        "completedRequiredTransitions",
        "allRendersSuccessful",
        "allCleanupsSuccessful",
        "noOom",
        "noUnexpectedRestarts",
        "noSamplingErrors",
        "noSwapActivity",
        "postUnloadVramHeadroomMet",
        "hostMemoryHeadroomMet",
        "vramGrowthWithinTolerance",
        "hostGrowthWithinTolerance",
        "latencyWithinTolerance"
      ] as const;

      for (const check of gateCheckKeys) {
        if (!val.gate.checks[check]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact must have gate.checks.${check}: true`,
            path: ["gate", "checks", check]
          });
        }
      }

      if (val.aggregates.renderFailureCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have aggregates.renderFailureCount: 0",
          path: ["aggregates", "renderFailureCount"]
        });
      }

      if (val.aggregates.cleanupFailureCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have aggregates.cleanupFailureCount: 0",
          path: ["aggregates", "cleanupFailureCount"]
        });
      }

      if (val.aggregates.samplingErrorCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have aggregates.samplingErrorCount: 0",
          path: ["aggregates", "samplingErrorCount"]
        });
      }

      if (val.aggregates.oomCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have aggregates.oomCount: 0",
          path: ["aggregates", "oomCount"]
        });
      }

      if (val.aggregates.unexpectedRestartCount !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Passed artifact must have aggregates.unexpectedRestartCount: 0",
          path: ["aggregates", "unexpectedRestartCount"]
        });
      }

      const requiredAggregateFields = [
        "peakVramMb",
        "peakHostRamUsedMb",
        "peakProcessRssMb",
        "swapUsedDeltaMb",
        "systemSwapInPageDelta",
        "systemSwapOutPageDelta",
        "systemMajorPageFaultDelta",
        "systemMinorPageFaultDelta",
        "processMajorPageFaultDelta",
        "processMinorPageFaultDelta",
        "postUnloadUsedVramGrowthMb",
        "postUnloadHostRamGrowthMb",
        "postUnloadProcessRssGrowthMb"
      ] as const;

      for (const field of requiredAggregateFields) {
        if (val.aggregates[field] === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact must have non-null aggregates.${field}`,
            path: ["aggregates", field]
          });
        }
      }

      if (
        val.aggregates.sameFamilyPeakVramGrowthMb.flux === null ||
        val.aggregates.sameFamilyPeakVramGrowthMb.ltx === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Passed artifact must have non-null aggregates.sameFamilyPeakVramGrowthMb for both families",
          path: ["aggregates", "sameFamilyPeakVramGrowthMb"]
        });
      }

      if (
        val.aggregates.sameFamilyPeakHostRamGrowthMb.flux === null ||
        val.aggregates.sameFamilyPeakHostRamGrowthMb.ltx === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Passed artifact must have non-null aggregates.sameFamilyPeakHostRamGrowthMb for both families",
          path: ["aggregates", "sameFamilyPeakHostRamGrowthMb"]
        });
      }

      if (
        val.aggregates.sameFamilyPeakProcessRssGrowthMb.flux === null ||
        val.aggregates.sameFamilyPeakProcessRssGrowthMb.ltx === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Passed artifact must have non-null aggregates.sameFamilyPeakProcessRssGrowthMb for both families",
          path: ["aggregates", "sameFamilyPeakProcessRssGrowthMb"]
        });
      }

      if (
        val.aggregates.latencyDegradationPercent.flux === null ||
        val.aggregates.latencyDegradationPercent.ltx === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Passed artifact must have non-null aggregates.latencyDegradationPercent for both families",
          path: ["aggregates", "latencyDegradationPercent"]
        });
      }

      // Check per-iteration completeness on pass
      for (let i = 0; i < val.iterations.length; i++) {
        const iter = val.iterations[i];
        if (!iter) {
          continue;
        }
        if (iter.render.status !== "succeeded") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have render.status: 'succeeded'`,
            path: ["iterations", i, "render", "status"]
          });
        }
        if (iter.render.executionId === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have non-null render.executionId`,
            path: ["iterations", i, "render", "executionId"]
          });
        }
        if (iter.render.startedAt === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have non-null render.startedAt`,
            path: ["iterations", i, "render", "startedAt"]
          });
        }
        if (iter.render.completedAt === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have non-null render.completedAt`,
            path: ["iterations", i, "render", "completedAt"]
          });
        }
        if (iter.render.totalDurationMs === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have non-null render.totalDurationMs`,
            path: ["iterations", i, "render", "totalDurationMs"]
          });
        }
        if (!iter.cleanup.passed) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have cleanup.passed: true`,
            path: ["iterations", i, "cleanup", "passed"]
          });
        }
        if (iter.cleanup.postUnloadFreeVramMb === null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have non-null cleanup.postUnloadFreeVramMb`,
            path: ["iterations", i, "cleanup", "postUnloadFreeVramMb"]
          });
        }
        if (iter.oomDetected) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have oomDetected: false`,
            path: ["iterations", i, "oomDetected"]
          });
        }
        if (iter.comfyUiRestarted) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have comfyUiRestarted: false`,
            path: ["iterations", i, "comfyUiRestarted"]
          });
        }
        if (iter.failure !== null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have failure: null`,
            path: ["iterations", i, "failure"]
          });
        }
        if (iter.telemetry.samples.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must contain telemetry samples`,
            path: ["iterations", i, "telemetry", "samples"]
          });
        }
        if (iter.telemetry.samplingErrors.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Passed artifact iteration ${i} must have no sampling errors`,
            path: ["iterations", i, "telemetry", "samplingErrors"]
          });
        }
        const requiredIterationTelemetry = [
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
        for (const field of requiredIterationTelemetry) {
          if (iter.telemetry[field] === null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Passed artifact iteration ${i} must have non-null telemetry.${field}`,
              path: ["iterations", i, "telemetry", field]
            });
          }
        }
      }
    } else {
      // 3. Failed Artifact Invariants
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

      if (val.selectedRunnerProfile !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Failed artifact must have selectedRunnerProfile: null",
          path: ["selectedRunnerProfile"]
        });
      }
    }
  }
);

export type TransitionSoakArtifact = z.infer<typeof TransitionSoakArtifactBaseSchema>;
