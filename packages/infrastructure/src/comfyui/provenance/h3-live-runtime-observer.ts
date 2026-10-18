import { execFile } from "node:child_process";
import * as crypto from "node:crypto";
import { type Dirent } from "node:fs";
import { readdir, readFile, readlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type {
  H3RuntimeObservationPort,
  H3RuntimeObservationTarget,
  H3RuntimeObservationResult,
  H3ObservedRuntimeIdentity
} from "@cco/application";

const execFileAsync = promisify(execFile);

export interface H3LiveRuntimeObserverProbes {
  readonly getHostname?: () => string;
  readonly queryGpuUuids?: () => Promise<string[]>;
  readonly inspectProcess?: (pid: number) => Promise<{
    pid: number;
    startTimeTicks: number;
    executable: string;
    cmdline: readonly string[];
  }>;
  readonly getProcessCwd?: (pid: number) => Promise<string>;
  readonly resolveListeningPid?: (port: number) => Promise<number | undefined>;
  readonly getProcessGpuUuids?: (
    pid: number,
    availableGpus: readonly string[]
  ) => Promise<string[]>;
  readonly getComfyUiRevision?: (comfyUiDir: string) => Promise<string>;
  readonly inspectCustomNodes?: (
    comfyUiDir: string
  ) => Promise<Record<string, { revision: string; sourceHash: string }>>;
  readonly inspectPackageVersions?: (pythonExecutable: string) => Promise<Record<string, string>>;
}

async function defaultResolveListeningPid(port: number): Promise<number | undefined> {
  // 1. Try ss -tlnp
  try {
    const { stdout } = await execFileAsync("ss", ["-tlnp", `sport = :${port}`], {
      timeout: 3000
    });
    const match = stdout.match(/pid=(\d+)/);
    if (match && match[1]) {
      const pid = parseInt(match[1], 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    // ss unavailable or failed
  }

  // 2. Try lsof -iTCP:${port} -sTCP:LISTEN -t
  try {
    const { stdout } = await execFileAsync("lsof", ["-iTCP:" + port, "-sTCP:LISTEN", "-t"], {
      timeout: 3000
    });
    const pidStr = stdout.trim().split(/\s+/)[0];
    if (pidStr) {
      const pid = parseInt(pidStr, 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    // lsof unavailable or failed
  }

  // 3. Fallback: inspect /proc/net/tcp and /proc/net/tcp6
  try {
    const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
    const content = await readFile("/proc/net/tcp", "utf8");
    const lines = content.split("\n");
    let inode: string | undefined;
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts[1] && parts[1].endsWith(":" + hexPort) && parts[3] === "0A" && parts[9]) {
        inode = parts[9];
        break;
      }
    }
    if (inode) {
      const procEntries = await readdir("/proc", { withFileTypes: true });
      for (const entry of procEntries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const candidatePid = parseInt(entry.name, 10);
        try {
          const fds = await readdir(`/proc/${candidatePid}/fd`);
          for (const fd of fds) {
            try {
              const link = await readlink(`/proc/${candidatePid}/fd/${fd}`);
              if (link === `socket:[${inode}]`) {
                return candidatePid;
              }
            } catch {
              // fd closed or permission denied
            }
          }
        } catch {
          // unable to read /proc/[pid]/fd
        }
      }
    }
  } catch {
    // /proc unreadable
  }

  return undefined;
}

async function defaultGetProcessGpuUuids(
  pid: number,
  availableGpus: readonly string[]
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-compute-apps=pid,gpu_uuid", "--format=csv,noheader,nounits"],
      { timeout: 5000 }
    );
    const gpus: string[] = [];
    for (const line of stdout.split(/\r?\n/)) {
      const parts = line.split(",").map((s) => s.trim());
      if (parts[0] && parseInt(parts[0], 10) === pid && parts[1]) {
        gpus.push(parts[1]);
      }
    }
    if (gpus.length > 0) return gpus;
  } catch {
    // nvidia-smi failed or no compute apps
  }

  try {
    const environ = await readFile(`/proc/${pid}/environ`, "utf8");
    const vars = environ.split("\0");
    for (const v of vars) {
      if (v.startsWith("CUDA_VISIBLE_DEVICES=")) {
        const val = v.slice("CUDA_VISIBLE_DEVICES=".length).trim();
        if (val.startsWith("GPU-")) {
          return [val];
        }
        const idx = parseInt(val, 10);
        if (Number.isFinite(idx) && idx >= 0 && idx < availableGpus.length) {
          const gpu = availableGpus[idx];
          if (gpu) return [gpu];
        }
      }
    }
  } catch {
    // environ unreadable
  }

  return [];
}

/**
 * Reads /proc/[pid]/stat to extract process start time ticks.
 * Field 22 (1-indexed) in /proc/[pid]/stat is starttime (ticks after system boot).
 */
async function readLinuxProcessStartTime(pid: number): Promise<number> {
  const statContent = await readFile(`/proc/${pid}/stat`, "utf8");
  // Comm field may contain spaces and parentheses: e.g. (python3 (main))
  const closeParenIdx = statContent.lastIndexOf(")");
  if (closeParenIdx === -1) {
    throw new Error(`Malformed /proc/${pid}/stat content`);
  }
  const afterComm = statContent.slice(closeParenIdx + 2).trim();
  const fields = afterComm.split(/\s+/);
  // fields[0] is state (field 3 of /proc/pid/stat)
  // starttime is field 22 of stat, which is index 19 of fields (22 - 3 = 19)
  const startTimeTicks = parseInt(fields[19] || "", 10);
  if (!Number.isFinite(startTimeTicks) || startTimeTicks < 0) {
    throw new Error(`Could not parse start time ticks from /proc/${pid}/stat`);
  }
  return startTimeTicks;
}

async function defaultQueryGpuUuids(): Promise<string[]> {
  // FAIL-CLOSED: No ENOENT fallback. If nvidia-smi fails, error is propagated.
  const { stdout } = await execFileAsync(
    "nvidia-smi",
    ["--query-gpu=gpu_uuid", "--format=csv,noheader,nounits"],
    { timeout: 5000 }
  );
  return stdout
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function defaultInspectProcess(pid: number): Promise<{
  pid: number;
  startTimeTicks: number;
  executable: string;
  cmdline: readonly string[];
}> {
  const startTimeTicks = await readLinuxProcessStartTime(pid);
  const cmdlineRaw = await readFile(`/proc/${pid}/cmdline`, "utf8");
  const cmdline = cmdlineRaw.split("\0").filter((s) => s.length > 0);
  const firstArg = cmdline[0];
  if (!firstArg || cmdline.length === 0) {
    throw new Error(`Process ${pid} has empty /proc/${pid}/cmdline`);
  }
  let executable: string = firstArg;
  try {
    const realExe = await readlink(`/proc/${pid}/exe`);
    if (realExe) {
      executable = realExe;
    }
  } catch {
    // Keep cmdline[0] if readlink is unavailable
  }

  return {
    pid,
    startTimeTicks,
    executable,
    cmdline
  };
}

async function defaultGetComfyUiRevision(comfyUiDir: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: comfyUiDir,
    timeout: 5000
  });
  return stdout.trim();
}

async function defaultInspectPackageVersions(
  pythonExecutable: string
): Promise<Record<string, string>> {
  const script =
    "import importlib.metadata, json; " +
    "pkgs = {}; " +
    "for d in importlib.metadata.distributions(): " +
    "    name = d.metadata.get('Name'); " +
    "    if name: " +
    "        v = d.version; " +
    "        pkgs[name.lower()] = v; " +
    "        pkgs[name.lower().replace('-', '_')] = v; " +
    "print(json.dumps(pkgs))";
  const { stdout } = await execFileAsync(pythonExecutable, ["-c", script], { timeout: 10000 });
  return JSON.parse(stdout.trim()) as Record<string, string>;
}

async function defaultInspectCustomNodes(
  comfyUiDir: string
): Promise<Record<string, { revision: string; sourceHash: string }>> {
  const customNodesDir = path.join(comfyUiDir, "custom_nodes");
  let entries: Dirent[];
  try {
    entries = await readdir(customNodesDir, { withFileTypes: true });
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === "ENOENT") {
      return {};
    }
    throw err;
  }

  const result: Record<string, { revision: string; sourceHash: string }> = {};
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".") || entry.name.startsWith("__")) continue;

    const nodeName = entry.name;
    const nodePath = path.join(customNodesDir, nodeName);
    let revision = "none";
    try {
      const { stdout } = await execFileAsync("git", ["-C", nodePath, "rev-parse", "HEAD"], {
        timeout: 5000
      });
      revision = stdout.trim();
    } catch {
      // Not a git repository
    }

    let sourceHash = "none";
    try {
      if (revision !== "none") {
        const { stdout } = await execFileAsync(
          "git",
          ["-C", nodePath, "rev-parse", "HEAD^{tree}"],
          {
            timeout: 5000
          }
        );
        sourceHash = crypto.createHash("sha256").update(stdout.trim()).digest("hex");
      }
    } catch {
      // Tree hash unavailable
    }

    result[nodeName] = { revision, sourceHash };
  }
  return result;
}

/**
 * Live runtime observer inspecting physical host, GPU, process identity, and ComfyUI environment.
 *
 * GOVERNANCE INVARIANT:
 * Always fails closed if nvidia-smi is unavailable, host mismatches, GPU is absent, or process drifts.
 */
export class H3LiveRuntimeObserver implements H3RuntimeObservationPort {
  private readonly probes: H3LiveRuntimeObserverProbes;

  constructor(probes: H3LiveRuntimeObserverProbes = {}) {
    this.probes = probes;
  }

  async observeCurrentRuntime(
    target: H3RuntimeObservationTarget
  ): Promise<H3RuntimeObservationResult> {
    // 1. Observe local hostname and verify fail-closed match
    const getHostnameFn = this.probes.getHostname ?? os.hostname;
    const currentHostname = getHostnameFn();
    if (currentHostname !== target.hostname) {
      return {
        ok: false,
        blocker: `Observed hostname "${currentHostname}" does not match target hostname "${target.hostname}"`
      };
    }

    // 2. Validate comfyUiEndpoint if specified (must be local) & resolve listening PID
    let endpointListeningPid: number | undefined;
    if (target.comfyUiEndpoint) {
      let url: URL;
      try {
        url = new URL(target.comfyUiEndpoint);
      } catch (err) {
        return {
          ok: false,
          blocker: `Invalid comfyUiEndpoint URL "${target.comfyUiEndpoint}": ${err instanceof Error ? err.message : String(err)}`
        };
      }

      const host = url.hostname.toLowerCase();
      const isLocal =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host === "0.0.0.0" ||
        host === currentHostname.toLowerCase();
      if (!isLocal) {
        return {
          ok: false,
          blocker: `comfyUiEndpoint "${target.comfyUiEndpoint}" is remote (${host}); live runtime observation requires local process access`
        };
      }

      const port = parseInt(url.port || (url.protocol === "https:" ? "443" : "80"), 10);
      const resolvePidFn = this.probes.resolveListeningPid ?? defaultResolveListeningPid;
      try {
        endpointListeningPid = await resolvePidFn(port);
      } catch (err) {
        return {
          ok: false,
          blocker: `Failed to resolve listening process PID on endpoint "${target.comfyUiEndpoint}" (port ${port}): ${err instanceof Error ? err.message : String(err)}`
        };
      }

      if (endpointListeningPid === undefined) {
        return {
          ok: false,
          blocker: `Could not resolve listening process PID for endpoint "${target.comfyUiEndpoint}" (port ${port})`
        };
      }

      if (target.pid !== undefined && endpointListeningPid !== target.pid) {
        return {
          ok: false,
          blocker: `Target PID ${target.pid} does not match listening process PID ${endpointListeningPid} on endpoint "${target.comfyUiEndpoint}"`
        };
      }
    }

    // 3. Resolve target process PID (Fail-closed: no fallback to process.pid)
    const targetPid = target.pid ?? endpointListeningPid;
    if (targetPid === undefined) {
      return {
        ok: false,
        blocker:
          "Target PID is required (or must be resolvable from local comfyUiEndpoint); cannot fallback to self process"
      };
    }
    if (!Number.isInteger(targetPid) || targetPid <= 0) {
      return {
        ok: false,
        blocker: `Invalid target PID ${targetPid}: must be a positive integer`
      };
    }

    // 4. Query physical GPU UUIDs (Fail-closed: nvidia-smi must be operational)
    const queryGpuFn = this.probes.queryGpuUuids ?? defaultQueryGpuUuids;
    let availableGpus: string[];
    try {
      availableGpus = await queryGpuFn();
    } catch (err) {
      return {
        ok: false,
        blocker: `GPU observation failed: ${err instanceof Error ? err.message : String(err)}. nvidia-smi must be available and operational.`
      };
    }

    if (!availableGpus.includes(target.gpuUuid)) {
      return {
        ok: false,
        blocker: `Target GPU UUID "${target.gpuUuid}" was not found among host GPUs: [${availableGpus.join(", ")}]`
      };
    }

    // 5. Inspect target process (Fail-closed: no fallback to process.pid)
    const inspectProcFn = this.probes.inspectProcess ?? defaultInspectProcess;
    let procInfo: {
      pid: number;
      startTimeTicks: number;
      executable: string;
      cmdline: readonly string[];
    };
    try {
      procInfo = await inspectProcFn(targetPid);
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to inspect target process ${targetPid}: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    // Verify executable is a Python interpreter
    if (!procInfo.executable || !procInfo.executable.toLowerCase().includes("python")) {
      return {
        ok: false,
        blocker: `Target process ${targetPid} executable "${procInfo.executable}" is not a Python interpreter`
      };
    }

    // 6. Bind GPU usage to the target process
    const getProcGpuFn = this.probes.getProcessGpuUuids ?? defaultGetProcessGpuUuids;
    let processGpus: string[];
    try {
      processGpus = await getProcGpuFn(procInfo.pid, availableGpus);
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to inspect GPU binding for process ${procInfo.pid}: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    if (processGpus.length === 0) {
      return {
        ok: false,
        blocker: `Target process ${procInfo.pid} has no observable GPU binding; could not bind process to GPU "${target.gpuUuid}"`
      };
    }

    if (!processGpus.includes(target.gpuUuid)) {
      return {
        ok: false,
        blocker: `Target process ${procInfo.pid} is bound to GPU(s) [${processGpus.join(", ")}], which does not include target GPU "${target.gpuUuid}"`
      };
    }

    // 7. ComfyUI Core directory and revision (Fail-closed: no fallback to process.cwd())
    const getProcCwdFn =
      this.probes.getProcessCwd ?? ((pid: number) => readlink(`/proc/${pid}/cwd`));
    let comfyDir = target.comfyUiDir;
    if (!comfyDir) {
      try {
        comfyDir = await getProcCwdFn(targetPid);
      } catch (err) {
        return {
          ok: false,
          blocker: `ComfyUI directory not provided and cannot be resolved from process cwd: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    } else {
      try {
        const procCwd = await getProcCwdFn(targetPid);
        const resolvedTargetDir = path.resolve(comfyDir);
        const resolvedProcCwd = path.resolve(procCwd);
        if (resolvedProcCwd !== resolvedTargetDir) {
          return {
            ok: false,
            blocker: `Target ComfyUI directory "${comfyDir}" does not match observed process cwd "${procCwd}"`
          };
        }
      } catch (err) {
        return {
          ok: false,
          blocker: `Failed to inspect process cwd: ${err instanceof Error ? err.message : String(err)}`
        };
      }
    }

    const getRevFn = this.probes.getComfyUiRevision ?? defaultGetComfyUiRevision;
    let coreRevision: string;
    try {
      coreRevision = await getRevFn(comfyDir);
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to inspect ComfyUI git revision in "${comfyDir}": ${err instanceof Error ? err.message : String(err)}`
      };
    }

    // 8. Custom nodes
    const inspectNodesFn = this.probes.inspectCustomNodes ?? defaultInspectCustomNodes;
    let customNodes: Record<string, { revision: string; sourceHash: string }>;
    try {
      customNodes = await inspectNodesFn(comfyDir);
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to inspect custom nodes: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    // 9. Package versions
    const inspectPkgsFn = this.probes.inspectPackageVersions ?? defaultInspectPackageVersions;
    let packageVersions: Record<string, string>;
    try {
      packageVersions = await inspectPkgsFn(procInfo.executable);
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to inspect package versions: ${err instanceof Error ? err.message : String(err)}`
      };
    }

    if (Object.keys(packageVersions).length === 0) {
      return {
        ok: false,
        blocker:
          "Package versions inspection returned empty package list; failed to observe environment packages"
      };
    }

    const observation: H3ObservedRuntimeIdentity = {
      hostname: currentHostname,
      gpuUuid: target.gpuUuid,
      pid: procInfo.pid,
      processStartTimeTicks: procInfo.startTimeTicks,
      pythonExecutable: procInfo.executable,
      comfyUiCoreRevision: coreRevision,
      commandLineArgs: procInfo.cmdline,
      customNodes: Object.freeze(customNodes),
      packageVersions: Object.freeze(packageVersions),
      observedAt: new Date().toISOString()
    };

    return {
      ok: true,
      observation
    };
  }

  async verifyProcessContinuity(
    pid: number,
    expectedStartTimeTicks: number
  ): Promise<{ readonly continuous: boolean; readonly blocker?: string }> {
    try {
      const inspectProcFn = this.probes.inspectProcess ?? defaultInspectProcess;
      const current = await inspectProcFn(pid);
      if (current.startTimeTicks !== expectedStartTimeTicks) {
        return {
          continuous: false,
          blocker: `Process continuity check failed: PID ${pid} start time changed from ${expectedStartTimeTicks} to ${current.startTimeTicks} (PID recycled or process restarted)`
        };
      }
      return { continuous: true };
    } catch (err) {
      return {
        continuous: false,
        blocker: `Process continuity check failed: PID ${pid} is no longer accessible (${err instanceof Error ? err.message : String(err)})`
      };
    }
  }
}
