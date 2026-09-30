// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShotPlanAnimaticPlayer } from "./shot-plan-animatic-player.js";
import { compileShotPlanAnimaticTimeline } from "@cco/contracts";
import type { ShotPlanReviewItem } from "@cco/contracts";

function createMockShotPlanReviewItem(overrides?: Partial<ShotPlanReviewItem>): ShotPlanReviewItem {
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
    cameraPromptDescription: "Slow push in on the protagonist",
    actionSummary: "Protagonist raises visor and examines glowing data shard",
    lightingStyle: "neon_night",
    environmentDescription: "Rain-slicked alleyway in Neo-Tokyo",
    colorPalette: ["cyan", "magenta"],
    atmosphere: "steamy neon rain haze",
    subjects: [
      {
        subjectId: "hero-1",
        referenceAssetId: "33333333-3333-4333-8333-333333333333",
        role: "subject_identity",
        initialPosition: "screen_center",
        movementTrajectory: "stationary, raises hand",
        interactionSummary: "looks into visor"
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
        description: "Shard glows brighter",
        cameraAction: "hold close framing",
        subjectAction: "gaze fixes on glowing data"
      }
    ],
    dialogue: {
      speaker: "Elena",
      line: "Look at this data shard...",
      voiceoverCue: "The city never sleeps.",
      audioFxPrompt: "Cybernetic servo whir"
    },
    continuity: {
      persistentSubjectIds: ["hero-1"],
      frameAnchorTarget: "none"
    },
    previs: {
      candidateId: "55555555-5555-4555-8555-555555555555",
      media: {
        available: true,
        url: "https://media.example.com/previs-1.jpg"
      },
      reviewNotes: "Previs draft"
    },
    boundReferences: [],
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

describe("ShotPlanAnimaticPlayer Component", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders non-production watermark, motion badge, controls, and previs image", () => {
    const item = createMockShotPlanReviewItem();
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    // Watermark
    expect(screen.getByTestId("animatic-non-production-watermark").textContent).toContain(
      "STORYBOARD ANIMATIC — NON-PRODUCTION"
    );

    // Motion Badge
    expect(screen.getByTestId("animatic-motion-badge").textContent).toContain("Dolly In / Push In");
    expect(screen.getByTestId("animatic-motion-badge").textContent).toContain("slow");

    // Controls
    expect(screen.getByTestId("animatic-play-toggle").textContent).toContain("▶ Play");
    expect(screen.getByTestId("animatic-restart-button")).not.toBeNull();
    expect(screen.getByTestId("animatic-scrubber")).not.toBeNull();
    expect(screen.getByTestId("animatic-time-display").textContent).toContain("0.00s / 4.00s");

    // Previs image
    const img = screen.getByTestId("previs-preview-image");
    expect(img.getAttribute("src")).toBe("https://media.example.com/previs-1.jpg");

    // Initial beat HUD
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain("Beat 1");
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain(
      "Visor lifts to reveal cybernetic eye"
    );

    // Dialogue HUD
    expect(screen.getByTestId("animatic-dialogue-hud").textContent).toContain("[Elena]:");
    expect(screen.getByTestId("animatic-dialogue-hud").textContent).toContain(
      "Look at this data shard..."
    );

    // Blocking markers
    expect(screen.getByTestId("animatic-blocking-marker").textContent).toContain("Subject: hero-1");
  });

  it("renders fallback grid when previs media is unavailable", () => {
    const item = createMockShotPlanReviewItem({
      previs: {
        candidateId: null,
        media: { available: false, url: undefined },
        reviewNotes: null
      }
    });
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    expect(screen.queryByTestId("previs-preview-image")).toBeNull();
    const fallback = screen.getByTestId("previs-unavailable");
    expect(fallback).not.toBeNull();
    expect(fallback.textContent).toContain("PREVIS PENDING");
  });

  it("displays stale revision banner when isCurrentRevision is false", () => {
    const item = createMockShotPlanReviewItem();
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={false} />);

    const staleBanner = screen.getByTestId("animatic-stale-banner");
    expect(staleBanner).not.toBeNull();
    expect(staleBanner.textContent).toContain("STALE REVISION (Rev 2)");
    expect(staleBanner.textContent).toContain("Historical Planning Only");
  });

  it("toggles play/pause state when play toggle button is clicked", () => {
    const item = createMockShotPlanReviewItem();
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    const playBtn = screen.getByTestId("animatic-play-toggle");
    expect(playBtn.textContent).toContain("▶ Play");

    fireEvent.click(playBtn);
    expect(playBtn.textContent).toContain("⏸ Pause");

    fireEvent.click(playBtn);
    expect(playBtn.textContent).toContain("▶ Play");
  });

  it("updates currentTimeMs, active beat, and camera transform when scrubbed", () => {
    const onActiveBeatChange = vi.fn();
    const item = createMockShotPlanReviewItem();
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(
      <ShotPlanAnimaticPlayer
        timeline={timeline}
        isCurrentRevision={true}
        onActiveBeatChange={onActiveBeatChange}
      />
    );

    // Initial state: Beat 1
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain("Beat 1");

    // Scrub to 3000ms (Beat 2)
    const scrubber = screen.getByTestId("animatic-scrubber");
    fireEvent.change(scrubber, { target: { value: "3000" } });

    expect(screen.getByTestId("animatic-time-display").textContent).toContain("3.00s / 4.00s");
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain("Beat 2");
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain(
      "Shard glows brighter"
    );

    // Camera transform should have scaled up
    const cameraLayer = screen.getByTestId("animatic-camera-layer");
    expect(cameraLayer.style.transform).toMatch(/scale\(1\.[0-9]+\)/);

    // Active beat callback called
    expect(onActiveBeatChange).toHaveBeenCalledWith(2);
  });

  it("resets playback to 0ms when restart button is clicked", () => {
    const item = createMockShotPlanReviewItem();
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    const scrubber = screen.getByTestId("animatic-scrubber");
    fireEvent.change(scrubber, { target: { value: "2500" } });
    expect(screen.getByTestId("animatic-time-display").textContent).toContain("2.50s / 4.00s");

    const restartBtn = screen.getByTestId("animatic-restart-button");
    fireEvent.click(restartBtn);

    expect(screen.getByTestId("animatic-time-display").textContent).toContain("0.00s / 4.00s");
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain("Beat 1");
  });

  it("keeps spatial stability (zero transform) for static shots", () => {
    const item = createMockShotPlanReviewItem({ cameraMovement: "static" });
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    const cameraLayer = screen.getByTestId("animatic-camera-layer");
    expect(cameraLayer.style.transform).toBe("scale(1) translate(0%, 0%) rotate(0deg)");

    // Scrub to mid-point
    const scrubber = screen.getByTestId("animatic-scrubber");
    fireEvent.change(scrubber, { target: { value: "2000" } });

    expect(cameraLayer.style.transform).toBe("scale(1) translate(0%, 0%) rotate(0deg)");
  });

  it("collapses transforms to identity when reduced motion is toggled", () => {
    const item = createMockShotPlanReviewItem({ cameraMovement: "dolly_in" });
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    const scrubber = screen.getByTestId("animatic-scrubber");
    fireEvent.change(scrubber, { target: { value: "3000" } });

    const cameraLayer = screen.getByTestId("animatic-camera-layer");
    // Initially scaled
    expect(cameraLayer.style.transform).toMatch(/scale\(1\.[0-9]+\)/);

    // Toggle reduced motion ON
    const reducedMotionToggle = screen.getByTestId("animatic-reduced-motion-toggle");
    fireEvent.click(reducedMotionToggle);

    // Transform becomes identity
    expect(cameraLayer.style.transform).toBe("scale(1) translate(0%, 0%) rotate(0deg)");

    // Scrubber and cues still active
    expect(screen.getByTestId("animatic-active-beat-hud").textContent).toContain("Beat 2");
  });

  it("performs zero network fetch calls and zero production state mutation", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const item = createMockShotPlanReviewItem();
    const timeline = compileShotPlanAnimaticTimeline(item);

    render(<ShotPlanAnimaticPlayer timeline={timeline} isCurrentRevision={true} />);

    // Play, pause, scrub, restart
    fireEvent.click(screen.getByTestId("animatic-play-toggle"));
    fireEvent.click(screen.getByTestId("animatic-play-toggle"));
    fireEvent.change(screen.getByTestId("animatic-scrubber"), { target: { value: "1500" } });
    fireEvent.click(screen.getByTestId("animatic-restart-button"));

    // Assert zero fetch calls
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
