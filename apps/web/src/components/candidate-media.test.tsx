import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateMedia } from "./candidate-media.js";

type TestElement = ReactElement<{
  "data-testid"?: string;
  className?: string;
  children?: ReactNode;
  src?: string;
  alt?: string;
  onClick?: () => void;
  onError?: () => void;
  [key: string]: unknown;
}>;

function findByTestId(node: ReactNode, testId: string): TestElement | null {
  if (node == null || typeof node !== "object") {
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByTestId(child, testId);
      if (match) return match;
    }
    return null;
  }
  if ("props" in node) {
    const element = node as TestElement;
    if (element.props?.["data-testid"] === testId) {
      return element;
    }
    if (element.props?.children) {
      const match = findByTestId(element.props.children, testId);
      if (match) return match;
    }
  }
  return null;
}

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "object" && "props" in node) {
    const element = node as TestElement;
    return collectText(element.props?.children);
  }
  return "";
}

describe("CandidateMedia Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("does not render an image when media is unavailable", () => {
    // Case 1: available is false, url is undefined
    const html1 = renderToStaticMarkup(
      <CandidateMedia media={{ available: false }} revision={1} variantOrdinal={1} />
    );
    expect(html1).toContain('data-testid="candidate-media-unavailable"');
    expect(html1).toContain("Media unavailable; candidate provenance retained");
    expect(html1).not.toContain("<img");
    expect(html1).not.toContain('data-testid="candidate-media-img"');

    // Case 2: available is false, url is present (should still not render img)
    const html2 = renderToStaticMarkup(
      <CandidateMedia
        media={{ available: false, url: "https://example.com/stale.webp" }}
        revision={1}
        variantOrdinal={2}
      />
    );
    expect(html2).toContain('data-testid="candidate-media-unavailable"');
    expect(html2).toContain("Media unavailable; candidate provenance retained");
    expect(html2).not.toContain("<img");

    // Case 3: available is true, but url is missing / empty
    const html3 = renderToStaticMarkup(
      <CandidateMedia media={{ available: true }} revision={2} variantOrdinal={1} />
    );
    expect(html3).toContain('data-testid="candidate-media-unavailable"');
    expect(html3).toContain("Media unavailable; candidate provenance retained");
    expect(html3).not.toContain("<img");

    // Direct element inspection
    vi.spyOn(React, "useState").mockReturnValueOnce([null, vi.fn()]);
    const tree = CandidateMedia({
      media: { available: false },
      revision: 1,
      variantOrdinal: 1
    }) as TestElement;
    const unavailableEl = findByTestId(tree, "candidate-media-unavailable");
    expect(unavailableEl).not.toBeNull();
    expect(collectText(unavailableEl)).toContain(
      "Media unavailable; candidate provenance retained"
    );
    expect(findByTestId(tree, "candidate-media-img")).toBeNull();
  });

  it("replaces a failed presigned image with a refresh state", () => {
    const url = "https://storage.example.com/candidates/scene-1/rev-2-var-1.webp?signature=abc";

    // 1. Initial available render exposes onError handler
    const setFailedUrlMock = vi.fn();
    vi.spyOn(React, "useState").mockReturnValueOnce([null, setFailedUrlMock]);

    const initialTree = CandidateMedia({
      media: {
        available: true,
        url
      },
      revision: 2,
      variantOrdinal: 1
    }) as TestElement;

    const img = findByTestId(initialTree, "candidate-media-img");
    expect(img).not.toBeNull();
    expect(img?.props.src).toBe(url);

    // Trigger onError handler
    img?.props.onError?.();
    expect(setFailedUrlMock).toHaveBeenCalledWith(url);

    // 2. Failed state rendering (when failedUrl matches media.url)
    vi.spyOn(React, "useState").mockReturnValueOnce([url, setFailedUrlMock]);

    const failedTree = CandidateMedia({
      media: {
        available: true,
        url
      },
      revision: 2,
      variantOrdinal: 1
    }) as TestElement;

    // Broken image is completely removed
    expect(findByTestId(failedTree, "candidate-media-img")).toBeNull();

    // Renders "Media expired or unavailable"
    const expiredContainer = findByTestId(failedTree, "candidate-media-expired");
    expect(expiredContainer).not.toBeNull();
    expect(collectText(expiredContainer)).toContain("Media expired or unavailable");

    // Renders normal route refresh control
    const refreshBtn = findByTestId(failedTree, "candidate-media-refresh-btn");
    expect(refreshBtn).not.toBeNull();
    expect(collectText(refreshBtn)).toContain("Refresh page");

    // Invoking refresh control triggers page reload
    const reloadMock = vi.fn();
    vi.stubGlobal("window", {
      location: { reload: reloadMock }
    });

    refreshBtn?.props.onClick?.();
    expect(reloadMock).toHaveBeenCalledTimes(1);

    // 3. Custom onRefresh callback prop support
    const customRefreshMock = vi.fn();
    vi.spyOn(React, "useState").mockReturnValueOnce([url, setFailedUrlMock]);

    const customRefreshTree = CandidateMedia({
      media: {
        available: true,
        url
      },
      revision: 2,
      variantOrdinal: 1,
      onRefresh: customRefreshMock
    }) as TestElement;

    const customBtn = findByTestId(customRefreshTree, "candidate-media-refresh-btn");
    customBtn?.props.onClick?.();
    expect(customRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("resets failed state when media.url prop updates", () => {
    const initialUrl = "https://storage.example.com/candidate-old.webp";
    const newUrl = "https://storage.example.com/candidate-new.webp";

    // When state holds initialUrl but media.url prop has changed to newUrl:
    vi.spyOn(React, "useState").mockReturnValueOnce([initialUrl, vi.fn()]);

    const updatedTree = CandidateMedia({
      media: {
        available: true,
        url: newUrl
      },
      revision: 1,
      variantOrdinal: 1
    }) as TestElement;

    // Component recovers from expired state and renders the new image
    expect(findByTestId(updatedTree, "candidate-media-expired")).toBeNull();

    const img = findByTestId(updatedTree, "candidate-media-img");
    expect(img).not.toBeNull();
    expect(img?.props.src).toBe(newUrl);
  });

  it("renders available media with meaningful revision and variant alt text", () => {
    const presignedUrl =
      "https://godzspeed-review.s3.us-east-1.amazonaws.com/candidates/scene-uuid/rev3_var2.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260825%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260825T120000Z&X-Amz-Signature=5d67f33";

    const html = renderToStaticMarkup(
      <CandidateMedia
        media={{
          available: true,
          url: presignedUrl
        }}
        revision={3}
        variantOrdinal={2}
      />
    );

    expect(html).toContain('data-testid="candidate-media-img"');
    expect(html).toContain('alt="Candidate revision 3 variant 2"');

    // Alt text describes the candidate without using its expiring URL as identity
    const altMatch = html.match(/alt="([^"]*)"/);
    const altText = altMatch && altMatch[1] ? altMatch[1] : "";
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
    const htmlWithSpecRev = renderToStaticMarkup(
      <CandidateMedia
        media={{
          available: true,
          url: "https://example.com/test.webp"
        }}
        specRevision={5}
        variantOrdinal={4}
      />
    );
    expect(htmlWithSpecRev).toContain('alt="Candidate revision 5 variant 4"');
  });

  it("does not retain or refresh presigned URLs automatically", () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const html = renderToStaticMarkup(
      <CandidateMedia
        media={{
          available: true,
          url: "https://storage.example.com/candidate.webp"
        }}
        revision={1}
        variantOrdinal={1}
      />
    );

    expect(html).toContain('data-testid="candidate-media-img"');

    // Advance time - verify no automatic refresh, polling, or timers fire fetch
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(3_600_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
