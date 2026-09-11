"use client";

import React, { useReducer, useRef, useEffect, useLayoutEffect } from "react";
import Link from "next/link";
import {
  MIN_SCENE_COUNT,
  MAX_SCENE_COUNT,
  MIN_TARGET_DURATION_MS,
  MAX_TARGET_DURATION_MS,
  PlanCampaignStoryboardErrorResponseSchema,
  type PlanCampaignStoryboardRequest,
  type PlanCampaignStoryboardResponse
} from "@cco/contracts";

const MIN_TARGET_DURATION_SECONDS = Math.ceil(MIN_TARGET_DURATION_MS / 1000);
const MAX_TARGET_DURATION_SECONDS = Math.floor(MAX_TARGET_DURATION_MS / 1000);
import { PlanCampaignStoryboardApiError } from "../api/client";
import { generateUuidV4 } from "../lib/generate-uuid";
import {
  createInitialState,
  transitionCampaignCreationState,
  type CampaignCreationEvent,
  type CampaignCreationFormValues,
  type CampaignCreationState
} from "./campaign-creation-state";

export interface CampaignCreationFormProps {
  readonly submitCampaign?: (
    request: PlanCampaignStoryboardRequest
  ) => Promise<PlanCampaignStoryboardResponse>;
  readonly initialValues?: Partial<CampaignCreationFormValues> | undefined;
  readonly state?: CampaignCreationState | undefined;
  readonly dispatch?: ((event: CampaignCreationEvent) => void) | undefined;
}

async function defaultSubmitCampaign(
  request: PlanCampaignStoryboardRequest
): Promise<PlanCampaignStoryboardResponse> {
  const res = await fetch("/api/campaigns/plan", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(request)
  });

  if (res.ok) {
    return (await res.json()) as PlanCampaignStoryboardResponse;
  }

  let errorData: unknown;
  try {
    errorData = await res.json();
  } catch {
    throw new PlanCampaignStoryboardApiError(res.status, {
      message: `Request failed with HTTP ${res.status}: ${res.statusText}`
    });
  }

  const parseResult = PlanCampaignStoryboardErrorResponseSchema.safeParse(errorData);
  if (parseResult.success) {
    throw new PlanCampaignStoryboardApiError(res.status, parseResult.data);
  }

  throw new PlanCampaignStoryboardApiError(res.status, {
    message:
      typeof (errorData as Record<string, unknown>)?.message === "string"
        ? (errorData as { message: string }).message
        : `Request failed with HTTP ${res.status}`
  });
}

export function CampaignCreationForm({
  submitCampaign,
  initialValues,
  state: controlledState,
  dispatch: controlledDispatch
}: CampaignCreationFormProps) {
  const [internalState, internalDispatch] = useReducer(
    (prevState: CampaignCreationState, event: CampaignCreationEvent) =>
      transitionCampaignCreationState(prevState, event).state,
    initialValues,
    createInitialState
  );

  const state = controlledState ?? internalState;
  const dispatch = controlledDispatch ?? internalDispatch;

  const submitCampaignRef = useRef(submitCampaign);
  const dispatchRef = useRef(dispatch);

  useLayoutEffect(() => {
    submitCampaignRef.current = submitCampaign;
    dispatchRef.current = dispatch;
  });

  const submittedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.phase !== "submitting") {
      submittedKeyRef.current = null;
      return;
    }

    const submittingState = state;

    if (submittedKeyRef.current === submittingState.idempotencyKey) {
      return;
    }
    submittedKeyRef.current = submittingState.idempotencyKey;

    let isCancelled = false;

    async function executeSubmission() {
      try {
        const submitFn = submitCampaignRef.current ?? defaultSubmitCampaign;
        const response = await submitFn(submittingState.request);
        if (isCancelled) return;
        dispatchRef.current({ type: "SUBMIT_SUCCESS", response });
      } catch (err: unknown) {
        if (isCancelled) return;
        if (err instanceof PlanCampaignStoryboardApiError) {
          dispatchRef.current({
            type: "SUBMIT_ERROR",
            statusCode: err.statusCode,
            error: err.error
          });
          return;
        }

        const message =
          err instanceof Error
            ? err.message
            : "A network or server error occurred while planning the campaign.";
        dispatchRef.current({
          type: "SUBMIT_ERROR",
          statusCode: 502,
          error: { message }
        });
      }
    }

    void executeSubmission();

    return () => {
      isCancelled = true;
    };
  }, [state]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase === "submitting") {
      return;
    }

    const freshKey = generateUuidV4();
    dispatch({
      type: "SUBMIT",
      idempotencyKey: freshKey
    });
  }

  function handleFieldChange(field: keyof CampaignCreationFormValues, value: string) {
    dispatch({
      type: "UPDATE_FIELDS",
      values: { [field]: value }
    });
  }

  const values = state.values;
  const fieldErrors =
    state.phase === "validation-failed" || state.phase === "submit-error" ? state.fieldErrors : {};
  const isSubmitting = state.phase === "submitting";

  return (
    <section
      className="campaign-creation-surface"
      aria-label="Create Campaign Storyboard"
      data-testid="campaign-creation-surface"
    >
      <header className="campaign-creation-header">
        <h1>Create &amp; Plan Campaign</h1>
        <p className="campaign-creation-subtitle">
          Generate an MVP prompt-to-storyboard sequence with automated candidate generation.
        </p>
      </header>

      {/* 409 Conflict Banner */}
      {state.phase === "submit-error" && state.error.isConflict && (
        <div
          className="review-conflict-banner"
          data-testid="campaign-creation-conflict"
          role="alert"
        >
          <h3>Campaign Conflict ({state.error.code ?? "409"})</h3>
          <p>{state.error.message}</p>
        </div>
      )}

      {/* 400 Validation Error Banner */}
      {state.phase === "submit-error" &&
        !state.error.isConflict &&
        state.error.code === "VALIDATION_FAILURE" && (
          <div
            className="review-error-banner"
            data-testid="campaign-creation-validation-error"
            role="alert"
          >
            <h3>Validation Failure</h3>
            <p>{state.error.message}</p>
          </div>
        )}

      {/* Generic Error Banner (403, 422, 5xx, or other) */}
      {state.phase === "submit-error" &&
        !state.error.isConflict &&
        state.error.code !== "VALIDATION_FAILURE" && (
          <div className="review-error-banner" data-testid="campaign-creation-error" role="alert">
            <h3>
              Request Rejection
              {state.error.code ? ` (${state.error.code})` : ""}
            </h3>
            <p>
              The request could not be completed: {state.error.message}. Review the form and submit
              again if needed.
            </p>
          </div>
        )}

      {/* Client Validation Failure Banner */}
      {state.phase === "validation-failed" && (
        <div
          className="review-error-banner"
          data-testid="campaign-creation-validation-error"
          role="alert"
        >
          <h3>Validation Error</h3>
          <p>Please correct the errors in the form before submitting.</p>
        </div>
      )}

      {/* Success Summary Panel */}
      {state.phase === "succeeded" && (
        <div
          className="campaign-creation-success-panel review-draft-panel"
          data-testid="campaign-creation-success"
        >
          <h2>Campaign Storyboard Planned Successfully</h2>
          <div className="dialog-summary">
            <dl className="dialog-detail-list">
              <div className="dialog-detail-item">
                <dt>Campaign ID:</dt>
                <dd>
                  <code data-testid="created-campaign-id">{state.response.campaignId}</code>
                </dd>
              </div>
              <div className="dialog-detail-item">
                <dt>Status:</dt>
                <dd>{state.response.status}</dd>
              </div>
              <div className="dialog-detail-item">
                <dt>Total Planned Scenes:</dt>
                <dd>
                  <span data-testid="created-total-scenes">{state.response.totalScenes}</span>
                </dd>
              </div>
              <div className="dialog-detail-item">
                <dt>Materialized Scene Count:</dt>
                <dd>
                  <span data-testid="created-scene-count">{state.response.sceneCount}</span>
                </dd>
              </div>
              <div className="dialog-detail-item">
                <dt>Target Duration:</dt>
                <dd>
                  {Math.round(state.response.targetTotalDurationMs / 1000)}s (
                  {state.response.targetTotalDurationMs} ms)
                </dd>
              </div>
              {state.response.isIdempotentReplay && (
                <div className="dialog-detail-item">
                  <dt>Replay Mode:</dt>
                  <dd>Idempotent Replay</dd>
                </div>
              )}
            </dl>
          </div>

          <h3>Materialized Scenes ({state.response.scenes.length})</h3>
          <ol className="created-scenes-list" data-testid="created-scenes-list">
            {state.response.scenes.map((scene) => (
              <li key={scene.sceneId} data-testid={`created-scene-${scene.ordinal}`}>
                <span>Scene {scene.ordinal}:</span> <code>{scene.sceneId}</code> —{" "}
                <em>{scene.status}</em>
              </li>
            ))}
          </ol>

          <div className="draft-form-actions">
            <Link
              href={`/campaigns/${state.response.campaignId}`}
              className="stage-draft-button"
              data-testid="view-campaign-link"
            >
              View Campaign Storyboard →
            </Link>
          </div>
        </div>
      )}

      {/* Creation Form */}
      <form
        onSubmit={handleSubmit}
        className="campaign-creation-form review-draft-panel"
        data-testid="campaign-creation-form"
      >
        <div className="form-group">
          <label htmlFor="brief-description">Creative Brief Description *</label>
          <textarea
            id="brief-description"
            data-testid="brief-description-input"
            rows={4}
            value={values.briefDescription}
            onChange={(e) => handleFieldChange("briefDescription", e.target.value)}
            disabled={isSubmitting}
            placeholder="Describe the campaign narrative, tone, actions, and key visual moments..."
            required
          />
          {fieldErrors.briefDescription && (
            <span
              className="field-error"
              data-testid="field-error-brief-description"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.briefDescription}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="brief-visual-style">Visual Style (Optional)</label>
          <input
            id="brief-visual-style"
            type="text"
            data-testid="brief-visual-style-input"
            value={values.briefVisualStyle}
            onChange={(e) => handleFieldChange("briefVisualStyle", e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. golden hour cinematic, cyberpunk neon, hyper-real"
          />
          {fieldErrors.briefVisualStyle && (
            <span
              className="field-error"
              data-testid="field-error-brief-visual-style"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.briefVisualStyle}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="campaign-title">Campaign Title *</label>
          <input
            id="campaign-title"
            type="text"
            data-testid="campaign-title-input"
            value={values.title}
            onChange={(e) => handleFieldChange("title", e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. Summer 2026 Collection Reel"
            required
          />
          {fieldErrors.title && (
            <span
              className="field-error"
              data-testid="field-error-title"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.title}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="client-id">Client ID (UUID) *</label>
          <input
            id="client-id"
            type="text"
            data-testid="client-id-input"
            value={values.clientId}
            onChange={(e) => handleFieldChange("clientId", e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. 018e69e0-8a6a-72cb-b1b7-ec79a1f73801"
            required
          />
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Paste the UUID of an existing client account.
          </span>
          {fieldErrors.clientId && (
            <span
              className="field-error"
              data-testid="field-error-client-id"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.clientId}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="target-platform">Target Platform (Optional)</label>
          <input
            id="target-platform"
            type="text"
            data-testid="target-platform-input"
            value={values.targetPlatform}
            onChange={(e) => handleFieldChange("targetPlatform", e.target.value)}
            disabled={isSubmitting}
            placeholder="e.g. tiktok, instagram_reels, youtube_shorts"
          />
          {fieldErrors.targetPlatform && (
            <span
              className="field-error"
              data-testid="field-error-target-platform"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.targetPlatform}
            </span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="target-duration">Target Total Duration (seconds) *</label>
          <input
            id="target-duration"
            type="number"
            min={MIN_TARGET_DURATION_SECONDS}
            max={MAX_TARGET_DURATION_SECONDS}
            step={1}
            data-testid="target-duration-input"
            value={values.durationSeconds}
            onChange={(e) => handleFieldChange("durationSeconds", e.target.value)}
            disabled={isSubmitting}
            required
          />
          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Total storyboard duration ({MIN_TARGET_DURATION_SECONDS} to{" "}
            {MAX_TARGET_DURATION_SECONDS} seconds).
          </span>
          {fieldErrors.durationSeconds && (
            <span
              className="field-error"
              data-testid="field-error-duration"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.durationSeconds}
            </span>
          )}
        </div>

        <div className="form-group">
          <label>Scene Count Mode</label>
          <div
            style={{ display: "flex", gap: "1.5rem", alignItems: "center", margin: "0.25rem 0" }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                textTransform: "none",
                color: "var(--text-primary)"
              }}
            >
              <input
                type="radio"
                name="sceneCountMode"
                value="auto"
                checked={values.sceneCountMode === "auto"}
                onChange={() => handleFieldChange("sceneCountMode", "auto")}
                disabled={isSubmitting}
                data-testid="scene-count-mode-auto"
              />
              Auto
            </label>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                textTransform: "none",
                color: "var(--text-primary)"
              }}
            >
              <input
                type="radio"
                name="sceneCountMode"
                value="custom"
                checked={values.sceneCountMode === "custom"}
                onChange={() => handleFieldChange("sceneCountMode", "custom")}
                disabled={isSubmitting}
                data-testid="scene-count-mode-custom"
              />
              Custom Override
            </label>
          </div>

          {values.sceneCountMode === "auto" ? (
            <span
              data-testid="scene-count-auto-hint"
              style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}
            >
              Scene count will be determined automatically by backend orchestration based on
              duration and brief.
            </span>
          ) : (
            <div className="form-group" style={{ marginTop: "0.5rem" }}>
              <label htmlFor="scene-count-override">
                Custom Scene Count Override ({MIN_SCENE_COUNT} - {MAX_SCENE_COUNT})
              </label>
              <input
                id="scene-count-override"
                type="number"
                min={MIN_SCENE_COUNT}
                max={MAX_SCENE_COUNT}
                step={1}
                data-testid="scene-count-override-input"
                value={values.sceneCountOverride}
                onChange={(e) => handleFieldChange("sceneCountOverride", e.target.value)}
                disabled={isSubmitting}
                placeholder="e.g. 3"
                required
              />
            </div>
          )}

          {fieldErrors.sceneCountOverride && (
            <span
              className="field-error"
              data-testid="field-error-scene-count-override"
              style={{ color: "var(--status-failed-border)", fontSize: "0.8125rem" }}
            >
              {fieldErrors.sceneCountOverride}
            </span>
          )}
        </div>

        <div className="draft-form-actions" style={{ marginTop: "1rem" }}>
          <button
            type="submit"
            className="stage-draft-button"
            data-testid="submit-campaign-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Planning Storyboard..." : "Create & Plan Campaign"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default CampaignCreationForm;
