import type { Pool, PoolClient } from "pg";

export interface RecoverInterruptedPlanningRunsLogger {
  info(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface RecoverInterruptedPlanningRunsOptions {
  readonly pool?:
    | Pool
    | PoolClient
    | {
        query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ scene_id: string }> }>;
      }
    | undefined;
  readonly queryRunner?: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<{ scene_id: string }> }> | undefined;
  readonly asOf?: Date | undefined;
  readonly failureReason?: string | undefined;
  readonly logger?: RecoverInterruptedPlanningRunsLogger | undefined;
}

export const DEFAULT_PLANNING_INTERRUPTED_REASON =
  "Shot-plan generation was interrupted by service restart";

/**
 * Identifies storyboard scenes with expired planning leases, transitioning them
 * to 'failed' with a durable failure reason and clearing the planning run marker.
 *
 * This recovery sweep is atomic and fenced by lease expiration:
 * - Unrelated candidate generation (active_planning_run_id IS NULL) is untouched.
 * - Active planning runs on peer instances (expires_at > asOf) are untouched.
 * - Already failed or completed scenes are untouched.
 * - Repeated execution is idempotent.
 */
export async function recoverInterruptedPlanningRuns(
  options: RecoverInterruptedPlanningRunsOptions = {}
): Promise<string[]> {
  const runner =
    options.queryRunner ?? (options.pool ? options.pool.query.bind(options.pool) : undefined);
  if (!runner) {
    return [];
  }

  const asOf = options.asOf ?? new Date();
  const failureReason = options.failureReason ?? DEFAULT_PLANNING_INTERRUPTED_REASON;

  const sql = `
    UPDATE storyboard_scenes s
    SET
      status = 'failed',
      failed_from = 'generating_candidates',
      failure_reason = $1,
      active_planning_run_id = NULL,
      active_planning_expires_at = NULL,
      updated_at = CURRENT_TIMESTAMP
    WHERE s.status = 'generating_candidates'
      AND s.active_planning_run_id IS NOT NULL
      AND s.active_planning_expires_at IS NOT NULL
      AND s.active_planning_expires_at <= $2
    RETURNING s.scene_id;
  `;

  try {
    const result = await runner(sql, [failureReason, asOf]);
    const recoveredIds = (result?.rows ?? []).map((row) => row.scene_id);
    if (recoveredIds.length > 0) {
      const logFn = options.logger?.warn ?? options.logger?.info;
      logFn?.(
        `Recovered ${recoveredIds.length} interrupted shot planning run(s) to 'failed': ${recoveredIds.join(", ")}`
      );
    }
    return recoveredIds;
  } catch (err) {
    options.logger?.error(
      `Failed to run interrupted shot planning recovery sweep: ${
        err instanceof Error ? err.message : String(err)
      }`,
      err
    );
    throw err;
  }
}

export interface PlanningRecoveryReaper {
  readonly isRunning: boolean;
  stop(): void;
  runNow(asOf?: Date): Promise<string[]>;
}

export interface StartPlanningRecoveryReaperOptions extends RecoverInterruptedPlanningRunsOptions {
  readonly intervalMs?: number | undefined;
}

/**
 * Starts a recurring background lease-reaper that periodically identifies and atomically
 * transitions expired planner runs from 'generating_candidates' to 'failed'.
 *
 * This guarantees that interrupted runs whose leases had not yet expired during
 * startup recovery do not remain stuck in 'generating_candidates' indefinitely.
 */
export function startPlanningRecoveryReaper(
  options: StartPlanningRecoveryReaperOptions
): PlanningRecoveryReaper {
  const intervalMs = options.intervalMs ?? 5_000;
  let running = false;
  let stopped = false;

  const sweep = async (asOf?: Date): Promise<string[]> => {
    if (running || stopped) {
      return [];
    }
    running = true;
    try {
      return await recoverInterruptedPlanningRuns({
        ...options,
        ...(asOf !== undefined ? { asOf } : {})
      });
    } catch {
      // recovery sweep errors are already logged by recoverInterruptedPlanningRuns
      return [];
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void sweep();
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    get isRunning() {
      return !stopped;
    },
    stop: () => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
    },
    runNow: sweep
  };
}
