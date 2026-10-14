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
    expect(obs!.actualBackend).toBe("sage");
    expect(obs!.dispatchImplementation).toBe("sageattention.sageattn");
    expect(obs!.acceleratedCallCount).toBe(40);
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
          denseCallCount: 40,
          plannedDenseCallCount: 0,
          fallbackEvents: [],
          actualBackend: "torch_sdpa",
          dispatchImplementation: "torch.nn.functional.scaled_dot_product_attention"
        }
      }
    };

    const obs = reduceAttentionObservation({
      events: [event],
      attentionRequest: denseRequest
    });

    expect(obs).toBeDefined();
    expect(obs!.status).toBe("verified");
    expect(obs!.actualBackend).toBe("torch_sdpa");
    expect(obs!.denseCallCount).toBe(40);
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
});
