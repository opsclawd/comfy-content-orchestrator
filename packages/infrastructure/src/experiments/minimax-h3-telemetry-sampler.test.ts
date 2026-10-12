import { afterEach, describe, expect, it, vi } from "vitest";

// Control the timing of "nvidia-smi" (via execFile) so we can make a sample
// stay in-flight for as long as the test needs, without touching real GPU
// hardware or /proc. Deferred resolution lets us simulate contention
// (an interval tick firing while a previous sample is still running) and a
// slow-sample-outlives-stop() race deterministically.
const pendingExecFileCalls: Array<{ resolve: () => void }> = [];

vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    callback: (err: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    pendingExecFileCalls.push({
      resolve: () =>
        callback(null, {
          stdout: "GPU-aaaaaaaa-1111-1111-1111-111111111111, 8192, 1024, 7168\n",
          stderr: ""
        })
    });
  }
}));

vi.mock("../telemetry/linux-host-telemetry-adapter.js", () => ({
  LinuxHostTelemetryAdapter: class {
    async readHostMemory() {
      return {
        measuredAt: new Date().toISOString(),
        hostRamTotalMb: 16000,
        hostRamAvailableMb: 8000,
        hostRamUsedMb: 8000,
        processPid: 1,
        processStartTimeTicks: 0,
        processRssMb: 100,
        swapTotalMb: 0,
        swapUsedMb: 0,
        systemSwapInPages: 0,
        systemSwapOutPages: 0
      };
    }
  }
}));

const { MinimaxH3TelemetrySampler } = await import("./minimax-h3-telemetry-sampler.js");

describe("MinimaxH3TelemetrySampler", () => {
  afterEach(() => {
    pendingExecFileCalls.length = 0;
  });

  it("does not silently drop a tick that arrives while a sample is still in flight", async () => {
    vi.useFakeTimers();
    try {
      const sampler = new MinimaxH3TelemetrySampler();
      const samples: Array<{ timestamp: string }> = [];

      const handle = sampler.start({
        targetGpuUuid: "GPU-aaaaaaaa-1111-1111-1111-111111111111",
        pid: 1,
        intervalMs: 10,
        onSample: (sample) => {
          samples.push(sample);
        }
      });

      // Let the initial triggerSample() call reach execFile and get stuck there.
      await vi.advanceTimersByTimeAsync(0);
      expect(pendingExecFileCalls).toHaveLength(1);

      // Simulate an interval tick firing while that first sample is still
      // in flight -- this used to be dropped with no record of the gap.
      // Fake-timer advancement (not a real wall-clock wait) keeps this
      // deterministic under load instead of racing a real setInterval.
      await vi.advanceTimersByTimeAsync(15);

      // Resolve the stuck sample now.
      pendingExecFileCalls[0]?.resolve();
      await vi.advanceTimersByTimeAsync(0);

      // The deferred retrigger should have fired a second execFile call,
      // proving the missed tick was queued rather than discarded.
      expect(pendingExecFileCalls.length).toBeGreaterThan(1);
      pendingExecFileCalls.forEach((c) => c.resolve());
      await vi.advanceTimersByTimeAsync(0);

      const stopPromise = handle.stop();
      await vi.advanceTimersByTimeAsync(0);
      pendingExecFileCalls.forEach((c) => c.resolve());
      await vi.advanceTimersByTimeAsync(0);
      await stopPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("suppresses a sample callback that only resolves after stop() has given up waiting", async () => {
    vi.useFakeTimers();
    try {
      const sampler = new MinimaxH3TelemetrySampler();
      const samples: Array<{ timestamp: string }> = [];

      const handle = sampler.start({
        targetGpuUuid: "GPU-aaaaaaaa-1111-1111-1111-111111111111",
        pid: 1,
        intervalMs: 100_000, // no interval ticks during this test
        onSample: (sample) => {
          samples.push(sample);
        }
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(pendingExecFileCalls).toHaveLength(1);
      const firstCall = pendingExecFileCalls[0];

      // Kick off stop() while the first sample is still stuck in flight,
      // and advance past its 5s wait budget without resolving it -- this
      // is exactly the "slow nvidia-smi call outlives stop()'s patience"
      // scenario the fix targets.
      const stopPromise = handle.stop();
      await vi.advanceTimersByTimeAsync(5000);
      await stopPromise;

      // stop() has now given up and returned. No second execFile call is
      // expected (the first is still occupying the single sampleOnce
      // slot, so the forced "after" attempt would be a guaranteed no-op).
      expect(pendingExecFileCalls).toHaveLength(1);

      // Resolve the original stuck call *now*, long after stop() returned
      // and after its wait budget for it expired. Before the fix, this
      // would still have delivered a sample via onSample even though the
      // caller had already moved on (and may have finalized the sink).
      firstCall?.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(samples).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
