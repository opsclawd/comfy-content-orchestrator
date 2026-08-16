import { CertificationEnvironmentSchema } from "@cco/contracts";
import type { CertificationEnvironment } from "@cco/contracts";
import { execFile as defaultExecFileCallback } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import * as nodeOs from "node:os";
import { promisify } from "node:util";

const nodeExecFile = promisify(defaultExecFileCallback);

const NVIDIA_SMI_COMMAND = "nvidia-smi";
const NVIDIA_SMI_IDENTITY_ARGS: readonly string[] = Object.freeze([
  "--query-gpu=name,uuid,driver_version,memory.total",
  "--format=csv,noheader,nounits"
]);

export interface RunnerEnvironmentOs {
  readonly platform: () => string;
  readonly arch: () => string;
  readonly release: () => string;
  readonly version: () => string;
  readonly cpus: () => readonly Readonly<{ model: string }>[];
}

export type RunnerEnvironmentReadFileFn = (path: string, encoding: "utf-8") => Promise<string>;

export type RunnerEnvironmentExecFileFn = (
  file: string,
  args: readonly string[]
) => Promise<{ stdout: string; stderr?: string }>;

export interface RunnerEnvironmentDependencies {
  readonly os?: RunnerEnvironmentOs | undefined;
  readonly readFile?: RunnerEnvironmentReadFileFn | undefined;
  readonly execFile?: RunnerEnvironmentExecFileFn | undefined;
}

export interface RunnerEnvironmentOptions {
  readonly comfyUiPid: number;
  readonly gpuIndex?: number | undefined;
}

interface GpuIdentity {
  readonly gpuName: string;
  readonly gpuUuid: string;
  readonly gpuDriverVersion: string;
  readonly gpuTotalMemoryMb: number;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, received ${value}`);
  }
}

function parseGpuIdentity(stdout: string, gpuIndex: number): GpuIdentity {
  const lines = stdout.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }

  const row = lines[gpuIndex];
  if (row === undefined || row.trim() === "") {
    throw new Error(`GPU identity query did not return GPU index ${gpuIndex}`);
  }

  const columns = row.split(",").map((column) => column.trim());
  if (columns.length !== 4 || columns.some((column) => column.length === 0)) {
    throw new Error(`GPU identity query returned malformed row: "${row}"`);
  }

  const gpuTotalMemoryMb = Number(columns[3]);
  if (!Number.isInteger(gpuTotalMemoryMb) || gpuTotalMemoryMb <= 0) {
    throw new Error(`GPU identity query returned invalid total memory: "${columns[3]}"`);
  }

  return {
    gpuName: columns[0]!,
    gpuUuid: columns[1]!,
    gpuDriverVersion: columns[2]!,
    gpuTotalMemoryMb
  };
}

function parseComfyUiArgs(rawCmdline: string): string[] {
  const args = rawCmdline.split("\u0000");
  while (args.at(-1) === "") {
    args.pop();
  }

  if (args.length === 0) {
    throw new Error("ComfyUI command line is empty");
  }

  return args;
}

function parseCudaVersion(stdout: string): string | null {
  const match = stdout.match(/CUDA Version:\s*([^\s]+)/);
  return match?.[1] ?? null;
}

export async function collectRunnerEnvironment(
  options: RunnerEnvironmentOptions,
  dependencies: RunnerEnvironmentDependencies = {}
): Promise<CertificationEnvironment> {
  assertPositiveInteger(options.comfyUiPid, "comfyUiPid");

  const gpuIndex = options.gpuIndex ?? 0;
  if (!Number.isInteger(gpuIndex) || gpuIndex < 0) {
    throw new Error(`gpuIndex must be a non-negative integer, received ${gpuIndex}`);
  }

  const os = dependencies.os ?? nodeOs;
  const readFile =
    dependencies.readFile ??
    ((path: string, encoding: "utf-8") => fsPromises.readFile(path, { encoding }));
  const execFile =
    dependencies.execFile ?? (nodeExecFile as unknown as RunnerEnvironmentExecFileFn);

  let gpuIdentityOutput: string;
  try {
    gpuIdentityOutput = (await execFile(NVIDIA_SMI_COMMAND, NVIDIA_SMI_IDENTITY_ARGS)).stdout;
  } catch (cause: unknown) {
    throw new Error(
      `Failed to collect GPU identity from nvidia-smi: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  let gpu: GpuIdentity;
  try {
    gpu = parseGpuIdentity(gpuIdentityOutput, gpuIndex);
  } catch (cause: unknown) {
    throw new Error(
      `Failed to parse GPU identity from nvidia-smi: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  let cudaOutput: string;
  try {
    cudaOutput = (await execFile(NVIDIA_SMI_COMMAND, [])).stdout;
  } catch (cause: unknown) {
    throw new Error(
      `Failed to read the nvidia-smi CUDA banner: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  const cmdlinePath = `/proc/${options.comfyUiPid}/cmdline`;
  let rawCmdline: string;
  try {
    rawCmdline = await readFile(cmdlinePath, "utf-8");
  } catch (cause: unknown) {
    throw new Error(
      `Failed to read ComfyUI command line at ${cmdlinePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  let comfyUiArgs: string[];
  try {
    comfyUiArgs = parseComfyUiArgs(rawCmdline);
  } catch (cause: unknown) {
    throw new Error(
      `Failed to parse ComfyUI command line at ${cmdlinePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause }
    );
  }

  const cpuInfo = os.cpus();
  const cpuModel = cpuInfo[0]?.model;
  if (cpuModel === undefined || cpuModel.trim() === "") {
    throw new Error("Runner CPU identity is unavailable");
  }

  const environment = {
    nodeVersion: process.version,
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    osVersion: os.version(),
    cpuModel,
    cpuCount: cpuInfo.length,
    ...gpu,
    cudaVersion: parseCudaVersion(cudaOutput),
    comfyUiPid: options.comfyUiPid,
    comfyUiArgs
  };

  return CertificationEnvironmentSchema.parse(environment);
}
