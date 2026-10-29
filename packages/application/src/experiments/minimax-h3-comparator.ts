import {
  MinimaxH3ComparisonReportSchema,
  computeInvariantProjectionKey,
  computeAttentionTopologyDigest,
  computeAttentionRuntimeLockDigest,
  computeTeaCacheTopologyDigest,
  TEACACHE_ADAPTER_VERSION,
  PINNED_H3_CHECKPOINTS,
  PINNED_COMFYUI_CORE_REVISION,
  type MinimaxH3AnyExperimentDescriptor,
  type MinimaxH3AnyExperimentResult,
  type MinimaxH3ComparisonReport,
  type MinimaxH3ComparisonPurpose,
  type MinimaxH3FactorChange,
  type MinimaxH3ExperimentDescriptorV2,
  type MinimaxH3ExperimentResultV2,
  type MinimaxH3AttentionObservation,
  type MinimaxH3TeaCacheObservation,
  type MinimaxH3TeaCacheMode,
  type MinimaxH3TeaCacheRequest,
  type MinimaxH3DenseRegionPolicy,
  type MinimaxH3ObservedProvenance
} from "@cco/contracts";

export interface CompareMinimaxH3ExperimentsOptions {
  baselineDescriptor: MinimaxH3AnyExperimentDescriptor;
  baselineResult: MinimaxH3AnyExperimentResult;
  variantDescriptor: MinimaxH3AnyExperimentDescriptor;
  variantResult: MinimaxH3AnyExperimentResult;
  purpose?: MinimaxH3ComparisonPurpose;
}

interface ObservationEligibilityEvaluation {
  valid: boolean;
  reasons: string[];
}

function evaluateAttentionObservationEligibility(params: {
  role: "Baseline" | "Variant";
  observation: MinimaxH3AttentionObservation | undefined | null;
  policy?: MinimaxH3DenseRegionPolicy | null | undefined;
  isDense: boolean;
  expectedBackend?: string | undefined;
  expectedKernel?: string | undefined;
}): ObservationEligibilityEvaluation {
  const { role, observation: obs, policy, isDense, expectedBackend, expectedKernel } = params;
  const reasons: string[] = [];

  if (!obs) {
    return {
      valid: false,
      reasons: [
        `${role} result lacks verified attention observation evidence. Historical data or uninstrumented runs cannot support a speedup claim.`
      ]
    };
  }

  if (obs.status !== "verified") {
    if (role === "Baseline" && isDense) {
      reasons.push(
        `Baseline dense control observation was not verified (status: "${obs.status}", failure: "${obs.failureReason ?? "unverified"}").`
      );
    } else {
      reasons.push(
        `${role} requested attention backend "${expectedBackend ?? "torch_sdpa"}" but observed status was "${obs.status}" (${obs.failureReason ?? "unverified"}).`
      );
    }
  }

  if (expectedBackend) {
    if (obs.actualBackend === null) {
      if (role === "Baseline") {
        reasons.push(
          `Baseline observed attention backend "null" does not match expected "${expectedBackend}".`
        );
      } else {
        reasons.push(
          `Observed attention backend "null" does not match requested expectedBackend "${expectedBackend}".`
        );
      }
    } else if (obs.actualBackend !== expectedBackend) {
      if (role === "Baseline") {
        reasons.push(
          `Baseline observed attention backend "${obs.actualBackend}" does not match expected "${expectedBackend}".`
        );
      } else {
        reasons.push(
          `Observed attention backend "${obs.actualBackend}" does not match requested expectedBackend "${expectedBackend}".`
        );
      }
    }
  } else if (obs.actualBackend === null) {
    reasons.push(`${role} observed attention backend "null" is unverified.`);
  }

  if (expectedKernel) {
    if (obs.dispatchImplementation === null) {
      if (role === "Baseline") {
        reasons.push(
          `Baseline observed dispatch implementation "null" does not match expected "${expectedKernel}".`
        );
      } else {
        reasons.push(
          `Observed dispatch implementation "null" does not match requested expectedKernel "${expectedKernel}".`
        );
      }
    } else if (obs.dispatchImplementation !== expectedKernel) {
      if (role === "Baseline") {
        reasons.push(
          `Baseline observed dispatch implementation "${obs.dispatchImplementation}" does not match expected "${expectedKernel}".`
        );
      } else {
        reasons.push(
          `Observed dispatch implementation "${obs.dispatchImplementation}" does not match requested expectedKernel "${expectedKernel}".`
        );
      }
    }
  } else if (obs.dispatchImplementation === null) {
    reasons.push(`${role} observed dispatch implementation "null" is unverified.`);
  }

  if (obs.fallbackEvents && obs.fallbackEvents.length > 0) {
    reasons.push(
      `${role} experienced attention fallback during attention dispatch (${obs.fallbackEvents.length} fallback event(s)).`
    );
  }

  if (obs.failureReason !== null && obs.failureReason !== undefined) {
    reasons.push(`${role} experienced attention failure: ${obs.failureReason}.`);
  }

  if (obs.missingKernelFailure !== null && obs.missingKernelFailure !== undefined) {
    reasons.push(`${role} experienced missing kernel failure: ${obs.missingKernelFailure}.`);
  }

  if (!obs.measurementCoverage?.complete) {
    reasons.push(`${role} attention measurement coverage is incomplete.`);
  }

  if (isDense) {
    // Dense run must observe positive dense calls and zero accelerated calls
    if (obs.denseCallCount === 0) {
      reasons.push(`${role} observed 0 dense calls. Dense run must observe positive dense calls.`);
    }
    if (obs.acceleratedCallCount > 0) {
      reasons.push(
        `${role} observed mixed accelerated execution (${obs.acceleratedCallCount} accelerated call(s)). Dense run must be pure.`
      );
    }
    if (obs.stepRecords?.some((s) => s.callType === "accelerated" || s.callType === "fallback")) {
      reasons.push(
        `${role} step records contain accelerated or fallback execution. Dense run must be pure.`
      );
    }
    if (obs.plannedDenseCallCount > 0 && (!policy || !policy.allowPlannedDense)) {
      reasons.push(
        `${role} observed ${obs.plannedDenseCallCount} planned dense calls, but denseRegionPolicy does not permit dense calls (allowPlannedDense is false).`
      );
    }
    if (
      policy &&
      policy.allowPlannedDense &&
      policy.minTokensThreshold !== undefined &&
      policy.minTokensThreshold > 0 &&
      obs.plannedDenseCallCount > 0
    ) {
      const plannedSteps = (obs.stepRecords ?? []).filter((s) => s.callType === "planned_dense");
      if (plannedSteps.length !== obs.plannedDenseCallCount) {
        reasons.push(
          `${role} planned dense dispatch count (${obs.plannedDenseCallCount}) does not match per-call token evidence (${plannedSteps.length} records).`
        );
      } else {
        for (const s of plannedSteps) {
          const tokens =
            typeof s.metadata?.tokens === "number"
              ? s.metadata.tokens
              : typeof s.metadata?.tokenCount === "number"
                ? s.metadata.tokenCount
                : null;
          if (tokens === null || tokens > policy.minTokensThreshold) {
            reasons.push(
              `${role} planned dense call at step ${s.stepIndex} has token count ${tokens ?? "unknown"} which does not satisfy minTokensThreshold (<= ${policy.minTokensThreshold}).`
            );
          }
        }
      }
    }
  } else {
    // Accelerated variant must execute accelerated kernel
    if (obs.acceleratedCallCount === 0) {
      reasons.push(
        `${role} observed 0 accelerated attention calls during sampling (undetected no-op).`
      );
    }

    // Unplanned dense calls are ALWAYS disqualified, regardless of allowPlannedDense!
    if (obs.denseCallCount > 0) {
      if (policy && !policy.allowPlannedDense) {
        reasons.push(
          `${role} observed ${obs.denseCallCount} dense calls, but denseRegionPolicy does not permit dense calls (allowPlannedDense is false).`
        );
      } else {
        reasons.push(`${role} observed unplanned dense calls (${obs.denseCallCount} unplanned).`);
      }
    }

    if (obs.stepRecords?.some((s) => s.callType === "dense" || s.callType === "fallback")) {
      reasons.push(`${role} step records contain unplanned dense or fallback execution.`);
    }

    // Planned dense calls check
    if (obs.plannedDenseCallCount > 0) {
      if (!policy || !policy.allowPlannedDense) {
        reasons.push(
          `${role} observed ${obs.plannedDenseCallCount} planned dense calls, but denseRegionPolicy does not permit dense calls (allowPlannedDense is false).`
        );
      } else if (policy.minTokensThreshold !== undefined && policy.minTokensThreshold > 0) {
        const plannedSteps = (obs.stepRecords ?? []).filter((s) => s.callType === "planned_dense");
        if (plannedSteps.length !== obs.plannedDenseCallCount) {
          reasons.push(
            `${role} planned dense dispatch count (${obs.plannedDenseCallCount}) does not match per-call token evidence (${plannedSteps.length} records).`
          );
        } else {
          for (const s of plannedSteps) {
            const tokens =
              typeof s.metadata?.tokens === "number"
                ? s.metadata.tokens
                : typeof s.metadata?.tokenCount === "number"
                  ? s.metadata.tokenCount
                  : null;
            if (tokens === null || tokens > policy.minTokensThreshold) {
              reasons.push(
                `${role} planned dense call at step ${s.stepIndex} has token count ${tokens ?? "unknown"} which does not satisfy minTokensThreshold (<= ${policy.minTokensThreshold}).`
              );
            }
          }
        }
      }
    }
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

function evaluateTeaCacheObservationEligibility(params: {
  role: "Baseline" | "Variant";
  observation: MinimaxH3TeaCacheObservation | undefined | null;
  mode: MinimaxH3TeaCacheMode;
  expectedRequest?: MinimaxH3TeaCacheRequest | null | undefined;
}): ObservationEligibilityEvaluation {
  const { role, observation: obs, mode, expectedRequest } = params;
  const reasons: string[] = [];

  if (!obs) {
    return {
      valid: false,
      reasons: [
        `${role} result lacks verified TeaCache observation evidence. Matched pair comparison requires instrumented telemetry on both runs.`
      ]
    };
  }

  if (mode === "off") {
    if (obs.mode !== "off") {
      reasons.push(`${role} expected caching mode "off" but observed "${obs.mode}".`);
    }
    if (obs.status !== "verified") {
      reasons.push(
        `${role} control observation status was "${obs.status}" (${obs.failureReason ?? "unverified"}).`
      );
    }
    if (obs.cacheHitsRecorded !== null && obs.cacheHitsRecorded > 0) {
      reasons.push(
        `${role} observed ${obs.cacheHitsRecorded} cache hits while caching was disabled.`
      );
    }
    if (!obs.coverage?.complete) {
      reasons.push(`${role} control measurement coverage is incomplete.`);
    }
    if (!obs.coverage || obs.coverage.modelForwardsRecorded === null) {
      reasons.push(`${role} control lacks recorded independent model forwards.`);
    }
    if (
      obs.coverage &&
      obs.coverage.modelForwardsRecorded !== null &&
      obs.forwardCallsRecorded !== null &&
      obs.coverage.modelForwardsRecorded !== obs.forwardCallsRecorded
    ) {
      reasons.push(
        `${role} control modelForwardsRecorded (${obs.coverage.modelForwardsRecorded}) !== forwardCallsRecorded (${obs.forwardCallsRecorded}).`
      );
    }
    if (obs.coverage && obs.coverage.modelForwardsRecorded !== 20) {
      reasons.push(
        `${role} control modelForwardsRecorded (${obs.coverage.modelForwardsRecorded}) !== 20.`
      );
    }
    return {
      valid: reasons.length === 0,
      reasons
    };
  }

  if (obs.forwardCallsRecorded === null || obs.cacheHitsRecorded === null) {
    reasons.push(`${role} TeaCache forwardCallsRecorded or cacheHitsRecorded is unobserved/null.`);
  }

  if (!obs.coverage || obs.coverage.modelForwardsRecorded === null) {
    reasons.push(`${role} lacks recorded independent model forwards.`);
  }

  if (obs.status === "failed") {
    reasons.push(`${role} TeaCache execution failed: ${obs.failureReason ?? "unknown failure"}.`);
  } else if (obs.status === "no_op") {
    reasons.push(
      `${role} TeaCache resulted in 0 cache hits (no_op). Timestep caching variant cannot claim speedup without actual cached skips.`
    );
  } else if (obs.status !== "verified") {
    reasons.push(
      `${role} TeaCache observation status was "${obs.status}" (${obs.failureReason ?? "unverified"}).`
    );
  }

  if (obs.cacheHitsRecorded !== null && obs.cacheHitsRecorded === 0) {
    reasons.push(
      `${role} observed 0 cache hits. Caching variant cannot claim speedup when no forward passes were skipped.`
    );
  }

  if ((obs.nestedForwardsOnHits ?? 0) > 0) {
    reasons.push(
      `${role} recorded ${obs.nestedForwardsOnHits} nested forward passes during cache hits. Forward pass was not skipped.`
    );
  }

  if (!obs.coverage?.complete) {
    reasons.push(`${role} TeaCache measurement coverage is incomplete.`);
  }

  if (
    obs.coverage &&
    obs.coverage.modelForwardsRecorded !== null &&
    obs.forwardCallsRecorded !== null &&
    obs.coverage.modelForwardsRecorded !== obs.forwardCallsRecorded
  ) {
    reasons.push(
      `${role} TeaCache independent model forwards (${obs.coverage.modelForwardsRecorded}) does not match wrapper forward calls (${obs.forwardCallsRecorded}).`
    );
  }

  if (
    obs.forwardCallsRecorded !== null &&
    obs.cacheHitsRecorded !== null &&
    obs.forwardCallsRecorded + obs.cacheHitsRecorded !== obs.totalSteps
  ) {
    reasons.push(
      `${role} TeaCache accounting invariant violated: forwards (${obs.forwardCallsRecorded}) + hits (${obs.cacheHitsRecorded}) !== totalSteps (${obs.totalSteps}).`
    );
  }

  if (expectedRequest && expectedRequest.mode === "raw-l1-v1") {
    if (!obs.effectiveConfig) {
      reasons.push(`${role} TeaCache effectiveConfig is missing or null.`);
    } else {
      if (obs.effectiveConfig.mode !== expectedRequest.mode) {
        reasons.push(
          `${role} observed effectiveConfig mode "${obs.effectiveConfig.mode}" !== expected "${expectedRequest.mode}".`
        );
      }
      if (obs.effectiveConfig.relL1Thresh !== expectedRequest.relL1Thresh) {
        reasons.push(
          `${role} observed effectiveConfig threshold ${obs.effectiveConfig.relL1Thresh} !== expected ${expectedRequest.relL1Thresh}.`
        );
      }
      if (obs.effectiveConfig.startStep !== expectedRequest.startStep) {
        reasons.push(
          `${role} observed effectiveConfig startStep ${obs.effectiveConfig.startStep} !== expected ${expectedRequest.startStep}.`
        );
      }
      // Both the raw and normalized windows must agree with the request.
      // Accepting either alone let an observed endStep that disagrees with
      // the request (e.g. endStep=10 vs requested endStep=-2) still pass
      // purely because the two sides' normalizedEndStep happened to match
      // (both 18) -- that is not proof it's the same window, since
      // endStep=10 does not resolve to 18 under the -2/totalSteps=20
      // normalization convention at all.
      if (
        obs.effectiveConfig.endStep !== expectedRequest.endStep ||
        obs.effectiveConfig.normalizedEndStep !== expectedRequest.normalizedEndStep
      ) {
        reasons.push(
          `${role} observed effectiveConfig endStep ${obs.effectiveConfig.endStep} (normalized ${obs.effectiveConfig.normalizedEndStep}) !== expected ${expectedRequest.endStep} (normalized ${expectedRequest.normalizedEndStep}).`
        );
      }
      if (obs.effectiveConfig.totalSteps !== expectedRequest.totalSteps) {
        reasons.push(
          `${role} observed effectiveConfig totalSteps ${obs.effectiveConfig.totalSteps} !== expected ${expectedRequest.totalSteps}.`
        );
      }
    }
  }

  return {
    valid: reasons.length === 0,
    reasons
  };
}

export function compareMinimaxH3Experiments(
  options: CompareMinimaxH3ExperimentsOptions
): MinimaxH3ComparisonReport {
  const { baselineDescriptor, baselineResult, variantDescriptor, variantResult } = options;

  const purpose: MinimaxH3ComparisonPurpose =
    options.purpose ??
    (variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>).experimentVariant?.purpose ??
    "performance";

  const baselineDescV2 = baselineDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>;
  const variantDescV2 = variantDescriptor as Partial<MinimaxH3ExperimentDescriptorV2>;

  const declaredFactorChanges: MinimaxH3FactorChange[] =
    variantDescV2.experimentVariant?.changedFactors ?? [];
  const declaredPaths = declaredFactorChanges.map((f) => f.path);

  if (
    variantDescV2.attentionRequest &&
    (!baselineDescV2.attentionRequest ||
      variantDescV2.attentionRequest.attentionVariant !==
        baselineDescV2.attentionRequest.attentionVariant) &&
    !declaredPaths.includes("attention.configuration")
  ) {
    declaredPaths.push("attention.configuration");
  }

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

  const baselineAuxiliary = baselineDescV2.samplingRecipe?.lora
    ? [
        {
          name: baselineDescV2.samplingRecipe.lora.filename,
          hash: baselineDescV2.samplingRecipe.lora.sha256,
          strength: baselineDescV2.samplingRecipe.lora.strengthModel,
          role: "lora",
          order: 0
        }
      ]
    : undefined;
  const baselineSigmaShift = baselineDescV2.samplingRecipe?.sigmaShift ?? undefined;
  const baselineAttentionDigest =
    baselineDescV2.attentionRequest?.topologyDigest ??
    baselineDescV2.samplingRecipe?.attentionTopology?.topologyDigest;

  const baselineRuntimeManifestDigest =
    baselineDescV2.compatibility?.relativeToRuntimeManifestDigest ??
    (variantDescV2.requiredRuntime?.coreRevision === PINNED_COMFYUI_CORE_REVISION ||
    variantDescV2.provenance?.comfyuiCoreRevision === PINNED_COMFYUI_CORE_REVISION
      ? variantDescV2.compatibility?.relativeToRuntimeManifestDigest
      : undefined);

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
      baselineDescV2.provenance?.actualCheckpointHash ?? PINNED_H3_CHECKPOINTS.ref2va.sha256,
    samplerSettings: baselineDescV2.provenance?.samplerSettings ?? {
      sampler: "res_multistep",
      scheduler: "simple",
      steps: 20
    },
    memoryPolicy: baselineDescriptor.requestedRunner.memoryPolicy,
    ...(baselineAuxiliary ? { auxiliaryModels: baselineAuxiliary } : {}),
    ...(baselineSigmaShift ? { sigmaShift: baselineSigmaShift } : {}),
    ...(baselineAttentionDigest ? { attentionTopologyDigest: baselineAttentionDigest } : {}),
    ...(baselineDescV2.teacacheRequest?.topologyDigest
      ? { teacacheTopologyDigest: baselineDescV2.teacacheRequest.topologyDigest }
      : {}),
    coreRevision:
      baselineDescV2.provenance?.comfyuiCoreRevision ??
      baselineDescV2.requiredRuntime?.coreRevision ??
      PINNED_COMFYUI_CORE_REVISION,
    ...(baselineRuntimeManifestDigest
      ? { runtimeManifestDigest: baselineRuntimeManifestDigest }
      : {})
  });

  const variantAuxiliary = variantDescV2.samplingRecipe?.lora
    ? [
        {
          name: variantDescV2.samplingRecipe.lora.filename,
          hash: variantDescV2.samplingRecipe.lora.sha256,
          strength: variantDescV2.samplingRecipe.lora.strengthModel,
          role: "lora",
          order: 0
        }
      ]
    : undefined;
  const variantSigmaShift = variantDescV2.samplingRecipe?.sigmaShift ?? undefined;
  const variantAttentionDigest =
    variantDescV2.attentionRequest?.topologyDigest ??
    variantDescV2.samplingRecipe?.attentionTopology?.topologyDigest;

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
      variantDescV2.provenance?.actualCheckpointHash ?? PINNED_H3_CHECKPOINTS.ref2va.sha256,
    samplerSettings: variantDescV2.provenance?.samplerSettings ?? {
      sampler: "res_multistep",
      scheduler: "simple",
      steps: 20
    },
    memoryPolicy: variantDescriptor.requestedRunner.memoryPolicy,
    ...(variantAuxiliary ? { auxiliaryModels: variantAuxiliary } : {}),
    ...(variantSigmaShift ? { sigmaShift: variantSigmaShift } : {}),
    ...(variantAttentionDigest ? { attentionTopologyDigest: variantAttentionDigest } : {}),
    ...(variantDescV2.teacacheRequest?.topologyDigest
      ? { teacacheTopologyDigest: variantDescV2.teacacheRequest.topologyDigest }
      : {}),
    coreRevision:
      variantDescV2.provenance?.comfyuiCoreRevision ??
      variantDescV2.requiredRuntime?.coreRevision ??
      PINNED_COMFYUI_CORE_REVISION,
    ...(variantDescV2.compatibility?.relativeToRuntimeManifestDigest
      ? { runtimeManifestDigest: variantDescV2.compatibility.relativeToRuntimeManifestDigest }
      : {})
  });

  if (baselineKey !== variantKey) {
    admissionReasons.push(
      "Invariant projection keys do not match across controlled baseline and variant."
    );
  }

  if (
    variantDescV2.teacacheRequest?.mode === "raw-l1-v1" &&
    !declaredPaths.includes("caching.configuration")
  ) {
    admissionReasons.push(
      'Candidate TeaCache variant must explicitly declare factor "caching.configuration" in changedFactors.'
    );
  }

  // Validate declared factor changes before/after against actual descriptors
  for (const factor of declaredFactorChanges) {
    if (factor.path === "sampling.settings") {
      const baseSettings = baselineDescV2.provenance?.samplerSettings;
      const varSettings = variantDescV2.provenance?.samplerSettings;
      const beforeObj = factor.before as { sampler?: string; scheduler?: string; steps?: number };
      const afterObj = factor.after as { sampler?: string; scheduler?: string; steps?: number };
      const beforeMatch =
        !baseSettings ||
        (beforeObj.sampler === baseSettings.sampler &&
          beforeObj.scheduler === baseSettings.scheduler &&
          beforeObj.steps === baseSettings.steps);
      const afterMatch =
        !varSettings ||
        (afterObj.sampler === varSettings.sampler &&
          afterObj.scheduler === varSettings.scheduler &&
          afterObj.steps === varSettings.steps);
      if (!beforeMatch || !afterMatch) {
        admissionReasons.push(
          `Declared factor "sampling.settings" before/after does not match actual descriptor sampler settings.`
        );
      }
    } else if (factor.path === "models.diffusion") {
      const baseHash = baselineDescV2.provenance?.actualCheckpointHash;
      const varHash = variantDescV2.provenance?.actualCheckpointHash;
      const beforeObj = factor.before as { fileHash?: string };
      const afterObj = factor.after as { fileHash?: string };
      const beforeMatch = !baseHash || beforeObj.fileHash === baseHash;
      const afterMatch = !varHash || afterObj.fileHash === varHash;
      if (!beforeMatch || !afterMatch) {
        admissionReasons.push(
          `Declared factor "models.diffusion" before/after does not match actual descriptor checkpoint hashes.`
        );
      }
    } else if (factor.path === "runtime.manifest") {
      const baseDigest = baselineDescV2.compatibility?.relativeToRuntimeManifestDigest;
      const varDigest = variantDescV2.compatibility?.relativeToRuntimeManifestDigest;
      const beforeObj = factor.before as { runtimeManifestDigest?: string };
      const afterObj = factor.after as { runtimeManifestDigest?: string };
      const beforeMatch = !baseDigest || beforeObj.runtimeManifestDigest === baseDigest;
      const afterMatch = !varDigest || afterObj.runtimeManifestDigest === varDigest;
      if (!beforeMatch || !afterMatch) {
        admissionReasons.push(
          `Declared factor "runtime.manifest" before/after does not match actual descriptor runtime manifest digests.`
        );
      }
    } else if (factor.path === "attention.configuration") {
      const baseBackend =
        baselineDescV2.provenance?.requestedAttentionBackend ??
        baselineDescV2.samplingRecipe?.attentionTopology?.backend ??
        baselineDescV2.attentionRequest?.expectedBackend ??
        "torch_sdpa";
      const varBackend =
        variantDescV2.provenance?.requestedAttentionBackend ??
        variantDescV2.samplingRecipe?.attentionTopology?.backend ??
        variantDescV2.attentionRequest?.expectedBackend ??
        "torch_sdpa";
      const baseTopologyDigest =
        baselineDescV2.samplingRecipe?.attentionTopology?.topologyDigest ??
        baselineDescV2.attentionRequest?.topologyDigest ??
        computeAttentionTopologyDigest([]);
      const varTopologyDigest =
        variantDescV2.samplingRecipe?.attentionTopology?.topologyDigest ??
        variantDescV2.attentionRequest?.topologyDigest ??
        computeAttentionTopologyDigest([]);
      const beforeObj = factor.before as {
        backend?: string;
        topologyDigest?: string;
        patches?: string[];
      };
      const afterObj = factor.after as {
        backend?: string;
        topologyDigest?: string;
        patches?: string[];
      };
      const beforeMatch =
        !baseBackend ||
        beforeObj.backend === baseBackend ||
        (baseBackend === "default" && beforeObj.backend === "torch_sdpa");
      const afterMatch =
        !varBackend ||
        afterObj.backend === varBackend ||
        (varBackend === "default" && afterObj.backend === "torch_sdpa");
      if (!beforeMatch || !afterMatch) {
        admissionReasons.push(
          `Declared factor "attention.configuration" before/after does not match actual descriptor attention backend.`
        );
      }
      if (
        beforeObj.topologyDigest !== undefined &&
        baselineDescV2.samplingRecipe?.attentionTopology &&
        beforeObj.topologyDigest !== baseTopologyDigest
      ) {
        admissionReasons.push(
          `Declared factor "attention.configuration" before topologyDigest does not match actual baseline topology.`
        );
      }
      if (
        afterObj.topologyDigest !== undefined &&
        variantDescV2.samplingRecipe?.attentionTopology &&
        afterObj.topologyDigest !== varTopologyDigest
      ) {
        admissionReasons.push(
          `Declared factor "attention.configuration" after topologyDigest does not match actual variant topology.`
        );
      }
      if (Array.isArray(beforeObj.patches) && beforeObj.patches.length > 0) {
        const expectedBasePatches =
          baselineDescV2.samplingRecipe?.attentionTopology?.patches.map((p) => p.classType) ?? [];
        if (
          beforeObj.patches.length !== expectedBasePatches.length ||
          !beforeObj.patches.every((p, idx) => p === expectedBasePatches[idx])
        ) {
          admissionReasons.push(
            `Declared factor "attention.configuration" before patches does not match baseline topology patches.`
          );
        }
      }
      if (Array.isArray(afterObj.patches) && afterObj.patches.length > 0) {
        const expectedVarPatches =
          variantDescV2.samplingRecipe?.attentionTopology?.patches.map((p) => p.classType) ??
          variantDescV2.attentionRequest?.patches?.map((p) => p.classType) ??
          [];
        if (
          afterObj.patches.length !== expectedVarPatches.length ||
          !afterObj.patches.every((p, idx) => p === expectedVarPatches[idx])
        ) {
          admissionReasons.push(
            `Declared factor "attention.configuration" after patches does not match variant topology patches.`
          );
        }
      }
    } else if (factor.path === "models.auxiliary") {
      const baseLora = baselineDescV2.samplingRecipe?.lora;
      const varLora = variantDescV2.samplingRecipe?.lora;
      const beforeList = factor.before as
        | Array<{ hash?: string; name?: string; strength?: number; order?: number }>
        | null
        | undefined;
      const afterList = factor.after as
        | Array<{ hash?: string; name?: string; strength?: number; order?: number }>
        | null
        | undefined;
      if (baseLora) {
        if (!Array.isArray(beforeList) || beforeList.length !== 1) {
          admissionReasons.push(
            `Declared factor "models.auxiliary" before must contain exactly one LoRA matching baseline.`
          );
        } else {
          const entry = beforeList[0];
          if (
            !entry ||
            entry.hash !== baseLora.sha256 ||
            (entry.strength !== undefined && entry.strength !== baseLora.strengthModel) ||
            (entry.order !== undefined && entry.order !== 0)
          ) {
            admissionReasons.push(
              `Declared factor "models.auxiliary" before does not match baseline recipe LoRA attributes (hash, strength, order).`
            );
          }
        }
      } else if (Array.isArray(beforeList) && beforeList.length > 0) {
        admissionReasons.push(
          `Declared factor "models.auxiliary" before must be empty when baseline has no LoRA.`
        );
      }
      if (varLora) {
        if (!Array.isArray(afterList) || afterList.length !== 1) {
          admissionReasons.push(
            `Declared factor "models.auxiliary" after must contain exactly one LoRA matching variant.`
          );
        } else {
          const entry = afterList[0];
          if (
            !entry ||
            entry.hash !== varLora.sha256 ||
            (entry.strength !== undefined && entry.strength !== varLora.strengthModel) ||
            (entry.order !== undefined && entry.order !== 0)
          ) {
            admissionReasons.push(
              `Declared factor "models.auxiliary" after does not match variant recipe LoRA attributes (hash, strength, order).`
            );
          }
        }
      } else if (Array.isArray(afterList) && afterList.length > 0) {
        admissionReasons.push(
          `Declared factor "models.auxiliary" after must be empty when variant has no LoRA.`
        );
      }
    } else if (factor.path === "sampling.sigmaShift") {
      const baseShift = baselineDescV2.samplingRecipe?.sigmaShift;
      const varShift = variantDescV2.samplingRecipe?.sigmaShift;
      const beforeObj = factor.before as
        | {
            enabled?: boolean;
            videoShift?: number;
            audioShift?: number;
          }
        | null
        | undefined;
      const afterObj = factor.after as
        | {
            enabled?: boolean;
            videoShift?: number;
            audioShift?: number;
          }
        | null
        | undefined;

      if (baseShift) {
        if (
          !beforeObj ||
          beforeObj.enabled !== baseShift.enabled ||
          beforeObj.videoShift !== baseShift.videoShift ||
          beforeObj.audioShift !== baseShift.audioShift
        ) {
          admissionReasons.push(
            `Declared factor "sampling.sigmaShift" before does not match baseline recipe sigmaShift.`
          );
        }
      } else if (beforeObj && beforeObj.enabled === true) {
        admissionReasons.push(
          `Declared factor "sampling.sigmaShift" before must not be enabled when baseline has no sigmaShift.`
        );
      }

      if (varShift) {
        if (
          !afterObj ||
          afterObj.enabled !== varShift.enabled ||
          afterObj.videoShift !== varShift.videoShift ||
          afterObj.audioShift !== varShift.audioShift
        ) {
          admissionReasons.push(
            `Declared factor "sampling.sigmaShift" after does not match variant recipe sigmaShift.`
          );
        }
      } else if (afterObj && afterObj.enabled === true) {
        admissionReasons.push(
          `Declared factor "sampling.sigmaShift" after must not be enabled when variant has no sigmaShift.`
        );
      }
    } else if (factor.path === "caching.configuration") {
      const baseReq = baselineDescV2.teacacheRequest;
      const varReq = variantDescV2.teacacheRequest;
      const baseMode = baseReq?.mode ?? "off";
      const varMode = varReq?.mode ?? "off";
      const beforeObj = factor.before as {
        mode?: string;
        threshold?: number | null;
        relL1Thresh?: number | null;
        startStep?: number | null;
        endStep?: number | null;
        totalSteps?: number | null;
        window?: [number, number] | null;
        topologyDigest?: string | null;
        adapterVersion?: string | null;
      } | null;
      const afterObj = factor.after as {
        mode?: string;
        threshold?: number | null;
        relL1Thresh?: number | null;
        startStep?: number | null;
        endStep?: number | null;
        totalSteps?: number | null;
        window?: [number, number] | null;
        topologyDigest?: string | null;
        adapterVersion?: string | null;
      } | null;

      if (!beforeObj || !afterObj) {
        admissionReasons.push(
          `Declared factor "caching.configuration" before and after summaries must be non-null objects.`
        );
      } else {
        if (beforeObj.mode !== baseMode || afterObj.mode !== varMode) {
          admissionReasons.push(
            `Declared factor "caching.configuration" before/after mode does not match actual descriptor caching mode.`
          );
        }
        if (varReq && varReq.mode === "raw-l1-v1") {
          // These fields are required, not merely checked-if-present: a
          // declarer that simply omits a field (undefined) must not be able
          // to silently skip its validation, or an unchecked field could
          // mismatch reality without ever being caught.
          const afterThresh =
            afterObj.relL1Thresh !== undefined ? afterObj.relL1Thresh : afterObj.threshold;
          if (afterThresh === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after threshold is missing for an active caching variant.`
            );
          } else if (afterThresh !== varReq.relL1Thresh) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after threshold does not match actual variant threshold.`
            );
          }
          if (afterObj.startStep === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after startStep is missing.`
            );
          } else if (afterObj.startStep !== varReq.startStep) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after startStep does not match actual variant startStep.`
            );
          }
          if (afterObj.endStep === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after endStep is missing.`
            );
          } else if (afterObj.endStep !== varReq.endStep) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after endStep does not match actual variant endStep.`
            );
          }
          if (afterObj.totalSteps === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after totalSteps is missing.`
            );
          } else if (afterObj.totalSteps !== varReq.totalSteps) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after totalSteps does not match actual variant totalSteps.`
            );
          }
          if (afterObj.topologyDigest === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after topologyDigest is missing.`
            );
          } else if (afterObj.topologyDigest !== varReq.topologyDigest) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after topologyDigest does not match actual variant topologyDigest.`
            );
          }
          if (afterObj.adapterVersion === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after adapterVersion is missing.`
            );
          } else if (afterObj.adapterVersion !== varReq.adapterVersion) {
            admissionReasons.push(
              `Declared factor "caching.configuration" after adapterVersion does not match actual variant adapterVersion.`
            );
          }
        }
        if (baseMode === "off") {
          // A cache-off baseline's "before" summary must affirmatively
          // match the pinned disabled-caching constants -- not merely omit
          // the topology/adapter fields that would otherwise catch a
          // tampered declaration. (relL1Thresh/startStep/endStep still carry
          // the schema's numeric defaults even when mode is "off" -- there
          // is no "unset" representation for those -- so topologyDigest and
          // adapterVersion are the two fields that actually distinguish a
          // genuine disabled state from a fabricated one.)
          if (beforeObj.topologyDigest === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before topologyDigest is missing for a disabled-caching baseline.`
            );
          } else if (beforeObj.topologyDigest !== computeTeaCacheTopologyDigest(null)) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before topologyDigest does not match the pinned no-topology digest for a disabled-caching ("off") baseline.`
            );
          }
          if (beforeObj.adapterVersion === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before adapterVersion is missing for a disabled-caching baseline.`
            );
          } else if (beforeObj.adapterVersion !== TEACACHE_ADAPTER_VERSION) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before adapterVersion does not match the pinned adapter version for a disabled-caching ("off") baseline.`
            );
          }
        } else if (baseReq && baseReq.mode === "raw-l1-v1") {
          const beforeThresh =
            beforeObj.relL1Thresh !== undefined ? beforeObj.relL1Thresh : beforeObj.threshold;
          if (beforeThresh === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before threshold is missing for an active caching baseline.`
            );
          } else if (beforeThresh !== baseReq.relL1Thresh) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before threshold does not match actual baseline threshold.`
            );
          }
          if (beforeObj.topologyDigest === undefined) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before topologyDigest is missing for an active caching baseline.`
            );
          } else if (beforeObj.topologyDigest !== baseReq.topologyDigest) {
            admissionReasons.push(
              `Declared factor "caching.configuration" before topologyDigest does not match actual baseline topologyDigest.`
            );
          }
        }
      }
    }
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

  // Attention variant pair admission checks & independently verified runtime/model/handshake equality checks (Scope 6 & Finding F-af0b9742)
  const isAttentionComparison = Boolean(
    purpose === ("attention" as MinimaxH3ComparisonPurpose) ||
    baselineDescV2?.attentionRequest ||
    variantDescV2?.attentionRequest
  );

  if (isAttentionComparison) {
    if (!baselineDescV2.attentionRequest) {
      admissionReasons.push(
        "Attention comparison requires baseline to specify an attentionRequest."
      );
    }
    if (!variantDescV2.attentionRequest) {
      admissionReasons.push(
        "Attention comparison requires variant to specify an attentionRequest."
      );
    }

    if (baselineDescV2.attentionRequest && variantDescV2.attentionRequest) {
      const varAttn = variantDescV2.attentionRequest.attentionVariant;
      if (varAttn !== "dense") {
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
        const baseCore = baselineDescV2.requiredRuntime?.coreRevision;
        const varCore = variantDescV2.requiredRuntime?.coreRevision;
        if (!baseCore || !varCore || baseCore !== varCore) {
          admissionReasons.push(
            `Core revision mismatch across attention comparison pair: baseline is "${baseCore}", variant is "${varCore}". Attention comparison requires identical core revision (matched dense substrate).`
          );
        }
      } else {
        // Both are dense control: require identical coreRevision and identical runtimeLockDigest
        if (baselineDescV2.attentionRequest.attentionVariant !== "dense") {
          admissionReasons.push(
            `Dense control comparison requires baseline to be dense. Baseline requested variant "${baselineDescV2.attentionRequest.attentionVariant}".`
          );
        }
        if (
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

    if (!baselineProv) {
      admissionReasons.push(
        "Baseline experiment is missing observed provenance required for attention comparison."
      );
    }
    if (!variantProv) {
      admissionReasons.push(
        "Variant experiment is missing observed provenance required for attention comparison."
      );
    }

    if (baselineProv && variantProv) {
      const runsToCheck = [
        {
          prov: baselineProv,
          desc: baselineDescV2,
          result: baselineResult as Partial<MinimaxH3ExperimentResultV2>,
          role: "Baseline" as const
        },
        {
          prov: variantProv,
          desc: variantDescV2,
          result: variantResult as Partial<MinimaxH3ExperimentResultV2>,
          role: "Variant" as const
        }
      ];

      for (const { prov, desc, result, role } of runsToCheck) {
        if (prov.conflicts && prov.conflicts.length > 0) {
          admissionReasons.push(
            `${role} observed provenance has conflict(s): ${prov.conflicts.join("; ")}`
          );
        }

        // Check checkpoint hash
        if (prov.actualCheckpointHash?.status !== "verified" || !prov.actualCheckpointHash.value) {
          admissionReasons.push(
            `${role} actual checkpoint hash status is ${prov.actualCheckpointHash?.status ?? "missing"} (expected verified).`
          );
        } else if (
          desc?.provenance?.actualCheckpointHash &&
          prov.actualCheckpointHash.value !== desc.provenance.actualCheckpointHash
        ) {
          admissionReasons.push(
            `${role} actual checkpoint hash does not match expected checkpoint hash.`
          );
        }

        // Check loaded models completeness
        if (desc?.resolvedModelPaths) {
          for (const [modelRole, spec] of Object.entries(desc.resolvedModelPaths)) {
            const loaded = prov.loadedModelHashes?.[modelRole];
            const expectedHash =
              typeof spec === "string" ? spec : (spec as { expectedHash: string }).expectedHash;
            if (!loaded || loaded.status !== "verified" || !loaded.value) {
              admissionReasons.push(
                `${role} loaded model "${modelRole}" status is ${loaded?.status ?? "missing"} (expected verified).`
              );
            } else if (loaded.value !== expectedHash) {
              admissionReasons.push(
                `${role} loaded model "${modelRole}" hash does not match expected hash.`
              );
            }
          }
        }

        // Check ComfyUI core revision
        if (prov.comfyuiCoreRevision?.status !== "verified" || !prov.comfyuiCoreRevision.value) {
          admissionReasons.push(
            `${role} ComfyUI core revision status is ${prov.comfyuiCoreRevision?.status ?? "missing"} (expected verified).`
          );
        } else if (
          desc?.requiredRuntime?.coreRevision &&
          prov.comfyuiCoreRevision.value !== desc.requiredRuntime.coreRevision
        ) {
          admissionReasons.push(
            `${role} ComfyUI core revision does not match required coreRevision.`
          );
        }

        // Check runtime versions
        if (prov.runtimeVersions?.status !== "verified") {
          admissionReasons.push(
            `${role} runtime versions status is ${prov.runtimeVersions?.status ?? "missing"} (expected verified).`
          );
        }
        if (!prov.runtimeVersions?.driverVersion) {
          admissionReasons.push(`${role} driver version is unverified/null.`);
        }
        if (!prov.runtimeVersions?.cudaBuildVersion) {
          admissionReasons.push(`${role} CUDA build version is unverified/null.`);
        }
        if (!prov.runtimeVersions?.pythonVersion) {
          admissionReasons.push(`${role} Python version is unverified/null.`);
        }

        // Check bootstrap handshake
        if (prov.bootstrapHandshake?.status !== "verified") {
          admissionReasons.push(
            `${role} bootstrap handshake status is ${prov.bootstrapHandshake?.status ?? "missing"} (expected verified).`
          );
        }

        // Check capability handshake
        if (!prov.capabilityHandshake) {
          admissionReasons.push(`${role} is missing required pre-submission capability handshake.`);
        } else {
          if (desc && prov.capabilityHandshake.runId !== desc.runId) {
            admissionReasons.push(
              `${role} capability handshake runId mismatch: expected ${desc.runId}, observed ${prov.capabilityHandshake.runId}.`
            );
          }
          const hs = prov.capabilityHandshake;
          if (hs.status !== "ok" || !hs.attemptToken || !hs.nonce || !hs.pid) {
            admissionReasons.push(
              `${role} capability handshake is not a complete accepted per-attempt observation.`
            );
          }
          const expectedAttemptToken =
            (result.observedRunner as { attemptToken?: string } | undefined)?.attemptToken ??
            result.observedRunner?.env?.CCO_EXPERIMENT_ATTEMPT_TOKEN;
          if (expectedAttemptToken && hs.attemptToken !== expectedAttemptToken) {
            admissionReasons.push(
              `${role} capability handshake attemptToken mismatch: expected ${expectedAttemptToken}, observed ${hs.attemptToken}.`
            );
          }
          if (result.observedRunner?.pid && hs.pid !== result.observedRunner.pid) {
            admissionReasons.push(
              `${role} capability handshake PID mismatch: expected ${result.observedRunner.pid}, observed ${hs.pid}.`
            );
          }
          if (desc?.attentionRequest?.expectedKernel && hs.kernelCallableAvailable !== true) {
            admissionReasons.push(
              `${role} handshake did not verify the requested kernel callable.`
            );
          }
          if (desc?.requiredRuntime) {
            for (const node of desc.requiredRuntime.requiredNodes) {
              const registered = hs.registeredNodes[node.name];
              if (!registered) {
                admissionReasons.push(`${role} handshake lacks registered node "${node.name}".`);
              } else if (
                node.moduleHash &&
                registered.moduleHash &&
                registered.moduleHash !== node.moduleHash
              ) {
                admissionReasons.push(
                  `${role} registered node "${node.name}" moduleHash mismatch: expected ${node.moduleHash}, observed ${registered.moduleHash}.`
                );
              }
            }
            if (desc.requiredRuntime.hooks) {
              for (const hook of desc.requiredRuntime.hooks) {
                const found = hs.installedHooks?.find(
                  (h) =>
                    h.name === hook.name &&
                    h.modulePath === hook.modulePath &&
                    h.callable === hook.callable &&
                    h.phase === hook.phase
                );
                if (!found || !found.attached) {
                  admissionReasons.push(
                    `${role} handshake is missing attached hook "${hook.name}".`
                  );
                }
              }
            }
          }

          // The admitted live handshake checked above (hs) and the handshake
          // embedded in the attention identity envelope used for substrate
          // digest recomputation below are separate, independently-sourced
          // copies: nothing previously required them to agree, so a
          // substrate digest could be recomputed from a different
          // collector/protocol identity than the one actually admitted
          // (AC-6, F-af0b9742).
          const envelopeHandshake = prov.attentionIdentity?.handshake;
          if (envelopeHandshake) {
            if (envelopeHandshake.collectorDigest !== hs.collectorDigest) {
              admissionReasons.push(
                `${role} attention identity handshake collectorDigest "${envelopeHandshake.collectorDigest}" does not match admitted capability handshake collectorDigest "${hs.collectorDigest}".`
              );
            }
            if (envelopeHandshake.protocol !== hs.protocol) {
              admissionReasons.push(
                `${role} attention identity handshake protocol "${envelopeHandshake.protocol}" does not match admitted capability handshake protocol "${hs.protocol}".`
              );
            }
            if (envelopeHandshake.pid !== hs.pid || envelopeHandshake.nonce !== hs.nonce) {
              admissionReasons.push(
                `${role} attention identity handshake pid/nonce does not match the admitted capability handshake's pid/nonce.`
              );
            }
          }
        }

        // Check attention identity envelope
        if (!prov.attentionIdentity) {
          admissionReasons.push(`${role} is missing required attention identity envelope.`);
        } else {
          if (prov.attentionIdentity.identityVersion !== 1) {
            admissionReasons.push(
              `${role} attention identity version is invalid: ${prov.attentionIdentity.identityVersion}.`
            );
          }
          if (
            !prov.attentionIdentity.packageArtifacts ||
            prov.attentionIdentity.packageArtifacts.length === 0
          ) {
            admissionReasons.push(`${role} attention identity is missing package artifacts.`);
          } else {
            for (const pkg of prov.attentionIdentity.packageArtifacts) {
              if (!pkg.artifactHash || pkg.artifactHash.length !== 64) {
                admissionReasons.push(
                  `${role} package "${pkg.name}" has invalid or missing artifactHash.`
                );
              }
              if (pkg.artifactMethod !== "installed_record_sha256_v1") {
                admissionReasons.push(
                  `${role} package "${pkg.name}" has unsupported artifactMethod "${pkg.artifactMethod}".`
                );
              }
            }
            if (!prov.attentionIdentity.packageArtifacts.some((pkg) => pkg.name === "torch")) {
              admissionReasons.push(
                `${role} attention identity does not include mandatory torch artifact evidence.`
              );
            }
            if (desc?.requiredRuntime?.pythonPackages) {
              for (const reqPkg of desc.requiredRuntime.pythonPackages) {
                const match = prov.attentionIdentity.packageArtifacts.find(
                  (p) => p.name === reqPkg.name
                );
                if (!match) {
                  admissionReasons.push(
                    `${role} attention identity missing required package "${reqPkg.name}".`
                  );
                } else if (reqPkg.artifactHash && match.artifactHash !== reqPkg.artifactHash) {
                  admissionReasons.push(
                    `${role} package "${reqPkg.name}" artifactHash mismatch: expected ${reqPkg.artifactHash}, observed ${match.artifactHash}.`
                  );
                }
              }
            }
          }
          if (
            !prov.attentionIdentity.sourceIdentities ||
            Object.keys(prov.attentionIdentity.sourceIdentities).length === 0
          ) {
            admissionReasons.push(`${role} attention identity is missing source identities.`);
          } else if (desc?.requiredRuntime?.sourceFileHashes) {
            for (const [file, expHash] of Object.entries(desc.requiredRuntime.sourceFileHashes)) {
              if (!prov.attentionIdentity.sourceIdentities[file]) {
                admissionReasons.push(
                  `${role} attention identity missing required source file "${file}".`
                );
              } else if (prov.attentionIdentity.sourceIdentities[file] !== expHash) {
                admissionReasons.push(
                  `${role} source file "${file}" hash mismatch: expected ${expHash}, observed ${prov.attentionIdentity.sourceIdentities[file]}.`
                );
              }
            }
          }
          if (!prov.attentionIdentity.interpreter?.pythonVersion) {
            admissionReasons.push(`${role} attention identity is missing interpreter identity.`);
          }

          if (desc?.attentionRequest) {
            if (
              prov.attentionIdentity.substrateDigest !== desc.attentionRequest.runtimeLockDigest
            ) {
              admissionReasons.push(
                `${role} measured substrate digest "${prov.attentionIdentity.substrateDigest}" does not match requested runtimeLockDigest "${desc.attentionRequest.runtimeLockDigest}".`
              );
            }
          }
        }
      }

      // Cross-pair recomputed substrate equality
      const recomputeSubstrate = (
        prov: MinimaxH3ObservedProvenance,
        desc: Partial<MinimaxH3ExperimentDescriptorV2>
      ): string | null => {
        if (!prov.attentionIdentity || !desc.requiredRuntime) return null;
        return computeAttentionRuntimeLockDigest({
          comfyuiCoreRevision: desc.requiredRuntime.coreRevision,
          customNodeRevision: desc.requiredRuntime.customNodeRevision,
          sourceFileHashes: prov.attentionIdentity.sourceIdentities,
          interpreter: prov.attentionIdentity.interpreter,
          pytorchBuild:
            prov.attentionIdentity.toolchain?.pytorchBuild ?? desc.requiredRuntime.pytorchBuild,
          cudaBuild:
            prov.attentionIdentity.toolchain?.cudaBuildVersion ?? desc.requiredRuntime.cudaBuild,
          driverConstraints: desc.requiredRuntime.driverConstraints,
          pythonPackages: prov.attentionIdentity.packageArtifacts,
          cudaRequirement: desc.requiredRuntime.cudaRequirement,
          computeCapability: desc.requiredRuntime.computeCapability,
          instrumentationProtocol: desc.requiredRuntime.instrumentationProtocol,
          collectorDigest:
            prov.attentionIdentity.handshake?.collectorDigest ??
            desc.requiredRuntime.collectorDigest,
          hookManifestDigest:
            prov.attentionIdentity.handshake?.hookManifestDigest ??
            desc.requiredRuntime.hookManifestDigest,
          hooks: desc.requiredRuntime.hooks
        });
      };

      const baseSubstrate = recomputeSubstrate(baselineProv, baselineDescV2);
      const varSubstrate = recomputeSubstrate(variantProv, variantDescV2);

      if (baseSubstrate && baselineDescV2?.attentionRequest) {
        if (baseSubstrate !== baselineDescV2.attentionRequest.runtimeLockDigest) {
          admissionReasons.push(
            `Baseline recomputed measured substrate digest "${baseSubstrate}" does not match requested runtimeLockDigest "${baselineDescV2.attentionRequest.runtimeLockDigest}".`
          );
        }
      }
      if (varSubstrate && variantDescV2?.attentionRequest) {
        if (varSubstrate !== variantDescV2.attentionRequest.runtimeLockDigest) {
          admissionReasons.push(
            `Variant recomputed measured substrate digest "${varSubstrate}" does not match requested runtimeLockDigest "${variantDescV2.attentionRequest.runtimeLockDigest}".`
          );
        }
      }
      if (baseSubstrate && baselineProv?.attentionIdentity) {
        if (baseSubstrate !== baselineProv.attentionIdentity.substrateDigest) {
          admissionReasons.push(
            `Baseline recomputed measured substrate digest "${baseSubstrate}" does not match stored substrateDigest "${baselineProv.attentionIdentity.substrateDigest}".`
          );
        }
      }
      if (varSubstrate && variantProv?.attentionIdentity) {
        if (varSubstrate !== variantProv.attentionIdentity.substrateDigest) {
          admissionReasons.push(
            `Variant recomputed measured substrate digest "${varSubstrate}" does not match stored substrateDigest "${variantProv.attentionIdentity.substrateDigest}".`
          );
        }
      }
      if (baseSubstrate && varSubstrate && baseSubstrate !== varSubstrate) {
        admissionReasons.push(
          `Recomputed measured substrate digest mismatch across attention comparison pair: baseline is "${baseSubstrate}", variant is "${varSubstrate}".`
        );
      }

      // Cross-pair invariant equality
      if (
        baselineProv.runtimeVersions?.driverVersion &&
        variantProv.runtimeVersions?.driverVersion &&
        baselineProv.runtimeVersions.driverVersion !== variantProv.runtimeVersions.driverVersion
      ) {
        admissionReasons.push(
          `Driver version mismatch: baseline is "${baselineProv.runtimeVersions.driverVersion}", variant is "${variantProv.runtimeVersions.driverVersion}".`
        );
      }
      if (
        baselineProv.runtimeVersions?.cudaBuildVersion &&
        variantProv.runtimeVersions?.cudaBuildVersion &&
        baselineProv.runtimeVersions.cudaBuildVersion !==
          variantProv.runtimeVersions.cudaBuildVersion
      ) {
        admissionReasons.push(
          `CUDA build version mismatch: baseline is "${baselineProv.runtimeVersions.cudaBuildVersion}", variant is "${variantProv.runtimeVersions.cudaBuildVersion}".`
        );
      }
      if (
        baselineProv.runtimeVersions?.pythonVersion &&
        variantProv.runtimeVersions?.pythonVersion &&
        baselineProv.runtimeVersions.pythonVersion !== variantProv.runtimeVersions.pythonVersion
      ) {
        admissionReasons.push(
          `Python version mismatch: baseline is "${baselineProv.runtimeVersions.pythonVersion}", variant is "${variantProv.runtimeVersions.pythonVersion}".`
        );
      }
      if (
        baselineProv.actualCheckpointHash?.value &&
        variantProv.actualCheckpointHash?.value &&
        baselineProv.actualCheckpointHash.value !== variantProv.actualCheckpointHash.value
      ) {
        admissionReasons.push("Actual checkpoint hash mismatch across pair.");
      }
      if (
        baselineProv.bootstrapHandshake?.protocol &&
        variantProv.bootstrapHandshake?.protocol &&
        baselineProv.bootstrapHandshake.protocol !== variantProv.bootstrapHandshake.protocol
      ) {
        admissionReasons.push(
          `Bootstrap handshake protocol mismatch: baseline is "${baselineProv.bootstrapHandshake.protocol}", variant is "${variantProv.bootstrapHandshake.protocol}".`
        );
      }
      if (
        baselineProv.attentionIdentity?.toolchain?.pytorchBuild &&
        variantProv.attentionIdentity?.toolchain?.pytorchBuild &&
        baselineProv.attentionIdentity.toolchain.pytorchBuild !==
          variantProv.attentionIdentity.toolchain.pytorchBuild
      ) {
        admissionReasons.push(
          `PyTorch build mismatch across pair: baseline is "${baselineProv.attentionIdentity.toolchain.pytorchBuild}", variant is "${variantProv.attentionIdentity.toolchain.pytorchBuild}".`
        );
      }
      if (
        baselineProv.comfyuiCoreRevision?.value &&
        variantProv.comfyuiCoreRevision?.value &&
        baselineProv.comfyuiCoreRevision.value !== variantProv.comfyuiCoreRevision.value
      ) {
        admissionReasons.push(
          `ComfyUI core revision mismatch across pair: baseline is "${baselineProv.comfyuiCoreRevision.value}", variant is "${variantProv.comfyuiCoreRevision.value}".`
        );
      }
    }

    // Dense region policy: baseline purity and kernel failure guards
    const baseAttnObs = (baselineResult as Partial<MinimaxH3ExperimentResultV2>)
      ?.attentionObservation;
    if (!baseAttnObs) {
      admissionReasons.push(
        "Baseline experiment is missing attention observation required for attention comparison."
      );
    } else {
      if (baseAttnObs.missingKernelFailure) {
        admissionReasons.push(
          `Baseline recorded missing kernel failure: ${baseAttnObs.missingKernelFailure}. Attention comparison rejected.`
        );
      }
      if (baseAttnObs.status === "failed") {
        admissionReasons.push(
          `Baseline recorded attention failure: ${baseAttnObs.failureReason ?? "unknown"}. Attention comparison rejected.`
        );
      }
      if (baseAttnObs.acceleratedCallCount > 0) {
        admissionReasons.push(
          `Baseline observed mixed accelerated execution (${baseAttnObs.acceleratedCallCount} accelerated call(s)). Dense baseline must be pure. Attention comparison rejected.`
        );
      }
      if (baseAttnObs.fallbackEvents && baseAttnObs.fallbackEvents.length > 0) {
        admissionReasons.push(
          `Baseline experienced attention fallback (${baseAttnObs.fallbackEvents.length} fallback event(s)). Attention comparison rejected.`
        );
      }
    }

    const varAttnObs = (variantResult as Partial<MinimaxH3ExperimentResultV2>)
      ?.attentionObservation;
    if (!varAttnObs) {
      admissionReasons.push(
        "Variant experiment is missing attention observation required for attention comparison."
      );
    } else {
      if (varAttnObs.missingKernelFailure) {
        admissionReasons.push(
          `Variant recorded missing kernel failure: ${varAttnObs.missingKernelFailure}. Attention comparison rejected.`
        );
      }
      if (varAttnObs.status === "failed") {
        admissionReasons.push(
          `Variant recorded attention failure: ${varAttnObs.failureReason ?? "unknown"}. Attention comparison rejected.`
        );
      }
    }
  } else if (baselineProv && variantProv) {
    // Legacy non-attention checks
    if (
      baselineProv.actualCheckpointHash?.status === "conflict" ||
      variantProv.actualCheckpointHash?.status === "conflict"
    ) {
      admissionReasons.push("Actual checkpoint hash status is in conflict.");
    }
    if (
      baselineProv.comfyuiCoreRevision?.status === "conflict" ||
      variantProv.comfyuiCoreRevision?.status === "conflict"
    ) {
      admissionReasons.push("ComfyUI core revision status is in conflict.");
    }
    if (
      baselineProv.runtimeVersions?.driverVersion &&
      variantProv.runtimeVersions?.driverVersion &&
      baselineProv.runtimeVersions.driverVersion !== variantProv.runtimeVersions.driverVersion
    ) {
      admissionReasons.push(
        `Driver version mismatch: baseline is "${baselineProv.runtimeVersions.driverVersion}", variant is "${variantProv.runtimeVersions.driverVersion}".`
      );
    }
    if (
      baselineProv.runtimeVersions?.cudaBuildVersion &&
      variantProv.runtimeVersions?.cudaBuildVersion &&
      baselineProv.runtimeVersions.cudaBuildVersion !== variantProv.runtimeVersions.cudaBuildVersion
    ) {
      admissionReasons.push(
        `CUDA build version mismatch: baseline is "${baselineProv.runtimeVersions.cudaBuildVersion}", variant is "${variantProv.runtimeVersions.cudaBuildVersion}".`
      );
    }
    if (
      baselineProv.bootstrapHandshake &&
      variantProv.bootstrapHandshake &&
      baselineProv.bootstrapHandshake.protocol !== variantProv.bootstrapHandshake.protocol
    ) {
      admissionReasons.push(
        `Bootstrap handshake protocol mismatch: baseline is "${baselineProv.bootstrapHandshake.protocol}", variant is "${variantProv.bootstrapHandshake.protocol}".`
      );
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

  if (baselineExecuted && variantExecuted) {
    if (
      baselinePhase?.samplingWallTimeMs !== null &&
      baselinePhase?.samplingWallTimeMs !== undefined &&
      variantPhase?.samplingWallTimeMs !== null &&
      variantPhase?.samplingWallTimeMs !== undefined
    ) {
      samplingWallEligible = isEligible;
    } else {
      metricReasons.push("Sampling phase wall time was not measured in one or both runs.");
    }

    if (
      baselinePhase?.gpuKernelTimeMs !== null &&
      baselinePhase?.gpuKernelTimeMs !== undefined &&
      variantPhase?.gpuKernelTimeMs !== null &&
      variantPhase?.gpuKernelTimeMs !== undefined
    ) {
      kernelTimeEligible = isEligible;
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

    // Require verified observed sampling, conditioning, and attention
    // Require verified observed sampling, conditioning, and attention
    if (variantDescV2.samplingRecipe || baselineDescV2.samplingRecipe) {
      if (!variantProv?.observedSampling || variantProv.observedSampling.status !== "verified") {
        metricReasons.push(
          `Variant observed sampling was not verified (status: "${variantProv?.observedSampling?.status ?? "missing"}"). Speedup metrics disqualified for step-reduction experiment.`
        );
        samplingWallEligible = false;
        wallTimeEligible = false;
        kernelTimeEligible = false;
      }
      if (
        !variantProv?.observedConditioning ||
        variantProv.observedConditioning.status !== "verified"
      ) {
        metricReasons.push(
          `Variant observed conditioning was not verified (status: "${variantProv?.observedConditioning?.status ?? "missing"}"). Speedup metrics disqualified for step-reduction experiment.`
        );
        samplingWallEligible = false;
        wallTimeEligible = false;
        kernelTimeEligible = false;
      }
      if (variantDescV2.samplingRecipe?.attentionTopology) {
        if (
          !variantProv?.observedAttentionBackend ||
          variantProv.observedAttentionBackend.status !== "verified"
        ) {
          metricReasons.push(
            `Variant observed attention backend was not verified (status: "${variantProv?.observedAttentionBackend?.status ?? "missing"}"). Speedup metrics disqualified for FastH3 step-reduction experiment.`
          );
          samplingWallEligible = false;
          wallTimeEligible = false;
          kernelTimeEligible = false;
        }
        const varAttnObs = (variantResult as Partial<MinimaxH3ExperimentResultV2>)
          ?.attentionObservation;
        if (!varAttnObs || varAttnObs.status !== "verified") {
          metricReasons.push(
            `Variant attention observation was not verified (status: "${varAttnObs?.status ?? "missing"}"). Speedup metrics disqualified for FastH3 step-reduction experiment.`
          );
          samplingWallEligible = false;
          wallTimeEligible = false;
          kernelTimeEligible = false;
        }
      }
      if (!baselineProv?.observedSampling || baselineProv.observedSampling.status !== "verified") {
        metricReasons.push(
          `Baseline observed sampling was not verified (status: "${baselineProv?.observedSampling?.status ?? "missing"}"). Speedup metrics disqualified for step-reduction experiment.`
        );
        samplingWallEligible = false;
        wallTimeEligible = false;
        kernelTimeEligible = false;
      }
      if (
        !baselineProv?.observedConditioning ||
        baselineProv.observedConditioning.status !== "verified"
      ) {
        metricReasons.push(
          `Baseline observed conditioning was not verified (status: "${baselineProv?.observedConditioning?.status ?? "missing"}"). Speedup metrics disqualified for step-reduction experiment.`
        );
        samplingWallEligible = false;
        wallTimeEligible = false;
        kernelTimeEligible = false;
      }
    }
    if (baselineProv?.observedSampling?.status === "conflict") {
      metricReasons.push(`Baseline observed sampling had conflicts. Speedup metrics disqualified.`);
      samplingWallEligible = false;
      wallTimeEligible = false;
      kernelTimeEligible = false;
    }
    if (variantProv?.observedSampling?.status === "conflict") {
      metricReasons.push(`Variant observed sampling had conflicts. Speedup metrics disqualified.`);
      samplingWallEligible = false;
      wallTimeEligible = false;
      kernelTimeEligible = false;
    }
    if (baselineProv?.observedConditioning?.status === "conflict") {
      metricReasons.push(
        `Baseline observed conditioning had conflicts. Speedup metrics disqualified.`
      );
      samplingWallEligible = false;
      wallTimeEligible = false;
      kernelTimeEligible = false;
    }
    if (variantProv?.observedConditioning?.status === "conflict") {
      metricReasons.push(
        `Variant observed conditioning had conflicts. Speedup metrics disqualified.`
      );
      samplingWallEligible = false;
      wallTimeEligible = false;
      kernelTimeEligible = false;
    }

    // Attention variant verification
    if (isAttentionComparison) {
      const varResV2 = variantResult as Partial<MinimaxH3ExperimentResultV2>;
      const obs = varResV2.attentionObservation;
      const expectedBackend = variantDescV2.attentionRequest?.expectedBackend;
      const expectedKernel = variantDescV2.attentionRequest?.expectedKernel;
      const isAccelerated = variantDescV2.attentionRequest?.attentionVariant !== "dense";
      const baseResV2 = baselineResult as Partial<MinimaxH3ExperimentResultV2>;
      const baseObs = baseResV2.attentionObservation;
      let attentionValid = true;

      const baseExpectedBackend = baselineDescV2.attentionRequest?.expectedBackend ?? "torch_sdpa";
      const baseExpectedKernel =
        baselineDescV2.attentionRequest?.expectedKernel ??
        "torch.nn.functional.scaled_dot_product_attention";

      const baseEval = evaluateAttentionObservationEligibility({
        role: "Baseline",
        observation: baseObs,
        policy: baselineDescV2.attentionRequest?.denseRegionPolicy,
        isDense:
          baselineDescV2.attentionRequest?.attentionVariant === "dense" ||
          !baselineDescV2.attentionRequest,
        expectedBackend: baseExpectedBackend,
        expectedKernel: baseExpectedKernel
      });
      if (!baseEval.valid) {
        for (const r of baseEval.reasons) {
          metricReasons.push(`${r} Speedup metrics disqualified.`);
        }
        attentionValid = false;
      }
      if (
        baseObs?.stepRecords?.some((r) => r.callType === "accelerated" || r.callType === "fallback")
      ) {
        metricReasons.push(
          "Baseline step records contain accelerated or fallback execution. Dense baseline must be pure. Speedup metrics disqualified."
        );
        attentionValid = false;
      }

      if (variantDescV2.attentionRequest) {
        const varEval = evaluateAttentionObservationEligibility({
          role: "Variant",
          observation: obs,
          policy: variantDescV2.attentionRequest.denseRegionPolicy,
          isDense: !isAccelerated,
          expectedBackend,
          expectedKernel
        });
        if (!varEval.valid) {
          for (const r of varEval.reasons) {
            metricReasons.push(`${r} Speedup metrics disqualified.`);
          }
          attentionValid = false;
        }
      } else {
        metricReasons.push(
          "Variant result lacks verified attention observation evidence. Historical data or uninstrumented runs cannot support a speedup claim. Speedup metrics disqualified."
        );
        attentionValid = false;
      }

      if (!attentionValid) {
        wallTimeEligible = false;
        samplingWallEligible = false;
        kernelTimeEligible = false;
      }
    }

    // TeaCache variant verification
    const isTeaCacheComparison =
      declaredPaths.includes("caching.configuration") ||
      Boolean(variantDescV2.teacacheRequest) ||
      Boolean(baselineDescV2.teacacheRequest);

    if (isTeaCacheComparison) {
      const varResV2 = variantResult as Partial<MinimaxH3ExperimentResultV2>;
      const obs = varResV2.teacacheObservation;
      const baseResV2 = baselineResult as Partial<MinimaxH3ExperimentResultV2>;
      const baseObs = baseResV2.teacacheObservation;
      let teacacheValid = true;

      const baseMode = baselineDescV2.teacacheRequest?.mode ?? "off";
      const baseEval = evaluateTeaCacheObservationEligibility({
        role: "Baseline",
        observation: baseObs,
        mode: baseMode,
        expectedRequest: baselineDescV2.teacacheRequest
      });
      if (!baseEval.valid) {
        for (const r of baseEval.reasons) {
          metricReasons.push(`${r} Speedup metrics disqualified.`);
        }
        teacacheValid = false;
      }

      if (variantDescV2.teacacheRequest) {
        const varEval = evaluateTeaCacheObservationEligibility({
          role: "Variant",
          observation: obs,
          mode: variantDescV2.teacacheRequest.mode,
          expectedRequest: variantDescV2.teacacheRequest
        });
        if (!varEval.valid) {
          for (const r of varEval.reasons) {
            metricReasons.push(`${r} Speedup metrics disqualified.`);
          }
          teacacheValid = false;
        }
      } else {
        metricReasons.push(
          "Variant result lacks verified TeaCache observation evidence. Historical data or uninstrumented runs cannot support a speedup claim. Speedup metrics disqualified."
        );
        teacacheValid = false;
      }

      if (!teacacheValid) {
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
