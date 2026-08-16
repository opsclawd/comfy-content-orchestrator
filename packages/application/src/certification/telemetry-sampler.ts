import type {
  CertificationSamplingError,
  CertificationTelemetryData,
  CertificationTelemetrySample
} from "@cco/contracts";
import type { GpuTelemetryPort, HostTelemetryPort } from "../ports/index.js";

export type TelemetrySamplerState = "idle" | "running" | "stopping" | "stopped";

export class InvalidTelemetrySamplerStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTelemetrySamplerStateError";
  }
}

export interface TelemetrySamplerOptions {
  readonly gpuTelemetryPort: GpuTelemetryPort;
  readonly hostTelemetryPort: HostTelemetryPort;
  readonly intervalMs?: number;
  readonly consecutiveErrorBudget?: number;
  readonly now?: () => Date;
  readonly setTimeoutFn?: typeof globalThis.setTimeout;
  readonly clearTimeoutFn?: typeof globalThis.clearTimeout;
}

function formatErrorMessage(error: unknown, maxLength = 500): string {
  let message: string;
  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else {
    message = String(error);
  }

  if (message.length === 0) {
    message = "Unknown error during telemetry sampling";
  }

  if (message.length > maxLength) {
    return message.slice(0, maxLength);
  }
  return message;
}

export class TelemetrySampler {
  private readonly gpuTelemetryPort: GpuTelemetryPort;
  private readonly hostTelemetryPort: HostTelemetryPort;
  private readonly intervalMs: number;
  private readonly consecutiveErrorBudget: number;
  private readonly nowFn: () => Date;
  private readonly setTimeoutFn: typeof globalThis.setTimeout;
  private readonly clearTimeoutFn: typeof globalThis.clearTimeout;

  private currentState: TelemetrySamplerState = "idle";
  private samples: CertificationTelemetrySample[] = [];
  private samplingErrors: CertificationSamplingError[] = [];
  private consecutiveErrors = 0;
  private isAborted = false;

  private scheduledTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private currentAttemptPromise: Promise<void> | null = null;
  private stoppingPromise: Promise<CertificationTelemetryData> | null = null;

  constructor(options: TelemetrySamplerOptions) {
    this.gpuTelemetryPort = options.gpuTelemetryPort;
    this.hostTelemetryPort = options.hostTelemetryPort;
    this.intervalMs = options.intervalMs ?? 200;
    this.consecutiveErrorBudget = options.consecutiveErrorBudget ?? 10;
    this.nowFn = options.now ?? (() => new Date());
    this.setTimeoutFn = options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
    this.clearTimeoutFn = options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
  }

  public get state(): TelemetrySamplerState {
    return this.currentState;
  }

  public async start(): Promise<void> {
    if (this.currentState !== "idle") {
      throw new InvalidTelemetrySamplerStateError(
        `Cannot start TelemetrySampler when in state '${this.currentState}'. Expected 'idle'.`
      );
    }

    this.currentState = "running";
    await this.executeSample("pre_dispatch");

    if (this.currentState === "running" && !this.isAborted) {
      this.scheduleNextLoop();
    }
  }

  public async sampleNow(
    phase: "pre_dispatch" | "sampling" | "post_unload" = "sampling"
  ): Promise<CertificationTelemetrySample> {
    if (this.currentState !== "running") {
      throw new InvalidTelemetrySamplerStateError(
        `Cannot sampleNow when TelemetrySampler is in state '${this.currentState}'. Expected 'running'.`
      );
    }

    while (this.currentAttemptPromise !== null) {
      await this.currentAttemptPromise;
    }

    if (this.currentState !== "running") {
      throw new InvalidTelemetrySamplerStateError(
        `Cannot sampleNow when TelemetrySampler is in state '${this.currentState}'. Expected 'running'.`
      );
    }

    const previousSampleCount = this.samples.length;
    await this.executeSample(phase);

    if (this.samples.length > previousSampleCount) {
      return this.samples[this.samples.length - 1]!;
    }

    throw new Error(
      `Explicit sample (${phase}) failed: ${
        this.samplingErrors[this.samplingErrors.length - 1]?.message ?? "Unknown error"
      }`
    );
  }

  public async stop(): Promise<CertificationTelemetryData> {
    if (this.currentState === "stopped") {
      return this.getTelemetryData();
    }

    if (this.currentState === "stopping" && this.stoppingPromise !== null) {
      return await this.stoppingPromise;
    }

    if (this.currentState === "idle") {
      this.currentState = "stopped";
      return this.getTelemetryData();
    }

    this.currentState = "stopping";
    if (this.scheduledTimer !== null) {
      this.clearTimeoutFn(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    this.stoppingPromise = (async () => {
      while (this.currentAttemptPromise !== null) {
        await this.currentAttemptPromise;
      }
      this.currentState = "stopped";
      return this.getTelemetryData();
    })();

    return await this.stoppingPromise;
  }

  public getTelemetryData(): CertificationTelemetryData {
    return this.computeTelemetryData();
  }

  private scheduleNextLoop(): void {
    if (this.currentState !== "running" || this.isAborted) {
      return;
    }

    this.scheduledTimer = this.setTimeoutFn(async () => {
      this.scheduledTimer = null;
      if (this.currentState !== "running" || this.isAborted) {
        return;
      }

      await this.executeSample("sampling");

      if (this.currentState === "running" && !this.isAborted) {
        this.scheduleNextLoop();
      }
    }, this.intervalMs);
  }

  private async executeSample(phase: "pre_dispatch" | "sampling" | "post_unload"): Promise<void> {
    const attempt = (async () => {
      try {
        const [gpuResult, hostResult] = await Promise.allSettled([
          this.gpuTelemetryPort.readMemory(),
          this.hostTelemetryPort.readHostMemory()
        ]);

        const measuredAt = this.nowFn().toISOString();

        if (gpuResult.status === "fulfilled" && hostResult.status === "fulfilled") {
          const sample: CertificationTelemetrySample = {
            measuredAt,
            phase,
            gpu: {
              totalVramMb: Math.round(gpuResult.value.totalVramMb),
              usedVramMb: Math.round(gpuResult.value.usedVramMb),
              freeVramMb: Math.round(gpuResult.value.freeVramMb)
            },
            host: {
              hostRamTotalMb: Math.round(hostResult.value.hostRamTotalMb),
              hostRamAvailableMb: Math.round(hostResult.value.hostRamAvailableMb),
              hostRamUsedMb: Math.round(hostResult.value.hostRamUsedMb),
              swapTotalMb: Math.round(hostResult.value.swapTotalMb),
              swapUsedMb: Math.round(hostResult.value.swapUsedMb),
              systemSwapInPages: Math.round(hostResult.value.systemSwapInPages),
              systemSwapOutPages: Math.round(hostResult.value.systemSwapOutPages),
              systemMajorPageFaults: Math.round(hostResult.value.systemMajorPageFaults),
              systemMinorPageFaults: Math.round(hostResult.value.systemMinorPageFaults),
              processPid: hostResult.value.processPid,
              processStartTimeTicks: Math.round(hostResult.value.processStartTimeTicks),
              processRssMb: Math.round(hostResult.value.processRssMb),
              processMajorPageFaults: Math.round(hostResult.value.processMajorPageFaults),
              processMinorPageFaults: Math.round(hostResult.value.processMinorPageFaults)
            }
          };

          this.samples.push(sample);
          this.consecutiveErrors = 0;
        } else {
          const errorMessage = this.formatSettledErrors(gpuResult, hostResult);
          this.samplingErrors.push({
            measuredAt,
            message: errorMessage
          });

          this.consecutiveErrors++;
          if (this.consecutiveErrors >= this.consecutiveErrorBudget) {
            this.isAborted = true;
            this.samplingErrors.push({
              measuredAt: this.nowFn().toISOString(),
              message: `Sampling aborted: consecutive error budget of ${this.consecutiveErrorBudget} exceeded`
            });
          }
        }
      } catch (err) {
        const measuredAt = this.nowFn().toISOString();
        this.samplingErrors.push({
          measuredAt,
          message: formatErrorMessage(err)
        });

        this.consecutiveErrors++;
        if (this.consecutiveErrors >= this.consecutiveErrorBudget) {
          this.isAborted = true;
          this.samplingErrors.push({
            measuredAt: this.nowFn().toISOString(),
            message: `Sampling aborted: consecutive error budget of ${this.consecutiveErrorBudget} exceeded`
          });
        }
      } finally {
        this.currentAttemptPromise = null;
      }
    })();

    this.currentAttemptPromise = attempt;
    await attempt;
  }

  private formatSettledErrors(
    gpuResult: PromiseSettledResult<unknown>,
    hostResult: PromiseSettledResult<unknown>
  ): string {
    const parts: string[] = [];
    if (gpuResult.status === "rejected") {
      parts.push(`GPU read failed: ${formatErrorMessage(gpuResult.reason)}`);
    }
    if (hostResult.status === "rejected") {
      parts.push(`Host read failed: ${formatErrorMessage(hostResult.reason)}`);
    }
    return parts.join("; ");
  }

  private computeTelemetryData(): CertificationTelemetryData {
    if (this.samples.length === 0) {
      return {
        sampleIntervalMs: 200,
        samples: this.samples.map((s) => ({
          ...s,
          gpu: { ...s.gpu },
          host: { ...s.host }
        })),
        samplingErrors: this.samplingErrors.map((e) => ({ ...e })),
        peakVramMb: null,
        peakHostRamUsedMb: null,
        peakProcessRssMb: null,
        swapUsedDeltaMb: null,
        systemSwapInPageDelta: null,
        systemSwapOutPageDelta: null,
        systemMajorPageFaultDelta: null,
        systemMinorPageFaultDelta: null,
        processMajorPageFaultDelta: null,
        processMinorPageFaultDelta: null,
        postUnloadUsedVramMb: null,
        postUnloadFreeVramMb: null
      };
    }

    const peakVramMb = Math.max(...this.samples.map((s) => s.gpu.usedVramMb));
    const peakHostRamUsedMb = Math.max(...this.samples.map((s) => s.host.hostRamUsedMb));
    const peakProcessRssMb = Math.max(...this.samples.map((s) => s.host.processRssMb));

    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;

    const swapUsedDeltaMb = Math.max(0, last.host.swapUsedMb - first.host.swapUsedMb);
    const systemSwapInPageDelta = Math.max(
      0,
      last.host.systemSwapInPages - first.host.systemSwapInPages
    );
    const systemSwapOutPageDelta = Math.max(
      0,
      last.host.systemSwapOutPages - first.host.systemSwapOutPages
    );
    const systemMajorPageFaultDelta = Math.max(
      0,
      last.host.systemMajorPageFaults - first.host.systemMajorPageFaults
    );
    const systemMinorPageFaultDelta = Math.max(
      0,
      last.host.systemMinorPageFaults - first.host.systemMinorPageFaults
    );
    const processMajorPageFaultDelta = Math.max(
      0,
      last.host.processMajorPageFaults - first.host.processMajorPageFaults
    );
    const processMinorPageFaultDelta = Math.max(
      0,
      last.host.processMinorPageFaults - first.host.processMinorPageFaults
    );

    const postUnloadSample = [...this.samples].reverse().find((s) => s.phase === "post_unload");
    const postUnloadUsedVramMb = postUnloadSample ? postUnloadSample.gpu.usedVramMb : null;
    const postUnloadFreeVramMb = postUnloadSample ? postUnloadSample.gpu.freeVramMb : null;

    return {
      sampleIntervalMs: 200,
      samples: this.samples.map((s) => ({
        ...s,
        gpu: { ...s.gpu },
        host: { ...s.host }
      })),
      samplingErrors: this.samplingErrors.map((e) => ({ ...e })),
      peakVramMb,
      peakHostRamUsedMb,
      peakProcessRssMb,
      swapUsedDeltaMb,
      systemSwapInPageDelta,
      systemSwapOutPageDelta,
      systemMajorPageFaultDelta,
      systemMinorPageFaultDelta,
      processMajorPageFaultDelta,
      processMinorPageFaultDelta,
      postUnloadUsedVramMb,
      postUnloadFreeVramMb
    };
  }
}
