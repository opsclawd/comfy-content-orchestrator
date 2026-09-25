import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, PATCH } from "./route.js";
import * as DirectorAccessModule from "../../../../../../api/director-client-access.js";

describe("Review Hub Client Reference Item Route Handler: /api/clients/[clientId]/references/[referenceId]", () => {
  const validClientId = "11111111-1111-1111-1111-111111111111";
  const validReferenceId = "22222222-2222-2222-2222-222222222222";
  const dummyContext = {
    params: Promise.resolve({
      clientId: validClientId,
      referenceId: validReferenceId
    })
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

  describe("DELETE", () => {
    it("returns 400 when referenceId is invalid UUID", async () => {
      const request = new Request(
        `http://localhost:3000/api/clients/${validClientId}/references/bad-id`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, {
        params: Promise.resolve({
          clientId: validClientId,
          referenceId: "bad-id"
        })
      });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("returns 204 when Control API archives asset successfully", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));

      const request = new Request(
        `http://localhost:3000/api/clients/${validClientId}/references/${validReferenceId}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, dummyContext);
      expect(response.status).toBe(204);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    });

    it("forwards 404 from Control API", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ code: "NOT_FOUND", message: "Reference asset not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } }
          )
        );

      const request = new Request(
        `http://localhost:3000/api/clients/${validClientId}/references/${validReferenceId}`,
        { method: "DELETE" }
      );
      const response = await DELETE(request, dummyContext);
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("NOT_FOUND");
    });
  });

  describe("PATCH", () => {
    it("returns 400 on invalid payload", async () => {
      const request = new Request(
        `http://localhost:3000/api/clients/${validClientId}/references/${validReferenceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryRole: "invalid_role" })
        }
      );
      const response = await PATCH(request, dummyContext);
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("VALIDATION_FAILURE");
    });

    it("updates role and returns 200 on success", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: validReferenceId,
            clientId: validClientId,
            displayName: "Hero Character",
            libraryRole: "product",
            previewUrl: "https://s3.example.com/asset.png",
            previewAvailability: "available"
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = new Request(
        `http://localhost:3000/api/clients/${validClientId}/references/${validReferenceId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ libraryRole: "product" })
        }
      );
      const response = await PATCH(request, dummyContext);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.libraryRole).toBe("product");
    });
  });
});
