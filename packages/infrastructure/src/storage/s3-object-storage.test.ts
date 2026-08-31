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
});
