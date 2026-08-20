import { describe, expect, it } from "vitest";
import { EnforceStorageAdmission } from "./enforce-storage-admission.js";
import { StorageAdmissionError } from "./storage-admission-error.js";
import type { StorageMetricsRegistryPort } from "../ports/storage-metrics-registry-port.js";
import type { StorageTelemetryPort } from "../ports/storage-telemetry-port.js";
import type {
  StorageMetricsSnapshot,
  StorageTelemetrySnapshot,
  StorageWatermarkState
} from "@cco/contracts";

describe("EnforceStorageAdmission Use Case", () => {
  const TOTAL = 1_000_000_000; // 1 GB

  function createMockTelemetryPort(usedBytes: number): StorageTelemetryPort {
    return {
      async getStorageTelemetry(): Promise<StorageTelemetrySnapshot> {
        return {
          totalBytes: TOTAL,
          usedBytes,
          freeBytes: TOTAL - usedBytes,
          buckets: [{ bucket: "godzspeed-temp", usedBytes }],
          measuredAt: "2026-08-19T12:00:00.000Z"
        };
      }
    };
  }

  function createMockMetricsRegistry(): StorageMetricsRegistryPort {
    let lastSnapshot: StorageMetricsSnapshot | undefined;
    return {
      recordTelemetry(snapshot: StorageTelemetrySnapshot, state: StorageWatermarkState): void {
        lastSnapshot = {
          objectStorageBytes: { [snapshot.buckets[0]!.bucket]: snapshot.buckets[0]!.usedBytes },
          storageFreeBytes: snapshot.freeBytes,
          storageWatermarkState: state,
          measuredAt: snapshot.measuredAt
        };
      },
      getMetricsSnapshot(): StorageMetricsSnapshot {
        return (
          lastSnapshot ?? {
            objectStorageBytes: {},
            storageFreeBytes: 0,
            storageWatermarkState: "normal",
            measuredAt: "1970-01-01T00:00:00.000Z"
          }
        );
      },
      formatPrometheusMetrics(): string {
        return "";
      }
    };
  }

  it("permits all operations when usage is normal (<70%) and records metrics", async () => {
    const telemetryPort = createMockTelemetryPort(500_000_000); // 50%
    const metricsRegistry = createMockMetricsRegistry();
    const useCase = new EnforceStorageAdmission({ telemetryPort, metricsRegistry });

    const policy = await useCase.execute("candidate_upload");
    expect(policy.state).toBe("normal");
    expect(metricsRegistry.getMetricsSnapshot().storageWatermarkState).toBe("normal");

    await expect(useCase.execute("proxy_upload")).resolves.toBeDefined();
    await expect(useCase.execute("delivery_write")).resolves.toBeDefined();
    await expect(useCase.execute("cleanup")).resolves.toBeDefined();
    await expect(useCase.execute("repair")).resolves.toBeDefined();
  });

  it("permits all normal work when usage is warning (70%) and updates metrics", async () => {
    const telemetryPort = createMockTelemetryPort(700_000_000); // 70%
    const metricsRegistry = createMockMetricsRegistry();
    const useCase = new EnforceStorageAdmission({ telemetryPort, metricsRegistry });

    // Warning does NOT block candidate/proxy uploads
    const policy = await useCase.execute("candidate_upload");
    expect(policy.state).toBe("warning");
    expect(metricsRegistry.getMetricsSnapshot().storageWatermarkState).toBe("warning");

    await expect(useCase.execute("proxy_upload")).resolves.toBeDefined();
    await expect(useCase.execute("delivery_write")).resolves.toBeDefined();
    await expect(useCase.execute("cleanup")).resolves.toBeDefined();
    await expect(useCase.execute("repair")).resolves.toBeDefined();
  });

  it("blocks nonessential candidate/proxy uploads in degraded state (85%) but permits delivery and cleanup", async () => {
    const telemetryPort = createMockTelemetryPort(850_000_000); // 85%
    const metricsRegistry = createMockMetricsRegistry();
    const useCase = new EnforceStorageAdmission({ telemetryPort, metricsRegistry });

    await expect(useCase.execute("candidate_upload")).rejects.toThrow(StorageAdmissionError);
    await expect(useCase.execute("proxy_upload")).rejects.toThrow(StorageAdmissionError);

    // Permitted
    await expect(useCase.execute("delivery_write")).resolves.toBeDefined();
    await expect(useCase.execute("cleanup")).resolves.toBeDefined();
    await expect(useCase.execute("repair")).resolves.toBeDefined();

    expect(metricsRegistry.getMetricsSnapshot().storageWatermarkState).toBe("degraded");
  });

  it("blocks media writes in critical state (92%) but permits cleanup and repair", async () => {
    const telemetryPort = createMockTelemetryPort(920_000_000); // 92%
    const metricsRegistry = createMockMetricsRegistry();
    const useCase = new EnforceStorageAdmission({ telemetryPort, metricsRegistry });

    await expect(useCase.execute("candidate_upload")).rejects.toThrow(StorageAdmissionError);
    await expect(useCase.execute("proxy_upload")).rejects.toThrow(StorageAdmissionError);
    await expect(useCase.execute("delivery_write")).rejects.toThrow(StorageAdmissionError);

    // Permitted
    await expect(useCase.execute("cleanup")).resolves.toBeDefined();
    await expect(useCase.execute("repair")).resolves.toBeDefined();

    expect(metricsRegistry.getMetricsSnapshot().storageWatermarkState).toBe("critical");
  });

  it("includes descriptive context in StorageAdmissionError", async () => {
    const telemetryPort = createMockTelemetryPort(950_000_000); // 95%
    const useCase = new EnforceStorageAdmission({ telemetryPort });

    try {
      await useCase.execute("candidate_upload");
      expect.unreachable("should have thrown StorageAdmissionError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(StorageAdmissionError);
      const error = err as StorageAdmissionError;
      expect(error.operationClass).toBe("candidate_upload");
      expect(error.watermarkState).toBe("critical");
      expect(error.usedRatio).toBe(0.95);
      expect(error.totalBytes).toBe(TOTAL);
      expect(error.freeBytes).toBe(50_000_000);
      expect(error.message).toContain('Storage admission denied for operation "candidate_upload"');
    }
  });
});
