import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { PostgresEvidenceLockCoordinator } from "./postgres-evidence-lock-coordinator.js";

describe("PostgresEvidenceLockCoordinator", () => {
  it("acquires lock, resets lock_timeout, and releases connection cleanly", async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_unlock")) {
        return { rows: [{ unlocked: true }] };
      }
      return { rows: [] };
    });
    const mockRelease = vi.fn();
    const mockClient = {
      query: mockQuery,
      release: mockRelease
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    const coordinator = new PostgresEvidenceLockCoordinator(mockPool, 5000);
    const result = await coordinator.withSourceLock("client-1", "hash-1", async () => "ok");

    expect(result).toBe("ok");
    expect(mockQuery).toHaveBeenCalledWith("SET lock_timeout = '5000ms'");
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_lock"), [
      "client-1",
      "hash-1"
    ]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_unlock"), [
      "client-1",
      "hash-1"
    ]);
    expect(mockQuery).toHaveBeenCalledWith("RESET lock_timeout");
    expect(mockRelease).toHaveBeenCalledWith(false);
  });

  it("destroys connection (release(true)) if unlock fails", async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_unlock")) {
        throw new Error("Unlock error");
      }
      return { rows: [] };
    });
    const mockRelease = vi.fn();
    const mockClient = {
      query: mockQuery,
      release: mockRelease
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    const coordinator = new PostgresEvidenceLockCoordinator(mockPool, 5000);
    const result = await coordinator.withCommandLock("client-1", "action-1", async () => "result");

    expect(result).toBe("result");
    expect(mockRelease).toHaveBeenCalledWith(true);
  });

  it("coordinates command and source locks on a single dedicated connection", async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_unlock")) {
        return { rows: [{ unlocked: true }] };
      }
      return { rows: [] };
    });
    const mockRelease = vi.fn();
    const mockClient = {
      query: mockQuery,
      release: mockRelease
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    const coordinator = new PostgresEvidenceLockCoordinator(mockPool, 5000);
    const result = await coordinator.withLockSession("client-1", async (session) => {
      await session.acquireCommandLock("action-1");
      await session.acquireSourceLock("hash-1");
      return "done";
    });

    expect(result).toBe("done");
    // Verifies only 1 connection was acquired from the pool
    expect(mockPool.connect).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("evidence_command_lock"), [
      "client-1",
      "action-1"
    ]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("evidence_source_lock"), [
      "client-1",
      "hash-1"
    ]);
    expect(mockRelease).toHaveBeenCalledWith(false);
  });

  it("observes and releases any connection delivered after connect timeout", async () => {
    let resolveDelayedConnect!: (client: PoolClient) => void;
    const delayedConnectPromise = new Promise<PoolClient>((resolve) => {
      resolveDelayedConnect = resolve;
    });

    const mockRelease = vi.fn();
    const mockClient = {
      query: vi.fn(),
      release: mockRelease
    } as unknown as PoolClient;

    const mockPool = {
      connect: vi.fn().mockReturnValue(delayedConnectPromise)
    } as unknown as Pool;

    const coordinator = new PostgresEvidenceLockCoordinator(mockPool, 20);

    await expect(
      coordinator.withSourceLock("client-1", "hash-1", async () => "ok")
    ).rejects.toThrow("Timed out after 20ms waiting for database connection from pool");

    // Connection becomes available late after the timeout:
    resolveDelayedConnect(mockClient);
    // Allow the promise resolution microtasks to process
    await new Promise((r) => setTimeout(r, 10));

    expect(mockRelease).toHaveBeenCalled();
  });

  it("rejects pool when capacity is less than 2 connections", () => {
    const mockPool = {
      options: { max: 1 },
      connect: vi.fn()
    } as unknown as Pool;

    expect(() => new PostgresEvidenceLockCoordinator(mockPool, 5000)).toThrow(
      "Minimum pool capacity of 2 connections is required to avoid pool exhaustion"
    );
  });

  it("enforces admission control to reserve publishing connections on a 2-connection pool", async () => {
    const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_unlock")) {
        return { rows: [{ unlocked: true }] };
      }
      return { rows: [] };
    });
    const mockRelease = vi.fn();
    const mockClient = {
      query: mockQuery,
      release: mockRelease
    } as unknown as PoolClient;

    const mockPool = {
      options: { max: 2 },
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    // With max: 2, maxConcurrentSessions is Math.floor(2 / 2) = 1
    const coordinator = new PostgresEvidenceLockCoordinator(mockPool, 5000);

    let session1Running = false;
    let session2Started = false;
    let resolveSession1!: () => void;
    const session1Promise = new Promise<void>((resolve) => {
      resolveSession1 = resolve;
    });

    const run1 = coordinator.withLockSession("client-1", async () => {
      session1Running = true;
      await session1Promise;
      session1Running = false;
      return "res1";
    });

    // Wait until session 1 has acquired the session ticket
    while (!session1Running) {
      await new Promise((r) => setTimeout(r, 5));
    }

    const run2 = coordinator.withLockSession("client-1", async () => {
      session2Started = true;
      // Session 1 must have completed before session 2 is admitted!
      expect(session1Running).toBe(false);
      return "res2";
    });

    // Give microtasks time to attempt run2
    await new Promise((r) => setTimeout(r, 20));
    expect(session2Started).toBe(false);

    // Release session 1
    resolveSession1();

    const [res1, res2] = await Promise.all([run1, run2]);
    expect(res1).toBe("res1");
    expect(res2).toBe("res2");
    expect(session2Started).toBe(true);
  });

  it("times out if admission ticket is not granted within lockTimeoutMs", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ unlocked: true }] });
    const mockClient = {
      query: mockQuery,
      release: vi.fn()
    } as unknown as PoolClient;

    const mockPool = {
      options: { max: 2 },
      connect: vi.fn().mockResolvedValue(mockClient)
    } as unknown as Pool;

    const coordinator = new PostgresEvidenceLockCoordinator(mockPool, 50);

    let resolveSession1!: () => void;
    const session1Promise = new Promise<void>((resolve) => {
      resolveSession1 = resolve;
    });

    const run1 = coordinator.withLockSession("client-1", async () => {
      await session1Promise;
      return "res1";
    });

    // run2 should time out waiting for admission
    await expect(coordinator.withLockSession("client-1", async () => "res2")).rejects.toThrow(
      "Timed out after 50ms waiting for lock session admission"
    );

    resolveSession1();
    await run1;
  });
});
