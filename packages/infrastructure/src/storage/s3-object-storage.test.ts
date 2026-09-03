import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { S3ObjectStorage } from "./s3-object-storage.js";
import type { S3Client } from "@aws-sdk/client-s3";

describe("S3ObjectStorage (unit)", () => {
  it("enforces maxBytes limit when ContentLength header is present and exceeds maxBytes", async () => {
    let streamDestroyed = false;
    const fakeStream = new Readable({
      read() {
        this.push(Buffer.from("1234567890"));
        this.push(null);
      },
      destroy(err, cb) {
        streamDestroyed = true;
        cb(err);
      }
    });

    const fakeClient = {
      send: async () => ({
        ContentLength: 100,
        Body: fakeStream
      })
    } as unknown as S3Client;

    const storage = new S3ObjectStorage({
      endpoint: "http://localhost:9000",
      client: fakeClient
    });

    await expect(
      storage.getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 50 })
    ).rejects.toThrow(/ContentLength \(100\) exceeds maxBytes limit \(50\)/);

    expect(streamDestroyed).toBe(true);
  });

  it("enforces maxBytes limit during streaming when ContentLength is not present", async () => {
    let streamDestroyed = false;
    const fakeStream = new Readable({
      read() {
        this.push(Buffer.from("12345678901234567890")); // 20 bytes
        this.push(null);
      },
      destroy(err, cb) {
        streamDestroyed = true;
        cb(err);
      }
    });

    const fakeClient = {
      send: async () => ({
        ContentLength: undefined,
        Body: fakeStream
      })
    } as unknown as S3Client;

    const storage = new S3ObjectStorage({
      endpoint: "http://localhost:9000",
      client: fakeClient
    });

    await expect(
      storage.getObject({ bucket: "test-bucket", key: "test-key" }, { maxBytes: 10 })
    ).rejects.toThrow(/exceeds maxBytes limit \(10\)/);

    expect(streamDestroyed).toBe(true);
  });

  it("successfully retrieves stream when within maxBytes limit", async () => {
    const payload = Buffer.from("hello world");
    const fakeStream = new Readable({
      read() {
        this.push(payload);
        this.push(null);
      }
    });

    const fakeClient = {
      send: async () => ({
        ContentLength: payload.length,
        Body: fakeStream,
        ContentType: "text/plain"
      })
    } as unknown as S3Client;

    const storage = new S3ObjectStorage({
      endpoint: "http://localhost:9000",
      client: fakeClient
    });

    const result = await storage.getObject(
      { bucket: "test-bucket", key: "test-key" },
      { maxBytes: 100 }
    );

    expect(result).toBeDefined();
    expect(result?.body).toEqual(new Uint8Array(payload));
    expect(result?.contentType).toBe("text/plain");
  });

  it("passes IfNoneMatch to PutObjectCommand and returns locator", async () => {
    let sentCommand: { input: { IfNoneMatch?: string } } | undefined;
    const fakeClient = {
      send: async (cmd: unknown) => {
        sentCommand = cmd as { input: { IfNoneMatch?: string } };
        return {};
      }
    } as unknown as S3Client;

    const storage = new S3ObjectStorage({
      endpoint: "http://localhost:9000",
      client: fakeClient
    });

    const locator = await storage.putObject({
      bucket: "test-bucket",
      key: "test-key.json",
      body: new Uint8Array([1, 2, 3]),
      ifNoneMatch: "*"
    });

    expect(locator).toEqual({ bucket: "test-bucket", key: "test-key.json" });
    expect(sentCommand?.input.IfNoneMatch).toBe("*");
  });

  it("translates PreconditionFailed error to ObjectAlreadyExistsError", async () => {
    const preconditionError = Object.assign(new Error("Precondition Failed"), {
      name: "PreconditionFailed",
      $metadata: { httpStatusCode: 412 }
    });

    const fakeClient = {
      send: async () => {
        throw preconditionError;
      }
    } as unknown as S3Client;

    const storage = new S3ObjectStorage({
      endpoint: "http://localhost:9000",
      client: fakeClient
    });

    await expect(
      storage.putObject({
        bucket: "test-bucket",
        key: "existing.json",
        body: new Uint8Array([1, 2, 3]),
        ifNoneMatch: "*"
      })
    ).rejects.toThrowError(
      expect.objectContaining({
        name: "ObjectAlreadyExistsError",
        bucket: "test-bucket",
        key: "existing.json"
      })
    );
  });
});
