import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  MinimaxH3GpuSample,
  MinimaxH3HostSample,
  MinimaxH3TelemetrySample
} from "@cco/contracts";
import type { MinimaxH3TelemetrySamplerPort } from "@cco/application";
import { LinuxHostTelemetryAdapter } from "../telemetry/linux-host-telemetry-adapter.js";

const execFileAsync = promisify(execFile);

export class MinimaxH3TelemetrySampler implements MinimaxH3TelemetrySamplerPort {
  start(options: {
    targetGpuUuid: string;
    pid: number;
    processStartTimeTicks?: number;
    intervalMs: number;
    onSample: (sample: MinimaxH3TelemetrySample) => void | Promise<void>;
  }): {
    stop: () => Promise<void>;
    setPhase: (phase: "before" | "during" | "after") => void;
  } {
    const { targetGpuUuid, pid, processStartTimeTicks, intervalMs, onSample } = options;
    let currentPhase: "before" | "during" | "after" = "before";
    let isStopped = false;
    let isSampling = false;
    let pendingRetrigger = false;
    // One-way: once stop() gives up waiting on a sample and returns, no
    // sample started before that point may deliver onSample afterward,
    // even if it resolves later (e.g. a slow nvidia-smi call). Unlike a
    // toggled flag, this never re-opens once stop() has moved on.
    let stopFinalized = false;
    let timer: NodeJS.Timeout | null = null;
    let inFlightSample: Promise<void> | null = null;

    const hostAdapter = new LinuxHostTelemetryAdapter({
      pid,
      expectedStartTimeTicks: processStartTimeTicks
    });

    const collectGpuSample = async (): Promise<MinimaxH3GpuSample> => {
      const { stdout } = await execFileAsync(
        "nvidia-smi",
        ["--query-gpu=uuid,memory.total,memory.used,memory.free", "--format=csv,noheader,nounits"],
        { timeout: 5000 }
      );

      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      let matchedRow: string | null = null;

      for (const line of lines) {
        const parts = line.split(",").map((s) => s.trim());
        const uuid = parts[0];
        if (uuid === targetGpuUuid) {
          matchedRow = line;
          break;
        }
      }

      if (!matchedRow) {
        throw new Error(
          `Target GPU UUID "${targetGpuUuid}" not found in nvidia-smi output (${lines.length} devices detected)`
        );
      }

      const cols = matchedRow.split(",").map((s) => s.trim());
      const totalVramMb = parseInt(cols[1] || "", 10);
      const usedVramMb = parseInt(cols[2] || "", 10);
      const freeVramMb = parseInt(cols[3] || "", 10);

      if (Number.isNaN(totalVramMb) || Number.isNaN(usedVramMb) || Number.isNaN(freeVramMb)) {
        throw new Error(`Failed to parse numeric VRAM values from nvidia-smi row: "${matchedRow}"`);
      }

      return {
        timestamp: new Date().toISOString(),
        deviceUuid: targetGpuUuid,
        totalVramMb,
        usedVramMb,
        freeVramMb,
        allocatableVramMb: usedVramMb + freeVramMb
      };
    };

    const sampleOnce = async (force = false): Promise<void> => {
      if ((isStopped && !force) || isSampling) return;
      isSampling = true;
      const capturedPhase = currentPhase;
      const timestamp = new Date().toISOString();
      let gpu: MinimaxH3GpuSample | null = null;
      let host: MinimaxH3HostSample | null = null;
      const errors: string[] = [];

      try {
        try {
          gpu = await collectGpuSample();
        } catch (err) {
          errors.push(`GPU sampling error: ${(err as Error).message}`);
        }

        try {
          const hostSnap = await hostAdapter.readHostMemory();
          host = {
            timestamp: hostSnap.measuredAt,
            totalRamMb: hostSnap.hostRamTotalMb,
            availableRamMb: hostSnap.hostRamAvailableMb,
            usedRamMb: hostSnap.hostRamUsedMb,
            processPid: hostSnap.processPid,
            processStartTimeTicks: hostSnap.processStartTimeTicks,
            processRssMb: hostSnap.processRssMb,
            swapTotalMb: hostSnap.swapTotalMb,
            swapUsedMb: hostSnap.swapUsedMb,
            swapInPages: hostSnap.systemSwapInPages,
            swapOutPages: hostSnap.systemSwapOutPages
          };
        } catch (err) {
          errors.push(`Host sampling error: ${(err as Error).message}`);
        }

        const sample: MinimaxH3TelemetrySample = {
          timestamp,
          phase: capturedPhase,
          gpu,
          host,
          error: errors.length > 0 ? errors.join("; ") : null
        };

        if (!stopFinalized) {
          await Promise.resolve(onSample(sample));
        }
      } finally {
        isSampling = false;
        if (pendingRetrigger && !isStopped) {
          // An interval tick arrived while this sample was still in flight
          // and was deferred rather than dropped. Run it now so a slow
          // nvidia-smi/host read doesn't silently erase telemetry coverage
          // for that window.
          pendingRetrigger = false;
          triggerSample().catch(() => {});
        }
      }
    };

    const triggerSample = (force = false): Promise<void> => {
      if (isSampling) {
        pendingRetrigger = true;
        return inFlightSample ?? Promise.resolve();
      }
      inFlightSample = sampleOnce(force);
      return inFlightSample;
    };

    triggerSample().catch(() => {});

    timer = setInterval(() => {
      if (!isStopped) {
        triggerSample().catch(() => {});
      }
    }, intervalMs);

    return {
      setPhase(phase: "before" | "during" | "after") {
        currentPhase = phase;
      },
      async stop(): Promise<void> {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        isStopped = true;
        if (inFlightSample) {
          const timedOut = await Promise.race([
            inFlightSample.then(() => false).catch(() => false),
            new Promise<boolean>((r) => setTimeout(() => r(true), 5000))
          ]);
          if (timedOut) {
            // The in-flight sample is still running past our wait budget.
            // Give up on it now rather than let it deliver onSample
            // whenever it eventually resolves, which could be well after
            // this stop() call has already returned to the caller (who
            // may have finalized/closed the telemetry sink by then).
            stopFinalized = true;
            return;
          }
        }
        currentPhase = "after";
        await Promise.race([
          sampleOnce(true).catch(() => {}),
          new Promise<void>((r) => setTimeout(r, 5000))
        ]);
        stopFinalized = true;
      }
    };
  }
}
