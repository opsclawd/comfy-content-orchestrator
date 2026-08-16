import type {
  CertificationFailure,
  CertificationGate,
  CertificationGateChecks,
  CertificationRenderExecution,
  CertificationSamplingError,
  CertificationTelemetryData,
  CertificationTelemetrySample,
  LtxCertificationArtifact
} from "@cco/contracts";

export interface AggregateCertificationTelemetryOptions {
  readonly samples: readonly CertificationTelemetrySample[];
  readonly samplingErrors?: readonly CertificationSamplingError[];
  readonly sampleIntervalMs?: number;
}

function calculateNonNegativeDelta(first: number, last: number): number | null {
  const delta = last - first;
  return delta >= 0 ? delta : null;
}

/**
 * Aggregates raw paired GPU and host telemetry samples into peak and delta metrics.
 * Non-negative deltas require stable window edges and stable process identities.
 * Missing samples or counter resets yield null aggregates.
 */
export function aggregateCertificationTelemetry(
  options: AggregateCertificationTelemetryOptions
): CertificationTelemetryData;
export function aggregateCertificationTelemetry(
  samples: readonly CertificationTelemetrySample[],
  samplingErrors?: readonly CertificationSamplingError[],
  sampleIntervalMs?: number
): CertificationTelemetryData;
export function aggregateCertificationTelemetry(
  samplesOrOptions:
    readonly CertificationTelemetrySample[] | AggregateCertificationTelemetryOptions,
  samplingErrorsArg?: readonly CertificationSamplingError[],
  sampleIntervalMsArg?: number
): CertificationTelemetryData {
  let samples: readonly CertificationTelemetrySample[];
  let samplingErrors: readonly CertificationSamplingError[];
  let sampleIntervalMs: number;

  if ("samples" in samplesOrOptions) {
    samples = samplesOrOptions.samples;
    samplingErrors = samplesOrOptions.samplingErrors ?? [];
    sampleIntervalMs = samplesOrOptions.sampleIntervalMs ?? 200;
  } else {
    samples = samplesOrOptions;
    samplingErrors = samplingErrorsArg ?? [];
    sampleIntervalMs = sampleIntervalMsArg ?? 200;
  }

  if (samples.length === 0) {
    return {
      sampleIntervalMs: sampleIntervalMs as 200,
      samples: samples.map((s) => ({
        ...s,
        gpu: { ...s.gpu },
        host: { ...s.host }
      })),
      samplingErrors: samplingErrors.map((e) => ({ ...e })),
      peakVramMb: null,
      peakHostRamUsedMb: null,
      peakProcessRssMb: null,
      swapUsedDeltaMb: null,
      systemSwapInPageDelta: null,
      systemSwapOutPageDelta: null,
      systemMajorPageFaultDelta: null,
      systemMinorPageFaultDelta: null,
      processMajorPageFaultDelta: null,
      processMinorPageFaultDelta: null,
      postUnloadUsedVramMb: null,
      postUnloadFreeVramMb: null
    };
  }

  let peakVramMb = 0;
  let peakHostRamUsedMb = 0;
  let peakProcessRssMb = 0;

  for (const sample of samples) {
    if (sample.gpu.usedVramMb > peakVramMb) {
      peakVramMb = sample.gpu.usedVramMb;
    }
    if (sample.host.hostRamUsedMb > peakHostRamUsedMb) {
      peakHostRamUsedMb = sample.host.hostRamUsedMb;
    }
    if (sample.host.processRssMb > peakProcessRssMb) {
      peakProcessRssMb = sample.host.processRssMb;
    }
  }

  const first = samples[0]!;
  const last = samples[samples.length - 1]!;

  const swapUsedDeltaMb = calculateNonNegativeDelta(first.host.swapUsedMb, last.host.swapUsedMb);
  const systemSwapInPageDelta = calculateNonNegativeDelta(
    first.host.systemSwapInPages,
    last.host.systemSwapInPages
  );
  const systemSwapOutPageDelta = calculateNonNegativeDelta(
    first.host.systemSwapOutPages,
    last.host.systemSwapOutPages
  );
  const systemMajorPageFaultDelta = calculateNonNegativeDelta(
    first.host.systemMajorPageFaults,
    last.host.systemMajorPageFaults
  );
  const systemMinorPageFaultDelta = calculateNonNegativeDelta(
    first.host.systemMinorPageFaults,
    last.host.systemMinorPageFaults
  );

  const isSameProcess =
    first.host.processPid === last.host.processPid &&
    first.host.processStartTimeTicks === last.host.processStartTimeTicks;

  const processMajorPageFaultDelta = isSameProcess
    ? calculateNonNegativeDelta(first.host.processMajorPageFaults, last.host.processMajorPageFaults)
    : null;

  const processMinorPageFaultDelta = isSameProcess
    ? calculateNonNegativeDelta(first.host.processMinorPageFaults, last.host.processMinorPageFaults)
    : null;

  let postUnloadSample: CertificationTelemetrySample | undefined;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i]!.phase === "post_unload") {
      postUnloadSample = samples[i];
      break;
    }
  }

  const postUnloadUsedVramMb = postUnloadSample ? postUnloadSample.gpu.usedVramMb : null;
  const postUnloadFreeVramMb = postUnloadSample ? postUnloadSample.gpu.freeVramMb : null;

  return {
    sampleIntervalMs: sampleIntervalMs as 200,
    samples: samples.map((s) => ({
      ...s,
      gpu: { ...s.gpu },
      host: { ...s.host }
    })),
    samplingErrors: samplingErrors.map((e) => ({ ...e })),
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
    postUnloadUsedVramMb,
    postUnloadFreeVramMb
  };
}

export interface EvaluateLtxResourceGateOptions {
  readonly render: CertificationRenderExecution;
  readonly telemetry: CertificationTelemetryData;
  readonly failure?: CertificationFailure | null;
  readonly maxDurationMs?: number;
}

/**
 * Evaluates the 5 required certification gate checks:
 * 1. renderSuccess - ComfyUI render status is "succeeded"
 * 2. noOom - No out-of-memory errors occurred
 * 3. durationWithinLimit - Total render duration <= maxDurationMs (inclusive)
 * 4. telemetryComplete - All raw telemetry samples and non-null aggregates present with no errors
 * 5. postUnloadHeadroomObserved - Post-unload settle sample and headroom observed
 */
export function evaluateLtxResourceGate(options: EvaluateLtxResourceGateOptions): CertificationGate;
export function evaluateLtxResourceGate(
  render: CertificationRenderExecution,
  telemetry: CertificationTelemetryData,
  failure?: CertificationFailure | null,
  options?: { maxDurationMs?: number }
): CertificationGate;
export function evaluateLtxResourceGate(
  renderOrOptions: CertificationRenderExecution | EvaluateLtxResourceGateOptions,
  telemetryArg?: CertificationTelemetryData,
  failureArg?: CertificationFailure | null,
  optionsArg?: { maxDurationMs?: number }
): CertificationGate {
  let render: CertificationRenderExecution;
  let telemetry: CertificationTelemetryData;
  let failure: CertificationFailure | null | undefined;
  let maxDurationMs: number;

  if ("render" in renderOrOptions && "telemetry" in renderOrOptions) {
    render = renderOrOptions.render;
    telemetry = renderOrOptions.telemetry;
    failure = renderOrOptions.failure;
    maxDurationMs = renderOrOptions.maxDurationMs ?? 55000;
  } else {
    render = renderOrOptions as CertificationRenderExecution;
    telemetry = telemetryArg!;
    failure = failureArg;
    maxDurationMs = optionsArg?.maxDurationMs ?? 55000;
  }

  const renderSuccess = render.status === "succeeded";

  let isOom = false;
  if (failure) {
    const codeLower = failure.code.toLowerCase();
    const msgLower = failure.message.toLowerCase();
    if (
      codeLower === "oom" ||
      codeLower === "out_of_memory" ||
      codeLower.includes("oom") ||
      codeLower.includes("out_of_memory") ||
      msgLower.includes("out of memory") ||
      msgLower.includes("cuda out of memory") ||
      msgLower.includes("oom")
    ) {
      isOom = true;
    }
    if (failure.details && typeof failure.details === "object") {
      const details = failure.details as Record<string, unknown>;
      if (details.isOom === true || details.oom === true) {
        isOom = true;
      }
    }
  }
  const noOom = !isOom;

  const durationWithinLimit =
    render.totalDurationMs !== null &&
    render.totalDurationMs >= 0 &&
    render.totalDurationMs <= maxDurationMs;

  const telemetryComplete =
    telemetry.samples.length > 0 &&
    telemetry.samplingErrors.length === 0 &&
    telemetry.peakVramMb !== null &&
    telemetry.peakHostRamUsedMb !== null &&
    telemetry.peakProcessRssMb !== null &&
    telemetry.swapUsedDeltaMb !== null &&
    telemetry.systemSwapInPageDelta !== null &&
    telemetry.systemSwapOutPageDelta !== null &&
    telemetry.systemMajorPageFaultDelta !== null &&
    telemetry.systemMinorPageFaultDelta !== null &&
    telemetry.processMajorPageFaultDelta !== null &&
    telemetry.processMinorPageFaultDelta !== null;

  const postUnloadHeadroomObserved =
    telemetry.postUnloadUsedVramMb !== null &&
    telemetry.postUnloadFreeVramMb !== null &&
    telemetry.samples.some((s) => s.phase === "post_unload");

  const checks: CertificationGateChecks = {
    renderSuccess,
    noOom,
    durationWithinLimit,
    telemetryComplete,
    postUnloadHeadroomObserved
  };

  const passed =
    checks.renderSuccess &&
    checks.noOom &&
    checks.durationWithinLimit &&
    checks.telemetryComplete &&
    checks.postUnloadHeadroomObserved;

  return {
    passed,
    maxDurationMs,
    checks
  };
}

/**
 * Renders a Markdown summary exclusively from the parsed certification artifact.
 * Missing/failed values are explicitly labeled. Historical baseline comparison is
 * explicitly labeled as reference-only and never mixed with measured evidence.
 */
export function renderCertificationSummary(artifact: LtxCertificationArtifact): string {
  const statusBadge = artifact.status === "passed" ? "PASSED" : "FAILED";
  const gateBadge = artifact.gate.passed ? "PASSED" : "FAILED";

  const formatVal = (val: number | null, unit = ""): string => {
    if (val === null) return "N/A";
    const formatted = val.toLocaleString("en-US");
    return unit ? `${formatted} ${unit}` : formatted;
  };

  const formatCheck = (passed: boolean): string => (passed ? "PASS" : "FAIL");

  const lines: string[] = [
    `# LTX-2.5 Hardware Certification Summary`,
    ``,
    `**Run ID:** \`${artifact.runId}\`  `,
    `**Generated At:** \`${artifact.generatedAt}\`  `,
    `**Status:** **${statusBadge}**  `,
    `**Runner Mode:** \`${artifact.runnerMode}\`  `,
    ``,
    `## Workload & Hardware Identity`,
    ``,
    `- **Profile Key:** \`${artifact.identity.renderProfileKey}\` (v${artifact.identity.renderProfileVersion})`,
    `- **Profile ID:** \`${artifact.identity.profileId}\``,
    `- **Engine:** \`${artifact.identity.engine}\``,
    `- **Resolution & Frames:** ${artifact.identity.width}x${artifact.identity.height}, ${artifact.identity.frames} frames, ${artifact.identity.steps} steps`,
    `- **ComfyUI Commit:** \`${artifact.identity.comfyUiCommit}\``,
    `- **Workflow SHA-256:** \`${artifact.identity.workflowSha256}\``,
    `- **GPU:** ${artifact.environment.gpuName} (${formatVal(artifact.environment.gpuTotalMemoryMb, "MB")}, Driver ${artifact.environment.gpuDriverVersion}, CUDA ${artifact.environment.cudaVersion ?? "N/A"})`,
    `- **Host:** ${artifact.environment.cpuModel} (${artifact.environment.cpuCount} CPUs), ${artifact.environment.osRelease} (${artifact.environment.platform}/${artifact.environment.arch})`,
    `- **Node Version:** \`${artifact.environment.nodeVersion}\``,
    `- **ComfyUI PID:** \`${artifact.environment.comfyUiPid}\``,
    ``,
    `## Resource Gate Evaluation`,
    ``,
    `**Gate Status:** **${gateBadge}** (Max Duration: ${formatVal(artifact.gate.maxDurationMs, "ms")})`,
    ``,
    `| Check | Status | Description |`,
    `| :--- | :--- | :--- |`,
    `| Render Success | ${formatCheck(artifact.gate.checks.renderSuccess)} | Render execution completed successfully |`,
    `| No OOM Detected | ${formatCheck(artifact.gate.checks.noOom)} | Workload ran without Out-Of-Memory error |`,
    `| Duration Within Limit | ${formatCheck(artifact.gate.checks.durationWithinLimit)} | Render duration (${formatVal(artifact.render.totalDurationMs, "ms")}) <= limit (${formatVal(artifact.gate.maxDurationMs, "ms")}) |`,
    `| Telemetry Complete | ${formatCheck(artifact.gate.checks.telemetryComplete)} | All required GPU and host telemetry metrics captured without errors |`,
    `| Post-Unload Headroom Observed | ${formatCheck(artifact.gate.checks.postUnloadHeadroomObserved)} | Post-unload headroom sample measured after model unload |`,
    ``,
    `## Measured Resource Telemetry`,
    ``,
    `| Metric | Measured Value |`,
    `| :--- | :--- |`,
    `| **Total Render Duration** | ${formatVal(artifact.render.totalDurationMs, "ms")} |`,
    `| **Peak VRAM** | ${formatVal(artifact.telemetry.peakVramMb, "MB")} |`,
    `| **Peak Host RAM Used** | ${formatVal(artifact.telemetry.peakHostRamUsedMb, "MB")} |`,
    `| **Peak Process RSS** | ${formatVal(artifact.telemetry.peakProcessRssMb, "MB")} |`,
    `| **Swap Used Delta** | ${formatVal(artifact.telemetry.swapUsedDeltaMb, "MB")} |`,
    `| **System Swap-In Pages Delta** | ${formatVal(artifact.telemetry.systemSwapInPageDelta)} |`,
    `| **System Swap-Out Pages Delta** | ${formatVal(artifact.telemetry.systemSwapOutPageDelta)} |`,
    `| **System Major Page Faults Delta** | ${formatVal(artifact.telemetry.systemMajorPageFaultDelta)} |`,
    `| **System Minor Page Faults Delta** | ${formatVal(artifact.telemetry.systemMinorPageFaultDelta)} |`,
    `| **Process Major Page Faults Delta** | ${formatVal(artifact.telemetry.processMajorPageFaultDelta)} |`,
    `| **Process Minor Page Faults Delta** | ${formatVal(artifact.telemetry.processMinorPageFaultDelta)} |`,
    `| **Post-Unload Used VRAM** | ${formatVal(artifact.telemetry.postUnloadUsedVramMb, "MB")} |`,
    `| **Post-Unload Free VRAM** | ${formatVal(artifact.telemetry.postUnloadFreeVramMb, "MB")} |`,
    `| **Total Samples Collected** | ${artifact.telemetry.samples.length} |`,
    `| **Sampling Errors** | ${artifact.telemetry.samplingErrors.length} |`,
    ``
  ];

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
    `## Historical Baseline Comparison (Reference Only)`,
    ``,
    `*Note: Historical baseline values are informational reference points from previous benchmarks and are NOT used as measured data or pass conditions.*`,
    ``,
    `| Metric | Measured Run | Historical Baseline (Reference) |`,
    `| :--- | :--- | :--- |`,
    `| **Total Render Duration** | ${formatVal(artifact.render.totalDurationMs, "ms")} | ~46,000 ms (46 s) |`,
    `| **Peak VRAM** | ${formatVal(artifact.telemetry.peakVramMb, "MB")} | ~24,028 MB |`,
    `| **Core DiT Sampling** | N/A (Measured End-to-End) | ~12 s |`,
    ``
  );

  return lines.join("\n");
}
