import { describe, expect, it, vi } from "vitest";
import { ShotPlanPlanningCoordinator } from "./shot-plan-planning-coordinator.js";
import type { PlanShotPlansUseCase } from "@cco/application";
import type { SceneId } from "@cco/domain";

describe("ShotPlanPlanningCoordinator", () => {
  const sceneId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899" as SceneId;

  it("handles admission, starts in-flight background task, and finishes", async () => {
    let pipelineResolve: () => void = () => {};
    const pipelinePromise = new Promise<void>((resolve) => {
      pipelineResolve = resolve;
    });

    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "admitted",
        sceneId,
        status: "generating_candidates",
        specRevision: 1,
        variantCount: 2,
        input: { sceneId, variantCount: 2 }
      }),
      executePlanningPipeline: vi.fn().mockImplementation(async () => {
        await pipelinePromise;
        return [];
      })
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase
    });

    expect(coordinator.isInFlight(sceneId)).toBe(false);

    const admission = await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    expect(admission.kind).toBe("admitted");
    expect(coordinator.isInFlight(sceneId)).toBe(true);

    // Repeated admission while in flight returns admitted without second pipeline
    const repeatAdmission = await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    expect(repeatAdmission.kind).toBe("admitted");
    expect(mockUseCase.prepareAdmission).toHaveBeenCalledTimes(1);

    // Complete pipeline
    pipelineResolve();
    await coordinator.getInFlightPromise(sceneId);

    expect(coordinator.isInFlight(sceneId)).toBe(false);
  });

  it("returns replay without starting background task", async () => {
    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "replay",
        sceneId,
        status: "draft_pending",
        specRevision: 1,
        shotPlans: []
      }),
      executePlanningPipeline: vi.fn()
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase
    });

    const result = await coordinator.prepareAdmission({ sceneId });
    expect(result.kind).toBe("replay");
    expect(coordinator.isInFlight(sceneId)).toBe(false);
    expect(mockUseCase.executePlanningPipeline).not.toHaveBeenCalled();
  });

  it("catches background errors, logs them, and removes task from in-flight", async () => {
    const errorLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    };

    let rejectPipeline: (err: Error) => void = () => {};
    const pipelinePromise = new Promise<never>((_, reject) => {
      rejectPipeline = reject;
    });

    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "admitted",
        sceneId,
        status: "generating_candidates",
        specRevision: 1,
        variantCount: 2,
        input: { sceneId, variantCount: 2 }
      }),
      executePlanningPipeline: vi.fn().mockImplementation(() => pipelinePromise)
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase,
      logger: errorLogger
    });

    await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    expect(coordinator.isInFlight(sceneId)).toBe(true);

    rejectPipeline(new Error("Planner failure"));
    await coordinator.getInFlightPromise(sceneId);

    expect(coordinator.isInFlight(sceneId)).toBe(false);
    expect(errorLogger.error).toHaveBeenCalledWith(
      expect.stringContaining("Background shot planning failed for scene"),
      expect.any(Error)
    );
  });

  it("waits for in-flight tasks during graceful shutdown and triggers abort signal promptly", async () => {
    let capturedSignal: AbortSignal | undefined;
    let pipelineResolve: () => void = () => {};
    const pipelinePromise = new Promise<void>((resolve) => {
      pipelineResolve = resolve;
    });

    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "admitted",
        sceneId,
        status: "generating_candidates",
        specRevision: 1,
        variantCount: 2,
        runId: "run-uuid-1",
        isDuplicate: false,
        input: { sceneId, variantCount: 2 }
      }),
      executePlanningPipeline: vi
        .fn()
        .mockImplementation(
          async (_sceneId, _specRevision, _input, _runId, signal: AbortSignal) => {
            capturedSignal = signal;
            await pipelinePromise;
            return [];
          }
        )
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase
    });

    await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    const shutdownPromise = coordinator.shutdown(2000);
    // Upon shutdown(), the signal should be aborted immediately
    expect(capturedSignal?.aborted).toBe(true);

    pipelineResolve();
    await shutdownPromise;

    expect(coordinator.isInFlight(sceneId)).toBe(false);
  });

  it("handles peer-instance duplicate active lease without launching duplicate task", async () => {
    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "admitted",
        sceneId,
        status: "generating_candidates",
        specRevision: 1,
        variantCount: 2,
        runId: "peer-run-id",
        isDuplicate: true,
        input: { sceneId, variantCount: 2 }
      }),
      executePlanningPipeline: vi.fn()
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase
    });

    const result = await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    expect(result.kind).toBe("admitted");
    expect(coordinator.isInFlight(sceneId)).toBe(false);
    expect(mockUseCase.executePlanningPipeline).not.toHaveBeenCalled();
  });

  it("wires runId from admission into executePlanningPipeline", async () => {
    const runId = "durable-run-123";
    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "admitted",
        sceneId,
        status: "generating_candidates",
        specRevision: 1,
        variantCount: 2,
        runId,
        isDuplicate: false,
        input: { sceneId, variantCount: 2 }
      }),
      executePlanningPipeline: vi.fn().mockResolvedValue([])
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase
    });

    await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    await coordinator.waitForAllInFlight();

    expect(mockUseCase.executePlanningPipeline).toHaveBeenCalledWith(
      sceneId,
      1,
      expect.objectContaining({ sceneId, variantCount: 2 }),
      runId,
      expect.any(AbortSignal)
    );
  });

  it("recovers interrupted runs by updating stuck scenes", async () => {
    const mockQueryRunner = vi.fn().mockResolvedValue({
      rows: [{ scene_id: "scene-1" }, { scene_id: "scene-2" }]
    });

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const recovered = await ShotPlanPlanningCoordinator.recoverInterruptedRuns({
      queryRunner: mockQueryRunner,
      logger
    });

    expect(mockQueryRunner).toHaveBeenCalledTimes(1);
    expect(recovered).toEqual(["scene-1", "scene-2"]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Recovered 2 interrupted shot planning run(s)")
    );
  });

  it("starts recurring recovery reaper, executes sweeps, and stops on shutdown", async () => {
    const mockQueryRunner = vi.fn().mockResolvedValue({
      rows: [{ scene_id: "scene-expired-1" }]
    });

    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    const mockUseCase: Partial<PlanShotPlansUseCase> = {};

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase,
      logger
    });

    const reaper = coordinator.startRecoveryReaper({
      queryRunner: mockQueryRunner,
      intervalMs: 20
    });

    expect(coordinator.getRecoveryReaper()).toBe(reaper);
    expect(reaper.isRunning).toBe(true);

    // runNow executes immediately
    const recovered = await reaper.runNow();
    expect(recovered).toEqual(["scene-expired-1"]);
    expect(mockQueryRunner).toHaveBeenCalled();

    // Coordinator shutdown stops the reaper
    await coordinator.shutdown();
    expect(reaper.isRunning).toBe(false);
    expect(coordinator.getRecoveryReaper()).toBeUndefined();
  });

  it("reclaims expired planning lease on duplicate admission and launches task", async () => {
    const freshRunId = "reclaimed-fresh-run-id";
    let pipelineResolve: () => void = () => {};
    const pipelinePromise = new Promise<void>((resolve) => {
      pipelineResolve = resolve;
    });

    const mockUseCase: Partial<PlanShotPlansUseCase> = {
      prepareAdmission: vi.fn().mockResolvedValue({
        kind: "admitted",
        sceneId,
        status: "generating_candidates",
        specRevision: 1,
        variantCount: 2,
        runId: freshRunId,
        isDuplicate: false, // lease was expired, so use case reclaimed it with a fresh runId
        input: { sceneId, variantCount: 2 }
      }),
      executePlanningPipeline: vi.fn().mockImplementation(async () => {
        await pipelinePromise;
        return [];
      })
    };

    const coordinator = new ShotPlanPlanningCoordinator({
      planShotPlansUseCase: mockUseCase as PlanShotPlansUseCase
    });

    const admission = await coordinator.prepareAdmission({ sceneId, variantCount: 2 });
    expect(admission.kind).toBe("admitted");
    if (admission.kind === "admitted") {
      expect(admission.isDuplicate).toBe(false);
      expect(admission.runId).toBe(freshRunId);
    }

    expect(coordinator.isInFlight(sceneId)).toBe(true);
    pipelineResolve();
    await coordinator.waitForAllInFlight();
    expect(coordinator.isInFlight(sceneId)).toBe(false);

    expect(mockUseCase.executePlanningPipeline).toHaveBeenCalledWith(
      sceneId,
      1,
      expect.objectContaining({ sceneId, variantCount: 2 }),
      freshRunId,
      expect.any(AbortSignal)
    );
  });
});
