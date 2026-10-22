import React from "react";

export interface BadgeProps {
  readonly label: string;
  readonly detail?: string | undefined;
  readonly title?: string | undefined;
  readonly testId?: string | undefined;
}

export function ProvenanceBadge({
  label,
  detail,
  title,
  testId,
  style
}: BadgeProps & { style?: React.CSSProperties }): React.ReactElement {
  return (
    <span
      data-testid={testId || `badge-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
      title={title || (detail ? `${label}: ${detail}` : label)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.25rem",
        fontSize: "0.75rem",
        fontWeight: 600,
        padding: "0.15rem 0.5rem",
        borderRadius: "4px",
        border: "1px solid var(--border-prominent, #475569)",
        backgroundColor: "var(--bg-surface-elevated, #334155)",
        color: "var(--text-primary, #f8fafc)",
        lineHeight: 1.3,
        ...style
      }}
    >
      <span style={{ textTransform: "uppercase", letterSpacing: "0.03em" }}>{label}</span>
      {detail && (
        <span
          style={{
            fontWeight: 400,
            color: "var(--text-secondary, #94a3b8)",
            borderLeft: "1px solid var(--border-subtle, #334155)",
            paddingLeft: "0.25rem",
            marginLeft: "0.1rem"
          }}
        >
          {detail}
        </span>
      )}
    </span>
  );
}

export function ReportedBadge({
  detail,
  testId
}: {
  detail?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Reported"
      detail={detail}
      testId={testId || "badge-reported"}
      style={{
        backgroundColor: "#1e293b",
        borderColor: "#38bdf8",
        color: "#38bdf8"
      }}
    />
  );
}

export function OperatorAttestedBadge({
  detail,
  testId
}: {
  detail?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Operator-Attested"
      detail={detail}
      testId={testId || "badge-attested"}
      style={{
        backgroundColor: "#1e293b",
        borderColor: "#93c5fd",
        color: "#bfdbfe"
      }}
    />
  );
}

export function OperatorReviewedBadge({
  detail,
  isApproved,
  testId
}: {
  detail?: string;
  isApproved?: boolean;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Operator-Reviewed"
      detail={detail}
      testId={testId || "badge-operator-reviewed"}
      style={{
        backgroundColor: isApproved ? "#064e3b" : "#451a03",
        borderColor: isApproved ? "#10b981" : "#f59e0b",
        color: isApproved ? "#d1fae5" : "#fef3c7"
      }}
    />
  );
}

export function IndependentlyCorroboratedBadge({
  detail,
  testId
}: {
  detail?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Independently Sourced"
      detail={detail}
      testId={testId || "badge-independently-sourced"}
      style={{
        backgroundColor: "#1e1b4b",
        borderColor: "#818cf8",
        color: "#c7d2fe"
      }}
    />
  );
}

export function UnknownBadge({
  detail,
  testId
}: {
  detail?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Unknown"
      detail={detail}
      testId={testId || "badge-unknown"}
      style={{
        backgroundColor: "#334155",
        borderColor: "#64748b",
        color: "#cbd5e1"
      }}
    />
  );
}

export function BlockedBadge({
  detail,
  testId
}: {
  detail?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Blocked"
      detail={detail}
      testId={testId || "badge-blocked"}
      style={{
        backgroundColor: "#450a0a",
        borderColor: "#ef4444",
        color: "#fca5a5"
      }}
    />
  );
}

export function DerivativeBadge({
  detail,
  testId
}: {
  detail?: string;
  testId?: string;
}): React.ReactElement {
  return (
    <ProvenanceBadge
      label="Derivative Reference"
      detail={detail}
      testId={testId || "badge-derivative-reference"}
      style={{
        backgroundColor: "#2e1065",
        borderColor: "#a855f7",
        color: "#e9d5ff"
      }}
    />
  );
}
