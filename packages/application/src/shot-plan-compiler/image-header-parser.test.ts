import { describe, expect, it } from "vitest";
import { parseImageByteHeader } from "./image-header-parser.js";

describe("parseImageByteHeader", () => {
  it("returns null for empty or too short buffers", () => {
    expect(parseImageByteHeader(new Uint8Array())).toBeNull();
    expect(parseImageByteHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))).toBeNull();
  });

  it("returns null for unrecognized magic bytes", () => {
    expect(parseImageByteHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))).toBeNull();
  });

  it("parses valid PNG dimensions", () => {
    const png = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG magic
      0,
      0,
      0,
      13, // IHDR length
      0x49,
      0x48,
      0x44,
      0x52, // "IHDR"
      0,
      0,
      1,
      0, // width = 256
      0,
      0,
      0,
      200 // height = 200
    ]);
    const parsed = parseImageByteHeader(png);
    expect(parsed).toEqual({
      mimeType: "image/png",
      width: 256,
      height: 200
    });
  });

  it("returns null for truncated PNG header", () => {
    const truncatedPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(parseImageByteHeader(truncatedPng)).toBeNull();
  });

  it("parses valid JPEG dimensions from SOF marker", () => {
    const jpeg = Buffer.from([
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0x00,
      0x10,
      0x4a,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x00,
      0x00,
      0x01,
      0x00,
      0x01,
      0x00,
      0x00, // APP0
      0xff,
      0xc0,
      0x00,
      0x0b,
      0x08,
      0x00,
      0x64,
      0x00,
      0xc8,
      0x01,
      0x01 // SOF0: height=100 (0x64), width=200 (0xc8)
    ]);
    const parsed = parseImageByteHeader(jpeg);
    expect(parsed).toEqual({
      mimeType: "image/jpeg",
      width: 200,
      height: 100
    });
  });

  it("returns null for JPEG without SOF marker", () => {
    const jpegWithoutSof = Buffer.from([
      0xff,
      0xd8, // SOI
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, // APP0
      0xff,
      0xd9 // EOI
    ]);
    expect(parseImageByteHeader(jpegWithoutSof)).toBeNull();
  });

  it("parses valid WebP VP8 lossy dimensions", () => {
    const vp8 = Buffer.alloc(30);
    vp8.write("RIFF", 0);
    vp8.writeUInt32LE(22, 4);
    vp8.write("WEBP", 8);
    vp8.write("VP8 ", 12);
    vp8.writeUInt32LE(10, 16);
    vp8[20] = 0x00; // keyframe
    vp8[21] = 0x00;
    vp8[22] = 0x00;
    vp8[23] = 0x9d; // start code
    vp8[24] = 0x01;
    vp8[25] = 0x2a;
    vp8[26] = 0x40; // width = 64
    vp8[27] = 0x00;
    vp8[28] = 0x30; // height = 48
    vp8[29] = 0x00;

    const parsed = parseImageByteHeader(vp8);
    expect(parsed).toEqual({
      mimeType: "image/webp",
      width: 64,
      height: 48
    });
  });

  it("parses valid WebP VP8L lossless dimensions", () => {
    const vp8l = Buffer.alloc(25);
    vp8l.write("RIFF", 0);
    vp8l.writeUInt32LE(17, 4);
    vp8l.write("WEBP", 8);
    vp8l.write("VP8L", 12);
    vp8l.writeUInt32LE(5, 16);
    vp8l[20] = 0x2f; // signature
    // width - 1 = 99 -> 99 = 0x0063
    // height - 1 = 199 -> 199 = 0x00c7
    // b0 = 99 & 0xff = 0x63
    // b1 = ((99 >> 8) & 0x3f) | ((199 & 0x03) << 6) = 0 | (3 << 6) = 0xc0
    // b2 = (199 >> 2) & 0xff = 0x31
    // b3 = (199 >> 10) & 0x0f = 0
    vp8l[21] = 0x63;
    vp8l[22] = 0xc0;
    vp8l[23] = 0x31;
    vp8l[24] = 0x00;

    const parsed = parseImageByteHeader(vp8l);
    expect(parsed).toEqual({
      mimeType: "image/webp",
      width: 100,
      height: 200
    });
  });

  it("parses valid WebP VP8X extended dimensions", () => {
    const vp8x = Buffer.alloc(30);
    vp8x.write("RIFF", 0);
    vp8x.writeUInt32LE(22, 4);
    vp8x.write("WEBP", 8);
    vp8x.write("VP8X", 12);
    vp8x.writeUInt32LE(10, 16);
    // width - 1 = 300 - 1 = 299 = 0x00012b
    vp8x[24] = 0x2b;
    vp8x[25] = 0x01;
    vp8x[26] = 0x00;
    // height - 1 = 400 - 1 = 399 = 0x00018f
    vp8x[27] = 0x8f;
    vp8x[28] = 0x01;
    vp8x[29] = 0x00;

    const parsed = parseImageByteHeader(vp8x);
    expect(parsed).toEqual({
      mimeType: "image/webp",
      width: 300,
      height: 400
    });
  });
});
