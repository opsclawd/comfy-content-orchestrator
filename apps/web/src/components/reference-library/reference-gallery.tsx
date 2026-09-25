"use client";

import React from "react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { ReferenceCard } from "./reference-card";

export interface ReferenceGalleryProps {
  readonly references: readonly ReferenceAssetResponse[];
  readonly selectedIds?: readonly string[] | undefined;
  readonly onToggleSelect?: ((id: string) => void) | undefined;
  readonly onArchive?: ((reference: ReferenceAssetResponse) => void) | undefined;
  readonly onEditRole?: ((reference: ReferenceAssetResponse) => void) | undefined;
  readonly selectable?: boolean | undefined;
  readonly isLoading?: boolean | undefined;
  readonly error?: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
  readonly emptyMessage?: string | undefined;
  readonly expectedClientId?: string | undefined;
}

export function ReferenceGallery({
  references,
  selectedIds = [],
  onToggleSelect,
  onArchive,
  onEditRole,
  selectable = false,
  isLoading = false,
  error = null,
  onRetry,
  emptyMessage = "No active reference assets found for this client.",
  expectedClientId
}: ReferenceGalleryProps) {
  // Exclude archived references and any references not belonging to expectedClientId (if specified)
  const activeReferences = references.filter(
    (ref) => !ref.archivedAt && (!expectedClientId || ref.clientId === expectedClientId)
  );

  const selectedSet = new Set(selectedIds);

  if (isLoading) {
    return (
      <div
        data-testid="reference-gallery-loading"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "3rem 1rem",
          color: "var(--text-muted)",
          fontSize: "0.875rem"
        }}
      >
        <span>Loading reference assets...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="reference-gallery-error"
        style={{
          padding: "1rem",
          borderRadius: "var(--radius-md)",
          backgroundColor: "var(--status-failed-bg)",
          border: "1px solid var(--status-failed-border)",
          color: "var(--status-failed-text)",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          alignItems: "flex-start"
        }}
      >
        <span style={{ fontSize: "0.875rem" }}>{error}</span>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid="reference-gallery-retry-button"
            style={{
              padding: "0.25rem 0.75rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--status-failed-border)",
              backgroundColor: "transparent",
              color: "var(--status-failed-text)",
              fontSize: "0.75rem",
              cursor: "pointer"
            }}
          >
            Reload
          </button>
        )}
      </div>
    );
  }

  if (activeReferences.length === 0) {
    return (
      <div
        data-testid="reference-gallery-empty"
        style={{
          padding: "3rem 1rem",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: "0.875rem",
          backgroundColor: "var(--bg-surface)",
          borderRadius: "var(--radius-md)",
          border: "1px dashed var(--border-subtle)"
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div
      data-testid="reference-gallery-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "1rem"
      }}
    >
      {activeReferences.map((ref) => (
        <ReferenceCard
          key={ref.id}
          reference={ref}
          isSelected={selectedSet.has(ref.id)}
          onToggleSelect={onToggleSelect}
          onArchive={onArchive}
          onEditRole={onEditRole}
          selectable={selectable}
        />
      ))}
    </div>
  );
}
