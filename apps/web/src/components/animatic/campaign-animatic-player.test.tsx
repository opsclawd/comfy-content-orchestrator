// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { CampaignAnimaticPlayer, formatTimestamp } from "./campaign-animatic-player.js";
import { compileCampaignAnimaticReadModel } from "@cco/contracts";
import type { RawAnimaticSceneInput } from "@cco/contracts";
import type { ShotPlanDocument } from "@cco/contracts";

function createMockShotPlanDocument(overrides?: Partial<ShotPlanDocument>): ShotPlanDocument {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 1,
    variantOrdinal: 1,
    status: "draft",
    routingMode: "reference_directed",
    targetDurationMs: 3000,
    targetFrameCount: 72,
    durationToleranceMs: 355,
    fps: 24,
    framing: "wide",
    angle: "eye_level",
    cameraMovement: "pan_right",
    movementSpeed: "medium",
    lensIntent: "35mm prime",
    cameraPosition: "eye level",
    cameraPromptDescription: "Pan right following car",
    actionSummary: "Electric sports car drives down coastal road",
    lightingStyle: "natural_golden_hour",
    environmentDescription: "Pacific Coast Highway sunset",
    colorPalette: ["amber", "orange", "deep_blue"],
    atmosphere: "warm golden glow",
    subjects: [
      {
        subjectId: "car-1",
        referenceAssetId: "33333333-3333-4333-8333-333333333333",
        role: "subject_identity",
        initialPosition: "screen_left",
        movementTrajectory: "moves from left to right",
        interactionSummary: "accelerates smoothly"
      }
    ],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 3000,
        description: "Car enters and accelerates",
        cameraAction: "pan right tracking car",
        subjectAction: "car speeds along curve"
      }
    ],
    dialogue: {
      speaker: "Narrator",
      line: "Performance meets serenity.",
      voiceoverCue: "Crisp and confident tone.",
      audioFxPrompt: "Electric motor hum and ocean waves"
    },
    continuity: {
      persistentSubjectIds: ["car-1"],
      frameAnchorTarget: "none"
    },
    previs: {
      candidateId: "44444444-4444-4444-8444-444444444444",
      storageBucket: "previs-bucket",
      storageObjectKey: "scenes/scene-1/previs.png",
      contentHashSha256: "a".repeat(64),
      modelProfile: "flux-schnell",
      generatedAt: "2026-09-28T10:00:00.000Z",
      reviewNotes: "Previs draft"
    },
    createdAt: "2026-09-28T10:00:00.000Z",
    updatedAt: "2026-09-28T10:00:00.000Z",
    ...overrides
  };
}

describe("CampaignAnimaticPlayer Component", () => {
  const campaignId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const campaignName = "Summer Launch";
  const campaignUpdatedAt = "2026-09-28T10:00:00.000Z";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders non-production watermark, scene ordinal, selected draft status badge, and controls", () => {
    const plan1 = createMockShotPlanDocument();
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1,
      fallbackPrevisUrl: "https://media.example.com/previs-scene1.jpg"
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    // Watermark
    expect(screen.getByTestId("animatic-non-production-watermark").textContent).toContain(
      "STORYBOARD ANIMATIC — NON-PRODUCTION"
    );

    // Scene identity
    expect(screen.getByTestId("animatic-scene-ordinal").textContent).toContain(
      "SCENE 1 / 1 · SHOT V1"
    );

    // Approval status badge (selected draft)
    const badge = screen.getByTestId("animatic-shot-approval-badge");
    expect(badge.textContent).toContain("SELECTED DRAFT");
    expect(badge.getAttribute("data-approval-status")).toBe("draft");

    // Previs image
    expect(screen.getByTestId("previs-preview-image")).not.toBeNull();

    // Controls
    expect(screen.getByTestId("animatic-play-toggle").textContent).toContain("▶ Play");
    expect(screen.getByTestId("animatic-scrubber")).not.toBeNull();
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:00.00 / 00:03.00"
    );
  });

  it("renders approved badge when ShotPlan is approved", () => {
    const plan1 = createMockShotPlanDocument({ status: "approved" });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: plan1.id,
      selectedShotPlan: plan1,
      fallbackPrevisUrl: "https://media.example.com/previs-scene1.jpg"
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    const badge = screen.getByTestId("animatic-shot-approval-badge");
    expect(badge.textContent).toContain("APPROVED");
    expect(badge.getAttribute("data-approval-status")).toBe("approved");
  });

  it("renders fallback grid when previs media is unavailable", () => {
    const plan1 = createMockShotPlanDocument({ previs: undefined });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1,
      fallbackPrevisUrl: null
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    expect(screen.queryByTestId("previs-preview-image")).toBeNull();
    expect(screen.getByTestId("previs-unavailable")).not.toBeNull();
  });

  it("renders explicit gap slate when scene has no selection", () => {
    const scene1: RawAnimaticSceneInput = {
      sceneId: "22222222-2222-4222-8222-222222222222",
      sceneOrder: 1,
      specRevision: 1,
      durationSeconds: 3,
      selectedShotPlanId: null,
      selectedShotPlanRevision: null,
      approvedShotPlanId: null,
      selectedShotPlan: null
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    expect(screen.getByTestId("animatic-gap-slate")).not.toBeNull();
    expect(screen.getByTestId("animatic-gap-badge").textContent).toContain("GAP / BLOCKER");
    expect(screen.getByTestId("animatic-gap-slate").textContent).toContain("NO_SELECTION");
    expect(screen.getByTestId("animatic-scene-ordinal").textContent).toContain(
      "SCENE 1 / 1 · NO SELECTION"
    );
  });

  it("toggles play and pause on click", () => {
    const plan1 = createMockShotPlanDocument();
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    const playBtn = screen.getByTestId("animatic-play-toggle");
    expect(playBtn.textContent).toContain("▶ Play");

    fireEvent.click(playBtn);
    expect(playBtn.textContent).toContain("⏸ Pause");

    fireEvent.click(playBtn);
    expect(playBtn.textContent).toContain("▶ Play");
  });

  it("scrubs continuously across scenes and transitions between segments", () => {
    const plan1 = createMockShotPlanDocument({
      id: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222221",
      targetDurationMs: 3000
    });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const plan2 = createMockShotPlanDocument({
      id: "55555555-5555-4555-8555-555555555555",
      sceneId: "22222222-2222-4222-8222-222222222222",
      targetDurationMs: 4000,
      status: "approved"
    });
    const scene2: RawAnimaticSceneInput = {
      sceneId: plan2.sceneId,
      sceneOrder: 2,
      specRevision: 1,
      selectedShotPlanId: plan2.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: plan2.id,
      selectedShotPlan: plan2
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1, scene2]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    // Initially at scene 1
    expect(screen.getByTestId("animatic-scene-ordinal").textContent).toContain("SCENE 1 / 2");
    expect(screen.getByTestId("animatic-shot-approval-badge").textContent).toContain(
      "SELECTED DRAFT"
    );

    // Scrub to 3500ms (scene 2)
    const scrubber = screen.getByTestId("animatic-scrubber");
    fireEvent.change(scrubber, { target: { value: "3500" } });

    expect(screen.getByTestId("animatic-scene-ordinal").textContent).toContain("SCENE 2 / 2");
    expect(screen.getByTestId("animatic-shot-approval-badge").textContent).toContain("APPROVED");
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:03.50 / 00:07.00"
    );
  });

  it("navigates next and previous shots using step buttons", () => {
    const plan1 = createMockShotPlanDocument({
      id: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222221",
      targetDurationMs: 3000
    });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const plan2 = createMockShotPlanDocument({
      id: "55555555-5555-4555-8555-555555555555",
      sceneId: "22222222-2222-4222-8222-222222222222",
      targetDurationMs: 4000
    });
    const scene2: RawAnimaticSceneInput = {
      sceneId: plan2.sceneId,
      sceneOrder: 2,
      specRevision: 1,
      selectedShotPlanId: plan2.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan2
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1, scene2]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    // Click Next Shot -> jumps to scene 2 start (3000ms)
    fireEvent.click(screen.getByTestId("animatic-next-shot"));
    expect(screen.getByTestId("animatic-scene-ordinal").textContent).toContain("SCENE 2 / 2");
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:03.00 / 00:07.00"
    );

    // Click Prev Shot -> jumps back to scene 1 start (0ms)
    fireEvent.click(screen.getByTestId("animatic-prev-shot"));
    expect(screen.getByTestId("animatic-scene-ordinal").textContent).toContain("SCENE 1 / 2");
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:00.00 / 00:07.00"
    );
  });

  it("displays dialogue HUD and beat card for active shot", () => {
    const plan1 = createMockShotPlanDocument({
      beats: [
        {
          beatIndex: 1,
          startMs: 0,
          endMs: 3000,
          description: "Car rounds the scenic bend",
          cameraAction: "pan right tracking car",
          subjectAction: "car accelerates smoothly"
        }
      ],
      dialogue: {
        speaker: "Elena",
        line: "Pure electric power.",
        voiceoverCue: "Warm tone",
        audioFxPrompt: "Engine whine"
      }
    });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    // Dialogue banner
    expect(screen.getByTestId("animatic-dialogue-hud").textContent).toContain("Elena");
    expect(screen.getByTestId("animatic-dialogue-hud").textContent).toContain(
      "Pure electric power."
    );
    expect(screen.getByTestId("animatic-dialogue-hud").textContent).toContain("VO: Warm tone");

    // Beat HUD
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain("Beat 1");
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain(
      "Car rounds the scenic bend"
    );
  });

  it("displays stale rough cut warning banner when isStale is true and supports onRefresh", () => {
    const plan1 = createMockShotPlanDocument();
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    const onRefresh = vi.fn();

    render(<CampaignAnimaticPlayer animatic={animatic} isStale={true} onRefresh={onRefresh} />);

    expect(screen.getByTestId("animatic-stale-banner")).not.toBeNull();
    expect(screen.getByTestId("animatic-stale-banner").textContent).toContain("STALE ROUGH CUT");

    const reloadBtn = screen.getByTestId("animatic-reload-btn");
    fireEvent.click(reloadBtn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("displays stale banner when currentSnapshotId differs from animatic.readSnapshotId", () => {
    const plan1 = createMockShotPlanDocument();
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(
      <CampaignAnimaticPlayer animatic={animatic} currentSnapshotId="different-snapshot-hash" />
    );

    expect(screen.getByTestId("animatic-stale-banner")).not.toBeNull();
  });

  it("toggles reduced motion mode", () => {
    const plan1 = createMockShotPlanDocument();
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    const motionToggle = screen.getByTestId("animatic-reduced-motion-toggle");
    expect(motionToggle.textContent).toContain("Motion: Standard");

    fireEvent.click(motionToggle);
    expect(motionToggle.textContent).toContain("Motion: Reduced");
  });

  it("calls onActiveSegmentChange when scrubbing between segments", () => {
    const plan1 = createMockShotPlanDocument({
      id: "11111111-1111-4111-8111-111111111111",
      sceneId: "22222222-2222-4222-8222-222222222221",
      targetDurationMs: 3000
    });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const plan2 = createMockShotPlanDocument({
      id: "55555555-5555-4555-8555-555555555555",
      sceneId: "22222222-2222-4222-8222-222222222222",
      targetDurationMs: 4000
    });
    const scene2: RawAnimaticSceneInput = {
      sceneId: plan2.sceneId,
      sceneOrder: 2,
      specRevision: 1,
      selectedShotPlanId: plan2.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan2
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1, scene2]
    });

    const onActiveSegmentChange = vi.fn();
    render(
      <CampaignAnimaticPlayer animatic={animatic} onActiveSegmentChange={onActiveSegmentChange} />
    );

    expect(onActiveSegmentChange).toHaveBeenCalledWith(expect.objectContaining({ sceneOrder: 1 }));

    // Scrub to scene 2
    const scrubber = screen.getByTestId("animatic-scrubber");
    fireEvent.change(scrubber, { target: { value: "3500" } });

    expect(onActiveSegmentChange).toHaveBeenCalledWith(expect.objectContaining({ sceneOrder: 2 }));
  });

  it("advances playback via requestAnimationFrame and pauses cleanly upon reaching totalDurationMs", () => {
    let animFrameCallback: FrameRequestCallback | null = null;
    let animFrameCallCount = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      animFrameCallback = cb;
      animFrameCallCount++;
      return animFrameCallCount;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const plan1 = createMockShotPlanDocument({ targetDurationMs: 2000 });
    const scene1: RawAnimaticSceneInput = {
      sceneId: plan1.sceneId,
      sceneOrder: 1,
      specRevision: 1,
      selectedShotPlanId: plan1.id,
      selectedShotPlanRevision: 1,
      approvedShotPlanId: null,
      selectedShotPlan: plan1
    };

    const animatic = compileCampaignAnimaticReadModel({
      campaignId,
      campaignName,
      campaignUpdatedAt,
      scenes: [scene1]
    });

    render(<CampaignAnimaticPlayer animatic={animatic} />);

    const playBtn = screen.getByTestId("animatic-play-toggle");
    fireEvent.click(playBtn);
    expect(playBtn.textContent).toContain("⏸ Pause");
    expect(animFrameCallback).not.toBeNull();

    // Step 1: initial frame timestamp (delta = 0)
    act(() => {
      animFrameCallback!(1000);
    });
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:00.00 / 00:02.00"
    );

    // Step 2: intermediate frame (1000ms later)
    act(() => {
      animFrameCallback!(2000);
    });
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:01.00 / 00:02.00"
    );

    const callsBeforeEnd = animFrameCallCount;

    // Step 3: frame reaching total duration (another 1000ms later)
    act(() => {
      animFrameCallback!(3000);
    });
    expect(screen.getByTestId("animatic-time-display").textContent).toContain(
      "00:02.00 / 00:02.00"
    );
    expect(playBtn.textContent).toContain("▶ Play");

    // Crucial: requestAnimationFrame should NOT be called again once totalDurationMs is reached
    expect(animFrameCallCount).toBe(callsBeforeEnd);
  });
});

describe("formatTimestamp helper", () => {
  it("formats millisecond durations into strict MM:SS.ss strings", () => {
    expect(formatTimestamp(0)).toBe("00:00.00");
    expect(formatTimestamp(3000)).toBe("00:03.00");
    expect(formatTimestamp(3500)).toBe("00:03.50");
    expect(formatTimestamp(7000)).toBe("00:07.00");
    expect(formatTimestamp(12400)).toBe("00:12.40");
    expect(formatTimestamp(24500)).toBe("00:24.50");
    expect(formatTimestamp(65230)).toBe("01:05.23");
    expect(formatTimestamp(-100)).toBe("00:00.00");
  });
});
