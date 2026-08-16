import type { HostTelemetryPort, HostTelemetrySnapshot } from "@cco/application";
import * as fsPromises from "node:fs/promises";

export type LinuxHostReadFileFn = (path: string, encoding: "utf-8") => Promise<string>;

export interface ProcMeminfoResult {
  readonly hostRamTotalMb: number;
  readonly hostRamAvailableMb: number;
  readonly hostRamUsedMb: number;
  readonly swapTotalMb: number;
  readonly swapUsedMb: number;
}

export interface ProcVmstatResult {
  readonly systemSwapInPages: number;
  readonly systemSwapOutPages: number;
  readonly systemMajorPageFaults: number;
  readonly systemMinorPageFaults: number;
}

export interface ProcPidStatusResult {
  readonly processRssMb: number;
}

export interface ProcPidStatResult {
  readonly processPid: number;
  readonly processMinorPageFaults: number;
  readonly processMajorPageFaults: number;
  readonly processStartTimeTicks: number;
}

export interface LinuxHostTelemetryAdapterOptions {
  readonly pid: number;
  readonly readFile?: LinuxHostReadFileFn | undefined;
  readonly now?: (() => string | Date) | undefined;
  readonly expectedStartTimeTicks?: number | undefined;
  readonly procPath?: string | undefined;
}

export interface LinuxHostTelemetryErrorContext {
  readonly pid?: number | undefined;
  readonly path?: string | undefined;
  readonly cause?: unknown;
}

export class LinuxHostTelemetryError extends Error {
  override readonly name = "LinuxHostTelemetryError";
  readonly pid?: number | undefined;
  readonly path?: string | undefined;

  constructor(message: string, context?: LinuxHostTelemetryErrorContext) {
    super(message, context?.cause !== undefined ? { cause: context.cause } : undefined);
    this.pid = context?.pid;
    this.path = context?.path;
  }
}

export function parseProcMeminfo(content: string): ProcMeminfoResult {
  if (typeof content !== "string") {
    throw new LinuxHostTelemetryError("/proc/meminfo content must be a string");
  }

  let memTotalKb: number | undefined;
  let memAvailableKb: number | undefined;
  let swapTotalKb: number | undefined;
  let swapFreeKb: number | undefined;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valuePart = trimmed.slice(colonIdx + 1).trim();
    const match = valuePart.match(/^(\d+)(?:\s*kB)?$/i);
    if (!match) continue;

    const numValue = Number(match[1]);
    if (!Number.isFinite(numValue) || numValue < 0) continue;

    if (key === "MemTotal") {
      memTotalKb = numValue;
    } else if (key === "MemAvailable") {
      memAvailableKb = numValue;
    } else if (key === "SwapTotal") {
      swapTotalKb = numValue;
    } else if (key === "SwapFree") {
      swapFreeKb = numValue;
    }
  }

  if (memTotalKb === undefined) {
    throw new LinuxHostTelemetryError("Missing required key MemTotal in /proc/meminfo");
  }
  if (memAvailableKb === undefined) {
    throw new LinuxHostTelemetryError("Missing required key MemAvailable in /proc/meminfo");
  }
  if (swapTotalKb === undefined) {
    throw new LinuxHostTelemetryError("Missing required key SwapTotal in /proc/meminfo");
  }
  if (swapFreeKb === undefined) {
    throw new LinuxHostTelemetryError("Missing required key SwapFree in /proc/meminfo");
  }

  if (memAvailableKb > memTotalKb) {
    throw new LinuxHostTelemetryError(
      `Inconsistent /proc/meminfo: MemAvailable (${memAvailableKb} kB) exceeds MemTotal (${memTotalKb} kB)`
    );
  }

  if (swapFreeKb > swapTotalKb) {
    throw new LinuxHostTelemetryError(
      `Inconsistent /proc/meminfo: SwapFree (${swapFreeKb} kB) exceeds SwapTotal (${swapTotalKb} kB)`
    );
  }

  const hostRamTotalMb = Math.round(memTotalKb / 1024);
  const hostRamAvailableMb = Math.round(memAvailableKb / 1024);
  const hostRamUsedMb = hostRamTotalMb - hostRamAvailableMb;

  const swapTotalMb = Math.round(swapTotalKb / 1024);
  const swapFreeMb = Math.round(swapFreeKb / 1024);
  const swapUsedMb = swapTotalMb - swapFreeMb;

  return {
    hostRamTotalMb,
    hostRamAvailableMb,
    hostRamUsedMb,
    swapTotalMb,
    swapUsedMb
  };
}

export function parseProcVmstat(content: string): ProcVmstatResult {
  if (typeof content !== "string") {
    throw new LinuxHostTelemetryError("/proc/vmstat content must be a string");
  }

  let systemSwapInPages: number | undefined;
  let systemSwapOutPages: number | undefined;
  let systemMajorPageFaults: number | undefined;
  let systemMinorPageFaults: number | undefined;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const key = parts[0];
    const valStr = parts[1]!;
    const valNum = Number(valStr);

    if (!Number.isFinite(valNum) || !Number.isInteger(valNum) || valNum < 0) {
      continue;
    }

    if (key === "pswpin") {
      systemSwapInPages = valNum;
    } else if (key === "pswpout") {
      systemSwapOutPages = valNum;
    } else if (key === "pgmajfault") {
      systemMajorPageFaults = valNum;
    } else if (key === "pgfault") {
      systemMinorPageFaults = valNum;
    }
  }

  if (systemSwapInPages === undefined) {
    throw new LinuxHostTelemetryError("Missing required key pswpin in /proc/vmstat");
  }
  if (systemSwapOutPages === undefined) {
    throw new LinuxHostTelemetryError("Missing required key pswpout in /proc/vmstat");
  }
  if (systemMajorPageFaults === undefined) {
    throw new LinuxHostTelemetryError("Missing required key pgmajfault in /proc/vmstat");
  }
  if (systemMinorPageFaults === undefined) {
    throw new LinuxHostTelemetryError("Missing required key pgfault in /proc/vmstat");
  }

  return {
    systemSwapInPages,
    systemSwapOutPages,
    systemMajorPageFaults,
    systemMinorPageFaults
  };
}

export function parseProcPidStatus(content: string): ProcPidStatusResult {
  if (typeof content !== "string") {
    throw new LinuxHostTelemetryError("/proc/<pid>/status content must be a string");
  }

  let vmRssKb: number | undefined;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    if (key === "VmRSS") {
      const valuePart = trimmed.slice(colonIdx + 1).trim();
      const match = valuePart.match(/^(\d+)(?:\s*kB)?$/i);
      if (match) {
        const numValue = Number(match[1]);
        if (Number.isFinite(numValue) && numValue >= 0) {
          vmRssKb = numValue;
          break;
        }
      }
    }
  }

  if (vmRssKb === undefined) {
    throw new LinuxHostTelemetryError("Missing or invalid VmRSS in /proc/<pid>/status");
  }

  const processRssMb = Math.round(vmRssKb / 1024);

  return {
    processRssMb
  };
}

export function parseProcPidStat(content: string, expectedPid?: number): ProcPidStatResult {
  if (typeof content !== "string") {
    throw new LinuxHostTelemetryError("/proc/<pid>/stat content must be a string");
  }

  const firstParen = content.indexOf("(");
  const lastParen = content.lastIndexOf(")");
  if (firstParen === -1 || lastParen === -1 || lastParen <= firstParen) {
    throw new LinuxHostTelemetryError(
      "Malformed /proc/<pid>/stat: missing or invalid process comm parentheses"
    );
  }

  const pidStr = content.slice(0, firstParen).trim();
  const pid = Number(pidStr);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new LinuxHostTelemetryError(`Malformed /proc/<pid>/stat: invalid PID "${pidStr}"`);
  }

  if (expectedPid !== undefined && pid !== expectedPid) {
    throw new LinuxHostTelemetryError(
      `PID mismatch in /proc/<pid>/stat: expected ${expectedPid}, found ${pid}`,
      { pid }
    );
  }

  const rest = content.slice(lastParen + 1).trim();
  const fields = rest.split(/\s+/);

  // Field 3 (state) is index 0 in rest
  // Field 10 (minflt) is index 10 - 3 = 7
  // Field 12 (majflt) is index 12 - 3 = 9
  // Field 22 (starttime) is index 22 - 3 = 19
  if (fields.length < 20) {
    throw new LinuxHostTelemetryError(
      `Malformed /proc/<pid>/stat: insufficient fields (expected at least 22 fields, got ${fields.length + 2})`,
      { pid }
    );
  }

  const minfltStr = fields[7]!;
  const majfltStr = fields[9]!;
  const starttimeStr = fields[19]!;

  const processMinorPageFaults = Number(minfltStr);
  const processMajorPageFaults = Number(majfltStr);
  const processStartTimeTicks = Number(starttimeStr);

  if (
    !Number.isFinite(processMinorPageFaults) ||
    !Number.isInteger(processMinorPageFaults) ||
    processMinorPageFaults < 0
  ) {
    throw new LinuxHostTelemetryError(`Malformed /proc/<pid>/stat: invalid minflt "${minfltStr}"`, {
      pid
    });
  }

  if (
    !Number.isFinite(processMajorPageFaults) ||
    !Number.isInteger(processMajorPageFaults) ||
    processMajorPageFaults < 0
  ) {
    throw new LinuxHostTelemetryError(`Malformed /proc/<pid>/stat: invalid majflt "${majfltStr}"`, {
      pid
    });
  }

  if (
    !Number.isFinite(processStartTimeTicks) ||
    !Number.isInteger(processStartTimeTicks) ||
    processStartTimeTicks < 0
  ) {
    throw new LinuxHostTelemetryError(
      `Malformed /proc/<pid>/stat: invalid starttime ticks "${starttimeStr}"`,
      { pid }
    );
  }

  return {
    processPid: pid,
    processMinorPageFaults,
    processMajorPageFaults,
    processStartTimeTicks
  };
}

export class LinuxHostTelemetryAdapter implements HostTelemetryPort {
  private readonly pid: number;
  private readonly readFileFn: LinuxHostReadFileFn;
  private readonly nowFn: () => string;
  private readonly procPath: string;
  private expectedStartTimeTicks?: number | undefined;

  constructor(options: LinuxHostTelemetryAdapterOptions) {
    if (typeof options.pid !== "number" || !Number.isInteger(options.pid) || options.pid <= 0) {
      throw new TypeError(`pid must be a positive integer, received ${options.pid}`);
    }

    if (
      options.expectedStartTimeTicks !== undefined &&
      (typeof options.expectedStartTimeTicks !== "number" ||
        !Number.isInteger(options.expectedStartTimeTicks) ||
        options.expectedStartTimeTicks < 0)
    ) {
      throw new TypeError(
        `expectedStartTimeTicks must be a non-negative integer, received ${options.expectedStartTimeTicks}`
      );
    }

    this.pid = options.pid;
    this.expectedStartTimeTicks = options.expectedStartTimeTicks;
    this.procPath = options.procPath ?? "/proc";
    this.readFileFn =
      options.readFile ??
      ((filePath: string, encoding: "utf-8") => fsPromises.readFile(filePath, { encoding }));

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

  async readHostMemory(): Promise<HostTelemetrySnapshot> {
    const meminfoPath = `${this.procPath}/meminfo`;
    const vmstatPath = `${this.procPath}/vmstat`;
    const pidStatusPath = `${this.procPath}/${this.pid}/status`;
    const pidStatPath = `${this.procPath}/${this.pid}/stat`;

    let meminfoRaw: string;
    let vmstatRaw: string;
    let pidStatusRaw: string;
    let pidStatRaw: string;

    try {
      [meminfoRaw, vmstatRaw, pidStatusRaw, pidStatRaw] = await Promise.all([
        this.readFileFn(meminfoPath, "utf-8").catch((err) => {
          throw new LinuxHostTelemetryError(
            `Failed to read ${meminfoPath}: ${err instanceof Error ? err.message : String(err)}`,
            { pid: this.pid, path: meminfoPath, cause: err }
          );
        }),
        this.readFileFn(vmstatPath, "utf-8").catch((err) => {
          throw new LinuxHostTelemetryError(
            `Failed to read ${vmstatPath}: ${err instanceof Error ? err.message : String(err)}`,
            { pid: this.pid, path: vmstatPath, cause: err }
          );
        }),
        this.readFileFn(pidStatusPath, "utf-8").catch((err) => {
          throw new LinuxHostTelemetryError(
            `Failed to read ${pidStatusPath}: ${err instanceof Error ? err.message : String(err)}`,
            { pid: this.pid, path: pidStatusPath, cause: err }
          );
        }),
        this.readFileFn(pidStatPath, "utf-8").catch((err) => {
          throw new LinuxHostTelemetryError(
            `Failed to read ${pidStatPath}: ${err instanceof Error ? err.message : String(err)}`,
            { pid: this.pid, path: pidStatPath, cause: err }
          );
        })
      ]);
    } catch (err) {
      if (err instanceof LinuxHostTelemetryError) {
        throw err;
      }
      throw new LinuxHostTelemetryError(
        `Failed to read proc telemetry files for PID ${this.pid}: ${err instanceof Error ? err.message : String(err)}`,
        { pid: this.pid, cause: err }
      );
    }

    let meminfo: ProcMeminfoResult;
    let vmstat: ProcVmstatResult;
    let pidStatus: ProcPidStatusResult;
    let pidStat: ProcPidStatResult;

    try {
      meminfo = parseProcMeminfo(meminfoRaw);
    } catch (err) {
      if (err instanceof LinuxHostTelemetryError) throw err;
      throw new LinuxHostTelemetryError(
        `Failed to parse ${meminfoPath}: ${err instanceof Error ? err.message : String(err)}`,
        { pid: this.pid, path: meminfoPath, cause: err }
      );
    }

    try {
      vmstat = parseProcVmstat(vmstatRaw);
    } catch (err) {
      if (err instanceof LinuxHostTelemetryError) throw err;
      throw new LinuxHostTelemetryError(
        `Failed to parse ${vmstatPath}: ${err instanceof Error ? err.message : String(err)}`,
        { pid: this.pid, path: vmstatPath, cause: err }
      );
    }

    try {
      pidStatus = parseProcPidStatus(pidStatusRaw);
    } catch (err) {
      if (err instanceof LinuxHostTelemetryError) throw err;
      throw new LinuxHostTelemetryError(
        `Failed to parse ${pidStatusPath}: ${err instanceof Error ? err.message : String(err)}`,
        { pid: this.pid, path: pidStatusPath, cause: err }
      );
    }

    try {
      pidStat = parseProcPidStat(pidStatRaw, this.pid);
    } catch (err) {
      if (err instanceof LinuxHostTelemetryError) throw err;
      throw new LinuxHostTelemetryError(
        `Failed to parse ${pidStatPath}: ${err instanceof Error ? err.message : String(err)}`,
        { pid: this.pid, path: pidStatPath, cause: err }
      );
    }

    if (this.expectedStartTimeTicks === undefined) {
      this.expectedStartTimeTicks = pidStat.processStartTimeTicks;
    } else if (pidStat.processStartTimeTicks !== this.expectedStartTimeTicks) {
      throw new LinuxHostTelemetryError(
        `Process start time changed for PID ${this.pid}: expected ${this.expectedStartTimeTicks}, got ${pidStat.processStartTimeTicks} (PID reuse detected)`,
        { pid: this.pid, path: pidStatPath }
      );
    }

    return {
      hostRamTotalMb: meminfo.hostRamTotalMb,
      hostRamAvailableMb: meminfo.hostRamAvailableMb,
      hostRamUsedMb: meminfo.hostRamUsedMb,
      swapTotalMb: meminfo.swapTotalMb,
      swapUsedMb: meminfo.swapUsedMb,
      systemSwapInPages: vmstat.systemSwapInPages,
      systemSwapOutPages: vmstat.systemSwapOutPages,
      systemMajorPageFaults: vmstat.systemMajorPageFaults,
      systemMinorPageFaults: vmstat.systemMinorPageFaults,
      processPid: this.pid,
      processStartTimeTicks: pidStat.processStartTimeTicks,
      processRssMb: pidStatus.processRssMb,
      processMajorPageFaults: pidStat.processMajorPageFaults,
      processMinorPageFaults: pidStat.processMinorPageFaults,
      measuredAt: this.nowFn()
    };
  }
}
