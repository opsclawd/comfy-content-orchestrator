import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, stat, unlink, writeFile, statfs } from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  type MinimaxH3TargetSpecification,
  type MinimaxH3RequiredRuntimeManifest,
  PINNED_COMFYUI_CORE_REVISION,
  PINNED_COMFYUI_SOURCE_HASHES
} from "@cco/contracts";
import type { MinimaxH3TargetPreflightPort } from "@cco/application";
import {
  type ExperimentRuntimeRegistry,
  defaultExperimentRuntimeRegistry,
  type ExperimentRuntimeVerificationResult
} from "./minimax-h3-runtime-registry.js";

const execFileAsync = promisify(execFile);

export { PINNED_COMFYUI_CORE_REVISION };

export class MinimaxH3TargetPreflight implements MinimaxH3TargetPreflightPort {
  private runtimeRegistry: ExperimentRuntimeRegistry;

  constructor(options: { runtimeRegistry?: ExperimentRuntimeRegistry } = {}) {
    this.runtimeRegistry = options.runtimeRegistry ?? defaultExperimentRuntimeRegistry;
  }

  // Deletes lockPath only if it still holds expectedToken AND the path
  // still resolves to the exact inode we read that token from --
  // plain read-token-then-unlink-by-path has a window between the
  // read and the unlink where another process can replace the file
  // (e.g. legitimately re-acquiring a lock it also found stale),
  // and a bare path-based unlink in that window deletes the NEW
  // process's lock, not the stale one this call actually verified.
  // Binding the delete to the inode observed at read time closes that
  // window down to the gap between the second stat and the unlink
  // itself -- not perfectly atomic (true atomicity needs OS-level
  // advisory locking such as flock(), which this file-based scheme
  // doesn't use), but it means a same-path replacement can no longer
  // be silently deleted out from under its new owner.
  private async unlinkLockFileIfTokenMatches(
    lockPath: string,
    expectedToken: string
  ): Promise<void> {
    let handle;
    try {
      handle = await open(lockPath, "r");
    } catch {
      return; // already gone
    }
    try {
      const observedStat = await handle.stat();
      const raw = await handle.readFile("utf8");
      const parsed = JSON.parse(raw) as { lockToken?: string };
      if (parsed.lockToken !== expectedToken) {
        return;
      }
      let currentStat;
      try {
        currentStat = await stat(lockPath);
      } catch {
        return; // already gone/replaced-then-removed
      }
      if (currentStat.dev !== observedStat.dev || currentStat.ino !== observedStat.ino) {
        return; // path now points at a different file -- don't touch it
      }
      await unlink(lockPath);
    } catch {
      // malformed JSON, or unlink raced with another deletion -- ignore
    } finally {
      await handle.close();
    }
  }

  async checkTargetHost(
    target: MinimaxH3TargetSpecification
  ): Promise<{ ok: boolean; blocker?: string }> {
    const currentHostname = os.hostname();
    if (target.hostname !== currentHostname && target.hostname !== "localhost") {
      return {
        ok: false,
        blocker: `Host mismatch: target specified "${target.hostname}", but running on "${currentHostname}". Harness must run locally on the intended render host.`
      };
    }

    if (!target.gpuUuid || !target.gpuUuid.startsWith("GPU-")) {
      return {
        ok: false,
        blocker: `Invalid GPU UUID format: "${target.gpuUuid}". Must specify a physical NVIDIA GPU UUID.`
      };
    }

    try {
      const { stdout } = await execFileAsync(
        "nvidia-smi",
        ["--query-gpu=gpu_uuid,utilization.gpu", "--format=csv,noheader,nounits"],
        { timeout: 5000 }
      );
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0);
      const matching = lines.find((line) => line.includes(target.gpuUuid));
      if (!matching) {
        return {
          ok: false,
          blocker: `GPU with UUID "${target.gpuUuid}" was not found on host according to nvidia-smi.`
        };
      }
      const parts = matching.split(",").map((s) => s.trim());
      const util = parseInt(parts[1] || "", 10);
      if (Number.isNaN(util)) {
        // Malformed/unparseable utilization reading — fail closed rather
        // than silently treating an unreadable GPU state as idle.
        return {
          ok: false,
          blocker: `GPU "${target.gpuUuid}" utilization reading from nvidia-smi was malformed ("${parts[1] ?? ""}"); cannot confirm idle state.`
        };
      }
      if (util > 5) {
        return {
          ok: false,
          blocker: `GPU "${target.gpuUuid}" is currently busy (utilization: ${util}%). Exclusive access requires an idle GPU.`
        };
      }
    } catch (err) {
      const message = (err as Error).message;
      if (message.includes("was not found on host") || message.includes("is currently busy")) {
        throw err;
      }
      // Only tolerate the binary itself being absent (e.g. unit test
      // environment without a GPU). Any other failure — nvidia-smi ran but
      // errored, timed out, or produced an unexpected shape — must fail
      // closed instead of silently treating an unverifiable GPU as idle.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        return {
          ok: false,
          blocker: `Failed to verify GPU "${target.gpuUuid}" idle state via nvidia-smi: ${message}`
        };
      }
    }

    return { ok: true };
  }

  async acquireGpuLock(
    _outputRoot: string,
    gpuUuid: string,
    pid: number,
    processStartTimeTicks?: number
  ): Promise<{
    acquired: boolean;
    release: () => Promise<void>;
    blocker?: string;
    lockToken?: string;
    processStartTimeTicks?: number | null;
  }> {
    const lockDir = resolve(os.tmpdir(), "cco-gpu-locks");
    await mkdir(lockDir, { recursive: true });
    const lockPath = resolve(lockDir, `gpu-${gpuUuid}.lock`);

    let startTicks = processStartTimeTicks ?? null;
    if (startTicks === null) {
      try {
        const statContent = await readFile(`/proc/${pid}/stat`, "utf8");
        const lastParenIndex = statContent.lastIndexOf(")");
        if (lastParenIndex !== -1) {
          const fields = statContent
            .substring(lastParenIndex + 1)
            .trim()
            .split(/\s+/);
          const t = parseInt(fields[19] || "", 10);
          if (!Number.isNaN(t)) startTicks = t;
        }
      } catch {
        // ignore if not running on Linux /proc
      }
    }

    const lockToken = `${pid}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const lockRecord = {
      pid,
      processStartTimeTicks: startTicks,
      lockToken,
      acquiredAt: new Date().toISOString(),
      gpuUuid
    };

    let acquired = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await writeFile(lockPath, JSON.stringify(lockRecord, null, 2), { flag: "wx" });
        acquired = true;
        break;
      } catch (writeErr) {
        if ((writeErr as NodeJS.ErrnoException).code !== "EEXIST") {
          return {
            acquired: false,
            release: async () => {},
            blocker: `Failed to write GPU lock file at ${lockPath}: ${(writeErr as Error).message}`
          };
        }

        // Lock file already exists - inspect whether stale
        try {
          const existingRaw = await readFile(lockPath, "utf8");
          let existing: {
            pid?: number;
            processStartTimeTicks?: number | null;
            lockToken?: string;
          };
          try {
            existing = JSON.parse(existingRaw);
          } catch {
            return {
              acquired: false,
              release: async () => {},
              blocker: `Corrupted or unreadable GPU lock file at ${lockPath}`
            };
          }

          if (!existing || typeof existing.pid !== "number" || !existing.lockToken) {
            return {
              acquired: false,
              release: async () => {},
              blocker: `Corrupted GPU lock record at ${lockPath}`
            };
          }

          let isAlive = false;
          try {
            process.kill(existing.pid, 0);
            isAlive = true;
          } catch (killErr) {
            if ((killErr as NodeJS.ErrnoException).code === "ESRCH") {
              isAlive = false;
            } else if ((killErr as NodeJS.ErrnoException).code === "EPERM") {
              isAlive = true; // Process exists but belongs to another user
            } else {
              isAlive = false;
            }
          }

          if (isAlive && existing.processStartTimeTicks) {
            try {
              const statContent = await readFile(`/proc/${existing.pid}/stat`, "utf8");
              const lastParenIndex = statContent.lastIndexOf(")");
              if (lastParenIndex !== -1) {
                const fields = statContent
                  .substring(lastParenIndex + 1)
                  .trim()
                  .split(/\s+/);
                const currentTicks = parseInt(fields[19] || "", 10);
                if (
                  !Number.isNaN(currentTicks) &&
                  currentTicks !== existing.processStartTimeTicks
                ) {
                  isAlive = false; // PID was reused!
                }
              }
            } catch (statErr) {
              if (
                (statErr as NodeJS.ErrnoException).code === "ENOENT" ||
                (statErr as NodeJS.ErrnoException).code === "ESRCH"
              ) {
                isAlive = false;
              } else {
                isAlive = true; // Fail closed if /proc is unreadable
              }
            }
          }

          if (isAlive) {
            return {
              acquired: false,
              release: async () => {},
              blocker: `GPU "${gpuUuid}" is currently locked by active process PID ${existing.pid}. Exclusive access is required.`
            };
          }

          // Stale lock: clean it up only if lockToken matches and attempt re-acquire
          if (existing.lockToken) {
            await this.unlinkLockFileIfTokenMatches(lockPath, existing.lockToken);
          }
        } catch (checkErr) {
          return {
            acquired: false,
            release: async () => {},
            blocker: `Failed to inspect GPU lock at ${lockPath}: ${(checkErr as Error).message}`
          };
        }
      }
    }

    if (!acquired) {
      return {
        acquired: false,
        release: async () => {},
        blocker: `Failed to acquire GPU lock at ${lockPath} due to contention.`
      };
    }

    const release = async (): Promise<void> => {
      await this.unlinkLockFileIfTokenMatches(lockPath, lockToken);
    };

    return { acquired: true, release, lockToken, processStartTimeTicks: startTicks };
  }

  async releaseGpuLock(
    gpuUuid: string,
    expectedPid?: number,
    expectedStartTimeTicks?: number,
    expectedLockToken?: string
  ): Promise<{ released: boolean; reason?: string }> {
    const lockDir = resolve(os.tmpdir(), "cco-gpu-locks");
    const lockPath = resolve(lockDir, `gpu-${gpuUuid}.lock`);
    let handle;
    try {
      handle = await open(lockPath, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { released: true };
      }
      return { released: false, reason: (err as Error).message };
    }
    try {
      const observedStat = await handle.stat();
      const content = await handle.readFile("utf8");
      const record = JSON.parse(content) as {
        pid?: number;
        launcherPid?: number;
        childPid?: number | null;
        processStartTimeTicks?: number | null;
        lockToken?: string;
      };
      if (expectedLockToken && record.lockToken && record.lockToken !== expectedLockToken) {
        return { released: false, reason: "Lock token mismatch" };
      }
      if (expectedPid !== undefined) {
        const matchesLauncher = record.pid === expectedPid || record.launcherPid === expectedPid;
        const matchesChild = record.childPid === expectedPid;
        if (!matchesLauncher && !matchesChild) {
          return {
            released: false,
            reason: `Lock PID ${record.pid} does not match expected PID ${expectedPid}`
          };
        }
      }
      if (
        expectedStartTimeTicks !== undefined &&
        record.processStartTimeTicks &&
        record.processStartTimeTicks !== expectedStartTimeTicks
      ) {
        return { released: false, reason: "Lock ticks do not match expected ticks" };
      }
      // Same read-then-unlink TOCTOU guard as
      // unlinkLockFileIfTokenMatches above: confirm the path still
      // resolves to the exact file we just validated before deleting
      // it, so a replacement written between the read and the unlink
      // (e.g. a legitimate new acquisition) can't be deleted out from
      // under its new owner.
      let currentStat;
      try {
        currentStat = await stat(lockPath);
      } catch {
        return { released: true }; // already gone
      }
      if (currentStat.dev !== observedStat.dev || currentStat.ino !== observedStat.ino) {
        return { released: false, reason: "Lock file was replaced before it could be released" };
      }
      await unlink(lockPath);
      return { released: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return { released: true };
      }
      return { released: false, reason: (err as Error).message };
    } finally {
      await handle.close();
    }
  }

  async checkPortAvailable(
    address: string,
    port: number
  ): Promise<{ ok: boolean; blocker?: string }> {
    return new Promise((res) => {
      const server = net.createServer();
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          res({
            ok: false,
            blocker: `Target socket address ${address}:${port} is already in use by another process.`
          });
        } else {
          res({
            ok: false,
            blocker: `Cannot bind target socket ${address}:${port}: ${err.message}`
          });
        }
      });

      server.once("listening", () => {
        server.close(() => {
          res({ ok: true });
        });
      });

      server.listen(port, address);
    });
  }

  async verifyCheckout(comfyUiDir: string): Promise<{
    ok: boolean;
    revision: string;
    nodesPresent: boolean;
    cleanTree?: boolean;
    sourceHashes?: {
      cliArgsSha256: string;
      mainSha256: string;
      modelManagementSha256: string;
    };
    blocker?: string;
  }> {
    const resolvedDir = resolve(comfyUiDir);

    let revision = "";
    try {
      const { stdout } = await execFileAsync("git", ["-C", resolvedDir, "rev-parse", "HEAD"]);
      revision = stdout.trim();
    } catch (err) {
      return {
        ok: false,
        revision: "",
        nodesPresent: false,
        blocker: `Failed to read git commit revision from ComfyUI directory at ${resolvedDir}: ${(err as Error).message}`
      };
    }

    if (revision !== PINNED_COMFYUI_CORE_REVISION) {
      return {
        ok: false,
        revision,
        nodesPresent: false,
        blocker: `ComfyUI checkout revision mismatch: expected ${PINNED_COMFYUI_CORE_REVISION}, got ${revision}`
      };
    }

    try {
      const { stdout: statusOut } = await execFileAsync("git", [
        "-C",
        resolvedDir,
        "status",
        "--porcelain"
      ]);
      if (statusOut.trim().length > 0) {
        return {
          ok: false,
          revision,
          nodesPresent: false,
          cleanTree: false,
          blocker: `ComfyUI checkout at ${resolvedDir} is dirty; clean working tree required.`
        };
      }
    } catch {
      // if git status fails, allow proceeding with source hash checks
    }

    const nodesPath = resolve(resolvedDir, "comfy_extras/nodes_minimax_h3.py");
    try {
      const content = await readFile(nodesPath, "utf8");
      const hasI2vNode = content.includes("MiniMaxH3ImageToVideo");
      const hasRef2vNode = content.includes("MiniMaxH3ReferenceToVideo");

      if (!hasI2vNode || !hasRef2vNode) {
        return {
          ok: false,
          revision,
          nodesPresent: false,
          blocker: `comfy_extras/nodes_minimax_h3.py does not define required native nodes (MiniMaxH3ImageToVideo, MiniMaxH3ReferenceToVideo)`
        };
      }
    } catch (err) {
      return {
        ok: false,
        revision,
        nodesPresent: false,
        blocker: `Failed to find comfy_extras/nodes_minimax_h3.py in ${resolvedDir}: ${(err as Error).message}`
      };
    }

    // Read and hash actual source files
    let cliArgsSha256 = "";
    let mainSha256 = "";
    let modelManagementSha256 = "";
    try {
      const cliArgsPath = resolve(resolvedDir, "comfy/cli_args.py");
      const cliArgsContent = await readFile(cliArgsPath);
      cliArgsSha256 = createHash("sha256").update(cliArgsContent).digest("hex");

      const mainPath = resolve(resolvedDir, "main.py");
      const mainContent = await readFile(mainPath);
      mainSha256 = createHash("sha256").update(mainContent).digest("hex");

      const mmPath = resolve(resolvedDir, "comfy/model_management.py");
      const mmContent = await readFile(mmPath);
      modelManagementSha256 = createHash("sha256").update(mmContent).digest("hex");
    } catch (err) {
      return {
        ok: false,
        revision,
        nodesPresent: true,
        blocker: `Failed to read and hash ComfyUI source files in ${resolvedDir}: ${(err as Error).message}`
      };
    }

    if (cliArgsSha256 !== PINNED_COMFYUI_SOURCE_HASHES.cliArgsSha256) {
      return {
        ok: false,
        revision,
        nodesPresent: true,
        blocker: `comfy/cli_args.py SHA-256 hash mismatch: expected ${PINNED_COMFYUI_SOURCE_HASHES.cliArgsSha256}, got ${cliArgsSha256}`
      };
    }
    if (mainSha256 !== PINNED_COMFYUI_SOURCE_HASHES.mainSha256) {
      return {
        ok: false,
        revision,
        nodesPresent: true,
        blocker: `main.py SHA-256 hash mismatch: expected ${PINNED_COMFYUI_SOURCE_HASHES.mainSha256}, got ${mainSha256}`
      };
    }
    if (modelManagementSha256 !== PINNED_COMFYUI_SOURCE_HASHES.modelManagementSha256) {
      return {
        ok: false,
        revision,
        nodesPresent: true,
        blocker: `comfy/model_management.py SHA-256 hash mismatch: expected ${PINNED_COMFYUI_SOURCE_HASHES.modelManagementSha256}, got ${modelManagementSha256}`
      };
    }

    return {
      ok: true,
      revision,
      nodesPresent: true,
      cleanTree: true,
      sourceHashes: {
        cliArgsSha256,
        mainSha256,
        modelManagementSha256
      }
    };
  }

  async verifyModels(
    comfyUiDir: string,
    modelSpecs: Record<string, { expectedHash: string; sizeBytes?: number }>
  ): Promise<{
    ok: boolean;
    resolvedPaths: Record<
      string,
      { expectedHash: string; resolvedPath: string; sizeBytes: number }
    >;
    blocker?: string;
  }> {
    const resolvedPaths: Record<
      string,
      { expectedHash: string; resolvedPath: string; sizeBytes: number }
    > = {};

    for (const [key, spec] of Object.entries(modelSpecs)) {
      const candidatePath = resolve(comfyUiDir, "models", key);
      let foundPath = "";

      try {
        await stat(candidatePath);
        foundPath = candidatePath;
      } catch {
        if (key.includes("text_encoders/")) {
          const altKey = key.replace("text_encoders/", "clip/");
          const altPath = resolve(comfyUiDir, "models", altKey);
          try {
            await stat(altPath);
            foundPath = altPath;
          } catch {
            // not found
          }
        } else if (key.includes("clip/")) {
          const altKey = key.replace("clip/", "text_encoders/");
          const altPath = resolve(comfyUiDir, "models", altKey);
          try {
            await stat(altPath);
            foundPath = altPath;
          } catch {
            // not found
          }
        }
      }

      if (!foundPath) {
        return {
          ok: false,
          resolvedPaths: {},
          blocker: `Required model file not found in ComfyUI models directory: ${key}`
        };
      }

      const st = await stat(foundPath);
      if (!st.isFile()) {
        return {
          ok: false,
          resolvedPaths: {},
          blocker: `Model path is not a regular file: ${foundPath}`
        };
      }
      if (spec.sizeBytes && st.size !== spec.sizeBytes) {
        return {
          ok: false,
          resolvedPaths: {},
          blocker: `Model file size mismatch for ${key}: expected ${spec.sizeBytes} bytes, got ${st.size} bytes`
        };
      }

      // Hash the file incrementally with streaming to avoid readFile 2GB buffer limits
      const hash = createHash("sha256");
      try {
        const stream = createReadStream(foundPath, { highWaterMark: 1024 * 1024 });
        for await (const chunk of stream) {
          hash.update(chunk);
        }
      } catch (streamErr) {
        return {
          ok: false,
          resolvedPaths: {},
          blocker: `Failed to stream hash model file ${foundPath}: ${(streamErr as Error).message}`
        };
      }
      const actualSha = hash.digest("hex");

      const st2 = await stat(foundPath);
      if (
        st2.size !== st.size ||
        st2.mtimeMs !== st.mtimeMs ||
        st2.ino !== st.ino ||
        st2.dev !== st.dev
      ) {
        return {
          ok: false,
          resolvedPaths: {},
          blocker: `Model file was modified during hashing: ${foundPath}`
        };
      }

      if (actualSha !== spec.expectedHash) {
        return {
          ok: false,
          resolvedPaths: {},
          blocker: `Model SHA-256 hash mismatch for ${key}: expected ${spec.expectedHash}, got ${actualSha}`
        };
      }

      resolvedPaths[key] = {
        expectedHash: spec.expectedHash,
        resolvedPath: foundPath,
        sizeBytes: st.size
      };
    }

    return { ok: true, resolvedPaths };
  }

  async verifyDiskSpace(
    targetDir: string,
    minFreeGb: number
  ): Promise<{ ok: boolean; freeGb: number | null; blocker?: string }> {
    try {
      const stats = await statfs(targetDir);
      const freeBytes = stats.bavail * stats.bsize;
      const freeGb = freeBytes / (1024 * 1024 * 1024);

      if (freeGb < minFreeGb) {
        return {
          ok: false,
          freeGb,
          blocker: `Insufficient free disk space in ${targetDir}: required ${minFreeGb} GB, available ${freeGb.toFixed(2)} GB`
        };
      }
      return { ok: true, freeGb };
    } catch (err) {
      return {
        ok: false,
        // null, not 0 — statfs failed, so capacity is genuinely unknown,
        // not "confirmed zero bytes free". A caller logging/persisting
        // this value must be able to tell "unverifiable" apart from
        // "actually full".
        freeGb: null,
        blocker: `Failed to verify disk space at ${targetDir}: ${(err as Error).message}`
      };
    }
  }

  async verifyEnvironmentTools(
    pythonPath: string,
    ffmpegPath = "ffmpeg"
  ): Promise<{ ok: boolean; pythonVersion?: string; ffmpegVersion?: string; blocker?: string }> {
    let pythonVersion = "";
    try {
      const { stdout, stderr } = await execFileAsync(pythonPath, ["--version"], { timeout: 5000 });
      pythonVersion = (stdout || stderr).trim();
      if (!pythonVersion.toLowerCase().includes("python 3")) {
        return {
          ok: false,
          blocker: `Python interpreter at "${pythonPath}" must be Python 3.x, got: "${pythonVersion}"`
        };
      }
    } catch (err) {
      return {
        ok: false,
        blocker: `Failed to execute Python interpreter at "${pythonPath}": ${(err as Error).message}`
      };
    }

    let ffmpegVersion = "";
    try {
      const { stdout } = await execFileAsync(ffmpegPath, ["-version"], { timeout: 5000 });
      const firstLine = stdout.split("\n")[0] || "";
      ffmpegVersion = firstLine.trim();
      if (!firstLine.includes("7.0.2")) {
        return {
          ok: false,
          pythonVersion,
          ffmpegVersion,
          blocker: `FFmpeg version mismatch: expected 7.0.2 (pinned in .ffmpeg-version), got: "${firstLine}"`
        };
      }
    } catch (err) {
      return {
        ok: false,
        pythonVersion,
        blocker: `Failed to execute FFmpeg at "${ffmpegPath}": ${(err as Error).message}`
      };
    }

    return {
      ok: true,
      pythonVersion,
      ffmpegVersion
    };
  }

  async verifyExperimentRuntime(options: {
    comfyUiDir: string;
    pythonPath: string;
    requiredRuntime: MinimaxH3RequiredRuntimeManifest;
    requiredRuntimeDigest: string;
  }): Promise<ExperimentRuntimeVerificationResult> {
    return this.runtimeRegistry.verify(options);
  }
}
