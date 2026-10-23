import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { forwardProductEvidenceRequest } from "./product-evidence-forwarder";
import * as directorAccess from "./director-client-access";
import * as runtimeConfig from "./runtime-config";

describe("forwardProductEvidenceRequest", () => {
  const originalFetch = globalThis.fetch;
  const validClientId = "11111111-1111-7111-8111-111111111111";

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

  it("rejects invalid clientId UUID with 400 and Cache-Control: no-store", async () => {
    const req = new Request("http://localhost/api/clients/invalid-uuid/product-skus", {
      method: "GET"
    });

    const res = await forwardProductEvidenceRequest(req, {
      clientId: "invalid-uuid",
      upstreamPath: "/api/v1/clients/invalid-uuid/product-skus"
    });

    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_FAILURE");
  });

  it("rejects disallowed methods with 405", async () => {
    const req = new Request("http://localhost/api/clients/test/dossier", {
      method: "DELETE"
    });

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/batches/11111111-1111-7111-8111-111111111112/dossier`,
      allowedMethods: ["GET"]
    });

    expect(res.status).toBe(405);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("handles DirectorAuthenticationRequiredError with 401", async () => {
    vi.spyOn(directorAccess, "authorizeDirectorClientSession").mockRejectedValue(
      new directorAccess.DirectorAuthenticationRequiredError("Auth needed")
    );

    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.error).toBe("AUTHENTICATION_REQUIRED");
  });

  it("handles DirectorClientForbiddenError with 403", async () => {
    vi.spyOn(directorAccess, "authorizeDirectorClientSession").mockRejectedValue(
      new directorAccess.DirectorClientForbiddenError("Director not authorized")
    );

    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`
    });

    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.error).toBe("FORBIDDEN");
  });

  it("forwards GET with query string, Bearer token, and authoritative login header", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ skuId: "sku-1" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const req = new Request("http://localhost/api/clients/test/product-skus?includeArchived=true", {
      method: "GET",
      headers: {
        "tailscale-user-login": "spoofed-user",
        "x-reviewer-identity": "attacker"
      }
    });

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`,
      allowedMethods: ["GET"]
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `http://control-api.internal:8000/api/v1/clients/${validClientId}/product-skus?includeArchived=true`,
      expect.objectContaining({
        method: "GET",
        headers: {
          Authorization: "Bearer mock-session-token",
          "tailscale-user-login": "operator@example.com",
          Accept: "application/json"
        }
      })
    );
  });

  it("forwards POST with JSON body and preserves upstream 409 conflict", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "STALE_REVISION_CONFLICT",
          message: "Version mismatch"
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const req = new Request("http://localhost/api/clients/test/product-skus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canonicalSku: "SKU-001", displayName: "Sample" })
    });

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`,
      allowedMethods: ["POST"]
    });

    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.error).toBe("STALE_REVISION_CONFLICT");
  });

  it("returns 502 Bad Gateway when upstream fetch fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`
    });

    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.error).toBe("BAD_GATEWAY");
  });

  it("rejects invalid nested route parameters with 400", async () => {
    const req = new Request("http://localhost/api/clients/test/batches/not-a-uuid/facts", {
      method: "GET"
    });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/batches/not-a-uuid/facts`
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILURE");
  });

  it("sanitizes upstream HTML/non-JSON responses into 502 Bad Gateway", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("<html><body>502 Bad Gateway NGINX</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" }
      })
    );

    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`
    });

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("BAD_GATEWAY");
    expect(json.message).not.toContain("<html>");
  });

  it("validates multipart evidence metadata against schema and rejects missing metadata", async () => {
    const boundary = "---------------------------974767299852498929531610575";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\nfake-bytes\r\n--${boundary}--\r\n`;

    const req = new Request(
      "http://localhost/api/clients/test/batches/11111111-1111-7111-8111-111111111112/evidence",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body
      }
    );

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/batches/11111111-1111-7111-8111-111111111112/evidence`,
      allowedMethods: ["POST"]
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILURE");
    expect(json.message).toContain("metadata");
  });

  it("rejects unallowed subresource after batch UUID with 400", async () => {
    const req = new Request(
      "http://localhost/api/clients/test/batches/11111111-1111-7111-8111-111111111112/unknown-subresource",
      {
        method: "GET"
      }
    );
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/batches/11111111-1111-7111-8111-111111111112/unknown-subresource`
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILURE");
    expect(json.message).toContain("Invalid subresource after batch UUID");
  });

  it("rejects request body exceeding maxBytes with 413 PAYLOAD_TOO_LARGE", async () => {
    const req = new Request("http://localhost/api/clients/test/product-skus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(200) })
    });

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`,
      allowedMethods: ["POST"],
      maxBytes: 100 // Force limit at 100 bytes
    });

    expect(res.status).toBe(413);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("successfully forwards valid multipart evidence metadata to upstream", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ asset: { evidenceId: "11111111-1111-7111-8111-111111111113" } }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const boundary = "---------------------------974767299852498929531610575";
    const validMetadata = {
      actionId: "018f4a1a-7b3b-7123-8abc-0123456789ab", // valid UUIDv7
      batchId: "11111111-1111-7111-8111-111111111112",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      registrationIntent: "initial_assertion",
      declaredMimeType: "image/png",
      acquisitionMethod: "direct_upload",
      assertionText: "Verified original macro capture"
    };

    const body = `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(validMetadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hero.png"\r\nContent-Type: image/png\r\n\r\nPNG_BYTES_HERE\r\n--${boundary}--\r\n`;

    const req = new Request(
      "http://localhost/api/clients/test/batches/11111111-1111-7111-8111-111111111112/evidence",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body
      }
    );

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/batches/11111111-1111-7111-8111-111111111112/evidence`,
      allowedMethods: ["POST"]
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("forwards singular derivative upstreamPath for GET and POST successfully", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ derivativeId: "deriv-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
    );

    const evidenceId = "11111111-1111-7111-8111-111111111113";
    const batchId = "11111111-1111-7111-8111-111111111112";
    const singularPath = `/api/v1/clients/${validClientId}/batches/${batchId}/evidence/${evidenceId}/revisions/1/derivative`;

    // Test GET
    const getReq = new Request(`http://localhost${singularPath}`, { method: "GET" });
    const getRes = await forwardProductEvidenceRequest(getReq, {
      clientId: validClientId,
      upstreamPath: singularPath,
      allowedMethods: ["GET"]
    });
    expect(getRes.status).toBe(200);

    // Test POST
    const postReq = new Request(`http://localhost${singularPath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        referenceAssetId: "ref-1",
        derivativeSha256: "a".repeat(64),
        transformDescription: "test"
      })
    });
    const postRes = await forwardProductEvidenceRequest(postReq, {
      clientId: validClientId,
      upstreamPath: singularPath,
      allowedMethods: ["POST"]
    });
    expect(postRes.status).toBe(200);
  });

  it("handles streaming request body exceeding maxBytes by cancelling stream and returning 413", async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(200));
        controller.enqueue(new Uint8Array(200));
      },
      cancel() {
        cancelled = true;
      }
    });

    const req = new Request("http://localhost/api/clients/test/product-skus", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      // @ts-expect-error Node/undici supports duplex
      duplex: "half",
      body: stream
    });

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`,
      allowedMethods: ["POST"],
      maxBytes: 150
    });

    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    const json = await res.json();
    expect(json.error).toBe("PAYLOAD_TOO_LARGE");
  });

  it("preserves binary bytes and boundary in multipart upload", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ asset: { evidenceId: "11111111-1111-7111-8111-111111111113" } }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

    const boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW";
    const validMetadata = {
      actionId: "018f4a1a-7b3b-7123-8abc-0123456789ab",
      batchId: "11111111-1111-7111-8111-111111111112",
      purpose: "macro_hero_photo",
      sourceClass: "photo",
      registrationIntent: "initial_assertion",
      declaredMimeType: "image/png",
      acquisitionMethod: "direct_upload",
      assertionText: "Binary test capture"
    };

    // Construct raw binary payload with non-UTF8 bytes
    const textPart = `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(validMetadata)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="raw.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const trailingPart = `\r\n--${boundary}--\r\n`;

    const enc = new TextEncoder();
    const textBytes = enc.encode(textPart);
    const rawBinary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]);
    const trailingBytes = enc.encode(trailingPart);

    const totalLength = textBytes.length + rawBinary.length + trailingBytes.length;
    const fullBody = new Uint8Array(totalLength);
    fullBody.set(textBytes, 0);
    fullBody.set(rawBinary, textBytes.length);
    fullBody.set(trailingBytes, textBytes.length + rawBinary.length);

    const req = new Request(
      "http://localhost/api/clients/test/batches/11111111-1111-7111-8111-111111111112/evidence",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
        body: fullBody
      }
    );

    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/batches/11111111-1111-7111-8111-111111111112/evidence`,
      allowedMethods: ["POST"]
    });

    expect(res.status).toBe(201);
  });

  it("validates route params when options.params is supplied and rejects invalid params with 400", async () => {
    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      params: {
        clientId: validClientId,
        batchId: "invalid-batch-id"
      },
      upstreamPath: `/api/v1/clients/${validClientId}/batches/invalid-batch-id/dossier`
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILURE");
    expect(json.message).toContain("Invalid UUID parameter 'batchId'");
  });

  it("rejects non-positive integer revision route param with 400", async () => {
    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      params: {
        clientId: validClientId,
        revision: "0"
      },
      upstreamPath: `/api/v1/clients/${validClientId}/batches/11111111-1111-7111-8111-111111111112/evidence/11111111-1111-7111-8111-111111111113/revisions/0`
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("VALIDATION_FAILURE");
    expect(json.message).toContain("must be a positive integer");
  });

  it("validates successful upstream response against responseSchema and rejects malformed success with 502", async () => {
    const { z } = await import("zod");
    const testSchema = z.object({ expectedField: z.string() }).strict();

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpectedField: 123 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const req = new Request("http://localhost/api/clients/test/product-skus", { method: "GET" });
    const res = await forwardProductEvidenceRequest(req, {
      clientId: validClientId,
      upstreamPath: `/api/v1/clients/${validClientId}/product-skus`,
      responseSchema: testSchema
    });

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe("BAD_GATEWAY");
    expect(json.message).toContain("malformed response");
  });
});
