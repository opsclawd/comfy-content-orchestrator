import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile, readFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GpuLeaseOwnershipLostError,
  GpuLeaseUnavailableError,
  type GpuLeaseHolder
} from "@cco/application";
import { LocalFsGpuLeaseAdapter } from "./local-fs-gpu-lease-adapter.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const tsxBin = resolve(__dirname, "../../node_modules/.bin/tsx");
const childScriptPath = resolve(__dirname, "test-support/local-fs-gpu-lease-child.ts");

describe("LocalFsGpuLeaseAdapter", () => {
  let tempDir: string;
  const spawnedChildren: ChildProcess[] = [];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cco-gpu-lease-test-"));
  });

  afterEach(async () => {
    for (const child of spawnedChildren) {
      if (!child.killed) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }
    spawnedChildren.length = 0;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  function spawnChild(mode: "acquire" | "hold", lockFilePath: string, holdDurationMs?: number) {
    const args = [childScriptPath, mode, lockFilePath];
    if (holdDurationMs !== undefined) {
      args.push(String(holdDurationMs));
    }
    const child = spawn(tsxBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    spawnedChildren.push(child);

    let stdout = "";
    let stderr = "";
    let resolveLine:
      ((val: { status: string; holder?: GpuLeaseHolder; raw: string }) => void) | null = null;
    const linePromise = new Promise<{
      status: string;
      holder?: GpuLeaseHolder;
      raw: string;
    }>((res) => {
      resolveLine = res;
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const lines = stdout.split("\n");
      if (lines.length > 1 && resolveLine) {
        const line = lines[0] ?? "";
        try {
          const parsed = JSON.parse(line);
          resolveLine({ ...parsed, raw: line });
        } catch {
          resolveLine({ status: "unknown", raw: line });
        }
        resolveLine = null;
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const exitPromise = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
      stdout: string;
      stderr: string;
    }>((res) => {
      child.on("exit", (code, signal) => {
        if (resolveLine) {
          const firstLine = stdout.trim().split("\n")[0] ?? "";
          try {
            const parsed = JSON.parse(firstLine);
            resolveLine({ ...parsed, raw: firstLine });
          } catch {
            resolveLine({ status: "exited_without_json", raw: stdout });
          }
          resolveLine = null;
        }
        res({ code, signal, stdout, stderr });
      });
    });

    return {
      child,
      waitForFirstLine: () => linePromise,
      waitForExit: () => exitPromise
    };
  }

  it("acquires an absent lock atomically and records diagnostic holder metadata", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const adapter = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      pid: 12345,
      hostname: "test-host",
      now: () => "2026-08-16T12:00:00.000Z",
      createLeaseId: () => "lease-abc-123"
    });

    const lease = await adapter.acquireLease();
    expect(lease.holder).toEqual({
      version: 1,
      pid: 12345,
      startedAt: "2026-08-16T12:00:00.000Z",
      hostname: "test-host",
      leaseId: "lease-abc-123"
    });

    const onDiskRaw = await readFile(lockFilePath, "utf8");
    const onDisk = JSON.parse(onDiskRaw.trim());
    expect(onDisk).toEqual(lease.holder);

    // Verify temp files are cleaned up
    const dirFiles = await readdir(tempDir);
    expect(dirFiles.filter((f) => f.endsWith(".tmp"))).toHaveLength(0);

    await lease.release();
  });

  it("rejects a second process while a live holder owns the lease", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const child = spawnChild("hold", lockFilePath, 10000);
    const firstLine = await child.waitForFirstLine();
    expect(firstLine.status).toBe("acquired");
    expect(firstLine.holder).toBeDefined();

    const contender = new LocalFsGpuLeaseAdapter({ lockFilePath });
    await expect(contender.acquireLease()).rejects.toThrow(GpuLeaseUnavailableError);

    try {
      await contender.acquireLease();
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(GpuLeaseUnavailableError);
      const unavail = err as GpuLeaseUnavailableError;
      expect(unavail.holder?.pid).toBe(firstLine.holder?.pid);
      expect(unavail.holder?.leaseId).toBe(firstLine.holder?.leaseId);
    }

    child.child.kill("SIGKILL");
    await child.waitForExit();
  });

  it("releases an owned lease so a later process can acquire it", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const adapter1 = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      createLeaseId: () => "lease-1"
    });
    const adapter2 = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      createLeaseId: () => "lease-2"
    });

    const lease1 = await adapter1.acquireLease();
    expect(lease1.holder.leaseId).toBe("lease-1");

    await lease1.release();

    const lease2 = await adapter2.acquireLease();
    expect(lease2.holder.leaseId).toBe("lease-2");
    await lease2.release();
  });

  it("reclaims a dead holder under an atomic reclaim guard", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const staleHolder: GpuLeaseHolder = {
      version: 1,
      pid: 99999,
      startedAt: "2026-08-15T00:00:00.000Z",
      hostname: "same-host",
      leaseId: "stale-lease-1"
    };
    await writeFile(lockFilePath, `${JSON.stringify(staleHolder)}\n`, "utf8");

    const adapter = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      pid: 4242,
      hostname: "same-host",
      now: () => "2026-08-16T12:00:00.000Z",
      createLeaseId: () => "reclaimed-lease",
      probeProcess: (pid: number) => (pid === 99999 ? false : true)
    });

    const lease = await adapter.acquireLease();
    expect(lease.holder.leaseId).toBe("reclaimed-lease");
    expect(lease.holder.pid).toBe(4242);

    await expect(readFile(`${lockFilePath}.reclaim`, "utf8")).rejects.toThrow();

    await lease.release();
  });

  it("treats locks held by a different hostname as live without probing local PID", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const remoteHolder: GpuLeaseHolder = {
      version: 1,
      pid: 99999,
      startedAt: "2026-08-15T00:00:00.000Z",
      hostname: "remote-host",
      leaseId: "remote-lease-1"
    };
    await writeFile(lockFilePath, `${JSON.stringify(remoteHolder)}\n`, "utf8");

    let probeCalled = false;
    const adapter = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      pid: 4242,
      hostname: "local-host",
      probeProcess: (_pid: number) => {
        probeCalled = true;
        return false;
      }
    });

    await expect(adapter.acquireLease()).rejects.toThrow(GpuLeaseUnavailableError);
    expect(probeCalled).toBe(false);
  });

  it("fails closed for malformed or unreadable lease metadata", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    await writeFile(lockFilePath, "{ malformed json \n", "utf8");

    const adapter = new LocalFsGpuLeaseAdapter({ lockFilePath });
    await expect(adapter.acquireLease()).rejects.toThrow(GpuLeaseUnavailableError);

    const content = await readFile(lockFilePath, "utf8");
    expect(content).toBe("{ malformed json \n");
  });

  it("treats EPERM liveness checks as a live holder", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const holder: GpuLeaseHolder = {
      version: 1,
      pid: 54321,
      startedAt: "2026-08-15T00:00:00.000Z",
      hostname: "root-host",
      leaseId: "root-lease"
    };
    await writeFile(lockFilePath, `${JSON.stringify(holder)}\n`, "utf8");

    const adapter = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      hostname: "root-host",
      probeProcess: (_pid: number) => {
        const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
    });

    await expect(adapter.acquireLease()).rejects.toThrow(GpuLeaseUnavailableError);

    const content = await readFile(lockFilePath, "utf8");
    expect(JSON.parse(content.trim())).toEqual(holder);
  });

  it("does not remove a replacement lease when an old release token is used", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const adapter1 = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      createLeaseId: () => "lease-old"
    });
    const lease1 = await adapter1.acquireLease();

    const replacementHolder: GpuLeaseHolder = {
      version: 1,
      pid: 8888,
      startedAt: "2026-08-16T12:00:00.000Z",
      hostname: "replacement-host",
      leaseId: "lease-replacement"
    };
    await writeFile(lockFilePath, `${JSON.stringify(replacementHolder)}\n`, "utf8");

    await expect(lease1.release()).rejects.toThrow(GpuLeaseOwnershipLostError);

    const onDisk = JSON.parse((await readFile(lockFilePath, "utf8")).trim());
    expect(onDisk).toEqual(replacementHolder);
  });

  it("allows release to be called twice without deleting another lease", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const adapter1 = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      createLeaseId: () => "lease-1"
    });
    const lease1 = await adapter1.acquireLease();

    await lease1.release();

    const adapter2 = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      createLeaseId: () => "lease-2"
    });
    const lease2 = await adapter2.acquireLease();

    await expect(lease1.release()).resolves.toBeUndefined();

    const onDisk = JSON.parse((await readFile(lockFilePath, "utf8")).trim());
    expect(onDisk.leaseId).toBe("lease-2");

    await lease2.release();
  });

  it("permits only one winner when separate processes contend for the same stale lock", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const staleHolder: GpuLeaseHolder = {
      version: 1,
      pid: 9999999,
      startedAt: "2026-08-15T00:00:00.000Z",
      hostname: os.hostname(),
      leaseId: "dead-lease"
    };
    await writeFile(lockFilePath, `${JSON.stringify(staleHolder)}\n`, "utf8");

    const child1 = spawnChild("hold", lockFilePath, 1000);
    const child2 = spawnChild("hold", lockFilePath, 1000);

    const [exit1, exit2] = await Promise.all([child1.waitForExit(), child2.waitForExit()]);

    const exitCodes = [exit1.code, exit2.code].sort();
    expect(exitCodes).toEqual([0, 73]);
  });

  it("recovers an orphaned stale reclaim guard when a previous reclaimer died abruptly", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const staleHolder: GpuLeaseHolder = {
      version: 1,
      pid: 99991,
      startedAt: "2026-08-15T00:00:00.000Z",
      hostname: "shared-host",
      leaseId: "stale-holder-lease"
    };
    await writeFile(lockFilePath, `${JSON.stringify(staleHolder)}\n`, "utf8");

    const staleGuardHolder: GpuLeaseHolder = {
      version: 1,
      pid: 99992,
      startedAt: "2026-08-15T00:01:00.000Z",
      hostname: "shared-host",
      leaseId: "stale-guard-lease"
    };
    await writeFile(`${lockFilePath}.reclaim`, `${JSON.stringify(staleGuardHolder)}\n`, "utf8");

    const adapter = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      pid: 5555,
      hostname: "shared-host",
      now: () => "2026-08-16T12:00:00.000Z",
      createLeaseId: () => "successful-lease",
      probeProcess: (pid: number) => (pid === 99991 || pid === 99992 ? false : true)
    });

    const lease = await adapter.acquireLease();
    expect(lease.holder.leaseId).toBe("successful-lease");
    expect(lease.holder.pid).toBe(5555);

    await expect(readFile(`${lockFilePath}.reclaim`, "utf8")).rejects.toThrow();

    await lease.release();
  });

  it("treats reclaim guard held by a different hostname as live without probing local PID", async () => {
    const lockFilePath = join(tempDir, "gpu.lock");
    const staleHolder: GpuLeaseHolder = {
      version: 1,
      pid: 99991,
      startedAt: "2026-08-15T00:00:00.000Z",
      hostname: "local-host",
      leaseId: "stale-holder-lease"
    };
    await writeFile(lockFilePath, `${JSON.stringify(staleHolder)}\n`, "utf8");

    const remoteGuardHolder: GpuLeaseHolder = {
      version: 1,
      pid: 99992,
      startedAt: "2026-08-15T00:01:00.000Z",
      hostname: "remote-reclaimer-host",
      leaseId: "remote-guard-lease"
    };
    await writeFile(`${lockFilePath}.reclaim`, `${JSON.stringify(remoteGuardHolder)}\n`, "utf8");

    const probeCalls: number[] = [];
    const adapter = new LocalFsGpuLeaseAdapter({
      lockFilePath,
      pid: 5555,
      hostname: "local-host",
      probeProcess: (pid: number) => {
        probeCalls.push(pid);
        return false;
      }
    });

    await expect(adapter.acquireLease()).rejects.toThrow(GpuLeaseUnavailableError);
    // Primary lock was probed because hostname matched, but remote reclaim guard was NOT probed
    expect(probeCalls).toEqual([99991]);
    expect(await readFile(`${lockFilePath}.reclaim`, "utf8")).toBeDefined();
  });
});
