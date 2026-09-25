import { describe, expect, it } from "vitest";
import {
  authorizeDirectorClientSession,
  DirectorAuthenticationRequiredError,
  DirectorClientForbiddenError,
  isDirectorAuthorizedForClient,
  parseDirectorClientMappings,
  ReviewHubConfigError
} from "./director-client-access.js";
import type { WhoisClient } from "./reviewer-identity.js";

describe("director-client-access", () => {
  const testClientId = "11111111-1111-1111-1111-111111111111";
  const otherClientId = "22222222-2222-2222-2222-222222222222";
  const testSecret = "test-session-secret-abc";

  describe("parseDirectorClientMappings", () => {
    it("parses valid JSON map of director to client arrays", () => {
      const json = JSON.stringify({
        "alice@example.com": [testClientId],
        "bob@example.com": [testClientId, otherClientId]
      });
      const mappings = parseDirectorClientMappings(json);
      expect(mappings.get("alice@example.com")?.has(testClientId)).toBe(true);
      expect(mappings.get("alice@example.com")?.has(otherClientId)).toBe(false);
      expect(mappings.get("bob@example.com")?.has(otherClientId)).toBe(true);
    });

    it("returns empty map on invalid JSON or undefined", () => {
      expect(parseDirectorClientMappings("invalid-json").size).toBe(0);
      expect(parseDirectorClientMappings("").size).toBe(0);
      expect(parseDirectorClientMappings(undefined).size).toBe(0);
    });
  });

  describe("isDirectorAuthorizedForClient", () => {
    it("allows authorized clients and denies unauthorized clients", () => {
      const map = new Map<string, Set<string>>([
        ["alice@example.com", new Set([testClientId.toLowerCase()])]
      ]);
      expect(isDirectorAuthorizedForClient("alice@example.com", testClientId, map)).toBe(true);
      expect(isDirectorAuthorizedForClient("alice@example.com", otherClientId, map)).toBe(false);
      expect(isDirectorAuthorizedForClient("mallory@example.com", testClientId, map)).toBe(false);
    });

    it("supports wildcard access", () => {
      const map = new Map<string, Set<string>>([["admin@example.com", new Set(["*"])]]);
      expect(isDirectorAuthorizedForClient("admin@example.com", testClientId, map)).toBe(true);
      expect(isDirectorAuthorizedForClient("admin@example.com", otherClientId, map)).toBe(true);
    });
  });

  describe("authorizeDirectorClientSession", () => {
    const mockWhoisClient: WhoisClient = {
      resolve: async (ip: string) => {
        if (ip === "100.64.0.5") {
          return { login: "alice@example.com", displayName: "Alice" };
        }
        if (ip === "100.64.0.6") {
          return { login: "unauthorized@example.com", displayName: "Mallory" };
        }
        throw new Error("Unresolvable IP");
      }
    };

    it("mints a valid signed session token when director is entitled to client", async () => {
      const request = new Request(
        "http://localhost:3000/api/clients/" + testClientId + "/references",
        {
          headers: {
            "x-cco-tailscale-peer-ip": "100.64.0.5"
          }
        }
      );

      const mappings = new Map<string, Set<string>>([
        ["alice@example.com", new Set([testClientId.toLowerCase()])]
      ]);

      const result = await authorizeDirectorClientSession(request, testClientId, {
        whoisClient: mockWhoisClient,
        mappings,
        secret: testSecret
      });

      expect(result.directorLogin).toBe("alice@example.com");
      expect(result.sessionToken).toContain(`cco_s1.${testClientId}.`);
    });

    it("throws DirectorAuthenticationRequiredError when peer IP is missing or unresolvable", async () => {
      const request = new Request(
        "http://localhost:3000/api/clients/" + testClientId + "/references"
      );

      await expect(
        authorizeDirectorClientSession(request, testClientId, {
          whoisClient: mockWhoisClient,
          mappings: new Map(),
          secret: testSecret
        })
      ).rejects.toBeInstanceOf(DirectorAuthenticationRequiredError);
    });

    it("throws DirectorClientForbiddenError when director is not entitled to client", async () => {
      const request = new Request(
        "http://localhost:3000/api/clients/" + testClientId + "/references",
        {
          headers: {
            "x-cco-tailscale-peer-ip": "100.64.0.6"
          }
        }
      );

      const mappings = new Map<string, Set<string>>([
        ["alice@example.com", new Set([testClientId.toLowerCase()])]
      ]);

      await expect(
        authorizeDirectorClientSession(request, testClientId, {
          whoisClient: mockWhoisClient,
          mappings,
          secret: testSecret
        })
      ).rejects.toBeInstanceOf(DirectorClientForbiddenError);
    });

    it("throws ReviewHubConfigError when session secret is missing", async () => {
      const request = new Request(
        "http://localhost:3000/api/clients/" + testClientId + "/references",
        {
          headers: {
            "x-cco-tailscale-peer-ip": "100.64.0.5"
          }
        }
      );

      const prevSecret = process.env.CONTROL_API_CLIENT_SESSION_SECRET;
      delete process.env.CONTROL_API_CLIENT_SESSION_SECRET;

      try {
        await expect(
          authorizeDirectorClientSession(request, testClientId, {
            whoisClient: mockWhoisClient,
            mappings: new Map(),
            secret: ""
          })
        ).rejects.toBeInstanceOf(ReviewHubConfigError);
      } finally {
        if (prevSecret !== undefined) {
          process.env.CONTROL_API_CLIENT_SESSION_SECRET = prevSecret;
        }
      }
    });
  });
});
