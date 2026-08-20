import type {
  StorageMetricsSnapshot,
  StorageTelemetrySnapshot,
  StorageWatermarkState
} from "@cco/contracts";

export interface StorageMetricsRegistryPort {
  recordTelemetry(snapshot: StorageTelemetrySnapshot, state: StorageWatermarkState): void;
  getMetricsSnapshot(): StorageMetricsSnapshot;
  formatPrometheusMetrics(): string;
}
