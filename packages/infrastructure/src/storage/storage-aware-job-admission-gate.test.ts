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

// Every cell of PRD §2.3's watermark x job-kind admission table. Thresholds are
// WARNING_RATIO 0.7, DEGRADED_RATIO 0.85 and CRITICAL_RATIO 0.92, so each fixture
// sits inside the tier it names rather than on its boundary.
const admissionTable: ReadonlyArray<{
  readonly state: StorageWatermarkState;
  readonly usedBytes: number;
  readonly candidate: boolean;
  readonly production: boolean;
}> = [
  { state: "normal", usedBytes: 500, candidate: true, production: true },
  { state: "warning", usedBytes: 750, candidate: true, production: true },
  { state: "degraded", usedBytes: 860, candidate: false, production: true },
  { state: "critical", usedBytes: 950, candidate: false, production: false }
];

describe("StorageAwareJobAdmissionGate", () => {
  for (const row of admissionTable) {
    it(`admits candidate=${row.candidate} production=${row.production} at ${row.state}`, async () => {
      const telemetryPort = new FakeStorageTelemetryPort(makeSnapshot(row.usedBytes, 1000));
      const gate = new StorageAwareJobAdmissionGate({ telemetryPort });

      expect(await gate.canAdmit("candidate")).toBe(row.candidate);
      expect(await gate.canAdmit("production")).toBe(row.production);
    });
  }

  it("maps each job kind to its own operation class rather than a shared one", async () => {
    // Degraded is the only tier where the two kinds diverge, so it is the tier that
    // proves candidate uses candidate_upload while production uses delivery_write.
    const telemetryPort = new FakeStorageTelemetryPort(makeSnapshot(860, 1000));
    const gate = new StorageAwareJobAdmissionGate({ telemetryPort });

    expect(await gate.canAdmit("candidate")).toBe(false);
    expect(await gate.canAdmit("production")).toBe(true);
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
