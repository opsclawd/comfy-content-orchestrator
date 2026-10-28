import { describe, expect, it } from "vitest";
import { reduceTeaCacheObservation } from "./minimax-h3-teacache-reducer.js";
import {
  TEACACHE_UPSTREAM_COMMIT,
  TEACACHE_ADAPTER_VERSION,
  TEACACHE_NODE_KEY,
  type MinimaxH3TeaCacheRequest,
  type MinimaxH3InstrumentationEvent,
  type MinimaxH3PhaseType
} from "@cco/contracts";

describe("minimax-h3-teacache-reducer", () => {
  const sampleRequest: MinimaxH3TeaCacheRequest = {
    mode: "raw-l1-v1",
    relL1Thresh: 0.15,
    startStep: 2,
    endStep: -2,
    totalSteps: 20,
    normalizedStartStep: 2,
    normalizedEndStep: 18,
    upstreamCommit: TEACACHE_UPSTREAM_COMMIT,
    adapterVersion: TEACACHE_ADAPTER_VERSION,
    adapterDigest: "a".repeat(64),
    catalogDigest: "b".repeat(64),
    topologyDigest: "c".repeat(64),
    patchNode: {
      nodeId: "401",
      classType: TEACACHE_NODE_KEY,
      inputs: {
        model: ["6", 0],
        rel_l1_thresh: 0.15,
        start_step: 2,
        end_step: -2,
        total_steps: 20
      }
    }
  };

  const makeEvent = (
    phase: MinimaxH3PhaseType,
    type: "span_start" | "span_end" | "point_event",
    meta?: Record<string, unknown>,
    monotonicMs = 1000,
    outcome: "success" | "failed" = "success"
  ): MinimaxH3InstrumentationEvent => ({
    protocolVersion: "v2-jsonl",
    sequence: 1,
    runId: "run-1",
    attemptToken: "token-1",
    promptId: "prompt-1",
    spanId: "span-1",
    phase,
    type,
    outcome: type === "span_end" ? outcome : undefined,
    boundarySource: "child_bootstrap",
    clockDomain: "mono_child",
    monotonicMs,
    metadata: meta
  });

  function generateEvents(options: {
    skips: number[];
    includeSessionInit?: boolean;
    includeSessionEnd?: boolean;
    includeSamplingSpans?: boolean;
    effectiveConfig?: Record<string, unknown>;
  }): MinimaxH3InstrumentationEvent[] {
    const events: MinimaxH3InstrumentationEvent[] = [];
    const skipSet = new Set(options.skips);

    if (options.includeSamplingSpans !== false) {
      events.push(makeEvent("sampling", "span_start", undefined, 1000));
    }

    if (options.includeSessionInit !== false) {
      events.push(
        makeEvent(
          "sampling",
          "point_event",
          {
            teacacheSession: "start",
            teacacheEvent: "session_init",
            effectiveConfig: options.effectiveConfig ?? {
              mode: "raw-l1-v1",
              relL1Thresh: 0.15,
              startStep: 2,
              endStep: -2,
              totalSteps: 20,
              normalizedStartStep: 2,
              normalizedEndStep: 18
            }
          },
          1050
        )
      );
    }

    for (let s = 0; s < 20; s++) {
      const isSkip = skipSet.has(s);
      events.push(
        makeEvent(
          "sampling",
          "point_event",
          {
            teacacheEvent: isSkip ? "cache_hit" : "cache_miss",
            stepIndex: s
          },
          1100 + s * 10
        )
      );

      if (!isSkip) {
        const fwdSpanId = `span-df-${s}`;
        events.push({
          ...makeEvent(
            "sampling",
            "span_start",
            {
              phase: "diffusion_forward",
              modelForwardCall: true,
              stepIndex: s
            },
            1103 + s * 10
          ),
          spanId: fwdSpanId
        });
        events.push({
          ...makeEvent(
            "sampling",
            "span_end",
            {
              phase: "diffusion_forward",
              modelForwardCall: true,
              stepIndex: s
            },
            1105 + s * 10
          ),
          spanId: fwdSpanId
        });
      }
    }

    if (options.includeSessionEnd !== false) {
      const forwardCalls = 20 - options.skips.length;
      events.push(
        makeEvent(
          "sampling",
          "point_event",
          {
            teacacheSession: "end",
            summary: {
              mode: "raw-l1-v1",
              forwardCalls,
              cacheHits: options.skips.length,
              totalSteps: 20
            }
          },
          1800
        )
      );
    }

    if (options.includeSamplingSpans !== false) {
      events.push(makeEvent("sampling", "span_end", undefined, 2000));
    }

    return events;
  }

  it("returns undefined when teacacheRequest is omitted", () => {
    const obs = reduceTeaCacheObservation({
      events: [makeEvent("sampling", "span_start")]
    });
    expect(obs).toBeUndefined();
  });

  it("reduces verified observation with positive hits and matched counts", () => {
    const events = generateEvents({
      skips: [4, 5, 6, 7, 8, 9, 10] // 7 hits, 13 forwards
    });

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1",
      expectedAttemptToken: "token-1"
    });

    expect(obs).toBeDefined();
    expect(obs?.status).toBe("verified");
    expect(obs?.forwardCallsRecorded).toBe(13);
    expect(obs?.cacheHitsRecorded).toBe(7);
    expect(obs?.coverage.complete).toBe(true);
    expect(obs?.timings.samplingWallMs).toBe(1000);
    expect(obs?.effectiveConfig?.relL1Thresh).toBe(0.15);
  });

  it("detects no_op when cache hits count is 0", () => {
    const events = generateEvents({
      skips: [] // 0 hits, 20 forwards
    });

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("no_op");
    expect(obs?.cacheHitsRecorded).toBe(0);
    expect(obs?.forwardCallsRecorded).toBe(20);
    expect(obs?.coverage.complete).toBe(true);
  });

  it("fails when nested model forwards occur on cache hits", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "span_start", { teacacheSession: "start" }),
      makeEvent("sampling", "point_event", {
        teacacheSummary: {
          status: "verified",
          forwardCallsRecorded: 14,
          cacheHitsRecorded: 6,
          modelForwardsRecorded: 16,
          nestedForwardsOnHits: 2
        }
      }),
      makeEvent("sampling", "span_end")
    ];

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.failureReason).toMatch(/nested/i);
    expect(obs?.coverage.complete).toBe(false);
  });

  it("fails when step count does not sum to 20", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "span_start", { teacacheSession: "start" }),
      makeEvent("sampling", "point_event", {
        teacacheSummary: {
          status: "verified",
          forwardCallsRecorded: 10,
          cacheHitsRecorded: 5, // 15 != 20
          modelForwardsRecorded: 10,
          nestedForwardsOnHits: 0
        }
      }),
      makeEvent("sampling", "span_end")
    ];

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.failureReason).toMatch(/step count/i);
  });

  it("returns unknown when no caching events are recorded", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "span_end")
    ];

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("unknown");
    expect(obs?.forwardCallsRecorded).toBeNull();
    expect(obs?.cacheHitsRecorded).toBeNull();
    expect(obs?.coverage.complete).toBe(false);
  });

  it("fails and rejects adversarial stream with duplicate step-zero decisions and zero forwards", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "span_start", {
        teacacheSession: "start",
        effectiveConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      })
    ];

    // Emit 20 duplicate step-0 decisions
    for (let i = 0; i < 20; i++) {
      events.push(
        makeEvent("sampling", "point_event", {
          teacacheEvent: "cache_miss",
          stepIndex: 0
        })
      );
    }
    // No session end, 0 independent diffusion forwards
    events.push(makeEvent("sampling", "span_end"));

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.coverage.complete).toBe(false);
    expect(obs?.failureReason).toMatch(/duplicate|forward/i);
  });

  it("fails when independent model forwards disagree with wrapper forward calls", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "span_start", {
        teacacheSession: "start",
        effectiveConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      })
    ];

    // 14 misses, 6 hits
    for (let s = 0; s < 20; s++) {
      const isHit = s >= 5 && s <= 10;
      events.push(
        makeEvent("sampling", "point_event", {
          teacacheEvent: isHit ? "cache_hit" : "cache_miss",
          stepIndex: s
        })
      );
      // But only 10 independent diffusion_forwards recorded instead of 14
      if (!isHit && s < 10) {
        events.push(makeEvent("sampling", "span_end", { modelForwardCall: true }, 1000 + s * 10));
      }
    }
    events.push(makeEvent("sampling", "span_end", { teacacheSession: "end" }));

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.coverage.complete).toBe(false);
    expect(obs?.failureReason).toMatch(/does not match wrapper/i);
  });

  it("fails when observed effectiveConfig mismatches requestedConfig", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "span_start", {
        teacacheSession: "start",
        effectiveConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.05, // requested was 0.15
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      }),
      makeEvent("sampling", "point_event", {
        teacacheSummary: {
          status: "verified",
          forwardCallsRecorded: 14,
          cacheHitsRecorded: 6,
          modelForwardsRecorded: 14,
          nestedForwardsOnHits: 0
        }
      }),
      makeEvent("sampling", "span_end", { teacacheSession: "end" })
    ];

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.coverage.complete).toBe(false);
    expect(obs?.failureReason).toMatch(/effectiveConfig/i);
  });

  it("reconciles authentic producer-shaped control events with 20 diffusion forwards, 1 sampler invocation, and verified status", () => {
    const controlRequest: MinimaxH3TeaCacheRequest = {
      ...sampleRequest,
      mode: "off",
      patchNode: null
    };

    const samplerSpanId = "span-sampler-1";
    const events: MinimaxH3InstrumentationEvent[] = [
      {
        ...makeEvent("sampling", "span_start", {
          samplerName: "res_multistep",
          schedulerName: "simple"
        }),
        spanId: samplerSpanId
      },
      makeEvent("sampling", "point_event", {
        teacacheEvent: "session_init",
        effectiveConfig: {
          mode: "off",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: 18,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      })
    ];

    // Emit 20 diffusion_forward spans nested under samplerSpanId
    for (let s = 0; s < 20; s++) {
      const fwdSpanId = `span-df-${s}`;
      events.push({
        ...makeEvent(
          "sampling",
          "span_start",
          {
            modelForwardCall: true,
            phase: "diffusion_forward"
          },
          1100 + s * 20
        ),
        spanId: fwdSpanId,
        parentSpanId: samplerSpanId
      });
      events.push({
        ...makeEvent(
          "sampling",
          "span_end",
          {
            modelForwardCall: true,
            phase: "diffusion_forward"
          },
          1110 + s * 20
        ),
        spanId: fwdSpanId,
        parentSpanId: samplerSpanId
      });
    }

    events.push(
      makeEvent(
        "sampling",
        "point_event",
        {
          teacacheSession: "end",
          summary: {
            mode: "off",
            forwardCalls: 20,
            cacheHits: 0
          },
          teacacheSummary: {
            status: "verified",
            forwardCallsRecorded: 20,
            cacheHitsRecorded: 0,
            modelForwardsRecorded: 20,
            nestedForwardsOnHits: 0
          }
        },
        1600
      )
    );

    events.push({
      ...makeEvent("sampling", "span_end", { completedSteps: 20 }, 1620),
      spanId: samplerSpanId
    });

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: controlRequest,
      expectedRunId: "run-1"
    });

    expect(obs).toBeDefined();
    expect(obs?.status).toBe("verified");
    expect(obs?.mode).toBe("off");
    expect(obs?.forwardCallsRecorded).toBe(20);
    expect(obs?.cacheHitsRecorded).toBe(0);
    expect(obs?.coverage.modelForwardsRecorded).toBe(20);
    expect(obs?.coverage.samplingCallsRecorded).toBe(1);
    expect(obs?.coverage.complete).toBe(true);
    expect(obs?.failureReason).toBeNull();
  });

  it("rejects orphan diffusion_forward completions with no matching span_start (issue #467 adversarial probe)", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "point_event", {
        teacacheSession: "start",
        teacacheEvent: "session_init",
        effectiveConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      })
    ];

    for (let s = 0; s < 20; s++) {
      events.push(
        makeEvent("sampling", "point_event", { teacacheEvent: "cache_miss", stepIndex: s })
      );
      // 14 orphan span_end completions with no matching span_start, and
      // several repeats of the same spanId -- no real forward behind any
      // of them.
      events.push({
        ...makeEvent(
          "sampling",
          "span_end",
          { modelForwardCall: true, phase: "diffusion_forward" },
          1100 + s * 10
        ),
        spanId: "orphan-shared-id"
      });
    }
    events.push(makeEvent("sampling", "point_event", { teacacheSession: "end" }));
    events.push(makeEvent("sampling", "span_end"));

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.coverage.complete).toBe(false);
    expect(obs?.failureReason).toMatch(/orphan|duplicate|matching open span/i);
  });

  it("rejects a step range that is 20 distinct but out-of-range values (issue #467 adversarial probe)", () => {
    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      makeEvent("sampling", "point_event", {
        teacacheSession: "start",
        teacacheEvent: "session_init",
        effectiveConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      })
    ];

    // 20 distinct but out-of-range step indices: a bare size===20 check
    // would wrongly accept this.
    for (let s = 100; s < 120; s++) {
      events.push(
        makeEvent("sampling", "point_event", { teacacheEvent: "cache_miss", stepIndex: s })
      );
      events.push({
        ...makeEvent(
          "sampling",
          "span_end",
          { modelForwardCall: true, phase: "diffusion_forward" },
          1000 + s
        ),
        spanId: `span-df-${s}`
      });
      events.push({
        ...makeEvent(
          "sampling",
          "span_start",
          { modelForwardCall: true, phase: "diffusion_forward" },
          990 + s
        ),
        spanId: `span-df-${s}`
      });
    }
    events.push(makeEvent("sampling", "point_event", { teacacheSession: "end" }));
    events.push(makeEvent("sampling", "span_end"));

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.coverage.complete).toBe(false);
    expect(obs?.failureReason).toMatch(/range/i);
  });

  it("rejects an unclosed diffusion_forward span started during an alleged cache hit (issue #467 adversarial probe)", () => {
    // 19 real misses (19 closed forward spans) + 1 alleged hit at step 19
    // that nonetheless starts a forward span and never closes it -- a
    // forward beginning at all during a hit already contradicts "the
    // forward was skipped", and an orphaned start must not silently vanish
    // from the evidence just because nothing ever closed it.
    const events = generateEvents({ skips: [19] });
    events.push({
      ...makeEvent(
        "sampling",
        "span_start",
        { phase: "diffusion_forward", modelForwardCall: true, stepIndex: 19 },
        1650
      ),
      spanId: "span-df-unclosed-hit"
    });

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1",
      expectedAttemptToken: "token-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.coverage.complete).toBe(false);
    expect(obs?.failureReason).toMatch(/never closed/i);
  });

  it("rejects a run whose sampling span terminated with outcome 'failed'", () => {
    const events = generateEvents({ skips: [4, 5, 6] });
    // Flip the outer sampling span_end to a failure outcome.
    const samplingEndIdx = events.findIndex(
      (e) => e.phase === "sampling" && e.type === "span_end" && e.metadata === undefined
    );
    events[samplingEndIdx] = {
      ...events[samplingEndIdx],
      outcome: "failed"
    } as MinimaxH3InstrumentationEvent;

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.failureReason).toMatch(/failed/i);
  });

  it("does not synthesize a control-run effectiveConfig when none was actually observed", () => {
    const events = generateEvents({ skips: [] }).filter(
      (e) =>
        !(e.metadata && (e.metadata as Record<string, unknown>).teacacheEvent === "session_init")
    );

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: { ...sampleRequest, mode: "off", patchNode: null },
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.effectiveConfig).toBeNull();
    expect(obs?.failureReason).toMatch(/effectiveConfig/i);
  });

  it("rejects a TeaCache decision event parented under a foreign/different sampler span (issue #467 adversarial probe)", () => {
    const events = generateEvents({ skips: [4, 5, 6] });
    // Inject an extra decision event claiming to belong to a completely
    // different sampler invocation that isn't part of this reduction
    // window at all.
    events.push({
      ...makeEvent("sampling", "point_event", { teacacheEvent: "cache_miss", stepIndex: 50 }),
      parentSpanId: "span-foreign-sampler"
    });

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: sampleRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.failureReason).toMatch(/different sampler/i);
    // The foreign event (stepIndex 50, outside the legitimate 20-step
    // range) must not have been folded into this run's counts.
    expect(obs?.forwardCallsRecorded).toBe(17);
    expect(obs?.cacheHitsRecorded).toBe(3);
  });

  it("rejects a disabled-caching ('off') control run whose own observed effectiveConfig reports caching as actually active (issue #467 adversarial probe)", () => {
    const controlRequest: MinimaxH3TeaCacheRequest = {
      ...sampleRequest,
      mode: "off",
      patchNode: null
    };

    const events: MinimaxH3InstrumentationEvent[] = [
      makeEvent("sampling", "span_start"),
      // The control run's own session_init contradicts the control
      // declaration by reporting caching as actually enabled.
      makeEvent("sampling", "point_event", {
        teacacheEvent: "session_init",
        effectiveConfig: {
          mode: "raw-l1-v1",
          relL1Thresh: 0.15,
          startStep: 2,
          endStep: -2,
          totalSteps: 20,
          normalizedStartStep: 2,
          normalizedEndStep: 18
        }
      })
    ];
    for (let s = 0; s < 20; s++) {
      events.push(
        makeEvent("sampling", "point_event", { teacacheEvent: "cache_miss", stepIndex: s })
      );
      const fwdSpanId = `span-df-${s}`;
      events.push({
        ...makeEvent(
          "sampling",
          "span_start",
          { phase: "diffusion_forward", modelForwardCall: true },
          1000 + s
        ),
        spanId: fwdSpanId
      });
      events.push({
        ...makeEvent(
          "sampling",
          "span_end",
          { phase: "diffusion_forward", modelForwardCall: true },
          1005 + s
        ),
        spanId: fwdSpanId
      });
    }
    events.push(makeEvent("sampling", "point_event", { teacacheSession: "end" }));
    events.push(makeEvent("sampling", "span_end"));

    const obs = reduceTeaCacheObservation({
      events,
      teacacheRequest: controlRequest,
      expectedRunId: "run-1"
    });

    expect(obs?.status).toBe("failed");
    expect(obs?.failureReason).toMatch(/reports mode "raw-l1-v1", expected "off"/i);
  });
});
