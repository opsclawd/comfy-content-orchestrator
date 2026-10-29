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
  // True as soon as any genuine evaluation/forward evidence was observed
  // (a decision point_event, or a diffusion_forward span start/end, in
  // either outcome) -- distinct from hasCacheEvents, which a bare
  // session_init alone already sets. Without this, a log interrupted right
  // after session_init (no decisions or forwards ever reached) reported
  // forwardCallsRecorded=0/cacheHitsRecorded=0/modelForwardsRecorded=0 as
  // if zero forwards had been CONFIRMED, indistinguishable from a run that
  // genuinely completed with zero of something -- rather than surfacing
  // that nothing was ever observed to count at all.
  let sawAnyStepEvidence = false;
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
  // Maps an open forward span's id to the stepIndex its span_start
  // reported (undefined if none was reported at all). Keeping the
  // START's stepIndex, not just the END's, matters: a forward whose
  // span_start claims a step the stream already decided was a cache HIT
  // must be rejected outright -- a real forward should never even begin
  // during a hit interval, regardless of what its completion later
  // claims -- and a span whose start/end disagree on which step it
  // belongs to is itself contradictory evidence.
  const openForwardSpanIds = new Map<string, number | undefined>();
  let forwardStartedDuringHitCount = 0;
  let forwardStartEndStepMismatchCount = 0;
  let missingAttributionCount = 0;
  const completedForwardSpanIds = new Set<string>();
  let orphanOrDuplicateForwardCompletions = 0;
  let failedForwardCount = 0;

  // Counting completed forward spans is not the same guarantee as "each
  // real step that needed a forward got exactly one". Without per-step
  // attribution, a probe can tag every completed forward with the same
  // stepIndex (e.g. all step 0) and still pass a bare total-count check.
  const completedForwardStepIndices = new Set<number>();
  let duplicateForwardStepAttributions = 0;
  let unattributedForwardCompletions = 0;

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
        if (
          meta.adapterIdentity === undefined ||
          meta.adapterIdentity === null ||
          typeof meta.adapterIdentity !== "object" ||
          Array.isArray(meta.adapterIdentity)
        ) {
          // Covers both "field entirely absent" and a malformed/primitive
          // value (e.g. the literal string "true") that isn't the real
          // {verified, observedDigest, ...} shape at all -- neither can be
          // certified, and a bare typeof-object check elsewhere would
          // silently let a non-object value bypass validation entirely.
          adapterIdentityVerifiedFailure =
            "TeaCache session_init did not report a valid adapterIdentity object; loaded-module identity cannot be certified.";
        } else {
          const ai = meta.adapterIdentity as { verified?: unknown; observedDigest?: unknown };
          if (ai.verified !== true) {
            adapterIdentityVerifiedFailure =
              "TeaCache adapter identity was not verified for this session's loaded module.";
          } else if (typeof ai.observedDigest !== "string" || ai.observedDigest.length === 0) {
            // verified:true with no digest to actually check against the
            // pinned adapterDigest is an unverifiable "trust me" claim,
            // not evidence.
            adapterIdentityVerifiedFailure =
              "TeaCache adapterIdentity is verified but reports no observedDigest to check against the requested adapterDigest.";
          } else if (ai.observedDigest !== teacacheRequest.adapterDigest) {
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
              // The normalized step is a pure function of (raw step,
              // totalSteps) under the documented convention (negative ->
              // totalSteps + raw, else identity) -- there is no legitimate
              // way for a genuine runtime to report a raw/normalized pair
              // that disagrees with that derivation. Deriving it ourselves
              // whenever it isn't explicitly reported, but merely trusting
              // an EXPLICITLY reported value without checking it against
              // that same derivation, is exactly what let an internally
              // contradictory pair (e.g. endStep=10, normalizedEndStep=18)
              // construct a seemingly-valid observedEffectiveConfig at all.
              const derivedNormalizedStartStep =
                ec.startStep < 0 ? 20 + ec.startStep : ec.startStep;
              const derivedNormalizedEndStep = ec.endStep < 0 ? 20 + ec.endStep : ec.endStep;
              const reportedNormalizedStartStep =
                typeof ec.normalizedStartStep === "number" ? ec.normalizedStartStep : undefined;
              const reportedNormalizedEndStep =
                typeof ec.normalizedEndStep === "number" ? ec.normalizedEndStep : undefined;
              if (
                (reportedNormalizedStartStep !== undefined &&
                  reportedNormalizedStartStep !== derivedNormalizedStartStep) ||
                (reportedNormalizedEndStep !== undefined &&
                  reportedNormalizedEndStep !== derivedNormalizedEndStep)
              ) {
                failureReasons.push(
                  `Observed effectiveConfig reports an internally inconsistent raw/normalized step window: startStep=${ec.startStep} (normalized ${reportedNormalizedStartStep ?? derivedNormalizedStartStep}, derived ${derivedNormalizedStartStep}), endStep=${ec.endStep} (normalized ${reportedNormalizedEndStep ?? derivedNormalizedEndStep}, derived ${derivedNormalizedEndStep}).`
                );
              } else {
                observedEffectiveConfig = {
                  mode: (ec.mode as MinimaxH3TeaCacheMode) ?? "raw-l1-v1",
                  relL1Thresh: ec.relL1Thresh,
                  startStep: ec.startStep,
                  endStep: ec.endStep,
                  totalSteps: 20,
                  normalizedStartStep: derivedNormalizedStartStep,
                  normalizedEndStep: derivedNormalizedEndStep
                };
              }
            }
          }
        }
        // Deliberately no further fallback here: an older, non-standard
        // event shape (bare meta.mode/meta.relL1Thresh fields instead of
        // the structured effectiveConfig object the real producer always
        // emits) used to default any missing startStep/endStep to 2/-2 --
        // fabricating unobserved configuration rather than leaving it
        // null and letting the "missing observed effectiveConfig" check
        // below correctly fail the run.
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

      if ((isSkip || isFull) && event.parentSpanId === undefined) {
        // A decision event with no parentSpanId at all cannot be tied to
        // this window's real sampler invocation -- treating "attribution
        // absent" the same as "attribution matches" (rather than as
        // suspicious) is exactly what let a probe with genuinely unlinked
        // decisions still pass. Applies to both modes: decisions only ever
        // occur for raw-l1-v1 in practice, but there is no reason to scope
        // the check narrower than "any decision event this reducer sees".
        missingAttributionCount++;
      }
      if (isSkip || isFull) {
        hasCacheEvents = true;
        sawAnyStepEvidence = true;
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
        // Deliberately NOT setting sessionEndSeen here: a summary object
        // alone is not a terminal marker. The real producer always pairs
        // a summary with meta.teacacheSession === "end" on the SAME
        // event (handled above), so this is never a regression for
        // genuine data -- but an adversarial stream that strips the "end"
        // tag while keeping a summary object must NOT be able to satisfy
        // sessionEndSeen through this path instead.
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
        sawAnyStepEvidence = true;
        if (event.type === "span_start" && event.parentSpanId === undefined) {
          // Applies to both raw-l1-v1 and the matched "off" control: a
          // diffusion_forward span with no parentSpanId cannot be proven
          // to belong to this window's real sampler invocation either way
          // -- a control run's forwards need the same ownership evidence
          // as the candidate's, or an unparented batch of forward spans
          // can be certified as a "verified, complete" control baseline
          // with no sampler attribution at all.
          missingAttributionCount++;
        }
        if (event.type === "span_start") {
          if (spanKey) {
            if (openForwardSpanIds.has(spanKey)) {
              // A second span_start for a spanId that's already open (no
              // intervening close) is contradictory on its own -- a prior
              // version silently overwrote the stored stepIndex via
              // Map.set, discarding evidence of the first, unclosed start
              // instead of flagging the re-open.
              orphanOrDuplicateForwardCompletions++;
            } else {
              openForwardSpanIds.set(spanKey, stepIdx);
              if (stepIdx !== undefined && stepDecisions.get(stepIdx) === "skip") {
                forwardStartedDuringHitCount++;
              }
            }
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
            const startStepIdx = spanKey ? openForwardSpanIds.get(spanKey) : undefined;
            const hadOpenSpan = spanKey !== null && openForwardSpanIds.has(spanKey);
            if (spanKey) {
              openForwardSpanIds.delete(spanKey);
            }
            if (!spanKey || !hadOpenSpan || completedForwardSpanIds.has(spanKey)) {
              orphanOrDuplicateForwardCompletions++;
            } else if (startStepIdx !== stepIdx) {
              // Required to be EXACTLY equal, including "one side defined,
              // the other not": a forward's start and end must agree on
              // which real step it belongs to. Treating "either side
              // missing" as an automatic pass (rather than a mismatch) was
              // the gap that let a probe delete just the start's
              // stepIndex and still have the completion's stepIndex alone
              // satisfy attribution.
              forwardStartEndStepMismatchCount++;
            } else {
              completedForwardSpanIds.add(spanKey);
              if (stepIdx !== undefined && stepDecisions.get(stepIdx) === "skip") {
                nestedForwardsOnHits++;
              }
              if (stepIdx === undefined) {
                unattributedForwardCompletions++;
              } else if (completedForwardStepIndices.has(stepIdx)) {
                duplicateForwardStepAttributions++;
              } else {
                completedForwardStepIndices.add(stepIdx);
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
  if (missingAttributionCount > 0) {
    failureReasons.push(
      `Detected ${missingAttributionCount} decision/forward event(s) with no parentSpanId at all, so they cannot be tied to this window's real sampler invocation.`
    );
  }
  if (forwardStartedDuringHitCount > 0) {
    failureReasons.push(
      `Detected ${forwardStartedDuringHitCount} diffusion_model forward(s) that STARTED during a step already decided as a cache hit -- a real forward must never begin in a hit interval, regardless of how it completes.`
    );
  }
  if (forwardStartEndStepMismatchCount > 0) {
    failureReasons.push(
      `Detected ${forwardStartEndStepMismatchCount} diffusion_model forward span(s) whose span_start and span_end report different, contradictory stepIndex values.`
    );
  }
  if (teacacheRequest.mode === "raw-l1-v1" && unattributedForwardCompletions > 0) {
    // Control ("off") runs have no TeaCacheSession and therefore no
    // step-index tracking at all -- per-step attribution only applies to
    // the active-caching path, where it is the only way to distinguish
    // "20 independent forwards, one per real step" from "20 completions
    // all tagged the same step".
    failureReasons.push(
      `Detected ${unattributedForwardCompletions} completed diffusion_model forward(s) with no stepIndex attribution; cannot verify each real step independently.`
    );
  }
  if (teacacheRequest.mode === "raw-l1-v1" && duplicateForwardStepAttributions > 0) {
    failureReasons.push(
      `Detected ${duplicateForwardStepAttributions} completed diffusion_model forward(s) attributed to a stepIndex that already had a completed forward -- forwards are not independently attributed to distinct steps.`
    );
  }
  if (teacacheRequest.mode === "raw-l1-v1" && hasCacheEvents) {
    const missedStepIndices = new Set(
      Array.from(stepDecisions.entries())
        .filter(([, decision]) => decision === "full")
        .map(([step]) => step)
    );
    const missingForwardSteps = Array.from(missedStepIndices).filter(
      (s) => !completedForwardStepIndices.has(s)
    );
    const extraForwardSteps = Array.from(completedForwardStepIndices).filter(
      (s) => !missedStepIndices.has(s)
    );
    if (missingForwardSteps.length > 0 || extraForwardSteps.length > 0) {
      failureReasons.push(
        `Completed forwards are not a bijection with cache-miss decisions by step: missingForwardSteps=[${missingForwardSteps.join(",")}], extraForwardSteps=[${extraForwardSteps.join(",")}].`
      );
    }
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
      // Both the raw and normalized windows must agree with the request --
      // internal consistency of the observed pair (checked above) does not
      // by itself prove it's the SAME window as what was requested. An
      // "either matches" check let a candidate observe/report endStep=10
      // (normalizedEndStep=18) pass against a request of endStep=-2
      // (normalizedEndStep=18) purely because the normalized values
      // happened to agree, even though endStep=10 is not the window -2
      // resolves to under this session's totalSteps=20 convention.
      if (
        observedEffectiveConfig.mode !== requestedConfig.mode ||
        observedEffectiveConfig.relL1Thresh !== requestedConfig.relL1Thresh ||
        observedEffectiveConfig.startStep !== requestedConfig.startStep ||
        observedEffectiveConfig.endStep !== requestedConfig.endStep ||
        observedEffectiveConfig.normalizedStartStep !== requestedConfig.normalizedStartStep ||
        observedEffectiveConfig.normalizedEndStep !== requestedConfig.normalizedEndStep ||
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
    forwardCallsRecorded: sawAnyStepEvidence ? forwardCallsRecorded : null,
    cacheHitsRecorded: sawAnyStepEvidence ? cacheHitsRecorded : null,
    nestedForwardsOnHits,
    coverage: {
      samplingCallsRecorded,
      modelForwardsRecorded: sawAnyStepEvidence ? modelForwardsRecorded : null,
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
