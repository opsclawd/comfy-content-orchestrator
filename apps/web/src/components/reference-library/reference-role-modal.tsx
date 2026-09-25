"use client";

import React, { useState, useEffect } from "react";
import { REFERENCE_ROLES, type ReferenceAssetResponse, type ReferenceRole } from "@cco/contracts";
import { updateClientReferenceRole, ApiClientError } from "../../api/client";

export interface ReferenceRoleModalProps {
  readonly reference: ReferenceAssetResponse | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRoleUpdated: (updated: ReferenceAssetResponse) => void;
}

const ROLE_LABELS: Record<ReferenceRole, string> = {
  subject_identity: "Subject Identity",
  product: "Product",
  location: "Location",
  style: "Style",
  composition: "Composition"
};

export function ReferenceRoleModal({
  reference,
  isOpen,
  onClose,
  onRoleUpdated
}: ReferenceRoleModalProps) {
  const [selectedRole, setSelectedRole] = useState<ReferenceRole>("subject_identity");
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (reference) {
      if (reference.libraryRole && reference.libraryRole in ROLE_LABELS) {
        setSelectedRole(reference.libraryRole as ReferenceRole);
      } else {
        setSelectedRole("subject_identity");
      }
      setError(null);
    }
  }, [reference, isOpen]);

  if (!isOpen || !reference) return null;

  const displayName = reference.displayName ?? reference.contentHashSha256.slice(0, 16);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdating(true);
    setError(null);

    try {
      const updated = await updateClientReferenceRole(
        reference.clientId,
        reference.id,
        selectedRole
      );
      onRoleUpdated(updated);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to update role.";
      setError(message);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-modal-title"
      data-testid="reference-role-modal"
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
          id="role-modal-title"
          style={{ fontSize: "1.125rem", fontWeight: 600, color: "var(--text-primary)" }}
        >
          Assign Library Role
        </h2>

        {error && (
          <div
            data-testid="role-error-banner"
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

        <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)" }}>
          Set the intended library classification for <strong>&ldquo;{displayName}&rdquo;</strong>:
        </p>

        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
        >
          <div>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ReferenceRole)}
              disabled={isUpdating}
              data-testid="role-modal-select"
              style={{
                width: "100%",
                padding: "0.625rem",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                fontSize: "0.875rem"
              }}
            >
              {REFERENCE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

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
              disabled={isUpdating}
              data-testid="role-cancel-button"
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
              type="submit"
              disabled={isUpdating}
              data-testid="role-save-button"
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "var(--radius-sm)",
                border: "none",
                backgroundColor: "var(--color-primary)",
                color: "#0f172a",
                fontWeight: 600,
                cursor: isUpdating ? "not-allowed" : "pointer",
                fontSize: "0.875rem"
              }}
            >
              {isUpdating ? "Saving..." : "Save Role"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
