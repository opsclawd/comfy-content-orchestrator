import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShotPlanPanel } from "./shot-plan-panel.js";
import type { ShotPlanReviewItem } from "@cco/contracts";

function createSampleShotPlan(overrides?: Partial<ShotPlanReviewItem>): ShotPlanReviewItem {
  return {
    shotPlanId: "11111111-1111-4111-8111-111111111111",
    sceneId: "22222222-2222-4222-8222-222222222222",
    specRevision: 2,
    variantOrdinal: 1,
    status: "draft",
    routingMode: "reference_directed",
    isCurrentRevision: true,
    targetDurationMs: 4000,
    targetFrameCount: 97,
    framing: "medium_close_up",
    angle: "eye_level",
    cameraMovement: "dolly_in",
    movementSpeed: "slow",
    lensIntent: "50mm prime cinematic",
    cameraPosition: "chest height, facing subject",
    cameraPromptDescription: "Slow push in on the cybernetic protagonist",
    actionSummary: "Protagonist raises visor and examines glowing data shard",
    lightingStyle: "neon_night",
    environmentDescription: "Rain-slicked alleyway in Neo-Tokyo",
    colorPalette: ["cyan", "magenta", "deep_navy"],
    atmosphere: "steamy neon rain haze",
    subjects: [
      {
        subjectId: "subject-hero-1",
        role: "subject_identity",
        initialPosition: "screen_center",
        movementTrajectory: "stationary, raises arm forward"
      }
    ],
    beats: [
      {
        beatIndex: 1,
        startMs: 0,
        endMs: 2000,
        description: "Visor lifts to reveal cybernetic eye",
        cameraAction: "gentle push in",
        subjectAction: "hand lifts visor"
      },
      {
        beatIndex: 2,
        startMs: 2000,
        endMs: 4000,
        description: "Shard glows brighter, illuminating face",
        cameraAction: "hold close framing",
        subjectAction: "gaze fixes on glowing data"
      }
    ],
    dialogue: null,
    continuity: {
      persistentSubjectIds: ["subject-hero-1"],
      frameAnchorTarget: "none"
    },
    previs: {
      candidateId: "33333333-3333-4333-8333-333333333333",
      media: {
        available: true,
        url: "https://media.example.com/previs-1.jpg"
      },
      reviewNotes: "Previs draft showing eye-level composition"
    },
    boundReferences: [
      {
        referenceAssetId: "44444444-4444-4444-8444-444444444444",
        sceneId: "22222222-2222-4222-8222-222222222222",
        specRevision: 2,
        role: "subject_identity",
        displayName: "Protagonist Face Model",
        width: 1024,
        height: 1024,
        previewUrl: "https://media.example.com/ref-hero.png",
        previewAvailability: "available"
      }
    ],
    createdAt: "2026-09-27T12:00:00.000Z",
    updatedAt: "2026-09-27T12:00:00.000Z",
    ...overrides
  };
}

describe("ShotPlanPanel Component", () => {
  it("renders empty state when no shot plans are present", () => {
    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[]} currentSpecRevision={2} />);

    expect(html).toContain('data-testid="shot-plan-panel"');
    expect(html).toContain('data-testid="no-shot-plans-state"');
    expect(html).toContain("No shot plans have been generated for this scene");
  });

  it("renders structured intent, references, and distinct previs visualization", () => {
    const plan = createSampleShotPlan();
    const html = renderToStaticMarkup(<ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} />);

    // Section and authority headers
    expect(html).toContain('data-testid="shot-plan-panel"');
    expect(html).toContain("Structured Production Intent");
    expect(html).toContain("Director approval binds to structured ShotPlan intent");

    // Card header
    expect(html).toContain('data-testid="shot-plan-card"');
    expect(html).toContain("Variant #1");
    expect(html).toContain("DRAFT");
    expect(html).toContain("Reference Directed");
    expect(html).toContain("Rev 2 (Current)");

    // Previs visualization (distinguished and labeled as non-authoritative)
    expect(html).toContain('data-testid="shot-plan-previs-visualization"');
    expect(html).toContain("Previs Visualization (Non-Authoritative)");
    expect(html).toContain("not conditioned as first-frame in reference-directed H3");
    expect(html).toContain('data-testid="previs-preview-image"');
    expect(html).toContain("https://media.example.com/previs-1.jpg");

    // Structured attributes
    expect(html).toContain("4000 ms (4.00s) (97 frames)");
    expect(html).toContain("medium_close_up");
    expect(html).toContain("eye_level");
    expect(html).toContain("dolly_in (slow)");
    expect(html).toContain("50mm prime cinematic");
    expect(html).toContain("Protagonist raises visor and examines glowing data shard");
    expect(html).toContain("neon_night");
    expect(html).toContain("Rain-slicked alleyway in Neo-Tokyo");
    expect(html).toContain("subject-hero-1");
    expect(html).toContain("Visor lifts to reveal cybernetic eye");

    // Visual Authority Reference Assets
    expect(html).toContain('data-testid="shot-plan-references"');
    expect(html).toContain("Authoritative Reference Assets (Visual Authority)");
    expect(html).toContain('data-testid="shot-plan-reference-item"');
    expect(html).toContain("Protagonist Face Model");
    expect(html).toContain("subject");
    expect(html).toContain("1024×1024");
    expect(html).toContain('data-testid="reference-preview-image"');

    // Actions
    expect(html).toContain('data-testid="shot-plan-select-button"');
    expect(html).toContain('data-testid="shot-plan-approve-button"');
    expect(html).toContain("Select Plan");
    expect(html).toContain("Approve Intent");
  });

  it("renders frame-anchored routing mode and authoritative anchor identity when valid and confirmed", () => {
    const candidateHash = "a".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "anchor-candidate-uuid-9999",
        anchorMediaHashSha256: candidateHash
      },
      previs: {
        candidateId: "anchor-candidate-uuid-9999",
        media: {
          available: true,
          url: "https://media.example.com/anchor.jpg"
        }
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "anchor-candidate-uuid-9999",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: {
              available: true,
              url: "https://media.example.com/anchor.jpg"
            },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain("Frame Anchored");
    expect(html).toContain('data-testid="shot-plan-frame-anchor-notice"');
    expect(html).toContain('data-testid="shot-plan-frame-anchor-target"');
    expect(html).toContain("first_frame");
    expect(html).toContain('data-testid="shot-plan-frame-anchor-asset"');
    expect(html).toContain("anchor-candidate-uuid-9999");
    expect(html).toContain("Anchor source for declared frame-anchored route");

    // Approve button MUST be enabled for confirmed authoritative anchor
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).toBeNull();
  });

  it("marks stale shot plans and disables action buttons", () => {
    const stalePlan = createSampleShotPlan({
      specRevision: 1,
      isCurrentRevision: false
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[stalePlan]} currentSpecRevision={2} />
    );

    expect(html).toContain("Rev 1 (Stale)");
    expect(html).toContain("shot-plan-card-stale");

    // Both buttons disabled because plan is stale
    const selectBtnMatch = html.match(/data-testid="shot-plan-select-button"[^>]*disabled=""/);
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(selectBtnMatch).not.toBeNull();
    expect(approveBtnMatch).not.toBeNull();
  });

  it("indicates selected and approved plan status badges", () => {
    const selectedPlan = createSampleShotPlan({
      shotPlanId: "selected-plan-id",
      status: "draft"
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[selectedPlan]}
        selectedShotPlanId="selected-plan-id"
        currentSpecRevision={2}
      />
    );

    expect(html).toContain('data-testid="shot-plan-selected-badge"');
    expect(html).toContain("Selected Plan");
  });

  it("renders missing anchor error and disables approval when frame-anchored plan lacks anchor", () => {
    const invalidPlan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "none",
        anchorCandidateId: null
      },
      previs: {
        candidateId: "previs-candidate-should-not-be-inferred",
        media: {
          available: true,
          url: "https://media.example.com/previs-fallback.jpg"
        }
      }
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[invalidPlan]} currentSpecRevision={2} />
    );

    expect(html).toContain("Frame Anchored");
    expect(html).toContain('data-testid="shot-plan-frame-anchor-missing"');
    expect(html).toContain("Missing authoritative anchor");
    // Ensure no fallback inference to previs candidate or first_frame
    expect(html).not.toContain("previs-candidate-should-not-be-inferred");
    expect(html).not.toContain('data-testid="shot-plan-frame-anchor-target"');

    // Approve button MUST be disabled because frame anchor is invalid/missing
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when frame anchor target is unsupported", () => {
    const candidateHash = "b".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "last_frame",
        anchorCandidateId: "anchor-candidate-uuid-9999",
        anchorMediaHashSha256: candidateHash
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "anchor-candidate-uuid-9999",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("last_frame");
    expect(html).toContain("only &quot;first_frame&quot; is currently supported");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when candidate cannot be resolved", () => {
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "missing-candidate-uuid",
        anchorMediaHashSha256: "c".repeat(64)
      }
    });

    const html = renderToStaticMarkup(
      <ShotPlanPanel shotPlans={[plan]} currentSpecRevision={2} candidatesByRevision={[]} />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("missing-candidate-uuid");
    expect(html).toContain("was not found in candidate history");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when candidate revision is stale", () => {
    const candidateHash = "d".repeat(64);
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "stale-candidate-uuid",
        anchorMediaHashSha256: candidateHash
      }
    });

    const candidateGroups = [
      {
        specRevision: 1, // older revision
        candidates: [
          {
            candidateId: "stale-candidate-uuid",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 1,
            variantOrdinal: 1,
            contentHash: candidateHash,
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("does not match current scene revision");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });

  it("disables approval and shows invalid anchor state when candidate content hash mismatches", () => {
    const plan = createSampleShotPlan({
      routingMode: "frame_anchored",
      continuity: {
        persistentSubjectIds: [],
        frameAnchorTarget: "first_frame",
        anchorCandidateId: "hash-mismatch-candidate-uuid",
        anchorMediaHashSha256: "e".repeat(64)
      }
    });

    const candidateGroups = [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "hash-mismatch-candidate-uuid",
            sceneId: "22222222-2222-4222-8222-222222222222",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: "f".repeat(64), // mismatched hash!
            media: { available: true },
            createdAt: "2026-09-27T12:00:00.000Z"
          }
        ]
      }
    ];

    const html = renderToStaticMarkup(
      <ShotPlanPanel
        shotPlans={[plan]}
        currentSpecRevision={2}
        candidatesByRevision={candidateGroups}
      />
    );

    expect(html).toContain('data-testid="shot-plan-frame-anchor-invalid"');
    expect(html).toContain("Invalid authoritative anchor");
    expect(html).toContain("does not match ShotPlan declared anchorMediaHashSha256");
    const approveBtnMatch = html.match(/data-testid="shot-plan-approve-button"[^>]*disabled=""/);
    expect(approveBtnMatch).not.toBeNull();
  });
});
