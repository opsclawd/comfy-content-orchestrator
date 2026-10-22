import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import * as reviewerIdentity from "../../../api/reviewer-identity";
import * as runtimeConfig from "../../../api/runtime-config";

describe("GET /api/authorized-clients", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env.REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(runtimeConfig, "resolveControlApiBaseUrl").mockReturnValue(
      "http://control-api.internal:8000"
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS = originalEnv;
    vi.restoreAllMocks();
  });

  it("returns 401 when reviewer identity is unavailable", async () => {
    vi.spyOn(reviewerIdentity, "resolveReviewerIdentity").mockRejectedValue(
      new reviewerIdentity.ReviewerIdentityUnavailableError("No peer IP")
    );

    const req = new Request("http://localhost/api/authorized-clients", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns filtered clients list according to director client mappings", async () => {
    vi.spyOn(reviewerIdentity, "resolveReviewerIdentity").mockResolvedValue({
      login: "director@example.com"
    });

    const clientA = "11111111-1111-7111-8111-111111111111";
    const clientB = "22222222-2222-7222-8222-222222222222";

    process.env.REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS = JSON.stringify({
      "director@example.com": [clientA]
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { clientId: clientA, companyName: "Client A" },
          { clientId: clientB, companyName: "Client B" }
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const req = new Request("http://localhost/api/authorized-clients", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.directorLogin).toBe("director@example.com");
    expect(json.clients).toHaveLength(1);
    expect(json.clients[0].clientId).toBe(clientA);
  });

  it("returns all clients when director mapping is wildcard '*'", async () => {
    vi.spyOn(reviewerIdentity, "resolveReviewerIdentity").mockResolvedValue({
      login: "admin@example.com"
    });

    const clientA = "11111111-1111-7111-8111-111111111111";
    const clientB = "22222222-2222-7222-8222-222222222222";

    process.env.REVIEW_HUB_DIRECTOR_CLIENT_MAPPINGS = JSON.stringify({
      "admin@example.com": ["*"]
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          { clientId: clientA, companyName: "Client A" },
          { clientId: clientB, companyName: "Client B" }
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    const req = new Request("http://localhost/api/authorized-clients", { method: "GET" });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.clients).toHaveLength(2);
  });
});
