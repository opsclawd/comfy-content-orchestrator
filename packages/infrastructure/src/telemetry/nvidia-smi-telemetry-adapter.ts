import type { GpuMemorySnapshot, GpuTelemetryPort } from "@cco/application";
import { execFile as defaultExecFileCallback } from "node:child_process";
import { promisify } from "node:util";

const nodeExecFile = promisify(defaultExecFileCallback);

export const NVIDIA_SMI_COMMAND = "nvidia-smi";
export const NVIDIA_SMI_MEMORY_ARGS: readonly string[] = Object.freeze([
  "--query-gpu=memory.total,memory.used,memory.free",
  "--format=csv,noheader,nounits"
]);

export interface NvidiaSmiMemoryResult {
  readonly totalVramMb: number;
  readonly usedVramMb: number;
  readonly freeVramMb: number;
  readonly reservedVramMb: number;
}

export type NvidiaSmiExecFileFn = (
  file: string,
  args: readonly string[]
) => Promise<{ stdout: string; stderr?: string }>;

export interface NvidiaSmiTelemetryAdapterOptions {
  readonly gpuIndex?: number | undefined;
  readonly execFile?: NvidiaSmiExecFileFn | undefined;
  readonly now?: (() => string | Date) | undefined;
}

export interface NvidiaSmiTelemetryErrorContext {
  readonly gpuIndex?: number | undefined;
  readonly stderr?: string | undefined;
  readonly cause?: unknown;
}

export class NvidiaSmiTelemetryError extends Error {
  override readonly name = "NvidiaSmiTelemetryError";
  readonly gpuIndex?: number | undefined;
  readonly stderr?: string | undefined;

  constructor(message: string, context?: NvidiaSmiTelemetryErrorContext) {
    super(message, context?.cause !== undefined ? { cause: context.cause } : undefined);
    this.gpuIndex = context?.gpuIndex;
    this.stderr = context?.stderr;
  }
}

export function parseNvidiaSmiMemoryCsv(
  stdout: string,
  gpuIndex: number = 0
): NvidiaSmiMemoryResult {
  if (typeof gpuIndex !== "number" || !Number.isInteger(gpuIndex) || gpuIndex < 0) {
    throw new NvidiaSmiTelemetryError(
      `Invalid GPU index ${gpuIndex}: index must be a non-negative integer`,
      { gpuIndex }
    );
  }

  if (typeof stdout !== "string") {
    throw new NvidiaSmiTelemetryError("nvidia-smi output must be a string", { gpuIndex });
  }

  const rawLines = stdout.split(/\r?\n/);
  const lines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    // Skip trailing empty line typical of CLI stdout
    if (i === rawLines.length - 1 && line.trim() === "") {
      continue;
    }
    lines.push(line);
  }

  if (lines.length === 0) {
    throw new NvidiaSmiTelemetryError(
      `nvidia-smi returned empty output; GPU index ${gpuIndex} unavailable`,
      { gpuIndex }
    );
  }

  if (gpuIndex >= lines.length) {
    throw new NvidiaSmiTelemetryError(
      `Configured GPU index ${gpuIndex} not found in nvidia-smi output (${lines.length} ${lines.length === 1 ? "GPU" : "GPUs"} detected)`,
      { gpuIndex }
    );
  }

  const targetRow = lines[gpuIndex]!;
  if (targetRow.trim() === "") {
    throw new NvidiaSmiTelemetryError(`nvidia-smi output row for GPU index ${gpuIndex} is blank`, {
      gpuIndex
    });
  }

  const cols = targetRow.split(",").map((c) => c.trim());
  if (cols.length !== 3) {
    throw new NvidiaSmiTelemetryError(
      `nvidia-smi output row for GPU index ${gpuIndex} expected 3 columns (total, used, free), received ${cols.length}: "${targetRow}"`,
      { gpuIndex }
    );
  }

  for (let i = 0; i < cols.length; i++) {
    if (cols[i] === "") {
      throw new NvidiaSmiTelemetryError(
        `nvidia-smi output row for GPU index ${gpuIndex} contains empty column at index ${i}: "${targetRow}"`,
        { gpuIndex }
      );
    }
  }

  const totalVramMb = Number(cols[0]);
  const usedVramMb = Number(cols[1]);
  const freeVramMb = Number(cols[2]);

  if (!Number.isFinite(totalVramMb) || totalVramMb < 0) {
    throw new NvidiaSmiTelemetryError(
      `nvidia-smi total memory value is invalid or non-finite: "${cols[0]}" for GPU ${gpuIndex}`,
      { gpuIndex }
    );
  }

  if (!Number.isFinite(usedVramMb) || usedVramMb < 0) {
    throw new NvidiaSmiTelemetryError(
      `nvidia-smi used memory value is invalid or non-finite: "${cols[1]}" for GPU ${gpuIndex}`,
      { gpuIndex }
    );
  }

  if (!Number.isFinite(freeVramMb) || freeVramMb < 0) {
    throw new NvidiaSmiTelemetryError(
      `nvidia-smi free memory value is invalid or non-finite: "${cols[2]}" for GPU ${gpuIndex}`,
      { gpuIndex }
    );
  }

  const accountedVramMb = usedVramMb + freeVramMb;
  if (accountedVramMb > totalVramMb) {
    throw new NvidiaSmiTelemetryError(
      `nvidia-smi reported impossible memory values for GPU ${gpuIndex}: used (${usedVramMb} MB) + free (${freeVramMb} MB) = ${accountedVramMb} MB exceeds total (${totalVramMb} MB)`,
      { gpuIndex }
    );
  }

  const reservedVramMb = totalVramMb - accountedVramMb;

  return {
    totalVramMb,
    usedVramMb,
    freeVramMb,
    reservedVramMb
  };
}

export class NvidiaSmiTelemetryAdapter implements GpuTelemetryPort {
  private readonly gpuIndex: number;
  private readonly execFileFn: NvidiaSmiExecFileFn;
  private readonly nowFn: () => string;

  constructor(options: NvidiaSmiTelemetryAdapterOptions = {}) {
    const gpuIndex = options.gpuIndex ?? 0;
    if (typeof gpuIndex !== "number" || !Number.isInteger(gpuIndex) || gpuIndex < 0) {
      throw new TypeError(`gpuIndex must be a non-negative integer, received ${gpuIndex}`);
    }
    this.gpuIndex = gpuIndex;
    this.execFileFn = options.execFile ?? (nodeExecFile as unknown as NvidiaSmiExecFileFn);

    if (options.now) {
      const customNow = options.now;
      this.nowFn = () => {
        const result = customNow();
        return typeof result === "string" ? result : result.toISOString();
      };
    } else {
      this.nowFn = () => new Date().toISOString();
    }
  }

  async readMemory(): Promise<GpuMemorySnapshot> {
    let stdout: string;
    let stderr: string | undefined;

    try {
      const result = await this.execFileFn(NVIDIA_SMI_COMMAND, NVIDIA_SMI_MEMORY_ARGS);
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err: unknown) {
      const errObj = err as { stderr?: string; message?: string };
      const rawStderr = typeof errObj?.stderr === "string" ? errObj.stderr.trim() : undefined;
      const safeExcerpt =
        rawStderr && rawStderr.length > 500 ? `${rawStderr.slice(0, 500)}...` : rawStderr;
      const detail = safeExcerpt || (err instanceof Error ? err.message : String(err));

      throw new NvidiaSmiTelemetryError(
        `Failed to execute nvidia-smi for GPU ${this.gpuIndex}: ${detail}`,
        {
          gpuIndex: this.gpuIndex,
          stderr: safeExcerpt,
          cause: err
        }
      );
    }

    try {
      const parsed = parseNvidiaSmiMemoryCsv(stdout, this.gpuIndex);
      return {
        totalVramMb: parsed.totalVramMb,
        usedVramMb: parsed.usedVramMb,
        freeVramMb: parsed.freeVramMb,
        reservedVramMb: parsed.reservedVramMb,
        measuredAt: this.nowFn()
      };
    } catch (err: unknown) {
      if (err instanceof NvidiaSmiTelemetryError) {
        throw err;
      }
      throw new NvidiaSmiTelemetryError(
        `Failed to parse nvidia-smi memory output for GPU ${this.gpuIndex}: ${err instanceof Error ? err.message : String(err)}`,
        {
          gpuIndex: this.gpuIndex,
          stderr,
          cause: err
        }
      );
    }
  }
}
