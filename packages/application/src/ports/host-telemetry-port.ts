export interface HostTelemetrySnapshot {
  readonly hostRamTotalMb: number;
  readonly hostRamAvailableMb: number;
  readonly hostRamUsedMb: number;
  readonly swapTotalMb: number;
  readonly swapUsedMb: number;
  readonly systemSwapInPages: number;
  readonly systemSwapOutPages: number;
  readonly systemMajorPageFaults: number;
  readonly systemMinorPageFaults: number;
  readonly processPid: number;
  readonly processStartTimeTicks: number;
  readonly processRssMb: number;
  readonly processMajorPageFaults: number;
  readonly processMinorPageFaults: number;
  readonly measuredAt: string;
}

export interface HostTelemetryPort {
  readHostMemory(): Promise<HostTelemetrySnapshot>;
}
