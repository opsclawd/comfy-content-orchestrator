export interface GpuMemorySnapshot {
  readonly totalVramMb: number;
  readonly usedVramMb: number;
  readonly freeVramMb: number;
  readonly measuredAt: string;
}

export interface GpuTelemetryPort {
  readMemory(): Promise<GpuMemorySnapshot>;
}
