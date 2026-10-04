// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ProductionInputInspector } from "./production-input-inspector";
import type { H3ProductionInspectionReadModel } from "@cco/contracts";

describe("ProductionInputInspector", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const sampleInspection: H3ProductionInspectionReadModel = {
    authority: {
      sceneId: "01950c46-9e90-7d3d-82d2-8f1d3c000001",
      specRevision: 2,
      shotPlanId: "01950c46-9e90-7d3d-82d2-8f1d3c000002",
      variantOrdinal: 1,
      shotPlanStatus: "approved",
      isCurrentRevision: true
    },
    route: {
      routingMode: "reference_directed",
      renderProfileKey: "MINIMAX_H3_720P_5S_REF2V_V1",
      workflowTemplate: "minimax-h3-720p-124f-ref2v",
      targetDurationMs: 5000,
      targetFrameCount: 124,
      fps: 24,
      width: 1344,
      height: 768
    },
    visualInputs: {
      references: [
        {
          slotIndex: 1,
          promptTag: "<Picture 1>",
          referenceAssetId: "01950c46-9e90-7d3d-82d2-8f1d3c000003",
          displayName: "Protagonist Hero",
          role: "subject_identity",
          contentHashSha256: "a".repeat(64),
          previewUrl: "https://example.com/ref1.png",
          previewAvailability: "available"
        }
      ],
      frameAnchor: null
    },
    instruction: {
      compiledText: "A cyberpunk detective walks through rain-slicked streets under neon glow.",
      compiledSha256: "b".repeat(64),
      cameraIntentSummary: {
        framing: "wide",
        angle: "eye_level",
        cameraMovement: "dolly_in",
        movementSpeed: "slow",
        lensIntent: "35mm prime",
        cameraPosition: "chest height",
        cameraPromptDescription: "Slow push in on the protagonist"
      }
    },
    admission: {
      readiness: "ready",
      blockers: []
    },
    runtimeContext: {
      durationCeilingSeconds: 60
    },
    productionInputFingerprint: "c".repeat(64)
  };

  it("renders loading skeleton when isLoading is true", () => {
    render(<ProductionInputInspector inspection={null} isLoading={true} />);
    expect(screen.getByTestId("inspector-loading")).toBeDefined();
    expect(screen.getByText("Inspecting production inputs...")).toBeDefined();
  });

  it("renders error alert with retry button when error is provided", () => {
    const onRefresh = vi.fn();
    render(
      <ProductionInputInspector
        inspection={null}
        error="Network error fetching inspection"
        onRefresh={onRefresh}
      />
    );
    expect(screen.getByTestId("inspector-error")).toBeDefined();
    expect(screen.getByText("Network error fetching inspection")).toBeDefined();
    const retryButton = screen.getByTestId("inspector-retry-button");
    fireEvent.click(retryButton);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("renders empty state when inspection is null", () => {
    render(<ProductionInputInspector inspection={null} />);
    expect(screen.getByTestId("inspector-empty")).toBeDefined();
  });

  it("renders full inspection read model on happy path", () => {
    render(<ProductionInputInspector inspection={sampleInspection} />);

    expect(screen.getByTestId("production-input-inspector")).toBeDefined();

    // Readiness badge
    const badge = screen.getByTestId("inspector-readiness-badge");
    expect(badge.textContent).toBe("READY FOR ADMISSION");
    expect(badge.getAttribute("data-readiness")).toBe("ready");

    // Fingerprint
    const fp = screen.getByTestId("inspector-fingerprint");
    expect(fp.textContent).toBe("c".repeat(64));

    // Previs notice
    expect(screen.getByTestId("previs-review-only-notice")).toBeDefined();

    // Authority
    expect(screen.getByText("Revision 2")).toBeDefined();

    // Route & geometry
    const route = screen.getByTestId("inspector-route");
    expect(route.textContent).toContain("reference_directed");
    expect(route.textContent).toContain("1344x768 @ 24 fps");
    expect(route.textContent).toContain("124 frames (5000ms)");

    // References list
    const refsList = screen.getByTestId("inspector-references-list");
    expect(refsList.textContent).toContain("<Picture 1>");
    expect(refsList.textContent).toContain("Protagonist Hero");
    expect(refsList.textContent).toContain("subject_identity");

    // Instruction & camera intent
    const prompt = screen.getByTestId("inspector-compiled-prompt");
    expect(prompt.textContent).toBe(
      "A cyberpunk detective walks through rain-slicked streets under neon glow."
    );
    const cameraSummary = screen.getByTestId("inspector-camera-summary");
    expect(cameraSummary.textContent).toContain("wide");
    expect(cameraSummary.textContent).toContain("dolly_in (slow)");
    expect(cameraSummary.textContent).toContain("35mm prime");
  });

  it("renders frame_anchored mode with frame anchor details", () => {
    const frameInspection: H3ProductionInspectionReadModel = {
      ...sampleInspection,
      route: {
        ...sampleInspection.route,
        routingMode: "frame_anchored",
        workflowTemplate: "minimax-h3-720p-124f-i2v",
        renderProfileKey: "MINIMAX_H3_720P_5S_I2V_V1"
      },
      visualInputs: {
        references: [],
        frameAnchor: {
          frameAnchorTarget: "first_frame",
          anchorCandidateId: "cand-anchor-uuid-1",
          anchorMediaHashSha256: "d".repeat(64),
          previewUrl: "https://example.com/cand.png",
          previewAvailability: "available"
        }
      }
    };

    render(<ProductionInputInspector inspection={frameInspection} />);

    const anchor = screen.getByTestId("inspector-frame-anchor");
    expect(anchor.textContent).toContain("first_frame");
    expect(anchor.textContent).toContain("cand-anchor-uuid-1");
  });

  it("renders blockers list when admission is blocked", () => {
    const blockedInspection: H3ProductionInspectionReadModel = {
      ...sampleInspection,
      admission: {
        readiness: "blocked",
        blockers: [
          {
            code: "REFERENCE_MEDIA_VALIDATION_FAILED",
            message: "Reference asset byte length is 0."
          }
        ]
      }
    };

    render(<ProductionInputInspector inspection={blockedInspection} />);

    const badge = screen.getByTestId("inspector-readiness-badge");
    expect(badge.textContent).toBe("ADMISSION BLOCKED");

    const blockers = screen.getByTestId("inspector-blockers");
    expect(blockers.textContent).toContain("REFERENCE_MEDIA_VALIDATION_FAILED");
    expect(blockers.textContent).toContain("Reference asset byte length is 0.");
  });

  it("copies fingerprint to clipboard when copy button is clicked", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock
      }
    });

    render(<ProductionInputInspector inspection={sampleInspection} />);

    const copyBtn = screen.getByTestId("copy-fingerprint-button");
    expect(copyBtn.textContent).toBe("Copy Hash");

    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith("c".repeat(64));
  });
});
