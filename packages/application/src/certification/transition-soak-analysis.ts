import type {
  CertificationFailure,
  CertificationTelemetrySample,
  TransitionFamilyBaseline,
  TransitionSoakAggregates,
  TransitionSoakArtifact,
  TransitionSoakGate,
  TransitionSoakGateChecks,
  TransitionSoakIteration,
  TransitionSoakThresholds
} from "@cco/contracts";

export interface EvaluateTransitionSoakOptions {
  readonly iterations: readonly TransitionSoakIteration[];
  readonly baselines: {
    readonly flux: TransitionFamilyBaseline;
    readonly ltx: TransitionFamilyBaseline;
  };
  readonly thresholds: TransitionSoakThresholds;
  readonly requestedTransitionCount?: number;
  readonly runnerProfile?: string;
}

export interface TransitionSoakEvaluationResult {
  readonly status: "passed" | "failed";
  readonly completedTransitionCount: number;
  readonly aggregates: TransitionSoakAggregates;
  readonly gate: TransitionSoakGate;
  readonly hostRamDecision: "support_32gb" | "require_64gb";
  readonly selectedRunnerProfile: string | null;
  readonly failure: CertificationFailure | null;
}

function calculateNonNegativeDelta(first: number, last: number): number | null {
  const delta = last - first;
  return delta >= 0 ? delta : null;
}

function calculateMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

type SwapActivityClassification = "none" | "transient" | "sustained";

const SWAP_DECAY_RATIO = 0.1;
const SWAP_USED_NOISE_FLOOR_MB = 10;
const SWAP_PAGE_NOISE_FLOOR = 2500;
const SIGNIFICANT_SWAP_USED_MB = 5;
const SIGNIFICANT_SWAP_PAGES = 1250;

function classifySwapActivity(
  iterations: readonly TransitionSoakIteration[]
): SwapActivityClassification {
  const value = (metric: number | null): number => metric ?? 0;
  const hasActivity = iterations.some(
    ({ telemetry }) =>
      value(telemetry.swapUsedDeltaMb) > 0 ||
      value(telemetry.systemSwapInPageDelta) > 0 ||
      value(telemetry.systemSwapOutPageDelta) > 0
  );

  if (!hasActivity) return "none";

  const splitIndex = Math.ceil(iterations.length / 2);
  const firstHalf = iterations.slice(0, splitIndex);
  const secondHalf = iterations.slice(splitIndex);
  const sum = (
    records: readonly TransitionSoakIteration[],
    select: (iteration: TransitionSoakIteration) => number | null
  ): number => records.reduce((total, iteration) => total + value(select(iteration)), 0);
  const decayed = (first: number, second: number, noiseFloor: number): boolean =>
    second < first * SWAP_DECAY_RATIO || second < noiseFloor;

  const swapUsedDecayed = decayed(
    sum(firstHalf, ({ telemetry }) => telemetry.swapUsedDeltaMb),
    sum(secondHalf, ({ telemetry }) => telemetry.swapUsedDeltaMb),
    SWAP_USED_NOISE_FLOOR_MB
  );
  const swapInDecayed = decayed(
    sum(firstHalf, ({ telemetry }) => telemetry.systemSwapInPageDelta),
    sum(secondHalf, ({ telemetry }) => telemetry.systemSwapInPageDelta),
    SWAP_PAGE_NOISE_FLOOR
  );
  const swapOutDecayed = decayed(
    sum(firstHalf, ({ telemetry }) => telemetry.systemSwapOutPageDelta),
    sum(secondHalf, ({ telemetry }) => telemetry.systemSwapOutPageDelta),
    SWAP_PAGE_NOISE_FLOOR
  );
  const significantIterations = iterations.filter(
    ({ telemetry }) =>
      value(telemetry.swapUsedDeltaMb) > SIGNIFICANT_SWAP_USED_MB ||
      value(telemetry.systemSwapInPageDelta) > SIGNIFICANT_SWAP_PAGES ||
      value(telemetry.systemSwapOutPageDelta) > SIGNIFICANT_SWAP_PAGES
  ).length;
  const recurrent = significantIterations > iterations.length / 2;

  return swapUsedDecayed && swapInDecayed && swapOutDecayed && !recurrent
    ? "transient"
    : "sustained";
}

/**
 * Pure evaluator for FLUX <-> LTX transition soak stability and gate checks.
 *
 * Calculates global peaks, run-window deltas, family-normalized progressive memory growth,
 * post-unload settling growth, and median latency degradation against single-family baselines.
 *
 * Failing any check, sustained swap activity, OOM, restart, or incomplete evidence forces require_64gb
 * and fails closed.
 */
export function evaluateTransitionSoak(
  options: EvaluateTransitionSoakOptions
): TransitionSoakEvaluationResult;
export function evaluateTransitionSoak(
  iterations: readonly TransitionSoakIteration[],
  baselines: {
    readonly flux: TransitionFamilyBaseline;
    readonly ltx: TransitionFamilyBaseline;
  },
  thresholds: TransitionSoakThresholds,
  options?: { requestedTransitionCount?: number; runnerProfile?: string }
): TransitionSoakEvaluationResult;
export function evaluateTransitionSoak(
  iterationsOrOptions: readonly TransitionSoakIteration[] | EvaluateTransitionSoakOptions,
  baselinesArg?: {
    readonly flux: TransitionFamilyBaseline;
    readonly ltx: TransitionFamilyBaseline;
  },
  thresholdsArg?: TransitionSoakThresholds,
  optionsArg?: { requestedTransitionCount?: number; runnerProfile?: string }
): TransitionSoakEvaluationResult {
  let iterations: readonly TransitionSoakIteration[];
  let baselines: {
    readonly flux: TransitionFamilyBaseline;
    readonly ltx: TransitionFamilyBaseline;
  };
  let thresholds: TransitionSoakThresholds;
  let requestedTransitionCount: number;
  let runnerProfile: string;

  if ("iterations" in iterationsOrOptions) {
    iterations = iterationsOrOptions.iterations;
    baselines = iterationsOrOptions.baselines;
    thresholds = iterationsOrOptions.thresholds;
    requestedTransitionCount = iterationsOrOptions.requestedTransitionCount ?? 10;
    runnerProfile = iterationsOrOptions.runnerProfile ?? "dynamicvram-offload-v1";
  } else {
    iterations = iterationsOrOptions;
    baselines = baselinesArg!;
    thresholds = thresholdsArg!;
    requestedTransitionCount = optionsArg?.requestedTransitionCount ?? 10;
    runnerProfile = optionsArg?.runnerProfile ?? "dynamicvram-offload-v1";
  }

  // 1. Process identity stability and restart tracking
  let renderFailureCount = 0;
  let cleanupFailureCount = 0;
  let samplingErrorCount = 0;
  let oomCount = 0;
  let unexpectedRestartCount = 0;

  let initialPid: number | null = null;
  let initialStartTimeTicks: number | null = null;

  for (const iter of iterations) {
    if (iter.render.status !== "succeeded" || iter.failure !== null) {
      renderFailureCount++;
    }
    if (!iter.cleanup.passed || iter.cleanup.postUnloadFreeVramMb === null) {
      cleanupFailureCount++;
    }
    samplingErrorCount += iter.telemetry.samplingErrors.length;
    if (iter.oomDetected) {
      oomCount++;
    }

    let iterationRestarted = iter.comfyUiRestarted;
    for (const sample of iter.telemetry.samples) {
      if (initialPid === null) {
        initialPid = sample.host.processPid;
        initialStartTimeTicks = sample.host.processStartTimeTicks;
      } else if (
        sample.host.processPid !== initialPid ||
        sample.host.processStartTimeTicks !== initialStartTimeTicks
      ) {
        iterationRestarted = true;
      }
    }
    if (iterationRestarted) {
      unexpectedRestartCount++;
    }
  }

  // 2. Completed transitions calculation (strict sequence of completed transitions)
  let completedTransitionCount = 0;
  if (iterations.length > 0) {
    const initialRender = iterations[0];
    const initialPassed =
      initialRender?.render.status === "succeeded" &&
      initialRender.cleanup.passed &&
      !initialRender.oomDetected &&
      !initialRender.comfyUiRestarted &&
      initialRender.failure === null;

    if (initialPassed) {
      for (let i = 1; i < iterations.length; i++) {
        const iter = iterations[i]!;
        const iterPassed =
          iter.render.status === "succeeded" &&
          iter.cleanup.passed &&
          !iter.oomDetected &&
          !iter.comfyUiRestarted &&
          iter.failure === null &&
          iter.telemetry.samplingErrors.length === 0;

        if (iterPassed) {
          completedTransitionCount++;
        } else {
          break;
        }
      }
    }
  }

  // 3. Global Peaks
  let peakVramMb: number | null = null;
  let peakHostRamUsedMb: number | null = null;
  let peakProcessRssMb: number | null = null;

  for (const iter of iterations) {
    if (iter.telemetry.peakVramMb !== null) {
      peakVramMb =
        peakVramMb === null
          ? iter.telemetry.peakVramMb
          : Math.max(peakVramMb, iter.telemetry.peakVramMb);
    }
    if (iter.telemetry.peakHostRamUsedMb !== null) {
      peakHostRamUsedMb =
        peakHostRamUsedMb === null
          ? iter.telemetry.peakHostRamUsedMb
          : Math.max(peakHostRamUsedMb, iter.telemetry.peakHostRamUsedMb);
    }
    if (iter.telemetry.peakProcessRssMb !== null) {
      peakProcessRssMb =
        peakProcessRssMb === null
          ? iter.telemetry.peakProcessRssMb
          : Math.max(peakProcessRssMb, iter.telemetry.peakProcessRssMb);
    }
  }

  // 4. Global Deltas (Across first sample of first iteration and last sample of last iteration)
  let firstSample: CertificationTelemetrySample | undefined;
  let lastSample: CertificationTelemetrySample | undefined;

  for (const iter of iterations) {
    if (iter.telemetry.samples.length > 0) {
      if (!firstSample) {
        firstSample = iter.telemetry.samples[0];
      }
      lastSample = iter.telemetry.samples[iter.telemetry.samples.length - 1];
    }
  }

  let swapUsedDeltaMb: number | null = null;
  let systemSwapInPageDelta: number | null = null;
  let systemSwapOutPageDelta: number | null = null;
  let systemMajorPageFaultDelta: number | null = null;
  let systemMinorPageFaultDelta: number | null = null;
  let processMajorPageFaultDelta: number | null = null;
  let processMinorPageFaultDelta: number | null = null;

  if (firstSample && lastSample) {
    swapUsedDeltaMb = calculateNonNegativeDelta(
      firstSample.host.swapUsedMb,
      lastSample.host.swapUsedMb
    );
    systemSwapInPageDelta = calculateNonNegativeDelta(
      firstSample.host.systemSwapInPages,
      lastSample.host.systemSwapInPages
    );
    systemSwapOutPageDelta = calculateNonNegativeDelta(
      firstSample.host.systemSwapOutPages,
      lastSample.host.systemSwapOutPages
    );
    systemMajorPageFaultDelta = calculateNonNegativeDelta(
      firstSample.host.systemMajorPageFaults,
      lastSample.host.systemMajorPageFaults
    );
    systemMinorPageFaultDelta = calculateNonNegativeDelta(
      firstSample.host.systemMinorPageFaults,
      lastSample.host.systemMinorPageFaults
    );

    const isSameProcess =
      firstSample.host.processPid === lastSample.host.processPid &&
      firstSample.host.processStartTimeTicks === lastSample.host.processStartTimeTicks;

    processMajorPageFaultDelta = isSameProcess
      ? calculateNonNegativeDelta(
          firstSample.host.processMajorPageFaults,
          lastSample.host.processMajorPageFaults
        )
      : null;

    processMinorPageFaultDelta = isSameProcess
      ? calculateNonNegativeDelta(
          firstSample.host.processMinorPageFaults,
          lastSample.host.processMinorPageFaults
        )
      : null;
  }

  // 5. Family-Normalized Growth
  const fluxIterations = iterations.filter((it) => it.family === "flux");
  const ltxIterations = iterations.filter((it) => it.family === "ltx");

  const computeFamilyGrowth = (
    familyIters: readonly TransitionSoakIteration[],
    metricExtractor: (it: TransitionSoakIteration) => number | null
  ): number | null => {
    if (familyIters.length < 2) return null;
    const first = metricExtractor(familyIters[0]!);
    const last = metricExtractor(familyIters[familyIters.length - 1]!);
    if (first === null || last === null) return null;
    return last - first;
  };

  const sameFamilyPeakVramGrowthMb = {
    flux: computeFamilyGrowth(fluxIterations, (it) => it.telemetry.peakVramMb),
    ltx: computeFamilyGrowth(ltxIterations, (it) => it.telemetry.peakVramMb)
  };

  const sameFamilyPeakHostRamGrowthMb = {
    flux: computeFamilyGrowth(fluxIterations, (it) => it.telemetry.peakHostRamUsedMb),
    ltx: computeFamilyGrowth(ltxIterations, (it) => it.telemetry.peakHostRamUsedMb)
  };

  const sameFamilyPeakProcessRssGrowthMb = {
    flux: computeFamilyGrowth(fluxIterations, (it) => it.telemetry.peakProcessRssMb),
    ltx: computeFamilyGrowth(ltxIterations, (it) => it.telemetry.peakProcessRssMb)
  };

  // 6. Post-Unload Settling Growth
  let postUnloadUsedVramGrowthMb: number | null = null;
  let postUnloadHostRamGrowthMb: number | null = null;
  let postUnloadProcessRssGrowthMb: number | null = null;

  if (iterations.length >= 2) {
    const firstIter = iterations[0]!;
    const lastIter = iterations[iterations.length - 1]!;

    if (
      firstIter.telemetry.postUnloadUsedVramMb !== null &&
      lastIter.telemetry.postUnloadUsedVramMb !== null
    ) {
      postUnloadUsedVramGrowthMb =
        lastIter.telemetry.postUnloadUsedVramMb - firstIter.telemetry.postUnloadUsedVramMb;
    }

    const firstPostUnloadSample = firstIter.telemetry.samples.findLast(
      (s) => s.phase === "post_unload"
    );
    const lastPostUnloadSample = lastIter.telemetry.samples.findLast(
      (s) => s.phase === "post_unload"
    );

    if (firstPostUnloadSample && lastPostUnloadSample) {
      postUnloadHostRamGrowthMb =
        lastPostUnloadSample.host.hostRamUsedMb - firstPostUnloadSample.host.hostRamUsedMb;
      postUnloadProcessRssGrowthMb =
        lastPostUnloadSample.host.processRssMb - firstPostUnloadSample.host.processRssMb;
    }
  }

  // 7. Latency Degradation
  const computeLatencyDegradation = (
    familyIters: readonly TransitionSoakIteration[],
    baselineDurationMs: number
  ): number | null => {
    const durations = familyIters
      .filter((it) => it.render.status === "succeeded" && it.render.totalDurationMs !== null)
      .map((it) => it.render.totalDurationMs!);

    const medianDuration = calculateMedian(durations);
    if (medianDuration === null) return null;
    return ((medianDuration - baselineDurationMs) / baselineDurationMs) * 100;
  };

  const latencyDegradationPercent = {
    flux: computeLatencyDegradation(fluxIterations, baselines.flux.baselineDurationMs),
    ltx: computeLatencyDegradation(ltxIterations, baselines.ltx.baselineDurationMs)
  };

  const aggregates: TransitionSoakAggregates = {
    peakVramMb,
    peakHostRamUsedMb,
    peakProcessRssMb,
    swapUsedDeltaMb,
    systemSwapInPageDelta,
    systemSwapOutPageDelta,
    systemMajorPageFaultDelta,
    systemMinorPageFaultDelta,
    processMajorPageFaultDelta,
    processMinorPageFaultDelta,
    renderFailureCount,
    cleanupFailureCount,
    samplingErrorCount,
    oomCount,
    unexpectedRestartCount,
    sameFamilyPeakVramGrowthMb,
    sameFamilyPeakHostRamGrowthMb,
    sameFamilyPeakProcessRssGrowthMb,
    postUnloadUsedVramGrowthMb,
    postUnloadHostRamGrowthMb,
    postUnloadProcessRssGrowthMb,
    latencyDegradationPercent
  };

  // 8. Gate Checks Evaluation
  const completedRequiredTransitions =
    completedTransitionCount >= requestedTransitionCount &&
    iterations.length === requestedTransitionCount + 1;

  const allRendersSuccessful =
    iterations.length > 0 &&
    renderFailureCount === 0 &&
    iterations.every(
      (it) =>
        it.render.status === "succeeded" &&
        it.render.executionId !== null &&
        it.render.startedAt !== null &&
        it.render.completedAt !== null &&
        it.render.totalDurationMs !== null &&
        it.render.totalDurationMs >= 0 &&
        it.failure === null
    );

  const allCleanupsSuccessful =
    iterations.length > 0 &&
    cleanupFailureCount === 0 &&
    iterations.every((it) => it.cleanup.passed && it.cleanup.postUnloadFreeVramMb !== null);

  const noOom =
    iterations.length > 0 && oomCount === 0 && iterations.every((it) => !it.oomDetected);

  const noUnexpectedRestarts =
    iterations.length > 0 &&
    unexpectedRestartCount === 0 &&
    iterations.every((it) => !it.comfyUiRestarted);

  const noSamplingErrors =
    iterations.length > 0 &&
    samplingErrorCount === 0 &&
    iterations.every(
      (it) => it.telemetry.samplingErrors.length === 0 && it.telemetry.samples.length > 0
    );

  const swapActivity = classifySwapActivity(iterations);
  const noSwapActivity = swapActivity !== "sustained";

  const postUnloadVramHeadroomMet =
    iterations.length > 0 &&
    iterations.every(
      (it) =>
        it.cleanup.postUnloadFreeVramMb !== null &&
        it.cleanup.postUnloadFreeVramMb >= thresholds.minPostUnloadFreeVramMb &&
        it.telemetry.postUnloadFreeVramMb !== null &&
        it.telemetry.postUnloadFreeVramMb >= thresholds.minPostUnloadFreeVramMb
    );

  const hostMemoryHeadroomMet =
    iterations.length > 0 &&
    iterations.every(
      (it) =>
        it.telemetry.samples.length > 0 &&
        it.telemetry.samples.every(
          (s) => s.host.hostRamAvailableMb >= thresholds.minHostAvailableMb
        )
    );

  const vramGrowthWithinTolerance =
    sameFamilyPeakVramGrowthMb.flux !== null &&
    sameFamilyPeakVramGrowthMb.flux <= thresholds.maxVramGrowthMb &&
    sameFamilyPeakVramGrowthMb.ltx !== null &&
    sameFamilyPeakVramGrowthMb.ltx <= thresholds.maxVramGrowthMb &&
    postUnloadUsedVramGrowthMb !== null &&
    postUnloadUsedVramGrowthMb <= thresholds.maxVramGrowthMb;

  const hostGrowthWithinTolerance =
    sameFamilyPeakHostRamGrowthMb.flux !== null &&
    sameFamilyPeakHostRamGrowthMb.flux <= thresholds.maxHostGrowthMb &&
    sameFamilyPeakHostRamGrowthMb.ltx !== null &&
    sameFamilyPeakHostRamGrowthMb.ltx <= thresholds.maxHostGrowthMb &&
    sameFamilyPeakProcessRssGrowthMb.flux !== null &&
    sameFamilyPeakProcessRssGrowthMb.flux <= thresholds.maxHostGrowthMb &&
    sameFamilyPeakProcessRssGrowthMb.ltx !== null &&
    sameFamilyPeakProcessRssGrowthMb.ltx <= thresholds.maxHostGrowthMb &&
    postUnloadHostRamGrowthMb !== null &&
    postUnloadHostRamGrowthMb <= thresholds.maxHostGrowthMb &&
    postUnloadProcessRssGrowthMb !== null &&
    postUnloadProcessRssGrowthMb <= thresholds.maxHostGrowthMb;

  const latencyWithinTolerance =
    latencyDegradationPercent.flux !== null &&
    latencyDegradationPercent.flux <= thresholds.maxLatencyDegradationPercent &&
    latencyDegradationPercent.ltx !== null &&
    latencyDegradationPercent.ltx <= thresholds.maxLatencyDegradationPercent;

  const checks: TransitionSoakGateChecks = {
    completedRequiredTransitions,
    allRendersSuccessful,
    allCleanupsSuccessful,
    noOom,
    noUnexpectedRestarts,
    noSamplingErrors,
    noSwapActivity,
    postUnloadVramHeadroomMet,
    hostMemoryHeadroomMet,
    vramGrowthWithinTolerance,
    hostGrowthWithinTolerance,
    latencyWithinTolerance
  };

  const gatePassed = Object.values(checks).every(Boolean);

  const gate: TransitionSoakGate = {
    passed: gatePassed,
    checks
  };

  if (gatePassed) {
    return {
      status: "passed",
      completedTransitionCount,
      aggregates,
      gate,
      hostRamDecision: "support_32gb",
      selectedRunnerProfile: runnerProfile,
      failure: null
    };
  }

  // Identify failed checks for structured failure
  const failedCheckNames = Object.entries(checks)
    .filter(([_, passed]) => !passed)
    .map(([name]) => name);

  const firstIterationFailure = iterations.find((it) => it.failure !== null)?.failure;

  const failure: CertificationFailure = firstIterationFailure ?? {
    phase: "transition_soak_gate",
    code: "TRANSITION_SOAK_FAILED",
    message: `Transition soak failed gate checks: ${failedCheckNames.join(", ")}`,
    details: {
      failedChecks: failedCheckNames,
      renderFailureCount,
      cleanupFailureCount,
      oomCount,
      unexpectedRestartCount,
      samplingErrorCount
    }
  };

  return {
    status: "failed",
    completedTransitionCount,
    aggregates,
    gate,
    hostRamDecision: "require_64gb",
    selectedRunnerProfile: null,
    failure
  };
}

/**
 * Renders a Markdown summary exclusively from the parsed transition soak artifact.
 * Preserves all per-iteration measurements and outliers alongside gate checks and decisions.
 */
export function renderTransitionSoakSummary(artifact: TransitionSoakArtifact): string {
  const statusBadge = artifact.status === "passed" ? "PASSED" : "FAILED";
  const gateBadge = artifact.gate.passed ? "PASSED" : "FAILED";
  const decisionBadge =
    artifact.hostRamDecision === "support_32gb"
      ? "32GB Supported (Phase 1)"
      : "64GB Required (Phase 1 Prerequisite)";

  const formatVal = (val: number | null | undefined, unit = ""): string => {
    if (val === null || val === undefined) return "N/A";
    const formatted = val.toLocaleString("en-US");
    return unit ? `${formatted} ${unit}` : formatted;
  };

  const formatPercent = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "N/A";
    return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
  };

  const formatCheck = (passed: boolean): string => (passed ? "PASS" : "FAIL");

  const swapActivity = classifySwapActivity(artifact.iterations);
  let swapActivityLabel: string;
  if (!artifact.gate.checks.noSwapActivity) {
    if (swapActivity === "sustained") {
      swapActivityLabel = "Sustained (FAIL)";
    } else if (swapActivity === "transient") {
      swapActivityLabel = "Transient (FAIL - Legacy Strict Policy)";
    } else {
      swapActivityLabel = "None (FAIL - Legacy Strict Policy)";
    }
  } else {
    swapActivityLabel =
      swapActivity === "none"
        ? "None (PASS)"
        : swapActivity === "transient"
          ? "Transient (PASS)"
          : "Sustained (PASS)";
  }

  const lines: string[] = [
    `# FLUX ↔ LTX Transition Soak Certification Summary`,
    ``,
    `**Run ID:** \`${artifact.runId}\`  `,
    `**Generated At:** \`${artifact.generatedAt}\`  `,
    `**Status:** **${statusBadge}**  `,
    `**Host RAM Decision:** **${decisionBadge}** (\`${artifact.hostRamDecision}\`)  `,
    `**Runner Profile:** \`${artifact.runnerProfile}\`  `,
    `**Selected Profile:** \`${artifact.selectedRunnerProfile ?? "None (Failed Gate)"}\`  `,
    `**Completed Transitions:** ${artifact.completedTransitionCount} / ${artifact.requestedTransitionCount} (Total Renders: ${artifact.iterations.length})  `,
    ``,
    `## Workload & Hardware Identity`,
    ``,
    `### Host Hardware & Environment`,
    `- **GPU:** ${artifact.environment.gpuName} (${formatVal(artifact.environment.gpuTotalMemoryMb, "MB")}, Driver ${artifact.environment.gpuDriverVersion}, CUDA ${artifact.environment.cudaVersion ?? "N/A"})`,
    `- **Host CPU & RAM:** ${artifact.environment.cpuModel} (${artifact.environment.cpuCount} CPUs), ${artifact.environment.osRelease} (${artifact.environment.platform}/${artifact.environment.arch})`,
    `- **Node Version:** \`${artifact.environment.nodeVersion}\``,
    `- **ComfyUI PID:** \`${artifact.environment.comfyUiPid}\``,
    `- **ComfyUI Startup Args:** \`${artifact.environment.comfyUiArgs.join(" ")}\``,
    ``,
    `### FLUX Workload Identity (\`${artifact.identities.flux.profileId}\`)`,
    `- **Engine & Dimensions:** \`${artifact.identities.flux.engine}\` (${artifact.identities.flux.width}x${artifact.identities.flux.height}, ${artifact.identities.flux.frames} frame, ${artifact.identities.flux.steps} steps)`,
    `- **Workflow SHA-256:** \`${artifact.identities.flux.workflowSha256}\``,
    `- **ComfyUI Commit:** \`${artifact.identities.flux.comfyUiCommit}\``,
    `- **Measured Footprint:** ${artifact.identities.flux.measuredDiskFootprintGb} GB (Min Free Disk: ${artifact.identities.flux.minFreeDiskGb} GB)`,
    ``,
    `### LTX Workload Identity (\`${artifact.identities.ltx.profileId}\`)`,
    `- **Profile Key:** \`${artifact.identities.ltx.renderProfileKey ?? "N/A"}\` (v${artifact.identities.ltx.renderProfileVersion ?? "N/A"})`,
    `- **Engine & Dimensions:** \`${artifact.identities.ltx.engine}\` (${artifact.identities.ltx.width}x${artifact.identities.ltx.height}, ${artifact.identities.ltx.frames} frames, ${artifact.identities.ltx.steps} steps)`,
    `- **Workflow SHA-256:** \`${artifact.identities.ltx.workflowSha256}\``,
    `- **ComfyUI Commit:** \`${artifact.identities.ltx.comfyUiCommit}\``,
    `- **Measured Footprint:** ${artifact.identities.ltx.measuredDiskFootprintGb} GB (Min Free Disk: ${artifact.identities.ltx.minFreeDiskGb} GB)`,
    ``,
    `## Configured Thresholds`,
    ``,
    `| Threshold Parameter | Configured Limit | Description |`,
    `| :--- | :--- | :--- |`,
    `| **Min Post-Unload Free VRAM** | ${formatVal(artifact.thresholds.minPostUnloadFreeVramMb, "MB")} | Minimum free GPU memory required after model unload |`,
    `| **Min Host Available RAM** | ${formatVal(artifact.thresholds.minHostAvailableMb, "MB")} | Minimum available host system RAM at all times |`,
    `| **Max VRAM Growth** | ${formatVal(artifact.thresholds.maxVramGrowthMb, "MB")} | Maximum allowable same-family / post-unload VRAM growth |`,
    `| **Max Host / RSS Growth** | ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | Maximum allowable same-family / post-unload Host RAM or RSS growth |`,
    `| **Max Latency Degradation** | ${artifact.thresholds.maxLatencyDegradationPercent}% | Maximum median latency increase vs single-family baselines |`,
    `| **Cleanup Timeout** | ${formatVal(artifact.thresholds.cleanupTimeoutMs, "ms")} | Maximum duration to await post-unload VRAM headroom |`,
    `| **Cleanup Poll Interval** | ${formatVal(artifact.thresholds.cleanupPollIntervalMs, "ms")} | Telemetry polling interval during post-unload settle |`,
    ``,
    `## Resource Gate Evaluation`,
    ``,
    `**Gate Status:** **${gateBadge}**  `,
    ``,
    `| Gate Check | Status | Description |`,
    `| :--- | :--- | :--- |`,
    `| **Completed Required Transitions** | ${formatCheck(artifact.gate.checks.completedRequiredTransitions)} | Executed initial FLUX render plus ${artifact.requestedTransitionCount} strict switches (${artifact.completedTransitionCount} completed) |`,
    `| **All Renders Successful** | ${formatCheck(artifact.gate.checks.allRendersSuccessful)} | Every render completed with status 'succeeded' and non-null execution ID |`,
    `| **All Cleanups Successful** | ${formatCheck(artifact.gate.checks.allCleanupsSuccessful)} | Every post-render model unload passed within timeout |`,
    `| **No OOM Detected** | ${formatCheck(artifact.gate.checks.noOom)} | Zero CUDA or host Out-Of-Memory errors detected (OOM count: ${artifact.aggregates.oomCount}) |`,
    `| **No Unexpected Restarts** | ${formatCheck(artifact.gate.checks.noUnexpectedRestarts)} | Zero process restarts or PID identity changes (Restart count: ${artifact.aggregates.unexpectedRestartCount}) |`,
    `| **No Sampling Errors** | ${formatCheck(artifact.gate.checks.noSamplingErrors)} | All telemetry intervals collected without sampling errors (Error count: ${artifact.aggregates.samplingErrorCount}) |`,
    `| **Swap Activity** | ${swapActivityLabel} | None or transient activity passes; recurrent or non-decaying activity is sustained and fails |`,
    `| **Post-Unload VRAM Headroom Met** | ${formatCheck(artifact.gate.checks.postUnloadVramHeadroomMet)} | Free VRAM after unload >= ${formatVal(artifact.thresholds.minPostUnloadFreeVramMb, "MB")} across every iteration |`,
    `| **Host Memory Headroom Met** | ${formatCheck(artifact.gate.checks.hostMemoryHeadroomMet)} | Host available RAM >= ${formatVal(artifact.thresholds.minHostAvailableMb, "MB")} across every sample |`,
    `| **VRAM Growth Within Tolerance** | ${formatCheck(artifact.gate.checks.vramGrowthWithinTolerance)} | Same-family and post-unload VRAM growth <= ${formatVal(artifact.thresholds.maxVramGrowthMb, "MB")} |`,
    `| **Host Growth Within Tolerance** | ${formatCheck(artifact.gate.checks.hostGrowthWithinTolerance)} | Same-family and post-unload Host RAM and RSS growth <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} |`,
    `| **Latency Within Tolerance** | ${formatCheck(artifact.gate.checks.latencyWithinTolerance)} | Median duration degradation <= ${artifact.thresholds.maxLatencyDegradationPercent}% vs single-family baselines |`,
    ``,
    `## Transition Sequence & Raw Iteration Evidence`,
    ``,
    `*All measured values per render are preserved below to maintain visibility into outliers and spikes.*`,
    ``,
    `| # | Transition | Family | Status | Render Dur | Peak VRAM | Post Free VRAM | Peak Host RAM | Peak RSS | Swap Delta | Major/Minor Faults | Cleanup | OOM/Restart |`,
    `| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`
  ];

  for (const iter of artifact.iterations) {
    const transitionLabel =
      iter.transitionIndex === null
        ? "Initial (FLUX)"
        : `#${iter.transitionIndex} (${iter.fromFamily}→${iter.family})`;
    const statusLabel = iter.render.status === "succeeded" ? "OK" : "FAIL";
    const renderDur = formatVal(iter.render.totalDurationMs, "ms");
    const peakVram = formatVal(iter.telemetry.peakVramMb, "MB");
    const postFree = formatVal(iter.telemetry.postUnloadFreeVramMb, "MB");
    const peakHost = formatVal(iter.telemetry.peakHostRamUsedMb, "MB");
    const peakRss = formatVal(iter.telemetry.peakProcessRssMb, "MB");
    const swapDelta = `${formatVal(iter.telemetry.swapUsedDeltaMb, "MB")} (in:${iter.telemetry.systemSwapInPageDelta ?? 0}/out:${iter.telemetry.systemSwapOutPageDelta ?? 0})`;
    const faults = `${iter.telemetry.processMajorPageFaultDelta ?? 0} / ${formatVal(iter.telemetry.processMinorPageFaultDelta)}`;
    const cleanupLabel = `${iter.cleanup.passed ? "PASS" : "FAIL"} (${formatVal(iter.cleanup.durationMs, "ms")}, ${iter.cleanup.attempts} att)`;
    const oomRestart = `${iter.oomDetected ? "OOM" : "No OOM"} / ${iter.comfyUiRestarted ? "Restart" : "Stable"}`;

    lines.push(
      `| ${iter.renderIndex} | ${transitionLabel} | ${iter.family.toUpperCase()} | ${statusLabel} | ${renderDur} | ${peakVram} | ${postFree} | ${peakHost} | ${peakRss} | ${swapDelta} | ${faults} | ${cleanupLabel} | ${oomRestart} |`
    );
  }

  lines.push(
    ``,
    `## Aggregate Stability, Growth & Latency Comparisons`,
    ``,
    `### Progressive Memory Growth (Family-Normalized)`,
    ``,
    `| Metric Dimension | Measured Growth | Tolerance Limit | Result |`,
    `| :--- | :--- | :--- | :--- |`,
    `| **FLUX Peak VRAM Growth** | ${formatVal(artifact.aggregates.sameFamilyPeakVramGrowthMb.flux, "MB")} | <= ${formatVal(artifact.thresholds.maxVramGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.sameFamilyPeakVramGrowthMb.flux !== null && artifact.aggregates.sameFamilyPeakVramGrowthMb.flux <= artifact.thresholds.maxVramGrowthMb)} |`,
    `| **LTX Peak VRAM Growth** | ${formatVal(artifact.aggregates.sameFamilyPeakVramGrowthMb.ltx, "MB")} | <= ${formatVal(artifact.thresholds.maxVramGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.sameFamilyPeakVramGrowthMb.ltx !== null && artifact.aggregates.sameFamilyPeakVramGrowthMb.ltx <= artifact.thresholds.maxVramGrowthMb)} |`,
    `| **FLUX Peak Host RAM Growth** | ${formatVal(artifact.aggregates.sameFamilyPeakHostRamGrowthMb.flux, "MB")} | <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.sameFamilyPeakHostRamGrowthMb.flux !== null && artifact.aggregates.sameFamilyPeakHostRamGrowthMb.flux <= artifact.thresholds.maxHostGrowthMb)} |`,
    `| **LTX Peak Host RAM Growth** | ${formatVal(artifact.aggregates.sameFamilyPeakHostRamGrowthMb.ltx, "MB")} | <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.sameFamilyPeakHostRamGrowthMb.ltx !== null && artifact.aggregates.sameFamilyPeakHostRamGrowthMb.ltx <= artifact.thresholds.maxHostGrowthMb)} |`,
    `| **FLUX Peak Process RSS Growth** | ${formatVal(artifact.aggregates.sameFamilyPeakProcessRssGrowthMb.flux, "MB")} | <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.sameFamilyPeakProcessRssGrowthMb.flux !== null && artifact.aggregates.sameFamilyPeakProcessRssGrowthMb.flux <= artifact.thresholds.maxHostGrowthMb)} |`,
    `| **LTX Peak Process RSS Growth** | ${formatVal(artifact.aggregates.sameFamilyPeakProcessRssGrowthMb.ltx, "MB")} | <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.sameFamilyPeakProcessRssGrowthMb.ltx !== null && artifact.aggregates.sameFamilyPeakProcessRssGrowthMb.ltx <= artifact.thresholds.maxHostGrowthMb)} |`,
    `| **Post-Unload Used VRAM Growth** | ${formatVal(artifact.aggregates.postUnloadUsedVramGrowthMb, "MB")} | <= ${formatVal(artifact.thresholds.maxVramGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.postUnloadUsedVramGrowthMb !== null && artifact.aggregates.postUnloadUsedVramGrowthMb <= artifact.thresholds.maxVramGrowthMb)} |`,
    `| **Post-Unload Host RAM Growth** | ${formatVal(artifact.aggregates.postUnloadHostRamGrowthMb, "MB")} | <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.postUnloadHostRamGrowthMb !== null && artifact.aggregates.postUnloadHostRamGrowthMb <= artifact.thresholds.maxHostGrowthMb)} |`,
    `| **Post-Unload Process RSS Growth** | ${formatVal(artifact.aggregates.postUnloadProcessRssGrowthMb, "MB")} | <= ${formatVal(artifact.thresholds.maxHostGrowthMb, "MB")} | ${formatCheck(artifact.aggregates.postUnloadProcessRssGrowthMb !== null && artifact.aggregates.postUnloadProcessRssGrowthMb <= artifact.thresholds.maxHostGrowthMb)} |`,
    ``,
    `### Latency Degradation vs Single-Family Baselines`,
    ``,
    `| Family | Baseline Duration | Soak Median Duration | Degradation % | Max Allowed | Result |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- |`,
    `| **FLUX** | ${formatVal(artifact.baselines.flux.baselineDurationMs, "ms")} | ${
      artifact.aggregates.latencyDegradationPercent.flux !== null
        ? `${formatVal(Math.round(artifact.baselines.flux.baselineDurationMs * (1 + artifact.aggregates.latencyDegradationPercent.flux / 100)), "ms")}`
        : "N/A"
    } | ${formatPercent(artifact.aggregates.latencyDegradationPercent.flux)} | <= +${artifact.thresholds.maxLatencyDegradationPercent}% | ${formatCheck(artifact.aggregates.latencyDegradationPercent.flux !== null && artifact.aggregates.latencyDegradationPercent.flux <= artifact.thresholds.maxLatencyDegradationPercent)} |`,
    `| **LTX** | ${formatVal(artifact.baselines.ltx.baselineDurationMs, "ms")} | ${
      artifact.aggregates.latencyDegradationPercent.ltx !== null
        ? `${formatVal(Math.round(artifact.baselines.ltx.baselineDurationMs * (1 + artifact.aggregates.latencyDegradationPercent.ltx / 100)), "ms")}`
        : "N/A"
    } | ${formatPercent(artifact.aggregates.latencyDegradationPercent.ltx)} | <= +${artifact.thresholds.maxLatencyDegradationPercent}% | ${formatCheck(artifact.aggregates.latencyDegradationPercent.ltx !== null && artifact.aggregates.latencyDegradationPercent.ltx <= artifact.thresholds.maxLatencyDegradationPercent)} |`,
    ``
  );

  if (artifact.failure) {
    lines.push(
      `## Failure Details`,
      ``,
      `- **Phase:** \`${artifact.failure.phase}\``,
      `- **Code:** \`${artifact.failure.code}\``,
      `- **Message:** ${artifact.failure.message}`,
      `- **Details:** \`${JSON.stringify(artifact.failure.details ?? {})}\``,
      ``
    );
  }

  lines.push(
    `## Phase 1 Host RAM & Runner Profile Decision`,
    ``,
    `- **Host RAM Requirement Decision:** **${artifact.hostRamDecision.toUpperCase()}** (${decisionBadge})`,
    `- **Selected Runner Profile:** \`${artifact.selectedRunnerProfile ?? "None"}\``,
    `- **Decision Rationale:** ${
      artifact.gate.passed
        ? `All ${artifact.requestedTransitionCount} required transitions succeeded with no sustained swap activity, zero OOM errors, stable ComfyUI process identity, observed post-unload headroom, memory growth within ${artifact.thresholds.maxVramGrowthMb} MB, and latency within ${artifact.thresholds.maxLatencyDegradationPercent}% of single-family baselines.`
        : `Soak gate checks failed (${Object.entries(artifact.gate.checks)
            .filter(([_, p]) => !p)
            .map(([k]) => k)
            .join(
              ", "
            )}). Phase 1 production configuration requires 64GB host RAM before freezing production profile.`
    }`,
    ``
  );

  return lines.join("\n");
}
