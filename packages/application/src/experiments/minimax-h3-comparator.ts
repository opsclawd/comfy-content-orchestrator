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

  // Attention variant pair admission checks
  const variantDescV2 = variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>;
  const baselineDescV2 = baselineDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>;
  if (baselineDescV2.attentionRequest && !variantDescV2.attentionRequest) {
    admissionReasons.push(
      "Baseline has an attentionRequest but variant does not. Attention comparisons require both descriptors to specify attention requests."
    );
  }
  if (variantDescV2.attentionRequest) {
    const varAttn = variantDescV2.attentionRequest.attentionVariant;
    if (varAttn !== "dense") {
      if (!baselineDescV2.attentionRequest) {
        admissionReasons.push(
          "Attention variant comparisons require an explicit dense baseline attentionRequest with matching runtime substrate."
        );
      } else {
        const baseAttn = baselineDescV2.attentionRequest.attentionVariant;
        if (baseAttn !== "dense") {
          admissionReasons.push(
            `Attention variant comparisons require an untouched dense baseline control. Baseline requested accelerated variant "${baseAttn}".`
          );
        }
        if (
          variantDescV2.attentionRequest.runtimeLockDigest !==
          baselineDescV2.attentionRequest.runtimeLockDigest
        ) {
          admissionReasons.push(
            `Runtime lock digest mismatch across attention comparison pair: baseline is "${baselineDescV2.attentionRequest.runtimeLockDigest}", variant is "${variantDescV2.attentionRequest.runtimeLockDigest}". Attention comparison requires identical runtime lock (matched dependency substrate).`
          );
        }
      }
      const baseCore = baselineDescV2.requiredRuntime?.coreRevision;
      const varCore = variantDescV2.requiredRuntime?.coreRevision;
      if (!baseCore || !varCore || baseCore !== varCore) {
        admissionReasons.push(
          `Core revision mismatch across attention comparison pair: baseline is "${baseCore}", variant is "${varCore}". Attention comparison requires identical core revision (matched dense substrate).`
        );
      }
    } else {
      // Both are dense control: require identical coreRevision and identical runtimeLockDigest
      if (
        baselineDescV2.attentionRequest &&
        baselineDescV2.attentionRequest.attentionVariant !== "dense"
      ) {
        admissionReasons.push(
          `Dense control comparison requires baseline to be dense. Baseline requested variant "${baselineDescV2.attentionRequest.attentionVariant}".`
        );
      }
      if (
        baselineDescV2.attentionRequest?.attentionVariant === "dense" &&
        variantDescV2.attentionRequest.runtimeLockDigest !==
          baselineDescV2.attentionRequest.runtimeLockDigest
      ) {
        admissionReasons.push(
          `Runtime lock digest mismatch across dense control pair: baseline is "${baselineDescV2.attentionRequest.runtimeLockDigest}", variant is "${variantDescV2.attentionRequest.runtimeLockDigest}".`
        );
      }
      if (
        baselineDescV2.requiredRuntime?.coreRevision &&
        variantDescV2.requiredRuntime?.coreRevision &&
        variantDescV2.requiredRuntime.coreRevision !== baselineDescV2.requiredRuntime.coreRevision
      ) {
        admissionReasons.push(
          `Core revision mismatch across dense control pair: baseline is "${baselineDescV2.requiredRuntime.coreRevision}", variant is "${variantDescV2.requiredRuntime.coreRevision}".`
        );
      }
    }
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

  let wallTimeEligible = isEligible && baselineExecuted && variantExecuted;
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

    // Attention variant verification
    if (variantDescV2.attentionRequest) {
      const varResV2 = variantResult as Partial<MinimaxH3ExperimentResultV2>;
      const obs = varResV2.attentionObservation;
      const expectedBackend = variantDescV2.attentionRequest.expectedBackend;
      const expectedKernel = variantDescV2.attentionRequest.expectedKernel;
      const isAccelerated = variantDescV2.attentionRequest.attentionVariant !== "dense";
      const baseResV2 = baselineResult as Partial<MinimaxH3ExperimentResultV2>;
      const baseObs = baseResV2.attentionObservation;
      let attentionValid = true;

      // Verify baseline attention observation
      if (!baseObs) {
        metricReasons.push(
          "Baseline result lacks attention observation evidence. A verified baseline execution is required for attention comparison."
        );
        attentionValid = false;
      } else if (baseObs.status !== "verified") {
        metricReasons.push(
          `Baseline dense control observation was not verified (status: "${baseObs.status}"). Speedup metrics disqualified.`
        );
        attentionValid = false;
      } else if (baseObs.denseCallCount === 0) {
        metricReasons.push(
          "Baseline observed 0 dense attention calls during sampling. Speedup metrics disqualified."
        );
        attentionValid = false;
      } else if (baseObs.fallbackEvents.length > 0) {
        metricReasons.push(
          `Baseline experienced attention fallback (${baseObs.fallbackEvents.length} event(s)). Speedup metrics disqualified.`
        );
        attentionValid = false;
      } else if (!baseObs.measurementCoverage?.complete) {
        metricReasons.push(
          "Baseline attention measurement coverage is incomplete. Speedup metrics disqualified."
        );
        attentionValid = false;
      }

      const baseExpectedBackend = baselineDescV2.attentionRequest?.expectedBackend ?? "torch_sdpa";
      const baseExpectedKernel =
        baselineDescV2.attentionRequest?.expectedKernel ??
        "torch.nn.functional.scaled_dot_product_attention";
      if (baseObs?.actualBackend && baseObs.actualBackend !== baseExpectedBackend) {
        metricReasons.push(
          `Baseline observed attention backend "${baseObs.actualBackend}" does not match expected "${baseExpectedBackend}". Speedup metrics disqualified.`
        );
        attentionValid = false;
      }
      if (
        baseObs?.dispatchImplementation &&
        baseObs.dispatchImplementation !== baseExpectedKernel
      ) {
        metricReasons.push(
          `Baseline observed dispatch implementation "${baseObs.dispatchImplementation}" does not match expected "${baseExpectedKernel}". Speedup metrics disqualified.`
        );
        attentionValid = false;
      }

      if (!obs) {
        metricReasons.push(
          "Variant result lacks verified attention observation evidence. Historical data or uninstrumented runs cannot support a speedup claim."
        );
        attentionValid = false;
      } else {
        if (obs.status !== "verified") {
          metricReasons.push(
            `Variant requested attention backend "${expectedBackend}" but observed status was "${obs.status}" (${obs.failureReason ?? "unverified"}). Speedup metrics disqualified.`
          );
          attentionValid = false;
        }
        if (obs.actualBackend && obs.actualBackend !== expectedBackend) {
          metricReasons.push(
            `Observed attention backend "${obs.actualBackend}" does not match requested expectedBackend "${expectedBackend}". Speedup metrics disqualified.`
          );
          attentionValid = false;
        }
        if (obs.dispatchImplementation && obs.dispatchImplementation !== expectedKernel) {
          metricReasons.push(
            `Observed dispatch implementation "${obs.dispatchImplementation}" does not match requested expectedKernel "${expectedKernel}". Speedup metrics disqualified.`
          );
          attentionValid = false;
        }
        if (isAccelerated && obs.status === "verified" && obs.acceleratedCallCount === 0) {
          metricReasons.push(
            `Variant observed 0 accelerated attention calls during sampling (undetected no-op). Speedup metrics disqualified.`
          );
          attentionValid = false;
        }
        if (obs.fallbackEvents.length > 0) {
          metricReasons.push(
            `Variant experienced attention fallback during attention dispatch (${obs.fallbackEvents.length} fallback event(s)). Speedup metrics disqualified.`
          );
          attentionValid = false;
        }
        if (obs.missingKernelFailure !== null && obs.missingKernelFailure !== undefined) {
          metricReasons.push(
            `Variant experienced missing kernel failure: ${obs.missingKernelFailure}. Speedup metrics disqualified.`
          );
          attentionValid = false;
        }
        if (!obs.measurementCoverage?.complete) {
          metricReasons.push(
            "Variant attention measurement coverage is incomplete. Speedup metrics disqualified."
          );
          attentionValid = false;
        }
      }

      if (!attentionValid) {
        wallTimeEligible = false;
        samplingWallEligible = false;
        kernelTimeEligible = false;
      }
    }
  }

  // Calculate metric values
  let metrics: MinimaxH3ComparisonReport["metrics"] = null;
  if (isEligible && (wallTimeEligible || samplingWallEligible || kernelTimeEligible)) {
    const baselineWallMs =
      baselineResult.execution.latencyMs ?? baselinePhase?.wholeAttemptWallMs ?? null;
    const variantWallMs =
      variantResult.execution.latencyMs ?? variantPhase?.wholeAttemptWallMs ?? null;
    const wallRatio =
      wallTimeEligible && baselineWallMs !== null && variantWallMs !== null && baselineWallMs > 0
        ? Number((variantWallMs / baselineWallMs).toFixed(4))
        : null;

    const baselineSamplingMs = baselinePhase?.samplingWallTimeMs ?? null;
    const variantSamplingMs = variantPhase?.samplingWallTimeMs ?? null;
    const samplingRatio =
      samplingWallEligible &&
      baselineSamplingMs !== null &&
      variantSamplingMs !== null &&
      baselineSamplingMs > 0
        ? Number((variantSamplingMs / baselineSamplingMs).toFixed(4))
        : null;

    const baselineKernelMs = baselinePhase?.gpuKernelTimeMs ?? null;
    const variantKernelMs = variantPhase?.gpuKernelTimeMs ?? null;
    const kernelRatio =
      kernelTimeEligible &&
      baselineKernelMs !== null &&
      variantKernelMs !== null &&
      baselineKernelMs > 0
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
