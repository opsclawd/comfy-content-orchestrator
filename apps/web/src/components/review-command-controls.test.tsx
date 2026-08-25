import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewCommandControls } from "./review-command-controls.js";
import { type ReviewCommandState } from "./review-command-state.js";
import type { SceneReviewDetailReadModel } from "@cco/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn()
  })
}));

function createSampleDetail(
  overrides?: Partial<SceneReviewDetailReadModel>
): SceneReviewDetailReadModel {
  return {
    sceneId: "11111111-1111-4111-8111-111111111111",
    campaignId: "22222222-2222-4222-8222-222222222222",
    status: "director_review",
    specRevision: 2,
    configuration: {
      prompt: "Original cyberpunk prompt",
      referenceIds: ["ref-1", "ref-2"],
      engineProfileId: "engine-flux-schnell",
      durationMs: 4000,
      loraConfigurationId: "lora-base-1"
    },
    selectedCandidateId: "33333333-3333-4333-8333-333333333333",
    selectedCandidateRevision: 2,
    approval: undefined,
    candidatesByRevision: [],
    allowedActions: [
      "approve",
      "reject",
      "reroll",
      "prompt_edit",
      "reference_change",
      "engine_change",
      "duration_change",
      "lora_tune",
      "cancel"
    ],
    ...overrides
  };
}

describe("ReviewCommandControls Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders action buttons for each allowed action in idle state", () => {
    const detail = createSampleDetail({
      allowedActions: ["approve", "reroll", "prompt_edit", "cancel"]
    });

    const html = renderToStaticMarkup(<ReviewCommandControls detail={detail} />);

    expect(html).toContain('data-testid="review-command-controls"');
    expect(html).toContain('data-testid="action-button-approve"');
    expect(html).toContain('data-testid="action-button-reroll"');
    expect(html).toContain('data-testid="action-button-prompt_edit"');
    expect(html).toContain('data-testid="action-button-cancel"');
    expect(html).not.toContain('data-testid="action-button-reject"');
    expect(html).not.toContain('data-testid="review-draft-panel"');
    expect(html).not.toContain('data-testid="review-command-dialog"');
  });

  it("renders disabled state on action buttons when commands are disabled", () => {
    const detail = createSampleDetail({
      allowedActions: ["approve", "reroll"]
    });

    const html = renderToStaticMarkup(<ReviewCommandControls detail={detail} disabled={true} />);

    expect(html).toContain('data-testid="action-button-approve"');
    expect(html).toContain('disabled=""');
  });

  it("renders confirmation dialog with aria-modal and role dialog", () => {
    const detail = createSampleDetail({ specRevision: 2 });
    const confirmingState: ReviewCommandState = {
      phase: "confirming",
      detail,
      stagedAction: {
        action: "approve",
        payload: {},
        displayLabel: "Approve Scene",
        directorNotes: "LGTM for production"
      }
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={confirmingState} />
    );

    expect(html).toContain('data-testid="confirmation-dialog-backdrop"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('class="review-command-dialog"');
    expect(html).toContain('data-testid="review-command-dialog"');

    // Dialog contents
    expect(html).toContain("11111111-1111-4111-8111-111111111111");
    expect(html).toContain("Revision 2");
    expect(html).toContain("approve");
    expect(html).toContain("LGTM for production");

    // Buttons
    expect(html).toContain('data-testid="confirm-command-button"');
    expect(html).toContain('data-testid="cancel-confirmation-button"');
    expect(html).toContain("Confirm &amp; Submit");
  });

  it("submits the displayed revision and no authority fields", () => {
    const detail = createSampleDetail({ specRevision: 5 });
    const actionId = "99999999-9999-4999-8999-999999999999";
    const submittingState: ReviewCommandState = {
      phase: "submitting",
      detail,
      frozenIntent: {
        command: {
          actionId,
          sceneId: detail.sceneId,
          expectedSpecRevision: 5,
          action: "approve",
          payload: {},
          directorNotes: "Approved by director"
        },
        displayLabel: "Approve Scene"
      }
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={submittingState} />
    );

    // Submitting state disables confirm button and displays submitting label
    expect(html).toContain('data-testid="confirm-command-button"');
    expect(html).toContain("Submitting...");
    expect(html).toContain('disabled=""');

    // Invariant: command in state has expectedSpecRevision matching detail and no authority fields
    expect(submittingState.frozenIntent.command.expectedSpecRevision).toBe(5);
    expect(submittingState.frozenIntent.command.sceneId).toBe(detail.sceneId);
    expect(submittingState.frozenIntent.command).not.toHaveProperty("reviewerName");
    expect(submittingState.frozenIntent.command).not.toHaveProperty("occurredAt");
  });

  it("not found directs the user back to the campaign", () => {
    const detail = createSampleDetail({
      campaignId: "camp-404-uuid",
      sceneId: "scene-404-uuid"
    });

    const notFoundState: ReviewCommandState = {
      phase: "definitive-error",
      detail,
      statusCode: 404,
      error: {
        code: "NOT_FOUND",
        message: "Scene 'scene-404-uuid' was not found on server."
      },
      displayLabel: "Approve Scene"
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={notFoundState} />
    );

    expect(html).toContain('data-testid="definitive-error-banner"');
    expect(html).toContain("NOT_FOUND");
    expect(html).toContain("Scene &#x27;scene-404-uuid&#x27; was not found");

    // Invariant 14: 404 error displays link back to campaign
    expect(html).toContain('data-testid="back-to-campaign-link"');
    expect(html).toContain('href="/campaigns/camp-404-uuid"');
    expect(html).toContain("Back to Campaign");
  });

  it("stale conflict displays concurrent revision warning and allows loading latest revision", () => {
    const detail = createSampleDetail({ specRevision: 2 });

    const staleState: ReviewCommandState = {
      phase: "stale-conflict",
      detail,
      expectedRevision: 2,
      currentRevision: 3,
      rejectedAction: "approve",
      displayLabel: "Approve Scene",
      message: "Scene was modified by another operator"
    };

    const html = renderToStaticMarkup(<ReviewCommandControls detail={detail} state={staleState} />);

    expect(html).toContain('data-testid="stale-conflict-banner"');
    expect(html).toContain("Concurrent Spec Revision Conflict");
    expect(html).toContain("expected revision <strong>2</strong>");
    expect(html).toContain("revision <strong>3</strong>");
    expect(html).toContain("Scene was modified by another operator");
    expect(html).toContain('data-testid="load-stale-revision-button"');
    expect(html).toContain("Load Latest Revision");
  });

  it("domain rejection preserves displayed state and permits dismissal", () => {
    const detail = createSampleDetail({ specRevision: 2, status: "draft_pending" });

    const definitiveState: ReviewCommandState = {
      phase: "definitive-error",
      detail,
      statusCode: 422,
      error: {
        code: "INVALID_DOMAIN_TRANSITION",
        message: "Cannot perform 'approve' on scene in 'draft_pending' status"
      },
      displayLabel: "Approve Scene"
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={definitiveState} />
    );

    expect(html).toContain('data-testid="definitive-error-banner"');
    expect(html).toContain("INVALID_DOMAIN_TRANSITION");
    expect(html).toContain("Cannot perform &#x27;approve&#x27;");
    expect(html).toContain('data-testid="dismiss-error-button"');
    expect(html).toContain("Dismiss");
  });

  it("indeterminate error exposes retry button that resubmits same action ID", () => {
    const detail = createSampleDetail({ specRevision: 2 });
    const actionId = "frozen-action-uuid-1234";

    const errorState: ReviewCommandState = {
      phase: "indeterminate-error",
      detail,
      frozenIntent: {
        command: {
          actionId,
          sceneId: detail.sceneId,
          expectedSpecRevision: 2,
          action: "prompt_edit",
          payload: { prompt: "New prompt" }
        },
        displayLabel: "Edit Prompt"
      },
      message: "Gateway Timeout (504)",
      statusCode: 504
    };

    const html = renderToStaticMarkup(<ReviewCommandControls detail={detail} state={errorState} />);

    expect(html).toContain('data-testid="indeterminate-error-banner"');
    expect(html).toContain("Communication / Server Error");
    expect(html).toContain("Gateway Timeout (504)");
    expect(html).toContain('data-testid="retry-command-button"');
    expect(html).toContain('data-testid="dismiss-error-button"');
    expect(html).toContain("Retry Action");
  });

  it("drafting phase renders edit form for prompt_edit", () => {
    const detail = createSampleDetail();

    const draftingState: ReviewCommandState = {
      phase: "drafting",
      detail,
      draft: {
        action: "prompt_edit",
        payload: { prompt: "Updated cinematic shot" },
        displayLabel: "Edit Prompt"
      }
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={draftingState} />
    );

    expect(html).toContain('data-testid="review-draft-panel"');
    expect(html).toContain('data-testid="review-draft-form"');
    expect(html).toContain('data-testid="draft-prompt-input"');
    expect(html).toContain('data-testid="draft-director-notes-input"');
    expect(html).toContain('data-testid="stage-draft-button"');
    expect(html).toContain('data-testid="cancel-draft-button"');
    expect(html).toContain("Review &amp; Stage Action");
  });

  it("drafting phase renders edit form for reference_change, engine_change, duration_change, lora_tune", () => {
    const detail = createSampleDetail();

    // reference_change
    const refDraftHtml = renderToStaticMarkup(
      <ReviewCommandControls
        detail={detail}
        state={{
          phase: "drafting",
          detail,
          draft: {
            action: "reference_change",
            payload: { referenceIds: ["ref-a", "ref-b"] },
            displayLabel: "Change References"
          }
        }}
      />
    );
    expect(refDraftHtml).toContain('data-testid="draft-references-input"');

    // engine_change
    const engineDraftHtml = renderToStaticMarkup(
      <ReviewCommandControls
        detail={detail}
        state={{
          phase: "drafting",
          detail,
          draft: {
            action: "engine_change",
            payload: { engineProfileId: "engine-flux-dev" },
            displayLabel: "Change Engine"
          }
        }}
      />
    );
    expect(engineDraftHtml).toContain('data-testid="draft-engine-input"');

    // duration_change
    const durationDraftHtml = renderToStaticMarkup(
      <ReviewCommandControls
        detail={detail}
        state={{
          phase: "drafting",
          detail,
          draft: {
            action: "duration_change",
            payload: { durationMs: 6000 },
            displayLabel: "Change Duration"
          }
        }}
      />
    );
    expect(durationDraftHtml).toContain('data-testid="draft-duration-input"');

    // lora_tune
    const loraDraftHtml = renderToStaticMarkup(
      <ReviewCommandControls
        detail={detail}
        state={{
          phase: "drafting",
          detail,
          draft: {
            action: "lora_tune",
            payload: { loraConfigurationId: "lora-test" },
            displayLabel: "Tune LoRA"
          }
        }}
      />
    );
    expect(loraDraftHtml).toContain('data-testid="draft-lora-input"');
  });

  it("syncing state indicates generating candidates for reroll", () => {
    const detail = createSampleDetail({
      status: "generating_candidates"
    });

    const syncingState: ReviewCommandState = {
      phase: "succeeded-syncing",
      detail,
      lastResponse: {
        sceneId: detail.sceneId,
        status: "generating_candidates",
        specRevision: 2,
        isIdempotentReplay: false
      }
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={syncingState} />
    );

    expect(html).toContain('data-testid="syncing-indicator"');
    expect(html).toContain("Generating candidates...");
  });

  it("syncing state renders refresh error and retry refresh button", () => {
    const detail = createSampleDetail();

    const failedSyncState: ReviewCommandState = {
      phase: "succeeded-syncing",
      detail,
      lastResponse: {
        sceneId: detail.sceneId,
        status: "director_review",
        specRevision: 3,
        isIdempotentReplay: false
      },
      refreshError: "Network connection dropped during sync"
    };

    const html = renderToStaticMarkup(
      <ReviewCommandControls detail={detail} state={failedSyncState} />
    );

    expect(html).toContain('data-testid="syncing-indicator"');
    expect(html).toContain('data-testid="refresh-error"');
    expect(html).toContain("Network connection dropped during sync");
    expect(html).toContain("Retry Refresh");
  });
});
