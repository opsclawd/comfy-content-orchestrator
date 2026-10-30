import { describe, expect, it, vi } from "vitest";
import {
  TesseractPrevisTextDetector,
  type CreateTesseractWorker,
  type TesseractWorkerLike
} from "./tesseract-previs-text-detector.js";

function fakeWorker(): TesseractWorkerLike & { terminate: ReturnType<typeof vi.fn> } {
  return {
    setParameters: vi.fn(async () => undefined),
    recognize: vi.fn(async () => ({
      data: {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    words: [
                      { text: "LENTA", confidence: 91.5, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } },
                      { text: "x", confidence: 250 }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    })),
    terminate: vi.fn(async () => undefined)
  };
}

describe("TesseractPrevisTextDetector", () => {
  it("creates one worker lazily with local langPath, no cache, sparse PSM", async () => {
    const worker = fakeWorker();
    const create = vi.fn<CreateTesseractWorker>(async () => worker);
    const detector = new TesseractPrevisTextDetector({
      createWorker: create,
      langPath: "/local/tessdata",
      gzip: true,
      engineVersion: "9.9.9"
    });
    expect(create).not.toHaveBeenCalled();

    await detector.detectText({ bytes: new Uint8Array([1]) });
    await detector.detectText({ bytes: new Uint8Array([2]) });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith("eng", 1, {
      langPath: "/local/tessdata",
      gzip: true,
      cacheMethod: "none"
    });
    expect(worker.setParameters).toHaveBeenCalledWith({ tessedit_pageseg_mode: "11" });
  });

  it("maps words to normalised regions", async () => {
    const detector = new TesseractPrevisTextDetector({
      createWorker: async () => fakeWorker(),
      langPath: "/x",
      engineVersion: "9.9.9"
    });
    const result = await detector.detectText({ bytes: new Uint8Array([1]) });
    expect(result.engine).toEqual({ id: "tesseract.js", version: "9.9.9" });
    expect(result.regions).toEqual([
      { text: "LENTA", confidence: 0.915, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } },
      { text: "x", confidence: 1 }
    ]);
  });

  it("resolves the bundled English data by default and forwards terminate", async () => {
    const worker = fakeWorker();
    const create = vi.fn<CreateTesseractWorker>(async () => worker);
    const detector = new TesseractPrevisTextDetector({ createWorker: create });
    await detector.detectText({ bytes: new Uint8Array([1]) });
    const opts = create.mock.calls[0]![2];
    expect(String(opts.langPath)).toContain("@tesseract.js-data");
    expect(opts.cacheMethod).toBe("none");
    await detector.terminate();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("recycles the worker after a timeout so the next call gets a fresh one", async () => {
    const first = fakeWorker();
    const second = fakeWorker();
    const create = vi
      .fn<CreateTesseractWorker>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const detector = new TesseractPrevisTextDetector({ createWorker: create });
    await detector.detectText({ bytes: new Uint8Array([1]) });
    await detector.recycleAfterTimeout();
    expect(first.terminate).toHaveBeenCalledTimes(1);
    await detector.detectText({ bytes: new Uint8Array([1]) });
    expect(create).toHaveBeenCalledTimes(2);
  });
});
