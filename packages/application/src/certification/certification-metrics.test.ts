import type {
  CertificationFailure,
  CertificationRenderExecution,
  CertificationSamplingError,
  CertificationTelemetrySample,
  LtxCertificationArtifact
} from "@cco/contracts";
import { describe, expect, it } from "vitest";
import {
  aggregateCertificationTelemetry,
  evaluateLtxResourceGate,
  renderCertificationSummary
} from "./certification-metrics.js";

function createSample(
  overrides: {
    measuredAt?: string;
    phase?: "pre_dispatch" | "sampling" | "post_unload";
    usedVramMb?: number;
    freeVramMb?: number;
    totalVramMb?: number;
    hostRamUsedMb?: number;
    hostRamTotalMb?: number;
    hostRamAvailableMb?: number;
    swapTotalMb?: number;
    swapUsedMb?: number;
    systemSwapInPages?: number;
    systemSwapOutPages?: number;
    systemMajorPageFaults?: number;
    systemMinorPageFaults?: number;
    processPid?: number;
    processStartTimeTicks?: number;
    processRssMb?: number;
    processMajorPageFaults?: number;
    processMinorPageFaults?: number;
  } = {}
): CertificationTelemetrySample {
  return {
    measuredAt: overrides.measuredAt ?? "2026-08-15T20:00:00.000Z",
    phase: overrides.phase ?? "sampling",
    gpu: {
      totalVramMb: overrides.totalVramMb ?? 24564,
      usedVramMb: overrides.usedVramMb ?? 1024,
      freeVramMb: overrides.freeVramMb ?? 23540
    },
    host: {
      hostRamTotalMb: overrides.hostRamTotalMb ?? 64000,
      hostRamAvailableMb: overrides.hostRamAvailableMb ?? 50000,
      hostRamUsedMb: overrides.hostRamUsedMb ?? 14000,
      swapTotalMb: overrides.swapTotalMb ?? 16000,
      swapUsedMb: overrides.swapUsedMb ?? 100,
      systemSwapInPages: overrides.systemSwapInPages ?? 10,
      systemSwapOutPages: overrides.systemSwapOutPages ?? 5,
      systemMajorPageFaults: overrides.systemMajorPageFaults ?? 100,
      systemMinorPageFaults: overrides.systemMinorPageFaults ?? 5000,
      processPid: overrides.processPid ?? 12345,
      processStartTimeTicks: overrides.processStartTimeTicks ?? 100000,
      processRssMb: overrides.processRssMb ?? 1200,
      processMajorPageFaults: overrides.processMajorPageFaults ?? 10,
      processMinorPageFaults: overrides.processMinorPageFaults ?? 500
    }
  };
}

function createCompleteArtifact(
  overrides: Partial<LtxCertificationArtifact> = {}
): LtxCertificationArtifact {
  const defaultArtifact: LtxCertificationArtifact = {
    version: 1,
    runId: "trinidad-rtx4090-dynamicvram-v1",
    generatedAt: "2026-08-15T20:00:00.000Z",
    status: "passed",
    runnerMode: "dynamicvram",
    identity: {
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
    },
    environment: {
      nodeVersion: "v24.0.0",
      platform: "linux",
      arch: "x64",
      osRelease: "6.8.0-40-generic",
      osVersion: "#40-Ubuntu SMP PREEMPT_DYNAMIC",
      cpuModel: "AMD Ryzen 9 7950X",
      cpuCount: 32,
      gpuName: "NVIDIA GeForce RTX 4090",
      gpuUuid: "GPU-12345678-1234-1234-1234-123456789abc",
      gpuDriverVersion: "550.54.14",
      gpuTotalMemoryMb: 24564,
      cudaVersion: "12.4",
      comfyUiPid: 12345,
      comfyUiArgs: ["python3", "main.py", "--listen", "0.0.0.0", "--port", "8188"]
    },
    render: {
      executionId: "exec-123",
      status: "succeeded",
      outputObjectKeys: ["renders/scene-1/output.mp4"],
      startedAt: "2026-08-15T20:00:01.000Z",
      completedAt: "2026-08-15T20:00:47.000Z",
      totalDurationMs: 46000
    },
    telemetry: {
      sampleIntervalMs: 200,
      samples: [
        createSample({
          measuredAt: "2026-08-15T20:00:01.000Z",
          phase: "pre_dispatch",
          usedVramMb: 1024,
          hostRamUsedMb: 14000,
          processRssMb: 1200,
          swapUsedMb: 100,
          systemSwapInPages: 10,
          systemSwapOutPages: 5,
          systemMajorPageFaults: 100,
          systemMinorPageFaults: 5000,
          processMajorPageFaults: 10,
          processMinorPageFaults: 500
        }),
        createSample({
          measuredAt: "2026-08-15T20:00:20.000Z",
          phase: "sampling",
          usedVramMb: 24028,
          hostRamUsedMb: 19000,
          processRssMb: 4500,
          swapUsedMb: 150,
          systemSwapInPages: 12,
          systemSwapOutPages: 8,
          systemMajorPageFaults: 105,
          systemMinorPageFaults: 6200,
          processMajorPageFaults: 12,
          processMinorPageFaults: 1300
        }),
        createSample({
          measuredAt: "2026-08-15T20:00:52.000Z",
          phase: "post_unload",
          usedVramMb: 1024,
          freeVramMb: 23540,
          hostRamUsedMb: 15000,
          processRssMb: 1300,
          swapUsedMb: 150,
          systemSwapInPages: 12,
          systemSwapOutPages: 8,
          systemMajorPageFaults: 105,
          systemMinorPageFaults: 6200,
          processMajorPageFaults: 12,
          processMinorPageFaults: 1300
        })
      ],
      samplingErrors: [],
      peakVramMb: 24028,
      peakHostRamUsedMb: 19000,
      peakProcessRssMb: 4500,
      swapUsedDeltaMb: 50,
      systemSwapInPageDelta: 2,
      systemSwapOutPageDelta: 3,
      systemMajorPageFaultDelta: 5,
      systemMinorPageFaultDelta: 1200,
      processMajorPageFaultDelta: 2,
      processMinorPageFaultDelta: 800,
      postUnloadUsedVramMb: 1024,
      postUnloadFreeVramMb: 23540
    },
    gate: {
      passed: true,
      maxDurationMs: 55000,
      checks: {
        renderSuccess: true,
        noOom: true,
        durationWithinLimit: true,
        telemetryComplete: true,
        postUnloadHeadroomObserved: true
      }
    },
    failure: null
  };

  return {
    ...defaultArtifact,
    ...overrides
  };
}

describe("certification-metrics", () => {
  describe("aggregateCertificationTelemetry", () => {
    // Behavioral invariant: peaks-come-from-raw-samples
    it("calculates GPU and host peaks from raw samples", () => {
      const sample1 = createSample({
        measuredAt: "2026-08-15T20:00:00.000Z",
        phase: "pre_dispatch",
        usedVramMb: 2000,
        hostRamUsedMb: 10000,
        processRssMb: 3000
      });
      const sample2 = createSample({
        measuredAt: "2026-08-15T20:00:05.000Z",
        phase: "sampling",
        usedVramMb: 22500,
        hostRamUsedMb: 18000,
        processRssMb: 6000
      });
      const sample3 = createSample({
        measuredAt: "2026-08-15T20:00:10.000Z",
        phase: "sampling",
        usedVramMb: 15000,
        hostRamUsedMb: 21000,
        processRssMb: 4500
      });
      const sample4 = createSample({
        measuredAt: "2026-08-15T20:00:15.000Z",
        phase: "post_unload",
        usedVramMb: 1200,
        freeVramMb: 23364,
        hostRamUsedMb: 11000,
        processRssMb: 3100
      });

      const aggregated = aggregateCertificationTelemetry([sample1, sample2, sample3, sample4]);

      expect(aggregated.peakVramMb).toBe(22500);
      expect(aggregated.peakHostRamUsedMb).toBe(21000);
      expect(aggregated.peakProcessRssMb).toBe(6000);
      expect(aggregated.postUnloadUsedVramMb).toBe(1200);
      expect(aggregated.postUnloadFreeVramMb).toBe(23364);
      expect(aggregated.samples).toHaveLength(4);
      expect(aggregated.samplingErrors).toEqual([]);
      expect(aggregated.sampleIntervalMs).toBe(200);
    });

    // Behavioral invariant: deltas-use-window-edges
    it("calculates non-negative host and process deltas across one stable process", () => {
      const first = createSample({
        measuredAt: "2026-08-15T20:00:00.000Z",
        phase: "pre_dispatch",
        swapUsedMb: 200,
        systemSwapInPages: 50,
        systemSwapOutPages: 20,
        systemMajorPageFaults: 1000,
        systemMinorPageFaults: 50000,
        processPid: 4242,
        processStartTimeTicks: 987654,
        processMajorPageFaults: 15,
        processMinorPageFaults: 3000
      });

      const middle = createSample({
        measuredAt: "2026-08-15T20:00:05.000Z",
        phase: "sampling",
        swapUsedMb: 350,
        systemSwapInPages: 75,
        systemSwapOutPages: 30,
        systemMajorPageFaults: 1020,
        systemMinorPageFaults: 55000,
        processPid: 4242,
        processStartTimeTicks: 987654,
        processMajorPageFaults: 20,
        processMinorPageFaults: 4000
      });

      const last = createSample({
        measuredAt: "2026-08-15T20:00:10.000Z",
        phase: "post_unload",
        swapUsedMb: 300,
        systemSwapInPages: 80,
        systemSwapOutPages: 25,
        systemMajorPageFaults: 1030,
        systemMinorPageFaults: 60000,
        processPid: 4242,
        processStartTimeTicks: 987654,
        processMajorPageFaults: 22,
        processMinorPageFaults: 5200
      });

      const aggregated = aggregateCertificationTelemetry([first, middle, last]);

      expect(aggregated.swapUsedDeltaMb).toBe(100); // 300 - 200
      expect(aggregated.systemSwapInPageDelta).toBe(30); // 80 - 50
      expect(aggregated.systemSwapOutPageDelta).toBe(5); // 25 - 20
      expect(aggregated.systemMajorPageFaultDelta).toBe(30); // 1030 - 1000
      expect(aggregated.systemMinorPageFaultDelta).toBe(10000); // 60000 - 50000
      expect(aggregated.processMajorPageFaultDelta).toBe(7); // 22 - 15
      expect(aggregated.processMinorPageFaultDelta).toBe(2200); // 5200 - 3000
    });

    it("returns null deltas when counters decrease or process identity changes", () => {
      // Counter reset (e.g. system reboot or counter wrap)
      const sampleCounterResetStart = createSample({
        systemMajorPageFaults: 500,
        processPid: 100,
        processStartTimeTicks: 5000
      });
      const sampleCounterResetEnd = createSample({
        systemMajorPageFaults: 400, // decreased
        processPid: 100,
        processStartTimeTicks: 5000
      });

      const resCounterReset = aggregateCertificationTelemetry([
        sampleCounterResetStart,
        sampleCounterResetEnd
      ]);
      expect(resCounterReset.systemMajorPageFaultDelta).toBeNull();

      // Process PID change
      const samplePidStart = createSample({
        processPid: 100,
        processStartTimeTicks: 5000,
        processMajorPageFaults: 10
      });
      const samplePidEnd = createSample({
        processPid: 101, // different PID
        processStartTimeTicks: 5000,
        processMajorPageFaults: 20
      });

      const resPidChange = aggregateCertificationTelemetry([samplePidStart, samplePidEnd]);
      expect(resPidChange.processMajorPageFaultDelta).toBeNull();
      expect(resPidChange.processMinorPageFaultDelta).toBeNull();

      // Process start time ticks change (PID reuse)
      const sampleReuseStart = createSample({
        processPid: 100,
        processStartTimeTicks: 5000,
        processMajorPageFaults: 10
      });
      const sampleReuseEnd = createSample({
        processPid: 100,
        processStartTimeTicks: 6000, // different start time ticks
        processMajorPageFaults: 20
      });

      const resReuseChange = aggregateCertificationTelemetry([sampleReuseStart, sampleReuseEnd]);
      expect(resReuseChange.processMajorPageFaultDelta).toBeNull();
      expect(resReuseChange.processMinorPageFaultDelta).toBeNull();
    });

    it("returns null for all aggregates when samples array is empty", () => {
      const errors: CertificationSamplingError[] = [
        { measuredAt: "2026-08-15T20:00:00.000Z", message: "Device unavailable" }
      ];
      const aggregated = aggregateCertificationTelemetry([], errors, 200);

      expect(aggregated.samples).toEqual([]);
      expect(aggregated.samplingErrors).toEqual(errors);
      expect(aggregated.peakVramMb).toBeNull();
      expect(aggregated.peakHostRamUsedMb).toBeNull();
      expect(aggregated.peakProcessRssMb).toBeNull();
      expect(aggregated.swapUsedDeltaMb).toBeNull();
      expect(aggregated.systemSwapInPageDelta).toBeNull();
      expect(aggregated.systemSwapOutPageDelta).toBeNull();
      expect(aggregated.systemMajorPageFaultDelta).toBeNull();
      expect(aggregated.systemMinorPageFaultDelta).toBeNull();
      expect(aggregated.processMajorPageFaultDelta).toBeNull();
      expect(aggregated.processMinorPageFaultDelta).toBeNull();
      expect(aggregated.postUnloadUsedVramMb).toBeNull();
      expect(aggregated.postUnloadFreeVramMb).toBeNull();
    });
  });

  describe("evaluateLtxResourceGate", () => {
    // Behavioral invariant: missing-data-fails-the-gate
    it("fails certification when required telemetry evidence is missing", () => {
      const render: CertificationRenderExecution = {
        executionId: "exec-1",
        status: "succeeded",
        outputObjectKeys: ["renders/scene-1/output.mp4"],
        startedAt: "2026-08-15T20:00:00.000Z",
        completedAt: "2026-08-15T20:00:45.000Z",
        totalDurationMs: 45000
      };

      // Case 1: Empty samples
      const emptyTelemetry = aggregateCertificationTelemetry([]);
      const gateEmpty = evaluateLtxResourceGate({ render, telemetry: emptyTelemetry });
      expect(gateEmpty.passed).toBe(false);
      expect(gateEmpty.checks.telemetryComplete).toBe(false);
      expect(gateEmpty.checks.postUnloadHeadroomObserved).toBe(false);

      // Case 2: Sampling error present
      const sample = createSample({ phase: "sampling" });
      const samplePost = createSample({ phase: "post_unload" });
      const errorTelemetry = aggregateCertificationTelemetry(
        [sample, samplePost],
        [{ measuredAt: "2026-08-15T20:00:01.000Z", message: "GPU read dropped" }]
      );
      const gateError = evaluateLtxResourceGate({ render, telemetry: errorTelemetry });
      expect(gateError.passed).toBe(false);
      expect(gateError.checks.telemetryComplete).toBe(false);

      // Case 3: Missing post_unload phase sample
      const noPostTelemetry = aggregateCertificationTelemetry([sample]);
      const gateNoPost = evaluateLtxResourceGate({ render, telemetry: noPostTelemetry });
      expect(gateNoPost.passed).toBe(false);
      expect(gateNoPost.checks.postUnloadHeadroomObserved).toBe(false);

      // Case 4: Process PID changed (process delta is null)
      const pidStart = createSample({ processPid: 100, processStartTimeTicks: 1000 });
      const pidEnd = createSample({
        processPid: 101,
        processStartTimeTicks: 1000,
        phase: "post_unload"
      });
      const pidChangeTelemetry = aggregateCertificationTelemetry([pidStart, pidEnd]);
      const gatePidChange = evaluateLtxResourceGate({ render, telemetry: pidChangeTelemetry });
      expect(gatePidChange.passed).toBe(false);
      expect(gatePidChange.checks.telemetryComplete).toBe(false);
    });

    // Behavioral invariant: duration-boundary-is-inclusive
    it("applies the inclusive 55 second LTX duration gate", () => {
      const baseTelemetry = aggregateCertificationTelemetry([
        createSample({ phase: "pre_dispatch" }),
        createSample({ phase: "sampling" }),
        createSample({ phase: "post_unload" })
      ]);

      // Exactly 55,000 ms passes
      const renderPass: CertificationRenderExecution = {
        executionId: "exec-1",
        status: "succeeded",
        outputObjectKeys: ["out.mp4"],
        startedAt: "2026-08-15T20:00:00.000Z",
        completedAt: "2026-08-15T20:00:55.000Z",
        totalDurationMs: 55000
      };
      const gatePass = evaluateLtxResourceGate({ render: renderPass, telemetry: baseTelemetry });
      expect(gatePass.checks.durationWithinLimit).toBe(true);
      expect(gatePass.passed).toBe(true);

      // 55,001 ms fails
      const renderFail: CertificationRenderExecution = {
        executionId: "exec-2",
        status: "succeeded",
        outputObjectKeys: ["out.mp4"],
        startedAt: "2026-08-15T20:00:00.000Z",
        completedAt: "2026-08-15T20:00:55.001Z",
        totalDurationMs: 55001
      };
      const gateFail = evaluateLtxResourceGate({ render: renderFail, telemetry: baseTelemetry });
      expect(gateFail.checks.durationWithinLimit).toBe(false);
      expect(gateFail.passed).toBe(false);

      // null duration fails
      const renderNullDuration: CertificationRenderExecution = {
        executionId: "exec-3",
        status: "succeeded",
        outputObjectKeys: ["out.mp4"],
        startedAt: "2026-08-15T20:00:00.000Z",
        completedAt: null,
        totalDurationMs: null
      };
      const gateNull = evaluateLtxResourceGate({
        render: renderNullDuration,
        telemetry: baseTelemetry
      });
      expect(gateNull.checks.durationWithinLimit).toBe(false);
      expect(gateNull.passed).toBe(false);
    });

    it("evaluates render failure and OOM conditions accurately", () => {
      const baseTelemetry = aggregateCertificationTelemetry([
        createSample({ phase: "pre_dispatch" }),
        createSample({ phase: "sampling" }),
        createSample({ phase: "post_unload" })
      ]);

      // Render failed
      const renderFailed: CertificationRenderExecution = {
        executionId: "exec-1",
        status: "failed",
        outputObjectKeys: [],
        startedAt: "2026-08-15T20:00:00.000Z",
        completedAt: "2026-08-15T20:00:10.000Z",
        totalDurationMs: 10000
      };
      const gateRenderFailed = evaluateLtxResourceGate({
        render: renderFailed,
        telemetry: baseTelemetry
      });
      expect(gateRenderFailed.checks.renderSuccess).toBe(false);
      expect(gateRenderFailed.passed).toBe(false);

      // OOM failure code
      const oomFailure: CertificationFailure = {
        phase: "rendering",
        code: "out_of_memory",
        message: "CUDA out of memory during attention computation",
        details: { allocatedMb: 24500 }
      };
      const gateOom = evaluateLtxResourceGate({
        render: renderFailed,
        telemetry: baseTelemetry,
        failure: oomFailure
      });
      expect(gateOom.checks.noOom).toBe(false);
      expect(gateOom.passed).toBe(false);
    });
  });

  describe("renderCertificationSummary", () => {
    // Behavioral invariant: summary-has-one-source
    it("renders JSON-equivalent measurements and failures in Markdown", () => {
      const artifact = createCompleteArtifact();
      const markdown = renderCertificationSummary(artifact);

      // Verify header and identity
      expect(markdown).toContain("# LTX-2.5 Hardware Certification Summary");
      expect(markdown).toContain("trinidad-rtx4090-dynamicvram-v1");
      expect(markdown).toContain("dynamicvram");
      expect(markdown).toContain("PASSED");
      expect(markdown).toContain("LTX_25_720P_5S_V1");
      expect(markdown).toContain("NVIDIA GeForce RTX 4090");

      // Verify measured metrics are present and JSON-equivalent
      expect(markdown).toContain("46,000 ms");
      expect(markdown).toContain("24,028 MB");
      expect(markdown).toContain("19,000 MB");
      expect(markdown).toContain("4,500 MB");
      expect(markdown).toContain("50 MB");

      // Verify gate checks
      expect(markdown).toContain("Render Success");
      expect(markdown).toContain("No OOM Detected");
      expect(markdown).toContain("Duration Within Limit");
      expect(markdown).toContain("Telemetry Complete");
      expect(markdown).toContain("Post-Unload Headroom Observed");

      // Verify historical baseline is explicitly labeled as comparison reference only
      expect(markdown).toContain("Historical Baseline Comparison (Reference Only)");
      expect(markdown).toContain("46 s");
      expect(markdown).toContain("24,028 MB");

      // Test with failed artifact containing nulls and failure details
      const failedArtifact = createCompleteArtifact({
        status: "failed",
        render: {
          executionId: "exec-fail",
          status: "failed",
          outputObjectKeys: [],
          startedAt: "2026-08-15T20:00:00.000Z",
          completedAt: "2026-08-15T20:00:15.000Z",
          totalDurationMs: 15000
        },
        telemetry: {
          ...createCompleteArtifact().telemetry,
          postUnloadUsedVramMb: null,
          postUnloadFreeVramMb: null
        },
        gate: {
          passed: false,
          maxDurationMs: 55000,
          checks: {
            renderSuccess: false,
            noOom: true,
            durationWithinLimit: true,
            telemetryComplete: true,
            postUnloadHeadroomObserved: false
          }
        },
        failure: {
          phase: "rendering",
          code: "render_failed",
          message: "ComfyUI execution error at node 3",
          details: { nodeId: "3" }
        }
      });

      const failedMarkdown = renderCertificationSummary(failedArtifact);
      expect(failedMarkdown).toContain("FAILED");
      expect(failedMarkdown).toContain("render_failed");
      expect(failedMarkdown).toContain("ComfyUI execution error at node 3");
      expect(failedMarkdown).toContain("nodeId");
      expect(failedMarkdown).toContain("N/A");
    });
  });
});
