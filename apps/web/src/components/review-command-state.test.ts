import { describe, expect, it } from "vitest";
import type {
  ReviewCommandResponse,
  ReviewErrorResponse,
  SceneReviewDetailReadModel
} from "@cco/contracts";
import {
  areCommandsDisabled,
  createInitialState,
  createReviewCommand,
  mergeCompactResponse,
  transitionReviewCommandState,
  type ConfirmingState,
  type DefinitiveErrorState,
  type DraftingState,
  type IdleState,
  type IndeterminateErrorState,
  type ReviewCommandDraft,
  type ReviewCommandEffect,
  type StaleConflictState,
  type SubmittingState,
  type SucceededSyncingState
} from "./review-command-state.js";

function createTestDetail(
  overrides?: Partial<SceneReviewDetailReadModel>
): SceneReviewDetailReadModel {
  return {
    sceneId: "11111111-1111-4111-8111-111111111111",
    campaignId: "22222222-2222-4222-8222-222222222222",
    status: "director_review",
    specRevision: 2,
    configuration: {
      prompt: "A cinematic shot of a cyberpunk city at night",
      referenceIds: ["ref-alpha", "ref-beta"],
      engineProfileId: "engine-flux-schnell",
      durationMs: 4000,
      loraConfigurationId: null
    },
    selectedCandidateId: "33333333-3333-4333-8333-333333333333",
    selectedCandidateRevision: 2,
    approval: {
      revision: 2,
      approvedBy: "director-1",
      approvedAt: "2026-08-25T10:00:00.000Z"
    },
    candidatesByRevision: [
      {
        specRevision: 2,
        candidates: [
          {
            candidateId: "33333333-3333-4333-8333-333333333333",
            sceneId: "11111111-1111-4111-8111-111111111111",
            specRevision: 2,
            variantOrdinal: 1,
            contentHash: "hash-alpha-123456",
            media: { available: true, url: "/media/cand-1.mp4" },
            createdAt: "2026-08-25T10:05:00.000Z"
          }
        ]
      }
    ],
    allowedActions: [
      "candidate_select",
      "approve",
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

describe("review command state machine behavioral invariants", () => {
  it("requesting confirmation stages draft into confirming phase", () => {
    const detail = createTestDetail();
    const initialState = createInitialState(detail);

    const draft: ReviewCommandDraft = {
      action: "prompt_edit",
      payload: { prompt: "Updated prompt with more volumetric fog" },
      displayLabel: "Edit prompt",
      directorNotes: "Enhance atmospheric depth"
    };

    // Staging from idle
    const resultFromIdle = transitionReviewCommandState(initialState, {
      type: "REQUEST_CONFIRMATION",
      stagedAction: draft
    });

    expect(resultFromIdle.state.phase).toBe("confirming");
    const confirmingState = resultFromIdle.state as ConfirmingState;
    expect(confirmingState.stagedAction).toEqual(draft);
    expect(resultFromIdle.effect).toEqual<ReviewCommandEffect>({ type: "none" });

    // Staging from drafting
    const draftingState: DraftingState = {
      phase: "drafting",
      detail,
      draft
    };
    const resultFromDrafting = transitionReviewCommandState(draftingState, {
      type: "REQUEST_CONFIRMATION"
    });

    expect(resultFromDrafting.state.phase).toBe("confirming");
    const confirmingFromDraft = resultFromDrafting.state as ConfirmingState;
    expect(confirmingFromDraft.stagedAction).toEqual(draft);
    expect(confirmingFromDraft.draft).toEqual(draft);
    expect(resultFromDrafting.effect).toEqual<ReviewCommandEffect>({ type: "none" });
  });

  it("cancelling confirmation returns to drafting", () => {
    const detail = createTestDetail();
    const draft: ReviewCommandDraft = {
      action: "duration_change",
      payload: { durationMs: 6000 },
      displayLabel: "Change duration to 6.0s",
      directorNotes: "Extend for pacing"
    };

    const confirmingState: ConfirmingState = {
      phase: "confirming",
      detail,
      stagedAction: draft,
      draft
    };

    const result = transitionReviewCommandState(confirmingState, {
      type: "CANCEL_CONFIRMATION"
    });

    expect(result.state.phase).toBe("drafting");
    const draftingState = result.state as DraftingState;
    expect(draftingState.draft).toEqual(draft);
    expect(draftingState.detail).toEqual(detail);
    expect(result.effect).toEqual<ReviewCommandEffect>({ type: "none" });
  });

  it("confirm freezes the displayed revision and one action ID", () => {
    const detail = createTestDetail({ specRevision: 4 });
    const draft: ReviewCommandDraft = {
      action: "approve",
      payload: {},
      displayLabel: "Approve revision 4"
    };

    const confirmingState: ConfirmingState = {
      phase: "confirming",
      detail,
      stagedAction: draft
    };

    const actionId = "99999999-9999-4999-8999-999999999999";
    const result = transitionReviewCommandState(confirmingState, {
      type: "CONFIRM",
      actionId
    });

    expect(result.state.phase).toBe("submitting");
    const submittingState = result.state as SubmittingState;
    expect(submittingState.frozenIntent).toEqual({
      command: {
        actionId,
        sceneId: detail.sceneId,
        expectedSpecRevision: 4,
        action: "approve",
        payload: {}
      },
      displayLabel: "Approve revision 4"
    });

    expect(result.effect).toEqual<ReviewCommandEffect>({
      type: "submit",
      command: submittingState.frozenIntent.command
    });
  });

  it("pending submission ignores a second local submit", () => {
    const detail = createTestDetail({ specRevision: 2 });
    const originalActionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const originalIntent = {
      command: createReviewCommand(
        detail,
        { action: "reroll", payload: {}, displayLabel: "Regenerate candidates" },
        originalActionId
      ),
      displayLabel: "Regenerate candidates"
    };

    const submittingState: SubmittingState = {
      phase: "submitting",
      detail,
      frozenIntent: originalIntent
    };

    // Attempting a second confirm event while already submitting
    const duplicateSubmit = transitionReviewCommandState(submittingState, {
      type: "CONFIRM",
      actionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    });

    expect(duplicateSubmit.state.phase).toBe("submitting");
    const stillSubmitting = duplicateSubmit.state as SubmittingState;
    expect(stillSubmitting.frozenIntent).toBe(originalIntent);
    expect(duplicateSubmit.effect).toEqual<ReviewCommandEffect>({ type: "none" });
  });

  it("indeterminate failure retains the exact frozen intent", () => {
    const detail = createTestDetail({ specRevision: 3 });
    const actionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const frozenIntent = {
      command: createReviewCommand(
        detail,
        {
          action: "prompt_edit",
          payload: { prompt: "Night neon market street" },
          displayLabel: "Edit prompt",
          directorNotes: "Fix lighting"
        },
        actionId
      ),
      displayLabel: "Edit prompt"
    };

    const submittingState: SubmittingState = {
      phase: "submitting",
      detail,
      frozenIntent
    };

    const failureResult = transitionReviewCommandState(submittingState, {
      type: "SUBMIT_INDETERMINATE_ERROR",
      message: "Network connection lost during request",
      statusCode: undefined
    });

    expect(failureResult.state.phase).toBe("indeterminate-error");
    const errorState = failureResult.state as IndeterminateErrorState;
    expect(errorState.frozenIntent).toEqual(frozenIntent);
    expect(errorState.message).toBe("Network connection lost during request");
    expect(failureResult.effect).toEqual<ReviewCommandEffect>({ type: "none" });
  });

  it("retry resubmits the identical frozen command", () => {
    const detail = createTestDetail({ specRevision: 3 });
    const actionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const frozenIntent = {
      command: createReviewCommand(
        detail,
        {
          action: "reference_change",
          payload: { referenceIds: ["ref-1", "ref-2"] },
          displayLabel: "Update references"
        },
        actionId
      ),
      displayLabel: "Update references"
    };

    const errorState: IndeterminateErrorState = {
      phase: "indeterminate-error",
      detail,
      frozenIntent,
      message: "Gateway timeout 504",
      statusCode: 504
    };

    const retryResult = transitionReviewCommandState(errorState, {
      type: "RETRY"
    });

    expect(retryResult.state.phase).toBe("submitting");
    const submittingState = retryResult.state as SubmittingState;
    expect(submittingState.frozenIntent).toEqual(frozenIntent);
    expect(submittingState.frozenIntent.command.actionId).toBe(actionId);
    expect(retryResult.effect).toEqual<ReviewCommandEffect>({
      type: "submit",
      command: frozenIntent.command
    });
  });

  it("definitive rejection never exposes same-intent retry", () => {
    const detail = createTestDetail({ specRevision: 2 });
    const definitiveError: ReviewErrorResponse = {
      code: "INVALID_DOMAIN_TRANSITION",
      message: "Cannot approve scene in queued status"
    };

    const definitiveState: DefinitiveErrorState = {
      phase: "definitive-error",
      detail,
      statusCode: 422,
      error: definitiveError,
      displayLabel: "Approve revision 2"
    };

    // Retry should be rejected/ignored
    const retryResult = transitionReviewCommandState(definitiveState, {
      type: "RETRY"
    });
    expect(retryResult.state.phase).toBe("definitive-error");
    expect(retryResult.effect).toEqual<ReviewCommandEffect>({ type: "none" });

    // Dismissing error abandons intent and returns to idle
    const dismissResult = transitionReviewCommandState(definitiveState, {
      type: "DISMISS_ERROR"
    });
    expect(dismissResult.state.phase).toBe("idle");
    expect(dismissResult.effect).toEqual<ReviewCommandEffect>({ type: "none" });
  });

  it("stale conflict freezes both revisions and performs no refresh", () => {
    const detail = createTestDetail({ specRevision: 2 });
    const actionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const frozenIntent = {
      command: createReviewCommand(
        detail,
        { action: "approve", payload: {}, displayLabel: "Approve revision 2" },
        actionId
      ),
      displayLabel: "Approve revision 2"
    };

    const submittingState: SubmittingState = {
      phase: "submitting",
      detail,
      frozenIntent
    };

    const staleResult = transitionReviewCommandState(submittingState, {
      type: "SUBMIT_STALE_CONFLICT",
      expectedRevision: 2,
      currentRevision: 3,
      message: "Scene spec has advanced to revision 3"
    });

    expect(staleResult.state.phase).toBe("stale-conflict");
    const staleState = staleResult.state as StaleConflictState;
    expect(staleState.expectedRevision).toBe(2);
    expect(staleState.currentRevision).toBe(3);
    expect(staleState.rejectedAction).toBe("approve");
    expect(staleState.displayLabel).toBe("Approve revision 2");
    expect(staleState.detail).toEqual(detail);
    expect(staleResult.effect).toEqual<ReviewCommandEffect>({ type: "none" });
  });

  it("loading a stale revision clears the decision before refresh", () => {
    const detail = createTestDetail({ specRevision: 2 });
    const staleState: StaleConflictState = {
      phase: "stale-conflict",
      detail,
      expectedRevision: 2,
      currentRevision: 3,
      rejectedAction: "approve",
      displayLabel: "Approve revision 2"
    };

    const loadResult = transitionReviewCommandState(staleState, {
      type: "LOAD_STALE_REVISION"
    });

    expect(loadResult.state.phase).toBe("idle");
    expect(loadResult.effect).toEqual<ReviewCommandEffect>({
      type: "refresh",
      sceneId: detail.sceneId
    });
  });

  it("success merges only compact authoritative fields and requests refresh", () => {
    const detail = createTestDetail({
      specRevision: 2,
      status: "director_review",
      selectedCandidateId: "33333333-3333-4333-8333-333333333333",
      selectedCandidateRevision: 2,
      approval: {
        revision: 2,
        approvedBy: "director-1",
        approvedAt: "2026-08-25T10:00:00.000Z"
      }
    });

    const actionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const frozenIntent = {
      command: createReviewCommand(
        detail,
        {
          action: "prompt_edit",
          payload: { prompt: "New prompt text" },
          displayLabel: "Edit prompt"
        },
        actionId
      ),
      displayLabel: "Edit prompt"
    };

    const submittingState: SubmittingState = {
      phase: "submitting",
      detail,
      frozenIntent
    };

    // Server returns compact response: revision incremented to 3, status draft_pending,
    // selection and approval are omitted (so they should be cleared).
    const successResponse: ReviewCommandResponse = {
      sceneId: detail.sceneId,
      status: "draft_pending",
      specRevision: 3,
      isIdempotentReplay: false
    };

    const result = transitionReviewCommandState(submittingState, {
      type: "SUBMIT_SUCCESS",
      response: successResponse
    });

    expect(result.state.phase).toBe("succeeded-syncing");
    const syncingState = result.state as SucceededSyncingState;
    expect(syncingState.detail.specRevision).toBe(3);
    expect(syncingState.detail.status).toBe("draft_pending");
    expect(syncingState.detail.selectedCandidateId).toBeUndefined();
    expect(syncingState.detail.selectedCandidateRevision).toBeUndefined();
    expect(syncingState.detail.approval).toBeUndefined();
    // Configuration and candidatesByRevision remain unchanged from local state before full refresh
    expect(syncingState.detail.configuration).toEqual(detail.configuration);
    expect(syncingState.detail.candidatesByRevision).toEqual(detail.candidatesByRevision);
    expect(syncingState.detail.allowedActions).toEqual(detail.allowedActions);
    expect(syncingState.lastResponse).toEqual(successResponse);
    expect(areCommandsDisabled(result.state)).toBe(true);

    expect(result.effect).toEqual<ReviewCommandEffect>({
      type: "refresh",
      sceneId: detail.sceneId
    });
  });

  it("reroll success immediately shows generating candidates without polling", () => {
    const detail = createTestDetail({
      specRevision: 2,
      status: "director_review"
    });

    const actionId = "12121212-1212-4212-8212-121212121212";
    const frozenIntent = {
      command: createReviewCommand(
        detail,
        { action: "reroll", payload: {}, displayLabel: "Regenerate storyboard candidates" },
        actionId
      ),
      displayLabel: "Regenerate storyboard candidates"
    };

    const submittingState: SubmittingState = {
      phase: "submitting",
      detail,
      frozenIntent
    };

    const rerollResponse: ReviewCommandResponse = {
      sceneId: detail.sceneId,
      status: "generating_candidates",
      specRevision: 2,
      isIdempotentReplay: false
    };

    const result = transitionReviewCommandState(submittingState, {
      type: "SUBMIT_SUCCESS",
      response: rerollResponse
    });

    expect(result.state.phase).toBe("succeeded-syncing");
    const syncingState = result.state as SucceededSyncingState;
    expect(syncingState.detail.status).toBe("generating_candidates");
    expect(syncingState.detail.specRevision).toBe(2);

    // Only refresh effect emitted, never polling or timer
    expect(result.effect).toEqual<ReviewCommandEffect>({
      type: "refresh",
      sceneId: detail.sceneId
    });
  });

  it("refresh completion replaces the complete detail", () => {
    const detail = createTestDetail({
      specRevision: 2,
      status: "draft_pending"
    });

    const syncingState: SucceededSyncingState = {
      phase: "succeeded-syncing",
      detail,
      lastResponse: {
        sceneId: detail.sceneId,
        status: "draft_pending",
        specRevision: 2,
        isIdempotentReplay: false
      }
    };

    const updatedDetail: SceneReviewDetailReadModel = {
      ...detail,
      specRevision: 3,
      status: "director_review",
      configuration: {
        prompt: "Updated prompt from server",
        referenceIds: ["ref-gamma"],
        engineProfileId: "engine-flux-schnell",
        durationMs: 5000,
        loraConfigurationId: "lora-v2"
      },
      allowedActions: ["approve", "reject", "reroll", "candidate_select"]
    };

    // Case 1: Refresh succeeds
    const refreshSuccessResult = transitionReviewCommandState(syncingState, {
      type: "REFRESH_SUCCESS",
      detail: updatedDetail
    });

    expect(refreshSuccessResult.state.phase).toBe("idle");
    const idleState = refreshSuccessResult.state as IdleState;
    expect(idleState.detail).toEqual(updatedDetail);
    expect(idleState.detail.configuration.prompt).toBe("Updated prompt from server");
    expect(idleState.detail.allowedActions).toEqual([
      "approve",
      "reject",
      "reroll",
      "candidate_select"
    ]);
    expect(refreshSuccessResult.effect).toEqual<ReviewCommandEffect>({ type: "none" });

    // Case 2: Refresh fails
    const refreshFailureResult = transitionReviewCommandState(syncingState, {
      type: "REFRESH_FAILURE",
      error: "Failed to fetch updated scene detail"
    });

    expect(refreshFailureResult.state.phase).toBe("succeeded-syncing");
    const failedSyncState = refreshFailureResult.state as SucceededSyncingState;
    expect(failedSyncState.refreshError).toBe("Failed to fetch updated scene detail");
    expect(failedSyncState.detail).toEqual(detail);
    expect(areCommandsDisabled(refreshFailureResult.state)).toBe(true);

    // Manual refresh request from failed sync state emits refresh effect
    const manualRefresh = transitionReviewCommandState(failedSyncState, {
      type: "REQUEST_REFRESH"
    });
    expect(manualRefresh.effect).toEqual<ReviewCommandEffect>({
      type: "refresh",
      sceneId: detail.sceneId
    });
  });
});

describe("createReviewCommand and all ten Phase 1 review actions", () => {
  const detail = createTestDetail({ specRevision: 5 });
  const actionId = "77777777-7777-4777-8777-777777777777";
  const candidateId = "88888888-8888-4888-8888-888888888888";

  it("creates candidate_select command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "candidate_select",
        payload: { candidateId },
        displayLabel: "Select candidate 1"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "candidate_select",
      payload: { candidateId }
    });
  });

  it("creates approve command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "approve",
        payload: {},
        displayLabel: "Approve revision 5"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "approve",
      payload: {}
    });
  });

  it("creates reroll command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "reroll",
        payload: {},
        displayLabel: "Regenerate storyboard candidates"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "reroll",
      payload: {}
    });
  });

  it("creates prompt_edit command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "prompt_edit",
        payload: { prompt: "Epic sunset scene" },
        displayLabel: "Edit prompt"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "prompt_edit",
      payload: { prompt: "Epic sunset scene" }
    });
  });

  it("creates reference_change command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "reference_change",
        payload: { referenceIds: ["ref-x", "ref-y"] },
        displayLabel: "Update references"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "reference_change",
      payload: { referenceIds: ["ref-x", "ref-y"] }
    });
  });

  it("creates engine_change command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "engine_change",
        payload: { engineProfileId: "engine-flux-dev" },
        displayLabel: "Change engine to FLUX Dev"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "engine_change",
      payload: { engineProfileId: "engine-flux-dev" }
    });
  });

  it("creates duration_change command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "duration_change",
        payload: { durationMs: 8000 },
        displayLabel: "Change duration to 8s"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "duration_change",
      payload: { durationMs: 8000 }
    });
  });

  it("creates lora_tune command with null configuration", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "lora_tune",
        payload: { loraConfigurationId: null },
        displayLabel: "Remove LoRA"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "lora_tune",
      payload: { loraConfigurationId: null }
    });
  });

  it("creates cancel command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "cancel",
        payload: {},
        displayLabel: "Cancel scene"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "cancel",
      payload: {}
    });
  });

  it("creates reject command", () => {
    const command = createReviewCommand(
      detail,
      {
        action: "reject",
        payload: {},
        displayLabel: "Reject QA result"
      },
      actionId
    );
    expect(command).toEqual({
      actionId,
      sceneId: detail.sceneId,
      expectedSpecRevision: 5,
      action: "reject",
      payload: {}
    });
  });

  it("throws validation error for malformed action payload", () => {
    expect(() =>
      createReviewCommand(
        detail,
        {
          action: "duration_change",
          payload: { durationMs: -100 },
          displayLabel: "Invalid duration"
        },
        actionId
      )
    ).toThrow();
  });
});

describe("state machine helper functions", () => {
  it("areCommandsDisabled returns true only for submitting, succeeded-syncing, and stale-conflict", () => {
    const detail = createTestDetail();
    expect(areCommandsDisabled({ phase: "idle", detail })).toBe(false);
    expect(
      areCommandsDisabled({
        phase: "drafting",
        detail,
        draft: { action: "approve", displayLabel: "Approve" }
      })
    ).toBe(false);
    expect(
      areCommandsDisabled({
        phase: "confirming",
        detail,
        stagedAction: { action: "approve", displayLabel: "Approve" }
      })
    ).toBe(false);
    expect(
      areCommandsDisabled({
        phase: "submitting",
        detail,
        frozenIntent: {
          command: createReviewCommand(
            detail,
            { action: "approve", displayLabel: "Approve" },
            "99999999-9999-4999-8999-999999999999"
          ),
          displayLabel: "Approve"
        }
      })
    ).toBe(true);
    expect(
      areCommandsDisabled({
        phase: "succeeded-syncing",
        detail,
        lastResponse: {
          sceneId: detail.sceneId,
          status: "approved",
          specRevision: 3,
          isIdempotentReplay: false
        }
      })
    ).toBe(true);
    expect(
      areCommandsDisabled({
        phase: "stale-conflict",
        detail,
        expectedRevision: 2,
        currentRevision: 3,
        rejectedAction: "approve",
        displayLabel: "Approve"
      })
    ).toBe(true);
    expect(
      areCommandsDisabled({
        phase: "definitive-error",
        detail,
        statusCode: 422,
        error: { code: "INVALID_DOMAIN_TRANSITION", message: "Error" },
        displayLabel: "Approve"
      })
    ).toBe(false);
    expect(
      areCommandsDisabled({
        phase: "indeterminate-error",
        detail,
        frozenIntent: {
          command: createReviewCommand(
            detail,
            { action: "approve", displayLabel: "Approve" },
            "99999999-9999-4999-8999-999999999999"
          ),
          displayLabel: "Approve"
        },
        message: "Error"
      })
    ).toBe(false);
  });

  it("mergeCompactResponse preserves selection when returned in response", () => {
    const detail = createTestDetail({ specRevision: 2, selectedCandidateId: undefined });
    const newCandidateId = "44444444-4444-4444-8444-444444444444";
    const merged = mergeCompactResponse(detail, {
      sceneId: detail.sceneId,
      status: "director_review",
      specRevision: 2,
      selectedCandidateId: newCandidateId,
      isIdempotentReplay: false
    });

    expect(merged.selectedCandidateId).toBe(newCandidateId);
    expect(merged.selectedCandidateRevision).toBe(2);
  });
});
