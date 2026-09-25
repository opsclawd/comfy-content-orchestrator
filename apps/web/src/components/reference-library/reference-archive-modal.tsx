"use client";

import React, { useState } from "react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { archiveClientReference, ApiClientError } from "../../api/client";

export interface ReferenceArchiveModalProps {
  readonly reference: ReferenceAssetResponse | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onArchiveSuccess: (archivedReferenceId: string) => void;
}

export function ReferenceArchiveModal({
  reference,
  isOpen,
  onClose,
  onArchiveSuccess
}: ReferenceArchiveModalProps) {
  const [isArchiving, setIsArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !reference) return null;

  const displayName = reference.displayName ?? reference.contentHashSha256.slice(0, 16);

  const handleConfirm = async () => {
    setIsArchiving(true);
    setError(null);

    try {
      await archiveClientReference(reference.clientId, reference.id);
      onArchiveSuccess(reference.id);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to archive reference asset.";
      setError(message);
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-modal-title"
      data-testid="reference-archive-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "1rem"
      }}
    >
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-prominent)",
          borderRadius: "var(--radius-lg)",
          width: "100%",
          maxWidth: "460px",
          padding: "1.5rem",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "1rem"
        }}
      >
        <h2
          id="archive-modal-title"
          style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--text-primary)" }}
        >
          Archive Reference Asset?
        </h2>

        {error && (
          <div
            data-testid="archive-error-banner"
            style={{
              backgroundColor: "var(--status-failed-bg)",
              border: "1px solid var(--status-failed-border)",
              color: "var(--status-failed-text)",
              padding: "0.75rem",
              borderRadius: "var(--radius-sm)",
              fontSize: "0.875rem"
            }}
          >
            {error}
          </div>
        )}

        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
          Are you sure you want to archive <strong>&ldquo;{displayName}&rdquo;</strong>?
        </p>

        <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
          Archived references are removed from active view and will be excluded from new campaign
          creation selections. Existing storyboard scene bindings and historical renders remain
          intact.
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
            marginTop: "0.5rem"
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={isArchiving}
            data-testid="archive-cancel-button"
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-prominent)",
              backgroundColor: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: "0.875rem"
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isArchiving}
            data-testid="archive-confirm-button"
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              backgroundColor: isArchiving
                ? "var(--border-prominent)"
                : "var(--status-failed-border)",
              color: "#ffffff",
              fontWeight: 600,
              cursor: isArchiving ? "not-allowed" : "pointer",
              fontSize: "0.875rem"
            }}
          >
            {isArchiving ? "Archiving..." : "Archive Reference"}
          </button>
        </div>
      </div>
    </div>
  );
}
