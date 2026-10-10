import type {
  PlanShotPlansUseCase,
  PlanShotPlansInput,
  PlanShotPlansAdmissionResult
} from "@cco/application";
import type { SceneId } from "@cco/domain";
import {
  recoverInterruptedPlanningRuns,
  startPlanningRecoveryReaper,
  type RecoverInterruptedPlanningRunsOptions,
  type PlanningRecoveryReaper,
  type StartPlanningRecoveryReaperOptions
} from "@cco/infrastructure";

export interface ShotPlanPlanningLogger {
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn?(message: string, ...args: unknown[]): void;
}

export type StartRecoveryReaperOptions = StartPlanningRecoveryReaperOptions;
export type { PlanningRecoveryReaper };

export interface ShotPlanPlanningCoordinatorDeps {
  readonly planShotPlansUseCase: PlanShotPlansUseCase;
  readonly logger?: ShotPlanPlanningLogger | undefined;
  readonly recoveryReaperOptions?: StartRecoveryReaperOptions | undefined;
}

export interface InFlightPlanningTask {
  readonly sceneId: string;
  readonly specRevision: number;
  readonly runId?: string | undefined;
  readonly promise: Promise<void>;
  readonly abortController: AbortController;
  readonly startedAt: number;
}

export type RecoverInterruptedRunsOptions = RecoverInterruptedPlanningRunsOptions;

export class ShotPlanPlanningCoordinator {
  private readonly inFlightTasks = new Map<string, InFlightPlanningTask>();
  private recoveryReaper?: PlanningRecoveryReaper | undefined;

  constructor(private readonly deps: ShotPlanPlanningCoordinatorDeps) {
    if (deps.recoveryReaperOptions) {
      this.startRecoveryReaper(deps.recoveryReaperOptions);
    }
  }

  /**
   * Identifies storyboard scenes with expired planning leases, transitioning them
   * to 'failed' on startup to prevent indefinite stalls after process restart.
   */
  static async recoverInterruptedRuns(
    options: RecoverInterruptedRunsOptions = {}
  ): Promise<string[]> {
    return recoverInterruptedPlanningRuns(options);
  }

  /**
   * Starts a recurring background lease-reaper that periodically identifies and atomically
   * transitions expired planner runs from 'generating_candidates' to 'failed'.
   */
  static startRecoveryReaper(options: StartRecoveryReaperOptions): PlanningRecoveryReaper {
    return startPlanningRecoveryReaper(options);
  }

  startRecoveryReaper(options: StartRecoveryReaperOptions): PlanningRecoveryReaper {
    this.stopRecoveryReaper();
    const reaper = startPlanningRecoveryReaper({
      ...options,
      logger: options.logger ?? this.deps.logger
    });
    this.recoveryReaper = reaper;
    return reaper;
  }

  stopRecoveryReaper(): void {
    if (this.recoveryReaper) {
      this.recoveryReaper.stop();
      this.recoveryReaper = undefined;
    }
  }

  getRecoveryReaper(): PlanningRecoveryReaper | undefined {
    return this.recoveryReaper;
  }

  async recoverInterruptedRuns(options: RecoverInterruptedRunsOptions = {}): Promise<string[]> {
    return ShotPlanPlanningCoordinator.recoverInterruptedRuns({
      ...options,
      logger: options.logger ?? this.deps.logger
    });
  }

  isInFlight(sceneId: SceneId | string): boolean {
    return this.inFlightTasks.has(String(sceneId));
  }

  getInFlightPromise(sceneId: SceneId | string): Promise<void> | undefined {
    return this.inFlightTasks.get(String(sceneId))?.promise;
  }

  async waitForAllInFlight(): Promise<void> {
    const tasks = Array.from(this.inFlightTasks.values()).map((t) => t.promise);
    await Promise.allSettled(tasks);
  }

  async prepareAdmission(input: PlanShotPlansInput): Promise<PlanShotPlansAdmissionResult> {
    const sceneIdStr = String(input.sceneId);

    // If an identical task is already in flight for this scene in this process, return admitted response
    const existing = this.inFlightTasks.get(sceneIdStr);
    if (existing) {
      const variantCount = input.variantCount ?? 2;
      return {
        kind: "admitted",
        sceneId: input.sceneId,
        status: "generating_candidates",
        specRevision: existing.specRevision,
        variantCount,
        runId: existing.runId ?? "",
        isDuplicate: true,
        input: { ...input, variantCount }
      };
    }

    const admission = await this.deps.planShotPlansUseCase.prepareAdmission(input);
    if (admission.kind === "replay") {
      return admission;
    }

    if (admission.isDuplicate || this.inFlightTasks.has(sceneIdStr)) {
      return admission;
    }

    // Launch background task decoupled from HTTP lifecycle
    this.startPlanningTask(
      admission.sceneId,
      admission.specRevision,
      admission.input,
      admission.runId
    );

    return admission;
  }

  startPlanningTask(
    sceneId: SceneId | string,
    specRevision: number,
    input: PlanShotPlansInput & { readonly variantCount: number },
    runId?: string
  ): Promise<void> {
    const sceneIdStr = String(sceneId);
    const existing = this.inFlightTasks.get(sceneIdStr);
    if (existing) {
      return existing.promise;
    }

    const abortController = new AbortController();
    const taskPromise = (async () => {
      try {
        await this.deps.planShotPlansUseCase.executePlanningPipeline(
          sceneId,
          specRevision,
          input,
          runId,
          abortController.signal
        );
      } catch (err) {
        this.deps.logger?.error(
          `Background shot planning failed for scene '${sceneIdStr}': ${
            err instanceof Error ? err.message : String(err)
          }`,
          err
        );
      } finally {
        this.inFlightTasks.delete(sceneIdStr);
      }
    })();

    this.inFlightTasks.set(sceneIdStr, {
      sceneId: sceneIdStr,
      specRevision,
      runId,
      promise: taskPromise,
      abortController,
      startedAt: Date.now()
    });

    return taskPromise;
  }

  async shutdown(timeoutMs: number = 5000): Promise<void> {
    this.stopRecoveryReaper();

    const pendingTasks = Array.from(this.inFlightTasks.values());
    if (pendingTasks.length === 0) {
      return;
    }

    this.deps.logger?.info(
      `Shutting down shot planning coordinator: aborting ${pendingTasks.length} in-flight task(s)...`
    );

    // 1. Immediately signal abort on all in-flight tasks so they cancel network calls
    // and record their failure state to Postgres before connection pool closure.
    for (const task of pendingTasks) {
      try {
        task.abortController.abort(new Error("Coordinator shutting down"));
      } catch {
        // ignore abort errors
      }
    }

    // 2. Wait for all tasks to settle within timeoutMs
    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeoutTimer = setTimeout(() => resolve("timeout"), timeoutMs);
    });

    const completionPromise = Promise.allSettled(pendingTasks.map((t) => t.promise)).then(
      () => "completed" as const
    );

    const outcome = await Promise.race([completionPromise, timeoutPromise]);
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }

    if (outcome === "timeout") {
      const remaining = this.inFlightTasks.size;
      this.deps.logger?.warn?.(
        `ShotPlanPlanningCoordinator shutdown timed out with ${remaining} task(s) still in-flight.`
      );
    } else {
      this.deps.logger?.info("All in-flight shot planning tasks settled before shutdown.");
    }
  }
}
