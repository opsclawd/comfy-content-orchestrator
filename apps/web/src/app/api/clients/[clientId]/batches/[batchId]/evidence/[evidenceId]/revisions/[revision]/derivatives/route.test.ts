import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET, POST } from "./route";
import * as directorAccess from "../../../../../../../../../../../api/director-client-access";
import * as runtimeConfig from "../../../../../../../../../../../api/runtime-config";

describe("Derivative route handler (GET / POST)", () => {
  const originalFetch = globalThis.fetch;
  const clientId = "11111111-1111-7111-8111-111111111111";
  const batchId = "22222222-2222-7222-8222-222222222222";
  const evidenceId = "33333333-3333-7333-8333-333333333333";
  const revision = "1";

  const context = {
    params: Promise.resolve({
      clientId,
      batchId,
      evidenceId,
      revision
    })
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(runtimeConfig, "resolveControlApiBaseUrl").mockReturnValue(
      "http://control-api.internal:8000"
    );
    vi.spyOn(directorAccess, "authorizeDirectorClientSession").mockResolvedValue({
      sessionToken: "mock-session-token",
      directorLogin: "operator@example.com"
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("forwards GET into singular derivative upstream endpoint", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              clientId,
              derivativeId: "44444444-4444-7444-8444-444444444444",
              evidenceId,
              evidenceRevision: 1,
              referenceAssetId: "55555555-5555-7555-8555-555555555555",
              derivativeSha256: "a".repeat(64),
              transformDescription: "Test transform",
              transformToolVersion: null,
              createdBy: "operator@example.com",
              createdAt: "2026-10-22T00:00:00Z"
            }
          ]),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    const req = new Request("http://localhost/api/test", { method: "GET" });
    const res = await GET(req, context);

    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://control-api.internal:8000/api/v1/clients/${clientId}/batches/${batchId}/evidence/${evidenceId}/revisions/${revision}/derivative`,
      expect.objectContaining({ method: "GET" })
    );
  });

  it("forwards POST into singular derivative upstream endpoint", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            clientId,
            derivativeId: "44444444-4444-7444-8444-444444444444",
            evidenceId,
            evidenceRevision: 1,
            referenceAssetId: "55555555-5555-7555-8555-555555555555",
            derivativeSha256: "a".repeat(64),
            transformDescription: "Linked derivative",
            transformToolVersion: null,
            createdBy: "operator@example.com",
            createdAt: "2026-10-22T00:00:00Z"
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    );

    const body = {
      actionId: "018f4a1a-7b3b-7123-8abc-0123456789ab",
      evidenceId,
      evidenceRevision: 1,
      referenceAssetId: "55555555-5555-7555-8555-555555555555",
      derivativeSha256: "a".repeat(64),
      transformDescription: "Linked derivative"
    };

    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const res = await POST(req, context);

    expect(res.status).toBe(201);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://control-api.internal:8000/api/v1/clients/${clientId}/batches/${batchId}/evidence/${evidenceId}/revisions/${revision}/derivative`,
      expect.objectContaining({ method: "POST" })
    );
  });
});
