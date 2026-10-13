import {
  MinimaxH3ComparisonReportSchema,
  computeInvariantProjectionKey,
  PINNED_H3_CHECKPOINTS,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3ComparisonReport,
  type MinimaxH3ComparisonPurpose,
  type MinimaxH3FactorChange,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2
} from "@cco/contracts";

export interface CompareMinimaxH3ExperimentsOptions {
  baselineDescriptor: MinimaxH3AnyExperimentDescriptor;
  baselineResult: MinimaxH3AnyExperimentResult;
  variantDescriptor: MinimaxH3AnyExperimentDescriptor;
  variantResult: MinimaxH3AnyExperimentResult;
  purpose?: MinimaxH3ComparisonPurpose;
}

export function compareMinimaxH3Experiments(
  options: CompareMinimaxH3ExperimentsOptions
): MinimaxH3ComparisonReport {
  const { baselineDescriptor, baselineResult, variantDescriptor, variantResult } = options;

  const purpose: MinimaxH3ComparisonPurpose =
    options.purpose ??
    (variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).experimentVariant?.purpose ??
    "performance";

  const declaredFactorChanges: MinimaxH3FactorChange[] =
    (variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).experimentVariant
      ?.changedFactors ?? [];
  const declaredPaths = declaredFactorChanges.map((f) => f.path);

  const admissionReasons: string[] = [];
  const operationalDifferences: Array<{
    field: string;
    baselineValue: string;
    variantValue: string;
  }> = [];

  // Check invariants
  if (baselineDescriptor.route !== variantDescriptor.route) {
    admissionReasons.push(
      `Route mismatch: baseline is "${baselineDescriptor.route}", variant is "${variantDescriptor.route}"`
    );
    operationalDifferences.push({
      field: "route",
      baselineValue: baselineDescriptor.route,
      variantValue: variantDescriptor.route
    });
  }

  if (baselineDescriptor.configuredFrames !== variantDescriptor.configuredFrames) {
    admissionReasons.push(
      `Frame count mismatch: baseline is ${baselineDescriptor.configuredFrames}, variant is ${variantDescriptor.configuredFrames}`
    );
    operationalDifferences.push({
      field: "configuredFrames",
      baselineValue: String(baselineDescriptor.configuredFrames),
      variantValue: String(variantDescriptor.configuredFrames)
    });
  }

  if (
    baselineDescriptor.width !== variantDescriptor.width ||
    baselineDescriptor.height !== variantDescriptor.height
  ) {
    admissionReasons.push(
      `Geometry mismatch: baseline is ${baselineDescriptor.width}x${baselineDescriptor.height}, variant is ${variantDescriptor.width}x${variantDescriptor.height}`
    );
    operationalDifferences.push({
      field: "geometry",
      baselineValue: `${baselineDescriptor.width}x${baselineDescriptor.height}`,
      variantValue: `${variantDescriptor.width}x${variantDescriptor.height}`
    });
  }

  if (baselineDescriptor.fps !== variantDescriptor.fps) {
    admissionReasons.push(
      `FPS mismatch: baseline is ${baselineDescriptor.fps}, variant is ${variantDescriptor.fps}`
    );
    operationalDifferences.push({
      field: "fps",
      baselineValue: String(baselineDescriptor.fps),
      variantValue: String(variantDescriptor.fps)
    });
  }

  if (baselineDescriptor.seed !== variantDescriptor.seed) {
    admissionReasons.push(
      `Seed mismatch: baseline is ${baselineDescriptor.seed}, variant is ${variantDescriptor.seed}`
    );
    operationalDifferences.push({
      field: "seed",
      baselineValue: String(baselineDescriptor.seed),
      variantValue: String(variantDescriptor.seed)
    });
  }

  if (
    baselineDescriptor.requestedRunner.variantName !== variantDescriptor.requestedRunner.variantName
  ) {
    admissionReasons.push(
      `Runner variant mismatch: baseline is "${baselineDescriptor.requestedRunner.variantName}", variant is "${variantDescriptor.requestedRunner.variantName}"`
    );
    operationalDifferences.push({
      field: "runnerVariant",
      baselineValue: baselineDescriptor.requestedRunner.variantName,
      variantValue: variantDescriptor.requestedRunner.variantName
    });
  }

  if (
    baselineDescriptor.requestedRunner.memoryPolicy !==
    variantDescriptor.requestedRunner.memoryPolicy
  ) {
    if (!declaredPaths.includes("memory.offload")) {
      admissionReasons.push(
        `Memory policy mismatch without declared variation: baseline is "${baselineDescriptor.requestedRunner.memoryPolicy}", variant is "${variantDescriptor.requestedRunner.memoryPolicy}"`
      );
    }
    operationalDifferences.push({
      field: "memoryPolicy",
      baselineValue: baselineDescriptor.requestedRunner.memoryPolicy,
      variantValue: variantDescriptor.requestedRunner.memoryPolicy
    });
  }

  if (baselineDescriptor.prompt !== variantDescriptor.prompt) {
    operationalDifferences.push({
      field: "prompt",
      baselineValue: baselineDescriptor.prompt,
      variantValue: variantDescriptor.prompt
    });
    const isDeclaredPromptChange =
      declaredPaths.includes("conditioning.positivePrompt") || purpose === "prompt_conditioning";
    if (!isDeclaredPromptChange) {
      admissionReasons.push(
        "Prompt differs without declared conditioning.positivePrompt variation or prompt_conditioning purpose."
      );
    }
  }

  // Calculate invariant projection key for pair admission
  const baselineKey = computeInvariantProjectionKey({
    route: baselineDescriptor.route,
    frames: baselineDescriptor.configuredFrames,
    width: baselineDescriptor.width,
    height: baselineDescriptor.height,
    fps: baselineDescriptor.fps,
    seed: baselineDescriptor.seed,
    baseProfileKey: baselineDescriptor.baseProfileKey,
    declaredPaths,
    positivePromptText: baselineDescriptor.prompt,
    references: baselineDescriptor.references,
    diffusionModelFileHash:
      (baselineDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).provenance
        ?.actualCheckpointHash ?? PINNED_H3_CHECKPOINTS.ref2va.sha256,
    samplerSettings: (baselineDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).provenance
      ?.samplerSettings ?? { sampler: "res_multistep", scheduler: "simple", steps: 20 },
    memoryPolicy: baselineDescriptor.requestedRunner.memoryPolicy
  });

  const variantKey = computeInvariantProjectionKey({
    route: variantDescriptor.route,
    frames: variantDescriptor.configuredFrames,
    width: variantDescriptor.width,
    height: variantDescriptor.height,
    fps: variantDescriptor.fps,
    seed: variantDescriptor.seed,
    baseProfileKey: variantDescriptor.baseProfileKey,
    declaredPaths,
    positivePromptText: variantDescriptor.prompt,
    references: variantDescriptor.references,
    diffusionModelFileHash:
      (variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).provenance
        ?.actualCheckpointHash ?? PINNED_H3_CHECKPOINTS.ref2va.sha256,
    samplerSettings: (variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).provenance
      ?.samplerSettings ?? { sampler: "res_multistep", scheduler: "simple", steps: 20 },
    memoryPolicy: variantDescriptor.requestedRunner.memoryPolicy
  });

  if (baselineKey !== variantKey) {
    admissionReasons.push(
      "Invariant projection keys do not match across controlled baseline and variant."
    );
  }

  // Runtime compatibility verification (Witness F2)
  const baselineProv = (baselineResult as Partial<MinimaxH3ExperimentResultV2>).observedProvenance;
  const variantProv = (variantResult as Partial<MinimaxH3ExperimentResultV2>).observedProvenance;
  if (variantProv && variantProv.conflicts && variantProv.conflicts.length > 0) {
    admissionReasons.push(
      `Variant runtime has unresolved conflicts: ${variantProv.conflicts.join("; ")}`
    );
  }
  if (baselineProv && baselineProv.conflicts && baselineProv.conflicts.length > 0) {
    admissionReasons.push(
      `Baseline runtime has unresolved conflicts: ${baselineProv.conflicts.join("; ")}`
    );
  }

  const isEligible = admissionReasons.length === 0;

  // Metric eligibility (KTD5, KTD5a - Witness F1)
  const metricReasons: string[] = [];
  const baselineExecuted = baselineResult.execution.status === "completed";
  const variantExecuted = variantResult.execution.status === "completed";

  if (!baselineExecuted) {
    metricReasons.push(
      `Baseline did not complete successfully (status: "${baselineResult.execution.status}").`
    );
  }
  if (!variantExecuted) {
    metricReasons.push(
      `Variant did not complete successfully (status: "${variantResult.execution.status}").`
    );
  }

  const wallTimeEligible = isEligible && baselineExecuted && variantExecuted;
  let samplingWallEligible = false;
  let kernelTimeEligible = false;

  const baselinePhase = (baselineResult as Partial<MinimaxH3ExperimentResultV2>).phaseAccounting;
  const variantPhase = (variantResult as Partial<MinimaxH3ExperimentResultV2>).phaseAccounting;

  if (wallTimeEligible) {
    if (
      baselinePhase?.samplingWallTimeMs !== null &&
      baselinePhase?.samplingWallTimeMs !== undefined &&
      variantPhase?.samplingWallTimeMs !== null &&
      variantPhase?.samplingWallTimeMs !== undefined
    ) {
      samplingWallEligible = true;
    } else {
      metricReasons.push("Sampling phase wall time was not measured in one or both runs.");
    }

    if (
      baselinePhase?.gpuKernelTimeMs !== null &&
      baselinePhase?.gpuKernelTimeMs !== undefined &&
      variantPhase?.gpuKernelTimeMs !== null &&
      variantPhase?.gpuKernelTimeMs !== undefined
    ) {
      kernelTimeEligible = true;
    } else {
      metricReasons.push(
        "GPU kernel profiling time was not recorded (profiler inactive or unsupported)."
      );
    }

    if (purpose === "prompt_conditioning") {
      metricReasons.push(
        "Prompt-conditioning variation: duration and sampling timings are valid_comparable; exact output hash and token counts are non_comparable."
      );
    }
  }

  // Calculate metric values
  let metrics: MinimaxH3ComparisonReport["metrics"] = null;
  if (isEligible && (wallTimeEligible || samplingWallEligible)) {
    const baselineWallMs =
      baselineResult.execution.latencyMs ?? baselinePhase?.wholeAttemptWallMs ?? null;
    const variantWallMs =
      variantResult.execution.latencyMs ?? variantPhase?.wholeAttemptWallMs ?? null;
    const wallRatio =
      baselineWallMs !== null && variantWallMs !== null && baselineWallMs > 0
        ? Number((variantWallMs / baselineWallMs).toFixed(4))
        : null;

    const baselineSamplingMs = baselinePhase?.samplingWallTimeMs ?? null;
    const variantSamplingMs = variantPhase?.samplingWallTimeMs ?? null;
    const samplingRatio =
      baselineSamplingMs !== null && variantSamplingMs !== null && baselineSamplingMs > 0
        ? Number((variantSamplingMs / baselineSamplingMs).toFixed(4))
        : null;

    const baselineKernelMs = baselinePhase?.gpuKernelTimeMs ?? null;
    const variantKernelMs = variantPhase?.gpuKernelTimeMs ?? null;
    const kernelRatio =
      baselineKernelMs !== null && variantKernelMs !== null && baselineKernelMs > 0
        ? Number((variantKernelMs / baselineKernelMs).toFixed(4))
        : null;

    metrics = {
      baselineWallTimeMs: baselineWallMs,
      variantWallTimeMs: variantWallMs,
      wallTimeRatio: wallRatio,
      baselineSamplingWallTimeMs: baselineSamplingMs,
      variantSamplingWallTimeMs: variantSamplingMs,
      samplingWallTimeRatio: samplingRatio,
      baselineGpuKernelTimeMs: baselineKernelMs,
      variantGpuKernelTimeMs: variantKernelMs,
      gpuKernelTimeRatio: kernelRatio
    };
  }

  const baselineConformant = baselineResult.outputConformance.status === "conformant";
  const variantConformant = variantResult.outputConformance.status === "conformant";

  const baselineReviewed = baselineResult.visualReview.status === "reviewed";
  const variantReviewed = variantResult.visualReview.status === "reviewed";

  const report: MinimaxH3ComparisonReport = {
    schemaVersion: 2,
    purpose,
    baselineRunId: baselineDescriptor.runId,
    variantRunId: variantDescriptor.runId,
    baselineDescriptorDigest:
      baselineDescriptor.descriptorDigest ??
      "0000000000000000000000000000000000000000000000000000000000000000",
    variantDescriptorDigest:
      variantDescriptor.descriptorDigest ??
      "0000000000000000000000000000000000000000000000000000000000000000",
    structuralAdmission: {
      eligible: isEligible,
      reasons: admissionReasons,
      invariantProjectionKey: isEligible ? baselineKey : null
    },
    metricEligibility: {
      wallTimeEligible,
      samplingWallEligible,
      kernelTimeEligible,
      reasons: metricReasons
    },
    normalizedOperationalDifferences: operationalDifferences,
    factorDifferences: declaredFactorChanges,
    metrics,
    mediaConformance: {
      baselineConformant,
      variantConformant
    },
    operatorEvaluation: {
      reviewed: baselineReviewed && variantReviewed,
      notes: null
    }
  };

  return MinimaxH3ComparisonReportSchema.parse(report);
}
