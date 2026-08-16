import { describe, expect, it, vi } from "vitest";
import {
  NvidiaSmiTelemetryAdapter,
  NvidiaSmiTelemetryError,
  parseNvidiaSmiMemoryCsv,
  type NvidiaSmiExecFileFn
} from "./nvidia-smi-telemetry-adapter.js";

describe("NvidiaSmiTelemetryAdapter", () => {
  // Behavioral invariant: selected-gpu-only
  it("reads the configured GPU index as one GpuMemorySnapshot", async () => {
    const stdoutMultiGpu = ["24576, 2048, 22528", "24576, 8192, 16384", "24576, 1024, 23552"].join(
      "\n"
    );

    const mockExecFile: NvidiaSmiExecFileFn = vi.fn().mockResolvedValue({
      stdout: stdoutMultiGpu,
      stderr: ""
    });
    const fakeNow = "2026-08-15T20:00:00.000Z";

    // Read GPU index 1
    const adapterGpu1 = new NvidiaSmiTelemetryAdapter({
      gpuIndex: 1,
      execFile: mockExecFile,
      now: () => fakeNow
    });

    const snapshot1 = await adapterGpu1.readMemory();
    expect(snapshot1).toEqual({
      totalVramMb: 24576,
      usedVramMb: 8192,
      freeVramMb: 16384,
      reservedVramMb: 0,
      measuredAt: fakeNow
    });

    // Read GPU index 0 (default)
    const adapterGpu0 = new NvidiaSmiTelemetryAdapter({
      execFile: mockExecFile,
      now: () => fakeNow
    });

    const snapshot0 = await adapterGpu0.readMemory();
    expect(snapshot0).toEqual({
      totalVramMb: 24576,
      usedVramMb: 2048,
      freeVramMb: 22528,
      reservedVramMb: 0,
      measuredAt: fakeNow
    });
  });

  // Behavioral invariant: strict-csv
  it("rejects malformed nvidia-smi memory output", () => {
    expect(() => parseNvidiaSmiMemoryCsv("", 0)).toThrow(NvidiaSmiTelemetryError);
    expect(() => parseNvidiaSmiMemoryCsv("   \n  \n", 0)).toThrow(NvidiaSmiTelemetryError);

    expect(() => parseNvidiaSmiMemoryCsv("24576, 8192\n", 0)).toThrow(NvidiaSmiTelemetryError);
    expect(() => parseNvidiaSmiMemoryCsv("24576, 8192, 16384, 999\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );
    expect(() => parseNvidiaSmiMemoryCsv("24576, , 16384\n", 0)).toThrow(NvidiaSmiTelemetryError);

    expect(() => parseNvidiaSmiMemoryCsv("24576, NaN, 16384\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );
    expect(() => parseNvidiaSmiMemoryCsv("24576, N/A, 16384\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );
    expect(() => parseNvidiaSmiMemoryCsv("total, used, free\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );
    expect(() => parseNvidiaSmiMemoryCsv("24576, Infinity, 0\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );

    expect(() => parseNvidiaSmiMemoryCsv("24576, -100, 24676\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );
    expect(() => parseNvidiaSmiMemoryCsv("-24576, 8192, 16384\n", 0)).toThrow(
      NvidiaSmiTelemetryError
    );
  });

  // Behavioral invariant: reserved-vram-reading-is-valid
  it("accepts real NVIDIA memory values when driver-reserved VRAM leaves used plus free below total", () => {
    const reservedVramReading = parseNvidiaSmiMemoryCsv("24564, 600, 23451\n", 0);
    expect(reservedVramReading).toEqual({
      totalVramMb: 24564,
      usedVramMb: 600,
      freeVramMb: 23451,
      reservedVramMb: 513
    });

    const exactReading = parseNvidiaSmiMemoryCsv("24576, 8192, 16384\n", 0);
    expect(exactReading).toEqual({
      totalVramMb: 24576,
      usedVramMb: 8192,
      freeVramMb: 16384,
      reservedVramMb: 0
    });
  });

  // Behavioral invariant: over-accounted-reading-is-invalid
  it("rejects memory values when used plus free exceeds total by one MB", () => {
    expect(() => parseNvidiaSmiMemoryCsv("24564, 600, 23965\n", 0)).toThrowError(
      "nvidia-smi reported impossible memory values for GPU 0: used (600 MB) + free (23965 MB) = 24565 MB exceeds total (24564 MB)"
    );
  });

  // Behavioral invariant: telemetry-never-fabricates
  it("surfaces nvidia-smi execution and GPU-selection failures", async () => {
    // Process launch error (e.g. ENOENT)
    const enoentError = new Error("spawn nvidia-smi ENOENT");
    const launchFailExec: NvidiaSmiExecFileFn = vi.fn().mockRejectedValue(enoentError);
    const adapterLaunchFail = new NvidiaSmiTelemetryAdapter({
      gpuIndex: 0,
      execFile: launchFailExec
    });

    await expect(adapterLaunchFail.readMemory()).rejects.toThrow(NvidiaSmiTelemetryError);
    await expect(adapterLaunchFail.readMemory()).rejects.toThrow(/nvidia-smi/);

    // Non-zero exit with stderr
    const nonZeroError = Object.assign(new Error("Command failed with exit code 1"), {
      code: 1,
      stderr: "NVIDIA-SMI has failed because no devices were found"
    });
    const nonZeroExec: NvidiaSmiExecFileFn = vi.fn().mockRejectedValue(nonZeroError);
    const adapterNonZero = new NvidiaSmiTelemetryAdapter({
      gpuIndex: 0,
      execFile: nonZeroExec
    });

    try {
      await adapterNonZero.readMemory();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NvidiaSmiTelemetryError);
      const telemetryErr = err as NvidiaSmiTelemetryError;
      expect(telemetryErr.gpuIndex).toBe(0);
      expect(telemetryErr.stderr).toContain("NVIDIA-SMI has failed because no devices were found");
      expect(telemetryErr.message).toContain("NVIDIA-SMI has failed because no devices were found");
    }

    // Missing selected GPU index
    const singleGpuStdout = "24576, 8192, 16384\n";
    const singleGpuExec: NvidiaSmiExecFileFn = vi.fn().mockResolvedValue({
      stdout: singleGpuStdout,
      stderr: ""
    });
    const adapterMissingGpu = new NvidiaSmiTelemetryAdapter({
      gpuIndex: 3,
      execFile: singleGpuExec
    });

    try {
      await adapterMissingGpu.readMemory();
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(NvidiaSmiTelemetryError);
      const telemetryErr = err as NvidiaSmiTelemetryError;
      expect(telemetryErr.gpuIndex).toBe(3);
      expect(telemetryErr.message).toMatch(/GPU index 3/i);
    }
  });

  // Behavioral invariant: documented-poll-command
  it("invokes the documented nounits memory query", async () => {
    const mockExecFile: NvidiaSmiExecFileFn = vi.fn().mockResolvedValue({
      stdout: "24576, 8192, 16384\n",
      stderr: ""
    });

    const adapter = new NvidiaSmiTelemetryAdapter({
      gpuIndex: 0,
      execFile: mockExecFile
    });

    await adapter.readMemory();

    expect(mockExecFile).toHaveBeenCalledTimes(1);
    expect(mockExecFile).toHaveBeenCalledWith("nvidia-smi", [
      "--query-gpu=memory.total,memory.used,memory.free",
      "--format=csv,noheader,nounits"
    ]);
  });

  it("handles Unix newlines (LF) and Windows newlines (CRLF) identically", () => {
    const lfOutput = "24576, 8192, 16384\n24576, 4096, 20480\n";
    const crlfOutput = "24576, 8192, 16384\r\n24576, 4096, 20480\r\n";

    const parsedLf0 = parseNvidiaSmiMemoryCsv(lfOutput, 0);
    const parsedLf1 = parseNvidiaSmiMemoryCsv(lfOutput, 1);
    const parsedCrlf0 = parseNvidiaSmiMemoryCsv(crlfOutput, 0);
    const parsedCrlf1 = parseNvidiaSmiMemoryCsv(crlfOutput, 1);

    expect(parsedLf0).toEqual(parsedCrlf0);
    expect(parsedLf1).toEqual(parsedCrlf1);
    expect(parsedLf0).toEqual({
      totalVramMb: 24576,
      usedVramMb: 8192,
      freeVramMb: 16384,
      reservedVramMb: 0
    });
    expect(parsedLf1).toEqual({
      totalVramMb: 24576,
      usedVramMb: 4096,
      freeVramMb: 20480,
      reservedVramMb: 0
    });
  });

  it("validates adapter constructor options", () => {
    expect(() => new NvidiaSmiTelemetryAdapter({ gpuIndex: -1 })).toThrow(TypeError);
    expect(() => new NvidiaSmiTelemetryAdapter({ gpuIndex: 1.5 })).toThrow(TypeError);
    expect(() => new NvidiaSmiTelemetryAdapter({ gpuIndex: NaN })).toThrow(TypeError);
  });
});
