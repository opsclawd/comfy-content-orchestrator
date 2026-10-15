import {
  type MinimaxH3InstrumentationEvent,
  type MinimaxH3AttentionObservation,
  type MinimaxH3AttentionRequest,
  type MinimaxH3AttentionFallbackEvent,
  type MinimaxH3AttentionStepRecord
} from "@cco/contracts";

export interface ReduceAttentionObservationOptions {
  events: readonly MinimaxH3InstrumentationEvent[];
  attentionRequest?: MinimaxH3AttentionRequest | undefined;
  expectedRunId?: string | undefined;
  expectedAttemptToken?: string | undefined;
  expectedPromptId?: string | null | undefined;
}

export function reduceAttentionObservation(
  options: ReduceAttentionObservationOptions
): MinimaxH3AttentionObservation | undefined {
  const { events, attentionRequest, expectedRunId, expectedAttemptToken, expectedPromptId } =
    options;

  if (!attentionRequest) {
    return undefined;
  }

  const requestedVariant = attentionRequest.attentionVariant;
  const expectedBackend = attentionRequest.expectedBackend;
  const expectedKernel = attentionRequest.expectedKernel;

  let acceleratedCallCount = 0;
  let denseCallCount = 0;
  let plannedDenseCallCount = 0;
  const fallbackEvents: MinimaxH3AttentionFallbackEvent[] = [];
  const stepRecords: MinimaxH3AttentionStepRecord[] = [];
  let missingKernelFailure: string | null = null;
  let reportedStatus: "verified" | "unknown" | "fallback" | "failed" | null = null;
  let reportedFailureReason: string | null = null;
  let actualBackend: string | null = null;
  let dispatchImplementation: string | null = null;
  let dtypeLayoutDiagnostics: Record<string, unknown> | null = null;
  let samplingCallsRecorded = 0;

  const observedBackends = new Set<string>();
  const observedAcceleratedBackends = new Set<string>();
  const observedImplementations = new Set<string>();

  for (const event of events) {
    // Correlate with owned attempt tokens to reject stale or unrelated events
    if (expectedRunId && event.runId !== expectedRunId) {
      continue;
    }
    if (expectedAttemptToken && event.attemptToken !== expectedAttemptToken) {
      continue;
    }
    if (expectedPromptId !== undefined) {
      if (expectedPromptId === null) {
        if (event.promptId !== null && event.promptId !== undefined) {
          continue;
        }
      } else {
        if (
          event.promptId !== null &&
          event.promptId !== undefined &&
          event.promptId !== expectedPromptId
        ) {
          continue;
        }
      }
    }

    if (event.phase === "sampling") {
      samplingCallsRecorded++;
    }

    const meta = event.metadata;
    if (!meta) continue;

    // Direct attention summary from collector
    if (meta.attentionSummary && typeof meta.attentionSummary === "object") {
      const s = meta.attentionSummary as Record<string, unknown>;
      if (typeof s.acceleratedCallCount === "number") {
        acceleratedCallCount = Math.max(acceleratedCallCount, s.acceleratedCallCount);
      }
      if (typeof s.denseCallCount === "number") {
        denseCallCount = Math.max(denseCallCount, s.denseCallCount);
      }
      if (typeof s.plannedDenseCallCount === "number") {
        plannedDenseCallCount = Math.max(plannedDenseCallCount, s.plannedDenseCallCount);
      }
      if (typeof s.actualBackend === "string" && s.actualBackend.length > 0) {
        actualBackend = s.actualBackend;
        observedBackends.add(s.actualBackend);
        if (s.actualBackend !== "torch_sdpa" && s.actualBackend !== "dense") {
          observedAcceleratedBackends.add(s.actualBackend);
        }
      }
      if (typeof s.dispatchImplementation === "string" && s.dispatchImplementation.length > 0) {
        dispatchImplementation = s.dispatchImplementation;
        observedImplementations.add(s.dispatchImplementation);
      }
      if (typeof s.missingKernelFailure === "string" && s.missingKernelFailure.length > 0) {
        missingKernelFailure = s.missingKernelFailure;
      }
      if (typeof s.failureReason === "string" && s.failureReason.length > 0) {
        reportedFailureReason = s.failureReason;
      }
      if (
        typeof s.status === "string" &&
        ["verified", "unknown", "fallback", "failed"].includes(s.status)
      ) {
        reportedStatus = s.status as "verified" | "unknown" | "fallback" | "failed";
      }
      if (Array.isArray(s.fallbackEvents)) {
        for (const fb of s.fallbackEvents) {
          if (fb && typeof fb === "object") {
            fallbackEvents.push(fb as MinimaxH3AttentionFallbackEvent);
          }
        }
      }
      if (s.dtypeLayoutDiagnostics && typeof s.dtypeLayoutDiagnostics === "object") {
        dtypeLayoutDiagnostics = s.dtypeLayoutDiagnostics as Record<string, unknown>;
      }
    }

    // Point event fallback
    if (meta.attentionEvent === "fallback") {
      fallbackEvents.push({
        stepIndex: event.stepIndex ?? 0,
        layerIndex: (meta.layerIndex as number | null) ?? null,
        requestedBackend:
          typeof meta.requestedBackend === "string"
            ? meta.requestedBackend
            : (expectedBackend ?? "unknown"),
        fallbackBackend:
          typeof meta.fallbackBackend === "string" ? meta.fallbackBackend : "unknown",
        reason: typeof meta.reason === "string" ? meta.reason : "Unexpected backend fallback",
        monotonicMs: event.monotonicMs
      });
    }

    // Individual attention call point event
    if (meta.attentionCall) {
      const callType = meta.attentionCall as string;
      const b = typeof meta.backend === "string" && meta.backend.length > 0 ? meta.backend : null;
      const impl =
        typeof meta.implementation === "string" && meta.implementation.length > 0
          ? meta.implementation
          : null;

      if (b) {
        observedBackends.add(b);
      }
      if (impl) {
        observedImplementations.add(impl);
      }

      if (
        callType === "accelerated" ||
        callType === "sage" ||
        callType === "sol_attn" ||
        callType === "veda"
      ) {
        acceleratedCallCount++;
        if (b) {
          observedAcceleratedBackends.add(b);
        }
        stepRecords.push({
          stepIndex: event.stepIndex ?? 0,
          layerIndex: (meta.layerIndex as number | null) ?? null,
          backend: b ?? "unknown",
          implementation: impl ?? "unknown",
          callType: "accelerated",
          monotonicMs: event.monotonicMs
        });
        if (!actualBackend && b) actualBackend = b;
        if (!dispatchImplementation && impl) dispatchImplementation = impl;
      } else if (callType === "planned_dense") {
        plannedDenseCallCount++;
        stepRecords.push({
          stepIndex: event.stepIndex ?? 0,
          layerIndex: (meta.layerIndex as number | null) ?? null,
          backend: b ?? "unknown",
          implementation: impl ?? "unknown",
          callType: "planned_dense",
          monotonicMs: event.monotonicMs
        });
        if (!actualBackend && b) actualBackend = b;
        if (!dispatchImplementation && impl) dispatchImplementation = impl;
      } else {
        denseCallCount++;
        stepRecords.push({
          stepIndex: event.stepIndex ?? 0,
          layerIndex: (meta.layerIndex as number | null) ?? null,
          backend: b ?? "unknown",
          implementation: impl ?? "unknown",
          callType: "dense",
          monotonicMs: event.monotonicMs
        });
        if (!actualBackend && b) actualBackend = b;
        if (!dispatchImplementation && impl) dispatchImplementation = impl;
      }
    }
  }

  // Determine definitive status and failure reasons without promoting requested values into verified observations
  let status: "verified" | "unknown" | "fallback" | "failed" = "unknown";
  let failureReason: string | null = null;

  if (missingKernelFailure) {
    status = "failed";
    failureReason = `Missing required attention kernel or package: ${missingKernelFailure}`;
  } else if (fallbackEvents.length > 0) {
    status = "fallback";
    failureReason = `Backend fallback detected (${fallbackEvents.length} event(s)): ${fallbackEvents.map((e) => e.reason).join("; ")}`;
  } else if (reportedStatus === "failed") {
    status = "failed";
    failureReason = reportedFailureReason ?? "Attention execution failed";
  } else if (reportedStatus === "fallback") {
    status = "fallback";
    failureReason = reportedFailureReason ?? "Attention fallback reported by collector";
  } else if (requestedVariant === "dense") {
    // Control regime: requires actual observed dense execution, zero fallbacks, zero accelerated calls
    if (acceleratedCallCount > 0) {
      status = "failed";
      failureReason = `Unexpected accelerated attention calls (${acceleratedCallCount}) observed for dense control.`;
    } else if (denseCallCount === 0 && plannedDenseCallCount === 0) {
      status = "unknown";
      actualBackend = null;
      dispatchImplementation = null;
      failureReason = "No attention execution events were recorded for dense control.";
    } else if (observedBackends.size > 1) {
      status = "failed";
      failureReason = `Multiple conflicting backends observed for dense control: ${Array.from(observedBackends).join(", ")}`;
    } else if (!actualBackend || !dispatchImplementation) {
      status = "unknown";
      failureReason = "Attention dispatch was not independently observed for dense control.";
    } else if (actualBackend !== expectedBackend) {
      status = "failed";
      failureReason = `Observed attention backend "${actualBackend}" does not match requested "${expectedBackend}".`;
    } else if (dispatchImplementation !== expectedKernel) {
      status = "failed";
      failureReason = `Observed dispatch implementation "${dispatchImplementation}" does not match requested "${expectedKernel}".`;
    } else {
      status = "verified";
    }
  } else {
    // Accelerated variant requested (sage, native-sol-attn, veda)
    const totalCalls = acceleratedCallCount + denseCallCount + plannedDenseCallCount;
    if (totalCalls === 0 && samplingCallsRecorded === 0) {
      status = "unknown";
      actualBackend = null;
      dispatchImplementation = null;
      failureReason = `No attention execution events or sampling phases were recorded for variant "${requestedVariant}".`;
    } else if (observedAcceleratedBackends.size > 1) {
      status = "failed";
      failureReason = `Multiple conflicting accelerated attention backends observed in event stream: ${Array.from(observedAcceleratedBackends).join(", ")}`;
    } else if (acceleratedCallCount === 0) {
      status = "failed";
      failureReason = `Zero accelerated attention calls were observed for variant "${requestedVariant}" (undetected no-op).`;
    } else if (!actualBackend || !dispatchImplementation) {
      status = "unknown";
      failureReason = `Attention dispatch was not independently observed for variant "${requestedVariant}".`;
    } else if (actualBackend !== expectedBackend) {
      status = "failed";
      failureReason = `Observed attention backend "${actualBackend}" does not match requested "${expectedBackend}".`;
    } else if (dispatchImplementation !== expectedKernel) {
      status = "failed";
      failureReason = `Observed dispatch implementation "${dispatchImplementation}" does not match requested "${expectedKernel}".`;
    } else if (denseCallCount > 0) {
      status = "failed";
      failureReason = !attentionRequest.denseRegionPolicy.allowPlannedDense
        ? `Unexpected dense attention calls (${denseCallCount}) observed under zero-dense policy for variant "${requestedVariant}".`
        : `Unexpected unplanned dense attention calls (${denseCallCount}) observed for accelerated variant "${requestedVariant}".`;
    } else if (plannedDenseCallCount > 0 && !attentionRequest.denseRegionPolicy.allowPlannedDense) {
      status = "failed";
      failureReason = `Planned dense attention calls (${plannedDenseCallCount}) observed under zero-dense policy (allowPlannedDense=false) for variant "${requestedVariant}".`;
    } else {
      status = "verified";
    }
  }

  const totalCalls = acceleratedCallCount + denseCallCount + plannedDenseCallCount;
  const isComplete =
    status === "verified" &&
    samplingCallsRecorded > 0 &&
    totalCalls > 0 &&
    fallbackEvents.length === 0 &&
    !missingKernelFailure &&
    (requestedVariant === "dense"
      ? acceleratedCallCount === 0
      : denseCallCount === 0 &&
        (attentionRequest.denseRegionPolicy.allowPlannedDense || plannedDenseCallCount === 0));

  return {
    status,
    actualBackend,
    dispatchImplementation,
    acceleratedCallCount,
    denseCallCount,
    plannedDenseCallCount,
    fallbackEvents,
    ...(stepRecords.length > 0 ? { stepRecords } : {}),
    failureReason,
    missingKernelFailure,
    dtypeLayoutDiagnostics,
    measurementCoverage: {
      samplingCallsRecorded,
      attentionCallsRecorded: totalCalls,
      complete: isComplete
    },
    timings: {
      deviceElapsedMs: null,
      kernelElapsedMs: null,
      timingUnavailableReason:
        "GPU kernel profiler was not attached; device elapsed time and kernel duration not captured"
    }
  };
}
