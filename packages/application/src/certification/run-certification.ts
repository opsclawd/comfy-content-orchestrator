import {
  type CertificationEnvironment,
  type CertificationFailure,
  type CertificationRenderExecution,
  type CertificationTelemetryData,
  type CertificationTelemetrySample,
  type CertificationWorkloadIdentity,
  type LtxCertificationArtifact,
  LtxCertificationArtifactSchema
} from "@cco/contracts";
import type { QueueRenderInput, RenderEnginePort } from "../ports/render-engine-port.js";
import { evaluateLtxResourceGate } from "./certification-metrics.js";

export type CertificationPhase =
  | "ready"
  | "sampling"
  | "rendering"
  | "unloading"
  | "settling"
  | "final_sampling"
  | "stopped"
  | "completed"
  | "recovery";

export interface TelemetrySamplerControl {
  start(): Promise<void>;
  sampleNow(
    phase?: "pre_dispatch" | "sampling" | "post_unload"
  ): Promise<CertificationTelemetrySample>;
  stop(): Promise<CertificationTelemetryData>;
  getTelemetryData?(): CertificationTelemetryData;
}

export interface RunCertificationOptions {
  readonly runId: string;
  readonly runnerMode: "dynamicvram" | "highvram";
  readonly identity: CertificationWorkloadIdentity;
  readonly environment: CertificationEnvironment;
  readonly renderEngine: RenderEnginePort;
  readonly telemetrySampler: TelemetrySamplerControl;
  readonly renderInput: QueueRenderInput;
  readonly maxDurationMs?: number;
  readonly settleDurationMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
  readonly onPhaseChange?: (phase: CertificationPhase) => void;
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
    message = "Unknown error during certification execution";
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

function extractErrorCode(err: unknown, defaultCode: string): string {
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
 * Orchestrates a complete LTX hardware certification run:
 * 1. Start telemetry sampling
 * 2. Dispatch render and await terminal outcome
 * 3. Perform cleanup (/free, bounded settle window, post-unload sample, sampler stop)
 * 4. Aggregate measurements, evaluate resource gates, and return a validated artifact draft
 */
export async function runCertification(
  options: RunCertificationOptions
): Promise<LtxCertificationArtifact> {
  const {
    runId,
    runnerMode,
    identity,
    environment,
    renderEngine,
    telemetrySampler,
    renderInput,
    maxDurationMs = 55000,
    settleDurationMs = 5000,
    sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => new Date(),
    onPhaseChange
  } = options;

  const transitionTo = (phase: CertificationPhase) => {
    onPhaseChange?.(phase);
  };

  transitionTo("ready");

  let renderStartedAt: string | null = null;
  let renderCompletedAt: string | null = null;
  let renderTotalDurationMs: number | null = null;
  let executionId: string | null = null;
  let outputObjectKeys: readonly string[] = [];
  let renderStatus: "succeeded" | "failed" | "not_started" = "not_started";

  let primaryFailure: CertificationFailure | null = null;
  let cleanupFailure: CertificationFailure | null = null;

  // Step 1: Start telemetry sampling
  try {
    transitionTo("sampling");
    await telemetrySampler.start();
  } catch (err) {
    primaryFailure = {
      phase: "sampling",
      code: "sampler_start_failed",
      message: formatErrorMessage(err)
    };
  }

  // Step 2: Render phase
  if (!primaryFailure) {
    transitionTo("rendering");
    const startTime = now();
    renderStartedAt = startTime.toISOString();

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
        const isTimeout = isTimeoutError(result.errorCode);
        primaryFailure = {
          phase: "rendering",
          code: isTimeout ? "render_timeout" : (result.errorCode?.toLowerCase() ?? "render_failed"),
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

      const isTimeout = isTimeoutError(err);
      primaryFailure = {
        phase: "rendering",
        code: isTimeout ? "render_timeout" : extractErrorCode(err, "render_failed"),
        message: formatErrorMessage(err),
        details: extractErrorDetails(err)
      };
    }
  }

  // Step 3: Cleanup / Recovery
  if (primaryFailure) {
    transitionTo("recovery");
  }

  // Unload models
  try {
    transitionTo("unloading");
    await renderEngine.unloadModels();
  } catch (err) {
    cleanupFailure = {
      phase: "unloading",
      code: "unload_failed",
      message: `Failed to unload models: ${formatErrorMessage(err)}`
    };
  }

  // Bounded settle window
  try {
    transitionTo("settling");
    await sleep(settleDurationMs);
  } catch (err) {
    if (!cleanupFailure) {
      cleanupFailure = {
        phase: "settling",
        code: "settle_failed",
        message: `Settle sleep failed: ${formatErrorMessage(err)}`
      };
    }
  }

  // Post-unload telemetry sample
  try {
    transitionTo("final_sampling");
    await telemetrySampler.sampleNow("post_unload");
  } catch (err) {
    if (!cleanupFailure) {
      cleanupFailure = {
        phase: "final_sampling",
        code: "final_sampling_failed",
        message: `Final telemetry sample failed: ${formatErrorMessage(err)}`
      };
    }
  }

  // Stop telemetry sampler
  let telemetryData: CertificationTelemetryData;
  try {
    transitionTo("stopped");
    telemetryData = await telemetrySampler.stop();
  } catch (err) {
    if (!cleanupFailure) {
      cleanupFailure = {
        phase: "stopped",
        code: "sampler_stop_failed",
        message: `Failed to stop telemetry sampler: ${formatErrorMessage(err)}`
      };
    }
    telemetryData = telemetrySampler.getTelemetryData?.() ?? createEmptyTelemetryData();
  }

  // Combine failures
  let finalFailure: CertificationFailure | null = null;
  if (primaryFailure && cleanupFailure) {
    finalFailure = {
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
    finalFailure = primaryFailure;
  } else if (cleanupFailure) {
    finalFailure = cleanupFailure;
  }

  const renderExecution: CertificationRenderExecution = {
    executionId,
    status: renderStatus,
    outputObjectKeys: [...outputObjectKeys],
    startedAt: renderStartedAt,
    completedAt: renderCompletedAt,
    totalDurationMs: renderTotalDurationMs
  };

  let gate = evaluateLtxResourceGate({
    render: renderExecution,
    telemetry: telemetryData,
    failure: finalFailure,
    maxDurationMs
  });

  if (finalFailure !== null) {
    gate = { ...gate, passed: false };
  }

  let status: "passed" | "failed" =
    !finalFailure && gate.passed && renderStatus === "succeeded" ? "passed" : "failed";

  if (status === "failed" && finalFailure === null) {
    const failedCheckNames = Object.entries(gate.checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    finalFailure = {
      phase: "gate",
      code: "gate_check_failed",
      message: `Resource gate evaluation failed: ${failedCheckNames.join(", ")}`,
      details: { checks: gate.checks }
    };
    gate = { ...gate, passed: false };
    status = "failed";
  }

  transitionTo("completed");

  const artifact: LtxCertificationArtifact = {
    version: 1,
    runId,
    generatedAt: now().toISOString(),
    status,
    runnerMode,
    identity,
    environment,
    render: renderExecution,
    telemetry: telemetryData,
    gate,
    failure: status === "passed" ? null : finalFailure
  };

  return LtxCertificationArtifactSchema.parse(artifact);
}
