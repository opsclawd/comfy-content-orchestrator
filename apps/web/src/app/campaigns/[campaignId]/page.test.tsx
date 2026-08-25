import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import CampaignPage, { dynamic } from "./page.js";
import CampaignNotFound from "./not-found.js";
import CampaignError from "./error.js";
import { getCampaignReviewSummary, ApiClientError } from "../../../api/client.js";
import type * as ClientModule from "../../../api/client.js";
import { notFound } from "next/navigation";
import type { CampaignReviewSummary } from "@cco/contracts";

vi.mock("../../../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getCampaignReviewSummary: vi.fn()
  };
});

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  })
}));

type TestElement = ReactElement<{
  "data-testid"?: string;
  children?: ReactNode;
  href?: string;
  onClick?: () => void;
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
    if ("type" in node && typeof node.type === "function") {
      try {
        const rendered = (node.type as (props: unknown) => ReactNode)(node.props);
        const match = findByTestId(rendered, testId);
        if (match) return match;
      } catch {
        // ignore
      }
    }
    if (element.props?.children) {
      const match = findByTestId(element.props.children, testId);
      if (match) return match;
    }
  }
  return null;
}

function findAllByTestId(node: ReactNode, testId: string): TestElement[] {
  const results: TestElement[] = [];
  function traverse(n: ReactNode) {
    if (n == null || typeof n !== "object") {
      return;
    }
    if (Array.isArray(n)) {
      for (const child of n) {
        traverse(child);
      }
      return;
    }
    if ("props" in n) {
      const element = n as TestElement;
      if (element.props?.["data-testid"] === testId) {
        results.push(element);
      }
      if ("type" in n && typeof n.type === "function") {
        try {
          const rendered = (n.type as (props: unknown) => ReactNode)(n.props);
          traverse(rendered);
        } catch {
          // ignore
        }
      }
      if (element.props?.children) {
        traverse(element.props.children);
      }
    }
  }
  traverse(node);
  return results;
}

function collectText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(" ");
  if (typeof node === "object") {
    if ("type" in node && typeof node.type === "function") {
      try {
        const rendered = (node.type as (props: unknown) => ReactNode)(node.props);
        return collectText(rendered);
      } catch {
        // ignore
      }
    }
    if ("props" in node) {
      const element = node as TestElement;
      return collectText(element.props?.children);
    }
  }
  return "";
}

describe("Campaign Review Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports dynamic = 'force-dynamic'", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders authoritative campaign progress and ordered scene links", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      campaignName: "Authoritative Campaign",
      totalScenes: 3,
      pendingReviewCount: 1,
      approvedCount: 1,
      completedCount: 1,
      scenesByStatus: {
        director_review: 1,
        approved: 1,
        completed: 1
      },
      scenes: [
        {
          sceneId: "s3333333-3333-4333-8333-333333333333",
          status: "director_review",
          specRevision: 2
        },
        {
          sceneId: "s1111111-1111-4111-8111-111111111111",
          status: "completed",
          specRevision: 1
        },
        {
          sceneId: "s2222222-2222-4222-8222-222222222222",
          status: "approved",
          specRevision: 3
        }
      ],
      updatedAt: "2026-08-25T12:34:56.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c1111111-1111-4111-8111-111111111111" })
    })) as TestElement;

    expect(getCampaignReviewSummary).toHaveBeenCalledWith("c1111111-1111-4111-8111-111111111111");
    expect(jsx).not.toBeNull();

    // Verify campaign name and updatedAt
    const nameEl = findByTestId(jsx, "campaign-name");
    expect(nameEl).not.toBeNull();
    expect(collectText(nameEl)).toContain("Authoritative Campaign");

    const updatedAtEl = findByTestId(jsx, "campaign-updated-at");
    expect(updatedAtEl).not.toBeNull();
    expect(collectText(updatedAtEl)).toContain("2026-08-25T12:34:56.000Z");

    // Verify aggregate metric cards
    const totalEl = findByTestId(jsx, "metric-total-scenes");
    expect(totalEl).not.toBeNull();
    expect(collectText(totalEl)).toContain("3");

    const pendingEl = findByTestId(jsx, "metric-pending-review");
    expect(pendingEl).not.toBeNull();
    expect(collectText(pendingEl)).toContain("1");

    const approvedEl = findByTestId(jsx, "metric-approved");
    expect(approvedEl).not.toBeNull();
    expect(collectText(approvedEl)).toContain("1");

    const completedEl = findByTestId(jsx, "metric-completed");
    expect(completedEl).not.toBeNull();
    expect(collectText(completedEl)).toContain("1");

    // Verify scenesByStatus breakdown
    const statusBreakdown = findByTestId(jsx, "scenes-by-status");
    expect(statusBreakdown).not.toBeNull();
    const breakdownText = collectText(statusBreakdown);
    expect(breakdownText).toContain("director_review");
    expect(breakdownText).toContain("approved");
    expect(breakdownText).toContain("completed");

    // Verify ordered scene rows and links
    const sceneRows = findAllByTestId(jsx, "scene-row");
    expect(sceneRows).toHaveLength(3);

    // Scene 1 in response order
    const link1 = findByTestId(sceneRows[0], "scene-link");
    expect(link1).not.toBeNull();
    expect(link1?.props.href).toBe("/scenes/s3333333-3333-4333-8333-333333333333");
    const row1Text = collectText(sceneRows[0]);
    expect(row1Text).toContain("director_review");
    expect(row1Text).toContain("2");

    // Scene 2 in response order
    const link2 = findByTestId(sceneRows[1], "scene-link");
    expect(link2).not.toBeNull();
    expect(link2?.props.href).toBe("/scenes/s1111111-1111-4111-8111-111111111111");
    const row2Text = collectText(sceneRows[1]);
    expect(row2Text).toContain("completed");
    expect(row2Text).toContain("1");

    // Scene 3 in response order
    const link3 = findByTestId(sceneRows[2], "scene-link");
    expect(link3).not.toBeNull();
    expect(link3?.props.href).toBe("/scenes/s2222222-2222-4222-8222-222222222222");
    const row3Text = collectText(sceneRows[2]);
    expect(row3Text).toContain("approved");
    expect(row3Text).toContain("3");
  });

  it("does not recompute aggregate counts from scene rows", async () => {
    const inconsistentFixture: CampaignReviewSummary = {
      campaignId: "c2222222-2222-4222-8222-222222222222",
      campaignName: "Inconsistent Metrics Campaign",
      totalScenes: 99,
      pendingReviewCount: 40,
      approvedCount: 30,
      completedCount: 29,
      scenesByStatus: {
        director_review: 40,
        approved: 30,
        completed: 29
      },
      // Deliberately only 1 scene provided in rows
      scenes: [
        {
          sceneId: "s9999999-9999-4999-8999-999999999999",
          status: "director_review",
          specRevision: 1
        }
      ],
      updatedAt: "2026-08-25T14:00:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(inconsistentFixture);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c2222222-2222-4222-8222-222222222222" })
    })) as TestElement;

    // Totals MUST match summary fields (99, 40, 30, 29) and NOT row count (1)
    const totalEl = findByTestId(jsx, "metric-total-scenes");
    expect(totalEl).not.toBeNull();
    expect(collectText(totalEl)).toContain("99");

    const pendingEl = findByTestId(jsx, "metric-pending-review");
    expect(pendingEl).not.toBeNull();
    expect(collectText(pendingEl)).toContain("40");

    const approvedEl = findByTestId(jsx, "metric-approved");
    expect(approvedEl).not.toBeNull();
    expect(collectText(approvedEl)).toContain("30");

    const completedEl = findByTestId(jsx, "metric-completed");
    expect(completedEl).not.toBeNull();
    expect(collectText(completedEl)).toContain("29");

    const sceneRows = findAllByTestId(jsx, "scene-row");
    expect(sceneRows).toHaveLength(1);
  });

  it("renders an explicit empty campaign state", async () => {
    const emptyFixture: CampaignReviewSummary = {
      campaignId: "c3333333-3333-4333-8333-333333333333",
      campaignName: "Empty Campaign",
      totalScenes: 0,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 0,
      scenesByStatus: {},
      scenes: [],
      updatedAt: "2026-08-25T15:00:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(emptyFixture);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c3333333-3333-4333-8333-333333333333" })
    })) as TestElement;

    const emptyState = findByTestId(jsx, "empty-campaign-state");
    expect(emptyState).not.toBeNull();
    expect(collectText(emptyState)).toMatch(/no scenes/i);

    const sceneRows = findAllByTestId(jsx, "scene-row");
    expect(sceneRows).toHaveLength(0);
  });

  it("maps a missing campaign to the App Router not-found flow", async () => {
    // Case 1: ApiClientError 404 should call notFound()
    vi.mocked(getCampaignReviewSummary).mockRejectedValueOnce(
      new ApiClientError("Campaign not found", 404)
    );

    await expect(
      CampaignPage({
        params: Promise.resolve({ campaignId: "c4040404-0404-4040-8404-040404040404" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);

    // Case 2: ApiClientError 500 should rethrow without calling notFound
    vi.mocked(getCampaignReviewSummary).mockRejectedValueOnce(
      new ApiClientError("Internal server error", 500)
    );

    await expect(
      CampaignPage({
        params: Promise.resolve({ campaignId: "c5000500-0500-4500-8500-050005000500" })
      })
    ).rejects.toThrow("Internal server error");

    expect(notFound).toHaveBeenCalledTimes(1); // Still 1 from case 1

    // Case 3: Generic error should rethrow without calling notFound
    vi.mocked(getCampaignReviewSummary).mockRejectedValueOnce(new Error("Network failure"));

    await expect(
      CampaignPage({
        params: Promise.resolve({ campaignId: "c6000600-0600-4600-8600-060006000600" })
      })
    ).rejects.toThrow("Network failure");

    expect(notFound).toHaveBeenCalledTimes(1); // Still 1 from case 1
  });

  it("renders not-found component with landing page link", () => {
    const notFoundJsx = CampaignNotFound() as TestElement;
    expect(notFoundJsx).not.toBeNull();
    const container = findByTestId(notFoundJsx, "campaign-not-found");
    expect(container).not.toBeNull();
    const link = findByTestId(notFoundJsx, "back-to-hub-link");
    expect(link).not.toBeNull();
    expect(link?.props.href).toBe("/");
  });

  it("renders error component with retry handler", () => {
    const resetMock = vi.fn();
    const errorJsx = CampaignError({
      error: new Error("Test error"),
      reset: resetMock
    }) as TestElement;

    expect(errorJsx).not.toBeNull();
    const container = findByTestId(errorJsx, "campaign-error");
    expect(container).not.toBeNull();
    const retryBtn = findByTestId(errorJsx, "retry-button");
    expect(retryBtn).not.toBeNull();
    retryBtn?.props.onClick?.();
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
