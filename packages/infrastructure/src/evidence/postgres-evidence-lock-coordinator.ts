import type { Pool, PoolClient } from "pg";
import type { EvidenceLockCoordinatorPort, EvidenceLockSession } from "@cco/application";

export class PostgresEvidenceLockCoordinator implements EvidenceLockCoordinatorPort {
  private readonly maxConcurrentSessions: number;
  private activeSessions = 0;
  private readonly admissionWaiters: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(
    private readonly pool: Pool,
    private readonly lockTimeoutMs: number = 10000,
    maxConcurrentSessions?: number
  ) {
    const poolMax = (this.pool as unknown as { readonly options?: { readonly max?: number } })
      ?.options?.max;
    if (typeof poolMax === "number" && poolMax < 2) {
      throw new Error(
        `Postgres connection pool capacity (${poolMax}) is insufficient. Minimum pool capacity of 2 connections is required to avoid pool exhaustion.`
      );
    }
    const calculatedMax = typeof poolMax === "number" ? Math.max(1, Math.floor(poolMax / 2)) : 5;
    this.maxConcurrentSessions = maxConcurrentSessions ?? calculatedMax;
  }

  private async acquireAdmissionTicket(): Promise<() => void> {
    if (this.activeSessions < this.maxConcurrentSessions) {
      this.activeSessions++;
      return () => this.releaseAdmissionTicket();
    }

    let timer!: NodeJS.Timeout;
    return new Promise<() => void>((resolve, reject) => {
      timer = setTimeout(() => {
        const idx = this.admissionWaiters.findIndex((w) => w.timer === timer);
        if (idx !== -1) {
          this.admissionWaiters.splice(idx, 1);
        }
        reject(
          new Error(`Timed out after ${this.lockTimeoutMs}ms waiting for lock session admission`)
        );
      }, this.lockTimeoutMs);

      this.admissionWaiters.push({
        resolve: () => {
          clearTimeout(timer);
          this.activeSessions++;
          resolve(() => this.releaseAdmissionTicket());
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
        timer
      });
    });
  }

  private releaseAdmissionTicket(): void {
    this.activeSessions--;
    if (this.admissionWaiters.length > 0) {
      const next = this.admissionWaiters.shift()!;
      next.resolve();
    }
  }

  async withLockSession<T>(
    clientId: string,
    action: (session: EvidenceLockSession) => Promise<T>
  ): Promise<T> {
    const releaseTicket = await this.acquireAdmissionTicket();
    try {
      const connectTimeoutMs = this.lockTimeoutMs;
      let timer: NodeJS.Timeout | undefined;
      let timedOut = false;

      const connectPromise = this.pool.connect();
      connectPromise.then(
        (lateClient) => {
          if (timedOut) {
            try {
              lateClient.release();
            } catch {
              // Best-effort release of late-acquired connection
            }
          }
        },
        () => {
          // Ignore errors for timed-out connection attempts
        }
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(
            new Error(
              `Timed out after ${connectTimeoutMs}ms waiting for database connection from pool`
            )
          );
        }, connectTimeoutMs);
      });

      let client: PoolClient;
      try {
        client = await Promise.race([connectPromise, timeoutPromise]);
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }

      const acquiredLocks: Array<{ type: "command" | "source"; key: string }> = [];
      let destroyConnection = false;

      try {
        await client.query(`SET lock_timeout = '${this.lockTimeoutMs}ms'`);

        const session: EvidenceLockSession = {
          acquireCommandLock: async (actionId: string) => {
            await client.query(
              `SELECT pg_advisory_lock(hashtext('evidence_command_lock'), hashtext($1 || '::' || $2))`,
              [clientId, actionId]
            );
            acquiredLocks.push({ type: "command", key: actionId });
          },
          acquireSourceLock: async (sha256: string) => {
            await client.query(
              `SELECT pg_advisory_lock(hashtext('evidence_source_lock'), hashtext($1 || '::' || $2))`,
              [clientId, sha256]
            );
            acquiredLocks.push({ type: "source", key: sha256 });
          }
        };

        return await action(session);
      } finally {
        for (const lock of acquiredLocks.reverse()) {
          try {
            const unlockSql =
              lock.type === "command"
                ? `SELECT pg_advisory_unlock(hashtext('evidence_command_lock'), hashtext($1 || '::' || $2)) AS unlocked`
                : `SELECT pg_advisory_unlock(hashtext('evidence_source_lock'), hashtext($1 || '::' || $2)) AS unlocked`;
            const res = await client.query<{ unlocked: boolean }>(unlockSql, [clientId, lock.key]);
            if (res.rows[0]?.unlocked !== true) {
              destroyConnection = true;
            }
          } catch {
            destroyConnection = true;
          }
        }

        try {
          await client.query(`RESET lock_timeout`);
        } catch {
          destroyConnection = true;
        }

        client.release(destroyConnection);
      }
    } finally {
      releaseTicket();
    }
  }

  async withSourceLock<T>(clientId: string, sha256: string, action: () => Promise<T>): Promise<T> {
    return await this.withLockSession(clientId, async (session) => {
      await session.acquireSourceLock(sha256);
      return await action();
    });
  }

  async withCommandLock<T>(
    clientId: string,
    actionId: string,
    action: () => Promise<T>
  ): Promise<T> {
    return await this.withLockSession(clientId, async (session) => {
      await session.acquireCommandLock(actionId);
      return await action();
    });
  }
}

export class InMemoryEvidenceLockCoordinator implements EvidenceLockCoordinatorPort {
  private readonly queues = new Map<string, Promise<void>>();

  async withLockSession<T>(
    clientId: string,
    action: (session: EvidenceLockSession) => Promise<T>
  ): Promise<T> {
    const releases: Array<() => void> = [];
    const session: EvidenceLockSession = {
      acquireCommandLock: async (actionId: string) => {
        const release = await this.acquireKey(`${clientId}::cmd::${actionId}`);
        releases.push(release);
      },
      acquireSourceLock: async (sha256: string) => {
        const release = await this.acquireKey(`${clientId}::source::${sha256}`);
        releases.push(release);
      }
    };

    try {
      return await action(session);
    } finally {
      for (const release of releases.reverse()) {
        release();
      }
    }
  }

  async withSourceLock<T>(clientId: string, sha256: string, action: () => Promise<T>): Promise<T> {
    return await this.withLockSession(clientId, async (session) => {
      await session.acquireSourceLock(sha256);
      return await action();
    });
  }

  async withCommandLock<T>(
    clientId: string,
    actionId: string,
    action: () => Promise<T>
  ): Promise<T> {
    return await this.withLockSession(clientId, async (session) => {
      await session.acquireCommandLock(actionId);
      return await action();
    });
  }

  private async acquireKey(key: string): Promise<() => void> {
    let release!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      release = resolve;
    });

    const previousLock = this.queues.get(key) ?? Promise.resolve();
    const chained = previousLock.then(
      () => currentLock,
      () => currentLock
    );
    this.queues.set(key, chained);

    await previousLock.catch(() => {});
    return () => {
      release();
      if (this.queues.get(key) === chained) {
        this.queues.delete(key);
      }
    };
  }
}
