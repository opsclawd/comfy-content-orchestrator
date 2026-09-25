import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { ImageValidationError } from "@cco/application";
import { SharpImageInspectionAdapter } from "./sharp-image-inspection-adapter.js";

describe("SharpImageInspectionAdapter", () => {
  const adapter = new SharpImageInspectionAdapter();
  const fixturePngPath = path.resolve(
    __dirname,
    "../../../../tests/fixtures/deterministic-reference.png"
  );
  const fixturePng = fs.readFileSync(fixturePngPath);

  it("successfully inspects and validates a real PNG fixture", async () => {
    const result = await adapter.inspectAndValidate(fixturePng, "image/png");
    expect(result.detectedMimeType).toBe("image/png");
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
    expect(result.byteLength).toBe(fixturePng.length);
  });

  it("successfully inspects and validates a JPEG image", async () => {
    const jpegBuffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    })
      .jpeg()
      .toBuffer();

    const result = await adapter.inspectAndValidate(jpegBuffer, "image/jpeg");
    expect(result.detectedMimeType).toBe("image/jpeg");
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });

  it("successfully inspects and validates a WebP image", async () => {
    const webpBuffer = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 }
      }
    })
      .webp()
      .toBuffer();

    const result = await adapter.inspectAndValidate(webpBuffer, "image/webp");
    expect(result.detectedMimeType).toBe("image/webp");
    expect(result.width).toBe(64);
    expect(result.height).toBe(64);
  });

  it("rejects empty buffer", async () => {
    await expect(adapter.inspectAndValidate(Buffer.alloc(0), "image/png")).rejects.toThrow(
      ImageValidationError
    );
  });

  it("rejects buffer exceeding max byte size limit", async () => {
    await expect(
      adapter.inspectAndValidate(fixturePng, "image/png", { maxByteSize: 100 })
    ).rejects.toThrow(/Image exceeds maximum allowed size/);
  });

  it("rejects unsupported declared Content-Type", async () => {
    await expect(adapter.inspectAndValidate(fixturePng, "image/gif")).rejects.toThrow(
      /Unsupported declared Content-Type/
    );
  });

  it("rejects MIME mismatch (PNG file declared as image/jpeg)", async () => {
    await expect(adapter.inspectAndValidate(fixturePng, "image/jpeg")).rejects.toThrow(
      /MIME type mismatch/
    );
  });

  it("rejects malformed / non-image buffer", async () => {
    const corruptBuffer = Buffer.from("this is definitely not a real image");
    await expect(adapter.inspectAndValidate(corruptBuffer, "image/png")).rejects.toThrow(
      /Malformed or unparseable image buffer/
    );
  });

  it("rejects image exceeding maxWidth", async () => {
    await expect(
      adapter.inspectAndValidate(fixturePng, "image/png", { maxWidth: 500 })
    ).rejects.toThrow(/exceeds maximum allowed width/);
  });

  it("rejects image exceeding maxHeight", async () => {
    await expect(
      adapter.inspectAndValidate(fixturePng, "image/png", { maxHeight: 500 })
    ).rejects.toThrow(/exceeds maximum allowed height/);
  });

  it("rejects image exceeding maxPixels", async () => {
    await expect(
      adapter.inspectAndValidate(fixturePng, "image/png", { maxPixels: 100_000 })
    ).rejects.toThrow(/exceeds pixel limit|pixel count .* exceeds maximum allowed/i);
  });
});
