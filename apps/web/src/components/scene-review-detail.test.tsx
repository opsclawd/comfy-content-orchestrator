// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { SceneReviewDetailView } from "./scene-review-detail.js";
import type { SceneReviewDetailReadModel, ShotPlanReviewItem } from "@cco/contracts";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: vi.fn()
  })
}));

function createSampleDetail(
  overrides?: Partial<SceneReviewDetailReadModel>
): SceneReviewDetailReadModel {
  return {
    sceneId: "123e4567-e89b-12d3-a456-426614174000",
    campaignId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    status: "director_review",
    specRevision: 2,
    configuration: {
      prompt: "A neon cyberpunk cityscape with flying cars",
      referenceIds: ["ref-1", "ref-2"],
      engineProfileId: "engine-flux-schnell",
      durationMs: 4000,
      loraConfigurationId: "lora-city-1"
    },
    selectedCandidateId: "cand-1111-uuid",
    selectedCandidateRevision: 2,
    approval: undefined,
    candidatesByRevision: [],
    allowedActions: ["approve", "reject", "reroll"],
    ...overrides
  };
}

const sampleShotPlan: ShotPlanReviewItem = {
  shotPlanId: "plan-1111-uuid",
  sceneId: "123e4567-e89b-12d3-a456-426614174000",
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
  cameraPosition: "eye level",
  cameraPromptDescription: "Smooth push in on character",
  actionSummary: "Character looks into camera",
  lightingStyle: "neon_night",
  environmentDescription: "Neon alley",
  colorPalette: ["cyan", "magenta"],
  subjects: [],
  beats: [],
  dialogue: null,
  continuity: {
    persistentSubjectIds: [],
    frameAnchorTarget: "none"
  },
  boundReferences: [],
  createdAt: "2026-09-28T12:00:00.000Z",
  updatedAt: "2026-09-28T12:00:00.000Z"
};

describe("SceneReviewDetailView: ShotPlanPanel Reachability & Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("mounts ShotPlanPanel in reachable empty state when shotPlans is undefined", () => {
    const detail = createSampleDetail({ shotPlans: undefined });
    render(<SceneReviewDetailView detail={detail} />);

    // ShotPlanPanel is mounted
    const panel = screen.getByTestId("shot-plan-panel");
    expect(panel).toBeDefined();

    // Empty state is visible and accessible
    const emptyState = screen.getByTestId("no-shot-plans-state");
    expect(emptyState).toBeDefined();
    expect(emptyState.textContent).toContain("No shot plans have been generated for this scene.");

    // Generate Shot Plans button is available
    const generateBtn = screen.getByTestId("generate-shot-plans-button");
    expect(generateBtn).toBeDefined();
    expect((generateBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("mounts ShotPlanPanel in reachable empty state when shotPlans is empty array", () => {
    const detail = createSampleDetail({ shotPlans: [] });
    render(<SceneReviewDetailView detail={detail} />);

    const panel = screen.getByTestId("shot-plan-panel");
    expect(panel).toBeDefined();

    const emptyState = screen.getByTestId("no-shot-plans-state");
    expect(emptyState).toBeDefined();

    const generateBtn = screen.getByTestId("generate-shot-plans-button");
    expect(generateBtn).toBeDefined();
  });

  it("withholds direct candidate selection once ShotPlans exist (ShotPlan is the sole selection authority)", () => {
    const detail = createSampleDetail({
      shotPlans: [sampleShotPlan],
      candidatesByRevision: [
        {
          specRevision: 2,
          candidates: [
            {
              candidateId: "cand-2222-uuid",
              specRevision: 2,
              variantOrdinal: 1,
              storageBucket: "b",
              storageObjectKey: "k",
              contentHashSha256: "0".repeat(64),
              createdAt: "2026-09-28T12:00:00.000Z",
              isCurrent: true,
              media: { available: false }
            }
          ]
        }
      ]
    } as unknown as Partial<SceneReviewDetailReadModel>);
    render(<SceneReviewDetailView detail={detail} />);

    expect(screen.queryByTestId("select-candidate-button")).toBeNull();
  });

  it("keeps direct candidate selection for legacy scenes with no ShotPlans", () => {
    const detail = createSampleDetail({
      shotPlans: [],
      candidatesByRevision: [
        {
          specRevision: 2,
          candidates: [
            {
              candidateId: "cand-2222-uuid",
              specRevision: 2,
              variantOrdinal: 1,
              storageBucket: "b",
              storageObjectKey: "k",
              contentHashSha256: "0".repeat(64),
              createdAt: "2026-09-28T12:00:00.000Z",
              isCurrent: true,
              media: { available: false }
            }
          ]
        }
      ]
    } as unknown as Partial<SceneReviewDetailReadModel>);
    render(<SceneReviewDetailView detail={detail} />);

    expect(screen.getAllByTestId("select-candidate-button").length).toBeGreaterThan(0);
  });

  it("renders populated ShotPlan cards grid when shotPlans are present", () => {
    const detail = createSampleDetail({ shotPlans: [sampleShotPlan] });
    render(<SceneReviewDetailView detail={detail} />);

    const panel = screen.getByTestId("shot-plan-panel");
    expect(panel).toBeDefined();

    // No empty state rendered
    expect(screen.queryByTestId("no-shot-plans-state")).toBeNull();
    expect(screen.queryByTestId("generate-shot-plans-button")).toBeNull();

    // Populated card is rendered with intent and variant
    const card = screen.getByTestId("shot-plan-card");
    expect(card).toBeDefined();
    expect(card.getAttribute("data-shot-plan-id")).toBe(sampleShotPlan.shotPlanId);
    expect(screen.getByText("Variant #1")).toBeDefined();
  });

  it("success flow triggers canonical server refresh and does not synthesize read-model items from snapshot payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sceneId: "123e4567-e89b-12d3-a456-426614174000",
        shotPlans: [
          // A raw snapshot payload that lacks boundReferences, presigned URLs, etc.
          {
            id: "raw-snapshot-uuid",
            sceneId: "123e4567-e89b-12d3-a456-426614174000",
            specRevision: 2,
            variantOrdinal: 1,
            status: "draft",
            routingMode: "reference_directed",
            targetDurationMs: 4000,
            targetFrameCount: 97,
            durationToleranceMs: 355,
            fps: 24,
            framing: "wide",
            angle: "eye_level",
            lensIntent: "35mm prime",
            cameraPosition: "eye level",
            cameraMovement: "static",
            movementSpeed: "medium",
            cameraPromptDescription: "Static shot",
            subjects: [],
            actionSummary: "Raw action",
            beats: [],
            lightingStyle: "high_key_commercial",
            environmentDescription: "Room",
            colorPalette: [],
            continuity: { frameAnchorTarget: "none", persistentSubjectIds: [] },
            createdAt: "2026-09-28T12:00:00.000Z",
            updatedAt: "2026-09-28T12:00:00.000Z"
          }
        ],
        isIdempotentReplay: false
      })
    });
    vi.stubGlobal("fetch", mockFetch);

    const detail = createSampleDetail({ shotPlans: [] });
    render(<SceneReviewDetailView detail={detail} />);

    const generateBtn = screen.getByTestId("generate-shot-plans-button");
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/scenes/${detail.sceneId}/shot-plans`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ variantCount: 2, reroll: false })
      })
    );

    // Canonical server refresh was invoked
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    // The raw snapshot was NOT directly mounted into the DOM as read-model items;
    // only server refresh re-rendering with ShotPlanReviewItem[] will populate cards
    expect(screen.queryByTestId("shot-plan-card")).toBeNull();
    expect(screen.getByTestId("no-shot-plans-state")).toBeDefined();
  });

  it("clicking reject in production review panel opens confirmation modal and submits reject command", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        sceneId: "123e4567-e89b-12d3-a456-426614174000",
        status: "director_review",
        specRevision: 2,
        isIdempotentReplay: false
      })
    });
    vi.stubGlobal("fetch", mockFetch);

    const detail = createSampleDetail({
      status: "qa",
      allowedActions: ["production_accept", "production_rerender", "reject"]
    });
    const attempt = {
      runId: "run-1",
      sceneId: detail.sceneId,
      attemptOrdinal: 1,
      specRevision: 2,
      productionJobId: "job-1",
      technicalState: "completed" as const,
      reviewReady: true,
      availability: "available" as const,
      media: {
        url: "https://example.com/clip.mp4",
        generationManifestId: "gen-1"
      }
    };

    render(<SceneReviewDetailView detail={detail} productionAttempt={attempt} />);

    // There are two reject buttons: one in toolbar, one in production panel.
    const rejectButtons = screen.getAllByTestId("action-button-reject");
    expect(rejectButtons.length).toBeGreaterThanOrEqual(1);

    // Click the one in the production review panel
    const targetButton = rejectButtons[rejectButtons.length - 1];
    expect(targetButton).toBeDefined();
    fireEvent.click(targetButton!);

    // Modal dialog should appear!
    const dialog = await screen.findByTestId("review-command-dialog");
    expect(dialog).toBeDefined();
    expect(screen.getByTestId("confirm-dialog-title").textContent).toContain("Reject");

    // Click confirm
    const confirmBtn = screen.getByTestId("confirm-command-button");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        `/api/scenes/${detail.sceneId}/review-command`,
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"action":"reject"')
        })
      );
    });
  });
});
