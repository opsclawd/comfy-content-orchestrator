import { describe, expect, it, vi } from "vitest";
import { H3ProductionInspectionReadModelSchema } from "@cco/contracts";
import {
  SceneNotFoundError,
  ShotPlanNotFoundError,
  type PrepareSceneProductionInputsUseCase,
  type PrepareSceneProductionInputsResult,
  type UnitOfWork,
  type UnitOfWorkContext
} from "@cco/application";
import { createControlApiApp } from "../app.js";
import type { ControlApiContainer, ControlApiUseCases } from "../types.js";

class FakeUnitOfWork implements UnitOfWork {
  async execute<TResult>(work: (context: UnitOfWorkContext) => Promise<TResult>): Promise<TResult> {
    return work({} as unknown as UnitOfWorkContext);
  }
}

function createMockContainer(
  prepareInputs: Partial<PrepareSceneProductionInputsUseCase>
): ControlApiContainer {
  return {
    dependencies: { uow: new FakeUnitOfWork() },
    useCases: {
      prepareSceneProductionInputs: prepareInputs as PrepareSceneProductionInputsUseCase,
      reviewScene: {} as unknown as ControlApiUseCases["reviewScene"],
      productionReview: {} as unknown as ControlApiUseCases["productionReview"],
      progressSceneProduction: {} as unknown as ControlApiUseCases["progressSceneProduction"],
      approveSceneAndDispatchCampaignProduction:
        {} as unknown as ControlApiUseCases["approveSceneAndDispatchCampaignProduction"],
      completeCampaignProductionRun:
        {} as unknown as ControlApiUseCases["completeCampaignProductionRun"],
      completeCampaignProductionRunAssembly:
        {} as unknown as ControlApiUseCases["completeCampaignProductionRunAssembly"]
    },
    queries: {}
  } as unknown as ControlApiContainer;
}

describe("ProductionInspectionRoutes", () => {
  const sceneId = "01950c46-9e90-7d3d-82d2-8f1d3c000001";
  const shotPlanId = "01950c46-9e90-7d3d-82d2-8f1d3c000002";

  const sampleInspection: PrepareSceneProductionInputsResult = {
    readiness: "ready",
    blockers: [],
    inspection: {
      authority: {
        sceneId,
        specRevision: 1,
        shotPlanId,
        variantOrdinal: 1,
        shotPlanStatus: "approved",
        isCurrentRevision: true
      },
      route: {
        routingMode: "reference_directed",
        renderProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
        workflowTemplate: "minimax-h3-720p-124f-ref2v",
        targetDurationMs: 5000,
        targetFrameCount: 124,
        fps: 24,
        width: 1344,
        height: 768
      },
      visualInputs: {
        references: [
          {
            slotIndex: 1,
            promptTag: "<Picture 1>",
            referenceAssetId: "01950c46-9e90-7d3d-82d2-8f1d3c000003",
            displayName: "Subject Hero",
            role: "subject_identity",
            contentHashSha256: "a".repeat(64),
            previewUrl: null,
            previewAvailability: "unavailable"
          }
        ],
        frameAnchor: null
      },
      instruction: {
        compiledText: "A person walking on the beach at golden hour.",
        compiledSha256: "b".repeat(64),
        cameraIntentSummary: {
          framing: "wide",
          angle: "eye_level",
          cameraMovement: "pan_right",
          movementSpeed: "slow",
          lensIntent: "35mm",
          cameraPosition: "tripod front"
        }
      },
      admission: {
        readiness: "ready",
        blockers: []
      },
      runtimeContext: {
        durationCeilingSeconds: 60
      },
      productionInputFingerprint: "c".repeat(64)
    },
    canonicalReferences: [],
    targetShotPlan: undefined,
    durationResultOk: true,
    frameCount: 124
  };

  it("returns 200 with H3ProductionInspectionReadModel on happy path", async () => {
    const mockPrepareInputs: Partial<PrepareSceneProductionInputsUseCase> = {
      execute: vi.fn(async () => sampleInspection)
    };

    const app = createControlApiApp(createMockContainer(mockPrepareInputs));

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneId}/production-inspection?shotPlanId=${shotPlanId}`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const parseResult = H3ProductionInspectionReadModelSchema.safeParse(body);
    expect(parseResult.success).toBe(true);
    expect(body.productionInputFingerprint).toBe("c".repeat(64));
    expect(body.admission.readiness).toBe("ready");
    expect(body.route.routingMode).toBe("reference_directed");
    expect(mockPrepareInputs.execute).toHaveBeenCalledWith({
      sceneId,
      shotPlanId,
      dryRun: true
    });
  });

  it("returns 404 when scene is not found", async () => {
    const mockPrepareInputs: Partial<PrepareSceneProductionInputsUseCase> = {
      execute: vi.fn(async () => {
        throw new SceneNotFoundError(sceneId);
      })
    };

    const app = createControlApiApp(createMockContainer(mockPrepareInputs));

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneId}/production-inspection`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 when shot plan is not found", async () => {
    const mockPrepareInputs: Partial<PrepareSceneProductionInputsUseCase> = {
      execute: vi.fn(async () => {
        throw new ShotPlanNotFoundError(shotPlanId);
      })
    };

    const app = createControlApiApp(createMockContainer(mockPrepareInputs));

    const response = await app.inject({
      method: "GET",
      url: `/api/scenes/${sceneId}/production-inspection?shotPlanId=${shotPlanId}`
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when sceneId is not a valid UUID", async () => {
    const app = createControlApiApp(createMockContainer({ execute: vi.fn() }));

    const response = await app.inject({
      method: "GET",
      url: "/api/scenes/invalid-uuid/production-inspection"
    });

    expect(response.statusCode).toBe(400);
  });
});
