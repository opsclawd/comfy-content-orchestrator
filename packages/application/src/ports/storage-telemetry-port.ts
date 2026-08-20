import type { StorageTelemetrySnapshot } from "@cco/contracts";

export interface StorageTelemetryPort {
  getStorageTelemetry(): Promise<StorageTelemetrySnapshot>;
}
