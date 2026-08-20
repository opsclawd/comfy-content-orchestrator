import { describe, expect, it, vi } from "vitest";
import { parseProvisionCliArgs, runProvisionCli } from "./provision.js";

describe("storage provision CLI unit tests", () => {
  it("returns kind help when --help flag is passed", () => {
    const parsed = parseProvisionCliArgs(["--help"]);
    expect(parsed.kind).toBe("help");
  });

  it("returns kind help when -h flag is passed", () => {
    const parsed = parseProvisionCliArgs(["-h"]);
    expect(parsed.kind).toBe("help");
  });

  it("parses CLI flags correctly", () => {
    const parsed = parseProvisionCliArgs([
      "--endpoint",
      "http://127.0.0.1:9000",
      "--access-key",
      "test-key",
      "--secret-key",
      "test-secret",
      "--region",
      "us-east-1"
    ]);

    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.endpoint).toBe("http://127.0.0.1:9000");
      expect(parsed.options.accessKeyId).toBe("test-key");
      expect(parsed.options.secretAccessKey).toBe("test-secret");
      expect(parsed.options.region).toBe("us-east-1");
      expect(parsed.options.forcePathStyle).toBe(true);
    }
  });

  it("parses equals-style CLI flags and force-path-style correctly", () => {
    const parsed = parseProvisionCliArgs([
      "--endpoint=http://s3.custom.io",
      "--access-key=custom-key",
      "--secret-key=custom-secret",
      "--region=eu-central-1",
      "--force-path-style",
      "false"
    ]);

    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.endpoint).toBe("http://s3.custom.io");
      expect(parsed.options.accessKeyId).toBe("custom-key");
      expect(parsed.options.secretAccessKey).toBe("custom-secret");
      expect(parsed.options.region).toBe("eu-central-1");
      expect(parsed.options.forcePathStyle).toBe(false);
    }
  });

  it("falls back to environment variables when flags are omitted", () => {
    const env = {
      S3_ENDPOINT: "http://minio.internal:9000",
      AWS_ACCESS_KEY_ID: "env-key",
      AWS_SECRET_ACCESS_KEY: "env-secret"
    };

    const parsed = parseProvisionCliArgs([], env);
    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.endpoint).toBe("http://minio.internal:9000");
      expect(parsed.options.accessKeyId).toBe("env-key");
      expect(parsed.options.secretAccessKey).toBe("env-secret");
      expect(parsed.options.region).toBe("us-east-1");
      expect(parsed.options.forcePathStyle).toBe(true);
    }
  });

  it("falls back to MinIO environment variable aliases", () => {
    const env = {
      S3_ENDPOINT: "http://minio.internal:9000",
      MINIO_ROOT_USER: "minio-admin",
      MINIO_ROOT_PASSWORD: "minio-password",
      S3_REGION: "us-west-2"
    };

    const parsed = parseProvisionCliArgs([], env);
    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.options.endpoint).toBe("http://minio.internal:9000");
      expect(parsed.options.accessKeyId).toBe("minio-admin");
      expect(parsed.options.secretAccessKey).toBe("minio-password");
      expect(parsed.options.region).toBe("us-west-2");
    }
  });

  it("fails when endpoint or credentials are missing", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runProvisionCli([], { stdout, stderr }, {}, {});
    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("Missing required configuration"));
  });

  it("prints help message and returns 0 when --help is passed to runProvisionCli", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runProvisionCli(["--help"], { stdout, stderr });
    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
  });

  it("runs provisioning successfully and prints summary when dependencies succeed", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const mockProvisionStorageBuckets = vi.fn().mockResolvedValue({
      results: [
        { bucket: "cco-raw-inputs", bucketStatus: "created", lifecycleStatus: "applied" },
        {
          bucket: "cco-rendered-scenes",
          bucketStatus: "already_exists",
          lifecycleStatus: "applied"
        },
        { bucket: "cco-exports", bucketStatus: "created", lifecycleStatus: "skipped" }
      ],
      createdCount: 2,
      alreadyExistsCount: 1,
      lifecycleAppliedCount: 2,
      lifecycleSkippedCount: 1
    });

    const exitCode = await runProvisionCli(
      ["--endpoint", "http://127.0.0.1:9000", "--access-key", "key", "--secret-key", "secret"],
      { stdout, stderr },
      { provisionStorageBucketsFn: mockProvisionStorageBuckets }
    );

    expect(exitCode).toBe(0);
    expect(mockProvisionStorageBuckets).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Connecting to S3 endpoint"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("--- Provisioning Summary ---"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Total buckets: 3"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Created: 2"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Already existing: 1"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Lifecycle rules applied: 2"));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("Lifecycle rules skipped: 1"));
  });

  it("logs error and returns 1 when provisioning throws", async () => {
    const stdout = vi.fn();
    const stderr = vi.fn();

    const mockProvisionStorageBuckets = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const exitCode = await runProvisionCli(
      ["--endpoint", "http://127.0.0.1:9000", "--access-key", "key", "--secret-key", "secret"],
      { stdout, stderr },
      { provisionStorageBucketsFn: mockProvisionStorageBuckets }
    );

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("[provision] Failed: Connection refused")
    );
  });
});
