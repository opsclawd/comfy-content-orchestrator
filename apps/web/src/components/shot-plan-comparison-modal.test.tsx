// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { ShotPlanComparisonModal } from "./shot-plan-comparison-modal.js";
import type { ShotPlanReviewItem } from "@cco/contracts";

function createPlan(overrides?: Partial<ShotPlanReviewItem>): ShotPlanReviewItem {
  return {
    shotPlanId: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 2,
    status: "draft",
    routingMode: "reference_directed",
    isCurrentRevision: true,
    targetDurationMs: 5170,
    targetFrameCount: 124,
    framing: "medium",
    angle: "eye_level",
    cameraMovement: "static",
    movementSpeed: "medium",
    lensIntent: "35mm standard",
    cameraPosition: "chest height",
    cameraPromptDescription: "Locked off view of the product on the bar",
    actionSummary: "Bartender presents the product to camera",
    lightingStyle: "practical_interior",
    environmentDescription: "Bar interior",
    colorPalette: ["amber", "wood"],
    atmosphere: "warm haze",
    subjects: [
      {
        subjectId: "elena",
        role: "subject_identity",
        initialPosition: "screen_left",
        movementTrajectory: "stationary",
        interactionSummary: "looks at product"
      }
    ],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 5170,
        description: "Bartender lifts bottle",
        cameraAction: "static hold",
        subjectAction: "lifts bottle"
      }
    ],
    dialogue: null,
    continuity: {
      persistentSubjectIds: ["elena"],
      frameAnchorTarget: "none"
    },
    previs: null,
    boundReferences: [],
    derivedFromShotPlanId: null,
    derivation: null,
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

function createVariation(source: ShotPlanReviewItem): ShotPlanReviewItem {
  return createPlan({
    shotPlanId: "44444444-4444-4444-8444-444444444444",
    variantOrdinal: 4,
    framing: "medium_close_up",
    lensIntent: "50mm tight prime",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    derivedFromShotPlanId: source.shotPlanId,
    derivation: {
      sourceShotPlanId: source.shotPlanId,
      sourceVariantOrdinal: source.variantOrdinal,
      directorGuidance: "Tighter 50mm, product forward, slow dolly-in",
      requestedAt: "2026-09-28T12:00:00.000Z"
    }
  });
}

describe("ShotPlanComparisonModal", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders changed rows with before -> after for a directed variation", () => {
    const source = createPlan();
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("shot-plan-comparison-modal")).toBeTruthy();
    expect(screen.getByText("V4 — Variation of V2")).toBeTruthy();

    const changedSection = screen.getByTestId("comparison-changed-section");
    const rows = within(changedSection).getAllByTestId("comparison-changed-row");
    const framingRow = rows.find((r) => r.getAttribute("data-field-key") === "framing")!;
    expect(framingRow.textContent).toContain("Medium");
    expect(framingRow.textContent).toContain("Medium Close-up");

    const lensRow = rows.find((r) => r.getAttribute("data-field-key") === "lensIntent")!;
    expect(lensRow.textContent).toContain("35mm standard");
    expect(lensRow.textContent).toContain("50mm tight prime");
  });

  it("renders the unchanged section collapsed by default and expandable", () => {
    const source = createPlan();
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    const details = screen.getByTestId("comparison-unchanged-section") as HTMLDetailsElement;
    expect(details.open).toBe(false);

    const summary = details.querySelector("summary")!;
    fireEvent.click(summary);
    expect(details.open).toBe(true);

    const rows = within(details).getAllByTestId("comparison-unchanged-row");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("renders the historical fence banner only for historical scope", () => {
    const source = createPlan();
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByTestId("comparison-historical-fence")).toBeNull();
    cleanup();

    const staleSource = { ...source, specRevision: 1, isCurrentRevision: false };
    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[staleSource, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTestId("comparison-historical-fence")).toBeTruthy();
  });

  it("never renders select/approve controls", () => {
    const source = createPlan();
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    const modal = screen.getByTestId("shot-plan-comparison-modal");
    expect(within(modal).queryByTestId("shot-plan-select-button")).toBeNull();
    expect(within(modal).queryByTestId("shot-plan-approve-button")).toBeNull();

    const buttons = within(modal).getAllByRole("button");
    for (const button of buttons) {
      expect(button.textContent ?? "").not.toMatch(/approve|select/i);
    }
  });

  it("renders fully when previs media is absent on both sides", () => {
    const source = createPlan({ previs: null });
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("shot-plan-comparison-modal")).toBeTruthy();
    expect(screen.queryByTestId("comparison-previs-thumbnail")).toBeNull();
  });

  it("renders the source picker when lineage is unresolved, and a diff after choosing a source", () => {
    const unrelatedSource = createPlan({
      shotPlanId: "99999999-9999-4999-8999-999999999999",
      variantOrdinal: 1
    });
    const target = createPlan({
      shotPlanId: "44444444-4444-4444-8444-444444444444",
      variantOrdinal: 4,
      framing: "close_up"
    });

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[unrelatedSource, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("comparison-source-picker")).toBeTruthy();
    expect(screen.queryByTestId("comparison-changed-section")).toBeNull();

    fireEvent.change(screen.getByTestId("comparison-source-select"), {
      target: { value: unrelatedSource.shotPlanId }
    });

    expect(screen.getByTestId("comparison-changed-section")).toBeTruthy();
  });

  it("performs no fetch when open and comparing", () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const source = createPlan();
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("renders nothing when closed", () => {
    const source = createPlan();
    const target = createVariation(source);

    render(
      <ShotPlanComparisonModal
        isOpen={false}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByTestId("shot-plan-comparison-modal")).toBeNull();
  });

  it("calls onClose when the close button is clicked", () => {
    const source = createPlan();
    const target = createVariation(source);
    const onClose = vi.fn();

    render(
      <ShotPlanComparisonModal
        isOpen={true}
        targetPlan={target}
        shotPlans={[source, target]}
        currentSpecRevision={2}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByTestId("close-comparison-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
