// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ShotPlanBeatStrip } from "./shot-plan-beat-strip";
import type { ShotPlanTemporalBeat, ShotPlanBeatFrameReviewItem } from "@cco/contracts";

describe("ShotPlanBeatStrip Component", () => {
  afterEach(() => {
    cleanup();
  });

  const sampleBeats: ShotPlanTemporalBeat[] = [
    {
      beatIndex: 1,
      startMs: 0,
      endMs: 1500,
      description: "Close-up on agent eye",
      cameraAction: "static hold",
      subjectAction: "pupil dilates"
    },
    {
      beatIndex: 2,
      startMs: 1500,
      endMs: 3000,
      description: "Pull back to medium shot",
      cameraAction: "dolly back",
      subjectAction: "steps into rain"
    },
    {
      beatIndex: 3,
      startMs: 3000,
      endMs: 4500,
      description: "Neon reflection on pavement",
      cameraAction: "tilt down",
      subjectAction: "foot splashes in puddle"
    }
  ];

  it("returns null when beats array is empty", () => {
    const { container } = render(<ShotPlanBeatStrip beats={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders beat slots in beatIndex order even if input array is shuffled", () => {
    // Shuffled input: beat 3, beat 1, beat 2
    const shuffledBeats = [sampleBeats[2]!, sampleBeats[0]!, sampleBeats[1]!];
    const frames: ShotPlanBeatFrameReviewItem[] = [
      {
        beatIndex: 1,
        status: "ready",
        candidateId: "cand-1",
        media: { available: true, url: "https://media.example.com/beat-1.jpg" }
      },
      {
        beatIndex: 2,
        status: "pending",
        media: { available: false }
      },
      {
        beatIndex: 3,
        status: "failed",
        media: { available: false }
      }
    ];

    render(<ShotPlanBeatStrip beats={shuffledBeats} beatFrames={frames} planId="plan-test-123" />);

    const strip = screen.getByTestId("shot-plan-beat-strip");
    expect(strip).toBeDefined();
    expect(strip.getAttribute("data-shot-plan-id")).toBe("plan-test-123");

    // Badge
    const badge = screen.getByTestId("beat-strip-badge");
    expect(badge.textContent).toContain("Beat frames — non-authoritative");

    // Ordered slots
    const slots = screen.getAllByTestId("shot-plan-beat-slot");
    expect(slots).toHaveLength(3);

    expect(slots[0]?.getAttribute("data-beat-index")).toBe("1");
    expect(slots[0]?.getAttribute("data-status")).toBe("ready");

    expect(slots[1]?.getAttribute("data-beat-index")).toBe("2");
    expect(slots[1]?.getAttribute("data-status")).toBe("pending");

    expect(slots[2]?.getAttribute("data-beat-index")).toBe("3");
    expect(slots[2]?.getAttribute("data-status")).toBe("failed");
  });

  it("renders ready image with proper alt text and captions", () => {
    const frames: ShotPlanBeatFrameReviewItem[] = [
      {
        beatIndex: 1,
        status: "ready",
        candidateId: "cand-1",
        media: { available: true, url: "https://media.example.com/beat-1.jpg" }
      }
    ];

    render(<ShotPlanBeatStrip beats={[sampleBeats[0]!]} beatFrames={frames} />);

    const img = screen.getByTestId("shot-plan-beat-image");
    expect(img.getAttribute("src")).toBe("https://media.example.com/beat-1.jpg");
    expect(img.getAttribute("alt")).toBe("Beat 1: Close-up on agent eye");

    const caption = screen.getByTestId("shot-plan-beat-caption");
    expect(caption.textContent).toBe("Beat 1");
  });

  it("renders labeled placeholders for pending, failed, and unavailable statuses", () => {
    const frames: ShotPlanBeatFrameReviewItem[] = [
      {
        beatIndex: 1,
        status: "pending",
        media: { available: false }
      },
      {
        beatIndex: 2,
        status: "failed",
        media: { available: false }
      },
      {
        beatIndex: 3,
        status: "unavailable",
        media: { available: false }
      }
    ];

    render(<ShotPlanBeatStrip beats={sampleBeats} beatFrames={frames} />);

    const placeholders = screen.getAllByTestId("shot-plan-beat-placeholder");
    expect(placeholders).toHaveLength(3);

    expect(placeholders[0]?.getAttribute("data-status")).toBe("pending");
    expect(placeholders[0]?.textContent).toBe("Frame pending");

    expect(placeholders[1]?.getAttribute("data-status")).toBe("failed");
    expect(placeholders[1]?.textContent).toBe("Frame failed");

    expect(placeholders[2]?.getAttribute("data-status")).toBe("unavailable");
    expect(placeholders[2]?.textContent).toBe("Frame unavailable");
  });

  it("defaults to pending placeholder when frame read model is missing or partial", () => {
    // Only frame for beat 1 is provided
    const partialFrames: ShotPlanBeatFrameReviewItem[] = [
      {
        beatIndex: 1,
        status: "ready",
        candidateId: "cand-1",
        media: { available: true, url: "https://media.example.com/beat-1.jpg" }
      }
    ];

    render(<ShotPlanBeatStrip beats={sampleBeats} beatFrames={partialFrames} />);

    const slots = screen.getAllByTestId("shot-plan-beat-slot");
    expect(slots).toHaveLength(3);

    expect(slots[0]?.getAttribute("data-status")).toBe("ready");
    expect(slots[1]?.getAttribute("data-status")).toBe("pending");
    expect(slots[2]?.getAttribute("data-status")).toBe("pending");

    const placeholders = screen.getAllByTestId("shot-plan-beat-placeholder");
    expect(placeholders).toHaveLength(2);
    expect(placeholders[0]?.textContent).toBe("Frame pending");
    expect(placeholders[1]?.textContent).toBe("Frame pending");
  });

  it("falls back to Frame unavailable when image encounters onError, and resets on URL change", () => {
    const initialFrames: ShotPlanBeatFrameReviewItem[] = [
      {
        beatIndex: 1,
        status: "ready",
        candidateId: "cand-1",
        media: { available: true, url: "https://media.example.com/broken.jpg" }
      }
    ];

    const { rerender } = render(
      <ShotPlanBeatStrip beats={[sampleBeats[0]!]} beatFrames={initialFrames} />
    );

    const img = screen.getByTestId("shot-plan-beat-image");
    fireEvent.error(img);

    // After image load error, placeholder should appear with 'Frame unavailable'
    const placeholder = screen.getByTestId("shot-plan-beat-placeholder");
    expect(placeholder).toBeDefined();
    expect(placeholder.textContent).toBe("Frame unavailable");
    expect(placeholder.getAttribute("data-status")).toBe("unavailable");

    // Updating frame with a new valid URL should reset error state
    const updatedFrames: ShotPlanBeatFrameReviewItem[] = [
      {
        beatIndex: 1,
        status: "ready",
        candidateId: "cand-2",
        media: { available: true, url: "https://media.example.com/fixed.jpg" }
      }
    ];

    rerender(<ShotPlanBeatStrip beats={[sampleBeats[0]!]} beatFrames={updatedFrames} />);

    const restoredImg = screen.getByTestId("shot-plan-beat-image");
    expect(restoredImg.getAttribute("src")).toBe("https://media.example.com/fixed.jpg");
  });
});
