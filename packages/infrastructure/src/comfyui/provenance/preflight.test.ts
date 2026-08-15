import * as fsPromises from "node:fs/promises";
import type { StatsFs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelFileSpec } from "./hasher.js";
import {
  BYTES_PER_GB,
  DiskPreflightError,
  evaluateFreeSpaceReservation,
  LTX_MIN_FREE_DISK_GB,
  measureModelFootprint,
  runDiskPreflight
} from "./preflight.js";

describe("LTX Model Footprint and Disk Reservation Preflight", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(join(tmpdir(), "preflight-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  // Behavioral Invariant 1:
  it("preflight sums the live sizes of all manifest-listed model categories", async () => {
    const comfyUiDir = tempDir;
    await fsPromises.mkdir(join(comfyUiDir, "models", "diffusion_models"), { recursive: true });
    await fsPromises.mkdir(join(comfyUiDir, "models", "text_encoders"), { recursive: true });
    await fsPromises.mkdir(join(comfyUiDir, "models", "vae"), { recursive: true });
    await fsPromises.mkdir(join(comfyUiDir, "models", "loras"), { recursive: true });
    await fsPromises.mkdir(join(comfyUiDir, "models", "model_patches"), { recursive: true });

    const diffPath = join(comfyUiDir, "models", "diffusion_models", "model.safetensors");
    const encPath = join(comfyUiDir, "models", "text_encoders", "encoder.safetensors");
    const vaePath = join(comfyUiDir, "models", "vae", "vae.safetensors");
    const loraPath = join(comfyUiDir, "models", "loras", "lora.safetensors");
    const patchPath = join(comfyUiDir, "models", "model_patches", "patch.safetensors");

    const bufDiff = Buffer.alloc(111);
    const bufEnc = Buffer.alloc(222);
    const bufVae = Buffer.alloc(333);
    const bufLora = Buffer.alloc(444);
    const bufPatch = Buffer.alloc(555);

    await fsPromises.writeFile(diffPath, bufDiff);
    await fsPromises.writeFile(encPath, bufEnc);
    await fsPromises.writeFile(vaePath, bufVae);
    await fsPromises.writeFile(loraPath, bufLora);
    await fsPromises.writeFile(patchPath, bufPatch);

    const specs: ModelFileSpec[] = [
      { category: "diffusion_models", relativePath: "model.safetensors" },
      { category: "text_encoders", relativePath: "encoder.safetensors" },
      { category: "vae", relativePath: "vae.safetensors" },
      { category: "loras", relativePath: "lora.safetensors" },
      { category: "model_patches", relativePath: "patch.safetensors" }
    ];

    const totalBytes = await measureModelFootprint(comfyUiDir, specs);
    expect(totalBytes).toBe(111 + 222 + 333 + 444 + 555);
    expect(totalBytes).toBe(1665);
  });

  // Behavioral Invariant 2:
  it("preflight passes when available space equals the 100 GB reservation", async () => {
    const comfyUiDir = tempDir;
    const specs: ModelFileSpec[] = [];

    const exactReservationBytes = 100 * BYTES_PER_GB; // 100_000_000_000
    const fakeStatfs = vi.fn().mockResolvedValue({
      bavail: exactReservationBytes,
      bsize: 1,
      blocks: 500_000_000_000,
      bfree: 200_000_000_000
    } as unknown as StatsFs);

    const result = await runDiskPreflight(comfyUiDir, specs, 100, { statfs: fakeStatfs });

    expect(result.passes).toBe(true);
    expect(result.availableBytes).toBe(100_000_000_000);
    expect(result.requiredFreeBytes).toBe(100_000_000_000);
    expect(result.availableGb).toBe(100);
    expect(result.minFreeDiskGb).toBe(100);
    expect(result.modelFootprintBytes).toBe(0);
    expect(result.modelFootprintGb).toBe(0);
  });

  // Behavioral Invariant 3:
  it("preflight fails clearly one byte below the 100 GB reservation", async () => {
    const comfyUiDir = tempDir;
    await fsPromises.mkdir(join(comfyUiDir, "models", "checkpoints"), { recursive: true });
    const ckptPath = join(comfyUiDir, "models", "checkpoints", "base.safetensors");
    await fsPromises.writeFile(ckptPath, Buffer.alloc(1024));

    const specs: ModelFileSpec[] = [{ category: "checkpoints", relativePath: "base.safetensors" }];

    const oneByteBelowBytes = 100 * BYTES_PER_GB - 1; // 99_999_999_999
    const fakeStatfs = vi.fn().mockResolvedValue({
      bavail: oneByteBelowBytes,
      bsize: 1,
      blocks: 500_000_000_000,
      bfree: 200_000_000_000
    } as unknown as StatsFs);

    let caughtError: unknown;
    try {
      await runDiskPreflight(comfyUiDir, specs, 100, { statfs: fakeStatfs });
      expect.unreachable("preflight should have thrown DiskPreflightError");
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(DiskPreflightError);
    expect(caughtError).toBeInstanceOf(Error);
    const preflightErr = caughtError as DiskPreflightError;
    expect(preflightErr.name).toBe("DiskPreflightError");
    expect(preflightErr.result).toBeDefined();
    expect(preflightErr.result.passes).toBe(false);
    expect(preflightErr.result.availableBytes).toBe(99_999_999_999);
    expect(preflightErr.result.requiredFreeBytes).toBe(100_000_000_000);
    expect(preflightErr.result.modelFootprintBytes).toBe(1024);
    expect(preflightErr.result.minFreeDiskGb).toBe(100);
    expect(preflightErr.message).toMatch(/Insufficient disk space/);
  });

  // Behavioral Invariant 4:
  it("preflight uses filesystem available blocks rather than total blocks", async () => {
    const comfyUiDir = tempDir;
    const specs: ModelFileSpec[] = [];

    // Total blocks = 1,000 GB, bfree = 200 GB, bavail = 50 GB (bsize = 1000)
    const fakeStatfs = vi.fn().mockResolvedValue({
      blocks: 1_000_000_000,
      bfree: 200_000_000,
      bavail: 50_000_000,
      bsize: 1000
    } as unknown as StatsFs);

    await expect(runDiskPreflight(comfyUiDir, specs, 100, { statfs: fakeStatfs })).rejects.toThrow(
      DiskPreflightError
    );

    try {
      await runDiskPreflight(comfyUiDir, specs, 100, { statfs: fakeStatfs });
    } catch (err) {
      const error = err as DiskPreflightError;
      expect(error.result.availableBytes).toBe(50_000_000_000);
      expect(error.result.availableGb).toBe(50);
      expect(error.result.passes).toBe(false);
    }
  });

  // Behavioral Invariant 5:
  it("preflight rejects a directory where a model file is required", async () => {
    const comfyUiDir = tempDir;
    await fsPromises.mkdir(join(comfyUiDir, "models", "checkpoints", "not-a-file.safetensors"), {
      recursive: true
    });

    const spec: ModelFileSpec = {
      category: "checkpoints",
      relativePath: "not-a-file.safetensors"
    };

    await expect(measureModelFootprint(comfyUiDir, [spec])).rejects.toThrow(/regular file/i);
  });

  describe("evaluateFreeSpaceReservation", () => {
    it("evaluates exact boundary and derived GB values correctly", () => {
      const result = evaluateFreeSpaceReservation(68_800_000_000, 150_000_000_000, 100);

      expect(result).toEqual({
        modelFootprintBytes: 68_800_000_000,
        availableBytes: 150_000_000_000,
        requiredFreeBytes: 100_000_000_000,
        modelFootprintGb: 68.8,
        availableGb: 150,
        minFreeDiskGb: 100,
        passes: true
      });
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("rejects invalid numeric inputs", () => {
      expect(() => evaluateFreeSpaceReservation(-1, 100, 100)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(100, -1, 100)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(100, 100, -1)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(NaN, 100, 100)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(100, NaN, 100)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(100, 100, NaN)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(1.5, 100, 100)).toThrow(TypeError);
      expect(() => evaluateFreeSpaceReservation(100, 1.5, 100)).toThrow(TypeError);
    });
  });

  describe("runDiskPreflight defaults and missing files", () => {
    it("defaults to 100 GB reservation when minFreeDiskGb is omitted", async () => {
      const comfyUiDir = tempDir;
      const fakeStatfs = vi.fn().mockResolvedValue({
        bavail: 100_000_000_000,
        bsize: 1
      } as unknown as StatsFs);

      const result = await runDiskPreflight(comfyUiDir, [], undefined, { statfs: fakeStatfs });
      expect(result.minFreeDiskGb).toBe(LTX_MIN_FREE_DISK_GB);
      expect(result.requiredFreeBytes).toBe(100_000_000_000);
      expect(result.passes).toBe(true);
    });

    it("rejects missing model files with descriptive errors", async () => {
      const comfyUiDir = tempDir;
      const spec: ModelFileSpec = {
        category: "vae",
        relativePath: "missing.safetensors"
      };

      await expect(measureModelFootprint(comfyUiDir, [spec])).rejects.toThrow(
        /models\/vae\/missing\.safetensors/
      );
    });
  });
});
