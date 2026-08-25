"use client";

import React, { useId, useState, useEffect, useLayoutEffect, useRef, useReducer } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  ReviewAction,
  ReviewCommand,
  ReviewCommandResponse,
  ReviewErrorResponse,
  SceneConfiguration,
  SceneReviewDetailReadModel
} from "@cco/contracts";
import {
  areCommandsDisabled,
  createInitialState,
  mergeCompactResponse,
  transitionReviewCommandState,
  type ReviewCommandDraft,
  type ReviewCommandEvent,
  type ReviewCommandState
} from "./review-command-state";
import { formatReviewAction } from "./format-review-value";
import { ApiClientError, ReviewCommandApiError } from "../api/client";

export interface ReviewCommandControlsProps {
  detail: SceneReviewDetailReadModel;
  state?: ReviewCommandState | undefined;
  dispatch?: ((event: ReviewCommandEvent) => void) | undefined;
  onDetailChange?: ((detail: SceneReviewDetailReadModel) => void) | undefined;
  submitCommand?: ((command: ReviewCommand) => Promise<ReviewCommandResponse>) | undefined;
  disabled?: boolean | undefined;
}

function getInitialDraftPayload(
  action: ReviewAction,
  config: SceneConfiguration
): Record<string, unknown> {
  switch (action) {
    case "prompt_edit":
      return { prompt: config.prompt };
    case "reference_change":
      return { referenceIds: [...config.referenceIds] };
    case "engine_change":
      return { engineProfileId: config.engineProfileId };
    case "duration_change":
      return { durationMs: config.durationMs };
    case "lora_tune":
      return { loraConfigurationId: config.loraConfigurationId ?? null };
    default:
      return {};
  }
}

export function ReviewCommandControls({
  detail,
  state: controlledState,
  dispatch: controlledDispatch,
  onDetailChange,
  submitCommand,
  disabled: controlledDisabled
}: ReviewCommandControlsProps) {
  const router = useRouter();
  const [internalState, internalDispatch] = useReducer(
    (prevState: ReviewCommandState, event: ReviewCommandEvent) =>
      transitionReviewCommandState(prevState, event).state,
    detail,
    createInitialState
  );

  const state = controlledState ?? internalState;
  const dispatch = controlledDispatch ?? internalDispatch;
  const disabled = controlledDisabled ?? areCommandsDisabled(state);

  const onDetailChangeRef = useRef(onDetailChange);
  const submitCommandRef = useRef(submitCommand);
  const routerRef = useRef(router);
  const dispatchRef = useRef(dispatch);
  const isSubmitting = state.phase === "submitting";

  useLayoutEffect(() => {
    onDetailChangeRef.current = onDetailChange;
    submitCommandRef.current = submitCommand;
    routerRef.current = router;
    dispatchRef.current = dispatch;
  });

  // Staging action ID ref to ensure multiple clicks or retries use the exact same ID
  const stagedActionIdRef = useRef<string>(crypto.randomUUID());

  // Form draft state for editing action parameters
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftReferences, setDraftReferences] = useState("");
  const [draftEngine, setDraftEngine] = useState("");
  const [draftDuration, setDraftDuration] = useState("");
  const [draftLora, setDraftLora] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  const promptInputId = useId();
  const refInputId = useId();
  const engineInputId = useId();
  const durationInputId = useId();
  const loraInputId = useId();
  const notesInputId = useId();

  // Reset form inputs whenever draft changes
  useEffect(() => {
    if (state.phase === "drafting") {
      const payload = state.draft.payload ?? {};
      setDraftPrompt(typeof payload.prompt === "string" ? payload.prompt : "");
      setDraftReferences(
        Array.isArray(payload.referenceIds) ? (payload.referenceIds as string[]).join(", ") : ""
      );
      setDraftEngine(typeof payload.engineProfileId === "string" ? payload.engineProfileId : "");
      setDraftDuration(typeof payload.durationMs === "number" ? String(payload.durationMs) : "");
      setDraftLora(
        typeof payload.loraConfigurationId === "string" ? payload.loraConfigurationId : ""
      );
      setDraftNotes(state.draft.directorNotes ?? "");
    }
  }, [state.phase, state.phase === "drafting" ? state.draft : undefined]);

  // Synchronize internal state with detail prop changes
  const prevDetailRef = useRef(detail);
  useEffect(() => {
    if (prevDetailRef.current !== detail) {
      prevDetailRef.current = detail;
      if (!controlledState) {
        dispatchRef.current({ type: "REFRESH_SUCCESS", detail });
      }
    }
  }, [detail, controlledState]);

  // Handle command submission side effects
  const submittedActionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.phase !== "submitting") {
      submittedActionIdRef.current = null;
      return;
    }

    const command = state.frozenIntent.command;
    if (submittedActionIdRef.current === command.actionId) {
      return;
    }
    submittedActionIdRef.current = command.actionId;

    let isCancelled = false;

    async function executeSubmission() {
      try {
        const customSubmit = submitCommandRef.current;
        let response: ReviewCommandResponse;

        if (customSubmit) {
          response = await customSubmit(command);
        } else {
          const res = await fetch(
            `/api/scenes/${encodeURIComponent(command.sceneId)}/review-command`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify(command)
            }
          );

          if (res.ok) {
            response = (await res.json()) as ReviewCommandResponse;
          } else {
            let errorJson: unknown;
            try {
              errorJson = await res.json();
            } catch {
              throw new ApiClientError(
                `Control API returned HTTP ${res.status}: ${res.statusText}`,
                res.status
              );
            }

            if (
              res.status === 409 &&
              typeof errorJson === "object" &&
              errorJson !== null &&
              "code" in errorJson &&
              (errorJson as { code: string }).code === "STALE_REVISION_CONFLICT"
            ) {
              const details = (
                errorJson as {
                  details?: { expectedRevision?: number; currentRevision?: number };
                }
              ).details;
              throw {
                isStaleConflict: true,
                expectedRevision: details?.expectedRevision ?? command.expectedSpecRevision,
                currentRevision: details?.currentRevision ?? command.expectedSpecRevision + 1,
                message: (errorJson as { message?: string }).message
              };
            }

            if (
              typeof errorJson === "object" &&
              errorJson !== null &&
              "code" in errorJson &&
              "message" in errorJson
            ) {
              throw new ReviewCommandApiError(res.status, errorJson as ReviewErrorResponse);
            }

            throw new ApiClientError(`Control API returned HTTP ${res.status}`, res.status);
          }
        }

        if (isCancelled) return;

        const merged = mergeCompactResponse(state.detail, response);
        dispatchRef.current({ type: "SUBMIT_SUCCESS", response });
        onDetailChangeRef.current?.(merged);
        routerRef.current.refresh();
      } catch (err: unknown) {
        if (isCancelled) return;

        if (
          typeof err === "object" &&
          err !== null &&
          "isStaleConflict" in err &&
          (err as { isStaleConflict: boolean }).isStaleConflict
        ) {
          const stale = err as unknown as {
            expectedRevision: number;
            currentRevision: number;
            message?: string;
          };
          dispatchRef.current({
            type: "SUBMIT_STALE_CONFLICT",
            expectedRevision: stale.expectedRevision,
            currentRevision: stale.currentRevision,
            message: stale.message
          });
          return;
        }

        if (err instanceof ReviewCommandApiError) {
          if (err.statusCode === 409 && err.error.code === "STALE_REVISION_CONFLICT") {
            const details = err.error.details as
              { expectedRevision?: number; currentRevision?: number } | undefined;
            dispatchRef.current({
              type: "SUBMIT_STALE_CONFLICT",
              expectedRevision: details?.expectedRevision ?? command.expectedSpecRevision,
              currentRevision: details?.currentRevision ?? command.expectedSpecRevision + 1,
              message: err.error.message
            });
            return;
          }

          if (err.statusCode === 404) {
            dispatchRef.current({
              type: "SUBMIT_DEFINITIVE_ERROR",
              statusCode: 404,
              error: err.error
            });
            return;
          }

          if (err.statusCode >= 400 && err.statusCode < 500) {
            dispatchRef.current({
              type: "SUBMIT_DEFINITIVE_ERROR",
              statusCode: err.statusCode,
              error: err.error
            });
            return;
          }
        }

        const statusCode =
          err instanceof ApiClientError
            ? err.statusCode
            : err instanceof ReviewCommandApiError
              ? err.statusCode
              : undefined;

        if (statusCode === 404) {
          dispatchRef.current({
            type: "SUBMIT_DEFINITIVE_ERROR",
            statusCode: 404,
            error: {
              code: "NOT_FOUND",
              message: err instanceof Error ? err.message : "Scene not found"
            }
          });
          return;
        }

        const message =
          err instanceof Error
            ? err.message
            : "A network or server error occurred while processing your review action.";
        dispatchRef.current({
          type: "SUBMIT_INDETERMINATE_ERROR",
          message,
          statusCode
        });
      }
    }

    void executeSubmission();

    return () => {
      isCancelled = true;
    };
  }, [state]);

  function handleActionClick(action: ReviewAction) {
    stagedActionIdRef.current = crypto.randomUUID();
    const isDirectAction =
      action === "approve" || action === "reject" || action === "reroll" || action === "cancel";

    if (isDirectAction) {
      dispatch({
        type: "REQUEST_CONFIRMATION",
        stagedAction: {
          action,
          payload: {},
          displayLabel: formatReviewAction(action)
        }
      });
    } else {
      const initialPayload = getInitialDraftPayload(action, state.detail.configuration);
      dispatch({
        type: "START_DRAFT",
        draft: {
          action,
          payload: initialPayload,
          displayLabel: formatReviewAction(action)
        }
      });
    }
  }

  function handleStageDraft(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase !== "drafting") return;

    stagedActionIdRef.current = crypto.randomUUID();
    const action = state.draft.action;
    let payload: Record<string, unknown> = {};

    switch (action) {
      case "prompt_edit":
        payload = { prompt: draftPrompt };
        break;
      case "reference_change":
        payload = {
          referenceIds: draftReferences
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        };
        break;
      case "engine_change":
        payload = { engineProfileId: draftEngine.trim() };
        break;
      case "duration_change":
        payload = {
          durationMs: parseInt(draftDuration, 10) || state.detail.configuration.durationMs
        };
        break;
      case "lora_tune":
        payload = {
          loraConfigurationId: draftLora.trim() ? draftLora.trim() : null
        };
        break;
      default:
        payload = state.draft.payload ?? {};
    }

    const staged: ReviewCommandDraft = {
      action,
      payload,
      displayLabel: state.draft.displayLabel,
      ...(draftNotes.trim() ? { directorNotes: draftNotes.trim() } : {})
    };

    dispatch({
      type: "REQUEST_CONFIRMATION",
      stagedAction: staged
    });
  }

  function handleConfirmClick() {
    dispatch({
      type: "CONFIRM",
      actionId: stagedActionIdRef.current
    });
  }

  const activeDetail = state.detail;
  const allowedActions = activeDetail.allowedActions ?? [];

  return (
    <section
      className="scene-section review-command-surface"
      aria-label="Scene Review Actions"
      data-testid="review-command-controls"
    >
      <h2>Scene Review Actions</h2>

      {/* Syncing / In-Flight Status Indicator */}
      {state.phase === "succeeded-syncing" && (
        <div
          className="syncing-indicator"
          data-testid="syncing-indicator"
          data-status={state.detail.status}
        >
          <span className="syncing-text">
            {state.detail.status === "generating_candidates"
              ? "Generating candidates..."
              : "Action applied successfully. Synchronizing..."}
          </span>
          {state.refreshError && (
            <div className="syncing-error" data-testid="refresh-error">
              <p>{state.refreshError}</p>
              <button
                type="button"
                className="retry-button"
                onClick={() => dispatch({ type: "REQUEST_REFRESH" })}
              >
                Retry Refresh
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stale Revision Conflict Banner */}
      {state.phase === "stale-conflict" && (
        <div className="review-conflict-banner" data-testid="stale-conflict-banner" role="alert">
          <h3>Concurrent Spec Revision Conflict</h3>
          <p>
            Your command expected revision <strong>{state.expectedRevision}</strong>, but the scene
            is now at revision <strong>{state.currentRevision}</strong>.
          </p>
          {state.message && <p className="conflict-message">{state.message}</p>}
          <button
            type="button"
            className="retry-button"
            data-testid="load-stale-revision-button"
            onClick={() => dispatch({ type: "LOAD_STALE_REVISION" })}
          >
            Load Latest Revision
          </button>
        </div>
      )}

      {/* Definitive Error Banner */}
      {state.phase === "definitive-error" && (
        <div
          className="review-error-banner review-definitive-error"
          data-testid="definitive-error-banner"
          role="alert"
        >
          <h3>Action Rejected ({state.error.code})</h3>
          <p>{state.error.message}</p>
          {state.statusCode === 404 && (
            <div className="not-found-action" data-testid="not-found-action">
              <Link
                href={`/campaigns/${activeDetail.campaignId}`}
                className="back-link"
                data-testid="back-to-campaign-link"
              >
                ← Back to Campaign
              </Link>
            </div>
          )}
          <button
            type="button"
            className="dismiss-button"
            data-testid="dismiss-error-button"
            onClick={() => dispatch({ type: "DISMISS_ERROR" })}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Indeterminate / Network Error Banner */}
      {state.phase === "indeterminate-error" && (
        <div
          className="review-error-banner review-indeterminate-error"
          data-testid="indeterminate-error-banner"
          role="alert"
        >
          <h3>Communication / Server Error</h3>
          <p>{state.message}</p>
          <div className="error-button-group">
            <button
              type="button"
              className="retry-button"
              data-testid="retry-command-button"
              onClick={() => dispatch({ type: "RETRY" })}
            >
              Retry Action
            </button>
            <button
              type="button"
              className="dismiss-button"
              data-testid="dismiss-error-button"
              onClick={() => dispatch({ type: "DISMISS_ERROR" })}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Action Buttons Toolbar */}
      <div className="review-actions-toolbar" data-testid="review-actions-toolbar">
        {allowedActions.length > 0 ? (
          <div className="review-action-chips" data-testid="review-action-chips">
            {allowedActions.map((action) => (
              <button
                key={action}
                type="button"
                className={`review-action-btn review-action-${action}`}
                data-testid={`action-button-${action}`}
                data-action={action}
                disabled={disabled}
                onClick={() => handleActionClick(action)}
              >
                {formatReviewAction(action)}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-actions" data-testid="empty-actions">
            <span className="empty-value">
              No review actions available for current scene status
            </span>
          </div>
        )}
      </div>

      {/* Drafting Panel */}
      {state.phase === "drafting" && (
        <div className="review-draft-panel" data-testid="review-draft-panel">
          <h3>Draft: {state.draft.displayLabel}</h3>
          <form
            className="review-draft-form"
            data-testid="review-draft-form"
            onSubmit={handleStageDraft}
          >
            {state.draft.action === "prompt_edit" && (
              <div className="form-group">
                <label htmlFor={promptInputId}>Scene Prompt</label>
                <textarea
                  id={promptInputId}
                  data-testid="draft-prompt-input"
                  rows={4}
                  value={draftPrompt}
                  onChange={(e) => setDraftPrompt(e.target.value)}
                  required
                />
              </div>
            )}

            {state.draft.action === "reference_change" && (
              <div className="form-group">
                <label htmlFor={refInputId}>Reference Image IDs (comma-separated)</label>
                <input
                  id={refInputId}
                  data-testid="draft-references-input"
                  type="text"
                  value={draftReferences}
                  onChange={(e) => setDraftReferences(e.target.value)}
                  placeholder="ref-1, ref-2"
                />
              </div>
            )}

            {state.draft.action === "engine_change" && (
              <div className="form-group">
                <label htmlFor={engineInputId}>Engine Profile ID</label>
                <input
                  id={engineInputId}
                  data-testid="draft-engine-input"
                  type="text"
                  value={draftEngine}
                  onChange={(e) => setDraftEngine(e.target.value)}
                  required
                />
              </div>
            )}

            {state.draft.action === "duration_change" && (
              <div className="form-group">
                <label htmlFor={durationInputId}>Target Duration (milliseconds)</label>
                <input
                  id={durationInputId}
                  data-testid="draft-duration-input"
                  type="number"
                  min={100}
                  step={100}
                  value={draftDuration}
                  onChange={(e) => setDraftDuration(e.target.value)}
                  required
                />
              </div>
            )}

            {state.draft.action === "lora_tune" && (
              <div className="form-group">
                <label htmlFor={loraInputId}>LoRA Configuration ID (leave empty for none)</label>
                <input
                  id={loraInputId}
                  data-testid="draft-lora-input"
                  type="text"
                  value={draftLora}
                  onChange={(e) => setDraftLora(e.target.value)}
                  placeholder="lora-config-id or empty"
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor={notesInputId}>Director Notes (Optional)</label>
              <textarea
                id={notesInputId}
                data-testid="draft-director-notes-input"
                rows={2}
                value={draftNotes}
                onChange={(e) => setDraftNotes(e.target.value)}
                placeholder="Notes or reasoning for review history..."
              />
            </div>

            <div className="draft-form-actions">
              <button
                type="submit"
                className="stage-draft-button"
                data-testid="stage-draft-button"
                disabled={disabled}
              >
                Review & Stage Action
              </button>
              <button
                type="button"
                className="cancel-button"
                data-testid="cancel-draft-button"
                onClick={() => dispatch({ type: "CANCEL_DRAFT" })}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Dialog Modal */}
      {(state.phase === "confirming" || state.phase === "submitting") && (
        <div className="review-command-dialog-backdrop" data-testid="confirmation-dialog-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            className="review-command-dialog"
            data-testid="review-command-dialog"
            aria-labelledby="confirm-dialog-title"
          >
            <h3 id="confirm-dialog-title" data-testid="confirm-dialog-title">
              Confirm Action:{" "}
              {state.phase === "confirming"
                ? state.stagedAction.displayLabel
                : state.frozenIntent.displayLabel}
            </h3>

            <div className="dialog-summary" data-testid="dialog-summary">
              <dl className="dialog-detail-list">
                <div className="dialog-detail-item">
                  <dt>Target Scene:</dt>
                  <dd>
                    <code>{activeDetail.sceneId}</code>
                  </dd>
                </div>
                <div className="dialog-detail-item">
                  <dt>Expected Spec Revision:</dt>
                  <dd>Revision {activeDetail.specRevision}</dd>
                </div>
                <div className="dialog-detail-item">
                  <dt>Action:</dt>
                  <dd>
                    <code>
                      {state.phase === "confirming"
                        ? state.stagedAction.action
                        : state.frozenIntent.command.action}
                    </code>
                  </dd>
                </div>
                {state.phase === "confirming" && state.stagedAction.directorNotes && (
                  <div className="dialog-detail-item">
                    <dt>Director Notes:</dt>
                    <dd>{state.stagedAction.directorNotes}</dd>
                  </div>
                )}
                {state.phase === "submitting" && state.frozenIntent.command.directorNotes && (
                  <div className="dialog-detail-item">
                    <dt>Director Notes:</dt>
                    <dd>{state.frozenIntent.command.directorNotes}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="dialog-actions">
              <button
                type="button"
                className="confirm-button"
                data-testid="confirm-command-button"
                disabled={isSubmitting}
                onClick={handleConfirmClick}
              >
                {isSubmitting ? "Submitting..." : "Confirm & Submit"}
              </button>
              <button
                type="button"
                className="cancel-button"
                data-testid="cancel-confirmation-button"
                disabled={isSubmitting}
                onClick={() => dispatch({ type: "CANCEL_CONFIRMATION" })}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default ReviewCommandControls;
