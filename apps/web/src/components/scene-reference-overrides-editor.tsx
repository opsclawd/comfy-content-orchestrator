"use client";

import React, { useState } from "react";
import type { ReferenceAssetResponse, ReferenceRole } from "@cco/contracts";
import { ReferenceLibraryDrawer } from "./reference-library/reference-library-drawer";
import { SceneRolePickerModal } from "./scene-role-picker-modal";

export interface VisualReferenceBindingItem {
  readonly referenceAssetId: string;
  readonly role: ReferenceRole;
  readonly displayName?: string | null | undefined;
  readonly libraryRole?: ReferenceRole | string | null | undefined;
  readonly previewUrl?: string | null | undefined;
  readonly previewAvailability?: string | null | undefined;
  readonly weight?: number | null | undefined;
  readonly hints?: Record<string, unknown> | null | undefined;
}

export interface SceneReferenceOverridesEditorProps {
  readonly clientId?: string | undefined;
  readonly bindings: readonly VisualReferenceBindingItem[];
  readonly onChange: (bindings: readonly VisualReferenceBindingItem[]) => void;
  readonly disabled?: boolean | undefined;
}

const ALL_ROLES: readonly ReferenceRole[] = [
  "subject_identity",
  "product",
  "location",
  "style",
  "composition"
];

function isKnownReferenceRole(role: unknown): role is ReferenceRole {
  return typeof role === "string" && ALL_ROLES.includes(role as ReferenceRole);
}

export function SceneReferenceOverridesEditor({
  clientId,
  bindings,
  onChange,
  disabled = false
}: SceneReferenceOverridesEditorProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pendingAssetForRole, setPendingAssetForRole] = useState<ReferenceAssetResponse | null>(
    null
  );

  const isAtLimit = bindings.length >= 9;

  const handleRoleChange = (referenceAssetId: string, newRole: ReferenceRole) => {
    const updated = bindings.map((b) =>
      b.referenceAssetId === referenceAssetId ? { ...b, role: newRole } : b
    );
    onChange(updated);
  };

  const handleRemove = (referenceAssetId: string) => {
    const updated = bindings.filter((b) => b.referenceAssetId !== referenceAssetId);
    onChange(updated);
  };

  const handleSelectAssetFromDrawer = (asset: ReferenceAssetResponse) => {
    // Open the role picker modal for explicit scene-role assignment
    setPendingAssetForRole(asset);
    setIsDrawerOpen(false);
  };

  const handleConfirmRole = (selectedRole: ReferenceRole) => {
    if (!pendingAssetForRole) return;

    const existingIndex = bindings.findIndex((b) => b.referenceAssetId === pendingAssetForRole.id);

    const newItem: VisualReferenceBindingItem = {
      referenceAssetId: pendingAssetForRole.id,
      role: selectedRole,
      displayName: pendingAssetForRole.displayName,
      libraryRole: pendingAssetForRole.libraryRole,
      previewUrl: pendingAssetForRole.previewUrl,
      previewAvailability: pendingAssetForRole.previewAvailability
    };

    if (existingIndex >= 0) {
      const updated = [...bindings];
      updated[existingIndex] = newItem;
      onChange(updated);
    } else {
      if (bindings.length >= 9) {
        setPendingAssetForRole(null);
        return;
      }
      onChange([...bindings, newItem]);
    }

    setPendingAssetForRole(null);
  };

  const initialRoleForPendingAsset: ReferenceRole = pendingAssetForRole
    ? (bindings.find((b) => b.referenceAssetId === pendingAssetForRole.id)?.role ??
      (isKnownReferenceRole(pendingAssetForRole.libraryRole)
        ? pendingAssetForRole.libraryRole
        : "subject_identity"))
    : "subject_identity";

  return (
    <div
      className="scene-reference-overrides-editor"
      data-testid="scene-reference-overrides-editor"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}
      >
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: "var(--text-primary, #f8fafc)"
          }}
        >
          Production Visual References ({bindings.length}/9)
        </span>
        {!isAtLimit && clientId && (
          <button
            type="button"
            className="add-reference-button"
            data-testid="add-reference-button"
            onClick={() => setIsDrawerOpen(true)}
            disabled={disabled}
            style={{
              padding: "0.375rem 0.75rem",
              borderRadius: "var(--radius-sm, 6px)",
              border: "1px solid var(--color-primary, #38bdf8)",
              backgroundColor: "rgba(56, 189, 248, 0.1)",
              color: "var(--color-primary, #38bdf8)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: disabled ? "not-allowed" : "pointer"
            }}
          >
            + Add reference
          </button>
        )}
      </div>

      {!clientId && (
        <div
          data-testid="no-client-warning"
          style={{
            padding: "0.625rem 0.875rem",
            backgroundColor: "rgba(234, 179, 8, 0.1)",
            border: "1px solid rgba(234, 179, 8, 0.3)",
            borderRadius: "var(--radius-sm, 6px)",
            color: "#fde047",
            fontSize: "0.8125rem"
          }}
        >
          Client ID unavailable for this scene; Reference Library access is restricted.
        </div>
      )}

      {isAtLimit && (
        <div
          data-testid="max-references-reached"
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: "rgba(148, 163, 184, 0.1)",
            borderRadius: "var(--radius-sm, 6px)",
            color: "var(--text-muted, #94a3b8)",
            fontSize: "0.8125rem"
          }}
        >
          Maximum of 9 visual reference assets reached. Remove a reference to add another.
        </div>
      )}

      {bindings.length === 0 ? (
        <div
          data-testid="empty-references-message"
          style={{
            padding: "1.5rem",
            textAlign: "center",
            backgroundColor: "var(--bg-primary, #0f172a)",
            border: "1px dashed var(--border-subtle, #334155)",
            borderRadius: "var(--radius-sm, 6px)",
            color: "var(--text-muted, #94a3b8)",
            fontSize: "0.875rem"
          }}
        >
          No visual production references currently bound to this scene.
        </div>
      ) : (
        <div
          className="production-references-list"
          data-testid="production-references-list"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem"
          }}
        >
          {bindings.map((binding) => {
            const hasPreview =
              binding.previewAvailability === "available" && Boolean(binding.previewUrl);
            const displayName = binding.displayName || binding.referenceAssetId.slice(0, 8);

            return (
              <div
                key={binding.referenceAssetId}
                className="reference-override-card"
                data-testid={`reference-override-card-${binding.referenceAssetId}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.625rem 0.875rem",
                  backgroundColor: "var(--bg-primary, #0f172a)",
                  border: "1px solid var(--border-subtle, #334155)",
                  borderRadius: "var(--radius-sm, 6px)",
                  gap: "1rem"
                }}
              >
                {/* Media thumbnail */}
                <div
                  style={{
                    width: "48px",
                    height: "48px",
                    borderRadius: "4px",
                    overflow: "hidden",
                    backgroundColor: "#020617",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0
                  }}
                >
                  {hasPreview ? (
                    <img
                      src={binding.previewUrl!}
                      alt={displayName}
                      data-testid={`reference-preview-${binding.referenceAssetId}`}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      data-testid={`reference-placeholder-${binding.referenceAssetId}`}
                      style={{ fontSize: "0.6875rem", color: "var(--text-muted, #94a3b8)" }}
                    >
                      Image
                    </span>
                  )}
                </div>

                {/* Identity & Library Role */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    data-testid={`reference-name-${binding.referenceAssetId}`}
                    style={{
                      fontWeight: 600,
                      fontSize: "0.875rem",
                      color: "var(--text-primary, #f8fafc)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    data-testid={`reference-library-role-${binding.referenceAssetId}`}
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted, #94a3b8)",
                      marginTop: "0.125rem"
                    }}
                  >
                    Library role:{" "}
                    <span
                      style={{
                        padding: "0.0625rem 0.25rem",
                        borderRadius: "3px",
                        backgroundColor: "rgba(148, 163, 184, 0.15)",
                        color: "var(--text-secondary, #cbd5e1)",
                        fontSize: "0.6875rem"
                      }}
                    >
                      {binding.libraryRole ?? "unassigned"}
                    </span>
                  </div>
                </div>

                {/* Scene Role Selector */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <label
                    htmlFor={`scene-role-select-${binding.referenceAssetId}`}
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-muted, #94a3b8)",
                      whiteSpace: "nowrap"
                    }}
                  >
                    Scene Role:
                  </label>
                  <select
                    id={`scene-role-select-${binding.referenceAssetId}`}
                    data-testid={`scene-role-select-${binding.referenceAssetId}`}
                    value={binding.role}
                    onChange={(e) =>
                      handleRoleChange(binding.referenceAssetId, e.target.value as ReferenceRole)
                    }
                    disabled={disabled}
                    style={{
                      padding: "0.3125rem 0.5rem",
                      backgroundColor: "var(--bg-surface, #1e293b)",
                      color: "var(--text-primary, #f8fafc)",
                      border: "1px solid var(--border-prominent, #475569)",
                      borderRadius: "var(--radius-sm, 4px)",
                      fontSize: "0.8125rem"
                    }}
                  >
                    {ALL_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Remove Button */}
                <button
                  type="button"
                  data-testid={`remove-reference-${binding.referenceAssetId}`}
                  onClick={() => handleRemove(binding.referenceAssetId)}
                  disabled={disabled}
                  style={{
                    padding: "0.3125rem 0.625rem",
                    borderRadius: "var(--radius-sm, 4px)",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    backgroundColor: "rgba(239, 68, 68, 0.1)",
                    color: "var(--color-danger, #ef4444)",
                    fontSize: "0.75rem",
                    cursor: disabled ? "not-allowed" : "pointer"
                  }}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Library Drawer Integration */}
      {clientId && (
        <ReferenceLibraryDrawer
          clientId={clientId}
          isOpen={isDrawerOpen}
          onClose={() => setIsDrawerOpen(false)}
          selectedIds={bindings.map((b) => b.referenceAssetId)}
          onSelectAsset={handleSelectAssetFromDrawer}
        />
      )}

      {/* Role Picker Modal */}
      {pendingAssetForRole && (
        <SceneRolePickerModal
          key={pendingAssetForRole.id}
          isOpen={true}
          onClose={() => setPendingAssetForRole(null)}
          onConfirm={handleConfirmRole}
          asset={pendingAssetForRole}
          initialRole={initialRoleForPendingAsset}
        />
      )}
    </div>
  );
}
