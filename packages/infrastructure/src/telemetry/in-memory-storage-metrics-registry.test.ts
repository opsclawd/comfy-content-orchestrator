import { describe, expect, it } from "vitest";
import {
  InMemoryStorageMetricsRegistry,
  WATERMARK_STATE_NUMERIC_VALUES
} from "./in-memory-storage-metrics-registry.js";
import type { StorageTelemetrySnapshot } from "@cco/contracts";

describe("InMemoryStorageMetricsRegistry", () => {
  it("initializes with default metrics", () => {
    const registry = new InMemoryStorageMetricsRegistry();
    const metrics = registry.getMetricsSnapshot();
    expect(metrics.storageWatermarkState).toBe("normal");
    expect(metrics.storageFreeBytes).toBe(0);
    expect(metrics.objectStorageBytes).toEqual({});
  });

  it("records telemetry snapshot and watermark state", () => {
    const registry = new InMemoryStorageMetricsRegistry();
    const snapshot: StorageTelemetrySnapshot = {
      totalBytes: 1_000_000_000,
      usedBytes: 850_000_000,
      freeBytes: 150_000_000,
      buckets: [
        { bucket: "godzspeed-temp", usedBytes: 400_000_000, objectCount: 12 },
        { bucket: "godzspeed-review", usedBytes: 450_000_000, objectCount: 20 }
      ],
      measuredAt: "2026-08-19T12:00:00.000Z"
    };

    registry.recordTelemetry(snapshot, "degraded");
    const metrics = registry.getMetricsSnapshot();

    expect(metrics.storageWatermarkState).toBe("degraded");
    expect(metrics.storageFreeBytes).toBe(150_000_000);
    expect(metrics.objectStorageBytes).toEqual({
      "godzspeed-temp": 400_000_000,
      "godzspeed-review": 450_000_000
    });
    expect(metrics.measuredAt).toBe("2026-08-19T12:00:00.000Z");
  });

  it("formats neutral Prometheus metric names without a branded prefix", () => {
    const registry = new InMemoryStorageMetricsRegistry();
    const snapshot: StorageTelemetrySnapshot = {
      totalBytes: 1_000_000_000,
      usedBytes: 700_000_000,
      freeBytes: 300_000_000,
      buckets: [
        { bucket: "godzspeed-temp", usedBytes: 100_000_000 },
        { bucket: "godzspeed-review", usedBytes: 600_000_000 }
      ],
      measuredAt: "2026-08-19T12:00:00.000Z"
    };

    registry.recordTelemetry(snapshot, "warning");
    const output = registry.formatPrometheusMetrics();

    expect(output).toContain('object_storage_bytes{bucket="godzspeed-review"} 600000000');
    expect(output).toContain('object_storage_bytes{bucket="godzspeed-temp"} 100000000');
    expect(output).toContain("storage_free_bytes 300000000");
    expect(output).toContain(`storage_watermark_state ${WATERMARK_STATE_NUMERIC_VALUES.warning}`);
    expect(output.indexOf('bucket="godzspeed-review"')).toBeLessThan(
      output.indexOf('bucket="godzspeed-temp"')
    );
    expect(output.endsWith("\n")).toBe(true);
    expect(output).not.toContain("godzspeed_");
  });
});
