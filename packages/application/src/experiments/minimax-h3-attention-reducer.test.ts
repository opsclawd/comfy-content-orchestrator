import { describe, expect, it } from "vitest";
import { reduceAttentionObservation } from "./minimax-h3-attention-reducer.js";
import { type MinimaxH3AttentionRequest, type MinimaxH3InstrumentationEvent } from "@cco/contracts";

describe("MiniMax-H3 Attention Reducer", () => {
  const baseRequest: MinimaxH3AttentionRequest = {
    attentionVariant: "sage",
    expectedBackend: "sage",
    expectedKernel: "sageattention.sageattn",
    topologyDigest: "1111111111111111111111111111111111111111111111111111111111111111",
    catalogDigest: "3333333333333333333333333333333333333333333333333333333333333333",
    patches: [],
    runtimeLockDigest: "2222222222222222222222222222222222222222222222222222222222222222",
    denseRegionPolicy: {
      allowPlannedDense: true,
      description: "Allow dense fallback only if planned"
    }
  };

  it("returns undefined if attentionRequest is not provided", () => {
    const obs = reduceAttentionObservation({
      events: [],
      attentionRequest: undefined
    });
    expect(obs).toBeUndefined();
  });

  it("reduces clean verified accelerated observation from summary event", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sage-1",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 4,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: Array.from({ length: 4 }, (_, i) => ({
          stepIndex: i,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-sage-1",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1, 2, 3].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-sage-1",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 4,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.actualBackend).toBe("sage");
    expect(obs!.dispatchImplementation).toBe("sageattention.sageattn");
    expect(obs!.acceleratedCallCount).toBe(4);
    expect(obs!.denseCallCount).toBe(0);
    expect(obs!.fallbackEvents).toHaveLength(0);
    expect(obs!.failureReason).toBeNull();
    expect(obs!.measurementCoverage.complete).toBe(true);
  });

  it("fails closed on undetected no-op when zero accelerated calls occur", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sage-2",
      attemptToken: "token-2",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 0,
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "torch_sdpa"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain("Zero accelerated attention calls were observed");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("detects fallback events and sets status to fallback", () => {
    const fallbackPointEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-sage-3",
      attemptToken: "token-3",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1500.0,
      metadata: {
        attentionEvent: "fallback",
        requestedBackend: "sage",
        fallbackBackend: "torch_sdpa",
        reason: "Triton kernel unsupported on target dtype"
      }
    };

    const obs = reduceAttentionObservation({
      events: [fallbackPointEvent],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("fallback");
    expect(obs!.fallbackEvents).toHaveLength(1);
    expect(obs!.fallbackEvents[0]!.reason).toContain("Triton kernel unsupported");
  });

  it("fails closed when missing kernel failure is reported", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sage-4",
      attemptToken: "token-4",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          missingKernelFailure: "sageattention",
          acceleratedCallCount: 0,
          denseCallCount: 0
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.missingKernelFailure).toBe("sageattention");
    expect(obs!.failureReason).toContain("Missing required attention kernel");
  });

  it("reduces dense control run cleanly without requiring accelerated calls", () => {
    const denseRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      attentionVariant: "dense",
      expectedBackend: "torch_sdpa",
      expectedKernel: "torch.nn.functional.scaled_dot_product_attention"
    };

    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-dense-1",
      attemptToken: "token-dense",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 0,
          denseCallCount: 4,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention"
        },
        stepRecords: Array.from({ length: 4 }, (_, i) => ({
          stepIndex: i,
          backend: "torch_sdpa",
          implementation: "torch.nn.functional.scaled_dot_product_attention",
          callType: "dense" as const
        }))
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-dense-1",
      attemptToken: "token-dense",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1, 2, 3].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-dense-1",
      attemptToken: "token-dense",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: denseRequest,
      expectedSteps: 4,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.actualBackend).toBe("torch_sdpa");
    expect(obs!.denseCallCount).toBe(4);
    expect(obs!.measurementCoverage.complete).toBe(true);
  });

  it("returns unknown for dense request when event log has zero calls (empty log)", () => {
    const denseRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      attentionVariant: "dense",
      expectedBackend: "torch_sdpa",
      expectedKernel: "torch.nn.functional.scaled_dot_product_attention"
    };

    const obs = reduceAttentionObservation({
      events: [],
      attentionRequest: denseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("unknown");
    expect(obs!.actualBackend).toBeNull();
    expect(obs!.dispatchImplementation).toBeNull();
    expect(obs!.failureReason).toContain("No attention execution events were recorded");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("returns unknown for accelerated request when event log has zero calls (empty log)", () => {
    const obs = reduceAttentionObservation({
      events: [],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("unknown");
    expect(obs!.actualBackend).toBeNull();
    expect(obs!.dispatchImplementation).toBeNull();
    expect(obs!.failureReason).toContain(
      "No attention execution events or sampling phases were recorded"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("fails when observed backend does not match requested backend (preserves observed identities)", () => {
    // Probe scenario: observed veda/wrong_kernel with sage request
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sage-probe",
      attemptToken: "token-probe",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 1,
          denseCallCount: 99,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "veda",
          dispatchImplementation: "wrong_kernel",
          status: "unknown"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.actualBackend).toBe("veda");
    expect(obs!.dispatchImplementation).toBe("wrong_kernel");
    expect(obs!.failureReason).toContain(
      'Observed attention backend "veda" does not match requested "sage"'
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("fails when unplanned dense calls occur under allowPlannedDense=false policy", () => {
    const strictRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      denseRegionPolicy: {
        allowPlannedDense: false,
        description: "Zero dense calls allowed"
      }
    };

    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sage-strict",
      attemptToken: "token-strict",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 5,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: strictRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain(
      "Unexpected dense attention calls (5) observed under zero-dense policy"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("filters out stale attempt tokens and wrong runId / promptId", () => {
    const staleEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-current",
      attemptToken: "token-old-attempt",
      promptId: "prompt-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 500.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 50,
          denseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn"
        }
      }
    };

    const wrongPromptEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-current",
      attemptToken: "token-current-attempt",
      promptId: "prompt-different",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 600.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 60,
          denseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn"
        }
      }
    };

    const currentEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 3,
      runId: "run-current",
      attemptToken: "token-current-attempt",
      promptId: "prompt-1",
      spanId: "span-3",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [staleEvent, wrongPromptEvent, currentEvent],
      attentionRequest: baseRequest,
      expectedRunId: "run-current",
      expectedAttemptToken: "token-current-attempt",
      expectedPromptId: "prompt-1"
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.acceleratedCallCount).toBe(40);
  });

  it("fails closed when multiple conflicting accelerated backends are observed in events", () => {
    const eventSage: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-conflict",
      attemptToken: "token-conflict",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionCall: "accelerated",
        backend: "sage",
        implementation: "sageattention.sageattn"
      }
    };

    const eventVeda: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-conflict",
      attemptToken: "token-conflict",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1050.0,
      metadata: {
        attentionCall: "accelerated",
        backend: "veda",
        implementation: "veda_sparse_attention.triton_kernel"
      }
    };

    const obs = reduceAttentionObservation({
      events: [eventSage, eventVeda],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain(
      "Multiple conflicting accelerated attention backends observed in event stream"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("fails closed when unexpected accelerated call occurs during dense control", () => {
    const denseRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      attentionVariant: "dense",
      expectedBackend: "torch_sdpa",
      expectedKernel: "torch.nn.functional.scaled_dot_product_attention"
    };

    const eventAcc: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-dense-corrupt",
      attemptToken: "token-dc",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionCall: "accelerated",
        backend: "sage",
        implementation: "sageattention.sageattn"
      }
    };

    const obs = reduceAttentionObservation({
      events: [eventAcc],
      attentionRequest: denseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain(
      "Unexpected accelerated attention calls (1) observed for dense control"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("records unknown fallbackBackend when not provided by collector (does not synthesize torch_sdpa)", () => {
    const fallbackEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-fb-unknown",
      attemptToken: "token-fb",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionEvent: "fallback",
        requestedBackend: "sage",
        reason: "Unknown failure"
      }
    };

    const obs = reduceAttentionObservation({
      events: [fallbackEvent],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("fallback");
    expect(obs!.fallbackEvents).toHaveLength(1);
    expect(obs!.fallbackEvents[0]!.fallbackBackend).toBe("unknown");
  });

  it("fails when unplanned dense calls occur even when allowPlannedDense=true", () => {
    const plannedRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      denseRegionPolicy: {
        allowPlannedDense: true,
        description: "Allow dense fallback only if planned"
      }
    };

    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-unplanned-dense",
      attemptToken: "token-unplanned",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 30,
          denseCallCount: 2, // unplanned dense!
          plannedDenseCallCount: 5,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: plannedRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain(
      "Unexpected unplanned dense attention calls (2) observed for accelerated variant"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("succeeds when only planned dense calls occur under allowPlannedDense=true", () => {
    const plannedRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      denseRegionPolicy: {
        allowPlannedDense: true,
        description: "Allow dense fallback only if planned"
      }
    };

    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-planned-dense-ok",
      attemptToken: "token-planned-ok",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 4,
          denseCallCount: 0,
          plannedDenseCallCount: 1,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn"
        },
        stepRecords: [
          ...Array.from({ length: 4 }, (_, i) => ({
            stepIndex: i,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          })),
          {
            stepIndex: 3,
            backend: "torch_sdpa",
            implementation: "torch.nn.functional.scaled_dot_product_attention",
            callType: "planned_dense" as const
          }
        ]
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-planned-dense-ok",
      attemptToken: "token-planned-ok",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1, 2, 3].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-planned-dense-ok",
      attemptToken: "token-planned-ok",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: plannedRequest,
      expectedSteps: 4,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.acceleratedCallCount).toBe(4);
    expect(obs!.denseCallCount).toBe(0);
    expect(obs!.plannedDenseCallCount).toBe(1);
    expect(obs!.failureReason).toBeNull();
    expect(obs!.measurementCoverage.complete).toBe(true);
  });

  it("fails when planned dense calls occur under allowPlannedDense=false", () => {
    const strictRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      denseRegionPolicy: {
        allowPlannedDense: false,
        description: "Zero dense calls permitted"
      }
    };

    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-planned-under-strict",
      attemptToken: "token-strict-planned",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 35,
          denseCallCount: 0,
          plannedDenseCallCount: 5,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: strictRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain(
      "Planned dense attention calls (5) observed under zero-dense policy"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when summary event lacks per-step records", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-no-step-records",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when stepRecords only partially cover expected steps", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-partial-steps",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 30,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        // Covers only steps 0, 1, 2 out of 4 expected
        stepRecords: [0, 1, 2].map((s) => ({
          stepIndex: s,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest,
      expectedSteps: 4
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when all step records default to step 0 despite multiple sampling steps", () => {
    const samplingSpans: MinimaxH3InstrumentationEvent[] = [0, 1, 2, 3].map((s) => ({
      protocolVersion: "v2-jsonl",
      sequence: s + 1,
      runId: "run-step0-bug",
      attemptToken: "token-1",
      spanId: `step-${s}`,
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0 + s * 100
    }));

    const summaryEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 10,
      runId: "run-step0-bug",
      attemptToken: "token-1",
      spanId: "span-summary",
      phase: "teardown",
      type: "point_event",
      boundarySource: "diagnostic",
      clockDomain: "mono_child",
      monotonicMs: 2000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        // All calls erroneously stamped at step 0
        stepRecords: Array.from({ length: 40 }, () => ({
          stepIndex: 0,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const obs = reduceAttentionObservation({
      events: [...samplingSpans, summaryEvent],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("rejects execution events with promptId: null when expectedPromptId is known", () => {
    const executionEventWithNullPrompt: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-prompt-check",
      attemptToken: "token-1",
      promptId: null, // Should be rejected for known prompt!
      spanId: "span-exec",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1200.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [executionEventWithNullPrompt],
      attentionRequest: baseRequest,
      expectedPromptId: "known-prompt-id"
    });

    // All execution events were filtered out due to null promptId
    expect(obs).toBeDefined();
    expect(obs!.status).toBe("unknown");
    expect(obs!.acceleratedCallCount).toBe(0);
  });

  it("fails verification when expectedCollectorDigest mismatches", () => {
    const startupHandshake: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-digest-check",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "environment_startup",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 100.0,
      metadata: {
        handshake: "v2-jsonl",
        collectorDigest: "actual-collector-digest-1111111111111111111111111111111111111111"
      }
    };

    const summaryEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-digest-check",
      attemptToken: "token-1",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [startupHandshake, summaryEvent],
      attentionRequest: baseRequest,
      expectedCollectorDigest: "expected-different-digest-22222222222222222222222222222222"
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain("does not match expected");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("fails closed when multiple conflicting collector digests are present in event stream", () => {
    const event1: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-multi-digest",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "environment_startup",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 100.0,
      metadata: {
        handshake: "v2-jsonl",
        collectorDigest: "digest-aaa"
      }
    };

    const event2: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-multi-digest",
      attemptToken: "token-1",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        collectorDigest: "digest-bbb",
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event1, event2],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain(
      "Multiple conflicting collector digests observed in event stream"
    );
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("preserves failed status across stream even if a subsequent event reports verified", () => {
    const eventFailed: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sticky-fail",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 0,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          status: "failed",
          failureReason: "Kernel missing in step 1"
        }
      }
    };

    const eventVerifiedLater: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-sticky-fail",
      attemptToken: "token-1",
      spanId: "span-2",
      phase: "teardown",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 2000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 40,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [eventFailed, eventVerifiedLater],
      attentionRequest: baseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.failureReason).toContain("Kernel missing in step 1");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("prefers authoritative cumulative stepRecords over point events", () => {
    const pointEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-authoritative",
      attemptToken: "token-1",
      spanId: "span-point",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 500.0,
      metadata: {
        attentionCall: "accelerated",
        backend: "sage",
        implementation: "sageattention.sageattn",
        stepIndex: 99
      }
    };

    const summaryEventWithAuthoritativeRecords: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-authoritative",
      attemptToken: "token-1",
      spanId: "span-summary",
      phase: "teardown",
      type: "point_event",
      boundarySource: "diagnostic",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 2,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [
          {
            stepIndex: 0,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          },
          {
            stepIndex: 1,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          }
        ]
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 3,
      runId: "run-authoritative",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 4 + idx,
      runId: "run-authoritative",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [pointEvent, summaryEventWithAuthoritativeRecords, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 2,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.stepRecords).toHaveLength(2);
    expect(obs!.stepRecords!.map((r) => r.stepIndex)).toEqual([0, 1]);
    expect(obs!.measurementCoverage.complete).toBe(true);
  });

  it("marks coverage incomplete when expectedSteps is not a positive integer", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-zero-steps",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 4,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [0, 1].map((s) => ({
          stepIndex: s,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const obsZero = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest,
      expectedSteps: 0
    });
    expect(obsZero!.measurementCoverage.complete).toBe(false);

    const obsNegative = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest,
      expectedSteps: -2
    });
    expect(obsNegative!.measurementCoverage.complete).toBe(false);

    const obsFloat = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest,
      expectedSteps: 2.5
    });
    expect(obsFloat!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when step records contain unflushed flag or out-of-range steps", () => {
    const eventWithUnflushed: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-unflushed",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 2,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [
          {
            stepIndex: 0,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          },
          {
            stepIndex: 1,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const,
            metadata: { unflushed: true }
          }
        ]
      }
    };

    const obs = reduceAttentionObservation({
      events: [eventWithUnflushed],
      attentionRequest: baseRequest,
      expectedSteps: 2
    });
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("does not report conflicting implementations when policy-approved planned-dense calls coexist with accelerated calls [F-64dcdaf2]", () => {
    const plannedRequest: MinimaxH3AttentionRequest = {
      ...baseRequest,
      denseRegionPolicy: {
        allowPlannedDense: true,
        description: "Allow dense fallback only if planned"
      }
    };

    const accelPointEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-mixed",
      attemptToken: "token-mixed",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionCall: "accelerated",
        backend: "sage",
        implementation: "sageattention.sageattn"
      }
    };

    const plannedDensePointEvent: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-mixed",
      attemptToken: "token-mixed",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1010.0,
      metadata: {
        attentionCall: "planned_dense",
        backend: "torch_sdpa",
        implementation: "torch.nn.functional.scaled_dot_product_attention"
      }
    };

    const obs = reduceAttentionObservation({
      events: [accelPointEvent, plannedDensePointEvent],
      attentionRequest: plannedRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.actualBackend).toBe("sage");
    expect(obs!.dispatchImplementation).toBe("sageattention.sageattn");
    expect(obs!.acceleratedCallCount).toBe(1);
    expect(obs!.plannedDenseCallCount).toBe(1);
    expect(obs!.denseCallCount).toBe(0);
    expect(obs!.failureReason).toBeNull();
  });

  it("rejects coverage completeness when stream has zero sampling events and mismatched call count [F-cf34dca5]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-cf34dca5",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "teardown",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 999,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "foreign_backend",
          dispatchImplementation: "foreign.kernel",
          status: "verified"
        },
        stepRecords: Array.from({ length: 20 }, (_, i) => ({
          stepIndex: i,
          backend: "foreign_backend",
          implementation: "foreign.kernel",
          callType: "accelerated" as const
        }))
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest,
      expectedSteps: 20
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("failed");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when sampling span ends with failure outcome [F-798478f7]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-sampling-fail",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 2,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [0, 1].map((step) => ({
          stepIndex: step,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const failedSamplingSpan: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-sampling-fail",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "failed",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-sampling-fail",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, failedSamplingSpan, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 2
    });

    expect(obs).toBeDefined();
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when a sampling_step span ends with failure outcome [F-798478f7]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-step-fail",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 2,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [0, 1].map((step) => ({
          stepIndex: step,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-step-fail",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [
      {
        protocolVersion: "v2-jsonl",
        sequence: 3,
        runId: "run-step-fail",
        attemptToken: "token-1",
        spanId: "span-step-0",
        phase: "sampling_step",
        type: "span_end",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        outcome: "success",
        stepIndex: 0,
        monotonicMs: 1010.0
      },
      {
        protocolVersion: "v2-jsonl",
        sequence: 4,
        runId: "run-step-fail",
        attemptToken: "token-1",
        spanId: "span-step-1",
        phase: "sampling_step",
        type: "span_end",
        boundarySource: "child_bootstrap",
        clockDomain: "mono_child",
        outcome: "failed",
        stepIndex: 1,
        monotonicMs: 1020.0
      }
    ];

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 2
    });

    expect(obs).toBeDefined();
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("marks coverage incomplete when summary total calls mismatch step records count [F-798478f7]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-mismatch",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 4, // Summary claims 4 calls
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [0, 1].map((step) => ({
          // But only 2 step records
          stepIndex: step,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-mismatch",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-mismatch",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 2
    });

    expect(obs).toBeDefined();
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("preserves multi-layer calls within the same step and counts them without deduplicating [F-798478f7]", () => {
    // 2 steps, 3 layers per step = 6 total accelerated calls
    const records = [
      {
        stepIndex: 0,
        layerIndex: 0,
        backend: "sage",
        implementation: "sageattention.sageattn",
        callType: "accelerated" as const
      },
      {
        stepIndex: 0,
        layerIndex: 1,
        backend: "sage",
        implementation: "sageattention.sageattn",
        callType: "accelerated" as const
      },
      {
        stepIndex: 0,
        layerIndex: 2,
        backend: "sage",
        implementation: "sageattention.sageattn",
        callType: "accelerated" as const
      },
      {
        stepIndex: 1,
        layerIndex: 0,
        backend: "sage",
        implementation: "sageattention.sageattn",
        callType: "accelerated" as const
      },
      {
        stepIndex: 1,
        layerIndex: 1,
        backend: "sage",
        implementation: "sageattention.sageattn",
        callType: "accelerated" as const
      },
      {
        stepIndex: 1,
        layerIndex: 2,
        backend: "sage",
        implementation: "sageattention.sageattn",
        callType: "accelerated" as const
      }
    ];

    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-layers",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 6,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: records
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-layers",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-layers",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 2,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.acceleratedCallCount).toBe(6);
    expect(obs!.stepRecords).toHaveLength(6);
    expect(obs!.measurementCoverage.complete).toBe(true);
  });

  it("marks coverage incomplete when extra sampling step span_ends occur beyond expectedSteps [F-798478f7]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-extra-step",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 2,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [0, 1].map((step) => ({
          stepIndex: step,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };

    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-extra-step",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };

    // Expected 2 steps (0, 1), but span ends exist for 0, 1, 2
    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1, 2].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-extra-step",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const obs = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 2
    });

    expect(obs).toBeDefined();
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("does not ingest attentionSummary or stepRecords from startup handshake event [F-aa019999]", () => {
    const startupHandshake: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-handshake",
      attemptToken: "token-1",
      spanId: "span-handshake",
      phase: "environment_startup",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 100.0,
      promptId: null,
      metadata: {
        handshake: "v2-jsonl",
        collectorDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        hookManifestDigest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        attentionSummary: {
          acceleratedCallCount: 99,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [
          {
            stepIndex: 0,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          }
        ]
      }
    };

    const obs = reduceAttentionObservation({
      events: [startupHandshake],
      attentionRequest: baseRequest,
      expectedPromptId: "known-prompt-1",
      expectedSteps: 1
    });

    expect(obs).toBeDefined();
    // Handshake digests were recorded, but attentionSummary/stepRecords were NOT ingested
    expect(obs!.acceleratedCallCount).toBe(0);
    expect(obs!.stepRecords).toBeUndefined();
    expect(obs!.status).toBe("unknown");
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("does not report completeness when identityValidated is not explicitly true, even with otherwise-complete coverage [AC-5, F-799002ee, F-aa019999]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-identity-1",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 4,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: Array.from({ length: 4 }, (_, i) => ({
          stepIndex: i,
          backend: "sage",
          implementation: "sageattention.sageattn",
          callType: "accelerated" as const
        }))
      }
    };
    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-identity-1",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };
    const stepEnds: MinimaxH3InstrumentationEvent[] = [0, 1, 2, 3].map((step, idx) => ({
      protocolVersion: "v2-jsonl",
      sequence: 3 + idx,
      runId: "run-identity-1",
      attemptToken: "token-1",
      spanId: `span-step-${step}`,
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: step,
      monotonicMs: 1000.0 + idx * 10
    }));

    const withoutIdentity = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 4
      // identityValidated intentionally omitted
    });
    expect(withoutIdentity).toBeDefined();
    expect(withoutIdentity!.status).toBe("verified");
    expect(withoutIdentity!.measurementCoverage.complete).toBe(false);

    const withFalseIdentity = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 4,
      identityValidated: false
    });
    expect(withFalseIdentity!.measurementCoverage.complete).toBe(false);

    const withValidatedIdentity = reduceAttentionObservation({
      events: [event, samplingEnd, ...stepEnds],
      attentionRequest: baseRequest,
      expectedSteps: 4,
      identityValidated: true
    });
    expect(withValidatedIdentity!.measurementCoverage.complete).toBe(true);
  });

  it("does not mark completeness true for a missing sampling span_end outcome (absent outcome is not success) [AC-3, F-798478f7]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-absent-outcome",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        attentionSummary: {
          acceleratedCallCount: 1,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: "sage",
          dispatchImplementation: "sageattention.sageattn",
          status: "verified"
        },
        stepRecords: [
          {
            stepIndex: 0,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          }
        ]
      }
    };
    // span_end with no `outcome` field at all -- must not be treated as implicit success.
    const samplingEndNoOutcome: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-absent-outcome",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1050.0
    };
    const stepEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 3,
      runId: "run-absent-outcome",
      attemptToken: "token-1",
      spanId: "span-step-0",
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: 0,
      monotonicMs: 1060.0
    };

    const obs = reduceAttentionObservation({
      events: [event, samplingEndNoOutcome, stepEnd],
      attentionRequest: baseRequest,
      expectedSteps: 1,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("does not let an explicit zero-count attentionSummary be overridden by a cumulative stepRecords backfill [AC-3, F-cf34dca5]", () => {
    const event: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-zero-summary",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        // Collector explicitly reports zero calls of every kind...
        attentionSummary: {
          acceleratedCallCount: 0,
          denseCallCount: 0,
          plannedDenseCallCount: 0,
          actualBackend: null,
          dispatchImplementation: null,
          status: "unknown"
        },
        // ...but a stale/unrelated cumulative snapshot with one dense record is also present.
        stepRecords: [
          {
            stepIndex: 0,
            backend: "torch_sdpa",
            implementation: "torch.sdpa",
            callType: "dense" as const
          }
        ]
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: baseRequest,
      expectedSteps: 1,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    // The explicit zero summary must stick -- not be backfilled into a non-zero dense call.
    expect(obs!.acceleratedCallCount).toBe(0);
    expect(obs!.denseCallCount).toBe(0);
    expect(obs!.plannedDenseCallCount).toBe(0);
    expect(obs!.measurementCoverage.complete).toBe(false);
  });

  it("flags conflicting cumulative stepRecords snapshots for the same step/layer as incomplete, not silently overwritten [AC-3, F-cf34dca5, F-798478f7]", () => {
    const firstSnapshot: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 1,
      runId: "run-conflict-snapshot",
      attemptToken: "token-1",
      spanId: "span-1",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1000.0,
      metadata: {
        stepRecords: [
          {
            stepIndex: 0,
            backend: "sage",
            implementation: "sageattention.sageattn",
            callType: "accelerated" as const
          }
        ]
      }
    };
    // A second cumulative snapshot reports step 0 with a DIFFERENT callType/backend --
    // a genuine conflict, not a progressive update, and must not be silently replaced.
    const conflictingSnapshot: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 2,
      runId: "run-conflict-snapshot",
      attemptToken: "token-1",
      spanId: "span-2",
      phase: "sampling",
      type: "point_event",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      monotonicMs: 1010.0,
      metadata: {
        stepRecords: [
          {
            stepIndex: 0,
            backend: "torch_sdpa",
            implementation: "torch.sdpa",
            callType: "dense" as const
          }
        ]
      }
    };
    const samplingEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 3,
      runId: "run-conflict-snapshot",
      attemptToken: "token-1",
      spanId: "span-sampling",
      phase: "sampling",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      monotonicMs: 1050.0
    };
    const stepEnd: MinimaxH3InstrumentationEvent = {
      protocolVersion: "v2-jsonl",
      sequence: 4,
      runId: "run-conflict-snapshot",
      attemptToken: "token-1",
      spanId: "span-step-0",
      phase: "sampling_step",
      type: "span_end",
      boundarySource: "child_bootstrap",
      clockDomain: "mono_child",
      outcome: "success",
      stepIndex: 0,
      monotonicMs: 1060.0
    };

    const obs = reduceAttentionObservation({
      events: [firstSnapshot, conflictingSnapshot, samplingEnd, stepEnd],
      attentionRequest: baseRequest,
      expectedSteps: 1,
      identityValidated: true
    });

    expect(obs).toBeDefined();
    expect(obs!.measurementCoverage.complete).toBe(false);
  });
});
