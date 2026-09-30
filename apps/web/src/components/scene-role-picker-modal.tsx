"use client";

import React, { useState, useEffect } from "react";
import type { ReferenceRole } from "@cco/contracts";

export interface SceneRolePickerModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (role: ReferenceRole) => void;
  readonly asset: {
    readonly id: string;
    readonly displayName?: string | null | undefined;
    readonly libraryRole?: ReferenceRole | string | null | undefined;
    readonly previewUrl?: string | null | undefined;
    readonly previewAvailability?: string | null | undefined;
  } | null;
  readonly initialRole?: ReferenceRole;
}

const AVAILABLE_ROLES: readonly {
  readonly value: ReferenceRole;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: "subject_identity",
    label: "Subject Identity",
    description: "Actor, character face, or subject identity continuity authority"
  },
  {
    value: "product",
    label: "Product",
    description: "Hero commercial product geometry and brand visual authority"
  },
  {
    value: "location",
    label: "Location",
    description: "Environment, architectural space, or background visual authority"
  },
  {
    value: "style",
    label: "Style",
    description: "Lighting, color palette, grading, or artistic medium authority"
  },
  {
    value: "composition",
    label: "Composition",
    description: "Camera framing, spatial arrangement, and structural blocking authority"
  }
];

export function SceneRolePickerModal({
  isOpen,
  onClose,
  onConfirm,
  asset,
  initialRole = "subject_identity"
}: SceneRolePickerModalProps) {
  const [selectedRole, setSelectedRole] = useState<ReferenceRole>(initialRole);

  useEffect(() => {
    setSelectedRole(initialRole);
  }, [asset?.id, initialRole]);

  if (!isOpen || !asset) return null;

  const displayName = asset.displayName || asset.id.slice(0, 8);
  const hasPreview = asset.previewAvailability === "available" && Boolean(asset.previewUrl);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(selectedRole);
  };

  return (
    <div
      className="scene-role-picker-modal-backdrop"
      data-testid="scene-role-picker-modal-backdrop"
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="scene-role-picker-title"
        className="scene-role-picker-modal"
        data-testid="scene-role-picker-modal"
        style={{
          width: "100%",
          maxWidth: "520px",
          backgroundColor: "var(--bg-surface, #1e293b)",
          borderRadius: "var(--radius-md, 8px)",
          border: "1px solid var(--border-prominent, #475569)",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
          color: "var(--text-primary, #f8fafc)"
        }}
      >
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--border-subtle, #334155)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
        >
          <h3
            id="scene-role-picker-title"
            data-testid="scene-role-picker-title"
            style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}
          >
            Assign Scene Production Role
          </h3>
          <button
            type="button"
            data-testid="close-role-picker-button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted, #94a3b8)",
              cursor: "pointer",
              fontSize: "1.25rem",
              lineHeight: 1
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "1.5rem" }}>
          {/* Asset Summary */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              padding: "0.75rem",
              backgroundColor: "var(--bg-primary, #0f172a)",
              borderRadius: "var(--radius-sm, 6px)",
              marginBottom: "1.25rem",
              border: "1px solid var(--border-subtle, #334155)"
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
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
                  src={asset.previewUrl!}
                  alt={displayName}
                  data-testid="role-picker-asset-preview"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span
                  data-testid="role-picker-asset-placeholder"
                  style={{ fontSize: "0.75rem", color: "var(--text-muted, #94a3b8)" }}
                >
                  No image
                </span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                data-testid="role-picker-asset-name"
                style={{
                  fontWeight: 600,
                  fontSize: "0.9375rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {displayName}
              </div>
              <div
                data-testid="modal-library-role"
                style={{
                  fontSize: "0.8125rem",
                  color: "var(--text-muted, #94a3b8)",
                  marginTop: "0.25rem"
                }}
              >
                Library role:{" "}
                <span
                  style={{
                    display: "inline-block",
                    padding: "0.125rem 0.375rem",
                    borderRadius: "4px",
                    backgroundColor: "rgba(148, 163, 184, 0.15)",
                    color: "var(--text-primary, #f8fafc)",
                    fontWeight: 500,
                    fontSize: "0.75rem"
                  }}
                >
                  {asset.libraryRole ?? "unassigned"}
                </span>
              </div>
            </div>
          </div>

          {/* Role Selection */}
          <div style={{ marginBottom: "1.25rem" }}>
            <label
              htmlFor="scene-role-select"
              style={{
                display: "block",
                fontSize: "0.875rem",
                fontWeight: 500,
                marginBottom: "0.5rem"
              }}
            >
              Scene Production Role
            </label>
            <select
              id="scene-role-select"
              data-testid="scene-role-select"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as ReferenceRole)}
              style={{
                width: "100%",
                padding: "0.625rem 0.75rem",
                backgroundColor: "var(--bg-primary, #0f172a)",
                color: "var(--text-primary, #f8fafc)",
                border: "1px solid var(--border-prominent, #475569)",
                borderRadius: "var(--radius-sm, 6px)",
                fontSize: "0.875rem"
              }}
            >
              {AVAILABLE_ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label} ({r.value})
                </option>
              ))}
            </select>
            <p
              style={{
                fontSize: "0.8125rem",
                color: "var(--text-muted, #94a3b8)",
                marginTop: "0.5rem",
                lineHeight: 1.4
              }}
            >
              {AVAILABLE_ROLES.find((r) => r.value === selectedRole)?.description}
            </p>
          </div>

          <div
            style={{
              padding: "0.75rem 1rem",
              backgroundColor: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.2)",
              borderRadius: "var(--radius-sm, 6px)",
              fontSize: "0.8125rem",
              color: "#93c5fd",
              marginBottom: "1.5rem",
              lineHeight: 1.4
            }}
          >
            <strong>Authority Notice:</strong> The scene role dictates how MiniMax-H3 conditions
            this scene, independent of the library classification.
          </div>

          {/* Form Actions */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
            <button
              type="button"
              data-testid="cancel-scene-role-button"
              onClick={onClose}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "var(--radius-sm, 6px)",
                border: "1px solid var(--border-subtle, #334155)",
                backgroundColor: "transparent",
                color: "var(--text-primary, #f8fafc)",
                cursor: "pointer",
                fontSize: "0.875rem"
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="confirm-scene-role-button"
              style={{
                padding: "0.5rem 1.25rem",
                borderRadius: "var(--radius-sm, 6px)",
                border: "none",
                backgroundColor: "var(--color-primary, #38bdf8)",
                color: "#0f172a",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.875rem"
              }}
            >
              Apply Role
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
