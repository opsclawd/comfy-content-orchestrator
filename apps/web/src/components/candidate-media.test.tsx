import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidateMedia } from "./candidate-media.js";
import type { CandidateMediaProps } from "./candidate-media.js";

type TestElement = ReactElement<{
  "data-testid"?: string;
  children?: ReactNode;
  src?: string;
  alt?: string;
  onError?: () => void;
  onClick?: () => void;
  [key: string]: unknown;
}>;

interface ReactInternalDispatcher {
  useState: (initial: unknown) => [unknown, (val: unknown) => void];
  [key: string]: unknown;
}

const ReactSharedInternals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      H: ReactInternalDispatcher | null;
    };
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

function renderWithState(
  stateValue: boolean,
  setStateFn: (newVal: boolean | ((prev: boolean) => boolean)) => void,
  fn: () => ReactNode
): ReactNode {
  const prevDispatcher = ReactSharedInternals.H;
  ReactSharedInternals.H = {
    useState: (initial: unknown) => [
      stateValue !== undefined ? stateValue : initial,
      setStateFn as (val: unknown) => void
    ]
  };
  try {
    return fn();
  } finally {
    ReactSharedInternals.H = prevDispatcher;
  }
}

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
    const props1: CandidateMediaProps = {
      media: { available: false },
      revision: 1,
      variantOrdinal: 1
    };
    const markup1 = renderToStaticMarkup(React.createElement(CandidateMedia, props1));
    expect(markup1).toContain("Media unavailable; candidate provenance retained");
    expect(markup1).not.toContain("<img");

    // Case 2: available is false, url is present (should still not render img)
    const props2: CandidateMediaProps = {
      media: { available: false, url: "https://example.com/stale.webp" },
      revision: 1,
      variantOrdinal: 2
    };
    const markup2 = renderToStaticMarkup(React.createElement(CandidateMedia, props2));
    expect(markup2).toContain("Media unavailable; candidate provenance retained");
    expect(markup2).not.toContain("<img");

    // Case 3: available is true, but url is missing / empty
    const props3: CandidateMediaProps = {
      media: { available: true },
      revision: 2,
      variantOrdinal: 1
    };
    const markup3 = renderToStaticMarkup(React.createElement(CandidateMedia, props3));
    expect(markup3).toContain("Media unavailable; candidate provenance retained");
    expect(markup3).not.toContain("<img");

    // Direct element tree inspection
    const element = renderWithState(false, vi.fn(), () => CandidateMedia(props1)) as TestElement;
    expect(element).not.toBeNull();
    const unavailableNode = findByTestId(element, "candidate-media-unavailable");
    expect(unavailableNode).not.toBeNull();
    expect(collectText(unavailableNode)).toContain(
      "Media unavailable; candidate provenance retained"
    );
    expect(findByTestId(element, "candidate-media-img")).toBeNull();
  });

  it("replaces a failed presigned image with a refresh state", () => {
    let stateValue = false;
    const setStateMock = vi.fn((newVal: boolean | ((prev: boolean) => boolean)) => {
      stateValue = typeof newVal === "function" ? newVal(stateValue) : newVal;
    });

    const props: CandidateMediaProps = {
      media: {
        available: true,
        url: "https://storage.example.com/candidates/scene-1/rev-2-var-1.webp?signature=abc"
      },
      revision: 2,
      variantOrdinal: 1
    };

    // Initial render: healthy image
    stateValue = false;
    const initialElement = renderWithState(stateValue, setStateMock, () =>
      CandidateMedia(props)
    ) as TestElement;
    const imgElement = findByTestId(initialElement, "candidate-media-img");
    expect(imgElement).not.toBeNull();
    expect(typeof imgElement?.props.onError).toBe("function");

    // Trigger image load failure via onError handler
    imgElement?.props.onError?.();
    expect(setStateMock).toHaveBeenCalledWith(true);
    expect(stateValue).toBe(true);

    // Re-render in failed state
    const failedElement = renderWithState(stateValue, setStateMock, () =>
      CandidateMedia(props)
    ) as TestElement;
    expect(failedElement).not.toBeNull();

    // 1. Broken image is completely removed
    expect(findByTestId(failedElement, "candidate-media-img")).toBeNull();
    const markup = renderToStaticMarkup(failedElement);
    expect(markup).not.toContain("<img");

    // 2. Renders "Media expired or unavailable"
    const expiredContainer = findByTestId(failedElement, "candidate-media-expired");
    expect(expiredContainer).not.toBeNull();
    expect(collectText(expiredContainer)).toContain("Media expired or unavailable");

    // 3. Renders normal route refresh control
    const refreshBtn = findByTestId(failedElement, "candidate-media-refresh-btn");
    expect(refreshBtn).not.toBeNull();
    expect(collectText(refreshBtn)).toContain("Refresh page");

    // 4. Invoking refresh control triggers page reload
    const reloadMock = vi.fn();
    vi.stubGlobal("window", {
      location: { reload: reloadMock }
    });

    refreshBtn?.props.onClick?.();
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("renders available media with meaningful revision and variant alt text", () => {
    const presignedUrl =
      "https://godzspeed-review.s3.us-east-1.amazonaws.com/candidates/scene-uuid/rev3_var2.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260825%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260825T120000Z&X-Amz-Signature=5d67f33";

    const props: CandidateMediaProps = {
      media: {
        available: true,
        url: presignedUrl
      },
      revision: 3,
      variantOrdinal: 2
    };

    const markup = renderToStaticMarkup(React.createElement(CandidateMedia, props));
    expect(markup).toContain("<img");
    expect(markup).toContain('alt="Candidate revision 3 variant 2"');

    // Direct element inspection
    const element = renderWithState(false, vi.fn(), () => CandidateMedia(props)) as TestElement;
    const imgElement = findByTestId(element, "candidate-media-img");
    expect(imgElement).not.toBeNull();
    expect(imgElement?.props.src).toBe(presignedUrl);

    // Alt text describes the candidate without using its expiring URL as identity
    const altText = imgElement?.props.alt ?? "";
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
    const propsWithSpecRev: CandidateMediaProps = {
      media: {
        available: true,
        url: "https://example.com/test.webp"
      },
      specRevision: 5,
      variantOrdinal: 4
    };
    const elementWithSpecRev = renderWithState(false, vi.fn(), () =>
      CandidateMedia(propsWithSpecRev)
    ) as TestElement;
    const imgWithSpecRev = findByTestId(elementWithSpecRev, "candidate-media-img");
    expect(imgWithSpecRev?.props.alt).toContain("5");
    expect(imgWithSpecRev?.props.alt).toContain("4");
  });

  it("does not retain or refresh presigned URLs automatically", () => {
    vi.useFakeTimers();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const props: CandidateMediaProps = {
      media: {
        available: true,
        url: "https://storage.example.com/candidate.webp"
      },
      revision: 1,
      variantOrdinal: 1
    };

    // Render component
    const markup = renderToStaticMarkup(React.createElement(CandidateMedia, props));
    expect(markup).toContain("<img");

    // Advance time - verify no automatic refresh, polling, or timers fire fetch
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(3_600_000);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
