import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import type { UnitOfWork } from "@cco/application";
import {
  TailscaleReviewerIdentityResolver,
  parseReviewerIdentityConfig,
  normalizeIpAddress
} from "./reviewer-identity.js";
import { ReviewerIdentityUnavailableError } from "./errors.js";
import { createControlApiApp } from "./app.js";

function createMockRequest(options: {
  remoteAddress?: string;
  headers?: Record<string, string | string[] | undefined>;
}): FastifyRequest {
  return {
    raw: {
      socket: {
        remoteAddress: options.remoteAddress
      }
    },
    headers: options.headers ?? {}
  } as unknown as FastifyRequest;
}

describe("TailscaleReviewerIdentityResolver behavioral invariants", () => {
  it("prefers a trimmed Tailscale login from a trusted direct proxy", () => {
    const resolver = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["127.0.0.1"]
    });

    const request = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-login": "  director@tailnet.example  ",
        "tailscale-user-name": "Display Name"
      }
    });

    expect(resolver.resolve(request)).toBe("director@tailnet.example");
  });

  it("uses a trimmed Tailscale display name when a trusted proxy supplies no login", () => {
    const resolver = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["127.0.0.1"]
    });

    // 1. Missing login header
    const req1 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-name": "  Director Alice  "
      }
    });
    expect(resolver.resolve(req1)).toBe("Director Alice");

    // 2. Blank login header
    const req2 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-login": "   ",
        "tailscale-user-name": "  Director Alice  "
      }
    });
    expect(resolver.resolve(req2)).toBe("Director Alice");
  });

  it("ignores forged Tailscale headers from an untrusted peer", () => {
    // Untrusted peer without fallback throws ReviewerIdentityUnavailableError
    const resolverWithoutFallback = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["127.0.0.1"]
    });
    const untrustedReq = createMockRequest({
      remoteAddress: "192.168.1.50",
      headers: {
        "tailscale-user-login": "forged-admin@tailnet.example",
        "tailscale-user-name": "Forged Admin"
      }
    });
    expect(() => resolverWithoutFallback.resolve(untrustedReq)).toThrow(
      ReviewerIdentityUnavailableError
    );
  });

  it("rejects configuring a fallback identity together with trusted proxy addresses", () => {
    // A fallback is only meaningful when Tailscale enforcement is fully disabled for the
    // deployment (no trusted proxy addresses at all). Combining both would let any untrusted
    // request be attributed to the fallback identity instead of being rejected, so this must
    // fail loudly at construction rather than silently ignoring the fallback per-request.
    expect(
      () =>
        new TailscaleReviewerIdentityResolver({
          trustedProxyAddresses: ["127.0.0.1"],
          fallbackIdentity: "Explicit Fallback Director"
        })
    ).toThrow(/fallback identity cannot be combined with trusted proxy addresses/);
  });

  it("rejects a trusted-but-headerless request when Tailscale enforcement is active, even with a fallback configured", () => {
    // Trusted proxy addresses and a fallback identity cannot both be configured (see the
    // rejection test above), so a resolver enforcing Tailscale identity never has a fallback
    // to fall through to: a trusted peer that fails to supply usable headers must fail closed.
    const resolver = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["127.0.0.1"]
    });

    // Trusted peer with missing headers
    const req1 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {}
    });
    expect(() => resolver.resolve(req1)).toThrow(ReviewerIdentityUnavailableError);

    // Trusted peer with empty/blank headers
    const req2 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-login": "   ",
        "tailscale-user-name": ""
      }
    });
    expect(() => resolver.resolve(req2)).toThrow(ReviewerIdentityUnavailableError);
  });

  it("uses the explicit fallback only when Tailscale enforcement is fully disabled (no trusted proxy addresses)", () => {
    const resolver = new TailscaleReviewerIdentityResolver({
      fallbackIdentity: "Explicit Fallback Director"
    });

    const req = createMockRequest({
      remoteAddress: "192.168.1.50",
      headers: {}
    });
    expect(resolver.resolve(req)).toBe("Explicit Fallback Director");

    const noFallbackResolver = new TailscaleReviewerIdentityResolver({});
    expect(() => noFallbackResolver.resolve(req)).toThrow(ReviewerIdentityUnavailableError);
  });

  it("rejects ambiguous or oversized identity headers without revealing the cause", () => {
    const resolver = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["127.0.0.1"]
    });

    // 1. Repeated/array login header throws non-sensitive error
    const reqRepeatedLogin = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-login": ["user1@example.com", "user2@example.com"]
      }
    });
    expect(() => resolver.resolve(reqRepeatedLogin)).toThrow(ReviewerIdentityUnavailableError);

    // 2. Repeated/array name header throws non-sensitive error
    const reqRepeatedName = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-name": ["User One", "User Two"]
      }
    });
    expect(() => resolver.resolve(reqRepeatedName)).toThrow(ReviewerIdentityUnavailableError);

    // 3. Exactly 128 characters is valid
    const valid128 = "a".repeat(128);
    const req128 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-login": valid128
      }
    });
    expect(resolver.resolve(req128)).toBe(valid128);

    // 4. Exactly 129 characters throws non-sensitive error
    const invalid129 = "a".repeat(129);
    const req129 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-login": invalid129
      }
    });
    expect(() => resolver.resolve(req129)).toThrow(ReviewerIdentityUnavailableError);

    // 5. Oversized display name throws non-sensitive error
    const req129Name = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: {
        "tailscale-user-name": invalid129
      }
    });
    expect(() => resolver.resolve(req129Name)).toThrow(ReviewerIdentityUnavailableError);
  });

  it("treats IPv4 and IPv4-mapped IPv6 peer addresses as equivalent", () => {
    // Config configured with IPv4 address
    const resolverV4 = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["127.0.0.1"]
    });

    const reqV4 = createMockRequest({
      remoteAddress: "127.0.0.1",
      headers: { "tailscale-user-login": "user@example.com" }
    });
    const reqMappedV6 = createMockRequest({
      remoteAddress: "::ffff:127.0.0.1",
      headers: { "tailscale-user-login": "user@example.com" }
    });
    const reqOther = createMockRequest({
      remoteAddress: "127.0.0.2",
      headers: { "tailscale-user-login": "user@example.com" }
    });

    expect(resolverV4.resolve(reqV4)).toBe("user@example.com");
    expect(resolverV4.resolve(reqMappedV6)).toBe("user@example.com");
    expect(() => resolverV4.resolve(reqOther)).toThrow(ReviewerIdentityUnavailableError);

    // Config configured with IPv4-mapped IPv6 address
    const resolverMapped = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["::ffff:10.0.0.1"]
    });
    const reqV4_10 = createMockRequest({
      remoteAddress: "10.0.0.1",
      headers: { "tailscale-user-login": "user@example.com" }
    });
    const reqMappedV6_10 = createMockRequest({
      remoteAddress: "::ffff:10.0.0.1",
      headers: { "tailscale-user-login": "user@example.com" }
    });
    expect(resolverMapped.resolve(reqV4_10)).toBe("user@example.com");
    expect(resolverMapped.resolve(reqMappedV6_10)).toBe("user@example.com");
  });

  it("accepts pure IPv6 trusted proxy", () => {
    const resolver = new TailscaleReviewerIdentityResolver({
      trustedProxyAddresses: ["::1"]
    });
    const req = createMockRequest({
      remoteAddress: "::1",
      headers: { "tailscale-user-login": "user@example.com" }
    });
    expect(resolver.resolve(req)).toBe("user@example.com");
  });

  it("rejects invalid identity deployment configuration during app creation", () => {
    const fakeUow = {} as UnitOfWork;

    // 1. Invalid IP literal
    expect(() => {
      const origEnv = process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
      try {
        process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES = "127.0.0.1, invalid-ip";
        createControlApiApp({ uow: fakeUow });
      } finally {
        if (origEnv !== undefined) {
          process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES = origEnv;
        } else {
          delete process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
        }
      }
    }).toThrow();

    // 2. Empty element in proxy list
    expect(() => {
      const origEnv = process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
      try {
        process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES = "127.0.0.1, , 10.0.0.1";
        createControlApiApp({ uow: fakeUow });
      } finally {
        if (origEnv !== undefined) {
          process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES = origEnv;
        } else {
          delete process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
        }
      }
    }).toThrow();

    // 3. Duplicate proxy addresses (including IPv4 and IPv4-mapped duplicate)
    expect(() => {
      const origEnv = process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
      try {
        process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES = "127.0.0.1, ::ffff:127.0.0.1";
        createControlApiApp({ uow: fakeUow });
      } finally {
        if (origEnv !== undefined) {
          process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES = origEnv;
        } else {
          delete process.env.CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES;
        }
      }
    }).toThrow();

    // 4. Oversized fallback identity (>128 chars)
    expect(() => {
      const origEnv = process.env.CONTROL_API_REVIEWER_IDENTITY_FALLBACK;
      try {
        process.env.CONTROL_API_REVIEWER_IDENTITY_FALLBACK = "f".repeat(129);
        createControlApiApp({ uow: fakeUow });
      } finally {
        if (origEnv !== undefined) {
          process.env.CONTROL_API_REVIEWER_IDENTITY_FALLBACK = origEnv;
        } else {
          delete process.env.CONTROL_API_REVIEWER_IDENTITY_FALLBACK;
        }
      }
    }).toThrow();
  });
});

describe("parseReviewerIdentityConfig", () => {
  it("returns empty proxies and undefined fallback when environment variables are missing or blank", () => {
    expect(parseReviewerIdentityConfig({})).toEqual({
      trustedProxyAddresses: []
    });

    expect(
      parseReviewerIdentityConfig({
        CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: "   ",
        CONTROL_API_REVIEWER_IDENTITY_FALLBACK: "  "
      })
    ).toEqual({
      trustedProxyAddresses: []
    });
  });

  it("parses and trims valid configuration", () => {
    const config = parseReviewerIdentityConfig({
      CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: "  127.0.0.1 , 10.0.0.2  ",
      CONTROL_API_REVIEWER_IDENTITY_FALLBACK: "  Director Fallback  "
    });

    expect(config).toEqual({
      trustedProxyAddresses: ["127.0.0.1", "10.0.0.2"],
      fallbackIdentity: "Director Fallback"
    });
  });

  it("rejects CIDR blocks as invalid IP literals", () => {
    expect(() =>
      parseReviewerIdentityConfig({
        CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: "127.0.0.1/24"
      })
    ).toThrow();
  });
});

describe("TailscaleReviewerIdentityResolver NODE_ENV=production construction guards", () => {
  it("rejects fallbackIdentity when NODE_ENV=production", () => {
    expect(
      () =>
        new TailscaleReviewerIdentityResolver({
          nodeEnv: "production",
          fallbackIdentity: "Dev Fallback Director"
        })
    ).toThrow(/NODE_ENV=production/);
  });

  it("accepts trustedProxyAddresses only when NODE_ENV=production", () => {
    expect(
      () =>
        new TailscaleReviewerIdentityResolver({
          nodeEnv: "production",
          trustedProxyAddresses: ["127.0.0.1"]
        })
    ).not.toThrow();
  });

  it("accepts fallbackIdentity when NODE_ENV is not production", () => {
    expect(
      () =>
        new TailscaleReviewerIdentityResolver({
          nodeEnv: "test",
          fallbackIdentity: "Dev Fallback Director"
        })
    ).not.toThrow();
  });

  it("lets the existing mutual-exclusion error win when both proxies and fallback are configured in production", () => {
    // The new NODE_ENV=production check is a defense-in-depth layer for the
    // fallback-only misconfiguration. When both proxies and fallback are
    // configured together, the existing mutual-exclusion check is the more
    // specific failure and must take precedence so the operator is pointed at
    // the actual configuration error, not at the production guard.
    expect(
      () =>
        new TailscaleReviewerIdentityResolver({
          nodeEnv: "production",
          trustedProxyAddresses: ["127.0.0.1"],
          fallbackIdentity: "Dev Fallback Director"
        })
    ).toThrow(/fallback identity cannot be combined with trusted proxy addresses/);
  });
});

describe("normalizeIpAddress", () => {
  it("normalizes IPv4, IPv4-mapped IPv6, and pure IPv6 addresses", () => {
    expect(normalizeIpAddress("127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIpAddress("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIpAddress("::FFFF:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIpAddress("::1")).toBe("::1");
    expect(normalizeIpAddress("2001:db8::1")).toBe("2001:db8::1");
  });

  it("throws on invalid IP address", () => {
    expect(() => normalizeIpAddress("not-an-ip")).toThrow();
    expect(() => normalizeIpAddress("256.0.0.1")).toThrow();
  });
});
