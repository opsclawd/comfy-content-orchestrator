import sharp from "sharp";
import {
  ImageValidationError,
  type ImageInspectionLimits,
  type ImageInspectionPort,
  type SupportedReferenceMimeType,
  type ValidatedImageMetadata,
  SUPPORTED_REFERENCE_MIME_TYPES
} from "@cco/application";

export const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MiB
export const DEFAULT_MAX_WIDTH = 8192;
export const DEFAULT_MAX_HEIGHT = 8192;
export const DEFAULT_MAX_PIXELS = 8192 * 8192;

export class SharpImageInspectionAdapter implements ImageInspectionPort {
  async inspectAndValidate(
    buffer: Buffer | Uint8Array,
    declaredMimeType: string,
    limits?: ImageInspectionLimits
  ): Promise<ValidatedImageMetadata> {
    if (!buffer || buffer.length === 0) {
      throw new ImageValidationError("Image buffer cannot be empty");
    }

    const maxByteSize = limits?.maxByteSize ?? DEFAULT_MAX_IMAGE_BYTES;
    if (buffer.length > maxByteSize) {
      throw new ImageValidationError(
        `Image exceeds maximum allowed size of ${maxByteSize} bytes (received ${buffer.length} bytes)`
      );
    }

    if (!SUPPORTED_REFERENCE_MIME_TYPES.includes(declaredMimeType as SupportedReferenceMimeType)) {
      throw new ImageValidationError(
        `Unsupported declared Content-Type "${declaredMimeType}". Must be one of: ${SUPPORTED_REFERENCE_MIME_TYPES.join(", ")}`
      );
    }

    const maxWidth = limits?.maxWidth ?? DEFAULT_MAX_WIDTH;
    const maxHeight = limits?.maxHeight ?? DEFAULT_MAX_HEIGHT;
    const maxPixels = limits?.maxPixels ?? DEFAULT_MAX_PIXELS;

    const inputBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);

    let metadata: sharp.Metadata;
    try {
      const image = sharp(inputBuffer, {
        failOnError: true,
        limitInputPixels: maxPixels
      });
      metadata = await image.metadata();
      // Decode image channels/stats to catch truncated or corrupted payload chunks
      await image.stats();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ImageValidationError(`Malformed or unparseable image buffer: ${message}`);
    }

    let detectedMimeType: SupportedReferenceMimeType;
    if (metadata.format === "png") {
      detectedMimeType = "image/png";
    } else if (metadata.format === "jpeg") {
      detectedMimeType = "image/jpeg";
    } else if (metadata.format === "webp") {
      detectedMimeType = "image/webp";
    } else {
      throw new ImageValidationError(
        `Unsupported detected image format "${metadata.format ?? "unknown"}". Must be one of: image/png, image/jpeg, image/webp`
      );
    }

    if (declaredMimeType !== detectedMimeType) {
      throw new ImageValidationError(
        `MIME type mismatch: declared Content-Type "${declaredMimeType}" does not match detected format "${detectedMimeType}".`
      );
    }

    const width = metadata.width;
    const height = metadata.height;

    if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
      throw new ImageValidationError("Image must have positive width and height.");
    }

    if (width > maxWidth) {
      throw new ImageValidationError(
        `Image width (${width}) exceeds maximum allowed width (${maxWidth}).`
      );
    }

    if (height > maxHeight) {
      throw new ImageValidationError(
        `Image height (${height}) exceeds maximum allowed height (${maxHeight}).`
      );
    }

    const pixelCount = width * height;
    if (pixelCount > maxPixels) {
      throw new ImageValidationError(
        `Image pixel count (${pixelCount}) exceeds maximum allowed (${maxPixels}).`
      );
    }

    return {
      detectedMimeType,
      width,
      height,
      byteLength: inputBuffer.length
    };
  }
}
