import { describe, expect, it } from "vitest";
import {
  HostFsStorageTelemetryAdapter,
  HostFsStorageTelemetryError
} from "./storage-telemetry-adapter.js";

describe("HostFsStorageTelemetryAdapter", () => {
  it("calculates total, used, and free bytes from filesystem stats", async () => {
    const mockStatfs = async (_path: string) => ({
      bsize: 4096,
      blocks: 250_000_000, // 1 TB
      bfree: 50_000_000, // 200 GB
      bavail: 40_000_000 // 160 GB available to non-root
    });

    const mockBucketUsage = async () => [
      { bucket: "godzspeed-temp" as const, usedBytes: 100_000_000, objectCount: 10 },
      { bucket: "godzspeed-review" as const, usedBytes: 200_000_000, objectCount: 20 }
    ];

    const adapter = new HostFsStorageTelemetryAdapter({
      storagePath: "/data",
      statfsFn: mockStatfs,
      bucketUsageProvider: mockBucketUsage,
      clock: () => "2026-08-19T12:00:00.000Z"
    });

    const telemetry = await adapter.getStorageTelemetry();

    expect(telemetry.totalBytes).toBe(250_000_000 * 4096); // 1,024,000,000,000
    expect(telemetry.usedBytes).toBe((250_000_000 - 50_000_000) * 4096);
    expect(telemetry.freeBytes).toBe(40_000_000 * 4096);
    expect(telemetry.buckets).toEqual([
      { bucket: "godzspeed-temp", usedBytes: 100_000_000, objectCount: 10 },
      { bucket: "godzspeed-review", usedBytes: 200_000_000, objectCount: 20 }
    ]);
    expect(telemetry.measuredAt).toBe("2026-08-19T12:00:00.000Z");
  });

  it("handles statfs failures by throwing HostFsStorageTelemetryError", async () => {
    const failingStatfs = async () => {
      throw new Error("ENOENT: no such file or directory");
    };

    const adapter = new HostFsStorageTelemetryAdapter({
      statfsFn: failingStatfs
    });

    await expect(adapter.getStorageTelemetry()).rejects.toThrow(HostFsStorageTelemetryError);
    await expect(adapter.getStorageTelemetry()).rejects.toThrow(
      "Failed to read storage filesystem stats for /: ENOENT: no such file or directory"
    );
  });

  it("handles bucketUsageProvider failures by throwing HostFsStorageTelemetryError", async () => {
    const mockStatfs = async () => ({
      bsize: 4096,
      blocks: 1000,
      bfree: 500,
      bavail: 500
    });

    const failingBucketUsage = async () => {
      throw new Error("S3 connection refused");
    };

    const adapter = new HostFsStorageTelemetryAdapter({
      statfsFn: mockStatfs,
      bucketUsageProvider: failingBucketUsage
    });

    await expect(adapter.getStorageTelemetry()).rejects.toThrow(HostFsStorageTelemetryError);
    await expect(adapter.getStorageTelemetry()).rejects.toThrow(
      "Failed to read bucket usage: S3 connection refused"
    );
  });

  it("populates default bucket list when bucketUsageProvider is not provided", async () => {
    const mockStatfs = async () => ({
      bsize: 1024,
      blocks: 1000,
      bfree: 500,
      bavail: 500
    });

    const adapter = new HostFsStorageTelemetryAdapter({
      statfsFn: mockStatfs
    });

    const telemetry = await adapter.getStorageTelemetry();
    expect(telemetry.buckets.map((b) => b.bucket)).toEqual([
      "godzspeed-temp",
      "godzspeed-review",
      "godzspeed-reference",
      "godzspeed-delivery"
    ]);
    expect(telemetry.buckets.every((b) => b.usedBytes === 0)).toBe(true);
  });
});
