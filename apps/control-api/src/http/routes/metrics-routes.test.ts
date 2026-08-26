import { describe, expect, it, vi } from "vitest";
import type { UnitOfWork, UnitOfWorkContext } from "@cco/application";
import {
  HostFsStorageTelemetryAdapter,
  InMemoryStorageMetricsRegistry,
  type StatFsFn
} from "@cco/infrastructure";
import { createControlApiApp } from "../app.js";

class FakeUnitOfWork implements UnitOfWork {
  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({
      scenes: { findById: async () => undefined, save: async () => {} },
      reviewEvents: { findById: async () => undefined, append: async () => {} },
      candidates: {
        findById: async () => undefined,
        insert: async () => {},
        listBySceneAndRevision: async () => []
      }
    });
  }
}

describe("Metrics Routes", () => {
  it("samples and records fresh storage telemetry for every metrics request", async () => {
    let statfsCallCount = 0;
    let usedBlocks = 69;

    const statfsFn: StatFsFn = async () => {
      statfsCallCount++;
      return {
        bsize: 1,
        blocks: 100,
        bfree: 100 - usedBlocks,
        bavail: 100 - usedBlocks
      };
    };

    const telemetry = new HostFsStorageTelemetryAdapter({
      statfsFn,
      bucketUsageProvider: async () => []
    });
    const registry = new InMemoryStorageMetricsRegistry();

    const recordSpy = vi.spyOn(registry, "recordTelemetry");
    const formatSpy = vi.spyOn(registry, "formatPrometheusMetrics");

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      storageTelemetry: telemetry,
      storageMetricsRegistry: registry
    });

    // First scrape: 69% used -> normal (0)
    const response1 = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    expect(response1.statusCode).toBe(200);
    expect(statfsCallCount).toBe(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(formatSpy).toHaveBeenCalledTimes(1);
    expect(response1.body).toContain("storage_watermark_state 0");
    expect(response1.body).toContain("storage_free_bytes 31");

    // Second scrape: 85% used -> degraded (2)
    usedBlocks = 85;
    const response2 = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    expect(response2.statusCode).toBe(200);
    expect(statfsCallCount).toBe(2);
    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(formatSpy).toHaveBeenCalledTimes(2);
    expect(response2.body).toContain("storage_watermark_state 2");
    expect(response2.body).toContain("storage_free_bytes 15");

    await app.close();
  });

  it("maps exact storage thresholds to warning degraded and critical metrics", async () => {
    const cases = [
      { blocks: 100, bfree: 31, bavail: 31, expectedState: 0, description: "69% (normal)" },
      { blocks: 100, bfree: 30, bavail: 30, expectedState: 1, description: "70% (warning)" },
      { blocks: 100, bfree: 15, bavail: 15, expectedState: 2, description: "85% (degraded)" },
      { blocks: 100, bfree: 8, bavail: 8, expectedState: 3, description: "92% (critical)" }
    ];

    for (const testCase of cases) {
      const statfsFn: StatFsFn = async () => ({
        bsize: 1,
        blocks: testCase.blocks,
        bfree: testCase.bfree,
        bavail: testCase.bavail
      });

      const telemetry = new HostFsStorageTelemetryAdapter({
        statfsFn,
        bucketUsageProvider: async () => []
      });
      const registry = new InMemoryStorageMetricsRegistry();

      const app = createControlApiApp({
        uow: new FakeUnitOfWork(),
        storageTelemetry: telemetry,
        storageMetricsRegistry: registry
      });

      const response = await app.inject({
        method: "GET",
        url: "/metrics"
      });

      expect(response.statusCode, `Failed on ${testCase.description}`).toBe(200);
      expect(response.body, `State check failed on ${testCase.description}`).toContain(
        `storage_watermark_state ${testCase.expectedState}`
      );
      expect(response.body, `Free bytes check failed on ${testCase.description}`).toContain(
        `storage_free_bytes ${testCase.bavail}`
      );

      await app.close();
    }
  });

  it("returns canonical Prometheus text for a successful scrape", async () => {
    const statfsFn: StatFsFn = async () => ({
      bsize: 1024,
      blocks: 1000,
      bfree: 400,
      bavail: 400
    });

    const telemetry = new HostFsStorageTelemetryAdapter({
      statfsFn,
      bucketUsageProvider: async () => []
    });
    const registry = new InMemoryStorageMetricsRegistry();

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      storageTelemetry: telemetry,
      storageMetricsRegistry: registry
    });

    const response = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/plain; version=0.0.4; charset=utf-8");
    expect(response.body.endsWith("\n")).toBe(true);
    expect(response.body).toContain("storage_free_bytes 409600");
    expect(response.body).toContain("storage_watermark_state 0");
    expect(response.body).not.toContain("godzspeed_");

    await app.close();
  });

  it("returns 503 without formatting stale metrics when telemetry sampling fails", async () => {
    let shouldFail = false;

    const statfsFn: StatFsFn = async () => {
      if (shouldFail) {
        throw new Error("EIO: disk hardware i/o failure at /var/data");
      }
      return {
        bsize: 1,
        blocks: 100,
        bfree: 50,
        bavail: 50
      };
    };

    const telemetry = new HostFsStorageTelemetryAdapter({
      statfsFn,
      bucketUsageProvider: async () => []
    });
    const registry = new InMemoryStorageMetricsRegistry();

    const app = createControlApiApp({
      uow: new FakeUnitOfWork(),
      storageTelemetry: telemetry,
      storageMetricsRegistry: registry
    });

    let logErrorSpy: ReturnType<typeof vi.spyOn> | undefined;
    app.addHook("onRequest", async (req) => {
      logErrorSpy = vi.spyOn(req.log, "error");
    });

    // Prime registry with an initial successful scrape
    const successResponse = await app.inject({
      method: "GET",
      url: "/metrics"
    });
    expect(successResponse.statusCode).toBe(200);

    // Spy on formatPrometheusMetrics before failure
    const formatSpy = vi.spyOn(registry, "formatPrometheusMetrics");

    // Now induce failure
    shouldFail = true;
    const failureResponse = await app.inject({
      method: "GET",
      url: "/metrics"
    });

    expect(failureResponse.statusCode).toBe(503);
    expect(formatSpy).not.toHaveBeenCalled();
    expect(logErrorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("EIO") }),
      "Failed to collect storage telemetry"
    );

    const body = failureResponse.json();
    expect(body).toEqual({
      code: "STORAGE_TELEMETRY_UNAVAILABLE",
      message: "Storage telemetry is unavailable."
    });
    expect(failureResponse.body).not.toContain("EIO");
    expect(failureResponse.body).not.toContain("/var/data");

    await app.close();
  });

  it("leaves metrics unregistered when either dependency is absent", async () => {
    const dummyTelemetry = new HostFsStorageTelemetryAdapter({
      bucketUsageProvider: async () => []
    });
    const dummyRegistry = new InMemoryStorageMetricsRegistry();

    // 1. Neither provided
    const appNeither = createControlApiApp({
      uow: new FakeUnitOfWork()
    });
    const resNeither = await appNeither.inject({
      method: "GET",
      url: "/metrics"
    });
    expect(resNeither.statusCode).toBe(404);
    expect(resNeither.json()).toEqual({
      code: "NOT_FOUND",
      message: "Route GET /metrics not found."
    });
    await appNeither.close();

    // 2. Only telemetry provided
    const appOnlyTelemetry = createControlApiApp({
      uow: new FakeUnitOfWork(),
      storageTelemetry: dummyTelemetry
    });
    const resOnlyTelemetry = await appOnlyTelemetry.inject({
      method: "GET",
      url: "/metrics"
    });
    expect(resOnlyTelemetry.statusCode).toBe(404);
    expect(resOnlyTelemetry.json()).toEqual({
      code: "NOT_FOUND",
      message: "Route GET /metrics not found."
    });
    await appOnlyTelemetry.close();

    // 3. Only registry provided
    const appOnlyRegistry = createControlApiApp({
      uow: new FakeUnitOfWork(),
      storageMetricsRegistry: dummyRegistry
    });
    const resOnlyRegistry = await appOnlyRegistry.inject({
      method: "GET",
      url: "/metrics"
    });
    expect(resOnlyRegistry.statusCode).toBe(404);
    expect(resOnlyRegistry.json()).toEqual({
      code: "NOT_FOUND",
      message: "Route GET /metrics not found."
    });
    await appOnlyRegistry.close();
  });
});
