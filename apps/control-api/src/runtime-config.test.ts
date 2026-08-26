import { describe, expect, it } from "vitest";
import { parseControlApiRuntimeConfig } from "./runtime-config.js";

describe("runtime-config", () => {
  const validEnv: Record<string, string> = {
    DATABASE_URL: "postgres://app_user:s3cr3t_db_pass@db.internal:5432/comfy_orchestrator",
    S3_STORAGE_ENDPOINT: "http://minio.internal:9000",
    S3_SIGNING_ENDPOINT: "https://storage.godzspeed-internal.ts.net",
    AWS_ACCESS_KEY_ID: "app-s3-key",
    AWS_SECRET_ACCESS_KEY: "s3cr3t_s3_key",
    CONTROL_API_HOST: "100.64.0.1",
    CONTROL_API_PORT: "3000"
  };

  it("rejects every missing or blank required variable without exposing secret values", () => {
    const requiredKeys = [
      "DATABASE_URL",
      "S3_STORAGE_ENDPOINT",
      "S3_SIGNING_ENDPOINT",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "CONTROL_API_HOST",
      "CONTROL_API_PORT"
    ] as const;

    const secretValues = ["s3cr3t_db_pass", "s3cr3t_s3_key"];

    for (const key of requiredKeys) {
      // Test missing (omitted)
      const envMissing = { ...validEnv };
      delete envMissing[key];

      expect(
        () => parseControlApiRuntimeConfig(envMissing),
        `Expected error when ${key} is omitted`
      ).toThrowError(new RegExp(`\\b${key}\\b`));

      try {
        parseControlApiRuntimeConfig(envMissing);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        for (const secret of secretValues) {
          expect(
            message,
            `Error for missing ${key} must not contain secret ${secret}`
          ).not.toContain(secret);
        }
      }

      // Test blank (empty string or whitespace)
      for (const blankValue of ["", "   ", "\t\n"]) {
        const envBlank = { ...validEnv, [key]: blankValue };

        expect(
          () => parseControlApiRuntimeConfig(envBlank),
          `Expected error when ${key} is '${blankValue}'`
        ).toThrowError(new RegExp(`\\b${key}\\b`));

        try {
          parseControlApiRuntimeConfig(envBlank);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          for (const secret of secretValues) {
            expect(
              message,
              `Error for blank ${key} must not contain secret ${secret}`
            ).not.toContain(secret);
          }
        }
      }
    }
  });

  it("rejects malformed URLs ports and expiry values before creating dependencies", () => {
    const secretValues = ["s3cr3t_db_pass", "s3cr3t_s3_key"];

    // Non-HTTP storage endpoint
    const badStorageEndpoints = [
      "ftp://storage.internal:9000",
      "not_a_url",
      "javascript:void(0)",
      "ws://storage.internal:9000"
    ];
    for (const badEndpoint of badStorageEndpoints) {
      expect(() =>
        parseControlApiRuntimeConfig({
          ...validEnv,
          S3_STORAGE_ENDPOINT: badEndpoint
        })
      ).toThrowError(/S3_STORAGE_ENDPOINT/);

      try {
        parseControlApiRuntimeConfig({ ...validEnv, S3_STORAGE_ENDPOINT: badEndpoint });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        for (const secret of secretValues) {
          expect(msg).not.toContain(secret);
        }
      }
    }

    // Non-HTTP signing endpoint
    const badSigningEndpoints = ["file:///var/storage", "not_a_url", "gopher://storage.ts.net"];
    for (const badEndpoint of badSigningEndpoints) {
      expect(() =>
        parseControlApiRuntimeConfig({
          ...validEnv,
          S3_SIGNING_ENDPOINT: badEndpoint
        })
      ).toThrowError(/S3_SIGNING_ENDPOINT/);
    }

    // Malformed DATABASE_URL (not a URL)
    expect(() =>
      parseControlApiRuntimeConfig({
        ...validEnv,
        DATABASE_URL: "not_a_valid_postgres_url"
      })
    ).toThrowError(/DATABASE_URL/);

    // Malformed ports: out of range, non-integer, non-numeric
    const badPorts = ["0", "-1", "65536", "70000", "3000.5", "abc", "port3000"];
    for (const badPort of badPorts) {
      expect(() =>
        parseControlApiRuntimeConfig({
          ...validEnv,
          CONTROL_API_PORT: badPort
        })
      ).toThrowError(/CONTROL_API_PORT/);
    }

    // Malformed expiry: 0, negative, >900, non-integer, non-numeric
    const badExpiries = ["0", "-10", "901", "10000", "abc", "300.5"];
    for (const badExpiry of badExpiries) {
      expect(() =>
        parseControlApiRuntimeConfig({
          ...validEnv,
          S3_PRESIGNED_EXPIRY_SECONDS: badExpiry
        })
      ).toThrowError(/S3_PRESIGNED_EXPIRY_SECONDS/);
    }
  });

  it("keeps internal storage and browser signing endpoints distinct", () => {
    const config = parseControlApiRuntimeConfig({
      ...validEnv,
      S3_STORAGE_ENDPOINT: "http://minio.internal:9000",
      S3_SIGNING_ENDPOINT: "https://storage.godzspeed-internal.ts.net"
    });

    expect(config.s3.storageEndpoint).toBe("http://minio.internal:9000");
    expect(config.s3.signingEndpoint).toBe("https://storage.godzspeed-internal.ts.net");
    expect(config.s3.storageEndpoint).not.toBe(config.s3.signingEndpoint);
  });

  it("parses valid complete configuration with defaults for optional values", () => {
    const config = parseControlApiRuntimeConfig(validEnv);

    expect(config.database.url).toBe(validEnv.DATABASE_URL);
    expect(config.s3.storageEndpoint).toBe("http://minio.internal:9000");
    expect(config.s3.signingEndpoint).toBe("https://storage.godzspeed-internal.ts.net");
    expect(config.s3.credentials).toEqual({
      accessKeyId: "app-s3-key",
      secretAccessKey: "s3cr3t_s3_key"
    });
    expect(config.s3.region).toBe("us-east-1");
    expect(config.s3.forcePathStyle).toBe(true);
    expect(config.s3.readinessBucket).toBe("godzspeed-review");
    expect(config.s3.defaultExpirySeconds).toBe(300);
    expect(config.http.host).toBe("100.64.0.1");
    expect(config.http.port).toBe(3000);
    expect(config.reviewerIdentity).toEqual({
      trustedProxyAddresses: []
    });
  });

  it("supports overrides for optional S3 and HTTP fields and aliases", () => {
    const config = parseControlApiRuntimeConfig({
      ...validEnv,
      AWS_REGION: "us-west-2",
      S3_FORCE_PATH_STYLE: "false",
      S3_READINESS_BUCKET: "custom-bucket",
      S3_PRESIGNED_EXPIRY_SECONDS: "600",
      CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: "127.0.0.1, 10.0.0.2"
    });

    expect(config.s3.region).toBe("us-west-2");
    expect(config.s3.forcePathStyle).toBe(false);
    expect(config.s3.readinessBucket).toBe("custom-bucket");
    expect(config.s3.defaultExpirySeconds).toBe(600);
    expect(config.reviewerIdentity.trustedProxyAddresses).toEqual(["127.0.0.1", "10.0.0.2"]);
  });

  it("supports HOST and PORT aliases if CONTROL_API_HOST/PORT are not set", () => {
    const envWithoutPrefix = { ...validEnv };
    delete envWithoutPrefix.CONTROL_API_HOST;
    delete envWithoutPrefix.CONTROL_API_PORT;

    const config = parseControlApiRuntimeConfig({
      ...envWithoutPrefix,
      HOST: "127.0.0.1",
      PORT: "8080"
    });

    expect(config.http.host).toBe("127.0.0.1");
    expect(config.http.port).toBe(8080);
  });

  it("supports S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY aliases", () => {
    const envWithS3Keys = { ...validEnv };
    delete envWithS3Keys.AWS_ACCESS_KEY_ID;
    delete envWithS3Keys.AWS_SECRET_ACCESS_KEY;

    const config = parseControlApiRuntimeConfig({
      ...envWithS3Keys,
      S3_ACCESS_KEY_ID: "s3-alias-key",
      S3_SECRET_ACCESS_KEY: "s3-alias-secret"
    });

    expect(config.s3.credentials).toEqual({
      accessKeyId: "s3-alias-key",
      secretAccessKey: "s3-alias-secret"
    });
  });

  it("validates reviewer identity fallback and trusted proxies consistency", () => {
    // Cannot combine fallback and trusted proxies
    expect(() =>
      parseControlApiRuntimeConfig({
        ...validEnv,
        CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: "127.0.0.1",
        CONTROL_API_REVIEWER_IDENTITY_FALLBACK: "Director"
      })
    ).toThrowError(/reviewer identity/i);
  });
});
