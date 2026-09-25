"use client";

import React, { useState } from "react";
import type { ReferenceAssetResponse } from "@cco/contracts";
import { ReferenceRoleBadge } from "./reference-role-badge";

export interface ReferenceCardProps {
  readonly reference: ReferenceAssetResponse;
  readonly isSelected?: boolean | undefined;
  readonly onToggleSelect?: ((id: string) => void) | undefined;
  readonly onArchive?: ((reference: ReferenceAssetResponse) => void) | undefined;
  readonly onEditRole?: ((reference: ReferenceAssetResponse) => void) | undefined;
  readonly selectable?: boolean | undefined;
  readonly disabled?: boolean | undefined;
}

export function ReferenceCard({
  reference,
  isSelected = false,
  onToggleSelect,
  onArchive,
  onEditRole,
  selectable = false,
  disabled = false
}: ReferenceCardProps) {
  const [imageError, setImageError] = useState(false);

  const hasValidPreview =
    reference.previewAvailability === "available" && reference.previewUrl !== null && !imageError;

  const displayName = reference.displayName ?? reference.contentHashSha256.slice(0, 16);

  const handleClick = () => {
    if (!disabled && selectable && onToggleSelect) {
      onToggleSelect(reference.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!disabled && selectable && onToggleSelect && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      onToggleSelect(reference.id);
    }
  };

  const dimensionsLabel =
    reference.width && reference.height ? `${reference.width}×${reference.height}` : undefined;

  return (
    <div
      role={selectable ? "checkbox" : undefined}
      aria-checked={selectable ? isSelected : undefined}
      aria-label={`Reference asset: ${displayName}`}
      tabIndex={selectable && !disabled ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`reference-card-${reference.id}`}
      data-selected={isSelected ? "true" : "false"}
      data-reference-id={reference.id}
      className={`reference-card ${isSelected ? "selected" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        backgroundColor: isSelected ? "var(--bg-surface-elevated)" : "var(--bg-surface)",
        border: isSelected ? "2px solid var(--color-primary)" : "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
        position: "relative",
        cursor: selectable && !disabled ? "pointer" : "default",
        opacity: disabled ? 0.6 : 1,
        transition: "all 0.15s ease",
        outline: "none"
      }}
    >
      {/* Thumbnail or Fallback */}
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 9",
          backgroundColor: "#090d16",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden"
        }}
      >
        {hasValidPreview ? (
          <img
            src={reference.previewUrl!}
            alt={displayName}
            data-testid="reference-thumbnail"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover"
            }}
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            data-testid="reference-thumbnail-fallback"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.25rem",
              color: "var(--text-muted)",
              fontSize: "0.75rem",
              padding: "0.5rem",
              textAlign: "center"
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ opacity: 0.6 }}
            >
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
            </svg>
            <span>Preview unavailable</span>
          </div>
        )}

        {/* Selection Indicator Checkbox */}
        {selectable && (
          <div
            data-testid="reference-selection-indicator"
            style={{
              position: "absolute",
              top: "0.5rem",
              right: "0.5rem",
              width: "1.25rem",
              height: "1.25rem",
              borderRadius: "4px",
              backgroundColor: isSelected ? "var(--color-primary)" : "rgba(15, 23, 42, 0.75)",
              border: isSelected ? "none" : "1px solid var(--border-prominent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#0f172a",
              fontWeight: "bold",
              fontSize: "0.75rem",
              boxShadow: "0 1px 3px rgba(0,0,0,0.5)"
            }}
          >
            {isSelected && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        )}
      </div>

      {/* Details */}
      <div
        style={{
          padding: "0.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          flex: 1
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "0.5rem"
          }}
        >
          <strong
            data-testid="reference-display-name"
            style={{
              fontSize: "0.875rem",
              color: "var(--text-primary)",
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}
            title={displayName}
          >
            {displayName}
          </strong>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.5rem"
          }}
        >
          <ReferenceRoleBadge role={reference.libraryRole} />

          {onEditRole && (
            <button
              type="button"
              data-testid="edit-role-button"
              onClick={(e) => {
                e.stopPropagation();
                onEditRole(reference);
              }}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--color-primary)",
                fontSize: "0.75rem",
                cursor: "pointer",
                padding: "0.15rem 0.3rem",
                textDecoration: "underline"
              }}
            >
              Change
            </button>
          )}
        </div>

        {/* Supplemental Metadata */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.75rem",
            color: "var(--text-muted)",
            marginTop: "auto",
            paddingTop: "0.25rem",
            borderTop: "1px solid var(--border-subtle)"
          }}
        >
          <span>{reference.mimeType.replace("image/", "").toUpperCase()}</span>
          {dimensionsLabel && <span>{dimensionsLabel}</span>}

          {onArchive && (
            <button
              type="button"
              data-testid="archive-reference-button"
              onClick={(e) => {
                e.stopPropagation();
                onArchive(reference);
              }}
              title="Archive reference"
              aria-label={`Archive ${displayName}`}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--status-failed-border)",
                cursor: "pointer",
                fontSize: "0.75rem",
                padding: "0.2rem 0.4rem",
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem"
              }}
            >
              Archive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
