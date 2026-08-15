import { stat, statfs } from "node:fs/promises";
import { resolveModelFilePath, type ModelFileSpec } from "./hasher.js";

export const BYTES_PER_GB = 1_000_000_000;
export const LTX_MIN_FREE_DISK_GB = 100;

export interface DiskPreflightResult {
  readonly modelFootprintBytes: number;
  readonly availableBytes: number;
  readonly requiredFreeBytes: number;
  readonly modelFootprintGb: number;
  readonly availableGb: number;
  readonly minFreeDiskGb: number;
  readonly passes: boolean;
}

export class DiskPreflightError extends Error {
  readonly result: DiskPreflightResult;

  constructor(result: DiskPreflightResult, message?: string) {
    const formattedMessage =
      message ??
      `Insufficient disk space: ${result.availableGb} GB available, but ${result.minFreeDiskGb} GB required for reservation (model footprint: ${result.modelFootprintGb} GB)`;
    super(formattedMessage);
    this.name = "DiskPreflightError";
    this.result = result;
  }
}

export function evaluateFreeSpaceReservation(
  modelFootprintBytes: number,
  availableBytes: number,
  minFreeDiskGb: number
): DiskPreflightResult {
  if (
    typeof modelFootprintBytes !== "number" ||
    !Number.isFinite(modelFootprintBytes) ||
    !Number.isSafeInteger(modelFootprintBytes) ||
    modelFootprintBytes < 0
  ) {
    throw new TypeError("modelFootprintBytes must be a non-negative safe integer");
  }

  if (
    typeof availableBytes !== "number" ||
    !Number.isFinite(availableBytes) ||
    !Number.isSafeInteger(availableBytes) ||
    availableBytes < 0
  ) {
    throw new TypeError("availableBytes must be a non-negative safe integer");
  }

  if (typeof minFreeDiskGb !== "number" || !Number.isFinite(minFreeDiskGb) || minFreeDiskGb < 0) {
    throw new TypeError("minFreeDiskGb must be a non-negative finite number");
  }

  const requiredFreeBytes = Math.round(minFreeDiskGb * BYTES_PER_GB);
  const passes = availableBytes >= requiredFreeBytes;
  const modelFootprintGb = modelFootprintBytes / BYTES_PER_GB;
  const availableGb = availableBytes / BYTES_PER_GB;

  return Object.freeze({
    modelFootprintBytes,
    availableBytes,
    requiredFreeBytes,
    modelFootprintGb,
    availableGb,
    minFreeDiskGb,
    passes
  });
}

export async function measureModelFootprint(
  comfyUiDir: string,
  specs: readonly ModelFileSpec[]
): Promise<number> {
  let totalFootprint = 0;

  for (const spec of specs) {
    const key = `models/${spec.category}/${spec.relativePath.replace(/\\/g, "/")}`;

    let targetPath: string;
    try {
      targetPath = resolveModelFilePath(comfyUiDir, spec);
    } catch (err) {
      throw new Error(`Failed to resolve path for model ${key}`, { cause: err });
    }

    let fileStat;
    try {
      fileStat = await stat(targetPath);
    } catch (err) {
      throw new Error(`Failed to access model file for ${key}: ${(err as Error).message}`, {
        cause: err
      });
    }

    if (!fileStat.isFile()) {
      throw new Error(`Model path is not a regular file: ${key}`);
    }

    totalFootprint += fileStat.size;
  }

  return totalFootprint;
}

export async function runDiskPreflight(
  comfyUiDir: string,
  specs: readonly ModelFileSpec[],
  minFreeDiskGb: number = LTX_MIN_FREE_DISK_GB,
  dependencies?: Readonly<{ statfs: typeof statfs }>
): Promise<DiskPreflightResult> {
  const statfsFn = dependencies?.statfs ?? statfs;
  const modelFootprintBytes = await measureModelFootprint(comfyUiDir, specs);

  const stats = await statfsFn(comfyUiDir);
  const availableBytes = Math.floor(Number(stats.bavail) * Number(stats.bsize));

  const result = evaluateFreeSpaceReservation(modelFootprintBytes, availableBytes, minFreeDiskGb);

  if (!result.passes) {
    throw new DiskPreflightError(result);
  }

  return result;
}
