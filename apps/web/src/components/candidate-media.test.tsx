/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { CandidateMedia } from "./candidate-media.js";
import type { CandidateMediaProps } from "./candidate-media.js";

describe("CandidateMedia Component", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
      root = null;
    }
    if (container) {
      container.remove();
      container = null;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderComponent(props: CandidateMediaProps) {
    act(() => {
      root?.render(<CandidateMedia {...props} />);
    });
  }

  it("does not render an image when media is unavailable", () => {
    // Case 1: available is false, url is undefined
    renderComponent({
      media: { available: false },
      revision: 1,
      variantOrdinal: 1
    });
    expect(container?.querySelector("[data-testid='candidate-media-unavailable']")).not.toBeNull();
    expect(container?.textContent).toContain("Media unavailable; candidate provenance retained");
    expect(container?.querySelector("img")).toBeNull();

    // Case 2: available is false, url is present (should still not render img)
    renderComponent({
      media: { available: false, url: "https://example.com/stale.webp" },
      revision: 1,
      variantOrdinal: 2
    });
    expect(container?.querySelector("[data-testid='candidate-media-unavailable']")).not.toBeNull();
    expect(container?.textContent).toContain("Media unavailable; candidate provenance retained");
    expect(container?.querySelector("img")).toBeNull();

    // Case 3: available is true, but url is missing / empty
    renderComponent({
      media: { available: true },
      revision: 2,
      variantOrdinal: 1
    });
    expect(container?.querySelector("[data-testid='candidate-media-unavailable']")).not.toBeNull();
    expect(container?.textContent).toContain("Media unavailable; candidate provenance retained");
    expect(container?.querySelector("img")).toBeNull();
  });

  it("replaces a failed presigned image with a refresh state", () => {
    const url = "https://storage.example.com/candidates/scene-1/rev-2-var-1.webp?signature=abc";
    renderComponent({
      media: {
        available: true,
        url
      },
      revision: 2,
      variantOrdinal: 1
    });

    const img = container?.querySelector<HTMLImageElement>("[data-testid='candidate-media-img']");
    expect(img).not.toBeNull();

    // Trigger image load failure
    act(() => {
      img?.dispatchEvent(new Event("error"));
    });

    // 1. Broken image is completely removed
    expect(container?.querySelector("[data-testid='candidate-media-img']")).toBeNull();

    // 2. Renders "Media expired or unavailable"
    const expiredContainer = container?.querySelector("[data-testid='candidate-media-expired']");
    expect(expiredContainer).not.toBeNull();
    expect(expiredContainer?.textContent).toContain("Media expired or unavailable");

    // 3. Renders normal route refresh control
    const refreshBtn = container?.querySelector<HTMLButtonElement>(
      "[data-testid='candidate-media-refresh-btn']"
    );
    expect(refreshBtn).not.toBeNull();
    expect(refreshBtn?.textContent).toContain("Refresh page");

    // 4. Invoking refresh control triggers page reload
    const reloadMock = vi.fn();
    vi.stubGlobal("window", {
      ...window,
      location: { ...window.location, reload: reloadMock }
    });

    act(() => {
      refreshBtn?.click();
    });
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("resets failed state when media.url prop updates", () => {
    const initialUrl = "https://storage.example.com/candidate-old.webp";
    const newUrl = "https://storage.example.com/candidate-new.webp";

    // Initial render with initial URL
    renderComponent({
      media: {
        available: true,
        url: initialUrl
      },
      revision: 1,
      variantOrdinal: 1
    });

    const img1 = container?.querySelector<HTMLImageElement>("[data-testid='candidate-media-img']");
    expect(img1).not.toBeNull();

    // Trigger error on initial URL -> enters failed state
    act(() => {
      img1?.dispatchEvent(new Event("error"));
    });

    expect(container?.querySelector("[data-testid='candidate-media-expired']")).not.toBeNull();
    expect(container?.querySelector("[data-testid='candidate-media-img']")).toBeNull();

    // Update media prop with a new URL
    renderComponent({
      media: {
        available: true,
        url: newUrl
      },
      revision: 1,
      variantOrdinal: 1
    });

    // Component should recover from expired state and render the new image
    const img2 = container?.querySelector<HTMLImageElement>("[data-testid='candidate-media-img']");
    expect(img2).not.toBeNull();
    expect(img2?.src).toBe(newUrl);
    expect(container?.querySelector("[data-testid='candidate-media-expired']")).toBeNull();
  });

  it("renders available media with meaningful revision and variant alt text", () => {
    const presignedUrl =
      "https://godzspeed-review.s3.us-east-1.amazonaws.com/candidates/scene-uuid/rev3_var2.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260825%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260825T120000Z&X-Amz-Signature=5d67f33";

    renderComponent({
      media: {
        available: true,
        url: presignedUrl
      },
      revision: 3,
      variantOrdinal: 2
    });

    const img = container?.querySelector<HTMLImageElement>("[data-testid='candidate-media-img']");
    expect(img).not.toBeNull();
    expect(img?.src).toBe(presignedUrl);
    expect(img?.alt).toBe("Candidate revision 3 variant 2");

    // Alt text describes the candidate without using its expiring URL as identity
    const altText = img?.alt ?? "";
    expect(altText).toContain("3");
    expect(altText).toContain("2");
    expect(altText.toLowerCase()).toContain("revision");
    expect(altText.toLowerCase()).toContain("variant");

    // Alt text must NOT contain any URL fragments or presigned query params
    expect(altText).not.toContain("http");
    expect(altText).not.toContain("amazonaws");
    expect(altText).not.toContain("X-Amz-Signature");
    expect(altText).not.toContain("scene-uuid");

    // Test with specRevision alias
    renderComponent({
      media: {
        available: true,
        url: "https://example.com/test.webp"
      },
      specRevision: 5,
      variantOrdinal: 4
    });
    const imgWithSpecRev = container?.querySelector<HTMLImageElement>(
      "[data-testid='candidate-media-img']"
    );
    expect(imgWithSpecRev?.alt).toBe("Candidate revision 5 variant 4");
  });

  it("does not retain or refresh presigned URLs automatically", () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    renderComponent({
      media: {
        available: true,
        url: "https://storage.example.com/candidate.webp"
      },
      revision: 1,
      variantOrdinal: 1
    });

    expect(container?.querySelector("[data-testid='candidate-media-img']")).not.toBeNull();

    // Advance time - verify no automatic refresh, polling, or timers fire fetch
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(3_600_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
