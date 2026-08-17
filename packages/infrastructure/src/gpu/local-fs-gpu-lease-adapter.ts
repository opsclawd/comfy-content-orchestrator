import { randomUUID } from "node:crypto";
import { link, open, readFile, unlink } from "node:fs/promises";
import os from "node:os";
import type { GpuExecutionLeasePort, GpuLeaseHolder, RenderLease } from "@cco/application";
import { GpuLeaseOwnershipLostError, GpuLeaseUnavailableError } from "@cco/application";

export interface LocalFsGpuLeaseAdapterOptions {
  readonly lockFilePath: string;
  readonly pid?: number;
  readonly hostname?: string;
  readonly now?: () => Date | string;
  readonly createLeaseId?: () => string;
  readonly probeProcess?: (pid: number) => boolean;
}

function isErrno(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === code
  );
}

function isValidHolder(obj: unknown): obj is GpuLeaseHolder {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return false;
  }
  const candidate = obj as Record<string, unknown>;
  if (candidate.version !== 1) {
    return false;
  }
  if (typeof candidate.pid !== "number" || !Number.isInteger(candidate.pid) || candidate.pid <= 0) {
    return false;
  }
  if (
    typeof candidate.startedAt !== "string" ||
    candidate.startedAt.trim().length === 0 ||
    isNaN(Date.parse(candidate.startedAt))
  ) {
    return false;
  }
  if (typeof candidate.hostname !== "string" || candidate.hostname.trim().length === 0) {
    return false;
  }
  if (typeof candidate.leaseId !== "string" || candidate.leaseId.trim().length === 0) {
    return false;
  }
  return true;
}

function defaultProbeProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (isErrno(err, "ESRCH")) {
      return false;
    }
    if (isErrno(err, "EPERM")) {
      return true;
    }
    return true;
  }
}

export class LocalFsGpuLeaseAdapter implements GpuExecutionLeasePort {
  readonly lockFilePath: string;
  readonly pid: number;
  readonly hostname: string;
  private readonly now: () => Date | string;
  private readonly createLeaseId: () => string;
  private readonly probeProcess: (pid: number) => boolean;

  constructor(options: LocalFsGpuLeaseAdapterOptions) {
    if (!options.lockFilePath || options.lockFilePath.trim().length === 0) {
      throw new Error("lockFilePath must be a non-empty string");
    }
    if (options.pid !== undefined && (!Number.isInteger(options.pid) || options.pid <= 0)) {
      throw new Error("pid must be a positive integer");
    }
    if (options.hostname !== undefined && options.hostname.trim().length === 0) {
      throw new Error("hostname must be a non-empty string");
    }

    this.lockFilePath = options.lockFilePath;
    this.pid = options.pid ?? process.pid;
    this.hostname = options.hostname ?? os.hostname();
    this.now = options.now ?? (() => new Date().toISOString());
    this.createLeaseId = options.createLeaseId ?? (() => randomUUID());
    this.probeProcess = options.probeProcess ?? defaultProbeProcess;
  }

  private getIsoNow(): string {
    const raw = this.now();
    return typeof raw === "string" ? raw : raw.toISOString();
  }

  private isProcessLive(pid: number): boolean {
    try {
      const res = this.probeProcess(pid);
      return Boolean(res);
    } catch (err: unknown) {
      if (isErrno(err, "ESRCH")) {
        return false;
      }
      if (isErrno(err, "EPERM")) {
        return true;
      }
      return true;
    }
  }

  private async readHolder(filePath: string): Promise<GpuLeaseHolder | null | undefined> {
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (err: unknown) {
      if (isErrno(err, "ENOENT")) {
        return undefined;
      }
      return null;
    }

    try {
      const trimmed = content.trim();
      if (!trimmed) {
        return null;
      }
      const parsed = JSON.parse(trimmed);
      if (isValidHolder(parsed)) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async writeAtomicLock(filePath: string, holder: GpuLeaseHolder): Promise<void> {
    const tempPath = `${filePath}.${this.pid}.${randomUUID()}.tmp`;
    try {
      const handle = await open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(holder)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(tempPath, filePath);
    } finally {
      try {
        await unlink(tempPath);
      } catch (err: unknown) {
        if (!isErrno(err, "ENOENT")) {
          // ignore cleanup error
        }
      }
    }
  }

  async acquireLease(): Promise<RenderLease> {
    while (true) {
      const holder: GpuLeaseHolder = {
        version: 1,
        pid: this.pid,
        startedAt: this.getIsoNow(),
        hostname: this.hostname,
        leaseId: this.createLeaseId()
      };

      try {
        await this.writeAtomicLock(this.lockFilePath, holder);
        return this.createRenderLease(holder);
      } catch (err: unknown) {
        if (!isErrno(err, "EEXIST")) {
          throw err;
        }
      }

      // EEXIST: lock file already exists
      const currentHolder = await this.readHolder(this.lockFilePath);
      if (currentHolder === undefined) {
        // Lock file was released between writeAtomicLock and readHolder: retry acquisition loop
        continue;
      }
      if (currentHolder === null) {
        throw new GpuLeaseUnavailableError(
          `GPU lease at ${this.lockFilePath} is unavailable due to malformed or unreadable metadata`
        );
      }

      if (currentHolder.hostname !== this.hostname) {
        throw new GpuLeaseUnavailableError(
          `GPU lease at ${this.lockFilePath} is currently held by process on host ${currentHolder.hostname} (PID ${currentHolder.pid})`,
          currentHolder
        );
      }

      const isLive = this.isProcessLive(currentHolder.pid);
      if (isLive) {
        throw new GpuLeaseUnavailableError(
          `GPU lease at ${this.lockFilePath} is currently held by live PID ${currentHolder.pid}`,
          currentHolder
        );
      }

      // Current holder is dead (ESRCH). Reclaim under reclaim guard.
      await this.reclaimDeadHolder();
    }
  }

  private async reclaimDeadHolder(): Promise<void> {
    const reclaimPath = `${this.lockFilePath}.reclaim`;
    let guardHolder: GpuLeaseHolder | null = null;

    while (guardHolder === null) {
      const candidateGuard: GpuLeaseHolder = {
        version: 1,
        pid: this.pid,
        startedAt: this.getIsoNow(),
        hostname: this.hostname,
        leaseId: this.createLeaseId()
      };

      try {
        await this.writeAtomicLock(reclaimPath, candidateGuard);
        guardHolder = candidateGuard;
      } catch (err: unknown) {
        if (!isErrno(err, "EEXIST")) {
          throw err;
        }

        // Reclaim guard already exists: check its liveness
        const currentGuard = await this.readHolder(reclaimPath);
        if (currentGuard === undefined) {
          // Reclaim guard was released/unlinked between writeAtomicLock and readHolder: retry acquiring guard
          continue;
        }
        if (currentGuard === null) {
          throw new GpuLeaseUnavailableError(
            `GPU reclaim guard at ${reclaimPath} is held with malformed metadata`
          );
        }

        if (currentGuard.hostname !== this.hostname) {
          throw new GpuLeaseUnavailableError(
            `GPU reclaim guard at ${reclaimPath} is currently held by reclaimer on host ${currentGuard.hostname} (PID ${currentGuard.pid})`,
            currentGuard
          );
        }

        const guardLive = this.isProcessLive(currentGuard.pid);
        if (guardLive) {
          throw new GpuLeaseUnavailableError(
            `GPU reclaim guard at ${reclaimPath} is currently held by active reclaimer PID ${currentGuard.pid}`,
            currentGuard
          );
        }

        // Orphaned reclaim guard from dead reclaimer (ESRCH): unlink and retry guard acquisition
        try {
          await unlink(reclaimPath);
        } catch (unlinkErr: unknown) {
          if (!isErrno(unlinkErr, "ENOENT")) {
            throw unlinkErr;
          }
        }
      }
    }

    try {
      // Owned reclaim guard: reread and reprobe the primary lock before unlinking
      const recheckHolder = await this.readHolder(this.lockFilePath);
      if (recheckHolder === undefined) {
        // Lock file is already gone (released or unlinked)
        return;
      }
      if (recheckHolder === null) {
        // File exists on disk but is malformed -> do not unlink!
        throw new GpuLeaseUnavailableError(
          `GPU lease at ${this.lockFilePath} contains malformed metadata`
        );
      }

      if (recheckHolder.hostname !== this.hostname) {
        throw new GpuLeaseUnavailableError(
          `GPU lease at ${this.lockFilePath} is currently held by process on host ${recheckHolder.hostname} (PID ${recheckHolder.pid})`,
          recheckHolder
        );
      }

      const stillLive = this.isProcessLive(recheckHolder.pid);
      if (stillLive) {
        throw new GpuLeaseUnavailableError(
          `GPU lease at ${this.lockFilePath} is currently held by live PID ${recheckHolder.pid}`,
          recheckHolder
        );
      }

      try {
        await unlink(this.lockFilePath);
      } catch (unlinkErr: unknown) {
        if (!isErrno(unlinkErr, "ENOENT")) {
          throw unlinkErr;
        }
      }
    } finally {
      // Release reclaim guard
      try {
        const onDiskGuard = await this.readHolder(reclaimPath);
        if (onDiskGuard && onDiskGuard.leaseId === guardHolder.leaseId) {
          await unlink(reclaimPath);
        }
      } catch {
        // ignore errors in finally cleanup
      }
    }
  }

  private createRenderLease(holder: GpuLeaseHolder): RenderLease {
    let released = false;

    return {
      holder: Object.freeze({ ...holder }),
      release: async (): Promise<void> => {
        if (released) {
          return;
        }

        let fileContent: string;
        try {
          fileContent = await readFile(this.lockFilePath, "utf8");
        } catch (err: unknown) {
          if (isErrno(err, "ENOENT")) {
            released = true;
            return;
          }
          throw err;
        }

        let onDiskHolder: GpuLeaseHolder | null = null;
        try {
          const parsed = JSON.parse(fileContent.trim());
          if (isValidHolder(parsed)) {
            onDiskHolder = parsed;
          }
        } catch {
          throw new GpuLeaseOwnershipLostError(
            `Cannot release GPU lease: lock file at ${this.lockFilePath} contains invalid metadata`
          );
        }

        if (!onDiskHolder || onDiskHolder.leaseId !== holder.leaseId) {
          throw new GpuLeaseOwnershipLostError(
            `GPU lease ownership lost: current lease ID is ${onDiskHolder?.leaseId ?? "unknown"}, expected ${holder.leaseId}`
          );
        }

        try {
          await unlink(this.lockFilePath);
        } catch (err: unknown) {
          if (!isErrno(err, "ENOENT")) {
            throw err;
          }
        }

        released = true;
      }
    };
  }
}
