"use client";

import React, {
  useReducer,
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import {
  PlanCampaignStoryboardApiError,
  listClientReferences,
  ApiClientError,
  type ReferenceAssetResponse
} from "../api/client";
import { generateUuidV4 } from "../lib/generate-uuid";
import {
  createInitialState,
  transitionCampaignCreationState,
  type CampaignCreationEvent,
  type CampaignCreationFormValues,
  type CampaignCreationState
} from "./campaign-creation-state";
import { ReferenceGallery, ReferenceLibraryDrawer } from "./reference-library";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CampaignCreationFormProps {
  readonly submitCampaign?: (
    request: PlanCampaignStoryboardRequest
  ) => Promise<PlanCampaignStoryboardResponse>;
  readonly initialValues?: Partial<CampaignCreationFormValues> | undefined;
  readonly state?: CampaignCreationState | undefined;
  readonly dispatch?: ((event: CampaignCreationEvent) => void) | undefined;
  readonly initialReferences?: readonly ReferenceAssetResponse[] | undefined;
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
  dispatch: controlledDispatch,
  initialReferences
}: CampaignCreationFormProps) {
  const [internalState, internalDispatch] = useReducer(
    (prevState: CampaignCreationState, event: CampaignCreationEvent) =>
      transitionCampaignCreationState(prevState, event).state,
    initialValues,
    createInitialState
  );

  const state = controlledState ?? internalState;
  const dispatch = controlledDispatch ?? internalDispatch;

  const currentClientId = state.values.clientId.trim();
  const prevClientIdRef = useRef(currentClientId);
  const fetchGenerationRef = useRef(0);
  const isInitialMountRef = useRef(true);
  const candidateIdsRef = useRef(state.values.candidateReferenceAssetIds);
  candidateIdsRef.current = state.values.candidateReferenceAssetIds;

  // Synchronously invalidate request generation on EVERY client change, including invalid IDs
  if (prevClientIdRef.current !== currentClientId) {
    prevClientIdRef.current = currentClientId;
    fetchGenerationRef.current++;
  }

  const [referenceState, setReferenceState] = useState<{
    clientId: string;
    references: readonly ReferenceAssetResponse[];
    status: "idle" | "loading" | "loaded" | "error";
    error: string | null;
  }>(() => {
    if (initialReferences !== undefined) {
      return {
        clientId: currentClientId,
        references: initialReferences.filter(
          (r) => r.clientId === currentClientId && !r.archivedAt
        ),
        status: "loaded",
        error: null
      };
    }
    return {
      clientId: currentClientId,
      references: [],
      status: "idle",
      error: null
    };
  });

  const [isLibraryDrawerOpen, setIsLibraryDrawerOpen] = useState(false);

  // Associate reference state with its client ID and render/use it only when that ID matches current client
  const isCurrentClient = referenceState.clientId === currentClientId;
  const references = isCurrentClient ? referenceState.references : [];
  const isReferencesLoaded = isCurrentClient && referenceState.status === "loaded";
  const isReferencesLoading = isCurrentClient
    ? referenceState.status === "loading"
    : UUID_REGEX.test(currentClientId);
  const referencesError = isCurrentClient ? referenceState.error : null;

  useEffect(() => {
    // When client ID changes from previously loaded client, close drawer and clear candidate IDs
    if (referenceState.clientId !== currentClientId) {
      setIsLibraryDrawerOpen(false);
      if (candidateIdsRef.current && candidateIdsRef.current.length > 0) {
        dispatch({
          type: "UPDATE_FIELDS",
          values: { candidateReferenceAssetIds: [] }
        });
      }
    }

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      if (initialReferences !== undefined) {
        return;
      }
    }

    const isValidUuid = UUID_REGEX.test(currentClientId);
    if (!isValidUuid) {
      setReferenceState({
        clientId: currentClientId,
        references: [],
        status: "idle",
        error: null
      });
      return;
    }

    const generation = ++fetchGenerationRef.current;
    setReferenceState({
      clientId: currentClientId,
      references: [],
      status: "loading",
      error: null
    });

    listClientReferences(currentClientId)
      .then((data) => {
        if (generation !== fetchGenerationRef.current) return;
        const filtered = data.filter((ref) => ref.clientId === currentClientId && !ref.archivedAt);
        setReferenceState({
          clientId: currentClientId,
          references: filtered,
          status: "loaded",
          error: null
        });
      })
      .catch((err: unknown) => {
        if (generation !== fetchGenerationRef.current) return;
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load client references.";
        setReferenceState({
          clientId: currentClientId,
          references: [],
          status: "error",
          error: msg
        });
      });
  }, [currentClientId, initialReferences, dispatch]);

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

  const router = useRouter();
  const navigatedCampaignIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (state.phase !== "succeeded") {
      navigatedCampaignIdRef.current = null;
      return;
    }

    const campaignId = state.response.campaignId;
    if (!campaignId || navigatedCampaignIdRef.current === campaignId) {
      return;
    }
    navigatedCampaignIdRef.current = campaignId;
    router.push(`/campaigns/${campaignId}`);
  }, [state, router]);

  const handleToggleReference = useCallback(
    (referenceId: string) => {
      // Only permit toggling references that are active members of current client
      const isActiveMember = references.some(
        (r) => r.id === referenceId && r.clientId === currentClientId && !r.archivedAt
      );
      if (!isActiveMember) {
        return;
      }

      const currentSelected = state.values.candidateReferenceAssetIds ?? [];
      const isSelected = currentSelected.includes(referenceId);
      const nextSelected = isSelected
        ? currentSelected.filter((id) => id !== referenceId)
        : [...currentSelected, referenceId];

      dispatch({
        type: "UPDATE_FIELDS",
        values: { candidateReferenceAssetIds: nextSelected }
      });
    },
    [references, currentClientId, state.values.candidateReferenceAssetIds, dispatch]
  );

  const handleReferenceArchived = useCallback(
    (archivedId: string) => {
      setReferenceState((prev) => {
        if (prev.clientId !== currentClientId) return prev;
        return {
          ...prev,
          references: prev.references.filter((r) => r.id !== archivedId)
        };
      });
      if (state.values.candidateReferenceAssetIds?.includes(archivedId)) {
        dispatch({
          type: "UPDATE_FIELDS",
          values: {
            candidateReferenceAssetIds: (state.values.candidateReferenceAssetIds ?? []).filter(
              (id) => id !== archivedId
            )
          }
        });
      }
    },
    [currentClientId, state.values.candidateReferenceAssetIds, dispatch]
  );

  const handleReferenceAdded = useCallback(
    (newReference: ReferenceAssetResponse) => {
      if (newReference.clientId === currentClientId && !newReference.archivedAt) {
        setReferenceState((prev) => {
          if (prev.clientId !== currentClientId) return prev;
          return {
            ...prev,
            references: [newReference, ...prev.references.filter((r) => r.id !== newReference.id)]
          };
        });
      }
    },
    [currentClientId]
  );

  const handleReferenceRoleUpdated = useCallback(
    (updatedRef: ReferenceAssetResponse) => {
      if (updatedRef.clientId === currentClientId) {
        setReferenceState((prev) => {
          if (prev.clientId !== currentClientId) return prev;
          const filtered = updatedRef.archivedAt
            ? prev.references.filter((r) => r.id !== updatedRef.id)
            : prev.references.map((r) => (r.id === updatedRef.id ? updatedRef : r));
          return {
            ...prev,
            references: filtered
          };
        });
      }
    },
    [currentClientId]
  );

  const handleRetryReferences = useCallback(() => {
    if (!UUID_REGEX.test(currentClientId)) return;
    const generation = ++fetchGenerationRef.current;
    setReferenceState({
      clientId: currentClientId,
      references: [],
      status: "loading",
      error: null
    });

    listClientReferences(currentClientId)
      .then((data) => {
        if (generation !== fetchGenerationRef.current) return;
        const filtered = data.filter((ref) => ref.clientId === currentClientId && !ref.archivedAt);
        setReferenceState({
          clientId: currentClientId,
          references: filtered,
          status: "loaded",
          error: null
        });
      })
      .catch((err: unknown) => {
        if (generation !== fetchGenerationRef.current) return;
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load client references.";
        setReferenceState({
          clientId: currentClientId,
          references: [],
          status: "error",
          error: msg
        });
      });
  }, [currentClientId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.phase === "submitting") {
      return;
    }

    const candidateIds = state.values.candidateReferenceAssetIds ?? [];
    if (candidateIds.length > 0) {
      // 1. Refuse submission if references for current client are not successfully loaded
      if (!isReferencesLoaded) {
        setReferenceState((prev) => ({
          ...prev,
          clientId: currentClientId,
          status: "error",
          error:
            prev.error ??
            (isReferencesLoading
              ? "Cannot submit campaign: client references are still loading."
              : "Cannot submit campaign: client references could not be verified.")
        }));
        return;
      }

      // 2. Refuse submission if any selected ID is outside the loaded active set (even if the set is empty)
      const activeReferenceIdSet = new Set(
        references.filter((r) => r.clientId === currentClientId && !r.archivedAt).map((r) => r.id)
      );
      const invalidCandidates = candidateIds.filter((id) => !activeReferenceIdSet.has(id));
      if (invalidCandidates.length > 0) {
        setReferenceState((prev) => ({
          ...prev,
          clientId: currentClientId,
          status: "error",
          error: `Cannot submit campaign: selected reference asset(s) are not active references for client ${currentClientId}.`
        }));
        return;
      }
    }

    const freshKey = generateUuidV4();
    dispatch({
      type: "SUBMIT",
      idempotencyKey: freshKey
    });
  }

  function handleFieldChange(field: keyof CampaignCreationFormValues, value: string) {
    if (field === "clientId") {
      const trimmed = value.trim();
      if (trimmed !== state.values.clientId.trim()) {
        dispatch({
          type: "UPDATE_FIELDS",
          values: { clientId: value, candidateReferenceAssetIds: [] }
        });
        return;
      }
    }
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

        {/* Reference Assets Multi-Select Section */}
        <div className="form-group" data-testid="reference-assets-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem"
            }}
          >
            <div>
              <label style={{ margin: 0 }}>Reference Assets (Optional)</label>
              <span
                style={{
                  display: "block",
                  fontSize: "0.75rem",
                  color: "var(--text-muted)",
                  marginTop: "0.25rem"
                }}
              >
                Select reference assets to guide visual candidate generation for this campaign.
                {values.candidateReferenceAssetIds &&
                  values.candidateReferenceAssetIds.length > 0 && (
                    <strong
                      style={{ marginLeft: "0.5rem", color: "var(--color-primary, #6366f1)" }}
                      data-testid="selected-reference-count"
                    >
                      ({values.candidateReferenceAssetIds.length} selected)
                    </strong>
                  )}
              </span>
            </div>
            <button
              type="button"
              className="action-button secondary"
              data-testid="manage-references-button"
              onClick={() => {
                if (UUID_REGEX.test(values.clientId.trim()) && !isSubmitting) {
                  setIsLibraryDrawerOpen(true);
                }
              }}
              disabled={isSubmitting ? true : undefined}
              aria-disabled={!UUID_REGEX.test(values.clientId.trim()) || isSubmitting}
              style={{
                fontSize: "0.8125rem",
                padding: "0.375rem 0.75rem",
                cursor:
                  !UUID_REGEX.test(values.clientId.trim()) || isSubmitting
                    ? "not-allowed"
                    : "pointer"
              }}
            >
              Manage Library / Upload
            </button>
          </div>

          {!UUID_REGEX.test(values.clientId.trim()) ? (
            <div
              data-testid="reference-library-prompt"
              style={{
                padding: "1.5rem 1rem",
                borderRadius: "var(--radius-md)",
                border: "1px dashed var(--border-subtle)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-muted)",
                fontSize: "0.875rem",
                textAlign: "center"
              }}
            >
              Enter a valid Client ID above to browse and select reference assets.
            </div>
          ) : (
            <ReferenceGallery
              references={references}
              selectedIds={values.candidateReferenceAssetIds ?? []}
              onToggleSelect={handleToggleReference}
              selectable={!isSubmitting}
              isLoading={isReferencesLoading}
              error={referencesError}
              onRetry={handleRetryReferences}
              expectedClientId={currentClientId}
              emptyMessage="No active reference assets found for this client. Click “Manage Library / Upload” to add reference assets."
            />
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

        <div className="form-group" data-testid="engine-selection-group">
          <label>Target Video Generation Engine *</label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: "1rem",
              marginTop: "0.5rem"
            }}
          >
            {/* MiniMax-H3 Card */}
            <label
              data-testid="engine-card-minimax-h3"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                padding: "1rem",
                borderRadius: "var(--radius-md)",
                border:
                  values.targetEngineProfileId === "MINIMAX_H3_720P_5S_I2V_V1"
                    ? "2px solid var(--color-primary)"
                    : "1px solid var(--border-subtle)",
                backgroundColor:
                  values.targetEngineProfileId === "MINIMAX_H3_720P_5S_I2V_V1"
                    ? "var(--bg-surface-elevated)"
                    : "var(--bg-surface)",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
                textTransform: "none"
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="radio"
                    name="targetEngineProfileId"
                    value="MINIMAX_H3_720P_5S_I2V_V1"
                    checked={values.targetEngineProfileId === "MINIMAX_H3_720P_5S_I2V_V1"}
                    onChange={() =>
                      handleFieldChange("targetEngineProfileId", "MINIMAX_H3_720P_5S_I2V_V1")
                    }
                    disabled={isSubmitting}
                    data-testid="engine-radio-minimax-h3"
                  />
                  <strong style={{ color: "var(--text-primary)", fontSize: "0.95rem" }}>
                    MiniMax-H3
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "999px",
                    backgroundColor: "rgba(56, 189, 248, 0.15)",
                    color: "var(--color-primary)"
                  }}
                >
                  Photorealistic Hero
                </span>
              </div>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                  margin: 0,
                  lineHeight: 1.4
                }}
              >
                High-capacity multimodal video model. Realistic skin texture, facial wrinkles,
                natural lighting, and synchronized AAC audio.
              </p>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "auto" }}>
                1344×768 (720p) · 124 frames (5.0s) · ~6.5m on RTX 4090
              </div>
            </label>

            {/* LTX-Video 2.5 Card */}
            <label
              data-testid="engine-card-ltx-25"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                padding: "1rem",
                borderRadius: "var(--radius-md)",
                border:
                  values.targetEngineProfileId === "LTX_25_720P_5S_V1"
                    ? "2px solid var(--color-primary)"
                    : "1px solid var(--border-subtle)",
                backgroundColor:
                  values.targetEngineProfileId === "LTX_25_720P_5S_V1"
                    ? "var(--bg-surface-elevated)"
                    : "var(--bg-surface)",
                cursor: isSubmitting ? "not-allowed" : "pointer",
                transition: "all 0.15s ease",
                textTransform: "none"
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <input
                    type="radio"
                    name="targetEngineProfileId"
                    value="LTX_25_720P_5S_V1"
                    checked={values.targetEngineProfileId === "LTX_25_720P_5S_V1"}
                    onChange={() => handleFieldChange("targetEngineProfileId", "LTX_25_720P_5S_V1")}
                    disabled={isSubmitting}
                    data-testid="engine-radio-ltx-25"
                  />
                  <strong style={{ color: "var(--text-primary)", fontSize: "0.95rem" }}>
                    LTX-Video 2.5
                  </strong>
                </div>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "999px",
                    backgroundColor: "rgba(100, 116, 139, 0.2)",
                    color: "var(--text-secondary)"
                  }}
                >
                  Fast Animatics
                </span>
              </div>
              <p
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-secondary)",
                  margin: 0,
                  lineHeight: 1.4
                }}
              >
                Lightweight 2B model optimized for rapid storyboard pacing, draft iteration, and
                quick previews.
              </p>
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "auto" }}>
                1280×720 (720p) · 97 frames (~4.0s) · ~40s on RTX 4090
              </div>
            </label>
          </div>
          {fieldErrors.targetEngineProfileId && (
            <span
              className="field-error"
              data-testid="field-error-target-engine-profile-id"
              style={{
                color: "var(--status-failed-border)",
                fontSize: "0.8125rem",
                marginTop: "0.25rem",
                display: "block"
              }}
            >
              {fieldErrors.targetEngineProfileId}
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

      {/* Reference Library Drawer */}
      {UUID_REGEX.test(values.clientId.trim()) && (
        <ReferenceLibraryDrawer
          clientId={values.clientId.trim()}
          isOpen={isLibraryDrawerOpen}
          onClose={() => setIsLibraryDrawerOpen(false)}
          selectedIds={values.candidateReferenceAssetIds ?? []}
          onToggleSelect={handleToggleReference}
          onReferenceArchived={handleReferenceArchived}
          onReferenceAdded={handleReferenceAdded}
          onReferenceUpdated={handleReferenceRoleUpdated}
        />
      )}
    </section>
  );
}

export default CampaignCreationForm;
