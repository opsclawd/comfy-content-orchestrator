// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CampaignDeliveryReelPanel } from "./campaign-delivery-reel-panel.js";
import type { CampaignDeliveryReelReadModel } from "@cco/contracts";

const mockRefresh = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: mockPush
  })
}));

function createSampleDeliveryReel(
  overrides?: Partial<CampaignDeliveryReelReadModel>
): CampaignDeliveryReelReadModel {
  return {
    campaignId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    status: "completed",
    state: "completed",
    assemblyId: "asm-12345",
    assemblyJobId: "job-67890",
    media: {
      url: "https://storage.example.com/delivery/final-reel.mp4",
      bucket: "deliveries",
      key: "delivery/final-reel.mp4",
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      durationMs: 12000,
      width: 1920,
      height: 1080
    },
    updatedAt: "2026-09-13T12:00:00.000Z",
    ...overrides
  };
}

describe("CampaignDeliveryReelPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing when deliveryReel is undefined", () => {
    const { container } = render(<CampaignDeliveryReelPanel deliveryReel={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders not-started state with stable testids and without video player or download link", () => {
    const reel = createSampleDeliveryReel({
      status: "not-started",
      state: "not-started",
      assemblyId: undefined,
      assemblyJobId: undefined,
      media: undefined
    });

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    expect(screen.getByTestId("campaign-delivery-reel-panel")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-panel").getAttribute("data-status")).toBe(
      "not-started"
    );
    expect(screen.getByTestId("delivery-reel-not-started")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state-not-started")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state").textContent).toContain("not-started");

    expect(screen.getByText(/Delivery Reel Not Started/i)).toBeDefined();
    expect(screen.queryByTestId("delivery-reel-player")).toBeNull();
    expect(screen.queryByTestId("delivery-reel-download-link")).toBeNull();
  });

  it("renders assembling state with assembly job badge and without video player", () => {
    const reel = createSampleDeliveryReel({
      status: "assembling",
      state: "assembling",
      assemblyJobId: "job-active-1234",
      media: undefined
    });

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    expect(screen.getByTestId("delivery-reel-assembling")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state-assembling")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state").textContent).toContain("assembling");
    expect(screen.getByTestId("delivery-reel-job-id").textContent).toContain("job-active-1234");

    expect(screen.getByText(/Assembly in Progress/i)).toBeDefined();
    expect(screen.queryByTestId("delivery-reel-player")).toBeNull();
    expect(screen.queryByTestId("delivery-reel-download-link")).toBeNull();
  });

  it("renders failed state with error text and job badge, without video player", () => {
    const reel = createSampleDeliveryReel({
      status: "failed",
      state: "failed",
      assemblyJobId: "job-failed-5678",
      error: "Licensing check failed for background audio stem",
      media: undefined
    });

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    expect(screen.getByTestId("delivery-reel-failed")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state-failed")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-error").textContent).toContain(
      "Licensing check failed for background audio stem"
    );
    expect(screen.getByTestId("delivery-reel-job-id").textContent).toContain("job-failed-5678");

    expect(screen.getByText(/Delivery Reel Assembly Failed/i)).toBeDefined();
    expect(screen.queryByTestId("delivery-reel-player")).toBeNull();
    expect(screen.queryByTestId("delivery-reel-download-link")).toBeNull();
  });

  it("renders unavailable-artifact state with reason and Reload Reel button", () => {
    const reel = createSampleDeliveryReel({
      status: "unavailable-artifact",
      state: "unavailable-artifact",
      assemblyId: "asm-missing-999",
      reason: "Physical media key not found in storage bucket",
      media: undefined
    });

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    expect(screen.getByTestId("delivery-reel-unavailable")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-unavailable-artifact")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-unavailable-reason").textContent).toContain(
      "Physical media key not found in storage bucket"
    );
    expect(screen.getByTestId("delivery-reel-assembly-id").textContent).toContain(
      "asm-missing-999"
    );

    const reloadButton = screen.getByTestId("reload-delivery-reel-button");
    expect(reloadButton).toBeDefined();
    fireEvent.click(reloadButton);
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    expect(screen.queryByTestId("delivery-reel-player")).toBeNull();
    expect(screen.queryByTestId("delivery-reel-download-link")).toBeNull();
  });

  it("renders completed state with video player, metadata, and download link", () => {
    const reel = createSampleDeliveryReel();

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    expect(screen.getByTestId("delivery-reel-completed")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state-completed")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-state").textContent).toContain("completed");

    // Video player
    const player = screen.getByTestId("delivery-reel-player") as HTMLVideoElement;
    expect(player).toBeDefined();
    expect(player.getAttribute("src")).toBe("https://storage.example.com/delivery/final-reel.mp4");
    expect(player.hasAttribute("controls")).toBe(true);

    // Download action
    const downloadLink = screen.getByTestId("delivery-reel-download-link");
    expect(downloadLink).toBeDefined();
    expect(downloadLink.getAttribute("href")).toBe(
      "https://storage.example.com/delivery/final-reel.mp4"
    );
    expect(downloadLink.getAttribute("download")).toBe(`campaign-${reel.campaignId}-reel.mp4`);
    expect(screen.getByTestId("delivery-reel-download-button").textContent).toContain(
      "Download Final Reel (.mp4)"
    );

    // Metadata badges
    expect(screen.getByTestId("delivery-reel-assembly-id").textContent).toContain("asm-12345");
    expect(screen.getByTestId("delivery-reel-job-id").textContent).toContain("job-67890");
    expect(screen.getByTestId("delivery-reel-duration").textContent).toContain("12000 ms (12.00s)");
    expect(screen.getByTestId("delivery-reel-resolution").textContent).toContain("1920x1080");
    expect(screen.getByTestId("delivery-reel-sha256").textContent).toContain("0123456789ab...");
  });

  it("transitions to media-unavailable banner when video player encounters error", () => {
    const reel = createSampleDeliveryReel();

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    const player = screen.getByTestId("delivery-reel-player");
    expect(player).toBeDefined();

    // Trigger video onError
    fireEvent.error(player);

    // Should now display unavailable banner
    expect(screen.getByTestId("delivery-reel-unavailable")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-unavailable-artifact")).toBeDefined();
    expect(screen.getByTestId("delivery-reel-unavailable-reason").textContent).toContain(
      "Delivery reel playback link expired or encountered an error."
    );

    // Video player and download link should no longer be rendered
    expect(screen.queryByTestId("delivery-reel-player")).toBeNull();
    expect(screen.queryByTestId("delivery-reel-download-link")).toBeNull();

    // Clicking Reload Reel invokes router.refresh()
    const reloadBtn = screen.getByTestId("reload-delivery-reel-button");
    fireEvent.click(reloadBtn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("resets playerError when refreshed with a new media URL", () => {
    const reel1 = createSampleDeliveryReel({
      media: {
        url: "https://storage.example.com/delivery/expired-reel.mp4",
        bucket: "deliveries",
        key: "delivery/expired-reel.mp4",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    });

    const { rerender } = render(<CampaignDeliveryReelPanel deliveryReel={reel1} />);

    // Trigger video error
    fireEvent.error(screen.getByTestId("delivery-reel-player"));
    expect(screen.getByTestId("delivery-reel-unavailable")).toBeDefined();

    // Rerender with fresh URL
    const reel2 = createSampleDeliveryReel({
      media: {
        url: "https://storage.example.com/delivery/fresh-reel.mp4",
        bucket: "deliveries",
        key: "delivery/fresh-reel.mp4",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
      }
    });

    rerender(<CampaignDeliveryReelPanel deliveryReel={reel2} />);

    // Video player should be restored
    const player = screen.getByTestId("delivery-reel-player") as HTMLVideoElement;
    expect(player).toBeDefined();
    expect(player.getAttribute("src")).toBe("https://storage.example.com/delivery/fresh-reel.mp4");
    expect(screen.queryByTestId("delivery-reel-unavailable")).toBeNull();
  });

  it("falls back to unavailable banner if completed status has missing media.url", () => {
    const reel = createSampleDeliveryReel({
      status: "completed",
      state: "completed",
      media: undefined
    });

    render(<CampaignDeliveryReelPanel deliveryReel={reel} />);

    expect(screen.getByTestId("delivery-reel-unavailable")).toBeDefined();
    expect(screen.queryByTestId("delivery-reel-player")).toBeNull();
  });
});
