/**
 * Ordered find/replace passes applied to free-text error content before it is
 * ever written to a log. Each pattern targets a specific credential shape
 * observed in this repo's own test fixtures (route.test.ts's upstream and
 * fallback error text) rather than attempting a general-purpose secret
 * scanner. Order matters: URL-credential redaction runs before the generic
 * key/value passes so a redacted URL doesn't get double-processed.
 */
const REDACTION_PASSES: ReadonlyArray<{ readonly pattern: RegExp; readonly replacement: string }> =
  [
    // scheme://<userinfo>@host -> scheme://[REDACTED]@host (keeps host/port/path).
    // Matches everything up to the LAST '@' before the authority ends (at the
    // next '/' or end of string) rather than assuming a colon-delimited
    // user:pass pair — required because userinfo content (in particular, a
    // password) can itself legitimately contain '@' or have no colon at all
    // (single-token userinfo, e.g. "token@host").
    { pattern: /(:\/\/)[^\s/]+@/g, replacement: "$1[REDACTED]@" },
    // "password": "...", "secret_token": "...", "api_key": "...", "authorization": "..."
    // Matches JSON string values while respecting escaped characters (e.g. "abc\"def")
    {
      pattern:
        /("(?:password|secret[_-]?token|api[_-]?key|token|authorization)"\s*:\s*")(?:[^"\\]|\\.)*(")/gi,
      replacement: "$1[REDACTED]$2"
    },
    // free-text "password <value>" / "password: <value>" / "password=<value>"
    { pattern: /\bpasswords?\b(\s*[:=]?\s*)(\S+)/gi, replacement: "password$1[REDACTED]" },
    // "Authorization: Bearer <token>" / "Bearer <token>" (case-insensitive)
    { pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "$1 [REDACTED]" }
  ];

export function redactSecrets(text: string): string {
  return REDACTION_PASSES.reduce(
    (acc, { pattern, replacement }) => acc.replace(pattern, replacement),
    text
  );
}

export interface SafeErrorProjection {
  readonly errorType: string;
  readonly safeMessage: string;
  readonly safeStack?: string;
  readonly cause?: SafeErrorProjection;
  readonly code?: string | number;
  readonly address?: string;
  readonly port?: number;
}

/**
 * Bounded, secret-safe representation of an unknown caught value, suitable
 * for server-side logging (never for a client-facing response body). Retains
 * the real diagnostic text (host, status prose, domain detail) while
 * removing credential-shaped substrings via redactSecrets. Distinct from
 * `errorMessage` (which returns raw, unredacted text for contexts where the
 * caller has already established the value is safe to surface, e.g.
 * synchronous internal validation messages) — this function makes no such
 * assumption about its input's provenance.
 *
 * Supports cycle-safe, depth-bounded recursive projection of nested causes
 * and preserves connection metadata (code, address, port) when present.
 */
export function projectErrorForLogging(
  err: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet<object>()
): SafeErrorProjection {
  const MAX_DEPTH = 5;

  if (typeof err === "object" && err !== null) {
    if (seen.has(err)) {
      return {
        errorType: err.constructor?.name ?? "object",
        safeMessage: "[Circular]"
      };
    }
    seen.add(err);
  }

  if (err instanceof Error) {
    let projectedCause: SafeErrorProjection | undefined;
    if (depth < MAX_DEPTH && "cause" in err && err.cause !== undefined) {
      projectedCause = projectErrorForLogging(err.cause, depth + 1, seen);
    }

    const errAny = err as unknown as Record<string, unknown>;
    const code =
      typeof errAny.code === "string" || typeof errAny.code === "number" ? errAny.code : undefined;
    const address = typeof errAny.address === "string" ? redactSecrets(errAny.address) : undefined;
    const port = typeof errAny.port === "number" ? errAny.port : undefined;

    return {
      errorType: err.constructor.name,
      safeMessage: redactSecrets(err.message),
      ...(typeof err.stack === "string" ? { safeStack: redactSecrets(err.stack) } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(projectedCause !== undefined ? { cause: projectedCause } : {})
    };
  }

  if (typeof err === "object" && err !== null) {
    const errAny = err as Record<string, unknown>;
    const code =
      typeof errAny.code === "string" || typeof errAny.code === "number" ? errAny.code : undefined;
    const address = typeof errAny.address === "string" ? redactSecrets(errAny.address) : undefined;
    const port = typeof errAny.port === "number" ? errAny.port : undefined;
    let projectedCause: SafeErrorProjection | undefined;
    if (depth < MAX_DEPTH && "cause" in err && errAny.cause !== undefined) {
      projectedCause = projectErrorForLogging(errAny.cause, depth + 1, seen);
    }

    return {
      errorType: typeof err,
      safeMessage: redactSecrets(String(err)),
      ...(code !== undefined ? { code } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(port !== undefined ? { port } : {}),
      ...(projectedCause !== undefined ? { cause: projectedCause } : {})
    };
  }

  return { errorType: typeof err, safeMessage: redactSecrets(String(err)) };
}
