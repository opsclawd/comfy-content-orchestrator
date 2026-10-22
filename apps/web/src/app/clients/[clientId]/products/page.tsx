"use client";

import React, { Suspense, useEffect, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductBatchResponse, ProductSkuResponse } from "@cco/contracts";
import type { BatchOriginKind } from "@cco/shared";
import { generateUuidV7 } from "@cco/shared";
import {
  createProductBatch,
  createProductSku,
  fetchProductBatches,
  fetchProductSkus,
  updateProductBatchMetadata,
  updateProductSkuMetadata,
  ProductEvidenceApiError
} from "../../../../api/product-evidence-client";
import { formatUtcDateTime } from "../../../../components/product-evidence/format-decimal";
import {
  BlockedBadge,
  UnknownBadge
} from "../../../../components/product-evidence/provenance-badges";

export const dynamic = "force-dynamic";

export interface ClientProductsPageProps {
  readonly params: Promise<{
    clientId: string;
  }>;
}

export default function ClientProductsPage({
  params
}: ClientProductsPageProps): React.ReactElement {
  return (
    <Suspense fallback={<div>Loading products workspace...</div>}>
      <ClientProductsContent params={params} />
    </Suspense>
  );
}

function ClientProductsContent({ params }: ClientProductsPageProps): React.ReactElement {
  const { clientId } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();

  const [skus, setSkus] = useState<readonly ProductSkuResponse[]>([]);
  const [batches, setBatches] = useState<readonly ProductBatchResponse[]>([]);
  const [selectedSkuFilter, setSelectedSkuFilter] = useState<string>(
    searchParams.get("skuId") || ""
  );
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Sync selectedSkuFilter with URL searchParams
  useEffect(() => {
    const skuFromUrl = searchParams.get("skuId") || "";
    setSelectedSkuFilter(skuFromUrl);
  }, [searchParams]);

  // Create SKU Modal
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [canonicalSku, setCanonicalSku] = useState("");
  const [skuDisplayName, setSkuDisplayName] = useState("");
  const [skuError, setSkuError] = useState<string | null>(null);
  const [isSkuSubmitting, setIsSkuSubmitting] = useState(false);
  const createSkuActionIdRef = useRef(generateUuidV7());

  // Edit SKU Modal
  const [editSkuTarget, setEditSkuTarget] = useState<ProductSkuResponse | null>(null);
  const [editSkuDisplayName, setEditSkuDisplayName] = useState("");
  const [editSkuError, setEditSkuError] = useState<string | null>(null);
  const [isEditSkuSubmitting, setIsEditSkuSubmitting] = useState(false);
  const editSkuActionIdRef = useRef(generateUuidV7());

  // Create Batch Modal
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchSkuId, setBatchSkuId] = useState("");
  const [lotIdentifier, setLotIdentifier] = useState("");
  const [batchDisplayName, setBatchDisplayName] = useState("");
  const [initialOriginKind, setInitialOriginKind] = useState<BatchOriginKind>("unknown");
  const [initialProducer, setInitialProducer] = useState("");
  const [initialStartDate, setInitialStartDate] = useState("");
  const [initialEndDate, setInitialEndDate] = useState("");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const createBatchActionIdRef = useRef(generateUuidV7());

  // Edit Batch Modal
  const [editBatchTarget, setEditBatchTarget] = useState<ProductBatchResponse | null>(null);
  const [editBatchDisplayName, setEditBatchDisplayName] = useState("");
  const [editBatchError, setEditBatchError] = useState<string | null>(null);
  const [isEditBatchSubmitting, setIsEditBatchSubmitting] = useState(false);
  const editBatchActionIdRef = useRef(generateUuidV7());

  const loadRequestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadData = async () => {
    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const currentReqId = ++loadRequestIdRef.current;
    setIsLoading(true);
    setPageError(null);
    try {
      const [skuList, batchList] = await Promise.all([
        fetchProductSkus(clientId),
        fetchProductBatches(clientId)
      ]);
      if (abortController.signal.aborted || currentReqId !== loadRequestIdRef.current) return;
      setSkus(skuList);
      setBatches(batchList);
      if (skuList.length > 0 && !batchSkuId) {
        setBatchSkuId(skuList[0]!.skuId);
      }
    } catch (err) {
      if (abortController.signal.aborted || currentReqId !== loadRequestIdRef.current) return;
      const msg =
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err);
      setPageError(msg);
    } finally {
      if (!abortController.signal.aborted && currentReqId === loadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData();
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [clientId]);

  const handleSelectSkuFilter = (skuId: string) => {
    const nextFilter = selectedSkuFilter === skuId ? "" : skuId;
    setSelectedSkuFilter(nextFilter);
    const nextParams = new URLSearchParams(window.location.search);
    if (nextFilter) {
      nextParams.set("skuId", nextFilter);
    } else {
      nextParams.delete("skuId");
    }
    const query = nextParams.toString() ? `?${nextParams.toString()}` : "";
    router.push(`/clients/${clientId}/products${query}`);
  };

  const handleCreateSku = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSkuSubmitting(true);
    setSkuError(null);

    try {
      await createProductSku(clientId, {
        actionId: createSkuActionIdRef.current,
        canonicalSku: canonicalSku.trim(),
        displayName: skuDisplayName.trim()
      });
      createSkuActionIdRef.current = generateUuidV7();
      setShowSkuModal(false);
      setCanonicalSku("");
      setSkuDisplayName("");
      await loadData();
    } catch (err) {
      setSkuError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsSkuSubmitting(false);
    }
  };

  const handleEditSku = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editSkuTarget) return;
    setIsEditSkuSubmitting(true);
    setEditSkuError(null);

    try {
      await updateProductSkuMetadata(clientId, editSkuTarget.skuId, {
        actionId: editSkuActionIdRef.current,
        expectedVersion: editSkuTarget.version,
        displayName: editSkuDisplayName.trim()
      });
      editSkuActionIdRef.current = generateUuidV7();
      setEditSkuTarget(null);
      await loadData();
    } catch (err) {
      setEditSkuError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsEditSkuSubmitting(false);
    }
  };

  const handleCreateBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsBatchSubmitting(true);
    setBatchError(null);

    try {
      await createProductBatch(clientId, {
        actionId: createBatchActionIdRef.current,
        skuId: batchSkuId,
        lotIdentifier: lotIdentifier.trim(),
        displayName: batchDisplayName.trim(),
        initialFacts: {
          originKind: initialOriginKind,
          ...(initialProducer.trim() ? { producerIdentityAsClaimed: initialProducer.trim() } : {}),
          ...(initialStartDate.trim() ? { productionStartDate: initialStartDate.trim() } : {}),
          ...(initialEndDate.trim() ? { productionEndDate: initialEndDate.trim() } : {})
        }
      });
      createBatchActionIdRef.current = generateUuidV7();
      setShowBatchModal(false);
      setLotIdentifier("");
      setBatchDisplayName("");
      setInitialProducer("");
      setInitialOriginKind("unknown");
      await loadData();
    } catch (err) {
      setBatchError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsBatchSubmitting(false);
    }
  };

  const handleEditBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editBatchTarget) return;
    setIsEditBatchSubmitting(true);
    setEditBatchError(null);

    try {
      await updateProductBatchMetadata(clientId, editBatchTarget.batchId, {
        actionId: editBatchActionIdRef.current,
        expectedVersion: editBatchTarget.version,
        displayName: editBatchDisplayName.trim()
      });
      editBatchActionIdRef.current = generateUuidV7();
      setEditBatchTarget(null);
      await loadData();
    } catch (err) {
      setEditBatchError(
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err)
      );
    } finally {
      setIsEditBatchSubmitting(false);
    }
  };

  const selectedSku = skus.find((s) => s.skuId === selectedSkuFilter);
  const filteredBatches = selectedSkuFilter
    ? batches.filter((b) => b.skuId === selectedSkuFilter)
    : batches;

  return (
    <section data-testid="products-workspace">
      <nav style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
        <Link href="/">Home</Link> / <Link href="/products">Products</Link> /{" "}
        <span style={{ color: "var(--text-primary)" }}>Client {clientId.slice(0, 8)}…</span>
      </nav>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "1.5rem"
        }}
      >
        <div>
          <h1>Client Products &amp; Lots</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Tenant Client UUID: <code>{clientId}</code>
          </p>
        </div>
        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
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
          {isLoading ? "Refreshing..." : "↻ Refresh"}
        </button>
      </div>

      {pageError && (
        <div
          data-testid="client-products-error"
          style={{
            padding: "1rem",
            backgroundColor: "#450a0a",
            borderRadius: "8px",
            color: "#fee2e2",
            marginBottom: "1rem"
          }}
        >
          <BlockedBadge detail="Access Error" />
          <p style={{ marginTop: "0.5rem" }}>{pageError}</p>
        </div>
      )}

      {/* SKUs Section */}
      <div
        style={{
          backgroundColor: "var(--bg-surface)",
          borderRadius: "8px",
          padding: "1.25rem",
          border: "1px solid var(--border-subtle)",
          marginBottom: "1.5rem"
        }}
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
            <h2>Product SKUs</h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Registered product lines under this tenant namespace.
            </p>
          </div>
          <button
            type="button"
            data-testid="create-sku-button"
            onClick={() => {
              createSkuActionIdRef.current = generateUuidV7();
              setSkuError(null);
              setShowSkuModal(true);
            }}
            className="stage-draft-button"
            style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
          >
            + Create SKU
          </button>
        </div>

        {skus.length === 0 ? (
          <div
            data-testid="no-skus-message"
            style={{ padding: "1rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}
          >
            <UnknownBadge detail="No SKUs registered yet" />
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "0.75rem"
            }}
          >
            {skus.map((sku) => (
              <div
                key={sku.skuId}
                role="button"
                tabIndex={0}
                aria-pressed={selectedSkuFilter === sku.skuId}
                data-testid={`sku-card-${sku.canonicalSku}`}
                onClick={() => handleSelectSkuFilter(sku.skuId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectSkuFilter(sku.skuId);
                  }
                }}
                style={{
                  backgroundColor: "var(--bg-surface-elevated)",
                  borderRadius: "6px",
                  padding: "0.75rem 1rem",
                  border:
                    selectedSkuFilter === sku.skuId
                      ? "2px solid #38bdf8"
                      : "1px solid var(--border-prominent)",
                  cursor: "pointer"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start"
                  }}
                >
                  <div>
                    <h3 style={{ fontSize: "0.95rem", margin: 0 }}>{sku.displayName}</h3>
                    <code
                      data-testid="sku-canonical-code"
                      style={{ fontSize: "0.8rem", color: "#38bdf8" }}
                    >
                      {sku.canonicalSku}
                    </code>
                  </div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditSkuTarget(sku);
                        setEditSkuDisplayName(sku.displayName);
                        setEditSkuError(null);
                        editSkuActionIdRef.current = generateUuidV7();
                      }}
                      style={{
                        fontSize: "0.75rem",
                        padding: "0.2rem 0.4rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-subtle)",
                        background: "none",
                        color: "var(--text-secondary)",
                        cursor: "pointer"
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectSkuFilter(sku.skuId);
                      }}
                      style={{
                        fontSize: "0.75rem",
                        padding: "0.2rem 0.4rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-subtle)",
                        background: "none",
                        color:
                          selectedSkuFilter === sku.skuId ? "#38bdf8" : "var(--text-secondary)",
                        cursor: "pointer"
                      }}
                    >
                      {selectedSkuFilter === sku.skuId ? "Selected" : "Filter Lots"}
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    marginTop: "0.5rem",
                    display: "flex",
                    justifyContent: "space-between"
                  }}
                >
                  <span>v{sku.version}</span>
                  <span>Created {formatUtcDateTime(sku.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Batches Section */}
      <div
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
            marginBottom: "1rem"
          }}
        >
          <div>
            <h2 data-testid="lot-section-title">
              Batches &amp; Production Lots
              {selectedSku ? ` (${selectedSku.canonicalSku})` : ""}
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              Physical production lots with immutable factual dossiers.
            </p>
          </div>
          <button
            type="button"
            data-testid="create-batch-button"
            onClick={() => {
              // Default the new batch's parent SKU to the SKU currently
              // selected in the workspace, not whatever SKU batchSkuId
              // happened to default to on first load; otherwise a batch
              // created right after selecting a SKU can be silently
              // attached to a different, stale SKU.
              if (selectedSku) {
                setBatchSkuId(selectedSku.skuId);
              }
              createBatchActionIdRef.current = generateUuidV7();
              setBatchError(null);
              setShowBatchModal(true);
            }}
            disabled={skus.length === 0}
            className="stage-draft-button"
            style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
          >
            + Create Batch / Lot
          </button>
        </div>

        {filteredBatches.length === 0 ? (
          <div
            data-testid="no-batches-message"
            style={{ padding: "1rem", color: "var(--text-secondary)", fontSize: "0.9rem" }}
          >
            <UnknownBadge
              detail={
                selectedSkuFilter ? "No batches for selected SKU" : "No batches registered yet"
              }
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {filteredBatches.map((batch) => {
              const sku = skus.find((s) => s.skuId === batch.skuId);
              return (
                <div
                  key={batch.batchId}
                  data-testid={`batch-item-${batch.lotIdentifier}`}
                  style={{
                    backgroundColor: "var(--bg-surface-elevated)",
                    borderRadius: "6px",
                    padding: "0.75rem 1rem",
                    border: "1px solid var(--border-prominent)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "0.5rem"
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <strong style={{ fontSize: "0.95rem" }}>
                        {batch.displayName || batch.lotIdentifier}
                      </strong>
                      <code
                        data-testid="batch-lot-code"
                        style={{ fontSize: "0.8rem", color: "var(--text-primary)" }}
                      >
                        Lot: {batch.lotIdentifier}
                      </code>
                      {sku && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            backgroundColor: "var(--bg-surface)",
                            padding: "0.1rem 0.3rem",
                            borderRadius: "3px",
                            color: "var(--text-secondary)"
                          }}
                        >
                          SKU: {sku.canonicalSku}
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                        marginTop: "0.25rem",
                        display: "flex",
                        gap: "1rem"
                      }}
                    >
                      <span>Batch Version: v{batch.version}</span>
                      <span>Facts Rev: {batch.currentFactsRevision}</span>
                      <span>Created {formatUtcDateTime(batch.createdAt)}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditBatchTarget(batch);
                        setEditBatchDisplayName(batch.displayName || "");
                        setEditBatchError(null);
                        editBatchActionIdRef.current = generateUuidV7();
                      }}
                      style={{
                        padding: "0.35rem 0.6rem",
                        fontSize: "0.8rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-subtle)",
                        background: "none",
                        color: "var(--text-secondary)",
                        cursor: "pointer"
                      }}
                    >
                      Edit
                    </button>
                    <Link
                      data-testid={`view-dossier-button-${batch.lotIdentifier}`}
                      href={`/clients/${clientId}/products/${batch.skuId}/batches/${batch.batchId}`}
                      className="stage-draft-button"
                      style={{ padding: "0.4rem 0.8rem", fontSize: "0.85rem" }}
                    >
                      View Batch Dossier →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create SKU Modal */}
      {showSkuModal && (
        <div
          data-testid="create-sku-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-sku-modal-title"
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
              maxWidth: "480px",
              width: "100%",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="create-sku-modal-title">Create Product SKU</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Canonical SKU must be 3–64 characters containing uppercase alphanumeric characters,
              hyphens, or underscores (e.g. <code>SKU-BLUE-DREAM-01</code>).
            </p>

            {skuError && (
              <div
                data-testid="create-sku-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {skuError}
              </div>
            )}

            <form
              onSubmit={handleCreateSku}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="sku-canonical-code-input"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Canonical SKU Code:
                </label>
                <input
                  id="sku-canonical-code-input"
                  type="text"
                  data-testid="sku-canonical-input"
                  value={canonicalSku}
                  onChange={(e) => {
                    setCanonicalSku(e.target.value);
                    createSkuActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. SKU-BLUE-DREAM-01"
                  required
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div>
                <label
                  htmlFor="sku-display-name-input-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Display Title / Product Name:
                </label>
                <input
                  id="sku-display-name-input-field"
                  type="text"
                  data-testid="sku-display-name-input"
                  value={skuDisplayName}
                  onChange={(e) => {
                    setSkuDisplayName(e.target.value);
                    createSkuActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Blue Dream 3.5g Jar"
                  required
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setShowSkuModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-create-sku-button"
                  disabled={isSkuSubmitting}
                  className="stage-draft-button"
                >
                  {isSkuSubmitting ? "Creating..." : "Create SKU"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit SKU Modal */}
      {editSkuTarget && (
        <div
          data-testid="edit-sku-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-sku-modal-title"
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
              maxWidth: "480px",
              width: "100%",
              border: "1px solid var(--border-prominent)"
            }}
          >
            <h3 id="edit-sku-modal-title">Edit SKU: {editSkuTarget.canonicalSku}</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Update display metadata for this SKU. (Expected version: v{editSkuTarget.version})
            </p>

            {editSkuError && (
              <div
                data-testid="edit-sku-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {editSkuError}
              </div>
            )}

            <form
              onSubmit={handleEditSku}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="edit-sku-display-name-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Product Display Name:
                </label>
                <input
                  id="edit-sku-display-name-field"
                  type="text"
                  data-testid="edit-sku-display-name-input"
                  value={editSkuDisplayName}
                  onChange={(e) => {
                    setEditSkuDisplayName(e.target.value);
                    editSkuActionIdRef.current = generateUuidV7();
                  }}
                  required
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setEditSkuTarget(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-edit-sku-button"
                  disabled={isEditSkuSubmitting}
                  className="stage-draft-button"
                >
                  {isEditSkuSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Batch Modal */}
      {showBatchModal && (
        <div
          data-testid="create-batch-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-batch-modal-title"
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
            <h3 id="create-batch-modal-title">Create Product Batch / Lot</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Lot identifier must be 1–128 alphanumeric characters, hyphens, or underscores (e.g.{" "}
              <code>LOT-2026-A1</code>).
            </p>

            {batchError && (
              <div
                data-testid="create-batch-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {batchError}
              </div>
            )}

            <form
              onSubmit={handleCreateBatch}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="batch-parent-sku-select"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Parent SKU:
                </label>
                <select
                  id="batch-parent-sku-select"
                  data-testid="batch-sku-select"
                  value={batchSkuId}
                  onChange={(e) => {
                    setBatchSkuId(e.target.value);
                    createBatchActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                  required
                >
                  {skus.map((s) => (
                    <option key={s.skuId} value={s.skuId}>
                      {s.displayName} ({s.canonicalSku})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="batch-lot-id-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Physical Lot Identifier:
                </label>
                <input
                  id="batch-lot-id-field"
                  type="text"
                  data-testid="batch-lot-identifier-input"
                  value={lotIdentifier}
                  onChange={(e) => {
                    setLotIdentifier(e.target.value);
                    createBatchActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. LOT-2026-0819A"
                  required
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div>
                <label
                  htmlFor="batch-display-name-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Batch Display Name:
                </label>
                <input
                  id="batch-display-name-field"
                  type="text"
                  data-testid="batch-display-name-input"
                  value={batchDisplayName}
                  onChange={(e) => {
                    setBatchDisplayName(e.target.value);
                    createBatchActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Harvest Batch August 2026"
                  required
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div>
                <label
                  htmlFor="batch-origin-select-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Initial Origin Kind:
                </label>
                <select
                  id="batch-origin-select-field"
                  data-testid="batch-origin-select"
                  value={initialOriginKind}
                  onChange={(e) => {
                    setInitialOriginKind(e.target.value as BatchOriginKind);
                    createBatchActionIdRef.current = generateUuidV7();
                  }}
                  style={{ width: "100%", padding: "0.4rem" }}
                >
                  <option value="unknown">unknown (Origin Not Documented)</option>
                  <option value="own_production">own_production (Internal Cultivation)</option>
                  <option value="partner_origin">
                    partner_origin (Licensed Partner / Supplier)
                  </option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="batch-producer-input-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Producer Identity (Optional):
                </label>
                <input
                  id="batch-producer-input-field"
                  type="text"
                  data-testid="batch-producer-input"
                  value={initialProducer}
                  onChange={(e) => {
                    setInitialProducer(e.target.value);
                    createBatchActionIdRef.current = generateUuidV7();
                  }}
                  placeholder="e.g. Apex Cultivation Facility"
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                <div>
                  <label
                    htmlFor="batch-start-date-field"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    Start Date:
                  </label>
                  <input
                    id="batch-start-date-field"
                    type="date"
                    value={initialStartDate}
                    onChange={(e) => {
                      setInitialStartDate(e.target.value);
                      createBatchActionIdRef.current = generateUuidV7();
                    }}
                    style={{ width: "100%", padding: "0.4rem" }}
                  />
                </div>
                <div>
                  <label
                    htmlFor="batch-end-date-field"
                    style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                  >
                    End Date:
                  </label>
                  <input
                    id="batch-end-date-field"
                    type="date"
                    value={initialEndDate}
                    onChange={(e) => {
                      setInitialEndDate(e.target.value);
                      createBatchActionIdRef.current = generateUuidV7();
                    }}
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
                <button type="button" onClick={() => setShowBatchModal(false)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-create-batch-button"
                  disabled={isBatchSubmitting}
                  className="stage-draft-button"
                >
                  {isBatchSubmitting ? "Creating..." : "Create Batch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Batch Modal */}
      {editBatchTarget && (
        <div
          data-testid="edit-batch-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-batch-modal-title"
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
            <h3 id="edit-batch-modal-title">Edit Batch: {editBatchTarget.lotIdentifier}</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "1rem" }}>
              Update display metadata for this batch lot. (Expected version: v
              {editBatchTarget.version})
            </p>

            {editBatchError && (
              <div
                data-testid="edit-batch-error"
                style={{ color: "#ef4444", marginBottom: "0.75rem", fontSize: "0.85rem" }}
              >
                {editBatchError}
              </div>
            )}

            <form
              onSubmit={handleEditBatch}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div>
                <label
                  htmlFor="edit-batch-display-name-field"
                  style={{ display: "block", fontSize: "0.85rem", marginBottom: "0.25rem" }}
                >
                  Batch Display Name:
                </label>
                <input
                  id="edit-batch-display-name-field"
                  type="text"
                  data-testid="edit-batch-display-name-input"
                  value={editBatchDisplayName}
                  onChange={(e) => {
                    setEditBatchDisplayName(e.target.value);
                    editBatchActionIdRef.current = generateUuidV7();
                  }}
                  required
                  style={{ width: "100%", padding: "0.4rem" }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.5rem",
                  marginTop: "1rem"
                }}
              >
                <button type="button" onClick={() => setEditBatchTarget(null)}>
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="submit-edit-batch-button"
                  disabled={isEditBatchSubmitting}
                  className="stage-draft-button"
                >
                  {isEditBatchSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
