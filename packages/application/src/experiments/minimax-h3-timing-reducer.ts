import {
  type MinimaxH3InstrumentationEvent,
  type MinimaxH3PhaseAccountingResult,
  type MinimaxH3PhaseRecord,
  type MinimaxH3PhaseType,
  type MinimaxH3StepRecord,
  MINIMAX_H3_PHASE_TYPES
} from "@cco/contracts";

export interface TimingReducerOptions {
  events: readonly MinimaxH3InstrumentationEvent[];
  parentWallTimeMs: number;
  declaredSteps?: number;
  profilerMode?: "none" | "pytorch_profiler" | "nvtx" | "unknown";
  profilerKernelTimeMs?: number | null;
}

interface SpanInterval {
  spanId: string;
  parentSpanId: string | null;
  phase: MinimaxH3PhaseType;
  clockDomain: "mono_child" | "mono_parent" | "none";
  startMs: number;
  endMs: number;
  durationMs: number;
  stepIndex?: number | undefined;
  outcome?: "success" | "failed" | "interrupted" | undefined;
  nodeId?: string | undefined;
  classType?: string | undefined;
}

export function computeIntervalUnionDuration(
  intervals: Array<{ startMs: number; endMs: number }>
): number {
  if (intervals.length === 0) return 0;
  // Sort intervals by start time
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  let totalDuration = 0;
  let curStart = sorted[0]!.startMs;
  let curEnd = sorted[0]!.endMs;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (next.startMs <= curEnd) {
      curEnd = Math.max(curEnd, next.endMs);
    } else {
      totalDuration += Math.max(0, curEnd - curStart);
      curStart = next.startMs;
      curEnd = next.endMs;
    }
  }
  totalDuration += Math.max(0, curEnd - curStart);
  return totalDuration;
}

export function reducePhaseAccounting(
  options: TimingReducerOptions
): MinimaxH3PhaseAccountingResult {
  const {
    events,
    parentWallTimeMs,
    declaredSteps,
    profilerMode = "none",
    profilerKernelTimeMs = null
  } = options;

  const inconsistencies: string[] = [];
  const coverageGaps: Array<{
    startMs: number;
    endMs: number;
    durationMs: number;
    reason: string;
  }> = [];

  if (events.length === 0) {
    const emptyPhases: Record<string, MinimaxH3PhaseRecord> = {};
    for (const phase of MINIMAX_H3_PHASE_TYPES) {
      emptyPhases[phase] = {
        phase,
        status: "unknown",
        durationMs: null,
        startMs: null,
        endMs: null,
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        unknownReason: "missing_events"
      };
    }
    emptyPhases.whole_attempt_wall = {
      phase: "whole_attempt_wall",
      status: "measured",
      durationMs: parentWallTimeMs,
      startMs: 0,
      endMs: parentWallTimeMs,
      boundarySource: "parent_orchestration",
      clockDomain: "mono_parent",
      unknownReason: null
    };

    return {
      status: "missing",
      phases: emptyPhases as Record<MinimaxH3PhaseType, MinimaxH3PhaseRecord>,
      wholeAttemptWallMs: parentWallTimeMs,
      samplingWallTimeMs: null,
      deviceElapsedMs: null,
      gpuKernelTimeMs: null,
      profilerMode,
      coverageGaps: [],
      intervalInconsistencies: ["No instrumentation events recorded"]
    };
  }

  // 1. Validate sequence and detect gaps
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]!;
    if (ev.sequence !== i + 1) {
      inconsistencies.push(
        `Sequence mismatch at index ${i}: expected ${i + 1}, found ${ev.sequence}`
      );
    }
  }

  // 2. Pair span_start with span_end
  const starts = new Map<string, MinimaxH3InstrumentationEvent>();
  const completedSpans: SpanInterval[] = [];

  for (const ev of events) {
    if (ev.type === "span_start") {
      if (starts.has(ev.spanId)) {
        inconsistencies.push(`Duplicate span_start for spanId ${ev.spanId}`);
      }
      starts.set(ev.spanId, ev);
    } else if (ev.type === "span_end") {
      const startEv = starts.get(ev.spanId);
      if (!startEv) {
        inconsistencies.push(`span_end without matching start for spanId ${ev.spanId}`);
        continue;
      }
      starts.delete(ev.spanId);

      // Validate clock domain consistency
      if (startEv.clockDomain !== ev.clockDomain) {
        inconsistencies.push(
          `Clock domain mismatch for spanId ${ev.spanId}: ${startEv.clockDomain} vs ${ev.clockDomain}`
        );
        continue;
      }

      // Validate nonnegative duration
      if (ev.monotonicMs < startEv.monotonicMs) {
        inconsistencies.push(
          `Negative duration for spanId ${ev.spanId}: end (${ev.monotonicMs}) < start (${startEv.monotonicMs})`
        );
        continue;
      }

      const durationMs = ev.monotonicMs - startEv.monotonicMs;
      completedSpans.push({
        spanId: ev.spanId,
        parentSpanId: ev.parentSpanId ?? startEv.parentSpanId ?? null,
        phase: ev.phase,
        clockDomain: ev.clockDomain,
        startMs: startEv.monotonicMs,
        endMs: ev.monotonicMs,
        durationMs,
        stepIndex: ev.stepIndex ?? startEv.stepIndex,
        outcome: ev.outcome,
        nodeId: ev.nodeId ?? startEv.nodeId,
        classType: ev.classType ?? startEv.classType
      });
    }
  }

  // Any remaining unclosed spans are incomplete
  for (const [spanId, unclosed] of starts.entries()) {
    inconsistencies.push(`Unclosed spanId ${spanId} in phase ${unclosed.phase}`);
  }

  // 3. Validate parent containment
  const spansById = new Map<string, SpanInterval>();
  for (const s of completedSpans) {
    spansById.set(s.spanId, s);
  }

  for (const s of completedSpans) {
    if (s.parentSpanId) {
      const parent = spansById.get(s.parentSpanId);
      if (parent) {
        if (s.startMs < parent.startMs || s.endMs > parent.endMs) {
          inconsistencies.push(
            `Child span ${s.spanId} [${s.startMs}, ${s.endMs}] exceeds parent ${parent.spanId} [${parent.startMs}, ${parent.endMs}]`
          );
        }
      } else {
        const unclosedParent = starts.get(s.parentSpanId);
        if (unclosedParent) {
          if (s.startMs < unclosedParent.monotonicMs) {
            inconsistencies.push(
              `Child span ${s.spanId} [${s.startMs}, ${s.endMs}] exceeds parent ${unclosedParent.spanId} [start: ${unclosedParent.monotonicMs}]`
            );
          }
        } else {
          inconsistencies.push(
            `Child span ${s.spanId} references unknown parentSpanId ${s.parentSpanId}`
          );
        }
      }
    }
  }

  // 4. Group intervals by phase and compute disjoint union durations
  const phaseSpans = new Map<MinimaxH3PhaseType, SpanInterval[]>();
  for (const phase of MINIMAX_H3_PHASE_TYPES) {
    phaseSpans.set(phase, []);
  }

  for (const s of completedSpans) {
    const list = phaseSpans.get(s.phase);
    if (list) {
      list.push(s);
    }
  }

  const phaseRecords: Record<string, MinimaxH3PhaseRecord> = {};

  for (const phase of MINIMAX_H3_PHASE_TYPES) {
    if (phase === "whole_attempt_wall") {
      phaseRecords[phase] = {
        phase,
        status: "measured",
        durationMs: parentWallTimeMs,
        startMs: 0,
        endMs: parentWallTimeMs,
        boundarySource: "parent_orchestration",
        clockDomain: "mono_parent",
        unknownReason: null
      };
      continue;
    }

    const spans = phaseSpans.get(phase) ?? [];
    if (spans.length === 0) {
      phaseRecords[phase] = {
        phase,
        status: "unknown",
        durationMs: null,
        startMs: null,
        endMs: null,
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        unknownReason: `no_spans_recorded_for_${phase}`
      };
      continue;
    }

    // Check if any span failed or interrupted
    const hasFailed = spans.some((s) => s.outcome === "failed" || s.outcome === "interrupted");
    if (hasFailed) {
      phaseRecords[phase] = {
        phase,
        status: "unknown",
        durationMs: null,
        startMs: spans[0]!.startMs,
        endMs: spans[spans.length - 1]!.endMs,
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        unknownReason: `span_failed_or_interrupted_in_${phase}`
      };
      continue;
    }

    const earliestStart = Math.min(...spans.map((s) => s.startMs));
    const latestEnd = Math.max(...spans.map((s) => s.endMs));
    const unionDuration = computeIntervalUnionDuration(spans);

    const record: MinimaxH3PhaseRecord = {
      phase,
      status: "measured",
      durationMs: unionDuration,
      startMs: earliestStart,
      endMs: latestEnd,
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      unknownReason: null
    };

    if (phase === "sampling") {
      const stepSpans = phaseSpans.get("sampling_step") ?? [];
      const steps: MinimaxH3StepRecord[] = stepSpans
        .filter((s) => s.stepIndex !== undefined)
        .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))
        .map((s) => ({
          stepIndex: s.stepIndex!,
          startMs: s.startMs,
          endMs: s.endMs,
          durationMs: s.durationMs,
          status: s.outcome === "failed" ? ("unknown" as const) : ("measured" as const),
          unknownReason: s.outcome === "failed" ? "step_failed" : null
        }));

      record.stepCount = steps.length;
      record.steps = steps;

      if (declaredSteps !== undefined && steps.length < declaredSteps) {
        inconsistencies.push(
          `Observed step count (${steps.length}) is less than declared steps (${declaredSteps})`
        );
      }
    }

    phaseRecords[phase] = record;
  }

  // 5. Compute sampling wall time and device elapsed time
  const samplingRecord = phaseRecords.sampling;
  const samplingWallTimeMs =
    samplingRecord?.status === "measured" ? samplingRecord.durationMs : null;

  // Device elapsed time is device execution time (derived from sampling wall if measured)
  const deviceElapsedMs = samplingWallTimeMs;

  // 6. Overall completeness status
  const keyPhases: MinimaxH3PhaseType[] = [
    "environment_startup",
    "conditioning",
    "sampling",
    "vae_decode_video"
  ];
  const missingKeyPhases = keyPhases.filter((p) => phaseRecords[p]?.status !== "measured");

  let completenessStatus: "complete" | "partial" | "missing" = "complete";
  if (missingKeyPhases.length === keyPhases.length) {
    completenessStatus = "missing";
  } else if (missingKeyPhases.length > 0 || inconsistencies.length > 0) {
    completenessStatus = "partial";
  }

  return {
    status: completenessStatus,
    phases: phaseRecords as Record<MinimaxH3PhaseType, MinimaxH3PhaseRecord>,
    wholeAttemptWallMs: parentWallTimeMs,
    samplingWallTimeMs,
    deviceElapsedMs,
    gpuKernelTimeMs: profilerKernelTimeMs,
    profilerMode,
    coverageGaps,
    intervalInconsistencies: inconsistencies
  };
}
