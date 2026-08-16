import {
  type CertificationEnvironment,
  type CertificationFailure,
  type CertificationRenderExecution,
  type CertificationTelemetryData,
  type TransitionFamily,
  type TransitionFamilyBaseline,
  type TransitionSoakArtifact,
  TransitionSoakArtifactSchema,
  type TransitionSoakCleanup,
  type TransitionSoakIteration,
  type TransitionSoakThresholds,
  type TransitionWorkloadIdentity
} from "@cco/contracts";
import type {
  QueueRenderInput,
  RenderEnginePort,
  RenderWorkflow
} from "../ports/render-engine-port.js";
import type { TelemetrySamplerControl } from "./run-certification.js";
import { evaluateTransitionSoak } from "./transition-soak-analysis.js";

export type TransitionSoakPhase =
  | "preparing"
  | "sampling"
  | "rendering"
  | "unloading"
  | "polling_headroom"
  | "recording"
  | "recovery"
  | "completed";

export interface RunTransitionSoakOptions {

  readonly runId: string;
  readonly runnerProfile?: string;
  readonly requestedTransitionCount?: number;
  readonly environment: CertificationEnvironment;
  readonly identities: {
    readonly flux: TransitionWorkloadIdentity;
    readonly ltx: TransitionWorkloadIdentity;
  };
  readonly baselines: {
    readonly flux: TransitionFamilyBaseline;
    readonly ltx: TransitionFamilyBaseline;
  };
  readonly workflows: {
    readonly flux: RenderWorkflow | QueueRenderInput;
    readonly ltx: RenderWorkflow | QueueRenderInput;
  };
  readonly renderEngine: RenderEnginePort;
  readonly createTelemetrySampler: (
    renderIndex: number,
    family: TransitionFamily
  ) => TelemetrySamplerControl;
  readonly thresholds: TransitionSoakThresholds;
  readonly maxRenderDurationMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly onPhaseChange?: (
    phase: TransitionSoakPhase,
    context?: { renderIndex: number; family: TransitionFamily }
  ) => void;
}

function formatErrorMessage(error: unknown, maxLength = 500): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = String(error);
  }

  if (message.length === 0) {
    message = "Unknown error during transition soak execution";
  }

  if (message.length > maxLength) {
    return message.slice(0, maxLength);
  }
  return message;
}

function isTimeoutError(errOrCode: unknown): boolean {
  if (typeof errOrCode === "string") {
    const lower = errOrCode.toLowerCase();
    return lower.includes("timeout") || lower.includes("timed_out") || lower.includes("timedout");
  }
  if (errOrCode instanceof Error) {
    const code = (errOrCode as { code?: unknown }).code;
    if (typeof code === "string" && isTimeoutError(code)) {
      return true;
    }
    return isTimeoutError(errOrCode.message);
  }
  if (typeof errOrCode === "object" && errOrCode !== null) {
    const code =
      (errOrCode as { code?: unknown; errorCode?: unknown }).code ??
      (errOrCode as { errorCode?: unknown }).errorCode;
    if (typeof code === "string" && isTimeoutError(code)) {
      return true;
    }
    const message = (errOrCode as { message?: unknown }).message;
    if (typeof message === "string" && isTimeoutError(message)) {
      return true;
    }
  }
  return false;
}

function isOomError(errOrCode: unknown): boolean {
  if (typeof errOrCode === "string") {
    const lower = errOrCode.toLowerCase();
    return (
      lower.includes("oom") ||
      lower.includes("out of memory") ||
      lower.includes("out_of_memory") ||
      lower.includes("cuda out of memory")
    );
  }
  if (errOrCode instanceof Error) {
    const code = (errOrCode as { code?: unknown }).code;
    if (typeof code === "string" && isOomError(code)) {
      return true;
    }
    return isOomError(errOrCode.message);
  }
  if (typeof errOrCode === "object" && errOrCode !== null) {
    const code =
      (errOrCode as { code?: unknown; errorCode?: unknown }).code ??
      (errOrCode as { errorCode?: unknown }).errorCode;
    if (typeof code === "string" && isOomError(code)) {
      return true;
    }
    const message = (errOrCode as { message?: unknown }).message;
    if (typeof message === "string" && isOomError(message)) {
      return true;
    }
    const details = (errOrCode as { details?: unknown }).details;
    if (typeof details === "object" && details !== null) {
      const isOom =
        (details as { isOom?: unknown; oom?: unknown }).isOom ??
        (details as { oom?: unknown }).oom;
      if (isOom === true) return true;
    }
  }
  return false;
}

function extractErrorCode(err: unknown, defaultCode: string): string {
  if (isOomError(err)) {
    return "oom_detected";
  }
  if (isTimeoutError(err)) {
    return "render_timeout";
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code.toLowerCase();
    }
  }
  if (typeof err === "object" && err !== null) {
    const code =
      (err as { code?: unknown; errorCode?: unknown }).code ??
      (err as { errorCode?: unknown }).errorCode;
    if (typeof code === "string" && code.length > 0) {
      return code.toLowerCase();
    }
  }
  return defaultCode;
}

function extractErrorDetails(err: unknown): Record<string, unknown> | undefined {
  if (typeof err === "object" && err !== null) {
    const details = (err as { details?: unknown }).details;
    if (typeof details === "object" && details !== null && !Array.isArray(details)) {
      return details as Record<string, unknown>;
    }
  }
  return undefined;
}

function createEmptyTelemetryData(): CertificationTelemetryData {
  return {
    sampleIntervalMs: 200,
    samples: [],
    samplingErrors: [],
    peakVramMb: null,
    reservedVramMb: null,
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

/**
 * Orchestrates a FLUX <-> LTX alternating transition soak:
 * 1. Executes an initial FLUX render followed by alternating family switches.
 * 2. Before dispatching the next family, verifies models are unloaded and GPU VRAM headroom is restored.
 * 3. Bounded cleanup timeout stops the sequence if headroom is not observed.
 * 4. Preserves primary failures while guaranteeing resource cleanup and sampler termination.
 * 5. Aggregates all iteration evidence, evaluates gate thresholds, and returns a schema-validated artifact.
 */
export async function runTransitionSoak(
  options: RunTransitionSoakOptions
): Promise<TransitionSoakArtifact> {
  const {
    runId,
    runnerProfile = "dynamicvram-offload-v1",
    requestedTransitionCount = 10,
    environment,
    identities,
    baselines,
    workflows,
    renderEngine,
    createTelemetrySampler,
    thresholds,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => new Date(),
    onPhaseChange
  } = options;

  const transitionTo = (
    phase: TransitionSoakPhase,
    context?: { renderIndex: number; family: TransitionFamily }
  ) => {
    onPhaseChange?.(phase, context);
  };

  transitionTo("preparing");

  const renderCount = requestedTransitionCount + 1;
  const familyFor = (renderIndex: number): TransitionFamily =>
    renderIndex % 2 === 0 ? "flux" : "ltx";

  const iterations: TransitionSoakIteration[] = [];
  let initialPid: number | null = null;
  let initialStartTimeTicks: number | null = null;

  for (let renderIndex = 0; renderIndex < renderCount; renderIndex++) {
    const family = familyFor(renderIndex);
    const fromFamily: TransitionFamily | null =
      renderIndex === 0 ? null : familyFor(renderIndex - 1);
    const transitionIndex: number | null = renderIndex === 0 ? null : renderIndex;

    const context = { renderIndex, family };
    transitionTo("sampling", context);

    const sampler = createTelemetrySampler(renderIndex, family);

    let renderStartedAt: string | null = null;
    let renderCompletedAt: string | null = null;
    let renderTotalDurationMs: number | null = null;
    let executionId: string | null = null;
    let outputObjectKeys: readonly string[] = [];
    let renderStatus: "succeeded" | "failed" | "not_started" = "not_started";
    let oomDetected = false;
    let comfyUiRestarted = false;

    let primaryFailure: CertificationFailure | null = null;
    let cleanupFailure: CertificationFailure | null = null;

    let cleanupStartedAt = now().toISOString();
    let cleanupCompletedAt = cleanupStartedAt;
    let cleanupDurationMs = 0;
    let cleanupAttempts = 0;
    let postUnloadFreeVramMb: number | null = null;
    let cleanupPassed = false;

    let telemetryData: CertificationTelemetryData = createEmptyTelemetryData();

    try {
      // 1. Start Sampler
      try {
        await sampler.start();
      } catch (err) {
        primaryFailure = {
          phase: "sampling",
          code: "sampler_start_failed",
          message: formatErrorMessage(err)
        };
      }

      // 2. Render Phase (if sampler started successfully)
      if (!primaryFailure) {
        transitionTo("rendering", context);
        const startTime = now();
        renderStartedAt = startTime.toISOString();

        const rawWorkflow = (workflows as Record<string, unknown>)[family];
        const renderInput: QueueRenderInput =
          typeof rawWorkflow === "object" && rawWorkflow !== null && "workflow" in rawWorkflow
            ? (rawWorkflow as QueueRenderInput)
            : {
                renderJobId: `${runId}-${renderIndex}-${family}`,
                sceneId: `scene-${family}-${renderIndex}`,
                renderProfileKey:
                  identities[family].renderProfileKey ?? identities[family].profileId,
                workflow: rawWorkflow as RenderWorkflow
              };

        try {
          const receipt = await renderEngine.queueRender(renderInput);
          executionId = receipt.executionId;

          const result = await renderEngine.getRenderResult(executionId);
          const endTime = now();
          renderCompletedAt = result?.completedAt ?? endTime.toISOString();
          renderTotalDurationMs = Math.max(0, endTime.getTime() - startTime.getTime());

          if (!result) {
            renderStatus = "failed";
            primaryFailure = {
              phase: "rendering",
              code: "render_result_missing",
              message: "RenderEnginePort returned undefined render result"
            };
          } else if (result.status === "failed") {
            renderStatus = "failed";
            outputObjectKeys = [...result.outputObjectKeys];
            const isOom = isOomError(result.errorCode);
            const isTimeout = isTimeoutError(result.errorCode);
            if (isOom) {
              oomDetected = true;
            }
            primaryFailure = {
              phase: "rendering",
              code: isOom
                ? "oom_detected"
                : isTimeout
                  ? "render_timeout"
                  : (result.errorCode?.toLowerCase() ?? "render_failed"),
              message: `Render execution failed${result.errorCode ? `: ${result.errorCode}` : ""}`
            };
          } else {
            renderStatus = "succeeded";
            outputObjectKeys = [...result.outputObjectKeys];
          }
        } catch (err) {
          renderStatus = "failed";
          const endTime = now();
          renderCompletedAt = endTime.toISOString();
          renderTotalDurationMs = Math.max(0, endTime.getTime() - startTime.getTime());

          const isOom = isOomError(err);
          const isTimeout = isTimeoutError(err);
          if (isOom) {
            oomDetected = true;
          }
          primaryFailure = {
            phase: "rendering",
            code: isOom
              ? "oom_detected"
              : isTimeout
                ? "render_timeout"
                : extractErrorCode(err, "render_failed"),
            message: formatErrorMessage(err),
            details: extractErrorDetails(err)
          };
        }
      }

      // If render or sampler start failed, transition to recovery
      if (primaryFailure) {
        transitionTo("recovery", context);
      }

      // 3. Cleanup: Unloading
      transitionTo("unloading", context);
      const cleanupStartTime = now().getTime();
      cleanupStartedAt = new Date(cleanupStartTime).toISOString();

      try {
        await renderEngine.unloadModels();
      } catch (err) {
        cleanupFailure = {
          phase: "unloading",
          code: "unload_failed",
          message: `Failed to unload models: ${formatErrorMessage(err)}`
        };
        if (!primaryFailure) {
          transitionTo("recovery", context);
        }
      }

      // 4. Cleanup: Polling Headroom
      transitionTo("polling_headroom", context);
      const deadline = cleanupStartTime + thresholds.cleanupTimeoutMs;

      while (true) {
        cleanupAttempts++;
        try {
          const sample = await sampler.sampleNow("post_unload");
          postUnloadFreeVramMb = sample.gpu.freeVramMb;
          if (postUnloadFreeVramMb >= thresholds.minPostUnloadFreeVramMb) {
            cleanupPassed = true;
            break;
          }
        } catch (err) {
          if (!cleanupFailure) {
            cleanupFailure = {
              phase: "polling_headroom",
              code: "headroom_sample_failed",
              message: `Headroom sample failed: ${formatErrorMessage(err)}`
            };
            if (!primaryFailure) {
              transitionTo("recovery", context);
            }
          }
        }

        const currentTime = now().getTime();
        if (currentTime >= deadline || currentTime + thresholds.cleanupPollIntervalMs > deadline) {
          break;
        }

        await sleep(thresholds.cleanupPollIntervalMs);

        if (now().getTime() >= deadline) {
          break;
        }
      }

      const cleanupEndTime = now().getTime();
      cleanupCompletedAt = new Date(cleanupEndTime).toISOString();
      cleanupDurationMs = Math.max(0, cleanupEndTime - cleanupStartTime);

      if (!cleanupPassed && !cleanupFailure) {
        cleanupFailure = {
          phase: "polling_headroom",
          code: "cleanup_headroom_timeout",
          message: `Cleanup headroom timed out after ${thresholds.cleanupTimeoutMs}ms: free VRAM (${postUnloadFreeVramMb ?? "unknown"} MB) did not reach threshold (${thresholds.minPostUnloadFreeVramMb} MB)`
        };
        if (!primaryFailure) {
          transitionTo("recovery", context);
        }
      }
    } finally {
      // 5. Sampler Stop (Guaranteed single invocation per iteration)
      try {
        telemetryData = await sampler.stop();
      } catch (err) {
        if (!cleanupFailure) {
          cleanupFailure = {
            phase: "polling_headroom",
            code: "sampler_stop_failed",
            message: `Failed to stop telemetry sampler: ${formatErrorMessage(err)}`
          };
          if (!primaryFailure) {
            transitionTo("recovery", context);
          }
        }
        telemetryData = sampler.getTelemetryData?.() ?? createEmptyTelemetryData();
      }
    }

    // Process identity validation across samples
    for (const sample of telemetryData.samples) {
      if (initialPid === null) {
        initialPid = sample.host.processPid;
        initialStartTimeTicks = sample.host.processStartTimeTicks;
      } else if (
        sample.host.processPid !== initialPid ||
        sample.host.processStartTimeTicks !== initialStartTimeTicks
      ) {
        comfyUiRestarted = true;
      }
    }

    for (const sErr of telemetryData.samplingErrors) {
      const lower = sErr.message.toLowerCase();
      if (
        lower.includes("identity") ||
        lower.includes("restart") ||
        lower.includes("pid mismatch")
      ) {
        comfyUiRestarted = true;
      }
    }

    if (comfyUiRestarted && !primaryFailure && !cleanupFailure) {
      cleanupFailure = {
        phase: "polling_headroom",
        code: "comfyui_restarted",
        message: `ComfyUI process identity changed during iteration ${renderIndex} (initial PID: ${initialPid}, ticks: ${initialStartTimeTicks})`,
        details: {
          initialPid,
          initialStartTimeTicks
        }
      };
      transitionTo("recovery", context);
    }

    // Combine primary and cleanup failures
    let finalIterationFailure: CertificationFailure | null = null;
    if (primaryFailure && cleanupFailure) {
      finalIterationFailure = {
        ...primaryFailure,
        details: {
          ...(primaryFailure.details ?? {}),
          cleanupFailure: {
            phase: cleanupFailure.phase,
            code: cleanupFailure.code,
            message: cleanupFailure.message
          }
        }
      };
    } else if (primaryFailure) {
      finalIterationFailure = primaryFailure;
    } else if (cleanupFailure) {
      finalIterationFailure = cleanupFailure;
    }

    const renderExecution: CertificationRenderExecution = {
      executionId,
      status: renderStatus,
      outputObjectKeys: [...outputObjectKeys],
      startedAt: renderStartedAt,
      completedAt: renderCompletedAt,
      totalDurationMs: renderTotalDurationMs
    };

    const cleanup: TransitionSoakCleanup = {
      startedAt: cleanupStartedAt,
      completedAt: cleanupCompletedAt,
      durationMs: cleanupDurationMs,
      attempts: cleanupAttempts,
      postUnloadFreeVramMb,
      passed: cleanupPassed
    };

    const iteration: TransitionSoakIteration = {
      renderIndex,
      transitionIndex,
      fromFamily,
      family,
      render: renderExecution,
      telemetry: telemetryData,
      cleanup,
      oomDetected,
      comfyUiRestarted,
      failure: finalIterationFailure
    };

    transitionTo("recording", context);
    iterations.push(iteration);

    const iterationPassed =
      renderStatus === "succeeded" &&
      cleanupPassed &&
      !oomDetected &&
      !comfyUiRestarted &&
      finalIterationFailure === null &&
      telemetryData.samplingErrors.length === 0;

    if (!iterationPassed) {
      break;
    }
  }

  transitionTo("completed");

  const evalResult = evaluateTransitionSoak({
    iterations,
    baselines,
    thresholds,
    requestedTransitionCount,
    runnerProfile
  });

  const artifact: TransitionSoakArtifact = {
    version: 1,
    runId,
    generatedAt: now().toISOString(),
    status: evalResult.status,
    runnerProfile,
    requestedTransitionCount,
    completedTransitionCount: evalResult.completedTransitionCount,
    thresholds,
    baselines,
    identities,
    environment,
    iterations,
    aggregates: evalResult.aggregates,
    gate: evalResult.gate,
    hostRamDecision: evalResult.hostRamDecision,
    selectedRunnerProfile: evalResult.selectedRunnerProfile,
    failure: evalResult.failure
  };

  return TransitionSoakArtifactSchema.parse(artifact);
}
