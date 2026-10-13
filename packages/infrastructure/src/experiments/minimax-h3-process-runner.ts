import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, readlink, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { MinimaxH3OwnedProcess, MinimaxH3ProcessRunnerPort } from "@cco/application";

function parseStartTimeTicksFromStat(statContent: string): number {
  // /proc/[pid]/stat format: pid (comm) state ppid pgrp session tty_nr tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime priority nice num_threads itrealvalue starttime ...
  // comm can contain spaces and parentheses, so find the last ')' to parse subsequent fields
  const lastParenIndex = statContent.lastIndexOf(")");
  if (lastParenIndex === -1) {
    throw new Error("Invalid /proc/[pid]/stat format: missing closing parenthesis");
  }
  const rest = statContent.substring(lastParenIndex + 1).trim();
  const fields = rest.split(/\s+/);
  // fields[0] is state (field 3)
  // fields[19] is starttime (field 22 in 1-based index)
  const starttimeStr = fields[19];
  if (!starttimeStr) {
    throw new Error("Cannot find starttime field in /proc/[pid]/stat");
  }
  return parseInt(starttimeStr, 10);
}

function ipToHex(ip: string): string {
  if (ip === "0.0.0.0") return "00000000";
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4) return "";
  // /proc/net/tcp uses little-endian byte order for IPv4
  const hex =
    parts[3]!.toString(16).padStart(2, "0") +
    parts[2]!.toString(16).padStart(2, "0") +
    parts[1]!.toString(16).padStart(2, "0") +
    parts[0]!.toString(16).padStart(2, "0");
  return hex.toUpperCase();
}

function portToHex(port: number): string {
  return port.toString(16).padStart(4, "0").toUpperCase();
}

export class OwnedProcessInstance implements MinimaxH3OwnedProcess {
  public readonly pid: number;
  public readonly startTimeTicks: number;
  public readonly address: string;
  public readonly port: number;
  public readonly gpuUuid: string;

  private stdoutBuffer = "";
  private stderrBuffer = "";
  private child: ChildProcess;
  private hasExited = false;
  private readonly expectedPythonPath: string;
  private readonly expectedCwd: string;
  private readonly expectedEntrypoint: string;

  constructor(options: {
    child: ChildProcess;
    startTimeTicks: number;
    address: string;
    port: number;
    gpuUuid: string;
    expectedPythonPath: string;
    expectedCwd: string;
    expectedEntrypoint?: string;
  }) {
    this.child = options.child;
    this.pid = options.child.pid!;
    this.startTimeTicks = options.startTimeTicks;
    this.address = options.address;
    this.port = options.port;
    this.gpuUuid = options.gpuUuid;
    this.expectedPythonPath = options.expectedPythonPath;
    this.expectedCwd = options.expectedCwd;
    this.expectedEntrypoint = options.expectedEntrypoint ?? "main.py";

    this.child.once("exit", () => {
      this.hasExited = true;
    });
    this.child.once("close", () => {
      this.hasExited = true;
    });
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.hasExited = true;
    }

    this.child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString("utf8");
    });
    this.child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString("utf8");
    });
  }

  getStdout(): string {
    return this.stdoutBuffer;
  }

  getStderr(): string {
    return this.stderrBuffer;
  }

  isRunning(): boolean {
    return !this.hasExited && this.child.exitCode === null && this.child.signalCode === null;
  }

  async verifySocketOwnership(): Promise<{ ok: boolean; reason?: string }> {
    // 1. Verify that this process's startTimeTicks still matches /proc/[pid]/stat (detect PID reuse)
    try {
      const statContent = await readFile(`/proc/${this.pid}/stat`, "utf8");
      const currentTicks = parseStartTimeTicksFromStat(statContent);
      if (currentTicks !== this.startTimeTicks) {
        return {
          ok: false,
          reason: `PID ${this.pid} was reused by an unrelated process (start ticks mismatch: expected ${this.startTimeTicks}, got ${currentTicks})`
        };
      }
    } catch (err) {
      return {
        ok: false,
        reason: `Failed to read /proc/${this.pid}/stat: ${(err as Error).message}`
      };
    }

    // 2. Verify exact executable, argv[1]=main.py, and cwd — not merely that
    // some argument happens to end in "main.py", which any unrelated
    // process (e.g. a user's own script named main.py) could satisfy.
    try {
      const cmdline = await readFile(`/proc/${this.pid}/cmdline`, "utf8");
      const args = cmdline.split("\0").filter((s) => s.length > 0);
      const [actualExecutable, actualEntrypoint] = args;
      if (actualExecutable !== this.expectedPythonPath) {
        return {
          ok: false,
          reason: `PID ${this.pid} executable "${actualExecutable ?? ""}" does not match expected interpreter "${this.expectedPythonPath}" (unexpected process identity)`
        };
      }
      if (actualEntrypoint !== this.expectedEntrypoint && actualEntrypoint !== "main.py") {
        return {
          ok: false,
          reason: `PID ${this.pid} entrypoint argument "${actualEntrypoint ?? ""}" does not match expected entrypoint "${this.expectedEntrypoint}" (unexpected process identity)`
        };
      }
    } catch (err) {
      return {
        ok: false,
        reason: `Failed to read /proc/${this.pid}/cmdline: ${(err as Error).message}`
      };
    }

    // 2b. Verify the process's working directory matches the ComfyUI
    // checkout it was launched from.
    try {
      const actualCwd = await realpath(`/proc/${this.pid}/cwd`);
      const expectedCwdResolved = await realpath(this.expectedCwd);
      if (actualCwd !== expectedCwdResolved) {
        return {
          ok: false,
          reason: `PID ${this.pid} cwd "${actualCwd}" does not match expected ComfyUI directory "${expectedCwdResolved}" (unexpected process identity)`
        };
      }
    } catch (err) {
      return {
        ok: false,
        reason: `Failed to verify /proc/${this.pid}/cwd: ${(err as Error).message}`
      };
    }

    // 3. Reject wildcard listening addresses (loopback only)
    if (this.address === "0.0.0.0" || this.address === "::") {
      return {
        ok: false,
        reason: `Listening address ${this.address} is a wildcard address, but only loopback addresses are allowed`
      };
    }

    // 4. Read /proc/[pid]/fd to find all socket inodes owned by this PID
    const ownedSocketInodes = new Set<string>();
    try {
      const fds = await readdir(`/proc/${this.pid}/fd`);
      for (const fd of fds) {
        try {
          const link = await readlink(`/proc/${this.pid}/fd/${fd}`);
          const match = link.match(/^socket:\[(\d+)\]$/);
          if (match && match[1]) {
            ownedSocketInodes.add(match[1]);
          }
        } catch {
          // ignore transient fds
        }
      }
    } catch (err) {
      return {
        ok: false,
        reason: `Failed to read /proc/${this.pid}/fd: ${(err as Error).message}`
      };
    }

    // 5. Inspect /proc/net/tcp and /proc/net/tcp6 for the listening socket
    const expectedPortHex = portToHex(this.port);
    const expectedIpHex = ipToHex(this.address);

    let matchingInode: string | null = null;
    let foundSocketOnPort = false;

    for (const tcpFile of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      try {
        const tcpContent = await readFile(tcpFile, "utf8");
        const lines = tcpContent.split("\n");
        // Line format: sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i]?.trim();
          if (!line) continue;
          const parts = line.split(/\s+/);
          const localAddr = parts[1]; // IP:PORT hex
          const state = parts[3]; // '0A' is TCP_LISTEN
          const inode = parts[9];

          if (localAddr && state === "0A") {
            const [ipHex, portHex] = localAddr.split(":");
            if (portHex?.toUpperCase() === expectedPortHex) {
              foundSocketOnPort = true;
              // Must strictly match expected IP hex, reject 00000000 wildcard
              if (ipHex?.toUpperCase() === expectedIpHex && ipHex !== "00000000") {
                if (inode && ownedSocketInodes.has(inode)) {
                  matchingInode = inode;
                  break;
                }
              }
            }
          }
        }
        if (matchingInode) break;
      } catch {
        // file unreadable or not present
      }
    }

    if (!matchingInode) {
      if (foundSocketOnPort) {
        return {
          ok: false,
          reason: `Socket on port ${this.port} exists but is NOT owned by owned child PID ${this.pid}. Unrelated process detected on port.`
        };
      }
      return {
        ok: false,
        reason: `Could not verify listening socket on ${this.address}:${this.port} owned by PID ${this.pid}`
      };
    }

    return { ok: true };
  }

  async verifyChildEnvironment(): Promise<{ ok: boolean; reason?: string }> {
    try {
      const environBuffer = await readFile(`/proc/${this.pid}/environ`);
      const entries = environBuffer.toString("utf8").split("\0");
      let cudaDevices: string | undefined;

      for (const entry of entries) {
        if (entry.startsWith("CUDA_VISIBLE_DEVICES=")) {
          cudaDevices = entry.substring("CUDA_VISIBLE_DEVICES=".length);
          break;
        }
      }

      if (cudaDevices === undefined) {
        return {
          ok: false,
          reason: `Child PID ${this.pid} environment missing CUDA_VISIBLE_DEVICES.`
        };
      }

      if (cudaDevices !== this.gpuUuid) {
        return {
          ok: false,
          reason: `Child PID ${this.pid} CUDA_VISIBLE_DEVICES mismatch: expected "${this.gpuUuid}", got "${cudaDevices}".`
        };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: `Failed to read child environment from /proc/${this.pid}/environ: ${(err as Error).message}`
      };
    }
  }

  async readActualProcessInfo(): Promise<{
    argv: string[];
    env: Record<string, string>;
    commandLine: string;
  }> {
    try {
      const cmdline = await readFile(`/proc/${this.pid}/cmdline`, "utf8");
      const argv = cmdline.split("\0").filter((s) => s.length > 0);
      const environ = await readFile(`/proc/${this.pid}/environ`, "utf8");
      const envEntries = environ.split("\0").filter((s) => s.length > 0);
      const env: Record<string, string> = {};
      for (const entry of envEntries) {
        const idx = entry.indexOf("=");
        if (idx !== -1) {
          env[entry.substring(0, idx)] = entry.substring(idx + 1);
        }
      }
      return {
        argv,
        env,
        commandLine: argv.join(" ")
      };
    } catch {
      return {
        argv: [],
        env: {},
        commandLine: ""
      };
    }
  }

  private async verifyPidAlive(): Promise<boolean> {
    // this.isRunning() reflects Node's own tracking of the exact child
    // process we spawned (exit/close events, exitCode/signalCode), which
    // cannot be confused with an unrelated process that later reused this
    // PID. Check it first so a dead child is never reported alive.
    if (!this.isRunning()) {
      return false;
    }
    try {
      const statContent = await readFile(`/proc/${this.pid}/stat`, "utf8");
      const currentTicks = parseStartTimeTicksFromStat(statContent);
      return currentTicks === this.startTimeTicks;
    } catch (err) {
      if (
        (err as NodeJS.ErrnoException).code === "ENOENT" ||
        (err as NodeJS.ErrnoException).code === "ESRCH"
      ) {
        return false;
      }
      // /proc is unreadable for some other reason (e.g. a sandboxed
      // environment). Node's own exit tracking above already confirmed
      // this is still our exact spawned child, so there is no PID-reuse
      // ambiguity left to resolve — unlike a bare kill(pid, 0), which
      // cannot tell our child apart from an impostor that reused the PID.
      return true;
    }
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (!this.isRunning() && !(await this.verifyPidAlive())) {
        return true;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return !this.isRunning() && !(await this.verifyPidAlive());
  }

  async stop(timeoutMs = 5000): Promise<void> {
    if (!this.isRunning() && !(await this.verifyPidAlive())) {
      this.hasExited = true;
      return;
    }

    const intWait = Math.max(500, Math.floor(timeoutMs * 0.6));
    const termWait = Math.max(500, Math.floor(timeoutMs * 0.3));
    const killWait = Math.max(500, Math.floor(timeoutMs * 0.2));

    // 1. SIGINT
    if (await this.verifyPidAlive()) {
      try {
        this.child.kill("SIGINT");
      } catch {
        // Process might already be dead
      }
    }
    if (await this.waitForExit(intWait)) {
      this.hasExited = true;
      return;
    }

    // 2. SIGTERM
    if (await this.verifyPidAlive()) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // Process might already be dead
      }
    }
    if (await this.waitForExit(termWait)) {
      this.hasExited = true;
      return;
    }

    // 3. SIGKILL
    if (await this.verifyPidAlive()) {
      try {
        this.child.kill("SIGKILL");
      } catch {
        // Process might already be dead
      }
    }
    if (await this.waitForExit(killWait)) {
      this.hasExited = true;
      return;
    }

    if (await this.verifyPidAlive()) {
      throw new Error(
        `Child PID ${this.pid} could not be terminated after SIGINT/SIGTERM/SIGKILL escalation.`
      );
    }
    this.hasExited = true;
  }
}

export class MinimaxH3ProcessRunner implements MinimaxH3ProcessRunnerPort {
  async spawnChild(options: {
    pythonPath: string;
    comfyUiDir: string;
    address: string;
    port: number;
    dirs: {
      inputDir: string;
      outputDir: string;
      tempDir: string;
      userDir: string;
    };
    argv: readonly string[];
    env: Record<string, string>;
    gpuUuid: string;
    collectorPath?: string;
    runDir?: string;
    runId?: string;
    attemptToken?: string;
  }): Promise<MinimaxH3OwnedProcess> {
    const {
      pythonPath,
      comfyUiDir,
      address,
      port,
      dirs,
      argv,
      env,
      gpuUuid,
      collectorPath,
      runDir,
      runId,
      attemptToken
    } = options;

    let childArgs: string[];
    let expectedEntrypoint = "main.py";

    const commonComfyArgs = [
      "--listen",
      address,
      "--port",
      String(port),
      "--input-directory",
      resolve(dirs.inputDir),
      "--output-directory",
      resolve(dirs.outputDir),
      "--temp-directory",
      resolve(dirs.tempDir),
      "--user-directory",
      resolve(dirs.userDir),
      ...argv
    ];

    if (collectorPath) {
      expectedEntrypoint = collectorPath;
      childArgs = [
        collectorPath,
        "--bootstrap-entrypoint",
        resolve(comfyUiDir, "main.py"),
        ...commonComfyArgs
      ];
    } else {
      childArgs = ["main.py", ...commonComfyArgs];
    }

    const cleanEnv: Record<string, string> = {};
    for (const key of [
      "PATH",
      "HOME",
      "USER",
      "LANG",
      "LC_ALL",
      "TMPDIR",
      "LD_LIBRARY_PATH",
      "PYTHONPATH"
    ]) {
      if (process.env[key] !== undefined) {
        cleanEnv[key] = process.env[key]!;
      }
    }
    Object.assign(cleanEnv, env);
    cleanEnv["CUDA_VISIBLE_DEVICES"] = gpuUuid;

    if (collectorPath) {
      const activeRunDir = resolve(runDir ?? dirs.outputDir);
      cleanEnv["CCO_EXPERIMENT_RUN_DIR"] = activeRunDir;
      cleanEnv["CCO_EXPERIMENT_RUN_ID"] = runId ?? "experiment-run";
      cleanEnv["CCO_EXPERIMENT_ATTEMPT_TOKEN"] = attemptToken ?? "attempt-1";
      cleanEnv["CCO_EXPERIMENT_EVENT_LOG"] = resolve(activeRunDir, "phase-events.jsonl");
    }

    const child = spawn(pythonPath, childArgs, {
      cwd: resolve(comfyUiDir),
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"]
    });

    if (!child.pid) {
      throw new Error(`Failed to spawn child ComfyUI process with ${pythonPath}`);
    }

    // Wait a brief moment to ensure process has started and read start time ticks from /proc/[pid]/stat
    await new Promise((r) => setTimeout(r, 100));

    let startTimeTicks = 0;
    try {
      const statContent = await readFile(`/proc/${child.pid}/stat`, "utf8");
      startTimeTicks = parseStartTimeTicksFromStat(statContent);
    } catch {
      startTimeTicks = Date.now();
    }

    return new OwnedProcessInstance({
      child,
      startTimeTicks,
      address,
      port,
      gpuUuid,
      expectedPythonPath: pythonPath,
      expectedCwd: resolve(comfyUiDir),
      expectedEntrypoint
    });
  }
}
