import { describe, expect, it } from "vitest";
import Fastify, { type FastifyRequest } from "fastify";
import type { Pool, QueryResult } from "pg";
import {
  createClientSessionToken,
  createProductionClientSessionAuthenticator,
  installClientSessionMiddleware,
  SessionClientContextResolver,
  verifyClientSessionToken,
  VERIFIED_CLIENT_PRINCIPAL_KEY
} from "./client-context.js";

describe("SessionClientContextResolver", () => {
  const resolver = new SessionClientContextResolver();
  const validUuid = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";

  it("resolves clientId from authoritative VERIFIED_CLIENT_PRINCIPAL_KEY", () => {
    const req = {
      [VERIFIED_CLIENT_PRINCIPAL_KEY]: {
        clientId: validUuid,
        authenticatedAt: new Date(),
        authMethod: "session_token"
      }
    } as unknown as FastifyRequest;

    expect(resolver.resolve(req)).toBe(validUuid);
  });

  it("returns null when no verified principal is present", () => {
    const req = {} as unknown as FastifyRequest;
    expect(resolver.resolve(req)).toBeNull();
  });

  it("returns null when principal clientId is not a valid UUID", () => {
    const req = {
      [VERIFIED_CLIENT_PRINCIPAL_KEY]: {
        clientId: "not-a-valid-uuid",
        authenticatedAt: new Date(),
        authMethod: "session_token"
      }
    } as unknown as FastifyRequest;

    expect(resolver.resolve(req)).toBeNull();
  });

  it("returns null when principal clientId is empty string or whitespace", () => {
    const req = {
      [VERIFIED_CLIENT_PRINCIPAL_KEY]: {
        clientId: "   ",
        authenticatedAt: new Date(),
        authMethod: "session_token"
      }
    } as unknown as FastifyRequest;

    expect(resolver.resolve(req)).toBeNull();
  });

  it("strictly rejects unverified ambient request decorations (session, clientContext, user, auth)", () => {
    const req = {
      session: { clientId: validUuid },
      clientContext: { clientId: validUuid },
      user: { clientId: validUuid },
      auth: { clientId: validUuid },
      raw: { session: { clientId: validUuid } }
    } as unknown as FastifyRequest;

    expect(resolver.resolve(req)).toBeNull();
  });

  it("strictly rejects headers, query parameters, or route params as identity sources", () => {
    const req = {
      headers: { "x-client-id": validUuid, "x-authenticated-client-id": validUuid },
      params: { clientId: validUuid },
      query: { clientId: validUuid }
    } as unknown as FastifyRequest;

    expect(resolver.resolve(req)).toBeNull();
  });
});

describe("Client Session Tokens (HMAC-SHA256)", () => {
  const validClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const secret = "test-session-secret-key-12345";

  it("creates and verifies a valid token successfully", async () => {
    const token = createClientSessionToken({ clientId: validClientId, secret });
    expect(token.startsWith("cco_s1.")).toBe(true);

    const verified = await verifyClientSessionToken({ token, secret });
    expect(verified).not.toBeNull();
    expect(verified?.clientId).toBe(validClientId);
    expect(verified?.authMethod).toBe("session_token");
    expect(verified?.authenticatedAt).toBeInstanceOf(Date);
  });

  it("rejects token when secret does not match", async () => {
    const token = createClientSessionToken({ clientId: validClientId, secret });
    const verified = await verifyClientSessionToken({ token, secret: "wrong-secret" });
    expect(verified).toBeNull();
  });

  it("rejects token with tampered clientId", async () => {
    const token = createClientSessionToken({ clientId: validClientId, secret });
    const parts = token.split(".");
    // Tamper the client ID
    parts[1] = "018e69e0-8a6a-72cb-b1b7-ec79a1f73899";
    const tampered = parts.join(".");

    const verified = await verifyClientSessionToken({ token: tampered, secret });
    expect(verified).toBeNull();
  });

  it("rejects expired token", async () => {
    const pastTime = Date.now() - 100_000;
    const token = createClientSessionToken({
      clientId: validClientId,
      secret,
      issuedAt: pastTime
    });

    // maxAgeMs = 50s (so 100s ago is expired)
    const verified = await verifyClientSessionToken({
      token,
      secret,
      maxAgeMs: 50_000
    });
    expect(verified).toBeNull();
  });

  it("rejects token with timestamp in the far future (clock skew violation)", async () => {
    const futureTime = Date.now() + 120_000; // 2 minutes in future (> 60s tolerance)
    const token = createClientSessionToken({
      clientId: validClientId,
      secret,
      issuedAt: futureTime
    });

    const verified = await verifyClientSessionToken({ token, secret });
    expect(verified).toBeNull();
  });

  it("rejects malformed tokens", async () => {
    expect(await verifyClientSessionToken({ token: "not-a-token", secret })).toBeNull();
    expect(
      await verifyClientSessionToken({ token: "cco_s1.not-uuid.1234.sig", secret })
    ).toBeNull();
    expect(
      await verifyClientSessionToken({ token: `wrong_prefix.${validClientId}.1234.sig`, secret })
    ).toBeNull();
    expect(await verifyClientSessionToken({ token: "", secret })).toBeNull();
  });

  it("queries database when pool is provided and verifies client existence", async () => {
    const mockPool = {
      query: (async (_queryText: string, values?: readonly unknown[]): Promise<QueryResult> => {
        if (values && values[0] === validClientId) {
          return { rowCount: 1, rows: [{ id: validClientId }] } as unknown as QueryResult;
        }
        return { rowCount: 0, rows: [] } as unknown as QueryResult;
      }) as unknown
    } as unknown as Pool;

    const token = createClientSessionToken({ clientId: validClientId, secret });
    const verified = await verifyClientSessionToken({ token, secret, pool: mockPool });
    expect(verified?.clientId).toBe(validClientId);

    // With a non-existent client ID in database
    const unknownClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73999";
    const unknownToken = createClientSessionToken({ clientId: unknownClientId, secret });
    const verifiedUnknown = await verifyClientSessionToken({
      token: unknownToken,
      secret,
      pool: mockPool
    });
    expect(verifiedUnknown).toBeNull();
  });
});

describe("createProductionClientSessionAuthenticator", () => {
  const validClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const secret = "prod-secret-key";
  const authenticator = createProductionClientSessionAuthenticator({ secret });

  it("extracts and verifies valid Bearer token", async () => {
    const token = createClientSessionToken({ clientId: validClientId, secret });
    const req = {
      headers: {
        authorization: `Bearer ${token}`
      }
    } as unknown as FastifyRequest;

    const principal = await authenticator(req);
    expect(principal?.clientId).toBe(validClientId);
  });

  it("returns null when Authorization header is missing or invalid format", async () => {
    expect(await authenticator({ headers: {} } as unknown as FastifyRequest)).toBeNull();
    expect(
      await authenticator({
        headers: { authorization: "Basic 1234" }
      } as unknown as FastifyRequest)
    ).toBeNull();
    expect(
      await authenticator({
        headers: { authorization: "Bearer invalid-token" }
      } as unknown as FastifyRequest)
    ).toBeNull();
  });
});

describe("installClientSessionMiddleware", () => {
  const validClientId = "018e69e0-8a6a-72cb-b1b7-ec79a1f73801";
  const secret = "middleware-secret";
  const resolver = new SessionClientContextResolver();

  it("authenticates client using configured authenticator", async () => {
    const authenticator = createProductionClientSessionAuthenticator({ secret });
    const app = Fastify();
    installClientSessionMiddleware(app, {
      authenticator,
      nodeEnv: "production"
    });

    app.get("/test", async (request) => {
      const clientId = resolver.resolve(request);
      return { clientId };
    });

    const token = createClientSessionToken({ clientId: validClientId, secret });
    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: {
        authorization: `Bearer ${token}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clientId: validClientId });
  });

  it("leaves client null when no valid credentials provided", async () => {
    const authenticator = createProductionClientSessionAuthenticator({ secret });
    const app = Fastify();
    installClientSessionMiddleware(app, {
      authenticator,
      nodeEnv: "production"
    });

    app.get("/test", async (request) => {
      const clientId = resolver.resolve(request);
      return { clientId };
    });

    const response = await app.inject({
      method: "GET",
      url: "/test"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clientId: null });
  });

  it("strictly ignores caller-supplied x-authenticated-client-id header", async () => {
    const authenticator = createProductionClientSessionAuthenticator({ secret });
    const app = Fastify();
    installClientSessionMiddleware(app, {
      authenticator,
      nodeEnv: "production"
    });

    app.get("/test", async (request) => {
      const clientId = resolver.resolve(request);
      return { clientId };
    });

    const response = await app.inject({
      method: "GET",
      url: "/test",
      headers: {
        "x-authenticated-client-id": validClientId
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clientId: null });
  });

  it("fails in production when no authenticator is configured", () => {
    const app = Fastify();
    expect(() =>
      installClientSessionMiddleware(app, {
        nodeEnv: "production"
      })
    ).toThrowError(/an authenticator is required when NODE_ENV=production/);
  });

  it("forbids fallbackClientId when NODE_ENV=production", () => {
    const app = Fastify();
    expect(() =>
      installClientSessionMiddleware(app, {
        fallbackClientId: validClientId,
        nodeEnv: "production"
      })
    ).toThrowError(/fallbackClientId is forbidden when NODE_ENV=production/);
  });

  it("allows fallbackClientId in non-production environments", async () => {
    const app = Fastify();
    installClientSessionMiddleware(app, {
      fallbackClientId: validClientId,
      nodeEnv: "test"
    });

    app.get("/test", async (request) => {
      const clientId = resolver.resolve(request);
      return { clientId };
    });

    const response = await app.inject({
      method: "GET",
      url: "/test"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ clientId: validClientId });
  });
});
