import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import {
  validateControlPlaneModel,
  scanTextForSecrets,
  scanTextForProhibitedHostnames,
  validateRequiredVariablesOmissionInMemory,
  isBinaryFile,
  REQUIRED_COMPOSE_VARIABLES
} from "./check-control-plane.js";

function createValidSyntheticModel() {
  return {
    services: {
      postgres: {
        image: "postgres:18.6",
        command: ["postgres", "-c", "io_method=worker"],
        environment: {
          POSTGRES_DB: "synthetic_db",
          POSTGRES_USER: "postgres",
          POSTGRES_PASSWORD: "synthetic_password"
        },
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"],
          interval: "5s",
          timeout: "5s",
          retries: 5
        },
        volumes: [{ source: "postgres_data", target: "/var/lib/postgresql/data", type: "volume" }],
        networks: { "control-plane": {} }
      },
      migrate: {
        image: "cco-control-api:latest",
        command: ["node", "node_modules/@cco/infrastructure/dist/postgres/migrate.js"],
        environment: {
          DATABASE_URL: "postgresql://postgres:synthetic_password@postgres:5432/synthetic_db",
          DATABASE_APP_ROLE: "synthetic_app_role"
        },
        depends_on: {
          postgres: {
            condition: "service_healthy",
            required: true
          }
        },
        restart: "no",
        networks: { "control-plane": {} }
      },
      minio: {
        image: "minio/minio:RELEASE.2024-01-18T22-51-28Z",
        command: ["server", "/data", "--console-address", ":9001"],
        environment: {
          MINIO_ROOT_USER: "synthetic_minio_admin",
          MINIO_ROOT_PASSWORD: "synthetic_minio_password"
        },
        ports: [
          {
            mode: "host",
            protocol: "tcp",
            published: "9000",
            target: 9000,
            host_ip: "100.64.0.1"
          },
          {
            mode: "host",
            protocol: "tcp",
            published: "9001",
            target: 9001,
            host_ip: "127.0.0.1"
          }
        ],
        healthcheck: {
          test: ["CMD", "mc", "ready", "local"],
          interval: "5s",
          timeout: "5s",
          retries: 5
        },
        volumes: [{ source: "minio_data", target: "/data", type: "volume" }],
        networks: { "control-plane": {} }
      },
      "control-api": {
        image: "cco-control-api:latest",
        command: ["node", "dist/bootstrap.js"],
        environment: {
          DATABASE_URL: "postgresql://synthetic_app:synthetic_app_pwd@postgres:5432/synthetic_db",
          S3_STORAGE_ENDPOINT: "http://minio:9000",
          S3_SIGNING_ENDPOINT: "http://storage-01.synthetic.example:9000",
          AWS_ACCESS_KEY_ID: "synthetic_s3_key",
          AWS_SECRET_ACCESS_KEY: "synthetic_s3_secret",
          CONTROL_API_HOST: "0.0.0.0",
          CONTROL_API_PORT: "3000",
          CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES: "100.64.0.1",
          STORAGE_TELEMETRY_PATH: "/var/lib/cco/storage-observation"
        },
        volumes: [
          {
            source: "minio_data",
            target: "/var/lib/cco/storage-observation",
            type: "volume",
            read_only: true
          }
        ],
        ports: [
          {
            mode: "host",
            protocol: "tcp",
            published: "3000",
            target: 3000,
            host_ip: "100.64.0.1"
          }
        ],
        depends_on: {
          postgres: {
            condition: "service_healthy",
            required: true
          },
          minio: {
            condition: "service_healthy",
            required: true
          },
          migrate: {
            condition: "service_completed_successfully",
            required: true
          }
        },
        networks: { "control-plane": {} }
      },
      "review-hub": {
        image: "cco-web:latest",
        command: ["node", "apps/web/server.js"],
        environment: {
          CONTROL_API_URL: "http://control-01.synthetic.example:3000",
          NODE_ENV: "production",
          PORT: "3000",
          HOSTNAME: "0.0.0.0"
        },
        ports: [
          {
            mode: "host",
            protocol: "tcp",
            published: "3001",
            target: 3000,
            host_ip: "100.64.0.1"
          }
        ],
        depends_on: {
          "control-api": {
            condition: "service_started",
            required: true
          }
        },
        networks: { "control-plane": {} }
      }
    },
    networks: {
      "control-plane": {
        driver: "bridge"
      }
    },
    volumes: {
      postgres_data: {},
      minio_data: {}
    }
  };
}

describe("Control-plane topology and security validator", () => {
  it("rejects omitted empty IPv4 wildcard IPv6 wildcard and wildcard-equivalent host bindings", () => {
    const validModel = createValidSyntheticModel();
    // Valid model should pass without throwing
    validateControlPlaneModel(validModel, {
      tailnetIp: "100.64.0.1",
      operatorIp: "127.0.0.1"
    });

    const wildcardForms = [
      undefined,
      "",
      " ",
      "0.0.0.0",
      "::",
      "[::]",
      "0:0:0:0:0:0:0:0",
      "[0:0:0:0:0:0:0:0]",
      "*",
      "0",
      "0.0.0.0/0"
    ];

    for (const wildcard of wildcardForms) {
      const invalidModel = createValidSyntheticModel();
      invalidModel.services["control-api"].ports[0].host_ip = wildcard;

      assert.throws(
        () => {
          validateControlPlaneModel(invalidModel, {
            tailnetIp: "100.64.0.1",
            operatorIp: "127.0.0.1"
          });
        },
        (err) => {
          assert.match(err.message, /wildcard|missing|invalid/i);
          return true;
        },
        `Expected rejection for wildcard binding: ${JSON.stringify(wildcard)}`
      );
    }
  });

  it("keeps PostgreSQL unpublished and separates reviewer and operator bindings", () => {
    // 1. PostgreSQL must be unpublished
    const postgresPublishedModel = createValidSyntheticModel();
    postgresPublishedModel.services.postgres.ports = [
      {
        mode: "host",
        protocol: "tcp",
        published: "5432",
        target: 5432,
        host_ip: "100.64.0.1"
      }
    ];

    assert.throws(() => {
      validateControlPlaneModel(postgresPublishedModel, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /postgres.*unpublished|postgres.*must not publish/i);

    // 2. MinIO Console (9001) must not use the reviewer/tailnet IP
    const consoleOnReviewerIp = createValidSyntheticModel();
    consoleOnReviewerIp.services.minio.ports = [
      {
        mode: "host",
        protocol: "tcp",
        published: "9000",
        target: 9000,
        host_ip: "100.64.0.1"
      },
      {
        mode: "host",
        protocol: "tcp",
        published: "9001",
        target: 9001,
        host_ip: "100.64.0.1" // Wrong! Should be operator IP 127.0.0.1
      }
    ];

    assert.throws(() => {
      validateControlPlaneModel(consoleOnReviewerIp, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /console.*operator|separate.*binding/i);

    // 3. Reviewer surfaces (S3 9000, control-api 3000, review-hub) must use tailnet IP
    const reviewHubOnOperatorIp = createValidSyntheticModel();
    reviewHubOnOperatorIp.services["review-hub"].ports[0].host_ip = "127.0.0.1";

    assert.throws(() => {
      validateControlPlaneModel(reviewHubOnOperatorIp, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /review-hub.*tailnet|reviewer.*binding/i);
  });

  it("starts API only after healthy dependencies and successful migration", () => {
    // 1. Missing postgres dependency
    const noPostgresDep = createValidSyntheticModel();
    delete noPostgresDep.services["control-api"].depends_on.postgres;
    assert.throws(() => {
      validateControlPlaneModel(noPostgresDep, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /control-api.*depends_on.*postgres/i);

    // 2. Postgres dependency not service_healthy
    const unhealthPostgresDep = createValidSyntheticModel();
    unhealthPostgresDep.services["control-api"].depends_on.postgres.condition = "service_started";
    assert.throws(() => {
      validateControlPlaneModel(unhealthPostgresDep, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /postgres.*service_healthy/i);

    // 3. Missing minio dependency
    const noMinioDep = createValidSyntheticModel();
    delete noMinioDep.services["control-api"].depends_on.minio;
    assert.throws(() => {
      validateControlPlaneModel(noMinioDep, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /control-api.*depends_on.*minio/i);

    // 4. Missing migrate dependency or wrong condition
    const unhealthMigrateDep = createValidSyntheticModel();
    unhealthMigrateDep.services["control-api"].depends_on.migrate.condition = "service_started";
    assert.throws(() => {
      validateControlPlaneModel(unhealthMigrateDep, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /migrate.*service_completed_successfully/i);

    // 5. Migrate service must depend on postgres service_healthy
    const migrateNoPostgres = createValidSyntheticModel();
    delete migrateNoPostgres.services.migrate.depends_on.postgres;
    assert.throws(() => {
      validateControlPlaneModel(migrateNoPostgres, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /migrate.*depends_on.*postgres/i);
  });

  it("keeps Review Hub independent of MinIO console", () => {
    // 1. Review Hub depends only on control-api
    const hubWithMinioDep = createValidSyntheticModel();
    hubWithMinioDep.services["review-hub"].depends_on.minio = {
      condition: "service_healthy",
      required: true
    };
    assert.throws(() => {
      validateControlPlaneModel(hubWithMinioDep, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /review-hub.*depend.*only.*control-api/i);

    // 2. Review Hub contains no 9001 endpoint/config
    const hubWithConsoleConfig = createValidSyntheticModel();
    hubWithConsoleConfig.services["review-hub"].environment.MINIO_CONSOLE_URL = "http://minio:9001";
    assert.throws(() => {
      validateControlPlaneModel(hubWithConsoleConfig, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /review-hub.*console|9001/i);
  });

  it("configures PostgreSQL io_method worker without fixing io_workers", () => {
    // 1. Valid command has io_method=worker
    const validModel = createValidSyntheticModel();
    validateControlPlaneModel(validModel, {
      tailnetIp: "100.64.0.1",
      operatorIp: "127.0.0.1"
    });

    // 2. Missing io_method=worker
    const missingIoMethod = createValidSyntheticModel();
    missingIoMethod.services.postgres.command = ["postgres"];
    assert.throws(() => {
      validateControlPlaneModel(missingIoMethod, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /postgres.*io_method=worker/i);

    // 3. Explicitly fixing io_workers is prohibited
    const withIoWorkers = createValidSyntheticModel();
    withIoWorkers.services.postgres.command = [
      "postgres",
      "-c",
      "io_method=worker",
      "-c",
      "io_workers=4"
    ];
    assert.throws(() => {
      validateControlPlaneModel(withIoWorkers, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /postgres.*io_workers/i);
  });

  it("renders configured hostnames without executable hardcoded tailnet suffixes", () => {
    // 1. Scanning synthetic text without hardcoded production tailnet suffix passes
    const cleanText = "const url = process.env.CONTROL_API_URL || 'http://localhost:3000';";
    const cleanViolations = scanTextForProhibitedHostnames(
      "apps/control-api/src/app.ts",
      cleanText
    );
    assert.deepEqual(cleanViolations, []);

    // 2. Scanning executable file with hardcoded godzspeed-internal.ts.net fails
    const dirtyText = "const endpoint = 'https://storage-01.godzspeed-internal.ts.net:9000';";
    const dirtyViolations = scanTextForProhibitedHostnames(
      "apps/control-api/src/app.ts",
      dirtyText
    );
    assert.equal(dirtyViolations.length, 1);
    assert.match(dirtyViolations[0].message, /godzspeed-internal\.ts\.net/);

    // 3. Allowlisted files (like .env.example or docs) are permitted
    const allowlistedViolations = scanTextForProhibitedHostnames(".env.example", dirtyText);
    assert.deepEqual(allowlistedViolations, []);
  });

  it("fails rendering when each required variable is omitted", () => {
    // Verify required variables list contains all mandatory keys
    const mandatoryKeys = [
      "TAILNET_IP",
      "OPERATOR_BIND_IP",
      "CONTROL_API_PORT",
      "REVIEW_HUB_PORT",
      "S3_PORT",
      "MINIO_CONSOLE_PORT",
      "REVIEW_HUB_HOSTNAME",
      "CONTROL_API_HOSTNAME",
      "STORAGE_HOSTNAME",
      "POSTGRES_DB",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "DATABASE_MIGRATION_URL",
      "DATABASE_APP_ROLE",
      "DATABASE_URL",
      "MINIO_ROOT_USER",
      "MINIO_ROOT_PASSWORD",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
      "S3_STORAGE_ENDPOINT",
      "S3_SIGNING_ENDPOINT",
      "CONTROL_API_HOST",
      "CONTROL_API_URL",
      "CONTROL_API_TRUSTED_IDENTITY_PROXY_ADDRESSES",
      "STORAGE_TELEMETRY_PATH"
    ];

    for (const key of mandatoryKeys) {
      assert.ok(
        REQUIRED_COMPOSE_VARIABLES.includes(key),
        `Expected REQUIRED_COMPOSE_VARIABLES to include ${key}`
      );
    }

    // In-memory test of omission check
    const fullEnv = {};
    for (const key of REQUIRED_COMPOSE_VARIABLES) {
      fullEnv[key] = "test-value";
    }

    // When full env is provided, omission validator succeeds
    assert.doesNotThrow(() => {
      validateRequiredVariablesOmissionInMemory(fullEnv);
    });

    // Omitting any required variable throws
    for (const key of mandatoryKeys) {
      const partialEnv = { ...fullEnv };
      delete partialEnv[key];
      assert.throws(
        () => {
          validateRequiredVariablesOmissionInMemory(partialEnv);
        },
        (err) => {
          assert.match(err.message, new RegExp(`missing.*${key}`, "i"));
          return true;
        }
      );
    }
  });

  it("rejects tracked private keys tailnet auth keys and non-example credentials", () => {
    // 1. Private keys are detected and rejected without leaking key content
    const privateKeySample = `
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0syntheticKeyPayloadDataHere
-----END RSA PRIVATE KEY-----
    `;
    const pkViolations = scanTextForSecrets("packages/shared/secret.pem", privateKeySample);
    assert.equal(pkViolations.length, 1);
    assert.match(pkViolations[0].message, /private key/i);
    // Ensure the message does not print the secret content
    assert.ok(!pkViolations[0].message.includes("MIIEowIBAAKCAQEA0syntheticKeyPayloadDataHere"));

    // 2. Tailscale auth keys are detected and rejected
    const tsKeySample = "const key = 'tskey-auth-k1234567890abcdef1234567890abcdef';";
    const tsViolations = scanTextForSecrets("apps/control-api/auth.ts", tsKeySample);
    assert.equal(tsViolations.length, 1);
    assert.match(tsViolations[0].message, /tailnet auth key/i);
    // Ensure the key itself is not leaked in the message
    assert.ok(!tsViolations[0].message.includes("tskey-auth-k1234567890abcdef1234567890abcdef"));

    // 3. Synthetic values in .env.example or test files are accepted
    const syntheticExample = `
POSTGRES_PASSWORD=synthetic_postgres_migration_password
MINIO_ROOT_PASSWORD=synthetic_minio_admin_password
S3_SECRET_ACCESS_KEY=synthetic_s3_app_secret_access_key
S3_ACCESS_KEY_ID=synthetic_s3_app_access_key_id
API_SECRET=synthetic_api_secret_key_12345
    `;
    const exampleViolations = scanTextForSecrets(".env.example", syntheticExample);
    assert.deepEqual(exampleViolations, []);

    const testFilePkViolations = scanTextForSecrets(
      "scripts/check-control-plane.test.js",
      privateKeySample
    );
    assert.deepEqual(testFilePkViolations, []);

    // 4. Live non-example S3, database, and API secrets are detected and rejected
    const liveSecretsSamples = [
      "POSTGRES_PASSWORD=super_secret_production_password_123",
      "MINIO_ROOT_PASSWORD=super_secret_minio_admin_password_123",
      "S3_SECRET_ACCESS_KEY=my_s3_secret_access_key_123456789",
      "AWS_SECRET_ACCESS_KEY=my_aws_secret_key_123456789012345",
      "S3_ACCESS_KEY_ID=my_s3_access_key_123456789012345",
      "API_SECRET=my_real_api_secret_1234567890",
      "AUTH_TOKEN=my_real_auth_token_1234567890",
      "API_KEY=my_real_api_key_1234567890"
    ];

    for (const secretLine of liveSecretsSamples) {
      const violations = scanTextForSecrets("apps/control-api/config.ts", secretLine);
      assert.equal(violations.length, 1, `Expected violation for live secret: ${secretLine}`);
      assert.match(violations[0].message, /plausible non-example credential/i);
    }

    // 5. Harmless assignments (function calls, env references, profile constants) do not trigger false positives
    const benignSamples = [
      "const secretAccessKey = parseRequiredString(rawSecretKey, secretKeyVarName);",
      "const password = process.env.POSTGRES_PASSWORD;",
      'const LTX_RENDER_PROFILE_KEY = "LTX_25_720P_5S_V1";',
      "const apiKey = getApiKey();"
    ];

    for (const benignLine of benignSamples) {
      const violations = scanTextForSecrets("apps/control-api/config.ts", benignLine);
      assert.deepEqual(violations, [], `Expected no violation for benign code line: ${benignLine}`);
    }
  });

  it("detects and excludes binary files from text secret and hostname scanning", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cco-binary-test-"));
    try {
      // 1. Text file without null bytes is not binary
      const textFilePath = join(tempDir, "sample.txt");
      writeFileSync(textFilePath, "Hello world\nThis is a standard UTF-8 text file.\n", "utf8");
      assert.equal(isBinaryFile(textFilePath), false);

      // 2. File with null byte is detected as binary
      const binaryNullFilePath = join(tempDir, "sample.dat");
      const binaryBuffer = Buffer.from([
        0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x57, 0x6f, 0x72, 0x6c, 0x64
      ]);
      writeFileSync(binaryNullFilePath, binaryBuffer);
      assert.equal(isBinaryFile(binaryNullFilePath), true);

      // 3. Known binary extension (e.g. .png, .wasm) is detected as binary
      const pngFilePath = join(tempDir, "icon.png");
      writeFileSync(pngFilePath, "fake png content");
      assert.equal(isBinaryFile(pngFilePath), true);

      const wasmFilePath = join(tempDir, "module.wasm");
      writeFileSync(wasmFilePath, "fake wasm content");
      assert.equal(isBinaryFile(wasmFilePath), true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("accepts a matching read-only MinIO observation mount", () => {
    const validModel = createValidSyntheticModel();
    assert.doesNotThrow(() => {
      validateControlPlaneModel(validModel, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    });
  });

  it("rejects a missing control-api storage observation mount", () => {
    // Missing volumes property
    const modelWithoutVolumes = createValidSyntheticModel();
    delete modelWithoutVolumes.services["control-api"].volumes;
    assert.throws(() => {
      validateControlPlaneModel(modelWithoutVolumes, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /minio_data.*volume|storage.*observation.*mount/i);

    // Empty volumes array
    const modelWithEmptyVolumes = createValidSyntheticModel();
    modelWithEmptyVolumes.services["control-api"].volumes = [];
    assert.throws(() => {
      validateControlPlaneModel(modelWithEmptyVolumes, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /minio_data.*volume|storage.*observation.*mount/i);

    // Volumes array with different volume source
    const modelWithDifferentVolume = createValidSyntheticModel();
    modelWithDifferentVolume.services["control-api"].volumes = [
      {
        source: "other_volume",
        target: "/var/lib/cco/storage-observation",
        type: "volume",
        read_only: true
      }
    ];
    assert.throws(() => {
      validateControlPlaneModel(modelWithDifferentVolume, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /minio_data.*volume|storage.*observation.*mount/i);
  });

  it("rejects a writable storage observation mount", () => {
    const writableMountModel = createValidSyntheticModel();
    writableMountModel.services["control-api"].volumes = [
      {
        source: "minio_data",
        target: "/var/lib/cco/storage-observation",
        type: "volume",
        read_only: false
      }
    ];
    assert.throws(() => {
      validateControlPlaneModel(writableMountModel, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /read-only|read_only/i);
  });

  it("rejects a mismatched telemetry path and mount target", () => {
    // Mount target does not match STORAGE_TELEMETRY_PATH
    const mismatchedTargetModel = createValidSyntheticModel();
    mismatchedTargetModel.services["control-api"].volumes = [
      {
        source: "minio_data",
        target: "/var/lib/cco/other-target",
        type: "volume",
        read_only: true
      }
    ];
    assert.throws(() => {
      validateControlPlaneModel(mismatchedTargetModel, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /mismatch|target/i);

    // Missing STORAGE_TELEMETRY_PATH in control-api environment
    const missingEnvModel = createValidSyntheticModel();
    delete missingEnvModel.services["control-api"].environment.STORAGE_TELEMETRY_PATH;
    assert.throws(() => {
      validateControlPlaneModel(missingEnvModel, {
        tailnetIp: "100.64.0.1",
        operatorIp: "127.0.0.1"
      });
    }, /STORAGE_TELEMETRY_PATH|storage.*telemetry/i);
  });

  it("requires STORAGE_TELEMETRY_PATH during Compose rendering", () => {
    assert.ok(
      REQUIRED_COMPOSE_VARIABLES.includes("STORAGE_TELEMETRY_PATH"),
      "REQUIRED_COMPOSE_VARIABLES must include STORAGE_TELEMETRY_PATH"
    );

    const env = {};
    for (const key of REQUIRED_COMPOSE_VARIABLES) {
      env[key] = "test-value";
    }
    delete env.STORAGE_TELEMETRY_PATH;

    assert.throws(() => {
      validateRequiredVariablesOmissionInMemory(env);
    }, /missing.*STORAGE_TELEMETRY_PATH/i);
  });
});
