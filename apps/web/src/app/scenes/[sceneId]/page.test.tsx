import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ScenePage, { dynamic } from "./page.js";
import SceneNotFound from "./not-found.js";
import SceneError from "./error.js";
import { CandidateMedia } from "../../../components/candidate-media.js";
import { formatDateTime } from "../../../components/format-review-value.js";
import { getSceneReviewDetail, ApiClientError } from "../../../api/client.js";
import type * as ClientModule from "../../../api/client.js";
import { notFound } from "next/navigation";
import type { SceneReviewDetailReadModel } from "@cco/contracts";

vi.mock("../../../api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return {
    ...actual,
    getSceneReviewDetail: vi.fn()
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
  type?: string;
  role?: string;
  [key: string]: unknown;
}>;

// `findByTestId` below operates directly on React elements. It is only safe for element trees
// that never reach a component using hooks (e.g. `SceneNotFound`, `SceneError`) because it
// calls function components as plain functions to descend into their output, which is an
// invalid hook call for anything stateful.
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
    if ("type" in node && typeof node.type === "function" && node.type !== CandidateMedia) {
      const rendered = (node.type as (props: unknown) => ReactNode)(element.props);
      const match = findByTestId(rendered, testId);
      if (match) return match;
    }
    if (element.props?.children) {
      const match = findByTestId(element.props.children, testId);
      if (match) return match;
    }
  }
  return null;
}

// For any subtree that may contain client components with hooks (i.e. anything rendered by
// `ScenePage`), assertions must go through real rendering instead of manually invoking
// component functions. `renderToStaticMarkup` executes hooks correctly; the helpers below parse
// that resulting HTML string into a minimal element tree for `data-testid` based lookups.
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

function findAllHtmlByTestId(node: HtmlElementNode | string, testId: string): HtmlElementNode[] {
  return findAllHtmlNodes(node, (el) => el.attrs["data-testid"] === testId);
}

function collectHtmlText(node: HtmlElementNode | string | null): string {
  if (node === null) return "";
  function extract(n: HtmlElementNode | string): string {
    if (!isHtmlElementNode(n)) return n;
    return n.children.map(extract).join(" ");
  }
  return extract(node).replace(/\s+/g, " ").trim();
}

function collectText(node: ReactNode | HtmlElementNode | null): string {
  if (node === null) return "";
  if (typeof node === "object" && "tag" in node && "attrs" in node && "children" in node) {
    return collectHtmlText(node as HtmlElementNode);
  }
  return collectHtmlText(parseHtml(renderToStaticMarkup(node as ReactElement)));
}

describe("Scene Review Detail Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports dynamic = 'force-dynamic'", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("renders every scene configuration review and identity field", async () => {
    const completeFixture: SceneReviewDetailReadModel = {
      sceneId: "s1111111-1111-4111-8111-111111111111",
      campaignId: "c1111111-1111-4111-8111-111111111111",
      status: "director_review",
      specRevision: 3,
      configuration: {
        prompt: "Cinematic shot of neon city in the rain",
        referenceIds: ["ref-001", "ref-002"],
        engineProfileId: "engine-v2-sdxl",
        durationMs: 4500,
        loraConfigurationId: "lora-cyberpunk-01"
      },
      selectedCandidateId: "cand-curr-1-1111-4111-8111-111111111111",
      selectedCandidateRevision: 3,
      approval: {
        revision: 3,
        approvedBy: "director-alex",
        approvedAt: "2026-08-25T14:30:00.000Z"
      },
      candidatesByRevision: [
        {
          specRevision: 3,
          candidates: [
            {
              candidateId: "cand-curr-1-1111-4111-8111-111111111111",
              sceneId: "s1111111-1111-4111-8111-111111111111",
              specRevision: 3,
              variantOrdinal: 1,
              contentHash: "hash-curr-1-abcdef",
              media: {
                available: true,
                url: "https://media.example.com/cand-curr-1.png"
              },
              createdAt: "2026-08-25T14:00:00.000Z"
            },
            {
              candidateId: "cand-curr-2-2222-4222-8222-222222222222",
              sceneId: "s1111111-1111-4111-8111-111111111111",
              specRevision: 3,
              variantOrdinal: 2,
              contentHash: "hash-curr-2-bcdef0",
              media: {
                available: true,
                url: "https://media.example.com/cand-curr-2.png"
              },
              createdAt: "2026-08-25T14:05:00.000Z"
            }
          ]
        },
        {
          specRevision: 2,
          candidates: [
            {
              candidateId: "cand-hist-1-3333-4333-8333-333333333333",
              sceneId: "s1111111-1111-4111-8111-111111111111",
              specRevision: 2,
              variantOrdinal: 1,
              contentHash: "hash-hist-1-cdef01",
              media: {
                available: true,
                url: "https://media.example.com/cand-hist-1.png"
              },
              createdAt: "2026-08-25T12:00:00.000Z"
            }
          ]
        }
      ],
      allowedActions: ["approve", "reject", "reroll", "prompt_edit", "candidate_select"]
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(completeFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s1111111-1111-4111-8111-111111111111" })
    })) as TestElement;

    expect(getSceneReviewDetail).toHaveBeenCalledWith("s1111111-1111-4111-8111-111111111111");
    expect(jsx).not.toBeNull();

    const html = renderToStaticMarkup(jsx);
    const htmlTree = parseHtml(html);
    const fullText = collectText(jsx);

    // Identity and scene status/revision
    expect(fullText).toContain("s1111111-1111-4111-8111-111111111111");
    expect(fullText).toContain("director_review");
    expect(fullText).toContain("3");

    // Campaign backlink
    const campaignLink = findHtmlByTestId(htmlTree, "back-to-campaign-link");
    expect(campaignLink).not.toBeNull();
    expect(campaignLink?.attrs.href).toBe("/campaigns/c1111111-1111-4111-8111-111111111111");

    // Configuration fields
    expect(fullText).toContain("Cinematic shot of neon city in the rain");
    expect(fullText).toContain("ref-001");
    expect(fullText).toContain("ref-002");
    expect(fullText).toContain("engine-v2-sdxl");
    expect(fullText).toContain("4500"); // exact duration milliseconds
    expect(fullText).toContain("lora-cyberpunk-01");

    // Selection metadata
    expect(fullText).toContain("cand-curr-1-1111-4111-8111-111111111111");

    // Approval metadata
    expect(fullText).toContain("director-alex");
    expect(fullText).toContain(formatDateTime("2026-08-25T14:30:00.000Z"));

    // Candidate fields: ID, hash, ordinal, time
    expect(fullText).toContain("hash-curr-1-abcdef");
    expect(fullText).toContain("hash-curr-2-bcdef0");
    expect(fullText).toContain("hash-hist-1-cdef01");
    expect(fullText).toContain("cand-curr-2-2222-4222-8222-222222222222");
    expect(fullText).toContain("cand-hist-1-3333-4333-8333-333333333333");
    expect(fullText).toContain(formatDateTime("2026-08-25T14:00:00.000Z"));
    expect(fullText).toContain(formatDateTime("2026-08-25T12:00:00.000Z"));

    // Allowed action buttons rendered in command surface
    expect(html).toContain('data-testid="action-button-approve"');
    expect(html).toContain('data-testid="action-button-reject"');
    expect(html).toContain('data-testid="action-button-reroll"');
    expect(html).toContain('data-testid="action-button-prompt_edit"');
    expect(html).toContain('data-testid="action-button-candidate_select"');

    // Static markup checks
    expect(html).toContain('data-testid="scene-review-detail"');
    expect(html).toContain('data-testid="candidate-card"');
    expect(html).toContain('data-testid="review-command-controls"');
  });

  it("renders explicit absent selection approval references and LoRA states", async () => {
    const minimalFixture: SceneReviewDetailReadModel = {
      sceneId: "s2222222-2222-4222-8222-222222222222",
      campaignId: "c2222222-2222-4222-8222-222222222222",
      status: "draft_pending",
      specRevision: 1,
      configuration: {
        prompt: "Simple sketch",
        referenceIds: [],
        engineProfileId: "engine-v1",
        durationMs: 3000,
        loraConfigurationId: null
      },
      selectedCandidateId: undefined,
      selectedCandidateRevision: undefined,
      approval: undefined,
      candidatesByRevision: [],
      allowedActions: []
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(minimalFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s2222222-2222-4222-8222-222222222222" })
    })) as TestElement;

    // Check explicit absent states
    const htmlTree = parseHtml(renderToStaticMarkup(jsx));

    const selectionEl = findHtmlByTestId(htmlTree, "selection-status");
    expect(selectionEl).not.toBeNull();
    expect(collectText(selectionEl)).toMatch(/no candidate selected|none/i);

    const approvalEl = findHtmlByTestId(htmlTree, "approval-status");
    expect(approvalEl).not.toBeNull();
    expect(collectText(approvalEl)).toMatch(/not approved|none/i);

    const referencesEl = findHtmlByTestId(htmlTree, "scene-references");
    expect(referencesEl).not.toBeNull();
    expect(collectText(referencesEl)).toMatch(/none/i);

    const loraEl = findHtmlByTestId(htmlTree, "scene-lora");
    expect(loraEl).not.toBeNull();
    expect(collectText(loraEl)).toMatch(/none/i);
  });

  it("keeps candidates grouped and labels current and historical revisions", async () => {
    const multiGroupFixture: SceneReviewDetailReadModel = {
      sceneId: "s3333333-3333-4333-8333-333333333333",
      campaignId: "c3333333-3333-4333-8333-333333333333",
      status: "director_review",
      specRevision: 3,
      configuration: {
        prompt: "Multi-revision scene prompt",
        referenceIds: [],
        engineProfileId: "engine-v2",
        durationMs: 5000
      },
      candidatesByRevision: [
        {
          specRevision: 3,
          candidates: [
            {
              candidateId: "c3333333-3333-4333-8333-333333333331",
              sceneId: "s3333333-3333-4333-8333-333333333333",
              specRevision: 3,
              variantOrdinal: 1,
              contentHash: "hash-rev3-1",
              media: { available: true, url: "https://example.com/rev3.png" },
              createdAt: "2026-08-25T15:00:00.000Z"
            }
          ]
        },
        {
          specRevision: 2,
          candidates: [
            {
              candidateId: "c2222222-2222-4222-8222-222222222221",
              sceneId: "s3333333-3333-4333-8333-333333333333",
              specRevision: 2,
              variantOrdinal: 1,
              contentHash: "hash-rev2-1",
              media: { available: true, url: "https://example.com/rev2.png" },
              createdAt: "2026-08-25T14:00:00.000Z"
            }
          ]
        },
        {
          specRevision: 1,
          candidates: [
            {
              candidateId: "c1111111-1111-4111-8111-111111111111",
              sceneId: "s3333333-3333-4333-8333-333333333333",
              specRevision: 1,
              variantOrdinal: 1,
              contentHash: "hash-rev1-1",
              media: { available: true, url: "https://example.com/rev1.png" },
              createdAt: "2026-08-25T13:00:00.000Z"
            }
          ]
        }
      ],
      allowedActions: []
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(multiGroupFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s3333333-3333-4333-8333-333333333333" })
    })) as TestElement;

    const htmlTree = parseHtml(renderToStaticMarkup(jsx));
    const revisionGroups = findAllHtmlByTestId(htmlTree, "candidate-revision-group");
    expect(revisionGroups).toHaveLength(3);

    // Group 1: Revision 3 -> Current
    const group1Header = findHtmlByTestId(revisionGroups[0]!, "revision-group-heading");
    expect(group1Header).not.toBeNull();
    const g1Text = collectText(group1Header);
    expect(g1Text).toContain("Revision 3");
    expect(g1Text).toMatch(/current/i);

    // Group 2: Revision 2 -> Historical
    const group2Header = findHtmlByTestId(revisionGroups[1]!, "revision-group-heading");
    expect(group2Header).not.toBeNull();
    const g2Text = collectText(group2Header);
    expect(g2Text).toContain("Revision 2");
    expect(g2Text).toMatch(/historical/i);

    // Group 3: Revision 1 -> Historical
    const group3Header = findHtmlByTestId(revisionGroups[2]!, "revision-group-heading");
    expect(group3Header).not.toBeNull();
    const g3Text = collectText(group3Header);
    expect(g3Text).toContain("Revision 1");
    expect(g3Text).toMatch(/historical/i);
  });

  it("keeps historical candidates visible without selection affordances", async () => {
    const historicalFixture: SceneReviewDetailReadModel = {
      sceneId: "s4444444-4444-4444-8444-444444444444",
      campaignId: "c4444444-4444-4444-8444-444444444444",
      status: "director_review",
      specRevision: 2,
      configuration: {
        prompt: "Historical test",
        referenceIds: [],
        engineProfileId: "engine-v2",
        durationMs: 4000
      },
      candidatesByRevision: [
        {
          specRevision: 2,
          candidates: [
            {
              candidateId: "c4444444-4444-4444-8444-444444444441",
              sceneId: "s4444444-4444-4444-8444-444444444444",
              specRevision: 2,
              variantOrdinal: 1,
              contentHash: "hash-curr",
              media: { available: true, url: "https://example.com/c4.png" },
              createdAt: "2026-08-25T16:00:00.000Z"
            }
          ]
        },
        {
          specRevision: 1,
          candidates: [
            {
              candidateId: "c4444444-4444-4444-8444-444444444440",
              sceneId: "s4444444-4444-4444-8444-444444444444",
              specRevision: 1,
              variantOrdinal: 1,
              contentHash: "hash-hist",
              media: { available: true, url: "https://example.com/c3.png" },
              createdAt: "2026-08-25T15:00:00.000Z"
            }
          ]
        }
      ],
      allowedActions: ["approve", "reject"]
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(historicalFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s4444444-4444-4444-8444-444444444444" })
    })) as TestElement;

    // Historical candidate card is fully visible with identity
    const htmlTree = parseHtml(renderToStaticMarkup(jsx));
    const candidateCards = findAllHtmlByTestId(htmlTree, "candidate-card");
    expect(candidateCards).toHaveLength(2);

    const histCard = candidateCards[1]!;
    const histText = collectText(histCard);
    expect(histText).toContain("c4444444-4444-4444-8444-444444444440");
    expect(histText).toContain("hash-hist");

    // Assert no interactive mutation affordance inside candidate cards
    const interactiveElements = findAllHtmlNodes(
      histCard,
      (el) =>
        el.tag === "button" ||
        el.tag === "form" ||
        el.tag === "input" ||
        el.tag === "select" ||
        el.tag === "textarea" ||
        el.attrs.role === "button" ||
        el.attrs.role === "radio" ||
        el.attrs.role === "checkbox"
    );
    expect(interactiveElements).toHaveLength(0);
  });

  it("renders server allowed actions as interactive review command controls", async () => {
    // Case 1: Populated allowed actions
    const actionsFixture: SceneReviewDetailReadModel = {
      sceneId: "s5555555-5555-4555-8555-555555555555",
      campaignId: "c5555555-5555-4555-8555-555555555555",
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "Action test",
        referenceIds: [],
        engineProfileId: "engine-v2",
        durationMs: 3000
      },
      candidatesByRevision: [],
      allowedActions: ["approve", "reroll", "prompt_edit"]
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(actionsFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s5555555-5555-4555-8555-555555555555" })
    })) as TestElement;

    const html = renderToStaticMarkup(jsx);
    expect(html).toContain('data-testid="review-command-controls"');
    expect(html).toContain('data-testid="action-button-approve"');
    expect(html).toContain('data-testid="action-button-reroll"');
    expect(html).toContain('data-testid="action-button-prompt_edit"');

    // Case 2: Empty allowed actions
    const emptyActionsFixture: SceneReviewDetailReadModel = {
      ...actionsFixture,
      allowedActions: []
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(emptyActionsFixture);

    const jsxEmpty = (await ScenePage({
      params: Promise.resolve({ sceneId: "s5555555-5555-4555-8555-555555555555" })
    })) as TestElement;

    const htmlEmpty = renderToStaticMarkup(jsxEmpty);
    expect(htmlEmpty).toContain('data-testid="empty-actions"');
    expect(htmlEmpty).toMatch(/no review actions available/i);
  });

  it("renders an explicit no-candidates state", async () => {
    const noCandidatesFixture: SceneReviewDetailReadModel = {
      sceneId: "s6666666-6666-4666-8666-666666666666",
      campaignId: "c6666666-6666-4666-8666-666666666666",
      status: "generating_candidates",
      specRevision: 1,
      configuration: {
        prompt: "Generating scene",
        referenceIds: [],
        engineProfileId: "engine-v2",
        durationMs: 3000
      },
      candidatesByRevision: [],
      allowedActions: []
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(noCandidatesFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s6666666-6666-4666-8666-666666666666" })
    })) as TestElement;

    const htmlTree = parseHtml(renderToStaticMarkup(jsx));
    const noCandidatesEl = findHtmlByTestId(htmlTree, "no-candidates-state");
    expect(noCandidatesEl).not.toBeNull();
    expect(collectText(noCandidatesEl)).toMatch(/no candidates/i);

    const candidateCards = findAllHtmlByTestId(htmlTree, "candidate-card");
    expect(candidateCards).toHaveLength(0);
  });

  it("composes CandidateMedia with unavailable media props", async () => {
    const unavailableMediaFixture: SceneReviewDetailReadModel = {
      sceneId: "s7777777-7777-4777-8777-777777777777",
      campaignId: "c7777777-7777-4777-8777-777777777777",
      status: "director_review",
      specRevision: 1,
      configuration: {
        prompt: "Scene with unavailable candidate media",
        referenceIds: [],
        engineProfileId: "engine-v2",
        durationMs: 3000
      },
      candidatesByRevision: [
        {
          specRevision: 1,
          candidates: [
            {
              candidateId: "c7777777-7777-4777-8777-777777777771",
              sceneId: "s7777777-7777-4777-8777-777777777777",
              specRevision: 1,
              variantOrdinal: 1,
              contentHash: "hash-unavail",
              media: { available: false },
              createdAt: "2026-08-25T16:00:00.000Z"
            }
          ]
        }
      ],
      allowedActions: []
    };

    vi.mocked(getSceneReviewDetail).mockResolvedValueOnce(unavailableMediaFixture);

    const jsx = (await ScenePage({
      params: Promise.resolve({ sceneId: "s7777777-7777-4777-8777-777777777777" })
    })) as TestElement;

    const html = renderToStaticMarkup(jsx);
    expect(html).toContain('data-testid="candidate-media-unavailable"');
    expect(html).toContain("Media unavailable; candidate provenance retained");
    expect(html).not.toContain("<img");
  });

  it("maps a missing scene to the route-local not-found state", async () => {
    // 404 ApiClientError should call notFound()
    vi.mocked(getSceneReviewDetail).mockRejectedValueOnce(
      new ApiClientError("Scene not found", 404)
    );

    await expect(
      ScenePage({
        params: Promise.resolve({ sceneId: "s4040404-0404-4040-8404-040404040404" })
      })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(notFound).toHaveBeenCalledTimes(1);

    // 500 ApiClientError should rethrow without calling notFound
    vi.mocked(getSceneReviewDetail).mockRejectedValueOnce(
      new ApiClientError("Internal server error", 500)
    );

    await expect(
      ScenePage({
        params: Promise.resolve({ sceneId: "s5000500-0500-4500-8500-050005000500" })
      })
    ).rejects.toThrow("Internal server error");

    expect(notFound).toHaveBeenCalledTimes(1);

    // Generic error should rethrow without calling notFound
    vi.mocked(getSceneReviewDetail).mockRejectedValueOnce(new Error("Network failure"));

    await expect(
      ScenePage({
        params: Promise.resolve({ sceneId: "s6000600-0600-4600-8600-060006000600" })
      })
    ).rejects.toThrow("Network failure");

    expect(notFound).toHaveBeenCalledTimes(1);
  });

  it("renders not-found component with landing page link", () => {
    const notFoundJsx = SceneNotFound() as TestElement;
    expect(notFoundJsx).not.toBeNull();
    const container = findByTestId(notFoundJsx, "scene-not-found");
    expect(container).not.toBeNull();
    const link = findByTestId(notFoundJsx, "back-to-hub-link");
    expect(link).not.toBeNull();
    expect(link?.props.href).toBe("/");
  });

  it("renders error component with retry handler", () => {
    const resetMock = vi.fn();
    const errorJsx = SceneError({
      error: new Error("Test error"),
      reset: resetMock
    }) as TestElement;

    expect(errorJsx).not.toBeNull();
    const container = findByTestId(errorJsx, "scene-error");
    expect(container).not.toBeNull();
    const retryBtn = findByTestId(errorJsx, "retry-button");
    expect(retryBtn).not.toBeNull();
    retryBtn?.props.onClick?.();
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
