// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ProductionReviewPanel } from "./production-review-panel.js";
import { createInitialState } from "./review-command-state.js";
import type { SceneReviewDetailReadModel } from "@cco/contracts";
import type { CurrentProductionAttemptReadModel } from "../api/client.js";

const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: mockPush
  })
}));

function createSampleDetail(
  overrides?: Partial<SceneReviewDetailReadModel>
): SceneReviewDetailReadModel {
  return {
    sceneId: "scene-1111-uuid",
    campaignId: "camp-2222-uuid",
    status: "qa",
    specRevision: 2,
    configuration: {
      prompt: "Cinematic shot of neon city",
      referenceIds: ["ref-1"],
      engineProfileId: "engine-flux",
      durationMs: 4000
    },
    selectedCandidateId: "cand-3333-uuid",
    selectedCandidateRevision: 2,
    candidatesByRevision: [],
    allowedActions: ["production_accept", "production_rerender"],
    ...overrides
  };
}

function createSampleAttempt(
  overrides?: Partial<CurrentProductionAttemptReadModel>
): CurrentProductionAttemptReadModel {
  return {
    runId: "run-1111-uuid",
    sceneId: "scene-1111-uuid",
    attemptOrdinal: 1,
    specRevision: 2,
    technicalState: "completed",
    reviewReady: true,
    availability: "available",
    productionJobId: "prod-job-4444",
    media: {
      url: "https://media.example.com/production-attempt-1.mp4",
      generationManifestId: "gen-man-5555"
    },
    ...overrides
  };
}

describe("ProductionReviewPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when productionAttempt is undefined", () => {
    const detail = createSampleDetail();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    const { container } = render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={undefined}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders video player and identity strip when available and reviewReady", () => {
    const detail = createSampleDetail();
    const attempt = createSampleAttempt();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.getByTestId("production-review-panel")).toBeDefined();
    const player = screen.getByTestId("production-clip-player") as HTMLVideoElement;
    expect(player).toBeDefined();
    expect(player.src).toBe("https://media.example.com/production-attempt-1.mp4");
    expect(player.controls).toBe(true);

    const identity = screen.getByTestId("production-attempt-identity");
    expect(identity.textContent).toContain("Attempt #1");
    expect(identity.textContent).toContain("Spec Rev 2");
    expect(identity.textContent).toContain("completed");
    expect(identity.textContent).toContain("prod-job-4444");
  });

  it("renders img player when media URL is animated webp format", () => {
    const detail = createSampleDetail();
    const attempt = createSampleAttempt({
      media: {
        url: "https://media.example.com/scenes/scene-1/job-1/output.webp?signature=abc",
        generationManifestId: "manifest-1"
      }
    });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    const player = screen.getByTestId("production-clip-player") as HTMLImageElement;
    expect(player).toBeDefined();
    expect(player.tagName).toBe("IMG");
    expect(player.src).toBe(
      "https://media.example.com/scenes/scene-1/job-1/output.webp?signature=abc"
    );
    expect(player.alt).toContain("Production attempt #1 preview");
  });

  it("renders rendering banner when technicalState is queued, leased, or rendering", () => {
    const detail = createSampleDetail();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    for (const technicalState of ["queued", "leased", "rendering"] as const) {
      cleanup();
      const attempt = createSampleAttempt({
        technicalState,
        reviewReady: false,
        media: undefined
      });

      render(
        <ProductionReviewPanel
          detail={detail}
          productionAttempt={attempt}
          state={state}
          dispatch={dispatch}
        />
      );

      expect(screen.getByTestId("production-rendering-banner")).toBeDefined();
      expect(screen.queryByTestId("production-clip-player")).toBeNull();
    }
  });

  it("renders failed banner when technicalState is failed or cancelled", () => {
    const detail = createSampleDetail();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    for (const technicalState of ["failed", "cancelled"] as const) {
      cleanup();
      const attempt = createSampleAttempt({
        technicalState,
        reviewReady: false,
        media: undefined
      });

      render(
        <ProductionReviewPanel
          detail={detail}
          productionAttempt={attempt}
          state={state}
          dispatch={dispatch}
        />
      );

      expect(screen.getByTestId("production-failed-banner")).toBeDefined();
      expect(screen.queryByTestId("production-clip-player")).toBeNull();
    }
  });

  it("renders media-unavailable banner with Reload Media button when availability !== available", () => {
    const detail = createSampleDetail();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    const attempt = createSampleAttempt({
      availability: "unavailable",
      reviewReady: true,
      media: undefined
    });

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.getByTestId("production-media-unavailable")).toBeDefined();
    const reloadBtn = screen.getByTestId("reload-production-media-button");
    expect(reloadBtn).toBeDefined();

    fireEvent.click(reloadBtn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders not-ready banner when reviewReady is false and not rendering/failed", () => {
    const detail = createSampleDetail();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    const attempt = createSampleAttempt({
      technicalState: "completed",
      reviewReady: false,
      availability: "available"
    });

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.getByTestId("production-not-ready-banner")).toBeDefined();
    expect(screen.queryByTestId("production-clip-player")).toBeNull();
  });

  it("transitions to media-unavailable banner when video onError fires, and Reload Media calls router.refresh", () => {
    const detail = createSampleDetail();
    const attempt = createSampleAttempt();
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    const player = screen.getByTestId("production-clip-player");
    expect(player).toBeDefined();

    // Trigger video playback error
    fireEvent.error(player);

    // Should now switch to media-unavailable banner
    expect(screen.queryByTestId("production-clip-player")).toBeNull();
    const unavailableBanner = screen.getByTestId("production-media-unavailable");
    expect(unavailableBanner).toBeDefined();
    expect(unavailableBanner.textContent).toContain("expired or encountered a playback error");

    const reloadBtn = screen.getByTestId("reload-production-media-button");
    fireEvent.click(reloadBtn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("resets playerError back to player when refreshed with a new media URL", () => {
    const detail = createSampleDetail();
    const attempt1 = createSampleAttempt({
      media: {
        url: "https://media.example.com/expired-url-1.mp4",
        generationManifestId: "gen-1"
      }
    });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    const { rerender } = render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt1}
        state={state}
        dispatch={dispatch}
      />
    );

    const player = screen.getByTestId("production-clip-player");
    fireEvent.error(player);

    expect(screen.getByTestId("production-media-unavailable")).toBeDefined();

    // Re-render with fresh URL from server refresh
    const attempt2 = createSampleAttempt({
      media: {
        url: "https://media.example.com/fresh-url-2.mp4",
        generationManifestId: "gen-1"
      }
    });

    rerender(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt2}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.queryByTestId("production-media-unavailable")).toBeNull();
    const refreshedPlayer = screen.getByTestId("production-clip-player") as HTMLVideoElement;
    expect(refreshedPlayer).toBeDefined();
    expect(refreshedPlayer.src).toBe("https://media.example.com/fresh-url-2.mp4");
  });

  it("renders stale spec banner when detail and attempt specRevisions diverge", () => {
    const detail = createSampleDetail({ specRevision: 3 });
    const attempt = createSampleAttempt({ specRevision: 2 });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.getByTestId("production-stale-spec-banner")).toBeDefined();
  });

  it("renders Accept and Re-render buttons when allowedActions contains them and productionJobId is present", () => {
    const detail = createSampleDetail({
      allowedActions: ["production_accept", "production_rerender"]
    });
    const attempt = createSampleAttempt({ productionJobId: "prod-job-xyz" });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    const acceptBtn = screen.getByTestId("action-button-production_accept");
    expect(acceptBtn).toBeDefined();
    fireEvent.click(acceptBtn);

    expect(dispatch).toHaveBeenCalledWith({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "production_accept",
        payload: {
          expectedProductionJobId: "prod-job-xyz"
        },
        displayLabel: "Accept Production"
      }
    });

    const rerenderBtn = screen.getByTestId("action-button-production_rerender");
    expect(rerenderBtn).toBeDefined();
    fireEvent.click(rerenderBtn);

    expect(dispatch).toHaveBeenCalledWith({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "production_rerender",
        payload: {
          expectedProductionJobId: "prod-job-xyz"
        },
        displayLabel: "Re-render Production"
      }
    });
  });

  it("omits buttons when productionJobId is missing or undefined", () => {
    const detail = createSampleDetail({
      allowedActions: ["production_accept", "production_rerender"]
    });
    const attempt = createSampleAttempt({ productionJobId: undefined });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.queryByTestId("action-button-production_accept")).toBeNull();
    expect(screen.queryByTestId("action-button-production_rerender")).toBeNull();
  });

  it("omits buttons when allowedActions does not include them", () => {
    const detail = createSampleDetail({
      allowedActions: ["approve", "reject"]
    });
    const attempt = createSampleAttempt({ productionJobId: "prod-job-xyz" });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
      />
    );

    expect(screen.queryByTestId("action-button-production_accept")).toBeNull();
    expect(screen.queryByTestId("action-button-production_rerender")).toBeNull();
  });

  it("disables buttons when disabled prop is true", () => {
    const detail = createSampleDetail({
      allowedActions: ["production_accept", "production_rerender"]
    });
    const attempt = createSampleAttempt({ productionJobId: "prod-job-xyz" });
    const state = createInitialState(detail);
    const dispatch = vi.fn();

    render(
      <ProductionReviewPanel
        detail={detail}
        productionAttempt={attempt}
        state={state}
        dispatch={dispatch}
        disabled={true}
      />
    );

    const acceptBtn = screen.getByTestId("action-button-production_accept") as HTMLButtonElement;
    const rerenderBtn = screen.getByTestId(
      "action-button-production_rerender"
    ) as HTMLButtonElement;

    expect(acceptBtn.disabled).toBe(true);
    expect(rerenderBtn.disabled).toBe(true);
  });
});
