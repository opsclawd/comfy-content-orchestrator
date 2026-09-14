import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CampaignPage, { dynamic } from "./page.js";
import CampaignNotFound from "./not-found.js";
import CampaignError from "./error.js";
import { CampaignDeliveryReelPanel } from "../../../components/campaign-delivery-reel-panel.js";
import {
  getCampaignReviewSummary,
  getCampaignDeliveryReel,
  ApiClientError
} from "../../../api/client.js";
import type * as ClientModule from "../../../api/client.js";
import { notFound } from "next/navigation";
import type { CampaignReviewSummary, CampaignDeliveryReelReadModel } from "@cco/contracts";

vi.mock("../../../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getCampaignReviewSummary: vi.fn(),
    getCampaignDeliveryReel: vi.fn()
  };
});

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: vi.fn(() => ({
    refresh: vi.fn(),
    push: vi.fn()
  }))
}));

type TestElement = ReactElement<{
  "data-testid"?: string;
  children?: ReactNode;
  href?: string;
  onClick?: () => void;
  [key: string]: unknown;
}>;

interface HtmlElementNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: ReadonlyArray<HtmlElementNode | string>;
}

const HTML_VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseHtmlAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(attrString)) !== null) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeHtmlEntities(value);
  }
  return attrs;
}

function parseHtml(html: string): HtmlElementNode {
  const root: HtmlElementNode = { tag: "#root", attrs: {}, children: [] };
  const stack: HtmlElementNode[] = [root];
  const TOKEN_RE = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)([^>]*)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(html)) !== null) {
    const [full, closingTag, openingTag, rest, text] = match;
    if (full.startsWith("<!--")) continue;
    if (closingTag) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i]!.tag === closingTag.toLowerCase()) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (openingTag) {
      const tag = openingTag.toLowerCase();
      const restStr = rest ?? "";
      const selfClosing = /\/\s*$/.test(restStr);
      const attrString = selfClosing ? restStr.replace(/\/\s*$/, "") : restStr;
      const node: HtmlElementNode = { tag, attrs: parseHtmlAttrs(attrString), children: [] };
      const parent = stack[stack.length - 1]!;
      (parent.children as (HtmlElementNode | string)[]).push(node);
      if (!selfClosing && !HTML_VOID_TAGS.has(tag)) {
        stack.push(node);
      }
      continue;
    }
    if (text !== undefined) {
      const decoded = decodeHtmlEntities(text);
      if (decoded.length > 0) {
        (stack[stack.length - 1]!.children as (HtmlElementNode | string)[]).push(decoded);
      }
    }
  }
  return root;
}

function isHtmlElementNode(node: HtmlElementNode | string): node is HtmlElementNode {
  return typeof node !== "string";
}

function findAllHtmlNodes(
  node: HtmlElementNode | string,
  predicate: (element: HtmlElementNode) => boolean
): HtmlElementNode[] {
  const results: HtmlElementNode[] = [];
  function traverse(n: HtmlElementNode | string) {
    if (!isHtmlElementNode(n)) return;
    if (predicate(n)) {
      results.push(n);
    }
    for (const child of n.children) {
      traverse(child);
    }
  }
  traverse(node);
  return results;
}

function findHtmlByTestId(node: HtmlElementNode | string, testId: string): HtmlElementNode | null {
  return findAllHtmlNodes(node, (el) => el.attrs["data-testid"] === testId)[0] ?? null;
}

function collectHtmlText(node: HtmlElementNode | string | null): string {
  if (node === null) return "";
  function extract(n: HtmlElementNode | string): string {
    if (!isHtmlElementNode(n)) return n;
    return n.children.map(extract).join(" ");
  }
  return extract(node).replace(/\s+/g, " ").trim();
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
    if (
      "type" in node &&
      typeof node.type === "function" &&
      node.type !== CampaignDeliveryReelPanel
    ) {
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
      if ("type" in n && typeof n.type === "function" && n.type !== CampaignDeliveryReelPanel) {
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
    if (
      "type" in node &&
      typeof node.type === "function" &&
      node.type !== CampaignDeliveryReelPanel
    ) {
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
    vi.mocked(getCampaignDeliveryReel).mockResolvedValue({
      campaignId: "c1111111-1111-4111-8111-111111111111",
      status: "not-started",
      state: "not-started",
      updatedAt: "2026-08-25T12:00:00.000Z"
    });
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

  it("renders campaign page with completed delivery reel and player", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      campaignName: "Delivered Campaign",
      totalScenes: 1,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 1,
      scenesByStatus: { completed: 1 },
      scenes: [
        {
          sceneId: "s1111111-1111-4111-8111-111111111111",
          status: "completed",
          specRevision: 1
        }
      ],
      updatedAt: "2026-08-25T12:00:00.000Z"
    };

    const completedReel: CampaignDeliveryReelReadModel = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      status: "completed",
      state: "completed",
      assemblyId: "asm-comp-789",
      assemblyJobId: "job-comp-101",
      media: {
        url: "https://storage.example.com/delivery/completed-reel.mp4",
        bucket: "deliveries",
        key: "delivery/completed-reel.mp4",
        sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        durationMs: 15000,
        width: 1920,
        height: 1080
      },
      updatedAt: "2026-08-25T12:30:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);
    vi.mocked(getCampaignDeliveryReel).mockResolvedValueOnce(completedReel);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c1111111-1111-4111-8111-111111111111" })
    })) as TestElement;

    expect(getCampaignDeliveryReel).toHaveBeenCalledWith("c1111111-1111-4111-8111-111111111111");

    const html = renderToStaticMarkup(jsx);
    const htmlTree = parseHtml(html);

    const panel = findHtmlByTestId(htmlTree, "campaign-delivery-reel-panel");
    expect(panel).not.toBeNull();
    expect(panel?.attrs["data-status"]).toBe("completed");

    const completedContainer = findHtmlByTestId(htmlTree, "delivery-reel-completed");
    expect(completedContainer).not.toBeNull();

    const player = findHtmlByTestId(htmlTree, "delivery-reel-player");
    expect(player).not.toBeNull();
    expect(player?.attrs.src).toBe("https://storage.example.com/delivery/completed-reel.mp4");
    expect(player?.attrs.controls).toBeDefined();

    const downloadLink = findHtmlByTestId(htmlTree, "delivery-reel-download-link");
    expect(downloadLink).not.toBeNull();
    expect(downloadLink?.attrs.href).toBe(
      "https://storage.example.com/delivery/completed-reel.mp4"
    );

    const assemblyBadge = findHtmlByTestId(htmlTree, "delivery-reel-assembly-id");
    expect(assemblyBadge).not.toBeNull();
    expect(collectHtmlText(assemblyBadge)).toContain("asm-comp-789");
  });

  it("renders campaign page with assembling delivery reel", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      campaignName: "Assembling Campaign",
      totalScenes: 1,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 1,
      scenesByStatus: { completed: 1 },
      scenes: [],
      updatedAt: "2026-08-25T12:00:00.000Z"
    };

    const assemblingReel: CampaignDeliveryReelReadModel = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      status: "assembling",
      state: "assembling",
      assemblyJobId: "job-active-888",
      updatedAt: "2026-08-25T12:15:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);
    vi.mocked(getCampaignDeliveryReel).mockResolvedValueOnce(assemblingReel);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c1111111-1111-4111-8111-111111111111" })
    })) as TestElement;

    const html = renderToStaticMarkup(jsx);
    const htmlTree = parseHtml(html);

    const assemblingContainer = findHtmlByTestId(htmlTree, "delivery-reel-assembling");
    expect(assemblingContainer).not.toBeNull();
    expect(collectHtmlText(assemblingContainer)).toContain("Assembly in Progress");

    const jobBadge = findHtmlByTestId(htmlTree, "delivery-reel-job-id");
    expect(jobBadge).not.toBeNull();
    expect(collectHtmlText(jobBadge)).toContain("job-active-888");

    // Must NOT render video player or download link
    expect(findHtmlByTestId(htmlTree, "delivery-reel-player")).toBeNull();
    expect(findHtmlByTestId(htmlTree, "delivery-reel-download-link")).toBeNull();
  });

  it("renders campaign page with failed delivery reel", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      campaignName: "Failed Campaign",
      totalScenes: 1,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 1,
      scenesByStatus: { completed: 1 },
      scenes: [],
      updatedAt: "2026-08-25T12:00:00.000Z"
    };

    const failedReel: CampaignDeliveryReelReadModel = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      status: "failed",
      state: "failed",
      assemblyJobId: "job-failed-777",
      error: "Encoder error: Unsupported pixel format",
      updatedAt: "2026-08-25T12:20:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);
    vi.mocked(getCampaignDeliveryReel).mockResolvedValueOnce(failedReel);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c1111111-1111-4111-8111-111111111111" })
    })) as TestElement;

    const html = renderToStaticMarkup(jsx);
    const htmlTree = parseHtml(html);

    const failedContainer = findHtmlByTestId(htmlTree, "delivery-reel-failed");
    expect(failedContainer).not.toBeNull();

    const errorEl = findHtmlByTestId(htmlTree, "delivery-reel-error");
    expect(errorEl).not.toBeNull();
    expect(collectHtmlText(errorEl)).toContain("Encoder error: Unsupported pixel format");

    // Must NOT render video player or download link
    expect(findHtmlByTestId(htmlTree, "delivery-reel-player")).toBeNull();
    expect(findHtmlByTestId(htmlTree, "delivery-reel-download-link")).toBeNull();
  });

  it("renders campaign page with unavailable delivery reel", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      campaignName: "Unavailable Campaign",
      totalScenes: 1,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 1,
      scenesByStatus: { completed: 1 },
      scenes: [],
      updatedAt: "2026-08-25T12:00:00.000Z"
    };

    const unavailableReel: CampaignDeliveryReelReadModel = {
      campaignId: "c1111111-1111-4111-8111-111111111111",
      status: "unavailable-artifact",
      state: "unavailable-artifact",
      assemblyId: "asm-unavail-555",
      reason: "Delivery manifest missing in S3",
      updatedAt: "2026-08-25T12:25:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);
    vi.mocked(getCampaignDeliveryReel).mockResolvedValueOnce(unavailableReel);

    const jsx = (await CampaignPage({
      params: Promise.resolve({ campaignId: "c1111111-1111-4111-8111-111111111111" })
    })) as TestElement;

    const html = renderToStaticMarkup(jsx);
    const htmlTree = parseHtml(html);

    const unavailContainer = findHtmlByTestId(htmlTree, "delivery-reel-unavailable");
    expect(unavailContainer).not.toBeNull();

    const reasonEl = findHtmlByTestId(htmlTree, "delivery-reel-unavailable-reason");
    expect(reasonEl).not.toBeNull();
    expect(collectHtmlText(reasonEl)).toContain("Delivery manifest missing in S3");

    // Must NOT render video player or download link
    expect(findHtmlByTestId(htmlTree, "delivery-reel-player")).toBeNull();
    expect(findHtmlByTestId(htmlTree, "delivery-reel-download-link")).toBeNull();
  });

  it("maps 404 from getCampaignDeliveryReel to notFound()", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c4040404-0404-4040-8404-040404040404",
      campaignName: "Test Campaign",
      totalScenes: 0,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 0,
      scenesByStatus: {},
      scenes: [],
      updatedAt: "2026-08-25T12:00:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);
    vi.mocked(getCampaignDeliveryReel).mockRejectedValueOnce(
      new ApiClientError("Delivery reel not found", 404)
    );

    await expect(
      CampaignPage({
        params: Promise.resolve({ campaignId: "c4040404-0404-4040-8404-040404040404" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalled();
  });

  it("rethrows 500 error from getCampaignDeliveryReel without invoking notFound()", async () => {
    const summaryFixture: CampaignReviewSummary = {
      campaignId: "c5000500-0500-4500-8500-050005000500",
      campaignName: "Test Campaign",
      totalScenes: 0,
      pendingReviewCount: 0,
      approvedCount: 0,
      completedCount: 0,
      scenesByStatus: {},
      scenes: [],
      updatedAt: "2026-08-25T12:00:00.000Z"
    };

    vi.mocked(getCampaignReviewSummary).mockResolvedValueOnce(summaryFixture);
    vi.mocked(getCampaignDeliveryReel).mockRejectedValueOnce(
      new ApiClientError("Internal delivery reel error", 500)
    );

    await expect(
      CampaignPage({
        params: Promise.resolve({ campaignId: "c5000500-0500-4500-8500-050005000500" })
      })
    ).rejects.toThrow("Internal delivery reel error");
  });
});
