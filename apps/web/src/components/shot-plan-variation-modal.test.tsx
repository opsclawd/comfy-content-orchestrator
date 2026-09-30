// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ShotPlanVariationModal } from "./shot-plan-variation-modal";
import type {
  ShotPlanReviewItem,
  ShotPlanDocument,
  CreateShotPlanVariationResponse
} from "@cco/contracts";

function createSampleShotPlanDoc(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 2,
    status: "draft",
    routingMode: "reference_directed",
    targetDurationMs: 4000,
    targetFrameCount: 97,
    durationToleranceMs: 355,
    fps: 24,
    framing: "medium_close_up",
    angle: "eye_level",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    lensIntent: "50mm prime",
    cameraPosition: "chest height",
    cameraPromptDescription: "Medium close up",
    actionSummary: "Character enters scene",
    lightingStyle: "high_key_commercial",
    environmentDescription: "Studio room",
    colorPalette: ["white", "grey"],
    atmosphere: null,
    subjects: [],
    beats: [],
    dialogue: null,
    continuity: {
      persistentSubjectIds: [],
      frameAnchorTarget: "none"
    },
    derivedFromShotPlanId: "11111111-1111-4111-8111-111111111111",
    derivation: {
      sourceShotPlanId: "11111111-1111-4111-8111-111111111111",
      sourceVariantOrdinal: 1,
      directorGuidance: "Tighter shot on 50mm",
      requestedAt: "2026-09-28T12:00:00.000Z"
    },
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    ...overrides
  };
}

function createSampleShotPlan(overrides?: Partial<ShotPlanReviewItem>): ShotPlanReviewItem {
  return {
    shotPlanId: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 1,
    status: "draft",
    routingMode: "reference_directed",
    isCurrentRevision: true,
    targetDurationMs: 4000,
    targetFrameCount: 97,
    framing: "medium_close_up",
    angle: "eye_level",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    lensIntent: "50mm prime",
    cameraPosition: "chest height",
    cameraPromptDescription: "Medium close up",
    actionSummary: "Character enters scene",
    lightingStyle: "high_key_commercial",
    environmentDescription: "Studio room",
    colorPalette: ["white", "grey"],
    atmosphere: null,
    subjects: [],
    beats: [],
    dialogue: null,
    continuity: {
      persistentSubjectIds: [],
      frameAnchorTarget: "none"
    },
    previs: null,
    boundReferences: [],
    createdAt: "2026-09-28T12:00:00.000Z",
    updatedAt: "2026-09-28T12:00:00.000Z",
    ...overrides
  };
}

describe("ShotPlanVariationModal", () => {
  const sceneId = "22222222-2222-4222-8222-222222222222";
  const currentSpecRevision = 2;
  const samplePlan = createSampleShotPlan();

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not render when isOpen is false", () => {
    render(
      <ShotPlanVariationModal
        isOpen={false}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByTestId("shot-plan-variation-modal")).toBeNull();
  });

  it("does not render when sourcePlan is null", () => {
    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={null}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByTestId("shot-plan-variation-modal")).toBeNull();
  });

  it("renders modal with source variant identity", () => {
    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("shot-plan-variation-modal")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Create Shot Plan Variation" })).toBeDefined();
    const identity = screen.getByTestId("variation-source-identity");
    expect(identity.textContent).toContain("Source Variant: V1 (Rev 2)");
    expect(identity.textContent).toContain("50mm prime");
  });

  it("validates empty guidance and disables submit until text is entered", () => {
    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={vi.fn()}
      />
    );

    const submitBtn = screen.getByTestId("submit-variation-button") as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    const textarea = screen.getByTestId("variation-guidance-input");
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(submitBtn.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "Tighter framing with slower movement" } });
    expect(submitBtn.disabled).toBe(false);
  });

  it("handles successful variation submission via onCreateVariation", async () => {
    const mockOnClose = vi.fn();
    const mockOnSuccess = vi.fn();
    const mockCreate = vi.fn().mockResolvedValueOnce({
      sceneId,
      sourceShotPlanId: samplePlan.shotPlanId,
      shotPlans: [createSampleShotPlanDoc()],
      isIdempotentReplay: false
    } satisfies CreateShotPlanVariationResponse);

    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={mockOnClose}
        onSuccess={mockOnSuccess}
        onCreateVariation={mockCreate}
      />
    );

    const textarea = screen.getByTestId("variation-guidance-input");
    fireEvent.change(textarea, { target: { value: "Tighter shot on 50mm" } });

    const countSelect = screen.getByTestId("variation-count-select");
    fireEvent.change(countSelect, { target: { value: "2" } });

    const submitBtn = screen.getByTestId("submit-variation-button");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    expect(mockCreate).toHaveBeenCalledWith({
      sourceShotPlanId: samplePlan.shotPlanId,
      expectedSpecRevision: currentSpecRevision,
      directorGuidance: "Tighter shot on 50mm",
      variantCount: 2,
      idempotencyKey: expect.any(String)
    });

    await waitFor(() => {
      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  it("surfaces cloud planning not authorized error (403)", async () => {
    const mockCreate = vi.fn().mockRejectedValueOnce({
      statusCode: 403,
      error: {
        code: "CLOUD_PLANNING_NOT_AUTHORIZED",
        message: "allowCloudPlanning disabled"
      }
    });

    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={vi.fn()}
        onCreateVariation={mockCreate}
      />
    );

    const textarea = screen.getByTestId("variation-guidance-input");
    fireEvent.change(textarea, { target: { value: "Tighter shot" } });

    fireEvent.click(screen.getByTestId("submit-variation-button"));

    await waitFor(() => {
      const errorBanner = screen.getByTestId("variation-error-message");
      expect(errorBanner.textContent).toContain("Cloud planning not authorized");
    });
  });

  it("surfaces configuration error (503)", async () => {
    const mockCreate = vi.fn().mockRejectedValueOnce({
      statusCode: 503,
      error: {
        code: "CONFIGURATION_ERROR",
        message: "Shot plan variation is unavailable"
      }
    });

    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={vi.fn()}
        onCreateVariation={mockCreate}
      />
    );

    const textarea = screen.getByTestId("variation-guidance-input");
    fireEvent.change(textarea, { target: { value: "Tighter shot" } });

    fireEvent.click(screen.getByTestId("submit-variation-button"));

    await waitFor(() => {
      const errorBanner = screen.getByTestId("variation-error-message");
      expect(errorBanner.textContent).toContain("Planning configuration error");
    });
  });

  it("surfaces idempotency conflict error (409)", async () => {
    const mockCreate = vi.fn().mockRejectedValueOnce({
      statusCode: 409,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Conflicting variation request for idempotency key"
      }
    });

    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={vi.fn()}
        onCreateVariation={mockCreate}
      />
    );

    const textarea = screen.getByTestId("variation-guidance-input");
    fireEvent.change(textarea, { target: { value: "Tighter shot" } });

    fireEvent.click(screen.getByTestId("submit-variation-button"));

    await waitFor(() => {
      const errorBanner = screen.getByTestId("variation-error-message");
      expect(errorBanner.textContent).toContain("Conflicting variation request");
    });
  });

  it("closes on cancel button click", () => {
    const mockOnClose = vi.fn();
    render(
      <ShotPlanVariationModal
        isOpen={true}
        sceneId={sceneId}
        currentSpecRevision={currentSpecRevision}
        sourcePlan={samplePlan}
        onClose={mockOnClose}
      />
    );

    const cancelBtn = screen.getByTestId("cancel-variation-button");
    fireEvent.click(cancelBtn);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
