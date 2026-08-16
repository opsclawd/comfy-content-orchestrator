import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CertificationTelemetryDataSchema } from "@cco/contracts";
import type {
  GpuMemorySnapshot,
  GpuTelemetryPort,
  HostTelemetrySnapshot,
  HostTelemetryPort
} from "../ports/index.js";
import { TelemetrySampler, InvalidTelemetrySamplerStateError } from "./telemetry-sampler.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createMockGpuPort(overrides: Partial<GpuMemorySnapshot> = {}): GpuTelemetryPort {
  return {
    readMemory: vi.fn(async (): Promise<GpuMemorySnapshot> => ({
      totalVramMb: 24564,
      usedVramMb: 1024,
      freeVramMb: 23540,
      measuredAt: "2026-08-15T20:00:00.000Z",
      ...overrides
    }))
  };
}

function createMockHostPort(overrides: Partial<HostTelemetrySnapshot> = {}): HostTelemetryPort {
  return {
    readHostMemory: vi.fn(async (): Promise<HostTelemetrySnapshot> => ({
      hostRamTotalMb: 64000,
      hostRamAvailableMb: 50000,
      hostRamUsedMb: 14000,
      swapTotalMb: 16000,
      swapUsedMb: 0,
      systemSwapInPages: 0,
      systemSwapOutPages: 0,
      systemMajorPageFaults: 100,
      systemMinorPageFaults: 5000,
      processPid: 12345,
      processStartTimeTicks: 100000,
      processRssMb: 1200,
      processMajorPageFaults: 10,
      processMinorPageFaults: 500,
      measuredAt: "2026-08-15T20:00:00.000Z",
      ...overrides
    }))
  };
}

describe("TelemetrySampler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Behavioral invariant: start-samples-before-dispatch
  it("captures a pre-dispatch sample before start resolves", async () => {
    const gpuPort = createMockGpuPort();
    const hostPort = createMockHostPort();
    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    expect(sampler.state).toBe("idle");
    const startPromise = sampler.start();
    await startPromise;

    expect(sampler.state).toBe("running");
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(1);
    expect(hostPort.readHostMemory).toHaveBeenCalledTimes(1);

    const data = sampler.getTelemetryData();
    expect(data.samples).toHaveLength(1);
    expect(data.samples[0]?.phase).toBe("pre_dispatch");

    // Advance time by 199 ms - next sample should not have run yet
    await vi.advanceTimersByTimeAsync(199);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(1);

    // Advance time by 1 ms (total 200 ms) - next interval sample runs
    await vi.advanceTimersByTimeAsync(1);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    const dataAfter200ms = sampler.getTelemetryData();
    expect(dataAfter200ms.samples).toHaveLength(2);
    expect(dataAfter200ms.samples[1]?.phase).toBe("sampling");

    await sampler.stop();
  });

  // Behavioral invariant: one-sample-at-a-time
  it("never overlaps telemetry reads when a sample is slow", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const deferred = createDeferred<GpuMemorySnapshot>();

    const gpuPort: GpuTelemetryPort = {
      readMemory: vi.fn(async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        try {
          if (
            inFlight === 1 &&
            (gpuPort.readMemory as ReturnType<typeof vi.fn>).mock.calls.length === 2
          ) {
            return await deferred.promise;
          }
          return {
            totalVramMb: 24564,
            usedVramMb: 2048,
            freeVramMb: 22516,
            measuredAt: new Date().toISOString()
          };
        } finally {
          inFlight--;
        }
      })
    };
    const hostPort = createMockHostPort();

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);

    // Trigger 2nd sample (the slow deferred one)
    await vi.advanceTimersByTimeAsync(200);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    expect(inFlight).toBe(1);

    // Advance time by 500ms while sample 2 is still pending
    await vi.advanceTimersByTimeAsync(500);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);

    // Now resolve sample 2
    deferred.resolve({
      totalVramMb: 24564,
      usedVramMb: 4096,
      freeVramMb: 20468,
      measuredAt: new Date().toISOString()
    });
    await vi.advanceTimersByTimeAsync(0);

    // Sample 2 is settled, next interval scheduled for +200ms
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBe(1);

    await sampler.stop();
  });

  // Behavioral invariant: sample-failure-recovers
  it("records a sampling error and recovers on the next interval", async () => {
    let callCount = 0;
    const gpuPort: GpuTelemetryPort = {
      readMemory: vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error("nvidia-smi timed out after 500ms");
        }
        return {
          totalVramMb: 24564,
          usedVramMb: 1024 * callCount,
          freeVramMb: 24564 - 1024 * callCount,
          measuredAt: new Date().toISOString()
        };
      })
    };
    const hostPort = createMockHostPort();

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    expect(sampler.getTelemetryData().samples).toHaveLength(1);
    expect(sampler.getTelemetryData().samplingErrors).toHaveLength(0);

    // Advance to sample 2 (which fails)
    await vi.advanceTimersByTimeAsync(200);
    const dataAfterError = sampler.getTelemetryData();
    expect(dataAfterError.samples).toHaveLength(1);
    expect(dataAfterError.samplingErrors).toHaveLength(1);
    expect(dataAfterError.samplingErrors[0]?.message).toContain("nvidia-smi timed out");

    // Advance to sample 3 (which succeeds)
    await vi.advanceTimersByTimeAsync(200);
    const dataAfterRecovery = sampler.getTelemetryData();
    expect(dataAfterRecovery.samples).toHaveLength(2);
    expect(dataAfterRecovery.samplingErrors).toHaveLength(1);

    await sampler.stop();
  });

  // Behavioral invariant: stop-is-terminal
  it("drains the active sample and remains stopped", async () => {
    const deferred = createDeferred<GpuMemorySnapshot>();
    let callCount = 0;
    const gpuPort: GpuTelemetryPort = {
      readMemory: vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          return await deferred.promise;
        }
        return {
          totalVramMb: 24564,
          usedVramMb: 1024,
          freeVramMb: 23540,
          measuredAt: new Date().toISOString()
        };
      })
    };
    const hostPort = createMockHostPort();

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(1);

    // Advance to trigger sample 2 (in-flight)
    await vi.advanceTimersByTimeAsync(200);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);

    // Call stop while sample 2 is in-flight
    let stopResolved = false;
    const stopPromise = sampler.stop().then((res) => {
      stopResolved = true;
      return res;
    });

    expect(sampler.state).toBe("stopping");
    expect(stopResolved).toBe(false);

    // Resolve in-flight sample 2
    deferred.resolve({
      totalVramMb: 24564,
      usedVramMb: 5000,
      freeVramMb: 19564,
      measuredAt: new Date().toISOString()
    });

    const finalData = await stopPromise;
    expect(sampler.state).toBe("stopped");
    expect(stopResolved).toBe(true);
    expect(finalData.samples).toHaveLength(2);

    // Advance time further - no new samples should execute
    await vi.advanceTimersByTimeAsync(1000);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    expect(sampler.getTelemetryData().samples).toHaveLength(2);
  });

  // Behavioral invariant: post-unload-is-explicit
  it("tags the explicit post-unload sample", async () => {
    const gpuPort = createMockGpuPort();
    const hostPort = createMockHostPort();
    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    await vi.advanceTimersByTimeAsync(200);

    const postUnloadSample = await sampler.sampleNow("post_unload");
    expect(postUnloadSample.phase).toBe("post_unload");

    const stoppedData = await sampler.stop();
    const phases = stoppedData.samples.map((s) => s.phase);
    expect(phases).toEqual(["pre_dispatch", "sampling", "post_unload"]);
    expect(stoppedData.postUnloadUsedVramMb).toBe(1024);
    expect(stoppedData.postUnloadFreeVramMb).toBe(23540);
  });

  // Behavioral invariant: invalid-transitions-throw
  it("rejects invalid state machine transitions and handles re-entrant calls", async () => {
    const gpuPort = createMockGpuPort();
    const hostPort = createMockHostPort();
    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    // In idle state: sampleNow() throws
    await expect(sampler.sampleNow("post_unload")).rejects.toThrow(
      InvalidTelemetrySamplerStateError
    );

    // Start transitions idle -> running
    await sampler.start();
    expect(sampler.state).toBe("running");

    // Re-entrant start while running throws
    await expect(sampler.start()).rejects.toThrow(InvalidTelemetrySamplerStateError);

    // Stop transitions running -> stopped
    const stopPromise1 = sampler.stop();
    const stopPromise2 = sampler.stop();
    const [data1, data2] = await Promise.all([stopPromise1, stopPromise2]);
    expect(sampler.state).toBe("stopped");
    expect(data1).toEqual(data2);

    // Stop when already stopped is idempotent
    const data3 = await sampler.stop();
    expect(data3).toEqual(data1);

    // Calling start or sampleNow on stopped sampler throws
    await expect(sampler.start()).rejects.toThrow(InvalidTelemetrySamplerStateError);
    await expect(sampler.sampleNow("post_unload")).rejects.toThrow(
      InvalidTelemetrySamplerStateError
    );
  });

  // Behavioral invariant: consecutive-error-budget-aborts
  it("aborts sampling when consecutive error budget is exceeded", async () => {
    const gpuPort: GpuTelemetryPort = {
      readMemory: vi.fn(async () => {
        throw new Error("Persistent GPU driver crash");
      })
    };
    const hostPort = createMockHostPort();

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200,
      consecutiveErrorBudget: 3
    });

    // start() attempts pre_dispatch which fails (error 1)
    await sampler.start();
    expect(sampler.getTelemetryData().samplingErrors).toHaveLength(1);

    // Sample 2 (error 2)
    await vi.advanceTimersByTimeAsync(200);
    expect(sampler.getTelemetryData().samplingErrors).toHaveLength(2);

    // Sample 3 (error 3 => budget 3 reached, aborts further polling)
    await vi.advanceTimersByTimeAsync(200);
    const dataAfterBudget = sampler.getTelemetryData();
    expect(dataAfterBudget.samplingErrors).toHaveLength(4);
    expect(dataAfterBudget.samplingErrors[3]?.message).toContain(
      "Sampling aborted: consecutive error budget of 3 exceeded"
    );

    const callCountAtAbort = (gpuPort.readMemory as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCountAtAbort).toBe(3);

    // Advancing time further does not trigger additional reads
    await vi.advanceTimersByTimeAsync(1000);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(callCountAtAbort);

    const stoppedData = await sampler.stop();
    expect(stoppedData.samplingErrors).toHaveLength(4);
  });

  it("does not overlap scheduled timer sample when sampleNow is in flight", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    const sampleNowDeferred = createDeferred<GpuMemorySnapshot>();

    const gpuPort: GpuTelemetryPort = {
      readMemory: vi.fn(async () => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        try {
          if ((gpuPort.readMemory as ReturnType<typeof vi.fn>).mock.calls.length === 2) {
            return await sampleNowDeferred.promise;
          }
          return {
            totalVramMb: 24564,
            usedVramMb: 1024,
            freeVramMb: 23540,
            measuredAt: new Date().toISOString()
          };
        } finally {
          inFlight--;
        }
      })
    };
    const hostPort = createMockHostPort();

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(1);

    // At t=100ms, initiate an explicit sampleNow which is slow
    await vi.advanceTimersByTimeAsync(100);
    const sampleNowPromise = sampler.sampleNow("sampling");
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    expect(inFlight).toBe(1);

    // At t=200ms, the scheduled timer expires while sampleNow is in flight
    await vi.advanceTimersByTimeAsync(100);
    // Scheduled timer must wait for sampleNow and NOT start another concurrent read
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(2);
    expect(maxConcurrent).toBe(1);

    // Resolve sampleNow
    sampleNowDeferred.resolve({
      totalVramMb: 24564,
      usedVramMb: 2048,
      freeVramMb: 22516,
      measuredAt: new Date().toISOString()
    });
    await sampleNowPromise;

    // After sampleNow resolves, the scheduled timer proceeds
    await vi.advanceTimersByTimeAsync(0);
    expect(gpuPort.readMemory).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBe(1);

    await sampler.stop();
  });

  it("returns null for negative deltas instead of clamping to zero", async () => {
    let callCount = 0;
    const gpuPort = createMockGpuPort();
    const hostPort: HostTelemetryPort = {
      readHostMemory: vi.fn(async () => {
        callCount++;
        return {
          hostRamTotalMb: 64000,
          hostRamAvailableMb: 50000,
          hostRamUsedMb: 14000,
          swapTotalMb: 16000,
          swapUsedMb: callCount === 1 ? 500 : 100, // swap decreased => negative delta
          systemSwapInPages: callCount === 1 ? 200 : 50, // counter reset
          systemSwapOutPages: 0,
          systemMajorPageFaults: 100,
          systemMinorPageFaults: 5000,
          processPid: 12345,
          processStartTimeTicks: 100000,
          processRssMb: 1200,
          processMajorPageFaults: 10,
          processMinorPageFaults: 500,
          measuredAt: "2026-08-15T20:00:00.000Z"
        };
      })
    };

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    await vi.advanceTimersByTimeAsync(200);
    const data = await sampler.stop();

    expect(data.swapUsedDeltaMb).toBeNull();
    expect(data.systemSwapInPageDelta).toBeNull();
    expect(data.systemSwapOutPageDelta).toBe(0);
    expect(data.systemMajorPageFaultDelta).toBe(0);
  });

  it("returns null for process fault deltas when process PID or start time changes", async () => {
    let callCount = 0;
    const gpuPort = createMockGpuPort();
    const hostPort: HostTelemetryPort = {
      readHostMemory: vi.fn(async () => {
        callCount++;
        return {
          hostRamTotalMb: 64000,
          hostRamAvailableMb: 50000,
          hostRamUsedMb: 14000,
          swapTotalMb: 16000,
          swapUsedMb: 0,
          systemSwapInPages: 0,
          systemSwapOutPages: 0,
          systemMajorPageFaults: 100 + callCount,
          systemMinorPageFaults: 5000,
          processPid: callCount === 1 ? 12345 : 99999, // PID changed
          processStartTimeTicks: 100000,
          processRssMb: 1200,
          processMajorPageFaults: 10 + callCount,
          processMinorPageFaults: 500,
          measuredAt: "2026-08-15T20:00:00.000Z"
        };
      })
    };

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    await vi.advanceTimersByTimeAsync(200);
    const data = await sampler.stop();

    expect(data.processMajorPageFaultDelta).toBeNull();
    expect(data.processMinorPageFaultDelta).toBeNull();
    expect(data.systemMajorPageFaultDelta).toBe(1); // system delta is still valid
  });

  it("returns null for process fault deltas when process start time ticks change", async () => {
    let callCount = 0;
    const gpuPort = createMockGpuPort();
    const hostPort: HostTelemetryPort = {
      readHostMemory: vi.fn(async () => {
        callCount++;
        return {
          hostRamTotalMb: 64000,
          hostRamAvailableMb: 50000,
          hostRamUsedMb: 14000,
          swapTotalMb: 16000,
          swapUsedMb: 0,
          systemSwapInPages: 0,
          systemSwapOutPages: 0,
          systemMajorPageFaults: 100,
          systemMinorPageFaults: 5000,
          processPid: 12345,
          processStartTimeTicks: callCount === 1 ? 100000 : 200000, // start time changed
          processRssMb: 1200,
          processMajorPageFaults: 10 + callCount,
          processMinorPageFaults: 500,
          measuredAt: "2026-08-15T20:00:00.000Z"
        };
      })
    };

    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    await vi.advanceTimersByTimeAsync(200);
    const data = await sampler.stop();

    expect(data.processMajorPageFaultDelta).toBeNull();
    expect(data.processMinorPageFaultDelta).toBeNull();
  });

  it("propagates custom intervalMs to sampleIntervalMs", async () => {
    const gpuPort = createMockGpuPort();
    const hostPort = createMockHostPort();
    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 100
    });

    await sampler.start();
    const data = await sampler.stop();
    expect(data.sampleIntervalMs).toBe(100);
  });

  it("calculates summary metrics and schema conformance correctly", async () => {
    const gpuPort = createMockGpuPort();
    const hostPort = createMockHostPort();
    const sampler = new TelemetrySampler({
      gpuTelemetryPort: gpuPort,
      hostTelemetryPort: hostPort,
      intervalMs: 200
    });

    await sampler.start();
    await vi.advanceTimersByTimeAsync(200);
    await sampler.sampleNow("post_unload");
    const data = await sampler.stop();

    const parseResult = CertificationTelemetryDataSchema.safeParse(data);
    expect(parseResult.success).toBe(true);
    expect(data.peakVramMb).toBe(1024);
    expect(data.peakHostRamUsedMb).toBe(14000);
    expect(data.peakProcessRssMb).toBe(1200);
    expect(data.swapUsedDeltaMb).toBe(0);
    expect(data.systemMajorPageFaultDelta).toBe(0);
    expect(data.postUnloadUsedVramMb).toBe(1024);
  });
});
