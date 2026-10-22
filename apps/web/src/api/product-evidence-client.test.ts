import { describe, expect, it, vi } from "vitest";
import {
  fetchAuthorizedClients,
  fetchBatchEvidenceDossier,
  fetchProductSkus,
  createProductSku,
  registerEvidenceAssetMultipart,
  fetchEvidenceMedia,
  ProductEvidenceApiError
} from "./product-evidence-client";

describe("product-evidence-client", () => {
  const sampleUuid = "11111111-1111-7111-8111-111111111111";
  const now = "2026-10-22T00:00:00.000Z";
  const sampleSha = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

  it("fetchAuthorizedClients parses and validates valid response", async () => {
    const mockResponse = {
      clients: [
        {
          clientId: sampleUuid,
          companyName: "Acme Corp"
        }
      ],
      directorLogin: "operator@example.com"
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const result = await fetchAuthorizedClients(mockFetch);
    expect(result.clients).toHaveLength(1);
    expect(result.clients[0]!.companyName).toBe("Acme Corp");
    expect(result.directorLogin).toBe("operator@example.com");
  });

  it("fetchAuthorizedClients throws UPSTREAM_VALIDATION_ERROR when schema validation fails", async () => {
    const invalidResponse = {
      clients: [{ clientId: "not-a-uuid" }],
      directorLogin: ""
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(invalidResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    await expect(fetchAuthorizedClients(mockFetch)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "UPSTREAM_VALIDATION_ERROR"
    });
  });

  it("throws ProductEvidenceApiError on structured HTTP error", async () => {
    const errorBody = {
      error: "FORBIDDEN",
      message: "Director not authorized for this client"
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(errorBody), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const call = fetchProductSkus(sampleUuid, false, mockFetch);
    await expect(call).rejects.toBeInstanceOf(ProductEvidenceApiError);
    await expect(call).rejects.toMatchObject({
      statusCode: 403,
      errorCode: "FORBIDDEN",
      message: "Director not authorized for this client"
    });
  });

  it("throws ProductEvidenceApiError when response is unparseable non-JSON", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", {
          status: 502,
          headers: { "Content-Type": "text/html" }
        })
      )
    );

    await expect(fetchProductSkus(sampleUuid, false, mockFetch)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: "UPSTREAM_ERROR"
    });
  });

  it("createProductSku posts JSON and parses valid response", async () => {
    const skuResponse = {
      skuId: sampleUuid,
      clientId: sampleUuid,
      canonicalSku: "SKU-TEST-001",
      displayName: "Test SKU",
      version: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(skuResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const result = await createProductSku(
      sampleUuid,
      {
        actionId: sampleUuid,
        canonicalSku: "SKU-TEST-001",
        displayName: "Test SKU"
      },
      mockFetch
    );

    expect(result.canonicalSku).toBe("SKU-TEST-001");
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/clients/${sampleUuid}/product-skus`,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      })
    );
  });

  it("registerEvidenceAssetMultipart posts FormData", async () => {
    const assetResponse = {
      evidenceAsset: {
        evidenceId: sampleUuid,
        clientId: sampleUuid,
        currentRevision: 1,
        version: 1,
        createdAt: now,
        archivedAt: null
      },
      evidenceRevision: {
        clientId: sampleUuid,
        evidenceId: sampleUuid,
        revision: 1,
        sourceObjectId: sampleUuid,
        sourceClass: "photo",
        acquisitionMethod: "direct_upload",
        submittedBy: "operator-1",
        submittedAt: now,
        assertionText: "Hero trichome capture",
        reportedCaptureDate: null,
        reportedCaptureTimestamp: null,
        reportedCapturePrecision: "date",
        captureContext: null,
        rightsStatus: "granted",
        consentStatus: "granted",
        rightsAttribution: null,
        rightsDocumentLocator: null,
        supersedesRevision: null
      },
      sourceObject: {
        sourceObjectId: sampleUuid,
        originalSha256: sampleSha,
        byteLength: 2048,
        detectedMimeType: "image/png",
        uploadedAt: now,
        uploaderId: "operator-1",
        accessClass: "restricted_original",
        retentionClass: "source_evidence_archive",
        retentionPolicyVersion: "1.0",
        availability: "available"
      },
      batchEvidenceLink: {
        clientId: sampleUuid,
        batchId: sampleUuid,
        evidenceId: sampleUuid,
        evidenceRevision: 1,
        purpose: "macro_hero_photo",
        assertedBy: "operator-1",
        assertedAt: now
      },
      derivative: null
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(assetResponse), {
          status: 201,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const formData = new FormData();
    formData.append("file", new Blob(["test"], { type: "image/png" }));

    const result = await registerEvidenceAssetMultipart(
      sampleUuid,
      sampleUuid,
      formData,
      mockFetch
    );

    expect(result.evidenceAsset.evidenceId).toBe(sampleUuid);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/clients/${sampleUuid}/batches/${sampleUuid}/evidence`,
      expect.objectContaining({
        method: "POST",
        body: formData
      })
    );
  });

  it("fetchEvidenceMedia returns valid delivery metadata", async () => {
    const delivery = {
      clientId: sampleUuid,
      batchId: sampleUuid,
      evidenceId: sampleUuid,
      evidenceRevision: 1,
      sourceObjectId: sampleUuid,
      originalSha256: sampleSha,
      detectedMimeType: "image/png",
      byteLength: 1024,
      url: "http://storage.internal/media/presigned",
      expiresAt: now
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(delivery), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const result = await fetchEvidenceMedia(sampleUuid, sampleUuid, sampleUuid, 1, mockFetch);
    expect(result.url).toBe("http://storage.internal/media/presigned");
    expect(result.detectedMimeType).toBe("image/png");
  });

  it("fetchBatchEvidenceDossier parses full dossier response", async () => {
    const dossierData = {
      schemaVersion: "1.0.0",
      clientId: sampleUuid,
      sku: {
        skuId: sampleUuid,
        clientId: sampleUuid,
        canonicalSku: "SKU-CANONICAL",
        displayName: "Canonical Product",
        version: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      batch: {
        batchId: sampleUuid,
        skuId: sampleUuid,
        clientId: sampleUuid,
        lotIdentifier: "LOT-2026",
        displayName: "Batch 2026",
        currentFactsRevision: 1,
        version: 1,
        createdAt: now,
        updatedAt: now,
        archivedAt: null
      },
      factsHistory: [
        {
          clientId: sampleUuid,
          batchId: sampleUuid,
          revision: 1,
          originKind: "own_production",
          producerIdentityAsClaimed: "Apex Facility",
          productionStartDate: null,
          productionEndDate: null,
          originEvidenceId: null,
          originEvidenceRevision: null,
          supersedesRevision: null,
          assertedBy: "operator-1",
          assertedAt: now
        }
      ],
      evidenceLinks: [],
      evidence: [],
      coaReports: [],
      claims: [],
      resolvedAt: now
    };

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(dossierData), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const result = await fetchBatchEvidenceDossier(sampleUuid, sampleUuid, mockFetch);
    expect(result.sku.canonicalSku).toBe("SKU-CANONICAL");
    expect(result.batch.lotIdentifier).toBe("LOT-2026");
    expect(result.factsHistory).toHaveLength(1);
  });
});
