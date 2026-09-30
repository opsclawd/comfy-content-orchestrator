"use client";

import React, { useMemo, useState } from "react";
import type { ShotPlanReviewItem, ShotPlanSemanticDiff } from "@cco/contracts";
import {
  computeShotPlanSemanticDiff,
  evaluateShotPlanComparability,
  resolveShotPlanDiffSource,
  ShotPlanComparisonRejectedError
} from "@cco/contracts";

export interface ShotPlanComparisonModalProps {
  readonly isOpen: boolean;
  readonly targetPlan: ShotPlanReviewItem | null;
  readonly shotPlans: readonly ShotPlanReviewItem[];
  readonly currentSpecRevision: number;
  readonly initialSourceShotPlanId?: string | undefined;
  readonly onClose: () => void;
}

interface ComparisonOutcome {
  readonly diff: ShotPlanSemanticDiff | null;
  readonly rejectionMessage: string | null;
}

function computeOutcome(
  source: ShotPlanReviewItem,
  target: ShotPlanReviewItem,
  currentSpecRevision: number
): ComparisonOutcome {
  const comparability = evaluateShotPlanComparability(source, target, currentSpecRevision);
  if (!comparability.eligible) {
    return {
      diff: null,
      rejectionMessage:
        comparability.rejectionCode === "CROSS_SCENE_COMPARISON"
          ? "These ShotPlans belong to different scenes and cannot be compared."
          : "A ShotPlan cannot be compared against itself."
    };
  }
  try {
    return {
      diff: computeShotPlanSemanticDiff(source, target, { currentSpecRevision }),
      rejectionMessage: null
    };
  } catch (err) {
    if (err instanceof ShotPlanComparisonRejectedError) {
      return { diff: null, rejectionMessage: err.message };
    }
    throw err;
  }
}

function revisionLabel(
  isCurrentRevision: boolean,
  specRevision: number,
  currentSpecRevision: number
): "revision-current" | "revision-stale" {
  return isCurrentRevision && specRevision === currentSpecRevision
    ? "revision-current"
    : "revision-stale";
}

export function ShotPlanComparisonModal({
  isOpen,
  targetPlan,
  shotPlans,
  currentSpecRevision,
  initialSourceShotPlanId,
  onClose
}: ShotPlanComparisonModalProps) {
  const [manualSourceId, setManualSourceId] = useState<string | null>(null);

  const lineage = useMemo(() => {
    if (!targetPlan) return null;
    return resolveShotPlanDiffSource(targetPlan, shotPlans);
  }, [targetPlan, shotPlans]);

  if (!isOpen || !targetPlan) {
    return null;
  }

  const otherPlans = shotPlans.filter((p) => p.shotPlanId !== targetPlan.shotPlanId);

  const selectedSourceId =
    manualSourceId ?? initialSourceShotPlanId ?? lineage?.sourceShotPlanId ?? null;
  const sourcePlan =
    otherPlans.find((p) => p.shotPlanId === selectedSourceId) ??
    (lineage?.sourcePlan as ShotPlanReviewItem | null) ??
    null;

  const isDerivedRelationship =
    Boolean(lineage?.sourceShotPlanId) && lineage?.sourceShotPlanId === selectedSourceId;

  const outcome = sourcePlan ? computeOutcome(sourcePlan, targetPlan, currentSpecRevision) : null;
  const diff = outcome?.diff ?? null;

  return (
    <div
      className="shot-plan-comparison-modal-backdrop"
      data-testid="shot-plan-comparison-modal-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shot-plan-comparison-title"
        className="shot-plan-comparison-modal"
        data-testid="shot-plan-comparison-modal"
        data-comparison-scope={diff?.comparisonScope}
      >
        <div className="shot-plan-comparison-modal-header">
          <h3 id="shot-plan-comparison-title">
            {sourcePlan
              ? isDerivedRelationship
                ? `V${targetPlan.variantOrdinal} — Variation of V${sourcePlan.variantOrdinal}`
                : `V${targetPlan.variantOrdinal} vs V${sourcePlan.variantOrdinal}`
              : `V${targetPlan.variantOrdinal} — Compare`}
          </h3>
        </div>

        {!sourcePlan && (
          <div
            className="shot-plan-comparison-source-picker"
            data-testid="comparison-source-picker"
          >
            <label htmlFor="comparison-source-select">Compare against</label>
            <select
              id="comparison-source-select"
              data-testid="comparison-source-select"
              value=""
              onChange={(e) => setManualSourceId(e.target.value || null)}
            >
              <option value="" disabled>
                Select a source ShotPlan…
              </option>
              {otherPlans.map((p) => (
                <option key={p.shotPlanId} value={p.shotPlanId}>
                  V{p.variantOrdinal} (Rev {p.specRevision})
                </option>
              ))}
            </select>
          </div>
        )}

        {sourcePlan && outcome && !outcome.diff && (
          <div
            className="shot-plan-comparison-rejected"
            data-testid="comparison-rejected"
            role="alert"
          >
            {outcome.rejectionMessage}
          </div>
        )}

        {sourcePlan && diff && (
          <ShotPlanComparisonBody
            diff={diff}
            targetPlan={targetPlan}
            sourcePlan={sourcePlan}
            currentSpecRevision={currentSpecRevision}
          />
        )}

        <div className="shot-plan-comparison-modal-actions">
          <button
            type="button"
            className="action-button"
            data-testid="close-comparison-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function PrevisThumbnail({
  label,
  plan
}: {
  readonly label: string;
  readonly plan: ShotPlanReviewItem;
}) {
  if (!plan.previs?.media?.available || !plan.previs.media.url) {
    return null;
  }
  return (
    <div className="shot-plan-comparison-previs-thumb" data-testid="comparison-previs-thumbnail">
      <span className="comparison-previs-label">
        {label} — planning context only, non-authoritative
      </span>
      <img src={plan.previs.media.url} alt={`${label} previs`} />
    </div>
  );
}

function ShotPlanComparisonBody({
  diff,
  targetPlan,
  sourcePlan,
  currentSpecRevision
}: {
  readonly diff: ShotPlanSemanticDiff;
  readonly targetPlan: ShotPlanReviewItem;
  readonly sourcePlan: ShotPlanReviewItem;
  readonly currentSpecRevision: number;
}) {
  const changedGroups = diff.groups.filter(
    (g) =>
      g.fields.some((f) => f.status !== "unchanged") ||
      g.collections.some(
        (e) => e.status !== "unchanged" || e.fields.some((f) => f.status !== "unchanged")
      )
  );
  const unchangedCount = diff.unchangedFieldCount;

  return (
    <div className="shot-plan-comparison-body">
      <div className="shot-plan-comparison-revision-badges">
        <span
          className={`shot-plan-revision-badge ${revisionLabel(diff.source.isCurrentRevision, diff.source.specRevision, currentSpecRevision)}`}
          data-testid="comparison-source-revision-badge"
        >
          Source: V{diff.source.variantOrdinal} · Rev {diff.source.specRevision}{" "}
          {revisionLabel(
            diff.source.isCurrentRevision,
            diff.source.specRevision,
            currentSpecRevision
          ) === "revision-current"
            ? "(Current)"
            : "(Stale)"}
        </span>
        <span
          className={`shot-plan-revision-badge ${revisionLabel(diff.target.isCurrentRevision, diff.target.specRevision, currentSpecRevision)}`}
          data-testid="comparison-target-revision-badge"
        >
          Target: V{diff.target.variantOrdinal} · Rev {diff.target.specRevision}{" "}
          {revisionLabel(
            diff.target.isCurrentRevision,
            diff.target.specRevision,
            currentSpecRevision
          ) === "revision-current"
            ? "(Current)"
            : "(Stale)"}
        </span>
      </div>

      {diff.comparisonScope === "historical" && (
        <div
          className="shot-plan-comparison-historical-fence"
          data-testid="comparison-historical-fence"
          role="note"
        >
          This is a historical or cross-revision comparison. It does not reflect current selection
          or approval state and cannot be used to select or approve a ShotPlan.
        </div>
      )}

      <div className="shot-plan-comparison-previs-row">
        <PrevisThumbnail label="Source" plan={sourcePlan} />
        <PrevisThumbnail label="Target" plan={targetPlan} />
      </div>

      <div
        className="shot-plan-comparison-read-only-notice"
        data-testid="comparison-read-only-notice"
      >
        {diff.readOnlyNotice}
      </div>

      <div
        className="shot-plan-comparison-changed-section"
        data-testid="comparison-changed-section"
      >
        <h4>Changed</h4>
        {changedGroups.length === 0 ? (
          <p data-testid="comparison-no-changes">No material changes</p>
        ) : (
          changedGroups.map((group) => (
            <div key={group.group} className="shot-plan-comparison-group">
              <h5>{group.label}</h5>
              {/* Design D9 / issue mock-up row shape: "Label    before -> after". */}
              {group.fields
                .filter((f) => f.status !== "unchanged")
                .map((field) => (
                  <div
                    key={field.key}
                    className="shot-plan-comparison-row"
                    data-testid="comparison-changed-row"
                    data-field-key={field.key}
                    data-status={field.status}
                  >
                    <span className="comparison-row-label">{field.label}</span>
                    <span className="comparison-row-values">
                      {field.before.display ?? "—"} <span aria-hidden="true">→</span>{" "}
                      {field.after.display ?? "—"}
                    </span>
                  </div>
                ))}
              {group.collections
                .filter(
                  (entry) =>
                    entry.status !== "unchanged" ||
                    entry.fields.some((f) => f.status !== "unchanged")
                )
                .map((entry) => (
                  <div key={entry.entryKey} className="shot-plan-comparison-collection-entry">
                    <h6>
                      {entry.label}{" "}
                      {entry.status !== "unchanged" && (
                        <span className="comparison-entry-status">({entry.status})</span>
                      )}
                    </h6>
                    {entry.fields
                      .filter((f) => f.status !== "unchanged")
                      .map((field) => (
                        <div
                          key={field.key}
                          className="shot-plan-comparison-row"
                          data-testid="comparison-changed-row"
                          data-field-key={`${entry.entryKey}.${field.key}`}
                          data-status={field.status}
                        >
                          <span className="comparison-row-label">{field.label}</span>
                          <span className="comparison-row-values">
                            {field.before.display ?? "—"} <span aria-hidden="true">→</span>{" "}
                            {field.after.display ?? "—"}
                          </span>
                        </div>
                      ))}
                  </div>
                ))}
            </div>
          ))
        )}
      </div>

      <details
        className="shot-plan-comparison-unchanged-section"
        data-testid="comparison-unchanged-section"
      >
        <summary>Unchanged ({unchangedCount})</summary>
        {diff.groups.map((group) => {
          const unchangedFields = group.fields.filter((f) => f.status === "unchanged");
          const unchangedEntries = group.collections
            .map((entry) => ({
              entry,
              unchangedFields: entry.fields.filter((f) => f.status === "unchanged")
            }))
            .filter(({ unchangedFields: fields }) => fields.length > 0);
          if (unchangedFields.length === 0 && unchangedEntries.length === 0) {
            return null;
          }
          return (
            <div key={group.group} className="shot-plan-comparison-group">
              <h5>{group.label}</h5>
              {unchangedFields.map((field) => (
                <div
                  key={field.key}
                  className="shot-plan-comparison-row shot-plan-comparison-row-unchanged"
                  data-testid="comparison-unchanged-row"
                  data-field-key={field.key}
                  data-status={field.status}
                >
                  <span className="comparison-row-label">{field.label}</span>
                  <span className="comparison-row-values">{field.after.display ?? "—"}</span>
                </div>
              ))}
              {unchangedEntries.map(({ entry, unchangedFields: fields }) => (
                <div key={entry.entryKey} className="shot-plan-comparison-collection-entry">
                  <h6>{entry.label}</h6>
                  {fields.map((field) => (
                    <div
                      key={field.key}
                      className="shot-plan-comparison-row shot-plan-comparison-row-unchanged"
                      data-testid="comparison-unchanged-row"
                      data-field-key={`${entry.entryKey}.${field.key}`}
                      data-status={field.status}
                    >
                      <span className="comparison-row-label">{field.label}</span>
                      <span className="comparison-row-values">{field.after.display ?? "—"}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </details>
    </div>
  );
}

export default ShotPlanComparisonModal;
