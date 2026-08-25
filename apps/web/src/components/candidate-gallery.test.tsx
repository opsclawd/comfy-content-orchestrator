import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SceneReviewCandidateGroup } from "@cco/contracts";
import { CandidateGallery } from "./candidate-gallery.js";

type TestElement = ReactElement<{
  "data-testid"?: string;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  [key: string]: unknown;
}>;

function findAllByTestId(node: ReactNode, testId: string): TestElement[] {
  const matches: TestElement[] = [];
  if (node == null || typeof node !== "object") return matches;
  if (Array.isArray(node)) {
    for (const child of node) {
      matches.push(...findAllByTestId(child, testId));
    }
    return matches;
  }
  if ("props" in node) {
    const element = node as TestElement;
    if (element.props?.["data-testid"] === testId) {
      matches.push(element);
    }
    if (element.props?.children) {
      matches.push(...findAllByTestId(element.props.children, testId));
    }
  }
  return matches;
}

function candidateGroup(
  specRevision: number,
  candidateId: string,
  overrides: Partial<SceneReviewCandidateGroup["candidates"][number]> = {}
): SceneReviewCandidateGroup {
  return {
    specRevision,
    candidates: [
      {
        candidateId,
        sceneId: "11111111-1111-1111-1111-111111111111",
        specRevision,
        variantOrdinal: 1,
        contentHash: "hash-1",
        media: { available: false },
        createdAt: "2026-08-25T00:00:00.000Z",
        ...overrides
      }
    ]
  };
}

const currentCandidateId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const historicalCandidateId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("CandidateGallery selection controls", () => {
  it("offers a select control only on current-revision candidates when onSelectCandidate is provided", () => {
    const candidatesByRevision = [
      candidateGroup(1, historicalCandidateId),
      candidateGroup(2, currentCandidateId)
    ];

    const html = renderToStaticMarkup(
      <CandidateGallery
        candidatesByRevision={candidatesByRevision}
        currentSpecRevision={2}
        onSelectCandidate={vi.fn()}
      />
    );

    const buttonMarkers = html.match(/data-testid="select-candidate-button"/g) ?? [];
    expect(buttonMarkers).toHaveLength(1);

    const tree = CandidateGallery({
      candidatesByRevision,
      currentSpecRevision: 2,
      onSelectCandidate: vi.fn()
    }) as TestElement;
    const buttons = findAllByTestId(tree, "select-candidate-button");
    expect(buttons).toHaveLength(1);
  });

  it("never offers a select control without an onSelectCandidate callback (read-only view)", () => {
    const candidatesByRevision = [candidateGroup(1, currentCandidateId)];

    const html = renderToStaticMarkup(
      <CandidateGallery candidatesByRevision={candidatesByRevision} currentSpecRevision={1} />
    );

    expect(html).not.toContain('data-testid="select-candidate-button"');
  });

  it("does not offer a select control on the already-selected candidate", () => {
    const candidatesByRevision = [candidateGroup(1, currentCandidateId)];

    const tree = CandidateGallery({
      candidatesByRevision,
      currentSpecRevision: 1,
      selectedCandidateId: currentCandidateId,
      onSelectCandidate: vi.fn()
    }) as TestElement;

    expect(findAllByTestId(tree, "select-candidate-button")).toHaveLength(0);
    expect(findAllByTestId(tree, "candidate-selected-badge")).toHaveLength(1);
  });

  it("invokes onSelectCandidate with the candidate's id and spec revision on click", () => {
    const candidatesByRevision = [candidateGroup(3, currentCandidateId)];
    const onSelectCandidate = vi.fn();

    const tree = CandidateGallery({
      candidatesByRevision,
      currentSpecRevision: 3,
      onSelectCandidate
    }) as TestElement;

    const [button] = findAllByTestId(tree, "select-candidate-button");
    button?.props.onClick?.();

    expect(onSelectCandidate).toHaveBeenCalledTimes(1);
    expect(onSelectCandidate).toHaveBeenCalledWith(currentCandidateId, 3);
  });

  it("disables the select control when disabled is true", () => {
    const candidatesByRevision = [candidateGroup(1, currentCandidateId)];

    const html = renderToStaticMarkup(
      <CandidateGallery
        candidatesByRevision={candidatesByRevision}
        currentSpecRevision={1}
        onSelectCandidate={vi.fn()}
        disabled
      />
    );

    expect(html).toContain('data-testid="select-candidate-button"');
    expect(html).toMatch(/data-testid="select-candidate-button"[^>]*disabled=""/);
  });
});
