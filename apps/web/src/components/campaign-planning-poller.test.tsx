// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, act, cleanup } from "@testing-library/react";
import { CampaignPlanningPoller } from "./campaign-planning-poller";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRefresh,
    push: vi.fn()
  })
}));

describe("CampaignPlanningPoller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not poll when isPlanning is false", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<CampaignPlanningPoller campaignId="c123" isPlanning={false} pollIntervalMs={1000} />);

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("polls every interval and calls router.refresh() when status transitions to drafting", async () => {
    const onStatusChange = vi.fn();
    let pollCount = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      pollCount++;
      if (pollCount < 3) {
        return new Response(JSON.stringify({ status: "planning" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "drafting" }), { status: 200 });
    });

    render(
      <CampaignPlanningPoller
        campaignId="c123"
        isPlanning={true}
        pollIntervalMs={1000}
        onStatusChange={onStatusChange}
      />
    );

    // 1st tick
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();

    // 2nd tick
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(mockRefresh).not.toHaveBeenCalled();

    // 3rd tick -> returns drafting
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(onStatusChange).toHaveBeenCalledWith("drafting");
    expect(mockRefresh).toHaveBeenCalledTimes(1);

    // 4th tick -> polling stopped after transition
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
