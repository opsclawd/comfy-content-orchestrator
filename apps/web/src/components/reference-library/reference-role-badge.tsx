"use client";

import React from "react";
import type { ReferenceRole } from "@cco/contracts";

export interface ReferenceRoleBadgeProps {
  readonly role?: ReferenceRole | null | undefined;
  readonly className?: string;
}

const ROLE_LABELS: Record<ReferenceRole, string> = {
  subject_identity: "Subject Identity",
  product: "Product",
  location: "Location",
  style: "Style",
  composition: "Composition"
};

const ROLE_COLORS: Record<ReferenceRole, { bg: string; text: string; border: string }> = {
  subject_identity: {
    bg: "rgba(56, 189, 248, 0.15)",
    text: "var(--color-primary)",
    border: "rgba(56, 189, 248, 0.3)"
  },
  product: {
    bg: "rgba(168, 85, 247, 0.15)",
    text: "#c084fc",
    border: "rgba(168, 85, 247, 0.3)"
  },
  location: {
    bg: "rgba(34, 197, 94, 0.15)",
    text: "#4ade80",
    border: "rgba(34, 197, 94, 0.3)"
  },
  style: {
    bg: "rgba(245, 158, 11, 0.15)",
    text: "#fbbf24",
    border: "rgba(245, 158, 11, 0.3)"
  },
  composition: {
    bg: "rgba(236, 72, 153, 0.15)",
    text: "#f472b6",
    border: "rgba(236, 72, 153, 0.3)"
  }
};

const UNASSIGNED_COLOR = {
  bg: "rgba(148, 163, 184, 0.15)",
  text: "var(--text-secondary)",
  border: "rgba(148, 163, 184, 0.3)"
};

export function ReferenceRoleBadge({ role, className = "" }: ReferenceRoleBadgeProps) {
  const isAssigned = role !== null && role !== undefined && role in ROLE_LABELS;
  const label = isAssigned ? ROLE_LABELS[role as ReferenceRole] : "Unassigned";
  const colors = isAssigned ? ROLE_COLORS[role as ReferenceRole] : UNASSIGNED_COLOR;

  return (
    <span
      className={`reference-role-badge ${className}`}
      data-testid="reference-role-badge"
      data-role={isAssigned ? role : "unassigned"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: "0.75rem",
        fontWeight: 600,
        padding: "0.15rem 0.5rem",
        borderRadius: "999px",
        backgroundColor: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.border}`,
        lineHeight: 1.2,
        whiteSpace: "nowrap"
      }}
    >
      {label}
    </span>
  );
}
