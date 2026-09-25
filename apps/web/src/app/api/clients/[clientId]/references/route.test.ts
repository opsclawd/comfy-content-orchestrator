import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route.js";
import * as DirectorAccessModule from "../../../../../api/director-client-access.js";

describe("Review Hub Client References Route Handler: /api/clients/[clientId]/references", () => {
  const validClientId = "11111111-1111-1111-1111-111111111111";
  const dummyContext = {
    params: Promise.resolve({ clientId: validClientId })
  };

  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.spyOn(DirectorAccessModule, "authorizeDirectorClientSession").mockResolvedValue({
      sessionToken: "dummy-session-token",
      directorLogin: "director@example.com"
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("GET", () => {
    it("returns 400 when clientId is not a valid UUID", async () => {
      const request = new Request("http://localhost:3000/api/clients/bad-uuid/references");
      const response = await GET(request, {
        params: Promise.resolve({ clientId: "bad-uuid" })
      });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("returns 401 when director authentication fails", async () => {
      vi.spyOn(DirectorAccessModule, "authorizeDirectorClientSession").mockRejectedValueOnce(
        new DirectorAccessModule.DirectorAuthenticationRequiredError()
      );

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`);
      const response = await GET(request, dummyContext);
      expect(response.status).toBe(401);
      expect((await response.json()).code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("returns 403 when director is forbidden for client", async () => {
      vi.spyOn(DirectorAccessModule, "authorizeDirectorClientSession").mockRejectedValueOnce(
        new DirectorAccessModule.DirectorClientForbiddenError()
      );

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`);
      const response = await GET(request, dummyContext);
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("FORBIDDEN");
    });

    it("forwards upstream list response on success", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            references: [
              {
                id: "22222222-2222-2222-2222-222222222222",
                clientId: validClientId,
                displayName: "Hero Character",
                libraryRole: "subject_identity",
                previewUrl: "https://s3.example.com/asset.png",
                previewAvailability: "available"
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`);
      const response = await GET(request, dummyContext);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.json();
      expect(body.references).toHaveLength(1);
      expect(body.references[0].displayName).toBe("Hero Character");
      expect(body.references[0].libraryRole).toBe("subject_identity");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/clients/${validClientId}/references`),
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer dummy-session-token"
          }
        })
      );
    });

    it("returns 502 on upstream fetch failure", async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network connection failed"));

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`);
      const response = await GET(request, dummyContext);
      expect(response.status).toBe(502);
      expect((await response.json()).code).toBe("BAD_GATEWAY");
    });
  });

  describe("POST", () => {
    it("returns 400 for unsupported content-type", async () => {
      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/gif",
          "x-reference-role": "subject_identity"
        },
        body: new Uint8Array([1, 2, 3])
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 when x-reference-role is missing", async () => {
      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png"
        },
        body: new Uint8Array([1, 2, 3])
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 when x-reference-role is invalid", async () => {
      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "x-reference-role": "not-a-role"
        },
        body: new Uint8Array([1, 2, 3])
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("returns 400 when body is empty", async () => {
      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "x-reference-role": "subject_identity"
        },
        body: new Uint8Array(0)
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("forwards binary upload to Control API with allowlisted headers and returns 201", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "22222222-2222-2222-2222-222222222222",
            clientId: validClientId,
            displayName: "Test Portrait",
            libraryRole: "subject_identity",
            previewUrl: "https://s3.example.com/asset.png",
            previewAvailability: "available"
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "x-reference-role": "subject_identity",
          "X-Display-Name": "Test Portrait",
          "X-Injected-Header": "Forbidden"
        },
        body: new Uint8Array([137, 80, 78, 71])
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.id).toBe("22222222-2222-2222-2222-222222222222");
      expect(body.libraryRole).toBe("subject_identity");

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/clients/${validClientId}/references`),
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer dummy-session-token",
            "Content-Type": "image/png",
            "x-reference-role": "subject_identity",
            "X-Display-Name": "Test Portrait"
          }
        })
      );
    });

    it("stops reading and cancels stream when chunked request exceeds 10 MiB without Content-Length", async () => {
      let wasCancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          // Provide 6 MiB chunks on demand
          controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        },
        cancel() {
          wasCancelled = true;
        }
      });

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "x-reference-role": "subject_identity"
          // Omit content-length header
        },
        body: stream,
        // @ts-expect-error duplex is required in node environment for streaming request bodies
        duplex: "half"
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("VALIDATION_FAILURE");
      expect(json.message).toContain("Payload exceeds 10 MiB limit");
      expect(wasCancelled).toBe(true);
    });

    it("returns 400 when declared content-length exceeds 10 MiB", async () => {
      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "x-reference-role": "subject_identity",
          "Content-Length": String(11 * 1024 * 1024)
        },
        body: new Uint8Array([1, 2, 3])
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("VALIDATION_FAILURE");
      expect(json.message).toContain("Payload exceeds 10 MiB limit");
    });

    it("returns 400 controlled client error when request body stream read errors", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1024));
          controller.error(new Error("Stream aborted by client"));
        }
      });

      const request = new Request(`http://localhost:3000/api/clients/${validClientId}/references`, {
        method: "POST",
        headers: {
          "Content-Type": "image/png",
          "x-reference-role": "subject_identity"
        },
        body: stream,
        // @ts-expect-error duplex is required in node environment for streaming request bodies
        duplex: "half"
      });

      const response = await POST(request, dummyContext);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.code).toBe("VALIDATION_FAILURE");
      expect(json.message).toContain("Failed to read request body stream");
      expect(json.message).toContain("Stream aborted by client");
    });
  });
});
