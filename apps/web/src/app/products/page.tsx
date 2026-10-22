"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClientListItem } from "@cco/contracts";
import { fetchAuthorizedClients, ProductEvidenceApiError } from "../../api/product-evidence-client";
import { BlockedBadge } from "../../components/product-evidence/provenance-badges";

export const dynamic = "force-dynamic";

export default function ProductsWorkspaceChooserPage(): React.ReactElement {
  const router = useRouter();
  const [clients, setClients] = useState<readonly ClientListItem[]>([]);
  const [directorLogin, setDirectorLogin] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchAuthorizedClients();
      setClients(res.clients);
      setDirectorLogin(res.directorLogin);
      if (res.clients.length > 0) {
        setSelectedClientId(res.clients[0]!.clientId);
      }
    } catch (err) {
      const msg =
        err instanceof ProductEvidenceApiError ? `${err.errorCode}: ${err.message}` : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSelectClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) return;
    router.push(`/clients/${selectedClientId}/products`);
  };

  return (
    <section data-testid="authorized-client-chooser">
      <div style={{ marginBottom: "1.5rem" }}>
        <nav
          style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}
        >
          <Link href="/">Home</Link> /{" "}
          <span style={{ color: "var(--text-primary)" }}>Products &amp; Batches</span>
        </nav>
        <h1>Product &amp; Batch Workspace</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: "0.25rem" }}>
          Private verified-batch operator workspace. Tenant client authorization is enforced by
          server mappings.
        </p>
        {directorLogin && (
          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Authorized Director Session: <strong>{directorLogin}</strong>
          </div>
        )}
      </div>

      {isLoading && <div data-testid="chooser-loading">Resolving authorized clients...</div>}

      {error && (
        <div
          data-testid="chooser-error"
          style={{
            padding: "1rem",
            backgroundColor: "#450a0a",
            borderRadius: "8px",
            color: "#fee2e2",
            marginBottom: "1rem"
          }}
        >
          <BlockedBadge detail="Authorization Error" />
          <p style={{ marginTop: "0.5rem" }}>{error}</p>
          <button
            type="button"
            data-testid="chooser-retry-button"
            onClick={load}
            style={{
              marginTop: "0.75rem",
              padding: "0.35rem 0.75rem",
              fontSize: "0.85rem",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {!isLoading && !error && clients.length === 0 && (
        <div
          data-testid="no-authorized-clients"
          style={{ padding: "1.5rem", backgroundColor: "var(--bg-surface)", borderRadius: "8px" }}
        >
          <h3>No Authorized Clients</h3>
          <p style={{ color: "var(--text-secondary)", marginTop: "0.5rem", fontSize: "0.9rem" }}>
            Director <strong>{directorLogin}</strong> does not have configured access to any client
            product namespaces. Check <code>REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS</code>.
          </p>
        </div>
      )}

      {!isLoading && !error && clients.length > 0 && (
        <div
          data-testid="client-picker-card"
          style={{
            backgroundColor: "var(--bg-surface)",
            borderRadius: "8px",
            padding: "1.5rem",
            maxWidth: "500px",
            border: "1px solid var(--border-subtle)"
          }}
        >
          <form
            onSubmit={handleSelectClient}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  marginBottom: "0.5rem"
                }}
              >
                Select Authorized Client:
              </label>
              <select
                data-testid="authorized-client-select"
                value={selectedClientId}
                onChange={(e) => setSelectedClientId(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", borderRadius: "4px" }}
              >
                {clients.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.companyName || c.clientId} ({c.clientId.slice(0, 8)}…)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                Authorized Client Direct Access:
              </span>
              {clients.map((c) => (
                <Link
                  key={c.clientId}
                  href={`/clients/${c.clientId}/products`}
                  data-testid={`client-choice-${c.clientId}`}
                  style={{
                    color: "var(--color-primary, #60a5fa)",
                    textDecoration: "underline",
                    fontSize: "0.9rem"
                  }}
                >
                  {c.companyName || c.clientId} ({c.clientId.slice(0, 8)}…) →
                </Link>
              ))}
            </div>

            <button
              type="submit"
              data-testid="open-client-workspace-button"
              className="stage-draft-button"
              style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }}
            >
              Enter Client Product Workspace →
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
