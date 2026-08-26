import type { StorageMetricsRegistryPort } from "@cco/application";
import type {
  StorageMetricsSnapshot,
  StorageTelemetrySnapshot,
  StorageWatermarkState
} from "@cco/contracts";

export const WATERMARK_STATE_NUMERIC_VALUES: Readonly<Record<StorageWatermarkState, number>> =
  Object.freeze({
    normal: 0,
    warning: 1,
    degraded: 2,
    critical: 3
  });

export class InMemoryStorageMetricsRegistry implements StorageMetricsRegistryPort {
  private lastSnapshot?: StorageMetricsSnapshot;

  recordTelemetry(snapshot: StorageTelemetrySnapshot, state: StorageWatermarkState): void {
    const objectStorageBytes: Record<string, number> = {};
    for (const b of snapshot.buckets) {
      objectStorageBytes[b.bucket] = b.usedBytes;
    }
    this.lastSnapshot = {
      objectStorageBytes,
      storageFreeBytes: snapshot.freeBytes,
      storageWatermarkState: state,
      measuredAt: snapshot.measuredAt
    };
  }

  getMetricsSnapshot(): StorageMetricsSnapshot {
    if (!this.lastSnapshot) {
      return {
        objectStorageBytes: {},
        storageFreeBytes: 0,
        storageWatermarkState: "normal",
        measuredAt: new Date(0).toISOString()
      };
    }
    return {
      objectStorageBytes: { ...this.lastSnapshot.objectStorageBytes },
      storageFreeBytes: this.lastSnapshot.storageFreeBytes,
      storageWatermarkState: this.lastSnapshot.storageWatermarkState,
      measuredAt: this.lastSnapshot.measuredAt
    };
  }

  formatPrometheusMetrics(): string {
    const snapshot = this.getMetricsSnapshot();
    const lines: string[] = [];

    // object_storage_bytes{bucket="..."}
    lines.push("# HELP object_storage_bytes Total bytes stored per bucket");
    lines.push("# TYPE object_storage_bytes gauge");
    const buckets = Object.keys(snapshot.objectStorageBytes).sort();
    for (const bucket of buckets) {
      const bytes = snapshot.objectStorageBytes[bucket];
      lines.push(`object_storage_bytes{bucket="${bucket}"} ${bytes}`);
    }

    // storage_free_bytes
    lines.push("# HELP storage_free_bytes Free storage space in bytes on underlying volume");
    lines.push("# TYPE storage_free_bytes gauge");
    lines.push(`storage_free_bytes ${snapshot.storageFreeBytes}`);

    // storage_watermark_state
    lines.push(
      "# HELP storage_watermark_state Current storage watermark state (0=normal, 1=warning, 2=degraded, 3=critical)"
    );
    lines.push("# TYPE storage_watermark_state gauge");
    const stateValue = WATERMARK_STATE_NUMERIC_VALUES[snapshot.storageWatermarkState];
    lines.push(`storage_watermark_state ${stateValue}`);

    return lines.join("\n") + "\n";
  }
}
