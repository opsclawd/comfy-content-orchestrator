import net from "node:net";
import type { FastifyRequest } from "fastify";
import { ReviewerIdentityUnavailableError } from "./errors.js";
import type { ReviewerIdentityResolver } from "./types.js";

export interface TailscaleReviewerIdentityResolverConfig {
  readonly trustedProxyAddresses?: readonly string[];
  readonly fallbackIdentity?: string;
}

export function normalizeIpAddress(ip: string): string {
  const trimmed = ip.trim();
  const ipVersion = net.isIP(trimmed);
  if (ipVersion === 0) {
    throw new Error(`Invalid IP literal: '${ip}'`);
  }
  if (ipVersion === 4) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("::ffff:")) {
    const v4Candidate = lower.slice(7);
    if (net.isIP(v4Candidate) === 4) {
      return v4Candidate;
    }
  }
  return lower;
}

export function parseReviewerIdentityConfig(
  env: NodeJS.ProcessEnv = process.env
): TailscaleReviewerIdentityResolverConfig {
  const rawProxyAddresses = env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
  const rawFallback = env.CONTROL_API_REVIEWER_IDENTITY_FALLBACK;

  const trustedProxyAddresses: string[] = [];
  if (rawProxyAddresses !== undefined && rawProxyAddresses.trim() !== "") {
    const elements = rawProxyAddresses.split(",");
    const seenNormalized = new Set<string>();

    for (const elem of elements) {
      const trimmed = elem.trim();
      if (trimmed === "") {
        throw new Error(
          "Invalid CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: contains empty element"
        );
      }
      const normalized = normalizeIpAddress(trimmed);
      if (seenNormalized.has(normalized)) {
        throw new Error(
          `Invalid CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: contains duplicate proxy address '${trimmed}'`
        );
      }
      seenNormalized.add(normalized);
      trustedProxyAddresses.push(normalized);
    }
  }

  let fallbackIdentity: string | undefined;
  if (rawFallback !== undefined && rawFallback.trim() !== "") {
    const trimmed = rawFallback.trim();
    if (trimmed.length > 128) {
      throw new Error(
        `Invalid CONTROL_API_REVIEWER_IDENTITY_FALLBACK: fallback identity exceeds maximum length of 128 characters (length: ${trimmed.length})`
      );
    }
    fallbackIdentity = trimmed;
  }

  return {
    trustedProxyAddresses,
    ...(fallbackIdentity !== undefined ? { fallbackIdentity } : {})
  };
}

export class TailscaleReviewerIdentityResolver implements ReviewerIdentityResolver {
  private readonly trustedProxies: ReadonlySet<string>;
  private readonly fallbackIdentity: string | undefined;

  constructor(config: TailscaleReviewerIdentityResolverConfig = {}) {
    const trustedProxies = new Set<string>();
    if (config.trustedProxyAddresses) {
      for (const addr of config.trustedProxyAddresses) {
        const trimmed = addr.trim();
        if (trimmed === "") {
          throw new Error("Invalid trusted proxy address: contains empty element");
        }
        const normalized = normalizeIpAddress(trimmed);
        if (trustedProxies.has(normalized)) {
          throw new Error(`Invalid trusted proxy address: duplicate proxy address '${trimmed}'`);
        }
        trustedProxies.add(normalized);
      }
    }
    this.trustedProxies = trustedProxies;

    if (config.fallbackIdentity !== undefined) {
      const trimmed = config.fallbackIdentity.trim();
      if (trimmed === "") {
        this.fallbackIdentity = undefined;
      } else {
        if (trimmed.length > 128) {
          throw new Error(
            `Fallback reviewer identity exceeds maximum length of 128 characters (length: ${trimmed.length})`
          );
        }
        this.fallbackIdentity = trimmed;
      }
    }
  }

  resolve(request: FastifyRequest): string {
    const rawRemoteAddress = request.raw?.socket?.remoteAddress;
    const isTrusted =
      rawRemoteAddress !== undefined &&
      rawRemoteAddress.trim() !== "" &&
      net.isIP(rawRemoteAddress.trim()) !== 0 &&
      this.trustedProxies.has(normalizeIpAddress(rawRemoteAddress));

    if (isTrusted) {
      const loginHeader = request.headers["tailscale-user-login"];
      const nameHeader = request.headers["tailscale-user-name"];

      if (loginHeader !== undefined) {
        if (Array.isArray(loginHeader)) {
          throw new ReviewerIdentityUnavailableError();
        }
        const trimmedLogin = loginHeader.trim();
        if (trimmedLogin !== "") {
          if (trimmedLogin.length > 128) {
            throw new ReviewerIdentityUnavailableError();
          }
          return trimmedLogin;
        }
      }

      if (nameHeader !== undefined) {
        if (Array.isArray(nameHeader)) {
          throw new ReviewerIdentityUnavailableError();
        }
        const trimmedName = nameHeader.trim();
        if (trimmedName !== "") {
          if (trimmedName.length > 128) {
            throw new ReviewerIdentityUnavailableError();
          }
          return trimmedName;
        }
      }
    }

    if (this.fallbackIdentity !== undefined) {
      return this.fallbackIdentity;
    }

    throw new ReviewerIdentityUnavailableError();
  }
}
