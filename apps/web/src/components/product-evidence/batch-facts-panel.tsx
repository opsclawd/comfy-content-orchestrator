"use client";

import React, { useRef, useState } from "react";
import type { BatchFactsRevisionResponse, ProductBatchResponse } from "@cco/contracts";
import type { BatchOriginKind } from "@cco/shared";
import { generateUuidV7 } from "@cco/shared";
import { appendBatchFacts, ProductEvidenceApiError } from "../../api/product-evidence-client";
import { formatUtcDateTime } from "./format-decimal";
import { OperatorAttestedBadge, UnknownBadge } from "./provenance-badges";

export interface BatchFactsPanelProps {
  readonly clientId: string;
  readonly batch: ProductBatchResponse;
  readonly factsHistory: readonly BatchFactsRevisionResponse[];
  readonly onDossierUpdated: () => void;
  readonly isRefreshing?: boolean;
}

export function BatchFactsPanel({
  clientId,
  batch,
  factsHistory,
  onDossierUpdated,
  isRefreshing = false
}: BatchFactsPanelProps): React.ReactElement {
  const currentFact = factsHistory[factsHistory.length - 1];

  const [showAppendModal, setShowAppendModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const appendActionIdRef = useRef(generateUuidV7());

  // Form fields
  const [originKind, setOriginKind] = useState<BatchOriginKind>(
    currentFact?.originKind || "unknown"
  );
  const [producerIdentity, setProducerIdentity] = useState(
    currentFact?.producerIdentityAsClaimed || ""
  );
  const [startDate, setStartDate] = useState(currentFact?.productionStartDate || "");
  const [endDate, setEndDate] = useState(currentFact?.productionEndDate || "");
  const [originEvidenceId, setOriginEvidenceId] = useState(currentFact?.originEvidenceId || "");
  const [originEvidenceRev, setOriginEvidenceRev] = useState(
    currentFact?.originEvidenceRevision !== null &&
      currentFact?.originEvidenceRevision !== undefined
      ? String(currentFact.originEvidenceRevision)
      : ""
  );

  const handleAppendFacts = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);

    try {
      const hasId = Boolean(originEvidenceId.trim());
      const hasRev = Boolean(originEvidenceRev.trim());
      if ((hasId && !hasRev) || (!hasId && hasRev)) {
        setFormError("Origin Evidence ID and Revision must both be set or both omitted.");
        setIsSubmitting(false);
        return;
      }

      await appendBatchFacts(clientId, batch.batchId, {
        actionId: appendActionIdRef.current,
        expectedVersion: batch.version,
        originKind,
        ...(producerIdentity.trim() ? { producerIdentityAsClaimed: producerIdentity.trim() } : {}),
        ...(startDate.trim() ? { productionStartDate: startDate.trim() } : {}),
        ...(endDate.trim() ? { productionEndDate: endDate.trim() } : {}),
        ...(hasId ? { originEvidenceId: originEvidenceId.trim() } : {}),
        ...(hasRev ? { originEvidenceRevision: Number(originEvidenceRev) } : {})
      });

      appendActionIdRef.current = generateUuidV7();
      setShowAppendModal(false);
      onDossierUpdated();
    } catch (err) {
      if (err instanceof ProductEvidenceApiError && err.statusCode === 409) {
        onDossierUpdated();
      }
      setFormError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section
      id="batch-facts-section"
      data-testid="batch-facts-section"
      style={{ marginTop: "2rem" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1rem"
        }}
      >
        <div>
          <h2>Batch Facts &amp; Origin Lineage</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            Append-only factual log of production origin, dates, and lineage.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            data-testid="toggle-facts-history-button"
            onClick={() => setShowHistory(!showHistory)}
            style={{
              padding: "0.4rem 0.8rem",
              fontSize: "0.875rem",
              borderRadius: "4px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer"
            }}
          >
            {showHistory ? "Hide History" : `View History (${factsHistory.length})`}
          </button>
          <button
            type="button"
            data-testid="append-facts-button"
            onClick={() => {
              setFormError(null);
              setShowAppendModal(true);
            }}
            disabled={isRefreshing}
            className="stage-draft-button"
            style={{ padding: "0.4rem 0.8rem", fontSize: "0.875rem" }}
          >
            + Append Facts Revision
          </button>
        </div>
      </div>

      {isRefreshing && (
        <div
          data-testid="facts-stale-banner"
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: "#451a03",
            border: "1px solid #f59e0b",
            borderRadius: "4px",
            color: "#fef3c7",
            fontSize: "0.85rem",
            marginBottom: "1rem"
          }}
        >
          Dossier is refreshing. Batch facts modification controls are temporarily disabled to
          prevent stale decisions.
        </div>
      )}

      {currentFact ? (
        <div
          data-testid="current-facts-card"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderRadius: "8px",
            padding: "1.25rem",
            border: "1px solid var(--border-subtle)"
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem"
            }}
          >
            <div style={{ fontWeight: 600 }}>Active Facts Revision {currentFact.revision}</div>
            <OperatorAttestedBadge detail={`Asserted by ${currentFact.assertedBy}`} />
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: "0.75rem",
              fontSize: "0.875rem"
            }}
          >
            <div>
              <span style={{ color: "var(--text-muted)" }}>Origin Kind: </span>
              <span data-testid="facts-origin-kind" style={{ fontWeight: 600 }}>
                {currentFact.originKind === "unknown" ? (
                  <UnknownBadge detail="Unknown" />
                ) : (
                  currentFact.originKind
                )}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Producer / Farm: </span>
              <span data-testid="facts-producer">
                {currentFact.producerIdentityAsClaimed || <UnknownBadge detail="Not Reported" />}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Production Dates: </span>
              <span data-testid="facts-dates">
                {currentFact.productionStartDate || currentFact.productionEndDate ? (
                  `${currentFact.productionStartDate || "—"} to ${currentFact.productionEndDate || "—"}`
                ) : (
                  <UnknownBadge detail="No Dates" />
                )}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Origin Evidence: </span>
              <span>
                {currentFact.originEvidenceId ? (
                  `Ev ${currentFact.originEvidenceId.slice(0, 8)}… (Rev ${currentFact.originEvidenceRevision})`
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>None linked</span>
                )}
              </span>
            </div>
            <div>
              <span style={{ color: "var(--text-muted)" }}>Asserted At: </span>
              <span>{formatUtcDateTime(currentFact.assertedAt)}</span>
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{ padding: "1.5rem", backgroundColor: "var(--bg-surface)", borderRadius: "8px" }}
        >
          <UnknownBadge detail="No batch facts recorded" />
        </div>
      )}

      {/* Expandable Facts History */}
      {showHistory && (
        <div data-testid="facts-history-table" style={{ marginTop: "1rem", overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.85rem",
              backgroundColor: "var(--bg-surface)"
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid var(--border-prominent)",
                  textAlign: "left",
                  color: "var(--text-muted)"
                }}
              >
                <th style={{ padding: "0.5rem" }}>Rev</th>
                <th style={{ padding: "0.5rem" }}>Origin Kind</th>
                <th style={{ padding: "0.5rem" }}>Producer</th>
                <th style={{ padding: "0.5rem" }}>Dates</th>
                <th style={{ padding: "0.5rem" }}>Asserted By</th>
                <th style={{ padding: "0.5rem" }}>Asserted At</th>
              </tr>
            </thead>
            <tbody>
              {factsHistory.map((fact) => (
                <tr key={fact.revision} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td style={{ padding: "0.5rem", fontWeight: 600 }}>{fact.revision}</td>
                  <td style={{ padding: "0.5rem" }}>{fact.originKind}</td>
                  <td style={{ padding: "0.5rem" }}>{fact.producerIdentityAsClaimed || "—"}</td>
                  <td style={{ padding: "0.5rem" }}>
                    {fact.productionStartDate || fact.productionEndDate
                      ? `${fact.productionStartDate || "—"} to ${fact.productionEndDate || "—"}`
                      : "—"}
                  </td>
                  <td style={{ padding: "0.5rem" }}>{fact.assertedBy}</td>
                  <td style={{ padding: "0.5rem" }}>{formatUtcDateTime(fact.assertedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Append Facts Revision Modal */}
      {showAppendModal && (
        <div
          data-testid="append-facts-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="append-facts-title"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "1.5rem"
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-surface)",
              borderRadius: "8px",
              padding: "1.5rem",
              maxWidth: "500px",
              width: "100%",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="append-facts-title">Append Batch Facts Revision</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Creates a new sealed facts revision. Expected current version: {batch.version}.
            </p>

            {formError && (
              <div
                data-testid="append-facts-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {formError}
              </div>
            )}

            <form
              onSubmit={handleAppendFacts}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="append-facts-origin-kind"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Origin Kind:
                </label>
                <select
                  id="append-facts-origin-kind"
                  data-testid="append-facts-origin-kind-select"
                  value={originKind}
                  onChange={(e) => {
                    setOriginKind(e.target.value as BatchOriginKind);
                    appendActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="unknown">unknown</option>
                  <option value="own_production">own_production</option>
                  <option value="partner_origin">partner_origin</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="append-facts-producer"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Producer / Lineage Identity:
                </label>
                <input
                  id="append-facts-producer"
                  type="text"
                  data-testid="append-facts-producer-input"
                  value={producerIdentity}
                  onChange={(e) => {
                    setProducerIdentity(e.target.value);
                    appendActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Northern Canopy Organics"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="append-facts-start"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Production Start:
                  </label>
                  <input
                    id="append-facts-start"
                    type="date"
                    data-testid="append-facts-start-date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      appendActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="append-facts-end"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Production End:
                  </label>
                  <input
                    id="append-facts-end"
                    type="date"
                    data-testid="append-facts-end-date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      appendActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="append-facts-ev-id"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Origin Evidence ID (Optional):
                  </label>
                  <input
                    id="append-facts-ev-id"
                    type="text"
                    data-testid="append-facts-evidence-id"
                    value={originEvidenceId}
                    onChange={(e) => {
                      setOriginEvidenceId(e.target.value);
                      appendActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="UUID"
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="append-facts-ev-rev"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Revision:
                  </label>
                  <input
                    id="append-facts-ev-rev"
                    type="number"
                    data-testid="append-facts-evidence-rev"
                    value={originEvidenceRev}
                    onChange={(e) => {
                      setOriginEvidenceRev(e.target.value);
                      appendActionIdRef.current = generateUuidV7();
                    }}
                    placeholder="1"
                    min={1}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowAppendModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-append-facts-button"
                  disabled={isSubmitting || isRefreshing}
                  className="stage-draft-button"
                >
                  {isSubmitting ? "Submitting..." : "Append Facts Revision"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
