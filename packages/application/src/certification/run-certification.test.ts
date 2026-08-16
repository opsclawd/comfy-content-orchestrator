import type {
  CertificationEnvironment,
  CertificationTelemetryData,
  CertificationTelemetrySample,
  CertificationWorkloadIdentity
} from "@cco/contracts";
import { describe, expect, it, vi } from "vitest";
import type {
  QueueRenderInput,
  RenderEnginePort,
  RenderQueueReceipt,
  RenderResult
} from "../ports/render-engine-port.js";
import {
  type CertificationPhase,
  type RunCertificationOptions,
  type TelemetrySamplerControl,
  runCertification
} from "./run-certification.js";

function createValidIdentity(): CertificationWorkloadIdentity {
  return {
    profileId: "ltx-25-720p-97f",
    renderProfileKey: "LTX_25_720P_5S_V1",
    renderProfileVersion: 1,
    engine: "ltx_25",
    width: 1280,
    height: 720,
    frames: 97,
    steps: 8,
    workflowSha256: "a".repeat(64),
    modelSha256: {
      checkpoint: "b".repeat(64),
      textEncoder: "c".repeat(64),
      vae: "d".repeat(64)
    },
    comfyUiCommit: "e".repeat(40),
    customNodes: [
      {
        name: "ComfyUI-LTXVideo",
        commit: "f".repeat(40),
        status: "tracked"
      }
    ]
  };
}

function createValidEnvironment(): CertificationEnvironment {
  return {
    nodeVersion: "v24.0.0",
    platform: "linux",
    arch: "x64",
    osRelease: "6.8.0-generic",
    osVersion: "#1 SMP PREEMPT_DYNAMIC",
    cpuModel: "AMD Ryzen 9 7950X",
    cpuCount: 32,
    gpuName: "NVIDIA GeForce RTX 4090",
    gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
    gpuDriverVersion: "550.54.14",
    gpuTotalMemoryMb: 24564,
    cudaVersion: "12.4",
    comfyUiPid: 12345,
    comfyUiArgs: ["--port", "8188"]
  };
}

function createSample(
  phase: "pre_dispatch" | "sampling" | "post_unload" = "sampling",
  measuredAt = "2026-08-15T20:00:00.000Z"
): CertificationTelemetrySample {
  return {
    measuredAt,
    phase,
    gpu: {
      totalVramMb: 24564,
      usedVramMb: phase === "post_unload" ? 1024 : 18000,
      freeVramMb: phase === "post_unload" ? 23540 : 6564
    },
    host: {
      hostRamTotalMb: 64000,
      hostRamAvailableMb: 50000,
      hostRamUsedMb: 14000,
      swapTotalMb: 16000,
      swapUsedMb: 100,
      systemSwapInPages: 10,
      systemSwapOutPages: 5,
      systemMajorPageFaults: 100,
      systemMinorPageFaults: 5000,
      processPid: 12345,
      processStartTimeTicks: 100000,
      processRssMb: 1200,
      processMajorPageFaults: 10,
      processMinorPageFaults: 500
    }
  };
}

function createValidTelemetryData(): CertificationTelemetryData {
  const samples = [
    createSample("pre_dispatch", "2026-08-15T20:00:00.000Z"),
    createSample("sampling", "2026-08-15T20:00:01.000Z"),
    createSample("post_unload", "2026-08-15T20:00:10.000Z")
  ];

  return {
    sampleIntervalMs: 200,
    samples,
    samplingErrors: [],
    peakVramMb: 18000,
    peakHostRamUsedMb: 14000,
    peakProcessRssMb: 1200,
    swapUsedDeltaMb: 0,
    systemSwapInPageDelta: 0,
    systemSwapOutPageDelta: 0,
    systemMajorPageFaultDelta: 0,
    systemMinorPageFaultDelta: 0,
    processMajorPageFaultDelta: 0,
    processMinorPageFaultDelta: 0,
    postUnloadUsedVramMb: 1024,
    postUnloadFreeVramMb: 23540
  };
}

interface FakeSamplerOptions {
  telemetryData?: CertificationTelemetryData | undefined;
  startError?: Error | undefined;
  sampleNowError?: Error | undefined;
  stopError?: Error | undefined;
  onCall?: ((name: string, arg?: unknown) => void) | undefined;
}

class FakeTelemetrySampler implements TelemetrySamplerControl {
  private readonly telemetryData: CertificationTelemetryData;
  private readonly startError: Error | undefined;
  private readonly sampleNowError: Error | undefined;
  private readonly stopError: Error | undefined;
  private readonly onCall: ((name: string, arg?: unknown) => void) | undefined;

  constructor(options: FakeSamplerOptions = {}) {
    this.telemetryData = options.telemetryData ?? createValidTelemetryData();
    this.startError = options.startError;
    this.sampleNowError = options.sampleNowError;
    this.stopError = options.stopError;
    this.onCall = options.onCall;
  }

  async start(): Promise<void> {
    this.onCall?.("sampler.start");
    if (this.startError) throw this.startError;
  }

  async sampleNow(
    phase: "pre_dispatch" | "sampling" | "post_unload" = "sampling"
  ): Promise<CertificationTelemetrySample> {
    this.onCall?.("sampler.sampleNow", phase);
    if (this.sampleNowError) throw this.sampleNowError;
    return createSample(phase);
  }

  async stop(): Promise<CertificationTelemetryData> {
    this.onCall?.("sampler.stop");
    if (this.stopError) throw this.stopError;
    return this.telemetryData;
  }

  getTelemetryData(): CertificationTelemetryData {
    return this.telemetryData;
  }
}

interface FakeRenderEngineOptions {
  queueReceipt?: RenderQueueReceipt | undefined;
  renderResult?: RenderResult | undefined;
  queueError?: Error | undefined;
  getResultError?: Error | undefined;
  unloadError?: Error | undefined;
  onCall?: ((name: string, arg?: unknown) => void) | undefined;
}

class FakeRenderEngine implements RenderEnginePort {
  private readonly queueReceipt: RenderQueueReceipt;
  private readonly renderResult: RenderResult | undefined;
  private readonly queueError: Error | undefined;
  private readonly getResultError: Error | undefined;
  private readonly unloadError: Error | undefined;
  private readonly onCall: ((name: string, arg?: unknown) => void) | undefined;

  constructor(options: FakeRenderEngineOptions = {}) {
    this.queueReceipt = options.queueReceipt ?? {
      executionId: "exec-test-123",
      acceptedAt: "2026-08-15T20:00:00.000Z"
    };
    this.renderResult =
      options.renderResult !== undefined
        ? options.renderResult
        : {
            executionId: "exec-test-123",
            status: "succeeded",
            outputObjectKeys: ["renders/ltx_0001.mp4"],
            completedAt: "2026-08-15T20:00:45.000Z"
          };
    this.queueError = options.queueError;
    this.getResultError = options.getResultError;
    this.unloadError = options.unloadError;
    this.onCall = options.onCall;
  }

  async queueRender(input: QueueRenderInput): Promise<RenderQueueReceipt> {
    this.onCall?.("renderEngine.queueRender", input);
    if (this.queueError) throw this.queueError;
    return this.queueReceipt;
  }

  async getRenderResult(executionId: string): Promise<RenderResult | undefined> {
    this.onCall?.("renderEngine.getRenderResult", executionId);
    if (this.getResultError) throw this.getResultError;
    return this.renderResult;
  }

  async unloadModels(): Promise<void> {
    this.onCall?.("renderEngine.unloadModels");
    if (this.unloadError) throw this.unloadError;
  }
}

function createDefaultOptions(
  overrides: Partial<RunCertificationOptions> = {}
): RunCertificationOptions {
  return {
    runId: "trinidad-rtx4090-dynamicvram-v1",
    runnerMode: "dynamicvram",
    identity: createValidIdentity(),
    environment: createValidEnvironment(),
    renderEngine: new FakeRenderEngine(),
    telemetrySampler: new FakeTelemetrySampler(),
    renderInput: {
      renderJobId: "job-1",
      sceneId: "scene-1",
      renderProfileKey: "LTX_25_720P_5S_V1",
      workflow: { 1: { class_type: "LTXVideo" } }
    },
    maxDurationMs: 55000,
    settleDurationMs: 5000,
    sleep: vi.fn().mockResolvedValue(undefined),
    now: (() => {
      let time = 1755288000000; // 2025-08-15T20:00:00.000Z
      return () => {
        const d = new Date(time);
        time += 1000;
        return d;
      };
    })(),
    ...overrides
  };
}

describe("runCertification", () => {
  // Behavioral Invariant 1: ordered-success-path
  it("runs the successful certification phases in order", async () => {
    const callLog: string[] = [];
    const phaseLog: CertificationPhase[] = [];

    const fakeSampler = new FakeTelemetrySampler({
      onCall: (name, arg) => callLog.push(arg ? `${name}:${String(arg)}` : name)
    });
    const fakeRenderEngine = new FakeRenderEngine({
      onCall: (name, arg) => callLog.push(typeof arg === "string" ? `${name}:${arg}` : name)
    });
    const sleepSpy = vi.fn().mockImplementation(async (ms: number) => {
      callLog.push(`sleep:${ms}`);
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler,
      renderEngine: fakeRenderEngine,
      sleep: sleepSpy,
      onPhaseChange: (phase) => phaseLog.push(phase)
    });

    const artifact = await runCertification(options);

    // Assert phase transitions
    expect(phaseLog).toEqual([
      "ready",
      "sampling",
      "rendering",
      "unloading",
      "settling",
      "final_sampling",
      "stopped",
      "completed"
    ]);

    // Assert call order: sampler starts BEFORE queueRender, unloadModels only AFTER success
    expect(callLog).toEqual([
      "sampler.start",
      "renderEngine.queueRender",
      "renderEngine.getRenderResult:exec-test-123",
      "renderEngine.unloadModels",
      "sleep:5000",
      "sampler.sampleNow:post_unload",
      "sampler.stop"
    ]);

    // Assert artifact properties
    expect(artifact.status).toBe("passed");
    expect(artifact.failure).toBeNull();
    expect(artifact.gate.passed).toBe(true);
    expect(artifact.gate.checks.renderSuccess).toBe(true);
    expect(artifact.gate.checks.noOom).toBe(true);
    expect(artifact.gate.checks.durationWithinLimit).toBe(true);
    expect(artifact.gate.checks.telemetryComplete).toBe(true);
    expect(artifact.gate.checks.postUnloadHeadroomObserved).toBe(true);
    expect(artifact.render.status).toBe("succeeded");
    expect(artifact.render.executionId).toBe("exec-test-123");
    expect(artifact.render.outputObjectKeys).toEqual(["renders/ltx_0001.mp4"]);
  });

  // Behavioral Invariant 2: failed-render-keeps-cleanup
  it("captures a failed render and still attempts cleanup evidence", async () => {
    const callLog: string[] = [];
    const phaseLog: CertificationPhase[] = [];

    const fakeSampler = new FakeTelemetrySampler({
      onCall: (name, arg) => callLog.push(arg ? `${name}:${String(arg)}` : name)
    });
    const fakeRenderEngine = new FakeRenderEngine({
      getResultError: new Error("ComfyUI node execution failed: OutOfMemoryError"),
      onCall: (name) => callLog.push(name)
    });
    const sleepSpy = vi.fn().mockImplementation(async (ms: number) => {
      callLog.push(`sleep:${ms}`);
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler,
      renderEngine: fakeRenderEngine,
      sleep: sleepSpy,
      onPhaseChange: (phase) => phaseLog.push(phase)
    });

    const artifact = await runCertification(options);

    // Assert recovery path was entered and cleanup steps were attempted
    expect(phaseLog).toContain("recovery");
    expect(phaseLog).toContain("unloading");
    expect(phaseLog).toContain("settling");
    expect(phaseLog).toContain("final_sampling");
    expect(phaseLog).toContain("stopped");
    expect(phaseLog).toContain("completed");

    expect(callLog).toContain("renderEngine.unloadModels");
    expect(callLog).toContain("sleep:5000");
    expect(callLog).toContain("sampler.sampleNow:post_unload");
    expect(callLog).toContain("sampler.stop");

    // Assert artifact captured failed render and structured failure
    expect(artifact.status).toBe("failed");
    expect(artifact.gate.passed).toBe(false);
    expect(artifact.failure).not.toBeNull();
    expect(artifact.failure?.phase).toBe("rendering");
    expect(artifact.failure?.message).toContain("ComfyUI node execution failed");
    expect(artifact.render.status).toBe("failed");
    expect(artifact.telemetry.samples.length).toBeGreaterThan(0);
  });

  // Behavioral Invariant 3: timeout-is-not-thrown-away
  it("returns measured failure evidence when RenderEnginePort times out", async () => {
    const timeoutError = Object.assign(new Error("Render execution timed out after 300000ms"), {
      code: "RENDER_TIMEOUT"
    });

    const fakeSampler = new FakeTelemetrySampler();
    const fakeRenderEngine = new FakeRenderEngine({
      getResultError: timeoutError
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler,
      renderEngine: fakeRenderEngine
    });

    const artifact = await runCertification(options);

    expect(artifact.status).toBe("failed");
    expect(artifact.gate.passed).toBe(false);
    expect(artifact.failure).not.toBeNull();
    expect(artifact.failure?.code).toBe("render_timeout");
    expect(artifact.failure?.phase).toBe("rendering");
    expect(artifact.failure?.message).toContain("Render execution timed out");
    expect(artifact.telemetry.samples.length).toBe(3);
    expect(artifact.render.status).toBe("failed");
  });

  // Behavioral Invariant 4: cleanup-failure-cannot-pass
  it("fails the run when post-render cleanup evidence is incomplete", async () => {
    const fakeSampler = new FakeTelemetrySampler();
    const fakeRenderEngine = new FakeRenderEngine({
      unloadError: new Error("Failed to reach /free endpoint: connection refused")
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler,
      renderEngine: fakeRenderEngine
    });

    const artifact = await runCertification(options);

    expect(artifact.status).toBe("failed");
    expect(artifact.gate.passed).toBe(false);
    expect(artifact.failure).not.toBeNull();
    expect(artifact.failure?.phase).toBe("unloading");
    expect(artifact.failure?.code).toBe("unload_failed");
    expect(artifact.failure?.message).toContain("Failed to reach /free endpoint");
    expect(artifact.render.status).toBe("succeeded");
  });

  // Behavioral Invariant 5: settle-is-bounded
  it("uses the fixed five second post-unload settle window", async () => {
    const sleepSpy = vi.fn().mockResolvedValue(undefined);

    const options = createDefaultOptions({
      sleep: sleepSpy
    });

    await runCertification(options);

    expect(sleepSpy).toHaveBeenCalledTimes(1);
    expect(sleepSpy).toHaveBeenCalledWith(5000);
  });

  it("fails the run when final sampling fails after successful render", async () => {
    const fakeSampler = new FakeTelemetrySampler({
      sampleNowError: new Error("Failed to read post-unload GPU telemetry")
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler
    });

    const artifact = await runCertification(options);

    expect(artifact.status).toBe("failed");
    expect(artifact.gate.passed).toBe(false);
    expect(artifact.failure).not.toBeNull();
    expect(artifact.failure?.phase).toBe("final_sampling");
    expect(artifact.failure?.code).toBe("final_sampling_failed");
  });

  it("fails the run when stopping sampler fails after successful render", async () => {
    const fakeSampler = new FakeTelemetrySampler({
      stopError: new Error("Sampler stop promise rejected")
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler
    });

    const artifact = await runCertification(options);

    expect(artifact.status).toBe("failed");
    expect(artifact.gate.passed).toBe(false);
    expect(artifact.failure).not.toBeNull();
    expect(artifact.failure?.phase).toBe("stopped");
    expect(artifact.failure?.code).toBe("sampler_stop_failed");
  });

  it("combines primary render failure and cleanup failure in structured details", async () => {
    const fakeSampler = new FakeTelemetrySampler();
    const fakeRenderEngine = new FakeRenderEngine({
      getResultError: new Error("CUDA kernel execution failed"),
      unloadError: new Error("/free timed out")
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler,
      renderEngine: fakeRenderEngine
    });

    const artifact = await runCertification(options);

    expect(artifact.status).toBe("failed");
    expect(artifact.failure?.phase).toBe("rendering");
    expect(artifact.failure?.message).toContain("CUDA kernel execution failed");
    expect(artifact.failure?.details).toBeDefined();
    const details = artifact.failure?.details as {
      cleanupFailure?: { phase: string; code: string; message: string };
    };
    expect(details.cleanupFailure).toBeDefined();
    expect(details.cleanupFailure?.phase).toBe("unloading");
    expect(details.cleanupFailure?.code).toBe("unload_failed");
    expect(details.cleanupFailure?.message).toContain("/free timed out");
  });

  it("captures queue failure before dispatch and executes recovery cleanup", async () => {
    const callLog: string[] = [];
    const fakeSampler = new FakeTelemetrySampler({
      onCall: (name) => callLog.push(name)
    });
    const fakeRenderEngine = new FakeRenderEngine({
      queueError: new Error("Queue submission rejected: invalid workflow"),
      onCall: (name) => callLog.push(name)
    });

    const options = createDefaultOptions({
      telemetrySampler: fakeSampler,
      renderEngine: fakeRenderEngine
    });

    const artifact = await runCertification(options);

    expect(artifact.status).toBe("failed");
    expect(artifact.failure?.phase).toBe("rendering");
    expect(artifact.failure?.message).toContain("Queue submission rejected");
    expect(artifact.render.status).toBe("failed");
    expect(artifact.render.executionId).toBeNull();
    expect(callLog).toContain("renderEngine.unloadModels");
    expect(callLog).toContain("sampler.stop");
  });
});
