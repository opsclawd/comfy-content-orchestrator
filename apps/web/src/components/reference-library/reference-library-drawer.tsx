"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { listClientReferences, ApiClientError } from "../../api/client";
import { ReferenceGallery } from "./reference-gallery";
import { ReferenceUploadModal } from "./reference-upload-modal";
import { ReferenceArchiveModal } from "./reference-archive-modal";
import { ReferenceRoleModal } from "./reference-role-modal";

export interface ReferenceLibraryDrawerProps {
  readonly clientId: string;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly selectedIds?: readonly string[] | undefined;
  readonly onToggleSelect?: ((id: string) => void) | undefined;
  readonly onReferenceArchived?: ((archivedId: string) => void) | undefined;
  readonly onReferenceAdded?: ((newReference: ReferenceAssetResponse) => void) | undefined;
  readonly onReferenceUpdated?: ((updatedReference: ReferenceAssetResponse) => void) | undefined;
}

export function ReferenceLibraryDrawer({
  clientId,
  isOpen,
  onClose,
  selectedIds = [],
  onToggleSelect,
  onReferenceArchived,
  onReferenceAdded,
  onReferenceUpdated
}: ReferenceLibraryDrawerProps) {
  const [referenceState, setReferenceState] = useState<{
    clientId: string;
    references: readonly ReferenceAssetResponse[];
    isLoading: boolean;
    error: string | null;
  }>({
    clientId,
    references: [],
    isLoading: false,
    error: null
  });

  // Modals
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<ReferenceAssetResponse | null>(null);
  const [roleEditTarget, setRoleEditTarget] = useState<ReferenceAssetResponse | null>(null);

  const prevClientIdRef = useRef(clientId);
  const fetchGenerationRef = useRef(0);

  // Synchronously invalidate request generation on every clientId change
  if (prevClientIdRef.current !== clientId) {
    prevClientIdRef.current = clientId;
    fetchGenerationRef.current++;
  }

  // Key rendered/loading state by client
  const isCurrentClient = referenceState.clientId === clientId;
  const references = isCurrentClient ? referenceState.references : [];
  const isLoading = isCurrentClient ? referenceState.isLoading : isOpen && Boolean(clientId.trim());
  const error = isCurrentClient ? referenceState.error : null;

  const fetchReferences = useCallback(async (targetClientId: string) => {
    const trimmedId = targetClientId.trim();
    if (!trimmedId) {
      setReferenceState({
        clientId: targetClientId,
        references: [],
        isLoading: false,
        error: null
      });
      return;
    }

    const currentGeneration = ++fetchGenerationRef.current;
    setReferenceState({
      clientId: targetClientId,
      references: [],
      isLoading: true,
      error: null
    });

    try {
      const data = await listClientReferences(trimmedId);
      if (fetchGenerationRef.current === currentGeneration) {
        const filtered = data.filter((ref) => ref.clientId === trimmedId && !ref.archivedAt);
        setReferenceState({
          clientId: targetClientId,
          references: filtered,
          isLoading: false,
          error: null
        });
      }
    } catch (err) {
      if (fetchGenerationRef.current === currentGeneration) {
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load client references.";
        setReferenceState({
          clientId: targetClientId,
          references: [],
          isLoading: false,
          error: msg
        });
      }
    }
  }, []);

  // Fetch when opened or when clientId changes
  useEffect(() => {
    if (isOpen && clientId) {
      fetchReferences(clientId);
    } else if (!isOpen) {
      // Clear modals when drawer closes
      setIsUploadOpen(false);
      setArchiveTarget(null);
      setRoleEditTarget(null);
    }
  }, [isOpen, clientId, fetchReferences]);

  const handleToggleSelect = useCallback(
    (id: string) => {
      if (!onToggleSelect) return;
      // Refuse toggle if the id is not an active reference of the current client
      const activeRef = references.find(
        (r) => r.id === id && r.clientId === clientId && !r.archivedAt
      );
      if (activeRef) {
        onToggleSelect(id);
      }
    },
    [onToggleSelect, references, clientId]
  );

  const handleRetry = useCallback(() => {
    if (clientId) {
      fetchReferences(clientId);
    }
  }, [clientId, fetchReferences]);

  if (!isOpen) return null;

  const handleUploadSuccess = (newRef: ReferenceAssetResponse) => {
    if (newRef.clientId === clientId && !newRef.archivedAt) {
      setReferenceState((prev) => {
        if (prev.clientId !== clientId) return prev;
        return {
          ...prev,
          references: [newRef, ...prev.references.filter((r) => r.id !== newRef.id)]
        };
      });
      if (onReferenceAdded) {
        onReferenceAdded(newRef);
      }
    }
  };

  const handleArchiveSuccess = (archivedId: string) => {
    setReferenceState((prev) => {
      if (prev.clientId !== clientId) return prev;
      return {
        ...prev,
        references: prev.references.filter((r) => r.id !== archivedId)
      };
    });
    if (onReferenceArchived) {
      onReferenceArchived(archivedId);
    }
  };

  const handleRoleUpdated = (updated: ReferenceAssetResponse) => {
    if (updated.clientId === clientId) {
      setReferenceState((prev) => {
        if (prev.clientId !== clientId) return prev;
        const filtered = updated.archivedAt
          ? prev.references.filter((r) => r.id !== updated.id)
          : prev.references.map((r) => (r.id === updated.id ? updated : r));
        return {
          ...prev,
          references: filtered
        };
      });
      if (onReferenceUpdated) {
        onReferenceUpdated(updated);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Client Reference Library"
      data-testid="reference-library-drawer"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 900
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "800px",
          height: "100%",
          backgroundColor: "var(--bg-primary)",
          borderLeft: "1px solid var(--border-prominent)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-10px 0 25px -5px rgba(0, 0, 0, 0.5)"
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Client Reference Library
            </h2>
            <p style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
              Active reusable image assets for client{" "}
              <code style={{ color: "var(--color-primary)" }}>{clientId}</code>
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <button
              type="button"
              data-testid="open-upload-modal-button"
              onClick={() => setIsUploadOpen(true)}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "var(--radius-sm)",
                border: "none",
                backgroundColor: "var(--color-primary)",
                color: "#0f172a",
                fontWeight: 600,
                fontSize: "0.875rem",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem"
              }}
            >
              <span>+</span> Upload Reference
            </button>
            <button
              type="button"
              data-testid="close-drawer-button"
              onClick={onClose}
              aria-label="Close drawer"
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "1.5rem",
                padding: "0.25rem 0.5rem"
              }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Gallery Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
          <ReferenceGallery
            references={references}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect ? handleToggleSelect : undefined}
            onArchive={(ref) => setArchiveTarget(ref)}
            onEditRole={(ref) => setRoleEditTarget(ref)}
            selectable={Boolean(onToggleSelect)}
            isLoading={isLoading}
            error={error}
            onRetry={handleRetry}
            expectedClientId={clientId}
          />
        </div>
      </div>

      {/* Sub-modals */}
      <ReferenceUploadModal
        clientId={clientId}
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={handleUploadSuccess}
      />

      <ReferenceArchiveModal
        reference={archiveTarget}
        isOpen={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onArchiveSuccess={handleArchiveSuccess}
      />

      <ReferenceRoleModal
        reference={roleEditTarget}
        isOpen={roleEditTarget !== null}
        onClose={() => setRoleEditTarget(null)}
        onRoleUpdated={handleRoleUpdated}
      />
    </div>
  );
}
