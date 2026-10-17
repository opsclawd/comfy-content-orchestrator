import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GET } from "./route";
import * as runtimeConfigModule from "../../../api/runtime-config";

describe("GET /api/clients (Web Proxy Route)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(runtimeConfigModule, "resolveControlApiBaseUrl").mockReturnValue(
      "http://control-api.internal:8000"
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 200 with populated clients list and Cache-Control: no-store", async () => {
    const clients = [
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73801",
        companyName: "Acme Corp"
      },
      {
        clientId: "018e69e0-8a6a-72cb-b1b7-ec79a1f73802",
        companyName: "Beta LLC"
      }
    ];

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(clients), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual(clients);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://control-api.internal:8000/api/clients",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store"
      })
    );
  });

  it("returns 200 with empty array when no clients exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("relays upstream non-2xx status and error body with Cache-Control: no-store", async () => {
    const errorBody = { code: "INTERNAL_ERROR", message: "Database down" };
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      })
    );

    const res = await GET();

    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json).toEqual(errorBody);
  });

  it("returns 502 when upstream network fetch fails", async () => {
    globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await GET();

    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.code).toBe("BAD_GATEWAY");
  });

  it("returns 502 when upstream returns malformed JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response("<html>Not JSON</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" }
      })
    );

    const res = await GET();

    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.code).toBe("BAD_GATEWAY");
  });

  it("returns 502 when upstream returns data that fails schema validation", async () => {
    const invalidData = [
      {
        clientId: "not-a-uuid",
        companyName: "Acme Corp"
      }
    ];

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify(invalidData), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const res = await GET();

    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const json = await res.json();
    expect(json.code).toBe("BAD_GATEWAY");
  });

  it("does not require director authentication headers or mapping", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    // Call GET with no session or request context
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
