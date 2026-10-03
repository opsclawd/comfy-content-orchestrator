// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ShotPlanPanel } from "./shot-plan-panel.js";
import type { ShotPlanReviewItem } from "@cco/contracts";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: vi.fn()
  })
}));

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
    lensIntent: "50mm prime cinematic",
    cameraPosition: "chest height, facing subject",
    cameraPromptDescription: "Slow push in on the cybernetic protagonist",
    actionSummary: "Protagonist raises visor and examines glowing data shard",
    lightingStyle: "neon_night",
    environmentDescription: "Rain-slicked alleyway in Neo-Tokyo",
    colorPalette: ["cyan", "magenta", "deep_navy"],
    atmosphere: "steamy neon rain haze",
    subjects: [
      {
        subjectId: "subject-hero-1",
        role: "subject_identity",
        initialPosition: "screen_center",
        movementTrajectory: "stationary, raises arm forward"
      }
    ],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2000,
        description: "Visor lifts to reveal cybernetic eye",
        cameraAction: "gentle push in",
        subjectAction: "hand lifts visor"
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Shard glows brighter, illuminating face",
        cameraAction: "hold close framing",
        subjectAction: "gaze fixes on glowing data"
      }
    ],
    dialogue: null,
    continuity: {
      persistentSubjectIds: ["subject-hero-1"],
      frameAnchorTarget: "none"
    },
    previs: {
      candidateId: "33333333-3333-4333-8333-333333333333",
      media: {
        available: true,
        url: "https://media.example.com/previs-1.jpg"
      },
      reviewNotes: "Previs draft showing eye-level composition"
    },
    boundReferences: [
      {
        referenceAssetId: "44444444-4444-4444-8444-444444444444",
        sceneId: "22222222-2222-4222-8222-222222222222",
        specRevision: 2,
        role: "subject_identity",
        displayName: "Protagonist Face Model",
        width: 1024,
        height: 1024,
        previewUrl: "https://media.example.com/ref-hero.png",
        previewAvailability: "available"
      }
    ],
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

describe("ShotPlanPanel Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders empty state when no shot plans are present", () => {
    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[]} currentSpecRevision={2} />);

    expect(html).toContain('data-testid="shot-plan-panel"');
    expect(html).toContain('data-testid="no-shot-plans-state"');
    expect(html).toContain("No shot plans have been generated for this scene");
  });

  it("renders structured intent, references, and distinct previs visualization", () => {
    const plan = createSampleShotPlan();
    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

    // Section and authority headers
    expect(html).toContain('data-testid="shot-plan-panel"');
    expect(html).toContain("Structured Production Intent");
    expect(html).toContain("Director approval binds to structured ShotPlan intent");

    // Card header
    expect(html).toContain('data-testid="shot-plan-card"');
    expect(html).toContain("Variant #1");
    expect(html).toContain("DRAFT");
    expect(html).toContain("Reference Directed");
    expect(html).toContain("Rev 2 (Current)");

    // Previs visualization (distinguished and labeled as non-authoritative)
    expect(html).toContain('data-testid="shot-plan-previs-visualization"');
    expect(html).toContain("Previs Visualization (Non-Authoritative)");
    expect(html).toContain("not conditioned as first-frame in reference-directed H3");
    expect(html).toContain('data-testid="previs-preview-image"');
    expect(html).toContain("https://media.example.com/previs-1.jpg");

    // Structured attributes
    expect(html).toContain("4000 ms (4.00s) (97 frames)");
    expect(html).toContain("medium_close_up");
    expect(html).toContain("eye_level");
    expect(html).toContain("dolly_in (slow)");
    expect(html).toContain("50mm prime cinematic");
    expect(html).toContain("Protagonist raises visor and examines glowing data shard");
    expect(html).toContain("neon_night");
    expect(html).toContain("Rain-slicked alleyway in Neo-Tokyo");
    expect(html).toContain("subject-hero-1");
    expect(html).toContain("Visor lifts to reveal cybernetic eye");

    // Visual Authority Reference Assets
    expect(html).toContain('data-testid="shot-plan-references"');
    expect(html).toContain("Authoritative Reference Assets (Visual Authority)");
    expect(html).toContain('data-testid="shot-plan-reference-item"');
    expect(html).toContain("Protagonist Face Model");
    expect(html).toContain("subject");
    expect(html).toContain("1024×1024");
    expect(html).toContain('data-testid="reference-preview-image"');

    // Actions
    expect(html).toContain('data-testid="shot-plan-select-button"');
    expect(html).toContain('data-testid="shot-plan-approve-button"');
    expect(html).toContain("Select Plan");
    expect(html).toContain("Approve Intent");
  });

  it("renders frame-anchored routing mode and authoritative anchor identity when valid and confirmed", () => {
    const candidateHash = "a".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "anchor-candidate-uuid-9999",
        anchorMediaHashSha256: candidateHash
      },
      previs: {
        candidateId: "anchor-candidate-uuid-9999",
        media: {
          available: true,
          url: "https://media.example.com/anchor.jpg"
        }
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "anchor-candidate-uuid-9999",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: {
              available: true,
              url: "https://media.example.com/anchor.jpg"
            },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain("Frame Anchored");
    expect(html).toContain('data-testid="shot-plan-frame-anchor-notice"');
    expect(html).toContain('data-testid="shot-plan-frame-anchor-target"');
    expect(html).toContain("first_frame");
    expect(html).toContain('data-testid="shot-plan-frame-anchor-asset"');
    expect(html).toContain("anchor-candidate-uuid-9999");
    expect(html).toContain("Anchor source for declared frame-anchored route");

    // Approve button MUST be enabled for confirmed authoritative anchor
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).toBeNull();
  });

  it("marks stale shot plans and disables action buttons", () => {
    const stalePlan = createSampleShotPlan({
      specRevision: 1,
      isCurrentRevision: false
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[stalePlan]} currentSpecRevision={2} />
    );

    expect(html).toContain("Rev 1 (Stale)");
    expect(html).toContain("shot-plan-card-stale");

    // Both buttons disabled because plan is stale
    const selectBtnMatch = html.match(/data-testid="shot-plan-select-button"[^>]*disabled=""/);
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(selectBtnMatch).not.toBeNull();
    expect(approveBtnMatch).not.toBeNull();
  });

  it("indicates selected and approved plan status badges", () => {
    const selectedPlan = createSampleShotPlan({
      shotPlanId: "selected-plan-id",
      status: "draft"
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[selectedPlan]}
        selectedShotPlanId="selected-plan-id"
        currentSpecRevision={2}
      />
    );

    expect(html).toContain('data-testid="shot-plan-selected-badge"');
    expect(html).toContain("Selected Plan");
  });

  it("renders missing anchor error and disables approval when frame-anchored plan lacks anchor", () => {
    const invalidPlan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none",
        anchorCandidateId: null
      },
      previs: {
        candidateId: "previs-candidate-should-not-be-inferred",
        media: {
          available: true,
          url: "https://media.example.com/previs-fallback.jpg"
        }
      }
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[invalidPlan]} currentSpecRevision={2} />
    );

    expect(html).toContain("Frame Anchored");
    expect(html).toContain('data-testid="shot-plan-frame-anchor-missing"');
    expect(html).toContain("Missing authoritative anchor");
    // Ensure no fallback inference to previs candidate or first_frame
    expect(html).not.toContain("previs-candidate-should-not-be-inferred");
    expect(html).not.toContain('data-testid="shot-plan-frame-anchor-target"');

    // Approve button MUST be disabled because frame anchor is invalid/missing
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when frame anchor target is unsupported", () => {
    const candidateHash = "b".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "last_frame",
        anchorCandidateId: "anchor-candidate-uuid-9999",
        anchorMediaHashSha256: candidateHash
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "anchor-candidate-uuid-9999",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("last_frame");
    expect(html).toContain("only &quot;first_frame&quot; is currently supported");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when candidate cannot be resolved", () => {
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "missing-candidate-uuid",
        anchorMediaHashSha256: "c".repeat(64)
      }
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} candidatesByRevision={[]} />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("missing-candidate-uuid");
    expect(html).toContain("was not found in candidate history");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when candidate revision is stale", () => {
    const candidateHash = "d".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "stale-candidate-uuid",
        anchorMediaHashSha256: candidateHash
      }
    });

    const candidateGroups = [
      {
        specRevision: 1, // older revision
        candidates: [
          {
            candidateId: "stale-candidate-uuid",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 1,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("does not match current scene revision");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when candidate content hash mismatches", () => {
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "hash-mismatch-candidate-uuid",
        anchorMediaHashSha256: "e".repeat(64)
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "hash-mismatch-candidate-uuid",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: "f".repeat(64), // mismatched hash!
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("does not match ShotPlan declared anchorMediaHashSha256");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("presents ShotPlan variant as a professional storyboard panel with camera sluglines, blocking, and non-production banner", () => {
    const plan = createSampleShotPlan();
    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

    // Director slate slugline
    expect(html).toContain('data-testid="storyboard-slate-title"');
    expect(html).toContain("SCENE 22222222 · SHOTPLAN V1");

    // Persistent Non-Production visual treatment
    expect(html).toContain('data-testid="previs-non-production-badge"');
    expect(html).toContain("Storyboard / Previs — non-production image");
    expect(html).toContain(
      "Visual truth is supplied by bound reference assets. Previs pixels are not conditioned into production."
    );

    // Cinematic camera sluglines in uppercase
    expect(html).toContain("MEDIUM CLOSE-UP · EYE LEVEL · 50mm prime cinematic");
    expect(html).toContain("DOLLY IN · SLOW");

    // Directional Staging & Blocking
    expect(html).toContain("Staging &amp; Blocking");
    expect(html).toContain("Subject:");
    expect(html).toContain("subject-hero-1");
    expect(html).toContain("[Protagonist Face Model · subject_identity]");
    expect(html).toContain("screen center → stationary, raises arm forward");

    // Technical Footprint & Routing
    expect(html).toContain("Duration:");
    expect(html).toContain("4000 ms (4.00s) (97 frames)");
    expect(html).toContain("Routing Mode:");
    expect(html).toContain("Reference Directed");
  });

  it("renders director slate format with custom sceneId and variantOrdinal", () => {
    const plan = createSampleShotPlan({
      sceneId: "scene-04",
      variantOrdinal: 2
    });
    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

    expect(html).toContain("SCENE 04 · SHOTPLAN V2");
    expect(html).toContain("Variant #2");
  });

  it("associates subject blocking with bound references by referenceAssetId or role", () => {
    const plan = createSampleShotPlan({
      subjects: [
        {
          subjectId: "subject-elena",
          referenceAssetId: "55555555-5555-4555-8555-555555555555",
          role: "subject_identity",
          initialPosition: "screen_left",
          movementTrajectory: "screen left → center",
          interactionSummary: "reaches for product"
        },
        {
          subjectId: "product-can",
          referenceAssetId: "66666666-6666-4666-8666-666666666666",
          role: "product",
          initialPosition: "foreground_right",
          movementTrajectory: "stationary on counter",
          interactionSummary: null
        }
      ],
      boundReferences: [
        {
          referenceAssetId: "55555555-5555-4555-8555-555555555555",
          role: "subject_identity",
          displayName: "Elena Vance",
          width: 1024,
          height: 1024,
          previewUrl: "https://media.example.com/elena.png",
          previewAvailability: "available"
        },
        {
          referenceAssetId: "66666666-6666-4666-8666-666666666666",
          role: "product",
          displayName: "Cyber Cola Can",
          width: 512,
          height: 512,
          previewUrl: "https://media.example.com/cola.png",
          previewAvailability: "available"
        }
      ]
    });

    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

    expect(html).toContain("Subject:");
    expect(html).toContain("subject-elena");
    expect(html).toContain("[Elena Vance · subject_identity]");
    expect(html).toContain("screen left → screen left → center");
    expect(html).toContain("reaches for product");

    expect(html).toContain("Product:");
    expect(html).toContain("product-can");
    expect(html).toContain("[Cyber Cola Can · product]");
    expect(html).toContain("foreground right → stationary on counter");
  });

  it("dispatches identity-based select_shotplan command on Select Plan click", () => {
    const plan = createSampleShotPlan();
    const dispatch = vi.fn();

    render(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        dispatch={dispatch}
        allowedActions={["select_shotplan"]}
      />
    );

    const selectBtn = screen.getByTestId("shot-plan-select-button");
    fireEvent.click(selectBtn);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "select_shotplan",
        payload: {
          shotPlanId: plan.shotPlanId,
          expectedSpecRevision: 2
        },
        displayLabel: "Select Shot Plan"
      }
    });
  });

  it("dispatches identity-based approve_shotplan command on Approve Intent click", () => {
    const plan = createSampleShotPlan();
    const dispatch = vi.fn();

    render(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        dispatch={dispatch}
        allowedActions={["approve_shotplan"]}
      />
    );

    const approveBtn = screen.getByTestId("shot-plan-approve-button");
    fireEvent.click(approveBtn);

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "REQUEST_CONFIRMATION",
      stagedAction: {
        action: "approve_shotplan",
        payload: {
          shotPlanId: plan.shotPlanId,
          expectedSpecRevision: 2
        },
        displayLabel: "Approve Shot Plan"
      }
    });
  });

  it("calls onSelectShotPlan and onApproveShotPlan callback props directly when provided", () => {
    const plan = createSampleShotPlan();
    const onSelect = vi.fn();
    const onApprove = vi.fn();

    render(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        onSelectShotPlan={onSelect}
        onApproveShotPlan={onApprove}
        allowedActions={["select_shotplan", "approve_shotplan"]}
      />
    );

    fireEvent.click(screen.getByTestId("shot-plan-select-button"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(plan.shotPlanId);

    fireEvent.click(screen.getByTestId("shot-plan-approve-button"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(plan.shotPlanId);
  });

  it("renders explicit non-production status for frame-anchored route with missing anchor", () => {
    const invalidPlan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none",
        anchorCandidateId: null
      }
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[invalidPlan]} currentSpecRevision={2} />
    );

    expect(html).toContain('data-testid="previs-non-production-badge"');
    expect(html).toContain("Storyboard / Previs — non-production image (missing frame anchor)");
    expect(html).toContain("badge-frame-anchor-invalid");
  });

  it("renders conditional pixel anchor status for confirmed frame-anchored route", () => {
    const candidateHash = "a".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "anchor-cand-1234",
        anchorMediaHashSha256: candidateHash
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "anchor-cand-1234",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="previs-non-production-badge"');
    expect(html).toContain("Frame Anchor Candidate — conditional pixel anchor (first_frame)");
    expect(html).toContain("badge-frame-anchor-valid");
  });

  describe("Generate Shot Plans Action in Empty State", () => {
    const sceneId = "123e4567-e89b-12d3-a456-426614174000";

    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      cleanup();
      vi.restoreAllMocks();
    });

    it("renders Generate Shot Plans button in empty state when sceneId is present", () => {
      render(<ShotPlanPanel shotPlans={[]} currentSpecRevision={1} sceneId={sceneId} />);

      const button = screen.getByTestId("generate-shot-plans-button");
      expect(button).toBeDefined();
      expect(button.textContent).toBe("Generate Shot Plans");
      expect((button as HTMLButtonElement).disabled).toBe(false);
    });

    it("disables button when sceneId is absent or disabled prop is true", () => {
      const { rerender } = render(
        <ShotPlanPanel shotPlans={[]} currentSpecRevision={1} sceneId={undefined} />
      );
      const buttonWithoutSceneId = screen.getByTestId(
        "generate-shot-plans-button"
      ) as HTMLButtonElement;
      expect(buttonWithoutSceneId.disabled).toBe(true);

      rerender(
        <ShotPlanPanel shotPlans={[]} currentSpecRevision={1} sceneId={sceneId} disabled={true} />
      );
      const buttonDisabled = screen.getByTestId("generate-shot-plans-button") as HTMLButtonElement;
      expect(buttonDisabled.disabled).toBe(true);
    });

    it("submits exact default payload { variantCount: 2, reroll: false } and invokes onRefresh and router.refresh on success", async () => {
      const onGenerateShotPlans = vi.fn().mockResolvedValue(undefined);
      const onRefresh = vi.fn().mockResolvedValue(undefined);

      render(
        <ShotPlanPanel
          shotPlans={[]}
          currentSpecRevision={1}
          sceneId={sceneId}
          onGenerateShotPlans={onGenerateShotPlans}
          onRefresh={onRefresh}
        />
      );

      const button = screen.getByTestId("generate-shot-plans-button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(onGenerateShotPlans).toHaveBeenCalledTimes(1);
      });
      expect(onGenerateShotPlans).toHaveBeenCalledWith({ variantCount: 2, reroll: false });
      expect(onRefresh).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it("calls same-origin fetch with count 2 and reroll false when onGenerateShotPlans is not provided", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sceneId, shotPlans: [], isIdempotentReplay: false })
      });
      vi.stubGlobal("fetch", mockFetch);

      render(<ShotPlanPanel shotPlans={[]} currentSpecRevision={1} sceneId={sceneId} />);

      const button = screen.getByTestId("generate-shot-plans-button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });
      expect(mockFetch).toHaveBeenCalledWith(`/api/scenes/${sceneId}/shot-plans`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ variantCount: 2, reroll: false })
      });
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it("shows pending state and blocks duplicate submissions while in-flight", async () => {
      let resolvePromise: () => void = () => {};
      const pendingPromise = new Promise<void>((res) => {
        resolvePromise = res;
      });
      const onGenerateShotPlans = vi.fn().mockReturnValue(pendingPromise);

      render(
        <ShotPlanPanel
          shotPlans={[]}
          currentSpecRevision={1}
          sceneId={sceneId}
          onGenerateShotPlans={onGenerateShotPlans}
        />
      );

      const button = screen.getByTestId("generate-shot-plans-button") as HTMLButtonElement;
      fireEvent.click(button);

      // Pending state is visible
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe("Generating Shot Plans...");
      expect(screen.getByTestId("generating-shot-plans-status")).toBeDefined();
      expect(screen.getByTestId("generating-shot-plans-status").textContent).toContain(
        "Generating shot plans (2 variants)..."
      );

      // Attempt second click while in-flight
      fireEvent.click(button);
      expect(onGenerateShotPlans).toHaveBeenCalledTimes(1);

      // Resolve pending operation
      resolvePromise();
      await waitFor(() => {
        expect(button.disabled).toBe(false);
      });
      expect(button.textContent).toBe("Generate Shot Plans");
      expect(screen.queryByTestId("generating-shot-plans-status")).toBeNull();
    });

    it("surfaces actionable message on CLOUD_PLANNING_NOT_AUTHORIZED error", async () => {
      const onGenerateShotPlans = vi.fn().mockRejectedValue({
        status: 403,
        error: {
          code: "CLOUD_PLANNING_NOT_AUTHORIZED",
          message: "allowCloudPlanning disabled"
        }
      });

      render(
        <ShotPlanPanel
          shotPlans={[]}
          currentSpecRevision={1}
          sceneId={sceneId}
          onGenerateShotPlans={onGenerateShotPlans}
        />
      );

      const button = screen.getByTestId("generate-shot-plans-button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId("shot-plan-error-message")).toBeDefined();
      });
      const errorMsg = screen.getByTestId("shot-plan-error-message");
      expect(errorMsg.textContent).toContain(
        "Cloud planning not authorized: allowCloudPlanning disabled"
      );
    });

    it("surfaces actionable message on CONFIGURATION_ERROR error", async () => {
      const onGenerateShotPlans = vi.fn().mockRejectedValue({
        status: 503,
        error: {
          code: "CONFIGURATION_ERROR",
          message: "Shot plan planning is not available; planning model clients are not configured."
        }
      });

      render(
        <ShotPlanPanel
          shotPlans={[]}
          currentSpecRevision={1}
          sceneId={sceneId}
          onGenerateShotPlans={onGenerateShotPlans}
        />
      );

      const button = screen.getByTestId("generate-shot-plans-button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId("shot-plan-error-message")).toBeDefined();
      });
      const errorMsg = screen.getByTestId("shot-plan-error-message");
      expect(errorMsg.textContent).toContain(
        "Planning configuration error: Shot plan planning is not available"
      );
    });

    it("surfaces safe generic message on unexpected errors and clears error on retry", async () => {
      const onGenerateShotPlans = vi
        .fn()
        .mockRejectedValueOnce(new Error("Network connection dropped"))
        .mockResolvedValueOnce(undefined);

      render(
        <ShotPlanPanel
          shotPlans={[]}
          currentSpecRevision={1}
          sceneId={sceneId}
          onGenerateShotPlans={onGenerateShotPlans}
        />
      );

      const button = screen.getByTestId("generate-shot-plans-button");
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByTestId("shot-plan-error-message")).toBeDefined();
      });
      expect(screen.getByTestId("shot-plan-error-message").textContent).toContain(
        "Failed to generate shot plans. Please try again."
      );

      // Retry: clicking button clears old error
      fireEvent.click(button);
      await waitFor(() => {
        expect(screen.queryByTestId("shot-plan-error-message")).toBeNull();
      });
    });

    it("renders stale spec banner and generation button when all shot plans belong to a prior revision", () => {
      const stalePlan = createSampleShotPlan({
        specRevision: 1,
        isCurrentRevision: false
      });
      const html = renderToStaticMarkup(
        <ShotPlanPanel shotPlans={[stalePlan]} currentSpecRevision={2} sceneId={sceneId} />
      );
      expect(html).toContain('data-testid="shot-plan-stale-spec-banner"');
      expect(html).toContain("Spec Revision Updated");
      expect(html).toContain("Generate Shot Plans for Revision 2");
    });
  });

  describe("Animatic Integration & Dual-Column Synchronization", () => {
    it("renders animatic player with controls and watermarking in storyboard panel", () => {
      const plan = createSampleShotPlan();
      const html = renderToStaticMarkup(
        <ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />
      );

      expect(html).toContain('data-testid="shot-plan-animatic-player"');
      expect(html).toContain('data-testid="animatic-play-toggle"');
      expect(html).toContain('data-testid="animatic-restart-button"');
      expect(html).toContain('data-testid="animatic-scrubber"');
      expect(html).toContain('data-testid="animatic-time-display"');
      expect(html).toContain('data-testid="animatic-non-production-watermark"');
      expect(html).toContain("STORYBOARD ANIMATIC — NON-PRODUCTION");
    });

    it("dynamically synchronizes active beat highlight in right-column script breakdown when scrubbed", () => {
      const plan = createSampleShotPlan();
      render(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

      // Initially Beat 1 is active (at 0ms)
      const beatsList = screen.getByTestId("shot-plan-beats");
      const beatItems = beatsList.querySelectorAll(".storyboard-beat-item");
      expect(beatItems).toHaveLength(2);

      expect(beatItems[0]?.classList.contains("storyboard-beat-item-active")).toBe(true);
      expect(beatItems[0]?.getAttribute("data-active-beat")).toBe("true");
      expect(beatItems[1]?.classList.contains("storyboard-beat-item-active")).toBe(false);

      // Scrub animatic player to 3000ms (Beat 2: [2000, 4000])
      const scrubber = screen.getByTestId("animatic-scrubber");
      fireEvent.change(scrubber, { target: { value: "3000" } });

      // Beat 2 should now be highlighted with storyboard-beat-item-active
      expect(beatItems[0]?.classList.contains("storyboard-beat-item-active")).toBe(false);
      expect(beatItems[1]?.classList.contains("storyboard-beat-item-active")).toBe(true);
      expect(beatItems[1]?.getAttribute("data-active-beat")).toBe("true");
    });
  });

  describe("Directed ShotPlan Variations UX", () => {
    const sceneId = "22222222-2222-4222-8222-222222222222";

    it("renders Create variation button on current shot plans and disables it on stale plans", () => {
      const currentPlan = createSampleShotPlan({
        shotPlanId: "plan-current-1",
        variantOrdinal: 1,
        specRevision: 2,
        isCurrentRevision: true
      });
      const stalePlan = createSampleShotPlan({
        shotPlanId: "plan-stale-2",
        variantOrdinal: 2,
        specRevision: 1,
        isCurrentRevision: false
      });

      render(
        <ShotPlanPanel
          shotPlans={[currentPlan, stalePlan]}
          currentSpecRevision={2}
          sceneId={sceneId}
        />
      );

      const variationButtons = screen.getAllByTestId("shot-plan-create-variation-button");
      expect(variationButtons).toHaveLength(2);

      const currentBtn = variationButtons[0] as HTMLButtonElement;
      const staleBtn = variationButtons[1] as HTMLButtonElement;

      expect(currentBtn.disabled).toBe(false);
      expect(currentBtn.textContent).toBe("Create variation");
      expect(staleBtn.disabled).toBe(true);
    });

    it("disables Create variation button when disabled prop is true", () => {
      const plan = createSampleShotPlan();
      render(
        <ShotPlanPanel
          shotPlans={[plan]}
          currentSpecRevision={2}
          sceneId={sceneId}
          disabled={true}
        />
      );

      const btn = screen.getByTestId("shot-plan-create-variation-button") as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("opens variation modal with chosen source variant identity when clicked", () => {
      const plan = createSampleShotPlan({
        variantOrdinal: 2,
        lensIntent: "85mm portrait"
      });

      render(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} sceneId={sceneId} />);

      // Modal is not visible initially
      expect(screen.queryByTestId("shot-plan-variation-modal")).toBeNull();

      // Click Create variation
      const btn = screen.getByTestId("shot-plan-create-variation-button");
      fireEvent.click(btn);

      // Modal is opened
      const modal = screen.getByTestId("shot-plan-variation-modal");
      expect(modal).toBeDefined();

      const identity = screen.getByTestId("variation-source-identity");
      expect(identity.textContent).toContain("Source Variant: V2 (Rev 2)");
      expect(identity.textContent).toContain("85mm portrait");
    });

    it("displays Variation of V1 badge and guidance note when shot plan has derivation provenance", () => {
      const derivedPlan = createSampleShotPlan({
        variantOrdinal: 3,
        derivedFromShotPlanId: "11111111-1111-4111-8111-111111111111",
        derivation: {
          sourceShotPlanId: "11111111-1111-4111-8111-111111111111",
          sourceVariantOrdinal: 1,
          directorGuidance: "Make it a tighter 50mm shot and use slow dolly in",
          requestedAt: "2026-09-28T12:00:00.000Z"
        }
      });

      render(<ShotPlanPanel shotPlans={[derivedPlan]} currentSpecRevision={2} sceneId={sceneId} />);

      const badge = screen.getByTestId("shot-plan-variation-badge");
      expect(badge).toBeDefined();
      expect(badge.textContent).toBe("Variation of V1");

      const note = screen.getByTestId("shot-plan-derivation-note");
      expect(note).toBeDefined();
      expect(note.textContent).toContain("Make it a tighter 50mm shot and use slow dolly in");
    });

    it("invokes onRefresh and router.refresh when variation is successfully created", async () => {
      const onRefresh = vi.fn();
      const mockCreate = vi.fn().mockResolvedValue({
        sceneId,
        sourceShotPlanId: "11111111-1111-4111-8111-111111111111",
        shotPlans: [createSampleShotPlan({ variantOrdinal: 2 })],
        isIdempotentReplay: false
      });

      const plan = createSampleShotPlan();
      render(
        <ShotPlanPanel
          shotPlans={[plan]}
          currentSpecRevision={2}
          sceneId={sceneId}
          onRefresh={onRefresh}
          onCreateVariation={mockCreate}
        />
      );

      fireEvent.click(screen.getByTestId("shot-plan-create-variation-button"));

      const textarea = screen.getByTestId("variation-guidance-input");
      fireEvent.change(textarea, { target: { value: "More dynamic angle" } });

      fireEvent.click(screen.getByTestId("submit-variation-button"));

      await waitFor(() => {
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(onRefresh).toHaveBeenCalledTimes(1);
        expect(mockRefresh).toHaveBeenCalledTimes(1);
      });

      // Modal closes after success
      expect(screen.queryByTestId("shot-plan-variation-modal")).toBeNull();
    });
  });

  describe("ShotPlan comparison", () => {
    it("disables the compare button when only a single plan exists", () => {
      const plan = createSampleShotPlan();
      render(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

      const compareButton = screen.getByTestId("shot-plan-compare-button") as HTMLButtonElement;
      expect(compareButton.disabled).toBe(true);
      expect(compareButton.textContent).toBe("Compare");
    });

    it("labels the compare button 'Compare to source' for a derived variation", () => {
      const source = createSampleShotPlan({ variantOrdinal: 2 });
      const variation = createSampleShotPlan({
        shotPlanId: "55555555-5555-4555-8555-555555555555",
        variantOrdinal: 4,
        derivedFromShotPlanId: source.shotPlanId,
        derivation: {
          sourceShotPlanId: source.shotPlanId,
          sourceVariantOrdinal: source.variantOrdinal,
          directorGuidance: "Tighter 50mm, product forward, slow dolly-in",
          requestedAt: "2026-09-28T12:00:00.000Z"
        }
      });

      render(<ShotPlanPanel shotPlans={[source, variation]} currentSpecRevision={2} />);

      const compareButtons = screen.getAllByTestId("shot-plan-compare-button");
      const variationButton = compareButtons.find(
        (btn) => btn.getAttribute("data-shot-plan-id") === variation.shotPlanId
      )! as HTMLButtonElement;
      expect(variationButton.textContent).toBe("Compare to source");
      expect(variationButton.disabled).toBe(false);
    });

    it("opens the comparison modal pre-loaded with the resolved source variant and performs no fetch or dispatch", () => {
      const fetchSpy = vi.spyOn(global, "fetch");
      const dispatch = vi.fn();

      const source = createSampleShotPlan({ variantOrdinal: 2, framing: "medium" });
      const variation = createSampleShotPlan({
        shotPlanId: "55555555-5555-4555-8555-555555555555",
        variantOrdinal: 4,
        framing: "medium_close_up",
        derivedFromShotPlanId: source.shotPlanId,
        derivation: {
          sourceShotPlanId: source.shotPlanId,
          sourceVariantOrdinal: source.variantOrdinal,
          directorGuidance: "Tighter 50mm, product forward, slow dolly-in",
          requestedAt: "2026-09-28T12:00:00.000Z"
        }
      });

      render(
        <ShotPlanPanel
          shotPlans={[source, variation]}
          currentSpecRevision={2}
          dispatch={dispatch}
        />
      );

      const compareButtons = screen.getAllByTestId("shot-plan-compare-button");
      const variationButton = compareButtons.find(
        (btn) => btn.getAttribute("data-shot-plan-id") === variation.shotPlanId
      )!;
      fireEvent.click(variationButton);

      expect(screen.getByTestId("shot-plan-comparison-modal")).toBeTruthy();
      expect(screen.getByTestId("comparison-source-revision-badge").textContent).toContain("V2");
      expect(screen.getByTestId("comparison-target-revision-badge").textContent).toContain("V4");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });
});
