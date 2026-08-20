import { describe, expect, it } from "vitest";
import {
  BucketStorageTelemetrySchema,
  StorageMetricsSnapshotSchema,
  StorageOperationClassSchema,
  StorageTelemetrySnapshotSchema,
  StorageWatermarkStateSchema
} from "./storage-watermark.js";

describe("storage-watermark contracts", () => {
  it("validates valid watermark states and operations", () => {
    expect(StorageWatermarkStateSchema.parse("normal")).toBe("normal");
    expect(StorageWatermarkStateSchema.parse("warning")).toBe("warning");
    expect(StorageWatermarkStateSchema.parse("degraded")).toBe("degraded");
    expect(StorageWatermarkStateSchema.parse("critical")).toBe("critical");
    expect(() => StorageWatermarkStateSchema.parse("unknown")).toThrow();

    expect(StorageOperationClassSchema.parse("candidate_upload")).toBe("candidate_upload");
    expect(StorageOperationClassSchema.parse("proxy_upload")).toBe("proxy_upload");
    expect(StorageOperationClassSchema.parse("delivery_write")).toBe("delivery_write");
    expect(StorageOperationClassSchema.parse("cleanup")).toBe("cleanup");
    expect(StorageOperationClassSchema.parse("repair")).toBe("repair");
    expect(() => StorageOperationClassSchema.parse("arbitrary_op")).toThrow();
  });

  it("validates telemetry snapshots and metrics schema", () => {
    const bucketTelemetry = BucketStorageTelemetrySchema.parse({
      bucket: "godzspeed-temp",
      usedBytes: 200,
      objectCount: 5
    });
    expect(bucketTelemetry.bucket).toBe("godzspeed-temp");

    const telemetry = StorageTelemetrySnapshotSchema.parse({
      totalBytes: 1000,
      usedBytes: 700,
      freeBytes: 300,
      buckets: [{ bucket: "godzspeed-temp", usedBytes: 200, objectCount: 5 }],
      measuredAt: "2026-08-19T00:00:00.000Z"
    });
    expect(telemetry.buckets[0]?.bucket).toBe("godzspeed-temp");

    const metrics = StorageMetricsSnapshotSchema.parse({
      objectStorageBytes: { "godzspeed-temp": 200 },
      storageFreeBytes: 300,
      storageWatermarkState: "warning",
      measuredAt: "2026-08-19T00:00:00.000Z"
    });
    expect(metrics.storageWatermarkState).toBe("warning");
  });
});
