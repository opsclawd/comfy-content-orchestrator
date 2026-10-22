"use client";

import React, { useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import type { BatchEvidenceDossier } from "@cco/contracts";
import {
  fetchBatchEvidenceDossier,
  ProductEvidenceApiError
} from "../../../../../../../api/product-evidence-client";
import { BatchDossierSummary } from "../../../../../../../components/product-evidence/batch-dossier-summary";
import { BatchFactsPanel } from "../../../../../../../components/product-evidence/batch-facts-panel";
import { SourceInspectionPanel } from "../../../../../../../components/product-evidence/source-inspection-panel";
import { CoaReportsPanel } from "../../../../../../../components/product-evidence/coa-reports-panel";
import { ProductClaimsPanel } from "../../../../../../../components/product-evidence/product-claims-panel";
import { BlockedBadge } from "../../../../../../../components/product-evidence/provenance-badges";

export const dynamic = "force-dynamic";

export interface BatchDossierPageProps {
  readonly params: Promise<{
    clientId: string;
    skuId: string;
    batchId: string;
  }>;
}

export default function BatchDossierPage({ params }: BatchDossierPageProps): React.ReactElement {
  const { clientId, skuId, batchId } = use(params);

  const [dossier, setDossier] = useState<BatchEvidenceDossier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadDossier = async (isManualRefresh = false) => {
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const currentRequestId = ++requestIdRef.current;
    if (isManualRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const data = await fetchBatchEvidenceDossier(clientId, batchId);
      if (abortController.signal.aborted || currentRequestId !== requestIdRef.current) {
        return;
      }
      setDossier(data);
    } catch (err) {
      if (abortController.signal.aborted || currentRequestId !== requestIdRef.current) {
        return;
      }
      const msg =
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err);
      setError(msg);
    } finally {
      if (!abortController.signal.aborted && currentRequestId === requestIdRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    loadDossier();
    const handleFocus = () => {
      loadDossier(true);
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      abortControllerRef.current?.abort();
      window.removeEventListener("focus", handleFocus);
    };
  }, [clientId, skuId, batchId]);

  if (isLoading) {
    return (
      <section data-testid="dossier-loading-view" style={{ padding: "2rem" }}>
        <div>Loading batch evidence dossier...</div>
      </section>
    );
  }

  if (error || !dossier) {
    return (
      <section data-testid="dossier-error-view" style={{ padding: "2rem" }}>
        <nav style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
          <Link href="/">Home</Link> / <Link href="/products">Products</Link> /{" "}
          <Link href={`/clients/${clientId}/products`}>Client ({clientId.slice(0, 8)}…)</Link>
        </nav>
        <div
          data-testid="dossier-load-error"
          style={{
            padding: "1.5rem",
            backgroundColor: "#450a0a",
            borderRadius: "8px",
            color: "#fee2e2"
          }}
        >
          <BlockedBadge detail="Dossier Retrieval Error" />
          <h2 style={{ marginTop: "0.5rem" }}>Unable to Load Batch Dossier</h2>
          <p style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            {error || "Failed to load batch dossier."}
          </p>
          <div style={{ marginTop: "1rem" }}>
            <button
              type="button"
              onClick={() => loadDossier(true)}
              style={{ padding: "0.4rem 0.8rem" }}
            >
              ↻ Retry Dossier Load
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Deep-Link Security Verification: SKU Mismatch Guard
  if (dossier.sku.skuId !== skuId) {
    return (
      <section data-testid="dossier-sku-mismatch-view" style={{ padding: "2rem" }}>
        <div
          data-testid="sku-mismatch-banner"
          style={{
            padding: "1.5rem",
            backgroundColor: "#450a0a",
            borderRadius: "8px",
            color: "#fee2e2",
            border: "2px solid #ef4444"
          }}
        >
          <BlockedBadge detail="Security Route Violation: SKU Mismatch" />
          <h2 style={{ marginTop: "0.5rem" }}>Route SKU Mismatch Detected</h2>
          <p style={{ marginTop: "0.5rem" }}>
            The requested batch <code>{dossier.batch.lotIdentifier}</code> belongs to SKU{" "}
            <code>{dossier.sku.skuId}</code> ({dossier.sku.canonicalSku}), but was requested under
            route SKU <code>{skuId}</code>.
          </p>
          <p style={{ marginTop: "0.5rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            To prevent cross-SKU lot confusion, the batch dossier cannot be viewed under a foreign
            SKU path.
          </p>
          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem" }}>
            <Link
              href={`/clients/${clientId}/products/${dossier.sku.skuId}/batches/${batchId}`}
              className="stage-draft-button"
              style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
            >
              Go to Canonical SKU Dossier →
            </Link>
            <Link
              href={`/clients/${clientId}/products`}
              style={{
                padding: "0.4rem 0.8rem",
                fontSize: "0.85rem",
                color: "var(--text-secondary)"
              }}
            >
              ← Back to Client Products
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="batch-dossier-page">
      <BatchDossierSummary
        dossier={dossier}
        onRefresh={() => loadDossier(true)}
        isRefreshing={isRefreshing}
      />

      <BatchFactsPanel
        clientId={clientId}
        batch={dossier.batch}
        factsHistory={dossier.factsHistory}
        onDossierUpdated={() => loadDossier(true)}
        isRefreshing={isRefreshing}
      />

      <SourceInspectionPanel
        clientId={clientId}
        batchId={batchId}
        evidence={dossier.evidence}
        onDossierUpdated={() => loadDossier(true)}
        isRefreshing={isRefreshing}
      />

      <CoaReportsPanel
        clientId={clientId}
        batchId={batchId}
        coaReports={dossier.coaReports}
        availableEvidence={dossier.evidence}
        onDossierUpdated={() => loadDossier(true)}
        isRefreshing={isRefreshing}
      />

      <ProductClaimsPanel
        clientId={clientId}
        batchId={batchId}
        claims={dossier.claims}
        availableEvidence={dossier.evidence}
        availableCoas={dossier.coaReports}
        factsHistory={dossier.factsHistory}
        onDossierUpdated={() => loadDossier(true)}
        isRefreshing={isRefreshing}
      />
    </section>
  );
}
