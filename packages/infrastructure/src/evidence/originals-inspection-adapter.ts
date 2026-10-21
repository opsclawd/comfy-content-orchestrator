import sharp from "sharp";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from "pdf-lib";
import type { EvidenceSourceClass } from "@cco/shared";
import { MimeConflictError, ProductValidationError } from "@cco/domain";
import type { InspectedOriginalMetadata, OriginalsInspectionPort } from "@cco/application";

export interface OriginalsInspectionLimits {
  readonly maxPhotoBytes?: number;
  readonly maxDocumentBytes?: number;
  readonly maxRawBytes?: number;
  readonly maxImageDimension?: number;
  readonly maxImagePixels?: number;
}

const DEFAULT_MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MiB
const DEFAULT_MAX_RAW_BYTES = 64 * 1024 * 1024; // 64 MiB
const DEFAULT_MAX_IMAGE_DIMENSION = 16384;
const DEFAULT_MAX_IMAGE_PIXELS = 67_108_864;

// Magic numbers
const JPEG_HEADER = [0xff, 0xd8, 0xff];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PDF_MAGIC = "%PDF-";

export class OriginalsInspectionAdapter implements OriginalsInspectionPort {
  constructor(private readonly limits: OriginalsInspectionLimits = {}) {}

  async inspectAndValidate(
    body: Buffer | Uint8Array,
    declaredMimeType: string,
    sourceClass: EvidenceSourceClass
  ): Promise<InspectedOriginalMetadata> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const byteLength = buffer.length;

    if (byteLength === 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: "Uploaded evidence file buffer cannot be empty."
        }
      ]);
    }

    const normDeclared = declaredMimeType.trim().toLowerCase();

    switch (sourceClass) {
      case "photo":
        return this.inspectPhoto(buffer, normDeclared);

      case "document":
      case "coa":
      case "process_record":
        return this.inspectDocument(buffer, normDeclared, sourceClass);

      case "raw":
        return this.inspectRaw(buffer, normDeclared);

      case "video":
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["sourceClass"],
            message:
              'Unsupported source class: "video". Video source evidence is not yet supported in this phase.'
          }
        ]);

      default:
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["sourceClass"],
            message: `Unsupported source class: "${String(sourceClass)}".`
          }
        ]);
    }
  }

  // --------------------------------------------------------------------------
  // Photo Inspection (JPEG, PNG, WebP)
  // --------------------------------------------------------------------------
  private async inspectPhoto(
    buffer: Buffer,
    declaredMime: string
  ): Promise<InspectedOriginalMetadata> {
    const maxBytes = this.limits.maxPhotoBytes ?? DEFAULT_MAX_PHOTO_BYTES;
    if (buffer.length > maxBytes) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Photo file size (${buffer.length} bytes) exceeds limit of ${maxBytes} bytes.`
        }
      ]);
    }

    const detectedMime = this.sniffRasterMime(buffer);
    if (!detectedMime) {
      throw new MimeConflictError(
        `Unable to detect a supported photo format (JPEG, PNG, WebP) from byte headers.`
      );
    }

    if (detectedMime !== declaredMime) {
      throw new MimeConflictError(
        `Declared MIME type "${declaredMime}" does not match detected MIME type "${detectedMime}".`,
        { declaredMime, detectedMime }
      );
    }

    let meta: sharp.Metadata;
    try {
      meta = await sharp(buffer, { failOn: "error" }).metadata();
    } catch (err) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Corrupt or unreadable image stream: ${err instanceof Error ? err.message : String(err)}`
        }
      ]);
    }

    const width = meta.width;
    const height = meta.height;

    if (!width || !height || width <= 0 || height <= 0) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: "Image dimensions could not be reliably determined."
        }
      ]);
    }

    const maxDim = this.limits.maxImageDimension ?? DEFAULT_MAX_IMAGE_DIMENSION;
    if (width > maxDim || height > maxDim) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Image dimensions (${width}x${height}) exceed maximum allowed dimension of ${maxDim}px.`
        }
      ]);
    }

    const maxPixels = this.limits.maxImagePixels ?? DEFAULT_MAX_IMAGE_PIXELS;
    if (width * height > maxPixels) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Image total pixels (${width * height}) exceed maximum allowed pixels of ${maxPixels}.`
        }
      ]);
    }

    return {
      detectedMimeType: detectedMime,
      byteLength: buffer.length,
      sourceClass: "photo",
      width,
      height
    };
  }

  private sniffRasterMime(buffer: Buffer): string | null {
    if (
      buffer.length >= 3 &&
      buffer[0] === JPEG_HEADER[0] &&
      buffer[1] === JPEG_HEADER[1] &&
      buffer[2] === JPEG_HEADER[2]
    ) {
      return "image/jpeg";
    }

    if (buffer.length >= PNG_HEADER.length) {
      let isPng = true;
      for (let i = 0; i < PNG_HEADER.length; i++) {
        if (buffer[i] !== PNG_HEADER[i]) {
          isPng = false;
          break;
        }
      }
      if (isPng) {
        return "image/png";
      }
    }

    if (buffer.length >= 12) {
      const riff = buffer.toString("ascii", 0, 4);
      const webp = buffer.toString("ascii", 8, 12);
      if (riff === "RIFF" && webp === "WEBP") {
        return "image/webp";
      }
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Document Inspection (PDF)
  // --------------------------------------------------------------------------
  private async inspectDocument(
    buffer: Buffer,
    declaredMime: string,
    sourceClass: EvidenceSourceClass
  ): Promise<InspectedOriginalMetadata> {
    const maxBytes = this.limits.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES;
    if (buffer.length > maxBytes) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Document file size (${buffer.length} bytes) exceeds limit of ${maxBytes} bytes.`
        }
      ]);
    }

    if (declaredMime !== "application/pdf") {
      throw new MimeConflictError(
        `Declared MIME type "${declaredMime}" is not supported for ${sourceClass}. Only "application/pdf" is supported.`,
        { declaredMime, supportedMime: "application/pdf" }
      );
    }

    // Check %PDF- header
    const header = buffer.toString("ascii", 0, 5);
    if (header !== PDF_MAGIC) {
      throw new MimeConflictError(`PDF file does not begin with valid %PDF- magic header.`, {
        declaredMime,
        detectedHeader: header
      });
    }

    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(buffer, {
        ignoreEncryption: false,
        updateMetadata: false
      });
    } catch (err) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Malformed or unparseable PDF document structure: ${err instanceof Error ? err.message : String(err)}`
        }
      ]);
    }

    if (pdfDoc.isEncrypted) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: "Encrypted PDFs are not permitted for evidence archives."
        }
      ]);
    }

    const pageCount = pdfDoc.getPageCount();
    if (pageCount < 1) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: "PDF document contains 0 pages."
        }
      ]);
    }

    // Security check: inspect catalog and dictionary entries for active scripts / embedded files
    this.assertPdfNoActiveContent(pdfDoc);

    return {
      detectedMimeType: "application/pdf",
      byteLength: buffer.length,
      sourceClass
    };
  }

  private assertPdfNoActiveContent(doc: PDFDocument): void {
    const forbiddenKeyNames = new Set([
      "OpenAction",
      "AA",
      "JavaScript",
      "JS",
      "Launch",
      "EmbeddedFiles",
      "EF",
      "SubmitForm",
      "ImportData",
      "RichMedia"
    ]);

    const forbiddenSubtypes = new Set([
      "/Launch",
      "/JavaScript",
      "/JS",
      "/SubmitForm",
      "/ImportData",
      "/RichMedia",
      "/Sound",
      "/Movie"
    ]);

    try {
      const visited = new Set<PDFObject>();

      const inspectObject = (obj: PDFObject): void => {
        if (visited.has(obj)) {
          return;
        }
        visited.add(obj);

        if (obj instanceof PDFDict) {
          const typeObj = obj.lookupMaybe(PDFName.of("Type"), PDFName);
          if (typeObj && typeObj.asString() === "/EmbeddedFile") {
            throw new ProductValidationError([
              {
                code: "INVALID_FIELD_COMBINATION",
                path: ["body"],
                message: 'PDF document contains forbidden embedded file stream ("/EmbeddedFile").'
              }
            ]);
          }

          for (const [key, rawVal] of obj.entries()) {
            const keyName = key.asString().replace(/^\//, "");
            if (forbiddenKeyNames.has(keyName)) {
              throw new ProductValidationError([
                {
                  code: "INVALID_FIELD_COMBINATION",
                  path: ["body"],
                  message: `PDF document contains forbidden active element or embedded file: "/${keyName}".`
                }
              ]);
            }

            const val = doc.context.lookup(rawVal);
            if (keyName === "S" && val instanceof PDFName) {
              if (forbiddenSubtypes.has(val.asString())) {
                throw new ProductValidationError([
                  {
                    code: "INVALID_FIELD_COMBINATION",
                    path: ["body"],
                    message: `PDF document contains forbidden action subtype: "${val.asString()}".`
                  }
                ]);
              }
            }

            if (val) {
              inspectObject(val);
            }
          }
        } else if (obj instanceof PDFStream) {
          inspectObject(obj.dict);
        } else if (obj instanceof PDFArray) {
          for (const rawItem of obj.asArray()) {
            const item = doc.context.lookup(rawItem);
            if (item) {
              inspectObject(item);
            }
          }
        }
      };

      inspectObject(doc.catalog);

      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        inspectObject(obj);
      }
    } catch (err) {
      if (err instanceof ProductValidationError) {
        throw err;
      }
      // If reading catalog elements threw an unexpected error, fail closed
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `PDF structural inspection failed: ${err instanceof Error ? err.message : String(err)}`
        }
      ]);
    }
  }

  // --------------------------------------------------------------------------
  // RAW Inspection (Adobe DNG bounded TIFF container)
  // --------------------------------------------------------------------------
  private inspectRaw(buffer: Buffer, declaredMime: string): InspectedOriginalMetadata {
    const maxBytes = this.limits.maxRawBytes ?? DEFAULT_MAX_RAW_BYTES;
    if (buffer.length > maxBytes) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `RAW file size (${buffer.length} bytes) exceeds limit of ${maxBytes} bytes.`
        }
      ]);
    }

    if (declaredMime !== "image/x-adobe-dng") {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["declaredMimeType"],
          message: `Unsupported RAW format: "${declaredMime}". Supported RAW format is image/x-adobe-dng (Adobe DNG). Proprietary RAW formats (e.g. Sony ARW, Canon CR3) must be converted to DNG prior to ingestion.`
        }
      ]);
    }

    if (buffer.length < 16) {
      throw new MimeConflictError("RAW buffer is too small to contain a valid TIFF/DNG header.");
    }

    // Inspect TIFF byte order & magic
    const byteOrder = buffer.toString("ascii", 0, 2);
    let isLittleEndian: boolean;
    if (byteOrder === "II") {
      isLittleEndian = true;
    } else if (byteOrder === "MM") {
      isLittleEndian = false;
    } else {
      throw new MimeConflictError(
        `Invalid byte order in RAW file: "${byteOrder}". Expected "II" (little-endian) or "MM" (big-endian).`
      );
    }

    const magic = isLittleEndian ? buffer.readUInt16LE(2) : buffer.readUInt16BE(2);
    if (magic !== 42) {
      throw new MimeConflictError(`Invalid TIFF magic number: ${magic}. Expected 42.`);
    }

    const firstIfdOffset = isLittleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4);
    if (firstIfdOffset < 8 || firstIfdOffset >= buffer.length) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message: `Invalid TIFF IFD offset (${firstIfdOffset}) in RAW container.`
        }
      ]);
    }

    // Bounded traversal of IFDs to find DNGVersion tag (50706 / 0xC612)
    const hasDngVersion = this.findDngVersionTag(buffer, firstIfdOffset, isLittleEndian);
    if (!hasDngVersion) {
      throw new ProductValidationError([
        {
          code: "INVALID_FIELD_COMBINATION",
          path: ["body"],
          message:
            "TIFF container is not an Adobe DNG file (missing mandatory DNGVersion tag 50706). Generic TIFF or non-DNG RAW files are not permitted."
        }
      ]);
    }

    return {
      detectedMimeType: "image/x-adobe-dng",
      byteLength: buffer.length,
      sourceClass: "raw"
    };
  }

  private findDngVersionTag(
    buffer: Buffer,
    initialIfdOffset: number,
    isLittleEndian: boolean
  ): boolean {
    const TAG_DNG_VERSION = 50706; // 0xC612
    let ifdOffset = initialIfdOffset;
    let ifdsVisited = 0;
    const maxIfds = 10;
    const visitedOffsets = new Set<number>();
    let foundValidDngVersion = false;

    while (ifdOffset > 0) {
      if (visitedOffsets.has(ifdOffset)) {
        // Cycle detected
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["body"],
            message: "Cyclic IFD structure detected in RAW TIFF container."
          }
        ]);
      }
      visitedOffsets.add(ifdOffset);
      ifdsVisited++;

      if (ifdsVisited > maxIfds) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["body"],
            message: `TIFF IFD chain exceeds bounded inspection limit (${maxIfds}).`
          }
        ]);
      }

      if (ifdOffset + 2 > buffer.length) {
        return false;
      }

      const numEntries = isLittleEndian
        ? buffer.readUInt16LE(ifdOffset)
        : buffer.readUInt16BE(ifdOffset);

      if (numEntries > 500) {
        throw new ProductValidationError([
          {
            code: "INVALID_FIELD_COMBINATION",
            path: ["body"],
            message: `TIFF IFD entry count (${numEntries}) exceeds safe bounded inspection limit (500).`
          }
        ]);
      }

      const ifdTotalLength = 2 + numEntries * 12 + 4;
      if (ifdOffset + ifdTotalLength > buffer.length) {
        return false;
      }

      let offset = ifdOffset + 2;
      for (let i = 0; i < numEntries; i++) {
        const tag = isLittleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
        if (tag === TAG_DNG_VERSION) {
          const type = isLittleEndian
            ? buffer.readUInt16LE(offset + 2)
            : buffer.readUInt16BE(offset + 2);
          const count = isLittleEndian
            ? buffer.readUInt32LE(offset + 4)
            : buffer.readUInt32BE(offset + 4);
          if (type === 1 && count === 4) {
            foundValidDngVersion = true;
          }
        }
        offset += 12;
      }

      const nextIfdOffset = isLittleEndian
        ? buffer.readUInt32LE(offset)
        : buffer.readUInt32BE(offset);

      if (nextIfdOffset !== 0) {
        if (visitedOffsets.has(nextIfdOffset)) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["body"],
              message: "Cyclic IFD structure detected in RAW TIFF container."
            }
          ]);
        }
        if (ifdsVisited >= maxIfds) {
          throw new ProductValidationError([
            {
              code: "INVALID_FIELD_COMBINATION",
              path: ["body"],
              message: `TIFF IFD chain exceeds bounded inspection limit (${maxIfds}) or has uninspected trailing IFDs.`
            }
          ]);
        }
      }

      ifdOffset = nextIfdOffset;
    }

    return foundValidDngVersion;
  }
}
