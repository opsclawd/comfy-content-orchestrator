export type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ParsedImageHeader {
  readonly mimeType: SupportedImageMimeType;
  readonly width: number;
  readonly height: number;
}

export function parseImageByteHeader(bytes: Uint8Array): ParsedImageHeader | null {
  if (!bytes || bytes.length < 8) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // 1. PNG
  if (
    view.getUint8(0) === 0x89 &&
    view.getUint8(1) === 0x50 &&
    view.getUint8(2) === 0x4e &&
    view.getUint8(3) === 0x47 &&
    view.getUint8(4) === 0x0d &&
    view.getUint8(5) === 0x0a &&
    view.getUint8(6) === 0x1a &&
    view.getUint8(7) === 0x0a
  ) {
    if (bytes.length < 24) return null;
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    return { mimeType: "image/png", width, height };
  }

  // 2. JPEG
  if (view.getUint8(0) === 0xff && view.getUint8(1) === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      if (view.getUint8(offset) !== 0xff) {
        offset++;
        continue;
      }
      while (offset < bytes.length && view.getUint8(offset) === 0xff) {
        offset++;
      }
      if (offset >= bytes.length) break;
      const marker = view.getUint8(offset++);
      if (marker === 0xd9 || marker === 0xda) break; // EOI or SOS (image data follows)
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const len = view.getUint16(offset, false);
      if (len < 2) break;
      const isSof =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isSof && offset + 7 <= bytes.length) {
        const height = view.getUint16(offset + 3, false);
        const width = view.getUint16(offset + 5, false);
        return { mimeType: "image/jpeg", width, height };
      }
      offset += len;
    }
    return null;
  }

  // 3. WebP
  if (
    bytes.length >= 12 &&
    view.getUint8(0) === 0x52 &&
    view.getUint8(1) === 0x49 &&
    view.getUint8(2) === 0x46 &&
    view.getUint8(3) === 0x46 && // RIFF
    view.getUint8(8) === 0x57 &&
    view.getUint8(9) === 0x45 &&
    view.getUint8(10) === 0x42 &&
    view.getUint8(11) === 0x50 // WEBP
  ) {
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const tag = String.fromCharCode(
        view.getUint8(offset),
        view.getUint8(offset + 1),
        view.getUint8(offset + 2),
        view.getUint8(offset + 3)
      );
      const chunkSize = view.getUint32(offset + 4, true); // little-endian

      if (tag === "VP8 " && offset + 8 + 10 <= bytes.length) {
        const keyframe = (view.getUint8(offset + 8) & 1) === 0;
        const startCode =
          view.getUint8(offset + 11) === 0x9d &&
          view.getUint8(offset + 12) === 0x01 &&
          view.getUint8(offset + 13) === 0x2a;
        if (keyframe && startCode) {
          const width = view.getUint16(offset + 14, true) & 0x3fff;
          const height = view.getUint16(offset + 16, true) & 0x3fff;
          return { mimeType: "image/webp", width, height };
        }
      }

      if (tag === "VP8L" && offset + 8 + 5 <= bytes.length) {
        if (view.getUint8(offset + 8) === 0x2f) {
          const b0 = view.getUint8(offset + 9);
          const b1 = view.getUint8(offset + 10);
          const b2 = view.getUint8(offset + 11);
          const b3 = view.getUint8(offset + 12);
          const width = (b0 | ((b1 & 0x3f) << 8)) + 1;
          const height = ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) + 1;
          return { mimeType: "image/webp", width, height };
        }
      }

      if (tag === "VP8X" && offset + 8 + 10 <= bytes.length) {
        const width =
          (view.getUint8(offset + 12) |
            (view.getUint8(offset + 13) << 8) |
            (view.getUint8(offset + 14) << 16)) +
          1;
        const height =
          (view.getUint8(offset + 15) |
            (view.getUint8(offset + 16) << 8) |
            (view.getUint8(offset + 17) << 16)) +
          1;
        return { mimeType: "image/webp", width, height };
      }

      offset += 8 + chunkSize + (chunkSize & 1);
    }
    return null;
  }

  return null;
}
