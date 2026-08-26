import { describe, expect, it } from "vitest";
import { resolveControlApiBaseUrl, WebRuntimeConfigError } from "./runtime-config";

describe("resolveControlApiBaseUrl", () => {
  it("uses an explicitly injected base URL without consulting process environment", () => {
    // Explicit base URL without trailing slash
    const result1 = resolveControlApiBaseUrl({
      baseUrl: "https://explicit.example.com",
      env: { CONTROL_API_URL: "http://env-host:9999", NODE_ENV: "production" },
      mode: "production"
    });
    expect(result1).toBe("https://explicit.example.com");

    // Explicit base URL with trailing slashes
    const result2 = resolveControlApiBaseUrl({
      baseUrl: "https://explicit.example.com///",
      env: { CONTROL_API_URL: "http://env-host:9999", NODE_ENV: "production" },
      mode: "production"
    });
    expect(result2).toBe("https://explicit.example.com");

    // Positional signature with empty/missing env CONTROL_API_URL in production mode
    const result3 = resolveControlApiBaseUrl("http://explicit.internal:8080/", {}, "production");
    expect(result3).toBe("http://explicit.internal:8080");
  });

  it("uses CONTROL_API_URL for server-side requests and removes trailing slashes", () => {
    // Valid HTTP URL with trailing slashes
    const result1 = resolveControlApiBaseUrl({
      env: { CONTROL_API_URL: "http://control-01:3000///" },
      mode: "production"
    });
    expect(result1).toBe("http://control-01:3000");

    // Valid HTTPS URL with path and trailing slash
    const result2 = resolveControlApiBaseUrl({
      env: { CONTROL_API_URL: "https://control-01.internal.example.com/api/" },
      mode: "production"
    });
    expect(result2).toBe("https://control-01.internal.example.com/api");

    // Positional signature
    const result3 = resolveControlApiBaseUrl(
      undefined,
      { CONTROL_API_URL: "http://control-api:4000/" },
      "production"
    );
    expect(result3).toBe("http://control-api:4000");
  });

  it("fails production resolution when CONTROL_API_URL is missing blank or malformed", () => {
    // Missing CONTROL_API_URL in production
    expect(() =>
      resolveControlApiBaseUrl({
        env: {},
        mode: "production"
      })
    ).toThrow(WebRuntimeConfigError);

    expect(() =>
      resolveControlApiBaseUrl({
        env: {},
        mode: "production"
      })
    ).toThrow(/CONTROL_API_URL/);

    // Blank / whitespace CONTROL_API_URL in production
    expect(() =>
      resolveControlApiBaseUrl({
        env: { CONTROL_API_URL: "   " },
        mode: "production"
      })
    ).toThrow(WebRuntimeConfigError);

    expect(() =>
      resolveControlApiBaseUrl({
        env: { CONTROL_API_URL: "" },
        mode: "production"
      })
    ).toThrow(/CONTROL_API_URL/);

    // Malformed non-URL in production
    expect(() =>
      resolveControlApiBaseUrl({
        env: { CONTROL_API_URL: "not-a-valid-url" },
        mode: "production"
      })
    ).toThrow(WebRuntimeConfigError);

    // Non-HTTP/HTTPS protocol in production
    expect(() =>
      resolveControlApiBaseUrl({
        env: { CONTROL_API_URL: "ftp://control-api:3000" },
        mode: "production"
      })
    ).toThrow(WebRuntimeConfigError);

    // Verify error does not expose any secret values
    try {
      resolveControlApiBaseUrl({
        env: { CONTROL_API_URL: "not-a-valid-url" },
        mode: "production"
      });
    } catch (err) {
      expect(err).toBeInstanceOf(WebRuntimeConfigError);
      expect((err as Error).message).toContain("CONTROL_API_URL");
    }
  });

  it("allows the documented localhost default only outside production", () => {
    // In development mode with undefined CONTROL_API_URL -> defaults to localhost:3000
    const resultDev = resolveControlApiBaseUrl({
      env: {},
      mode: "development"
    });
    expect(resultDev).toBe("http://localhost:3000");

    // In test mode with empty CONTROL_API_URL -> defaults to localhost:3000
    const resultTest = resolveControlApiBaseUrl({
      env: { CONTROL_API_URL: "" },
      mode: "test"
    });
    expect(resultTest).toBe("http://localhost:3000");

    // In development mode with valid CONTROL_API_URL -> uses CONTROL_API_URL
    const resultDevWithEnv = resolveControlApiBaseUrl({
      env: { CONTROL_API_URL: "http://dev-control-api:3000/" },
      mode: "development"
    });
    expect(resultDevWithEnv).toBe("http://dev-control-api:3000");

    // In production mode with missing CONTROL_API_URL -> throws, never falls back to localhost
    expect(() =>
      resolveControlApiBaseUrl({
        env: {},
        mode: "production"
      })
    ).toThrow(WebRuntimeConfigError);
  });
});
