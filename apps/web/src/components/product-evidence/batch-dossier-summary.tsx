"use client";

import React from "react";
import Link from "next/link";
import type { BatchEvidenceDossier } from "@cco/contracts";
import { formatUtcDateTime } from "./format-decimal";
import { BlockedBadge, UnknownBadge } from "./provenance-badges";

export interface BatchDossierSummaryProps {
  readonly dossier: BatchEvidenceDossier;
  readonly onRefresh: () => void;
  readonly isRefreshing?: boolean;
}

export function BatchDossierSummary({
  dossier,
  onRefresh,
  isRefreshing = false
}: BatchDossierSummaryProps): React.ReactElement {
  const { sku, batch, factsHistory, evidence, claims, clientId } = dossier;
  const currentFact = factsHistory[factsHistory.length - 1];

  // Calculate gaps
  const gaps: string[] = [];
  if (!currentFact || currentFact.originKind === "unknown") {
    gaps.push("Unknown Production Origin");
  }
  if (!currentFact || (!currentFact.productionStartDate && !currentFact.productionEndDate)) {
    gaps.push("Unrecorded Production Dates");
  }
  if (!currentFact || !currentFact.producerIdentityAsClaimed) {
    gaps.push("Unspecified Producer Identity");
  }

  // Calculate source availability
  let availableSources = 0;
  let totalSources = 0;
  for (const ev of evidence) {
    for (const src of ev.sourceObjects) {
      totalSources++;
      if (src.availability === "available") {
        availableSources++;
      }
    }
  }

  // Calculate claims readiness
  const totalClaims = claims.length;
  const eligibleClaims = claims.filter((c) => c.resolution.supportEligible).length;
  const blockedClaims = claims.filter((c) => !c.resolution.supportEligible).length;

  return (
    <div
      data-testid="batch-dossier-summary-panel"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderRadius: "8px",
        padding: "1.5rem",
        border: "1px solid var(--border-prominent)",
        marginBottom: "1.5rem"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "1rem"
        }}
      >
        <div>
          <nav
            data-testid="dossier-breadcrumbs"
            style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}
          >
            <Link href="/products">Products</Link> /{" "}
            <Link href={`/clients/${clientId}/products`}>Client ({clientId.slice(0, 8)}…)</Link> /{" "}
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              SKU {sku.canonicalSku} • Lot {batch.lotIdentifier}
            </span>
          </nav>

          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            Batch Dossier: {batch.displayName || batch.lotIdentifier}
          </h1>
          <div style={{ fontSize: "0.9rem", color: "var(--text-secondary)", marginTop: "0.25rem" }}>
            SKU: {sku.displayName} (<code>{sku.canonicalSku}</code>) • Lot:{" "}
            <code>{batch.lotIdentifier}</code>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button
            type="button"
            data-testid="refresh-dossier-button"
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{
              padding: "0.4rem 0.8rem",
              fontSize: "0.85rem",
              borderRadius: "4px",
              border: "1px solid var(--border-prominent)",
              backgroundColor: "var(--bg-surface-elevated)",
              color: "var(--text-primary)",
              cursor: "pointer"
            }}
          >
            {isRefreshing ? "Refreshing..." : "↻ Refresh Dossier"}
          </button>
          <Link
            href={`/clients/${clientId}/products`}
            style={{
              padding: "0.4rem 0.8rem",
              fontSize: "0.85rem",
              borderRadius: "4px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "transparent",
              color: "var(--text-secondary)"
            }}
          >
            ← Back to Batches
          </Link>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "1rem",
          marginTop: "1.25rem",
          paddingTop: "1.25rem",
          borderTop: "1px solid var(--border-subtle)"
        }}
      >
        {/* Versions & Timestamps */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 600
            }}
          >
            Registry State
          </div>
          <div style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}>
            Batch v{batch.version} • Facts Rev {batch.currentFactsRevision}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
            Dossier Snapshot: {formatUtcDateTime(dossier.resolvedAt)}
          </div>
          <a
            href="#batch-facts-section"
            data-testid="link-batch-facts-detail"
            style={{
              fontSize: "0.8rem",
              color: "#38bdf8",
              textDecoration: "underline",
              display: "inline-block",
              marginTop: "0.3rem"
            }}
          >
            View Facts History ↓
          </a>
        </div>

        {/* Source Availability */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 600
            }}
          >
            Source Storage Availability
          </div>
          <div
            data-testid="summary-source-availability"
            style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}
          >
            {totalSources === 0 ? (
              <UnknownBadge detail="0 Sources" />
            ) : availableSources === totalSources ? (
              <span style={{ color: "#10b981", fontWeight: 600 }}>
                ✓ {availableSources} / {totalSources} Available
              </span>
            ) : (
              <BlockedBadge detail={`${totalSources - availableSources} Unavailable`} />
            )}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
            {evidence.length} Registered Evidence Assets
          </div>
          <a
            href="#source-evidence-section"
            data-testid="link-source-evidence-detail"
            style={{
              fontSize: "0.8rem",
              color: "#38bdf8",
              textDecoration: "underline",
              display: "inline-block",
              marginTop: "0.3rem"
            }}
          >
            Inspect Sources ({evidence.length}) ↓
          </a>
        </div>

        {/* Claim Readiness */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 600
            }}
          >
            Claims Readiness
          </div>
          <div
            data-testid="summary-claims-readiness"
            style={{ fontSize: "0.9rem", marginTop: "0.25rem" }}
          >
            {totalClaims === 0 ? (
              <span style={{ color: "var(--text-secondary)" }}>0 Claims Proposed</span>
            ) : (
              <span>
                <strong style={{ color: "#10b981" }}>{eligibleClaims} Eligible</strong> •{" "}
                <strong style={{ color: blockedClaims > 0 ? "#ef4444" : "var(--text-secondary)" }}>
                  {blockedClaims} Blocked
                </strong>
              </span>
            )}
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: "0.2rem" }}>
            {dossier.coaReports.length} CoAs • {totalClaims} Total Claims
          </div>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
            <a
              href="#coa-reports-section"
              data-testid="link-coa-reports-detail"
              style={{
                fontSize: "0.8rem",
                color: "#38bdf8",
                textDecoration: "underline"
              }}
            >
              Inspect CoAs ({dossier.coaReports.length}) ↓
            </a>
            <a
              href="#product-claims-section"
              data-testid="link-product-claims-detail"
              style={{
                fontSize: "0.8rem",
                color: "#38bdf8",
                textDecoration: "underline"
              }}
            >
              View Claims ({totalClaims}) ↓
            </a>
          </div>
        </div>

        {/* Facts Gaps */}
        <div>
          <div
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              fontWeight: 600
            }}
          >
            Provenance Gaps
          </div>
          <div
            data-testid="summary-facts-gaps"
            style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.25rem" }}
          >
            {gaps.length === 0 ? (
              <span style={{ fontSize: "0.85rem", color: "#10b981" }}>✓ No Critical Gaps</span>
            ) : (
              gaps.map((gap) => <UnknownBadge key={gap} detail={gap} />)
            )}
          </div>
          <a
            href="#batch-facts-section"
            data-testid="link-facts-gaps-detail"
            style={{
              fontSize: "0.8rem",
              color: "#38bdf8",
              textDecoration: "underline",
              display: "inline-block",
              marginTop: "0.3rem"
            }}
          >
            Correct Batch Facts ↓
          </a>
        </div>
      </div>
    </div>
  );
}
