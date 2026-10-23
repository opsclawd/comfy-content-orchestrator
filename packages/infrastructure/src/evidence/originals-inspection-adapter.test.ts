import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument, PDFName } from "pdf-lib";
import { MimeConflictError, ProductValidationError } from "@cco/domain";
import { OriginalsInspectionAdapter } from "./originals-inspection-adapter.js";

function createSyntheticDngBuffer(includeDngTag = true): Buffer {
  const buf = Buffer.alloc(32);
  // Byte order: Little-endian
  buf.write("II", 0, "ascii");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4); // IFD offset = 8

  // Entry count = 1
  buf.writeUInt16LE(1, 8);

  // Tag: 50706 (DNGVersion) or 256 (ImageWidth)
  const tag = includeDngTag ? 50706 : 256;
  buf.writeUInt16LE(tag, 10);
  buf.writeUInt16LE(1, 12); // Type: BYTE (1)
  buf.writeUInt32LE(4, 14); // Count: 4
  buf.writeUInt8(1, 18); // Version 1.4.0.0
  buf.writeUInt8(4, 19);
  buf.writeUInt8(0, 20);
  buf.writeUInt8(0, 21);

  // Next IFD = 0
  buf.writeUInt32LE(0, 22);

  return buf;
}

describe("OriginalsInspectionAdapter", () => {
  const adapter = new OriginalsInspectionAdapter();

  describe("Photo inspection", () => {
    it("validates a valid PNG photo", async () => {
      const pngBytes = await sharp({
        create: { width: 10, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } }
      })
        .png()
        .toBuffer();

      const res = await adapter.inspectAndValidate(pngBytes, "image/png", "photo");
      expect(res.detectedMimeType).toBe("image/png");
      expect(res.sourceClass).toBe("photo");
      expect(res.width).toBe(10);
      expect(res.height).toBe(20);
    });

    it("validates a valid JPEG photo", async () => {
      const jpegBytes = await sharp({
        create: { width: 15, height: 25, channels: 3, background: { r: 0, g: 255, b: 0 } }
      })
        .jpeg()
        .toBuffer();

      const res = await adapter.inspectAndValidate(jpegBytes, "image/jpeg", "photo");
      expect(res.detectedMimeType).toBe("image/jpeg");
      expect(res.sourceClass).toBe("photo");
      expect(res.width).toBe(15);
      expect(res.height).toBe(25);
    });

    it("throws MimeConflictError when declared MIME does not match detected image", async () => {
      const pngBytes = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } }
      })
        .png()
        .toBuffer();

      await expect(adapter.inspectAndValidate(pngBytes, "image/jpeg", "photo")).rejects.toThrow(
        MimeConflictError
      );
    });

    it("throws ProductValidationError for corrupt image", async () => {
      const corrupt = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11, 0x22]); // Fake JPEG header then junk
      await expect(adapter.inspectAndValidate(corrupt, "image/jpeg", "photo")).rejects.toThrow(
        ProductValidationError
      );
    });

    it("enforces maxPhotoBytes limit", async () => {
      const smallLimitAdapter = new OriginalsInspectionAdapter({ maxPhotoBytes: 50 });
      const pngBytes = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 255 } }
      })
        .png()
        .toBuffer();

      await expect(
        smallLimitAdapter.inspectAndValidate(pngBytes, "image/png", "photo")
      ).rejects.toThrow(ProductValidationError);
    });
  });

  describe("Document / CoA inspection", () => {
    it("validates a valid clean PDF", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      const pdfBytes = await doc.save();

      const res = await adapter.inspectAndValidate(pdfBytes, "application/pdf", "coa");
      expect(res.detectedMimeType).toBe("application/pdf");
      expect(res.sourceClass).toBe("coa");
      expect(res.byteLength).toBe(pdfBytes.length);
    });

    it("rejects PDF not starting with %PDF-", async () => {
      const badPdf = Buffer.from("NOT_A_PDF_FILE");
      await expect(
        adapter.inspectAndValidate(badPdf, "application/pdf", "document")
      ).rejects.toThrow(MimeConflictError);
    });

    it("rejects PDF with active scripts or embedded files", async () => {
      const doc = await PDFDocument.create();
      doc.addPage([200, 200]);
      // Inject forbidden JavaScript name in catalog
      doc.catalog.set(PDFName.of("JavaScript"), doc.context.obj({}));
      const pdfBytes = await doc.save();

      await expect(
        adapter.inspectAndValidate(pdfBytes, "application/pdf", "document")
      ).rejects.toThrow(ProductValidationError);
    });

    it("rejects PDF with /OpenAction or /AA in catalog or indirect objects", async () => {
      const doc1 = await PDFDocument.create();
      doc1.addPage([200, 200]);
      doc1.catalog.set(PDFName.of("OpenAction"), doc1.context.obj({}));
      const pdf1 = await doc1.save();
      await expect(adapter.inspectAndValidate(pdf1, "application/pdf", "document")).rejects.toThrow(
        /OpenAction/
      );

      const doc2 = await PDFDocument.create();
      doc2.addPage([200, 200]);
      doc2.catalog.set(PDFName.of("AA"), doc2.context.obj({}));
      const pdf2 = await doc2.save();
      await expect(adapter.inspectAndValidate(pdf2, "application/pdf", "document")).rejects.toThrow(
        /AA/
      );

      const doc3 = await PDFDocument.create();
      doc3.addPage([200, 200]);
      const indirectDict = doc3.context.obj({
        Type: PDFName.of("EmbeddedFile")
      });
      doc3.context.register(indirectDict);
      const pdf3 = await doc3.save();
      await expect(adapter.inspectAndValidate(pdf3, "application/pdf", "document")).rejects.toThrow(
        /EmbeddedFile/
      );
    });

    it("rejects PDF with nested action dictionary (e.g. /A << /S /Launch >>)", async () => {
      const doc = await PDFDocument.create();
      const page = doc.addPage([200, 200]);
      const actionDict = doc.context.obj({
        S: PDFName.of("Launch"),
        F: "malicious.sh"
      });
      const annotDict = doc.context.obj({
        Type: PDFName.of("Annot"),
        Subtype: PDFName.of("Link"),
        A: actionDict
      });
      page.node.set(PDFName.of("Annots"), doc.context.obj([annotDict]));
      const pdfBytes = await doc.save();
      await expect(
        adapter.inspectAndValidate(pdfBytes, "application/pdf", "document")
      ).rejects.toThrow(/forbidden action subtype: "\/Launch"/);
    });
  });

  describe("RAW inspection (Adobe DNG)", () => {
    it("validates a valid synthetic DNG container with tag 50706", async () => {
      const dngBuf = createSyntheticDngBuffer(true);
      const res = await adapter.inspectAndValidate(dngBuf, "image/x-adobe-dng", "raw");
      expect(res.detectedMimeType).toBe("image/x-adobe-dng");
      expect(res.sourceClass).toBe("raw");
    });

    it("rejects generic TIFF missing DNGVersion tag 50706", async () => {
      const tiffBuf = createSyntheticDngBuffer(false);
      await expect(adapter.inspectAndValidate(tiffBuf, "image/x-adobe-dng", "raw")).rejects.toThrow(
        ProductValidationError
      );
    });

    it("rejects DNG container with invalid tag 50706 type or count", async () => {
      // Modify tag 50706 type to SHORT (3) instead of BYTE (1)
      const dngBuf = createSyntheticDngBuffer(true);
      dngBuf.writeUInt16LE(3, 12);
      await expect(adapter.inspectAndValidate(dngBuf, "image/x-adobe-dng", "raw")).rejects.toThrow(
        ProductValidationError
      );

      // Modify count to 2 instead of 4
      const dngBuf2 = createSyntheticDngBuffer(true);
      dngBuf2.writeUInt32LE(2, 14);
      await expect(adapter.inspectAndValidate(dngBuf2, "image/x-adobe-dng", "raw")).rejects.toThrow(
        ProductValidationError
      );
    });

    it("rejects cyclic IFD in RAW container", async () => {
      const cyclicBuf = createSyntheticDngBuffer(true);
      // Point next IFD offset back to first IFD (offset 8)
      cyclicBuf.writeUInt32LE(8, 22);
      await expect(
        adapter.inspectAndValidate(cyclicBuf, "image/x-adobe-dng", "raw")
      ).rejects.toThrow(/Cyclic IFD structure detected/);
    });

    it("rejects cyclic DNG container where 10th IFD points back to first", async () => {
      const buf = Buffer.alloc(8 + 10 * 18);
      buf.write("II", 0, "ascii");
      buf.writeUInt16LE(42, 2);
      buf.writeUInt32LE(8, 4);

      for (let i = 0; i < 10; i++) {
        const ifdStart = 8 + i * 18;
        buf.writeUInt16LE(1, ifdStart); // 1 entry
        buf.writeUInt16LE(50706, ifdStart + 2); // DNGVersion
        buf.writeUInt16LE(1, ifdStart + 4); // BYTE
        buf.writeUInt32LE(4, ifdStart + 6); // count 4
        buf.writeUInt8(1, ifdStart + 10);
        buf.writeUInt8(4, ifdStart + 11);
        buf.writeUInt8(0, ifdStart + 12);
        buf.writeUInt8(0, ifdStart + 13);
        const next = i < 9 ? ifdStart + 18 : 8; // 10th points back to 8!
        buf.writeUInt32LE(next, ifdStart + 14);
      }

      await expect(adapter.inspectAndValidate(buf, "image/x-adobe-dng", "raw")).rejects.toThrow(
        /Cyclic IFD structure detected/
      );
    });

    it("rejects proprietary RAW formats with actionable guidance", async () => {
      const buf = Buffer.alloc(100);
      await expect(adapter.inspectAndValidate(buf, "image/x-sony-arw", "raw")).rejects.toThrow(
        /Unsupported RAW format/
      );
    });
  });

  describe("Unsupported source classes", () => {
    it("rejects video sourceClass with actionable guidance", async () => {
      const buf = Buffer.from("dummy video content");
      await expect(adapter.inspectAndValidate(buf, "video/mp4", "video")).rejects.toThrow(
        /Unsupported source class: "video"/
      );
    });
  });
});
