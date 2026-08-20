import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import HomePage, { dynamic } from "./page.js";
import { getHealth } from "../api/client.js";

vi.mock("../api/client.js", () => ({
  getHealth: vi.fn()
}));

type TestElement = ReactElement<{
  "data-testid"?: string;
  children?: ReactNode;
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
      return findByTestId(element.props.children, testId);
    }
  }
  return null;
}

describe("HomePage Component", () => {
  it("exports dynamic = 'force-dynamic' for per-request health status", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders healthy status when API returns ok", async () => {
    vi.mocked(getHealth).mockResolvedValueOnce({
      status: "ok",
      timestamp: "2026-08-20T01:00:00.000Z"
    });

    const jsx = (await HomePage()) as TestElement;
    expect(jsx).not.toBeNull();
    expect(jsx.type).toBe("section");
    expect(findByTestId(jsx, "review-hub-home")).not.toBeNull();
    expect(getHealth).toHaveBeenCalled();

    const statusSection = findByTestId(jsx, "control-api-status");
    expect(statusSection).not.toBeNull();

    expect(findByTestId(jsx, "health-error")).toBeNull();

    const statusSpan = findByTestId(jsx, "health-status");
    expect(statusSpan).not.toBeNull();
    expect(statusSpan?.props.children).toEqual(["Status: ", "ok"]);

    const timestampSpan = findByTestId(jsx, "health-timestamp");
    expect(timestampSpan).not.toBeNull();
    expect(timestampSpan?.props.children).toEqual(["Timestamp: ", "2026-08-20T01:00:00.000Z"]);
  });

  it("handles error when API is unreachable", async () => {
    vi.mocked(getHealth).mockRejectedValueOnce(new Error("Connection refused"));

    const jsx = (await HomePage()) as TestElement;
    expect(jsx).not.toBeNull();
    expect(jsx.type).toBe("section");
    expect(findByTestId(jsx, "review-hub-home")).not.toBeNull();
    expect(getHealth).toHaveBeenCalled();

    const statusSection = findByTestId(jsx, "control-api-status");
    expect(statusSection).not.toBeNull();

    expect(findByTestId(jsx, "health-status")).toBeNull();

    const errorContainer = findByTestId(jsx, "health-error");
    expect(errorContainer).not.toBeNull();

    const errorSpan = errorContainer?.props.children as TestElement;
    expect(errorSpan?.props.children).toEqual(["Unavailable: ", "Connection refused"]);
  });
});
