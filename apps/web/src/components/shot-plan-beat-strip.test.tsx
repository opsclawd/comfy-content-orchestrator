// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from "vitest";
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

describe("ShotPlanBeatStrip text advisory", () => {
  afterEach(() => cleanup());

  const beat: ShotPlanTemporalBeat = {
    beatIndex: 1,
    startMs: 0,
    endMs: 1500,
    description: "Plaza",
    cameraAction: "static hold",
    subjectAction: "walks"
  };
  const advisory = (status: "flagged" | "clean" | "unavailable") => ({
    status,
    policyVersion: "previs_text_advisory_v1",
    thresholds: { minConfidence: 0.7, minAlnumChars: 3, minAlnumRatio: 0.6 },
    maxConfidence: status === "flagged" ? 0.82 : null,
    detections: status === "flagged" ? [{ text: "<b>LENTA</b>", confidence: 0.82 }] : [],
    engine: { id: "tesseract.js", version: "7" },
    checkedAt: "2026-10-30T00:00:00.000Z"
  });
  const frame = (status: "flagged" | "clean" | "unavailable"): ShotPlanBeatFrameReviewItem => ({
    beatIndex: 1,
    status: "ready",
    candidateId: "cand-1",
    media: { available: true, url: "https://media.example.com/a.png" },
    textAdvisory: advisory(status)
  });

  it("shows a plain-text badge for flagged stills", () => {
    render(<ShotPlanBeatStrip beats={[beat]} beatFrames={[frame("flagged")]} />);
    const badge = screen.getByTestId("previs-text-advisory-badge");
    expect(badge.textContent).toContain("Possible fabricated text");
    expect(badge.textContent).toContain("<b>LENTA</b> (82%)");
    expect(badge.querySelector("b")).toBeNull();
  });

  it("shows a muted note when unavailable and nothing when clean", () => {
    const { rerender } = render(
      <ShotPlanBeatStrip beats={[beat]} beatFrames={[frame("unavailable")]} />
    );
    expect(screen.getByTestId("previs-text-advisory-unavailable")).toBeDefined();
    rerender(<ShotPlanBeatStrip beats={[beat]} beatFrames={[frame("clean")]} />);
    expect(screen.queryByTestId("previs-text-advisory-badge")).toBeNull();
    expect(screen.queryByTestId("previs-text-advisory-unavailable")).toBeNull();
  });

  const ids = {
    sceneId: "11111111-1111-4111-8111-111111111111",
    planId: "22222222-2222-4222-8222-222222222222"
  };
  const candidateId = "33333333-3333-4333-8333-333333333333";

  it("posts the re-roll with the current candidate id and shows queued state", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const flagged = { ...frame("flagged"), candidateId };
    render(
      <ShotPlanBeatStrip
        beats={[beat]}
        beatFrames={[flagged]}
        sceneId={ids.sceneId}
        planId={ids.planId}
      />
    );
    fireEvent.click(screen.getByTestId("previs-reroll-button"));
    await screen.findByText("Re-roll queued");
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/scenes/${ids.sceneId}/shot-plans/${ids.planId}/beats/1/previs-reroll`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedCandidateId: candidateId })
      })
    );
    expect((screen.getByTestId("previs-reroll-button") as HTMLButtonElement).disabled).toBe(true);
    vi.unstubAllGlobals();
  });

  it("shows the error inline when the re-roll fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: "stale" }) })
    );
    render(
      <ShotPlanBeatStrip
        beats={[beat]}
        beatFrames={[{ ...frame("flagged"), candidateId }]}
        sceneId={ids.sceneId}
        planId={ids.planId}
      />
    );
    fireEvent.click(screen.getByTestId("previs-reroll-button"));
    expect((await screen.findByTestId("previs-reroll-error")).textContent).toBe("stale");
    vi.unstubAllGlobals();
  });

  it("does not render a re-roll button for clean stills", () => {
    render(
      <ShotPlanBeatStrip
        beats={[beat]}
        beatFrames={[{ ...frame("clean"), candidateId }]}
        sceneId={ids.sceneId}
        planId={ids.planId}
      />
    );
    expect(screen.queryByTestId("previs-reroll-button")).toBeNull();
  });
});
