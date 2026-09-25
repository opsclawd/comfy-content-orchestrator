import crypto from "node:crypto";
import type { ClientContextResolver } from "@cco/application";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool, PoolClient } from "pg";

export const VERIFIED_CLIENT_PRINCIPAL_KEY = Symbol.for("cco.verified_client_principal");

export interface VerifiedClientPrincipal {
  readonly clientId: string;
  readonly authenticatedAt: Date;
  readonly authMethod: "session_token" | "custom";
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_PREFIX = "cco_s1";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CLOCK_SKEW_MS = 60 * 1000; // 1 minute

export interface CreateClientSessionTokenOptions {
  readonly clientId: string;
  readonly secret: string;
  readonly issuedAt?: Date | number;
}

export function createClientSessionToken(options: CreateClientSessionTokenOptions): string {
  const { clientId, secret } = options;
  const trimmedId = clientId.trim().toLowerCase();
  if (!UUID_REGEX.test(trimmedId)) {
    throw new Error(`Invalid clientId: must be a valid UUID`);
  }
  if (!secret || secret.trim().length === 0) {
    throw new Error("Secret is required to create client session token");
  }
  const timestamp =
    typeof options.issuedAt === "number"
      ? options.issuedAt
      : options.issuedAt instanceof Date
        ? options.issuedAt.getTime()
        : Date.now();

  const payload = `${TOKEN_PREFIX}.${trimmedId}.${timestamp}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${hmac}`;
}

export interface VerifyClientSessionTokenOptions {
  readonly token: string;
  readonly secret: string;
  readonly maxAgeMs?: number | undefined;
  readonly pool?: Pool | PoolClient | undefined;
}

export async function verifyClientSessionToken(
  options: VerifyClientSessionTokenOptions
): Promise<VerifiedClientPrincipal | null> {
  const { token, secret, maxAgeMs = DEFAULT_MAX_AGE_MS, pool } = options;
  if (!token || typeof token !== "string" || !secret || secret.trim().length === 0) {
    return null;
  }

  const parts = token.trim().split(".");
  if (parts.length !== 4) {
    return null;
  }

  const [prefix, clientId, timestampStr, signature] = parts;
  if (prefix !== TOKEN_PREFIX || !clientId || !timestampStr || !signature) {
    return null;
  }

  const trimmedClientId = clientId.toLowerCase();
  if (!UUID_REGEX.test(trimmedClientId)) {
    return null;
  }

  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return null;
  }

  const now = Date.now();
  if (now > timestamp + maxAgeMs || timestamp > now + MAX_CLOCK_SKEW_MS) {
    return null;
  }

  const payload = `${prefix}.${trimmedClientId}.${timestampStr}`;
  const expectedHmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");

  if (signature.length !== expectedHmac.length) {
    return null;
  }

  const signatureBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expectedHmac, "hex");
  if (
    signatureBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(signatureBuf, expectedBuf)
  ) {
    return null;
  }

  if (pool) {
    try {
      const res = await pool.query<{ client_id: string }>(
        `SELECT client_id FROM clients WHERE client_id = $1 AND archived_at IS NULL`,
        [trimmedClientId]
      );
      if (res.rows.length === 0) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return {
    clientId: trimmedClientId,
    authenticatedAt: new Date(timestamp),
    authMethod: "session_token"
  };
}

export function createProductionClientSessionAuthenticator(options: {
  readonly secret: string;
  readonly pool?: Pool | PoolClient | undefined;
  readonly maxAgeMs?: number | undefined;
}): (request: FastifyRequest) => Promise<VerifiedClientPrincipal | null> {
  return async (request: FastifyRequest) => {
    const authHeader = request.headers.authorization;
    if (typeof authHeader !== "string") {
      return null;
    }
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
      return null;
    }
    const token = match[1].trim();
    return verifyClientSessionToken({
      token,
      secret: options.secret,
      ...(options.pool !== undefined ? { pool: options.pool } : {}),
      ...(options.maxAgeMs !== undefined ? { maxAgeMs: options.maxAgeMs } : {})
    });
  };
}

export interface ClientSessionMiddlewareOptions {
  readonly fallbackClientId?: string | undefined;
  readonly nodeEnv?: string | undefined;
  readonly authenticator?:
    | ((
        request: FastifyRequest
      ) => Promise<VerifiedClientPrincipal | null> | VerifiedClientPrincipal | null)
    | undefined;
  readonly trustedProxyAddresses?: readonly string[] | undefined;
}

export function installClientSessionMiddleware(
  app: FastifyInstance,
  options: ClientSessionMiddlewareOptions = {}
): void {
  const effectiveNodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  if (effectiveNodeEnv === "production") {
    if (options.fallbackClientId !== undefined) {
      throw new Error(
        "Invalid client session configuration: fallbackClientId is forbidden when NODE_ENV=production."
      );
    }
    if (!options.authenticator) {
      throw new Error(
        "Invalid client session configuration: an authenticator is required when NODE_ENV=production."
      );
    }
  }

  app.addHook("onRequest", async (request) => {
    // 1. Authenticator if configured
    if (options.authenticator) {
      const customPrincipal = await options.authenticator(request);
      if (customPrincipal && typeof customPrincipal.clientId === "string") {
        const trimmed = customPrincipal.clientId.trim();
        if (UUID_REGEX.test(trimmed)) {
          (request as unknown as Record<symbol, unknown>)[VERIFIED_CLIENT_PRINCIPAL_KEY] = {
            clientId: trimmed,
            authenticatedAt: customPrincipal.authenticatedAt ?? new Date(),
            authMethod: customPrincipal.authMethod ?? "custom"
          };
          return;
        }
      }
    }

    // 2. Fallback client ID (only permitted in dev/test, forbidden in production)
    if (options.fallbackClientId !== undefined && effectiveNodeEnv !== "production") {
      const trimmed = options.fallbackClientId.trim();
      if (UUID_REGEX.test(trimmed)) {
        (request as unknown as Record<symbol, unknown>)[VERIFIED_CLIENT_PRINCIPAL_KEY] = {
          clientId: trimmed,
          authenticatedAt: new Date(),
          authMethod: "custom"
        };
        return;
      }
    }
  });
}

/**
 * Resolves the authenticated client principal exclusively from verified context
 * established by trusted authentication/session middleware.
 *
 * Strict trust boundary:
 * - Does NOT trust :clientId route path parameter
 * - Does NOT trust request body fields
 * - Does NOT trust arbitrary client-supplied headers (e.g. x-client-id or unverified proxy headers)
 * - Does NOT accept unverified request.session / request.user / request.auth properties
 * - Only consumes authoritative VerifiedClientPrincipal established by trusted middleware
 */
export class SessionClientContextResolver implements ClientContextResolver<FastifyRequest> {
  resolve(request: FastifyRequest): string | null {
    const req = request as unknown as Record<symbol, unknown>;
    const principal = req[VERIFIED_CLIENT_PRINCIPAL_KEY] as VerifiedClientPrincipal | undefined;

    if (
      principal &&
      typeof principal.clientId === "string" &&
      UUID_REGEX.test(principal.clientId.trim())
    ) {
      return principal.clientId.trim();
    }

    return null;
  }
}
