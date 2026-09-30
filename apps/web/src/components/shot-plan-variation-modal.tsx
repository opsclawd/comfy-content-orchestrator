"use client";

import React, { useState, useEffect } from "react";
import type {
  ShotPlanReviewItem,
  CreateShotPlanVariationRequest,
  CreateShotPlanVariationResponse
} from "@cco/contracts";
import { formatShotFraming } from "./format-review-value";

export interface ShotPlanVariationModalProps {
  readonly isOpen: boolean;
  readonly sceneId: string;
  readonly currentSpecRevision: number;
  readonly sourcePlan: ShotPlanReviewItem | null;
  readonly onClose: () => void;
  readonly onSuccess?:
    ((response: CreateShotPlanVariationResponse) => void | Promise<void>) | undefined;
  readonly onCreateVariation?:
    | ((payload: CreateShotPlanVariationRequest) => Promise<CreateShotPlanVariationResponse>)
    | undefined;
}

export function ShotPlanVariationModal({
  isOpen,
  sceneId,
  currentSpecRevision,
  sourcePlan,
  onClose,
  onSuccess,
  onCreateVariation
}: ShotPlanVariationModalProps) {
  const [guidance, setGuidance] = useState("");
  const [variantCount, setVariantCount] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setGuidance("");
      setVariantCount(1);
      setIsSubmitting(false);
      setError(null);
      setValidationError(null);
    }
  }, [isOpen, sourcePlan?.shotPlanId]);

  if (!isOpen || !sourcePlan) {
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sourcePlan) {
      return;
    }

    const trimmedGuidance = guidance.trim();
    if (trimmedGuidance.length === 0) {
      setValidationError("Please enter director guidance for the variation.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setValidationError(null);

    const idempotencyKey = crypto.randomUUID();
    const payload: CreateShotPlanVariationRequest = {
      sourceShotPlanId: sourcePlan.shotPlanId,
      expectedSpecRevision: currentSpecRevision,
      directorGuidance: trimmedGuidance,
      variantCount,
      idempotencyKey
    };

    try {
      let result: CreateShotPlanVariationResponse;

      if (onCreateVariation) {
        result = await onCreateVariation(payload);
      } else {
        const res = await fetch(
          `/api/scenes/${encodeURIComponent(sceneId)}/shot-plans/variations`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify(payload)
          }
        );

        if (!res.ok) {
          let errorData: unknown;
          try {
            errorData = await res.json();
          } catch {
            errorData = null;
          }
          throw { status: res.status, error: errorData };
        }

        result = (await res.json()) as CreateShotPlanVariationResponse;
      }

      if (onSuccess) {
        await onSuccess(result);
      }
      onClose();
    } catch (err: unknown) {
      let formatted = "Failed to generate variation. Please try again.";

      if (typeof err === "object" && err !== null) {
        const status =
          "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : "status" in err
              ? (err as { status: number }).status
              : undefined;

        const errorPayload =
          "error" in err
            ? (err as { error: unknown }).error
            : "body" in err
              ? (err as { body: unknown }).body
              : err;

        if (typeof errorPayload === "object" && errorPayload !== null) {
          const code =
            "code" in errorPayload ? String((errorPayload as { code: unknown }).code) : undefined;
          const message =
            "message" in errorPayload
              ? String((errorPayload as { message: unknown }).message)
              : undefined;

          if (code === "CLOUD_PLANNING_NOT_AUTHORIZED" || status === 403) {
            formatted = message
              ? `Cloud planning not authorized: ${message}`
              : "Cloud planning is not authorized for this client. Please check your configuration.";
          } else if (code === "CONFIGURATION_ERROR" || status === 503) {
            formatted = message
              ? `Planning configuration error: ${message}`
              : "Shot plan variation is unavailable because planning model clients are not configured.";
          } else if (code === "SOURCE_SHOT_PLAN_NOT_FOUND" || status === 404) {
            formatted = message ?? "Source shot plan was not found.";
          } else if (code === "STALE_SOURCE_SHOT_PLAN_REVISION") {
            formatted =
              message ?? "Source shot plan revision is stale compared to the current scene spec.";
          } else if (code === "SUPERSEDED_SOURCE_SHOT_PLAN") {
            formatted = message ?? "Source shot plan has been superseded.";
          } else if (code === "IDEMPOTENCY_CONFLICT" || status === 409) {
            formatted = message ?? "Conflicting variation request for idempotency key.";
          } else if (message && status !== undefined && status < 500) {
            formatted = message;
          }
        }
      }

      setError(formatted);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="shot-plan-variation-modal-backdrop"
      data-testid="shot-plan-variation-modal-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shot-plan-variation-title"
        className="shot-plan-variation-modal"
        data-testid="shot-plan-variation-modal"
      >
        <div className="shot-plan-variation-modal-header">
          <h3 id="shot-plan-variation-title">Create Shot Plan Variation</h3>
          <p
            className="shot-plan-variation-source-identity"
            data-testid="variation-source-identity"
          >
            Source Variant: <strong>V{sourcePlan.variantOrdinal}</strong> (Rev{" "}
            {sourcePlan.specRevision}) · {formatShotFraming(sourcePlan.framing)} ·{" "}
            {sourcePlan.lensIntent}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="shot-plan-variation-form">
          <div className="form-group">
            <label htmlFor="director-guidance">
              Director Guidance <span className="required-star">*</span>
            </label>
            <p className="form-help-text">
              Describe the specific visual, framing, camera movement, or staging changes to make.
              Fields not mentioned will preserve source intent.
            </p>
            <textarea
              id="director-guidance"
              data-testid="variation-guidance-input"
              rows={4}
              className={`variation-guidance-textarea ${validationError ? "field-error-input" : ""}`}
              placeholder="e.g. Keep this composition, make it a tighter 50mm shot, move the product into the foreground, and use a slow dolly in."
              value={guidance}
              onChange={(e) => {
                setGuidance(e.target.value);
                if (validationError && e.target.value.trim().length > 0) {
                  setValidationError(null);
                }
              }}
              disabled={isSubmitting}
            />
            {validationError && (
              <span
                className="field-validation-error"
                data-testid="variation-guidance-validation-error"
              >
                {validationError}
              </span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="variant-count">Variants to Generate</label>
            <select
              id="variant-count"
              data-testid="variation-count-select"
              className="variation-count-select"
              value={variantCount}
              onChange={(e) => setVariantCount(Number(e.target.value))}
              disabled={isSubmitting}
            >
              <option value={1}>1 variation (default)</option>
              <option value={2}>2 variations</option>
              <option value={3}>3 variations</option>
            </select>
          </div>

          {isSubmitting && (
            <div
              className="generating-indicator"
              data-testid="generating-variation-status"
              role="status"
              aria-live="polite"
            >
              Planning directed variation(s)...
            </div>
          )}

          {error && (
            <div className="review-error-banner" data-testid="variation-error-message" role="alert">
              <p>{error}</p>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="action-button cancel-button"
              data-testid="cancel-variation-button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="action-button submit-variation-button"
              data-testid="submit-variation-button"
              disabled={isSubmitting || guidance.trim().length === 0}
              aria-busy={isSubmitting ? "true" : undefined}
            >
              {isSubmitting ? "Generating..." : "Generate Variation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default ShotPlanVariationModal;
