import { describe, expect, it } from "vitest";
import { createClientSessionToken } from "./client-session-token.js";

describe("createClientSessionToken", () => {
  const validClientId = "11111111-1111-1111-1111-111111111111";
  const secret = "test-secret-key";

  it("creates a valid cco_s1 token with 4 dot-separated parts", () => {
    const token = createClientSessionToken({
      clientId: validClientId,
      secret,
      issuedAt: 1700000000000
    });
    const parts = token.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("cco_s1");
    expect(parts[1]).toBe(validClientId);
    expect(parts[2]).toBe("1700000000000");
    expect(parts[3]).toHaveLength(64); // sha256 hex length
  });

  it("throws on invalid UUID clientId", () => {
    expect(() => createClientSessionToken({ clientId: "not-a-uuid", secret })).toThrow(
      "Invalid clientId: must be a valid UUID"
    );
  });

  it("throws on empty secret", () => {
    expect(() => createClientSessionToken({ clientId: validClientId, secret: "" })).toThrow(
      "Secret is required"
    );
  });
});
