import {
  type MinimaxH3InstrumentationEvent,
  type MinimaxH3TeaCacheObservation,
  type MinimaxH3TeaCacheRequest,
  type MinimaxH3TeaCacheConfig,
  type MinimaxH3TeaCacheMode
} from "@cco/contracts";

export interface ReduceTeaCacheObservationOptions {
  events: readonly MinimaxH3InstrumentationEvent[];
  teacacheRequest?: MinimaxH3TeaCacheRequest | undefined;
  expectedRunId?: string | undefined;
  expectedAttemptToken?: string | undefined;
  identityValidated?: boolean;
}

export function reduceTeaCacheObservation(
  options: ReduceTeaCacheObservationOptions
): MinimaxH3TeaCacheObservation | undefined {
  const {
    events,
    teacacheRequest,
    expectedRunId,
    expectedAttemptToken,
    identityValidated = true
  } = options;

  if (!teacacheRequest) {
    return undefined;
  }

  const requestedConfig: MinimaxH3TeaCacheConfig | null =
    teacacheRequest.mode === "raw-l1-v1"
      ? {
          mode: teacacheRequest.mode,
          relL1Thresh: teacacheRequest.relL1Thresh,
          startStep: teacacheRequest.startStep,
          endStep: teacacheRequest.endStep,
          totalSteps: 20,
          normalizedStartStep: teacacheRequest.normalizedStartStep,
          normalizedEndStep: teacacheRequest.normalizedEndStep
        }
      : null;

  let forwardCallsRecorded = 0;
  let cacheHitsRecorded = 0;
  let nestedForwardsOnHits = 0;
  let samplingCallsRecorded = 0;
  let hasCacheEvents = false;
  let sessionAttempts = 0;
  let sessionId: string | null = null;
  let observedEffectiveConfig: MinimaxH3TeaCacheConfig | null = null;

  let sessionInitSeen = false;
  let sessionEndSeen = false;
  let samplingSpanStartMs: number | null = null;
  let samplingSpanEndMs: number | null = null;
  let samplingWallMs: number | null = null;
  let samplingSpanEndSeen = false;
  let samplingOutcomeFailed = false;

  const seenSteps = new Set<number>();
  let duplicateStepEvaluations = 0;
  const stepDecisions = new Map<number, "skip" | "full">();
  const failureReasons: string[] = [];
  const observedSessionIds = new Set<string>();

  // diffusion_model.forward completions are only trustworthy evidence of
  // real work if each span_end is matched to a span_start it genuinely
  // closes (by spanId), and counted at most once. Without this, a malformed
  // or adversarial event stream can pad modelForwardsRecorded with
  // duplicate/orphan "success" span_end events that never had a real
  // forward call behind them, masking an actual failed or missing forward.
  const openForwardSpanIds = new Set<string>();
  const completedForwardSpanIds = new Set<string>();
  let orphanOrDuplicateForwardCompletions = 0;
  let failedForwardCount = 0;

  // The spanId of the single real (non-nested) sampling span for this
  // reduction window. TeaCache decision/init/end point_events and nested
  // diffusion_forward spans all carry parentSpanId set to this -- without
  // checking it, events genuinely belonging to a foreign sampler
  // invocation or a foreign TeaCache session (mixed into the same log by
  // a malformed/adversarial stream, or a bug elsewhere) would be silently
  // aggregated into this observation's counts.
  let realSamplerSpanId: string | null = null;
  let foreignAttributedEventCount = 0;

  // The session_id established by this window's session_init. Any later
  // teacache event that reports an explicit, different session_id (a
  // session_end claiming a foreign terminal session, or a decision event
  // mixed in from another session) is attributed-foreign the same way a
  // mismatched parentSpanId is -- it must not be folded into this run's
  // evidence just because its parentSpanId happened to line up.
  let boundSessionId: string | null = null;
  let sessionEndCount = 0;
  let adapterIdentityVerifiedFailure: string | null = null;
  let lastSummaryForwardCallsRecorded: number | null = null;
  let lastSummaryCacheHitsRecorded: number | null = null;

  for (const event of events) {
    if (expectedRunId && event.runId !== expectedRunId) {
      continue;
    }
    if (expectedAttemptToken && event.attemptToken !== expectedAttemptToken) {
      continue;
    }

    const meta = event.metadata as Record<string, unknown> | undefined;
    const isNestedModelSpan =
      meta?.modelForwardCall === true ||
      meta?.phase === "diffusion_forward" ||
      (event.phase as string) === "diffusion_forward" ||
      Boolean(event.parentSpanId);

    if (event.phase === "sampling" && !isNestedModelSpan) {
      if (event.type === "span_start") {
        if (samplingSpanStartMs === null) {
          samplingSpanStartMs = event.monotonicMs;
        }
        if (realSamplerSpanId === null && event.spanId) {
          realSamplerSpanId = event.spanId;
        }
        samplingCallsRecorded++;
      } else if (event.type === "span_end") {
        samplingSpanEndMs = event.monotonicMs;
        samplingSpanEndSeen = true;
        if (event.outcome === "failed") {
          samplingOutcomeFailed = true;
        }
        if (samplingSpanStartMs !== null && samplingSpanEndMs >= samplingSpanStartMs) {
          samplingWallMs = Math.round((samplingSpanEndMs - samplingSpanStartMs) * 1000) / 1000;
        }
      }
    }
    if (meta && typeof meta === "object") {
      const isTeaCacheRelatedEvent = Boolean(
        meta.teacacheEvent ||
        meta.teacacheSession ||
        meta.summary ||
        meta.teacacheSummary ||
        (event.phase as string) === "diffusion_forward" ||
        meta.phase === "diffusion_forward" ||
        meta.modelForwardCall === true
      );
      if (
        isTeaCacheRelatedEvent &&
        realSamplerSpanId !== null &&
        event.parentSpanId !== undefined &&
        event.parentSpanId !== realSamplerSpanId
      ) {
        // This event claims a parent span that isn't the one real sampler
        // invocation this window is reducing -- it belongs to a different
        // sampler call (a different run mixed into the same log, or a bug
        // elsewhere) and must not be aggregated into this observation at
        // all, in either direction (neither as a decision/forward counted
        // for this run, nor as a session_init/end establishing its state).
        foreignAttributedEventCount++;
        continue;
      }
      if (
        isTeaCacheRelatedEvent &&
        boundSessionId !== null &&
        typeof meta.sessionId === "string" &&
        meta.sessionId !== boundSessionId
      ) {
        // An explicit session_id that disagrees with the one this window
        // already bound (from session_init) is a foreign/terminal-session
        // mismatch -- e.g. a session_end claiming a different session than
        // the one that was actually initialized here.
        foreignAttributedEventCount++;
        continue;
      }
      if (meta.teacacheSession === "start" || meta.teacacheEvent === "session_init") {
        hasCacheEvents = true;
        sessionAttempts++;
        sessionInitSeen = true;
        if (event.spanId) {
          sessionId = event.spanId;
        }
        if (meta.sessionId) {
          sessionId = String(meta.sessionId);
          if (boundSessionId === null) {
            boundSessionId = sessionId;
          }
        }
        if (meta.adapterIdentity === undefined || meta.adapterIdentity === null) {
          adapterIdentityVerifiedFailure =
            "TeaCache session_init did not report an adapterIdentity; loaded-module identity cannot be certified.";
        } else if (typeof meta.adapterIdentity === "object") {
          const ai = meta.adapterIdentity as { verified?: unknown; observedDigest?: unknown };
          if (ai.verified !== true) {
            adapterIdentityVerifiedFailure =
              "TeaCache adapter identity was not verified for this session's loaded module.";
          } else if (
            typeof ai.observedDigest === "string" &&
            ai.observedDigest !== teacacheRequest.adapterDigest
          ) {
            adapterIdentityVerifiedFailure = `TeaCache adapter observedDigest "${ai.observedDigest}" does not match the pinned/requested adapterDigest "${teacacheRequest.adapterDigest}".`;
          }
        }
        // Track one identity per session_init occurrence (preferring the
        // explicit sessionId field, since a point_event's own spanId is
        // just that event's identity, not the session's) to detect two
        // genuinely different sessions' events being mixed into one
        // reduction window.
        observedSessionIds.add(
          meta.sessionId ? String(meta.sessionId) : (event.spanId ?? "unknown")
        );
        if (meta.effectiveConfig && typeof meta.effectiveConfig === "object") {
          const ec = meta.effectiveConfig as Record<string, unknown>;
          if (
            typeof ec.relL1Thresh === "number" &&
            typeof ec.startStep === "number" &&
            typeof ec.endStep === "number" &&
            typeof ec.totalSteps === "number"
          ) {
            // The contract type only permits totalSteps === 20 (mirroring
            // the hard runtime invariant), so a genuinely-different reported
            // value cannot be represented in observedEffectiveConfig at
            // all -- it must be surfaced as a failure instead of silently
            // coerced to the only representable value.
            if (ec.totalSteps !== 20) {
              failureReasons.push(
                `Observed effectiveConfig reported totalSteps=${ec.totalSteps}, expected 20.`
              );
            } else {
              observedEffectiveConfig = {
                mode: (ec.mode as MinimaxH3TeaCacheMode) ?? "raw-l1-v1",
                relL1Thresh: ec.relL1Thresh,
                startStep: ec.startStep,
                endStep: ec.endStep,
                totalSteps: 20,
                normalizedStartStep:
                  typeof ec.normalizedStartStep === "number"
                    ? ec.normalizedStartStep
                    : ec.startStep,
                normalizedEndStep:
                  typeof ec.normalizedEndStep === "number"
                    ? ec.normalizedEndStep
                    : ec.endStep < 0
                      ? 20 + ec.endStep
                      : ec.endStep
              };
            }
          }
        } else if (meta.mode === "raw-l1-v1" && typeof meta.relL1Thresh === "number") {
          observedEffectiveConfig = {
            mode: "raw-l1-v1",
            relL1Thresh: meta.relL1Thresh,
            startStep: typeof meta.startStep === "number" ? meta.startStep : 2,
            endStep: typeof meta.endStep === "number" ? meta.endStep : -2,
            totalSteps: 20,
            normalizedStartStep: typeof meta.startStep === "number" ? meta.startStep : 2,
            normalizedEndStep:
              typeof meta.normalizedEndStep === "number"
                ? meta.normalizedEndStep
                : typeof meta.endStep === "number" && meta.endStep < 0
                  ? 20 + meta.endStep
                  : 18
          };
        }
      }

      if (meta.teacacheSession === "end") {
        sessionEndSeen = true;
        sessionEndCount++;
      }

      const isSkip = meta.teacacheEvent === "cache_hit" || meta.decision === "skip";
      const isFull = meta.teacacheEvent === "cache_miss" || meta.decision === "full";
      const stepIdx =
        typeof meta.stepIndex === "number"
          ? meta.stepIndex
          : typeof meta.step_index === "number"
            ? meta.step_index
            : undefined;

      if (isSkip || isFull) {
        hasCacheEvents = true;
        if (stepIdx !== undefined) {
          if (seenSteps.has(stepIdx)) {
            duplicateStepEvaluations++;
          }
          seenSteps.add(stepIdx);
          stepDecisions.set(stepIdx, isSkip ? "skip" : "full");
        }
        if (isSkip) {
          cacheHitsRecorded++;
        } else {
          forwardCallsRecorded++;
        }
      }

      const summary = (meta.teacacheSummary ?? meta.summary) as
        | {
            status?: "verified" | "no_op" | "failed" | "unknown";
            forwardCallsRecorded?: number;
            forwardCalls?: number;
            cacheHitsRecorded?: number;
            cacheHits?: number;
            modelForwardsRecorded?: number;
            nestedForwardsOnHits?: number;
            failureReason?: string;
          }
        | undefined;

      if (summary) {
        hasCacheEvents = true;
        // Real producer events always pair a summary with
        // meta.teacacheSession === "end" on the SAME event, which already
        // increments sessionEndCount above -- do not double-count it here.
        sessionEndSeen = true;
        if (typeof summary.nestedForwardsOnHits === "number" && summary.nestedForwardsOnHits > 0) {
          nestedForwardsOnHits = Math.max(nestedForwardsOnHits, summary.nestedForwardsOnHits);
        }
        if (summary.failureReason) {
          failureReasons.push(summary.failureReason);
        }
        if (teacacheRequest.mode === "off") {
          const fc = summary.forwardCallsRecorded ?? summary.forwardCalls;
          if (typeof fc === "number") {
            forwardCallsRecorded = fc;
          }
        } else {
          // For raw-l1-v1, forwardCallsRecorded/cacheHitsRecorded are
          // built independently from the actual per-step decision events
          // (never copied from this self-reported summary). Capture the
          // summary's own numbers to cross-check against that independent
          // count once the full stream has been processed -- a
          // forged/corrupted terminal event reporting counts that
          // disagree (e.g. 999/999) must still disqualify the run even
          // though the independently-counted totals aren't overwritten by
          // it.
          const summaryFc = summary.forwardCallsRecorded ?? summary.forwardCalls;
          const summaryCh = summary.cacheHitsRecorded ?? summary.cacheHits;
          if (typeof summaryFc === "number") {
            lastSummaryForwardCallsRecorded = summaryFc;
          }
          if (typeof summaryCh === "number") {
            lastSummaryCacheHitsRecorded = summaryCh;
          }
        }
      }

      if (
        (event.phase as string) === "diffusion_forward" ||
        meta.phase === "diffusion_forward" ||
        meta.modelForwardCall === true
      ) {
        const spanKey = event.spanId ?? null;
        if (event.type === "span_start") {
          if (spanKey) {
            openForwardSpanIds.add(spanKey);
          }
        } else if (event.type === "span_end") {
          if (event.outcome === "failed") {
            failedForwardCount++;
          } else if (event.outcome === "success") {
            // A completion only counts as real evidence of a forward if it
            // closes a span this stream actually saw start, and each span
            // closes exactly once. Without this, an injected/duplicated
            // span_end with no matching span_start (or a repeat of one
            // already closed) can inflate modelForwardsRecorded with
            // nothing behind it.
            if (
              !spanKey ||
              !openForwardSpanIds.delete(spanKey) ||
              completedForwardSpanIds.has(spanKey)
            ) {
              orphanOrDuplicateForwardCompletions++;
            } else {
              completedForwardSpanIds.add(spanKey);
              if (stepIdx !== undefined && stepDecisions.get(stepIdx) === "skip") {
                nestedForwardsOnHits++;
              }
            }
          }
        }
      }
    }
  }

  const modelForwardsRecorded = completedForwardSpanIds.size;

  if (samplingOutcomeFailed) {
    failureReasons.push(
      "The sampling span terminated with outcome 'failed'; evidence from a failed run cannot be certified."
    );
  }
  if (failedForwardCount > 0) {
    failureReasons.push(
      `Detected ${failedForwardCount} failed diffusion_model forward execution(s).`
    );
  }
  if (orphanOrDuplicateForwardCompletions > 0) {
    failureReasons.push(
      `Detected ${orphanOrDuplicateForwardCompletions} diffusion_model forward completion event(s) with no matching open span or already closed -- not trustworthy evidence of a real forward.`
    );
  }
  if (openForwardSpanIds.size > 0) {
    // A span_start with no matching span_end/failure means a forward was
    // initiated (e.g. during an alleged cache hit, which should never
    // start a real forward at all) and never resolved either way -- this
    // must disqualify the observation rather than silently vanish because
    // nothing ever counted it as a completion.
    failureReasons.push(
      `Detected ${openForwardSpanIds.size} diffusion_model forward span(s) that started but never closed (no matching span_end).`
    );
  }
  if (foreignAttributedEventCount > 0) {
    failureReasons.push(
      `Detected ${foreignAttributedEventCount} TeaCache event(s) attributed to a different sampler span than this window's real sampling invocation.`
    );
  }
  if (observedSessionIds.size > 1) {
    failureReasons.push(
      `Observed ${observedSessionIds.size} distinct TeaCache session IDs in one reduction window; session attribution is ambiguous.`
    );
  }
  if (sessionEndCount > 1) {
    failureReasons.push(
      `Observed ${sessionEndCount} TeaCache session-end/terminal events; exactly one is expected per session.`
    );
  }
  if (adapterIdentityVerifiedFailure) {
    failureReasons.push(adapterIdentityVerifiedFailure);
  }
  if (
    teacacheRequest.mode === "raw-l1-v1" &&
    lastSummaryForwardCallsRecorded !== null &&
    lastSummaryForwardCallsRecorded !== forwardCallsRecorded
  ) {
    failureReasons.push(
      `Terminal summary reports forwardCallsRecorded=${lastSummaryForwardCallsRecorded}, which disagrees with the independently observed count of ${forwardCallsRecorded}.`
    );
  }
  if (
    teacacheRequest.mode === "raw-l1-v1" &&
    lastSummaryCacheHitsRecorded !== null &&
    lastSummaryCacheHitsRecorded !== cacheHitsRecorded
  ) {
    failureReasons.push(
      `Terminal summary reports cacheHitsRecorded=${lastSummaryCacheHitsRecorded}, which disagrees with the independently observed count of ${cacheHitsRecorded}.`
    );
  }

  if (!hasCacheEvents) {
    return {
      status: "unknown",
      mode: teacacheRequest.mode,
      requestedConfig,
      effectiveConfig: null,
      totalSteps: 20,
      forwardCallsRecorded: null,
      cacheHitsRecorded: null,
      nestedForwardsOnHits: null,
      coverage: {
        samplingCallsRecorded,
        modelForwardsRecorded: null,
        complete: false
      },
      timings: {
        samplingWallMs,
        modelForwardElapsedMs: null,
        decisionOverheadMs: null,
        timingUnavailableReason: "No TeaCache events recorded in execution log"
      },
      failureReason:
        failureReasons.length > 0
          ? failureReasons.join("; ")
          : "No TeaCache events recorded in execution log",
      sessionId: null,
      sessionAttempts: 0
    };
  }

  // Validate configuration identity
  if (teacacheRequest.mode === "raw-l1-v1") {
    if (!observedEffectiveConfig) {
      failureReasons.push(
        "Missing observed effectiveConfig from session runtime events; cannot certify runtime configuration."
      );
    } else if (requestedConfig) {
      const endStepMatches =
        observedEffectiveConfig.endStep === requestedConfig.endStep ||
        observedEffectiveConfig.normalizedEndStep === requestedConfig.normalizedEndStep;
      if (
        observedEffectiveConfig.mode !== requestedConfig.mode ||
        observedEffectiveConfig.relL1Thresh !== requestedConfig.relL1Thresh ||
        observedEffectiveConfig.startStep !== requestedConfig.startStep ||
        !endStepMatches ||
        observedEffectiveConfig.totalSteps !== requestedConfig.totalSteps
      ) {
        failureReasons.push(
          `Observed effectiveConfig (thresh=${observedEffectiveConfig.relL1Thresh}, window=[${observedEffectiveConfig.startStep}, ${observedEffectiveConfig.endStep})) does not match requestedConfig (thresh=${requestedConfig.relL1Thresh}, window=[${requestedConfig.startStep}, ${requestedConfig.endStep})).`
        );
      }
    }
  }

  if (teacacheRequest.mode === "raw-l1-v1" && seenSteps.size > 0) {
    const missing: number[] = [];
    for (let i = 0; i < 20; i++) {
      if (!seenSteps.has(i)) {
        missing.push(i);
      }
    }
    const outOfRange = Array.from(seenSteps).filter((s) => s < 0 || s > 19);
    if (missing.length > 0 || outOfRange.length > 0) {
      failureReasons.push(
        `Step coverage does not span the exact [0, 20) range: missing=[${missing.join(",")}], outOfRange=[${outOfRange.join(",")}].`
      );
    }
  }

  if (duplicateStepEvaluations > 0) {
    failureReasons.push(
      `Detected ${duplicateStepEvaluations} duplicate evaluation(s) in logical step intervals.`
    );
  }

  if (nestedForwardsOnHits > 0) {
    failureReasons.push(
      `Detected ${nestedForwardsOnHits} nested diffusion_model forward execution(s) during alleged cache hits. Forward was not skipped.`
    );
  }

  if (teacacheRequest.mode === "raw-l1-v1") {
    if (forwardCallsRecorded + cacheHitsRecorded !== 20) {
      failureReasons.push(
        `Incomplete or inconsistent step count: ${forwardCallsRecorded} forwards + ${cacheHitsRecorded} hits != 20 total steps.`
      );
    }
    if (modelForwardsRecorded !== forwardCallsRecorded) {
      failureReasons.push(
        `Independent diffusion_model forwards (${modelForwardsRecorded}) does not match wrapper forward calls (${forwardCallsRecorded}).`
      );
    }
    if (!sessionInitSeen) {
      failureReasons.push("TeaCache session init event was not observed.");
    }
    if (!sessionEndSeen) {
      failureReasons.push("TeaCache session end event was not observed.");
    }
    if (!samplingSpanEndSeen) {
      failureReasons.push("Sampling span end event was not observed.");
    }
  } else {
    // Mode off: matched control
    if (cacheHitsRecorded > 0) {
      failureReasons.push(
        `Observed ${cacheHitsRecorded} cache hits while caching was disabled (mode: 'off').`
      );
    }
    if (modelForwardsRecorded !== 20) {
      failureReasons.push(
        `Expected 20 independent diffusion_model forwards for control run, got ${modelForwardsRecorded}.`
      );
    }
    if (forwardCallsRecorded !== 20) {
      failureReasons.push(
        `Expected 20 forward calls for control run, got ${forwardCallsRecorded}.`
      );
    }
    if (!samplingSpanEndSeen) {
      failureReasons.push("Sampling span end event was not observed.");
    }
    if (!sessionInitSeen) {
      failureReasons.push("TeaCache control session init event was not observed.");
    }
    if (!sessionEndSeen) {
      failureReasons.push("TeaCache control session end event was not observed.");
    }
    // Do not fabricate the control run's effectiveConfig -- it must come
    // from an actually-observed session_init/off-mode event (parsed above,
    // same codepath as the raw-l1-v1 branch). A synthesized value here would
    // report "verified" configuration evidence that was never genuinely
    // observed on this run.
    if (!observedEffectiveConfig) {
      failureReasons.push(
        "Missing observed effectiveConfig for the disabled-caching control run; cannot certify runtime configuration."
      );
    } else if (observedEffectiveConfig.mode !== "off") {
      // An observed effectiveConfig that reports caching as actually
      // enabled (e.g. "raw-l1-v1") directly contradicts a control run,
      // regardless of how the forward/hit counters above happened to add
      // up -- this is the run's own evidence disagreeing with what it's
      // being certified as.
      failureReasons.push(
        `Control run's observed effectiveConfig reports mode "${observedEffectiveConfig.mode}", expected "off".`
      );
    } else if (observedEffectiveConfig.totalSteps !== 20) {
      failureReasons.push(
        `Control run reported totalSteps=${observedEffectiveConfig.totalSteps}, expected 20.`
      );
    }
  }

  let finalStatus: "verified" | "no_op" | "failed" | "unknown";
  let failureReason: string | null = null;

  if (failureReasons.length > 0) {
    finalStatus = "failed";
    failureReason = failureReasons.join("; ");
  } else if (teacacheRequest.mode === "raw-l1-v1" && cacheHitsRecorded === 0) {
    finalStatus = "no_op";
    failureReason = null;
  } else {
    finalStatus = "verified";
    failureReason = null;
  }

  // A set of 20 distinct step values is not the same guarantee as "steps 0
  // through 19 were each evaluated once" -- e.g. 20 distinct but
  // out-of-range indices (observed from an adversarial/malformed stream)
  // would pass a bare size check. Require the exact contiguous range.
  let stepsCoverFullRange = seenSteps.size === 20;
  if (stepsCoverFullRange) {
    for (let i = 0; i < 20; i++) {
      if (!seenSteps.has(i)) {
        stepsCoverFullRange = false;
        break;
      }
    }
  }

  const complete =
    identityValidated &&
    finalStatus !== "failed" &&
    samplingCallsRecorded > 0 &&
    samplingSpanEndSeen &&
    (teacacheRequest.mode === "off"
      ? modelForwardsRecorded === 20 && forwardCallsRecorded === 20
      : sessionEndSeen &&
        stepsCoverFullRange &&
        duplicateStepEvaluations === 0 &&
        forwardCallsRecorded + cacheHitsRecorded === 20 &&
        modelForwardsRecorded === forwardCallsRecorded);

  // Require coverage.complete === true before setting status to "verified"
  if (finalStatus === "verified" && !complete) {
    finalStatus = "failed";
    failureReason = failureReason ?? "Measurement coverage incomplete or unverified";
  }

  return {
    status: finalStatus,
    mode: teacacheRequest.mode,
    requestedConfig,
    effectiveConfig: finalStatus !== "failed" ? observedEffectiveConfig : null,
    totalSteps: 20,
    forwardCallsRecorded,
    cacheHitsRecorded,
    nestedForwardsOnHits,
    coverage: {
      samplingCallsRecorded,
      modelForwardsRecorded: hasCacheEvents ? modelForwardsRecorded : null,
      complete
    },
    timings: {
      samplingWallMs,
      modelForwardElapsedMs: null,
      decisionOverheadMs: null,
      timingUnavailableReason: null
    },
    failureReason,
    sessionId,
    sessionAttempts
  };
}
