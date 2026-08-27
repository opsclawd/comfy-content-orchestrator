import { describe, expect, it } from "vitest";
import type { StorageTelemetryPort, StorageMetricsRegistryPort } from "@cco/application";
import { StorageAdmissionUnavailableError } from "@cco/application";
import type {
  StorageMetricsSnapshot,
  StorageTelemetrySnapshot,
  StorageWatermarkState
} from "@cco/contracts";
import { StorageAwareJobAdmissionGate } from "./storage-aware-job-admission-gate.js";

class FakeStorageTelemetryPort implements StorageTelemetryPort {
  constructor(
    private snapshotOrFn:
      | StorageTelemetrySnapshot
      | (() => Promise<StorageTelemetrySnapshot> | StorageTelemetrySnapshot)
  ) {}

  setSnapshot(
    snapshotOrFn:
      | StorageTelemetrySnapshot
      | (() => Promise<StorageTelemetrySnapshot> | StorageTelemetrySnapshot)
  ): void {
    this.snapshotOrFn = snapshotOrFn;
  }

  async getStorageTelemetry(): Promise<StorageTelemetrySnapshot> {
    if (typeof this.snapshotOrFn === "function") {
      return this.snapshotOrFn();
    }
    return this.snapshotOrFn;
  }
}

class FakeStorageMetricsRegistryPort implements StorageMetricsRegistryPort {
  public readonly recorded: Array<{
    snapshot: StorageTelemetrySnapshot;
    state: StorageWatermarkState;
  }> = [];

  recordTelemetry(snapshot: StorageTelemetrySnapshot, state: StorageWatermarkState): void {
    this.recorded.push({ snapshot, state });
  }

  getMetricsSnapshot(): StorageMetricsSnapshot {
    throw new Error("not implemented");
  }

  formatPrometheusMetrics(): string {
    throw new Error("not implemented");
  }
}

function makeSnapshot(usedBytes: number, totalBytes: number): StorageTelemetrySnapshot {
  return {
    usedBytes,
    totalBytes,
    freeBytes: Math.max(0, totalBytes - usedBytes),
    buckets: [],
    measuredAt: new Date().toISOString()
  };
}

describe("StorageAwareJobAdmissionGate", () => {
  it("maps candidate jobs to candidate upload admission", async () => {
    const telemetryPort = new FakeStorageTelemetryPort(makeSnapshot(500, 1000));
    const gate = new StorageAwareJobAdmissionGate({ telemetryPort });

    const result = await gate.canAdmit("candidate");
    expect(result).toBe(true);
  });

  it("maps production jobs to delivery write admission", async () => {
    const telemetryPort = new FakeStorageTelemetryPort(makeSnapshot(860, 1000));
    const gate = new StorageAwareJobAdmissionGate({ telemetryPort });

    const result = await gate.canAdmit("production");
    expect(result).toBe(true);
  });

  it("turns storage policy denial into normal non-admission", async () => {
    const telemetryPort = new FakeStorageTelemetryPort(makeSnapshot(860, 1000));
    const gate = new StorageAwareJobAdmissionGate({ telemetryPort });

    // In degraded state (86%), candidate_upload is denied but delivery_write is permitted
    expect(await gate.canAdmit("candidate")).toBe(false);

    // In critical state (95%), both candidate_upload and delivery_write are denied
    telemetryPort.setSnapshot(makeSnapshot(950, 1000));
    expect(await gate.canAdmit("candidate")).toBe(false);
    expect(await gate.canAdmit("production")).toBe(false);
  });

  it("turns telemetry evaluation failure into typed unavailability", async () => {
    const originalError = new Error("disk failed");
    const telemetryPort = new FakeStorageTelemetryPort(() => {
      throw originalError;
    });
    const gate = new StorageAwareJobAdmissionGate({ telemetryPort });

    await expect(gate.canAdmit("candidate")).rejects.toThrow(StorageAdmissionUnavailableError);

    try {
      await gate.canAdmit("candidate");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageAdmissionUnavailableError);
      expect((error as StorageAdmissionUnavailableError).cause).toBe(originalError);
      expect((error as Error).message).toBe("Storage telemetry is unavailable.");
      expect((error as Error).name).toBe("StorageAdmissionUnavailableError");
    }

    // Direct StorageAdmissionUnavailableError is rethrown as-is
    const directUnavailableError = new StorageAdmissionUnavailableError();
    telemetryPort.setSnapshot(() => {
      throw directUnavailableError;
    });
    try {
      await gate.canAdmit("candidate");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBe(directUnavailableError);
    }
  });

  it("records storage telemetry in metrics registry when provided", async () => {
    const snapshot = makeSnapshot(860, 1000);
    const telemetryPort = new FakeStorageTelemetryPort(snapshot);
    const metricsRegistry = new FakeStorageMetricsRegistryPort();
    const gate = new StorageAwareJobAdmissionGate({ telemetryPort, metricsRegistry });

    await gate.canAdmit("candidate");

    expect(metricsRegistry.recorded).toHaveLength(1);
    expect(metricsRegistry.recorded[0]).toEqual({
      snapshot,
      state: "degraded"
    });
  });
});
