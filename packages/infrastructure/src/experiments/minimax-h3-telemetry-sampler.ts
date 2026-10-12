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

        await Promise.resolve(onSample(sample));
      } finally {
        isSampling = false;
      }
    };

    const triggerSample = (force = false): Promise<void> => {
      if (isSampling) {
        return Promise.resolve();
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
          await Promise.race([
            inFlightSample.catch(() => {}),
            new Promise((r) => setTimeout(r, 5000))
          ]);
        }
        currentPhase = "after";
        await Promise.race([
          sampleOnce(true).catch(() => {}),
          new Promise((r) => setTimeout(r, 5000))
        ]);
      }
    };
  }
}
