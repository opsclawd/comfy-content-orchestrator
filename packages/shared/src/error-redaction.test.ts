import { describe, expect, it } from "vitest";
import { projectErrorForLogging, redactSecrets } from "./error-redaction.js";

describe("redactSecrets", () => {
  it("redacts standard URL credentials while keeping scheme, host, port, and path", () => {
    const raw =
      "Control API returned HTTP 500: Internal Server Error (PostgreSQL connection pool exhausted at postgresql://user:pass@db:5432/cco)";
    const redacted = redactSecrets(raw);

    expect(redacted).toContain("postgresql://[REDACTED]@db:5432/cco");
    expect(redacted).not.toContain("user:pass");
  });

  it("redacts JSON-shaped secret keys", () => {
    const raw =
      'Control API response failed schema validation: invalid internal field structure in {"secret_token": "xyz123"}';
    const redacted = redactSecrets(raw);

    expect(redacted).toContain('"secret_token": "[REDACTED]"');
    expect(redacted).not.toContain("xyz123");
  });

  it("redacts JSON-shaped secret keys with escaped quotes without leaking suffixes", () => {
    const raw = '{"secret_token": "abc\\"def"}';
    const redacted = redactSecrets(raw);

    expect(redacted).toBe('{"secret_token": "[REDACTED]"}');
    expect(redacted).not.toContain("abc");
    expect(redacted).not.toContain("def");
  });

  it("redacts free-text password phrases", () => {
    const raw = "Unexpected crash with database password supersecretpassword";
    const redacted = redactSecrets(raw);

    expect(redacted).toContain("password [REDACTED]");
    expect(redacted).not.toContain("supersecretpassword");
  });

  it("redacts Bearer and Basic authorization headers case-insensitively", () => {
    const rawBearer = "Authorization: Bearer sk-abc123def456";
    expect(redactSecrets(rawBearer)).not.toContain("sk-abc123def456");
    expect(redactSecrets(rawBearer)).toBe("Authorization: Bearer [REDACTED]");

    const rawBasic = "Authorization: Basic dXNlcjpwYXNz";
    expect(redactSecrets(rawBasic)).not.toContain("dXNlcjpwYXNz");
    expect(redactSecrets(rawBasic)).toBe("Authorization: Basic [REDACTED]");

    const lowerBearer = "authorization: bearer sk-abc123def456";
    expect(redactSecrets(lowerBearer)).not.toContain("sk-abc123def456");
    expect(redactSecrets(lowerBearer)).toBe("authorization: bearer [REDACTED]");

    const lowerBasic = "authorization: basic dXNlcjpwYXNz";
    expect(redactSecrets(lowerBasic)).not.toContain("dXNlcjpwYXNz");
    expect(redactSecrets(lowerBasic)).toBe("authorization: basic [REDACTED]");
  });

  it("preserves network error details and internal hosts without credentials", () => {
    const raw =
      "Failed to connect to Control API: connect ECONNREFUSED 127.0.0.1:3000 (internal secret host: https://internal-api.secret.cluster.local)";
    const redacted = redactSecrets(raw);

    expect(redacted).toBe(raw);
    expect(redacted).toContain("ECONNREFUSED");
    expect(redacted).toContain("127.0.0.1:3000");
    expect(redacted).toContain("https://internal-api.secret.cluster.local");
  });

  it("preserves non-credential plain infrastructure error text", () => {
    const fixtures = [
      "Simulated database failure before transaction commit",
      "Queue persistence failure",
      "database connection timeout"
    ];

    for (const fixture of fixtures) {
      expect(redactSecrets(fixture)).toBe(fixture);
    }
  });

  it("redacts URL credentials containing an embedded @ symbol without leaking password fragments", () => {
    const raw =
      "database connection timeout: could not authenticate to postgresql://ctrlapi:P@ssw0rd1@db-internal:5432/cco";
    const redacted = redactSecrets(raw);

    expect(redacted).toContain("postgresql://[REDACTED]@db-internal:5432/cco");
    expect(redacted).not.toContain("P@ssw0rd1");
    expect(redacted).not.toContain("ssw0rd1");
    expect(redacted).not.toContain("ctrlapi");
  });

  it("redacts single-token colon-free userinfo in URLs", () => {
    const raw = "Connecting to scheme://token@host:5432/db failed";
    const redacted = redactSecrets(raw);

    expect(redacted).toContain("scheme://[REDACTED]@host:5432/db");
    expect(redacted).not.toContain("token@host");
  });

  it("preserves path-based @ symbols that are not URL credentials", () => {
    const raw = "Fetched resource from https://example.com/@handle/path";
    const redacted = redactSecrets(raw);

    expect(redacted).toBe(raw);
  });
});

describe("projectErrorForLogging", () => {
  it("projects standard Error instances with errorType, safeMessage, and safeStack", () => {
    const err = new Error("Connection failed to postgresql://user:pass@db:5432/cco");
    const projection = projectErrorForLogging(err);

    expect(projection.errorType).toBe("Error");
    expect(projection.safeMessage).toContain("postgresql://[REDACTED]@db:5432/cco");
    expect(projection.safeMessage).not.toContain("user:pass");
    expect(typeof projection.safeStack).toBe("string");
    expect(projection.safeStack).not.toContain("user:pass");
  });

  it("preserves the constructor name for custom Error subclasses", () => {
    class CustomDomainError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomDomainError";
      }
    }

    const err = new CustomDomainError("Custom error occurred");
    const projection = projectErrorForLogging(err);

    expect(projection.errorType).toBe("CustomDomainError");
    expect(projection.safeMessage).toBe("Custom error occurred");
  });

  it("projects non-Error values with typeof and excludes safeStack entirely", () => {
    const stringThrow = "boom with password secret123";
    const stringProj = projectErrorForLogging(stringThrow);
    expect(stringProj.errorType).toBe("string");
    expect(stringProj.safeMessage).toContain("password [REDACTED]");
    expect(stringProj.safeMessage).not.toContain("secret123");
    expect("safeStack" in stringProj).toBe(false);

    const undefinedProj = projectErrorForLogging(undefined);
    expect(undefinedProj.errorType).toBe("undefined");
    expect(undefinedProj.safeMessage).toBe("undefined");
    expect("safeStack" in undefinedProj).toBe(false);

    const objectProj = projectErrorForLogging({ code: 500 });
    expect(objectProj.errorType).toBe("object");
    expect(objectProj.safeMessage).toBe("[object Object]");
    expect("safeStack" in objectProj).toBe(false);
  });

  it("redacts embedded-@ credentials when wrapped in an Error", () => {
    const raw =
      "database connection timeout: could not authenticate to postgresql://ctrlapi:P@ssw0rd1@db-internal:5432/cco";
    const err = new Error(raw);
    const projection = projectErrorForLogging(err);

    expect(projection.safeMessage).toContain("postgresql://[REDACTED]@db-internal:5432/cco");
    expect(projection.safeMessage).not.toContain("P@ssw0rd1");
    expect(projection.safeMessage).not.toContain("ssw0rd1");
    expect(projection.safeMessage).not.toContain("ctrlapi");
  });

  it("recursively projects and redacts nested cause errors", () => {
    const inner = new Error("inner failure with database password supersecret123");
    const outer = new Error("outer request failed", { cause: inner });
    const projection = projectErrorForLogging(outer);

    expect(projection.errorType).toBe("Error");
    expect(projection.safeMessage).toBe("outer request failed");
    expect(projection.cause).toBeDefined();
    expect(projection.cause?.errorType).toBe("Error");
    expect(projection.cause?.safeMessage).toContain("database password [REDACTED]");
    expect(projection.cause?.safeMessage).not.toContain("supersecret123");
  });

  it("preserves connection metadata (code, address, port) on network error causes", () => {
    const netErr = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {
      code: "ECONNREFUSED",
      address: "127.0.0.1",
      port: 3000
    });
    const fetchErr = new TypeError("fetch failed", { cause: netErr });

    const projection = projectErrorForLogging(fetchErr);
    expect(projection.errorType).toBe("TypeError");
    expect(projection.safeMessage).toBe("fetch failed");
    expect(projection.cause).toBeDefined();
    expect(projection.cause?.errorType).toBe("Error");
    expect(projection.cause?.safeMessage).toContain("ECONNREFUSED");
    expect(projection.cause?.code).toBe("ECONNREFUSED");
    expect(projection.cause?.address).toBe("127.0.0.1");
    expect(projection.cause?.port).toBe(3000);
  });

  it("handles circular cause chains safely without infinite recursion", () => {
    const errA = new Error("error A") as Error & { cause?: Error };
    const errB = new Error("error B") as Error & { cause?: Error };
    errA.cause = errB;
    errB.cause = errA;

    const projection = projectErrorForLogging(errA);
    expect(projection.safeMessage).toBe("error A");
    expect(projection.cause?.safeMessage).toBe("error B");
    expect(projection.cause?.cause?.safeMessage).toBe("[Circular]");
  });

  it("bounds cause recursion depth to prevent unbounded structures", () => {
    let current = new Error("root error");
    for (let i = 1; i <= 10; i++) {
      const parent = new Error(`level ${i}`, { cause: current });
      current = parent;
    }

    const projection = projectErrorForLogging(current);
    expect(projection.safeMessage).toBe("level 10");

    let depth = 0;
    let iter: typeof projection | undefined = projection;
    while (iter?.cause) {
      depth++;
      iter = iter.cause;
    }
    expect(depth).toBeLessThanOrEqual(5);
  });
});
