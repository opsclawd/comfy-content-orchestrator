import {
  type MinimaxH3InstrumentationEvent,
  type MinimaxH3AttentionObservation,
  type MinimaxH3AttentionRequest,
  type MinimaxH3AttentionFallbackEvent,
  type MinimaxH3AttentionStepRecord,
  MinimaxH3AttentionStepRecordSchema
} from "@cco/contracts";

export interface ReduceAttentionObservationOptions {
  events: readonly MinimaxH3InstrumentationEvent[];
  attentionRequest?: MinimaxH3AttentionRequest | undefined;
  expectedRunId?: string | undefined;
  expectedAttemptToken?: string | undefined;
  expectedPromptId?: string | null | undefined;
  expectedSteps?: number | undefined;
  expectedCollectorDigest?: string | undefined;
  expectedHookManifestDigest?: string | undefined;
  /**
   * Whether the caller has independently validated the pre-submission capability
   * handshake (identity, attempt/intent binding, digest match) with zero conflicts.
   * Completeness MUST NOT be reported when this is not explicitly true — otherwise a
   * fully-covered event stream could be marked complete despite an invalid or missing
   * identity handshake (AC-5, F-799002ee, F-aa019999).
   */
  identityValidated?: boolean;
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
  let authoritativeCumulativeStepRecords: MinimaxH3AttentionStepRecord[] | null = null;
  const pointStepRecords: MinimaxH3AttentionStepRecord[] = [];
  const completedSamplingSteps = new Set<number>();
  let missingKernelFailure: string | null = null;
  let reportedStatus: "verified" | "unknown" | "fallback" | "failed" | null = null;
  let reportedFailureReason: string | null = null;
  let actualBackend: string | null = null;
  let dispatchImplementation: string | null = null;
  let dtypeLayoutDiagnostics: Record<string, unknown> | null = null;
  let samplingCallsRecorded = 0;
  let samplingSpansRecorded = false;
  let samplingFailed = false;
  let samplingStepFailed = false;
  let attentionSummaryObserved = false;
  let stepRecordSnapshotConflict = false;

  const observedBackends = new Set<string>();
  const observedAcceleratedBackends = new Set<string>();
  const observedImplementations = new Set<string>();
  const observedAcceleratedImplementations = new Set<string>();
  const observedCollectorDigests = new Set<string>();
  const observedHookManifestDigests = new Set<string>();

  for (const event of events) {
    // Correlate with owned attempt tokens to reject stale or unrelated events
    if (expectedRunId && event.runId !== expectedRunId) {
      continue;
    }
    if (expectedAttemptToken && event.attemptToken !== expectedAttemptToken) {
      continue;
    }
    // Genuine startup identity handshake contributes identity digests only, not attention execution payload
    if (event.phase === "environment_startup") {
      const handshakeMeta = event.metadata;
      if (handshakeMeta) {
        if (
          typeof handshakeMeta.collectorDigest === "string" &&
          handshakeMeta.collectorDigest.length > 0
        ) {
          observedCollectorDigests.add(handshakeMeta.collectorDigest);
        }
        if (
          typeof handshakeMeta.hookManifestDigest === "string" &&
          handshakeMeta.hookManifestDigest.length > 0
        ) {
          observedHookManifestDigests.add(handshakeMeta.hookManifestDigest);
        }
      }
      continue;
    }

    if (expectedPromptId !== undefined) {
      if (expectedPromptId === null) {
        if (event.promptId !== null && event.promptId !== undefined) {
          continue;
        }
      } else {
        if (
          event.promptId === null ||
          event.promptId === undefined ||
          event.promptId !== expectedPromptId
        ) {
          continue;
        }
      }
    }

    if (event.phase === "sampling") {
      samplingCallsRecorded++;
      if (event.type === "span_end") {
        if (event.outcome === "failed") {
          samplingFailed = true;
        } else if (event.outcome === "success") {
          samplingSpansRecorded = true;
        } else {
          // Absent/ambiguous outcome is not evidence of success (AC-3, F-798478f7):
          // an unlabeled span_end must not silently satisfy the completeness gate.
          samplingFailed = true;
        }
      }
    }
    if (event.phase === "sampling_step" && event.type === "span_end") {
      if (event.outcome === "failed") {
        samplingStepFailed = true;
      } else if (event.outcome === "success") {
        if (
          typeof event.stepIndex === "number" &&
          Number.isInteger(event.stepIndex) &&
          event.stepIndex >= 0
        ) {
          completedSamplingSteps.add(event.stepIndex);
        }
      }
    }

    const meta = event.metadata;
    if (!meta) continue;

    if (typeof meta.collectorDigest === "string" && meta.collectorDigest.length > 0) {
      observedCollectorDigests.add(meta.collectorDigest);
    }
    if (typeof meta.hookManifestDigest === "string" && meta.hookManifestDigest.length > 0) {
      observedHookManifestDigests.add(meta.hookManifestDigest);
    }

    // Ingest cumulative stepRecords snapshot if present in metadata (preserving all records)
    if (Array.isArray(meta.stepRecords)) {
      const validRecords: MinimaxH3AttentionStepRecord[] = [];
      let allValid = true;
      for (const raw of meta.stepRecords) {
        const parsed = MinimaxH3AttentionStepRecordSchema.safeParse(raw);
        if (parsed.success) {
          validRecords.push(parsed.data);
          if (
            parsed.data.callType === "accelerated" &&
            typeof parsed.data.implementation === "string" &&
            parsed.data.implementation.length > 0
          ) {
            observedAcceleratedImplementations.add(parsed.data.implementation);
          }
        } else {
          allValid = false;
          break;
        }
      }
      if (allValid) {
        // A later cumulative snapshot normally supersedes an earlier one (progressive
        // reporting), but if the two snapshots disagree about the same (stepIndex,
        // layerIndex) call's callType/backend/implementation, that is a genuine conflict
        // and must not be silently overwritten (AC-3, F-cf34dca5, F-798478f7).
        if (authoritativeCumulativeStepRecords !== null) {
          const priorByKey = new Map<string, MinimaxH3AttentionStepRecord>();
          for (const rec of authoritativeCumulativeStepRecords) {
            priorByKey.set(`${rec.stepIndex}:${rec.layerIndex ?? "null"}`, rec);
          }
          for (const rec of validRecords) {
            const prior = priorByKey.get(`${rec.stepIndex}:${rec.layerIndex ?? "null"}`);
            if (
              prior &&
              (prior.callType !== rec.callType ||
                prior.backend !== rec.backend ||
                prior.implementation !== rec.implementation)
            ) {
              stepRecordSnapshotConflict = true;
            }
          }
        }
        authoritativeCumulativeStepRecords = validRecords;
      }
    }

    // Ingest individual attentionStepRecord point event
    if (meta.attentionStepRecord && typeof meta.attentionStepRecord === "object") {
      const parsed = MinimaxH3AttentionStepRecordSchema.safeParse(meta.attentionStepRecord);
      if (parsed.success) {
        const rec = parsed.data;
        pointStepRecords.push(rec);
        if (rec.callType === "accelerated") {
          acceleratedCallCount++;
          if (rec.backend) observedAcceleratedBackends.add(rec.backend);
          if (rec.implementation) observedAcceleratedImplementations.add(rec.implementation);
        } else if (rec.callType === "planned_dense") {
          plannedDenseCallCount++;
        } else {
          denseCallCount++;
        }
        if (rec.backend) observedBackends.add(rec.backend);
        if (rec.implementation) observedImplementations.add(rec.implementation);
        if (!actualBackend && rec.backend) actualBackend = rec.backend;
        if (!dispatchImplementation && rec.implementation)
          dispatchImplementation = rec.implementation;
      }
    }

    // Direct attention summary from collector. The collector reports this cumulatively,
    // so the LAST observed summary (in event order) is authoritative: use its value
    // directly rather than Math.max-blending it with whatever was seen before, so a
    // later explicit count -- including an explicit zero -- is not masked by an earlier,
    // possibly-stale report (AC-3, F-cf34dca5).
    if (meta.attentionSummary && typeof meta.attentionSummary === "object") {
      const s = meta.attentionSummary as Record<string, unknown>;
      attentionSummaryObserved = true;
      if (typeof s.acceleratedCallCount === "number") {
        acceleratedCallCount = s.acceleratedCallCount;
      }
      if (typeof s.denseCallCount === "number") {
        denseCallCount = s.denseCallCount;
      }
      if (typeof s.plannedDenseCallCount === "number") {
        plannedDenseCallCount = s.plannedDenseCallCount;
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
        if (s.actualBackend !== "torch_sdpa" && s.actualBackend !== "dense") {
          observedAcceleratedImplementations.add(s.dispatchImplementation);
        }
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
        const newStatus = s.status as "verified" | "unknown" | "fallback" | "failed";
        if (newStatus === "failed") {
          reportedStatus = "failed";
          if (typeof s.failureReason === "string" && s.failureReason.length > 0) {
            reportedFailureReason = s.failureReason;
          }
        } else if (newStatus === "fallback") {
          if (reportedStatus !== "failed") {
            reportedStatus = "fallback";
            if (typeof s.failureReason === "string" && s.failureReason.length > 0) {
              reportedFailureReason = s.failureReason;
            }
          }
        } else if (newStatus === "unknown") {
          if (reportedStatus === null) {
            reportedStatus = "unknown";
          }
        } else if (newStatus === "verified") {
          if (reportedStatus === null || reportedStatus === "unknown") {
            reportedStatus = "verified";
          }
        }
      }
      if (Array.isArray(s.fallbackEvents)) {
        for (const fb of s.fallbackEvents) {
          if (fb && typeof fb === "object") {
            fallbackEvents.push(fb as MinimaxH3AttentionFallbackEvent);
          }
        }
        if (s.fallbackEvents.length > 0 && reportedStatus !== "failed") {
          reportedStatus = "fallback";
        }
      }
      if (s.dtypeLayoutDiagnostics && typeof s.dtypeLayoutDiagnostics === "object") {
        dtypeLayoutDiagnostics = s.dtypeLayoutDiagnostics as Record<string, unknown>;
      }
    }

    // Point event fallback
    if (meta.attentionEvent === "fallback") {
      const stepIdx =
        typeof event.stepIndex === "number" &&
        Number.isInteger(event.stepIndex) &&
        event.stepIndex >= 0
          ? event.stepIndex
          : null;
      const layerIdx =
        typeof meta.layerIndex === "number" &&
        Number.isInteger(meta.layerIndex) &&
        meta.layerIndex >= 0
          ? meta.layerIndex
          : null;
      fallbackEvents.push({
        stepIndex: stepIdx,
        layerIndex: layerIdx,
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

    // Individual attention call point event (if not already ingested via attentionStepRecord)
    if (meta.attentionCall && !meta.attentionStepRecord) {
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

      const recCallType =
        callType === "accelerated" ||
        callType === "sage" ||
        callType === "sol_attn" ||
        callType === "veda"
          ? "accelerated"
          : callType === "planned_dense"
            ? "planned_dense"
            : "dense";

      if (recCallType === "accelerated") {
        acceleratedCallCount++;
        if (b) {
          observedAcceleratedBackends.add(b);
        }
        if (impl) {
          observedAcceleratedImplementations.add(impl);
        }
      } else if (recCallType === "planned_dense") {
        plannedDenseCallCount++;
      } else {
        denseCallCount++;
      }

      const stepIdx =
        typeof event.stepIndex === "number" &&
        Number.isInteger(event.stepIndex) &&
        event.stepIndex >= 0
          ? event.stepIndex
          : -1;
      const layerIdx =
        typeof meta.layerIndex === "number" &&
        Number.isInteger(meta.layerIndex) &&
        meta.layerIndex >= 0
          ? meta.layerIndex
          : null;

      if (stepIdx >= 0) {
        pointStepRecords.push({
          stepIndex: stepIdx,
          layerIndex: layerIdx,
          backend: b ?? "unknown",
          implementation: impl ?? "unknown",
          callType: recCallType,
          monotonicMs: event.monotonicMs
        });
      }

      if (!actualBackend && b) actualBackend = b;
      if (!dispatchImplementation && impl) dispatchImplementation = impl;
    }
  }

  if (authoritativeCumulativeStepRecords !== null) {
    // Only backfill call counts from the cumulative stepRecords snapshot when no
    // attentionSummary was ever reported -- an explicitly-reported summary (including
    // an explicit zero) is authoritative on its own and must not be silently replaced
    // by record-derived counts (AC-3, F-cf34dca5: "zero-call summary with one dense
    // record" previously still reached complete=true via this backfill).
    if (
      !attentionSummaryObserved &&
      acceleratedCallCount === 0 &&
      denseCallCount === 0 &&
      plannedDenseCallCount === 0
    ) {
      for (const rec of authoritativeCumulativeStepRecords) {
        if (rec.callType === "accelerated") {
          acceleratedCallCount++;
          if (rec.backend) observedAcceleratedBackends.add(rec.backend);
          if (rec.implementation) observedAcceleratedImplementations.add(rec.implementation);
        } else if (rec.callType === "planned_dense") {
          plannedDenseCallCount++;
        } else if (rec.callType === "dense") {
          denseCallCount++;
        }
        if (rec.backend) observedBackends.add(rec.backend);
        if (rec.implementation) observedImplementations.add(rec.implementation);
        if (!actualBackend && rec.backend) actualBackend = rec.backend;
        if (!dispatchImplementation && rec.implementation) {
          dispatchImplementation = rec.implementation;
        }
      }
    }
  }

  const stepRecords: MinimaxH3AttentionStepRecord[] =
    authoritativeCumulativeStepRecords !== null
      ? authoritativeCumulativeStepRecords
      : pointStepRecords;

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

  if (requestedVariant === "dense") {
    if (observedImplementations.size > 1) {
      status = "failed";
      if (!failureReason) {
        failureReason = `Multiple conflicting dispatch implementations observed for dense control: ${Array.from(observedImplementations).join(", ")}`;
      }
    }
  } else {
    if (observedAcceleratedImplementations.size > 1) {
      status = "failed";
      if (
        !failureReason ||
        !failureReason.includes("Multiple conflicting accelerated attention backends")
      ) {
        failureReason = `Multiple conflicting accelerated dispatch implementations observed in event stream: ${Array.from(observedAcceleratedImplementations).join(", ")}`;
      }
    }
  }
  if (observedCollectorDigests.size > 1) {
    status = "failed";
    failureReason = `Multiple conflicting collector digests observed in event stream: ${Array.from(observedCollectorDigests).join(", ")}`;
  }
  if (observedHookManifestDigests.size > 1) {
    status = "failed";
    failureReason = `Multiple conflicting hook manifest digests observed in event stream: ${Array.from(observedHookManifestDigests).join(", ")}`;
  }

  if (options.expectedCollectorDigest) {
    if (observedCollectorDigests.size === 0) {
      status = "failed";
      failureReason = `Collector digest not observed in instrumentation events; expected "${options.expectedCollectorDigest}".`;
    } else if (
      !observedCollectorDigests.has(options.expectedCollectorDigest) ||
      observedCollectorDigests.size > 1
    ) {
      status = "failed";
      failureReason = `Observed collector digest "${Array.from(observedCollectorDigests).join(", ")}" does not match expected "${options.expectedCollectorDigest}".`;
    }
  }

  if (options.expectedHookManifestDigest) {
    if (observedHookManifestDigests.size === 0) {
      status = "failed";
      failureReason = `Hook manifest digest not observed in instrumentation events; expected "${options.expectedHookManifestDigest}".`;
    } else if (
      !observedHookManifestDigests.has(options.expectedHookManifestDigest) ||
      observedHookManifestDigests.size > 1
    ) {
      status = "failed";
      failureReason = `Observed hook manifest digest "${Array.from(observedHookManifestDigests).join(", ")}" does not match expected "${options.expectedHookManifestDigest}".`;
    }
  }

  const totalCalls = acceleratedCallCount + denseCallCount + plannedDenseCallCount;

  // Real per-step completeness verification
  let isComplete = false;
  if (
    status === "verified" &&
    options.identityValidated === true &&
    !stepRecordSnapshotConflict &&
    totalCalls > 0 &&
    samplingCallsRecorded > 0 &&
    stepRecords.length > 0 &&
    fallbackEvents.length === 0 &&
    !missingKernelFailure &&
    !failureReason &&
    options.expectedSteps !== undefined &&
    typeof options.expectedSteps === "number" &&
    Number.isInteger(options.expectedSteps) &&
    options.expectedSteps > 0
  ) {
    const effectiveSteps = options.expectedSteps;

    // 1. Sampling span must have completed successfully with no failed span
    // 2. Sampling step span_ends must cover exactly 0..effectiveSteps-1
    const samplingStepsValid =
      samplingSpansRecorded &&
      !samplingFailed &&
      !samplingStepFailed &&
      completedSamplingSteps.size === effectiveSteps &&
      Array.from({ length: effectiveSteps }, (_, i) => i).every((i) =>
        completedSamplingSteps.has(i)
      );

    // 3. Step records must cover 0..effectiveSteps-1 with valid policy
    const coveredSteps = new Set<number>();
    let stepPolicyValid = true;

    for (const r of stepRecords) {
      const parsedRecord = MinimaxH3AttentionStepRecordSchema.safeParse(r);
      if (!parsedRecord.success) {
        stepPolicyValid = false;
        break;
      }
      if (
        typeof r.stepIndex !== "number" ||
        !Number.isInteger(r.stepIndex) ||
        r.stepIndex < 0 ||
        r.stepIndex >= effectiveSteps
      ) {
        stepPolicyValid = false;
        break;
      }
      coveredSteps.add(r.stepIndex);

      if (
        (r as unknown as { unflushed?: boolean }).unflushed === true ||
        (r as unknown as { unattributed?: boolean }).unattributed === true ||
        (r.metadata && (r.metadata as Record<string, unknown>).unflushed === true)
      ) {
        stepPolicyValid = false;
        break;
      }

      if (requestedVariant === "dense") {
        if (
          (r.callType !== "dense" && r.callType !== "planned_dense") ||
          r.backend !== expectedBackend ||
          r.implementation !== expectedKernel
        ) {
          stepPolicyValid = false;
          break;
        }
      } else {
        if (r.callType === "dense" || r.callType === "fallback") {
          stepPolicyValid = false;
          break;
        }
        if (r.callType === "planned_dense") {
          if (!attentionRequest.denseRegionPolicy.allowPlannedDense) {
            stepPolicyValid = false;
            break;
          }
        } else if (r.callType === "accelerated") {
          if (r.backend !== expectedBackend || r.implementation !== expectedKernel) {
            stepPolicyValid = false;
            break;
          }
        }
      }
    }

    const requiredStepsCovered =
      stepPolicyValid &&
      coveredSteps.size === effectiveSteps &&
      Array.from({ length: effectiveSteps }, (_, i) => i).every((i) => coveredSteps.has(i));

    // 4. Exact counts match: record-derived counts must match totalCalls and individual call counts
    const recAccelerated = stepRecords.filter((r) => r.callType === "accelerated").length;
    const recDense = stepRecords.filter((r) => r.callType === "dense").length;
    const recPlannedDense = stepRecords.filter((r) => r.callType === "planned_dense").length;
    const recFallbacks = stepRecords.filter((r) => r.callType === "fallback").length;

    const countsValid =
      recFallbacks === 0 &&
      stepRecords.length === totalCalls &&
      recAccelerated === acceleratedCallCount &&
      recDense === denseCallCount &&
      recPlannedDense === plannedDenseCallCount;

    isComplete =
      requiredStepsCovered &&
      samplingStepsValid &&
      stepPolicyValid &&
      countsValid &&
      (requestedVariant === "dense"
        ? acceleratedCallCount === 0
        : denseCallCount === 0 &&
          (attentionRequest.denseRegionPolicy.allowPlannedDense || plannedDenseCallCount === 0));
  }

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
